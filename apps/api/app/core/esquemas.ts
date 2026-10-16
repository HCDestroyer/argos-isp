import {
    Dinero,
    auditable,
    booleano,
    definirEsquema,
    entero,
    enumerado,
    fecha,
    id,
    instante,
    jsonLibre,
    lista,
    nulable,
    objeto,
    texto,
} from '#shared/openapi/esquemas'
import type { EsquemaJson } from '#shared/openapi/esquemas'
import { CAMPOS_EXCEPCION, type CampoExcepcion } from '#billing/excepciones'
import { ReglasPromesa } from '#billing/esquemas'
import { PlanEfectivo } from '#network/esquemas'
import { TIPOS_ACTOR } from '#shared/contexto'

/**
 * Schemas de respuesta del módulo core (usuarios, ACL, clientes, servicios, bitácora).
 * Columnas = nombres de la base de datos (snake_case). Datos sensibles nunca salen (pass_ppp).
 */

/** Forma exacta que usa el frontend desde la semilla de contracts. */
export const Me = definirEsquema('Me', {
    type: 'object',
    required: ['id', 'nombre', 'email', 'permisos', 'roles'],
    properties: {
        id: { type: 'integer' },
        nombre: { type: 'string' },
        email: { type: 'string', format: 'email' },
        roles: { type: 'array', items: { type: 'string' } },
        permisos: { type: 'array', items: { type: 'string' } },
    },
})

export const Sesion = definirEsquema(
    'SesionIniciada',
    objeto({ token: { type: 'string', description: 'Token Bearer opaco' }, usuario: Me }),
)

export const AsignacionRol = definirEsquema(
    'AsignacionRol',
    objeto({
        role_id: id,
        rol: texto,
        alcance_tipo: nulable(enumerado(['router', 'zona', 'caja'])),
        alcance_id: nulable(id),
    }),
)

export const Usuario = definirEsquema(
    'Usuario',
    objeto({
        id,
        nombre: texto,
        email: { type: 'string', format: 'email' },
        activo: booleano,
        roles: lista(AsignacionRol),
        ...auditable,
    }),
)

export const Rol = definirEsquema(
    'Rol',
    objeto({ id, nombre: texto, descripcion: nulable(texto), permisos: lista(texto), ...auditable }),
)

export const Permiso = definirEsquema('Permiso', objeto({ id, nombre: texto, descripcion: nulable(texto) }))

export const TokenApi = definirEsquema(
    'TokenApi',
    objeto({
        id,
        usuario_id: id,
        nombre: texto,
        alcances: jsonLibre,
        ultimo_uso: nulable(instante),
        revocado_en: nulable(instante),
        created_at: instante,
    }),
)

export const TokenApiCreado = definirEsquema(
    'TokenApiCreado',
    objeto({ token: { type: 'string', description: 'Se muestra una sola vez' }, datos: TokenApi }),
)

export const Zona = definirEsquema('Zona', objeto({ id, nombre: texto, ...auditable }))

export const Cliente = definirEsquema(
    'Cliente',
    objeto(
        {
            id,
            nombre: texto,
            tipo: enumerado(['persona', 'empresa']),
            nit_cui: nulable(texto),
            nombre_fiscal: nulable(texto),
            direccion_fiscal: nulable(texto),
            email: nulable(texto),
            telefono: nulable(texto),
            movil: nulable(texto),
            direccion: nulable(texto),
            coordenadas: nulable(texto),
            zona_id: nulable(id),
            campos_personalizados: jsonLibre,
            canal_preferido: enumerado(['correo', 'telegram', 'whatsapp']),
            telegram_chat_id: nulable(texto),
            responsable_pago_id: {
                ...nulable(id),
                description: 'Cliente que paga por este (responsable de pago); null si paga él mismo',
            },
            responsable_pago_nombre: {
                ...nulable(texto),
                description: 'Nombre del responsable de pago (solo lectura)',
            },
            ...auditable,
        },
        [],
    ),
)

/** Fila de `GET /clientes/:id/dependientes`. */
export const DependientePago = definirEsquema(
    'DependientePago',
    objeto({
        id,
        nombre: texto,
        nit_cui: nulable(texto),
        servicios: { type: 'integer', minimum: 0, description: 'Servicios no retirados' },
        estado_servicio: {
            ...nulable(enumerado(['activo', 'limitado', 'suspendido', 'retirado'])),
            description:
                'Resumen: el estado más grave de sus servicios no retirados (suspendido > limitado > activo); ' +
                'retirado si todos lo están; null sin servicios',
        },
    }),
)

