import type { Schema, paths } from '@argosisp/contracts'
import type { BadgeProps } from '@nuxt/ui'
import Decimal from 'decimal.js'
import * as z from 'zod'

type AdicionalApi = Schema<'Adicional'>
type AsignacionApi = Schema<'AdicionalServicio'>
type DatosAdicionalApi = paths['/api/v1/adicionales']['post']['requestBody']['content']['application/json']
type CambiosAdicionalApi = paths['/api/v1/adicionales/{id}']['put']['requestBody']['content']['application/json']
type DatosMotivoApi = paths['/api/v1/adicionales/motivos']['post']['requestBody']['content']['application/json']
type DatosAsignacionApi = paths['/api/v1/servicios/{id}/adicionales']['post']['requestBody']['content']['application/json']
type CambiosAsignacionApi = paths['/api/v1/servicios/{id}/adicionales/{asignacionId}']['put']['requestBody']['content']['application/json']

export type ModalidadAdicional = AsignacionApi['modalidad']
export type PrimerPeriodoAdicional = NonNullable<AsignacionApi['primer_periodo']>
export type BloqueoAdicionalServicio = NonNullable<AsignacionApi['bloqueo']>

const MONTO = /^\d{1,12}(\.\d{1,2})?$/
/** Como el validador de A1: letras, dígitos, guion y guion bajo; se guarda en mayúsculas. */
const CODIGO = /^[A-Z0-9][A-Z0-9_-]{0,39}$/

/**
 * Modalidades de un adicional en un servicio (`contratos/adicionales.md`): **incluido** en el plan,
 * de **cortesía** (con motivo, permiso `servicios.adicional_cortesia`) o **cobrado** aparte.
 */
export const MODALIDADES_ADICIONAL: Record<ModalidadAdicional, { etiqueta: string, icono: string, color: NonNullable<BadgeProps['color']>, ayuda: string }> = {
    incluido: { etiqueta: 'Incluido', icono: 'i-lucide-package-check', color: 'info', ayuda: 'Viene con el plan, sin cobro aparte.' },
    cortesia: { etiqueta: 'Cortesía', icono: 'i-lucide-gift', color: 'warning', ayuda: 'Se regala con un motivo (queda en la bitácora).' },
    cobrado: { etiqueta: 'Cobrado', icono: 'i-lucide-receipt', color: 'success', ayuda: 'Se cobra aparte cada mes con su precio.' },
}

/**
 * Cómo se cobra el periodo en curso de un adicional `cobrado` (A1, `contratos/adicionales.md`): A3
 * agrega en la siguiente factura la parte proporcional desde `cobrado_desde`, o nada.
 */
export const PRIMEROS_PERIODOS_ADICIONAL: Record<PrimerPeriodoAdicional, { etiqueta: string, ayuda: string, corto: string }> = {
    prorrateado: { etiqueta: 'Cobrar proporcional este mes', ayuda: 'La siguiente factura cobra los días desde hoy hasta el fin del periodo.', corto: 'proporcional este mes' },
    sin_costo: { etiqueta: 'Sin costo este mes', ayuda: 'El periodo en curso no se cobra; se cobra completo desde el siguiente.', corto: 'sin costo este mes' },
}

/** «Desde 19/10/2026 · proporcional este mes» para un cobrado (o null si no aplica). */
export function resumenCobroAdicional(asignacion: Pick<AsignacionApi, 'modalidad' | 'primer_periodo' | 'cobrado_desde'>): string | null {
    if (asignacion.modalidad !== 'cobrado') {
        return null
    }
    const partes = [
        asignacion.cobrado_desde ? `Desde ${formatearFecha(asignacion.cobrado_desde)}` : null,
        asignacion.primer_periodo ? PRIMEROS_PERIODOS_ADICIONAL[asignacion.primer_periodo].corto : null,
    ].filter(Boolean)
    return partes.length ? partes.join(' · ') : null
}

/** Historial de bloqueos (A1): los pone y los quita el estado del servicio, nunca una persona. */
export const ACCIONES_BLOQUEO_ADICIONAL: Record<Schema<'BloqueoAdicional'>['accion'], { etiqueta: string, icono: string, color: NonNullable<BadgeProps['color']> }> = {
    bloqueado: { etiqueta: 'Bloqueado', icono: 'i-lucide-lock', color: 'error' },
    desbloqueado: { etiqueta: 'Desbloqueado', icono: 'i-lucide-lock-open', color: 'success' },
}

/** Por qué se dio de baja: texto del usuario o uno de los motivos del sistema. */
const BAJAS_SISTEMA: Record<string, string> = {
    retiro: 'Retiro del servicio',
    cambio_plan: 'Cambio de plan',
    cambio_empresa: 'Cambio de empresa',
}

export function motivoBajaLegible(motivo: string | null): string | null {
    return motivo ? BAJAS_SISTEMA[motivo] ?? motivo : null
}

