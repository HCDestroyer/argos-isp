import type { LocationQuery } from 'vue-router'

/**
 * Filtros de `/clientes` (pedido del PM) y su forma en la URL. La URL usa nombres cortos
 * (`?estado=suspendido&deuda=1`) para poder compartir el enlace; a la API se mandan los
 * parámetros del contrato (`estado_servicio`, `con_deuda_vencida`…).
 */
export interface EstadoFiltrosClientes {
    q: string
    zonaId: number | null
    estado: EstadoServicio | null
    routerId: number | null
    planId: number | null
    conDeuda: boolean
    conPromesa: boolean
    /** NIT/CUI marcado inválido al migrar a la localización fiscal (A1). */
    nitInvalido: boolean
}

export const FILTROS_CLIENTES_VACIOS: Readonly<EstadoFiltrosClientes> = Object.freeze({
    q: '',
    zonaId: null,
    estado: null,
    routerId: null,
    planId: null,
    conDeuda: false,
    conPromesa: false,
    nitInvalido: false,
})

/** Accesos rápidos de la lista: "Todos", "Cortados" (suspendido) y "Con deuda" vencida. */
export type AccesoRapidoClientes = 'todos' | 'cortados' | 'deuda'

function texto(valor: LocationQuery[string] | undefined): string {
    const primero = Array.isArray(valor) ? valor[0] : valor
    return typeof primero === 'string' ? primero : ''
}

function idPositivo(valor: LocationQuery[string] | undefined): number | null {
    const crudo = texto(valor)
    if (!/^\d+$/.test(crudo)) {
        return null
    }
    const id = Number(crudo)
    return id > 0 ? id : null
}

function bandera(valor: LocationQuery[string] | undefined): boolean {
    const crudo = texto(valor)
    return crudo === '1' || crudo === 'true'
}

/** Lee los filtros de la URL; lo que no se entiende se ignora (enlace viejo o editado a mano). */
export function leerFiltrosClientes(query: LocationQuery): EstadoFiltrosClientes {
    const estado = texto(query.estado)
    return {
        q: texto(query.q),
        zonaId: idPositivo(query.zona),
        estado: esEstadoServicio(estado) ? estado : null,
        routerId: idPositivo(query.router),
        planId: idPositivo(query.plan),
        conDeuda: bandera(query.deuda),
        conPromesa: bandera(query.promesa),
        nitInvalido: bandera(query.nit_invalido),
    }
}

/** Query de la URL: solo los filtros puestos, para que "sin filtros" sea `/clientes` a secas. */
export function queryFiltrosClientes(filtros: EstadoFiltrosClientes): Record<string, string> {
    const query: Record<string, string> = {}
    const q = filtros.q.trim()
    if (q) {
        query.q = q
    }
    if (filtros.zonaId) {
        query.zona = String(filtros.zonaId)
    }
    if (filtros.estado) {
        query.estado = filtros.estado
    }
    if (filtros.routerId) {
        query.router = String(filtros.routerId)
    }
    if (filtros.planId) {
        query.plan = String(filtros.planId)
    }
    if (filtros.conDeuda) {
        query.deuda = '1'
    }
    if (filtros.conPromesa) {
        query.promesa = '1'
    }
    if (filtros.nitInvalido) {
        query.nit_invalido = '1'
    }
    return query
}

/**
 * Parámetros de `GET /clientes`. Las banderas apagadas no se mandan: `con_deuda_vencida=false`
 * en la API significa "sin deuda", no "sin filtro".
 */
export function filtrosApiClientes(filtros: EstadoFiltrosClientes): FiltrosClientes {
    const resultado: FiltrosClientes = {}
    const q = filtros.q.trim()
    if (q) {
        resultado.q = q
    }
    if (filtros.zonaId) {
        resultado.zona_id = filtros.zonaId
    }
    if (filtros.estado) {
        resultado.estado_servicio = filtros.estado
    }
    if (filtros.routerId) {
        resultado.router_id = filtros.routerId
    }
    if (filtros.planId) {
        resultado.plan_id = filtros.planId
    }
    if (filtros.conDeuda) {
        resultado.con_deuda_vencida = true
    }
    if (filtros.conPromesa) {
        resultado.con_promesa_activa = true
    }
    if (filtros.nitInvalido) {
        resultado.nit_cui_invalido = true
    }
    return resultado
}

/** Filtros del panel puestos (la búsqueda no cuenta: se ve en su propia caja). */
export function contarFiltrosClientes(filtros: EstadoFiltrosClientes): number {
    return [filtros.zonaId, filtros.estado, filtros.routerId, filtros.planId, filtros.conDeuda, filtros.conPromesa, filtros.nitInvalido]
        .filter(valor => valor !== null && valor !== false)
        .length
}

export function hayFiltrosClientes(filtros: EstadoFiltrosClientes): boolean {
    return filtros.q.trim() !== '' || contarFiltrosClientes(filtros) > 0
}

/**
 * Acceso rápido que corresponde a los filtros, o `null` si hay otra combinación.
 * "Todos" es sin estado ni deuda (la búsqueda y los demás filtros se respetan).
 */
export function accesoRapidoClientes(filtros: EstadoFiltrosClientes): AccesoRapidoClientes | null {
    if (filtros.estado === null && !filtros.conDeuda) {
        return 'todos'
    }
    if (filtros.estado === 'suspendido' && !filtros.conDeuda) {
        return 'cortados'
    }
    if (filtros.estado === null && filtros.conDeuda) {
        return 'deuda'
    }
    return null
}

/** Aplica un acceso rápido: solo toca estado y deuda, el resto de filtros sigue igual. */
export function aplicarAccesoRapidoClientes(filtros: EstadoFiltrosClientes, acceso: AccesoRapidoClientes): EstadoFiltrosClientes {
    return {
        ...filtros,
        estado: acceso === 'cortados' ? 'suspendido' : null,
        conDeuda: acceso === 'deuda',
    }
}
