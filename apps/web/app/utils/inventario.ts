import type { Schema } from '@argosisp/contracts'
import type { BadgeProps } from '@nuxt/ui'
import Decimal from 'decimal.js'
import * as z from 'zod'

/**
 * Inventario interno (A3, `contratos/inventario.md`): textos de tipos, estados y movimientos,
 * formato de cantidades y los esquemas espejo de los validadores de productos, bodegas y
 * movimientos.
 */

type BadgeColor = NonNullable<BadgeProps['color']>
type ProductoApi = Schema<'Producto'>
type MovimientoApi = Schema<'MovimientoInventario'>
type UnidadApi = Schema<'UnidadInventario'>

export const TIPOS_PRODUCTO: Record<ProductoApi['tipo'], string> = {
    equipo: 'Equipo',
    material: 'Material',
    otro: 'Otro',
}

export const SEGUIMIENTOS: Record<ProductoApi['seguimiento'], { etiqueta: string, descripcion: string, icono: string }> = {
    cantidad: { etiqueta: 'Por cantidad', descripcion: 'Cable, conectores, grapas: se lleva cuánto hay.', icono: 'i-lucide-ruler' },
    serie: { etiqueta: 'Por serie', descripcion: 'Router, ONU, antena: una unidad por serie o MAC, se presta en comodato.', icono: 'i-lucide-barcode' },
}

export const TIPOS_BODEGA: Record<Schema<'Bodega'>['tipo'], { etiqueta: string, icono: string }> = {
    bodega: { etiqueta: 'Bodega', icono: 'i-lucide-warehouse' },
    tecnico: { etiqueta: 'Técnico', icono: 'i-lucide-hard-hat' },
}

/** Tipo de movimiento del kardex con su texto; `entrada` dice de qué lado suele caer. */
export const TIPOS_MOVIMIENTO_INVENTARIO: Record<MovimientoApi['tipo'], string> = {
    entrada_compra: 'Compra',
    reverso_compra: 'Compra anulada',
    devolucion_proveedor: 'Devolución al proveedor',
    venta: 'Venta',
    reverso_venta: 'Venta anulada',
    consumo: 'Consumo',
    traslado: 'Traslado',
    asignacion_comodato: 'Comodato asignado',
    devolucion_comodato: 'Comodato devuelto',
    ajuste_conteo: 'Ajuste por conteo',
    ajuste: 'Ajuste',
    baja: 'Baja',
    saldo_inicial: 'Saldo inicial',
    premio: 'Premio entregado',
    reverso_premio: 'Entrega de premio anulada',
}

export const ESTADOS_UNIDAD: Record<UnidadApi['estado'], { etiqueta: string, color: BadgeColor, icono: string }> = {
    disponible: { etiqueta: 'Disponible', color: 'success', icono: 'i-lucide-circle-check' },
    en_comodato: { etiqueta: 'En comodato', color: 'info', icono: 'i-lucide-house' },
    por_recuperar: { etiqueta: 'Por recuperar', color: 'warning', icono: 'i-lucide-undo-2' },
    en_reparacion: { etiqueta: 'En reparación', color: 'warning', icono: 'i-lucide-wrench' },
    vendida: { etiqueta: 'Vendida', color: 'neutral', icono: 'i-lucide-receipt' },
    dada_de_baja: { etiqueta: 'Dada de baja', color: 'error', icono: 'i-lucide-trash-2' },
    anulada: { etiqueta: 'Anulada', color: 'neutral', icono: 'i-lucide-ban' },
    devuelta_proveedor: { etiqueta: 'Devuelta al proveedor', color: 'neutral', icono: 'i-lucide-truck' },
    entregada: { etiqueta: 'Entregada (premio)', color: 'neutral', icono: 'i-lucide-gift' },
}

export const CONDICIONES_UNIDAD: Record<UnidadApi['condicion'], string> = {
    nuevo: 'Nuevo',
    usado: 'Usado',
}

export const CAUSAS_BAJA: Record<'danado' | 'robado' | 'obsoleto' | 'otro', string> = {
    danado: 'Dañado',
    robado: 'Robado',
    obsoleto: 'Obsoleto',
    otro: 'Otro',
}

