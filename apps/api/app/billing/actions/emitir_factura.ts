import { DomainAction, type Transaccion } from '#shared/domain_action'
import { aTexto, dec } from '#ledger/dinero'
import { configuracionDeServicio, leerServicio } from '#billing/configuracion'
import { claveFactura, sumarDias, type PeriodoFacturable } from '#billing/periodos'
import { aplicarDescuentos, lineaConIva, totalesDe, type LineaCalculada } from '#billing/facturas'
import { bloquearCliente } from '#billing/cobros'
import { emitirDocumento } from '#billing/emision'
import { aplicarCanjesEmitidos, descuentosParaFactura } from '#lealtad/emision'

/**
 * `facturas.emitir`: emite la factura de UN periodo de un servicio. La llama `generarFacturas`
 * (cron o `POST /facturas/generar`), una transacción por factura.
 *
 * - Idempotente por `clave_unica = servicio_id-periodo` (`INSERT … ON CONFLICT DO NOTHING`): si
 *   dos corridas compiten, solo una la crea y la otra devuelve `creada: false`.
 * - Líneas: el plan al precio efectivo (`costo_override` o precio del plan) y los conceptos
 *   recurrentes activos, ambos multiplicados por el factor de prorrateo del periodo. Precios con
 *   IVA incluido; el IVA se desglosa por línea (`lineaConIva`).
 * - Guarda `reglas_snapshot`: la configuración efectiva (plantilla + excepciones) y el precio con
 *   que se emitió. Vence `dias_gracia` días después del inicio del periodo.
 * - Lealtad (`#lealtad/emision`, §5): con un plan temporal de lealtad activo, descuento hasta el precio
 *   del plan original; los descuentos reservados del servicio van a esta factura y sus canjes quedan
 *   `aplicados` en la misma transacción.
 * - Asiento: `CxC (cliente) / Ingresos por internet + Otros ingresos + IVA débito`; con `descuentos`,
 *   líneas `descuento` sobre la línea del plan (IVA del neto) y `5.1.01 Descuentos` al debe.
 * - Multiempresa: la factura (y su asiento) es de la empresa del servicio (`empresa_id`): sale con
 *   su NIT y va a su libro. El anticipo que se aplica es el de esa empresa.
 * - Emite `factura.emitida` y aplica el anticipo del cliente si tiene (excedentes de pagos).
 * - FEL (contrato de localización fiscal §8.3, `#billing/emision`): según el modo de la empresa y
 *   el `certificar_al` efectivo, nace como hoy, como aviso de cobro (IVA a `2.1.11`) o
 *   `por_certificar` (sin asiento ni evento hasta que se certifique).
 */

export interface EntradaEmitirFactura {
    servicio_id: number
    periodo: PeriodoFacturable
    /**
     * Descuentos sobre la línea del plan (con IVA incluido; contrato de localización fiscal §3.5): van
     * como líneas `descuento` ligadas a ella, con el IVA del neto y `5.1.01 Descuentos` en el asiento.
     * Nunca dejan la línea bajo cero ni cubren mora ni otros conceptos.
     */
    descuentos?: Array<{ concepto: string; monto: string }>
}

export interface ResultadoEmitirFactura {
    factura_id: number | null
    creada: boolean
    /** por qué no se creó (ya existía, sin plantilla, retirado, monto cero) */
    motivo: string | null
}

export default class EmitirFactura extends DomainAction<EntradaEmitirFactura, ResultadoEmitirFactura> {
    readonly nombre = 'facturas.emitir'

    protected async handle(input: EntradaEmitirFactura, t: Transaccion): Promise<ResultadoEmitirFactura> {
        const servicio = await leerServicio(t.trx, input.servicio_id)
        t.fijarEntidad('servicio', servicio.id)
        t.fijarEmpresa(servicio.empresa_id)
        await bloquearCliente(t.trx, servicio.cliente_id)

        const clave = claveFactura(servicio.id, input.periodo.periodo)
        const existente = await t.trx
            .from('billing.facturas')
            .where('clave_unica', clave)
            .select('id')
            .first()
        if (existente) return { factura_id: existente.id, creada: false, motivo: 'ya_existe' }
        if (servicio.estado === 'retirado') return { factura_id: null, creada: false, motivo: 'retirado' }
        const config = await configuracionDeServicio(t.trx, servicio)
        if (!config) return { factura_id: null, creada: false, motivo: 'sin_plantilla' }

        const { periodo, fin, dias, dias_ciclo: diasCiclo } = input.periodo
        const factor = dec(input.periodo.factor)
        const prorrateado = !factor.equals(1)
        const ultimoDia = sumarDias(fin, -1)

        const lineas: LineaCalculada[] = [
            lineaConIva({
                concepto:
                    `Servicio de internet ${servicio.plan_nombre} del ${periodo} al ${ultimoDia}` +
                    (prorrateado ? ` (prorrateo ${dias}/${diasCiclo} días)` : ''),
                tipo: 'servicio',
                cantidad: '1',
                gravable: true,
                total: dec(servicio.precio).times(factor),
            }),
        ]
        const conceptos = (await t.trx
            .from('billing.conceptos_recurrentes')
            .where('servicio_id', servicio.id)
            .where('activo', true)
            .where('monto', '>', 0)
            .orderBy('id', 'asc')
            .select('nombre', 'monto')) as Array<{ nombre: string; monto: string }>
        for (const concepto of conceptos) {
            lineas.push(
                lineaConIva({
                    concepto: prorrateado
                        ? `${concepto.nombre} (prorrateo ${dias}/${diasCiclo} días)`
                        : concepto.nombre,
                    tipo: 'otro',
                    cantidad: '1',
                    gravable: true,
                    total: dec(concepto.monto).times(factor),
                }),
            )
        }
        const positivas = lineas.filter((linea) => dec(linea.total).gt(0))
        if (totalesDe(positivas).total.lte(0)) {
            return { factura_id: null, creada: false, motivo: 'monto_cero' }
        }
        const plan = positivas.findIndex((linea) => linea.tipo === 'servicio')
        // lealtad (§5): mejora de plan (descuento hasta el plan original) y descuentos reservados
        const lealtad =
            plan >= 0
                ? await descuentosParaFactura(t, servicio, dec(positivas[plan]!.total), factor)
                : { descuentos: [], canjes: [] }
        const pedidos = [...lealtad.descuentos, ...(input.descuentos ?? [])]
        const conMonto =
            plan >= 0 && pedidos.length > 0
                ? aplicarDescuentos(
                      positivas,
                      pedidos.map((d) => ({ indice: plan, concepto: d.concepto, monto: d.monto })),
                  )
                : positivas

        const venceEn = sumarDias(periodo, config.dias_gracia)
        const snapshot = {
            ...config,
            precio: aTexto(servicio.precio),
            plan_id: servicio.plan_id,
            plan_nombre: servicio.plan_nombre,
            periodo: input.periodo,
        }

        const emision = await emitirDocumento(t, {
            empresa_id: servicio.empresa_id,
            cliente_id: servicio.cliente_id,
            servicio_id: servicio.id,
            periodo,
            clave_unica: clave,
            vence_en: venceEn,
            lineas: conMonto,
            reglas_snapshot: snapshot,
            certificar_al: config.certificar_al,
            descripcion: `servicio ${servicio.id} · periodo ${periodo}`,
        })
        if (!emision.creada) return { factura_id: emision.factura_id, creada: false, motivo: 'ya_existe' }
        const facturaId = emision.factura_id!
        await aplicarCanjesEmitidos(t, facturaId, lealtad.canjes)
        return { factura_id: facturaId, creada: true, motivo: null }
    }
}
