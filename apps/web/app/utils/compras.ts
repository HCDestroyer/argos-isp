import type { Problem, Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import * as z from 'zod'

/**
 * Textos y esquemas de la fase 5 (A3, contrato fiscal §19): proveedores, compras, pagos a proveedores,
 * constancias, activos fijos y diferimientos. Los esquemas son espejo de los validadores de la API.
 */

type Compra = Schema<'Compra'>
type Linea = Schema<'LineaCompra'>
type Proveedor = Schema<'Proveedor'>
type Activo = Schema<'ActivoFijo'>
type BadgeColor = 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral'

export type TipoDocumentoCompra = Compra['tipo_documento']
export type TipoLineaCompra = Linea['tipo']
export type TipoProveedor = Proveedor['tipo']
export type ClaseActivo = 'equipo_red' | 'computacion' | 'mobiliario' | 'vehiculos' | 'herramientas' | 'edificios' | 'otros'
export type MetodoPagoCompra = Schema<'PagoProveedor'>['metodo']

const MONTO = /^\d{1,12}(\.\d{1,2})?$/
const FECHA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const TASA = /^\d{1,3}(\.\d{1,2})?$/

export const TIPOS_DOCUMENTO_COMPRA: Record<TipoDocumentoCompra, string> = {
    FACT: 'Factura',
    FCAM: 'Factura cambiaria',
    FPEQ: 'Factura de pequeño contribuyente',
    FCAP: 'Factura cambiaria de pequeño contribuyente',
    NCRE: 'Nota de crédito del proveedor',
    NDEB: 'Nota de débito del proveedor',
    FESP: 'Factura especial',
    DUA: 'Declaración aduanera (DUA)',
    RECIBO: 'Recibo (sin crédito fiscal)',
}

export const TIPOS_LINEA_COMPRA: Record<TipoLineaCompra, string> = {
    servicio: 'Servicio',
    bien: 'Bien',
    activo_fijo: 'Activo fijo',
    combustible: 'Combustible',
    importacion: 'Importación',
}

export const TIPOS_PROVEEDOR: Record<TipoProveedor, string> = {
    general: 'General',
    pequeno_contribuyente: 'Pequeño contribuyente',
    no_residente: 'No residente',
    sin_documento: 'Sin documento (factura especial)',
}

export const DOCUMENTOS_PROVEEDOR: Record<Proveedor['tipo_documento'], string> = {
    nit: 'NIT',
    cui: 'CUI',
    id_extranjero: 'Identificación extranjera',
}

export const CLASES_ACTIVO: Record<ClaseActivo, string> = {
    equipo_red: 'Equipo de red',
    computacion: 'Equipo de cómputo',
    mobiliario: 'Mobiliario',
    vehiculos: 'Vehículos',
    herramientas: 'Herramientas',
    edificios: 'Edificios',
    otros: 'Otros',
}

export function etiquetaClaseActivo(clase: string | null | undefined): string {
    return clase && clase in CLASES_ACTIVO ? CLASES_ACTIVO[clase as ClaseActivo] : (clase ?? '—')
}

export const ESTADOS_COMPRA: Record<Compra['estado'], { etiqueta: string, color: BadgeColor, icono: string }> = {
    vigente: { etiqueta: 'Vigente', color: 'success', icono: 'i-lucide-circle-check' },
    anulada: { etiqueta: 'Anulada', color: 'neutral', icono: 'i-lucide-ban' },
}

export const ESTADOS_ACTIVO: Record<Activo['estado'], { etiqueta: string, color: BadgeColor, icono: string }> = {
    vigente: { etiqueta: 'Vigente', color: 'success', icono: 'i-lucide-circle-check' },
    dado_de_baja: { etiqueta: 'Dado de baja', color: 'neutral', icono: 'i-lucide-archive' },
}

export const TIPOS_BAJA: Record<NonNullable<Activo['baja']>['tipo'], string> = {
    venta: 'Venta',
    retiro: 'Retiro',
    anulacion: 'Anulación de la compra',
}

export const ESTADOS_DIFERIMIENTO: Record<Schema<'Diferimiento'>['estado'], { etiqueta: string, color: BadgeColor }> = {
    vigente: { etiqueta: 'Vigente', color: 'info' },
    amortizado: { etiqueta: 'Amortizado', color: 'success' },
    cancelado: { etiqueta: 'Cancelado', color: 'neutral' },
}

export const METODOS_PAGO_COMPRA: Record<MetodoPagoCompra, string> = {
    caja: 'Efectivo de caja',
    banco: 'Banco del libro',
    cuenta_bancaria: 'Cuenta bancaria propia',
}

export const CONTRAPARTIDAS_ACTIVO: Record<'2.9.01' | '3.1.01' | '3.3.01', string> = {
    '2.9.01': 'Saldos de apertura (inventario inicial)',
    '3.1.01': 'Aporte de capital social',
    '3.3.01': 'Utilidades acumuladas',
}

/** Retenciones emitidas que el panel ofrece (las demás las sugiere la API sin el campo). */
export const RETENCIONES_EMITIDAS: Record<string, string> = {
    RET_ISR_OPC_C: 'ISR del régimen opcional (5 %)',
    RET_IVA_ESP_C: 'IVA de factura especial',
    RET_IVA_PEQ_C: 'IVA a pequeño contribuyente',
}

/** `FACT A-1234`. */
export function documentoCompra(c: Pick<Compra, 'tipo_documento' | 'serie' | 'numero'>): string {
    return `${c.tipo_documento} ${c.serie ? `${c.serie}-` : ''}${c.numero}`
}

/** Base gravada + exento de la compra (sin IVA). */
export function baseCompra(c: Pick<Compra, 'base_bienes' | 'base_servicios' | 'base_importaciones' | 'exento'>): string {
    return new Decimal(c.base_bienes).plus(c.base_servicios).plus(c.base_importaciones).plus(c.exento).toFixed(2)
}

/** Por qué una compra no se puede anular desde la pantalla (lo dice antes de pedir el motivo). */
export function compraAnulable(c: Pick<Compra, 'estado'>): boolean {
    return c.estado === 'vigente'
}

/** Días de vencida de una compra al crédito con saldo (0 si no ha vencido). */
export function diasVencida(c: Pick<Compra, 'vence_en' | 'saldo' | 'estado'>, hoy: string): number {
    if (c.estado !== 'vigente' || !c.vence_en || new Decimal(c.saldo).lte(0)) {
        return 0
    }
    return Math.max(0, Math.round((Date.parse(`${hoy}T00:00:00Z`) - Date.parse(`${c.vence_en}T00:00:00Z`)) / 86_400_000))
}

const TITULOS: Record<string, string> = {
    proveedor_duplicado: 'Ese proveedor ya existe',
    compra_duplicada: 'Esa compra ya está registrada',
    compra_anulada: 'La compra ya está anulada',
    compra_con_notas: 'La compra tiene notas de crédito',
    compra_con_pagos: 'La compra tiene pagos',
    compra_con_constancia: 'La compra ya tiene su constancia de retención',
    activo_con_cuotas: 'Su activo ya se deprecia',
    diferido_con_cuotas: 'Su diferimiento ya tiene cuotas',
    ncre_excede_saldo: 'La nota de crédito pasa del saldo',
    credito_fiscal_extemporaneo: 'El crédito fiscal está fuera de plazo',
    compra_distinta_del_egreso: 'La compra no cuadra con el egreso',
    egreso_con_compra: 'El egreso ya tiene su compra',
    egreso_de_compra: 'El egreso ya es de una compra',
    egreso_anulado: 'El egreso está anulado',
    pago_excede_saldo: 'El pago pasa de lo que se le debe',
    pago_anterior_a_compra: 'El pago es anterior a la compra',
    pago_anulado: 'El pago ya está anulado',
    cuenta_de_otra_empresa: 'La cuenta es de otra empresa',
    constancia_registrada: 'La retención ya tiene constancia',
    constancia_duplicada: 'Ese número de constancia ya se usó',
    tasa_sobre_tope: 'La tasa pasa del máximo legal',
    activo_dado_de_baja: 'El activo ya está dado de baja',
    mes_terminado: 'Solo meses terminados',
    linea_diferida: 'Esa línea ya se difiere',
    version_conflicto: 'Alguien más cambió el proveedor',
}

const QUE_HACER: Record<string, string> = {
    compra_con_notas: 'Anula primero las NCRE del proveedor que la corrigen.',
    compra_con_pagos: 'Anula primero los pagos aplicados a esta compra (Pagos a proveedores).',
    compra_con_constancia: 'Con la constancia emitida la compra ya no se anula: corrígela con una NCRE del proveedor.',
    activo_con_cuotas: 'Da de baja el activo en vez de anular la compra.',
    credito_fiscal_extemporaneo: 'Registra la compra sin crédito fiscal (el IVA va al costo).',
    version_conflicto: 'Vuelve a cargar la ficha y repite el cambio.',
}

/** Problema con título legible y qué hacer (el `detail` de la API se conserva). */
export function problemaCompraLegible(problema: Problem): Problem {
    const codigo = codigoProblema(problema) ?? problema.errors?.find(e => e.rule && e.rule in TITULOS)?.rule ?? null
    const titulo = codigo ? TITULOS[codigo] : undefined
    if (!titulo) {
        return problemaFiscalLegible(problema)
    }
    const sugerencia = codigo ? QUE_HACER[codigo] : undefined
    const detalle = sugerencia ? `${problema.detail ?? ''} ${sugerencia}`.trim() : problema.detail
    return { ...problema, title: titulo, ...(detalle ? { detail: detalle } : {}) }
}

/* ---------- Esquemas ---------- */

const montoPositivo = (mensaje = 'Monto mayor que 0 con hasta 2 decimales, sin comas (ej. 150.00)') => z.string().trim()
    .regex(MONTO, mensaje)
    .refine(v => !MONTO.test(v) || new Decimal(v).gt(0), 'Debe ser mayor que cero')
const montoOpcional = z.string().trim().refine(v => v === '' || MONTO.test(v), 'Monto con hasta 2 decimales')
const fechaOpcional = (hoy: string, futura = 'La fecha no puede ser futura') => z.string().trim()
    .refine(v => v === '' || FECHA.test(v), 'Elige una fecha válida (día, mes y año)')
    .refine(v => v === '' || v <= hoy, futura)
const texto = (max: number) => z.string().trim().max(max, `Máximo ${max} caracteres`)

/** Espejo de `crearProveedorValidator` / `editarProveedorValidator` (el documento solo al crear). */
export function esquemaProveedor(edicion: boolean) {
    return z.object({
        tipo_documento: z.enum(['nit', 'cui', 'id_extranjero']),
        nit: edicion ? z.string() : z.string().trim().min(1, 'Escribe el documento').max(30, 'Máximo 30 caracteres'),
        nombre: z.string().trim().min(2, 'Mínimo 2 caracteres').max(150, 'Máximo 150 caracteres'),
        tipo: z.enum(['general', 'pequeno_contribuyente', 'no_residente', 'sin_documento']),
        regimen_isr: z.enum(['ninguno', 'utilidades', 'opcional_simplificado', 'pequeno_contribuyente']),
        agente_retencion_iva: z.boolean(),
        direccion: texto(300),
        correo: texto(150).refine(v => v === '' || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), 'Escribe un correo válido, como nombre@dominio.com'),
        telefono: texto(40),
        dias_credito: z.number({ message: 'Días de 0 a 365' }).int('Días enteros').min(0, 'Días de 0 a 365').max(365, 'Días de 0 a 365'),
    })
}
export type EntradaProveedor = z.input<ReturnType<typeof esquemaProveedor>>

