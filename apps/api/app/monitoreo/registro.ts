import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { ValidacionFallida } from '#shared/errores'
import { LIMITE_POR_DEFECTO } from '#shared/paginacion'
import { colasLegibles, conTimeout, type ColaLegible } from '#monitoreo/salud'

/**
 * Registro del sistema (`GET /api/v1/sistema/registro`, contrato `salud.md` §3): eventos operativos
 * recientes leídos de lo que ya está en la base y en Redis (nunca de archivos de log).
 *
 * Fuentes: errores de `audit.acciones`, comandos fallidos de `audit.red`, eventos operativos del
 * outbox, mediciones de almacenamiento con el disco en aviso y jobs fallidos de BullMQ. Se ordenan
 * por (momento, id) descendente; el cursor guarda la última clave para que la paginación sea estable
 * aunque lleguen filas nuevas.
 */

export const NIVELES = ['error', 'advertencia', 'info'] as const
export const ORIGENES = ['api', 'red', 'radius', 'coa', 'colas', 'contabilidad', 'almacenamiento'] as const
export type Nivel = (typeof NIVELES)[number]
export type Origen = (typeof ORIGENES)[number]

export const DIAS_POR_DEFECTO = 7
export const DIAS_MAXIMOS = 31
export const LIMITE_MAXIMO_REGISTRO = 100

export interface EntradaRegistro {
    id: string
    momento: string
    nivel: Nivel
    origen: Origen
    titulo: string
    detalle: string | null
    entidad: { tipo: string; id: string } | null
    request_id: string | null
}

export interface ConsultaRegistro {
    nivel?: Nivel
    origen?: Origen
    desde?: Date
    cursor?: string
    limit?: number
}

/** Clave de orden: microsegundos desde epoch + id. */
interface Clave {
    us: bigint
    id: string
}

const EVENTOS: Record<string, { origen: Origen; nivel: Nivel }> = {
    'coa.fallido': { origen: 'coa', nivel: 'error' },
    'routeros.fallido': { origen: 'red', nivel: 'error' },
    'aaa.caido': { origen: 'radius', nivel: 'error' },
    'aaa.recuperado': { origen: 'radius', nivel: 'info' },
    'libro.integridad_rota': { origen: 'contabilidad', nivel: 'error' },
    'libro.proceso_bloqueado': { origen: 'contabilidad', nivel: 'advertencia' },
}

/*
|--------------------------------------------------------------------------
| Enmascarado de texto libre
|--------------------------------------------------------------------------
*/

import { enmascararTexto } from '#monitoreo/texto'

export { enmascararTexto }

/*
|--------------------------------------------------------------------------
| Cursor
|--------------------------------------------------------------------------
*/

export function codificarCursorRegistro(clave: Clave): string {
    return Buffer.from(JSON.stringify([clave.us.toString(), clave.id]), 'utf8').toString('base64url')
}

export function decodificarCursorRegistro(cursor: string): Clave {
    try {
        const valor = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown
        if (
            Array.isArray(valor) &&
            typeof valor[0] === 'string' &&
            /^\d{1,19}$/.test(valor[0]) &&
            typeof valor[1] === 'string' &&
            valor[1].length <= 200
        ) {
            return { us: BigInt(valor[0]), id: valor[1] }
        }
    } catch {
        // cae al error de abajo
    }
    throw new ValidacionFallida([{ field: 'cursor', rule: 'cursor', message: 'Cursor inválido' }])
}

/** Orden descendente por (us, id) con comparación de bytes (igual que `COLLATE "C"`). */
function compararDesc(a: Clave, b: Clave): number {
    if (a.us !== b.us) return a.us > b.us ? -1 : 1
    if (a.id === b.id) return 0
    return a.id > b.id ? -1 : 1
}

/*
|--------------------------------------------------------------------------
| Fuentes de la base
|--------------------------------------------------------------------------
*/

