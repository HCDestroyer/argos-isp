import { DomainAction, type Transaccion } from '#shared/domain_action'
import { facturarDesdeDe } from '#billing/asignacion_plantilla'
import { ZONA_NEGOCIO } from '#ledger/fechas'
import { aTexto, dec, type Dec } from '#ledger/dinero'
import { ReglaNegocio } from '#shared/errores'
import { configuracionDeServicio, leerServicio } from '#billing/configuracion'
import {
    claveFactura,
    diasEntre,
    periodosHasta,
    sumarDias,
    type ConfigCiclo,
    type PeriodoFacturable,
} from '#billing/periodos'
import { aplicarDescuentos, lineaConIva, totalesDe, type LineaCalculada } from '#billing/facturas'
import { bloquearCliente } from '#billing/cobros'
import { emitirDocumento } from '#billing/emision'
import { aplicarCanjesEmitidos, descuentosParaFactura } from '#lealtad/emision'
import {
    MOTIVO_CANJE,
    MOTIVO_PROMOCION,
    motivoPorNombre,
    registrarBonificacion,
    type OrigenBonificacion,
} from '#billing/bonificaciones'

/**
 * `facturas.emitir`: emite la factura de UN periodo de un servicio. La llama `generarFacturas`
 * (cron o `POST /facturas/generar`), una transacción por factura.
 *
 * - Idempotente por `clave_unica = servicio_id-periodo` (`INSERT … ON CONFLICT DO NOTHING`): si
 *   dos corridas compiten, solo una la crea y la otra devuelve `creada: false`.
 * - Líneas: el plan al precio efectivo (`costo_override` o precio del plan), los conceptos
 *   recurrentes activos y los adicionales `cobrado` vigentes en el periodo (una línea por asignación,
 *   `servicio_adicional_id`), todos multiplicados por el factor de prorrateo del periodo. Precios con
 *   IVA incluido; el IVA se desglosa por línea (`lineaConIva`).
 * - Guarda `reglas_snapshot`: la configuración efectiva (plantilla + excepciones) y el precio con
 *   que se emitió. Vence `dias_gracia` días después del inicio del periodo (a mano, lo pasado vence
 *   desde hoy: `manual.vence_en`, y el total puede editarse: `manual.monto`).
 * - Adicionales `cobrado` (decisiones del PM 2 y 3, `contratos/adicionales.md`): no se cobran en un
 *   periodo que empieza con la asignación bloqueada (servicio suspendido); el periodo en que empieza a
 *   cobrarse (`cobrado_desde`) se cobra según `primer_periodo`: `prorrateado`, los días desde
 *   `cobrado_desde` hasta el fin de ese periodo en la siguiente factura (o en la de ese periodo si aún
 *   no se emitió); `sin_costo`, nada. Cada línea guarda el periodo que cobra (`adicional_periodo`).
 * - **Nunca una factura de Q0** (decisión del PM, 19 oct): si los descuentos (mes gratis, canje,
 *   descuento del 100 %) la dejan en cero, el periodo se registra como **bonificación**
 *   (`#billing/bonificaciones`) con el motivo «Canje de lealtad» (o el pedido) y sus canjes quedan
 *   aplicados a ella.
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
    /** motivo de la bonificación si los `descuentos` dejan el periodo en cero (por defecto «Promoción») */
    bonificacion?: { motivo_id: number; motivo_texto: string } | null
    /**
     * Emisión manual de un periodo (`facturas.emitir_periodos`, `POST /servicios/:id/facturas-periodo`):
     * queda en `reglas_snapshot.emision_manual`. Con `antes_de_facturar_desde`, el periodo se emite
     * aunque sea anterior al `facturar_desde` de la asignación (excepción explícita, con su motivo y el
     * permiso `facturas.emitir_periodo_anterior`, que valida quien llama). El cron nunca la manda.
     */
    manual?: EmisionManual | null
}

