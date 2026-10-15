import { createServer, type Server } from 'node:http'
import { enviarJson, enviarProblema } from './http.ts'

/**
 * Esqueleto del coa-dispatcher (día 1, A6).
 *
 * Solo expone `GET /health` para que el compose arranque. A2 lo completa (día 3): consumidor de
 * `servicio.estado_cambiado` y `servicio.config_cambiada` desde Redis Streams, CoA/Disconnect al
 * `nas_ip` de la sesión (UDP 3799) con el paquete `radius`, registro en `audit.red` y `coa.fallido`.
 */
export function crearServidor(): Server {
    return createServer((req, res) => {
        const ruta = new URL(req.url ?? '/', 'http://localhost').pathname
        req.resume()

        if (req.method === 'GET' && ruta === '/health') {
            enviarJson(res, 200, { status: 'ok', servicio: 'coa' })
            return
        }

        enviarProblema(res, 404, 'No encontrado')
    })
}
