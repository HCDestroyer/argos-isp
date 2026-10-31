import type { Schema } from '@argosisp/contracts'
import type { BadgeProps } from '@nuxt/ui'
import Decimal from 'decimal.js'
import * as z from 'zod'

/**
 * Borradores de compra desde un archivo (A3, `contratos/inventario.md` D.5): el esquema común de la
 * extracción (`ExtraccionCompra`, espejo de `editarBorradorValidator`), la confianza de la IA por campo
 * y por línea, y la confirmación (proveedor, condición y qué hacer con cada línea: un producto
 * existente, uno nuevo o gasto).
 */

type BadgeColor = NonNullable<BadgeProps['color']>
type Borrador = Schema<'BorradorCompra'>
type Propuesta = NonNullable<Borrador['propuesta']>
type Modalidad = 'comodato' | 'consumible_gasto' | 'consumible_cobro'

export const ESTADOS_BORRADOR: Record<Borrador['estado'], { etiqueta: string, color: BadgeColor, icono: string }> = {
    borrador: { etiqueta: 'Por revisar', color: 'info', icono: 'i-lucide-file-pen' },
    confirmado: { etiqueta: 'Confirmado', color: 'success', icono: 'i-lucide-file-check' },
    descartado: { etiqueta: 'Descartado', color: 'neutral', icono: 'i-lucide-file-x' },
}

export const FUENTES_BORRADOR: Record<Borrador['fuente'], { etiqueta: string, icono: string }> = {
    xml_fel: { etiqueta: 'XML FEL', icono: 'i-lucide-file-code' },
    ia: { etiqueta: 'Leído con IA', icono: 'i-lucide-sparkles' },
    manual: { etiqueta: 'Captura manual', icono: 'i-lucide-keyboard' },
}

/** `ia_no_configurada: …` / `ia_fallo: …` → un texto para quien carga la factura. */
export function textoErrorExtraccion(error: string): { titulo: string, detalle: string } {
    const [codigo = '', ...resto] = error.split(':')
    const detalle = resto.join(':').trim()
    if (codigo === 'ia_no_configurada') {
        return { titulo: 'No hay IA configurada para leer PDF o imágenes', detalle: 'Captura los datos a mano o pide que configuren la IA en Configuración → Inventario.' }
    }
    if (codigo === 'ia_fallo') {
        const motivos: Record<string, string> = {
            pdf_sin_texto: 'El PDF es un escaneo sin texto: súbelo como imagen.',
            respuesta_invalida: 'La IA respondió algo que no es una factura válida.',
        }
        return { titulo: 'La IA no pudo leer la factura', detalle: `${motivos[detalle] ?? detalle} Captura los datos a mano.` }
    }
    return { titulo: 'No se pudo leer la factura', detalle: error }
}

/* Confianza de la IA (0 a 1) */

export function nivelConfianza(valor: number | null): { etiqueta: string, color: BadgeColor, clase: string } | null {
    if (valor === null) {
        return null
    }
    if (valor >= 0.85) {
        return { etiqueta: `Alta (${Math.round(valor * 100)} %)`, color: 'success', clase: '' }
    }
    if (valor >= 0.6) {
        return { etiqueta: `Media (${Math.round(valor * 100)} %)`, color: 'warning', clase: 'ring-2 ring-warning/60 rounded-md' }
    }
    return { etiqueta: `Baja (${Math.round(valor * 100)} %)`, color: 'error', clase: 'ring-2 ring-error/60 rounded-md' }
}

function numero(valor: unknown): number | null {
    return typeof valor === 'number' && valor >= 0 && valor <= 1 ? valor : null
}

/** La confianza de un campo (`emisor`, `numero`, `fecha`, `totales`…), o `null` si la IA no la dio. */
export function confianzaCampo(confianza: Borrador['confianza'], campo: string): number | null {
    return confianza ? numero(Reflect.get(confianza, campo)) : null
}

/** La confianza de un campo de una línea (`confianza.lineas[i].campo`). */
export function confianzaLinea(confianza: Borrador['confianza'], indice: number, campo: string): number | null {
    const lineas: unknown = confianza ? Reflect.get(confianza, 'lineas') : null
    const linea: unknown = Array.isArray(lineas) ? lineas[indice] : null
    return typeof linea === 'object' && linea !== null ? numero(Reflect.get(linea, campo)) : null
}

/* Datos de la factura (`editar`) */

const MONTO = /^-?\d{1,12}(\.\d{1,2})?$/
const CANTIDAD = /^\d{1,11}(\.\d{1,6})?$/

