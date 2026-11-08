import type { Schema } from '@argosisp/contracts'

/**
 * Identificación del cliente cortado (`contratos/corte-identificacion.md` §5 P1 y §5 bis), por router:
 *
 * - `codigo`: el router manda a cada suspendido a `/corte?c=<código>` con su web proxy (puerto 3346,
 *   cerrado desde afuera). Necesita la API del router (usuario y clave): sin ella la API responde 422
 *   `corte_codigo_sin_api` en `corte_identificacion`, también al borrar la clave de un router en `codigo`.
 * - `ip`: el portal identifica por la IP de origen; solo funciona sin NAT ni proxy entre el router y Argos.
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
        opcion: 'Por IP (solo si no hay NAT ni proxy entre el router y Argos)',
        descripcion: 'La página de corte reconoce al cliente por la IP con la que llega. Con masquerade, NPM u otro proxy en medio no lo reconoce.',
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

/**
 * Minutos que un código cerrado sigue resolviendo (P5, `PORTAL_CODIGO_CORTE_GRACIA_MIN`, 30 por
 * defecto). La API no lo devuelve: si el servidor lo cambia, «en gracia» es aproximado (pedido en a4.md).
 */
export const GRACIA_CODIGO_CORTE_MIN = 30

export interface PresentacionCodigoCorte {
    estado: 'activo' | 'gracia' | 'cerrado' | 'sin_codigo'
    etiqueta: string
    color: 'success' | 'warning' | 'neutral'
    icono: string
    detalle: string
}

/** Estado del código de corte para la ficha del servicio. Nunca hay código que mostrar: la API no lo da. */
export function presentarCodigoCorte(codigo: CodigoCorteServicio, ahora: number = Date.now()): PresentacionCodigoCorte {
    if (codigo.activo) {
        return {
            estado: 'activo',
            etiqueta: 'Activo',
            color: 'success',
            icono: 'i-lucide-ticket-check',
            detalle: codigo.creado_en
                ? `Activo desde ${formatearFechaHora(codigo.creado_en)}. El router manda a este suspendido a la página de corte con su código.`
                : 'El router manda a este suspendido a la página de corte con su código.',
        }
    }
    if (codigo.cerrado_en) {
        const cerrado = new Date(codigo.cerrado_en).getTime()
        const hasta = cerrado + GRACIA_CODIGO_CORTE_MIN * 60_000
        if (ahora < hasta) {
            return {
                estado: 'gracia',
                etiqueta: 'En gracia',
                color: 'warning',
                icono: 'i-lucide-hourglass',
                detalle: `Cerrado el ${formatearFechaHora(codigo.cerrado_en)} al dejar de estar suspendido. Sigue abriendo la página de corte hasta ${formatearFechaHora(new Date(hasta).toISOString())} para mostrar «ya tienes servicio».`,
            }
        }
        return {
            estado: 'cerrado',
            etiqueta: 'Sin código',
            color: 'neutral',
            icono: 'i-lucide-ticket-x',
            detalle: `El último se cerró el ${formatearFechaHora(codigo.cerrado_en)}. Se emite uno nuevo en la próxima suspensión${codigo.corte_identificacion === 'codigo' ? '' : ' si el router pasa a «Por código»'}.`,
        }
    }
    return {
        estado: 'sin_codigo',
        etiqueta: 'Sin código',
        color: 'neutral',
        icono: 'i-lucide-ticket-x',
        detalle: codigo.corte_identificacion === 'codigo'
            ? 'Nunca ha tenido código: se emite al suspenderse.'
            : 'Sin código: el router identifica por IP.',
    }
}
