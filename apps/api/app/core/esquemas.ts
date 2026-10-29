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
import { Advertencia, PlanEfectivo } from '#network/esquemas'
import { TIPOS_PLAN } from '#network/tipos_plan'
import { TIPOS_ACTOR } from '#shared/contexto'
import { ESTADOS_SERVICIO } from '#shared/eventos'
import { REGIMENES_ISR } from '#core/empresas'
import { TIPOS_DOCUMENTO_FISCAL } from '#core/nit_cui'
import { TIPOS_CAMPO_PERSONALIZADO } from '#core/campos_personalizados'
import { NOMBRES_PERMISOS, PERMISOS, ROLES_BASE, type Permiso as NombreDePermiso } from '#core/permisos'

/**
 * Schemas de respuesta del módulo core (usuarios, ACL, clientes, servicios, bitácora).
 * Columnas = nombres de la base de datos (snake_case). Datos sensibles nunca salen (pass_ppp).
 */

/** Forma exacta que usa el frontend desde la semilla de contracts. */
export const Me = definirEsquema('Me', {
    type: 'object',
    // `csrf` es opcional de verdad: solo viene con la sesión del panel por cookie
    required: [
        'id',
        'nombre',
        'email',
        'permisos',
        'roles',
        'expira_en',
        'expira_max_en',
        'alcance_global',
        'empresas',
        'empresa_activa_id',
    ],
    properties: {
        id: { type: 'integer' },
        nombre: { type: 'string' },
        email: { type: 'string', format: 'email' },
        roles: { type: 'array', items: { type: 'string' } },
        permisos: { type: 'array', items: { type: 'string' } },
        csrf: {
            type: 'string',
            description:
                'Solo con la sesión del panel por cookie (`GET /me`): valor de `X-CSRF-Token` para POST, PUT y DELETE',
        },
        expira_en: nulable({
            ...instante,
            description:
                'Cuándo vence la credencial actual. Con la cookie del panel se renueva sola ' +
                'mientras se usa (`ahora + PANEL_SESION_INACTIVIDAD_H`); con Bearer de login es fijo; ' +
                'null con tokens de API (no vencen)',
        }),
        expira_max_en: nulable({
            ...instante,
            description:
                'Tope absoluto de la sesión (login + `PANEL_SESION_MAXIMA_H` con la cookie; ' +
                'igual a `expira_en` con Bearer de login; null con tokens de API)',
        }),
        alcance_global: {
            type: 'boolean',
            description: 'Multiempresa: ve y opera todas las empresas y los consolidados (`?empresas=todas`)',
        },
        empresas: {
            type: 'array',
            items: { $ref: '#/components/schemas/EmpresaResumen' },
            description:
                'Multiempresa: empresas activas que el usuario puede operar (selector). Con una sola, el selector no aparece',
        },
        empresa_activa_id: {
            type: ['integer', 'null'],
            description:
                'Solo en `GET /me`: empresa activa de la petición (`X-Empresa-Id` o la única del usuario); null si tiene varias y no eligió',
        },
    },
})

export const Sesion = definirEsquema(
    'SesionIniciada',
    objeto({ token: { type: 'string', description: 'Token Bearer opaco' }, usuario: Me }),
)

export const SesionPanel = definirEsquema(
    'SesionPanel',
    objeto({
        usuario: Me,
        csrf: {
            type: 'string',
            description: 'Valor de `X-CSRF-Token` en POST, PUT y DELETE mientras dure la sesión',
        },
        expira_en: nulable({
            ...instante,
            description:
                'Cuándo vence la sesión si no se usa. Cada petición la renueva hasta `ahora + ' +
                'PANEL_SESION_INACTIVIDAD_H` sin pasar de `expira_max_en`',
        }),
        expira_max_en: nulable({
            ...instante,
            description: 'Tope absoluto: login + `PANEL_SESION_MAXIMA_H`; ahí la sesión vence aunque se use',
        }),
    }),
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
        alcance_global: {
            ...booleano,
            description: 'Ve y opera todas las empresas (multiempresa); siempre presente',
        },
        empresas: {
            ...lista(id),
            description: 'Empresas asignadas (vacía con alcance global); siempre presente',
        },
        ...auditable,
    }),
)