const monto = (mensaje = 'Monto con hasta 2 decimales') => z.string().trim().regex(MONTO, mensaje)

export const esquemaLineaCompraArchivo = z.object({
    codigo: z.string().trim().max(100),
    descripcion: z.string().trim().min(1, 'Escribe la descripción').max(500),
    cantidad: z.string().trim().regex(CANTIDAD, 'Cantidad mayor que 0'),
    unidad: z.string().trim().max(30),
    precio_unitario: monto(),
    descuento: monto(),
    total: monto(),
    iva: monto(),
    bien_o_servicio: z.enum(['B', 'S']),
})

export const esquemaDatosCompra = z.object({
    emisor: z.object({
        nit: z.string().trim().min(1, 'Escribe el NIT del emisor').max(30),
        nombre: z.string().trim().min(1, 'Escribe el nombre del emisor').max(300),
    }),
    receptor: z.object({ nit: z.string().trim().max(30), nombre: z.string().trim().max(300) }),
    tipo_documento: z.string().trim().min(1, 'Elige el tipo').max(10),
    serie: z.string().trim().max(40),
    numero: z.string().trim().min(1, 'Escribe el número').max(60),
    autorizacion: z.string().trim().max(100),
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha AAAA-MM-DD'),
    moneda: z.string().trim().length(3, 'Código de 3 letras'),
    lineas: z.array(esquemaLineaCompraArchivo).min(1, 'La factura necesita al menos una línea').max(500),
    totales: z.object({ total: monto(), iva: monto() }),
})

export type EntradaDatosCompra = z.input<typeof esquemaDatosCompra>
export type LineaDatosCompra = EntradaDatosCompra['lineas'][number]

export function lineaCompraVacia(): LineaDatosCompra {
    return { codigo: '', descripcion: '', cantidad: '1', unidad: '', precio_unitario: '0.00', descuento: '0.00', total: '0.00', iva: '0.00', bien_o_servicio: 'B' }
}

const texto = (valor: unknown): string => (typeof valor === 'string' ? valor : typeof valor === 'number' ? String(valor) : '')
const objeto = (valor: unknown): Record<string, unknown> => (typeof valor === 'object' && valor !== null ? valor as Record<string, unknown> : {})

/** Los `datos` del borrador (un objeto libre en el OpenAPI) como estado del formulario; lo que falta, vacío. */
export function datosDesdeBorrador(datos: Borrador['datos'], hoy: string): EntradaDatosCompra {
    const d = objeto(datos)
    const emisor = objeto(d.emisor)
    const receptor = objeto(d.receptor)
    const totales = objeto(d.totales)
    const lineas = Array.isArray(d.lineas) ? d.lineas.map(objeto) : []
    return {
        emisor: { nit: texto(emisor.nit), nombre: texto(emisor.nombre) },
        receptor: { nit: texto(receptor.nit), nombre: texto(receptor.nombre) },
        tipo_documento: texto(d.tipo_documento) || 'FACT',
        serie: texto(d.serie),
        numero: texto(d.numero),
        autorizacion: texto(d.autorizacion),
        fecha: texto(d.fecha) || hoy,
        moneda: texto(d.moneda) || 'GTQ',
        lineas: lineas.map(l => ({
            codigo: texto(l.codigo),
            descripcion: texto(l.descripcion),
            cantidad: texto(l.cantidad) || '1',
            unidad: texto(l.unidad),
            precio_unitario: texto(l.precio_unitario) || '0.00',
            descuento: texto(l.descuento) || '0.00',
            total: texto(l.total) || '0.00',
            iva: texto(l.iva) || '0.00',
            bien_o_servicio: l.bien_o_servicio === 'S' ? 'S' : 'B',
        })),
        totales: { total: texto(totales.total) || '0.00', iva: texto(totales.iva) || '0.00' },
    }
}

/** El cuerpo `datos` de `editar` (vacíos como null donde la API los admite). */
export function cuerpoDatosCompra(d: EntradaDatosCompra) {
    const vacioNulo = (v: string) => (v.trim() ? v.trim() : null)
    return {
        emisor: { nit: d.emisor.nit.trim(), nombre: d.emisor.nombre.trim() },
        receptor: { nit: vacioNulo(d.receptor.nit), nombre: vacioNulo(d.receptor.nombre) },
        tipo_documento: d.tipo_documento,
        serie: vacioNulo(d.serie),
        numero: d.numero.trim(),
        autorizacion: vacioNulo(d.autorizacion),
        fecha: d.fecha,
        moneda: d.moneda.toUpperCase(),
        lineas: d.lineas.map(l => ({ ...l, codigo: vacioNulo(l.codigo), unidad: vacioNulo(l.unidad) })),
        totales: d.totales,
    }
}

