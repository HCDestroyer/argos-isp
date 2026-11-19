import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado, ReglaNegocio, ValidacionFallida } from '#shared/errores'
import { aTexto } from '#ledger/dinero'
import { fechaValida } from '#ledger/fechas'
import { bloquearCliente, saldoAnticipos } from '#billing/cobros'
import {
    exigirDentroDelMaximo,
    exigirEmitible,
    periodosDelServicio,
    soloPeriodo,
    type PeriodoDelServicio,
} from '#billing/periodos_facturables'
import EmitirFactura from '#billing/actions/emitir_factura'

/**
 * `facturas.emitir_periodos` (`POST /servicios/:id/facturas-periodo` + `Idempotency-Key`): emite a
 * mano las facturas de periodos de un servicio (pedido del PM, 19 nov): **pago por adelantado**
 * (periodos futuros) y **periodos que el cron no emitió**.
 *
 * - `periodos` (inicios exactos, `YYYY-MM-DD`) o `hasta` (todos los no emitidos que empiezan ese día
 *   o antes, desde `facturar_desde`): uno de los dos, nunca ambos.
 * - Cada periodo con `EmitirFactura` (la misma del cron), anidada y en orden ascendente, todo en esta
 *   transacción: mismas líneas, `reglas_snapshot` (con `emision_manual`), asiento, `factura.emitida`,
 *   FEL según el modo y `clave_unica = servicio_id-periodo`. Aplica el saldo a favor (Anticipos) del
 *   cliente, de la factura más antigua a la más nueva.
 * - Un periodo ya ocupado (factura o bonificación) se omite y se informa en `omitidas`: nunca se
 *   duplica (la clave es única también frente al cron).
 * - Futuros: hasta `MAXIMO_PERIODOS_FUTUROS` (422 `maximo_periodos_futuros`). Vencen en su fecha
 *   normal (`periodo + dias_gracia`): el corte no los cuenta antes.
 * - Anteriores a `facturar_desde` (asignación de plantilla sin facturar hacia atrás): solo pedidos en
 *   `periodos`, con `puede_emitir_anterior` (la ruta lo fija con `facturas.emitir_periodo_anterior`)
 *   y `motivo`; si no, 422 `antes_de_facturar_desde` o `motivo_requerido`.
 * - Retirado, pendiente de instalación o sin plantilla: 422 con esa regla. Un inicio que no es de un
 *   periodo del servicio: 422 `periodo_invalido`.
 */

export interface EntradaEmitirFacturasPeriodo {
    servicio_id: number
    periodos?: string[]
    hasta?: string
    motivo?: string | null
    /** la ruta lo fija según `facturas.emitir_periodo_anterior`; nunca viene del cuerpo */
    puede_emitir_anterior?: boolean
    /** día de Guatemala que cuenta como hoy (pruebas); por defecto el real */
    hoy?: string
}

export interface FacturaPeriodoCreada {
    periodo: string
    factura_id: number
    estado: string
    total: string
    /** lo que cubrió el saldo a favor al emitirla */
    pagado: string
    vence_en: string
}

export interface PeriodoBonificado {
    periodo: string
    bonificacion_id: number
}

export type MotivoOmision = 'ya_emitida' | 'bonificada'

export interface PeriodoOmitido {
    periodo: string
    motivo: MotivoOmision
    factura_id: number | null
    bonificacion_id: number | null
}

export interface ResultadoEmitirFacturasPeriodo {
    servicio_id: number
    cliente_id: number
    creadas: FacturaPeriodoCreada[]
    bonificadas: PeriodoBonificado[]
    omitidas: PeriodoOmitido[]
    /** saldo a favor del cliente en la empresa del servicio después de emitir */
    saldo_a_favor: string
}

export default class EmitirFacturasPeriodo extends DomainAction<
    EntradaEmitirFacturasPeriodo,
    ResultadoEmitirFacturasPeriodo
