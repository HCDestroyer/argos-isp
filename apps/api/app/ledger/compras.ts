import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado, ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { filtrarPorEmpresa } from '#shared/empresa_activa'
import { paginar, type OpcionesPaginacion } from '#shared/paginacion'
import { CERO, aTexto, dec, redondear, type Dec } from '#ledger/dinero'
import { CUENTAS, PAIS_PLAN } from '#ledger/plan_cuentas'
import { CLASES_ACTIVO, CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import type { LineaAsiento } from '#ledger/actions/registrar_asiento'

/**
 * Compras (contrato de localización fiscal §3.4, fase 5): lectura y cálculo. Las acciones
 * (`compras.registrar`, `compras.registrar_desde_egreso`, `compras.anular`) viven en `actions/`.
 *
 * Una compra es la factura (u otro documento) del proveedor: solo inserción, con sus líneas y sus
 * retenciones emitidas. Su asiento (origen `compra`, `origen_id` = la compra):
 *
 * ```
 * Gasto o activo (línea)            debe   base (+ IVA si no hay crédito fiscal)
 * 1.1.04 IVA crédito fiscal         debe   iva            (solo con credito_fiscal)
 * Caja | Banco | 2.1.03 Proveedores haber  total − retenciones
 * 2.1.04 Retenciones IVA por pagar  haber  retención de IVA
 * 2.1.05 Retenciones ISR por pagar  haber  retención de ISR
 * ```
 *
 * Una NCRE del proveedor es el mismo asiento al revés (baja la CxP de la compra que corrige). Cada
 * partida de base y de cuota lleva su etiqueta (`IVA12_C` con `C_BASE_BIEN`, `C_BASE_SERV`,
 * `C_PEQ`, `C_SIN_CREDITO` o `C_IVA`; las retenciones con `RET_IVA_EMI` y `RET_ISR_EMI`; signo `-`
 * en las NCRE y en los reversos de una anulación).
 */

export const TIPOS_DOCUMENTO_COMPRA = [
    'FACT',
    'FCAM',
    'FPEQ',
    'FCAP',
    'NCRE',
    'NDEB',
    'FESP',
    'DUA',
    'RECIBO',
] as const
export type TipoDocumentoCompra = (typeof TIPOS_DOCUMENTO_COMPRA)[number]

/** Documentos sin IVA desglosado ni crédito fiscal (inv. A.3). */
export const DOCUMENTOS_SIN_IVA: ReadonlySet<TipoDocumentoCompra> = new Set(['FPEQ', 'FCAP', 'RECIBO'])
/** Documentos de un pequeño contribuyente. */
export const DOCUMENTOS_PEQUENO: ReadonlySet<TipoDocumentoCompra> = new Set(['FPEQ', 'FCAP'])

export const TIPOS_LINEA_COMPRA = ['bien', 'servicio', 'activo_fijo', 'combustible', 'importacion'] as const
export type TipoLineaCompra = (typeof TIPOS_LINEA_COMPRA)[number]

export type ClaseActivo = (typeof CLASES_ACTIVO)[number]['clave']
export const CLAVES_CLASE_ACTIVO = CLASES_ACTIVO.map((c) => c.clave) as ClaseActivo[]

/** Impuesto de las etiquetas de la compra (contrato §10.2: un código por uso). */
export const IMPUESTO_IVA_COMPRA = 'IVA12_C'

export type CondicionCompra = 'contado' | 'credito'
export type EstadoCompra = 'vigente' | 'anulada'

export interface LineaCompraEntrada {
    descripcion: string
    tipo?: TipoLineaCompra | null
    /** cuenta de gasto o de activo (código o id); o `categoria` de egreso; activo fijo: `clase_activo` */
    cuenta?: string | number | null
    categoria?: string | null
    clase_activo?: ClaseActivo | null
    /** total de la línea con el IVA incluido */
    total: string
    /** unidades de la línea (1 por defecto): un bien para varios premios de un sorteo se reparte por unidad */
    cantidad?: number | null
    /** IVA del documento si difiere del calculado (redondeo del proveedor) */
    iva?: string | null
    exento?: boolean | null
    /** diferir el gasto en N meses (gasto pagado por anticipado, §10.10) */
    diferir_meses?: number | null
    /** mes en que empieza la amortización (por defecto el de la compra) */
    diferir_desde?: string | null
    /** datos del activo fijo de la línea (§10.10) */
    activo_descripcion?: string | null
    activo_serie?: string | null
    activo_ubicacion?: string | null
    activo_tasa_anual?: string | null
    activo_valor_residual?: string | null
    /**
     * inventario (`contratos/inventario.md` §5): una línea `bien` con producto entra al kardex en
     * `bodega_id` por `cantidad` unidades y va a `1.1.14 Inventarios` en lugar de a un gasto
     */
    producto_id?: number | null
    bodega_id?: number | null
}

export interface CuentaLinea {
    id: number
    codigo: string
    nombre: string
    tipo: string
}

export interface LineaCompraCalculada {
    descripcion: string
    tipo: TipoLineaCompra
    cuenta: CuentaLinea
    exento: boolean
    base: Dec
    iva: Dec
    total: Dec
    clase_activo: ClaseActivo | null
    diferir_meses: number | null
    cantidad: number
    producto_id: number | null
    bodega_id: number | null
}

export interface TotalesCompra {
    base_bienes: Dec
    base_servicios: Dec
    base_importaciones: Dec
    exento: Dec
    iva: Dec
    total: Dec
}

/** Columna del libro de compras de una línea. */
export function columnaDeLinea(
    linea: Pick<LineaCompraCalculada, 'tipo' | 'exento'>,
): keyof Omit<TotalesCompra, 'iva' | 'total'> {
    if (linea.exento) return 'exento'
    if (linea.tipo === 'servicio') return 'base_servicios'
    if (linea.tipo === 'importacion') return 'base_importaciones'
    return 'base_bienes'
}

export function totalesCompra(lineas: LineaCompraCalculada[]): TotalesCompra {
    const totales: TotalesCompra = {
        base_bienes: CERO,
        base_servicios: CERO,
        base_importaciones: CERO,
        exento: CERO,
        iva: CERO,
        total: CERO,
    }
    for (const linea of lineas) {
        const columna = columnaDeLinea(linea)
        totales[columna] = totales[columna].plus(linea.base)
        totales.iva = totales.iva.plus(linea.iva)
        totales.total = totales.total.plus(linea.total)
    }
    return totales
}

/**
 * Base e IVA de cada línea con la tasa vigente (`IVA12_C`, porcentaje incluido): `iva = total −
 * total / (1 + tasa)`, redondeado al final de la línea. Un IVA del documento se respeta si no se
 * aparta más de Q0.05 del calculado (redondeos del proveedor). Documentos sin IVA: iva = 0.
 */
export function calcularLineas(
    entradas: LineaCompraEntrada[],
    cuentas: CuentaLinea[],
    tipoDocumento: TipoDocumentoCompra,
    tasaIva: string,
): LineaCompraCalculada[] {
    const errores: ErrorCampo[] = []
    const divisor = dec('1').plus(dec(tasaIva).div(100))
    const lineas = entradas.map((entrada, i): LineaCompraCalculada => {
        const campo = `lineas.${i}`
        const total = dec(entrada.total)
        if (total.lte(0) || total.decimalPlaces() > 2) {
            errores.push({
                field: `${campo}.total`,
                message: 'El total de la línea es mayor que 0 con hasta 2 decimales',
                rule: 'monto',
            })
        }
        const sinIva = DOCUMENTOS_SIN_IVA.has(tipoDocumento) || Boolean(entrada.exento)
        let iva = sinIva ? CERO : redondear(total.minus(total.div(divisor)))
        if (entrada.iva !== undefined && entrada.iva !== null) {
            const documento = dec(entrada.iva)
            if (sinIva && !documento.isZero()) {
                errores.push({
                    field: `${campo}.iva`,
                    message: entrada.exento
                        ? 'Una línea exenta no lleva IVA'
                        : `Un documento ${tipoDocumento} no lleva IVA desglosado`,
                    rule: 'sin_iva',
                })
            } else if (!sinIva && documento.minus(iva).abs().gt('0.05')) {
                errores.push({
                    field: `${campo}.iva`,
                    message: `El IVA ${aTexto(documento)} se aparta del calculado (${aTexto(iva)}) en más de Q0.05`,
                    rule: 'iva',
                })
            } else {
                iva = documento
            }
        }
        const tipo = entrada.tipo ?? 'servicio'
        return {
            descripcion: entrada.descripcion.trim(),
            tipo,
            cuenta: cuentas[i]!,
            exento: Boolean(entrada.exento) && !DOCUMENTOS_SIN_IVA.has(tipoDocumento),
            base: total.minus(iva),
            iva,
            total,
            clase_activo: entrada.clase_activo ?? null,
            diferir_meses: entrada.diferir_meses ?? null,
            cantidad: entrada.cantidad ?? 1,
            producto_id: entrada.producto_id ?? null,
            bodega_id: entrada.producto_id ? (entrada.bodega_id ?? null) : null,
        }
    })
    if (errores.length > 0) throw new ValidacionFallida(errores)
    return lineas
}

/** Cuadrícula de la base de una línea (sin signo), o null si no lleva etiqueta (exenta). */
export function cuadriculaBase(
    tipoDocumento: TipoDocumentoCompra,
    linea: Pick<LineaCompraCalculada, 'tipo' | 'exento'>,
    creditoFiscal: boolean,
): string | null {
    if (linea.exento) return null
    if (DOCUMENTOS_PEQUENO.has(tipoDocumento)) return 'C_PEQ'
    if (!creditoFiscal) return 'C_SIN_CREDITO'
    return linea.tipo === 'servicio' ? 'C_BASE_SERV' : 'C_BASE_BIEN'
}

export interface RetencionCalculada {
    impuesto_codigo: string
    impuesto: 'iva' | 'isr'
    base: Dec
    tasa: string
    monto: Dec
    cuenta: string
    cuadricula: string
}

/**
 * Partidas del asiento de una compra (o NCRE, `invertir`): las líneas (con el IVA si no hay
 * crédito), el IVA crédito, las retenciones y la contrapartida (caja, banco o `2.1.03` con el
 * proveedor) por el neto. Las etiquetas llevan signo `+` (`-` en la NCRE).
 */
export function movimientosCompra(datos: {
    tipo_documento: TipoDocumentoCompra
    lineas: LineaCompraCalculada[]
    credito_fiscal: boolean
    iva: Dec
    retenciones: RetencionCalculada[]
    contrapartida: { cuenta: string | number; proveedor_id: number | null }
    neto: Dec
    /** cuenta de una línea que se reemplaza (diferidos: la línea va a 1.1.13) */
    cuentaDe?: (linea: LineaCompraCalculada) => number
}): LineaAsiento[] {
    const invertir = datos.tipo_documento === 'NCRE'
    const signo = invertir ? '-' : '+'
    const lado = (monto: Dec, enDebe: boolean) =>
        enDebe !== invertir ? { debe: aTexto(monto) } : { haber: aTexto(monto) }
    const movimientos: LineaAsiento[] = []
    for (const linea of datos.lineas) {
        const costo = datos.credito_fiscal ? linea.base : linea.total
        const cuadricula = cuadriculaBase(datos.tipo_documento, linea, datos.credito_fiscal)
        movimientos.push({
            cuenta: datos.cuentaDe ? datos.cuentaDe(linea) : linea.cuenta.id,
            ...lado(costo, true),
            ...(cuadricula
                ? { impuesto_codigo: IMPUESTO_IVA_COMPRA, cuadricula: `${signo}${cuadricula}` }
                : {}),
        })
    }
    if (datos.credito_fiscal && datos.iva.gt(0)) {
        movimientos.push({
            cuenta: CUENTAS_GT.IVA_CREDITO,
            ...lado(datos.iva, true),
            impuesto_codigo: IMPUESTO_IVA_COMPRA,
            cuadricula: `${signo}C_IVA`,
        })
    }
    for (const retencion of datos.retenciones) {
        movimientos.push({
            cuenta: retencion.cuenta,
            ...lado(retencion.monto, false),
            impuesto_codigo: retencion.impuesto_codigo,
            cuadricula: `${signo}${retencion.cuadricula}`,
        })
    }
    movimientos.push({
        cuenta: datos.contrapartida.cuenta,
        ...lado(datos.neto, false),
        proveedor_id: datos.contrapartida.proveedor_id,
    })
    return movimientos
}

/**
 * Cuenta de cada línea: activo fijo → `1.2.01.NN` de su clase; `categoria` → la cuenta de la
 * categoría de egreso; `cuenta` → una de gasto o de activo imputable y activa (nunca caja, banco,
 * IVA, retenciones, CxC ni proveedores; propiedad, planta y equipo solo con `activo_fijo`: 422
 * `cuenta_activo_fijo`); sin nada, `5.2.04 Vehículos` para combustible y `5.2.99
 * Otros gastos` para el resto.
 */
export async function resolverCuentasLineas(
    trx: QueryClientContract,
    entradas: LineaCompraEntrada[],
    empresaId: number,
): Promise<CuentaLinea[]> {
    const errores: ErrorCampo[] = []
    const salida: CuentaLinea[] = []
    for (const [i, entrada] of entradas.entries()) {
        const campo = `lineas.${i}`
        const tipo = entrada.tipo ?? 'servicio'
        let fila: (CuentaLinea & Record<string, unknown>) | null = null
        if (entrada.producto_id || entrada.bodega_id) {
            // inventario §5: la línea bien con producto va a 1.1.14 (la única cuenta del kardex)
            const problema =
                tipo !== 'bien'
                    ? { campo: 'tipo', mensaje: 'Solo una línea bien entra al inventario' }
                    : !entrada.producto_id || !entrada.bodega_id
                      ? {
                            campo: entrada.producto_id ? 'bodega_id' : 'producto_id',
                            mensaje: 'Una línea que entra al inventario lleva producto_id y bodega_id',
                        }
                      : entrada.cuenta || entrada.categoria || entrada.clase_activo || entrada.diferir_meses
                        ? {
                              campo: 'cuenta',
                              mensaje:
                                  'Una línea de inventario va a 1.1.14: sin cuenta, categoría, clase de activo ni diferimiento',
                          }
                        : null
            if (problema) {
                errores.push({
                    field: `${campo}.${problema.campo}`,
                    message: problema.mensaje,
                    rule: 'linea_inventario',
                })
                continue
            }
            fila = await cuentaPorCodigo(trx, CUENTAS_GT.INVENTARIOS)
            if (!fila) {
                errores.push({
                    field: `${campo}.producto_id`,
                    message: `La cuenta ${CUENTAS_GT.INVENTARIOS} no está instalada: actualiza la localización`,
                    rule: 'cuenta_compra',
                })
                continue
            }
            salida.push({
                id: Number(fila.id),
                codigo: String(fila.codigo),
                nombre: String(fila.nombre),
                tipo: String(fila.tipo),
            })
            continue
        } else if (tipo === 'activo_fijo') {
            const clase = CLASES_ACTIVO.find((c) => c.clave === entrada.clase_activo)
            if (!clase) {
                errores.push({
                    field: `${campo}.clase_activo`,
                    message: `Un activo fijo necesita su clase (${CLAVES_CLASE_ACTIVO.join(', ')})`,
                    rule: 'clase_activo',
                })
                continue
            }
            fila = await cuentaPorCodigo(trx, `${CUENTAS_GT.PROPIEDAD_PLANTA_EQUIPO}.${clase.sufijo}`)
        } else if (entrada.clase_activo) {
            errores.push({
                field: `${campo}.clase_activo`,
                message: 'clase_activo solo aplica a las líneas activo_fijo',
                rule: 'no_aplica',
            })
            continue
        } else if (entrada.categoria) {
            fila = (await trx
                .from('ledger.egresos_categorias as ec')
                .join('ledger.cuentas as c', 'c.id', 'ec.cuenta_id')
                .where('ec.clave', entrada.categoria)
                .select('c.*')
                .first()) as (CuentaLinea & Record<string, unknown>) | null
            if (!fila) {
                errores.push({
                    field: `${campo}.categoria`,
                    message: `La categoría ${entrada.categoria} no existe`,
                    rule: 'exists',
                })
                continue
            }
        } else if (entrada.cuenta !== undefined && entrada.cuenta !== null) {
            fila =
                typeof entrada.cuenta === 'number'
                    ? ((await trx.from('ledger.cuentas').where('id', entrada.cuenta).first()) as
                          (CuentaLinea & Record<string, unknown>) | null)
                    : await cuentaPorCodigo(trx, entrada.cuenta)
            if (!fila) {
                errores.push({
                    field: `${campo}.cuenta`,
                    message: `La cuenta ${entrada.cuenta} no existe`,
                    rule: 'exists',
                })
                continue
            }
        } else {
            fila = await cuentaPorCodigo(
                trx,
                tipo === 'combustible' ? CUENTAS.GASTO_VEHICULOS : CUENTAS.GASTO_OTROS,
            )
        }
        const problema = problemaDeCuentaLinea(fila!, empresaId)
        if (problema) {
            errores.push({ field: `${campo}.cuenta`, message: problema, rule: 'cuenta_compra' })
            continue
        }
        // inventario §3: 1.1.14 solo la mueve el kardex (una línea con producto_id)
        if (String(fila!.codigo) === CUENTAS_GT.INVENTARIOS) {
            errores.push({
                field: `${campo}.cuenta`,
                message: `La cuenta ${CUENTAS_GT.INVENTARIOS} es del kardex: usa producto_id y bodega_id en una línea bien`,
                rule: 'cuenta_inventario',
            })
            continue
        }
        // observación del auditor (sorteos): propiedad, planta y equipo solo con una línea activo_fijo,
        // que da de alta el activo; si no, 1.2.01.NN quedaría sin su activo (y sin depreciación)
        const codigoFila = String(fila!.codigo)
        if (
            tipo !== 'activo_fijo' &&
            [CUENTAS_GT.PROPIEDAD_PLANTA_EQUIPO, CUENTAS_GT.DEPRECIACION_ACUMULADA].some(
                (c) => codigoFila === c || codigoFila.startsWith(`${c}.`),
            )
        ) {
            errores.push({
                field: `${campo}.cuenta`,
                message: `La cuenta ${codigoFila} es de activo fijo: usa tipo activo_fijo con su clase_activo (da de alta el activo)`,
                rule: 'cuenta_activo_fijo',
            })
            continue
        }
        salida.push({
            id: Number(fila!.id),
            codigo: String(fila!.codigo),
            nombre: String(fila!.nombre),
            tipo: String(fila!.tipo),
        })
    }
    if (errores.length > 0) throw new ValidacionFallida(errores)
    return salida
}

async function cuentaPorCodigo(trx: QueryClientContract, codigo: string) {
    return (await trx.from('ledger.cuentas').where({ pais: PAIS_PLAN, codigo }).first()) as
        (CuentaLinea & Record<string, unknown>) | null
}

/** Cuentas que una línea de compra no puede tocar (las mueve la compra misma u otro documento). */
const PREFIJOS_PROHIBIDOS = [
    CUENTAS.CAJAS,
    CUENTAS.BANCOS,
    CUENTAS.CXC_CLIENTES,
    CUENTAS_GT.IVA_CREDITO,
    CUENTAS_GT.IVA_RETENIDO_CLIENTES,
    CUENTAS_GT.ISR_RETENIDO_CLIENTES,
    CUENTAS_GT.COBROS_POR_LIQUIDAR,
    CUENTAS_GT.FONDOS_EN_TRANSITO,
    CUENTAS_GT.ESTIMACION_INCOBRABLES,
    CUENTAS_GT.DEPRECIACION_ACUMULADA,
]

function problemaDeCuentaLinea(fila: Record<string, unknown>, empresaId: number): string | null {
    const codigo = String(fila.codigo)
    if (!fila.activa) return `La cuenta ${codigo} está inactiva`
    if (!fila.imputable) return `La cuenta ${codigo} es de agrupación`
    if (fila.empresa_id !== null && Number(fila.empresa_id) !== empresaId) {
        return `La cuenta ${codigo} es de otra empresa`
    }
    if (fila.tipo !== 'gasto' && fila.tipo !== 'activo') {
        return `Una línea de compra va a una cuenta de gasto o de activo (${codigo} es ${String(fila.tipo)})`
    }
    if (fila.auxiliar_cliente || fila.auxiliar_proveedor) return `La cuenta ${codigo} lleva auxiliar`
    if (PREFIJOS_PROHIBIDOS.some((p) => codigo === p || codigo.startsWith(`${p}.`))) {
        return `La cuenta ${codigo} la mueve la compra misma u otro documento; usa una de gasto o de activo`
    }
    return null
}

/*
|--------------------------------------------------------------------------
| Lectura
|--------------------------------------------------------------------------
*/

export interface CompraVista {
    id: number
    empresa_id: number
    proveedor_id: number
    proveedor_nombre: string
    proveedor_nit: string
    tipo_documento: TipoDocumentoCompra
    serie: string
    numero: string
    autorizacion: string | null
    fecha_documento: string
    periodo_iva: string
    fecha: string
    condicion: CondicionCompra
    vence_en: string | null
    base_bienes: string
    base_servicios: string
    base_importaciones: string
    exento: string
    iva: string
    total: string
    credito_fiscal: boolean
    retencion_iva: string
    retencion_isr: string
    /** total − retenciones: lo que se paga al proveedor */
    neto: string
    /** lo que falta pagar (crédito vigente); 0 en contado, NCRE y anuladas */
    saldo: string
    compra_referencia_id: number | null
    /** egreso existente desde el que se registró la compra */
    egreso_id: number | null
    /** egreso que paga la compra al contado */
    egreso_pago_id: number | null
    descripcion: string | null
    asiento_id: number | null
    estado: EstadoCompra
    anulado_en: Date | null
    anulado_por: number | null
    motivo_anulacion: string | null
    asiento_reverso_id: number | null
    registrado_por: number | null
    created_at: Date
    lineas: Array<{
        id: number
        descripcion: string
        tipo: TipoLineaCompra
        cuenta_id: number
        cuenta_codigo: string
        exento: boolean
        base: string
        iva: string
        clase_activo: string | null
        diferir_meses: number | null
        cantidad: number
        /** inventario: la línea entró al kardex de este producto y bodega */
        producto_id: number | null
        bodega_id: number | null
    }>
    retenciones: Array<{
        impuesto_codigo: string
        impuesto: 'iva' | 'isr'
        base: string
        tasa: string
        monto: string
    }>
}

/**
 * SQL del saldo pendiente de la compra `alias` (crédito vigente): neto − NCRE vigentes que la
 * corrigen − pagos vigentes aplicados (`#ledger/pagos_proveedores`, cuando existan).
 */
export function sqlSaldoCompra(alias: string): string {
    return `(CASE WHEN ${alias}.condicion <> 'credito' OR ${alias}.tipo_documento = 'NCRE'
                    OR EXISTS (SELECT 1 FROM ledger.compras_anulaciones xa WHERE xa.compra_id = ${alias}.id) THEN 0
              ELSE ${alias}.total - ${alias}.retencion_iva - ${alias}.retencion_isr
                   - coalesce((SELECT sum(n.total) FROM ledger.compras n
                                WHERE n.compra_referencia_id = ${alias}.id AND n.tipo_documento = 'NCRE'
                                  AND NOT EXISTS (SELECT 1 FROM ledger.compras_anulaciones xn WHERE xn.compra_id = n.id)), 0)
                   ${sqlPagadoCompra(alias)}
          END)`
}

/** Pagos a proveedores aplicados a la compra (fase 5, pieza 3: se completa con su tabla). */
function sqlPagadoCompra(alias: string): string {
    return `- coalesce((SELECT sum(ap.monto) FROM ledger.pagos_proveedores_aplicaciones ap
                         WHERE ap.compra_id = ${alias}.id
                           AND NOT EXISTS (SELECT 1 FROM ledger.pagos_proveedores_anulaciones xp
                                            WHERE xp.pago_id = ap.pago_id)), 0)`
}

function consultaCompras(cliente: QueryClientContract) {
    return cliente
        .from('ledger.compras as c')
        .join('ledger.proveedores as p', 'p.id', 'c.proveedor_id')
        .leftJoin('ledger.compras_anulaciones as an', 'an.compra_id', 'c.id')
        .leftJoin('ledger.egresos as eg', 'eg.compra_id', 'c.id')
        .select(
            'c.id',
            'c.empresa_id',
            'c.proveedor_id',
            'p.nombre as proveedor_nombre',
            'p.nit as proveedor_nit',
            'c.tipo_documento',
            'c.serie',
            'c.numero',
            'c.autorizacion',
            cliente.raw(`to_char(c.fecha_documento, 'YYYY-MM-DD') as fecha_documento`),
            cliente.raw(`to_char(c.periodo_iva, 'YYYY-MM-DD') as periodo_iva`),
            cliente.raw(`to_char(c.fecha, 'YYYY-MM-DD') as fecha`),
            'c.condicion',
            cliente.raw(`to_char(c.vence_en, 'YYYY-MM-DD') as vence_en`),
            'c.base_bienes',
            'c.base_servicios',
            'c.base_importaciones',
            'c.exento',
            'c.iva',
            'c.total',
            'c.credito_fiscal',
            'c.retencion_iva',
            'c.retencion_isr',
            cliente.raw('(c.total - c.retencion_iva - c.retencion_isr)::text as neto'),
            cliente.raw(`(${sqlSaldoCompra('c')})::numeric(14,2)::text as saldo`),
            'c.compra_referencia_id',
            'c.egreso_id',
            'eg.id as egreso_pago_id',
            'c.descripcion',
            cliente.raw(
                `(SELECT a.id FROM ledger.asientos a WHERE a.origen_tipo = 'compra' AND a.origen_id = c.id
                     AND a.reversa_de IS NULL ORDER BY a.id LIMIT 1) as asiento_id`,
            ),
            cliente.raw(`case when an.id is null then 'vigente' else 'anulada' end as estado`),
            'an.anulado_en',
            'an.anulado_por',
            'an.motivo as motivo_anulacion',
            'an.asiento_id as asiento_reverso_id',
            'c.registrado_por',
            'c.created_at',
        )
}

type FilaCompra = Omit<CompraVista, 'lineas' | 'retenciones'>

async function completar(cliente: QueryClientContract, filas: FilaCompra[]): Promise<CompraVista[]> {
    if (filas.length === 0) return []
    const ids = filas.map((f) => Number(f.id))
    const lineas = (await cliente
        .from('ledger.compras_lineas as l')
        .join('ledger.cuentas as cu', 'cu.id', 'l.cuenta_id')
        .whereIn('l.compra_id', ids)
        .orderBy('l.id')
        .select(
            'l.id',
            'l.compra_id',
            'l.descripcion',
            'l.tipo',
            'l.cuenta_id',
            'cu.codigo as cuenta_codigo',
            'l.exento',
            'l.base',
            'l.iva',
            'l.clase_activo',
            'l.diferir_meses',
            'l.cantidad',
            'l.producto_id',
            'l.bodega_id',
        )) as Array<CompraVista['lineas'][number] & { compra_id: number }>
    const retenciones = (await cliente
        .from('ledger.compras_retenciones')
        .whereIn('compra_id', ids)
        .orderBy('id')
        .select('compra_id', 'impuesto_codigo', 'impuesto', 'base', 'tasa', 'monto')) as Array<
        CompraVista['retenciones'][number] & { compra_id: number }
    >
    const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))
    return filas.map((f) => ({
        ...f,
        id: Number(f.id),
        empresa_id: Number(f.empresa_id),
        proveedor_id: Number(f.proveedor_id),
        compra_referencia_id: n(f.compra_referencia_id),
        egreso_id: n(f.egreso_id),
        egreso_pago_id: n(f.egreso_pago_id),
        asiento_id: n(f.asiento_id),
        asiento_reverso_id: n(f.asiento_reverso_id),
        lineas: lineas
            .filter((l) => Number(l.compra_id) === Number(f.id))
            .map(({ compra_id: _c, ...l }) => ({
                ...l,
                id: Number(l.id),
                cuenta_id: Number(l.cuenta_id),
                diferir_meses: n(l.diferir_meses),
                producto_id: n(l.producto_id),
                bodega_id: n(l.bodega_id),
            })),
        retenciones: retenciones
            .filter((r) => Number(r.compra_id) === Number(f.id))
            .map(({ compra_id: _c, ...r }) => r),
    }))
}

