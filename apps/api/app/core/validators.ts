import vine from '@vinejs/vine'
import { reglasPaginacion } from '#shared/paginacion'
import {
    coordenadas,
    empresaSugerida,
    fechaIso,
    dinero,
    idEntidad,
    instanteIso,
    ipv4,
    motivo,
    prefijoV6,
    versionEsperada,
} from '#shared/validadores'
import { NOMBRES_PERMISOS } from '#core/permisos'
import { CANALES } from '#shared/contexto'
import { CAMPOS_EXCEPCION } from '#billing/excepciones'
import { TIPOS_EXCEPCION } from '#core/esquemas'
import { REGIMENES_ISR } from '#core/empresas'

const ESTADOS_SERVICIO = ['activo', 'limitado', 'suspendido', 'retirado'] as const

/*
|--------------------------------------------------------------------------
| Auth
|--------------------------------------------------------------------------
*/

export const loginValidator = vine.compile(
    vine.object({
        email: vine.string().trim().email().toLowerCase(),
        password: vine.string().minLength(1).maxLength(200),
    }),
)

/*
|--------------------------------------------------------------------------
| Clientes y zonas
|--------------------------------------------------------------------------
*/

/** NIT guatemalteco (dígitos + verificador numérico o K) o CUI de 13 dígitos; "CF" para consumidor final. */
const nitCui = () =>
    vine
        .string()
        .trim()
        .toUpperCase()
        .regex(/^(CF|\d{13}|\d{1,12}-?[0-9K])$/)
        .meta({ description: 'NIT (con dígito verificador), CUI de 13 dígitos o CF' })

const camposCliente = {
    nombre: vine.string().trim().minLength(2).maxLength(200),
    tipo: vine.enum(['persona', 'empresa'] as const).optional(),
    nit_cui: nitCui().nullable().optional(),
    nombre_fiscal: vine.string().trim().maxLength(200).nullable().optional(),
    direccion_fiscal: vine.string().trim().maxLength(300).nullable().optional(),
    email: vine.string().trim().email().nullable().optional(),
    telefono: vine.string().trim().maxLength(30).nullable().optional(),
    movil: vine.string().trim().maxLength(30).nullable().optional(),
    direccion: vine.string().trim().maxLength(300).nullable().optional(),
    coordenadas: coordenadas().nullable().optional(),
    zona_id: idEntidad().nullable().optional(),
    campos_personalizados: vine.record(vine.any()).optional(),
    canal_preferido: vine.enum(['correo', 'telegram', 'whatsapp'] as const).optional(),
}

export const crearClienteValidator = vine.compile(vine.object(camposCliente))

export const editarClienteValidator = vine.compile(
    vine.object({
        ...camposCliente,
        nombre: camposCliente.nombre.optional(),
        version: versionEsperada(),
    }),
)

export const listarClientesValidator = vine.compile(
    vine.object({
        ...reglasPaginacion,
        q: vine
            .string()
            .trim()
            .maxLength(100)
            .optional()
            .meta({ description: 'Busca por nombre, NIT/CUI, teléfono, user_ppp o IP' }),
        zona_id: idEntidad().optional(),
        estado_servicio: vine
            .enum(ESTADOS_SERVICIO)
            .optional()
            .meta({ description: 'Clientes con al menos un servicio en este estado' }),
        router_id: idEntidad()
            .optional()
            .meta({ description: 'Clientes con al menos un servicio en este router' }),
        plan_id: idEntidad()
            .optional()
            .meta({ description: 'Clientes con al menos un servicio en este plan' }),
        con_deuda_vencida: vine
            .boolean()
            .optional()
            .meta({ description: 'true: con alguna factura vencida; false: sin ninguna' }),
        con_promesa_activa: vine
            .boolean()
            .optional()
            .meta({ description: 'true: con alguna promesa de pago activa; false: sin ninguna' }),
        responsable_pago_id: idEntidad()
            .optional()
            .meta({ description: 'Dependientes de este responsable de pago' }),
    }),
)

/** `POST /clientes/:id/responsable-pago`. */
export const asignarResponsablePagoValidator = vine.compile(
    vine.object({
        responsable_id: idEntidad().meta({ description: 'Cliente que paga por este' }),
        motivo: motivo().optional(),
    }),
)

