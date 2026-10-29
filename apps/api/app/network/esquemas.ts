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

const extrasVelocidad = objeto({
    rafaga: { ...booleano, description: 'burst-* del plan (en PCQ: pcq-burst-*)' },
    prioridad: { ...booleano, description: 'priority del plan (1–8); false = 8' },
    garantizado: { ...booleano, description: 'limit-at (CIR); false = 0' },
    excluir_fasttrack: {
        ...booleano,
        description: 'Reglas `argosisp:top sin fasttrack` para argos-clientes antes de FastTrack',
    },
})

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
                },
                ['rafaga', 'prioridad', 'garantizado', 'excluir_fasttrack'],
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
    objeto({
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
        capacidad_bajada_kbps: kbpsNulable('Capacidad del enlace (techo del padre global); null = sin techo'),
        capacidad_subida_kbps: kbpsNulable('Capacidad del enlace (techo del padre global); null = sin techo'),
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
            description: 'Obsoleto: derivado de control_velocidad (arbol_pcq → pcq). Usar control_velocidad',
        },
        empresa_sugerida_id: {
            ...nulable(id),
            description: 'Empresa por defecto de los servicios nuevos del router (después de la de la zona)',
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

/*
|--------------------------------------------------------------------------
| Control de velocidad por capas: vista previa, matriz, sincronizar, reconciliar y corte (A2)
|--------------------------------------------------------------------------
*/

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
                valor: enumerado(['rafaga', 'prioridad', 'garantizado', 'excluir_fasttrack']),
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

/** `POST /routers/:id/reconciliar` («Reconciliar ahora»). */
export const ResultadoReconciliacion = definirEsquema(
    'ResultadoReconciliacion',
    objeto({
        router_id: id,
        servicios: entero,
        correcciones: lista(
            objeto({
                ruta: texto,
                comment: texto,
                accion: enumerado(['creado', 'actualizado', 'borrado', 'movido']),
            }),
        ),
        avisos: lista(texto),
        error: nulable(texto),
        errores_velocidad: lista(texto),
    }),
)

/** `GET /routers/:id/diagnostico-corte`: el chequeo `corte` de «Probar conexión». */
export const DiagnosticoCorte = definirEsquema(
    'DiagnosticoCorte',
    objeto({
        router_id: id,
        ok: booleano,
        problemas: lista(
            objeto({
                codigo: enumerado([
                    'sin_api',
                    'router_no_responde',
                    'faltan_reglas',
                    'reglas_desordenadas',
                    'falta_lista_suspendidos',
                    'falta_perfil_suspendido',
                    'walled_garden',
                    'portal_sin_configurar',
                    'portal_inalcanzable',
                ]),
                mensaje: { ...texto, description: 'Qué falla y qué hacer, en lenguaje simple' },
                reconciliar: { ...booleano, description: '«Reconciliar ahora» lo arregla' },
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
            url: nulable(texto),
            alcanzable: { ...nulable(booleano), description: 'null: no se probó (sin URL del portal)' },
            detalle: nulable(texto),
        }),
    }),
)