/** Emisión manual de un periodo (`facturas.emitir_periodos`; `manualDe` en `#billing/periodos_facturables`). */
export interface EmisionManual {
    motivo: string | null
    /** periodo anterior al `facturar_desde` de la asignación (excepción con permiso y motivo) */
    antes_de_facturar_desde: boolean
    /** periodo anterior al primero del servicio (`antes_del_inicio`, misma excepción) */
    antes_del_inicio?: boolean
    /** vencimiento fijado por quien llama (lo pasado a mano vence desde hoy); por defecto periodo + gracia */
    vence_en?: string | null
    /**
     * Total editado a mano (con IVA incluido; `facturas.editar_monto_periodo` y motivo, que valida quien
     * llama). Si difiere del calculado: mayor, una línea `servicio` «Ajuste del monto del periodo» por
     * la diferencia (4.1.01, IVA desglosado); menor, un descuento por la diferencia sobre la línea del
     * plan (IVA del neto, 5.1.01), como cualquier descuento. Nunca deja la línea del plan bajo cero.
     */
    monto?: string | null
    /**
     * Incluir en esta factura (el primer periodo del servicio) el tramo entre el inicio del ciclo y la
     * instalación (decisión del PM del 21 nov): la línea dice «del `tramo_desde` al …» y el snapshot
     * guarda `emision_manual.tramo_inicial`. La clave sigue siendo la del periodo (`servicio_id-inicio`),
     * la misma que usaría el cron: nunca dos facturas del primer periodo.
     */
    tramo_desde?: string | null
}

export interface ResultadoEmitirFactura {
    factura_id: number | null
    /** el periodo quedó en cero y se registró como bonificación (nunca una factura de Q0) */
    bonificacion_id?: number | null
    creada: boolean
    /** por qué no se creó (ya existía, sin plantilla, retirado, pendiente de instalación, monto cero, antes de `facturar_desde`) */
    motivo: string | null
    /** total calculado antes de editar el monto (solo al crear una factura o bonificación) */
    monto_calculado?: string | null
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
        const bonificada = (await t.trx
            .from('billing.bonificaciones')
            .where('clave_unica', clave)
            .select('id')
            .first()) as { id: number } | null
        if (bonificada) {
            return {
                factura_id: null,
                bonificacion_id: Number(bonificada.id),
                creada: false,
                motivo: 'ya_existe',
            }
        }
        if (servicio.estado === 'retirado') return { factura_id: null, creada: false, motivo: 'retirado' }
        // sin instalar no hay periodo que cobrar (`contratos/instalacion.md` §3); los cargos únicos sí
        if (servicio.estado === 'pendiente_instalacion') {
            return { factura_id: null, creada: false, motivo: 'pendiente_instalacion' }
        }
        const config = await configuracionDeServicio(t.trx, servicio)
        if (!config) return { factura_id: null, creada: false, motivo: 'sin_plantilla' }
        // asignada por `plantillas.asignar_sin_plantilla`: nunca un periodo anterior a `facturar_desde`
        const desde = await facturarDesdeDe(t.trx, servicio.id)
        const permitida = input.manual?.antes_de_facturar_desde || input.manual?.antes_del_inicio
        if (desde && input.periodo.periodo < desde && !permitida) {
            return { factura_id: null, creada: false, motivo: 'antes_de_facturar_desde' }
        }

        const { periodo, fin, dias, dias_ciclo: diasCiclo } = input.periodo
        const factor = dec(input.periodo.factor)
        const prorrateado = !factor.equals(1)
        const ultimoDia = sumarDias(fin, -1)
        const tramoDesde = input.manual?.tramo_desde ?? null
        const cubreDesde = tramoDesde ?? periodo

