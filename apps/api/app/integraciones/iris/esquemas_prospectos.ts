import {
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

/** Vínculo de un prospecto registrado desde Argos en Iris (contrato Iris 0.10.0 §3.6, A44). */
export const ProspectoIris = definirEsquema(
    'ProspectoIris',
    objeto({
        id,
        empresa_id: id,
        cliente_id: nulable(id),
        registrado_por: nulable(id),
        origen: enumerado(['oficina', 'llamada', 'whatsapp', 'referido', 'otro']),
        telefonos: { ...entero, description: 'Cuántos números se enviaron (los números no se guardan)' },
        entrega: {
            ...enumerado(['pendiente', 'enviado', 'duplicado', 'rechazado', 'fallido']),
            description:
                'pendiente: en la cola hacia Iris; duplicado: ya había un prospecto abierto con uno de los números (Iris sumó el pedido como actividad); rechazado: 422 de Iris (codigo_error)',
        },
        intentos: entero,
        ultimo_error: nulable(texto),
        codigo_error: {
            ...nulable(texto),
            description: 'plan_no_permitido, telefonos_invalidos, cliente_no_valido, prospecto_duplicado…',
        },
        prospecto_id: nulable(texto),
        numero: nulable(texto),
        estado_iris: {
            ...nulable(texto),
            description: 'Último estado informado por Iris (prospecto.estado_cambiado)',
        },
        motivo_iris: nulable(texto),
        asignado: { ...nulable(booleano), description: 'Ya tiene vendedor en Iris' },
        url_iris: {
            ...nulable(texto),
            description: 'Enlace plano al prospecto en Iris (el autologin se pide al abrirlo)',
        },
        enviado_en: nulable(instante),
        estado_cambiado_en: nulable(instante),
        created_at: instante,
    }),
)

export const DisponibilidadProspectosIris = definirEsquema(
    'DisponibilidadProspectosIris',
    objeto({ disponible: booleano, motivo: nulable(texto) }),
)
