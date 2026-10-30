import type { Problem, Schema } from '@argosisp/contracts'

/**
 * Modo de seguridad del router (A1, `apps/api/app/network/README.md`, «Modo de seguridad»):
 *
 * - `radius` (por defecto): PPPoE por RADIUS y CoA, más `ip_estatica` / `dhcp_fija` por la API REST.
 *   La IP del NAS es obligatoria.
 * - `api`: router sin RADIUS. Todo por la API REST de RouterOS: `ip_estatica` y `dhcp_fija` con colas y
 *   listas, y PPPoE con un `/ppp/secret` local por servicio (`contratos/pppoe-local.md`): sin consumo
 *   de datos ni cambios al instante (el perfil nuevo rige al reconectar) y sesiones leídas por sondeo
 *   de `/ppp/active` cada minuto (`Sesion.origen = 'sondeo'`). PPPoE exige las credenciales de la API
 *   (422 `pppoe_local_requiere_api`). `nas_ip` y `radius_secret` son opcionales (la API devuelve
 *   `nas_ip: null`) y no admite el script de conexión (422 `script_requiere_radius`).
 */
export type ModoSeguridad = Schema<'Router'>['modo_seguridad']

export const MODOS_SEGURIDAD: Record<ModoSeguridad, { etiqueta: string, opcion: string, descripcion: string, icono: string, color: 'neutral' | 'info' }> = {
    radius: {
        etiqueta: 'RADIUS',
        opcion: 'RADIUS (recomendado)',
        descripcion: 'PPPoE autenticado por RADIUS, con corte y velocidad por CoA. También admite IP estática y DHCP fija.',
        icono: 'i-lucide-shield-check',
        color: 'neutral',
    },
    api: {
        etiqueta: 'Sin RADIUS',
        opcion: 'Sin RADIUS (todo por la API REST)',
        descripcion: 'Argos configura, limita y corta cada servicio con la API REST de RouterOS; PPPoE va como secrets locales, sin consumo de datos. No pide IP del NAS ni secreto RADIUS.',
        icono: 'i-lucide-plug',
        color: 'info',
    },
}

export function esSinRadius(router: Pick<Schema<'Router'>, 'modo_seguridad'> | null | undefined): boolean {
    return router?.modo_seguridad === 'api'
}

/** La IP del NAS para mostrar: «Sin RADIUS» en un router `api` sin ella, «—» si falta en otro caso. */
export function textoNas(router: { nas_ip?: string | null, modo_seguridad?: ModoSeguridad }): string {
    if (router.nas_ip) {
        return router.nas_ip
    }
    return router.modo_seguridad === 'api' || router.modo_seguridad === undefined ? 'Sin RADIUS' : '—'
}

/** «host · NAS 10.0.0.1» o «host · sin RADIUS» (selectores de unión, migración, velocidad). */
export function hostYNas(router: { host: string, nas_ip?: string | null, modo_seguridad?: ModoSeguridad }): string {
    return router.nas_ip ? `${router.host} · NAS ${router.nas_ip}` : `${router.host} · sin RADIUS`
}

/** Ayuda del tipo PPPoE en un router sin RADIUS (`contratos/pppoe-local.md`). */
export const AYUDA_PPPOE_SIN_RADIUS = 'Sin RADIUS: el usuario se crea como secret en el MikroTik; sin consumo de datos ni cambios al instante.'

/**
 * Cómo funciona PPPoE en un router `api` (ficha del router): secrets locales, sesiones por sondeo
 * cada minuto y sin consumo.
 */
export const PPPOE_EN_ROUTER_SIN_RADIUS = 'PPPoE va con secrets locales que Argos crea por la API; las sesiones se leen de /ppp/active cada minuto y no hay consumo de datos. Un cambio de plan o de estado quita la sesión y rige al reconectar.'

/** Texto del panel para el 422 `pppoe_local_requiere_api` (el `detail` de la API queda debajo). */
export const MENSAJE_PPPOE_LOCAL_REQUIERE_API = 'El router no tiene credenciales de la API: agrégalas en la ficha del router.'