function codigo() {
    return z.string()
        .trim()
        .transform(valor => valor.toUpperCase())
        .refine(valor => CODIGO.test(valor), 'Solo letras, dígitos, guion y guion bajo; empieza con letra o dígito (máx. 40)')
}

function montoOpcional(mensaje: string) {
    return z.string().trim().refine(valor => valor === '' || MONTO.test(valor), mensaje)
}

/** Espejo de `crearAdicionalValidator` / `editarAdicionalValidator` (A1). */
export const esquemaAdicional = z.object({
    codigo: codigo(),
    nombre: z.string().trim().min(2, 'Al menos 2 caracteres').max(100, 'Máximo 100 caracteres'),
    descripcion: z.string().trim().max(500, 'Máximo 500 caracteres'),
    precio_sugerido: montoOpcional('Escribe un monto con hasta 2 decimales, sin comas (ej. 45.00)'),
})

export type EntradaAdicional = z.input<typeof esquemaAdicional>
export type SalidaAdicional = z.output<typeof esquemaAdicional>

export function entradaAdicional(adicional: AdicionalApi | null): EntradaAdicional {
    return {
        codigo: adicional?.codigo ?? '',
        nombre: adicional?.nombre ?? '',
        descripcion: adicional?.descripcion ?? '',
        precio_sugerido: adicional?.precio_sugerido ?? '',
    }
}

export function cuerpoAdicional(datos: SalidaAdicional): DatosAdicionalApi {
    return {
        codigo: datos.codigo,
        nombre: datos.nombre,
        descripcion: datos.descripcion || null,
        precio_sugerido: datos.precio_sugerido ? new Decimal(datos.precio_sugerido).toFixed(2) : null,
    }
}

export function cambiosAdicional(datos: SalidaAdicional, version: number): CambiosAdicionalApi {
    return { ...cuerpoAdicional(datos), version }
}

/** Espejo de `crearMotivoCortesiaValidator` (A1). */
export const esquemaMotivoCortesia = z.object({
    codigo: codigo(),
    nombre: z.string().trim().min(2, 'Al menos 2 caracteres').max(100, 'Máximo 100 caracteres'),
})

export type EntradaMotivoCortesia = z.input<typeof esquemaMotivoCortesia>
export type SalidaMotivoCortesia = z.output<typeof esquemaMotivoCortesia>

export function cuerpoMotivoCortesia(datos: SalidaMotivoCortesia): DatosMotivoApi {
    return { codigo: datos.codigo, nombre: datos.nombre }
}

/**
 * Espejo de `agregarAdicionalValidator` / `editarAdicionalValidator` y de las reglas de la acción:
 * con `cobrado`, precio > 0 obligatorio; con `cortesia`, motivo obligatorio. El precio y el motivo
 * de las otras modalidades no se envían.
 */
export const esquemaAsignacion = z.object({
    adicional_id: z.number().int().positive().nullable().refine(valor => valor !== null, 'Elige el adicional'),
    modalidad: z.enum(['incluido', 'cortesia', 'cobrado']),
    identificador: z.string().trim().max(200, 'Máximo 200 caracteres'),
    precio: z.string().trim(),
    motivo_id: z.number().int().positive().nullable(),
    motivo_detalle: z.string().trim().max(500, 'Máximo 500 caracteres'),
    /** Solo se envía con `cobrado`. */
    primer_periodo: z.enum(['prorrateado', 'sin_costo']),
}).superRefine((datos, ctx) => {
    if (datos.modalidad === 'cobrado') {
        if (!MONTO.test(datos.precio)) {
            ctx.addIssue({ code: 'custom', path: ['precio'], message: 'Escribe el precio mensual con hasta 2 decimales (ej. 35.00)' })
        }
        else if (!new Decimal(datos.precio).gt(0)) {
            ctx.addIssue({ code: 'custom', path: ['precio'], message: 'El precio debe ser mayor que cero' })
        }
    }
    if (datos.modalidad === 'cortesia' && datos.motivo_id === null) {
        ctx.addIssue({ code: 'custom', path: ['motivo_id'], message: 'Elige el motivo de la cortesía' })
    }
})

export type EntradaAsignacion = z.input<typeof esquemaAsignacion>
export type SalidaAsignacion = z.output<typeof esquemaAsignacion>

export function entradaAsignacion(asignacion: AsignacionApi | null): EntradaAsignacion {
    return {
        adicional_id: asignacion?.adicional_id ?? null,
        modalidad: asignacion?.modalidad ?? 'cobrado',
        identificador: asignacion?.identificador ?? '',
        precio: asignacion?.precio ?? '',
        motivo_id: asignacion?.motivo_id ?? null,
        motivo_detalle: asignacion?.motivo_detalle ?? '',
        primer_periodo: asignacion?.primer_periodo ?? 'prorrateado',
    }
}

