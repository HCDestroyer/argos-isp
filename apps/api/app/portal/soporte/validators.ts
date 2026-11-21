import vine from '@vinejs/vine'
import { idEntidad, versionEsperada } from '#shared/validadores'
import { ESTADOS_SOLICITUD, ESTADOS_TICKET, TIPOS_SOLICITUD } from '#portal/soporte/vistas'

/**
 * Validadores de soporte, solicitudes y contactos del portal (contrato Iris 0.9.0 §11, 0.10.0 §3.5).
 * Espejo de las reglas de Iris para no gastar un envío que Iris rechazaría. Espejo en
 * `apps/portal/app/utils/soporteEsquema.ts` y `contactoEsquema.ts`.
 */

const empresa = () =>
    idEntidad().optional().meta({
        description: 'Empresa del servicio (una de las del cliente); sin ella, la del primer servicio',
    })

/** Límite de las listas de Iris (§11.1: de 1 a 100, 20 por defecto). */
const paginacionIris = {
    cursor: vine
        .string()
        .trim()
        .maxLength(200)
        .optional()
        .meta({ description: 'Cursor opaco de la página anterior' }),
    limit: vine
        .number()
        .withoutDecimals()
        .range([1, 100])
        .optional()
        .meta({ description: 'De 1 a 100 (20 por defecto)' }),
}

/**
 * `?estado=` uno o varios separados por coma. El parser de la consulta convierte `a,b` en lista; el
 * gancho `antes` de la ruta la vuelve a unir (`unirEstados`) antes de validar.
 */
function estados<T extends string>(valores: readonly T[]) {
    const uno = `(${valores.join('|')})`
    return vine
        .string()
        .trim()
        .regex(new RegExp(`^${uno}(,${uno})*$`))
        .optional()
        .meta({ description: `Uno o varios separados por coma: ${valores.join(', ')}` })
}

/**
 * Servicio a cargo (A46, contrato Iris 0.12.1 §11.10): `contacto_id` (el contacto de la persona en la
 * cuenta del dueño) con `servicio_id` (obligatorio con `contacto_id`). Sin ellos, el titular.
 */
const aCargo = {
    contacto_id: idEntidad().optional().meta({
        description:
            'Servicio a cargo (A46): el contacto de la persona en la cuenta del dueño. Exige `servicio_id`',
    }),
    servicio_id: idEntidad().optional().meta({
        description:
            'Con `contacto_id`, el servicio a cargo (obligatorio); con el titular, filtra por servicio',
    }),
}

export const empresaSoporteValidator = vine.compile(vine.object({ empresa_id: empresa() }))

/** Detalle, mensajes y adjuntos de un ticket: el titular o un contacto a cargo. */
export const verTicketValidator = vine.compile(vine.object({ empresa_id: empresa(), ...aCargo }))

export const listarTicketsValidator = vine.compile(
    vine.object({
        empresa_id: empresa(),
        estado: estados(ESTADOS_TICKET),
        ...aCargo,
        ...paginacionIris,
    }),
)

export const listarMensajesValidator = vine.compile(
    vine.object({ empresa_id: empresa(), ...aCargo, ...paginacionIris }),
)

export const listarSolicitudesValidator = vine.compile(
    vine.object({
        empresa_id: empresa(),
        estado: estados(ESTADOS_SOLICITUD),
        ...paginacionIris,
    }),
)

/** `POST /portal/soporte/tickets` (multipart: estos campos y hasta 3 `archivos`). */
export const abrirTicketValidator = vine.compile(
    vine.object({
        empresa_id: empresa(),
        asunto: vine.string().trim().minLength(3).maxLength(200),
        descripcion: vine.string().trim().minLength(1).maxLength(20_000),
        categoria_id: idEntidad().optional().meta({ description: 'Una de GET /portal/soporte/categorias' }),
        servicio_id: idEntidad().optional().meta({ description: 'Un servicio del cliente en esa empresa' }),
        contacto_id: idEntidad().optional().meta({
            description:
                'Reportar la falla de un servicio que la persona tiene a cargo (A46): su contacto en la cuenta del dueño, con `reportar`. Exige `servicio_id`',
        }),
    }),
)

