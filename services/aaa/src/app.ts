import { createServer, type Server } from 'node:http'
import { enviarJson, enviarProblema } from './http.ts'

/**
 * Esqueleto del servicio aaa (día 1, A6).
 *
 * Solo `node:http` para que el compose arranque. A2 reemplaza esto con Fastify o Hono e implementa
 * `/aaa/authorize`, `/aaa/post-auth` y `/aaa/accounting` según `.claude/agents/a2-radius.md`.
 *
 * Contrato con FreeRADIUS (`freeradius/mods-enabled/rest`, `body = 'json'`):
 * - Petición: JSON con los atributos del paquete RADIUS, p. ej. `{"User-Name":{"type":"string","value":["juan"]}}`.
 * - Respuesta 200 con JSON `{"control:Cleartext-Password":"...","reply:Mikrotik-Rate-Limit":"10240k/10240k"}`
 *   → `updated`; 204 → `ok`; 401 → `reject`; 404 → `notfound`; 5xx (incluido 501) → `fail`.
 */
export function crearServidor(): Server {
    return createServer((req, res) => {
        const ruta = new URL(req.url ?? '/', 'http://localhost').pathname

        if (req.method === 'GET' && ruta === '/health') {
            enviarJson(res, 200, { status: 'ok', servicio: 'aaa' })
            return
        }

        if (
            req.method === 'POST' &&
            (ruta === '/aaa/authorize' || ruta === '/aaa/post-auth' || ruta === '/aaa/accounting')
        ) {
            // A2 lo implementa (día 2: authorize; día 3: accounting). Mientras tanto FreeRADIUS recibe
            // 501 → rlm_rest devuelve `fail` → Access-Reject / sin Accounting-Response.
            req.resume()
            enviarProblema(res, 501, 'No implementado', `${ruta} lo implementa A2`)
            return
        }

        req.resume()
        enviarProblema(res, 404, 'No encontrado')
    })
}
