import {
    booleano,
    definirEsquema,
    entero,
    enumerado,
    fecha,
    id,
    instante,
    jsonLibre,
    lista,
    nulable,
    objeto,
    texto,
} from '#shared/openapi/esquemas'
import { TIPOS_BLOQUEO, TIPOS_EXCEPCION } from '#ledger/bloqueos'
import { TIPOS_CHECK } from '#ledger/checks'

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

export const CheckCierre = definirEsquema(
    'CheckCierre',
    objeto({
        id,
        empresa_id: id,
        tipo: enumerado(TIPOS_CHECK),
        periodo: { ...fecha, description: 'Primer día del mes (o del año en los anuales)' },
        clave: texto,
        titulo: texto,
        aviso: { ...booleano, description: 'Un aviso nunca bloquea el cierre' },
        automatico: { ...booleano, description: 'false = fila de una revisión (supervisión) a mano' },
        esperado: nulable(texto),
        obtenido: nulable(texto),
        resultado: enumerado(['ok', 'anomalia']),
        estado: enumerado(['revisado', 'anomalia', 'supervisado']),
        nota: nulable(texto),
        detalle: {
            ...nulable(jsonLibre),
            description: 'Datos del cálculo (conteos, cuentas, diarios con huecos…)',
        },
        revisado_por: nulable(id),
        revisado_por_nombre: nulable(texto),
        created_at: instante,
    }),
)

export const ChecksCierre = definirEsquema(
    'ChecksCierre',
    objeto(
        {
            empresa_id: id,
            tipo: enumerado(TIPOS_CHECK),
            periodo: { ...texto, description: 'AAAA-MM o AAAA' },
            checks: {
                ...lista(CheckCierre),
                description: 'Última fila de cada clave, en el orden del catálogo',
            },
            sin_verificar: {
                ...lista(objeto({ clave: texto, titulo: texto })),
                description: 'Checks del catálogo que aún no tienen fila (falta verificar)',
            },
            pasan: {
                ...booleano,
                description: 'true si todos están en ok o supervisados (el cierre no se bloquea)',
            },
            historial: {
                ...lista(CheckCierre),
                description: 'Con historial=true: todas las filas, la más reciente primero',
            },
        },
        ['historial'],
    ),
)

export const VerificacionCierre = definirEsquema(
    'VerificacionCierre',
    objeto({
        empresa_id: id,
        tipo: enumerado(TIPOS_CHECK),
        periodo: texto,
        checks: lista(CheckCierre),
        anomalias: { ...lista(texto), description: 'Claves en anomalía sin supervisar' },
    }),
)
