import {
    auditable,
    booleano,
    definirEsquema,
    entero,
    enumerado,
    id,
    instante,
    nulable,
    objeto,
    texto,
} from '#shared/openapi/esquemas'

/**
 * Schemas de respuesta del módulo notify.
 */

const canal = enumerado(['correo', 'telegram', 'whatsapp'])

export const PlantillaNotificacion = definirEsquema(
    'PlantillaNotificacion',
    objeto({
        id,
        evento: { type: 'string', description: 'Evento del catálogo o `recordatorio.N`' },
        canal,
        asunto: nulable(texto),
        cuerpo: { type: 'string', description: 'Mustache, texto plano' },
        activa: booleano,
        ...auditable,
    }),
)

export const EnvioNotificacion = definirEsquema(
    'EnvioNotificacion',
    objeto({
        id,
        cliente_id: nulable(id),
        origen: { type: 'string', description: '`outbox:<id>`, `recordatorio:<n>:factura:<id>`…' },
        evento: texto,
        canal,
        destino: texto,
        asunto: nulable(texto),
        cuerpo: nulable(texto),
        estado: enumerado(['encolado', 'enviado', 'fallido']),
        error: nulable(texto),
        intentos: entero,
        proveedor_id: nulable(texto),
        fallback_de: nulable(id),
        enviado_en: nulable(instante),
        created_at: instante,
        updated_at: instante,
    }),
)

export const RecordatorioPago = definirEsquema(
    'RecordatorioPago',
    objeto({
        id,
        orden: { type: 'integer', minimum: 1, maximum: 3, description: 'Plantilla `recordatorio.<orden>`' },
        dias: { type: 'integer', description: 'Días respecto al vencimiento (negativo = antes)' },
        hora: { type: 'string', description: 'HH:MM:SS hora de Guatemala' },
        activo: booleano,
        ...auditable,
    }),
)

export const TelegramWebhookRespuesta = definirEsquema('TelegramWebhookRespuesta', objeto({ ok: booleano }))
