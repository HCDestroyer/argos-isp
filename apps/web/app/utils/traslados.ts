import type { Schema } from '@argosisp/contracts'
import type { BadgeProps } from '@nuxt/ui'
import Decimal from 'decimal.js'
import * as z from 'zod'

/**
 * Órdenes de traslado (A3, `contratos/inventario.md` D.1): lo enviado viaja en la bodega
 * `transito` hasta que el destino lo recibe (con firma digital, en papel o por aceptación simple);
 * lo que no llega vuelve al origen. Textos, esquemas espejo de `enviar` y `recibir` y sus cuerpos.
 */

type BadgeColor = NonNullable<BadgeProps['color']>
type OrdenApi = Schema<'OrdenTraslado'>
type DetalleApi = Schema<'OrdenTrasladoDetalle'>
type LineaApi = DetalleApi['lineas'][number]
export type MetodoRecepcion = NonNullable<OrdenApi['metodo_recepcion']>

export const ESTADOS_ORDEN_TRASLADO: Record<OrdenApi['estado'], { etiqueta: string, color: BadgeColor, icono: string }> = {
    en_transito: { etiqueta: 'En tránsito', color: 'info', icono: 'i-lucide-truck' },
    recibida: { etiqueta: 'Recibida', color: 'success', icono: 'i-lucide-package-check' },
    recibida_con_diferencias: { etiqueta: 'Recibida con diferencias', color: 'warning', icono: 'i-lucide-package-x' },
    cancelada: { etiqueta: 'Cancelada', color: 'neutral', icono: 'i-lucide-ban' },
}

export const METODOS_RECEPCION: Record<MetodoRecepcion, { etiqueta: string, descripcion: string, icono: string }> = {
    firma_digital: { etiqueta: 'Firma digital', descripcion: 'Quien recibe firma en esta pantalla (teléfono o tableta).', icono: 'i-lucide-signature' },
    firma_papel: { etiqueta: 'Firma en papel', descripcion: 'Se imprime la orden, se firma y después se adjunta la foto o el escaneo.', icono: 'i-lucide-printer' },
    aceptacion_sistema: { etiqueta: 'Aceptación simple', descripcion: 'Sin firma: solo si la empresa no la exige.', icono: 'i-lucide-check-check' },
}

/** Mensaje de cada código de error del contrato (D.1 y contrato Iris §3.3). */
export const ERRORES_TRASLADO: Record<string, string> = {
    traslado_no_encontrado: 'La orden no existe o no es visible para ti.',
    traslado_ya_recibido: 'La orden ya se recibió: la recepción guardada no cambia. Las diferencias se corrigen con un ajuste.',
    traslado_cancelado: 'La orden está cancelada: lo enviado ya volvió al origen.',
    traslado_de_otro_tecnico: 'Quien recibe no es el técnico de la bodega destino.',
    lineas_invalidas: 'Revisa lo recibido en cada línea.',
    firma_invalida: 'La firma no es válida: vuelve a firmar.',
    tecnico_no_encontrado: 'No hay un usuario activo para ese técnico.',
    tecnico_ambiguo: 'El correo coincide con más de un usuario.',
    tecnico_sin_bodega: 'El técnico no tiene bodega activa en esta empresa.',
    existencia_insuficiente: 'No alcanza la existencia en el origen.',
    bodega_transito: 'La bodega de tránsito no se opera a mano.',
    documento_registrado: 'La orden ya tiene su documento firmado.',
}

/** Origen y destino de una orden en una línea. */
export function rutaOrden(orden: Pick<OrdenApi, 'bodega_origen_nombre' | 'bodega_destino_nombre' | 'usuario_destino_nombre'>): string {
    const destino = orden.usuario_destino_nombre && !orden.bodega_destino_nombre.includes(orden.usuario_destino_nombre)
        ? `${orden.bodega_destino_nombre} (${orden.usuario_destino_nombre})`
        : orden.bodega_destino_nombre
    return `${orden.bodega_origen_nombre} → ${destino}`
}

/* Nueva orden (`POST /inventario/traslados/enviar`) */

const CANTIDAD = /^\d{1,11}(\.\d{1,3})?$/

