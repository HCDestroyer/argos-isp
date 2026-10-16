import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, ReglaNegocio, ValidacionFallida } from '#shared/errores'
import { aTexto, dec, tieneCentavosExactos } from '#ledger/dinero'
import { fechaValida, hoyGuatemala } from '#ledger/fechas'
import { CUENTAS } from '#ledger/plan_cuentas'
import RegistrarAsiento from '#ledger/actions/registrar_asiento'
import { aplicarAnticipos, bloquearCliente } from '#billing/cobros'
import { configuracionDeServicio, leerServicio } from '#billing/configuracion'
import { claveFactura, sumarDias } from '#billing/periodos'
import { lineaConIva, totalesDe, type EstadoFactura } from '#billing/facturas'

/**
 * `facturas.importar_pendiente` = `importarFacturaPendiente` (importador de A6, sin endpoint):
 * una factura pendiente de un servicio traída de otro sistema, con su periodo y lo que se debe.
 *
 * - Idempotente por `clave_externa` (id en el origen): repetirla devuelve la misma factura
 *   (`creada: false`); con otro servicio, periodo o monto → 409 `clave_externa_conflicto`.
 * - Ocupa la `clave_unica = servicio_id-periodo`: `generarFacturas` ya no emite ese periodo. Si
 *   ArgosIsp ya facturó el periodo → 409 `periodo_facturado`.
 * - `total` es lo que el cliente debe de esa factura (IVA incluido, desglosado en la línea).
 *   `reglas_snapshot` = la configuración efectiva del servicio, con mora `ninguna` salvo
 *   `aplicar_mora: true` (no se cobra mora retroactiva por la migración).
 * - `vence_en` por defecto = periodo + días de gracia. Si ya pasó, nace `vencida` (cuenta para el
 *   corte en la siguiente evaluación; no cambia el estado del servicio por sí sola).
 * - Asiento `CxC / 2.9.01 Saldos de apertura` (origen `factura`): el ingreso y el IVA ya se
 *   registraron en el sistema de origen. Aplica el anticipo del cliente si tiene.
 * - Sin eventos (no notifica): es la carga histórica.
 */

export interface EntradaImportarFactura {
    clave_externa: string
    servicio_id: number
    /** primer día del periodo (YYYY-MM-DD) */
    periodo: string
    /** lo pendiente, IVA incluido: "150.00" */
    total: string
    vence_en?: string
    concepto?: string | null
    aplicar_mora?: boolean
    /** día de referencia para decidir si ya venció (pruebas); por defecto hoy en Guatemala */
    hoy?: string
}

export interface ResultadoImportarFactura {
    factura_id: number
    creada: boolean
    estado: EstadoFactura
}

export default class ImportarFacturaPendiente extends DomainAction<
    EntradaImportarFactura,
    ResultadoImportarFactura
