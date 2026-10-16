import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ReglaNegocio, ValidacionFallida } from '#shared/errores'
import type { MetodoPago } from '#shared/eventos'
import { CERO, aTexto, dec, tieneCentavosExactos, type Dec } from '#ledger/dinero'
import { CUENTAS } from '#ledger/plan_cuentas'
import RegistrarAsiento, { type LineaAsiento } from '#ledger/actions/registrar_asiento'
import {
    aplicarAFacturas,
    aplicarAnticipos,
    bloquearClientes,
    clientesDelPago,
    duenosDeFacturas,
    facturasPendientes,
    serviciosDe,
} from '#billing/cobros'
import { cajaPrincipalId, verPago, type PagoVista } from '#billing/pagos'
import { cajaDelCajero } from '#ledger/cajas'
import EvaluarEstadoServicio, { type ResultadoEvaluarEstado } from '#billing/actions/evaluar_estado_servicio'
import { exigirReferenciaLibre, validarDatosBancarios } from '#billing/datos_bancarios'

export { DATOS_POR_METODO } from '#billing/datos_bancarios'

/**
 * `pagos.registrar` (`POST /pagos`, cobro rápido del panel): registra un pago y lo aplica.
 *
 * - `Idempotency-Key` lo resuelve el middleware de la ruta (misma clave → misma respuesta). Además
 *   la `referencia` (boleta, transacción) es única por método: repetirla responde 409.
 * - Aplica a las facturas pendientes del cliente: primero las `facturas` pedidas (en ese orden),
 *   luego la más antigua (vencimiento, periodo, id). El excedente queda en Anticipos y se aplica
 *   solo a las facturas que se emitan después.
 * - Asiento: `Caja (o Bancos) / CxC (aplicado) + Anticipos (excedente)`. `caja` sin `caja_id` va a
 *   la caja del turno abierto del cajero (`cajaDelCajero`) o, si no tiene, a la caja principal. El
 *   pago queda en el turno abierto de esa caja (`turno_id`, base del esperado del cierre). Los
 *   métodos bancarios (`deposito`, `transferencia`, `ach`, `remesa`) exigen sus datos
 *   (`DATOS_POR_METODO`, 422 por campo) y van a la subcuenta de la cuenta bancaria de destino;
 *   pasarela, agente y débito, al banco principal. La referencia es única por (método, cuenta
 *   bancaria, referencia).
 * - Evento `pago.registrado` y, **en la misma transacción**, `evaluarEstadoServicio` de cada
 *   servicio cuyas facturas tocó: la reactivación sale con el pago (evento
 *   `servicio.estado_cambiado`), sin esperar al cron.
 */

export interface EntradaRegistrarPago {
    cliente_id: number
    metodo: MetodoPago
    monto: string
    referencia?: string | null
    caja_id?: number | null
    /** cuenta bancaria propia de destino (deposito, transferencia, ach, remesa) */
    cuenta_bancaria_id?: number | null
    /** banco de origen del catálogo (transferencia, ach) */
    banco_origen_id?: number | null
    nota?: string | null
    facturas?: number[]
}

export interface ResultadoRegistrarPago extends PagoVista {
    /** cómo quedó cada servicio afectado (para el recibo y la pantalla de cobro) */
    servicios: Array<Pick<ResultadoEvaluarEstado, 'servicio_id' | 'estado' | 'de' | 'cambiado' | 'motivo'>>
}

export default class RegistrarPago extends DomainAction<EntradaRegistrarPago, ResultadoRegistrarPago> {
    readonly nombre = 'pagos.registrar'