export function proveedorVacio(p?: Proveedor): EntradaProveedor {
    return {
        tipo_documento: p?.tipo_documento ?? 'nit',
        nit: p?.nit ?? '',
        nombre: p?.nombre ?? '',
        tipo: p?.tipo ?? 'general',
        regimen_isr: p?.regimen_isr ?? 'ninguno',
        agente_retencion_iva: p?.agente_retencion_iva ?? false,
        direccion: p?.direccion ?? '',
        correo: p?.correo ?? '',
        telefono: p?.telefono ?? '',
        dias_credito: p?.dias_credito ?? 0,
    }
}

const nulo = (v: string) => (v.trim() === '' ? null : v.trim())

export function cuerpoProveedorCompra(e: EntradaProveedor): CuerpoProveedor {
    return {
        tipo_documento: e.tipo_documento,
        nit: e.nit.trim(),
        nombre: e.nombre.trim(),
        tipo: e.tipo,
        regimen_isr: e.regimen_isr === 'ninguno' ? null : e.regimen_isr,
        agente_retencion_iva: e.agente_retencion_iva,
        direccion: nulo(e.direccion),
        correo: nulo(e.correo),
        telefono: nulo(e.telefono),
        dias_credito: e.dias_credito,
    }
}

/** Solo lo que cambió, con la `version` leída (el documento y el país no se editan). */
export function cuerpoEditarProveedor(e: EntradaProveedor, p: Proveedor): CuerpoEditarProveedor {
    const nuevo = cuerpoProveedorCompra(e)
    const cuerpo: CuerpoEditarProveedor = { version: p.version }
    for (const campo of ['nombre', 'tipo', 'regimen_isr', 'agente_retencion_iva', 'direccion', 'correo', 'telefono', 'dias_credito'] as const) {
        if (nuevo[campo] !== p[campo]) {
            Object.assign(cuerpo, { [campo]: nuevo[campo] })
        }
    }
    return cuerpo
}

