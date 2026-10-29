import vine from '@vinejs/vine'
import { Decimal } from 'decimal.js'
import { reglasPaginacion } from '#shared/paginacion'
import {
    coordenadas,
    empresaSugerida,
    empresasConsulta,
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
import { TIPOS_DOCUMENTO_FISCAL } from '#core/nit_cui'
import { CONECTORES_SSO, TIPOS_DESTINO_SSO } from '#core/sso'
import { ESTADOS_SERVICIO, MODALIDADES_ADICIONAL, PRIMEROS_PERIODOS_ADICIONAL } from '#shared/eventos'
import { ESTADOS_INICIALES_SERVICIO } from '#core/instalacion'
import { TIPOS_PLAN } from '#network/tipos_plan'
import { TIPOS_CAMPO_PERSONALIZADO } from '#core/campos_personalizados'

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

/**
 * Número del documento fiscal del receptor. El formato fino depende de `tipo_documento_fiscal` y
 * lo valida la acción (`#core/nit_cui`): NIT con verificador, CUI de 13 dígitos, pasaporte o CF.
 */
const nitCui = () =>
    vine
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[0-9A-Z][0-9A-Z -]{0,24}$/)
        .meta({
            description:
                'NIT (con dígito verificador módulo 11), CUI de 13 dígitos, pasaporte (3-20 letras o dígitos) o CF, ' +
                'según `tipo_documento_fiscal`. Se guarda sin guiones ni espacios',
        })

/** País ISO 3166-1 alfa-2 en mayúsculas. */
const pais = () =>
    vine
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z]{2}$/)

const camposCliente = {
    nombre: vine.string().trim().minLength(2).maxLength(200),
    tipo: vine.enum(['persona', 'empresa'] as const).optional(),
    tipo_documento_fiscal: vine
        .enum(TIPOS_DOCUMENTO_FISCAL)
        .optional()
        .meta({
            description:
                'Documento del receptor (FEL): nit, cui, pasaporte o cf. Sin él se deduce de `nit_cui` ' +
                '(vacío o CF → cf, 13 dígitos → cui, NIT válido → nit)',
        }),
    nit_cui: nitCui().nullable().optional(),
    nombre_fiscal: vine.string().trim().maxLength(200).nullable().optional(),
    direccion_fiscal: vine.string().trim().maxLength(300).nullable().optional(),
    pais_fiscal: pais().optional().meta({
        description: 'País del receptor (por defecto GT); NIT y CUI exigen GT, un extranjero usa pasaporte',
    }),
    agente_retencion_iva: vine.boolean().optional().meta({
        description: 'El cliente es agente de retención de IVA (retiene al pagar)',
    }),
    sector_publico: vine.boolean().optional().meta({
        description: 'Entidad del sector público (reglas propias de retención)',
    }),
    email: vine.string().trim().email().nullable().optional(),
    telefono: vine.string().trim().maxLength(30).nullable().optional(),
    movil: vine.string().trim().maxLength(30).nullable().optional(),
    direccion: vine.string().trim().maxLength(300).nullable().optional(),
    coordenadas: coordenadas().nullable().optional(),
    zona_id: idEntidad().nullable().optional(),
    campos_personalizados: vine
        .record(vine.any().nullable())
        .optional()
        .meta({
            description:
                'Valores por clave del catálogo (GET /campos-personalizados): cada uno de su tipo; null = vacío. ' +
                'Al editar se reemplaza completo. Claves fuera del catálogo se guardan tal cual',
        }),
    canal_preferido: vine.enum(['correo', 'telegram', 'whatsapp'] as const).optional(),
    codigo_externo: vine.string().trim().maxLength(50).nullable().optional().meta({
        description: 'Código del cliente en el sistema anterior (importador); no reemplaza a `codigo`',
    }),
}

export const crearClienteValidator = vine.compile(
    vine.object({
        ...camposCliente,
        codigo_referido: vine
            .string()
            .trim()
            .maxLength(20)
            .nullable()
            .optional()
            .meta({
                description:
                    'Código de referido de otro cliente (programa de lealtad, 8 caracteres). 422 ' +
                    '`referido_invalido` si no existe o el referidor tiene el mismo NIT o CUI',
            }),
    }),
)

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
        empresas: empresasConsulta(),
        q: vine
            .string()
            .trim()
            .maxLength(100)
            .optional()
            .meta({ description: 'Busca por nombre, código, NIT/CUI, teléfono, user_ppp o IP' }),
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
        nit_cui_invalido: vine.boolean().optional().meta({
            description:
                'true: clientes con el NIT/CUI marcado inválido (migración de la localización fiscal)',
        }),
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