    protected async handle(input: EntradaRegistrarPago, t: Transaccion): Promise<ResultadoRegistrarPago> {
        const monto = dec(input.monto)
        if (monto.lte(0) || !tieneCentavosExactos(monto)) {
            throw new ValidacionFallida([
                {
                    field: 'monto',
                    message: 'El monto debe ser mayor que 0 con hasta 2 decimales',
                    rule: 'monto',
                },
            ])
        }
        const cliente = await t.trx.from('core.clientes').where('id', input.cliente_id).select('id').first()
        if (!cliente) {
            throw new ValidacionFallida([
                { field: 'cliente_id', message: `El cliente ${input.cliente_id} no existe`, rule: 'exists' },
            ])
        }
        // pago de terceros: se bloquean el pagador y los dueños de las facturas pedidas
        await bloquearClientes(t.trx, [
            input.cliente_id,
            ...(await duenosDeFacturas(t.trx, input.facturas ?? [])),
        ])

        const referencia = input.referencia?.trim() || null
        const bancario = await validarDatosBancarios(t.trx, {
            metodo: input.metodo,
            referencia,
            cuenta_bancaria_id: input.cuenta_bancaria_id,
            banco_origen_id: input.banco_origen_id,
        })
        await exigirReferenciaLibre(t.trx, input.metodo, referencia, bancario.cuentaBancariaId)
        const { cajaId, cuentaDebe, turnoId } = await this.destino(t, input, bancario.cuentaLibro)

        // Anticipos previos primero: no puede quedar saldo a favor mientras haya deuda.
        const previas = await aplicarAnticipos(t, input.cliente_id)

        const [pago] = (await t.trx
            .insertQuery()
            .table('billing.pagos')
            .insert({
                cliente_id: input.cliente_id,
                metodo: input.metodo,
                monto: aTexto(monto),
                referencia,
                caja_id: cajaId,
                turno_id: turnoId,
                cuenta_bancaria_id: bancario.cuentaBancariaId,
                banco_origen_id: bancario.bancoOrigenId,
                estado: 'registrado',
                nota: input.nota?.trim() || null,
                registrado_por: t.ctx.actor.id,
            })
            .returning('id')) as Array<{ id: number }>
        const pagoId = pago!.id
        t.fijarEntidad('pago', pagoId)

        const facturas = await facturasPendientes(t.trx, input.cliente_id, input.facturas ?? [])
        const { aplicaciones, restante } = await aplicarAFacturas(t.trx, pagoId, monto, facturas)

        // un solo asiento: el débito por el total y el crédito en el auxiliar CxC de cada dueño
        const movimientos: LineaAsiento[] = [{ cuenta: cuentaDebe, debe: aTexto(monto) }]
        const porCliente = new Map<number, Dec>()
        for (const a of aplicaciones) {
            porCliente.set(a.cliente_id, (porCliente.get(a.cliente_id) ?? CERO).plus(a.monto))
        }
        for (const [clienteId, aplicadoCliente] of [...porCliente].sort(([x], [y]) => x - y)) {
            movimientos.push({
                cuenta: CUENTAS.CXC_CLIENTES,
                haber: aTexto(aplicadoCliente),
                cliente_id: clienteId,
            })
        }
        if (restante.gt(0)) {
            movimientos.push({
                cuenta: CUENTAS.ANTICIPOS_CLIENTES,
                haber: aTexto(restante),
                cliente_id: input.cliente_id,
            })
        }
        await new RegistrarAsiento().execute(
            {
                descripcion:
                    `Pago ${pagoId} · ${input.metodo}` +
                    (referencia ? ` · ref. ${referencia}` : '') +
                    (aplicaciones.length > 0
                        ? ` · facturas ${aplicaciones.map((a) => a.factura_id).join(', ')}`
                        : ' · anticipo'),
                origen_tipo: 'pago',
                origen_id: pagoId,
                movimientos,
            },
            t.ctx,
            { trx: t.trx },
        )

        await t.emit('pago.registrado', {
            pago_id: pagoId,
            cliente_id: input.cliente_id,
            monto: aTexto(monto),
            metodo: input.metodo,
            facturas: aplicaciones.map((a) => a.factura_id),
            clientes: clientesDelPago(input.cliente_id, aplicaciones),
        })

        const servicios = []
        for (const servicioId of serviciosDe([...previas, ...aplicaciones])) {
            const r = await new EvaluarEstadoServicio().execute({ servicio_id: servicioId }, t.ctx, {
                trx: t.trx,
            })
            servicios.push({
                servicio_id: r.servicio_id,
                estado: r.estado,
                de: r.de,
                cambiado: r.cambiado,
                motivo: r.motivo,
            })
        }

        return { ...(await verPago(pagoId, t.trx)), servicios }
    }

    /** Caja, turno abierto y cuenta del debe según el método. */
    private async destino(
        t: Transaccion,
        input: EntradaRegistrarPago,
        cuentaBancaria: number | null,
    ): Promise<{ cajaId: number | null; cuentaDebe: string | number; turnoId: number | null }> {
        if (input.metodo !== 'caja') {
            // depósito, transferencia, ACH y remesa: la subcuenta de la cuenta de destino;
            // pasarela, agente y débito: el banco principal (conciliación de pasarelas: semana 2)
            return { cajaId: null, cuentaDebe: cuentaBancaria ?? CUENTAS.BANCO_PRINCIPAL, turnoId: null }
        }
        const cajaId =
            input.caja_id ??
            (await cajaDelCajero(t.ctx.actor.id, undefined, t.trx)) ??
            (await cajaPrincipalId(t.trx))
        if (!cajaId) throw new ReglaNegocio('No hay caja principal activa para pagos en efectivo', 'sin_caja')
        const caja = await t.trx
            .from('ledger.cajas')
            .where('id', cajaId)
            .select('id', 'cuenta_id', 'activa')
            .first()
        if (!caja || !caja.activa) {
            throw new ValidacionFallida([
                { field: 'caja_id', message: `La caja ${cajaId} no existe o está inactiva`, rule: 'caja' },
            ])
        }
        // FOR SHARE: si el turno se está cerrando, este cobro espera y luego ya no entra en él.
        const turno = await t.trx
            .from('ledger.cajas_turnos')
            .where('caja_id', cajaId)
            .whereNull('cerrado_en')
            .forShare()
            .select('id')
            .first()
        return { cajaId, cuentaDebe: caja.cuenta_id as number, turnoId: (turno?.id as number) ?? null }
    }
}
