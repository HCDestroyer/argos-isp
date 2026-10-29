import type { Aplicacion, Estrategia, EstrategiaParcial, EstrategiasPlan, EstrategiasRouter, Extra, MatrizControlVelocidad, Padre, TipoCola, TipoConexionVelocidad } from '~/types/controlVelocidad'
import { APLICACIONES, EXTRAS, PADRES, TIPOS_COLA, TIPOS_CONEXION_VELOCIDAD } from '~/types/controlVelocidad'

/**
 * Control de velocidad por capas (`contratos/control-velocidad.md`): textos en lenguaje simple de
 * cada opción, la estrategia efectiva de un plan (router capa por capa sobrescrito por el plan) y
 * qué opciones admite la matriz para un tipo de conexión, con el porqué de las que no. La API valida
 * igual (`validarEstrategias()`): el panel solo deshabilita para no dejar elegir algo que rechazaría.
 */

export const ETIQUETAS_TIPO_CONEXION: Record<TipoConexionVelocidad, string> = {
    pppoe: 'PPPoE',
    ip_estatica: 'IP estática',
    dhcp_fija: 'DHCP con IP fija',
}

export const OPCIONES_APLICACION: Record<Aplicacion, { etiqueta: string, explicacion: string, escenario: string }> = {
    radius_rate_limit: {
        etiqueta: 'RADIUS por sesión',
        explicacion: 'La velocidad viaja con la sesión PPPoE: el router crea una cola por cliente al conectarse.',
        escenario: 'Lo habitual en PPPoE: cada cliente con su plan, sin tocar el router a mano.',
    },
    perfil_ppp: {
        etiqueta: 'Perfil PPP del plan',
        explicacion: 'La velocidad vive en el perfil PPP de cada plan; RADIUS solo dice qué perfil usar.',
        escenario: 'Cuando quieres ver y ajustar la velocidad de cada plan en Winbox, en PPP → Profiles.',
    },
    cola_simple: {
        etiqueta: 'Cola simple por API',
        explicacion: 'ArgosIsp crea una cola simple por cliente en el router: para IP estática y DHCP.',
        escenario: 'Antenas o clientes con IP fija, sin PPPoE.',
    },
    pcq_plan: {
        etiqueta: 'PCQ por plan',
        explicacion: 'Una sola cola por plan reparte el ancho del plan entre sus clientes, en partes iguales.',
        escenario: 'Muchos clientes por router: menos colas que una por cliente y menos carga de CPU.',
    },
    arbol_pcq: {
        etiqueta: 'Árbol de colas con PCQ',
        explicacion: 'Queue tree con marcas: el router reparte por plan y por cliente con garantía y reuso.',
        escenario: 'Routers grandes (cientos o miles de clientes) que necesitan techo global y garantía por plan.',
    },
}

export const OPCIONES_PADRE: Record<Padre, { etiqueta: string, explicacion: string }> = {
    ninguno: { etiqueta: 'Sin agrupar', explicacion: 'Cada cliente solo con su tope; nada limita la suma.' },
    por_plan: { etiqueta: 'Por plan', explicacion: 'Los clientes de un plan comparten su ancho según el reuso (solo con reuso mayor a 1).' },
    por_router: { etiqueta: 'Techo del router', explicacion: 'Todos los clientes comparten la capacidad del enlace del router.' },
    jerarquico: { etiqueta: 'Router → plan → cliente', explicacion: 'Techo del router, debajo cada plan con su reuso y debajo cada cliente.' },
}

export const OPCIONES_TIPO_COLA: Record<TipoCola, { etiqueta: string, explicacion: string }> = {
    default: { etiqueta: 'Por defecto', explicacion: 'Lo que trae RouterOS: sin cambios.' },
    sfq: { etiqueta: 'SFQ', explicacion: 'Reparte el tráfico de un cliente entre sus conexiones: una descarga no tapa todo.' },
    fq_codel: { etiqueta: 'fq_codel', explicacion: 'Reduce la latencia bajo carga: videollamadas y juegos van mejor. Requiere RouterOS 7.' },
    cake: { etiqueta: 'CAKE', explicacion: 'Reduce la latencia bajo carga y reparte de forma justa entre dispositivos. Requiere RouterOS 7.' },
    pcq: { etiqueta: 'PCQ', explicacion: 'Reparte entre varios clientes: obligatorio con PCQ por plan y árbol de colas.' },
}

