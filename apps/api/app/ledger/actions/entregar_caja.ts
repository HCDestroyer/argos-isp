import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, NoEncontrado, ReglaNegocio, ValidacionFallida } from '#shared/errores'
import { alcanceDePermiso } from '#core/acl'
import { aTexto, dec } from '#ledger/dinero'
import { ajustesCajas, entregaVigenteDelTurno, verEntrega, type EntregaVista } from '#ledger/custodia'
import RecibirEntrega from '#ledger/actions/recibir_entrega'

/**
 * `cajas.entregar` (`POST /cajas/turnos/:id/entregar`): entrega el efectivo de un turno cerrado de
 * una caja de cobros a una persona (custodia). B1 del plan de contabilidad, §5.7.
 *
 * - La llama `cajas.cerrar` al cerrar con `entregado_a` (origen `cierre`) y, por la ruta, el cajero
 *   cuando quien debía recibir dijo «No lo recibí» (origen `reentrega`). El monto es lo que no quedó de
 *   fondo (`entregado_monto` del turno): 422 `turno_sin_entrega` si no hay.
 * - Una sola entrega vigente por turno (409 `entrega_vigente`).
 * - Sin asiento: hasta que quien recibe diga «Recibí» el efectivo sigue a nombre del cajero (cuenta
 *   de la caja). Quien recibe necesita `cajas.recibir_entrega` (422 `receptor_sin_permiso`).
 * - «Lo deposito yo» (`entregado_a` = quien entrega): se recibe en el acto (`cajas.recibir_entrega`
 *   anidada, sin diferencia), si la empresa lo permite (422 `autoentrega_apagada`).
 * - Evento `caja.entregada` (y `caja.entrega_recibida` con «lo deposito yo»).
 */

export interface EntradaEntregarCaja {
    turno_id: number
    entregado_a: number
    /** interno: `cierre` desde `cajas.cerrar`; la ruta siempre usa `reentrega` */
    origen?: 'cierre' | 'reentrega'
}

export default class EntregarCaja extends DomainAction<EntradaEntregarCaja, EntregaVista> {
    readonly nombre = 'cajas.entregar'

    protected async handle(input: EntradaEntregarCaja, t: Transaccion): Promise<EntregaVista> {
        t.fijarEntidad('caja_turno', input.turno_id)
        const turno = (await t.trx
            .from('ledger.cajas_turnos as tu')
            .join('ledger.cajas as c', 'c.id', 'tu.caja_id')
            .where('tu.id', input.turno_id)
            .forUpdate()
            .select(
                'tu.id',
                'tu.caja_id',
                'tu.cerrado_en',
                'tu.cerrado_por',
                'tu.abierto_por',
                'tu.entregado_monto',
                'c.empresa_id',
                'c.tipo',
                'c.nombre',
            )
            .first()) as {
            id: number
            caja_id: number
            cerrado_en: Date | null
            cerrado_por: number | null
            abierto_por: number | null
            entregado_monto: string | null
            empresa_id: number
            tipo: string
            nombre: string
        } | null
        if (!turno) throw new NoEncontrado(`El turno ${input.turno_id} no existe`)
        const empresaId = Number(turno.empresa_id)
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        if (turno.tipo !== 'cobros') {
            throw new ReglaNegocio(`${turno.nombre} no es una caja de cobros`, 'caja_no_es_de_cobros')
        }
        if (!turno.cerrado_en) {
            throw new Conflicto(
                `El turno ${turno.id} sigue abierto: se entrega al cerrarlo`,
                'turno_abierto',
                'Turno abierto',
            )
        }
        const monto = dec(turno.entregado_monto ?? '0')
        if (monto.lte(0)) {
            throw new ReglaNegocio(
                `El turno ${turno.id} no dejó efectivo para entregar (todo quedó de fondo)`,
                'turno_sin_entrega',
            )
        }
        const vigente = await entregaVigenteDelTurno(t.trx, turno.id)
        if (vigente) {
            throw new Conflicto(
                `El turno ${turno.id} ya tiene la entrega ${vigente.id} (${vigente.estado})`,
                'entrega_vigente',
                'Entrega vigente',
            )
        }

        const receptor = await t.trx
            .from('core.usuarios')
            .where({ id: input.entregado_a, activo: true })
            .select('id')
            .first()
        if (!receptor) {
            throw new ValidacionFallida([
                { field: 'entregado_a', message: 'Usuario inexistente o inactivo', rule: 'exists' },
            ])
        }
        const actor = usuarioDelActor(t.ctx.actor)
        const entregadoPor = actor ?? turno.cerrado_por ?? turno.abierto_por
        const autoentrega = entregadoPor !== null && Number(entregadoPor) === input.entregado_a
        if (autoentrega) {
            const ajustes = await ajustesCajas(empresaId, t.trx)
            if (!ajustes.autoentrega) {
                throw new ReglaNegocio(
                    'La empresa no permite «Lo deposito yo»: entrega el efectivo a otra persona',
                    'autoentrega_apagada',
                    [{ field: 'entregado_a', message: '«Lo deposito yo» está apagado', rule: 'autoentrega' }],
                )
            }
        } else if (!(await alcanceDePermiso(input.entregado_a, 'cajas.recibir_entrega'))) {
            throw new ReglaNegocio(
                'Esa persona no puede recibir efectivo (permiso cajas.recibir_entrega)',
                'receptor_sin_permiso',
                [{ field: 'entregado_a', message: 'Sin permiso para recibir efectivo', rule: 'permiso' }],
            )
        }

        const [fila] = (await t.trx
            .insertQuery()
            .table('ledger.entregas')
            .insert({
                empresa_id: empresaId,
                caja_id: turno.caja_id,
                turno_id: turno.id,
                monto: aTexto(monto),
                entregado_por: entregadoPor,
                recibe_id: input.entregado_a,
                autoentrega,
                origen: input.origen ?? 'reentrega',
            })
            .returning('id')) as Array<{ id: number }>
        const entregaId = Number(fila!.id)
        t.fijarEntidad('entrega', entregaId)
        await t.emit('caja.entregada', {
            entrega_id: entregaId,
            empresa_id: empresaId,
            caja_id: Number(turno.caja_id),
            turno_id: Number(turno.id),
            entregado_por: entregadoPor === null ? null : Number(entregadoPor),
            recibe_id: input.entregado_a,
            monto: aTexto(monto),
            autoentrega,
        })
        if (autoentrega) {
            await new RecibirEntrega().execute({ entrega_id: entregaId }, t.ctx, { trx: t.trx })
        }
        return verEntrega(entregaId, t.trx)
    }
}
