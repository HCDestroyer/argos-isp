import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado, ReglaNegocio, ValidacionFallida } from '#shared/errores'
import { aTexto, dec } from '#ledger/dinero'
import { fechaValida } from '#ledger/fechas'
import { bloquearCliente, saldoAnticipos } from '#billing/cobros'
import {
    esPeriodoAnterior,
    exigirDentroDelMaximo,
    exigirEmitible,
    manualDe,
    montoProporcionalTramo,
    MAXIMO_PERIODOS_ANTERIORES,
    periodosDelServicio,
    soloPeriodo,
    type PeriodoDelServicio,
    type PeriodosDelServicio,
    type TramoInicial,
} from '#billing/periodos_facturables'
import { claveTramoInicial, sumarDias } from '#billing/periodos'
import { lineaConIva } from '#billing/facturas'
import { emitirDocumento } from '#billing/emision'
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
 * - **Sin prorrateo** (pedido del PM, 21 nov): cada periodo cobra el precio efectivo completo,
 *   aunque la plantilla prorratee (el cron sí lo respeta).
 * - Futuros: hasta `MAXIMO_PERIODOS_FUTUROS` (422 `maximo_periodos_futuros`). Vencen en su fecha
 *   normal (`periodo + dias_gracia`): el corte no los cuenta antes.
 * - Anteriores a `facturar_desde` (asignación de plantilla sin facturar hacia atrás) y **anteriores al
 *   inicio del servicio** (hasta `MAXIMO_PERIODOS_ANTERIORES`, decisión del PM del 21 nov): solo
 *   pedidos en `periodos`, con `puede_emitir_anterior` (la ruta lo fija con
 *   `facturas.emitir_periodo_anterior`) y `motivo`; si no, 422 `antes_de_facturar_desde` /
 *   `antes_del_inicio` o `motivo_requerido`; más atrás, 422 `maximo_periodos_anteriores`.
 * - **Vencimiento:** todo periodo emitido aquí vence en `max(periodo, hoy) + dias_gracia`
 *   (`vencimientoDe`): un pendiente atrasado o un anterior no corta al cliente al emitirlo.
 * - **Monto editado** (`montos`, pedido del PM del 21 nov): el total de un periodo distinto del
 *   calculado exige `puede_editar_monto` (`facturas.editar_monto_periodo`; si no, 422
 *   `editar_monto_sin_permiso`) y `motivo` (422 `motivo_requerido`); mayor que cero (422
 *   `monto_positivo`). Las líneas: `EmisionManual.monto` en `EmitirFactura`. Calculado y cobrado
 *   quedan en `reglas_snapshot.emision_manual`, en el resultado y en la bitácora (`montos_editados`).
 * - **Tramo inicial** (`tramo_inicial`, decisión del PM del 21 nov): los días entre el inicio del
 *   ciclo y la instalación (primer periodo a mitad de ciclo) no son de ningún periodo. Con
 *   `facturas.emitir_periodo_anterior` y motivo (422 `tramo_inicial_sin_permiso`, `motivo_requerido`):
 *   - `primera_factura`: la factura del primer periodo (que debe venir en `periodos` y estar libre; 422
 *     `tramo_sin_primer_periodo`) cubre desde el inicio del ciclo, con la misma clave del periodo y el
 *     monto completo (editable en `montos`).
 *   - `cargo_unico`: un cargo único del servicio (clave fija `cargo-tramo-<servicio>-<desde>`: no
 *     ocupa periodo y nunca se duplica), línea de servicio de internet (4.1.01) con las fechas, por
 *     `monto` o, por defecto, el proporcional (`montoProporcionalTramo`); un monto distinto exige
 *     `puede_editar_monto`. Sin mora, vence hoy + dias_gracia, asiento, `factura.emitida` y FEL.
 *   - Ya cobrado de una forma u otra (factura vigente): 422 `tramo_ya_cobrado`; sin tramo: 422
 *     `sin_tramo_inicial`.
 * - Retirado, pendiente de instalación o sin plantilla: 422 con esa regla. Un inicio que no es de un
 *   periodo del servicio: 422 `periodo_invalido`.
 */

