import { DateTime } from 'luxon'
import { usuarioDelActor } from '#shared/contexto'
import { empresaDeImportacion } from '#billing/empresa'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, ValidacionFallida } from '#shared/errores'
import { METODOS_PAGO, type MetodoPago } from '#shared/eventos'
import { CERO, aTexto, dec, tieneCentavosExactos, type Dec } from '#ledger/dinero'
import { ZONA_NEGOCIO, fechaValida, hoyGuatemala } from '#ledger/fechas'
import { CUENTAS } from '#ledger/plan_cuentas'
import RegistrarAsiento, { type LineaAsiento } from '#ledger/actions/registrar_asiento'
import { aplicarAFacturas, bloquearClientes, duenosDeFacturas, facturasPendientes } from '#billing/cobros'
import { claveImportacion, exigirPeriodoAbierto, textoClave } from '#billing/importacion'
import { verPago, type PagoVista } from '#billing/pagos'
import { porRecuperar } from '#ledger/cartera'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'

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
 * - Idempotente por (`origen`, `id_externo`) (alias `clave_externa`): repetirlo con el mismo
 *   cliente, monto y fecha devuelve el pago ya registrado (`creado: false`); con otros datos → 409
 *   `clave_externa_conflicto`. El mismo id en otro origen es otro pago.
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
    /** sistema de origen (`mikrowisp`, `smartisp`, `csv`…); ver `claveImportacion` */
    origen?: string
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
    /**
     * empresa del pago (multiempresa). Sin ella: la de las facturas pedidas, la de los servicios
     * del cliente (si es una sola), la activa o la 1. Solo aplica a facturas de esa empresa.
     */
    empresa_id?: number | null
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
        const claveOrigen = claveImportacion(input)
        const clave = claveOrigen.id_externo
        const texto = textoClave(claveOrigen)
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
            .where('origen', claveOrigen.origen)
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
                    `El id_externo ${texto} ya se usó para el pago ${existente.id} (cliente ${existente.cliente_id}, Q${existente.monto}, ${fechaPrevia})`,
                    'clave_externa_conflicto',
                    'Clave externa en uso',
                )
            }
            t.fijarEntidad('pago', existente.id)
            return { ...(await verPago(existente.id, t.trx)), creado: false }
        }

        const empresaId = await this.empresa(t, input)
        t.fijarEmpresa(empresaId)
        await exigirPeriodoAbierto(t.trx, fecha, `Pago histórico ${texto}`, empresaId)

        const referencia = input.referencia?.trim() || null
        // el pago queda "hecho" el día del origen (mediodía en Guatemala: sin saltar de día en UTC)
        const hechoEn = DateTime.fromISO(`${fecha}T12:00:00`, { zone: ZONA_NEGOCIO }).toJSDate()
        const [pago] = (await t.trx
            .insertQuery()
            .table('billing.pagos')
            .insert({
                empresa_id: empresaId,
                cliente_id: input.cliente_id,
                metodo: input.metodo,
                monto: aTexto(monto),
                comision: '0.00',
                referencia,
                estado: 'registrado',
                historico: true,
                origen: claveOrigen.origen,
                clave_externa: clave,
                nota: input.nota?.trim() || `Pago histórico importado (${texto})`,
                registrado_por: usuarioDelActor(t.ctx.actor),
                created_at: hechoEn,
            })
            .returning('id')) as Array<{ id: number }>
        const pagoId = pago!.id
        t.fijarEntidad('pago', pagoId)

        const facturas = await facturasPendientes(t.trx, input.cliente_id, input.facturas ?? [], [empresaId])
        const { aplicaciones, restante } = await aplicarAFacturas(t.trx, pagoId, monto, facturas)

        const movimientos: LineaAsiento[] = [{ cuenta: CUENTAS.SALDOS_APERTURA, debe: aTexto(monto) }]
        const porCliente = new Map<number, Dec>()
        for (const a of aplicaciones) {
            porCliente.set(a.cliente_id, (porCliente.get(a.cliente_id) ?? CERO).plus(a.monto))
        }
        for (const [clienteId, aplicado] of [...porCliente].sort(([x], [y]) => x - y)) {
            movimientos.push({ cuenta: CUENTAS.CXC_CLIENTES, haber: aTexto(aplicado), cliente_id: clienteId })
        }
        // decisión (g) del líder, igual que registrarPago: con castigos por recuperar, lo que sobra es
        // recuperación (4.2.03) antes que anticipo
        let sobrante = restante
        if (sobrante.gt(0)) {
            const falta = await porRecuperar(t.trx, empresaId, input.cliente_id)
            const recuperado = falta.gt(0) ? (falta.lt(sobrante) ? falta : sobrante) : CERO
            if (recuperado.gt(0)) {
                movimientos.push({
                    cuenta: CUENTAS_GT.RECUPERACION_INCOBRABLES,
                    haber: aTexto(recuperado),
                    cliente_id: input.cliente_id,
                })
                sobrante = sobrante.minus(recuperado)
            }
        }
        if (sobrante.gt(0)) {
            movimientos.push({
                cuenta: CUENTAS.ANTICIPOS_CLIENTES,
                haber: aTexto(sobrante),
                cliente_id: input.cliente_id,
            })
        }
        await new RegistrarAsiento().execute(
            {
                empresa_id: empresaId,
                fecha,
                descripcion:
                    `Pago histórico ${pagoId} (${texto}) · ${input.metodo}` +
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

    /** Empresa del pago histórico; 422 si las facturas pedidas son de otra (o de varias). */
    private async empresa(t: Transaccion, input: EntradaPagoHistorico): Promise<number> {
        const pedidas = input.facturas ?? []
        const filas = pedidas.length
            ? ((await t.trx.from('billing.facturas').whereIn('id', pedidas).distinct('empresa_id')) as Array<{
                  empresa_id: number
              }>)
            : []
        const deFacturas = [...new Set(filas.map((f) => Number(f.empresa_id)))]
        const empresaId =
            input.empresa_id ??
            (deFacturas.length === 1
                ? deFacturas[0]!
                : await empresaDeImportacion(t.trx, t.ctx, { cliente_id: input.cliente_id }))
        if (input.empresa_id) await empresaDeImportacion(t.trx, t.ctx, { empresa_id: input.empresa_id })
        const ajena = deFacturas.find((id) => id !== empresaId)
        if (ajena !== undefined) {
            throw new ValidacionFallida([
                {
                    field: 'facturas',
                    message: `Hay facturas de la empresa ${ajena}: un pago es de una sola empresa (${empresaId})`,
                    rule: 'factura_de_otra_empresa',
                },
            ])
        }
        return empresaId
    }
}
