import {
    booleano,
    definirEsquema,
    id,
    instante,
    lista,
    nulable,
    objeto,
    texto,
} from '#shared/openapi/esquemas'

/** Schemas de respuesta del conector Iris (`contratos/iris.md` §1). */

const secreto = {
    type: ['string', 'null'],
    enum: ['***', null],
    description: 'Secreto de solo escritura: `***` si está guardado, null si no',
}

export const ConectorIris = definirEsquema(
    'ConectorIris',
    objeto({
        activo: { type: 'boolean', description: 'Apagado por defecto; encender exige URL y token' },
        url_base: { ...nulable(texto), description: 'Origen de la API de Iris' },
        token: secreto,
        webhook_salida_url: {
            ...nulable(texto),
            description: 'Receptor de Iris (webhooks Argos → Iris, §2.3)',
        },
        webhook_salida_secreto: secreto,
        webhook_entrada_url: {
            ...nulable(texto),
            description:
                'Receptor de Argos para webhooks de Iris (reservado: responde 501 hasta que el contrato los defina)',
        },
        webhook_entrada_secreto: secreto,
        conector_id: {
            ...nulable(texto),
            description: 'Id opaco del conector en Argos (respuesta del canje)',
        },
        conectado_por_enlace_en: nulable(instante),
        token_argos_id: { ...nulable(id), description: 'Token atk_ entregado a Iris en el último canje' },
        version: { type: 'integer', minimum: 0 },
    }),
)

export const EstadoConectorIris = definirEsquema(
    'EstadoConectorIris',
    objeto({ activo: { type: 'boolean', description: 'Si "Ver en Iris" puede funcionar' } }),
)

export const EnlaceConexionIris = definirEsquema(
    'EnlaceConexionIris',
    objeto({
        enlace: { ...texto, description: '`https://<argos>/conectar#<codigo>`: se muestra una sola vez' },
        vence_en: instante,
    }),
)

/** `alcance_global` y `empresas[]`: canje del enlace y vista previa de la autorización. */
const alcanceEmpresas = {
    alcance_global: {
        ...booleano,
        description:
            'true: el usuario técnico Iris ve todas las empresas activas, también las que se creen después; ' +
            'false: solo las de `empresas` (contrato Iris 0.3.1)',
    },
    empresas: {
        ...lista(
            objeto({
                id,
                nombre: { ...texto, description: 'Nombre comercial' },
                nit: {
                    ...nulable(texto),
                    description: 'NIT sin guiones; null si la empresa aún no lo tiene',
                },
            }),
        ),
        description:
            'Empresas activas del alcance del token al canjear, en orden de id (contrato Iris 0.3.1)',
    },
}

export const CanjeConexionIris = definirEsquema(
    'CanjeConexionIris',
    objeto({
        token: { ...texto, description: 'Token `atk_` del usuario técnico Iris (§1.1)' },
        webhook: objeto({ url: texto, secreto: texto }),
        conector_id: texto,
        ...alcanceEmpresas,
        panel_url: {
            ...texto,
            description:
                'URL pública del panel de Argos (`PANEL_URL_PUBLICA`): «Ver en Argos» y volver a autorizar (contrato Iris 0.4.0)',
        },
    }),
)

export const TicketIris = definirEsquema(
    'TicketIris',
    objeto({
        url: { ...texto, description: 'URL de Iris con el ticket (un solo uso, 60 s); el panel la abre' },
        expira_en: nulable(instante),
    }),
)

export const AutorizacionIris = definirEsquema(
    'AutorizacionIris',
    objeto({
        redirigir_a: {
            ...texto,
            description:
                '`<iris>/administracion/integraciones/argos/vuelta#codigo=…&api=…&state=…` (todo en el fragmento): ' +
                'el panel navega ahí. El código vale 15 min y un solo uso',
        },
    }),
)

export const VistaPreviaAutorizacionIris = definirEsquema(
    'VistaPreviaAutorizacionIris',
    objeto({
        origen_normalizado: { ...texto, description: '`https://host[:puerto]` de Iris' },
        origen_conocido: {
            ...booleano,
            description:
                'true: es el del conector Iris o está en `ARGOSISP_IRIS_ORIGENES`; false: el admin debe escribir el dominio para confirmar',
        },
        ...alcanceEmpresas,
    }),
)