export const Rol = definirEsquema(
    'Rol',
    objeto({
        id,
        nombre: texto,
        descripcion: nulable(texto),
        base: {
            ...booleano,
            description:
                'Rol base del seed (admin, cajero, soporte, tecnico, contabilidad, lectura): sus permisos se ' +
                'definen en código; PUT con `permisos` responde 409 `rol_base`. Se puede editar la descripción',
        },
        permisos: lista(texto),
        ...auditable,
    }),
)

/**
 * Catálogo de permisos (`app/core/permisos.ts`) en el OpenAPI: el panel tipa y describe los
 * permisos desde aquí (`x-enum-descriptions`, alineado con `enum`), sin copiarlos a mano.
 */
export const NombrePermiso = definirEsquema('NombrePermiso', {
    type: 'string',
    description: 'Nombre de un permiso del ACL (= nombre de la acción)',
    enum: [...NOMBRES_PERMISOS],
    'x-enum-descriptions': NOMBRES_PERMISOS.map((p) => PERMISOS[p]),
})

export const Permiso = definirEsquema(
    'Permiso',
    objeto({ id, nombre: NombrePermiso, descripcion: nulable(texto) }),
)

/** Rol base del seed (`ROLES_BASE`); `x-roles-base` trae los seis con sus permisos. */
export const RolBase = definirEsquema('RolBase', {
    ...objeto({
        nombre: texto,
        descripcion: texto,
        permisos: lista(NombrePermiso),
    }),
    description:
        'Rol base del seed: sus permisos se definen en código (`GET /roles/base`). `x-roles-base` los trae ' +
        'en el propio esquema para derivar fixtures sin la API',
    'x-roles-base': rolesBase(),
})

/** Los roles base de `ROLES_BASE`, en orden, con sus permisos ordenados. */
export function rolesBase(): Array<{ nombre: string; descripcion: string; permisos: NombreDePermiso[] }> {
    return Object.entries(ROLES_BASE).map(([nombre, rol]) => ({
        nombre,
        descripcion: rol.descripcion,
        permisos: [...rol.permisos].sort(),
    }))
}

/** Alcances de un token de API: cada clave ausente es "sin recorte" en esa dimensión. */
export const AlcancesToken = definirEsquema('AlcancesToken', {
    type: 'object',
    additionalProperties: false,
    description:
        'Recortes del token sobre los permisos y alcances de su usuario (Y lógico). Una clave ausente no ' +
        'recorta esa dimensión; `{}` = mismos permisos y alcance que el usuario',
    properties: {
        permisos: {
            ...lista(NombrePermiso),
            description: 'Solo estos permisos (nombres de `GET /permisos`), y solo si el usuario los tiene',
        },
        routers: { ...lista(id), description: 'Solo recursos de estos routers' },
        zonas: { ...lista(id), description: 'Solo recursos de estas zonas' },
        cajas: { ...lista(id), description: 'Solo estas cajas' },
    },
})

export const TokenApi = definirEsquema(
    'TokenApi',
    objeto({
        id,
        usuario_id: id,
        nombre: texto,
        alcances: AlcancesToken,
        ultimo_uso: nulable(instante),
        revocado_en: nulable(instante),
        created_at: instante,
    }),
)

export const TokenApiCreado = definirEsquema(
    'TokenApiCreado',
    objeto({ token: { type: 'string', description: 'Se muestra una sola vez' }, datos: TokenApi }),
)

export const Zona = definirEsquema(
    'Zona',
    objeto({
        id,
        nombre: texto,
        empresa_sugerida_id: {
            ...nulable(id),
            description: 'Empresa por defecto de los servicios nuevos de clientes de esta zona',
        },
        ...auditable,
    }),
)

