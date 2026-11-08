import type { Schema } from '@argosisp/contracts'

/**
 * Identificación del cliente cortado (`contratos/corte-identificacion.md` §5 P1 y §5 bis), por router:
 *
 * - `codigo`: el router manda a cada suspendido a `/corte?c=<código>` con su web proxy (puerto 3346,
 *   cerrado desde afuera). Necesita la API del router (usuario y clave): sin ella la API responde 422
 *   `corte_codigo_sin_api` en `corte_identificacion`, también al borrar la clave de un router en `codigo`.
 * - `ip`: el portal identifica por la IP de origen en el primer salto (el destino del dst-nat). Fase 2
 *   (§5 ter): si el router está registrado en el túnel WireGuard, el corte va por el túnel sin NAT; también
 *   funciona con el servidor en la LAN del ISP o por IPv6. Ese primer salto emite el código de la suspensión
 *   y redirige con `?c=`, así que el resto de la visita no depende de la IP.
 *
 * Decisión del PM: el formulario del panel obliga a elegirlo (sin valor preseleccionado en el alta) y
 * sugiere `codigo` cuando el router tiene API. La API, sin el campo, deja `ip`.
 */
export type CorteIdentificacion = Schema<'Router'>['corte_identificacion']

export const CORTE_IDENTIFICACION: Record<CorteIdentificacion, { etiqueta: string, opcion: string, descripcion: string, icono: string }> = {
    codigo: {
        etiqueta: 'Por código',
        opcion: 'Por código (recomendado si el router tiene API)',
        descripcion: 'El router manda a cada suspendido a la página de corte con su propio código. No depende de la IP que vea el servidor.',
        icono: 'i-lucide-ticket',
    },
    ip: {
        etiqueta: 'Por IP',
        opcion: 'Por IP (por el túnel WireGuard o sin NAT entre el router y Argos)',
        descripcion: 'La página de corte reconoce al cliente por la IP con la que llega: por el túnel WireGuard, la LAN del ISP o IPv6. Con masquerade, NPM u otro proxy en medio no lo reconoce.',
        icono: 'i-lucide-map-pin',
    },
}

/** Ayuda corta del modo código: qué toca Argos en el router. */
export const AYUDA_CORTE_CODIGO = 'En modo código Argos activa el proxy web del router en el puerto 3346, cerrado desde afuera. Si el proxy ya se usa para otra cosa, solo agrega su puerto y no toca lo demás.'

/** Mismo texto que `exigirApiSiCodigo` (A5) para el error local antes de mandar el formulario. */
export const MENSAJE_CORTE_CODIGO_SIN_API = 'La identificación por código necesita la API del router (usuario y clave): Argos escribe en el router la regla de cada suspendido. Sin API, usa «Por IP».'

/** Por qué `codigo` está deshabilitado en el selector. */
export const CODIGO_SIN_API = 'Necesita el usuario y la contraseña de la API del router.'

export const MENSAJE_CORTE_OBLIGATORIO = 'Elige cómo identificar al cliente cortado'

/**
 * Opciones del selector: `codigo` deshabilitado sin API, salvo que ya esté elegido (así se ve el error
 * del campo y el operador puede cambiarlo).
 */
export function itemsCorteIdentificacion(conApi: boolean, elegido: CorteIdentificacion | undefined) {
    return (['codigo', 'ip'] as const).map(valor => ({
        label: CORTE_IDENTIFICACION[valor].opcion,
        value: valor,
        description: valor === 'codigo' && !conApi ? `${CORTE_IDENTIFICACION.codigo.descripcion} ${CODIGO_SIN_API}` : CORTE_IDENTIFICACION[valor].descripcion,
        disabled: valor === 'codigo' && !conApi && elegido !== 'codigo',
    }))
}

/** Texto de ayuda del campo según lo elegido y si el router tiene API. */
export function ayudaCorteIdentificacion(conApi: boolean, elegido: CorteIdentificacion | undefined): string {
    if (elegido === 'codigo') {
        return AYUDA_CORTE_CODIGO
    }
    if (elegido === 'ip') {
        return conApi
            ? 'Si el diagnóstico de corte dice que el portal ve otra IP, pasa este router a «Por código».'
            : 'Sin la API del router es la única opción. Si el diagnóstico de corte dice que el portal ve otra IP, agrega la API y pasa a «Por código».'
    }
    return conApi
        ? 'Sugerido: «Por código», porque el router tiene API.'
        : 'Sin la API del router solo se puede «Por IP».'
}

/** El 422 `corte_codigo_sin_api` de la API (A5), en el campo `corte_identificacion`. */
export function esCorteCodigoSinApi(problema: { errors?: { field: string, rule?: string }[] } | null | undefined): boolean {
    return (problema?.errors ?? []).some(e => e.field === 'corte_identificacion' && e.rule === 'corte_codigo_sin_api')
}

