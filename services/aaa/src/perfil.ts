import type { ServicioAaa } from './servicio.ts'

/**
 * Traduce un servicio a los atributos RADIUS del Access-Accept. Función pura: no decide estados,
 * solo aplica el estado que trae el servicio (CLAUDE.md: el estado lo decide billing).
 *
 * Perfil de suspendido verificado en RouterOS 7.24.5 (`infra/mikrotik/README.md`):
 * `Mikrotik-Group` (perfil de corte completo al conectar: address-list e interface-list IPv4/IPv6),
 * `Mikrotik-Address-List` (redirección HTTP IPv4), `Filter-Id = "argos-corte.in"` (filtro IPv4 e IPv6,
 * solo entrada) y rate-limit mínimo. Son los mismos atributos que `coa` manda al suspender una sesión
 * viva, así el router queda igual se suspenda al conectar o por CoA.
 */

export interface PerfilSuspendido {
    rateLimit: string
    grupo: string
    addressList: string
    filterId: string
}

export interface OpcionesPerfil {
    suspendido: PerfilSuspendido
    interimSegundos: number
}

export type ValorRadius = string | number
export type AtributosReply = Record<string, ValorRadius>

export interface ResultadoPerfil {
    reply: AtributosReply
    /** Avisos de datos incompletos (se registran en log, no rechazan). */
    avisos: string[]
}

function rateLimit(subidaKbps: number, bajadaKbps: number): string {
    // RouterOS: rx/tx desde el punto de vista del router = subida/bajada del cliente.
    return `${subidaKbps}k/${bajadaKbps}k`
}

/**
 * Perfil PPP del servicio activo o limitado (`Mikrotik-Group`): con reuso en modo `simple`, el
 * perfil `plan-<id>` que ArgosIsp mantiene en el router con `parent-queue` a la cola padre del plan
 * (`apps/api/app/network/routeros/velocidad_router.ts`); si no, el `profile_ppp` del router.
 */
export function grupoDe(servicio: ServicioAaa): string | null {
    if (servicio.control_velocidad === 'simple' && servicio.plan.reuso > 1) return `plan-${servicio.plan.id}`
    return servicio.plan.profile_ppp
}

export function construirReply(servicio: ServicioAaa, op: OpcionesPerfil): ResultadoPerfil {
    const reply: AtributosReply = {}
    const avisos: string[] = []
    const { plan } = servicio
    const grupo = grupoDe(servicio)

    switch (servicio.estado) {
        case 'activo':
            // `plan.rate_limit` ya trae el `rate_limit_override` del router si existe.
            reply['Mikrotik-Rate-Limit'] =
                plan.rate_limit ?? plan.rate_limit_override ?? rateLimit(plan.subida_kbps, plan.bajada_kbps)
            if (grupo) reply['Mikrotik-Group'] = grupo
            break
        case 'limitado':
            if (plan.rate_limit_limitado && plan.subida_limitada_kbps > 0 && plan.bajada_limitada_kbps > 0) {
                reply['Mikrotik-Rate-Limit'] = plan.rate_limit_limitado
            } else if (plan.subida_limitada_kbps > 0 && plan.bajada_limitada_kbps > 0) {
                reply['Mikrotik-Rate-Limit'] = rateLimit(plan.subida_limitada_kbps, plan.bajada_limitada_kbps)
            } else {
                // El plan no define velocidad limitada: se entrega la del plan y se avisa (A1 debería
                // exigir *_limitada_kbps > 0 cuando la plantilla limita).
                reply['Mikrotik-Rate-Limit'] = rateLimit(plan.subida_kbps, plan.bajada_kbps)
                avisos.push(`plan ${plan.id} sin velocidad limitada; se usa la del plan`)
            }
            if (grupo) reply['Mikrotik-Group'] = grupo
            break
        case 'suspendido':
            reply['Mikrotik-Rate-Limit'] = op.suspendido.rateLimit
            reply['Mikrotik-Group'] = op.suspendido.grupo
            reply['Mikrotik-Address-List'] = op.suspendido.addressList
            reply['Filter-Id'] = op.suspendido.filterId
            break
        case 'retirado':
        case 'pendiente_instalacion':
            throw new Error(`un servicio ${servicio.estado} no tiene perfil: se rechaza antes`)
    }
    // `arbol_pcq`: sin cola simple por servicio. La velocidad la ponen el PCQ y el árbol del plan,
    // con las direcciones de la sesión en `argosisp-plan-<id>[-limitado]` (dispatcher de RouterOS).
    // El suspendido conserva su rate-limit mínimo (no está en las listas del plan).
    if (servicio.control_velocidad === 'arbol_pcq' && servicio.estado !== 'suspendido') {
        delete reply['Mikrotik-Rate-Limit']
    }

    // IPv4: se conserva también al suspender (A5 identifica al cliente por IP en la página de corte).
    if (servicio.ipv4?.modo === 'estatico') reply['Framed-IP-Address'] = servicio.ipv4.ip
    else if (servicio.ipv4?.modo === 'pool') reply['Framed-Pool'] = servicio.ipv4.pool

    const v6 = servicio.ipv6
    if (v6.modo === 'radius_servicio') {
        if (v6.prefijo_enlace) reply['Framed-IPv6-Prefix'] = v6.prefijo_enlace
        if (v6.prefijo_delegado) reply['Delegated-IPv6-Prefix'] = v6.prefijo_delegado
        if (!v6.prefijo_enlace && !v6.prefijo_delegado)
            avisos.push('ipv6 radius_servicio sin prefijos asignados')
    } else if (v6.modo === 'radius_pool') {
        if (v6.pool_enlace) reply['Framed-IPv6-Pool'] = v6.pool_enlace
        // El pool de delegación va en los dos atributos: `Delegated-IPv6-Prefix-Pool` (RFC 6911, 171;
        // FreeRADIUS 3.2 lo llama así, no "Delegated-IPv6-Pool") y el VSA `Mikrotik-Delegated-IPv6-Pool`
        // (14988/22), que es el que lee RouterOS. Un NAS ignora el que no conoce.
        if (v6.pool_delegacion) {
            reply['Delegated-IPv6-Prefix-Pool'] = v6.pool_delegacion
            reply['Mikrotik-Delegated-IPv6-Pool'] = v6.pool_delegacion
        }
    }
    // duid / estatico / ninguno: IPv6 no viaja por RADIUS (DHCPv6 por DUID o ruta por API de A6).

    reply['Acct-Interim-Interval'] = op.interimSegundos
    return { reply, avisos }
}