/** Línea del formulario de compra. */
export interface LineaFormulario {
    descripcion: string
    tipo: TipoLineaCompra
    cuenta: string
    total: string
    exento: boolean
    diferir: boolean
    diferir_meses: number | null
    clase_activo: ClaseActivo | null
    activo_tasa_anual: string
    /** Inventario (A3): una línea `bien` con producto entra al kardex en su bodega. */
    producto_id: number | null
    bodega_id: number | null
    cantidad: number | null
    /** Seguimiento del producto elegido (`serie` pide las series o MAC). */
    seguimiento: 'cantidad' | 'serie' | null
    /** Series o MAC pegadas o escaneadas, una por línea (compra de equipos por serie). */
    series: string
    /** Equipos que se devuelven al proveedor (NCRE de equipos por serie). */
    unidad_ids: number[]
}

export function lineaVacia(): LineaFormulario {
    return { descripcion: '', tipo: 'servicio', cuenta: '', total: '', exento: false, diferir: false, diferir_meses: null, clase_activo: null, activo_tasa_anual: '', producto_id: null, bodega_id: null, cantidad: null, seguimiento: null, series: '', unidad_ids: [] }
}

export interface RetencionFormulario {
    codigo: string
    monto: string
}

/** Espejo de `registrarCompraValidator` (y de la compra desde un egreso, sin condición ni medio de pago). */
export function esquemaCompra(hoy: string, desdeEgreso: boolean) {
    return z.object({
        proveedor_id: z.number().int().nullable().refine(v => v !== null && v > 0, 'Elige el proveedor'),
        tipo_documento: z.enum(['FACT', 'FCAM', 'FPEQ', 'FCAP', 'NCRE', 'NDEB', 'FESP', 'DUA', 'RECIBO']),
        serie: texto(30),
        numero: z.string().trim().min(1, 'Escribe el número del documento').max(40, 'Máximo 40 caracteres'),
        autorizacion: z.string().trim().refine(v => v === '' || /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/.test(v), 'UUID de autorización del DTE (8-4-4-4-12)'),
        fecha_documento: z.string().trim().regex(FECHA, 'Elige la fecha del documento').refine(v => !FECHA.test(v) || v <= hoy, 'La fecha del documento no puede ser futura'),
        periodo_iva: z.string().trim().refine(v => v === '' || /^\d{4}-(0[1-9]|1[0-2])$/.test(v), 'Mes del IVA (AAAA-MM)'),
        credito_fiscal: z.boolean(),
        compra_referencia_id: z.number().int().positive().nullable(),
        descripcion: texto(500),
        condicion: z.enum(['contado', 'credito']),
        vence_en: fechaOpcional('9999-12-31'),
        metodo: z.enum(['caja', 'banco', 'cuenta_bancaria']),
        caja_id: z.number().int().positive().nullable(),
        banco_id: z.number().int().positive().nullable(),
        cuenta_bancaria_id: z.number().int().positive().nullable(),
        retenciones_modo: z.enum(['sugeridas', 'ninguna', 'manual']),
        retenciones: z.array(z.object({
            codigo: z.string().min(3, 'Elige la retención'),
            monto: montoOpcional,
        })),
        lineas: z.array(z.object({
            descripcion: z.string().trim().min(1, 'Describe la línea').max(300, 'Máximo 300 caracteres'),
            tipo: z.enum(['bien', 'servicio', 'activo_fijo', 'combustible', 'importacion']),
            cuenta: texto(30),
            total: montoPositivo('Total con IVA, hasta 2 decimales'),
            exento: z.boolean(),
            diferir: z.boolean(),
            diferir_meses: z.number().int().min(2, 'De 2 a 120 meses').max(120, 'De 2 a 120 meses').nullable(),
            clase_activo: z.enum(['equipo_red', 'computacion', 'mobiliario', 'vehiculos', 'herramientas', 'edificios', 'otros']).nullable(),
            activo_tasa_anual: z.string().trim().refine(v => v === '' || TASA.test(v), 'Por ciento con hasta 2 decimales'),
            producto_id: z.number().int().positive().nullable(),
            bodega_id: z.number().int().positive().nullable(),
            cantidad: z.number().int('Solo enteros').min(1, 'Al menos 1').max(100000).nullable(),
            seguimiento: z.enum(['cantidad', 'serie']).nullable(),
            series: z.string(),
            unidad_ids: z.array(z.number().int().positive()),
        })).min(1, 'Agrega al menos una línea'),
    }).superRefine((d, ctx) => {
        if (d.tipo_documento === 'NCRE' && d.compra_referencia_id === null) {
            ctx.addIssue({ code: 'custom', path: ['compra_referencia_id'], message: 'Una NCRE corrige una compra: elígela' })
        }
        if (d.tipo_documento === 'NCRE' && d.condicion !== 'credito' && !desdeEgreso) {
            ctx.addIssue({ code: 'custom', path: ['condicion'], message: 'La NCRE del proveedor va solo al crédito' })
        }
        if (!desdeEgreso && d.condicion === 'contado') {
            if (d.metodo === 'caja' && d.caja_id === null) {
                ctx.addIssue({ code: 'custom', path: ['caja_id'], message: 'Elige la caja de la que sale el dinero' })
            }
            if (d.metodo === 'cuenta_bancaria' && d.cuenta_bancaria_id === null) {
                ctx.addIssue({ code: 'custom', path: ['cuenta_bancaria_id'], message: 'Elige la cuenta bancaria de la que sale el dinero' })
            }
        }
        d.lineas.forEach((l, i) => {
            if (l.tipo === 'activo_fijo' && l.clase_activo === null) {
                ctx.addIssue({ code: 'custom', path: ['lineas', i, 'clase_activo'], message: 'Elige la clase del activo' })
            }
            if (l.diferir && l.diferir_meses === null) {
                ctx.addIssue({ code: 'custom', path: ['lineas', i, 'diferir_meses'], message: 'De 2 a 120 meses' })
            }
            if (l.producto_id !== null) {
                if (l.tipo !== 'bien') {
                    ctx.addIssue({ code: 'custom', path: ['lineas', i, 'tipo'], message: 'Una línea con producto del inventario es un bien' })
                }
                if (l.bodega_id === null) {
                    ctx.addIssue({ code: 'custom', path: ['lineas', i, 'bodega_id'], message: 'Elige la bodega que recibe' })
                }
                const series = l.series.split(/[\n,;]+/).map(x => x.trim()).filter(Boolean)
                if (l.seguimiento === 'serie' && d.tipo_documento !== 'NCRE' && series.length !== (l.cantidad ?? 1)) {
                    ctx.addIssue({ code: 'custom', path: ['lineas', i, 'series'], message: `Escribe ${l.cantidad ?? 1} series o MAC (una por equipo); van ${series.length}` })
                }
                if (l.seguimiento === 'serie' && d.tipo_documento === 'NCRE' && !l.unidad_ids.length) {
                    ctx.addIssue({ code: 'custom', path: ['lineas', i, 'unidad_ids'], message: 'Elige los equipos que se devuelven' })
                }
            }
        })
    })
}
export type EntradaCompra = z.input<ReturnType<typeof esquemaCompra>>

