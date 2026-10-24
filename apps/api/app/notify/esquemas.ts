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
        estado: enumerado(['encolado', 'enviado', 'fallido', 'omitido']),
        error: nulable(texto),
        motivo: {
            ...nulable(texto),
            description: 'Por qué quedó `omitido` (canal o tipo de aviso apagado en la configuración)',
        },
        empresa_id: { ...nulable(id), description: 'Empresa cuya configuración se aplicó (null = global)' },
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

const secreto = {
    type: ['string', 'null'],
    enum: ['***', null],
    description: '`***` si hay uno guardado, null si no. Nunca se devuelve el valor',
}

export const ConfiguracionNotificaciones = definirEsquema(
    'ConfiguracionNotificaciones',
    objeto({
        id: { ...nulable(id), description: 'null: todavía no hay configuración guardada' },
        empresa_id: { ...nulable(id), description: 'null: configuración global' },
        hereda: {
            type: 'boolean',
            description: 'Solo empresas: usa la configuración global. La global siempre es false',
        },
        origen: {
            ...enumerado(['guardada', 'entorno', 'sin_configurar']),
            description:
                '`guardada`: fila del panel. `entorno`: global sin guardar, rigen las variables de entorno. `sin_configurar`: empresa sin fila (hereda la global)',
        },
        sembrada_desde_entorno: booleano,
        correo: objeto({
            activo: booleano,
            host: nulable(texto),
            puerto: nulable(entero),
            tls: enumerado(['auto', 'starttls', 'tls', 'ninguno']),
            usuario: nulable(texto),
            password: secreto,
            remitente: nulable(texto),
            nombre_visible: nulable(texto),
            contabilidad: {
                ...nulable(texto),
                description:
                    'Correo de contabilidad para los avisos fiscales (integridad del libro, DTE rechazado, contingencia FEL, nota de crédito anulada, libro y cierres); direcciones separadas por coma',
            },
        }),
        telegram: objeto({
            clientes_activo: booleano,
            alertas_activo: booleano,
            token: secreto,
            bot_id: { ...nulable(texto), description: 'Id público del bot (parte numérica del token)' },
            bot_nombre: nulable(texto),
            chat_equipo: nulable(texto),
            webhook_secreto: secreto,
            webhook_ruta: {
                ...nulable(texto),
                description: 'Ruta del webhook de este bot: `/api/v1/telegram/webhook/<bot_id>`',
            },
        }),
        avisos: objeto({
            factura: booleano,
            vencimiento: booleano,
            recordatorio: booleano,
            corte: booleano,
            pago: booleano,
            promesa: booleano,
            comprobante: booleano,
            lealtad: booleano,
        }),
        version: {
            type: 'integer',
            minimum: 0,
            description: 'Control optimista: envíala al guardar (0 = sin guardar)',
        },
        created_at: nulable(instante),
        updated_at: nulable(instante),
    }),
)

export const ResultadoPruebaCanal = definirEsquema(
    'ResultadoPruebaCanal',
    objeto({
        estado: enumerado(['enviado', 'fallido']),
        error: { ...nulable(texto), description: 'Error real del servidor SMTP o de la Bot API' },
        destino: texto,
        origen: {
            ...enumerado(['global', 'empresa', 'entorno']),
            description: 'Configuración con la que se probó',
        },
        envio_id: id,
    }),
)

const variableCatalogo = objeto({
    nombre: { type: 'string', description: 'Nombre completo para Mustache: `factura.total_q`' },
    tipo: enumerado(['texto', 'numero', 'booleano']),
    ejemplo: { type: 'string', description: 'Valor de ejemplo (el de la vista previa), como texto' },
})

export const EventoNotificacion = definirEsquema(
    'EventoNotificacion',
    objeto({
        evento: {
            type: 'string',
            description: 'Evento de la plantilla (`factura.emitida`, `recordatorio.1`, `alerta.…`)',
        },
        nombre: { type: 'string', description: 'Nombre legible en español' },
        grupo: enumerado(['cliente', 'recordatorio', 'alerta']),
        tipo_aviso: {
            ...nulable(texto),
            description:
                'Interruptor de `avisos` de la configuración que lo apaga; null = no se apaga por tipo',
        },
        canales: { type: 'array', items: canal, description: 'Canales con plantilla de fábrica' },
        variables: {
            type: 'array',
            description:
                'Variables Mustache por grupo, las mismas que arma el aviso real. En las alertas, `alerta.*` sale de sus plantillas de fábrica y el ejemplo es el nombre',
            items: objeto({
                grupo: { type: 'string', description: 'Primer nivel: `empresa`, `factura`, `alerta`…' },
                etiqueta: texto,
                variables: { type: 'array', items: variableCatalogo },
            }),
        },
    }),
)

export const VistaPreviaPlantilla = definirEsquema(
    'VistaPreviaPlantilla',
    objeto({
        evento: texto,
        canal,
        asunto: nulable(texto),
        cuerpo: texto,
        mensaje: {
            type: 'string',
            description:
                'Lo que recibe el destinatario: en Telegram, asunto y cuerpo en un solo texto (máx. 4096)',
        },
        variables_desconocidas: {
            type: 'array',
            items: texto,
            description: 'Variables que la plantilla usa y el evento no trae: se renderizan vacías',
        },
    }),
)
