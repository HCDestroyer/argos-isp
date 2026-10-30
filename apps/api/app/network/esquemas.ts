import {
    Dinero,
    auditable,
    booleano,
    definirEsquema,
    entero,
    enumerado,
    id,
    instante,
    jsonLibre,
    lista,
    nulable,
    objeto,
    texto,
    type EsquemaJson,
} from '#shared/openapi/esquemas'
import { TIPOS_PLAN } from '#network/tipos_plan'
import { APLICACIONES, PADRES, TIPOS_CONEXION, TIPOS_COLA } from '#network/estrategia_velocidad'
import { MOTIVOS_API } from '#network/diagnostico_routeros'
import { PROTOCOLOS_QOS } from '#network/qos'

/**
 * Schemas de respuesta del módulo network. Credenciales (api_password, radius_secret) nunca salen;
 * solo se indica si están configuradas.
 */

const kbpsNulable = (descripcion: string): EsquemaJson => ({ ...nulable(entero), description: descripcion })

/*
|--------------------------------------------------------------------------
| Control de velocidad por capas (A2, `contratos/control-velocidad.md`)
|--------------------------------------------------------------------------
*/

/**
 * Extras de la estrategia. La API además envía `qos` (prioridad por clases, `contratos/qos.md`, por
 * defecto false): queda fuera del esquema de respuesta hasta que el panel lo use (agregarlo, aunque
 * sea opcional, rompe los `Record<Extra, …>` de `apps/web`); se pide a A4 en `.claude/integration/a2.md`.
 * En las peticiones sí está (`extras.qos` opcional).
 */
const extrasVelocidad = {
    ...objeto({
        rafaga: { ...booleano, description: 'burst-* del plan (en PCQ: pcq-burst-*)' },
        prioridad: { ...booleano, description: 'priority del plan (1–8); false = 8' },
        garantizado: { ...booleano, description: 'limit-at (CIR); false = 0' },
        excluir_fasttrack: {
            ...booleano,
            description: 'Reglas `argosisp:top sin fasttrack` para argos-clientes antes de FastTrack',
        },
    }),
    description:
        'Además `qos` (boolean, por defecto false): prioridad por clases en el árbol (contratos/qos.md); la API ' +
        'siempre lo envía',
}

export const EstrategiaVelocidad = definirEsquema(
    'EstrategiaVelocidad',
    objeto({
        aplicacion: { ...enumerado(APLICACIONES), description: 'Capa 1: cómo se limita a cada cliente' },
        padre: { ...enumerado(PADRES), description: 'Capa 2: agregación' },
        tipo_cola: { ...enumerado(TIPOS_COLA), description: 'Capa 3: cola de las hojas o del PCQ' },
        extras: extrasVelocidad,
    }),
)

export const EstrategiasRouter = definirEsquema(
    'EstrategiasRouter',
    objeto(Object.fromEntries(TIPOS_CONEXION.map((t) => [t, EstrategiaVelocidad]))),
)

const enumNulable = (valores: readonly string[]): EsquemaJson => ({
    type: ['string', 'null'],
    enum: [...valores, null],
})

const parcialVelocidad = objeto(
    {
        aplicacion: enumNulable(APLICACIONES),
        padre: enumNulable(PADRES),
        tipo_cola: enumNulable(TIPOS_COLA),
        extras: nulable(
            objeto(
                {
                    rafaga: nulable(booleano),
                    prioridad: nulable(booleano),
                    garantizado: nulable(booleano),
                    excluir_fasttrack: nulable(booleano),
                    qos: nulable(booleano),
                },
                ['rafaga', 'prioridad', 'garantizado', 'excluir_fasttrack', 'qos'],
            ),
        ),
    },
    ['aplicacion', 'padre', 'tipo_cola', 'extras'],
)