export function compraVacia(hoy: string): EntradaCompra {
    return {
        proveedor_id: null,
        tipo_documento: 'FACT',
        serie: '',
        numero: '',
        autorizacion: '',
        fecha_documento: hoy,
        periodo_iva: '',
        credito_fiscal: true,
        compra_referencia_id: null,
        descripcion: '',
        condicion: 'credito',
        vence_en: '',
        metodo: 'banco',
        caja_id: null,
        banco_id: null,
        cuenta_bancaria_id: null,
        retenciones_modo: 'sugeridas',
        retenciones: [],
        lineas: [lineaVacia()],
    }
}

function lineasCuerpo(e: EntradaCompra): CuerpoCompra['lineas'] {
    return e.lineas.map(l => ({
        descripcion: l.descripcion.trim(),
        tipo: l.tipo,
        ...(l.cuenta.trim() ? { cuenta: l.cuenta.trim() } : {}),
        total: l.total.trim(),
        exento: l.exento,
        ...(l.diferir && l.diferir_meses !== null ? { diferir_meses: l.diferir_meses } : {}),
        ...(l.tipo === 'activo_fijo' && l.clase_activo ? { clase_activo: l.clase_activo } : {}),
        ...(l.tipo === 'activo_fijo' && l.activo_tasa_anual.trim() ? { activo_tasa_anual: l.activo_tasa_anual.trim() } : {}),
        ...lineaInventario(l, e.tipo_documento),
    }))
}

