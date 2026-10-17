import type { Problem, Schema } from '@argosisp/contracts'
import { codigoProblema } from './cobro'
import type { PresentacionEstadoUi } from './estados'

/**
 * Presentación de la integración con Horus Flow (`contratos/horus.md` 1.2.0, rama de A1+A6).
 * Horus devuelve la consulta 360 (§3.1) "tal cual" en `Horus360Servicio.datos` (objeto libre en
 * el contrato), así que aquí se lee con guardias: lo que no tenga la forma esperada no se muestra.
 */

export type ConectorHorus = Schema<'ConectorHorus'>
export type ConectorHorusGuardado = Schema<'ConectorHorusGuardado'>
export type ResultadoPruebaHorus = Schema<'ResultadoPruebaHorus'>
export type EnlaceConexionHorus = Schema<'EnlaceConexionHorus'>
export type TicketHorus = Schema<'TicketHorus'>
export type Horus360Servicio = Schema<'Horus360Servicio'>
export type SeguridadHorus = Schema<'SeguridadHorus'>
export type SeguridadServicioHorus = SeguridadHorus['items'][number]
export type TokenApi = Schema<'TokenApi'>
export type TokenHorusCreado = Schema<'TokenHorusCreado'>
export type VinculacionExterna = Schema<'VinculacionExterna'>
export type CanjeSso = Schema<'CanjeSso'>

/** Destinos de "Ver en Horus" (`abrirEnHorusValidator`). */
export type TipoDestinoHorus = 'cliente' | 'servicio' | 'router' | 'hallazgo'

/** Estado de seguridad de Horus (§3.4/§3.5). `desconocido` = Horus mandó otro valor o ninguno. */
export type EstadoSeguridad = 'clean' | 'suspected' | 'compromised' | 'desconocido'

/** Siempre icono + texto + color (regla de la identidad): el color nunca va solo. */
export const ESTADOS_SEGURIDAD: Record<EstadoSeguridad, PresentacionEstadoUi> = {
    clean: { etiqueta: 'Limpio', color: 'success', icono: 'i-lucide-shield-check' },
    suspected: { etiqueta: 'Sospechoso', color: 'warning', icono: 'i-lucide-shield-alert' },
    compromised: { etiqueta: 'Comprometido', color: 'error', icono: 'i-lucide-shield-x' },
    desconocido: { etiqueta: 'Sin dato', color: 'neutral', icono: 'i-lucide-shield-question' },
}

export function estadoSeguridad(valor: unknown): EstadoSeguridad {
    return valor === 'clean' || valor === 'suspected' || valor === 'compromised' ? valor : 'desconocido'
}

const SEVERIDADES: Record<string, PresentacionEstadoUi> = {
    low: { etiqueta: 'Baja', color: 'neutral', icono: 'i-lucide-signal-low' },
    medium: { etiqueta: 'Media', color: 'warning', icono: 'i-lucide-signal-medium' },
    high: { etiqueta: 'Alta', color: 'error', icono: 'i-lucide-signal-high' },
    critical: { etiqueta: 'Crítica', color: 'error', icono: 'i-lucide-siren' },
}

export function presentacionSeveridad(severidad: string | null): PresentacionEstadoUi {
    return (severidad && SEVERIDADES[severidad]) || { etiqueta: severidad ?? 'Sin severidad', color: 'neutral', icono: 'i-lucide-signal' }
}

/** Nombres de los tipos de hallazgo conocidos; los demás se muestran como los manda Horus. */
const TIPOS_HALLAZGO: Record<string, string> = {
    outbound_scanning: 'Escaneo saliente',
    botnet_c2: 'Contacto con botnet',
    malware: 'Malware',
    spam: 'Envío de spam',
    ddos_source: 'Origen de DDoS',
    open_resolver: 'DNS abierto',
    bruteforce: 'Fuerza bruta',
}

export function nombreTipoHallazgo(tipo: string): string {
    return TIPOS_HALLAZGO[tipo] ?? tipo
}

export interface HallazgoHorus {
    id: string
    tipo: string
    severidad: string | null
    abierto_en: string | null
    resumen: string | null
}

export interface SeguridadLeida {
    estado: EstadoSeguridad
    hallazgos_abiertos: number | null
    hallazgos: HallazgoHorus[]
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
    return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
}

const texto = (valor: unknown): string | null => (typeof valor === 'string' && valor !== '' ? valor : null)

/** `security` de la consulta 360 (§3.1), o `null` si Horus no lo mandó. */
export function leerSeguridad(datos: Horus360Servicio['datos']): SeguridadLeida | null {
    const seguridad = datos?.security
    if (!esObjeto(seguridad)) {
        return null
    }
    const lista = Array.isArray(seguridad.findings) ? seguridad.findings : []
    const hallazgos = lista.filter(esObjeto).flatMap((h): HallazgoHorus[] => {
        const id = typeof h.id === 'number' ? String(h.id) : texto(h.id)
        return id ? [{ id, tipo: texto(h.kind) ?? 'desconocido', severidad: texto(h.severity), abierto_en: texto(h.opened_at), resumen: texto(h.summary) }] : []
    })
    const abiertos = typeof seguridad.open_findings === 'number' ? seguridad.open_findings : null
    return { estado: estadoSeguridad(seguridad.state), hallazgos_abiertos: abiertos, hallazgos }
}