/** Campo del catálogo de campos personalizados del cliente (`GET /campos-personalizados`). */
export const CampoPersonalizado = definirEsquema(
    'CampoPersonalizado',
    objeto({
        id,
        clave: {
            ...texto,
            pattern: '^[a-z][a-z0-9_]{0,39}$',
            description: 'Clave en `Cliente.campos_personalizados`; no cambia',
        },
        etiqueta: { ...texto, description: 'Nombre que ve el operador en la ficha y el formulario' },
        tipo: {
            ...enumerado(TIPOS_CAMPO_PERSONALIZADO),
            description:
                'texto (string, hasta 500), numero (number), fecha (string AAAA-MM-DD), booleano, opcion ' +
                '(string de `opciones`); no cambia',
        },
        opciones: { ...lista(texto), description: 'Valores permitidos (solo opcion; vacía en los demás)' },
        requerido: {
            ...booleano,
            description: 'Se exige con valor al crear un cliente y al guardar sus campos personalizados',
        },
        orden: { ...entero, description: 'Orden en la ficha (menor primero)' },
        activo: {
            ...booleano,
            description: 'Inactivo: no se muestra ni se valida; los valores guardados se conservan',
        },
        ...auditable,
    }),
)

export const Cliente = definirEsquema(
    'Cliente',
    objeto({
        id,
        codigo: {
            type: 'string',
            pattern: '^C-\\d{6,}$',
            description:
                'Código estable del cliente (`C-000455`): derivado del id al crear, único e inmutable',
        },
        codigo_externo: {
            ...nulable(texto),
            description: 'Código en el sistema anterior (importador); no reemplaza a `codigo`',
        },
        nombre: texto,
        tipo: enumerado(['persona', 'empresa']),
        tipo_documento_fiscal: {
            ...enumerado(TIPOS_DOCUMENTO_FISCAL),
            description: 'Documento del receptor para FEL: nit, cui, pasaporte o cf (consumidor final)',
        },
        nit_cui: {
            ...nulable(texto),
            description:
                'Número del documento sin guiones ni espacios (NIT, CUI o pasaporte); CF o null en cf',
        },
        nit_cui_invalido: {
            ...booleano,
            description:
                'true: el número no pasó la validación al migrar a la localización fiscal (se conservó); ' +
                'se apaga al corregirlo',
        },
        nombre_fiscal: nulable(texto),
        direccion_fiscal: nulable(texto),
        pais_fiscal: {
            ...texto,
            pattern: '^[A-Z]{2}$',
            description: 'País del receptor (ISO 3166-1 alfa-2)',
        },
        agente_retencion_iva: { ...booleano, description: 'Agente de retención de IVA' },
        sector_publico: { ...booleano, description: 'Entidad del sector público' },
        email: nulable(texto),
        telefono: nulable(texto),
        movil: nulable(texto),
        direccion: nulable(texto),
        coordenadas: nulable(texto),
        zona_id: nulable(id),
        campos_personalizados: {
            ...jsonLibre,
            description:
                'Valores por clave del catálogo (GET /campos-personalizados); puede traer claves fuera ' +
                'del catálogo (importador, campos desactivados)',
        },
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
        referido_por_id: {
            ...nulable(id),
            description:
                'Cliente que lo refirió (programa de lealtad): el dueño del `codigo_referido` del alta',
        },
        referido_empresa_id: {
            ...nulable(id),
            description: 'Empresa (NIT) en la que cuenta el referido: la del código usado',
        },
        codigos_referido: {
            ...lista(objeto({ empresa_id: id, codigo: { ...texto, pattern: '^[2-9A-HJKMNP-Z]{8}$' } })),
            description:
                'Códigos para referir clientes, uno por empresa en la que tiene servicio (se crean solos ' +
                'con el primer servicio en cada empresa)',
        },
        externo: {
            ...nulable(
                objeto({ sistema: { ...texto, description: 'Sistema de origen: `mikrowisp`' }, id: texto }),
            ),
            description:
                'Id en el sistema del que se importó (`core.ids_externos`); null si se creó en Argos',
        },
        ...auditable,
    }),
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
            ...nulable(enumerado([...ESTADOS_SERVICIO])),
            description:
                'Resumen: el estado más grave de sus servicios no retirados (suspendido > limitado > activo > pendiente_instalacion); ' +
                'retirado si todos lo están; null sin servicios',
        },
    }),
)