/** Campos de inventario de una línea `bien` con producto (vacío sin producto: la compra de siempre). */
function lineaInventario(l: EntradaCompra['lineas'][number], tipoDocumento: EntradaCompra['tipo_documento']) {
    if (l.producto_id === null || l.tipo !== 'bien') {
        return {}
    }
    const base = { producto_id: l.producto_id, bodega_id: l.bodega_id, cantidad: l.cantidad ?? 1 }
    if (l.seguimiento !== 'serie') {
        return base
    }
    if (tipoDocumento === 'NCRE') {
        return { ...base, cantidad: l.unidad_ids.length, unidad_ids: l.unidad_ids }
    }
    return { ...base, unidades: l.series.split(/[\n,;]+/).map(x => x.trim()).filter(Boolean).map(serieOMac) }
}

function comunCuerpo(e: EntradaCompra) {
    return {
        proveedor_id: e.proveedor_id ?? 0,
        tipo_documento: e.tipo_documento,
        serie: nulo(e.serie),
        numero: e.numero.trim(),
        autorizacion: nulo(e.autorizacion),
        fecha_documento: e.fecha_documento,
        ...(e.periodo_iva ? { periodo_iva: `${e.periodo_iva}-01` } : {}),
        credito_fiscal: e.credito_fiscal,
        ...(e.compra_referencia_id !== null && (e.tipo_documento === 'NCRE' || e.tipo_documento === 'NDEB') ? { compra_referencia_id: e.compra_referencia_id } : {}),
        descripcion: nulo(e.descripcion),
        lineas: lineasCuerpo(e),
        // Sin el campo, las sugeridas; [] = ninguna.
        ...(e.retenciones_modo === 'ninguna' ? { retenciones: [] } : {}),
        ...(e.retenciones_modo === 'manual' ? { retenciones: e.retenciones.map(r => ({ codigo: r.codigo, ...(r.monto.trim() ? { monto: r.monto.trim() } : {}) })) } : {}),
    }
}