/** La suma de las líneas contra el total de la factura (aviso si no cuadra). */
export function cuadreLineas(d: EntradaDatosCompra): { suma: string, cuadra: boolean } {
    const suma = d.lineas.reduce((t, l) => t.plus(MONTO.test(l.total) ? l.total : '0'), new Decimal(0))
    return { suma: suma.toFixed(2), cuadra: MONTO.test(d.totales.total) && suma.equals(d.totales.total) }
}

/* Confirmación */

export const esquemaLineaConfirmacion = z.object({
    indice: z.number().int().min(0),
    accion: z.enum(['existente', 'crear', 'gasto']),
    producto_id: z.number().int().nullable(),
    sku: z.string().trim().max(60),
    nombre: z.string().trim().max(200),
    tipo: z.string().trim(),
    modalidad: z.enum(['del_tipo', 'comodato', 'consumible_gasto', 'consumible_cobro']),
    unidad: z.string().trim().max(30),
    /** Producto de serie: una por unidad comprada. */
    series: z.string().trim(),
    seguimiento: z.enum(['cantidad', 'serie']),
    bodega_id: z.number().int().nullable(),
    cuenta: z.string().trim().refine(v => v === '' || /^\d+(\.\d+)*$/.test(v), 'Código de cuenta: 5.2.01'),
    /** La cantidad de la línea (para las series). */
    cantidad: z.string(),
})

export const esquemaConfirmacion = z.object({
    proveedor_modo: z.enum(['existente', 'crear']),
    proveedor_id: z.number().int().nullable(),
    proveedor_nombre: z.string().trim().max(200),
    proveedor_nit: z.string().trim().max(30),
    condicion: z.enum(['contado', 'credito']),
    vence_en: z.string().trim(),
    metodo: z.enum(['caja', 'banco', 'cuenta_bancaria']),
    caja_id: z.number().int().nullable(),
    banco_id: z.number().int().nullable(),
    cuenta_bancaria_id: z.number().int().nullable(),
    forzar_receptor: z.boolean(),
    lineas: z.array(esquemaLineaConfirmacion),
}).superRefine((d, ctx) => {
    const error = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message })
    if (d.proveedor_modo === 'existente' && !d.proveedor_id) {
        error(['proveedor_id'], 'Elige el proveedor')
    }
    if (d.proveedor_modo === 'crear' && d.proveedor_nombre.length < 2) {
        error(['proveedor_nombre'], 'Escribe el nombre del proveedor')
    }
    d.lineas.forEach((l, i) => {
        if (l.accion === 'gasto') {
            return
        }
        if (l.accion === 'existente' && !l.producto_id) {
            error(['lineas', i, 'producto_id'], 'Elige el producto')
        }
        if (l.accion === 'crear') {
            if (!l.sku) {
                error(['lineas', i, 'sku'], 'Escribe el SKU')
            }
            if (l.nombre.length < 2) {
                error(['lineas', i, 'nombre'], 'Escribe el nombre')
            }
            if (!/^[a-z0-9_]{2,40}$/.test(l.tipo)) {
                error(['lineas', i, 'tipo'], 'Elige el tipo')
            }
        }
        if (!l.bodega_id) {
            error(['lineas', i, 'bodega_id'], 'Elige la bodega a la que entra')
        }
        if (!/^\d+$/.test(l.cantidad)) {
            error(['lineas', i, 'cantidad'], 'A inventario solo entran unidades enteras: corrige la unidad o mándala a gasto')
        }
        if (l.seguimiento === 'serie' && /^\d+$/.test(l.cantidad) && partirSeries(l.series).length !== Number(l.cantidad)) {
            error(['lineas', i, 'series'], `Escribe ${Number(l.cantidad)} series o MAC (una por unidad)`)
        }
    })
})

export type EntradaConfirmacion = z.input<typeof esquemaConfirmacion>
export type LineaConfirmacion = EntradaConfirmacion['lineas'][number]

type ProductoMinimo = { id: number, seguimiento: 'cantidad' | 'serie' }
type TipoMinimo = { codigo: string, seguimiento_defecto: 'cantidad' | 'serie', modalidad_defecto: Modalidad }