        const lineas: LineaCalculada[] = [
            lineaConIva({
                concepto:
                    `Servicio de internet ${servicio.plan_nombre} del ${cubreDesde} al ${ultimoDia}` +
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
        // adicionales `cobrado` (contrato adicionales.md; decisiones del PM 2 y 3)
        lineas.push(...(await lineasAdicionales(t, servicio, config, input.periodo)))
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
        const calculadas =
            plan >= 0 && pedidos.length > 0
                ? aplicarDescuentos(
                      positivas,
                      pedidos.map((d) => ({ indice: plan, concepto: d.concepto, monto: d.monto })),
                  )
                : positivas
        const calculado = totalesDe(calculadas).total
        const cobrado = input.manual?.monto ? dec(input.manual.monto) : null
        const editado = cobrado !== null && !cobrado.equals(calculado)
        const conMonto = editado
            ? conMontoEditado(calculadas, positivas, pedidos, plan, calculado, cobrado)
            : calculadas

        const venceEn = input.manual?.vence_en ?? sumarDias(periodo, config.dias_gracia)
        const snapshot = {
            ...config,
            precio: aTexto(servicio.precio),
            plan_id: servicio.plan_id,
            plan_nombre: servicio.plan_nombre,
            ...(servicio.promocion_precio ? { promocion_velocidad: servicio.promocion_precio } : {}),
            periodo: input.periodo,
            ...(input.manual
                ? {
                      emision_manual: {
                          motivo: input.manual.motivo,
                          antes_de_facturar_desde: input.manual.antes_de_facturar_desde,
                          antes_del_inicio: input.manual.antes_del_inicio ?? false,
                          facturar_desde: desde,
                          monto_calculado: aTexto(calculado),
                          monto_cobrado: editado ? aTexto(cobrado) : null,
                          ...(tramoDesde
                              ? {
                                    tramo_inicial: {
                                        modo: 'primera_factura',
                                        desde: tramoDesde,
                                        dias: diasEntre(tramoDesde, periodo),
                                    },
                                }
                              : {}),
                      },
                  }
                : {}),
        }

        if (totalesDe(conMonto).total.isZero()) {
            const bonificado = await bonificarPeriodo(t, {
                servicio,
                periodo,
                clave,
                lineas: conMonto,
                snapshot,
                canjes: lealtad.canjes,
                pedido: input.bonificacion ?? null,
                descuentos: input.descuentos ?? [],
            })
            return { ...bonificado, monto_calculado: aTexto(calculado) }
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
        await aplicarCanjesEmitidos(t, { factura_id: facturaId }, lealtad.canjes)
        return { factura_id: facturaId, creada: true, motivo: null, monto_calculado: aTexto(calculado) }
    }
}

/**
 * Las líneas con el total editado a mano (`EmisionManual.monto`): más que lo calculado, una línea
 * `servicio` por la diferencia; menos, un descuento más sobre la línea del plan, junto con los que ya
 * tenía (lealtad, pedidos), para que el IVA del neto salga de una vez. 422 `monto_editado_invalido`
 * si la línea del plan no alcanza para la rebaja.
 */
function conMontoEditado(
    calculadas: LineaCalculada[],
    positivas: LineaCalculada[],
    pedidos: Array<{ concepto: string; monto: string }>,
    plan: number,
    calculado: Dec,
    cobrado: Dec,
): LineaCalculada[] {
    const diferencia = cobrado.minus(calculado)
    let lineas: LineaCalculada[]
    if (diferencia.gt(0)) {
        lineas = [
            ...calculadas,
            lineaConIva({
                concepto: 'Ajuste del monto del periodo',
                tipo: 'servicio',
                cantidad: '1',
                gravable: true,
                total: diferencia,
            }),
        ]
    } else {
        if (plan < 0) throw montoInvalido('La factura no tiene línea del servicio que rebajar')
        lineas = aplicarDescuentos(positivas, [
            ...pedidos.map((d) => ({ indice: plan, concepto: d.concepto, monto: d.monto })),
            { indice: plan, concepto: 'Ajuste del monto del periodo', monto: aTexto(diferencia.negated()) },
        ])
    }
    if (!totalesDe(lineas).total.equals(cobrado)) {
        throw montoInvalido(
            `El monto ${aTexto(cobrado)} rebaja más que la línea del servicio (calculado ${aTexto(calculado)})`,
        )
    }
    return lineas
}

function montoInvalido(mensaje: string): ReglaNegocio {
    return new ReglaNegocio(mensaje, 'monto_editado_invalido', [
        { field: 'montos', message: mensaje, rule: 'monto_editado_invalido' },
    ])
}

/** Periodo en cero: bonificación con su asiento interno; los canjes que lo dejaron en cero, aplicados a ella. */
async function bonificarPeriodo(
    t: Transaccion,
    d: {
        servicio: { id: number; cliente_id: number; empresa_id: number; plan_nombre: string }
        periodo: string
        clave: string
        lineas: LineaCalculada[]
        snapshot: Record<string, unknown>
        canjes: Array<{ id: number; monto: string }>
        pedido: { motivo_id: number; motivo_texto: string } | null
        descuentos: Array<{ concepto: string; monto: string }>
    },
): Promise<ResultadoEmitirFactura> {
    let origen: OrigenBonificacion
    let motivoId: number
    let motivoTexto: string
    if (d.canjes.length > 0) {
        const tipos = (await t.trx
            .from('lealtad.canjes')
            .whereIn(
                'id',
                d.canjes.map((c) => c.id),
            )
            .select('tipo')) as Array<{ tipo: string }>
        origen = tipos.some((c) => c.tipo === 'mes_gratis') ? 'mes_gratis' : 'canje'
        motivoId = d.pedido?.motivo_id ?? (await motivoPorNombre(t.trx, d.servicio.empresa_id, MOTIVO_CANJE))
        motivoTexto =
            d.pedido?.motivo_texto ?? `Canje ${d.canjes.map((c) => c.id).join(', ')} del programa de lealtad`
    } else {
        origen = 'descuento_100'
        motivoId =
            d.pedido?.motivo_id ?? (await motivoPorNombre(t.trx, d.servicio.empresa_id, MOTIVO_PROMOCION))
        motivoTexto =
            d.pedido?.motivo_texto ??
            (d.descuentos.map((x) => x.concepto).join('; ') || 'Descuento del 100 %')
    }
    const { bonificacion, creada } = await registrarBonificacion(t, {
        empresa_id: d.servicio.empresa_id,
        cliente_id: d.servicio.cliente_id,
        servicio_id: d.servicio.id,
        periodo: d.periodo,
        clave_unica: d.clave,
        concepto: `Servicio de internet ${d.servicio.plan_nombre} · periodo ${d.periodo}`,
        origen,
        lineas: d.lineas,
        motivo_id: motivoId,
        motivo_texto: motivoTexto,
        canje_id: d.canjes[0]?.id ?? null,
        reglas_snapshot: d.snapshot,
    })
    if (!creada) {
        return { factura_id: null, bonificacion_id: bonificacion.id, creada: false, motivo: 'ya_existe' }
    }
    await aplicarCanjesEmitidos(t, { bonificacion_id: bonificacion.id }, d.canjes)
    return { factura_id: null, bonificacion_id: bonificacion.id, creada: true, motivo: 'bonificacion' }
}

interface AsignacionCobrada {
    id: number
    nombre: string
    identificador: string | null
    precio: string
    primer_periodo: 'prorrateado' | 'sin_costo'
    /** fecha de `cobrado_desde` en Guatemala */
    desde: string
    /** fecha de `baja_en` en Guatemala, o null */
    baja: string | null
    /** la asignación estaba bloqueada (servicio suspendido) al empezar el periodo de la factura */
    bloqueada: boolean
}

/** Alguna factura viva ya tiene la línea de la asignación para ese periodo. */
async function yaCobrada(t: Transaccion, asignacionId: number, periodo: string): Promise<boolean> {
    const fila = await t.trx
        .from('billing.facturas_lineas as l')
        .join('billing.facturas as f', 'f.id', 'l.factura_id')
        .where('l.servicio_adicional_id', asignacionId)
        .where('l.adicional_periodo', periodo)
        .whereNot('f.estado', 'anulada')
        .select('l.id')
        .first()
    return Boolean(fila)
}

function lineaAdicional(
    a: AsignacionCobrada,
    concepto: string,
    total: ReturnType<typeof dec>,
    periodo: string,
): LineaCalculada {
    return {
        ...lineaConIva({ concepto, tipo: 'otro', cantidad: '1', gravable: true, total }),
        servicio_adicional_id: Number(a.id),
        adicional_periodo: periodo,
    }
}

/**
 * Líneas de los adicionales `cobrado` en la factura del periodo `q` (contrato `adicionales.md`):
 *
 * - **Completa** (`precio × factor` del periodo, como el plan) si se cobra desde el inicio de `q` o
 *   antes, no tenía baja al empezar `q` y no estaba bloqueada al empezar `q` (decisión 2).
 * - **Primer periodo** `P` (el que contiene `cobrado_desde`) con `primer_periodo = prorrateado`
 *   (decisión 3), una sola vez (ninguna factura viva tiene ya la línea de esa asignación y `P`):
 *   - si se cobra desde después del primer día de `P`: `precio × días desde cobrado_desde hasta el fin
 *     de P / días del ciclo`, en la factura de `P` si aún no se emitió o en la siguiente;
 *   - si se cobra desde el primer día de `P` y `P` ya se había facturado sin ella: `P` completo en la
 *     siguiente.
 * - `sin_costo`: el periodo de `cobrado_desde` no se cobra (salvo que empiece ese mismo día y aún no
 *   se haya facturado: entonces es la línea completa de ese periodo).
 */
async function lineasAdicionales(
    t: Transaccion,
    servicio: { id: number; inicio: string },
    config: ConfigCiclo,
    q: PeriodoFacturable,
): Promise<LineaCalculada[]> {
    const inicioQ = `(?::date)::timestamp AT TIME ZONE '${ZONA_NEGOCIO}'`
    const filas = (await t.trx
        .from('core.servicios_adicionales as sa')
        .join('core.adicionales as a', 'a.id', 'sa.adicional_id')
        .where('sa.servicio_id', servicio.id)
        .where('sa.modalidad', 'cobrado')
        .whereNotNull('sa.precio')
        .whereNotNull('sa.cobrado_desde')
        .whereRaw(`(sa.cobrado_desde AT TIME ZONE '${ZONA_NEGOCIO}')::date < ?::date`, [q.fin])
        .orderBy('sa.id', 'asc')
        .select(
            'sa.id',
            'a.nombre',
            'sa.identificador',
            'sa.precio',
            'sa.primer_periodo',
            t.trx.raw(`to_char(sa.cobrado_desde AT TIME ZONE '${ZONA_NEGOCIO}', 'YYYY-MM-DD') as desde`),
            t.trx.raw(`to_char(sa.baja_en AT TIME ZONE '${ZONA_NEGOCIO}', 'YYYY-MM-DD') as baja`),
            t.trx.raw(
                `coalesce(
                    (SELECT b.accion = 'bloqueado' FROM core.servicios_adicionales_bloqueos b
                      WHERE b.asignacion_id = sa.id AND b.created_at <= ${inicioQ}
                      ORDER BY b.id DESC LIMIT 1),
                    sa.bloqueo = 'bloqueado' AND sa.bloqueado_en <= ${inicioQ}
                ) as bloqueada`,
                [q.periodo, q.periodo],
            ),
        )) as AsignacionCobrada[]
    const salida: LineaCalculada[] = []
    const factor = dec(q.factor)
    for (const a of filas) {
        const nombre = a.identificador ? `${a.nombre} (${a.identificador})` : a.nombre
        const p = periodosHasta(config, servicio.inicio, a.desde).at(-1)
        if (p && a.primer_periodo === 'prorrateado' && p.periodo <= q.periodo) {
            if (a.desde > p.periodo && !(await yaCobrada(t, a.id, p.periodo))) {
                const dias = diasEntre(a.desde, p.fin)
                salida.push(
                    lineaAdicional(
                        a,
                        `${nombre} (primer periodo, ${dias}/${p.dias_ciclo} días desde el ${a.desde})`,
                        dec(a.precio).times(dias).div(p.dias_ciclo),
                        p.periodo,
                    ),
                )
            } else if (
                a.desde === p.periodo &&
                p.periodo < q.periodo &&
                !(await yaCobrada(t, a.id, p.periodo))
            ) {
                const facturado = await t.trx
                    .from('billing.facturas')
                    .where('clave_unica', claveFactura(servicio.id, p.periodo))
                    .whereNot('estado', 'anulada')
                    .select('id')
                    .first()
                if (facturado) {
                    salida.push(
                        lineaAdicional(
                            a,
                            `${nombre} (periodo del ${p.periodo})`,
                            dec(a.precio).times(p.factor),
                            p.periodo,
                        ),
                    )
                }
            }
        }
        // el periodo de esta factura, completo
        const vigente = a.baja === null || a.baja > q.periodo
        if (a.desde <= q.periodo && vigente && !a.bloqueada) {
            const concepto = factor.equals(1)
                ? nombre
                : `${nombre} (prorrateo ${q.dias}/${q.dias_ciclo} días)`
            salida.push(lineaAdicional(a, concepto, dec(a.precio).times(factor), q.periodo))
        }
    }
    return salida
}
