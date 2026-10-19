import { DateTime } from 'luxon'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Problema, ValidacionFallida } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { resolverEmpresaActiva } from '#core/empresas'
import {
    TIPOS_EXCEPCION,
    motivoObligatorio,
    verExcepcion,
    type ExcepcionVista,
    type TipoExcepcion,
} from '#ledger/bloqueos'

/**
 * `libro.excepcion_bloqueo` (`POST /libro/bloqueos/excepciones`, solo `admin`): permite registrar
 * bajo el bloqueo `tipo` (nunca el duro) hasta `hasta_en`, a un usuario o a todos (contrato
 * §10.4). El fin es obligatorio: sin él o sobre el duro, 422 `excepcion_sin_fin`.
 *
 * La excepción no mueve el bloqueo: `RegistrarAsiento` la usa sola cuando el asiento del usuario
 * cae bajo ese tipo y la guarda en `ledger.asientos.excepcion_id`. Cubre solo su tipo; si otro
 * bloqueo también aplica, el asiento sigue rechazado. Se revoca con `RevocarExcepcionBloqueo`.
 */

export interface EntradaExcepcion {
    empresa_id?: number | null
    tipo: TipoExcepcion | 'duro'
    /** null = todos los usuarios */
    usuario_id?: number | null
    motivo: string
    /** instante de fin (obligatorio): ISO 8601 o `Date` (el validador lo entrega como `Date`) */
    hasta_en?: string | Date | null
}

export default class CrearExcepcionBloqueo extends DomainAction<EntradaExcepcion, ExcepcionVista> {
    readonly nombre = 'libro.excepcion_bloqueo'

    protected async handle(input: EntradaExcepcion, t: Transaccion): Promise<ExcepcionVista> {
        if (!(TIPOS_EXCEPCION as readonly string[]).includes(input.tipo) || !input.hasta_en) {
            const detalle =
                input.tipo === 'duro'
                    ? 'El bloqueo duro no admite excepciones'
                    : 'Una excepción de bloqueo lleva fecha de fin (hasta_en)'
            throw new Problema(422, 'excepcion_sin_fin', 'Excepción inválida', detalle, [
                {
                    field: input.tipo === 'duro' ? 'tipo' : 'hasta_en',
                    message: detalle,
                    rule: 'excepcion_sin_fin',
                },
            ])
        }
        const motivo = motivoObligatorio(input.motivo)
        const fin =
            input.hasta_en instanceof Date
                ? DateTime.fromJSDate(input.hasta_en)
                : DateTime.fromISO(input.hasta_en)
        if (!fin.isValid) {
            throw new ValidacionFallida([{ field: 'hasta_en', message: 'Instante inválido', rule: 'fecha' }])
        }
        if (fin <= DateTime.now()) {
            throw new ValidacionFallida([
                { field: 'hasta_en', message: 'El fin de la excepción debe ser futuro', rule: 'futuro' },
            ])
        }
        const empresaId = input.empresa_id ?? (await resolverEmpresaActiva(t.ctx, t.trx))
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)

        const usuarioId = input.usuario_id ?? null
        if (usuarioId !== null) {
            const existe = await t.trx.from('core.usuarios').where('id', usuarioId).select('id').first()
            if (!existe) {
                throw new ValidacionFallida([
                    { field: 'usuario_id', message: `El usuario ${usuarioId} no existe`, rule: 'exists' },
                ])
            }
        }
        const [fila] = (await t.trx
            .insertQuery()
            .table('ledger.bloqueos_excepciones')
            .insert({
                empresa_id: empresaId,
                tipo: input.tipo,
                usuario_id: usuarioId,
                motivo,
                hasta_en: fin.toUTC().toISO(),
                creada_por: usuarioDelActor(t.ctx.actor),
            })
            .returning('id')) as Array<{ id: number }>
        const id = Number(fila!.id)
        t.fijarEntidad('excepcion_bloqueo', id)
        return (await verExcepcion(id, t.trx))!
    }
}
