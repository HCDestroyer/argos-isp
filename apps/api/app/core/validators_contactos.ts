import vine from '@vinejs/vine'
import { idEntidad, versionEsperada } from '#shared/validadores'
import { RELACIONES_CONTACTO } from '#core/contactos'

/**
 * Validadores de contactos del cliente (contrato Iris 0.10.0 §3.5, A42; 0.10.1 §3.8, A46). Los
 * números se validan y normalizan a E.164 en la acción (`validarTelefonos`): el 422 dice el campo y
 * la regla, nunca repite el número.
 */

const telefono = () =>
    vine.object({
        numero: vine.string().trim().minLength(8).maxLength(25).meta({
            description: 'E.164 (`+50255123344`); también 8 dígitos de Guatemala. Se guarda en E.164',
        }),
        whatsapp: vine.boolean().optional(),
        principal: vine.boolean().optional().meta({
            description: 'Exactamente uno por contacto (con un solo número, ese es el principal)',
        }),
    })

const permisos = () =>
    vine
        .object({
            consultar: vine.boolean().optional(),
            reportar: vine.boolean().optional(),
            pagar: vine.boolean().optional(),
            avisos: vine.boolean().optional(),
        })
        .optional()
        .meta({
            description:
                'consultar (saldo, estado, facturas), reportar (tickets), pagar (comprobantes y promesas), avisos (avisos de cobro). Los que no vienen, encendidos',
        })

const servicios = () =>
    vine.array(idEntidad()).minLength(1).maxLength(50).nullable().optional().meta({
        description: 'Servicios del cliente a los que aplica; null o ausente = todos',
    })

const personaCliente = () =>
    idEntidad().nullable().optional().meta({
        description:
            'Otro cliente de la misma empresa que es esta persona (A46). Desde Iris solo se vincula si un número del contacto es el teléfono verificado de ese cliente; si no, queda suelto',
    })

export const crearContactoValidator = vine.compile(
    vine.object({
        nombre: vine.string().trim().minLength(2).maxLength(200),
        relacion: vine.enum(RELACIONES_CONTACTO).meta({
            description:
                '`titular` no se admite (422 contacto_titular_no_permitido): el titular es el cliente',
        }),
        servicios: servicios(),
        permisos: permisos(),
        telefonos: vine.array(telefono()).minLength(1).maxLength(5),
        persona_cliente_id: personaCliente(),
    }),
)

export const editarContactoValidator = vine.compile(
    vine.object({
        version: versionEsperada(),
        nombre: vine.string().trim().minLength(2).maxLength(200).optional(),
        relacion: vine.enum(RELACIONES_CONTACTO).optional(),
        servicios: servicios(),
        permisos: permisos(),
        telefonos: vine.array(telefono()).maxLength(5).optional().meta({
            description:
                'Reemplaza la lista completa. En el contacto titular, solo números adicionales (hasta 4, sin principal)',
        }),
        persona_cliente_id: personaCliente(),
    }),
)

export const quitarContactoValidator = vine.compile(vine.object({ version: versionEsperada() }))

export const buscarContactosValidator = vine.compile(
    vine.object({
        telefono: vine.string().trim().minLength(8).maxLength(25).meta({
            description: 'Número en E.164 (`+50255123344`)',
        }),
    }),
)

export const telefonosAdicionales = () =>
    vine
        .array(
            vine.object({
                numero: vine.string().trim().minLength(8).maxLength(25).meta({ description: 'E.164' }),
                whatsapp: vine.boolean().optional(),
            }),
        )
        .maxLength(4)
        .optional()
        .meta({
            description:
                'Números adicionales del titular (contrato Iris 0.10.0 §3.2, hasta 4, E.164): van a su contacto titular y no cuentan como registrados',
        })
