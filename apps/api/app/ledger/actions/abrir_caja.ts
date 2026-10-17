import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, NoEncontrado, ReglaNegocio, ValidacionFallida } from '#shared/errores'
import { aTexto, dec, tieneCentavosExactos } from '#ledger/dinero'
import { verTurno, type TurnoVista } from '#ledger/cajas'

/**
 * `cajas.abrir` (`POST /cajas/:id/abrir`): abre un turno con su fondo inicial. Un solo turno
 * abierto por caja (409 `turno_abierto`). Queda `abierto_por` = el cajero: sus cobros en
 * efectivo sin `caja_id` van a esta caja mientras el turno siga abierto.
 *
 * No escribe asiento: el fondo ya está en la cuenta de la caja (es lo que quedó del turno
 * anterior). Que solo opere su caja lo asegura el alcance ACL de la ruta (`exigirAlcance`).
 */

export interface EntradaAbrirCaja {
    caja_id: number
    fondo_inicial: string
}

export default class AbrirCaja extends DomainAction<EntradaAbrirCaja, TurnoVista> {
    readonly nombre = 'cajas.abrir'

    protected async handle(input: EntradaAbrirCaja, t: Transaccion): Promise<TurnoVista> {
        t.fijarEntidad('caja', input.caja_id)
        const fondo = dec(input.fondo_inicial)
        if (fondo.isNegative() || !tieneCentavosExactos(fondo)) {
            throw new ValidacionFallida([
                { field: 'fondo_inicial', message: 'Monto inválido (≥ 0, 2 decimales)', rule: 'monto' },
            ])
        }
        const caja = await t.trx
            .from('ledger.cajas')
            .where('id', input.caja_id)
            .forUpdate()
            .select('id', 'activa', 'empresa_id')
            .first()
        if (!caja) throw new NoEncontrado(`La caja ${input.caja_id} no existe`)
        // la caja es de una empresa: solo la abre quien tiene acceso a ella
        exigirAccesoEmpresa(t.ctx, Number(caja.empresa_id))
        t.fijarEmpresa(Number(caja.empresa_id))
        if (!caja.activa) throw new ReglaNegocio(`La caja ${input.caja_id} está inactiva`, 'caja_inactiva')

        const abierto = await t.trx
            .from('ledger.cajas_turnos')
            .where('caja_id', caja.id)
            .whereNull('cerrado_en')
            .select('id')
            .first()
        if (abierto) {
            throw new Conflicto(
                `La caja ${caja.id} ya tiene el turno ${abierto.id} abierto`,
                'turno_abierto',
                'Turno abierto',
            )
        }

        const [fila] = (await t.trx
            .insertQuery()
            .table('ledger.cajas_turnos')
            .insert({
                caja_id: caja.id,
                fondo_inicial: aTexto(fondo),
                abierto_por: usuarioDelActor(t.ctx.actor),
            })
            .returning('id')) as Array<{ id: number }>
        t.fijarEntidad('caja_turno', fila!.id)
        return verTurno(fila!.id, t.trx)
    }
}