export type ModoTramoInicial = 'primera_factura' | 'cargo_unico'

export interface EntradaEmitirFacturasPeriodo {
    servicio_id: number
    periodos?: string[]
    hasta?: string
    motivo?: string | null
    /** total a cobrar por periodo (con IVA), si difiere del calculado */
    montos?: Array<{ periodo: string; monto: string }>
    /** qué hacer con el tramo entre el inicio del ciclo y la instalación */
    tramo_inicial?: { modo: ModoTramoInicial; monto?: string | null } | null
    /** la ruta lo fija según `facturas.emitir_periodo_anterior`; nunca viene del cuerpo */
    puede_emitir_anterior?: boolean
    /** la ruta lo fija según `facturas.editar_monto_periodo`; nunca viene del cuerpo */
    puede_editar_monto?: boolean
    /** día de Guatemala que cuenta como hoy (pruebas); por defecto el real */
    hoy?: string
}

export interface FacturaPeriodoCreada {
    periodo: string
    factura_id: number
    estado: string
    total: string
    /** total calculado (precio efectivo completo, conceptos, adicionales y descuentos) */
    monto_calculado: string
    /** el total se editó a mano (distinto del calculado) */
    monto_editado: boolean
    /** lo que cubrió el saldo a favor al emitirla */
    pagado: string
    vence_en: string
}

export interface PeriodoBonificado {
    periodo: string
    bonificacion_id: number
}

export interface TramoInicialCobrado {
    modo: ModoTramoInicial
    desde: string
    hasta: string
    factura_id: number
    total: string
    /** primera factura: el total del periodo calculado; cargo único: el proporcional sugerido */
    monto_calculado: string
    monto_editado: boolean
    vence_en: string
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
    /** el tramo inicial cobrado en esta emisión (null si no se pidió) */
    tramo_inicial: TramoInicialCobrado | null
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
        // el tramo como cargo único puede ir solo, sin periodos
        const soloTramo = !pidePeriodos && !input.hasta && input.tramo_inicial?.modo === 'cargo_unico'
        if (pidePeriodos === Boolean(input.hasta) && !soloTramo) {
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

        const elegidos = soloTramo
            ? []
            : pidePeriodos
              ? elegirPorInicio(datos.periodos, input.periodos!, datos)
              : elegirHasta(datos.periodos, fechaValida(input.hasta!, 'hasta'), datos)

        const motivo = input.motivo?.trim() || null
        exigirAnteriores(elegidos, datos.facturar_desde, input.puede_emitir_anterior === true, motivo)
        const montos = montosPedidos(input.montos ?? [], elegidos)
        const tramo = exigirTramo(input, datos, elegidos, motivo)

        const resultado: ResultadoEmitirFacturasPeriodo = {
            servicio_id: servicio.id,
            cliente_id: servicio.cliente_id,
            creadas: [],
            bonificadas: [],
            omitidas: [],
            tramo_inicial: null,
            saldo_a_favor: '0.00',
        }
        const emitidas: number[] = []
        const creadasPorPeriodo = new Map<number, string>()
        const calculadoPorFactura = new Map<number, string>()
        const editados: Array<{
            periodo: string
            factura_id: number | null
            calculado: string
            cobrado: string
        }> = []
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
                    manual: manualDe(
                        p,
                        motivo,
                        montos.get(p.periodo) ?? null,
                        tramo?.modo === 'primera_factura' && p.periodo === tramo.primer_periodo
                            ? tramo.desde
                            : null,
                    ),
                },
                t.ctx,
                { trx: t.trx },
            )
            const pedido = montos.get(p.periodo)
            if (r.creada && pedido && r.monto_calculado && !dec(pedido).equals(r.monto_calculado)) {
                // se valida al conocer el calculado; el error revierte toda la transacción
                exigirEdicion(p.periodo, input.puede_editar_monto === true, motivo)
                editados.push({
                    periodo: p.periodo,
                    factura_id: r.factura_id,
                    calculado: r.monto_calculado,
                    cobrado: aTexto(pedido),
                })
            }
            if (r.creada && r.factura_id) {
                emitidas.push(r.factura_id)
                creadasPorPeriodo.set(r.factura_id, p.periodo)
                calculadoPorFactura.set(r.factura_id, r.monto_calculado ?? '0.00')
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
                monto_calculado: calculadoPorFactura.get(Number(f.id))!,
                monto_editado: !dec(f.total).equals(calculadoPorFactura.get(Number(f.id))!),
                pagado: aTexto(f.pagado),
                vence_en: f.vence_en,
            }))
        }
        if (tramo?.modo === 'primera_factura') {
            const factura = resultado.creadas.find((c) => c.periodo === tramo.primer_periodo)
            if (!factura) {
                throw new ReglaNegocio(
                    `El primer periodo (${tramo.primer_periodo}) no se emitió: no se puede incluir el tramo`,
                    'tramo_sin_primer_periodo',
                )
            }
            resultado.tramo_inicial = {
                modo: 'primera_factura',
                desde: tramo.desde,
                hasta: sumarDias(tramo.fin, -1),
                factura_id: factura.factura_id,
                total: factura.total,
                monto_calculado: factura.monto_calculado,
                monto_editado: factura.monto_editado,
                vence_en: factura.vence_en,
            }
        } else if (tramo?.modo === 'cargo_unico') {
            resultado.tramo_inicial = await cobrarTramoComoCargo(
                t,
                datos,
                tramo,
                motivo,
                input.tramo_inicial?.monto,
            )
            if (resultado.tramo_inicial.monto_editado) {
                exigirEdicion(`tramo ${tramo.desde}`, input.puede_editar_monto === true, motivo)
                editados.push({
                    periodo: tramo.desde,
                    factura_id: resultado.tramo_inicial.factura_id,
                    calculado: resultado.tramo_inicial.monto_calculado,
                    cobrado: resultado.tramo_inicial.total,
                })
            }
            // emitirDocumento fija la factura como entidad: la de esta acción es el servicio
            t.fijarEntidad('servicio', servicio.id)
        }
        if (editados.length > 0) t.anotarAuditoria({ montos_editados: editados })
        resultado.saldo_a_favor = aTexto(
            await saldoAnticipos(t.trx, servicio.cliente_id, servicio.empresa_id),
        )
        return resultado
    }
}