export const OPCIONES_EXTRA: Record<Extra, { etiqueta: string, explicacion: string }> = {
    rafaga: { etiqueta: 'Ráfaga', explicacion: 'El cliente navega más rápido unos segundos al empezar una descarga, si el plan la define.' },
    prioridad: { etiqueta: 'Prioridad', explicacion: 'Los planes con más prioridad pasan primero cuando el enlace se llena.' },
    garantizado: { etiqueta: 'Velocidad garantizada', explicacion: 'Reserva el mínimo del plan (CIR) aunque el enlace esté lleno.' },
    excluir_fasttrack: { etiqueta: 'Verificar FastTrack', explicacion: 'Revisa que FastTrack no se salte las colas: sin esto, lo acelerado no se limita.' },
}

/**
 * Estrategias del router: las que trae la API (`Router.estrategia_velocidad`, siempre presente; la
 * migración y el alta con `control_velocidad` ya las resuelven con los atajos de la matriz).
 */
export function estrategiasDeRouter(router: Pick<RouterNas, 'estrategia_velocidad'>): EstrategiasRouter {
    return clonarEstrategia(router.estrategia_velocidad)
}

/** `estrategiaEfectiva()` (§2): la del router, capa por capa sobrescrita por la del plan. */
export function estrategiaEfectiva(router: Estrategia, plan: EstrategiaParcial | null | undefined): Estrategia {
    const extras = { ...router.extras }
    for (const extra of EXTRAS) {
        const valor = plan?.extras?.[extra]
        if (typeof valor === 'boolean') {
            extras[extra] = valor
        }
    }
    return {
        aplicacion: plan?.aplicacion ?? router.aplicacion,
        padre: plan?.padre ?? router.padre,
        tipo_cola: plan?.tipo_cola ?? router.tipo_cola,
        extras,
    }
}

/** Versión mayor de RouterOS (`7.24.5 (stable)` → 7); `null` si no se conoce. */
/**
 * Copia profunda de datos planos. No usa `structuredClone`: con un proxy reactivo de Vue (un `ref`
 * o un `v-model`) lanza `DataCloneError` y el clic en una opción no hacía nada.
 */
export function clonarEstrategia<T>(valor: T): T {
    return JSON.parse(JSON.stringify(valor)) as T
}

export function versionMayor(version: string | null | undefined): number | null {
    const mayor = Number(/^(\d+)\./.exec(version ?? '')?.[1])
    return Number.isInteger(mayor) ? mayor : null
}

export interface Disponibilidad {
    valida: boolean
    /** Por qué no se puede elegir (o una advertencia si `valida` y hay algo que avisar). */
    motivo: string | null
}

/** Si la aplicación sirve para ese tipo de conexión (reglas 1 y 2). */
export function aplicacionDisponible(matriz: MatrizControlVelocidad, aplicacion: Aplicacion, tipo: TipoConexionVelocidad): Disponibilidad {
    const fila = matriz.aplicaciones.find(a => a.valor === aplicacion)
    if (!fila) {
        return { valida: false, motivo: 'Opción desconocida' }
    }
    if (fila.tipos_conexion.includes(tipo)) {
        return { valida: true, motivo: null }
    }
    if (tipo === 'pppoe') {
        return { valida: false, motivo: 'PPPoE ya crea su cola dinámica: usa RADIUS por sesión, el perfil PPP, PCQ por plan o el árbol.' }
    }
    return { valida: false, motivo: `No aplica a ${ETIQUETAS_TIPO_CONEXION[tipo]}: sin sesión PPP no hay perfil ni rate-limit por RADIUS; usa cola simple, PCQ por plan o árbol.` }
}