export const ExcepcionEstrategia = definirEsquema(
    'ExcepcionEstrategia',
    objeto(Object.fromEntries(TIPOS_CONEXION.map((t) => [t, nulable(parcialVelocidad)])), [
        ...TIPOS_CONEXION,
    ]),
)

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
            nas_ip: {
                ...nulable(texto),
                description:
                    'IP con la que el router habla RADIUS; null solo en un router sin RADIUS (modo_seguridad api)',
            },
            modo_seguridad: {
                ...enumerado(['radius', 'api']),
                description:
                    'radius: PPPoE por RADIUS (y servicios ip_estatica/dhcp_fija por la API REST). api: router sin RADIUS, ' +
                    'solo ip_estatica y dhcp_fija por la API REST; sin nas_ip ni radius_secret obligatorios y sin PPPoE',
            },
            control_velocidad: {
                ...enumerado(['simple', 'arbol_pcq']),
                description:
                    'Obsoleto, derivado de estrategia_velocidad: arbol_pcq si PPPoE va por árbol, si no simple',
            },
            estrategia_velocidad: {
                ...EstrategiasRouter,
                description:
                    'Estrategia de control de velocidad por tipo de conexión (contratos/control-velocidad.md)',
            },
            routeros_version: {
                ...nulable(texto),
                description: 'Versión de RouterOS leída de /system/resource; null = no se sabe',
            },
            capacidad_bajada_kbps: kbpsNulable(
                'Capacidad del enlace (techo del padre global); null = sin techo',
            ),
            capacidad_subida_kbps: kbpsNulable(
                'Capacidad del enlace (techo del padre global); null = sin techo',
            ),
            api_url: {
                ...nulable(texto),
                description: 'https://host:puerto de la API REST; null = https://<host>',
            },
            api_tls_verificar: { ...booleano, description: 'Verificar el certificado TLS del router' },
            tiene_api_ca: {
                ...booleano,
                description:
                    'Hay una CA propia cargada (PEM). El PEM nunca sale por la API, como api_password; se cambia con ' +
                    'PUT /routers/:id (`api_ca`: el PEM nuevo, o null para quitarla)',
            },
            dhcp_servidor: {
                ...nulable(texto),
                description: 'server del lease DHCP (dhcp_fija); null = ROUTEROS_DHCP_SERVIDOR o all',
            },
            interfaz_clientes: {
                ...nulable(texto),
                description: 'Interfaz del ARP estático del amarre IP-MAC; null = ROUTEROS_INTERFAZ_CLIENTES',
            },
            modo_velocidad: {
                ...enumerado(['simple', 'pcq']),
                deprecated: true,
                description:
                    'Obsoleto: derivado de control_velocidad (arbol_pcq → pcq). Usar control_velocidad',
            },
            empresa_sugerida_id: {
                ...nulable(id),
                description:
                    'Empresa por defecto de los servicios nuevos del router (después de la de la zona)',
            },
            activo: booleano,
            en_linea: {
                ...nulable(booleano),
                description:
                    'Si el router responde: true con contacto periódico (accounting RADIUS o sondeo de RouterOS) ' +
                    'dentro de SESIONES_COLGADAS_INTERVALOS × AAA_INTERIM_SEGUNDOS (15 min); false si pasó el ' +
                    'umbral; null si ninguna fuente periódica lo mide todavía (no se sabe)',
            },
            ultimo_contacto: {
                ...nulable(instante),
                description:
                    'Última vez que el router mandó accounting, respondió a un sondeo, a un CoA/Disconnect o a un ' +
                    'comando de RouterOS (`audit.red` con ok); null si nunca',
            },
            serial: {
                ...nulable(texto),
                description:
                    'Número de serie del equipo (`/system/routerboard` serial-number) o software-id (`/system/license`, ' +
                    'CHR), leído por el sondeo; null = no se conoce. Sirve para detectar el mismo MikroTik registrado dos ' +
                    'veces (GET /routers/duplicados). La API siempre lo envía; opcional en el esquema hasta que las ' +
                    'fixtures del panel lo traigan',
            },
            unido_a_id: {
                ...nulable(id),
                description:
                    'Router que absorbió a este con POST /routers/:id/unir (este queda inactivo); null = no está unido. ' +
                    'La API siempre lo envía; opcional en el esquema hasta que las fixtures del panel lo traigan',
            },
            zona_id: {
                ...nulable(id),
                description:
                    'Zona del router (null = sin zona; no cambia el alcance del ACL). La API siempre la envía; ' +
                    'opcional en el esquema hasta que las fixtures del panel la traigan',
            },
            coordenadas: {
                ...nulable(texto),
                pattern: '^-?\\d+(\\.\\d+)?,-?\\d+(\\.\\d+)?$',
                description:
                    'Ubicación del router "lat,lng" en grados decimales, sin espacios, ' +
                    'el mismo formato que `coordenadas` de clientes y servicios; null = sin ubicar. La API siempre ' +
                    'la envía; opcional en el esquema hasta que las fixtures del panel la traigan',
            },
            qos_perfil_id: {
                ...nulable(id),
                description:
                    'Perfil de QoS por clases del router (contratos/qos.md); null = el predeterminado. Se cambia con ' +
                    'POST /routers/:id/qos-perfil. La API siempre lo envía; opcional en el esquema hasta que las ' +
                    'fixtures del panel lo traigan',
            },
            ...auditable,
        },
        ['serial', 'unido_a_id', 'zona_id', 'coordenadas', 'qos_perfil_id'],
    ),
)

const numero: EsquemaJson = { type: 'number' }

export const OcupacionPool = definirEsquema('OcupacionPool', {
    ...objeto({
        total: { ...entero, minimum: 0, description: 'IPv4: hosts utilizables. IPv6: prefijos que caben' },
        asignadas: { ...entero, minimum: 0, description: 'En uso por servicios' },
        libres: { ...entero, minimum: 0, description: 'Las que el sistema todavía puede entregar' },
        reservadas: {
            ...entero,
            minimum: 0,
            description:
                'No se entregan: IPv4, el gateway y las que quedan fuera del rango; IPv6, las ocupadas por prefijos de otro tamaño (estáticos)',
        },
        porcentaje: {
            ...numero,
            minimum: 0,
            maximum: 100,
            description: 'asignadas / (asignadas + libres) × 100, con un decimal',
        },
    }),
    description: 'Ocupación del pool (contratos/pools.md §2); total = asignadas + libres + reservadas',
})

export const RedIpv4 = definirEsquema(
    'RedIpv4',
    objeto({
        id,
        router_id: id,
        nombre: nulable(texto),
        cidr: texto,
        gateway: { ...nulable(texto), description: 'Puerta de enlace de los clientes; nunca se asigna' },
        tipo: enumerado(['estatico', 'pool']),
        rango_inicio: {
            ...nulable(texto),
            description: 'Primera IP que se entrega a servicios; null = toda la red',
        },
        rango_fin: {
            ...nulable(texto),
            description: 'Última IP que se entrega a servicios; null = toda la red',
        },
        dns_primario: nulable(texto),
        dns_secundario: nulable(texto),
        ocupacion: OcupacionPool,
        ...auditable,
    }),
)

export const Ipv6Bloque = definirEsquema(
    'Ipv6Bloque',
    objeto({
        id,
        router_id: id,
        nombre: nulable(texto),
        proveedor: { ...nulable(texto), description: 'Proveedor que asignó el bloque' },
        prefijo: texto,
        espacio: {
            ...objeto({
                pools: { ...entero, minimum: 0 },
                porcentaje_en_pools: {
                    ...numero,
                    description: 'Parte del bloque ya repartida en pools, con un decimal',
                },
            }),
            description: 'Cuánto del bloque está repartido en pools',
        },
        ...auditable,
    }),
)

const atributoRadius: EsquemaJson = {
    ...enumerado(['Framed-IPv6-Prefix', 'Delegated-IPv6-Prefix']),
    description: 'Atributo RADIUS con el que viaja el prefijo (enlace: Framed; delegación: Delegated)',
}

/** Qué recibe cada servicio de un pool IPv6 (también en la vista previa). */
const camposEntregaPool = {
    atributo_radius: atributoRadius,
    redes_lan_por_cliente: {
        ...entero,
        minimum: 1,
        description: '/64 que el router del cliente puede repartir en su LAN (1 en un pool de enlace)',
    },
    clientes_maximos: { ...entero, minimum: 1, description: 'Servicios que caben en el pool' },
    primer_prefijo: { ...texto, description: 'Lo que recibe el primer servicio' },
    segundo_prefijo: nulable(texto),
    ultimo_prefijo: texto,
}