type TramoPedido = TramoInicial & { modo: ModoTramoInicial }

/** Valida el tramo inicial pedido: que exista, no esté cobrado, permiso, motivo y su primer periodo. */
function exigirTramo(
    input: EntradaEmitirFacturasPeriodo,
    datos: PeriodosDelServicio,
    elegidos: PeriodoDelServicio[],
    motivo: string | null,
): TramoPedido | null {
    const pedido = input.tramo_inicial
    if (!pedido) return null
    const regla = (codigo: string, mensaje: string) =>
        new ReglaNegocio(mensaje, codigo, [{ field: 'tramo_inicial', message: mensaje, rule: codigo }])
    const tramo = datos.tramo_inicial
    if (!tramo) {
        throw regla(
            'sin_tramo_inicial',
            'El servicio empieza en un inicio de ciclo: no hay días antes del primer periodo',
        )
    }
    if (tramo.cobrado) {
        throw regla(
            'tramo_ya_cobrado',
            `Los días del ${tramo.desde} al ${sumarDias(tramo.fin, -1)} ya se cobraron (factura ${tramo.cobrado.factura_id})`,
        )
    }
    if (!input.puede_emitir_anterior) {
        throw regla(
            'tramo_inicial_sin_permiso',
            'Cobrar los días antes del primer periodo requiere el permiso facturas.emitir_periodo_anterior',
        )
    }
    if (!motivo) {
        const mensaje = 'Cobrar los días antes del primer periodo exige un motivo'
        throw new ValidacionFallida([{ field: 'motivo', message: mensaje, rule: 'motivo_requerido' }])
    }
    if (pedido.modo === 'primera_factura') {
        const primero = elegidos.find((p) => p.periodo === tramo.primer_periodo)
        if (!primero || primero.ocupacion) {
            throw regla(
                'tramo_sin_primer_periodo',
                `Para incluir los días en la primera factura, elige el primer periodo (${tramo.primer_periodo}) y que no esté emitido`,
            )
        }
    } else if (pedido.monto !== undefined && pedido.monto !== null && !dec(pedido.monto).gt(0)) {
        throw new ValidacionFallida([
            {
                field: 'tramo_inicial.monto',
                message: 'El monto debe ser mayor que cero',
                rule: 'monto_positivo',
            },
        ])
    }
    return { ...tramo, modo: pedido.modo }
}

