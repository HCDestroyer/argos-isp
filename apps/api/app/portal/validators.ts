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

/*
|--------------------------------------------------------------------------
| Anuncios (contrato `anuncios.md`)
|--------------------------------------------------------------------------
| Sin `.meta()` en los campos obligatorios: en VineJS 4.4 los deja aceptar `null`.
*/

const AUDIENCIAS_ANUNCIO = ['todos', 'suspendidos', 'con_puntos', 'al_dia'] as const
const LUGARES_ANUNCIO = ['portal_inicio', 'pagina_corte'] as const
const ESTADOS_ANUNCIO = ['borrador', 'publicado', 'archivado'] as const

// `type` con `null`: el `type` del `.meta()` reemplaza el que deduce el generador del OpenAPI y
// sin él `inicio: null` / `fin: null` (que borran la vigencia) quedarían fuera de los tipos.
const instanteOpcional = () =>
    vine
        .date({ formats: ['iso8601'] })
        .nullable()
        .optional()
        .meta({ type: ['string', 'null'], format: 'date-time' })

const camposAnuncio = {
    texto: vine.string().trim().maxLength(500).optional().meta({
        description: 'Texto plano (sin HTML; el portal lo muestra tal cual, con saltos de línea)',
    }),
    boton_texto: vine.string().trim().minLength(1).maxLength(40).nullable().optional(),
    boton_url: vine.string().trim().maxLength(500).nullable().optional().meta({
        description: '`https://…`, `http://…` o una ruta del portal que empieza con `/` (p. ej. `/cuenta`)',
    }),
    inicio: instanteOpcional(),
    fin: instanteOpcional(),
    audiencia: vine.enum(AUDIENCIAS_ANUNCIO).optional(),
    lugares: vine.array(vine.enum(LUGARES_ANUNCIO)).minLength(1).maxLength(2).optional(),
    orden: vine.number().withoutDecimals().min(-1000).max(1000).optional().meta({
        description: 'Mayor primero en el carrusel; a igual orden, el más nuevo',
    }),
}

export const crearAnuncioValidator = vine.compile(
    vine.object({
        titulo: vine.string().trim().minLength(1).maxLength(80),
        ...camposAnuncio,
    }),
)

export const editarAnuncioValidator = vine.compile(
    vine.object({
        version: versionEsperada(),
        titulo: vine.string().trim().minLength(1).maxLength(80).optional(),
        imagen_alt: vine.string().trim().minLength(1).maxLength(200).optional().meta({
            description: 'Texto alternativo de la imagen (solo si el anuncio tiene imagen)',
        }),
        ...camposAnuncio,
    }),
)

export const imagenAnuncioValidator = vine.compile(
    vine.object({
        version: versionEsperada(),
        alt: vine.string().trim().minLength(1).maxLength(200).optional().meta({
            description: 'Texto alternativo; obligatorio al subir si el anuncio aún no tiene',
        }),
        quitar: vine.boolean().optional().meta({ description: 'true = quitar la imagen (sin archivo)' }),
    }),
)

export const estadoAnuncioValidator = vine.compile(vine.object({ version: versionEsperada() }))

export const listarAnunciosValidator = vine.compile(
    vine.object({
        ...reglasPaginacion,
        estado: vine.enum(ESTADOS_ANUNCIO).optional(),
    }),
)

export const anunciosPortalValidator = vine.compile(
    vine.object({
        lugar: vine.enum(LUGARES_ANUNCIO),
    }),
)

export const eventoAnuncioValidator = vine.compile(
    vine.object({
        tipo: vine.enum(['vista', 'clic'] as const),
        visitante: vine.string().trim().uuid(),
        lugar: vine.enum(LUGARES_ANUNCIO),
    }),
)

/** `POST /nodos-portal` (contrato `nodo-portal.md`). */
export const crearNodoPortalValidator = vine.compile(
    vine.object({
        // Identificador del nodo (`^[a-z0-9][a-z0-9-]{0,62}$`, p. ej. `xela-1`), único. Sin `.meta()`:
        // en VineJS 4.4 `meta()` sobre un campo obligatorio lo deja aceptar `null` (y el bodyparser
        // convierte "" en null), así que la descripción va en el schema `NodoPortal`.
        nombre: vine
            .string()
            .trim()
            .regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
    }),
)

/** `POST /portal/canjes` (contrato `lealtad.md` §12): el premio y el servicio que recibe el beneficio. */
export const canjearPuntosValidator = vine.compile(
    vine.object({
        premio_id: idEntidad(),
        servicio_id: idEntidad(),
    }),
)

/** `GET /portal/avisos-sorteo`: en qué lugar del portal (decide cómo se identifica al cliente). */
export const avisosSorteoValidator = vine.compile(
    vine.object({
        lugar: vine.enum(['portal_inicio', 'pagina_corte'] as const),
    }),
)