export const EstadoServicio = definirEsquema(
    'EstadoServicio',
    enumerado(['activo', 'limitado', 'suspendido', 'retirado']),
)

const horaCorte: EsquemaJson = {
    type: 'string',
    pattern: '^([01]\\d|2[0-3]):[0-5]\\d$',
    description: 'HH:MM hora de Guatemala',
}

/** Tipo de cada campo exceptuable (la lista y la validación son de A3: `app/billing/excepciones.ts`). */
export const TIPOS_EXCEPCION: Record<CampoExcepcion, EsquemaJson> = {
    dia: { type: 'integer', minimum: 1, maximum: 28 },
    prorrateo: booleano,
    dias_gracia: { type: 'integer', minimum: 0 },
    facturas_para_limitar: { type: 'integer', minimum: 0 },
    facturas_para_cortar: { type: 'integer', minimum: 1 },
    mora_tipo: enumerado(['ninguna', 'fija', 'porcentaje']),
    mora_valor: Dinero,
    mora_recurrente: booleano,
    hora_corte: horaCorte,
    certificar_al: enumerado(['emitir', 'pagar', 'nunca']),
    reglas_promesa: { ...jsonLibre, description: 'Parcial: se combina clave a clave sobre la plantilla' },
}

/** `{ campo: valor }` de `core.servicios_excepciones`; solo trae los campos exceptuados. */
export const ExcepcionesServicio = definirEsquema('ExcepcionesServicio', {
    type: 'object',
    description: 'Excepciones a la plantilla de facturación del servicio',
    properties: Object.fromEntries(CAMPOS_EXCEPCION.map((campo) => [campo, TIPOS_EXCEPCION[campo]])),
    additionalProperties: false,
})

export const Servicio = definirEsquema(
    'Servicio',
    objeto({
        id,
        cliente_id: id,
        router_id: id,
        plan_id: id,
        plantilla_facturacion_id: nulable(id),
        estado: EstadoServicio,
        promesa_activa: { type: 'boolean', description: 'Bandera: hay una promesa de pago activa' },
        suspension_manual: {
            type: 'boolean',
            description: 'Suspendido a mano por un operador: el corte y los pagos no lo reactivan',
        },
        suspension_manual_motivo: nulable(texto),
        tipo_conexion: {
            ...enumerado(['pppoe', 'ip_estatica', 'dhcp_fija']),
            description: 'pppoe (RADIUS) o sin PPPoE (ip_estatica, dhcp_fija) por API REST de RouterOS',
        },
        user_ppp: { ...nulable(texto), description: 'null fuera de pppoe' },
        amarre_ip_mac: { ...booleano, description: 'ARP estático IP-MAC en el router (solo sin PPPoE)' },
        mac: nulable(texto),
        direccion: nulable(texto),
        coordenadas: nulable(texto),
        fecha_instalacion: nulable(fecha),
        costo_override: nulable(Dinero),
        excluir_firewall: booleano,
        ipv4: nulable(texto),
        prefijo_enlace_v6: nulable(texto),
        prefijo_delegado_v6: nulable(texto),
        ipv6_modo: enumerado(['radius_servicio', 'radius_pool', 'duid', 'estatico', 'ninguno']),
        ipv6_duid: nulable(texto),
        // nombres de solo lectura (la API siempre los envía; obligatorios desde la semana 3)
        cliente_nombre: texto,
        plan_nombre: texto,
        router_nombre: texto,
        zona_nombre: nulable(texto),
        excepciones: ExcepcionesServicio,
        ...auditable,
    }),
)

/** Plantilla de facturación con las excepciones del servicio aplicadas (`aplicarExcepciones`). */
export const ConfiguracionFacturacion = definirEsquema(
    'ConfiguracionFacturacion',
    objeto({
        plantilla_id: id,
        nombre: texto,
        ciclo: enumerado(['dia_fijo', 'aniversario']),
        dia: nulable(entero),
        prorrateo: booleano,
        dias_gracia: entero,
        facturas_para_limitar: entero,
        facturas_para_cortar: entero,
        mora_tipo: enumerado(['ninguna', 'fija', 'porcentaje']),
        mora_valor: Dinero,
        mora_recurrente: booleano,
        hora_corte: horaCorte,
        certificar_al: enumerado(['emitir', 'pagar', 'nunca']),
        reglas_promesa: ReglasPromesa,
        excepciones: { ...lista(texto), description: 'Campos que vienen de una excepción del servicio' },
    }),
)

