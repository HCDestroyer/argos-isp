import type { Schema } from '@argosisp/contracts'

/*
| Presentación compartida de las pantallas de Red (rediseño, tableros RedRouters, RedRouterFicha,
| RedIps, RedSesiones y OperServicioFicha). Solo arma textos y tonos a partir de lo que da la API:
| nunca inventa un número que no llegó.
*/

type RouterLista = Pick<Schema<'Router'>, 'activo' | 'en_linea' | 'ultimo_contacto' | 'unido_a_id'>

/** Estado del router en la lista: el de contacto más «Por conectar» (nunca respondió) e «Inactivo». */
export type EstadoListaRouter = 'en_linea' | 'caido' | 'por_conectar' | 'desconocido' | 'inactivo'

export const ESTADOS_LISTA_ROUTER: Record<EstadoListaRouter, { etiqueta: string, icono: string, color: 'success' | 'error' | 'neutral' | 'warning', tono: string }> = {
    en_linea: { etiqueta: 'En línea', icono: 'i-lucide-circle-check', color: 'success', tono: 'tono-exito' },
    caido: { etiqueta: 'Caído', icono: 'i-lucide-circle-x', color: 'error', tono: 'tono-error' },
    por_conectar: { etiqueta: 'Por conectar', icono: 'i-lucide-plug', color: 'neutral', tono: '' },
    desconocido: { etiqueta: 'Sin medir', icono: 'i-lucide-circle-help', color: 'neutral', tono: '' },
    inactivo: { etiqueta: 'Inactivo', icono: 'i-lucide-circle-pause', color: 'neutral', tono: '' },
}

export function estadoListaRouter(router: RouterLista): EstadoListaRouter {
    if (!router.activo) {
        return 'inactivo'
    }
    if (router.en_linea === true) {
        return 'en_linea'
    }
    if (router.en_linea === false) {
        return 'caido'
    }
    return router.ultimo_contacto ? 'desconocido' : 'por_conectar'
}

/** Debajo del estado: «contacto hace 2 min», «sin contacto hace 14 min» o «falta correr el script». */
export function detalleContactoRouter(router: RouterLista, ahora: number = Date.now()): string {
    const estado = estadoListaRouter(router)
    if (estado === 'por_conectar') {
        return 'nunca respondió'
    }
    if (!router.ultimo_contacto) {
        return 'sin contacto'
    }
    const hace = haceCuanto(router.ultimo_contacto, ahora)
    return estado === 'caido' ? `sin contacto ${hace}` : `contacto ${hace}`
}

/** Etiqueta corta del tipo de conexión del router («PPPoE», «IP estática», «DHCP fija»). */
export function tipoConexionCorto(tipo: Schema<'Router'>['tipo_conexion']): string {
    return tipo === 'dhcp_fija' ? 'DHCP fija' : ETIQUETAS_TIPO_CONEXION[tipo]
}

/** El modo de control de velocidad que rige en el router (el de su tipo de conexión). */
export function controlRouter(router: Pick<Schema<'Router'>, 'tipo_conexion' | 'estrategia_velocidad'>) {
    const estrategia = router.estrategia_velocidad[router.tipo_conexion]
    return {
        estrategia,
        etiqueta: OPCIONES_APLICACION[estrategia.aplicacion].etiqueta,
        icono: DETALLE_APLICACION[estrategia.aplicacion].icono,
        padre: OPCIONES_PADRE[estrategia.padre].etiqueta,
    }
}

/** Porcentaje de la ocupación de una red o pool, o `null` si no hay direcciones. */
export function porcentajeOcupacion(ocupacion: Pick<Schema<'OcupacionPool'>, 'total' | 'porcentaje'> | null | undefined): number | null {
    if (!ocupacion || ocupacion.total <= 0) {
        return null
    }
    return ocupacion.porcentaje
}

/** Umbral desde el que una red se avisa como «casi llena». */
export const UMBRAL_RED_LLENA = 85

/** Número con separador de miles (`1,295`), como en los tableros. */
export function formatearEntero(valor: number): string {
    return new Intl.NumberFormat('en-US').format(valor)
}