export const ESTADOS_CONTEO: Record<Schema<'ConteoInventario'>['estado'], { etiqueta: string, color: BadgeColor, icono: string }> = {
    abierto: { etiqueta: 'Abierto', color: 'info', icono: 'i-lucide-clipboard-list' },
    cerrado: { etiqueta: 'Cerrado', color: 'success', icono: 'i-lucide-clipboard-check' },
    cancelado: { etiqueta: 'Cancelado', color: 'neutral', icono: 'i-lucide-clipboard-x' },
}

/** `"12.500"` → `"12.5"`; `"3.000"` → `"3"` (la API manda 3 decimales). Con la unidad si se da. */
export function formatearCantidad(cantidad: string | null | undefined, unidad?: string | null): string {
    if (cantidad === null || cantidad === undefined || cantidad === '') {
        return '—'
    }
    const numero = new Decimal(cantidad)
    const texto = numero.toDecimalPlaces(3).toNumber().toLocaleString('es-GT', { maximumFractionDigits: 3 })
    return unidad ? `${texto} ${unidad}` : texto
}

/** Serie y MAC de una unidad en una línea («SN123 · AA:BB:…»). */
export function identificacionUnidad(unidad: Pick<UnidadApi, 'serie' | 'mac'>): string {
    return [unidad.serie, unidad.mac].filter(Boolean).join(' · ') || 'Sin serie ni MAC'
}

/** Lista de series o MAC pegadas o escaneadas: una por línea, coma o punto y coma; sin vacías. */
export function partirSeries(texto: string): string[] {
    return texto.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean)
}

const MAC = /^([0-9a-f]{2}[:.-]?){5}[0-9a-f]{2}$/i

/** Una línea pegada como serie o MAC: la MAC se reconoce por su forma (como la normaliza la API). */
export function serieOMac(valor: string): { serie: string | null, mac: string | null } {
    return MAC.test(valor.replaceAll('.', '')) || MAC.test(valor) ? { serie: null, mac: valor } : { serie: valor, mac: null }
}

/* Esquemas espejo de los validadores (A3, `apps/api/app/inventario/validators.ts`) */

const CANTIDAD = /^\d{1,11}(\.\d{1,3})?$/
const CANTIDAD_CON_SIGNO = /^-?\d{1,11}(\.\d{1,3})?$/
const COSTO = /^\d{1,12}(\.\d{1,6})?$/
const CUENTA = /^\d+(\.\d+)*$/

function textoONulo(maximo: number, mensaje = `Máximo ${maximo} caracteres`) {
    return z.string().trim().max(maximo, mensaje).transform(valor => valor || null)
}

export const esquemaProducto = z.object({
    sku: z.string().trim().min(1, 'Escribe el SKU').max(60, 'Máximo 60 caracteres'),
    nombre: z.string().trim().min(2, 'Escribe al menos 2 caracteres').max(200, 'Máximo 200 caracteres'),
    tipo: z.enum(['equipo', 'material', 'otro']),
    seguimiento: z.enum(['cantidad', 'serie']),
    unidad: textoONulo(30),
    clase_activo: z.enum(['equipo_red', 'computacion', 'mobiliario', 'vehiculos', 'herramientas', 'edificios', 'otros']),
    cuenta_costo: z.string().trim().max(30).refine(v => v === '' || CUENTA.test(v), 'Código de cuenta: 5.6.01').transform(v => v || null),
    cuenta_consumo: z.string().trim().max(30).refine(v => v === '' || CUENTA.test(v), 'Código de cuenta: 5.2.07').transform(v => v || null),
    existencia_minima: z.string().trim().refine(v => v === '' || CANTIDAD.test(v), 'Hasta 3 decimales').transform(v => v || null),
})

export type EntradaProducto = z.input<typeof esquemaProducto>
export type SalidaProducto = z.output<typeof esquemaProducto>

export function entradaProducto(producto: ProductoApi | null): EntradaProducto {
    return {
        sku: producto?.sku ?? '',
        nombre: producto?.nombre ?? '',
        tipo: producto?.tipo ?? 'material',
        seguimiento: producto?.seguimiento ?? 'cantidad',
        unidad: producto?.unidad ?? 'unidad',
        clase_activo: (producto?.clase_activo as EntradaProducto['clase_activo'] | null) ?? 'equipo_red',
        cuenta_costo: producto?.cuenta_costo ?? '',
        cuenta_consumo: producto?.cuenta_consumo ?? '',
        existencia_minima: producto?.existencia_minima ? formatearCantidad(producto.existencia_minima).replaceAll(',', '') : '',
    }
}