interface FilaFuente {
    id: string
    us: string
    momento: Date
    fuente: 'accion' | 'red' | 'evento' | 'almacenamiento'
    nivel: Nivel
    origen: Origen
    ref: string | null
    detalle: string | null
    entidad_tipo: string | null
    entidad_id: string | null
    request_id: string | null
    payload: Record<string, unknown> | null
}

const ORIGEN_ACCION = `CASE
    WHEN accion ~ '^(libro|asientos|cierres|ejercicios|ledger)\\.' THEN 'contabilidad'
    WHEN accion ~ '^(routeros|routers)\\.' THEN 'red'
    WHEN accion ~ '^(aaa|sesiones)\\.' THEN 'radius'
    ELSE 'api' END`

/** UNION de las fuentes de la base, filtrada y ordenada. */
async function filasBase(
    cliente: QueryClientContract,
    desde: Date,
    consulta: ConsultaRegistro,
    cursor: Clave | null,
    limite: number,
): Promise<FilaFuente[]> {
    const eventos = Object.keys(EVENTOS)
    const casoEventoOrigen = `CASE evento ${eventos.map((e) => `WHEN '${e}' THEN '${EVENTOS[e]!.origen}'`).join(' ')} END`
    const casoEventoNivel = `CASE evento ${eventos.map((e) => `WHEN '${e}' THEN '${EVENTOS[e]!.nivel}'`).join(' ')} END`
    const us = (col: string) => `(extract(epoch FROM ${col}) * 1000000)::bigint`

    const filtros: string[] = []
    const valores: Array<string | number | Date | string[]> = [desde, desde, eventos, desde, desde]
    if (consulta.nivel) {
        filtros.push('nivel = ?')
        valores.push(consulta.nivel)
    }
    if (consulta.origen) {
        filtros.push('origen = ?')
        valores.push(consulta.origen)
    }
    if (cursor) {
        filtros.push(`(us < ? OR (us = ? AND id COLLATE "C" < ?))`)
        valores.push(cursor.us.toString(), cursor.us.toString(), cursor.id)
    }
    valores.push(limite)

    const { rows } = (await cliente.rawQuery(
        `SELECT * FROM (
             SELECT 'accion:' || id AS id, ${us('created_at')} AS us, created_at AS momento, 'accion' AS fuente,
                    CASE WHEN error ~ '^E_[A-Z0-9_]+:' THEN 'advertencia' ELSE 'error' END AS nivel,
                    ${ORIGEN_ACCION} AS origen, accion AS ref, error AS detalle,
                    entidad_tipo, entidad_id::text AS entidad_id, request_id, NULL::jsonb AS payload
               FROM audit.acciones
              WHERE resultado = 'error' AND created_at >= ?
             UNION ALL
             SELECT 'red:' || id, ${us('created_at')}, created_at, 'red', 'error',
                    CASE WHEN tipo = 'routeros' THEN 'red' ELSE 'coa' END, tipo,
                    concat_ws(' · ',
                        coalesce(comando->>'operacion', comando->>'metodo'),
                        comando->>'ruta',
                        coalesce(respuesta->>'error', respuesta->>'detail', respuesta->>'message',
                                 respuesta->>'mensaje', respuesta->>'codigo')),
                    CASE WHEN servicio_id IS NOT NULL THEN 'servicio' WHEN router_id IS NOT NULL THEN 'router' END,
                    coalesce(servicio_id, router_id)::text, comando->>'request_id', NULL::jsonb
               FROM audit.red
              WHERE NOT ok AND created_at >= ?
             UNION ALL
             SELECT 'evento:' || id, ${us('created_at')}, created_at, 'evento', ${casoEventoNivel},
                    ${casoEventoOrigen}, evento, NULL, NULL, NULL, request_id, payload
               FROM audit.outbox
              WHERE evento = ANY (?) AND created_at >= ?
             UNION ALL
             SELECT 'almacenamiento:' || id, ${us('calculado_en')}, calculado_en, 'almacenamiento',
                    CASE WHEN estado_disco = 'caido' THEN 'error' ELSE 'advertencia' END,
                    'almacenamiento', estado_disco, porcentaje_disco::text, 'almacenamiento_medicion', id::text,
                    NULL, NULL
               FROM core.almacenamiento_mediciones
              WHERE estado_disco IN ('degradado', 'caido') AND calculado_en >= ?
         ) f
         ${filtros.length ? `WHERE ${filtros.join(' AND ')}` : ''}
         ORDER BY us DESC, id COLLATE "C" DESC
         LIMIT ?`,
        valores,
    )) as { rows: FilaFuente[] }
    return rows
}