export const ConfiguracionEfectivaServicio = definirEsquema(
    'ConfiguracionEfectivaServicio',
    objeto({
        servicio_id: id,
        plantilla_facturacion_id: nulable(id),
        plan: PlanEfectivo,
        facturacion: nulable(ConfiguracionFacturacion),
        excepciones: ExcepcionesServicio,
    }),
)

export const CredencialesPpp = definirEsquema(
    'CredencialesPpp',
    objeto({
        servicio_id: id,
        user_ppp: texto,
        pass_ppp: { type: 'string', description: 'En claro; cada consulta queda auditada' },
    }),
)

export const AccionAuditoria = definirEsquema(
    'AccionAuditoria',
    objeto({
        id,
        actor_tipo: enumerado(TIPOS_ACTOR),
        actor_id: nulable(id),
        actor_nombre: {
            type: ['string', 'null'],
            description: 'Nombre del usuario, o del cliente si actor_tipo = cliente (null para el sistema)',
        },
        canal: texto,
        accion: texto,
        entidad_tipo: nulable(texto),
        entidad_id: nulable(id),
        entrada: {},
        resultado: enumerado(['ok', 'error']),
        error: nulable(texto),
        request_id: nulable(texto),
        created_at: instante,
    }),
)

export const CambioAuditoria = definirEsquema(
    'CambioAuditoria',
    objeto({
        id,
        entidad_tipo: texto,
        entidad_id: id,
        campo: {
            type: 'string',
            description:
                'Nombre del campo en snake_case (`ipv4`, `prefijo_enlace_v6`). Filas anteriores al día 4 ' +
                'pueden traer `ipv_4`, `prefijo_enlace_v_6`, `prefijo_delegado_v_6`',
        },
        antes: {},
        despues: {},
        actor_tipo: nulable(enumerado(TIPOS_ACTOR)),
        actor_id: nulable(id),
        actor_nombre: {
            type: ['string', 'null'],
            description: 'Nombre del usuario, o del cliente si actor_tipo = cliente (null para el sistema)',
        },
        request_id: nulable(texto),
        created_at: instante,
    }),
)

export const ResolucionIp = definirEsquema(
    'ResolucionIp',
    objeto({
        servicio_id: id,
        cliente_id: id,
        prefijo: { type: 'string', description: 'Asignación que contiene la IP (prefijo más largo)' },
    }),
)

/**
 * Todo lo que necesita RADIUS para autorizar un user_ppp (lo arma A1, lo consume A2). Mismo JSON
 * que `aaa:user:<user_ppp>` en Redis; contrato en `.claude/integration/contratos/aaa.md`.
 */
export const AaaServicio = definirEsquema(
    'AaaServicio',
    objeto({
        servicio_id: id,
        version: { type: 'integer', minimum: 1, description: 'core.servicios.version (diagnóstico)' },
        user_ppp: texto,
        pass_ppp: { type: 'string', description: 'Cifrada (formato v1); el servicio aaa la descifra' },
        estado: EstadoServicio,
        router_id: id,
        control_velocidad: {
            ...enumerado(['simple', 'arbol_pcq']),
            description: 'network.routers.control_velocidad del router del servicio',
        },
        plan: objeto({
            id,
            subida_kbps: entero,
            bajada_kbps: entero,
            subida_limitada_kbps: entero,
            bajada_limitada_kbps: entero,
            rate_limit_override: nulable(texto),
            profile_ppp: nulable(texto),
            rate_limit: {
                type: 'string',
                description:
                    'Mikrotik-Rate-Limit completo en estado activo: "rx/tx ráfaga-rx/tx umbral-rx/tx tiempo-rx/tx prioridad limit-at-rx/tx" (o rate_limit_override)',
            },
            rate_limit_limitado: {
                type: 'string',
                description: 'Mikrotik-Rate-Limit completo en estado limitado (sin ráfaga)',
            },
            reuso: {
                type: 'integer',
                minimum: 1,
                maximum: 64,
                description: 'Reuso efectivo 1:N en el router',
            },
        }),
        ipv4: {
            anyOf: [
                objeto({ modo: enumerado(['estatico']), ip: texto }),
                objeto({ modo: enumerado(['pool']), pool: texto }),
                { type: 'null' },
            ],
        },
        ipv6: {
            anyOf: [
                objeto({
                    modo: enumerado(['radius_servicio']),
                    prefijo_enlace: nulable(texto),
                    prefijo_delegado: nulable(texto),
                }),
                objeto({
                    modo: enumerado(['radius_pool']),
                    pool_enlace: nulable(texto),
                    pool_delegacion: nulable(texto),
                }),
                objeto({ modo: enumerado(['duid', 'estatico', 'ninguno']) }),
            ],
        },
    }),
)
