import { DateTime } from 'luxon'
import type { Transaccion } from '#shared/domain_action'
import { Conflicto, Problema, ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { aTexto, dec, type Dec } from '#ledger/dinero'
import { fechaValida, hoyGuatemala, inicioDeMes } from '#ledger/fechas'
import { bloqueoDe } from '#ledger/bloqueos'
import { impuesto as impuestoVigente } from '#fiscal/impuestos'
import { valorParametro } from '#fiscal/parametros'
import { sinIvaPorRegimen } from '#billing/regimen'
import { exigirDevolucionDentroDeLaCompra } from '#inventario/compras'
import { verProveedor, type ProveedorVista } from '#ledger/proveedores'
import {
    DOCUMENTOS_PEQUENO,
    DOCUMENTOS_SIN_IVA,
    IMPUESTO_IVA_COMPRA,
    calcularLineas,
    resolverCuentasLineas,
    saldoCompra,
    totalesCompra,
    type LineaCompraCalculada,
    type LineaCompraEntrada,
    type RetencionCalculada,
    type TipoDocumentoCompra,
    type TotalesCompra,
} from '#ledger/compras'
import {
    calcularRetenciones,
    sugerirRetencionesCompra,
    totalRetenido,
    type PedidoRetencion,
} from '#ledger/retenciones'

/**
 * Validación y cálculo comunes de `compras.registrar` y `compras.registrar_desde_egreso`
 * (contrato de localización fiscal §3.4 y §6.2). No escribe nada.
 *
 * - Documento según el proveedor: FPEQ y FCAP solo de un pequeño contribuyente (y él no emite
 *   FACT, FCAM, NDEB ni FESP); FESP solo a un proveedor `sin_documento`; un no residente, RECIBO.
 *   Otro caso: 422 `documento_no_permitido`.
 * - Duplicado (mismo proveedor, tipo, serie y número): 409 `compra_duplicada`.
 * - Crédito fiscal: por defecto, si el documento desglosa IVA y la empresa no es pequeño
 *   contribuyente en la fecha del documento (H40: entonces nunca, 422 `credito_no_permitido` si se pide). `periodo_iva` (primer día del mes en
 *   que se toma el crédito; por defecto el mes del documento, o el actual si ese mes está cerrado)
 *   va del mes del documento hasta `credito_fiscal_ventana_meses` después (inv. A.1, art. 20);
 *   fuera: 422 `credito_fiscal_extemporaneo` (o, desde un egreso, la compra entra sin crédito).
 * - Fecha contable = la mayor entre la fecha del documento y el inicio de `periodo_iva`: el
 *   asiento cae en el mes del libro de compras y `1.1.04` cuadra con él mes a mes.
 * - Retenciones emitidas: las pedidas o, sin `retenciones`, las sugeridas (`#ledger/retenciones`).
 * - NCRE: corrige una compra al crédito vigente del mismo proveedor sin pasar de su saldo (422
 *   `ncre_excede_saldo`); toma su crédito fiscal y no lleva retenciones.
 */

export interface DatosDocumentoCompra {
    empresa_id?: number | null
    proveedor_id: number
    tipo_documento: TipoDocumentoCompra
    serie?: string | null
    numero: string
    autorizacion?: string | null
    fecha_documento: string
    periodo_iva?: string | null
    credito_fiscal?: boolean | null
    compra_referencia_id?: number | null
    descripcion?: string | null
    lineas: LineaCompraEntrada[]
    retenciones?: PedidoRetencion[] | null
}

export interface CompraPreparada {
    empresaId: number
    proveedor: ProveedorVista
    tipo: TipoDocumentoCompra
    serie: string
    numero: string
    autorizacion: string | null
    fechaDocumento: string
    periodoIva: string
    fecha: string
    lineas: LineaCompraCalculada[]
    totales: TotalesCompra
    credito: boolean
    retenciones: RetencionCalculada[]
    neto: Dec
    referenciaId: number | null
    descripcion: string | null
}

export interface OpcionesPreparar {
    /** mes mínimo por defecto de `periodo_iva` (desde un egreso: el mes del egreso) */
    periodoMinimo?: string
    /** fuera de la ventana del crédito, la compra entra sin crédito en lugar de 422 */
    sinCreditoFueraDeVentana?: boolean
}

function sumarMeses(periodo: string, meses: number): string {
    return DateTime.fromISO(periodo, { zone: 'utc' }).plus({ months: meses }).toISODate()!
}

function problemaDocumento(proveedor: ProveedorVista, tipo: TipoDocumentoCompra): string | null {
    if (DOCUMENTOS_PEQUENO.has(tipo) && proveedor.tipo !== 'pequeno_contribuyente') {
        return `${tipo} es el documento de un pequeño contribuyente; ${proveedor.nombre} es ${proveedor.tipo}`
    }
    if (proveedor.tipo === 'pequeno_contribuyente' && ['FACT', 'FCAM', 'NDEB', 'FESP'].includes(tipo)) {
        return `Un pequeño contribuyente emite FPEQ o FCAP, no ${tipo}`
    }
    if ((tipo === 'FESP') !== (proveedor.tipo === 'sin_documento') && proveedor.tipo !== 'no_residente') {
        return tipo === 'FESP'
            ? 'La factura especial se emite a un proveedor sin documento (tipo sin_documento)'
            : 'A un proveedor sin documento la empresa le emite factura especial (FESP)'
    }
    if (proveedor.tipo === 'no_residente' && tipo !== 'RECIBO') {
        return 'Un no residente no emite documentos de la SAT: se registra con RECIBO (sin IVA)'
    }
    return null
}

export async function prepararCompra(
    t: Transaccion,
    input: DatosDocumentoCompra,
    opciones: OpcionesPreparar = {},
): Promise<CompraPreparada> {
    const proveedor = await verProveedor(input.proveedor_id, t.trx)
    const empresaId = proveedor.empresa_id
    exigirAccesoEmpresa(t.ctx, empresaId)
    t.fijarEmpresa(empresaId)
    const errores: ErrorCampo[] = []
    if (input.empresa_id && input.empresa_id !== empresaId) {
        errores.push({
            field: 'empresa_id',
            message: `El proveedor ${proveedor.id} es de la empresa ${empresaId}`,
            rule: 'proveedor_de_otra_empresa',
        })
    }
    if (!proveedor.activo) {
        errores.push({
            field: 'proveedor_id',
            message: 'El proveedor está inactivo',
            rule: 'proveedor_inactivo',
        })
    }
    const tipo = input.tipo_documento
    const problema = problemaDocumento(proveedor, tipo)
    if (problema) errores.push({ field: 'tipo_documento', message: problema, rule: 'documento_no_permitido' })
    const hoy = hoyGuatemala()
    const fechaDocumento = fechaValida(input.fecha_documento, 'fecha_documento')
    if (fechaDocumento > hoy) {
        errores.push({
            field: 'fecha_documento',
            message: 'La fecha del documento no puede ser futura',
            rule: 'futuro',
        })
    }
    if (input.lineas.length === 0) {
        errores.push({ field: 'lineas', message: 'La compra necesita al menos una línea', rule: 'required' })
    }
    if (tipo === 'NCRE') {
        input.lineas.forEach((linea, i) => {
            if (linea.tipo === 'activo_fijo' || linea.diferir_meses) {
                errores.push({
                    field: `lineas.${i}.tipo`,
                    message:
                        'Una NCRE no da de alta activos ni diferidos: corrige la compra con una baja o un ajuste',
                    rule: 'no_aplica',
                })
            }
        })
        if (input.retenciones && input.retenciones.length > 0) {
            errores.push({
                field: 'retenciones',
                message: 'Una NCRE no lleva retenciones',
                rule: 'no_aplica',
            })
        }
    }
    if (errores.length > 0) throw new ValidacionFallida(errores)

    const serie = (input.serie ?? '').trim().toUpperCase()
    const numero = input.numero.trim().toUpperCase()
    const repetida = await t.trx
        .from('ledger.compras')
        .where({ empresa_id: empresaId, proveedor_id: proveedor.id, tipo_documento: tipo, serie, numero })
        .select('id')
        .first()
    if (repetida) {
        throw new Conflicto(
            `El documento ${tipo} ${serie ? `${serie}-` : ''}${numero} de ${proveedor.nombre} ya está registrado (compra ${repetida.id})`,
            'compra_duplicada',
            'Compra duplicada',
        )
    }

    // referencia (NCRE obligatoria; NDEB opcional): compra vigente del mismo proveedor
    interface Referencia {
        id: number
        credito_fiscal: boolean
        condicion: string
    }
    let referencia: Referencia | null = null
    if (input.compra_referencia_id) {
        referencia = (await t.trx
            .from('ledger.compras as c')
            .where('c.id', input.compra_referencia_id)
            .where('c.proveedor_id', proveedor.id)
            .whereNot('c.tipo_documento', 'NCRE')
            .whereNotExists((q) => q.from('ledger.compras_anulaciones as x').whereRaw('x.compra_id = c.id'))
            .select('c.id', 'c.credito_fiscal', 'c.condicion')
            .first()) as Referencia | null
        if (!referencia) {
            throw new ValidacionFallida([
                {
                    field: 'compra_referencia_id',
                    message: `La compra ${input.compra_referencia_id} no es una compra vigente de ${proveedor.nombre}`,
                    rule: 'referencia',
                },
            ])
        }
    } else if (tipo === 'NCRE') {
        throw new ValidacionFallida([
            {
                field: 'compra_referencia_id',
                message: 'La NCRE corrige una compra: indica compra_referencia_id',
                rule: 'required',
            },
        ])
    }
    if (tipo !== 'NCRE' && tipo !== 'NDEB' && input.compra_referencia_id) {
        throw new ValidacionFallida([
            {
                field: 'compra_referencia_id',
                message: 'Solo NCRE y NDEB refieren otra compra',
                rule: 'no_aplica',
            },
        ])
    }

    const cuentas = await resolverCuentasLineas(t.trx, input.lineas, empresaId)
    const ivaCompra = DOCUMENTOS_SIN_IVA.has(tipo)
        ? null
        : await impuestoVigente(empresaId, IMPUESTO_IVA_COMPRA, fechaDocumento, t.trx)
    const tasa = ivaCompra?.tasa ?? '0'
    const lineas = calcularLineas(input.lineas, cuentas, tipo, tasa)
    const totales = totalesCompra(lineas)

    // H40 (auditor): una empresa de pequeño contribuyente en la fecha del documento no tiene crédito
    // fiscal: el IVA de su compra es costo o gasto (la línea va por su total, C_SIN_CREDITO)
    const pequeno = await sinIvaPorRegimen(t.trx, empresaId, fechaDocumento)
    const admite = !DOCUMENTOS_SIN_IVA.has(tipo) && totales.iva.gt(0) && !pequeno
    let credito = input.credito_fiscal ?? admite
    if (tipo === 'NCRE') credito = Boolean(referencia?.credito_fiscal) && admite
    if (credito && !admite) {
        throw new ValidacionFallida([
            {
                field: 'credito_fiscal',
                message: pequeno
                    ? 'La empresa es pequeño contribuyente en la fecha del documento: sus compras no dan crédito fiscal'
                    : DOCUMENTOS_SIN_IVA.has(tipo)
                      ? `Un documento ${tipo} no da derecho a crédito fiscal`
                      : 'Sin IVA no hay crédito fiscal',
                rule: 'credito_no_permitido',
            },
        ])
    }

    // periodo del IVA y fecha contable
    const mesDocumento = inicioDeMes(fechaDocumento)
    const mesHoy = inicioDeMes(hoy)
    let periodoIva: string
    if (input.periodo_iva) {
        periodoIva = inicioDeMes(fechaValida(input.periodo_iva, 'periodo_iva'))
    } else {
        periodoIva = [mesDocumento, opciones.periodoMinimo ?? mesDocumento].sort().at(-1)!
        // mes del IVA cerrado o bloqueado (declarado: bloqueo de impuestos, §10.4): al mes actual
        if (
            periodoIva < mesHoy &&
            (await bloqueoDe(t.trx, {
                fecha: periodoIva,
                empresaId,
                origen: 'compra',
                conImpuesto: true,
            })) !== null
        ) {
            periodoIva = mesHoy
        }
    }
    if (periodoIva < mesDocumento) {
        throw new ValidacionFallida([
            {
                field: 'periodo_iva',
                message: `El periodo del IVA no puede ser anterior al mes del documento (${mesDocumento.slice(0, 7)})`,
                rule: 'periodo_iva',
            },
        ])
    }
    if (periodoIva > mesHoy) {
        throw new ValidacionFallida([
            { field: 'periodo_iva', message: 'El periodo del IVA no puede ser futuro', rule: 'futuro' },
        ])
    }
    if (credito) {
        const ventana = Number(
            await valorParametro<number>(empresaId, 'credito_fiscal_ventana_meses', fechaDocumento, t.trx),
        )
        const limite = sumarMeses(mesDocumento, ventana)
        if (periodoIva > limite) {
            if (opciones.sinCreditoFueraDeVentana && input.credito_fiscal !== true) {
                credito = false
            } else {
                throw new Problema(
                    422,
                    'credito_fiscal_extemporaneo',
                    'Crédito fiscal fuera de plazo',
                    `El crédito de un documento de ${mesDocumento.slice(0, 7)} se toma hasta ${limite.slice(0, 7)} (${ventana} meses, art. 20 Ley del IVA); regístralo con credito_fiscal = false`,
                    [
                        {
                            field: 'periodo_iva',
                            message: `Fuera de la ventana del crédito fiscal (hasta ${limite.slice(0, 7)})`,
                            rule: 'credito_fiscal_extemporaneo',
                        },
                    ],
                )
            }
        }
    }
    const fecha = fechaDocumento > periodoIva ? fechaDocumento : periodoIva

    // retenciones emitidas
    const documento = { total: totales.total, iva: totales.iva }
    const pedidos =
        tipo === 'NCRE'
            ? []
            : (input.retenciones ??
              (await sugerirRetencionesCompra(t.trx, empresaId, fechaDocumento, proveedor, tipo, documento)))
    const retenciones = await calcularRetenciones(
        t.trx,
        empresaId,
        fechaDocumento,
        'compra',
        pedidos,
        documento,
    )
    const neto = totales.total.minus(totalRetenido(retenciones))
    if (neto.lte(0)) {
        throw new ValidacionFallida([
            {
                field: 'retenciones',
                message: 'Las retenciones no pueden cubrir todo el documento',
                rule: 'monto',
            },
        ])
    }

    if (tipo === 'NCRE') {
        // inventario: lo que pasa de lo que entró con la compra, antes que el saldo (observación del auditor)
        await exigirDevolucionDentroDeLaCompra(t, referencia!.id, lineas)
        const saldo = await saldoCompra(t.trx, referencia!.id)
        if (referencia!.condicion !== 'credito' || totales.total.gt(saldo)) {
            throw new Problema(
                422,
                'ncre_excede_saldo',
                'NCRE mayor que el saldo',
                `La NCRE de Q${aTexto(totales.total)} pasa del saldo pendiente de la compra ${referencia!.id} (Q${aTexto(saldo)})`,
                [
                    {
                        field: 'compra_referencia_id',
                        message: `Saldo: Q${aTexto(saldo)}`,
                        rule: 'ncre_excede_saldo',
                    },
                ],
            )
        }
    }

    return {
        empresaId,
        proveedor,
        tipo,
        serie,
        numero,
        autorizacion: input.autorizacion?.trim() || null,
        fechaDocumento,
        periodoIva,
        fecha,
        lineas,
        totales,
        credito,
        retenciones,
        neto,
        referenciaId: referencia?.id ?? null,
        descripcion: input.descripcion?.trim() || null,
    }
}

/** Fila de `ledger.compras` y sus líneas y retenciones (solo inserción). Devuelve el id. */
export async function insertarCompra(
    t: Transaccion,
    compra: CompraPreparada,
    extra: { condicion: 'contado' | 'credito'; vence_en: string | null; egreso_id: number | null },
    registradoPor: number | null,
): Promise<number> {
    const [fila] = (await t.trx
        .insertQuery()
        .table('ledger.compras')
        .insert({
            empresa_id: compra.empresaId,
            proveedor_id: compra.proveedor.id,
            tipo_documento: compra.tipo,
            serie: compra.serie,
            numero: compra.numero,
            autorizacion: compra.autorizacion,
            fecha_documento: compra.fechaDocumento,
            periodo_iva: compra.periodoIva,
            fecha: compra.fecha,
            condicion: extra.condicion,
            vence_en: extra.vence_en,
            base_bienes: aTexto(compra.totales.base_bienes),
            base_servicios: aTexto(compra.totales.base_servicios),
            base_importaciones: aTexto(compra.totales.base_importaciones),
            exento: aTexto(compra.totales.exento),
            iva: aTexto(compra.totales.iva),
            total: aTexto(compra.totales.total),
            credito_fiscal: compra.credito,
            retencion_iva: aTexto(totalRetenido(compra.retenciones, 'iva')),
            retencion_isr: aTexto(totalRetenido(compra.retenciones, 'isr')),
            compra_referencia_id: compra.referenciaId,
            egreso_id: extra.egreso_id,
            descripcion: compra.descripcion,
            registrado_por: registradoPor,
        })
        .returning('id')) as Array<{ id: number }>
    const compraId = Number(fila!.id)
    await t.trx
        .insertQuery()
        .table('ledger.compras_lineas')
        .multiInsert(
            compra.lineas.map((l) => ({
                compra_id: compraId,
                descripcion: l.descripcion,
                tipo: l.tipo,
                cuenta_id: l.cuenta.id,
                exento: l.exento,
                base: aTexto(l.base),
                iva: aTexto(l.iva),
                clase_activo: l.clase_activo,
                diferir_meses: l.diferir_meses,
                cantidad: l.cantidad,
                producto_id: l.producto_id,
                bodega_id: l.bodega_id,
            })),
        )
    if (compra.retenciones.length > 0) {
        await t.trx
            .insertQuery()
            .table('ledger.compras_retenciones')
            .multiInsert(
                compra.retenciones.map((r) => ({
                    compra_id: compraId,
                    impuesto_codigo: r.impuesto_codigo,
                    impuesto: r.impuesto,
                    base: aTexto(r.base),
                    tasa: r.tasa,
                    monto: aTexto(r.monto),
                })),
            )
    }
    return compraId
}

/** Texto del documento: `FACT A-123`. */
export function documentoCompra(compra: Pick<CompraPreparada, 'tipo' | 'serie' | 'numero'>): string {
    return `${compra.tipo} ${compra.serie ? `${compra.serie}-` : ''}${compra.numero}`
}

/** Fecha límite de pago de una compra al crédito: la dada o el documento + días de crédito. */
export function venceCompra(compra: CompraPreparada, venceEn?: string | null): string {
    if (venceEn) {
        const fecha = fechaValida(venceEn, 'vence_en')
        if (fecha < compra.fechaDocumento) {
            throw new ValidacionFallida([
                {
                    field: 'vence_en',
                    message: 'El vencimiento no puede ser anterior al documento',
                    rule: 'vence_en',
                },
            ])
        }
        return fecha
    }
    return DateTime.fromISO(compra.fechaDocumento, { zone: 'utc' })
        .plus({ days: compra.proveedor.dias_credito })
        .toISODate()!
}

export { dec }
