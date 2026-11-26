import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { CERO, aTexto, dec, redondear, type Dec } from '#ledger/dinero'
import { valorParametro } from '#fiscal/parametros'
import { impuesto as impuestoVigente } from '#fiscal/impuestos'
import { hoyGuatemala } from '#ledger/fechas'
import { lineaConIva } from '#billing/facturas'
import { sinIvaPorRegimen } from '#billing/regimen'

/**
 * Perfil fiscal del cliente (lote B4 del plan de contabilidad; decisión del PM del 26 nov 2026).
 *
 * - **Tipo de impuesto** (`tipo_impuesto`): `normal` (se le cobra IVA: casi todos),
 *   `agente_retenedor_iva` (paga menos y entrega constancia por la retención de IVA) o `exento`
 *   (por ley no paga IVA; pide su resolución). Además, la casilla aparte **«me retiene ISR»**
 *   (`retiene_isr`).
 * - Es del **cliente**, no de una empresa (el cliente no tiene empresa: `contratos/multiempresa.md`).
 *   Lo que cambia por empresa es lo que se espera retener: depende del régimen de la empresa que
 *   factura, en la fecha de la factura.
 * - Un cliente sin fila en `billing.perfiles_fiscales_cliente` es Normal, sin ISR (versión 0).
 * - **Exento apagado** (decisión del PM 4): se puede guardar, pero la factura sale como Normal
 *   (con IVA) mientras la empresa no tenga la frase de exención del contador para la FEL
 *   (`localizacion-fiscal.md` §15 #94). `exencionDisponible` es la única llave; hoy siempre dice
 *   `exencion_sin_frase`. La instantánea de la factura lo deja escrito (`exento_aplicado: false`).
 *
 * **Retenciones esperadas** (lo que B10 usa para conciliar y lo que el cobro muestra). Confirmar
 * con contador (§15):
 *
 * - IVA: cliente agente retenedor, empresa que no es pequeño contribuyente (plan §5.8: «con
 *   empresa pequeño contribuyente no hay retención de IVA»), factura con IVA y total desde
 *   `ret_iva_minimo` (el mismo mínimo con el que la empresa retiene a sus proveedores) →
 *   `RET_IVA_ESP` (15 %) del IVA de la factura.
 * - ISR: cliente que retiene ISR y empresa en el régimen opcional simplificado (la frase de su
 *   factura dice «sujeto a retención definitiva») → `RET_ISR_OPC` sobre lo facturado sin IVA con
 *   los tramos `isr_opcional_tramos` (5 % hasta Q30,000; Q1,500 + 7 % del excedente). En el régimen
 *   sobre utilidades (pagos trimestrales) o pequeño contribuyente no se espera retención de ISR.
 * - `a_recibir = total − retenciones`: lo que debe llegar en dinero.
 */

export const TIPOS_IMPUESTO = ['normal', 'agente_retenedor_iva', 'exento'] as const
export type TipoImpuesto = (typeof TIPOS_IMPUESTO)[number]

/** Campos del perfil que viajan en `cliente.actualizado` (solo nombres). */
export { CAMPOS_CLIENTE_FISCAL as CAMPOS_PERFIL_FISCAL } from '#shared/eventos'

export interface ResolucionExencion {
    numero: string
    fecha: string
}

export interface PerfilFiscal {
    cliente_id: number
    tipo_impuesto: TipoImpuesto
    retiene_isr: boolean
    /** resolución de la SAT que respalda la exención (obligatoria con `exento`) */
    resolucion_exencion: ResolucionExencion | null
    nota: string | null
    /** 0 = nunca se guardó (Normal por defecto) */
    version: number
    actualizado_por: number | null
    actualizado_en: string | null
}

interface FilaPerfil {
    cliente_id: number | string
    tipo_impuesto: TipoImpuesto
    retiene_isr: boolean
    resolucion_exencion: ResolucionExencion | null
    nota: string | null
    version: number
    actualizado_por: number | string | null
    updated_at: Date | string
}

export function perfilPorDefecto(clienteId: number): PerfilFiscal {
    return {
        cliente_id: clienteId,
        tipo_impuesto: 'normal',
        retiene_isr: false,
        resolucion_exencion: null,
        nota: null,
        version: 0,
        actualizado_por: null,
        actualizado_en: null,
    }
}