/** Cuerpo de `POST /productos`: la clase de activo solo viaja con seguimiento por serie. */
export function cuerpoProducto(salida: SalidaProducto) {
    return { ...salida, clase_activo: salida.seguimiento === 'serie' ? salida.clase_activo : null }
}

export const esquemaBodega = z.object({
    nombre: z.string().trim().min(2, 'Escribe al menos 2 caracteres').max(120, 'Máximo 120 caracteres'),
    tipo: z.enum(['bodega', 'tecnico']),
    usuario_id: z.number().int().positive().nullable(),
}).superRefine((datos, ctx) => {
    if (datos.tipo === 'tecnico' && !datos.usuario_id) {
        ctx.addIssue({ code: 'custom', path: ['usuario_id'], message: 'Elige el técnico que responde por esta bodega' })
    }
})

export type EntradaBodega = z.input<typeof esquemaBodega>

/** Las operaciones del inventario que se hacen desde Existencias. */
export type OperacionInventario = 'saldo_inicial' | 'consumo' | 'traslado' | 'ajuste' | 'baja'

export const OPERACIONES_INVENTARIO: Record<OperacionInventario, { etiqueta: string, descripcion: string, icono: string, permiso: string, confirmar: string }> = {
    saldo_inicial: { etiqueta: 'Saldo inicial', descripcion: 'Lo que ya había al empezar a usar el inventario (contra 2.9.01).', icono: 'i-lucide-flag', permiso: 'inventario.cargar_saldo_inicial', confirmar: 'Cargar saldo' },
    consumo: { etiqueta: 'Consumo', descripcion: 'Materiales usados en una instalación o reparación (gasto 5.2.07).', icono: 'i-lucide-hammer', permiso: 'inventario.consumir', confirmar: 'Registrar consumo' },
    traslado: { etiqueta: 'Traslado', descripcion: 'De una bodega a otra o a un técnico, al mismo costo y sin asiento.', icono: 'i-lucide-arrow-right-left', permiso: 'inventario.trasladar', confirmar: 'Trasladar' },
    ajuste: { etiqueta: 'Ajuste', descripcion: 'Corrige la existencia (+ entra, − sale) con motivo: faltante a 5.6.02, sobrante a 4.2.04.', icono: 'i-lucide-scale', permiso: 'inventario.ajustar', confirmar: 'Ajustar' },
    baja: { etiqueta: 'Baja', descripcion: 'Dañado, robado u obsoleto: sale del inventario a mermas (5.6.02).', icono: 'i-lucide-trash-2', permiso: 'inventario.dar_de_baja', confirmar: 'Dar de baja' },
}

