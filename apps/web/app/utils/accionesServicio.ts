import type { ButtonProps } from '@nuxt/ui'
import * as z from 'zod'

/**
 * Presentación de las acciones explícitas del servicio. `permiso` es el mismo nombre de la
 * acción en el ACL (`apps/api/app/core/permisos.ts`); `desde` son los estados en los que el
 * botón está habilitado (la API vuelve a validar y responde 422 si no aplica).
 */
export interface PresentacionAccionServicio {
    accion: AccionServicio
    etiqueta: string
    /** Texto del botón de confirmación del modal. */
    confirmar: string
    /** Qué pasa en la red al confirmar. */
    efecto: string
    icono: string
    color: NonNullable<ButtonProps['color']>
    permiso: string
    desde: EstadoServicio[]
    /** Mensaje del toast al terminar bien. */
    hecho: string
}

export const ACCIONES_SERVICIO: PresentacionAccionServicio[] = [
    {
        accion: 'suspender',
        etiqueta: 'Suspender',
        confirmar: 'Suspender servicio',
        efecto: 'El cliente queda cortado: su navegación se redirige a la página de corte.',
        icono: 'i-lucide-circle-x',
        color: 'error',
        permiso: 'servicios.suspender',
        desde: ['activo', 'limitado'],
        hecho: 'Servicio suspendido',
    },
    {
        accion: 'reactivar',
        etiqueta: 'Reactivar',
        confirmar: 'Reactivar servicio',
        efecto: 'Se desconecta la sesión para que el equipo vuelva a conectarse con navegación completa.',
        icono: 'i-lucide-circle-check',
        color: 'success',
        permiso: 'servicios.reactivar',
        desde: ['suspendido'],
        hecho: 'Servicio reactivado',
    },
    {
        accion: 'limitar',
        etiqueta: 'Limitar',
        confirmar: 'Limitar velocidad',
        efecto: 'La velocidad baja a la limitada del plan hasta que se quite el límite.',
        icono: 'i-lucide-gauge',
        color: 'warning',
        permiso: 'servicios.limitar',
        desde: ['activo'],
        hecho: 'Velocidad limitada',
    },
    {
        accion: 'quitar_limite',
        etiqueta: 'Quitar límite',
        confirmar: 'Quitar límite',
        efecto: 'El servicio vuelve a la velocidad completa del plan.',
        icono: 'i-lucide-gauge-circle',
        color: 'success',
        permiso: 'servicios.quitar_limite',
        desde: ['limitado'],
        hecho: 'Límite de velocidad quitado',
    },
    {
        accion: 'desconectar',
        etiqueta: 'Desconectar sesión',
        confirmar: 'Desconectar sesión',
        efecto: 'Se envía un Disconnect al router; el equipo del cliente vuelve a conectarse solo.',
        icono: 'i-lucide-unplug',
        color: 'neutral',
        permiso: 'servicios.desconectar',
        desde: ['activo', 'limitado', 'suspendido'],
        hecho: 'Sesión desconectada',
    },
    {
        accion: 'retirar',
        etiqueta: 'Retirar',
        confirmar: 'Retirar servicio',
        efecto: 'Baja definitiva: se liberan la IPv4 y los prefijos IPv6 y no se puede deshacer.',
        icono: 'i-lucide-archive',
        color: 'error',
        permiso: 'servicios.retirar',
        desde: ['activo', 'limitado', 'suspendido'],
        hecho: 'Servicio retirado',
    },
]

/**
 * Acciones que la API rechaza sobre un servicio suspendido a mano (422 `suspension_manual`):
 * solo "Reactivar" quita la marca, para que no se salte por otro camino.
 */
export const BLOQUEADAS_POR_SUSPENSION_MANUAL: readonly AccionServicio[] = ['limitar', 'quitar_limite']

/**
 * Si el botón de la acción se muestra para este servicio: aplica a su estado y no la bloquea
 * una suspensión manual. Los permisos se revisan aparte (`usePermisos`).
 */
export function accionDisponible(
    accion: PresentacionAccionServicio,
    servicio: Pick<Servicio, 'estado' | 'suspension_manual'>,
): boolean {
    if (!accion.desde.includes(servicio.estado)) {
        return false
    }
    return !(servicio.suspension_manual && BLOQUEADAS_POR_SUSPENSION_MANUAL.includes(accion.accion))
}

/** Espejo del cuerpo de `POST /servicios/:id/<acción>`: `motivo` de 3 a 500 caracteres. */
export const esquemaMotivo = z.object({
    motivo: z.string().trim().min(3, 'Escribe el motivo (al menos 3 caracteres)').max(500, 'Máximo 500 caracteres'),
})

export type DatosMotivo = z.output<typeof esquemaMotivo>