/** `POST /portal/soporte/tickets/:ticketId/responder` (multipart: estos campos y hasta 3 `archivos`). */
export const responderTicketValidator = vine.compile(
    vine.object({
        empresa_id: empresa(),
        cuerpo: vine.string().trim().minLength(1).maxLength(20_000),
        ...aCargo,
        version: vine.number().withoutDecimals().min(1).optional().meta({
            description: 'La del ticket que vio el cliente; si cambió, 409 `conflicto_version`',
        }),
    }),
)

export const confirmarSolucionValidator = vine.compile(
    vine.object({ empresa_id: empresa(), ...aCargo, version: versionEsperada() }),
)

/** `POST /portal/soporte/solicitudes` (§11.7). Las reglas por tipo las revisa el handler. */
export const solicitarServicioValidator = vine.compile(
    vine.object({
        empresa_id: empresa(),
        tipo: vine.enum(TIPOS_SOLICITUD),
        servicio_id: idEntidad().optional().meta({
            description: 'Obligatorio en `cambio_plan` y `traslado`; opcional en `otro`; no va en `alta`',
        }),
        direccion: vine.string().trim().minLength(1).maxLength(300).optional().meta({
            description: 'Obligatoria en `alta` y `traslado`',
        }),
        coordenadas: vine
            .string()
            .trim()
            .regex(/^-?\d{1,2}(\.\d+)?,\s?-?\d{1,3}(\.\d+)?$/)
            .optional()
            .meta({ description: '`lat,lng`' }),
        plan_interes_id: idEntidad().optional().meta({ description: 'Uno de GET /portal/soporte/planes' }),
        comentario: vine.string().trim().maxLength(2000).optional(),
        telefono_contacto: vine
            .string()
            .trim()
            .regex(/^\+?[\d\s()-]{8,25}$/)
            .optional()
            .meta({ description: 'Si falta, Iris usa el de la ficha' }),
    }),
)

// ── Contactos ────────────────────────────────────────────────────────────────────────────────

const telefonoContacto = () =>
    vine.object({
        numero: vine.string().trim().minLength(8).maxLength(25).meta({
            description: 'E.164 (`+50255123344`) u 8 dígitos de Guatemala; se guarda en E.164',
        }),
        whatsapp: vine.boolean().optional(),
        principal: vine.boolean().optional().meta({ description: 'Exactamente uno por contacto' }),
    })

const permisosContacto = () =>
    vine
        .object({
            consultar: vine.boolean().optional(),
            reportar: vine.boolean().optional(),
            pagar: vine.boolean().optional(),
            avisos: vine.boolean().optional(),
        })
        .optional()
        .meta({ description: 'Los que no vienen, encendidos (al crear) o sin cambio (al editar)' })

const serviciosContacto = () =>
    vine.array(idEntidad()).minLength(1).maxLength(50).nullable().optional().meta({
        description: 'Servicios de tu cuenta a los que aplica; null o ausente = todos',
    })

const RELACIONES = ['familiar', 'inquilino', 'empleado', 'otro'] as const

export const agregarContactoValidator = vine.compile(
    vine.object({
        nombre: vine.string().trim().minLength(2).maxLength(200),
        relacion: vine.enum(RELACIONES),
        servicios: serviciosContacto(),
        permisos: permisosContacto(),
        telefonos: vine.array(telefonoContacto()).minLength(1).maxLength(5),
    }),
)

export const cambiarContactoValidator = vine.compile(
    vine.object({
        version: versionEsperada(),
        nombre: vine.string().trim().minLength(2).maxLength(200).optional(),
        relacion: vine.enum(RELACIONES).optional(),
        servicios: serviciosContacto(),
        permisos: permisosContacto(),
        telefonos: vine.array(telefonoContacto()).minLength(1).maxLength(5).optional(),
    }),
)

export const quitarContactoValidator = vine.compile(vine.object({ version: versionEsperada() }))