export async function verCompra(id: number, cliente: QueryClientContract = db.connection()) {
    const fila = (await consultaCompras(cliente).where('c.id', id).first()) as FilaCompra | null
    if (!fila) throw new NoEncontrado(`La compra ${id} no existe`)
    const [vista] = await completar(cliente, [fila])
    return vista!
}

export interface FiltrosCompras extends OpcionesPaginacion {
    proveedor_id?: number
    periodo_iva?: string
    desde?: string
    hasta?: string
    tipo_documento?: TipoDocumentoCompra
    estado?: EstadoCompra
    condicion?: CondicionCompra
    pendientes?: boolean
}

export async function listarCompras(filtros: FiltrosCompras, empresas: number[] | null) {
    const consulta = consultaCompras(db.connection())
        .if(filtros.proveedor_id, (q) => q.where('c.proveedor_id', filtros.proveedor_id!))
        .if(filtros.periodo_iva, (q) => q.where('c.periodo_iva', `${filtros.periodo_iva!.slice(0, 7)}-01`))
        .if(filtros.desde, (q) => q.where('c.fecha_documento', '>=', filtros.desde!))
        .if(filtros.hasta, (q) => q.where('c.fecha_documento', '<=', filtros.hasta!))
        .if(filtros.tipo_documento, (q) => q.where('c.tipo_documento', filtros.tipo_documento!))
        .if(filtros.condicion, (q) => q.where('c.condicion', filtros.condicion!))
        .if(filtros.estado === 'anulada', (q) => q.whereNotNull('an.id'))
        .if(filtros.estado === 'vigente', (q) => q.whereNull('an.id'))
        .if(filtros.pendientes, (q) => q.whereRaw(`${sqlSaldoCompra('c')} > 0`))
    filtrarPorEmpresa(consulta, empresas, (q, ids) => q.whereIn('c.empresa_id', ids))
    const pagina = await paginar<FilaCompra>(consulta, filtros, { columna: 'c.id' })
    return { data: await completar(db.connection(), pagina.data), nextCursor: pagina.nextCursor }
}

export async function empresaDeCompra(id: number): Promise<{ empresa_id: number }> {
    const fila = await db.from('ledger.compras').where('id', id).select('empresa_id').first()
    if (!fila) throw new NoEncontrado(`La compra ${id} no existe`)
    return { empresa_id: Number(fila.empresa_id) }
}

/** Saldo pendiente de una compra (crédito vigente), con la misma regla que la vista. */
export async function saldoCompra(cliente: QueryClientContract, compraId: number): Promise<Dec> {
    const fila = (await cliente
        .from('ledger.compras as c')
        .where('c.id', compraId)
        .select(cliente.raw(`(${sqlSaldoCompra('c')})::numeric(14,2)::text as saldo`))
        .first()) as { saldo: string } | null
    return fila ? dec(fila.saldo) : CERO
}
