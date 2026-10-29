import vine from '@vinejs/vine'
import db from '@adonisjs/lucid/services/db'
import { paginar, reglasPaginacion, type OpcionesPaginacion } from '#shared/paginacion'
import {
    booleano,
    definirEsquema,
    entero,
    enumerado,
    id,
    instante,
    lista,
    nulable,
    objeto,
    texto,
} from '#shared/openapi/esquemas'
import { TABLA_ENVIOS_IRIS, alcanceConectorIris } from '#integraciones/iris/envios'
import { destinoWebhooksIris } from '#integraciones/iris/configuracion'

/**
 * Panel de los webhooks Argos → Iris (A6): lista de envíos con su estado y un resumen para la
 * pantalla del conector (pendientes, fallidos y el último error). Así un receptor caído o mal
 * configurado se ve sin leer logs, igual que `GET /integraciones/horus/envios`.
 */

const ESTADOS = ['pendiente', 'enviado', 'fallido', 'descartado'] as const

export const listarEnviosIrisValidator = vine.compile(
    vine.object({
        ...reglasPaginacion,
        estado: vine.enum(ESTADOS).optional(),
        evento: vine.string().trim().maxLength(100).optional(),
    }),
)

export const EnvioIris = definirEsquema(
    'EnvioIris',
    objeto({
        id,
        evento_id: { ...texto, description: '`id` del webhook (`argos-evt-<id>`, estable entre reintentos)' },
        evento: texto,
        empresa_id: nulable(id),
        estado: enumerado([...ESTADOS]),
        intentos: entero,
        proximo_intento_en: nulable(instante),
        ultimo_status: nulable(entero),
        ultimo_error: nulable(texto),
        enviado_en: nulable(instante),
        created_at: instante,
        updated_at: instante,
    }),
)

export const ResumenEnviosIris = definirEsquema(
    'ResumenEnviosIris',
    objeto({
        destino_configurado: {
            ...booleano,
            description: 'Conector activo con URL y secreto del receptor de Iris; sin él no se envía nada',
        },
        alcance: {
            ...nulable(
                objeto({
                    global: booleano,
                    empresas: lista(id),
                }),
            ),
            description:
                'Empresas del usuario técnico «Iris» cuyos eventos se envían; null sin usuario técnico activo (no se envía nada)',
        },
        pendientes: entero,
        fallidos: entero,
        ultimo_enviado_en: nulable(instante),
        ultimo_fallo: nulable(
            objeto({
                evento_id: texto,
                evento: texto,
                estado: enumerado(['pendiente', 'fallido']),
                intentos: entero,
                ultimo_error: nulable(texto),
                en: instante,
            }),
        ),
    }),
)

function porEmpresa<Q extends { where: (...a: any[]) => Q }>(consulta: Q, empresas: number[] | null): Q {
    if (empresas === null) return consulta
    return consulta.where((q: any) => q.whereIn('empresa_id', empresas).orWhereNull('empresa_id'))
}

export async function listarEnviosIris(
    filtros: OpcionesPaginacion & { estado?: string; evento?: string },
    empresas: number[] | null,
) {
    const consulta = db
        .from(TABLA_ENVIOS_IRIS)
        .select(
            'id',
            'evento_id',
            'evento',
            'empresa_id',
            'estado',
            'intentos',
            'proximo_intento_en',
            'ultimo_status',
            'ultimo_error',
            'enviado_en',
            'created_at',
            'updated_at',
        )
        .if(filtros.estado, (q) => q.where('estado', filtros.estado!))
        .if(filtros.evento, (q) => q.where('evento', filtros.evento!))
    return paginar(porEmpresa(consulta, empresas), filtros)
}

function iso(valor: Date | string | null | undefined): string | null {
    if (!valor) return null
    return (valor instanceof Date ? valor : new Date(valor)).toISOString()
}

export async function resumenEnviosIris(empresas: number[] | null) {
    const conteo = (await porEmpresa(db.from(TABLA_ENVIOS_IRIS), empresas)
        .select(
            db.raw(`count(*) FILTER (WHERE estado = 'pendiente')::int AS pendientes`),
            db.raw(`count(*) FILTER (WHERE estado = 'fallido')::int AS fallidos`),
            db.raw(`max(enviado_en) AS ultimo_enviado_en`),
        )
        .first()) as { pendientes: number; fallidos: number; ultimo_enviado_en: Date | null }
    // Último envío con error: un fallido o un pendiente que ya falló al menos una vez
    const fallo = (await porEmpresa(db.from(TABLA_ENVIOS_IRIS), empresas)
        .whereIn('estado', ['pendiente', 'fallido'])
        .whereNotNull('ultimo_error')
        .orderBy('updated_at', 'desc')
        .orderBy('id', 'desc')
        .select('evento_id', 'evento', 'estado', 'intentos', 'ultimo_error', 'updated_at')
        .first()) as {
        evento_id: string
        evento: string
        estado: 'pendiente' | 'fallido'
        intentos: number
        ultimo_error: string | null
        updated_at: Date
    } | null
    return {
        destino_configurado: (await destinoWebhooksIris()) !== null,
        alcance: await alcanceConectorIris(),
        pendientes: Number(conteo.pendientes),
        fallidos: Number(conteo.fallidos),
        ultimo_enviado_en: iso(conteo.ultimo_enviado_en),
        ultimo_fallo: fallo
            ? {
                  evento_id: fallo.evento_id,
                  evento: fallo.evento,
                  estado: fallo.estado,
                  intentos: Number(fallo.intentos),
                  ultimo_error: fallo.ultimo_error,
                  en: iso(fallo.updated_at)!,
              }
            : null,
    }
}
