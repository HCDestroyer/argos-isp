import vine from '@vinejs/vine'
import { reglasPaginacion } from '#shared/paginacion'
import { conMensajes, MENSAJE_VERSION } from '#shared/mensajes_validacion'
import {
    cidrV4,
    coordenadasEnRango,
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
import { APLICACIONES, PADRES, TIPOS_COLA } from '#network/estrategia_velocidad'
import { TIPOS_PLAN } from '#network/tipos_plan'
import { PROTOCOLOS_QOS, QOS_MAX_CLASES, QOS_MAX_REGLAS } from '#network/qos'
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

/** Credencial del router en el alta (vacía o null = sin ella); en auditoría siempre `***`. */
const credencialRouter = (descripcion: string) =>
    vine
        .string()
        .maxLength(200)
        .nullable()
        .optional()
        .meta({ description: `${descripcion}. Vacía o null = sin credencial` })

/** Ubicación del router para factibilidad (Iris 0.3.1); null la quita. */
const coordenadasRouter = () =>
    coordenadasEnRango().nullable().optional().meta({
        description:
            'Ubicación del router "lat,lng" (latitud −90…90, longitud −180…180); se guarda sin espacios; null la quita',
    })

const zonaRouter = () =>
    idEntidad().nullable().optional().meta({ description: 'Zona del router (opcional); 422 si no existe' })

const camposRouter = {
    nombre: vine.string().trim().minLength(2).maxLength(100),
    host: vine
        .string()
        .trim()
        .minLength(1)
        .maxLength(255)
        .meta({ description: 'Host o IP de la API REST de RouterOS' }),
    api_usuario: vine.string().trim().maxLength(100).nullable().optional(),
    api_password: credencialRouter('Clave del usuario de la API REST. Se guarda cifrada'),
    radius_secret: credencialRouter(
        'Secreto RADIUS del NAS (el mismo que usa FreeRADIUS). Se guarda cifrado',
    ),
    nas_ip: ipv4(),
    modo_seguridad: vine.enum(['radius', 'api'] as const).optional(),
    empresa_sugerida_id: empresaSugerida(),
    zona_id: zonaRouter(),
    coordenadas: coordenadasRouter(),
    control_velocidad: vine.enum(CONTROLES_VELOCIDAD).optional().meta({
        description:
            'simple (cola por servicio, por defecto) o arbol_pcq (queue tree + PCQ por plan). Después del alta solo con POST /routers/:id/cambiar-control-velocidad',
    }),
    capacidad_bajada_kbps: capacidad(),
    capacidad_subida_kbps: capacidad(),
    ...camposConexionApi,
    activo: vine.boolean().optional(),
}

const MENSAJES_ROUTER = {
    'nombre.required': 'El nombre es obligatorio: así reconoces el router en el panel y en los servicios',
    'host.required':
        'El host es obligatorio: es la IP o el nombre con el que el sistema llega a la API del router',
    'nas_ip.required':
        'La IP del NAS es obligatoria: es la IP con la que el router habla con RADIUS y a la que se envían los CoA',
    'nas_ip.ipAddress': 'La IP del NAS debe ser una IPv4, por ejemplo 10.0.0.1',
    'coordenadas.regex':
        'Las coordenadas van como "latitud,longitud" en grados decimales, por ejemplo 14.6349,-90.5069 (latitud entre −90 y 90, longitud entre −180 y 180)',
}

export const crearRouterValidator = conMensajes(vine.compile(vine.object(camposRouter)), MENSAJES_ROUTER)

export const editarRouterValidator = conMensajes(
    vine.compile(
        vine.object({
            version: versionEsperada(),
            nombre: camposRouter.nombre.optional(),
            host: vine.string().trim().minLength(1).maxLength(255).optional(),
            api_usuario: vine.string().trim().maxLength(100).nullable().optional(),
            api_password: vine
                .string()
                .maxLength(200)
                .nullable()
                .optional()
                .meta({ description: 'Clave nueva de la API REST (cifrada). Vacía o null = no cambiar' }),
            radius_secret: vine.string().maxLength(200).nullable().optional().meta({
                description: 'Secreto RADIUS nuevo (cifrado; el de FreeRADIUS). Vacío o null = no cambiar',
            }),
            quitar_api_password: vine
                .boolean()
                .optional()
                .meta({ description: 'Borra la clave de la API (422 si además llega api_password)' }),
            quitar_radius_secret: vine
                .boolean()
                .optional()
                .meta({ description: 'Borra el secreto RADIUS (422 si además llega radius_secret)' }),
            nas_ip: ipv4().optional(),
            modo_seguridad: vine.enum(['radius', 'api'] as const).optional(),
            empresa_sugerida_id: empresaSugerida(),
            zona_id: zonaRouter(),
            coordenadas: coordenadasRouter(),
            capacidad_bajada_kbps: capacidad(),
            capacidad_subida_kbps: capacidad(),
            ...camposConexionApi,
            activo: vine.boolean().optional(),
        }),
    ),
    { ...MENSAJES_ROUTER, ...MENSAJE_VERSION },
)

/** `POST /routers/:id/cambiar-control-velocidad` (solo admin; la ejecución en el router es de A2). */
export const cambiarControlVelocidadValidator = conMensajes(
    vine.compile(
        vine.object({
            version: versionEsperada(),
            control_velocidad: vine.enum(CONTROLES_VELOCIDAD),
            motivo: vine.string().trim().minLength(3).maxLength(500).optional(),
        }),
    ),
    {
        ...MENSAJE_VERSION,
        'control_velocidad.required':
            'El control de velocidad es obligatorio: «simple» crea una cola por servicio y «arbol_pcq» un árbol de colas por plan',
    },
)

export const listarRoutersValidator = vine.compile(
    vine.object({ ...reglasPaginacion, activo: vine.boolean().optional(), empresas: empresasConsulta() }),
)

/*
|--------------------------------------------------------------------------
| IPAM
|--------------------------------------------------------------------------
*/

const MENSAJES_RED_IPV4 = {
    'cidr.required':
        'La red es obligatoria (por ejemplo 100.64.10.0/24): de ella salen las IPs que reciben los clientes',
    'cidr.regex': 'Escribe la red en notación CIDR, por ejemplo 100.64.10.0/24',
    'tipo.required':
        'El tipo es obligatorio: «estatico» si el sistema entrega una IP fija a cada servicio, «pool» si es el rango del pool del router',
    'gateway.ipAddress': 'El gateway debe ser una IPv4, por ejemplo 100.64.10.1',
    'rango_inicio.ipAddress': 'El inicio del rango debe ser una IPv4 de la red',
    'rango_fin.ipAddress': 'El fin del rango debe ser una IPv4 de la red',
    'dns_primario.ipAddress': 'El DNS primario debe ser una IPv4',
    'dns_secundario.ipAddress': 'El DNS secundario debe ser una IPv4',
}

/** Campos editables de una red IPv4 (`contratos/pools.md` §1). */
const camposRedIpv4 = {
    nombre: vine
        .string()
        .trim()
        .maxLength(100)
        .nullable()
        .optional()
        .meta({ description: 'Nombre para reconocer la red en el panel («Clientes zona norte»)' }),
    gateway: ipv4().nullable().optional().meta({
        description: 'Puerta de enlace de los clientes; no se asigna a ningún servicio',
    }),
    rango_inicio: ipv4().nullable().optional().meta({
        description:
            'Primera IP que el sistema entrega a servicios; null (con rango_fin) = toda la red. Fuera del rango las IPs quedan reservadas',
    }),
    rango_fin: ipv4()
        .nullable()
        .optional()
        .meta({ description: 'Última IP que el sistema entrega a servicios' }),
    dns_primario: ipv4().nullable().optional().meta({ description: 'DNS para los clientes de la red' }),
    dns_secundario: ipv4().nullable().optional(),
}

export const crearRedIpv4Validator = conMensajes(
    vine.compile(
        vine.object({
            cidr: cidrV4(),
            tipo: vine.enum(['estatico', 'pool'] as const),
            ...camposRedIpv4,
        }),
    ),
    MENSAJES_RED_IPV4,
)

/** `PUT /redes-ipv4/:id`: todo opcional menos `version`. */
export const editarRedIpv4Validator = conMensajes(
    vine.compile(
        vine.object({
            version: versionEsperada(),
            cidr: cidrV4().optional().meta({
                description:
                    'Agrandar o achicar la red; 422 con la lista si alguna IP asignada quedaría fuera',
            }),
            tipo: vine.enum(['estatico', 'pool'] as const).optional(),
            ...camposRedIpv4,
        }),
    ),
    { ...MENSAJES_RED_IPV4, ...MENSAJE_VERSION },
)

const MENSAJES_MIGRAR = {
    ...MENSAJE_VERSION,
    'router_id.required': 'El router de destino es obligatorio: es el router al que pasa el pool',
    'router_id.number': 'El router de destino debe ser el id de un router',
}

/** Campos comunes de `POST /redes-ipv4/:id/migrar` y `POST /ipv6-bloques/:id/migrar`. */
const camposMigrar = {
    version: versionEsperada(),
    router_id: idEntidad().meta({ description: 'Router de destino' }),
    mover_servicios: vine
        .boolean()
        .optional()
        .meta({
            description:
                'false (por defecto): si algún servicio usa direcciones del pool responde 422 con la lista. ' +
                'true: los servicios pasan al router de destino conservando sus direcciones del pool',
        }),
    simular: vine.boolean().optional().meta({
        description:
            'true = no guarda nada: devuelve lo que pasaría (servicios y direcciones antes y después)',
    }),
}

export const migrarRedIpv4Validator = conMensajes(
    vine.compile(
        vine.object({
            ...camposMigrar,
            bloques_ipv6: vine.array(idEntidad()).maxLength(50).distinct().optional().meta({
                description:
                    'Bloques IPv6 del mismo router que se mudan junto con la red (así los servicios conservan también sus prefijos)',
            }),
        }),
    ),
    MENSAJES_MIGRAR,
)

export const migrarBloqueIpv6Validator = conMensajes(
    vine.compile(
        vine.object({
            ...camposMigrar,
            redes_ipv4: vine.array(idEntidad()).maxLength(50).distinct().optional().meta({
                description:
                    'Redes IPv4 del mismo router que se mudan junto con el bloque (así los servicios conservan también su IPv4)',
            }),
        }),
    ),
    MENSAJES_MIGRAR,
)

const MENSAJES_BLOQUE_IPV6 = {
    'prefijo.required':
        'El prefijo es obligatorio (por ejemplo 2001:db8:100::/40): es el bloque que te asignó tu proveedor y de él se recortan los pools',
    'prefijo.regex': 'Escribe el prefijo en notación CIDR, por ejemplo 2001:db8:100::/40',
}

const camposBloqueIpv6 = {
    nombre: vine.string().trim().maxLength(100).nullable().optional().meta({
        description: 'Nombre para reconocer el bloque en el panel',
    }),
    proveedor: vine.string().trim().maxLength(100).nullable().optional().meta({
        description: 'Proveedor que asignó el bloque (un router puede tener bloques de varios proveedores)',
    }),
}

export const crearBloqueIpv6Validator = conMensajes(
    vine.compile(vine.object({ prefijo: prefijoV6(), ...camposBloqueIpv6 })),
    MENSAJES_BLOQUE_IPV6,
)

export const editarBloqueIpv6Validator = conMensajes(
    vine.compile(
        vine.object({
            version: versionEsperada(),
            prefijo: prefijoV6().optional().meta({
                description: 'Agrandar o achicar el bloque; 422 con la lista si algún pool quedaría fuera',
            }),
            ...camposBloqueIpv6,
        }),
    ),
    { ...MENSAJES_BLOQUE_IPV6, ...MENSAJE_VERSION },
)

const MENSAJES_POOL_IPV6 = {
    'prefijo.required':
        'El prefijo es obligatorio (por ejemplo 2001:db8:100::/48): es la parte del bloque de la que salen los prefijos de los clientes',
    'prefijo.regex': 'Escribe el prefijo en notación CIDR, por ejemplo 2001:db8:100::/48',
    'tipo.required':
        'El tipo es obligatorio: «enlace» entrega un /64 para la conexión PPPoE y «delegacion» el prefijo que el router del cliente reparte en su red',
    'tamano_entrega.required':
        'El tamaño de entrega es obligatorio: es el prefijo que recibe cada servicio (/64 en enlace; /56 o /48 en delegación)',
    'tamano_entrega.enum': 'El tamaño de entrega debe ser 64, 56 o 48',
}

const camposPoolIpv6 = {
    nombre: vine.string().trim().maxLength(100).nullable().optional().meta({
        description: 'Nombre para reconocer el pool en el panel',
    }),
    nombre_en_router: vine.string().trim().maxLength(100).nullable().optional().meta({
        description: 'Nombre del pool en RouterOS (modo radius_pool)',
    }),
}

const tamanoEntrega = (description?: string) =>
    vine
        .enum([64, 56, 48] as const)
        .meta(description ? { type: 'integer', description } : { type: 'integer' })

export const crearPoolIpv6Validator = conMensajes(
    vine.compile(
        vine.object({
            prefijo: prefijoV6(),
            tipo: vine.enum(['enlace', 'delegacion'] as const),
            tamano_entrega: tamanoEntrega(),
            ...camposPoolIpv6,
        }),
    ),
    MENSAJES_POOL_IPV6,
)

export const editarPoolIpv6Validator = conMensajes(
    vine.compile(
        vine.object({
            version: versionEsperada(),
            prefijo: prefijoV6().optional().meta({
                description:
                    'Agrandar o achicar el pool; 422 con la lista si algún prefijo asignado quedaría fuera',
            }),
            tipo: vine
                .enum(['enlace', 'delegacion'] as const)
                .optional()
                .meta({
                    description: 'Solo se cambia si el pool no tiene prefijos asignados',
                }),
            tamano_entrega: tamanoEntrega('Solo se cambia si el pool no tiene prefijos asignados').optional(),
            ...camposPoolIpv6,
        }),
    ),
    { ...MENSAJES_POOL_IPV6, ...MENSAJE_VERSION },
)

/** `POST /ipv6-pools/vista-previa`: qué entregaría un pool, sin guardar. */
export const vistaPreviaPoolIpv6Validator = conMensajes(
    vine.compile(
        vine.object({
            prefijo: prefijoV6(),
            tipo: vine.enum(['enlace', 'delegacion'] as const),
            tamano_entrega: tamanoEntrega(),
        }),
    ),
    MENSAJES_POOL_IPV6,
)

/** `POST /ipv6-bloques/vista-previa`: cómo repartir un bloque entre enlace y delegación. */
export const vistaPreviaBloqueIpv6Validator = conMensajes(
    vine.compile(
        vine.object({
            prefijo: prefijoV6(),
            tamano_delegado: tamanoEntrega('Prefijo delegado por cliente (el del plan: /56 por defecto)'),
        }),
    ),
    {
        ...MENSAJES_BLOQUE_IPV6,
        'tamano_delegado.required':
            'El tamaño delegado es obligatorio: es el prefijo que recibe cada cliente para su red (el del plan, /56 por defecto)',
        'tamano_delegado.enum': 'El tamaño delegado debe ser 64, 56 o 48',
    },
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

const MENSAJES_PLAN = {
    'nombre.required': 'El nombre es obligatorio: es como aparece el plan en servicios y facturas',
    'precio.required': 'El precio es obligatorio: es lo que se factura cada periodo por el plan',
    'precio.regex': 'El precio debe ser un monto con hasta 2 decimales, por ejemplo 150.00',
    'bajada_kbps.required':
        'La velocidad de bajada es obligatoria: es la velocidad máxima de descarga del cliente, en kbps',
    'subida_kbps.required':
        'La velocidad de subida es obligatoria: es la velocidad máxima de carga del cliente, en kbps',
    'bajada_limitada_kbps.required':
        'La bajada limitada es obligatoria: es la velocidad de descarga que queda cuando el servicio se limita por mora',
    'subida_limitada_kbps.required':
        'La subida limitada es obligatoria: es la velocidad de carga que queda cuando el servicio se limita por mora',
}

export const crearPlanValidator = conMensajes(vine.compile(vine.object(camposPlan)), MENSAJES_PLAN)

/** `POST /planes/vista-previa`: los campos de velocidad del formulario de planes, sin guardar. */
export const vistaPreviaPlanValidator = conMensajes(
    vine.compile(
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
    ),
    MENSAJES_PLAN,
)

export const editarPlanValidator = conMensajes(
    vine.compile(
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
    ),
    { ...MENSAJES_PLAN, ...MENSAJE_VERSION },
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
export const marcarRouterMigradoValidator = conMensajes(
    vine.compile(
        vine.object({
            desde: instanteIso().nullable().optional(),
            motivo: vine.string().trim().minLength(3).maxLength(500),
            version: vine.number().withoutDecimals().min(0).optional(),
        }),
    ),
    {
        'motivo.required':
            'El motivo es obligatorio: queda en la bitácora para saber por qué se marcó o desmarcó la migración',
    },
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

export const desconectarSesionValidator = conMensajes(
    vine.compile(vine.object({ motivo: vine.string().trim().minLength(3).maxLength(500) })),
    {
        'motivo.required':
            'El motivo es obligatorio: queda en la bitácora del servicio junto con la desconexión',
    },
)

/** `DELETE /routers/:id?version=` (`contratos/eliminar.md`). */
export const eliminarRouterValidator = vine.compile(vine.object({ version: versionEsperada() }))

/** `GET /routers/:id/vista-previa-control?a=` (A2): modo al que se cambiaría. */
export const vistaPreviaControlValidator = conMensajes(
    vine.compile(vine.object({ a: vine.enum(CONTROLES_VELOCIDAD) })),
    {
        'a.required':
            'Indica el control de velocidad al que cambiarías (simple o arbol_pcq) para ver qué se crea y qué se borra',
    },
)

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

/** `POST /routers/conexion/registrar` (lo manda el script del router, contrato §6.1). */
export const registrarConexionValidator = vine.compile(
    vine.object({
        token: vine.string().trim().minLength(16).maxLength(128),
        public_key: clavePublicaWg(),
        routeros_version: vine
            .string()
            .trim()
            .maxLength(100)
            .nullable()
            .optional()
            .meta({ description: 'Versión de RouterOS del equipo (`/system resource version`)' }),
        api_ca: vine
            .string()
            .trim()
            .maxLength(20_000)
            .regex(/^-----BEGIN CERTIFICATE-----/)
            .nullable()
            .optional()
            .meta({
                description:
                    'PEM de la CA propia del router (argosisp-ca.crt); vacío = no cambia. Argos verifica con ella ' +
                    'el certificado de www-ssl',
            }),
    }),
)

/** `POST /routers/:id/conexion/clave`: pegar la clave a mano. */
export const conexionClaveValidator = vine.compile(vine.object({ public_key: clavePublicaWg() }))

/** `POST /internal/wireguard/estado` (wireguard-agente, contrato §6.3). */
export const estadoWireguardValidator = vine.compile(
    vine.object({
        servidor: vine.object({
            public_key: clavePublicaWg(),
            ip: vine.string().trim().maxLength(64).nullable().optional(),
            red: vine.string().trim().maxLength(64).nullable().optional(),
            puerto: vine.number().withoutDecimals().min(1).max(65535).nullable().optional(),
            interfaz: vine.string().trim().maxLength(64).nullable().optional(),
            modo: vine.string().trim().maxLength(64).nullable().optional(),
        }),
        peers: vine
            .array(
                vine.object({
                    public_key: clavePublicaWg(),
                    ultimo_handshake: instanteIso().nullable(),
                    endpoint: vine.string().trim().maxLength(100).nullable().optional(),
                    rx_bytes: vine.number().min(0).nullable().optional(),
                    tx_bytes: vine.number().min(0).nullable().optional(),
                }),
            )
            .maxLength(65_536),
        generado_en: instanteIso().nullable().optional(),
    }),
)

/** `GET /routers/duplicados` (`contratos/routers.md` §2): con `router_id`, solo su grupo. */
export const duplicadosRoutersValidator = vine.compile(
    vine.object({ router_id: vine.number().withoutDecimals().positive().optional() }),
)

/** `POST /routers/:id/unir` (`contratos/routers.md` §3): `version` del router que queda. */
export const unirRoutersValidator = vine.compile(
    vine.object({
        version: versionEsperada(),
        absorber_id: vine.number().withoutDecimals().positive(),
        simular: vine.boolean().optional(),
    }),
)

/*
|--------------------------------------------------------------------------
| Control de velocidad por capas (A2, `contratos/control-velocidad.md`)
|--------------------------------------------------------------------------
*/

const extrasEstrategia = () =>
    vine.object({
        rafaga: vine.boolean(),
        prioridad: vine.boolean(),
        garantizado: vine.boolean(),
        excluir_fasttrack: vine.boolean(),
        /** ausente = conserva el valor actual del router (`contratos/qos.md` §2) */
        qos: vine.boolean().optional(),
    })

const estrategiaCompleta = () =>
    vine.object({
        aplicacion: vine.enum(APLICACIONES),
        padre: vine.enum(PADRES),
        tipo_cola: vine.enum(TIPOS_COLA),
        extras: extrasEstrategia(),
    })

const estrategiaParcial = () =>
    vine
        .object({
            aplicacion: vine.enum(APLICACIONES).nullable().optional(),
            padre: vine.enum(PADRES).nullable().optional(),
            tipo_cola: vine.enum(TIPOS_COLA).nullable().optional(),
            extras: vine
                .object({
                    rafaga: vine.boolean().nullable().optional(),
                    prioridad: vine.boolean().nullable().optional(),
                    garantizado: vine.boolean().nullable().optional(),
                    excluir_fasttrack: vine.boolean().nullable().optional(),
                    qos: vine.boolean().nullable().optional(),
                })
                .nullable()
                .optional(),
        })
        .nullable()
        .optional()

const estrategiasRouter = () =>
    vine.object({
        pppoe: estrategiaCompleta(),
        ip_estatica: estrategiaCompleta(),
        dhcp_fija: estrategiaCompleta(),
    })

const excepcionEstrategia = () =>
    vine
        .object({
            pppoe: estrategiaParcial(),
            ip_estatica: estrategiaParcial(),
            dhcp_fija: estrategiaParcial(),
        })
        .nullable()

const reconectar = () =>
    vine.boolean().optional().meta({
        description:
            'Disconnect por lotes a las sesiones PPPoE para que entren ya con la estrategia nueva. Por defecto no: conservan lo anterior hasta reconectar',
    })

export const cambiarEstrategiaVelocidadValidator = vine.compile(
    vine.object({
        version: versionEsperada(),
        estrategia_velocidad: estrategiasRouter(),
        motivo: vine.string().trim().minLength(3).maxLength(500).optional(),
        reconectar: reconectar(),
    }),
)

export const estrategiaPlanRouterValidator = vine.compile(
    vine.object({
        version: versionEsperada().optional(),
        estrategia_velocidad: excepcionEstrategia(),
        motivo: vine.string().trim().minLength(3).maxLength(500).optional(),
        reconectar: reconectar(),
    }),
)

export const vistaPreviaEstrategiaValidator = vine.compile(
    vine.object({
        estrategia_velocidad: estrategiasRouter().optional(),
        planes: vine
            .array(vine.object({ plan_id: idEntidad(), estrategia_velocidad: excepcionEstrategia() }))
            .maxLength(500)
            .optional(),
        reconectar: reconectar(),
    }),
)

export const sincronizarPlanValidator = vine.compile(vine.object({ router_id: idEntidad().optional() }))

/*
|--------------------------------------------------------------------------
| QoS por clases (A2, `contratos/qos.md`)
|--------------------------------------------------------------------------
*/

const reglaQos = () =>
    vine.object({
        protocolo: vine.enum(PROTOCOLOS_QOS).nullable().optional(),
        puertos_destino: vine
            .string()
            .trim()
            .maxLength(200)
            .nullable()
            .optional()
            .meta({ description: 'n o n-m separados por coma (máx. 15); exige tcp o udp' }),
        puertos_origen: vine.string().trim().maxLength(200).nullable().optional(),
        dscp: vine.number().withoutDecimals().range([0, 63]).nullable().optional(),
        lista_destino: vine
            .string()
            .trim()
            .maxLength(63)
            .regex(/^[A-Za-z0-9._-]+$/)
            .nullable()
            .optional()
            .meta({
                description: 'address-list de destino (IPv4 e IPv6, mismo nombre) que mantiene el admin',
            }),
    })

const camposClaseQos = {
    nombre: vine.string().trim().minLength(1).maxLength(80),
    orden: vine.number().withoutDecimals().range([1, 1000]),
    prioridad: vine.number().withoutDecimals().range([1, 8]),
    garantizado_pct: vine.number().withoutDecimals().range([0, 100]).optional(),
    tope_pct: vine.number().withoutDecimals().range([1, 100]).nullable().optional(),
    reglas: vine.array(reglaQos()).maxLength(QOS_MAX_REGLAS).optional(),
    bytes_minimo: vine
        .number()
        .withoutDecimals()
        .range([1, 1_000_000_000_000])
        .nullable()
        .optional()
        .meta({ description: 'Clase de descargas: connection-bytes mínimo para reclasificar' }),
    reclasifica_de: vine.array(idEntidad()).maxLength(QOS_MAX_CLASES).optional(),
}

export const listarPerfilesQosValidator = vine.compile(vine.object({ ...reglasPaginacion }))

export const crearPerfilQosValidator = vine.compile(
    vine.object({
        nombre: vine.string().trim().minLength(1).maxLength(120),
        descripcion: vine.string().trim().maxLength(500).nullable().optional(),
        empresa_id: idEntidad().nullable().optional(),
        copiar_de: idEntidad().optional(),
    }),
)

export const crearClaseQosValidator = vine.compile(vine.object(camposClaseQos))

export const editarClaseQosValidator = vine.compile(
    vine.object({
        version: versionEsperada(),
        nombre: camposClaseQos.nombre.clone().optional(),
        orden: camposClaseQos.orden.clone().optional(),
        prioridad: camposClaseQos.prioridad.clone().optional(),
        garantizado_pct: vine.number().withoutDecimals().range([0, 100]).optional(),
        tope_pct: vine.number().withoutDecimals().range([1, 100]).nullable().optional(),
        reglas: vine.array(reglaQos()).maxLength(QOS_MAX_REGLAS).optional(),
        bytes_minimo: vine.number().withoutDecimals().range([1, 1_000_000_000_000]).nullable().optional(),
        reclasifica_de: vine.array(idEntidad()).maxLength(QOS_MAX_CLASES).optional(),
    }),
)

export const estadoClaseQosValidator = vine.compile(
    vine.object({
        version: versionEsperada(),
        motivo: vine.string().trim().minLength(3).maxLength(500).optional(),
    }),
)

export const asignarPerfilQosValidator = vine.compile(
    vine.object({
        version: versionEsperada(),
        qos_perfil_id: idEntidad().nullable().meta({ description: 'null = el perfil predeterminado' }),
        motivo: vine.string().trim().minLength(3).maxLength(500).optional(),
    }),
)
