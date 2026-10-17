import {
    booleano,
    definirEsquema,
    entero,
    enumerado,
    id,
    instante,
    jsonLibre,
    lista,
    nulable,
    objeto,
    texto,
} from '#shared/openapi/esquemas'

/**
 * Schemas de respuesta del conector Horus (A6, `contratos/horus.md`).
 */

const secreto = {
    type: ['string', 'null'],
    enum: ['***', null],
    description: '`***` si hay uno guardado, null si no. Nunca se devuelve el valor',
}

const conectorPropiedades = {
    activo: { ...booleano, description: 'Apagado por defecto: sin él no hay llamadas ni webhooks' },
    url_base: { ...nulable(texto), description: 'URL base de Horus (https), sin `/api/v1`' },
    token: { ...secreto, description: 'Código de conexión `hf_pat_` de Horus (`***`)' },
    webhook_salida_url: { ...nulable(texto), description: 'Receptor de Horus (lo genera Horus)' },
    webhook_salida_secreto: { ...secreto, description: 'Secreto del receptor de Horus (`***`)' },
    webhook_entrada_url: {
        ...nulable(texto),
        description:
            'URL del receptor de Argos para pegar en Horus (null si la API no conoce su URL pública)',
    },
    webhook_entrada_ruta: { ...texto, description: 'Ruta del receptor de Argos' },
    webhook_entrada_secreto: { ...secreto, description: 'Secreto del receptor de Argos (`***`)' },
    conector_id: { ...nulable(texto), description: 'Id opaco del conector en Argos (§1.4)' },
    conectado_por_enlace_en: { ...nulable(instante), description: 'Último canje de un enlace de conexión' },
    ultima_prueba: objeto({ en: nulable(instante), ok: nulable(booleano), error: nulable(texto) }),
    salud: objeto({
        fallos_seguidos: entero,
        pausa_hasta: {
            ...nulable(instante),
            description: 'Sin llamadas a Horus hasta este instante (espera exponencial, máx. 15 min)',
        },
        ultimo_error: nulable(texto),
        ultimo_error_en: nulable(instante),
        ultimo_exito_en: nulable(instante),
    }),
    errores_cifrado: {
        ...lista(texto),
        description: 'Secretos que no se pudieron descifrar (cambió la clave)',
    },
    version: { type: 'integer', minimum: 0, description: '0 = nunca se guardó. Envíala al guardar' },
}

export const ConectorHorus = definirEsquema('ConectorHorus', objeto(conectorPropiedades))

export const ConectorHorusGuardado = definirEsquema(
    'ConectorHorusGuardado',
    objeto({
        ...conectorPropiedades,
        webhook_entrada_secreto_nuevo: {
            ...nulable(texto),
            description:
                'Secreto del receptor de Argos en claro, solo cuando se acaba de generar: copiarlo a Horus',
        },
    }),
)

export const ResultadoPruebaHorus = definirEsquema(
    'ResultadoPruebaHorus',
    objeto({
        ok: booleano,
        probado_en: instante,
        api: objeto({
            ok: booleano,
            status: nulable(entero),
            latencia_ms: nulable(entero),
            error: { ...nulable(texto), description: 'Error real (red, HTTP de Horus)' },
        }),
        webhook: nulable(objeto({ ok: booleano, status: nulable(entero), error: nulable(texto) })),
    }),
)

const conector = enumerado(['activo', 'apagado'])
const lectura = {
    conector,
    stale: { ...booleano, description: 'true = Horus no respondió y se muestra el último dato conocido' },
    actualizado_en: { ...nulable(instante), description: 'Cuándo se obtuvo de Horus el dato mostrado' },
    error: { ...nulable(texto), description: 'Por qué no hay dato fresco' },
}

