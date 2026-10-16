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
    type EsquemaJson,
} from '#shared/openapi/esquemas'

/**
 * Schemas de respuesta del módulo network. Credenciales (api_password, radius_secret) nunca salen;
 * solo se indica si están configuradas.
 */

const kbpsNulable = (descripcion: string): EsquemaJson => ({ ...nulable(entero), description: descripcion })

export const Router = definirEsquema(
    'Router',
    objeto(
        {
            id,
            nombre: texto,
            host: texto,
            api_usuario: nulable(texto),
            tiene_api_password: booleano,
            tiene_radius_secret: booleano,
            nas_ip: texto,
            modo_seguridad: enumerado(['radius', 'api']),
            control_velocidad: {
                ...enumerado(['simple', 'arbol_pcq']),
                description:
                    'simple: cola por servicio; arbol_pcq: queue tree + PCQ por plan (contratos/velocidad.md)',
            },
            capacidad_bajada_kbps: kbpsNulable(
                'Capacidad del enlace (techo del padre global); null = sin techo',
            ),
            capacidad_subida_kbps: kbpsNulable(
                'Capacidad del enlace (techo del padre global); null = sin techo',
            ),
            modo_velocidad: {
                ...enumerado(['simple', 'pcq']),
                deprecated: true,
                description:
                    'Obsoleto: derivado de control_velocidad (arbol_pcq → pcq). Usar control_velocidad',
            },
            activo: booleano,
            ...auditable,
        },
        // aditivos (semana 2): la API siempre los envía
        ['control_velocidad', 'capacidad_bajada_kbps', 'capacidad_subida_kbps'],
    ),
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

/** Campos de velocidad del plan (`contratos/velocidad.md`). */
const velocidadPlan = {
    garantizado_pct: {
        ...nulable({ type: 'number' }),
        description: 'CIR (limit-at) como % del MIR; null = 100 / reuso',
    },
    rafaga_bajada_kbps: kbpsNulable('burst-limit de bajada; null = sin ráfaga'),
    rafaga_subida_kbps: kbpsNulable('burst-limit de subida; null = sin ráfaga'),
    rafaga_umbral_pct: {
        type: 'integer',
        minimum: 1,
        maximum: 99,
        description: 'burst-threshold como % del MIR',
    },
    rafaga_segundos: { type: 'integer', minimum: 1, description: 'burst-time en segundos' },
    prioridad: { type: 'integer', minimum: 1, maximum: 8, description: '1 (alta) a 8 (baja)' },
} satisfies Record<string, EsquemaJson>
const CAMPOS_VELOCIDAD_PLAN = Object.keys(velocidadPlan)

export const Plan = definirEsquema(
    'Plan',
    objeto(
        {
            id,
            nombre: texto,
            precio: Dinero,
            bajada_kbps: entero,
            subida_kbps: entero,
            bajada_limitada_kbps: entero,
            subida_limitada_kbps: entero,
            reuso: entero,
            ...velocidadPlan,
            dual_stack: enumerado(['ambos', 'v4', 'v6']),
            tamano_prefijo_delegado: { type: 'integer', enum: [64, 56, 48] },
            global: booleano,
            activo: booleano,
            ...auditable,
        },
        CAMPOS_VELOCIDAD_PLAN,
    ),
)

export const PlanRouter = definirEsquema(
    'PlanRouter',
    objeto(
        {
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
            // excepciones de velocidad (semana 2): null = hereda del plan
            reuso: { ...nulable(entero), description: 'null = hereda del plan' },
            garantizado_pct: { ...nulable({ type: 'number' }), description: 'null = hereda del plan' },
            rafaga_bajada_kbps: kbpsNulable('null = hereda del plan'),
            rafaga_subida_kbps: kbpsNulable('null = hereda del plan'),
            rafaga_umbral_pct: { ...nulable(entero), description: 'null = hereda del plan' },
            rafaga_segundos: { ...nulable(entero), description: 'null = hereda del plan' },
            prioridad: { ...nulable(entero), description: 'null = hereda del plan' },
            ...auditable,
        },
        ['reuso', ...CAMPOS_VELOCIDAD_PLAN],
    ),
)

/** Plan con su configuración efectiva en un router (plantilla + `planes_routers`). */
export const PlanEfectivo = definirEsquema(
    'PlanEfectivo',
    objeto(
        {
            id,
            nombre: texto,
            precio: Dinero,
            bajada_kbps: entero,
            subida_kbps: entero,
            bajada_limitada_kbps: entero,
            subida_limitada_kbps: entero,
            reuso: { ...entero, description: 'Reuso efectivo en el router' },
            ...velocidadPlan,
            dual_stack: enumerado(['ambos', 'v4', 'v6']),
            tamano_prefijo_delegado: { type: 'integer', enum: [64, 56, 48] },
            global: booleano,
            activo: booleano,
            ...auditable,
            router_id: id,
            implementacion: nulable(PlanRouter),
            rate_limit: {
                type: 'string',
                description:
                    'Mikrotik-Rate-Limit completo en estado activo: "5M/20M 0/0 0/0 0/0 8 5M/20M" (rx/tx ráfaga umbral tiempo prioridad limit-at) o rate_limit_override',
            },
            rate_limit_limitado: {
                type: 'string',
                description: 'Mikrotik-Rate-Limit completo en estado limitado (sin ráfaga)',
            },
            profile_ppp: nulable(texto),
            pool_ipv4: nulable(texto),
            pool_ipv6_enlace: nulable(texto),
            pool_ipv6_delegacion: nulable(texto),
            local_address: nulable(texto),
            no_crear_reglas: booleano,
        },
        CAMPOS_VELOCIDAD_PLAN,
    ),
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

/** Tramo del historial de asignaciones de un servicio (`network.asignaciones_historial`). */
export const TramoAsignacion = definirEsquema(
    'TramoAsignacion',
    objeto({
        id,
        servicio_id: id,
        router_id: nulable(id),
        router_nombre: nulable(texto),
        plan_id: nulable(id),
        plan_nombre: nulable(texto),
        ipv4: nulable(texto),
        prefijo_enlace_v6: nulable(texto),
        prefijo_delegado_v6: nulable(texto),
        inicio: instante,
        fin: { ...nulable(instante), description: 'null = tramo vigente' },
        motivo: {
            ...nulable(texto),
            description: 'alta, edicion: <campos>, retiro: <motivo> o inicial (migración)',
        },
    }),
)
