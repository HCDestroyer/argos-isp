import { createServer, type Server } from 'node:http'
import { enviarJson, enviarProblema } from './http.ts'
import { scrapeAutorizado, type MetricasCoa } from './metricas.ts'

/** Estado del consumidor que expone `/health` (sin él, solo `status: ok`). */
export interface EstadoSalud {
    consumidor: () => { activo: boolean; ultimaLectura: Date | null }
    redisListo: () => boolean
    /** `/metrics`: contadores, eventos pendientes del grupo (`XPENDING`) y token opcional */
    metricas?: MetricasCoa
    pendientes?: () => Promise<number | null>
    metricasToken?: string
}

/**
 * HTTP del coa-dispatcher: `GET /metrics` (Prometheus) y `GET /health` (healthcheck del compose). Responde 503 si el
 * consumidor está detenido o Redis no está listo.
 */
export function crearServidor(estado?: EstadoSalud): Server {
    return createServer((req, res) => {
        const ruta = new URL(req.url ?? '/', 'http://localhost').pathname
        req.resume()

        if (req.method === 'GET' && ruta === '/metrics' && estado?.metricas) {
            if (!scrapeAutorizado(estado.metricasToken, req.headers.authorization)) {
                enviarProblema(res, 401, 'Token de métricas inválido')
                return
            }
            const metricas = estado.metricas
            void (estado.pendientes?.() ?? Promise.resolve(null))
                .catch(() => null)
                .then((pendientes) => {
                    const texto = metricas.exponer({
                        pendientes,
                        consumidorActivo: estado.consumidor().activo,
                    })
                    res.writeHead(200, {
                        'content-type': 'text/plain; version=0.0.4; charset=utf-8',
                        'content-length': Buffer.byteLength(texto),
                    })
                    res.end(texto)
                })
            return
        }

        if (req.method === 'GET' && ruta === '/health') {
            if (!estado) {
                enviarJson(res, 200, { status: 'ok', servicio: 'coa' })
                return
            }
            const consumidor = estado.consumidor()
            const redis = estado.redisListo()
            const ok = consumidor.activo && redis
            enviarJson(res, ok ? 200 : 503, {
                status: ok ? 'ok' : 'degradado',
                servicio: 'coa',
                redis: redis ? 'ok' : 'caido',
                consumidor: consumidor.activo ? 'activo' : 'detenido',
                ultima_lectura: consumidor.ultimaLectura?.toISOString() ?? null,
            })
            return
        }

        enviarProblema(res, 404, 'No encontrado')
    })
}
