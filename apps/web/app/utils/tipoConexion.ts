import type { Schema } from '@argosisp/contracts'

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
