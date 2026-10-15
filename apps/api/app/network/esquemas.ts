import {
    Dinero,
    auditable,
    booleano,
    definirEsquema,
    entero,
    enumerado,
    id,
    instante,
    nulable,
    objeto,
    texto,
} from '#shared/openapi/esquemas'

/**
 * Schemas de respuesta del módulo network. Credenciales (api_password, radius_secret) nunca salen;
 * solo se indica si están configuradas.
 */

export const Router = definirEsquema(
    'Router',
    objeto({
        id,
        nombre: texto,
        host: texto,
        api_usuario: nulable(texto),
        tiene_api_password: booleano,
        tiene_radius_secret: booleano,
        nas_ip: texto,
        modo_seguridad: enumerado(['radius', 'api']),
        modo_velocidad: enumerado(['simple', 'pcq']),
        activo: booleano,
        ...auditable,
    }),
)

export const RedIpv4 = definirEsquema(
    'RedIpv4',
    objeto({
        id,
        router_id: id,
        cidr: texto,
        gateway: nulable(texto),
        tipo: enumerado(['estatico', 'pool']),
        ...auditable,
    }),
)

export const Ipv6Bloque = definirEsquema(
    'Ipv6Bloque',
    objeto({ id, router_id: id, prefijo: texto, ...auditable }),
)

export const Ipv6Pool = definirEsquema(
    'Ipv6Pool',
    objeto({
        id,
        bloque_id: id,
        prefijo: texto,
        tipo: enumerado(['enlace', 'delegacion']),
        tamano_entrega: { type: 'integer', enum: [64, 56, 48] },
        nombre_en_router: nulable(texto),
        ...auditable,
    }),
)

export const Plan = definirEsquema(
    'Plan',
    objeto({
        id,
        nombre: texto,
        precio: Dinero,
        bajada_kbps: entero,
        subida_kbps: entero,
        bajada_limitada_kbps: entero,
        subida_limitada_kbps: entero,
        reuso: entero,
        dual_stack: enumerado(['ambos', 'v4', 'v6']),
        tamano_prefijo_delegado: { type: 'integer', enum: [64, 56, 48] },
        global: booleano,
        activo: booleano,
        ...auditable,
    }),
)

export const PlanRouter = definirEsquema(
    'PlanRouter',
    objeto({
        id,
        plan_id: id,
        router_id: id,
        profile_ppp: nulable(texto),
        pool_ipv4: nulable(texto),
        pool_ipv6_enlace: nulable(texto),
        pool_ipv6_delegacion: nulable(texto),
        local_address: nulable(texto),
        no_crear_reglas: booleano,
        rate_limit_override: nulable(texto),
        ...auditable,
    }),
)

export const Sesion = definirEsquema(
    'Sesion',
    objeto({
        id,
        servicio_id: nulable(id),
        router_id: nulable(id),
        nas_ip: texto,
        acct_session_id: texto,
        user_ppp: texto,
        ipv4: nulable(texto),
        prefijo_enlace_v6: nulable(texto),
        prefijo_delegado_v6: nulable(texto),
        inicio: instante,
        fin: nulable(instante),
        bytes_in: entero,
        bytes_out: entero,
        causa_fin: nulable(texto),
    }),
)
