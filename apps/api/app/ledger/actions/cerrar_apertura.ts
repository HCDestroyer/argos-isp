import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ValidacionFallida } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { resolverEmpresaActiva } from '#core/empresas'
import { aTexto } from '#ledger/dinero'
import { fechaValida, hoyGuatemala } from '#ledger/fechas'
import { CUENTAS } from '#ledger/plan_cuentas'
import {
    DESTINOS_APERTURA,
    DESTINO_APERTURA_DEFECTO,
    estadoApertura,
    saldoApertura,
    type DestinoApertura,
    type EstadoApertura,
} from '#ledger/apertura'
import RegistrarAsiento, { type AsientoRegistrado } from '#ledger/actions/registrar_asiento'

/**
 * `libro.cerrar_apertura` (`POST /libro/apertura/cerrar`, contrato de localización fiscal §23):
 * traslada el saldo neto de `2.9.01 Saldos de apertura por importación` a patrimonio
 * (`3.3.01 Utilidades acumuladas` por defecto, o `3.1.01 Capital social`).
 *
 * - Saldo de 2.9.01 de la empresa con fecha hasta `fecha` (por defecto hoy; no futura). Acreedor
 *   (lo normal: `CxC / 2.9.01` de la importación) → `2.9.01 / destino`; deudor → `destino / 2.9.01`.
 * - Idempotente: con el saldo en 0.00 no escribe nada y responde `asiento: null` (y el
 *   `Idempotency-Key` de la ruta devuelve la misma respuesta). Un lock por empresa evita que dos
 *   cierres simultáneos trasladen el mismo saldo.
 * - Bloqueos (§9.2, §10.4): el asiento pasa por `RegistrarAsiento` sin `trasladar_si_bloqueado`:
 *   mes cerrado → 422 `periodo_cerrado`, bloqueo duro → 409 `bloqueo_duro`, otro bloqueo sin
 *   excepción → 422 `periodo_bloqueado`. Nunca cruza empresas: el saldo y el asiento son de una.
 * - El asiento es `ajuste` sin `origen_id`, diario `VAR` (desvío (a) de §23); se corrige con su
 *   reverso (`libro.revertir_asiento`) y se vuelve a cerrar. Sin evento: no cambia el estado de
 *   ninguna entidad (como un asiento manual); la auditoría guarda la entrada y el asiento.
 */

export interface EntradaCerrarApertura {
    empresa_id?: number | null
    /** fecha del asiento y corte del saldo (YYYY-MM-DD); por defecto hoy en Guatemala */
    fecha?: string | null
    /** cuenta de patrimonio que recibe el saldo; por defecto 3.3.01 */
    cuenta_destino?: DestinoApertura | null
    nota?: string | null
}

export interface ResultadoCierreApertura extends EstadoApertura {
    cuenta_destino: DestinoApertura
    /** saldo de 2.9.01 que se trasladó (debe − haber antes del cierre); 0.00 si no había */
    trasladado: string
    /** el asiento del cierre; null si el saldo ya era 0.00 */
    asiento: AsientoRegistrado | null
}

export default class CerrarApertura extends DomainAction<EntradaCerrarApertura, ResultadoCierreApertura> {
    readonly nombre = 'libro.cerrar_apertura'

    protected async handle(input: EntradaCerrarApertura, t: Transaccion): Promise<ResultadoCierreApertura> {
        const hoy = hoyGuatemala()
        const fecha = input.fecha ? fechaValida(input.fecha) : hoy
        if (fecha > hoy) {
            throw new ValidacionFallida([
                { field: 'fecha', message: 'La fecha no puede ser futura', rule: 'futuro' },
            ])
        }
        const destino = input.cuenta_destino ?? DESTINO_APERTURA_DEFECTO
        if (!(DESTINOS_APERTURA as readonly string[]).includes(destino)) {
            throw new ValidacionFallida([
                {
                    field: 'cuenta_destino',
                    message: `La cuenta destino debe ser una de ${DESTINOS_APERTURA.join(', ')}`,
                    rule: 'enum',
                },
            ])
        }

        const empresaId = input.empresa_id ?? (await resolverEmpresaActiva(t.ctx, t.trx))
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        // un cierre de apertura a la vez por empresa: el segundo ve el saldo ya en 0.00
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(3050, ?::int)', [empresaId])

        const saldo = await saldoApertura(t.trx, empresaId, fecha)
        let asiento: AsientoRegistrado | null = null
        if (!saldo.isZero()) {
            const monto = aTexto(saldo.abs())
            const nota = input.nota?.trim()
            asiento = await new RegistrarAsiento().execute(
                {
                    empresa_id: empresaId,
                    fecha,
                    descripcion:
                        `Cierre de saldos de apertura: ${CUENTAS.SALDOS_APERTURA} a ${destino}` +
                        (nota ? ` · ${nota}` : ''),
                    origen_tipo: 'ajuste',
                    diario: 'VAR',
                    movimientos: saldo.isNegative()
                        ? [
                              { cuenta: CUENTAS.SALDOS_APERTURA, debe: monto },
                              { cuenta: destino, haber: monto },
                          ]
                        : [
                              { cuenta: destino, debe: monto },
                              { cuenta: CUENTAS.SALDOS_APERTURA, haber: monto },
                          ],
                },
                t.ctx,
                { trx: t.trx },
            )
            t.fijarEntidad('asiento', asiento.id)
        }

        return {
            ...(await estadoApertura(empresaId, fecha, t.trx)),
            cuenta_destino: destino,
            trasladado: aTexto(saldo),
            asiento,
        }
    }
}
