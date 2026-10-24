import { DateTime } from 'luxon'
import { empresaDeImportacion } from '#billing/empresa'
import { lineasSinIva, sinIvaPorRegimen } from '#billing/regimen'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, ReglaNegocio, ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { aTexto, dec, tieneCentavosExactos } from '#ledger/dinero'
import { ZONA_NEGOCIO, fechaValida, hoyGuatemala, inicioDeMes } from '#ledger/fechas'
import { CUENTAS } from '#ledger/plan_cuentas'
import RegistrarAsiento from '#ledger/actions/registrar_asiento'
import { aplicarAnticipos, bloquearCliente } from '#billing/cobros'
import { configuracionDeServicio, leerServicio, type ServicioFacturable } from '#billing/configuracion'
import type { ConfiguracionFacturacion } from '#billing/excepciones'
import { claveFactura, sumarDias } from '#billing/periodos'
import { lineaConIva, totalesDe, type EstadoFactura } from '#billing/facturas'
import { claveImportacion, exigirPeriodoAbierto, textoClave } from '#billing/importacion'

/**
 * `facturas.importar_pendiente` = `importarFacturaPendiente` (importador de A6, sin endpoint):
 * una factura traída de otro sistema. Contrato: `.claude/integration/contratos/importacion.md`.
 *
 * Dos clases de factura importada:
 *
 * - **De periodo** (`servicio_id` + `periodo`, sin `cargo_unico`): ocupa la
 *   `clave_unica = servicio_id-periodo`, así `generarFacturas` ya no emite ese periodo. Si
 *   ArgosIsp ya lo facturó → 409 `periodo_facturado`.
 * - **Cargo único** (`cargo_unico: true`, o falta `servicio_id` o `periodo`): instalación, TV
 *   adicional, la segunda factura de un mismo periodo, la deuda de un cliente retirado sin
 *   servicios… `clave_unica = importada-<origen>:<id_externo>`: no ocupa ningún periodo, el cron
 *   nunca la genera ni la cuenta como emitida. Sin servicio exige `cliente_id`; sin periodo exige
 *   `emitida_en` (el `periodo` guardado es el primer día de ese mes, para los reportes).
 *
 * Las dos suman al saldo del cliente (auxiliar CxC). Para el corte cuentan las que tienen servicio
 * (`tipo = 'servicio'`, como toda factura de servicio); una sin servicio no corta a nadie.
 *
 * - Idempotente por (`origen`, `id_externo`) (alias `clave_externa`): repetirla devuelve la misma
 *   factura (`creada: false`); con otro cliente, servicio, periodo, clase o monto → 409
 *   `clave_externa_conflicto`. El mismo id en otro origen es otra factura.
 * - `total` es lo que dice el origen (IVA incluido, desglosado en la línea). `total: "0.00"` se
 *   acepta (historial, factura sin cargo): queda `pagada` y sin asiento.
 * - `saldada_en_origen: true`: el origen la marca pagada pero no tiene ningún pago registrado.
 *   Queda `pagada` (`pagado = total`) **sin asiento ni pago**: no entra dinero que no entró y su
 *   efecto en el saldo es cero, igual que en el origen.
 * - `emitida_en` (YYYY-MM-DD): fecha de emisión en el origen. Se guarda en `emitida_en`
 *   (mediodía de Guatemala) y es la fecha del asiento, así el estado de cuenta la muestra en su
 *   lugar; en un mes cerrado → 422 `periodo_cerrado`. Sin ella: hoy (comportamiento anterior).
 * - `reglas_snapshot` = la configuración efectiva del servicio (o ninguna sin servicio), con mora
 *   `ninguna` salvo `aplicar_mora: true` (no se cobra mora retroactiva por la migración).
 * - `vence_en` por defecto = periodo (o `emitida_en` en un cargo sin periodo) + días de gracia
 *   (0 sin servicio). Si ya pasó, nace `vencida`.
 * - Asiento `CxC / 2.9.01 Saldos de apertura` (origen `factura`): el ingreso y el IVA ya se
 *   registraron en el sistema de origen. Aplica el anticipo del cliente si tiene.
 * - Sin eventos (no notifica) y sin reevaluar el servicio: es la carga histórica.
 */

