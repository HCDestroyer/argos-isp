import { DateTime } from 'luxon'
import { usuarioDelActor } from '#shared/contexto'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, ValidacionFallida } from '#shared/errores'
import { METODOS_PAGO, type MetodoPago } from '#shared/eventos'
import { CERO, aTexto, dec, tieneCentavosExactos, type Dec } from '#ledger/dinero'
import { ZONA_NEGOCIO, fechaValida, hoyGuatemala } from '#ledger/fechas'
import { CUENTAS } from '#ledger/plan_cuentas'
import RegistrarAsiento, { type LineaAsiento } from '#ledger/actions/registrar_asiento'
import { aplicarAFacturas, bloquearClientes, duenosDeFacturas, facturasPendientes } from '#billing/cobros'
import { exigirPeriodoAbierto, idExterno } from '#billing/importacion'
import { verPago, type PagoVista } from '#billing/pagos'

/**
 * `pagos.registrar_historico` = `registrarPagoHistorico` (importador de A6, sin endpoint): un
 * pago que el cliente hizo en el sistema de origen, con su fecha original.
 *
 * **Mueve el libro**, pero no la caja ni los bancos: el dinero ya entró (y se depositó o gastó)
 * en el sistema de origen. Asiento con la fecha del pago:
 * `2.9.01 Saldos de apertura / CxC (aplicado) + Anticipos (excedente)`. Por eso, para que el
 * saldo del cliente cuadre con el origen, el importador carga las facturas que este pago cubrió
 * **por su total** (`ImportarFacturaPendiente`) antes de registrarlo; si no, lo que no encuentre
 * factura queda en Anticipos (saldo a favor).
 *
 * - Entrada con `historico: true` (obligatorio: deja claro en la auditoría que es carga histórica).
 * - Idempotente por `id_externo` (alias `clave_externa`): repetirlo con el mismo cliente, monto y
 *   fecha devuelve el pago ya registrado (`creado: false`); con otros datos → 409
 *   `clave_externa_conflicto`.
 * - `fecha` (YYYY-MM-DD, no futura) en un periodo cerrado → 422 `periodo_cerrado`, sin escribir nada.
 * - Aplica a las `facturas` pedidas (en orden) y luego a la más antigua del cliente, como un pago.
 * - No exige caja, cuenta bancaria ni banco de origen; la `referencia` se guarda tal cual y no
 *   choca con las de pagos reales (el origen puede repetirlas).
 * - **No** emite `pago.registrado` (no notifica, no cumple promesas) y **no** reevalúa el estado
 *   de los servicios: el siguiente corte lo hace.
 * - Se anula como cualquier pago (`POST /pagos/:id/anular`), que sí reevalúa y emite `pago.anulado`.
 */

export interface EntradaPagoHistorico {
    historico: true
    /** id del pago en el sistema de origen */
    id_externo?: string
    /** nombre anterior de `id_externo` (se acepta igual) */
    clave_externa?: string
    cliente_id: number
    metodo: MetodoPago
    /** string decimal "150.00" */
    monto: string
    /** fecha del pago en el origen (YYYY-MM-DD, Guatemala); fecha contable del asiento */
    fecha: string
    referencia?: string | null
    nota?: string | null
    facturas?: number[]
    /** día de referencia para "no futura" (pruebas); por defecto hoy en Guatemala */
    hoy?: string
}

export interface ResultadoPagoHistorico extends PagoVista {
    creado: boolean
}

export default class RegistrarPagoHistorico extends DomainAction<
    EntradaPagoHistorico,
    ResultadoPagoHistorico