function aVista(fila: FilaPerfil): PerfilFiscal {
    return {
        cliente_id: Number(fila.cliente_id),
        tipo_impuesto: fila.tipo_impuesto,
        retiene_isr: Boolean(fila.retiene_isr),
        resolucion_exencion: fila.resolucion_exencion ?? null,
        nota: fila.nota ?? null,
        version: Number(fila.version),
        actualizado_por: fila.actualizado_por === null ? null : Number(fila.actualizado_por),
        actualizado_en: new Date(fila.updated_at).toISOString(),
    }
}

/** Perfil fiscal del cliente (Normal sin ISR si nunca se guardó). */
export async function perfilFiscalDe(
    clienteId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<PerfilFiscal> {
    const fila = (await cliente
        .from('billing.perfiles_fiscales_cliente')
        .where('cliente_id', clienteId)
        .first()) as FilaPerfil | null
    return fila ? aVista(fila) : perfilPorDefecto(clienteId)
}

/** Perfiles de varios clientes (los que no tienen fila, Normal). */
export async function perfilesFiscalesDe(
    clienteIds: number[],
    cliente: QueryClientContract = db.connection(),
): Promise<Map<number, PerfilFiscal>> {
    const ids = [...new Set(clienteIds)]
    const filas = ids.length
        ? ((await cliente
              .from('billing.perfiles_fiscales_cliente')
              .whereIn('cliente_id', ids)) as FilaPerfil[])
        : []
    const mapa = new Map(ids.map((id) => [id, perfilPorDefecto(id)]))
    for (const fila of filas) mapa.set(Number(fila.cliente_id), aVista(fila))
    return mapa
}

/*
|--------------------------------------------------------------------------
| Exención (apagada)
|--------------------------------------------------------------------------
*/

export type MotivoExencion = 'exencion_sin_frase'

/**
 * Si la empresa puede facturar sin IVA a un cliente exento. **Apagado** (decisión del PM 4): la
 * frase de exención del DTE (y el ítem exento del XML) está pendiente del contador
 * (`localizacion-fiscal.md` §15 #94). Cuando exista, esta es la única función que cambia.
 */
export async function exencionDisponible(
    _empresaId: number | null,
    _fecha: string,
    _cliente?: QueryClientContract,
): Promise<{ disponible: false; motivo: MotivoExencion }> {
    return { disponible: false, motivo: 'exencion_sin_frase' }
}

/** Perfil con el estado de la exención (respuesta de la API). */
export interface PerfilFiscalVista extends PerfilFiscal {
    exencion: { disponible: boolean; motivo: MotivoExencion | null }
}

/** Perfil del cliente para la API, con si la exención se aplica hoy en la empresa (o en general). */
export async function vistaPerfilFiscal(
    clienteId: number,
    empresaId: number | null,
    cliente: QueryClientContract = db.connection(),
): Promise<PerfilFiscalVista> {
    const perfil = await perfilFiscalDe(clienteId, cliente)
    const exencion = await exencionDisponible(empresaId, hoyGuatemala(), cliente)
    return { ...perfil, exencion: { disponible: exencion.disponible, motivo: exencion.motivo } }
}

/*
|--------------------------------------------------------------------------
| Retenciones esperadas
|--------------------------------------------------------------------------
*/

export type MotivoSinRetencion =
    | 'cliente_no_retiene'
    | 'regimen_pequeno_contribuyente'
    | 'regimen_utilidades'
    | 'sin_iva'
    | 'bajo_minimo'
    | 'sin_localizacion'

export interface RetencionEsperada {
    impuesto: 'iva' | 'isr'
    /** impuesto de retención recibida del catálogo fiscal (`RET_IVA_ESP`, `RET_ISR_OPC`) */
    codigo: string
    /** IVA de la factura (IVA) o lo facturado sin IVA (ISR) */
    base: string
    /** porcentaje aplicado (en ISR, el del tramo) */
    tasa: string
    monto: string
}

export interface RetencionNoEsperada {
    impuesto: 'iva' | 'isr'
    motivo: MotivoSinRetencion
}

/** Instantánea del perfil en la factura (`billing.facturas.perfil_fiscal`). */
export interface PerfilFiscalFactura {
    tipo_impuesto: TipoImpuesto
    retiene_isr: boolean
    /** la factura salió sin IVA por la exención (hoy siempre false: exención apagada) */
    exento_aplicado: boolean
    motivo_exento: MotivoExencion | null
    /** régimen de la empresa en la fecha de la factura (null sin localización) */
    regimen: string | null
    retenciones: RetencionEsperada[]
    sin_retencion: RetencionNoEsperada[]
    total_retenciones: string
    /** total − retenciones: lo que debe llegar en dinero */
    a_recibir: string
}

export interface DocumentoRetenible {
    empresa_id: number
    /** fecha del documento (YYYY-MM-DD) */
    fecha: string
    total: string | Dec
    iva: string | Dec
}

interface Tramo {
    desde: string
    hasta: string | null
    fijo: string
    porcentaje: string
    sobre_excedente_de: string
}

async function regimenEn(
    empresaId: number,
    fecha: string,
    cliente: QueryClientContract,
): Promise<string | null> {
    try {
        return await valorParametro<string>(empresaId, 'regimen', fecha, cliente)
    } catch {
        return null
    }
}

async function retencionIva(
    perfil: Pick<PerfilFiscal, 'tipo_impuesto'>,
    doc: DocumentoRetenible,
    regimen: string | null,
    cliente: QueryClientContract,
): Promise<RetencionEsperada | RetencionNoEsperada> {
    const sin = (motivo: MotivoSinRetencion): RetencionNoEsperada => ({ impuesto: 'iva', motivo })
    if (perfil.tipo_impuesto !== 'agente_retenedor_iva') return sin('cliente_no_retiene')
    if (regimen === null) return sin('sin_localizacion')
    if (regimen === 'pequeno_contribuyente') return sin('regimen_pequeno_contribuyente')
    const iva = dec(doc.iva)
    if (!iva.gt(0)) return sin('sin_iva')
    try {
        const minimo = await valorParametro<string>(doc.empresa_id, 'ret_iva_minimo', doc.fecha, cliente)
        if (dec(doc.total).lt(dec(minimo))) return sin('bajo_minimo')
        const vigente = await impuestoVigente(doc.empresa_id, 'RET_IVA_ESP', doc.fecha, cliente)
        const tasa = dec(vigente.tasa).abs()
        return {
            impuesto: 'iva',
            codigo: 'RET_IVA_ESP',
            base: aTexto(iva),
            tasa: tasa.toFixed(2),
            monto: aTexto(iva.times(tasa).dividedBy(100)),
        }
    } catch {
        return sin('sin_localizacion')
    }
}

async function retencionIsr(
    perfil: Pick<PerfilFiscal, 'retiene_isr'>,
    doc: DocumentoRetenible,
    regimen: string | null,
    cliente: QueryClientContract,
): Promise<RetencionEsperada | RetencionNoEsperada> {
    const sin = (motivo: MotivoSinRetencion): RetencionNoEsperada => ({ impuesto: 'isr', motivo })
    if (!perfil.retiene_isr) return sin('cliente_no_retiene')
    if (regimen === null) return sin('sin_localizacion')
    if (regimen === 'pequeno_contribuyente') return sin('regimen_pequeno_contribuyente')
    if (regimen !== 'opcional_simplificado') return sin('regimen_utilidades')
    const base = dec(doc.total).minus(dec(doc.iva))
    try {
        const { tramos } = await valorParametro<{ tramos: Tramo[] }>(
            doc.empresa_id,
            'isr_opcional_tramos',
            doc.fecha,
            cliente,
        )
        const tramo =
            tramos.find((t) => base.gte(dec(t.desde)) && (t.hasta === null || base.lte(dec(t.hasta)))) ??
            tramos[0]!
        const monto = dec(tramo.fijo).plus(
            base.minus(dec(tramo.sobre_excedente_de)).times(dec(tramo.porcentaje)).dividedBy(100),
        )
        return {
            impuesto: 'isr',
            codigo: 'RET_ISR_OPC',
            base: aTexto(base),
            tasa: dec(tramo.porcentaje).toFixed(2),
            monto: aTexto(monto),
        }
    } catch {
        return sin('sin_localizacion')
    }
}

/**
 * Instantánea del perfil para un documento de la empresa: si la exención se aplicó y qué
 * retenciones se esperan. El redondeo es al final de cada retención.
 */
export async function perfilParaDocumento(
    perfil: Pick<PerfilFiscal, 'tipo_impuesto' | 'retiene_isr'>,
    doc: DocumentoRetenible,
    cliente: QueryClientContract = db.connection(),
): Promise<PerfilFiscalFactura> {
    const regimen = await regimenEn(doc.empresa_id, doc.fecha, cliente)
    const exencion =
        perfil.tipo_impuesto === 'exento'
            ? await exencionDisponible(doc.empresa_id, doc.fecha, cliente)
            : null
    const resultados = [
        await retencionIva(perfil, doc, regimen, cliente),
        await retencionIsr(perfil, doc, regimen, cliente),
    ]
    const retenciones = resultados.filter((r): r is RetencionEsperada => 'monto' in r)
    const sinRetencion = resultados.filter((r): r is RetencionNoEsperada => 'motivo' in r)
    const total = retenciones.reduce((s, r) => s.plus(r.monto), CERO)
    return {
        tipo_impuesto: perfil.tipo_impuesto,
        retiene_isr: perfil.retiene_isr,
        exento_aplicado: exencion?.disponible ?? false,
        motivo_exento: exencion && !exencion.disponible ? exencion.motivo : null,
        regimen,
        retenciones,
        sin_retencion: sinRetencion,
        total_retenciones: aTexto(total),
        a_recibir: aTexto(redondear(doc.total).minus(total)),
    }
}

/** Retención esperada de una factura pendiente (para el estado de cuenta y la conciliación, B10). */
export interface RetencionFacturaPendiente {
    factura_id: number
    empresa_id: number
    total: string
    pendiente: string
    /** de la instantánea de la factura (`factura`) o calculada con el perfil de hoy (`perfil_actual`, facturas anteriores a B4) */
    fuente: 'factura' | 'perfil_actual'
    retencion_iva: string
    retencion_isr: string
    total_retenciones: string
    /** pendiente − retenciones (nunca negativo): lo que se espera recibir en dinero */
    a_recibir: string
}

export async function retencionesDeFacturas(
    facturas: Array<{
        id: number
        empresa_id: number
        cliente_id: number
        emitida_en: Date | string
        total: string
        iva: string
        pagado: string
        perfil_fiscal?: PerfilFiscalFactura | null
    }>,
    cliente: QueryClientContract = db.connection(),
): Promise<RetencionFacturaPendiente[]> {
    const perfiles = await perfilesFiscalesDe(
        facturas.filter((f) => !f.perfil_fiscal).map((f) => Number(f.cliente_id)),
        cliente,
    )
    const salida: RetencionFacturaPendiente[] = []
    for (const f of facturas) {
        const snapshot =
            f.perfil_fiscal ??
            (await perfilParaDocumento(
                perfiles.get(Number(f.cliente_id))!,
                {
                    empresa_id: Number(f.empresa_id),
                    fecha: hoyGuatemala(new Date(f.emitida_en)),
                    total: f.total,
                    iva: f.iva,
                },
                cliente,
            ))
        const monto = (impuesto: 'iva' | 'isr') =>
            snapshot.retenciones.find((r) => r.impuesto === impuesto)?.monto ?? '0.00'
        const pendiente = dec(f.total).minus(dec(f.pagado))
        const retenido = dec(snapshot.total_retenciones)
        const aRecibir = pendiente.minus(retenido)
        salida.push({
            factura_id: Number(f.id),
            empresa_id: Number(f.empresa_id),
            total: aTexto(f.total),
            pendiente: aTexto(pendiente),
            fuente: f.perfil_fiscal ? 'factura' : 'perfil_actual',
            retencion_iva: monto('iva'),
            retencion_isr: monto('isr'),
            total_retenciones: aTexto(retenido),
            a_recibir: aTexto(aRecibir.isNegative() ? CERO : aRecibir),
        })
    }
    return salida
}

/**
 * Lo que se espera retener de una factura de `total` (IVA incluido) que la empresa le haría hoy al
 * cliente: la cuenta de «Nueva factura» y de Cobrar («Te retendrá… Recibirás…») antes de emitir.
 * En pequeño contribuyente la factura no separa IVA.
 */
export async function simularRetenciones(
    clienteId: number,
    empresaId: number,
    total: string,
    cliente: QueryClientContract = db.connection(),
): Promise<PerfilFiscalFactura> {
    const hoy = hoyGuatemala()
    const gravable = !(await sinIvaPorRegimen(cliente, empresaId, hoy))
    const linea = lineaConIva({ concepto: 'simulación', tipo: 'otro', cantidad: '1', gravable, total })
    return perfilParaDocumento(
        await perfilFiscalDe(clienteId, cliente),
        { empresa_id: empresaId, fecha: hoy, total: linea.total, iva: linea.iva },
        cliente,
    )
}