/** Si el tipo de cola combina con la aplicación (regla 3) y con la versión del router (regla 4). */
export function tipoColaDisponible(matriz: MatrizControlVelocidad, tipoCola: TipoCola, aplicacion: Aplicacion, version: string | null | undefined): Disponibilidad {
    const fila = matriz.aplicaciones.find(a => a.valor === aplicacion)
    if (fila && !fila.tipos_cola.includes(tipoCola)) {
        return tipoCola === 'pcq'
            ? { valida: false, motivo: 'PCQ reparte entre varios clientes: en la cola de uno solo no sirve.' }
            : { valida: false, motivo: `${OPCIONES_APLICACION[aplicacion].etiqueta} necesita PCQ: el tope de cada cliente lo pone el PCQ.` }
    }
    // `routeros_minimo` llega como texto («7»): se compara con la versión mayor del router.
    const minimo = versionMayor(`${matriz.tipos_cola.find(t => t.valor === tipoCola)?.routeros_minimo ?? ''}.`)
    if (minimo !== null) {
        const mayor = versionMayor(version)
        if (mayor === null) {
            return { valida: true, motivo: `Requiere RouterOS ${minimo}; la versión del router no se conoce: usa «Probar conexión» para leerla.` }
        }
        if (mayor < minimo) {
            return { valida: false, motivo: `Requiere RouterOS ${minimo}; este router tiene ${version}.` }
        }
    }
    return { valida: true, motivo: null }
}

/**
 * Corrige una estrategia que quedó inválida al cambiar una capa: si la aplicación ya no sirve para
 * el tipo, toma la primera válida; si el tipo de cola no combina, el primero que sí.
 */
export function ajustarEstrategia(matriz: MatrizControlVelocidad, estrategia: Estrategia, tipo: TipoConexionVelocidad, version: string | null | undefined): Estrategia {
    const ajustada = clonarEstrategia(estrategia)
    if (!aplicacionDisponible(matriz, ajustada.aplicacion, tipo).valida) {
        ajustada.aplicacion = APLICACIONES.find(a => aplicacionDisponible(matriz, a, tipo).valida) ?? ajustada.aplicacion
    }
    if (!tipoColaDisponible(matriz, ajustada.tipo_cola, ajustada.aplicacion, version).valida) {
        ajustada.tipo_cola = TIPOS_COLA.find(t => tipoColaDisponible(matriz, t, ajustada.aplicacion, version).valida) ?? ajustada.tipo_cola
    }
    return ajustada
}

/** «Igual para todos»: la estrategia de un tipo copiada a los demás, ajustada a lo que admite cada uno. */
export function igualParaTodos(matriz: MatrizControlVelocidad, origen: TipoConexionVelocidad, estrategias: EstrategiasRouter, version: string | null | undefined): EstrategiasRouter {
    const base = estrategias[origen]
    return Object.fromEntries(TIPOS_CONEXION_VELOCIDAD.map(tipo => [tipo, tipo === origen ? clonarEstrategia(base) : ajustarEstrategia(matriz, base, tipo, version)])) as EstrategiasRouter
}

/** Resumen corto de una estrategia para listas: «RADIUS por sesión · Por plan · CAKE». */
export function resumenEstrategia(estrategia: Estrategia): string {
    return [OPCIONES_APLICACION[estrategia.aplicacion].etiqueta, OPCIONES_PADRE[estrategia.padre].etiqueta, OPCIONES_TIPO_COLA[estrategia.tipo_cola].etiqueta].join(' · ')
}

/** Si un plan tiene alguna capa propia en algún tipo de conexión. */
export function tieneExcepcion(plan: EstrategiasPlan | null | undefined): boolean {
    return !!plan && Object.values(plan).some(p => p && (p.aplicacion || p.padre || p.tipo_cola || (p.extras && Object.values(p.extras).some(v => typeof v === 'boolean'))))
}

/** Errores 422 de la API por tipo de conexión y capa (`errors[].field = estrategia_velocidad.<tipo>.<capa>`). */
export function erroresPorCapa(errores: { field: string, message: string }[]): Record<string, string[]> {
    const salida: Record<string, string[]> = {}
    for (const error of errores) {
        const clave = error.field.replace(/^estrategia_velocidad\./, '').replace(/^planes\.\d+\./, '')
        salida[clave] = [...(salida[clave] ?? []), error.message]
    }
    return salida
}

export { APLICACIONES, EXTRAS, PADRES, TIPOS_COLA, TIPOS_CONEXION_VELOCIDAD }