> {
    readonly nombre = 'pagos.registrar_historico'

    protected async handle(input: EntradaPagoHistorico, t: Transaccion): Promise<ResultadoPagoHistorico> {
        const clave = idExterno(input)
        const monto = dec(input.monto)
        const errores = []
        if (input.historico !== true) {
            errores.push({
                field: 'historico',
                message: 'Debe ser true (carga histórica)',
                rule: 'historico',
            })
        }
        if (!(METODOS_PAGO as readonly string[]).includes(input.metodo)) {
            errores.push({ field: 'metodo', message: `Método ${input.metodo} no válido`, rule: 'enum' })
        }
        if (monto.lte(0) || !tieneCentavosExactos(monto)) {
            errores.push({ field: 'monto', message: 'Mayor que 0 con hasta 2 decimales', rule: 'monto' })
        }
        if (errores.length > 0) throw new ValidacionFallida(errores)
        const fecha = fechaValida(input.fecha)
        if (fecha > (input.hoy ?? hoyGuatemala())) {
            throw new ValidacionFallida([
                { field: 'fecha', message: 'La fecha no puede ser futura', rule: 'fecha' },
            ])
        }

        const cliente = await t.trx.from('core.clientes').where('id', input.cliente_id).select('id').first()
        if (!cliente) {
            throw new ValidacionFallida([
                { field: 'cliente_id', message: `El cliente ${input.cliente_id} no existe`, rule: 'exists' },
            ])
        }
        await bloquearClientes(t.trx, [
            input.cliente_id,
            ...(await duenosDeFacturas(t.trx, input.facturas ?? [])),
        ])

        const existente = (await t.trx
            .from('billing.pagos')
            .where('clave_externa', clave)
            .select('id', 'cliente_id', 'monto', 'created_at')
            .first()) as { id: number; cliente_id: number; monto: string; created_at: Date } | null
        if (existente) {
            const fechaPrevia = DateTime.fromJSDate(existente.created_at).setZone(ZONA_NEGOCIO).toISODate()
            if (
                existente.cliente_id !== input.cliente_id ||
                !dec(existente.monto).equals(monto) ||
                fechaPrevia !== fecha
            ) {
                throw new Conflicto(
                    `El id_externo ${clave} ya se usó para el pago ${existente.id} (cliente ${existente.cliente_id}, Q${existente.monto}, ${fechaPrevia})`,
                    'clave_externa_conflicto',
                    'Clave externa en uso',
                )
            }
            t.fijarEntidad('pago', existente.id)
            return { ...(await verPago(existente.id, t.trx)), creado: false }
        }

        await exigirPeriodoAbierto(t.trx, fecha, `Pago histórico ${clave}`)

        const referencia = input.referencia?.trim() || null
        // el pago queda "hecho" el día del origen (mediodía en Guatemala: sin saltar de día en UTC)
        const hechoEn = DateTime.fromISO(`${fecha}T12:00:00`, { zone: ZONA_NEGOCIO }).toJSDate()
        const [pago] = (await t.trx
            .insertQuery()
            .table('billing.pagos')
            .insert({
                cliente_id: input.cliente_id,
                metodo: input.metodo,
                monto: aTexto(monto),
                comision: '0.00',
                referencia,
                estado: 'registrado',
                historico: true,
                clave_externa: clave,
                nota: input.nota?.trim() || `Pago histórico importado (${clave})`,
                registrado_por: usuarioDelActor(t.ctx.actor),
                created_at: hechoEn,
            })
            .returning('id')) as Array<{ id: number }>
        const pagoId = pago!.id
        t.fijarEntidad('pago', pagoId)

        const facturas = await facturasPendientes(t.trx, input.cliente_id, input.facturas ?? [])
        const { aplicaciones, restante } = await aplicarAFacturas(t.trx, pagoId, monto, facturas)

        const movimientos: LineaAsiento[] = [{ cuenta: CUENTAS.SALDOS_APERTURA, debe: aTexto(monto) }]
        const porCliente = new Map<number, Dec>()
        for (const a of aplicaciones) {
            porCliente.set(a.cliente_id, (porCliente.get(a.cliente_id) ?? CERO).plus(a.monto))
        }
        for (const [clienteId, aplicado] of [...porCliente].sort(([x], [y]) => x - y)) {
            movimientos.push({ cuenta: CUENTAS.CXC_CLIENTES, haber: aTexto(aplicado), cliente_id: clienteId })
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
                fecha,
                descripcion:
                    `Pago histórico ${pagoId} (${clave}) · ${input.metodo}` +
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

        return { ...(await verPago(pagoId, t.trx)), creado: true }
    }
}