export const esquemaLineaOrden = z.object({
    producto_id: z.number().int().positive('Elige el producto'),
    seguimiento: z.enum(['cantidad', 'serie']),
    cantidad: z.string().trim(),
    unidad_ids: z.array(z.number().int().positive()).max(500, 'Máximo 500 equipos por línea'),
})

export const esquemaNuevaOrden = z.object({
    bodega_origen_id: z.number({ message: 'Elige el origen' }).int().positive('Elige el origen'),
    bodega_destino_id: z.number({ message: 'Elige el destino' }).int().positive('Elige el destino'),
    motivo: z.string().trim().max(500, 'Máximo 500 caracteres'),
    lineas: z.array(esquemaLineaOrden).min(1, 'Agrega al menos una línea').max(200, 'Máximo 200 líneas'),
}).superRefine((d, ctx) => {
    if (d.bodega_origen_id && d.bodega_origen_id === d.bodega_destino_id) {
        ctx.addIssue({ code: 'custom', path: ['bodega_destino_id'], message: 'El destino debe ser otra bodega' })
    }
    const vistos = new Set<number>()
    d.lineas.forEach((linea, i) => {
        if (vistos.has(linea.producto_id)) {
            ctx.addIssue({ code: 'custom', path: ['lineas', i, 'producto_id'], message: 'El producto ya está en otra línea' })
        }
        vistos.add(linea.producto_id)
        if (linea.seguimiento === 'serie') {
            if (!linea.unidad_ids.length) {
                ctx.addIssue({ code: 'custom', path: ['lineas', i, 'unidad_ids'], message: 'Agrega al menos un equipo' })
            }
        }
        else if (!CANTIDAD.test(linea.cantidad) || new Decimal(linea.cantidad || '0').isZero()) {
            ctx.addIssue({ code: 'custom', path: ['lineas', i, 'cantidad'], message: 'Cantidad mayor que 0, hasta 3 decimales' })
        }
    })
})

export type EntradaNuevaOrden = z.input<typeof esquemaNuevaOrden>
export type SalidaNuevaOrden = z.output<typeof esquemaNuevaOrden>
export type EntradaLineaOrden = z.input<typeof esquemaLineaOrden>

export function nuevaOrdenVacia(): EntradaNuevaOrden {
    return { bodega_origen_id: 0, bodega_destino_id: 0, motivo: '', lineas: [] }
}

export function cuerpoNuevaOrden(d: SalidaNuevaOrden) {
    return {
        bodega_origen_id: d.bodega_origen_id,
        bodega_destino_id: d.bodega_destino_id,
        motivo: d.motivo || null,
        lineas: d.lineas.map(l => (l.seguimiento === 'serie' ? { producto_id: l.producto_id, unidad_ids: l.unidad_ids } : { producto_id: l.producto_id, cantidad: l.cantidad })),
    }
}

/** Busca una unidad por serie o MAC (lo escaneado o tecleado), sin distinguir mayúsculas ni separadores de la MAC. */
export function buscarUnidadPorCodigo<T extends { serie: string | null, mac: string | null }>(unidades: readonly T[], codigo: string): T | undefined {
    const limpio = codigo.trim().toUpperCase()
    const soloHex = limpio.replace(/[^0-9A-F]/g, '')
    return unidades.find(u => (u.serie ?? '').toUpperCase() === limpio || (soloHex.length === 12 && (u.mac ?? '').toUpperCase().replace(/[^0-9A-F]/g, '') === soloHex))
}

/* Recepción (`POST /inventario/traslados/:id/recibir`) */

export type LineaRecepcion = {
    linea_id: number
    seguimiento: LineaApi['seguimiento']
    /** Lo enviado (para el máximo). */
    enviado: string
    cantidad_recibida: string
    unidad_ids_faltantes: number[]
}

