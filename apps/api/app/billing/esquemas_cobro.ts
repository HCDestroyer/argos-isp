import {
    booleano,
    definirEsquema,
    enumerado,
    id,
    instante,
    nulable,
    objeto,
    texto,
} from '#shared/openapi/esquemas'
import { ORIGENES_GESTION, RESULTADOS_GESTION, TIPOS_GESTION } from '#billing/gestiones_cobro'

/**
 * Schemas de respuesta de las decisiones del PM del 21 nov (operación de cobro, A3).
 */

const camposGestion = {
    id,
    gestion_id: { ...id, description: 'Alias de id (contrato Iris 0.13.0)' },
    empresa_id: id,
    cliente_id: id,
    servicio_id: nulable(id),
    contacto_id: {
        ...nulable(id),
        description: 'Contacto con quien se habló (X-Iris-Contacto); null = el titular',
    },
    tipo: enumerado(TIPOS_GESTION),
    resultado: enumerado(RESULTADOS_GESTION),
    ocurrido_en: instante,
    origen_tipo: enumerado(ORIGENES_GESTION),
    origen_id: nulable(texto),
    sistema_origen: {
        ...nulable(enumerado(['iris'])),
        description: 'iris si la registró Iris; null desde el panel',
    },
    iris_gestion_id: { ...nulable(texto), description: 'UUID v7 de Iris (de Idempotency-Key)' },
    iris_actor: nulable(texto),
    nota: nulable(texto),
    tiene_adjunto: booleano,
    adjunto_tipo: nulable(texto),
    registrado_por: nulable(id),
    registrado_por_nombre: nulable(texto),
    created_at: instante,
}

export const GestionCobro = definirEsquema('GestionCobro', objeto(camposGestion))

export const GestionCobroRegistrada = definirEsquema(
    'GestionCobroRegistrada',
    objeto({
        ...camposGestion,
        repetida: {
            ...booleano,
            description:
                'true si Iris repitió la misma gestión (mismo iris_gestion_id y datos): no se duplicó',
        },
    }),
)
