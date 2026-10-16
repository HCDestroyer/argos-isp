import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import db from '@adonisjs/lucid/services/db'
import { Conflicto, Problema } from '#shared/errores'
import { COOKIE_PORTAL } from '#shared/rutas'
import { ipOrigenDeLaPeticion } from '#portal/ip_origen'

interface RespuestaGuardada {
    status: number
    body: unknown
}

interface FilaIdempotencia {
    id: number
    metodo: string
    ruta: string
    huella: string
    respuesta: RespuestaGuardada | null
}

const CLAVE_VALIDA = /^[\x21-\x7E]{1,255}$/

/**
 * Header `Idempotency-Key` en operaciones que mueven dinero o estado.
 *
 * - Sin header: la petición sigue normal.
 * - Primera vez: reserva `(clave, actor)` en `core.idempotency_keys`, ejecuta y guarda la
 *   respuesta 2xx. Si la operación falla, libera la reserva para permitir reintentar.
 * - Repetición con la misma ruta y cuerpo: devuelve la respuesta guardada con
 *   `Idempotent-Replayed: true` sin ejecutar nada.
 * - Misma clave con otra ruta u otro cuerpo: 422. Mientras la primera sigue en curso: 409. En
 *   multipart, el cuerpo incluye los archivos: campo, nombre, tamaño y sha256 del contenido
 *   (`huellaArchivos`), así que otro archivo con la misma clave también es 422.
 *
 * Espacio de claves (semana 3): con usuario autenticado, por `actor_id`. Sin usuario (rutas
 * públicas del portal) se acota por `alcance` (`alcanceAnonimo`): la sesión del portal si trae la
 * cookie, si no la IP de origen; así dos clientes con la misma clave nunca reciben la respuesta
 * guardada del otro.
 */
export default class IdempotenciaMiddleware {
    async handle(ctx: HttpContext, next: NextFn) {
        const clave = ctx.request.header('idempotency-key')
        if (clave === undefined) return next()
        if (!CLAVE_VALIDA.test(clave)) {
            throw new Problema(
                400,
                'idempotency_key_invalida',
                'Idempotency-Key inválida',
                'Debe tener 1 a 255 caracteres ASCII visibles',
            )
        }

        const actorId = 'auth' in ctx ? (ctx.auth.user?.id ?? null) : null
        const alcance = actorId === null ? alcanceAnonimo(ctx) : null
        const metodo = ctx.request.method()
        const ruta = ctx.request.url(true)
        const huella = createHash('sha256')
            .update(`${metodo} ${ruta}\n${JSON.stringify(ctx.request.body() ?? {})}`)
            .update(await huellaArchivos(ctx))
            .digest('hex')

        const insertadas = (await db
            .knexQuery()
            .table('core.idempotency_keys')
            .insert({ clave, actor_id: actorId, alcance, metodo, ruta, huella })
            .onConflict()
            .ignore()
            .returning('id')) as Array<{ id: number }>
        const reserva = insertadas[0]

        if (!reserva) {
            const previa = (await db
                .from('core.idempotency_keys')
                .where('clave', clave)
                .if(
                    actorId === null,
                    (q) => q.whereNull('actor_id'),
                    (q) => q.where('actor_id', actorId!),
                )
                .if(
                    alcance === null,
                    (q) => q.whereNull('alcance'),
                    (q) => q.where('alcance', alcance!),
                )
                .first()) as FilaIdempotencia | null

            if (!previa) return next()
            if (previa.huella !== huella) {
                throw new Problema(
                    422,
                    'idempotency_key_reutilizada',
                    'Idempotency-Key reutilizada',
                    'La clave ya se usó con otra ruta o con otro cuerpo',
                )
            }
            if (!previa.respuesta) {
                throw new Conflicto(
                    'Una petición con esta Idempotency-Key sigue en curso',
                    'idempotencia_en_curso',
                )
            }
            ctx.response.header('Idempotent-Replayed', 'true')
            ctx.response.status(previa.respuesta.status)
            if (previa.respuesta.body === null || previa.respuesta.body === undefined) {
                return ctx.response.send('')
            }
            return ctx.response.send(previa.respuesta.body)
        }

        try {
            await next()
        } catch (error) {
            await db.from('core.idempotency_keys').where('id', reserva.id).delete()
            throw error
        }

        const status = ctx.response.getStatus()
        if (status >= 200 && status < 300) {
            const respuesta: RespuestaGuardada = { status, body: ctx.response.getBody() ?? null }
            await db
                .from('core.idempotency_keys')
                .where('id', reserva.id)
                .update({ respuesta: JSON.stringify(respuesta), completada_en: db.knexRawQuery('now()') })
        } else {
            await db.from('core.idempotency_keys').where('id', reserva.id).delete()
        }
    }
}

const hash = (texto: string) => createHash('sha256').update(texto).digest('hex').slice(0, 40)

/**
 * Alcance de una petición sin usuario: `sesion:<hash>` de la cookie del portal (`argos_portal`) o
 * `ip:<hash>` de la IP de origen (`ipOrigenDeLaPeticion`, que respeta
 * `PORTAL_PROXIES_CONFIABLES`). Solo hashes: ni el token ni la IP quedan en la tabla.
 */
export function alcanceAnonimo(ctx: HttpContext): string {
    const sesion = ctx.request.plainCookie(COOKIE_PORTAL, { encoded: false })
    if (typeof sesion === 'string' && sesion !== '') return `sesion:${hash(sesion)}`
    const ip = ipOrigenDeLaPeticion(ctx) ?? ctx.request.ip()
    return `ip:${hash(ip)}`
}

/**
 * Archivos de un cuerpo multipart en la huella (semana 3, `a5.md:26`): por campo (ordenados), el
 * nombre del cliente, el tamaño y el sha256 del contenido. Vacío si la petición no trae archivos,
 * así la huella de un JSON no cambia.
 */
export async function huellaArchivos(ctx: HttpContext): Promise<string> {
    const porCampo = ctx.request.allFiles()
    const campos = Object.keys(porCampo).sort()
    if (campos.length === 0) return ''
    const partes: string[] = []
    for (const campo of campos) {
        const valor = porCampo[campo]
        const archivos = Array.isArray(valor) ? valor : valor ? [valor] : []
        for (const archivo of archivos) {
            let contenido = 'sin-contenido'
            if (archivo.tmpPath) {
                contenido = createHash('sha256')
                    .update(await readFile(archivo.tmpPath))
                    .digest('hex')
            }
            partes.push(`${campo}\t${archivo.clientName}\t${archivo.size}\t${contenido}`)
        }
    }
    return `\narchivos\n${partes.join('\n')}`
}