export function cuerpoCompra(e: EntradaCompra): CuerpoCompra {
    return {
        ...comunCuerpo(e),
        condicion: e.condicion,
        ...(e.condicion === 'credito' && e.vence_en ? { vence_en: e.vence_en } : {}),
        ...(e.condicion === 'contado'
            ? {
                    metodo: e.metodo,
                    ...(e.metodo === 'caja' ? { caja_id: e.caja_id } : {}),
                    ...(e.metodo === 'banco' && e.banco_id !== null ? { banco_id: e.banco_id } : {}),
                    ...(e.metodo === 'cuenta_bancaria' ? { cuenta_bancaria_id: e.cuenta_bancaria_id } : {}),
                }
            : {}),
    }
}

export function cuerpoCompraDesdeEgreso(e: EntradaCompra): CuerpoCompraDesdeEgreso {
    return comunCuerpo(e)
}

/** Totales que el formulario muestra antes de enviar (IVA del 12 % incluido; la API recalcula). */
export function totalesFormulario(e: Pick<EntradaCompra, 'lineas' | 'tipo_documento'>): { total: string, iva: string, base: string } {
    const sinCredito = ['FPEQ', 'FCAP', 'RECIBO'].includes(e.tipo_documento)
    let total = new Decimal(0)
    let iva = new Decimal(0)
    for (const l of e.lineas) {
        if (!MONTO.test(l.total.trim())) {
            continue
        }
        const monto = new Decimal(l.total.trim())
        total = total.plus(monto)
        if (!l.exento && !sinCredito) {
            iva = iva.plus(monto.times(12).dividedBy(112).toDecimalPlaces(2))
        }
    }
    return { total: total.toFixed(2), iva: iva.toFixed(2), base: total.minus(iva).toFixed(2) }
}