export const esquemaRecepcion = z.object({
    metodo_recepcion: z.enum(['firma_digital', 'firma_papel', 'aceptacion_sistema']),
    observaciones: z.string().trim().max(1000, 'Máximo 1000 caracteres'),
    lineas: z.array(z.object({
        linea_id: z.number().int().positive(),
        seguimiento: z.enum(['cantidad', 'serie']),
        enviado: z.string(),
        cantidad_recibida: z.string().trim(),
        unidad_ids_faltantes: z.array(z.number().int().positive()),
    })),
    firma: z.object({ png_base64: z.string(), sha256: z.string().regex(/^[0-9a-f]{64}$/), bytes: z.number(), ancho: z.number(), alto: z.number() }).nullable(),
}).superRefine((d, ctx) => {
    d.lineas.forEach((l, i) => {
        if (l.seguimiento === 'cantidad') {
            if (!CANTIDAD.test(l.cantidad_recibida) && l.cantidad_recibida !== '0') {
                ctx.addIssue({ code: 'custom', path: ['lineas', i, 'cantidad_recibida'], message: 'Cantidad con hasta 3 decimales' })
            }
            else if (new Decimal(l.cantidad_recibida || '0').greaterThan(l.enviado)) {
                ctx.addIssue({ code: 'custom', path: ['lineas', i, 'cantidad_recibida'], message: 'No puede ser más que lo enviado' })
            }
        }
    })
    if (d.metodo_recepcion === 'firma_digital' && !d.firma) {
        ctx.addIssue({ code: 'custom', path: ['firma'], message: 'Falta la firma de quien recibe' })
    }
})

export type EntradaRecepcion = z.input<typeof esquemaRecepcion>
export type SalidaRecepcion = z.output<typeof esquemaRecepcion>

/** Estado inicial de la recepción: todo recibido. */
export function recepcionDe(orden: DetalleApi, metodo: MetodoRecepcion): EntradaRecepcion {
    return {
        metodo_recepcion: metodo,
        observaciones: '',
        firma: null,
        lineas: orden.lineas.map(l => ({
            linea_id: l.id,
            seguimiento: l.seguimiento,
            enviado: l.cantidad,
            cantidad_recibida: new Decimal(l.cantidad).toString(),
            unidad_ids_faltantes: [],
        })),
    }
}

/** Faltante de una línea en la recepción (cantidad, o el número de equipos que no llegaron). */
export function faltanteLinea(linea: LineaRecepcion): Decimal {
    return linea.seguimiento === 'serie'
        ? new Decimal(linea.unidad_ids_faltantes.length)
        : new Decimal(linea.enviado).minus(CANTIDAD.test(linea.cantidad_recibida) ? linea.cantidad_recibida : '0')
}

/** Cuerpo de la recepción: solo viajan las líneas con faltante (sin `lineas`, se recibe todo). */
export function cuerpoRecepcion(d: SalidaRecepcion, version: number, recibidoEn: string) {
    const conFaltante = d.lineas.filter(l => faltanteLinea(l).greaterThan(0))
    return {
        version,
        metodo_recepcion: d.metodo_recepcion,
        observaciones: d.observaciones || null,
        recibido_en: recibidoEn,
        ...(d.metodo_recepcion === 'firma_digital' && d.firma ? { firma: { png_base64: d.firma.png_base64, sha256: d.firma.sha256 } } : {}),
        ...(conFaltante.length
            ? { lineas: conFaltante.map(l => (l.seguimiento === 'serie'
                    ? { linea_id: l.linea_id, unidad_ids_faltantes: l.unidad_ids_faltantes }
                    : { linea_id: l.linea_id, cantidad_recibida: new Decimal(l.cantidad_recibida).toFixed(3) })) }
            : {}),
    }
}

/** Errores `lineas.N.*` de la API (índice del cuerpo enviado) → la línea de la orden en el formulario. */
export function campoLineaRecepcion(campo: string, enviadas: readonly number[], todas: readonly number[]): string {
    const coincide = /^lineas\.(\d+)\.(.+)$/.exec(campo)
    if (!coincide) {
        return campo
    }
    const lineaId = enviadas[Number(coincide[1])]
    const indice = lineaId === undefined ? -1 : todas.indexOf(lineaId)
    const resto = coincide[2] === 'series_faltantes' ? 'unidad_ids_faltantes' : coincide[2]
    return indice < 0 ? campo : `lineas.${indice}.${resto}`
}