export type CodigoCorteServicio = Schema<'CodigoCorteServicio'>

export interface PresentacionCodigoCorte {
    estado: 'activo' | 'gracia' | 'cerrado' | 'sin_codigo'
    etiqueta: string
    color: 'success' | 'warning' | 'neutral'
    icono: string
    detalle: string
}

/**
 * Estado del código de corte para la ficha del servicio. Nunca hay código que mostrar: la API no lo da.
 * Lo emite el router (modo `codigo`) o, desde la fase 2 (§5 ter.1), el primer salto del portal cuando
 * identifica al suspendido por su IP (modo `ip`: túnel WireGuard, LAN del ISP o IPv6). Por eso `activo`
 * puede venir en los dos modos.
 */
export function presentarCodigoCorte(codigo: CodigoCorteServicio, ahora: number = Date.now()): PresentacionCodigoCorte {
    const porCodigo = codigo.corte_identificacion === 'codigo'
    if (codigo.activo) {
        const quien = porCodigo
            ? 'El router manda a este suspendido a la página de corte con su código.'
            : 'El portal identificó a este suspendido por su IP y le dio su código: la página de corte lo sigue reconociendo aunque el resto del camino tenga NAT.'
        return {
            estado: 'activo',
            etiqueta: 'Activo',
            color: 'success',
            icono: 'i-lucide-ticket-check',
            detalle: codigo.creado_en ? `Activo desde ${formatearFechaHora(codigo.creado_en)}. ${quien}` : quien,
        }
    }
    if (codigo.cerrado_en) {
        // `resuelve_hasta` (A5): cierre + la gracia del servidor (`PORTAL_CODIGO_CORTE_GRACIA_MIN`).
        if (codigo.resuelve_hasta && ahora < new Date(codigo.resuelve_hasta).getTime()) {
            return {
                estado: 'gracia',
                etiqueta: 'En gracia',
                color: 'warning',
                icono: 'i-lucide-hourglass',
                detalle: `Cerrado el ${formatearFechaHora(codigo.cerrado_en)} al dejar de estar suspendido. Sigue abriendo la página de corte hasta ${formatearFechaHora(codigo.resuelve_hasta)} para mostrar «ya tienes servicio».`,
            }
        }
        return {
            estado: 'cerrado',
            etiqueta: 'Sin código',
            color: 'neutral',
            icono: 'i-lucide-ticket-x',
            detalle: `El último se cerró el ${formatearFechaHora(codigo.cerrado_en)}. ${porCodigo ? 'Se emite uno nuevo en la próxima suspensión.' : 'En la próxima suspensión se emite uno nuevo cuando el portal lo identifique por su IP.'}`,
        }
    }
    return {
        estado: 'sin_codigo',
        etiqueta: 'Sin código',
        color: 'neutral',
        icono: 'i-lucide-ticket-x',
        detalle: porCodigo
            ? 'Nunca ha tenido código: se emite al suspenderse.'
            : 'Nunca ha tenido código: en este router lo emite el portal la primera vez que identifica al suspendido por su IP (túnel WireGuard, LAN del ISP o IPv6).',
    }
}

/**
 * «Corte por el túnel» en la ficha del router (§5 ter.3, `corteTunelDeRouter`): el dst-nat del corte va
 * a la IP del servidor en el túnel WireGuard, sin NAT, así que el portal ve la IP del cliente.
 *
 * TEMPORAL: A1 agrega `corte_por_tunel` y `corte_por_tunel_motivo` a `Router` en `a1/corte-fase2`, que
 * todavía no está en `packages/contracts`. Mientras tanto se leen como opcionales encima del schema; al
 * mezclar A1 y regenerar contracts, `RouterCorteTunel` pasa a ser `Schema<'Router'>` y esta intersección
 * se borra (anotado en `.claude/integration/a4.md`). Sin el campo no se muestra nada: nunca un «no»
 * inventado.
 */
export type RouterCorteTunel = Schema<'Router'> & {
    corte_por_tunel?: boolean
    corte_por_tunel_motivo?: string | null
}

export interface PresentacionCorteTunel {
    etiqueta: string
    color: 'success' | 'neutral'
    icono: string
    motivo: string | null
}

export function presentarCorteTunel(router: RouterCorteTunel): PresentacionCorteTunel | null {
    if (router.corte_por_tunel === undefined) {
        return null
    }
    if (router.corte_por_tunel) {
        return { etiqueta: 'Corte por el túnel: sí', color: 'success', icono: 'i-lucide-shield-check', motivo: null }
    }
    return {
        etiqueta: 'Corte por el túnel: no',
        color: 'neutral',
        icono: 'i-lucide-shield-off',
        motivo: router.corte_por_tunel_motivo?.trim() || 'La API no dijo por qué.',
    }
}