/*
|--------------------------------------------------------------------------
| Catálogo de campos personalizados del cliente
|--------------------------------------------------------------------------
*/

const etiquetaCampo = () => vine.string().trim().minLength(1).maxLength(80)
const opcionesCampo = () =>
    vine.array(vine.string().trim().minLength(1).maxLength(80)).maxLength(50).optional().meta({
        description: 'Valores permitidos: obligatorio (al menos uno) con opcion, prohibido en los demás',
    })
const ordenCampo = () =>
    vine
        .number()
        .withoutDecimals()
        .min(0)
        .max(10000)
        .optional()
        .meta({ description: 'Orden en la ficha (menor primero)' })

export const listarCamposPersonalizadosValidator = vine.compile(
    vine.object({ activo: vine.boolean().optional() }),
)

export const crearCampoPersonalizadoValidator = vine.compile(
    vine.object({
        clave: vine
            .string()
            .trim()
            .regex(/^[a-z][a-z0-9_]{0,39}$/)
            .meta({
                description: 'Clave en `campos_personalizados` (snake_case, hasta 40); no cambia después',
            }),
        etiqueta: etiquetaCampo(),
        tipo: vine.enum(TIPOS_CAMPO_PERSONALIZADO).meta({
            description:
                'texto (hasta 500), numero, fecha (AAAA-MM-DD), booleano u opcion; no cambia después',
        }),
        opciones: opcionesCampo(),
        requerido: vine.boolean().optional(),
        orden: ordenCampo(),
    }),
)

export const editarCampoPersonalizadoValidator = vine.compile(
    vine.object({
        etiqueta: etiquetaCampo().optional(),
        opciones: opcionesCampo(),
        requerido: vine.boolean().optional(),
        orden: ordenCampo(),
        version: versionEsperada(),
    }),
)

export const versionCampoPersonalizadoValidator = vine.compile(vine.object({ version: versionEsperada() }))

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
        estado_inicial: vine.enum(ESTADOS_INICIALES_SERVICIO).optional().meta({
            description:
                'Por defecto activo. pendiente_instalacion: venta desde Iris; no navega ni factura hasta POST /servicios/:id/activar-instalacion',
        }),
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
        empresas: empresasConsulta(),
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
        tipo: vine
            .enum(TIPOS_PLAN)
            .optional()
            .meta({ description: 'Tipo del plan del servicio: residencial, empresarial o dedicado' }),
    }),
)

/** suspender, reactivar, limitar, quitar-limite, retirar, desconectar */
export const motivoValidator = vine.compile(vine.object({ motivo: motivo() }))

const textoPlanta = () => vine.string().trim().minLength(1).maxLength(100).optional()

/** `potencia_dbm` entre -60 y 10 (comparación decimal, sin pasar por number). */
const potenciaEnRango = vine.createRule((valor, _opciones, campo) => {
    if (typeof valor !== 'string') return
    const d = new Decimal(valor)
    if (d.lessThan(-60) || d.greaterThan(10)) {
        campo.report('La potencia debe estar entre -60 y 10 dBm', 'rango', campo)
    }
})

/** `POST /servicios/:id/activar-instalacion` (`contratos/instalacion.md` §2). */
export const activarInstalacionValidator = vine.compile(
    vine.object({
        version: versionEsperada(),
        instalado_en: instanteIso().optional().meta({
            description:
                'Cuándo quedó instalado (inicio de la facturación). Sin él, ahora. Ni futuro (5 min de tolerancia de reloj) ni anterior al alta del servicio',
        }),
        origen_tipo: vine
            .string()
            .trim()
            .regex(/^[a-z][a-z0-9_]{1,39}$/)
            .optional()
            .meta({ description: 'Sistema y documento que activa, p. ej. iris_orden (auditoría y evento)' }),
        origen_id: vine
            .string()
            .trim()
            .minLength(1)
            .maxLength(100)
            .optional()
            .meta({ description: 'Id del documento de origen (la orden de Iris)' }),
        planta: vine
            .object({
                caja: textoPlanta(),
                puerto: textoPlanta(),
                olt: textoPlanta(),
                slot: textoPlanta(),
                pon: textoPlanta(),
                potencia_dbm: vine
                    .string()
                    .trim()
                    .regex(/^-?\d{1,2}(\.\d{1,2})?$/)
                    .use(potenciaEnRango())
                    .optional()
                    .meta({
                        description:
                            'Potencia óptica en dBm, decimal como texto (p. ej. "-19.40"), entre -60 y 10, hasta 2 decimales',
                    }),
            })
            .optional()
            .meta({
                description:
                    'Referencia de planta de la instalación (la envía Iris): solo lectura, no se valida contra nada',
            }),
    }),
)