export const EstadoServicio = definirEsquema('EstadoServicio', enumerado([...ESTADOS_SERVICIO]))

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

const textoPlanta: EsquemaJson = { type: 'string', maxLength: 100 }

export const Servicio = definirEsquema(
    'Servicio',
    objeto(
        {
            id,
            cliente_id: id,
            empresa_id: { ...id, description: 'Empresa (NIT) que factura el servicio' },
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
            instalado_en: {
                ...nulable(instante),
                description:
                    'Activación de la instalación (inicio de la facturación); null mientras está pendiente_instalacion',
            },
            planta: {
                ...nulable(
                    objeto(
                        {
                            caja: textoPlanta,
                            puerto: textoPlanta,
                            olt: textoPlanta,
                            slot: textoPlanta,
                            pon: textoPlanta,
                            potencia_dbm: {
                                type: 'string',
                                pattern: '^-?\\d{1,2}\\.\\d{2}$',
                                description:
                                    'Potencia óptica en dBm, decimal con 2 decimales (p. ej. "-19.40")',
                            },
                        },
                        ['caja', 'puerto', 'olt', 'slot', 'pon', 'potencia_dbm'],
                    ),
                ),
                description:
                    'Referencia de planta de la instalación (caja, puerto, OLT, slot, PON, potencia), de solo ' +
                    'lectura: la planta vive en OZmap y llega desde Iris al activar la instalación. null sin datos',
            },
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
            plan_tipo: {
                ...enumerado(TIPOS_PLAN),
                description: 'Tipo del plan del servicio (solo lectura; se cambia en el plan)',
            },
            router_nombre: texto,
            zona_nombre: nulable(texto),
            excepciones: ExcepcionesServicio,
            plan_temporal: {
                ...nulable(
                    objeto({
                        id,
                        plan_id: { ...id, description: 'Plan temporal' },
                        plan_original_id: { ...id, description: 'Plan base al que vuelve al terminar' },
                        inicio: instante,
                        fin: instante,
                        estado: enumerado(['programado', 'activo']),
                        origen: enumerado(['lealtad', 'manual']),
                        origen_id: nulable(id),
                        version: { type: 'integer', minimum: 1 },
                    }),
                ),
                description:
                    'Plan temporal programado o activo (lealtad), o null. Activo: `plan_id` del servicio ya es ' +
                    'el temporal (RADIUS, RouterOS y facturación lo usan) y vuelve a `plan_original_id` al terminar',
            },
            externo: {
                ...nulable(
                    objeto({
                        sistema: { ...texto, description: 'Sistema de origen: `mikrowisp`' },
                        id: texto,
                    }),
                ),
                description:
                    'Id en el sistema del que se importó (`core.ids_externos`); null si se creó en Argos',
            },
            ...auditable,
            warnings: {
                ...lista(Advertencia),
                description: 'Solo al crear o editar: advertencias del tipo de plan (nunca bloquean)',
            },
        },
        // `warnings` es opcional de verdad: solo viene al crear o editar
        ['warnings'],
    ),
)