/** `POST /clientes/:id/quitar-responsable-pago`. */
export const quitarResponsablePagoValidator = vine.compile(vine.object({ motivo: motivo().optional() }))

/** `GET /clientes/:id/dependientes`. */
export const listarDependientesValidator = vine.compile(vine.object({ ...reglasPaginacion }))

/** `POST /clientes/:id/vincular-telegram` (el bot de A6 llama la acción directamente). */
export const vincularTelegramValidator = vine.compile(
    vine.object({
        chat_id: vine
            .string()
            .trim()
            .regex(/^-?\d{1,20}$/)
            .meta({ description: 'chat id de Telegram (entero con signo, como texto)' }),
    }),
)

export const crearZonaValidator = vine.compile(
    vine.object({
        nombre: vine.string().trim().minLength(2).maxLength(100),
        empresa_sugerida_id: empresaSugerida(),
    }),
)

export const editarZonaValidator = vine.compile(
    vine.object({
        nombre: vine.string().trim().minLength(2).maxLength(100),
        empresa_sugerida_id: empresaSugerida(),
        version: versionEsperada(),
    }),
)

/**
 * Excepciones a la plantilla de facturación del servicio: `{ campo: valor }`. Los campos y sus
 * valores los define y valida A3 (`app/billing/excepciones.ts`, `validarExcepcion`); aquí solo se
 * declaran para el OpenAPI. `null` borra la excepción; un campo desconocido responde 422.
 */
const excepciones = () =>
    vine
        .object(
            Object.fromEntries(
                CAMPOS_EXCEPCION.map((campo) => [
                    campo,
                    // el valor lo valida validarExcepcion; el tipo es solo para el OpenAPI
                    vine
                        .any()
                        .nullable()
                        .optional()
                        .meta({ anyOf: [TIPOS_EXCEPCION[campo], { type: 'null' }] }),
                ]),
            ),
        )
        .allowUnknownProperties()
        .optional()
        .meta({
            description:
                'Excepciones a la plantilla: { campo: valor }; null borra la excepción. Campos: ' +
                CAMPOS_EXCEPCION.join(', '),
        })

/*
|--------------------------------------------------------------------------
| Servicios
|--------------------------------------------------------------------------
*/

const modosIpv6 = ['radius_servicio', 'radius_pool', 'duid', 'estatico', 'ninguno'] as const
const tiposConexion = ['pppoe', 'ip_estatica', 'dhcp_fija'] as const

const tipoConexion = () =>
    vine.enum(tiposConexion).meta({
        description:
            'pppoe (RADIUS, con user_ppp/pass_ppp), ip_estatica o dhcp_fija (sin credenciales, por API REST de RouterOS; dhcp_fija exige mac)',
    })

const amarreIpMac = () =>
    vine.boolean().meta({ description: 'ARP estático IP-MAC en el router (solo sin PPPoE; exige mac)' })

export const crearServicioValidator = vine.compile(
    vine.object({
        cliente_id: idEntidad(),
        empresa_id: idEntidad().optional().meta({
            description:
                'Empresa (NIT) que factura el servicio. Sin ella: la sugerida de la zona del cliente, la del router o la empresa activa (X-Empresa-Id); 422 empresa_requerida si no se puede deducir',
        }),
        router_id: idEntidad(),
        plan_id: idEntidad(),
        tipo_conexion: tipoConexion().optional().meta({ description: 'Por defecto pppoe' }),
        amarre_ip_mac: amarreIpMac().optional(),
        plantilla_facturacion_id: idEntidad().nullable().optional().meta({
            description:
                'Ausente: la plantilla marcada por_defecto; sin marcada, la única que haya (422 si hay varias). null: sin plantilla',
        }),
        user_ppp: vine
            .string()
            .trim()
            .regex(/^[A-Za-z0-9._@-]{3,64}$/)
            .optional()
            .meta({ description: 'Solo pppoe; se genera si no viene' }),
        pass_ppp: vine
            .string()
            .minLength(6)
            .maxLength(64)
            .optional()
            .meta({ description: 'Solo pppoe; se genera si no viene' }),
        mac: vine
            .string()
            .trim()
            .regex(/^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/)
            .nullable()
            .optional(),
        direccion: vine.string().trim().maxLength(300).nullable().optional(),
        coordenadas: coordenadas().nullable().optional(),
        fecha_instalacion: fechaIso().nullable().optional(),
        costo_override: dinero().nullable().optional(),
        excluir_firewall: vine.boolean().optional(),
        ipv4: ipv4()
            .optional()
            .meta({ description: 'IP fija; si no viene se asigna de las redes del router' }),
        red_ipv4_id: idEntidad().optional().meta({
            description: 'Red IPv4 del router de la que asignar la IP (422 si no es del router o está llena)',
        }),
        ipv6_modo: vine.enum(modosIpv6).optional(),
        ipv6_duid: vine.string().trim().maxLength(130).nullable().optional(),
        prefijo_delegado_v6: prefijoV6().optional().meta({ description: 'Solo modo estatico' }),
        excepciones: excepciones(),
    }),
)

