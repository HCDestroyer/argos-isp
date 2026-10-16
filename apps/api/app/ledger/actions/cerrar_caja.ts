import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, NoEncontrado, ValidacionFallida } from '#shared/errores'
import { aTexto, dec, tieneCentavosExactos } from '#ledger/dinero'
import { CUENTAS } from '#ledger/plan_cuentas'
import { verTurno, type TurnoVista } from '#ledger/cajas'
import { egresosDelTurno } from '#ledger/egresos'
import RegistrarAsiento, { type LineaAsiento } from '#ledger/actions/registrar_asiento'

/**
 * `cajas.cerrar` (`POST /cajas/:id/cerrar`): cierra el turno abierto de la caja.
 *
 * - `esperado = fondo_inicial + Σ pagos vigentes (no anulados) del turno − Σ egresos en efectivo
 *   vigentes del turno`; `diferencia = contado − esperado`.
 * - Diferencia ≠ 0 exige `motivo` (422) y deja asiento `cierre_caja` (origen = turno):
 *   faltante `Faltantes de caja / Caja`; sobrante `Caja / Sobrantes de caja`.
 * - Evento `caja.cerrada` con `cajero_id` = el cajero asignado a la caja o quien abrió el turno.
 * - 409 `sin_turno_abierto` si la caja no tiene turno abierto. El turno se bloquea: un cobro en
 *   curso termina antes del cierre y los siguientes ya no entran a este turno.
 */

export interface EntradaCerrarCaja {
    caja_id: number
    contado: string
    motivo?: string | null
}

export default class CerrarCaja extends DomainAction<EntradaCerrarCaja, TurnoVista> {
    readonly nombre = 'cajas.cerrar'

    protected async handle(input: EntradaCerrarCaja, t: Transaccion): Promise<TurnoVista> {
        t.fijarEntidad('caja', input.caja_id)
        const contado = dec(input.contado)
        if (contado.isNegative() || !tieneCentavosExactos(contado)) {
            throw new ValidacionFallida([
                { field: 'contado', message: 'Monto inválido (≥ 0, 2 decimales)', rule: 'monto' },
            ])
        }
        const caja = (await t.trx
            .from('ledger.cajas')
            .where('id', input.caja_id)
            .select('id', 'nombre', 'cuenta_id', 'cajero_id')
            .first()) as { id: number; nombre: string; cuenta_id: number; cajero_id: number | null } | null
        if (!caja) throw new NoEncontrado(`La caja ${input.caja_id} no existe`)

        const turno = (await t.trx
            .from('ledger.cajas_turnos')
            .where('caja_id', caja.id)
            .whereNull('cerrado_en')
            .forUpdate()
            .select('id', 'fondo_inicial', 'abierto_por')
            .first()) as { id: number; fondo_inicial: string; abierto_por: number | null } | null
        if (!turno) {
            throw new Conflicto(
                `La caja ${caja.id} no tiene turno abierto`,
                'sin_turno_abierto',
                'Sin turno abierto',
            )
        }
        t.fijarEntidad('caja_turno', turno.id)

        const cobrado = (await t.trx
            .from('billing.pagos')
            .where('turno_id', turno.id)
            .whereNot('estado', 'anulado')
            .select(t.trx.raw('coalesce(sum(monto), 0)::text as total'))
            .first()) as { total: string }
        const pagado = await egresosDelTurno(t.trx, turno.id)
        const esperado = dec(turno.fondo_inicial).plus(cobrado.total).minus(pagado)
        const diferencia = contado.minus(esperado)
        const motivo = input.motivo?.trim() || null
        if (!diferencia.isZero() && !motivo) {
            throw new ValidacionFallida([
                {
                    field: 'motivo',
                    message: `Hay una diferencia de Q${aTexto(diferencia)} (esperado Q${aTexto(esperado)}, contado Q${aTexto(contado)}): el motivo es obligatorio`,
                    rule: 'required',
                },
            ])
        }

        await t.trx
            .from('ledger.cajas_turnos')
            .where('id', turno.id)
            .update({
                cerrado_en: t.trx.knexRawQuery('greatest(now(), abierto_en)'),
                esperado: aTexto(esperado),
                contado: aTexto(contado),
                diferencia: aTexto(diferencia),
                motivo,
                cerrado_por: t.ctx.actor.id,
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)

        if (!diferencia.isZero()) {
            const monto = aTexto(diferencia.abs())
            const movimientos: LineaAsiento[] = diferencia.isNegative()
                ? [
                      { cuenta: CUENTAS.FALTANTES_CAJA, debe: monto },
                      { cuenta: caja.cuenta_id, haber: monto },
                  ]
                : [
                      { cuenta: caja.cuenta_id, debe: monto },
                      { cuenta: CUENTAS.SOBRANTES_CAJA, haber: monto },
                  ]
            await new RegistrarAsiento().execute(
                {
                    descripcion: `Cierre del turno ${turno.id} de ${caja.nombre}: ${diferencia.isNegative() ? 'faltante' : 'sobrante'} Q${monto} · ${motivo}`,
                    origen_tipo: 'cierre_caja',
                    origen_id: turno.id,
                    movimientos,
                },
                t.ctx,
                { trx: t.trx },
            )
        }

        await t.emit('caja.cerrada', {
            caja_id: caja.id,
            cajero_id: caja.cajero_id ?? turno.abierto_por,
            esperado: aTexto(esperado),
            contado: aTexto(contado),
            diferencia: aTexto(diferencia),
        })
        return verTurno(turno.id, t.trx)
    }
}