export const EntregaPoolIpv6 = definirEsquema('EntregaPoolIpv6', objeto(camposEntregaPool))

export const Ipv6Pool = definirEsquema(
    'Ipv6Pool',
    objeto({
        id,
        bloque_id: id,
        router_id: id,
        nombre: nulable(texto),
        prefijo: texto,
        tipo: {
            ...enumerado(['enlace', 'delegacion']),
            description:
                'enlace: un /64 por servicio para la conexión PPPoE; delegacion: el prefijo que el router del cliente reparte en su red',
        },
        tamano_entrega: { type: 'integer', enum: [64, 56, 48] },
        nombre_en_router: {
            ...nulable(texto),
            description: 'Nombre del pool en RouterOS (modo radius_pool)',
        },
        ocupacion: OcupacionPool,
        entrega: EntregaPoolIpv6,
        ...auditable,
    }),
)

export const VistaPreviaPoolIpv6 = definirEsquema(
    'VistaPreviaPoolIpv6',
    objeto({
        prefijo: texto,
        tipo: enumerado(['enlace', 'delegacion']),
        tamano_entrega: { type: 'integer', enum: [64, 56, 48] },
        ...camposEntregaPool,
        traslapa_con: {
            ...nulable(texto),
            description: 'Pool existente con el que se traslaparía (no se podría crear); null si no hay',
        },
    }),
)

export const VistaPreviaBloqueIpv6 = definirEsquema(
    'VistaPreviaBloqueIpv6',
    objeto({
        prefijo: texto,
        tamano_delegado: { type: 'integer', enum: [64, 56, 48] },
        clientes: {
            ...entero,
            minimum: 1,
            description:
                'Servicios que caben con la división sugerida (un /64 de enlace y un delegado cada uno)',
        },
        redes_lan_por_cliente: {
            ...entero,
            minimum: 1,
            description: '/64 que cada cliente reparte en su LAN',
        },
        pools_sugeridos: lista(
            objeto({
                tipo: enumerado(['enlace', 'delegacion']),
                prefijo: texto,
                tamano_entrega: { type: 'integer', enum: [64, 56, 48] },
                clientes: { ...entero, minimum: 1 },
            }),
        ),
        ejemplos: lista(
            objeto({
                servicio: { ...entero, minimum: 1, description: '1 = el primer servicio' },
                prefijo_enlace: texto,
                prefijo_delegado: texto,
            }),
        ),
        traslapa_con: {
            ...nulable(texto),
            description: 'Bloque existente con el que se traslaparía (no se podría crear); null si no hay',
        },
    }),
)

const asignacionesServicio = (descripcion: string): EsquemaJson => ({
    ...objeto({
        router_id: id,
        ipv4: nulable(texto),
        prefijo_enlace_v6: nulable(texto),
        prefijo_delegado_v6: nulable(texto),
    }),
    description: descripcion,
})

export const MigracionPools = definirEsquema(
    'MigracionPools',
    objeto({
        router_origen_id: id,
        router_destino_id: id,
        redes_ipv4: lista(RedIpv4),
        bloques_ipv6: lista(Ipv6Bloque),
        servicios: {
            ...lista(
                objeto({
                    servicio_id: id,
                    user_ppp: nulable(texto),
                    antes: asignacionesServicio('Router y direcciones antes de migrar'),
                    despues: asignacionesServicio('Router y direcciones después de migrar'),
                }),
            ),
            description: 'Servicios que pasaron (o pasarían, con simular) al router de destino',
        },
        simulado: { ...booleano, description: 'true = vista previa: no se guardó nada' },
    }),
)

const AvisoDireccionamiento = objeto({
    codigo: enumerado([
        'sin_ipv4',
        'sin_ipv4_libres',
        'sin_pool_enlace',
        'sin_pool_delegacion',
        'sin_prefijos_enlace_libres',
        'sin_prefijos_delegados_libres',
    ]),
    mensaje: texto,
})

export const DireccionamientoRouter = definirEsquema(
    'DireccionamientoRouter',
    objeto({
        router_id: id,
        redes_ipv4: lista(RedIpv4),
        bloques_ipv6: lista({
            allOf: [Ipv6Bloque, objeto({ pools: lista(Ipv6Pool) })],
        }),
        ocupacion: objeto({
            ipv4: OcupacionPool,
            ipv6: lista(
                objeto({
                    tipo: enumerado(['enlace', 'delegacion']),
                    tamano_entrega: { type: 'integer', enum: [64, 56, 48] },
                    ocupacion: OcupacionPool,
                }),
            ),
        }),
        planes: {
            ...lista(
                objeto({
                    plan_id: id,
                    nombre: texto,
                    dual_stack: enumerado(['ambos', 'v4', 'v6']),
                    ipv4: objeto({
                        origen: {
                            ...enumerado(['redes', 'pool_router', 'ninguna']),
                            description:
                                'redes: IP fija de las redes del router; pool_router: la asigna el router (Framed-Pool); ninguna: plan solo IPv6 o sin origen',
                        },
                        pool: nulable(texto),
                        libres: nulable(entero),
                    }),
                    ipv6: nulable(
                        objeto({
                            prefijo_enlace: { type: 'integer', enum: [64] },
                            prefijo_delegado: { type: 'integer', enum: [64, 56, 48] },
                            redes_lan_por_cliente: { ...entero, minimum: 1 },
                            enlaces_libres: { ...entero, minimum: 0 },
                            delegados_libres: { ...entero, minimum: 0 },
                        }),
                    ),
                    avisos: lista(AvisoDireccionamiento),
                }),
            ),
            description:
                'Qué recibe un servicio nuevo de cada plan disponible en el router (modo IPv6 radius_servicio)',
        },
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

/** Advertencia que no bloquea (tipo de plan); `codigo` estable para el frontend. */
export const Advertencia = definirEsquema(
    'Advertencia',
    objeto({
        codigo: enumerado(['plan_dedicado_asimetrico', 'plan_dedicado_compartido', 'servicio_cliente_cf']),
        mensaje: texto,
    }),
)

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
            tipo: {
                ...enumerado(TIPOS_PLAN),
                description: 'residencial (por defecto), empresarial o dedicado',
            },
            global: booleano,
            activo: booleano,
            ...auditable,
            warnings: {
                ...lista(Advertencia),
                description: 'Solo al crear o editar: advertencias del tipo de plan (nunca bloquean)',
            },
        },
        // `warnings` es opcional de verdad: solo en las respuestas de crear y editar
        ['warnings'],
    ),
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
        // excepciones de velocidad (semana 2): null = hereda del plan
        reuso: { ...nulable(entero), description: 'null = hereda del plan' },
        garantizado_pct: { ...nulable({ type: 'number' }), description: 'null = hereda del plan' },
        rafaga_bajada_kbps: kbpsNulable('null = hereda del plan'),
        rafaga_subida_kbps: kbpsNulable('null = hereda del plan'),
        rafaga_umbral_pct: { ...nulable(entero), description: 'null = hereda del plan' },
        rafaga_segundos: { ...nulable(entero), description: 'null = hereda del plan' },
        prioridad: { ...nulable(entero), description: 'null = hereda del plan' },
        estrategia_velocidad: {
            ...nulable(ExcepcionEstrategia),
            description:
                'Estrategia propia del plan en este router, parcial por tipo de conexión; null = hereda la del router',
        },
        ...auditable,
    }),
)