/** El tramo como cargo único del servicio (mismo camino que `EmitirCargoUnico`: `emitirDocumento`). */
async function cobrarTramoComoCargo(
    t: Transaccion,
    datos: PeriodosDelServicio,
    tramo: TramoInicial,
    motivo: string | null,
    monto: string | null | undefined,
): Promise<TramoInicialCobrado> {
    const { servicio } = datos
    const config = datos.config!
    const sugerido = montoProporcionalTramo(servicio.precio, tramo)
    const cobrado = aTexto(monto ? dec(monto) : dec(sugerido))
    const hasta = sumarDias(tramo.fin, -1)
    const venceEn = sumarDias(datos.hoy, config.dias_gracia)
    const emision = await emitirDocumento(t, {
        empresa_id: servicio.empresa_id,
        cliente_id: servicio.cliente_id,
        servicio_id: servicio.id,
        periodo: tramo.desde,
        clave_unica: claveTramoInicial(servicio.id, tramo.desde),
        vence_en: venceEn,
        lineas: [
            lineaConIva({
                concepto: `Servicio de internet ${servicio.plan_nombre} del ${tramo.desde} al ${hasta} (${tramo.dias} días antes del primer periodo)`,
                tipo: 'servicio',
                cantidad: '1',
                gravable: true,
                total: cobrado,
            }),
        ],
        reglas_snapshot: {
            ...config,
            // como todo cargo único: sin mora
            mora_tipo: 'ninguna',
            mora_valor: '0.00',
            mora_recurrente: false,
            cargo_unico: true,
            precio: aTexto(servicio.precio),
            plan_id: servicio.plan_id,
            plan_nombre: servicio.plan_nombre,
            ...(servicio.promocion_precio ? { promocion_velocidad: servicio.promocion_precio } : {}),
            emision_manual: {
                motivo,
                tramo_inicial: {
                    modo: 'cargo_unico',
                    desde: tramo.desde,
                    hasta,
                    dias: tramo.dias,
                    dias_ciclo: tramo.dias_ciclo,
                },
                monto_calculado: sugerido,
                monto_cobrado: dec(cobrado).equals(sugerido) ? null : cobrado,
            },
        },
        certificar_al: config.certificar_al,
        descripcion: `servicio ${servicio.id} · días del ${tramo.desde} al ${hasta}`,
    })
    if (!emision.creada || !emision.factura_id) {
        throw new ReglaNegocio(`Los días del ${tramo.desde} al ${hasta} ya se cobraron`, 'tramo_ya_cobrado')
    }
    const f = (await t.trx
        .from('billing.facturas')
        .where('id', emision.factura_id)
        .select('total')
        .firstOrFail()) as { total: string }
    return {
        modo: 'cargo_unico',
        desde: tramo.desde,
        hasta,
        factura_id: Number(emision.factura_id),
        total: aTexto(f.total),
        monto_calculado: sugerido,
        monto_editado: !dec(cobrado).equals(sugerido),
        vence_en: venceEn,
    }
}

