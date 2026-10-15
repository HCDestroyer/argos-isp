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
    objeto({
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
        ...auditable,
    }),
)

export const EstadoServicio = definirEsquema(
    'EstadoServicio',
    enumerado(['activo', 'limitado', 'suspendido', 'retirado']),
)

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
        user_ppp: texto,
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
        ...auditable,
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
        actor_tipo: enumerado(['usuario', 'token', 'agente', 'sistema']),
        actor_id: nulable(id),
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
        campo: texto,
        antes: {},
        despues: {},
        actor_tipo: nulable(enumerado(['usuario', 'token', 'agente', 'sistema'])),
        actor_id: nulable(id),
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

/** Todo lo que necesita RADIUS para autorizar un user_ppp (lo arma A1, lo consume A2). */
export const AaaServicio = definirEsquema(
    'AaaServicio',
    objeto({
        servicio_id: id,
        user_ppp: texto,
        pass_ppp: { type: 'string', description: 'Cifrada; el servicio aaa la descifra' },
        estado: EstadoServicio,
        rate_limit: { type: 'string', description: '"<subida>k/<bajada>k" efectivo (normal o limitado)' },
        ipv4: nulable(texto),
        pool_ipv4: nulable(texto),
        ipv6_modo: enumerado(['radius_servicio', 'radius_pool', 'duid', 'estatico', 'ninguno']),
        prefijo_enlace_v6: nulable(texto),
        prefijo_delegado_v6: nulable(texto),
        pool_ipv6_enlace: nulable(texto),
        pool_ipv6_delegacion: nulable(texto),
        address_list: nulable(texto),
        router_id: id,
        nas_ip: texto,
        acct_interim_interval: entero,
    }),
)