const MOTIVOS_OMITIDO: Record<string, string> = {
    permission: 'el código de conexión de Horus no tiene el permiso de seguridad',
    unavailable: 'el módulo de seguridad de Horus no está disponible',
    not_requested: 'no se pidió',
    not_configured: 'Horus no tiene la detección configurada',
}

/** Por qué Horus no devolvió `security` (`meta.omitted`), si lo dijo. */
export function motivoSinSeguridad(datos: Horus360Servicio['datos']): string | null {
    const meta = datos?.meta
    if (!esObjeto(meta)) {
        return null
    }
    const omitidos = meta.omitted
    let motivo: unknown = null
    if (esObjeto(omitidos)) {
        motivo = omitidos.security
    }
    else if (Array.isArray(omitidos)) {
        const fila = omitidos.find(o => esObjeto(o) && o.block === 'security')
        motivo = esObjeto(fila) ? fila.reason : null
    }
    return typeof motivo === 'string' ? (MOTIVOS_OMITIDO[motivo] ?? motivo) : null
}

/** "hace 3 min", "hace 2 h", "hace 4 días" desde `iso` hasta `ahora`. */
export function haceCuanto(iso: string, ahora: number = Date.now()): string {
    const segundos = Math.max(0, Math.round((ahora - new Date(iso).getTime()) / 1000))
    if (segundos < 60) {
        return 'hace menos de un minuto'
    }
    const minutos = Math.floor(segundos / 60)
    if (minutos < 60) {
        return `hace ${minutos} min`
    }
    const horas = Math.floor(minutos / 60)
    if (horas < 48) {
        return `hace ${horas} h`
    }
    return `hace ${Math.floor(horas / 24)} días`
}

/**
 * Marca de "último dato conocido" (`stale: true` o un dato que no salió de Horus en esta lectura):
 * "Dato de hace 12 min". `null` si el dato es fresco o no se sabe cuándo se obtuvo.
 */
export function marcaDatoViejo(stale: boolean, actualizadoEn: string | null, ahora: number = Date.now()): string | null {
    if (!stale || !actualizadoEn) {
        return stale ? 'Dato de una lectura anterior' : null
    }
    return `Dato de ${haceCuanto(actualizadoEn, ahora)}`
}

/** "14:32" restantes de un enlace o ticket (`mm:ss`), o `null` si ya venció. */
export function tiempoRestante(venceEn: string, ahora: number = Date.now()): string | null {
    const segundos = Math.floor((new Date(venceEn).getTime() - ahora) / 1000)
    if (segundos <= 0) {
        return null
    }
    const mm = String(Math.floor(segundos / 60)).padStart(2, '0')
    const ss = String(segundos % 60).padStart(2, '0')
    return `${mm}:${ss}`
}

/** El conector está apagado según un error de la API (422 `horus_apagado` o 503 del receptor). */
export function esHorusApagado(problema: Problem): boolean {
    return codigoProblema(problema) === 'horus_apagado'
}

/**
 * Ruta del panel a la que lleva un canje SSO. Solo rutas locales (`/…`, nunca `//host`); el router
 * del destino `/routers/:id` también existe en el panel (ficha del router).
 */
export function rutaLocalSegura(ruta: string | null | undefined): string {
    return typeof ruta === 'string' && ruta.startsWith('/') && !ruta.startsWith('//') && !ruta.includes('\\') ? ruta : '/'
}

/** Ticket del fragmento (`#<ticket>`) de `/sso/entrar`, o `null` si no parece uno. */
export function ticketDelFragmento(hash: string): string | null {
    const ticket = decodeURIComponent(hash.replace(/^#/, '')).trim()
    return ticket.length >= 20 && ticket.length <= 200 ? ticket : null
}

/** Mensaje para el usuario de un error de `/sso/entrar` (canje o vinculación). */
export function mensajeErrorSso(problema: Problem): { titulo: string, detalle: string } {
    const codigo = codigoProblema(problema)
    if (problema.status === 410 || codigo === 'ticket_invalido' || codigo === 'vinculacion_invalida') {
        return { titulo: 'El enlace venció', detalle: 'Los enlaces de Horus duran 60 segundos y sirven una sola vez. Vuelve a abrirlo desde Horus.' }
    }
    if (problema.status === 401) {
        return { titulo: 'Correo o contraseña incorrectos', detalle: problema.detail ?? 'Revisa tus credenciales de ArgosIsp.' }
    }
    if (problema.status === 429) {
        return { titulo: 'Demasiados intentos', detalle: problema.detail ?? 'Espera unos minutos e intenta de nuevo.' }
    }
    return { titulo: problema.title, detalle: problema.detail ?? 'No se pudo completar el inicio de sesión desde Horus.' }
}

/** Texto de la explicación de un botón "Ver en Horus" deshabilitado. */
export const EXPLICACION_HORUS = {
    sinPermiso: 'Necesitas el permiso horus.abrir para abrir registros en Horus.',
    apagado: 'La integración con Horus está apagada. Actívala en Configuración → Integraciones.',
} as const