export const Horus360Servicio = definirEsquema(
    'Horus360Servicio',
    objeto({
        servicio_id: id,
        ...lectura,
        consulta: nulable(enumerado(['external_service_id', 'address'])),
        ip: { ...nulable(texto), description: 'IP actual del servicio en Argos' },
        datos: {
            ...nulable(jsonLibre),
            description:
                'Respuesta de Horus §3.1 tal cual (customer, external, consumption, health, security, meta)',
        },
        eventos_recientes: lista(
            objeto({
                id,
                evento: texto,
                evento_interno: nulable(texto),
                ocurrido_en: nulable(instante),
                recibido_en: instante,
                resumen: nulable(texto),
            }),
        ),
    }),
)

export const ConsumoHorus = definirEsquema(
    'ConsumoHorus',
    objeto({
        ...lectura,
        desde: instante,
        hasta: instante,
        granularidad: enumerado(['day', 'total']),
        items: lista(
            objeto({
                servicio_id: id,
                stale: booleano,
                actualizado_en: nulable(instante),
                error: nulable(texto),
                subida_bytes: nulable(entero),
                bajada_bytes: nulable(entero),
                series: lista(objeto({ dia: texto, subida_bytes: entero, bajada_bytes: entero })),
                direcciones: lista(texto),
            }),
        ),
    }),
)

export const SeguridadHorus = definirEsquema(
    'SeguridadHorus',
    objeto({
        ...lectura,
        modo: {
            ...nulable(enumerado(['lotes', 'alternativa'])),
            description:
                '`alternativa` = Horus aún no tiene §3.5: último dato de la consulta 360 o de los webhooks',
        },
        items: lista(
            objeto({
                servicio_id: id,
                estado: { ...nulable(texto), description: '`clean`, `suspected`, `compromised`' },
                hallazgos_abiertos: nulable(entero),
                severidad_maxima: nulable(texto),
                desde: nulable(instante),
                fuente: nulable(enumerado(['horus', 'consulta_360', 'webhook'])),
                stale: booleano,
                actualizado_en: nulable(instante),
                error: nulable(texto),
            }),
        ),
    }),
)

export const EnvioHorus = definirEsquema(
    'EnvioHorus',
    objeto({
        id,
        evento_id: { ...texto, description: '`id` del webhook (estable entre reintentos)' },
        evento: texto,
        empresa_id: nulable(id),
        estado: enumerado(['pendiente', 'enviado', 'fallido', 'descartado']),
        intentos: entero,
        proximo_intento_en: nulable(instante),
        ultimo_status: nulable(entero),
        ultimo_error: nulable(texto),
        enviado_en: nulable(instante),
        created_at: instante,
        updated_at: instante,
    }),
)

export const WebhookHorusRecibido = definirEsquema(
    'WebhookHorusRecibido',
    objeto({
        id,
        webhook_id: texto,
        evento: texto,
        ocurrido_en: nulable(instante),
        estado: enumerado(['procesado', 'ignorado']),
        evento_interno: nulable(texto),
        empresa_id: nulable(id),
        servicio_id: nulable(id),
        created_at: instante,
    }),
)

export const ResultadoWebhookHorus = definirEsquema(
    'ResultadoWebhookHorus',
    objeto({
        recibido: booleano,
        duplicado: booleano,
        estado: enumerado(['procesado', 'ignorado']),
        evento_interno: nulable(texto),
    }),
)

export const EnlaceConexionHorus = definirEsquema(
    'EnlaceConexionHorus',
    objeto({
        enlace: { ...texto, description: '`https://<argos>/conectar#<codigo>`: se muestra una sola vez' },
        vence_en: instante,
    }),
)

export const CanjeConexionHorus = definirEsquema(
    'CanjeConexionHorus',
    objeto({
        token: { ...texto, description: 'Token `atk_` de Argos para Horus (§1.2)' },
        webhook: objeto({ url: texto, secreto: texto }),
        conector_id: texto,
    }),
)

export const TicketHorus = definirEsquema(
    'TicketHorus',
    objeto({
        url: { ...texto, description: 'URL de Horus con el ticket (un solo uso, 60 s); el panel la abre' },
        expira_en: nulable(instante),
    }),
)