export interface EntradaImportarFactura {
    /** sistema de origen (`mikrowisp`, `smartisp`, `csv`…); ver `claveImportacion` */
    origen?: string
    /** id de la factura en el origen (único por origen) */
    id_externo?: string
    /** nombre anterior de `id_externo` (se acepta igual) */
    clave_externa?: string
    /** servicio de la factura; sin él es un cargo único del cliente (exige `cliente_id`) */
    servicio_id?: number | null
    /** dueño de la factura: obligatorio sin servicio; con servicio, si viene, debe ser su dueño */
    cliente_id?: number | null
    /** primer día del periodo (YYYY-MM-DD); sin él es un cargo único (exige `emitida_en`) */
    periodo?: string | null
    /** true: no ocupa la clave `servicio_id-periodo` (p. ej. la segunda factura del periodo) */
    cargo_unico?: boolean
    /** fecha de emisión en el origen (YYYY-MM-DD, Guatemala); no futura */
    emitida_en?: string | null
    /** total de la factura, IVA incluido: "150.00"; "0.00" = sin cargo (historial) */
    total: string
    /** el origen la da por pagada sin registrar ningún pago: queda `pagada`, sin asiento */
    saldada_en_origen?: boolean
    vence_en?: string
    concepto?: string | null
    aplicar_mora?: boolean
    /**
     * empresa de la factura (multiempresa). Sin ella: la del servicio, la de los servicios del
     * cliente (si es una sola), la activa o la 1. Con servicio, debe ser la suya.
     */
    empresa_id?: number | null
    /** día de referencia para decidir si ya venció (pruebas); por defecto hoy en Guatemala */
    hoy?: string
}

export interface ResultadoImportarFactura {
    factura_id: number
    creada: boolean
    estado: EstadoFactura
    /** true: no ocupa ningún `servicio_id-periodo` */
    cargo_unico: boolean
}

interface FilaExistente {
    id: number
    cliente_id: number
    servicio_id: number | null
    clave_unica: string
    total: string
    estado: string
    periodo: string
}

const MORA_NINGUNA = { mora_tipo: 'ninguna', mora_valor: '0.00', mora_recurrente: false }

export default class ImportarFacturaPendiente extends DomainAction<
    EntradaImportarFactura,
    ResultadoImportarFactura
