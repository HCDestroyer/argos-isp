import vine from '@vinejs/vine'
import { reglasPaginacion } from '#shared/paginacion'
import {
    cidrV4,
    dinero,
    empresaSugerida,
    empresasConsulta,
    idEntidad,
    instanteIso,
    ipv4,
    prefijoV6,
    versionEsperada,
} from '#shared/validadores'
import { CONTROLES_VELOCIDAD } from '#network/velocidad'
import { TIPOS_PLAN } from '#network/tipos_plan'
import { RESULTADOS_EVENTO_RED, TIPOS_EVENTO_RED } from '#network/sesiones/eventos_red'

/*
|--------------------------------------------------------------------------
| Routers
|--------------------------------------------------------------------------
*/

/** Capacidad del enlace en kbps (techo del padre global); null = sin techo. */
const capacidad = () =>
    vine
        .number()
        .withoutDecimals()
        .min(1)
        .max(100_000_000)
        .nullable()
        .optional()
        .meta({ description: 'kbps del enlace (techo de la cola padre global); null = sin techo' })

/** Conexión a la API REST de RouterOS (`contratos/routeros.md`): todos opcionales. */
const camposConexionApi = {
    api_url: vine
        .string()
        .trim()
        .maxLength(300)
        .regex(/^https?:\/\/[^\s/]+(:\d{1,5})?\/?$/)
        .nullable()
        .optional()
        .meta({ description: 'https://host:puerto de la API REST; null = https://<host>' }),
    api_tls_verificar: vine
        .boolean()
        .optional()
        .meta({ description: 'Verificar el certificado TLS del router (por defecto true)' }),
    api_ca: vine
        .string()
        .trim()
        .maxLength(20_000)
        .regex(/^-----BEGIN CERTIFICATE-----/)
        .nullable()
        .optional()
        .meta({
            description: 'CA en PEM para routers con certificado propio; en auditoría se registra como ***',
        }),
    dhcp_servidor: vine
        .string()
        .trim()
        .minLength(1)
        .maxLength(100)
        .nullable()
        .optional()
        .meta({ description: 'server del lease DHCP (dhcp_fija); null = ROUTEROS_DHCP_SERVIDOR o all' }),
    interfaz_clientes: vine.string().trim().minLength(1).maxLength(100).nullable().optional().meta({
        description:
            'Interfaz del ARP estático del amarre IP-MAC; null = ROUTEROS_INTERFAZ_CLIENTES (sin ninguno no se crea el ARP)',
    }),
}

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
    empresa_sugerida_id: empresaSugerida(),
    control_velocidad: vine.enum(CONTROLES_VELOCIDAD).optional().meta({
        description:
            'simple (cola por servicio, por defecto) o arbol_pcq (queue tree + PCQ por plan). Después del alta solo con POST /routers/:id/cambiar-control-velocidad',
    }),
    capacidad_bajada_kbps: capacidad(),
    capacidad_subida_kbps: capacidad(),
    ...camposConexionApi,
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
        empresa_sugerida_id: empresaSugerida(),
        capacidad_bajada_kbps: capacidad(),
        capacidad_subida_kbps: capacidad(),
        ...camposConexionApi,
        activo: vine.boolean().optional(),
    }),
)

/** `POST /routers/:id/cambiar-control-velocidad` (solo admin; la ejecución en el router es de A2). */
export const cambiarControlVelocidadValidator = vine.compile(
    vine.object({
        version: versionEsperada(),
        control_velocidad: vine.enum(CONTROLES_VELOCIDAD),
        motivo: vine.string().trim().minLength(3).maxLength(500).optional(),
    }),
)