/** La confirmación inicial desde la propuesta (proveedor y productos coincidentes, nuevos o gasto). */
export function confirmacionDesdePropuesta(propuesta: Propuesta | null, datos: EntradaDatosCompra, productos: readonly ProductoMinimo[], tipos: readonly TipoMinimo[]): EntradaConfirmacion {
    const proveedor = propuesta?.proveedor ?? null
    return {
        proveedor_modo: proveedor && !proveedor.crear && proveedor.id ? 'existente' : 'crear',
        proveedor_id: proveedor?.id ?? null,
        proveedor_nombre: proveedor?.nombre ?? datos.emisor.nombre,
        proveedor_nit: proveedor?.nit ?? datos.emisor.nit,
        condicion: 'credito',
        vence_en: '',
        metodo: 'caja',
        caja_id: null,
        banco_id: null,
        cuenta_bancaria_id: null,
        forzar_receptor: false,
        lineas: datos.lineas.map((linea, indice) => {
            const p = propuesta?.lineas.find(x => x.indice === indice)
            const tipo = tipos.find(t => t.codigo === (p?.crear?.tipo ?? 'material'))
            const accion: LineaConfirmacion['accion'] = !p || p.gasto || linea.bien_o_servicio === 'S' ? 'gasto' : p.producto_id ? 'existente' : 'crear'
            const producto = productos.find(x => x.id === p?.producto_id)
            return {
                indice,
                accion,
                producto_id: p?.producto_id ?? null,
                sku: p?.crear?.sku ?? '',
                nombre: p?.crear?.nombre ?? linea.descripcion,
                tipo: p?.crear?.tipo ?? 'material',
                modalidad: 'del_tipo',
                unidad: p?.crear?.unidad ?? linea.unidad,
                series: '',
                seguimiento: accion === 'existente' ? (producto?.seguimiento ?? 'cantidad') : (tipo?.seguimiento_defecto ?? 'cantidad'),
                bodega_id: null,
                cuenta: '',
                cantidad: new Decimal(CANTIDAD.test(linea.cantidad) ? linea.cantidad : '0').toString(),
            }
        }),
    }
}

/** El cuerpo de `confirmar` desde el formulario validado. */
export function cuerpoConfirmacion(d: EntradaConfirmacion, version: number) {
    return {
        version,
        proveedor: d.proveedor_modo === 'existente' && d.proveedor_id
            ? { id: d.proveedor_id }
            : { crear: { nombre: d.proveedor_nombre, nit: d.proveedor_nit || null } },
        condicion: d.condicion,
        ...(d.condicion === 'credito' && d.vence_en ? { vence_en: d.vence_en } : {}),
        ...(d.condicion === 'contado'
            ? { metodo: d.metodo, caja_id: d.metodo === 'caja' ? d.caja_id : null, banco_id: d.metodo === 'banco' ? d.banco_id : null, cuenta_bancaria_id: d.metodo === 'cuenta_bancaria' ? d.cuenta_bancaria_id : null }
            : {}),
        ...(d.forzar_receptor ? { forzar_receptor: true } : {}),
        lineas: d.lineas.map((l) => {
            if (l.accion === 'gasto') {
                return { indice: l.indice, producto: null, ...(l.cuenta ? { cuenta: l.cuenta } : {}) }
            }
            const producto = l.accion === 'existente'
                ? { id: l.producto_id }
                : { crear: { sku: l.sku, nombre: l.nombre, tipo: l.tipo, ...(l.modalidad !== 'del_tipo' ? { modalidad: l.modalidad } : {}), ...(l.unidad ? { unidad: l.unidad } : {}) } }
            return {
                indice: l.indice,
                producto,
                bodega_id: l.bodega_id,
                ...(l.seguimiento === 'serie' ? { unidades: partirSeries(l.series).map(serieOMac) } : {}),
            }
        }),
    }
}

/** Errores `lineas.N.producto.crear.sku` de la API → el campo de la línea en el formulario. */
export function campoConfirmacion(campo: string): string {
    return campo
        .replace(/^proveedor\.crear\.nombre$/, 'proveedor_nombre')
        .replace(/^proveedor\.crear\.nit$/, 'proveedor_nit')
        .replace(/^proveedor\.id$/, 'proveedor_id')
        .replace(/^lineas\.(\d+)\.producto\.crear\.(\w+)$/, 'lineas.$1.$2')
        .replace(/^lineas\.(\d+)\.producto\.id$/, 'lineas.$1.producto_id')
        .replace(/^lineas\.(\d+)\.unidades.*$/, 'lineas.$1.series')
}

/** Texto de la coincidencia de un producto en la propuesta. */
export const COINCIDENCIAS: Record<string, string> = {
    codigo_proveedor: 'por el código del proveedor',
    sku: 'por el SKU',
    nombre: 'por el nombre',
}
