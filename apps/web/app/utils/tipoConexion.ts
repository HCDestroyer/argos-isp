import type { Problem, Schema } from '@argosisp/contracts'
import { codigoProblema } from './cobro'
import { AYUDA_PPPOE_SIN_RADIUS } from './modoSeguridad'

/**
 * Tipo de conexión del servicio (A1, decisión del PM): `pppoe` por RADIUS con credenciales, o
 * WISP sin PPPoE (`ip_estatica`, `dhcp_fija`) que ArgosIsp configura por la API REST de RouterOS
 * (`contratos/routeros.md`). Sin PPPoE no hay credenciales, sesión RADIUS ni IPv6 por RADIUS.
 */
export type TipoConexion = NonNullable<Schema<'Servicio'>['tipo_conexion']>

export const TIPOS_CONEXION: Record<TipoConexion, { etiqueta: string, corta: string, descripcion: string, icono: string }> = {
    pppoe: {
        etiqueta: 'PPPoE',
        corta: 'PPPoE',
        descripcion: 'Usuario y contraseña por RADIUS; sesión, corte y velocidad por RADIUS.',
        icono: 'i-lucide-key-round',
    },
    ip_estatica: {
        etiqueta: 'IP estática',
        corta: 'IP estática',
        descripcion: 'Sin credenciales: el equipo usa la IPv4 asignada. ArgosIsp crea la cola y el corte por API.',
        icono: 'i-lucide-network',
    },
    dhcp_fija: {
        etiqueta: 'DHCP con IP fija',
        corta: 'DHCP fija',
        descripcion: 'Lease estático por MAC (obligatoria). ArgosIsp crea el lease, la cola y el corte por API.',
        icono: 'i-lucide-router',
    },
}

export function esTipoConexion(valor: unknown): valor is TipoConexion {
    return typeof valor === 'string' && Object.hasOwn(TIPOS_CONEXION, valor)
}

/** La vista `Servicio` deja `tipo_conexion` opcional (la API siempre lo manda): por defecto PPPoE. */
export function tipoConexionDe(servicio: Pick<Schema<'Servicio'>, 'tipo_conexion'>): TipoConexion {
    return servicio.tipo_conexion ?? 'pppoe'
}

export function esPppoe(servicio: Pick<Schema<'Servicio'>, 'tipo_conexion'>): boolean {
    return tipoConexionDe(servicio) === 'pppoe'
}

/** Sin PPPoE no hay RADIUS: solo estos modos IPv6 (`validarTipoConexion` de A1). */
export const MODOS_IPV6_SIN_RADIUS = ['duid', 'estatico', 'ninguno'] as const

export function modoIpv6PorRadius(modo: string): boolean {
    return modo === 'radius_servicio' || modo === 'radius_pool'
}

/*
 * Tipo de conexión por router (`contratos/tipo-conexion-router.md`, decisión del PM del 5 nov): el
 * router lo define, uno por router, y sus servicios lo toman. Ya no se elige servicio por servicio.
 */

/** Opciones del selector de tipo en el alta y la edición del router. */
export function itemsTipoConexionRouter(sinRadius: boolean): { label: string, value: TipoConexion, description: string }[] {
    return (Object.keys(TIPOS_CONEXION) as TipoConexion[]).map(tipo => ({
        label: TIPOS_CONEXION[tipo].etiqueta,
        value: tipo,
        description: tipo === 'pppoe' && sinRadius ? AYUDA_PPPOE_SIN_RADIUS : TIPOS_CONEXION[tipo].descripcion,
    }))
}

/** Lo que le falta a un servicio para pasar a otro tipo (bloquea; el texto largo viene en `mensajes[]`). */
export const FALTAS_TIPO: Record<'mac' | 'ipv4' | 'plan', string> = {
    mac: 'Falta la MAC',
    ipv4: 'Falta IPv4',
    plan: 'Plan solo IPv6',
}

/** Lo que el cambio de tipo completa solo (no bloquea). */
export const COMPLETA_TIPO: Record<'credenciales' | 'ipv4' | 'ipv6_modo' | 'amarre_ip_mac', string> = {
    credenciales: 'Se generan usuario y contraseña PPPoE',
    ipv4: 'Se le asigna IPv4 de las redes del router',
    ipv6_modo: 'IPv6 por RADIUS pasa a «Sin IPv6»',
    amarre_ip_mac: 'Se quita el amarre IP-MAC',
}

export interface ServiciosDeProblema {
    /** Total del `detail` («El router tiene 3 servicios…»); si no se lee, los listados. */
    total: number
    servicios: { id: number, texto: string }[]
}

/**
 * 422 `tipo_conexion_con_servicios` de `PUT /routers/:id` (A1): el router tiene servicios de otro
 * tipo y no se cambia en la edición; un `errors[]` por servicio (`field: servicios.<id>`, hasta 50).
 * `null` si el problema es otro.
 */
export function serviciosConOtroTipo(problema: Problem | null | undefined): ServiciosDeProblema | null {
    if (!problema || codigoProblema(problema) !== 'tipo_conexion_con_servicios') {
        return null
    }
    const servicios = (problema.errors ?? []).flatMap((error) => {
        const id = /^servicios\.(\d+)$/.exec(error.field)?.[1]
        return id ? [{ id: Number(id), texto: error.message }] : []
    })
    const enDetalle = /tiene (\d+) servicios?/i.exec(problema.detail ?? '')?.[1]
    return { total: enDetalle ? Number(enDetalle) : servicios.length, servicios }
}

/**
 * 422 `tipo_conexion_servicios_incompletos` de `POST /routers/:id/cambiar-tipo-conexion`: un error
 * por falta (`field: servicios.<id>.<mac|ipv4|plan>`), agrupado por servicio.
 */
export function faltantesDeProblema(problema: Problem | null | undefined): Map<number, string[]> {
    const porServicio = new Map<number, string[]>()
    if (!problema || codigoProblema(problema) !== 'tipo_conexion_servicios_incompletos') {
        return porServicio
    }
    for (const error of problema.errors ?? []) {
        const id = /^servicios\.(\d+)\./.exec(error.field)?.[1]
        if (id) {
            porServicio.set(Number(id), [...(porServicio.get(Number(id)) ?? []), error.message])
        }
    }
    return porServicio
}