/** Precio y motivo solo con su modalidad (la API responde 422 si vienen con otra). */
function porModalidad(datos: SalidaAsignacion): Pick<DatosAsignacionApi, 'precio' | 'motivo_id' | 'motivo_detalle'> {
    return {
        precio: datos.modalidad === 'cobrado' ? new Decimal(datos.precio).toFixed(2) : null,
        motivo_id: datos.modalidad === 'cortesia' ? datos.motivo_id : null,
        motivo_detalle: datos.modalidad === 'cortesia' && datos.motivo_detalle ? datos.motivo_detalle : null,
    }
}

/** Cuerpo de `POST /servicios/:id/adicionales`; `primer_periodo` solo con `cobrado` (422 si no). */
export function cuerpoAsignacion(datos: SalidaAsignacion, credencial: string): DatosAsignacionApi {
    return {
        adicional_id: datos.adicional_id ?? 0,
        modalidad: datos.modalidad,
        identificador: datos.identificador || null,
        credencial: credencial || null,
        ...porModalidad(datos),
        primer_periodo: datos.modalidad === 'cobrado' ? datos.primer_periodo : null,
    }
}

/**
 * Cuerpo de `PUT /servicios/:id/adicionales/:asignacionId`: solo lo que cambió (más `version`),
 * para que editar el identificador de una cortesía no exija `servicios.adicional_cortesia`. La
 * credencial viaja solo si se reemplaza (`valor`) o se borra (`null`).
 */
export function cambiosAsignacion(antes: AsignacionApi, datos: SalidaAsignacion, credencial: Secreto): CambiosAsignacionApi {
    const cambios: CambiosAsignacionApi = { version: antes.version }
    const nuevos = porModalidad(datos)
    if (datos.modalidad !== antes.modalidad) {
        cambios.modalidad = datos.modalidad
    }
    if ((datos.identificador || null) !== antes.identificador) {
        cambios.identificador = datos.identificador || null
    }
    if (typeof nuevos.precio === 'string' && (antes.precio === null || !new Decimal(antes.precio).eq(nuevos.precio))) {
        cambios.precio = nuevos.precio
    }
    if (nuevos.motivo_id !== null && nuevos.motivo_id !== antes.motivo_id) {
        cambios.motivo_id = nuevos.motivo_id
    }
    if (datos.modalidad === 'cortesia' && (nuevos.motivo_detalle ?? null) !== antes.motivo_detalle) {
        cambios.motivo_detalle = nuevos.motivo_detalle ?? null
    }
    // Pasar a cobrado lo cobra desde ahora con el primer periodo elegido; seguir cobrado solo lo
    // manda si cambió. Dejar de ser cobrado lo borra la API (no se manda).
    if (datos.modalidad === 'cobrado' && (antes.modalidad !== 'cobrado' || datos.primer_periodo !== (antes.primer_periodo ?? 'prorrateado'))) {
        cambios.primer_periodo = datos.primer_periodo
    }
    if (credencial.accion === 'reemplazar' && credencial.valor) {
        cambios.credencial = credencial.valor
    }
    if (credencial.accion === 'borrar') {
        cambios.credencial = null
    }
    return cambios
}

/** Segundos que la credencial queda a la vista antes de ocultarse sola. */
export const SEGUNDOS_CREDENCIAL_VISIBLE = 30

type ListaPlanApi = paths['/api/v1/planes/{id}/adicionales']['put']['requestBody']['content']['application/json']['adicionales']

/** Espejo de `definirAdicionalesPlanValidator` (A1): hasta 100, cantidad de 1 a 50, sin repetir. */
export const esquemaAdicionalesPlan = z.object({
    adicionales: z.array(z.object({
        adicional_id: z.number().int().positive().nullable().refine(valor => valor !== null, 'Elige el adicional'),
        cantidad: z.number({ message: 'Escribe la cantidad' }).int('Solo enteros').min(1, 'De 1 a 50').max(50, 'De 1 a 50'),
    })).max(100, 'Máximo 100 adicionales por plan'),
}).superRefine((datos, ctx) => {
    const vistos = new Set<number>()
    datos.adicionales.forEach((fila, indice) => {
        if (fila.adicional_id === null) {
            return
        }
        if (vistos.has(fila.adicional_id)) {
            ctx.addIssue({ code: 'custom', path: ['adicionales', indice, 'adicional_id'], message: 'Ya está en la lista: sube la cantidad' })
        }
        vistos.add(fila.adicional_id)
    })
})

export type EntradaAdicionalesPlan = z.input<typeof esquemaAdicionalesPlan>
export type SalidaAdicionalesPlan = z.output<typeof esquemaAdicionalesPlan>

export function cuerpoAdicionalesPlan(datos: SalidaAdicionalesPlan): ListaPlanApi {
    return datos.adicionales.map(f => ({ adicional_id: f.adicional_id ?? 0, cantidad: f.cantidad }))
}
