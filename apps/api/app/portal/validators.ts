import vine from '@vinejs/vine'
import { reglasPaginacion } from '#shared/paginacion'
import { dinero, fechaIso, idEntidad, versionEsperada } from '#shared/validadores'

/**
 * Validadores del portal del cliente (A5). Espejo en `apps/portal` (esquemas de `UForm`).
 */

export const solicitarCodigoValidator = vine.compile(
    vine.object({
        identificador: vine
            .string()
            .trim()
            .minLength(2)
            .maxLength(64)
            .optional()
            .meta({ description: 'NIT/CUI o usuario PPPoE. Omitir con `por_ip: true`' }),
        por_ip: vine
            .boolean()
            .optional()
            .meta({ description: 'Identificar por la IP de origen (página de corte)' }),
    }),
)

export const verificarCodigoValidator = vine.compile(
    vine.object({
        solicitud: vine.string().trim().uuid().meta({ description: 'Devuelta por POST /portal/codigo' }),
        codigo: vine
            .string()
            .trim()
            .regex(/^\d{6}$/)
            .meta({ description: 'Código de 6 dígitos' }),
    }),
)

export const paginaPortalValidator = vine.compile(vine.object({ ...reglasPaginacion }))

/** Teléfono guatemalteco o internacional: dígitos, espacios, guiones, paréntesis y `+`. */
const telefono = () =>
    vine
        .string()
        .trim()
        .maxLength(30)
        .regex(/^\+?[\d\s()-]{7,30}$/)

/** Texto opcional de la configuración de empresa: `null` o vacío lo borra. */
const textoEmpresa = (maximo: number) => vine.string().trim().maxLength(maximo).nullable().optional()

export const editarEmpresaValidator = vine.compile(
    vine.object({
        version: vine
            .number()
            .withoutDecimals()
            .min(0)
            .meta({ description: 'version leída (0 si nunca se guardó); si cambió responde 409' }),
        nombre: vine.string().trim().minLength(1).maxLength(200).optional(),
        nit: textoEmpresa(20),
        direccion: textoEmpresa(300),
        telefono: telefono().nullable().optional(),
        telefono_alterno: telefono().nullable().optional(),
        whatsapp: telefono().nullable().optional(),
        correo: vine.string().trim().email().maxLength(200).nullable().optional(),
        horario: textoEmpresa(200),
        instrucciones_pago: textoEmpresa(1000),
    }),
)

export const editarPlantillaDocumentoValidator = vine.compile(
    vine.object({
        html: vine.string().minLength(1).maxLength(100_000),
        version: vine
            .number()
            .withoutDecimals()
            .min(0)
            .meta({ description: 'version leída (0 si es la de fábrica); si cambió responde 409' }),
    }),
)

export const vistaPreviaDocumentoValidator = vine.compile(
    vine.object({ html: vine.string().minLength(1).maxLength(100_000) }),
)

export const editarContactoValidator = vine.compile(
    vine.object({
        version: versionEsperada(),
        email: vine.string().trim().email().maxLength(200).nullable().optional(),
        telefono: telefono().nullable().optional(),
        movil: telefono().nullable().optional(),
        canal_preferido: vine.enum(['correo', 'telegram', 'whatsapp'] as const).optional(),
    }),
)

const servicioDeLaSesion = () =>
    idEntidad()
        .optional()
        .meta({ description: 'Solo con la sesión del portal; sin él se identifica por la IP de origen' })

/**
 * `POST /portal/promesas` (tarea 4). Sin `servicio_id` identifica por la IP de origen (página de
 * corte); con `servicio_id` exige la sesión del portal y que el servicio sea del cliente.
 */
export const solicitarPromesaValidator = vine.compile(
    vine.object({
        // Día de pago (YYYY-MM-DD, hora de Guatemala); la promesa vence a las 23:59:59 de ese día.
        vence_el: fechaIso(),
        monto: dinero(),
        servicio_id: servicioDeLaSesion(),
    }),
)

/** `GET /portal/promesas/condiciones`: mismo criterio de identificación que `POST /portal/promesas`. */
export const condicionesPromesaValidator = vine.compile(vine.object({ servicio_id: servicioDeLaSesion() }))

/**
 * `POST /portal/comprobantes` (tarea 5), `multipart/form-data`: estos campos más el archivo
 * `archivo` (foto JPG, PNG o WebP, o PDF, hasta 5 MB; lo valida `RegistrarComprobante` por el
 * contenido). Los campos llegan como texto y los vacíos como `null`. Mismo criterio de
 * identificación que la promesa.
 */
export const subirComprobanteValidator = vine.compile(
    vine.object({
        metodo: vine.enum(['deposito', 'transferencia', 'ach', 'remesa'] as const),
        cuenta_bancaria_id: idEntidad().meta({
            description: 'id de una de `cuentas_deposito` (GET /portal/empresa)',
        }),
        banco_origen_id: idEntidad()
            .nullable()
            .optional()
            .meta({ description: 'Solo con transferencia y ACH (catálogo GET /portal/bancos)' }),
        referencia: vine.string().trim().minLength(1).maxLength(100),
        monto: dinero(),
        fecha_deposito: fechaIso(),
        nota: vine.string().trim().maxLength(500).nullable().optional(),
        servicio_id: servicioDeLaSesion(),
    }),
)

/**
 * `POST /portal/pagos/iniciar` (semana 2, pago en línea). Sin `servicio_id` ni `facturas` cobra lo
 * vencido del servicio de la IP de origen (o lo pendiente, si nada está vencido). `servicio_id` y
 * `facturas` exigen la sesión del portal.
 */
export const iniciarPagoValidator = vine.compile(
    vine.object({
        servicio_id: servicioDeLaSesion(),
        facturas: vine
            .array(idEntidad())
            .minLength(1)
            .maxLength(50)
            .optional()
            .meta({ description: 'Facturas concretas del cliente (solo con la sesión del portal)' }),
    }),
)

/**
 * `GET /portal/empresa` (multiempresa): de qué empresa son los datos. Sin parámetros, la del
 * servicio de la IP de origen (`/corte`), si no la principal del cliente de la sesión, si no la
 * principal de la instalación.
 */
export const empresaPortalValidator = vine.compile(
    vine.object({
        empresa_id: idEntidad()
            .optional()
            .meta({ description: 'Esta empresa (la de un servicio o una factura de `/cuenta`)' }),
        de: vine
            .enum(['cliente'] as const)
            .optional()
            .meta({
                description: '`cliente`: la empresa principal del cliente de la sesión (401 sin sesión)',
            }),
    }),
)

export const vincularTelegramValidator = vine.compile(
    vine.object({
        empresa_id: idEntidad()
            .optional()
            .meta({
                description:
                    'Empresa (de un servicio del cliente) cuyo bot se vincula. Sin ella: la única empresa de sus ' +
                    'servicios o, con varias, el bot global',
            }),
    }),
)