/** Plan con su configuración efectiva en un router (plantilla + `planes_routers`). */
export const PlanEfectivo = definirEsquema(
    'PlanEfectivo',
    objeto({
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
        tipo: {
            ...enumerado(TIPOS_PLAN),
            description: 'Tipo del plan (residencial, empresarial, dedicado)',
        },
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

/** Fecha de migración del router al nuevo `aaa` (`GET /routers/:id/migracion-aaa`). */
export const MigracionAaaRouter = definirEsquema(
    'MigracionAaaRouter',
    objeto({
        router_id: id,
        aaa_desde: {
            ...nulable(instante),
            description:
                'Desde cuándo el router usa el nuevo aaa (marcado por el operador); null si no se marcó',
        },
        motivo: nulable(texto),
        version: { ...entero, description: '0 si nunca se marcó; mandarla al marcar (409 si cambió)' },
        updated_at: nulable(instante),
        primer_accounting: {
            ...nulable(instante),
            description:
                'Inicio de la primera sesión registrada del router (dato de referencia, no la migración)',
        },
    }),
)

/** PPPoE del router sin sesión desde una fecha (`GET /routers/:id/resumen-sesiones`). */
export const ServicioSinSesion = definirEsquema(
    'ServicioSinSesion',
    objeto({
        servicio_id: id,
        cliente_id: id,
        cliente_nombre: texto,
        user_ppp: texto,
        estado: enumerado(['activo', 'limitado', 'suspendido']),
        ultima_sesion_inicio: {
            ...nulable(instante),
            description: 'Última sesión registrada (de cualquier fecha)',
        },
        ultima_sesion_fin: nulable(instante),
    }),
)

/** Resumen de sesiones de un router para la pantalla "Migración de router" (A4). */
export const ResumenSesionesRouter = definirEsquema(
    'ResumenSesionesRouter',
    objeto({
        router_id: id,
        desde: { ...instante, description: 'El usado: el de la consulta o, si no vino, `aaa_desde`' },
        aaa_desde: { ...nulable(instante), description: 'Fecha de migración marcada del router (o null)' },
        servicios: {
            ...entero,
            description:
                'Servicios PPPoE no retirados ni pendientes de instalación del router (dentro del alcance)',
        },
        con_sesion_activa: { ...entero, description: 'De esos servicios, los que tienen sesión abierta' },
        sesiones_activas: {
            ...entero,
            description: 'Sesiones abiertas en el router (incluye user_ppp desconocidos)',
        },
        con_sesion_desde: {
            ...entero,
            description: 'De esos servicios, los que tuvieron sesión viva en o después de `desde`',
        },
        sin_sesion_desde: lista(ServicioSinSesion),
    }),
)

/**
 * Fila de `audit.red` (`GET /red/eventos`): un CoA, un Disconnect-Request o una escritura en
 * RouterOS, con la respuesta del equipo. Las credenciales salen como `***`.
 */
export const EventoRed = definirEsquema(
    'EventoRed',
    objeto({
        id,
        tipo: enumerado(['coa', 'disconnect', 'routeros']),
        router_id: nulable(id),
        router_nombre: nulable(texto),
        servicio_id: nulable(id),
        ok: { ...booleano, description: 'ACK del NAS o escritura aceptada por RouterOS' },
        comando: {
            ...jsonLibre,
            description:
                'Lo que se envió. CoA/Disconnect: `evento_id`, `evento`, `razon`, `sesion_id`, `nas_ip`, ' +
                '`puerto`, `atributos`, `intento`. RouterOS: `metodo`, `ruta`, `id`, `propiedades`, `host`, ' +
                '`intento` u `operacion` (fila final de un fallo)',
        },
        respuesta: {
            ...nulable(jsonLibre),
            description:
                'Lo que respondió el equipo. CoA/Disconnect: `resultado` (ack, nak, timeout, error, ' +
                'sin_secret, sin_rate_limit), `codigo`, `error`, `rtt_ms`, `final`. RouterOS: `status`, ' +
                '`objeto` o `error`/`tipo_error`',
        },
        created_at: instante,
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

const objetoVistaPrevia = objeto({
    ruta: texto,
    clave: { ...texto, description: '`comment` del objeto (o `name` en `/queue/type`)' },
    nombre: nulable(texto),
})

/** Vista previa del cambio de modo de control de un router (A2, `GET /routers/:id/vista-previa-control`). */
export const VistaPreviaControl = definirEsquema(
    'VistaPreviaControl',
    objeto({
        router_id: id,
        de: enumerado(['simple', 'arbol_pcq']),
        a: enumerado(['simple', 'arbol_pcq']),
        servicios: entero,
        lotes: {
            ...entero,
            description: 'Lotes en que el worker migra los servicios (con pausa entre lotes)',
        },
        sesiones_a_desconectar: {
            ...entero,
            description:
                'Sesiones PPPoE abiertas que reciben Disconnect para entrar con el perfil del modo nuevo',
        },
        menus: lista(objeto({ ruta: texto, crear: entero, actualizar: entero, borrar: entero })),
        crear: lista(objetoVistaPrevia),
        actualizar: lista(objetoVistaPrevia),
        borrar: lista(objetoVistaPrevia),
    }),
)

const parKbps = objeto({ subida: entero, bajada: entero })

/** Resultado de `POST /planes/vista-previa` (`vistaPreviaVelocidad` de `app/network/velocidad.ts`). */
export const VistaPreviaVelocidad = definirEsquema(
    'VistaPreviaVelocidad',
    objeto({
        rate_limit: {
            type: 'string',
            description: 'Mikrotik-Rate-Limit completo en estado activo (o rate_limit_override)',
        },
        rate_limit_limitado: {
            type: 'string',
            description: 'Mikrotik-Rate-Limit completo en estado limitado (sin ráfaga)',
        },
        garantizado_pct_efectivo: {
            type: 'number',
            description: 'garantizado_pct o 100 / reuso, con 2 decimales hacia abajo',
        },
        limit_at_servicio_kbps: { ...parKbps, description: 'CIR (limit-at) de cada servicio' },
        padre: objeto({
            max_limit: {
                type: 'string',
                description: 'max-limit subida/bajada: MIR × activos / reuso, hacia arriba',
            },
            limit_at: { type: 'string', description: 'limit-at subida/bajada: CIR × activos' },
            prioridad: entero,
            max_limit_kbps: parKbps,
            limit_at_kbps: parKbps,
            activos: { type: 'integer', minimum: 0, description: 'Con 0 se calcula como 1' },
        }),
    }),
)

const motivoDuplicado = {
    ...enumerado(['api', 'nas_ip', 'serial']),
    description:
        'api: mismo host:puerto de la API REST (api_url o https://<host>); nas_ip: misma nas_ip; serial: mismo ' +
        'número de serie o software-id del equipo',
}

/** Un grupo de `GET /routers/duplicados` (`contratos/routers.md` §2). */
export const GrupoRoutersDuplicados = definirEsquema(
    'GrupoRoutersDuplicados',
    objeto({
        motivos: { ...lista(motivoDuplicado), description: 'Por qué parecen el mismo equipo' },
        claves: {
            ...lista(objeto({ motivo: motivoDuplicado, valor: texto })),
            description: 'Valores compartidos por dos o más routers del grupo',
        },
        routers: lista(
            objeto({
                id,
                nombre: texto,
                host: texto,
                api_url: nulable(texto),
                nas_ip: nulable(texto),
                serial: nulable(texto),
                control_velocidad: enumerado(['simple', 'arbol_pcq']),
                servicios_total: { ...entero, description: 'Servicios no retirados del router' },
                sesiones_abiertas: { ...entero, description: 'Sesiones PPPoE abiertas atribuidas al router' },
                servicios: {
                    ...lista(
                        objeto({
                            id,
                            cliente_id: id,
                            user_ppp: nulable(texto),
                            estado: texto,
                            tipo_conexion: texto,
                        }),
                    ),
                    description: 'Los primeros 50 servicios no retirados (por id)',
                },
                version: entero,
            }),
        ),
    }),
)

/** Resultado de `POST /routers/:id/unir` (o su simulación; `contratos/routers.md` §3). */
export const UnionRouters = definirEsquema(
    'UnionRouters',
    objeto({
        router_id: { ...id, description: 'El router que queda' },
        absorbido_id: { ...id, description: 'El router absorbido (queda desactivado y unido)' },
        simulado: { ...booleano, description: 'true = simulación: no se guardó nada' },
        coincidencias: {
            ...lista(motivoDuplicado),
            description: 'Claves que comparten; vacío = no parecen el mismo equipo (va un aviso)',
        },
        servicios: {
            ...lista(
                objeto({ servicio_id: id, user_ppp: nulable(texto), estado: texto, tipo_conexion: texto }),
            ),
            description: 'Servicios que pasan al router que queda (conservan sus direcciones)',
        },
        redes_ipv4: { ...lista(id), description: 'Redes IPv4 que pasan al que queda' },
        ipv6_bloques: { ...lista(id), description: 'Bloques IPv6 (con sus pools) que pasan al que queda' },
        planes_movidos: {
            ...lista(id),
            description: 'plan_id de las implementaciones que pasan al que queda',
        },
        planes_descartados: {
            ...lista(id),
            description:
                'plan_id implementados en los dos: gana la del que queda y se descarta la del absorbido',
        },
        sesiones_abiertas: { ...entero, description: 'Sesiones abiertas que pasan al que queda' },
        avisos: { ...lista(texto), description: 'Lo que el operador debe saber antes de confirmar' },
        bloqueos: {
            ...lista(enumerado(['secreto_radius_distinto'])),
            description:
                'Solo en la simulación: lo que hará fallar la unión (422 con ese código). secreto_radius_distinto: ' +
                'primero el mismo secreto RADIUS en el equipo y en Argos. Vacío = se puede unir',
        },
        reencadenados: {
            ...lista(id),
            description: 'Routers que ya estaban unidos al absorbido y ahora apuntan al que queda',
        },
        router: Router,
        absorbido: Router,
    }),
)

/*
|--------------------------------------------------------------------------
| Control de velocidad por capas: vista previa, matriz, sincronizar, reconciliar y corte (A2)
|--------------------------------------------------------------------------
*/

const CODIGOS_CORTE = [
    'sin_api',
    'router_no_responde',
    'faltan_reglas',
    'reglas_desactivadas',
    'reglas_distintas',
    'reglas_desordenadas',
    'falta_lista_suspendidos',
    'falta_perfil_suspendido',
    'walled_garden',
    'portal_sin_configurar',
    'portal_sin_ipv4',
    'portal_inalcanzable',
    'portal_sin_corte',
    'suspendidos_fuera_de_lista',
    'fasttrack',
]

const problemaEstrategia = objeto({
    field: {
        ...texto,
        description: 'Capa con el problema, p. ej. estrategia_velocidad.ip_estatica.aplicacion',
    },
    rule: {
        ...texto,
        description:
            'aplicacion_tipo, tipo_cola, version, familia_router, plan_consistente, familia_plan o enum',
    },
    message: { ...texto, description: 'El porqué, en lenguaje simple' },
})

const advertenciaEstrategia = objeto({
    regla: {
        ...texto,
        description:
            'sin_techo, reuso_dedicado, sin_padre_prioridad, fasttrack, version_desconocida o fuera_del_techo',
    },
    mensaje: texto,
})

/** `POST /routers/:id/vista-previa-estrategia` (`contratos/control-velocidad.md` §4). */
export const VistaPreviaEstrategia = definirEsquema(
    'VistaPreviaEstrategia',
    objeto({
        router_id: id,
        valida: { ...booleano, description: 'false: la combinación no es válida (ver errores)' },
        errores: lista(problemaEstrategia),
        advertencias: lista(advertenciaEstrategia),
        de: EstrategiasRouter,
        a: EstrategiasRouter,
        planes: lista(
            objeto({ plan_id: id, de: nulable(ExcepcionEstrategia), a: nulable(ExcepcionEstrategia) }),
        ),
        crear: lista(objetoVistaPreviaEstrategia()),
        actualizar: lista(objetoVistaPreviaEstrategia()),
        borrar: lista(objetoVistaPreviaEstrategia()),
        menus: lista(objeto({ ruta: texto, crear: entero, actualizar: entero, borrar: entero })),
        servicios: { ...entero, description: 'Servicios cuya estrategia cambia' },
        lotes: { ...entero, description: 'Lotes de 50 servicios en que el worker los migra' },
        sesiones_coa: {
            ...entero,
            description: 'Sesiones PPPoE vivas que reciben el rate-limit nuevo por CoA',
        },
        sesiones_conservan: {
            ...entero,
            description: 'Sesiones PPPoE que conservan lo anterior hasta reconectar por su cuenta',
        },
        sesiones_a_desconectar: {
            ...entero,
            description: 'Solo con reconectar: sesiones que reciben Disconnect',
        },
        orden: lista(enumerado(['preparar', 'lotes', 'terminar'])),
    }),
)

function objetoVistaPreviaEstrategia() {
    return objeto({
        ruta: texto,
        clave: { ...texto, description: '`comment` del objeto (o `name` en `/queue/type`)' },
        nombre: nulable(texto),
    })
}

/** `GET /red/control-velocidad/matriz`: capas, compatibilidades y reglas (la pantalla no las copia). */
export const MatrizControlVelocidad = definirEsquema(
    'MatrizControlVelocidad',
    objeto({
        aplicaciones: lista(
            objeto({
                valor: enumerado(APLICACIONES),
                familia: enumerado(['simple', 'arbol']),
                tipos_conexion: lista(enumerado(TIPOS_CONEXION)),
                tipos_cola: lista(enumerado(TIPOS_COLA)),
                coa_en_vivo: { ...booleano, description: 'La velocidad de una sesión viva cambia por CoA' },
            }),
        ),
        tipos_cola: lista(objeto({ valor: enumerado(TIPOS_COLA), routeros_minimo: nulable(texto) })),
        padres: lista(objeto({ valor: enumerado(PADRES) })),
        extras: lista(
            objeto({
                valor: enumerado(['rafaga', 'prioridad', 'garantizado', 'excluir_fasttrack', 'qos']),
                por_defecto: booleano,
            }),
        ),
        reglas: lista(
            objeto({
                rule: { ...texto, description: 'El mismo `rule` de los errores 422' },
                mensaje: texto,
            }),
        ),
        advertencias: lista(texto),
        atajos: objeto({ simple: EstrategiasRouter, arbol_pcq: EstrategiasRouter }),
    }),
)

/** `POST /planes/:id/sincronizar` (`contratos/control-velocidad.md` §5). */
export const SincronizacionPlan = definirEsquema(
    'SincronizacionPlan',
    objeto({
        plan_id: id,
        aaa_reescritos: { ...entero, description: 'Servicios PPPoE del plan cuyo aaa:user:* se reescribe' },
        routers: lista(
            objeto({
                router_id: id,
                nombre: texto,
                servicios: entero,
                sesiones_actualizadas: {
                    ...entero,
                    description:
                        'Sesiones PPPoE vivas a las que se pidió CoA con la velocidad nueva (sin desconectar)',
                },
                sesiones_sin_coa: {
                    ...entero,
                    description:
                        'Sesiones abiertas sin CoA (PCQ del plan, suspendidas o con otra estrategia)',
                },
                colas_cambiadas: {
                    ...entero,
                    description: 'Objetos que el reconciliador creó, corrigió o borró',
                },
                reconciliado: { ...booleano, description: 'false: el router no tiene API (solo RADIUS)' },
                errores: lista(texto),
            }),
        ),
    }),
)

/** `GET /routers/:id/vista-previa-reconciliar`: lo que «Reconciliar ahora» haría, sin escribir. */
export const VistaPreviaReconciliar = definirEsquema(
    'VistaPreviaReconciliar',
    objeto({
        router_id: id,
        cambios: lista(
            objeto({
                ruta: texto,
                clave: texto,
                accion: enumerado(['crear', 'actualizar', 'borrar', 'mover']),
                grupo: enumerado(['servicio', 'velocidad', 'corte']),
            }),
        ),
        menus: lista(
            objeto({ ruta: texto, crear: entero, actualizar: entero, borrar: entero, mover: entero }),
        ),
        avisos: lista(texto),
        error: { ...nulable(texto), description: 'El router no respondió o no tiene credenciales' },
    }),
)

/** `GET /routers/:id/diagnostico-corte`: el chequeo `corte` de «Probar conexión». */
export const DiagnosticoCorte = definirEsquema(
    'DiagnosticoCorte',
    objeto({
        router_id: id,
        ok: {
            ...booleano,
            description: 'Un suspendido de este router ve la página de corte (todo en verde)',
        },
        chequeos: lista(
            objeto({
                clave: {
                    ...enumerado([
                        'lista_suspendidos',
                        'reglas',
                        'portal_http',
                        'sesiones_suspendidas',
                        'fasttrack',
                        'perfil_suspendido',
                        'walled_garden',
                    ]),
                    description:
                        'lista_suspendidos (existe o no hace falta), reglas (filter y NAT activas y en orden), ' +
                        'portal_http (`/tool/fetch` al destino real del NAT), sesiones_suspendidas (cada IP en la ' +
                        'lista), fasttrack (saltos antes de FastTrack), perfil_suspendido, walled_garden',
                },
                ok: { ...nulable(booleano), description: 'null: no se pudo comprobar' },
                codigo: { ...nulable(enumerado(CODIGOS_CORTE)), description: 'null si salió bien' },
                detalle: { ...texto, description: 'Qué se vio y qué hacer, en lenguaje simple' },
                comandos: {
                    ...lista(texto),
                    description:
                        'Comandos de RouterOS (terminal) para arreglarlo a mano; vacío si no hace falta',
                },
                reconciliar: { ...booleano, description: '«Reconciliar ahora» lo arregla' },
            }),
        ),
        problemas: lista(
            objeto({
                codigo: enumerado(CODIGOS_CORTE),
                mensaje: { ...texto, description: 'Qué falla y qué hacer, en lenguaje simple' },
                reconciliar: { ...booleano, description: '«Reconciliar ahora» lo arregla' },
                comandos: lista(texto),
            }),
        ),
        faltan: lista(
            objeto({
                ruta: texto,
                clave: texto,
                accion: enumerado(['crear', 'actualizar', 'borrar', 'mover']),
            }),
        ),
        portal: objeto({
            url: { ...nulable(texto), description: 'PORTAL_URL_PUBLICA (la que ve el cliente)' },
            fqdn: nulable(texto),
            ipv4: {
                ...nulable(texto),
                description:
                    'IPv4 del portal que Argos pone en el NAT: ROUTERS_SERVICIO_PORTAL_V4, la IP de la URL o el ' +
                    'FQDN resuelto en esta lectura (nunca se guarda); null si no la sabe',
            },
            origen: nulable(enumerado(['variable', 'url', 'dns'])),
            destino_nat: {
                ...nulable(texto),
                description:
                    'http://<ip>:<puerto>/corte: el destino real del dst-nat del router (o el deseado)',
            },
            alcanzable: { ...nulable(booleano), description: 'null: no se probó (sin destino)' },
            http_status: nulable(entero),
            detalle: nulable(texto),
        }),
        suspendidos: objeto({
            total: { ...entero, description: 'Suspendidos con IPv4 (PPPoE con sesión abierta o WISP)' },
            fuera_de_lista: {
                ...entero,
                description: 'Cuántos no están en la address-list: navegan sin corte',
            },
            ejemplos: lista(
                objeto({
                    servicio_id: id,
                    tipo_conexion: enumerado(['pppoe', 'ip_estatica', 'dhcp_fija']),
                    ipv4: texto,
                }),
            ),
        }),
        limites: {
            ...lista(texto),
            description: 'Lo que el corte no hace por diseño (HTTPS e IPv6 no se redirigen); mostrar siempre',
        },
    }),
)

/*
|--------------------------------------------------------------------------
| Conexión de routers por WireGuard (contratos/conexion-routers.md)
|--------------------------------------------------------------------------
*/

export const ConexionRouter = definirEsquema(
    'ConexionRouter',
    objeto({
        router_id: id,
        estado: {
            ...enumerado(['sin_configurar', 'pendiente', 'conectado']),
            description:
                'sin_configurar: nunca se generó el script; pendiente: sin registrar o sin handshake en los ' +
                'últimos 3 min; conectado: handshake de menos de 3 min',
        },
        ip_tunel: { ...nulable(texto), description: 'IP del router en el túnel (/32 de ARGOSISP_WG_RED)' },
        public_key: { ...nulable(texto), description: 'Clave pública WireGuard del router (no es secreta)' },
        ultimo_handshake: nulable(instante),
        handshake_reciente: {
            ...booleano,
            description: 'Hubo handshake en los últimos 180 s (el túnel está vivo)',
        },
        registrado_en: nulable(instante),
        routeros_version: { ...nulable(texto), description: 'La que informó el router al registrarse' },
        token_vence: {
            ...nulable(instante),
            description: 'Vencimiento del token del último script; null si ya se usó o no hay',
        },
        version: { ...entero, description: '0 sin configurar' },
    }),
)

export const RegistroConexion = definirEsquema(
    'RegistroConexion',
    objeto({
        router_id: id,
        ip_tunel: {
            ...texto,
            description: 'IP /32 del router en el túnel (el script la compara con la suya)',
        },
        servidor: objeto({
            public_key: { ...texto, description: 'Clave pública del servidor WireGuard' },
            endpoint: { ...texto, description: 'ARGOSISP_WG_ENDPOINT' },
            puerto: entero,
            ip: { ...texto, description: 'IP del servidor en el túnel (RADIUS, CoA, API)' },
        }),
    }),
)

export const PeerWireguard = definirEsquema(
    'PeerWireguard',
    objeto({ router_id: id, public_key: texto, ip_tunel: texto }),
)

export const PeersWireguard = definirEsquema('PeersWireguard', objeto({ data: lista(PeerWireguard) }))

export const ChequeoConexion = definirEsquema(
    'ChequeoConexion',
    objeto(
        {
            clave: {
                ...enumerado(['tunel', 'api', 'equipo', 'radius', 'corte']),
                description:
                    '`corte` (si la API respondió): ¿un suspendido ve la página de corte? (ver `corte`)',
            },
            ok: {
                ...nulable(booleano),
                description: 'null = no se pudo comprobar (falló otro chequeo antes)',
            },
            detalle: { ...texto, description: 'Explicación en lenguaje simple; nunca trae secretos' },
            ms: entero,
            motivo: {
                ...nulable(enumerado(MOTIVOS_API)),
                description:
                    'Solo en `api` cuando falla: sin_credenciales, sin_certificado (www-ssl sin certificado), ' +
                    'certificado_no_confiable, puerto_cerrado (www-ssl apagado o firewall), protocolo (HTTPS contra ' +
                    'un puerto HTTP), credenciales (401), politicas (faltan api/rest-api), no_responde, respuesta',
            },
            datos: {
                ...nulable(jsonLibre),
                description:
                    '`equipo`: { version, modelo, uptime, cpu_pct }; `radius`: { direcciones, esperadas, secreto_verificado }; ' +
                    'si falla: { error_tecnico } (el texto de Node/OpenSSL, solo para soporte; el detalle ya lo explica)',
            },
            corte: {
                ...nulable(DiagnosticoCorte),
                description:
                    'Solo en `corte`: los pasos con sus comandos de RouterOS, suspendidos fuera de la lista y límites',
            },
        },
        ['motivo', 'datos', 'corte'],
    ),
)

export const PruebaConexion = definirEsquema(
    'PruebaConexion',
    objeto({
        router_id: id,
        ok: { ...booleano, description: 'Todos los chequeos salieron bien' },
        probado_en: instante,
        chequeos: lista(ChequeoConexion),
    }),
)

export const ReconciliacionEncolada = definirEsquema(
    'ReconciliacionEncolada',
    objeto({
        router_id: id,
        job_id: texto,
        encolado: {
            ...booleano,
            description: 'false: ya había una esperando o en curso (no se encoló otra)',
        },
    }),
)

export const SincronizacionServicio = definirEsquema(
    'SincronizacionServicio',
    objeto({
        servicio_id: id,
        router_id: id,
        cambios: lista(
            objeto(
                {
                    router_id: id,
                    ruta: { ...texto, description: 'Menú de RouterOS (`/queue/simple`, `/ip/arp`…)' },
                    comment: { ...texto, description: '`argosisp:servicio:<id>` o `argosisp:plan:<id>`' },
                    accion: enumerado(['creado', 'actualizado', 'borrado']),
                    duplicados: entero,
                },
                ['duplicados'],
            ),
        ),
        ya_estaba_bien: { ...booleano, description: 'Nada que corregir y el router respondió' },
        avisos: lista(texto),
        error: {
            ...nulable(objeto({ motivo: enumerado(MOTIVOS_API), detalle: texto })),
            description: 'El router no respondió o rechazó un comando (lenguaje simple); null si todo bien',
        },
    }),
)

/*
|--------------------------------------------------------------------------
| QoS por clases (A2, `contratos/qos.md`)
|--------------------------------------------------------------------------
*/

export const ReglaQos = definirEsquema(
    'ReglaQos',
    objeto({
        protocolo: { ...enumNulable(PROTOCOLOS_QOS), description: 'tcp, udp, icmp o null (cualquiera)' },
        puertos_destino: { ...nulable(texto), description: '`dst-port`: n o n-m separados por coma' },
        puertos_origen: { ...nulable(texto), description: '`src-port`' },
        dscp: { ...nulable(entero), description: '0–63' },
        lista_destino: {
            ...nulable(texto),
            description: '`dst-address-list` que mantiene el admin en el router',
        },
    }),
)

export const ClaseQos = definirEsquema(
    'ClaseQos',
    objeto({
        id,
        perfil_id: id,
        nombre: texto,
        orden: {
            ...entero,
            description: 'Orden de clasificación: la primera clase que coincide se queda la conexión',
        },
        prioridad: { ...entero, description: '`priority` de la hoja del árbol (1 = primero)' },
        garantizado_pct: {
            ...entero,
            description: '`limit-at` de la hoja = % de la capacidad del nodo del plan',
        },
        tope_pct: {
            ...nulable(entero),
            description:
                'Tope por cliente (pcq-rate = MIR × %) y en total (max-limit de la hoja); null = sin tope',
        },
        es_resto: { ...booleano, description: 'Lo que no coincide con ninguna clase (una por perfil)' },
        reglas: lista(ReglaQos),
        bytes_minimo: {
            ...nulable(entero),
            description:
                'Clase de descargas: reclasifica conexiones que pasaron estos bytes (connection-bytes)',
        },
        reclasifica_de: {
            ...lista(id),
            description: 'Clases de las que una clase de descargas toma conexiones',
        },
        activa: booleano,
        ...auditable,
    }),
)

const advertenciaQos = objeto({ regla: texto, mensaje: texto })

const camposPerfilQos: Record<string, EsquemaJson> = {
    id,
    empresa_id: { ...nulable(id), description: 'null = común a todas las empresas' },
    nombre: texto,
    descripcion: nulable(texto),
    predeterminado: { ...booleano, description: 'El de los routers sin qos_perfil_id' },
    clases: lista(ClaseQos),
    advertencias: { ...lista(advertenciaQos), description: 'tope_por_cliente, orden_repetido' },
    ...auditable,
}

export const PerfilQos = definirEsquema('PerfilQos', objeto(camposPerfilQos))

export const UsoPerfilQos = definirEsquema(
    'UsoPerfilQos',
    objeto({
        router_id: id,
        nombre: texto,
        planes_qos: { ...entero, description: 'Planes del router con el extra qos' },
        clases: entero,
        hojas: { ...entero, description: 'Hojas de /queue/tree (planes × 2 estados × 2 sentidos × clases)' },
        reglas_mangle: { ...entero, description: 'Reglas de mangle por familia (IPv4; IPv6 igual)' },
        tipos_cola: { ...entero, description: 'Tipos PCQ extra (clases con tope)' },
        limite_hojas: entero,
    }),
)

export const PerfilQosDetalle = definirEsquema(
    'PerfilQosDetalle',
    objeto({
        ...camposPerfilQos,
        routers: { ...lista(UsoPerfilQos), description: 'Routers activos que usan el perfil y su costo' },
    }),
)