function comoTexto(valor: unknown): string | null {
    return typeof valor === 'string' && valor
        ? valor
        : valor === null || valor === undefined
          ? null
          : String(valor)
}

function entradaDeFila(f: FilaFuente): EntradaRegistro {
    const base = {
        id: f.id,
        momento: new Date(f.momento).toISOString(),
        nivel: f.nivel,
        origen: f.origen,
        request_id: f.request_id,
    }
    switch (f.fuente) {
        case 'accion':
            return {
                ...base,
                titulo: `Falló la acción «${f.ref}»`,
                detalle: enmascararTexto(f.detalle),
                entidad: f.entidad_tipo && f.entidad_id ? { tipo: f.entidad_tipo, id: f.entidad_id } : null,
            }
        case 'red':
            return {
                ...base,
                titulo:
                    f.ref === 'coa'
                        ? 'Falló un CoA'
                        : f.ref === 'disconnect'
                          ? 'Falló un Disconnect'
                          : 'El router rechazó un comando o no respondió',
                detalle: enmascararTexto(f.detalle),
                entidad: f.entidad_tipo && f.entidad_id ? { tipo: f.entidad_tipo, id: f.entidad_id } : null,
            }
        case 'almacenamiento':
            return {
                ...base,
                titulo:
                    f.ref === 'caido'
                        ? 'El disco de datos está casi lleno'
                        : 'El disco de datos pasó del 80 % de uso',
                detalle: f.detalle ? `${f.detalle} % usado` : null,
                entidad: { tipo: 'almacenamiento_medicion', id: f.entidad_id ?? '' },
            }
        case 'evento':
        default:
            return { ...base, ...describirEvento(f.ref ?? '', f.payload ?? {}) }
    }
}

function describirEvento(
    evento: string,
    p: Record<string, unknown>,
): Pick<EntradaRegistro, 'titulo' | 'detalle' | 'entidad'> {
    const servicio = p.servicio_id ? { tipo: 'servicio', id: String(p.servicio_id) } : null
    switch (evento) {
        case 'coa.fallido':
            return {
                titulo: `Falló un ${p.tipo === 'disconnect' ? 'Disconnect' : 'CoA'}`,
                detalle: enmascararTexto(
                    [comoTexto(p.nas_ip) && `NAS ${comoTexto(p.nas_ip)}`, comoTexto(p.error)]
                        .filter(Boolean)
                        .join(' · '),
                ),
                entidad: servicio,
            }
        case 'routeros.fallido':
            return {
                titulo: 'Falló una operación en RouterOS',
                detalle: enmascararTexto(
                    [comoTexto(p.operacion), comoTexto(p.error)].filter(Boolean).join(' · '),
                ),
                entidad: servicio ?? (p.router_id ? { tipo: 'router', id: String(p.router_id) } : null),
            }
        case 'aaa.caido':
            return {
                titulo: `RADIUS dejó de responder (${comoTexto(p.nodo) ?? 'nodo'})`,
                detalle: enmascararTexto(comoTexto(p.ultimo_error)),
                entidad: null,
            }
        case 'aaa.recuperado':
            return {
                titulo: `RADIUS volvió a responder (${comoTexto(p.nodo) ?? 'nodo'})`,
                detalle: p.desde ? `Caído desde ${comoTexto(p.desde)}` : null,
                entidad: null,
            }
        case 'libro.integridad_rota':
            return {
                titulo: 'Se rompió la integridad del libro',
                detalle: p.asiento_id ? `Asiento ${comoTexto(p.asiento_id)}` : null,
                entidad: p.asiento_id ? { tipo: 'asiento', id: String(p.asiento_id) } : null,
            }
        case 'libro.proceso_bloqueado':
            return {
                titulo: 'Un proceso se detuvo por un bloqueo del libro',
                detalle: [
                    comoTexto(p.proceso),
                    p.documentos !== undefined ? `${comoTexto(p.documentos)} documentos` : null,
                ]
                    .filter(Boolean)
                    .join(' · '),
                entidad: null,
            }
        default:
            return { titulo: evento, detalle: null, entidad: null }
    }
}