/** Espejo de `registrarPagoProveedorValidator`. */
export function esquemaPagoProveedor(hoy: string, maximo: string | null) {
    return z.object({
        monto: montoPositivo().refine(v => maximo === null || !MONTO.test(v) || new Decimal(v).lte(maximo), `Hasta lo pendiente${maximo ? ` (${maximo})` : ''}`),
        metodo: z.enum(['caja', 'banco', 'cuenta_bancaria']),
        caja_id: z.number().int().positive().nullable(),
        banco_id: z.number().int().positive().nullable(),
        cuenta_bancaria_id: z.number().int().positive().nullable(),
        fecha: fechaOpcional(hoy, 'La fecha del pago no puede ser futura'),
        referencia: texto(100),
        descripcion: texto(500),
        compras: z.array(z.number().int().positive()),
    }).superRefine((d, ctx) => {
        if (d.metodo === 'caja' && d.caja_id === null) {
            ctx.addIssue({ code: 'custom', path: ['caja_id'], message: 'Elige la caja de la que sale el dinero' })
        }
        if (d.metodo === 'cuenta_bancaria' && d.cuenta_bancaria_id === null) {
            ctx.addIssue({ code: 'custom', path: ['cuenta_bancaria_id'], message: 'Elige la cuenta bancaria de la que sale el dinero' })
        }
    })
}
export type EntradaPagoProveedor = z.input<ReturnType<typeof esquemaPagoProveedor>>

export function cuerpoPagoProveedor(proveedorId: number, e: EntradaPagoProveedor): CuerpoPagoProveedor {
    return {
        proveedor_id: proveedorId,
        monto: e.monto.trim(),
        metodo: e.metodo,
        ...(e.metodo === 'caja' ? { caja_id: e.caja_id } : {}),
        ...(e.metodo === 'banco' && e.banco_id !== null ? { banco_id: e.banco_id } : {}),
        ...(e.metodo === 'cuenta_bancaria' ? { cuenta_bancaria_id: e.cuenta_bancaria_id } : {}),
        ...(e.fecha ? { fecha: e.fecha } : {}),
        referencia: nulo(e.referencia),
        descripcion: nulo(e.descripcion),
        ...(e.compras.length ? { compras: [...e.compras] } : {}),
    }
}

/** Espejo de `registrarActivoValidator`. */
export function esquemaActivo(hoy: string) {
    return z.object({
        clase: z.enum(['equipo_red', 'computacion', 'mobiliario', 'vehiculos', 'herramientas', 'edificios', 'otros'], { message: 'Elige la clase' }),
        descripcion: z.string().trim().min(2, 'Mínimo 2 caracteres').max(300, 'Máximo 300 caracteres'),
        serie: texto(100),
        ubicacion: texto(200),
        fecha_alta: fechaOpcional(hoy, 'El alta no puede ser futura'),
        costo: montoPositivo('Costo sin el IVA tomado como crédito, hasta 2 decimales'),
        valor_residual: montoOpcional,
        depreciacion_inicial: montoOpcional,
        tasa_anual: z.string().trim().refine(v => v === '' || TASA.test(v), 'Por ciento con hasta 2 decimales'),
        contrapartida: z.enum(['2.9.01', '3.1.01', '3.3.01']),
    }).superRefine((d, ctx) => {
        if (MONTO.test(d.costo) && [d.valor_residual, d.depreciacion_inicial].every(v => v === '' || MONTO.test(v))) {
            const suma = new Decimal(d.valor_residual || '0').plus(d.depreciacion_inicial || '0')
            if (suma.gt(d.costo)) {
                ctx.addIssue({ code: 'custom', path: ['depreciacion_inicial'], message: 'El residual y la depreciación inicial no pasan del costo' })
            }
        }
    })
}
export type EntradaActivo = z.input<ReturnType<typeof esquemaActivo>>