> {
    readonly nombre = 'facturas.importar_pendiente'

    protected async handle(input: EntradaImportarFactura, t: Transaccion): Promise<ResultadoImportarFactura> {
        const claveOrigen = claveImportacion(input)
        const clave = claveOrigen.id_externo
        const texto = textoClave(claveOrigen)
        const hoy = input.hoy ? fechaValida(input.hoy, 'hoy') : hoyGuatemala()
        const total = dec(input.total)
        const servicioId = input.servicio_id ?? null
        const cargoUnico = input.cargo_unico ?? (servicioId === null || !input.periodo)

        const errores: ErrorCampo[] = []
        if (total.lt(0) || !tieneCentavosExactos(total)) {
            errores.push({ field: 'total', message: 'Monto de 0 o más con hasta 2 decimales', rule: 'monto' })
        }
        if (!cargoUnico && (servicioId === null || !input.periodo)) {
            errores.push({
                field: 'cargo_unico',
                message: 'Una factura de periodo necesita servicio_id y periodo',
                rule: 'cargo_unico',
            })
        }
        if (servicioId === null && !input.cliente_id) {
            errores.push({ field: 'cliente_id', message: 'Obligatorio sin servicio_id', rule: 'required' })
        }
        if (!input.periodo && !input.emitida_en) {
            errores.push({ field: 'emitida_en', message: 'Obligatoria sin periodo', rule: 'required' })
        }
        if (servicioId === null && input.aplicar_mora) {
            errores.push({
                field: 'aplicar_mora',
                message: 'La mora sale de la plantilla del servicio: sin servicio no hay mora',
                rule: 'aplicar_mora',
            })
        }
        if (errores.length > 0) throw new ValidacionFallida(errores)
        const emitida = input.emitida_en ? fechaValida(input.emitida_en, 'emitida_en') : null
        if (emitida && emitida > hoy) {
            throw new ValidacionFallida([
                { field: 'emitida_en', message: 'La fecha de emisión no puede ser futura', rule: 'fecha' },
            ])
        }
        const periodo = input.periodo ? fechaValida(input.periodo, 'periodo') : inicioDeMes(emitida!)

        let servicio: ServicioFacturable | null = null
        let config: ConfiguracionFacturacion | null = null
        let clienteId: number
        if (servicioId !== null) {
            t.fijarEntidad('servicio', servicioId)
            servicio = await leerServicio(t.trx, servicioId)
            config = await configuracionDeServicio(t.trx, servicio)
            if (!config) {
                throw new ReglaNegocio('El servicio no tiene plantilla de facturación', 'sin_plantilla')
            }
            if (input.cliente_id && input.cliente_id !== servicio.cliente_id) {
                throw new ValidacionFallida([
                    {
                        field: 'cliente_id',
                        message: `El servicio ${servicio.id} es del cliente ${servicio.cliente_id}`,
                        rule: 'cliente_id',
                    },
                ])
            }
            clienteId = servicio.cliente_id
        } else {
            clienteId = input.cliente_id!
            t.fijarEntidad('cliente', clienteId)
            const cliente = await t.trx.from('core.clientes').where('id', clienteId).select('id').first()
            if (!cliente) {
                throw new ValidacionFallida([
                    { field: 'cliente_id', message: `El cliente ${clienteId} no existe`, rule: 'exists' },
                ])
            }
        }
        await bloquearCliente(t.trx, clienteId)

        const claveUnica = cargoUnico
            ? `importada-${claveOrigen.origen}:${clave}`
            : claveFactura(servicio!.id, periodo)
        const existente = (await t.trx
            .from('billing.facturas')
            .where('origen', claveOrigen.origen)
            .where('clave_externa', clave)
            .select(
                'id',
                'cliente_id',
                'servicio_id',
                'clave_unica',
                'total',
                'estado',
                t.trx.raw(`to_char(periodo, 'YYYY-MM-DD') as periodo`),
            )
            .first()) as FilaExistente | null
        if (existente) {
            if (
                existente.cliente_id !== clienteId ||
                existente.servicio_id !== servicioId ||
                existente.clave_unica !== claveUnica ||
                existente.periodo !== periodo ||
                !dec(existente.total).equals(total)
            ) {
                throw new Conflicto(
                    `El id_externo ${texto} ya se importó como la factura ${existente.id} (cliente ${existente.cliente_id}, servicio ${existente.servicio_id ?? 'ninguno'}, periodo ${existente.periodo}, Q${existente.total})`,
                    'clave_externa_conflicto',
                    'Clave externa en uso',
                )
            }
            t.fijarEntidad('factura', existente.id)
            return {
                factura_id: existente.id,
                creada: false,
                estado: existente.estado as EstadoFactura,
                cargo_unico: existente.clave_unica.startsWith('importada-'),
            }
        }
        if (!cargoUnico) {
            const facturada = await t.trx
                .from('billing.facturas')
                .where('clave_unica', claveUnica)
                .select('id')
                .first()
            if (facturada) {
                throw new Conflicto(
                    `El servicio ${servicio!.id} ya tiene la factura ${facturada.id} del periodo ${periodo}` +
                        ' (para una segunda factura del mismo periodo use cargo_unico: true)',
                    'periodo_facturado',
                    'Periodo ya facturado',
                )
            }
        }

        const sinCargo = total.isZero()
        const saldada = !sinCargo && input.saldada_en_origen === true
        const conAsiento = !sinCargo && !saldada
        const empresaId = await empresaDeImportacion(t.trx, t.ctx, {
            empresa_id: input.empresa_id,
            servicio_id: servicioId,
            cliente_id: clienteId,
        })
        if (servicio && empresaId !== servicio.empresa_id) {
            throw new ValidacionFallida([
                {
                    field: 'empresa_id',
                    message: `El servicio ${servicio.id} es de la empresa ${servicio.empresa_id}`,
                    rule: 'empresa_servicio',
                },
            ])
        }
        t.fijarEmpresa(empresaId)
        if (conAsiento && emitida) {
            await exigirPeriodoAbierto(t.trx, emitida, `Factura importada ${texto}`, empresaId)
        }

        const venceEn = input.vence_en
            ? fechaValida(input.vence_en, 'vence_en')
            : sumarDias(input.periodo ? periodo : emitida!, config?.dias_gracia ?? 0)
        const vencida = venceEn < hoy
        const estado: EstadoFactura = conAsiento ? (vencida ? 'vencida' : 'emitida') : 'pagada'
        const concepto =
            input.concepto?.trim() ||
            (cargoUnico
                ? `Cargo importado (${texto})`
                : `Servicio de internet ${servicio!.plan_nombre} · periodo ${periodo} (importada)`)
        const conIva = lineaConIva({
            concepto,
            tipo: cargoUnico ? 'otro' : 'servicio',
            cantidad: '1',
            gravable: true,
            total,
        })
        // H62: en pequeño contribuyente (en la fecha del documento) no se separa IVA, como al facturar
        const sinIva = await sinIvaPorRegimen(t.trx, empresaId, emitida ?? periodo)
        const linea = sinIva ? lineasSinIva([conIva])[0]! : conIva
        const totales = totalesDe([linea])
        const snapshot = {
            ...(config ?? MORA_NINGUNA),
            ...(input.aplicar_mora ? {} : MORA_NINGUNA),
            importada: true,
            origen: claveOrigen.origen,
            clave_externa: clave,
            ...(cargoUnico ? { cargo_unico: true } : {}),
            ...(sinCargo ? { sin_cargo: true } : {}),
            ...(saldada ? { saldada_en_origen: true } : {}),
        }
        const emitidaEn = emitida
            ? DateTime.fromISO(`${emitida}T12:00:00`, { zone: ZONA_NEGOCIO }).toJSDate()
            : undefined

        const [fila] = (await t.trx
            .insertQuery()
            .table('billing.facturas')
            .insert({
                empresa_id: empresaId,
                cliente_id: clienteId,
                servicio_id: servicioId,
                tipo: 'servicio',
                periodo,
                clave_unica: claveUnica,
                origen: claveOrigen.origen,
                clave_externa: clave,
                ...(emitidaEn ? { emitida_en: emitidaEn } : {}),
                vence_en: venceEn,
                estado,
                vencida_en: estado === 'vencida' ? t.trx.knexRawQuery('now()') : null,
                subtotal: aTexto(totales.subtotal),
                iva: aTexto(totales.iva),
                total: aTexto(totales.total),
                pagado: saldada ? aTexto(totales.total) : '0.00',
                reglas_snapshot: JSON.stringify(snapshot),
            })
            .returning('id')) as Array<{ id: number }>
        const facturaId = fila!.id
        t.fijarEntidad('factura', facturaId)
        await t.trx
            .insertQuery()
            .table('billing.facturas_lineas')
            .insert({ ...linea, factura_id: facturaId })

        if (conAsiento) {
            await new RegistrarAsiento().execute(
                {
                    empresa_id: empresaId,
                    ...(emitida ? { fecha: emitida } : {}),
                    descripcion:
                        `Factura importada ${facturaId} (${texto})` +
                        (servicio ? ` · servicio ${servicio.id}` : ` · cliente ${clienteId}`) +
                        (cargoUnico ? ' · cargo único' : ` · periodo ${periodo}`),
                    origen_tipo: 'factura',
                    origen_id: facturaId,
                    movimientos: [
                        { cuenta: CUENTAS.CXC_CLIENTES, debe: aTexto(total), cliente_id: clienteId },
                        { cuenta: CUENTAS.SALDOS_APERTURA, haber: aTexto(total) },
                    ],
                },
                t.ctx,
                { trx: t.trx },
            )
            await aplicarAnticipos(t, clienteId, empresaId)
        }
        const final = await t.trx
            .from('billing.facturas')
            .where('id', facturaId)
            .select('estado')
            .firstOrFail()
        return {
            factura_id: facturaId,
            creada: true,
            estado: final.estado as EstadoFactura,
            cargo_unico: cargoUnico,
        }
    }
}
