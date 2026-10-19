import {
    definirEsquema,
    entero,
    enumerado,
    fecha,
    id,
    instante,
    lista,
    nulable,
    objeto,
    texto,
} from '#shared/openapi/esquemas'
import { TIPOS_BLOQUEO, TIPOS_EXCEPCION } from '#ledger/bloqueos'

/**
 * Schemas de bloqueos del libro y sus excepciones (contrato de localización fiscal §10.4, fase 6).
 */

export const BloqueoLibro = definirEsquema(
    'BloqueoLibro',
    objeto({
        id,
        empresa_id: id,
        tipo: enumerado(TIPOS_BLOQUEO),
        hasta: {
            ...nulable(fecha),
            description: 'Nada se registra con fecha ≤ hasta bajo este tipo; null = sin bloqueo de ese tipo',
        },
        anterior: { ...nulable(fecha), description: 'Bloqueo vigente de ese tipo antes de esta fila' },
        motivo: texto,
        creado_por: nulable(id),
        creado_por_nombre: nulable(texto),
        created_at: instante,
    }),
)

const vigentes = objeto(
    Object.fromEntries(
        TIPOS_BLOQUEO.map((t) => [t, { ...nulable(fecha), description: `Bloqueo ${t} vigente` }]),
    ),
)

export const BloqueosEmpresa = definirEsquema(
    'BloqueosEmpresa',
    objeto({
        empresa_id: id,
        vigentes: { ...vigentes, description: 'hasta vigente de cada tipo (null = sin bloqueo)' },
        ultimos: { ...lista(BloqueoLibro), description: 'Última fila de cada tipo que tiene alguna' },
    }),
)

export const ExcepcionBloqueo = definirEsquema(
    'ExcepcionBloqueo',
    objeto({
        id,
        empresa_id: id,
        tipo: enumerado(TIPOS_EXCEPCION),
        usuario_id: { ...nulable(id), description: 'null = todos los usuarios' },
        usuario_nombre: nulable(texto),
        motivo: texto,
        hasta_en: instante,
        estado: enumerado(['vigente', 'vencida', 'revocada']),
        creada_por: nulable(id),
        creada_por_nombre: nulable(texto),
        created_at: instante,
        revocada_en: nulable(instante),
        revocada_por: nulable(id),
        motivo_revocacion: nulable(texto),
        asientos: { ...entero, description: 'Asientos que entraron por esta excepción' },
    }),
)