export const editarServicioValidator = vine.compile(
    vine.object({
        version: versionEsperada(),
        router_id: idEntidad().optional(),
        plan_id: idEntidad().optional(),
        plantilla_facturacion_id: idEntidad().nullable().optional(),
        tipo_conexion: tipoConexion().optional(),
        amarre_ip_mac: amarreIpMac().optional(),
        user_ppp: vine
            .string()
            .trim()
            .regex(/^[A-Za-z0-9._@-]{3,64}$/)
            .optional()
            .meta({ description: 'Solo al cambiar a pppoe; se genera si no viene' }),
        pass_ppp: vine
            .string()
            .minLength(6)
            .maxLength(64)
            .optional()
            .meta({ description: 'Solo pppoe; al cambiar a pppoe se genera si no viene' }),
        mac: vine
            .string()
            .trim()
            .regex(/^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/)
            .nullable()
            .optional(),
        direccion: vine.string().trim().maxLength(300).nullable().optional(),
        coordenadas: coordenadas().nullable().optional(),
        fecha_instalacion: fechaIso().nullable().optional(),
        costo_override: dinero().nullable().optional(),
        excluir_firewall: vine.boolean().optional(),
        ipv4: ipv4().optional(),
        ipv6_modo: vine.enum(modosIpv6).optional(),
        ipv6_duid: vine.string().trim().maxLength(130).nullable().optional(),
        prefijo_delegado_v6: prefijoV6().optional(),
        excepciones: excepciones(),
    }),
)

export const listarServiciosValidator = vine.compile(
    vine.object({
        ...reglasPaginacion,
        q: vine
            .string()
            .trim()
            .maxLength(100)
            .optional()
            .meta({ description: 'user_ppp, IP o nombre del cliente' }),
        cliente_id: idEntidad().optional(),
        router_id: idEntidad().optional(),
        plan_id: idEntidad().optional(),
        estado: vine.enum(ESTADOS_SERVICIO).optional(),
        tipo_conexion: vine.enum(tiposConexion).optional(),
        zona_id: idEntidad().optional().meta({ description: 'Zona del cliente' }),
        con_deuda_vencida: vine
            .boolean()
            .optional()
            .meta({ description: 'true: el servicio tiene alguna factura vencida; false: ninguna' }),
    }),
)

/** suspender, reactivar, limitar, quitar-limite, retirar, desconectar */
export const motivoValidator = vine.compile(vine.object({ motivo: motivo() }))

export const cambiarEmpresaServicioValidator = vine.compile(
    vine.object({
        empresa_id: idEntidad().meta({ description: 'Empresa (NIT) nueva del servicio' }),
        version: versionEsperada(),
        motivo: motivo(),
    }),
)

/*
|--------------------------------------------------------------------------
| Usuarios, roles y tokens (ACL completo: A1)
|--------------------------------------------------------------------------
*/

const asignacionRol = vine.object({
    role_id: idEntidad(),
    alcance_tipo: vine
        .enum(['router', 'zona', 'caja'] as const)
        .nullable()
        .optional(),
    alcance_id: idEntidad().nullable().optional(),
})