/** `POST /servicios/:id/planes-temporales` (lealtad, `contratos/lealtad.md` §5). */
export const programarPlanTemporalValidator = vine.compile(
    vine.object({
        plan_id: idEntidad().meta({
            description: 'Plan temporal (mejora): activo, disponible en el router y compatible',
        }),
        inicio: instanteIso()
            .optional()
            .meta({ description: 'Por defecto, ahora (se inicia en la misma petición)' }),
        fin: instanteIso().optional().meta({ description: 'Fin de la vigencia; o `dias` (uno de los dos)' }),
        dias: vine.number().withoutDecimals().range([1, 366]).optional(),
        motivo: motivo().nullable().optional(),
    }),
)

/** `POST /servicios/:id/planes-temporales/:plan_temporal_id/cancelar`. */
export const cancelarPlanTemporalValidator = vine.compile(
    vine.object({ version: versionEsperada(), motivo: motivo() }),
)

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

export const asignarEmpresasUsuarioValidator = vine.compile(
    vine.object({
        version: versionEsperada(),
        alcance_global: vine
            .boolean()
            .meta({ description: 'true = todas las empresas y los consolidados; la lista se ignora' }),
        empresas: vine
            .array(idEntidad())
            .maxLength(100)
            .optional()
            .meta({ description: 'Empresas que puede operar sin alcance global (al menos una)' }),
    }),
)

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
        empresas: empresasConsulta(),
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
        .meta({
            description:
                'Régimen de ISR. Solo lectura desde la localización fiscal: se acepta al crear (semilla del ' +
                'parámetro `regimen`); al editar, otro valor responde 422 `campo_solo_lectura` (POST /fiscal/regimen)',
        }),
    codigo_establecimiento: vine
        .number()
        .withoutDecimals()
        .min(1)
        .max(999999)
        .nullable()
        .optional()
        .meta({
            description:
                'Código de establecimiento en la SAT (FEL). Solo lectura: se acepta al crear (establecimiento 1); ' +
                'al editar, otro valor responde 422 `campo_solo_lectura` (/fiscal/establecimientos)',
        }),
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
        pais: pais()
            .optional()
            .meta({
                description:
                    'País de la localización fiscal (por defecto GT; hoy solo GT, ver GET /empresas/paises). ' +
                    '422 `pais_no_soportado` sin paquete',
            }),
        ...camposEmpresa,
    }),
)

