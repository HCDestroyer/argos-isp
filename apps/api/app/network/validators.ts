import vine from '@vinejs/vine'
import { reglasPaginacion } from '#shared/paginacion'
import { cidrV4, dinero, idEntidad, ipv4, prefijoV6, versionEsperada } from '#shared/validadores'

/*
|--------------------------------------------------------------------------
| Routers
|--------------------------------------------------------------------------
*/

const camposRouter = {
    nombre: vine.string().trim().minLength(2).maxLength(100),
    host: vine
        .string()
        .trim()
        .minLength(1)
        .maxLength(255)
        .meta({ description: 'Host o IP de la API REST de RouterOS' }),
    api_usuario: vine.string().trim().maxLength(100).nullable().optional(),
    api_password: vine
        .string()
        .maxLength(200)
        .nullable()
        .optional()
        .meta({ description: 'Se guarda cifrada' }),
    radius_secret: vine
        .string()
        .maxLength(200)
        .nullable()
        .optional()
        .meta({ description: 'Se guarda cifrado' }),
    nas_ip: ipv4(),
    modo_seguridad: vine.enum(['radius', 'api'] as const).optional(),
    modo_velocidad: vine.enum(['simple', 'pcq'] as const).optional(),
    activo: vine.boolean().optional(),
}

export const crearRouterValidator = vine.compile(vine.object(camposRouter))

export const editarRouterValidator = vine.compile(
    vine.object({
        version: versionEsperada(),
        nombre: camposRouter.nombre.optional(),
        host: vine.string().trim().minLength(1).maxLength(255).optional(),
        api_usuario: vine.string().trim().maxLength(100).nullable().optional(),
        api_password: vine.string().maxLength(200).nullable().optional(),
        radius_secret: vine.string().maxLength(200).nullable().optional(),
        nas_ip: ipv4().optional(),
        modo_seguridad: vine.enum(['radius', 'api'] as const).optional(),
        modo_velocidad: vine.enum(['simple', 'pcq'] as const).optional(),
        activo: vine.boolean().optional(),
    }),
)

export const listarRoutersValidator = vine.compile(
    vine.object({ ...reglasPaginacion, activo: vine.boolean().optional() }),
)

/*
|--------------------------------------------------------------------------
| IPAM
|--------------------------------------------------------------------------
*/

export const crearRedIpv4Validator = vine.compile(
    vine.object({
        cidr: cidrV4(),
        gateway: ipv4().nullable().optional(),
        tipo: vine.enum(['estatico', 'pool'] as const),
    }),
)

export const crearBloqueIpv6Validator = vine.compile(vine.object({ prefijo: prefijoV6() }))

export const crearPoolIpv6Validator = vine.compile(
    vine.object({
        prefijo: prefijoV6(),
        tipo: vine.enum(['enlace', 'delegacion'] as const),
        tamano_entrega: vine.enum([64, 56, 48] as const).meta({ type: 'integer' }),
        nombre_en_router: vine.string().trim().maxLength(100).nullable().optional(),
    }),
)

/*
|--------------------------------------------------------------------------
| Planes
|--------------------------------------------------------------------------
*/

const kbps = () => vine.number().withoutDecimals().min(0).max(100_000_000)

const camposPlan = {
    nombre: vine.string().trim().minLength(2).maxLength(100),
    precio: dinero(),
    bajada_kbps: kbps(),
    subida_kbps: kbps(),
    bajada_limitada_kbps: kbps().optional(),
    subida_limitada_kbps: kbps().optional(),
    reuso: vine.number().withoutDecimals().min(1).max(64).optional(),
    dual_stack: vine.enum(['ambos', 'v4', 'v6'] as const).optional(),
    tamano_prefijo_delegado: vine
        .enum([64, 56, 48] as const)
        .optional()
        .meta({ type: 'integer' }),
    global: vine.boolean().optional(),
    activo: vine.boolean().optional(),
}

export const crearPlanValidator = vine.compile(vine.object(camposPlan))

export const editarPlanValidator = vine.compile(
    vine.object({
        version: versionEsperada(),
        nombre: camposPlan.nombre.optional(),
        precio: dinero().optional(),
        bajada_kbps: kbps().optional(),
        subida_kbps: kbps().optional(),
        bajada_limitada_kbps: kbps().optional(),
        subida_limitada_kbps: kbps().optional(),
        reuso: vine.number().withoutDecimals().min(1).max(64).optional(),
        dual_stack: vine.enum(['ambos', 'v4', 'v6'] as const).optional(),
        tamano_prefijo_delegado: vine
            .enum([64, 56, 48] as const)
            .optional()
            .meta({ type: 'integer' }),
        global: vine.boolean().optional(),
        activo: vine.boolean().optional(),
    }),
)

export const listarPlanesValidator = vine.compile(
    vine.object({
        ...reglasPaginacion,
        activo: vine.boolean().optional(),
        router_id: idEntidad().optional(),
    }),
)

/** Implementación de un plan en un router (`network.planes_routers`). */
export const implementacionPlanValidator = vine.compile(
    vine.object({
        version: versionEsperada()
            .optional()
            .meta({ description: 'Obligatoria si la implementación ya existe' }),
        profile_ppp: vine.string().trim().maxLength(100).nullable().optional(),
        pool_ipv4: vine.string().trim().maxLength(100).nullable().optional(),
        pool_ipv6_enlace: vine.string().trim().maxLength(100).nullable().optional(),
        pool_ipv6_delegacion: vine.string().trim().maxLength(100).nullable().optional(),
        local_address: ipv4().nullable().optional(),
        no_crear_reglas: vine.boolean().optional(),
        rate_limit_override: vine.string().trim().maxLength(200).nullable().optional(),
    }),
)

/*
|--------------------------------------------------------------------------
| Sesiones (A2)
|--------------------------------------------------------------------------
*/

export const listarSesionesValidator = vine.compile(
    vine.object({
        ...reglasPaginacion,
        router_id: idEntidad().optional(),
        servicio_id: idEntidad().optional(),
        activa: vine.boolean().optional(),
    }),
)

export const desconectarSesionValidator = vine.compile(
    vine.object({ motivo: vine.string().trim().minLength(3).maxLength(500) }),
)
