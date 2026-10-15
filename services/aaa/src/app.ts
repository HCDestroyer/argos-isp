import Fastify, { LogController, type FastifyInstance, type FastifyReply } from 'fastify'
import { ErrorAccounting, normalizarAccounting, type ColaAccounting } from './accounting.ts'
import { descifrar } from './cifrado.ts'
import type { ResolutorServicios } from './fuentes.ts'
import { construirReply, type OpcionesPerfil } from './perfil.ts'
import { leerAtributos } from './radius.ts'
import { esLapida } from './servicio.ts'

/**
 * Servicio aaa: endpoints que llama FreeRADIUS (`freeradius/mods-enabled/rest`, `body = 'json'`).
 *
 * Código HTTP → rcode de rlm_rest: 200 con JSON → updated; 204 → ok; 401 → reject; 404 → notfound;
 * 5xx → fail. `sites-enabled/default` rechaza en notfound/fail, así que:
 *   activo / limitado / suspendido → 200 con `control:Cleartext-Password` + atributos `reply:`
 *   retirado                       → 401
 *   inexistente (o lápida)         → 404
 *   error de Redis y del respaldo  → 503
 */

export interface DependenciasApp {
    resolutor: ResolutorServicios
    claveSecretos: Buffer
    perfil: OpcionesPerfil
    logLevel?: string
    /** Estado de Redis para /health (no bloquea: sin Redis se autoriza por el respaldo). */
    redisListo?: () => boolean
    /** Cola de accounting (BullMQ `aaa-accounting`). Sin ella `/aaa/accounting` responde 503. */
    cola?: ColaAccounting
    /** Tiempo máximo para encolar (rlm_rest espera 2 s en accounting). */
    encolarTimeoutMs?: number
}

class TiempoAgotado extends Error {}

function conLimite<T>(promesa: Promise<T>, ms: number): Promise<T> {
    let temporizador: NodeJS.Timeout | undefined
    const limite = new Promise<never>((_, rechazar) => {
        temporizador = setTimeout(() => rechazar(new TiempoAgotado(`sin respuesta en ${ms} ms`)), ms)
    })
    return Promise.race([promesa, limite]).finally(() => clearTimeout(temporizador))
}

function problema(reply: FastifyReply, status: number, title: string, detail?: string): FastifyReply {
    return reply
        .code(status)
        .type('application/problem+json; charset=utf-8')
        .send({ type: 'about:blank', title, status, ...(detail ? { detail } : {}) })
}