export const crearUsuarioValidator = vine.compile(
    vine.object({
        nombre: vine.string().trim().minLength(2).maxLength(200),
        email: vine.string().trim().email().toLowerCase(),
        password: vine.string().minLength(8).maxLength(200),
        activo: vine.boolean().optional(),
        roles: vine.array(asignacionRol).optional(),
    }),
)

export const editarUsuarioValidator = vine.compile(
    vine.object({
        version: versionEsperada(),
        nombre: vine.string().trim().minLength(2).maxLength(200).optional(),
        email: vine.string().trim().email().toLowerCase().optional(),
        password: vine.string().minLength(8).maxLength(200).optional(),
        activo: vine.boolean().optional(),
        roles: vine.array(asignacionRol).optional(),
    }),
)

const permisosValidos = vine.array(vine.enum(NOMBRES_PERMISOS))

export const crearRolValidator = vine.compile(
    vine.object({
        nombre: vine
            .string()
            .trim()
            .regex(/^[a-z0-9_]{2,50}$/),
        descripcion: vine.string().trim().maxLength(300).nullable().optional(),
        permisos: permisosValidos,
    }),
)

export const editarRolValidator = vine.compile(
    vine.object({
        version: versionEsperada(),
        descripcion: vine.string().trim().maxLength(300).nullable().optional(),
        permisos: permisosValidos.optional(),
    }),
)

export const crearTokenValidator = vine.compile(
    vine.object({
        usuario_id: idEntidad(),
        nombre: vine.string().trim().minLength(2).maxLength(100),
        alcances: vine
            .object({
                permisos: vine
                    .array(vine.enum(NOMBRES_PERMISOS))
                    .optional()
                    .meta({ description: 'Recorta los permisos del usuario a esta lista' }),
                routers: vine.array(idEntidad()).optional(),
                zonas: vine.array(idEntidad()).optional(),
                cajas: vine.array(idEntidad()).optional(),
            })
            .optional()
            .meta({ description: 'Alcances: permisos permitidos y routers, zonas o cajas' }),
    }),
)

export const listarPaginadoValidator = vine.compile(vine.object({ ...reglasPaginacion }))

/*
|--------------------------------------------------------------------------
| Bitácora
|--------------------------------------------------------------------------
*/

export const listarAccionesValidator = vine.compile(
    vine.object({
        ...reglasPaginacion,
        actor_id: idEntidad().optional(),
        accion: vine.string().trim().maxLength(100).optional(),
        entidad_tipo: vine.string().trim().maxLength(50).optional(),
        entidad_id: idEntidad().optional(),
        request_id: vine.string().trim().maxLength(128).optional(),
        desde: instanteIso().optional(),
        hasta: instanteIso().optional(),
        cliente_id: idEntidad()
            .optional()
            .meta({ description: 'Acciones del cliente y de sus servicios, facturas, pagos y promesas' }),
        canal: vine.enum(CANALES).optional(),
        excluir_canal: vine
            .enum(CANALES)
            .optional()
            .meta({ description: 'Oculta las acciones de este canal (p. ej. portal)' }),
    }),
)

export const listarCambiosValidator = vine.compile(
    vine.object({
        ...reglasPaginacion,
        entidad_tipo: vine.string().trim().maxLength(50).optional(),
        entidad_id: idEntidad().optional(),
        request_id: vine.string().trim().maxLength(128).optional(),
    }),
)

/*
|--------------------------------------------------------------------------
| Interno (servicio aaa)
|--------------------------------------------------------------------------
*/

export const aaaServicioValidator = vine.compile(
    vine.object({
        user_ppp: vine.string().trim().minLength(1).maxLength(64),
    }),
)

/**
 * `POST /internal/aaa/servicios` (carga por lotes, pedido de A2): `user_ppp` o `servicio_ids`
 * (hasta 100, sin paginar) o, sin ninguno, la página `cursor`/`limit` de todos los servicios
 * `pppoe` por `servicio_id` ascendente.
 */