> {
    readonly nombre = 'facturas.emitir_periodos'

    protected async handle(
        input: EntradaEmitirFacturasPeriodo,
        t: Transaccion,
    ): Promise<ResultadoEmitirFacturasPeriodo> {
        const pidePeriodos = input.periodos !== undefined && input.periodos !== null
        if (pidePeriodos === Boolean(input.hasta)) {
            const mensaje = 'Indica periodos o hasta (uno de los dos)'
            throw new ValidacionFallida([{ field: 'periodos', message: mensaje, rule: 'periodos_o_hasta' }])
        }
        // el bloqueo del cliente antes de leer lo emitido: el cron y otro cobro esperan
        const dueno = (await t.trx
            .from('core.servicios')
            .where('id', input.servicio_id)
            .select('cliente_id')
            .first()) as { cliente_id: number } | null
        if (!dueno) throw new NoEncontrado(`El servicio ${input.servicio_id} no existe`)
        await bloquearCliente(t.trx, dueno.cliente_id)
        const datos = await periodosDelServicio(t.trx, input.servicio_id, input.hoy)
        const { servicio } = datos
        t.fijarEntidad('servicio', servicio.id)
        t.fijarEmpresa(servicio.empresa_id)
        exigirEmitible(datos)

        const elegidos = pidePeriodos
            ? elegirPorInicio(datos.periodos, input.periodos!, datos)
            : elegirHasta(datos.periodos, fechaValida(input.hasta!, 'hasta'), datos)

        const anteriores = elegidos.filter((p) => p.estado === 'antes_de_facturar_desde')
        const motivo = input.motivo?.trim() || null
        if (anteriores.length > 0) {
            const lista = anteriores.map((p) => p.periodo).join(', ')
            if (!input.puede_emitir_anterior) {
                const mensaje = `${lista}: anterior a facturar_desde (${datos.facturar_desde}); requiere el permiso facturas.emitir_periodo_anterior`
                throw new ReglaNegocio(mensaje, 'antes_de_facturar_desde', [
                    { field: 'periodos', message: mensaje, rule: 'antes_de_facturar_desde' },
                ])
            }
            if (!motivo) {
                const mensaje = `${lista}: emitir un periodo anterior a facturar_desde exige un motivo`
                throw new ValidacionFallida([{ field: 'motivo', message: mensaje, rule: 'motivo_requerido' }])
            }
        }

        const resultado: ResultadoEmitirFacturasPeriodo = {
            servicio_id: servicio.id,
            cliente_id: servicio.cliente_id,
            creadas: [],
            bonificadas: [],
            omitidas: [],
            saldo_a_favor: '0.00',
        }
        const emitidas: number[] = []
        const creadasPorPeriodo = new Map<number, string>()
        for (const p of elegidos) {
            if (p.ocupacion) {
                resultado.omitidas.push({
                    periodo: p.periodo,
                    motivo: p.ocupacion.factura_id ? 'ya_emitida' : 'bonificada',
                    factura_id: p.ocupacion.factura_id,
                    bonificacion_id: p.ocupacion.bonificacion_id,
                })
                continue
            }
            const r = await new EmitirFactura().execute(
                {
                    servicio_id: servicio.id,
                    periodo: soloPeriodo(p),
                    manual: { motivo, antes_de_facturar_desde: p.estado === 'antes_de_facturar_desde' },
                },
                t.ctx,
                { trx: t.trx },
            )
            if (r.creada && r.factura_id) {
                emitidas.push(r.factura_id)
                creadasPorPeriodo.set(r.factura_id, p.periodo)
            } else if (r.creada && r.bonificacion_id) {
                resultado.bonificadas.push({ periodo: p.periodo, bonificacion_id: r.bonificacion_id })
            } else if (r.motivo === 'ya_existe') {
                // otra corrida (el cron) la emitió entre la lectura y el bloqueo
                resultado.omitidas.push({
                    periodo: p.periodo,
                    motivo: r.factura_id ? 'ya_emitida' : 'bonificada',
                    factura_id: r.factura_id,
                    bonificacion_id: r.bonificacion_id ?? null,
                })
            } else {
                throw new ReglaNegocio(
                    `No se pudo emitir el periodo ${p.periodo}: ${r.motivo ?? 'sin detalle'}`,
                    r.motivo ?? 'regla_negocio',
                )
            }
        }

        // estado y pagado finales: el saldo a favor se aplicó a medida que se emitían
        if (emitidas.length > 0) {
            const filas = (await t.trx
                .from('billing.facturas')
                .whereIn('id', emitidas)
                .orderBy('periodo', 'asc')
                .select(
                    'id',
                    'estado',
                    'total',
                    'pagado',
                    t.trx.raw(`to_char(vence_en, 'YYYY-MM-DD') as vence_en`),
                )) as Array<{ id: number; estado: string; total: string; pagado: string; vence_en: string }>
            resultado.creadas = filas.map((f) => ({
                periodo: creadasPorPeriodo.get(Number(f.id))!,
                factura_id: Number(f.id),
                estado: f.estado,
                total: aTexto(f.total),
                pagado: aTexto(f.pagado),
                vence_en: f.vence_en,
            }))
        }
        resultado.saldo_a_favor = aTexto(
            await saldoAnticipos(t.trx, servicio.cliente_id, servicio.empresa_id),
        )
        return resultado
    }
}

function elegirPorInicio(
    periodos: PeriodoDelServicio[],
    pedidos: string[],
    datos: Parameters<typeof exigirDentroDelMaximo>[0],
): PeriodoDelServicio[] {
    const porInicio = new Map(periodos.map((p) => [p.periodo, p]))
    const unicos = [...new Set(pedidos.map((p, i) => fechaValida(p, `periodos.${i}`)))].sort()
    const errores = []
    for (const [i, pedido] of unicos.entries()) {
        if (porInicio.has(pedido)) continue
        exigirDentroDelMaximo(datos, pedido, `periodos.${i}`)
        errores.push({
            field: `periodos.${i}`,
            message: `${pedido} no es el inicio de un periodo del servicio`,
            rule: 'periodo_invalido',
        })
    }
    if (errores.length > 0) {
        throw new ValidacionFallida(errores, 'Hay fechas que no son el inicio de un periodo del servicio')
    }
    return unicos.map((p) => porInicio.get(p)!)
}

/** Todos los periodos hasta `hasta`, sin los anteriores a `facturar_desde` (esos, solo por `periodos`). */
function elegirHasta(
    periodos: PeriodoDelServicio[],
    hasta: string,
    datos: Parameters<typeof exigirDentroDelMaximo>[0],
): PeriodoDelServicio[] {
    exigirDentroDelMaximo(datos, hasta, 'hasta')
    return periodos.filter((p) => p.periodo <= hasta && p.estado !== 'antes_de_facturar_desde')
}