> {
    readonly nombre = 'facturas.importar_pendiente'

    protected async handle(input: EntradaImportarFactura, t: Transaccion): Promise<ResultadoImportarFactura> {
        const clave = input.clave_externa?.trim()
        const total = dec(input.total)
        const errores = []
        if (!clave) errores.push({ field: 'clave_externa', message: 'Obligatoria', rule: 'required' })
        if (total.lte(0) || !tieneCentavosExactos(total)) {
            errores.push({
                field: 'total',
                message: 'Monto mayor que 0 con hasta 2 decimales',
                rule: 'monto',
            })
        }
        if (errores.length > 0) throw new ValidacionFallida(errores)
        const periodo = fechaValida(input.periodo, 'periodo')
        const hoy = input.hoy ? fechaValida(input.hoy, 'hoy') : hoyGuatemala()

        t.fijarEntidad('servicio', input.servicio_id)
        const servicio = await leerServicio(t.trx, input.servicio_id)
        const config = await configuracionDeServicio(t.trx, servicio)
        if (!config) throw new ReglaNegocio('El servicio no tiene plantilla de facturación', 'sin_plantilla')
        await bloquearCliente(t.trx, servicio.cliente_id)

        const existente = (await t.trx
            .from('billing.facturas')
            .where('clave_externa', clave)
            .select(
                'id',
                'servicio_id',
                'total',
                'estado',
                t.trx.raw(`to_char(periodo, 'YYYY-MM-DD') as periodo`),
            )
            .first()) as {
            id: number
            servicio_id: number
            total: string
            estado: string
            periodo: string
        } | null
        if (existente) {
            if (
                existente.servicio_id !== servicio.id ||
                existente.periodo !== periodo ||
                !dec(existente.total).equals(total)
            ) {
                throw new Conflicto(
                    `La clave externa ${clave} ya se importó como la factura ${existente.id} (servicio ${existente.servicio_id}, periodo ${existente.periodo}, Q${existente.total})`,
                    'clave_externa_conflicto',
                    'Clave externa en uso',
                )
            }
            return { factura_id: existente.id, creada: false, estado: existente.estado as EstadoFactura }
        }
        const claveUnica = claveFactura(servicio.id, periodo)
        const facturada = await t.trx
            .from('billing.facturas')
            .where('clave_unica', claveUnica)
            .select('id')
            .first()
        if (facturada) {
            throw new Conflicto(
                `El servicio ${servicio.id} ya tiene la factura ${facturada.id} del periodo ${periodo}`,
                'periodo_facturado',
                'Periodo ya facturado',
            )
        }

        const venceEn = input.vence_en
            ? fechaValida(input.vence_en, 'vence_en')
            : sumarDias(periodo, config.dias_gracia)
        const vencida = venceEn < hoy
        const linea = lineaConIva({
            concepto:
                input.concepto?.trim() ||
                `Servicio de internet ${servicio.plan_nombre} · periodo ${periodo} (importada)`,
            tipo: 'servicio',
            cantidad: '1',
            gravable: true,
            total,
        })
        const totales = totalesDe([linea])
        const snapshot = {
            ...config,
            ...(input.aplicar_mora
                ? {}
                : { mora_tipo: 'ninguna', mora_valor: '0.00', mora_recurrente: false }),
            importada: true,
            clave_externa: clave,
        }

        const [fila] = (await t.trx
            .insertQuery()
            .table('billing.facturas')
            .insert({
                cliente_id: servicio.cliente_id,
                servicio_id: servicio.id,
                tipo: 'servicio',
                periodo,
                clave_unica: claveUnica,
                clave_externa: clave,
                vence_en: venceEn,
                estado: vencida ? 'vencida' : 'emitida',
                vencida_en: vencida ? t.trx.knexRawQuery('now()') : null,
                subtotal: aTexto(totales.subtotal),
                iva: aTexto(totales.iva),
                total: aTexto(totales.total),
                reglas_snapshot: JSON.stringify(snapshot),
            })
            .returning('id')) as Array<{ id: number }>
        const facturaId = fila!.id
        t.fijarEntidad('factura', facturaId)
        await t.trx
            .insertQuery()
            .table('billing.facturas_lineas')
            .insert({ ...linea, factura_id: facturaId })

        await new RegistrarAsiento().execute(
            {
                descripcion: `Factura importada ${facturaId} (${clave}) · servicio ${servicio.id} · periodo ${periodo}`,
                origen_tipo: 'factura',
                origen_id: facturaId,
                movimientos: [
                    { cuenta: CUENTAS.CXC_CLIENTES, debe: aTexto(total), cliente_id: servicio.cliente_id },
                    { cuenta: CUENTAS.SALDOS_APERTURA, haber: aTexto(total) },
                ],
            },
            t.ctx,
            { trx: t.trx },
        )
        await aplicarAnticipos(t, servicio.cliente_id)
        const final = await t.trx
            .from('billing.facturas')
            .where('id', facturaId)
            .select('estado')
            .firstOrFail()
        return { factura_id: facturaId, creada: true, estado: final.estado as EstadoFactura }
    }
}