export function activoVacio(): EntradaActivo {
    return { clase: 'equipo_red', descripcion: '', serie: '', ubicacion: '', fecha_alta: '', costo: '', valor_residual: '', depreciacion_inicial: '', tasa_anual: '', contrapartida: '2.9.01' }
}

export function cuerpoActivo(e: EntradaActivo): CuerpoActivo {
    return {
        clase: e.clase,
        descripcion: e.descripcion.trim(),
        serie: nulo(e.serie),
        ubicacion: nulo(e.ubicacion),
        ...(e.fecha_alta ? { fecha_alta: e.fecha_alta } : {}),
        costo: e.costo.trim(),
        ...(e.valor_residual ? { valor_residual: e.valor_residual.trim() } : {}),
        ...(e.depreciacion_inicial ? { depreciacion_inicial: e.depreciacion_inicial.trim() } : {}),
        ...(e.tasa_anual ? { tasa_anual: e.tasa_anual.trim() } : {}),
        contrapartida: e.contrapartida,
    }
}

/** Espejo de `darDeBajaActivoValidator`. */
export function esquemaBajaActivo(hoy: string, alta: string) {
    return z.object({
        tipo: z.enum(['venta', 'retiro']),
        motivo: z.string().trim().min(3, 'Escribe el motivo (mínimo 3 caracteres)').max(500, 'Máximo 500 caracteres'),
        fecha: fechaOpcional(hoy, 'La baja no puede ser futura').refine(v => v === '' || v >= alta, `No antes del alta (${alta})`),
        precio_venta: montoOpcional,
        cuenta_bancaria_id: z.number().int().positive().nullable(),
    }).superRefine((d, ctx) => {
        if (d.tipo === 'venta' && (!d.precio_venta || !MONTO.test(d.precio_venta) || new Decimal(d.precio_venta).lte(0))) {
            ctx.addIssue({ code: 'custom', path: ['precio_venta'], message: 'Escribe el precio de venta sin IVA' })
        }
        if (d.tipo === 'venta' && d.cuenta_bancaria_id === null) {
            ctx.addIssue({ code: 'custom', path: ['cuenta_bancaria_id'], message: 'Elige la cuenta que recibe el precio' })
        }
    })
}
export type EntradaBajaActivo = z.input<ReturnType<typeof esquemaBajaActivo>>

export function cuerpoBajaActivo(e: EntradaBajaActivo): CuerpoBajaActivo {
    return {
        tipo: e.tipo,
        motivo: e.motivo.trim(),
        ...(e.fecha ? { fecha: e.fecha } : {}),
        ...(e.tipo === 'venta' ? { precio_venta: e.precio_venta.trim(), cuenta_bancaria_id: e.cuenta_bancaria_id } : {}),
    }
}

/** Espejo de `registrarConstanciaValidator`. */
export function esquemaConstancia(hoy: string) {
    return z.object({
        impuesto_codigo: z.string().min(3, 'Elige la retención'),
        numero: z.string().trim().min(1, 'Escribe el número de la constancia').max(60, 'Máximo 60 caracteres'),
        fecha: fechaOpcional(hoy, 'La constancia no puede ser futura'),
    })
}

/** Espejo de `registrarDiferimientoValidator` (sobre una línea de compra). */
export const esquemaDiferirLinea = z.object({
    compra_linea_id: z.number({ message: 'Elige la línea' }).int().positive('Elige la línea'),
    meses: z.number({ message: 'De 2 a 120 meses' }).int('Meses enteros').min(2, 'De 2 a 120 meses').max(120, 'De 2 a 120 meses'),
    inicio: z.string().trim().refine(v => v === '' || /^\d{4}-(0[1-9]|1[0-2])$/.test(v), 'Mes de la primera cuota (AAAA-MM)'),
    descripcion: texto(300),
})