/** Al pasar un router de `api` a `radius` (`contratos/pppoe-local.md` §9). */
export const AVISO_SIN_RADIUS_A_RADIUS = 'El reconciliador borra los secrets PPPoE que Argos creó en el router (los puestos a mano no se tocan). Las sesiones vivas siguen hasta caerse y reconectan por RADIUS: antes de guardar, configura /radius en el router y usa «Probar conexión».'

/** Si el router tiene usuario y contraseña de la API (lo que necesita PPPoE sin RADIUS). */
export function tieneCredencialesApi(router: Pick<Schema<'Router'>, 'api_usuario' | 'tiene_api_password'> | null | undefined): boolean {
    return Boolean(router?.api_usuario && router.tiene_api_password)
}

/** PPPoE en un router sin RADIUS que no tiene credenciales de la API: la API respondería 422. */
export function pppoeSinCredencialesApi(router: Pick<Schema<'Router'>, 'modo_seguridad' | 'api_usuario' | 'tiene_api_password'> | null | undefined): boolean {
    return esSinRadius(router) && !tieneCredencialesApi(router)
}

export const MENSAJE_SCRIPT_SIN_RADIUS = 'Este router no usa RADIUS y el script de conexión configura RADIUS y CoA en el equipo. Cámbialo a RADIUS para usar el script, o configura a mano el acceso a su API REST.'

/** Mensaje de la IP del NAS cuando falta en un router con RADIUS (espejo de `MENSAJE_NAS_IP_REQUERIDA`). */
export const MENSAJE_NAS_REQUERIDA = 'La IP del NAS es obligatoria con RADIUS. Si el router no usa RADIUS (todo por la API REST), elige «Sin RADIUS».'

export const PATRON_IPV4_NAS = /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/

/**
 * Regla de la IP del NAS por modo, para el `superRefine` de los formularios de router: obligatoria
 * con `radius`; con `api` se ignora (el campo no se muestra ni se manda).
 */
export function errorNas(modo: ModoSeguridad, nas: string): string | null {
    if (modo !== 'radius') {
        return null
    }
    if (!nas.trim()) {
        return MENSAJE_NAS_REQUERIDA
    }
    return PATRON_IPV4_NAS.test(nas.trim()) ? null : 'Escribe la IPv4 con la que el router habla con RADIUS, como 10.0.0.1'
}

function codigo(problema: Problem | null | undefined): string | null {
    const prefijo = 'urn:argosisp:problema:'
    return problema?.type.startsWith(prefijo) ? problema.type.slice(prefijo.length) : null
}

/** 422 `pppoe_local_requiere_api` (`errors[0].field = router_id`): router `api` sin credenciales. */
export function esPppoeLocalRequiereApi(problema: Problem | null | undefined): boolean {
    return codigo(problema) === 'pppoe_local_requiere_api'
}

export function esScriptRequiereRadius(problema: Problem | null | undefined): boolean {
    return codigo(problema) === 'script_requiere_radius'
}

export interface ServiciosPppoeEnRouter {
    /** Total de servicios PPPoE sin retirar (del `detail`; si no se puede leer, los listados). */
    total: number
    /** Los listados en `errors[]` (hasta 50), con su enlace. */
    servicios: { id: number, texto: string }[]
}

/**
 * 422 `servicios_pppoe_en_router` al pasar un router a «Sin RADIUS»: un `errors[]` por servicio
 * (`field: servicios.<id>`, hasta 50) y el total en `detail`. `null` si el problema es otro.
 */
export function serviciosPppoeEnRouter(problema: Problem | null | undefined): ServiciosPppoeEnRouter | null {
    if (!problema || codigo(problema) !== 'servicios_pppoe_en_router') {
        return null
    }
    const servicios = (problema.errors ?? []).flatMap((error) => {
        const id = /^servicios\.(\d+)$/.exec(error.field)?.[1]
        return id ? [{ id: Number(id), texto: error.message }] : []
    })
    const enDetalle = /(\d+)\s+servicios?\s+PPPoE/i.exec(problema.detail ?? '')?.[1]
    return { total: enDetalle ? Number(enDetalle) : servicios.length, servicios }
}