/** Formulario de una operación: un solo esquema con lo que cada una pide (validado en `superRefine`). */
export const esquemaOperacion = z.object({
    operacion: z.enum(['saldo_inicial', 'consumo', 'traslado', 'ajuste', 'baja']),
    producto_id: z.number({ message: 'Elige el producto' }).int().positive('Elige el producto'),
    seguimiento: z.enum(['cantidad', 'serie']),
    bodega_id: z.number({ message: 'Elige la bodega' }).int().positive('Elige la bodega'),
    bodega_destino_id: z.number().int().positive().nullable(),
    cantidad: z.string().trim(),
    unidad_ids: z.array(z.number().int().positive()),
    serie: z.string().trim().max(100, 'Máximo 100 caracteres'),
    mac: z.string().trim().max(30, 'Máximo 30 caracteres'),
    costo_unitario: z.string().trim(),
    servicio_id: z.number().int().positive().nullable(),
    causa: z.enum(['danado', 'robado', 'obsoleto', 'otro']),
    fecha: z.string().trim(),
    motivo: z.string().trim().max(500, 'Máximo 500 caracteres'),
}).superRefine((d, ctx) => {
    const error = (campo: string, message: string) => ctx.addIssue({ code: 'custom', path: [campo], message })
    const serie = d.seguimiento === 'serie'
    if (d.operacion === 'traslado') {
        if (!d.bodega_destino_id) {
            error('bodega_destino_id', 'Elige la bodega destino')
        }
        else if (d.bodega_destino_id === d.bodega_id) {
            error('bodega_destino_id', 'El destino debe ser otra bodega')
        }
    }
    if (serie) {
        if (d.operacion === 'consumo') {
            error('producto_id', 'Un producto por serie no se consume: se presta en comodato o se da de baja')
        }
        if ((d.operacion === 'traslado' && !d.unidad_ids.length)) {
            error('unidad_ids', 'Elige al menos un equipo')
        }
        if ((d.operacion === 'baja' || (d.operacion === 'ajuste' && d.cantidad.startsWith('-'))) && d.unidad_ids.length !== 1) {
            error('unidad_ids', 'Elige el equipo')
        }
        if ((d.operacion === 'saldo_inicial' || (d.operacion === 'ajuste' && !d.cantidad.startsWith('-'))) && !d.serie && !d.mac) {
            error('serie', 'Escribe la serie o la MAC del equipo')
        }
    }
    else {
        const patron = d.operacion === 'ajuste' ? CANTIDAD_CON_SIGNO : CANTIDAD
        if (!patron.test(d.cantidad) || new Decimal(d.cantidad || '0').isZero()) {
            error('cantidad', d.operacion === 'ajuste' ? 'Cantidad con signo, hasta 3 decimales (−2 o 5.5)' : 'Cantidad mayor que 0, hasta 3 decimales')
        }
    }
    if (d.costo_unitario && !COSTO.test(d.costo_unitario)) {
        error('costo_unitario', 'Monto con hasta 6 decimales')
    }
    if (d.operacion === 'saldo_inicial' && !d.costo_unitario) {
        error('costo_unitario', 'Escribe el costo unitario')
    }
    if ((d.operacion === 'ajuste' || d.operacion === 'baja') && d.motivo.length < 3) {
        error('motivo', 'Escribe el motivo (mínimo 3 caracteres)')
    }
})

export type EntradaOperacion = z.input<typeof esquemaOperacion>
export type SalidaOperacion = z.output<typeof esquemaOperacion>

export function operacionVacia(operacion: OperacionInventario): EntradaOperacion {
    return { operacion, producto_id: 0, seguimiento: 'cantidad', bodega_id: 0, bodega_destino_id: null, cantidad: '', unidad_ids: [], serie: '', mac: '', costo_unitario: '', servicio_id: null, causa: 'danado', fecha: '', motivo: '' }
}

/** Cuerpo de cada operación (lo que pide su validador en la API), desde el formulario validado. */
export function cuerpoOperacion(d: SalidaOperacion) {
    const base = { producto_id: d.producto_id, bodega_id: d.bodega_id }
    const serie = d.seguimiento === 'serie'
    const motivo = d.motivo || null
    const fecha = d.fecha || null
    const unidadNueva = { serie: d.serie || null, mac: d.mac || null }
    switch (d.operacion) {
        case 'saldo_inicial':
            return { operacion: d.operacion, cuerpo: serie
                ? { ...base, unidad: unidadNueva, costo_total: new Decimal(d.costo_unitario || '0').toFixed(2), fecha, motivo }
                : { ...base, cantidad: d.cantidad, costo_unitario: d.costo_unitario, fecha, motivo } } as const
        case 'consumo':
            return { operacion: d.operacion, cuerpo: { ...base, cantidad: d.cantidad, servicio_id: d.servicio_id, motivo, fecha } } as const
        case 'traslado':
            return { operacion: d.operacion, cuerpo: {
                producto_id: d.producto_id,
                bodega_origen_id: d.bodega_id,
                bodega_destino_id: d.bodega_destino_id ?? 0,
                ...(serie ? { unidad_ids: d.unidad_ids } : { cantidad: d.cantidad }),
                motivo,
            } } as const
        case 'ajuste': {
            const sale = d.cantidad.startsWith('-')
            const porSerie = sale ? { unidad_id: d.unidad_ids[0] ?? null } : { unidad: unidadNueva }
            return { operacion: d.operacion, cuerpo: {
                ...base,
                ...(serie ? porSerie : { cantidad: d.cantidad }),
                costo_unitario: d.costo_unitario || null,
                motivo: d.motivo,
                fecha,
            } } as const
        }
        case 'baja':
            return { operacion: d.operacion, cuerpo: { ...base, ...(serie ? { unidad_id: d.unidad_ids[0] ?? null } : { cantidad: d.cantidad }), causa: d.causa, motivo: d.motivo } } as const
    }
}