export const cambiarPaisEmpresaValidator = vine.compile(
    vine.object({
        pais: pais().meta({ description: 'País nuevo (ISO 3166-1 alfa-2); ver GET /empresas/paises' }),
        version: vine.number().withoutDecimals().min(0).meta({
            description: 'version leída de la empresa; si cambió responde 409',
        }),
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

/*
|--------------------------------------------------------------------------
| Integración Horus (contrato `.claude/integration/contratos/horus.md`)
|--------------------------------------------------------------------------
*/

/** Máximo de IPs por llamada a `POST /integraciones/horus/resolver` (contrato §2.1). */
export const MAXIMO_IPS_RESOLVER = 500

/** `POST /integraciones/horus/resolver`: las IPs van en el cuerpo, nunca en la URL. */
export const resolverIpsValidator = vine.compile(
    vine.object({
        ips: vine
            .array(vine.string().trim().ipAddress())
            .minLength(1)
            .maxLength(MAXIMO_IPS_RESOLVER)
            .meta({ description: 'IPv4 o IPv6, de 1 a 500; la respuesta conserva el orden' }),
    }),
)

/** `POST /integraciones/horus/tokens`. */
export const generarTokenHorusValidator = vine.compile(
    vine.object({
        nombre: vine.string().trim().minLength(2).maxLength(100).optional(),
        routers: vine
            .array(idEntidad())
            .optional()
            .meta({ description: 'Restringe el token a servicios de estos routers' }),
        zonas: vine
            .array(idEntidad())
            .optional()
            .meta({ description: 'Restringe el token a clientes de estas zonas' }),
    }),
)

/*
|--------------------------------------------------------------------------
| Autologin desde Horus (contrato Horus §1.5, lado receptor)
|--------------------------------------------------------------------------
*/

/** `POST /integraciones/horus/sso/tickets` (servidor de Horus con su token `atk_`). */
export const emitirTicketSsoValidator = vine.compile(
    vine.object({
        usuario: vine.object({
            id_externo: vine
                .string()
                .trim()
                .minLength(1)
                .maxLength(200)
                .meta({ description: 'Id del usuario en Horus; con el conector forma la vinculación' }),
            correo: vine
                .string()
                .trim()
                .maxLength(254)
                .nullable()
                .optional()
                .meta({ description: 'Solo informativo: nunca se vincula por correo' }),
            nombre: vine.string().trim().maxLength(200).nullable().optional(),
        }),
        destino: vine.object({
            tipo: vine.enum(TIPOS_DESTINO_SSO),
            id_externo: vine
                .string()
                .trim()
                .regex(/^[1-9]\d{0,17}$/)
                .meta({ description: 'Id del cliente o del servicio en ArgosIsp' }),
        }),
    }),
)

/** `POST /auth/sso/canjear` (panel, desde `/sso/entrar#<ticket>`). */
export const canjearTicketSsoValidator = vine.compile(
    vine.object({ ticket: vine.string().trim().minLength(20).maxLength(200) }),
)

/** `POST /auth/sso/vincular`: login normal + token de vinculación del canje. */
export const vincularCuentaSsoValidator = vine.compile(
    vine.object({
        token_vinculacion: vine.string().trim().minLength(20).maxLength(200),
        email: vine.string().trim().email().toLowerCase(),
        password: vine.string().minLength(1).maxLength(200),
    }),
)

/** `POST /vinculaciones/revocar` (administrador). */
export const revocarVinculacionesValidator = vine.compile(
    vine.object({
        usuario_id: idEntidad().optional().meta({ description: 'Solo las de este usuario; sin él, todas' }),
        conector: vine.enum(CONECTORES_SSO).optional(),
    }),
)

/*
|--------------------------------------------------------------------------
| Servicios adicionales (`contratos/adicionales.md`)
|--------------------------------------------------------------------------
*/

const codigoCatalogo = () =>
    vine
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z0-9][A-Z0-9_-]{0,39}$/)
        .meta({
            description:
                'Código único en la empresa: letras, dígitos, guion y guion bajo (se guarda en mayúsculas)',
        })

const empresaDelCatalogo = () =>
    idEntidad().optional().meta({ description: 'Empresa (NIT) del catálogo; por defecto, la empresa activa' })

export const listarAdicionalesValidator = vine.compile(
    vine.object({
        ...reglasPaginacion,
        q: vine.string().trim().maxLength(100).optional().meta({ description: 'Busca en nombre y código' }),
        activo: vine.boolean().optional(),
        empresas: empresasConsulta(),
    }),
)

export const crearAdicionalValidator = vine.compile(
    vine.object({
        empresa_id: empresaDelCatalogo(),
        codigo: codigoCatalogo(),
        nombre: vine.string().trim().minLength(2).maxLength(100),
        descripcion: vine.string().trim().maxLength(500).nullable().optional(),
        precio_sugerido: dinero()
            .nullable()
            .optional()
            .meta({ description: 'Precio sugerido para asignarlo `cobrado` (solo una sugerencia)' }),
    }),
)

export const editarAdicionalValidator = vine.compile(
    vine.object({
        version: versionEsperada(),
        codigo: codigoCatalogo().optional(),
        nombre: vine.string().trim().minLength(2).maxLength(100).optional(),
        descripcion: vine.string().trim().maxLength(500).nullable().optional(),
        precio_sugerido: dinero().nullable().optional(),
    }),
)

/** `POST /adicionales/:id/desactivar`, `POST /adicionales/motivos/:id/desactivar` */
export const desactivarVersionadoValidator = vine.compile(vine.object({ version: versionEsperada() }))

export const listarMotivosCortesiaValidator = vine.compile(
    vine.object({ activo: vine.boolean().optional(), empresas: empresasConsulta() }),
)

export const crearMotivoCortesiaValidator = vine.compile(
    vine.object({
        empresa_id: empresaDelCatalogo(),
        codigo: codigoCatalogo(),
        nombre: vine.string().trim().minLength(2).maxLength(100),
    }),
)

export const listarAdicionalesServicioValidator = vine.compile(
    vine.object({
        ...reglasPaginacion,
        estado: vine
            .enum(['activo', 'baja'] as const)
            .optional()
            .meta({ description: 'Solo los activos o solo las bajas; sin él, todos' }),
    }),
)

const identificadorAdicional = () =>
    vine
        .string()
        .trim()
        .minLength(1)
        .maxLength(200)
        .nullable()
        .optional()
        .meta({ description: 'Usuario de IPTV, correo de la cuenta de streaming…' })

const credencialAdicional = () =>
    vine
        .string()
        .minLength(1)
        .maxLength(500)
        .nullable()
        .optional()
        .meta({ description: 'Se guarda cifrada; nunca vuelve en las respuestas (ver `/credencial`)' })

export const agregarAdicionalServicioValidator = vine.compile(
    vine.object({
        adicional_id: idEntidad().meta({ description: 'Adicional activo de la empresa del servicio' }),
        modalidad: vine.enum(MODALIDADES_ADICIONAL).meta({
            description: 'cortesia exige además el permiso servicios.adicional_cortesia y motivo_id',
        }),
        identificador: identificadorAdicional(),
        credencial: credencialAdicional(),
        precio: dinero()
            .nullable()
            .optional()
            .meta({ description: 'Obligatorio y > 0 con cobrado; solo con cobrado' }),
        motivo_id: idEntidad()
            .nullable()
            .optional()
            .meta({ description: 'Motivo de cortesía (GET /adicionales/motivos); obligatorio con cortesia' }),
        motivo_detalle: vine.string().trim().maxLength(500).nullable().optional(),
        primer_periodo: vine.enum(PRIMEROS_PERIODOS_ADICIONAL).nullable().optional().meta({
            description:
                'Solo con cobrado: prorrateado (por defecto) cobra la parte proporcional del periodo en curso; sin_costo no lo cobra',
        }),
    }),
)

export const editarAdicionalServicioValidator = vine.compile(
    vine.object({
        version: versionEsperada(),
        modalidad: vine.enum(MODALIDADES_ADICIONAL).optional(),
        identificador: identificadorAdicional(),
        credencial: credencialAdicional(),
        precio: dinero().nullable().optional(),
        motivo_id: idEntidad().nullable().optional(),
        motivo_detalle: vine.string().trim().maxLength(500).nullable().optional(),
        primer_periodo: vine.enum(PRIMEROS_PERIODOS_ADICIONAL).nullable().optional().meta({
            description:
                'Solo con cobrado: prorrateado (por defecto) cobra la parte proporcional del periodo en curso; sin_costo no lo cobra',
        }),
    }),
)

export const quitarAdicionalServicioValidator = vine.compile(
    vine.object({
        version: versionEsperada(),
        motivo: vine.string().trim().minLength(3).maxLength(500).nullable().optional(),
    }),
)

export const definirAdicionalesPlanValidator = vine.compile(
    vine.object({
        version: vine.number().withoutDecimals().min(1).meta({
            description: 'version leída del plan (la lista es parte del plan); si cambió responde 409',
        }),
        adicionales: vine
            .array(
                vine.object({
                    adicional_id: idEntidad(),
                    cantidad: vine.number().withoutDecimals().range([1, 50]),
                }),
            )
            .maxLength(100)
            .meta({ description: 'Lista completa (reemplaza la anterior); [] la vacía' }),
    }),
)

/** `DELETE /servicios/:id?version=` (decisión del PM, 29 oct; `contratos/eliminar.md`). */
export const eliminarServicioValidator = vine.compile(vine.object({ version: versionEsperada() }))