/** Fila de `core.servicios_planes_temporales` (`contratos/lealtad.md` §3). */
export const PlanTemporal = definirEsquema(
    'PlanTemporal',
    objeto({
        id,
        empresa_id: id,
        servicio_id: id,
        plan_id: { ...id, description: 'Plan temporal (la mejora)' },
        plan_nombre: texto,
        plan_original_id: {
            ...id,
            description:
                'Plan base: el del servicio al programar, actualizado al iniciar; vuelve a él al terminar',
        },
        plan_original_nombre: texto,
        inicio: instante,
        fin: instante,
        origen: enumerado(['lealtad', 'manual']),
        origen_id: {
            ...nulable(id),
            description: 'Canje de lealtad que lo programó (con `origen: lealtad`)',
        },
        estado: enumerado(['programado', 'activo', 'terminado', 'cancelado']),
        motivo: nulable(texto),
        iniciado_en: nulable(instante),
        terminado_en: nulable(instante),
        creado_por: nulable(id),
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

/*
| Servicios adicionales (`contratos/adicionales.md`)
*/

export const Adicional = definirEsquema(
    'Adicional',
    objeto({
        id,
        empresa_id: { ...id, description: 'Empresa (NIT) del catálogo' },
        codigo: { ...texto, description: 'Único en la empresa, en mayúsculas' },
        nombre: texto,
        descripcion: nulable(texto),
        precio_sugerido: { ...nulable(Dinero), description: 'Sugerencia para asignarlo cobrado' },
        activo: { ...booleano, description: 'Desactivado: no se asigna ni lo traen los planes' },
        ...auditable,
    }),
)

export const MotivoCortesia = definirEsquema(
    'MotivoCortesia',
    objeto({
        id,
        empresa_id: { ...nulable(id), description: 'null = común a todas las empresas' },
        codigo: texto,
        nombre: texto,
        activo: booleano,
        ...auditable,
    }),
)

export const AdicionalServicio = definirEsquema(
    'AdicionalServicio',
    objeto({
        id: { ...id, description: 'Id de la asignación (`asignacionId` en las rutas)' },
        empresa_id: id,
        servicio_id: id,
        adicional_id: id,
        adicional_codigo: texto,
        adicional_nombre: texto,
        modalidad: enumerado(['incluido', 'cortesia', 'cobrado']),
        identificador: { ...nulable(texto), description: 'Usuario de IPTV, correo de la cuenta…' },
        tiene_credencial: {
            ...booleano,
            description: 'Si hay credencial guardada; se lee con GET …/credencial (queda auditado)',
        },
        precio: { ...nulable(Dinero), description: 'Solo con cobrado' },
        motivo_id: { ...nulable(id), description: 'Motivo de cortesía (solo con cortesia)' },
        motivo_nombre: nulable(texto),
        motivo_detalle: nulable(texto),
        plan_id: {
            ...nulable(id),
            description: 'Plan que lo trajo (solo incluido asignado por el plan)',
        },
        estado: enumerado(['activo', 'baja']),
        bloqueo: {
            ...enumerado(['vigente', 'bloqueado']),
            description: 'bloqueado mientras el servicio está suspendido (lo pone el estado del servicio)',
        },
        bloqueado_en: nulable(instante),
        primer_periodo: {
            ...nulable(enumerado(['prorrateado', 'sin_costo'])),
            description: 'Solo con cobrado: cómo se cobra el periodo en curso (lo factura A3)',
        },
        cobrado_desde: { ...nulable(instante), description: 'Solo con cobrado: desde cuándo se cobra' },
        alta_en: instante,
        baja_en: nulable(instante),
        motivo_baja: {
            ...nulable(texto),
            description: 'Texto de la baja, o retiro, cambio_plan, cambio_empresa',
        },
        ...auditable,
    }),
)

export const BloqueoAdicional = definirEsquema(
    'BloqueoAdicional',
    objeto({
        id,
        asignacion_id: id,
        accion: enumerado(['bloqueado', 'desbloqueado']),
        estado_servicio: enumerado([...ESTADOS_SERVICIO]),
        motivo: nulable(texto),
        created_at: instante,
    }),
)

export const AdicionalPlan = definirEsquema(
    'AdicionalPlan',
    objeto({
        plan_id: id,
        adicional_id: id,
        empresa_id: { ...id, description: 'Empresa del adicional: solo lo reciben servicios de esa empresa' },
        adicional_codigo: texto,
        adicional_nombre: texto,
        adicional_activo: booleano,
        cantidad: { ...entero, minimum: 1, maximum: 50 },
    }),
)

export const CredencialAdicional = definirEsquema(
    'CredencialAdicional',
    objeto({
        servicio_id: id,
        asignacion_id: id,
        identificador: nulable(texto),
        credencial: { type: 'string', description: 'En claro; cada consulta queda auditada' },
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
        empresa_id: {
            type: ['integer', 'null'],
            description:
                'Empresa (NIT) de lo que se hizo, o la empresa activa de quien lo hizo; null si no es de ninguna (login, usuarios, clientes, sistema)',
        },
        empresa_nombre: {
            type: ['string', 'null'],
            description: 'Nombre comercial de esa empresa (null sin empresa)',
        },
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

/** IP resuelta por `POST /integraciones/horus/resolver` (contrato Horus §2.1). */
export const IpResueltaHorus = definirEsquema(
    'IpResueltaHorus',
    objeto({
        ip: { type: 'string', description: 'La IP tal como se pidió' },
        servicio_id: id,
        cliente_id: id,
        prefijo: {
            type: 'string',
            description: 'Asignación o sesión que contiene la IP (prefijo más largo)',
        },
        cliente: objeto({
            nombre: texto,
            codigo: { type: 'string', description: 'Código estable del cliente (`C-000455`)' },
            tipo: enumerado(['persona', 'empresa']),
        }),
        servicio: objeto({
            user_ppp: nulable(texto),
            plan: { type: 'string', description: 'Nombre del plan' },
            estado: enumerado([...ESTADOS_SERVICIO]),
            router_id: id,
        }),
        empresa: objeto({
            id,
            nombre: { type: 'string', description: 'Nombre comercial de la empresa (NIT) del servicio' },
            nit: nulable(texto),
        }),
        desde: { ...instante, description: 'Inicio de la sesión o asignación vigente que contiene la IP' },
    }),
)

/** IP que ningún servicio del alcance del token tiene (o que no existe). */
export const IpNoEncontradaHorus = definirEsquema(
    'IpNoEncontradaHorus',
    objeto({ ip: texto, error: enumerado(['no_encontrada']) }),
)

export const ResolucionIpsHorus = definirEsquema(
    'ResolucionIpsHorus',
    objeto({
        resultados: {
            ...lista({ anyOf: [IpResueltaHorus, IpNoEncontradaHorus] }),
            description: 'Uno por IP pedida, en el mismo orden',
        },
    }),
)

/** `POST /integraciones/horus/tokens`: el token se muestra una sola vez. */
export const TokenHorusCreado = definirEsquema(
    'TokenHorusCreado',
    objeto({
        token: { type: 'string', description: 'Valor `atk_…`; se muestra una sola vez' },
        datos: TokenApi,
        usuario_id: { ...id, description: 'Usuario técnico Horus' },
    }),
)

/** `POST /integraciones/horus/sso/tickets` (contrato Horus §1.5). */
export const TicketSsoEmitido = definirEsquema(
    'TicketSsoEmitido',
    objeto({
        url: {
            type: 'string',
            description:
                '`https://<panel>/sso/entrar#<ticket>`: el ticket va en el fragmento; 60 s, un solo uso',
        },
        expira_en: instante,
    }),
)

/** Resultado de `POST /auth/sso/canjear` y `POST /auth/sso/vincular`. */
export const CanjeSso = definirEsquema(
    'CanjeSso',
    objeto({
        resultado: {
            ...enumerado(['sesion', 'vinculacion_requerida']),
            description:
                '`sesion`: cookie del panel puesta, ir a `ruta`. `vinculacion_requerida`: mostrar el login ' +
                'normal y mandarlo a `POST /auth/sso/vincular` con `vinculacion.token`',
        },
        ruta: { type: 'string', description: 'Ruta local del panel del destino, p. ej. `/servicios/812`' },
        conector: { type: 'string', description: 'Sistema que pidió el autologin (`horus`)' },
        sesion: { ...nulable(SesionPanel), description: 'Solo con `resultado: sesion`' },
        vinculacion: {
            ...nulable(
                objeto({
                    token: { type: 'string', description: 'Token de vinculación: 10 min, un solo uso' },
                    expira_en: instante,
                    usuario_externo: objeto({
                        id_externo: texto,
                        correo: nulable(texto),
                        nombre: nulable(texto),
                    }),
                }),
            ),
            description: 'Solo con `resultado: vinculacion_requerida`',
        },
    }),
)

/** Vinculación `(conector, id_externo) → usuario local` del autologin. */
export const VinculacionExterna = definirEsquema(
    'VinculacionExterna',
    objeto({
        id,
        conector: texto,
        id_externo: { type: 'string', description: 'Usuario en el otro sistema' },
        usuario_id: id,
        correo_externo: nulable(texto),
        nombre_externo: nulable(texto),
        revocada_en: nulable(instante),
        created_at: instante,
    }),
)

export const RevocacionVinculaciones = definirEsquema(
    'RevocacionVinculaciones',
    objeto({ revocadas: { type: 'integer', minimum: 0 } }),
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

/*
|--------------------------------------------------------------------------
| Empresas (multiempresa)
|--------------------------------------------------------------------------
*/

export const EmpresaGrupo = definirEsquema(
    'EmpresaGrupo',
    objeto({
        id,
        nit: nulable(texto),
        razon_social: nulable(texto),
        nombre_comercial: texto,
        direccion_fiscal: nulable(texto),
        municipio: nulable(texto),
        departamento: nulable(texto),
        telefono: nulable(texto),
        telefono_alterno: nulable(texto),
        whatsapp: nulable(texto),
        correo: nulable(texto),
        sitio_web: nulable(texto),
        horario: nulable(texto),
        instrucciones_pago: nulable(texto),
        color_marca: { ...nulable(texto), description: '`#RRGGBB`; solo PDF y correo' },
        pais: {
            ...texto,
            pattern: '^[A-Z]{2}$',
            description:
                'País de la localización fiscal (ISO 3166-1 alfa-2). Cambia con POST /empresas/:id/cambiar-pais',
        },
        regimen_isr: {
            ...nulable(enumerado(REGIMENES_ISR)),
            description:
                'Solo lectura (localización fiscal): régimen vigente; cambia con POST /fiscal/regimen',
        },
        codigo_establecimiento: {
            ...nulable(entero),
            description: 'Solo lectura (localización fiscal): establecimiento por defecto en la SAT',
        },
        logo_url: {
            ...nulable(texto),
            description: 'Ruta del logo (`/api/v1/empresas/:id/logo?v=…`, pública, con ETag); null sin logo',
        },
        logo_tipo: nulable(enumerado(['image/png', 'image/svg+xml'])),
        activa: booleano,
        principal: { ...booleano, description: 'La empresa 1 (la de la instalación original)' },
        version: {
            type: 'integer',
            minimum: 0,
            description: 'Control optimista: envíala al editar (0 = la empresa 1 nunca se guardó)',
        },
        created_at: instante,
        updated_at: instante,
    }),
)

/** País con localización fiscal (`GET /empresas/paises`). */
export const PaisLocalizacion = definirEsquema(
    'PaisLocalizacion',
    objeto({
        codigo: { ...texto, pattern: '^[A-Z]{2}$', description: 'ISO 3166-1 alfa-2' },
        nombre: texto,
    }),
)

/** Empresa en `GET /me` (selector de empresa). */
export const EmpresaResumen = definirEsquema(
    'EmpresaResumen',
    objeto({ id, nombre_comercial: texto, nit: nulable(texto), logo_url: nulable(texto) }),
)

/** Lo que impide eliminar un servicio o un router (`contratos/eliminar.md`). */
export const MotivoEliminacion = definirEsquema(
    'MotivoEliminacion',
    objeto({
        codigo: { ...texto, description: 'facturas, sesiones, servicios, routeros…' },
        cantidad: entero,
        mensaje: { ...texto, description: '«tiene 3 facturas»' },
    }),
)

export const Eliminable = definirEsquema(
    'Eliminable',
    objeto({
        eliminable: {
            ...booleano,
            description:
                'true: nunca se usó y el panel ofrece «Eliminar»; false: solo «Retirar» (o desactivar)',
        },
        motivos: lista(MotivoEliminacion),
    }),
)
