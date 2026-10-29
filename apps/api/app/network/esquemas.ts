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
import { MOTIVOS_API } from '#network/diagnostico_routeros'

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
            zona_id: {
                ...nulable(id),
                description:
                    'Zona del router (null = sin zona; no cambia el alcance del ACL). La API siempre la envía; ' +
                    'opcional en el esquema hasta que las fixtures del panel la traigan',
            },
            ...auditable,
        },
        ['zona_id'],
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
            clave: enumerado(['tunel', 'api', 'equipo', 'radius']),
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
        },
        ['motivo', 'datos'],
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
