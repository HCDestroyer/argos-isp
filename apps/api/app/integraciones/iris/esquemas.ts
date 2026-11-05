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
    objeto(
        {
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
            contrato: {
                ...nulable(texto),
                description:
                    'Versión del contrato que informó Iris (canje o `PUT /integraciones/iris/contrato`); null si nunca ' +
                    '(un Iris anterior a 0.5.0: no recibe los webhooks nuevos de 0.5.0)',
            },
            requiere_reconectar: {
                type: 'boolean',
                description:
                    'true solo si el último `receptor_argos` que informó Iris (canje o `PUT /integraciones/iris/contrato`) ' +
                    'es false: un conector canjeado antes de B1 que no guardó el receptor de Argos. Null o true: false ' +
                    '(contrato Iris 0.6.2)',
            },
            motivo_reconectar: {
                ...nulable(texto),
                description: 'Por qué hay que volver a conectar Iris; null si `requiere_reconectar` es false',
            },
            estado_canje: {
                type: ['string', 'null'],
                enum: ['pendiente', 'confirmado', 'desconectado', null],
                description:
                    'Contrato Iris 0.6.3. `pendiente`: Iris aún no usó el `atk_` del último canje (vence en ' +
                    '`canje_vence_en`: el token se revoca y el conector se desconecta); `confirmado`: ya lo usó; ' +
                    '`desconectado`: Iris revocó el token o el canje venció sin uso (ver `motivo_desconexion`); ' +
                    'null: el conector no se preparó con un enlace',
            },
            canje_vence_en: {
                ...nulable(instante),
                description:
                    'Cuándo vence un canje `pendiente` sin uso (24 h después del canje); null en otro estado',
            },
            desconectado_en: nulable(instante),
            motivo_desconexion: {
                type: ['string', 'null'],
                enum: ['revocado_por_iris', 'canje_sin_uso', null],
                description:
                    '`revocado_por_iris`: Iris revocó su token (`POST /integraciones/iris/conexion/revocar`); ' +
                    '`canje_sin_uso`: nadie usó el token del canje en 24 h. Volver a conectar es otro canje',
            },
            reconexion_pendiente_desde: {
                ...nulable(instante),
                description:
                    'Contrato Iris 0.6.3: cuándo se canjeó un enlace nuevo sobre este conector en uso. Hasta su ' +
                    'primera llamada autenticada, el conector sigue con el canje anterior (su `atk_`, URL y ' +
                    'secretos); al confirmarse se aplica y se revoca el `atk_` anterior. null si no hay',
            },
            reconexion_vence_en: {
                ...nulable(instante),
                description:
                    'Cuándo se descarta la reconexión pendiente si nadie la usa (24 h); el conector anterior ' +
                    'sigue igual. null si no hay',
            },
            version: { type: 'integer', minimum: 0 },
        },
        [
            'estado_canje',
            'canje_vence_en',
            'desconectado_en',
            'motivo_desconexion',
            'reconexion_pendiente_desde',
            'reconexion_vence_en',
        ],
    ),
)

/** `version_argos` y `contrato`: canje y estado (contrato Iris 0.5.0, «Versión y compatibilidad»). */
const versiones = {
    version_argos: {
        ...texto,
        description:
            'Versión instalada de Argos (`ARGOSISP_VERSION` de la imagen, p. ej. `1.6.0`; `desarrollo` fuera de ' +
            'una imagen publicada). La misma de `GET /version` (contrato Iris 0.5.0)',
    },
    contrato: {
        ...texto,
        description: 'Versión del contrato Iris ↔ Argos que habla este Argos, p. ej. `0.5.0`',
    },
}

export const EstadoConectorIris = definirEsquema(
    'EstadoConectorIris',
    objeto({ activo: { type: 'boolean', description: 'Si "Ver en Iris" puede funcionar' }, ...versiones }),
)

export const ContratoConectorIris = definirEsquema(
    'ContratoConectorIris',
    objeto({
        contrato_iris: {
            ...texto,
            description: 'Versión del contrato que habla Iris, tal como quedó guardada en el conector',
        },
        ...versiones,
    }),
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
        ...versiones,
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

/** Respuesta de `POST /integraciones/iris/verificar-identidad` (contrato Iris 0.6.0 §7.5). */
export const VerificacionIdentidad = definirEsquema(
    'VerificacionIdentidad',
    objeto({
        coincide: {
            type: 'boolean',
            description:
                'Si lo que dijo el cliente coincide con lo que tiene Argos. Nunca se devuelve el dato',
        },
    }),
)