/** Permiso y motivo de los periodos pasados a mano (`esPeriodoAnterior`). */
function exigirAnteriores(
    elegidos: PeriodoDelServicio[],
    facturarDesde: string | null,
    puede: boolean,
    motivo: string | null,
): void {
    const anteriores = elegidos.filter((p) => esPeriodoAnterior(p.estado))
    if (anteriores.length === 0) return
    const lista = anteriores.map((p) => p.periodo).join(', ')
    if (!puede) {
        const delInicio = anteriores.some((p) => p.estado === 'antes_del_inicio')
        const regla = delInicio ? 'antes_del_inicio' : 'antes_de_facturar_desde'
        const mensaje = delInicio
            ? `${lista}: anterior al inicio del servicio; requiere el permiso facturas.emitir_periodo_anterior`
            : `${lista}: anterior a facturar_desde (${facturarDesde}); requiere el permiso facturas.emitir_periodo_anterior`
        throw new ReglaNegocio(mensaje, regla, [{ field: 'periodos', message: mensaje, rule: regla }])
    }
    if (!motivo) {
        const mensaje = `${lista}: emitir un periodo anterior al inicio del servicio o del cobro exige un motivo`
        throw new ValidacionFallida([{ field: 'motivo', message: mensaje, rule: 'motivo_requerido' }])
    }
}

/** Los montos pedidos por periodo: de un periodo elegido, una vez, y mayores que cero. */
function montosPedidos(
    pedidos: Array<{ periodo: string; monto: string }>,
    elegidos: PeriodoDelServicio[],
): Map<string, string> {
    const salida = new Map<string, string>()
    const errores = []
    for (const [i, m] of pedidos.entries()) {
        const periodo = fechaValida(m.periodo, `montos.${i}.periodo`)
        if (!elegidos.some((p) => p.periodo === periodo) || salida.has(periodo)) {
            errores.push({
                field: `montos.${i}.periodo`,
                message: `${periodo} no es uno de los periodos elegidos (o se repite)`,
                rule: 'periodo_invalido',
            })
            continue
        }
        const monto = dec(m.monto)
        if (!monto.gt(0) || monto.decimalPlaces() > 2) {
            errores.push({
                field: `montos.${i}.monto`,
                message: 'El monto debe ser mayor que cero, con hasta 2 decimales',
                rule: 'monto_positivo',
            })
            continue
        }
        salida.set(periodo, aTexto(monto))
    }
    if (errores.length > 0) throw new ValidacionFallida(errores, 'Hay montos que no se pueden usar')
    return salida
}

/** Editar el total de un periodo: permiso `facturas.editar_monto_periodo` y motivo. */
function exigirEdicion(periodo: string, puede: boolean, motivo: string | null): void {
    if (!puede) {
        const mensaje = `${periodo}: cambiar el monto calculado requiere el permiso facturas.editar_monto_periodo`
        throw new ReglaNegocio(mensaje, 'editar_monto_sin_permiso', [
            { field: 'montos', message: mensaje, rule: 'editar_monto_sin_permiso' },
        ])
    }
    if (!motivo) {
        const mensaje = `${periodo}: cambiar el monto calculado exige un motivo`
        throw new ValidacionFallida([{ field: 'motivo', message: mensaje, rule: 'motivo_requerido' }])
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
        exigirDentroDeAnteriores(periodos, pedido, `periodos.${i}`)
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

/** 422 `maximo_periodos_anteriores` si `fecha` es anterior al primer periodo anterior permitido. */
function exigirDentroDeAnteriores(periodos: PeriodoDelServicio[], fecha: string, campo: string): void {
    const primero = periodos[0]
    if (!primero || fecha >= primero.periodo) return
    const mensaje = `Se pueden emitir hasta ${MAXIMO_PERIODOS_ANTERIORES} periodos anteriores al inicio del servicio: el primero empieza el ${primero.periodo}`
    throw new ReglaNegocio(mensaje, 'maximo_periodos_anteriores', [
        { field: campo, message: mensaje, rule: 'maximo_periodos_anteriores' },
    ])
}

/** Todos los periodos hasta `hasta`, sin los pasados a mano (anteriores al inicio o a `facturar_desde`: esos, solo por `periodos`). */
function elegirHasta(
    periodos: PeriodoDelServicio[],
    hasta: string,
    datos: Parameters<typeof exigirDentroDelMaximo>[0],
): PeriodoDelServicio[] {
    exigirDentroDelMaximo(datos, hasta, 'hasta')
    return periodos.filter((p) => p.periodo <= hasta && !esPeriodoAnterior(p.estado))
}