export const aaaServiciosLoteValidator = vine.compile(
    vine.object({
        user_ppp: vine
            .array(vine.string().trim().minLength(1).maxLength(64))
            .minLength(1)
            .maxLength(100)
            .optional()
            .meta({ description: 'Hasta 100 user_ppp; los inexistentes se omiten' }),
        servicio_ids: vine
            .array(vine.number().withoutDecimals().min(1))
            .minLength(1)
            .maxLength(100)
            .optional()
            .meta({ description: 'Hasta 100 ids de servicio; los inexistentes o sin PPPoE se omiten' }),
        ...reglasPaginacion,
    }),
)

/*
|--------------------------------------------------------------------------
| Empresas (multiempresa: `contratos/multiempresa.md`)
|--------------------------------------------------------------------------
*/

/** Texto opcional de la empresa: `null` o vacío lo borra. */
const textoEmpresa = (maximo: number) => vine.string().trim().maxLength(maximo).nullable().optional()

const telefonoEmpresa = () =>
    vine
        .string()
        .trim()
        .maxLength(30)
        .regex(/^\+?[\d\s()-]{7,30}$/)
        .nullable()
        .optional()

const camposEmpresa = {
    direccion_fiscal: textoEmpresa(300),
    municipio: textoEmpresa(100),
    departamento: textoEmpresa(100),
    telefono: telefonoEmpresa(),
    telefono_alterno: telefonoEmpresa(),
    whatsapp: telefonoEmpresa(),
    correo: vine.string().trim().email().maxLength(200).nullable().optional(),
    sitio_web: vine
        .string()
        .trim()
        .maxLength(300)
        .url({ require_protocol: true, protocols: ['http', 'https'] })
        .nullable()
        .optional(),
    horario: textoEmpresa(200),
    instrucciones_pago: textoEmpresa(1000),
    color_marca: vine
        .string()
        .trim()
        .regex(/^#[0-9A-Fa-f]{6}$/)
        .nullable()
        .optional()
        .meta({ description: 'Color de marca `#RRGGBB`, solo para el PDF y el correo' }),
    regimen_isr: vine
        .enum(REGIMENES_ISR)
        .nullable()
        .optional()
        .meta({ description: 'Régimen de ISR para las frases de FEL' }),
    codigo_establecimiento: vine
        .number()
        .withoutDecimals()
        .min(1)
        .max(999999)
        .nullable()
        .optional()
        .meta({ description: 'Código de establecimiento en la SAT (FEL)' }),
}

const nitEmpresa = () =>
    vine
        .string()
        .trim()
        .toUpperCase()
        .regex(/^(\d{13}|\d{1,12}-?[0-9K])$/)
        .meta({
            description: 'NIT con dígito verificador (o CUI de 13 dígitos); único entre las empresas activas',
        })

export const crearEmpresaValidator = vine.compile(
    vine.object({
        nit: nitEmpresa(),
        razon_social: vine.string().trim().minLength(1).maxLength(200),
        nombre_comercial: vine.string().trim().minLength(1).maxLength(200),
        ...camposEmpresa,
    }),
)

export const editarEmpresaValidator = vine.compile(
    vine.object({
        version: vine.number().withoutDecimals().min(0).meta({
            description: 'version leída (0 si la empresa 1 nunca se guardó); si cambió responde 409',
        }),
        nit: nitEmpresa().nullable().optional(),
        razon_social: textoEmpresa(200),
        nombre_comercial: vine.string().trim().minLength(1).maxLength(200).optional(),
        ...camposEmpresa,
    }),
)

export const desactivarEmpresaValidator = vine.compile(
    vine.object({ version: versionEsperada(), motivo: motivo() }),
)

/** Campos del multipart de `POST /empresas/:id/logo` (el archivo va en `logo`). */
export const cambiarLogoEmpresaValidator = vine.compile(
    vine.object({
        version: vine
            .number()
            .withoutDecimals()
            .min(0)
            .meta({ description: 'version leída de la empresa; si cambió responde 409' }),
        quitar: vine.boolean().optional().meta({ description: 'true = quitar el logo actual (sin archivo)' }),
    }),
)

export const listarEmpresasValidator = vine.compile(
    vine.object({
        activas: vine.boolean().optional().meta({ description: 'Solo las activas (true) o todas (omitido)' }),
    }),
)