/*
|--------------------------------------------------------------------------
| Jobs fallidos de BullMQ
|--------------------------------------------------------------------------
*/

const TOPE_JOBS_POR_COLA = 200

async function jobsFallidos(desde: Date): Promise<Array<{ clave: Clave; entrada: EntradaRegistro }>> {
    let colas: Map<string, ColaLegible>
    try {
        colas = colasLegibles()
    } catch {
        return []
    }
    const porCola = await Promise.all(
        [...colas.entries()].map(async ([nombre, cola]) => {
            try {
                const jobs = await conTimeout(cola.getFailed(0, TOPE_JOBS_POR_COLA - 1))
                return jobs.map((job) => ({ nombre, job }))
            } catch {
                // Redis caído o lento: la página sale sin los jobs
                return []
            }
        }),
    )
    const salida: Array<{ clave: Clave; entrada: EntradaRegistro }> = []
    for (const { nombre, job } of porCola.flat()) {
        const ms = job.finishedOn ?? job.timestamp
        if (!ms || ms < desde.getTime()) continue
        const id = `job:${nombre}:${job.id ?? ''}`
        salida.push({
            clave: { us: BigInt(Math.floor(ms)) * 1000n, id },
            entrada: {
                id,
                momento: new Date(ms).toISOString(),
                nivel: 'error',
                origen: 'colas',
                titulo: `Falló un trabajo en la cola ${nombre}`,
                detalle: enmascararTexto([job.name, job.failedReason].filter(Boolean).join(' · ')),
                entidad: null,
                request_id: null,
            },
        })
    }
    return salida
}

/*
|--------------------------------------------------------------------------
| Consulta
|--------------------------------------------------------------------------
*/

export async function registroSistema(
    consulta: ConsultaRegistro,
    cliente: QueryClientContract = db.connection(),
): Promise<{ data: EntradaRegistro[]; nextCursor: string | null }> {
    const ahora = Date.now()
    const desde = consulta.desde ?? new Date(ahora - DIAS_POR_DEFECTO * 86_400_000)
    if (desde.getTime() < ahora - DIAS_MAXIMOS * 86_400_000) {
        throw new ValidacionFallida([
            { field: 'desde', rule: 'rango', message: `No se aceptan más de ${DIAS_MAXIMOS} días atrás` },
        ])
    }
    const limite = Math.min(consulta.limit ?? LIMITE_POR_DEFECTO, LIMITE_MAXIMO_REGISTRO)
    const cursor = consulta.cursor ? decodificarCursorRegistro(consulta.cursor) : null

    const [filas, jobs] = await Promise.all([
        filasBase(cliente, desde, consulta, cursor, limite + 1),
        (!consulta.origen || consulta.origen === 'colas') && (!consulta.nivel || consulta.nivel === 'error')
            ? jobsFallidos(desde)
            : Promise.resolve([]),
    ])

    const candidatos = [
        ...filas.map((f) => ({ clave: { us: BigInt(f.us), id: f.id }, entrada: entradaDeFila(f) })),
        ...jobs.filter((j) => !cursor || compararDesc(j.clave, cursor) > 0),
    ].sort((a, b) => compararDesc(a.clave, b.clave))

    const pagina = candidatos.slice(0, limite)
    const hayMas = candidatos.length > limite
    return {
        data: pagina.map((c) => c.entrada),
        nextCursor: hayMas ? codificarCursorRegistro(pagina[pagina.length - 1]!.clave) : null,
    }
}