export function crearApp(deps: DependenciasApp): FastifyInstance {
    const app = Fastify({
        logger: {
            level: deps.logLevel ?? 'info',
            base: { servicio: 'aaa' },
            // El cuerpo nunca se registra (trae User-Password en PAP); por si alguien lo agrega:
            redact: ['req.body', 'body', '*.User-Password', '*.CHAP-Password', '*.Cleartext-Password'],
        },
        // Una línea propia por autorización en lugar de dos por petición.
        logController: new LogController({ disableRequestLogging: true }),
    })

    app.get('/health', async () => ({
        status: 'ok',
        servicio: 'aaa',
        redis: deps.redisListo ? (deps.redisListo() ? 'ok' : 'caido') : 'desconocido',
    }))

    app.post('/aaa/authorize', async (req, reply) => {
        const inicio = performance.now()
        const atributos = leerAtributos(req.body)
        const usuario = atributos.get('User-Name')
        const nas = atributos.get('NAS-IP-Address') ?? atributos.get('NAS-IPv6-Address')
        if (!usuario) {
            req.log.warn({ nas }, 'authorize sin User-Name')
            return reply.code(404).send()
        }

        let resuelto
        try {
            resuelto = await deps.resolutor.resolver(usuario)
        } catch (e) {
            req.log.error({ usuario, nas, error: (e as Error).message }, 'authorize: sin Redis ni respaldo')
            return problema(reply, 503, 'Fuente de servicios no disponible')
        }
        const { registro, origen, errorRedis } = resuelto
        const ms = Math.round((performance.now() - inicio) * 10) / 10
        if (errorRedis) req.log.warn({ usuario, error: errorRedis }, 'Redis no respondió; se usó el respaldo')

        if (registro === null || esLapida(registro)) {
            req.log.info({ usuario, nas, origen, resultado: 'inexistente', ms }, 'authorize')
            return reply.code(404).send()
        }
        if (registro.estado === 'retirado') {
            req.log.info(
                { usuario, nas, origen, servicio_id: registro.servicio_id, resultado: 'retirado', ms },
                'authorize',
            )
            return reply.code(401).send()
        }

        let password: string
        try {
            password = descifrar(registro.pass_ppp, deps.claveSecretos)
        } catch (e) {
            req.log.error(
                { usuario, servicio_id: registro.servicio_id, error: (e as Error).message },
                'authorize: pass_ppp',
            )
            return problema(reply, 500, 'No se pudo descifrar pass_ppp')
        }

        const { reply: atributosReply, avisos } = construirReply(registro, deps.perfil)
        for (const aviso of avisos) req.log.warn({ usuario, servicio_id: registro.servicio_id }, aviso)

        const cuerpo: Record<string, string | number> = { 'control:Cleartext-Password': password }
        for (const [nombre, valor] of Object.entries(atributosReply)) cuerpo[`reply:${nombre}`] = valor

        req.log.info(
            {
                usuario,
                nas,
                origen,
                servicio_id: registro.servicio_id,
                estado: registro.estado,
                rate_limit: atributosReply['Mikrotik-Rate-Limit'],
                resultado: 'aceptado',
                ms,
            },
            'authorize',
        )
        return reply.code(200).type('application/json').send(cuerpo)
    })

    app.post('/aaa/post-auth', async (req, reply) => {
        // No bloqueante (sites-enabled/default). Solo registra; el Accept/Reject ya lo decidió authorize.
        const atributos = leerAtributos(req.body)
        req.log.debug({ usuario: atributos.get('User-Name') }, 'post-auth')
        return reply.code(204).send()
    })

    app.post('/aaa/accounting', async (req, reply) => {
        // 204 → ok → FreeRADIUS contesta Accounting-Response. 503 → fail → sin respuesta y el NAS
        // reintenta: solo cuando no se pudo encolar (el paquete no se pierde).
        const inicio = performance.now()
        const atributos = leerAtributos(req.body)
        let registro
        try {
            registro = normalizarAccounting(atributos)
        } catch (e) {
            if (!(e instanceof ErrorAccounting)) throw e
            // Paquete inservible: se confirma igual para que el NAS no lo reintente sin fin.
            req.log.warn(
                {
                    usuario: atributos.get('User-Name'),
                    nas: atributos.get('NAS-IP-Address'),
                    error: e.message,
                },
                'accounting descartado',
            )
            return reply.code(204).send()
        }
        if (!deps.cola) return problema(reply, 503, 'Cola de accounting no configurada')
        try {
            await conLimite(deps.cola.encolar(registro), deps.encolarTimeoutMs ?? 1500)
        } catch (e) {
            req.log.error(
                {
                    usuario: registro.user_ppp,
                    nas: registro.nas_ip,
                    tipo: registro.tipo,
                    error: (e as Error).message,
                },
                'accounting: no se pudo encolar',
            )
            return problema(reply, 503, 'Cola de accounting no disponible')
        }
        req.log.info(
            {
                usuario: registro.user_ppp || undefined,
                nas: registro.nas_ip,
                tipo: registro.tipo,
                sesion: registro.acct_session_id || undefined,
                ms: Math.round((performance.now() - inicio) * 10) / 10,
            },
            'accounting',
        )
        return reply.code(204).send()
    })

    app.setNotFoundHandler((_req, reply) => problema(reply, 404, 'No encontrado'))
    app.setErrorHandler((error: { statusCode?: number; message: string }, req, reply) => {
        const status = error.statusCode && error.statusCode < 500 ? error.statusCode : 500
        if (status >= 500) req.log.error({ error: error.message }, 'error no controlado')
        return problema(
            reply,
            status,
            status >= 500 ? 'Error interno' : 'Petición inválida',
            status < 500 ? error.message : undefined,
        )
    })

    return app
}