export const listarRoutersValidator = vine.compile(
    vine.object({ ...reglasPaginacion, activo: vine.boolean().optional(), empresas: empresasConsulta() }),
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

const kbps = () => vine.number().withoutDecimals().min(1).max(100_000_000)

/**
 * Campos de velocidad (`contratos/velocidad.md`). Las reglas que cruzan campos (CIR ≤ MIR / reuso,
 * umbral < MIR < ráfaga) las valida `validarVelocidad` en la acción (422 por campo).
 */
const reglasVelocidad = {
    reuso: () =>
        vine.number().withoutDecimals().min(1).max(64).meta({ description: 'N de 1:N (1 = dedicado)' }),
    garantizado_pct: () =>
        vine
            .number()
            .decimal([0, 2])
            .min(0.01)
            .max(100)
            .meta({ description: 'CIR (limit-at) como % del MIR; null = 100 / reuso. Máximo 100 / reuso' }),
    rafaga_bajada_kbps: () =>
        kbps().meta({ description: 'burst-limit de bajada (> bajada_kbps); null = sin ráfaga' }),
    rafaga_subida_kbps: () =>
        kbps().meta({ description: 'burst-limit de subida (> subida_kbps); null = sin ráfaga' }),
    rafaga_umbral_pct: () =>
        vine
            .number()
            .withoutDecimals()
            .min(1)
            .max(99)
            .meta({ description: 'burst-threshold como % del MIR (75)' }),
    rafaga_segundos: () =>
        vine.number().withoutDecimals().min(1).max(3600).meta({ description: 'burst-time en segundos (16)' }),
    prioridad: () =>
        vine
            .number()
            .withoutDecimals()
            .min(1)
            .max(8)
            .meta({ description: '1 (alta) a 8 (baja, por defecto)' }),
}

/** En el plan: los que tienen valor por defecto no admiten null. */
const camposVelocidadPlan = () => ({
    reuso: reglasVelocidad.reuso().optional(),
    garantizado_pct: reglasVelocidad.garantizado_pct().nullable().optional(),
    rafaga_bajada_kbps: reglasVelocidad.rafaga_bajada_kbps().nullable().optional(),
    rafaga_subida_kbps: reglasVelocidad.rafaga_subida_kbps().nullable().optional(),
    rafaga_umbral_pct: reglasVelocidad.rafaga_umbral_pct().optional(),
    rafaga_segundos: reglasVelocidad.rafaga_segundos().optional(),
    prioridad: reglasVelocidad.prioridad().optional(),
})

/** En `planes_routers`: todo admite null (= hereda el valor del plan). */
const camposVelocidadExcepcion = () => ({
    reuso: reglasVelocidad.reuso().nullable().optional(),
    garantizado_pct: reglasVelocidad.garantizado_pct().nullable().optional(),
    rafaga_bajada_kbps: reglasVelocidad.rafaga_bajada_kbps().nullable().optional(),
    rafaga_subida_kbps: reglasVelocidad.rafaga_subida_kbps().nullable().optional(),
    rafaga_umbral_pct: reglasVelocidad.rafaga_umbral_pct().nullable().optional(),
    rafaga_segundos: reglasVelocidad.rafaga_segundos().nullable().optional(),
    prioridad: reglasVelocidad.prioridad().nullable().optional(),
})

const camposPlan = {
    nombre: vine.string().trim().minLength(2).maxLength(100),
    precio: dinero(),
    bajada_kbps: kbps(),
    subida_kbps: kbps(),
    // > 0: con 0 el servicio limitado navegaría a velocidad completa (aaa lo usa al limitar)
    bajada_limitada_kbps: kbps().min(1),
    subida_limitada_kbps: kbps().min(1),
    ...camposVelocidadPlan(),
    dual_stack: vine.enum(['ambos', 'v4', 'v6'] as const).optional(),
    tamano_prefijo_delegado: vine
        .enum([64, 56, 48] as const)
        .optional()
        .meta({ type: 'integer' }),
    tipo: vine.enum(TIPOS_PLAN).optional().meta({
        description: 'residencial (por defecto), empresarial o dedicado; solo advierte, nunca bloquea',
    }),
    global: vine.boolean().optional(),
    activo: vine.boolean().optional(),
}

export const crearPlanValidator = vine.compile(vine.object(camposPlan))

/** `POST /planes/vista-previa`: los campos de velocidad del formulario de planes, sin guardar. */
export const vistaPreviaPlanValidator = vine.compile(
    vine.object({
        bajada_kbps: kbps(),
        subida_kbps: kbps(),
        bajada_limitada_kbps: kbps().min(1),
        subida_limitada_kbps: kbps().min(1),
        ...camposVelocidadPlan(),
        rate_limit_override: vine.string().trim().maxLength(200).nullable().optional().meta({
            description: 'Como en planes_routers: reemplaza la cadena de estado activo',
        }),
        activos: vine.number().withoutDecimals().min(0).max(100_000).optional().meta({
            description: 'Servicios activos del plan en el router para la cola padre (por defecto 1)',
        }),
    }),
)

export const editarPlanValidator = vine.compile(
    vine.object({
        version: versionEsperada(),
        nombre: camposPlan.nombre.optional(),
        precio: dinero().optional(),
        bajada_kbps: kbps().optional(),
        subida_kbps: kbps().optional(),
        bajada_limitada_kbps: kbps().min(1).optional(),
        subida_limitada_kbps: kbps().min(1).optional(),
        ...camposVelocidadPlan(),
        dual_stack: vine.enum(['ambos', 'v4', 'v6'] as const).optional(),
        tamano_prefijo_delegado: vine
            .enum([64, 56, 48] as const)
            .optional()
            .meta({ type: 'integer' }),
        tipo: vine.enum(TIPOS_PLAN).optional(),
        global: vine.boolean().optional(),
        activo: vine.boolean().optional(),
    }),
)

export const listarPlanesValidator = vine.compile(
    vine.object({
        ...reglasPaginacion,
        activo: vine.boolean().optional(),
        router_id: idEntidad().optional(),
        tipo: vine.enum(TIPOS_PLAN).optional(),
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
        rate_limit_override: vine.string().trim().maxLength(200).nullable().optional().meta({
            description: 'Cadena Mikrotik-Rate-Limit completa que reemplaza la calculada en estado activo',
        }),
        // excepciones de velocidad del plan en este router: null = hereda del plan
        ...camposVelocidadExcepcion(),
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
        desde: instanteIso().optional().meta({
            description: 'Sesiones vivas en o después de este instante: abiertas o con `fin >= desde`',
        }),
        hasta: instanteIso()
            .optional()
            .meta({ description: 'Sesiones iniciadas antes de este instante (`inicio < hasta`)' }),
    }),
)

/** `GET /routers/:id/resumen-sesiones?desde=` (A2). */
export const resumenSesionesRouterValidator = vine.compile(
    vine.object({
        desde: instanteIso().optional(),
    }),
)

/** `POST /routers/:id/marcar-migrado` (A2): `desde` omitido = ahora; null = desmarcar. */
export const marcarRouterMigradoValidator = vine.compile(
    vine.object({
        desde: instanteIso().nullable().optional(),
        motivo: vine.string().trim().minLength(3).maxLength(500),
        version: vine.number().withoutDecimals().min(0).optional(),
    }),
)

/** `GET /red/eventos` (A2): lectura de `audit.red`. `desde` inclusive, `hasta` exclusive. */
export const listarEventosRedValidator = vine.compile(
    vine.object({
        ...reglasPaginacion,
        router_id: idEntidad().optional(),
        servicio_id: idEntidad().optional(),
        tipo: vine.enum(TIPOS_EVENTO_RED).optional(),
        resultado: vine.enum(RESULTADOS_EVENTO_RED).optional().meta({
            description: '`ok` (ACK o escritura aceptada) o `error` (NAK, timeout, sin secret, fallo)',
        }),
        desde: instanteIso().optional(),
        hasta: instanteIso().optional(),
    }),
)

export const desconectarSesionValidator = vine.compile(
    vine.object({ motivo: vine.string().trim().minLength(3).maxLength(500) }),
)

/** `GET /routers/:id/vista-previa-control?a=` (A2): modo al que se cambiaría. */
export const vistaPreviaControlValidator = vine.compile(vine.object({ a: vine.enum(CONTROLES_VELOCIDAD) }))

/*
|--------------------------------------------------------------------------
| Conexión de routers por WireGuard (contratos/conexion-routers.md)
|--------------------------------------------------------------------------
*/

/** Clave pública WireGuard: 32 bytes en base64 (44 caracteres). */
const clavePublicaWg = () =>
    vine
        .string()
        .trim()
        .regex(/^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/)
        .meta({ description: 'Clave pública WireGuard del router (base64, 44 caracteres)' })

/** `GET /routers/:id/script-conexion?admin=&incluir=` */
export const scriptConexionValidator = vine.compile(
    vine.object({
        admin: vine
            .string()
            .trim()
            .maxLength(2000)
            .optional()
            .meta({
                description:
                    'IPs o redes IPv4 separadas por coma para la lista argosisp-admin (winbox y ssh). ' +
                    'Vacía: gestión solo por el túnel',
            }),
        incluir: vine
            .enum(['servicio'])
            .optional()
            .meta({ description: '`servicio`: suma PPPoE, perfiles y corte; por defecto solo conexión' }),
    }),
)

/** `POST /routers/conexion/registrar` (lo manda el script del router). */
export const registrarConexionValidator = vine.compile(
    vine.object({
        token: vine.string().trim().minLength(16).maxLength(128),
        public_key: clavePublicaWg(),
    }),
)

/** `POST /routers/:id/conexion/clave`: pegar la clave a mano. */
export const conexionClaveValidator = vine.compile(vine.object({ public_key: clavePublicaWg() }))

/** `POST /internal/routers/conexion/handshakes` (servicio wireguard). */
export const handshakesValidator = vine.compile(
    vine.object({
        peers: vine
            .array(
                vine.object({
                    public_key: clavePublicaWg(),
                    ultimo_handshake: instanteIso().nullable(),
                }),
            )
            .maxLength(10000),
    }),
)
