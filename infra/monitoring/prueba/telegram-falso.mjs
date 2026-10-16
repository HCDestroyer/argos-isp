// Bot API de Telegram simulada para probar las alertas sin internet (infra/monitoring/probar-alertas.sh).
//
//   POST /bot<token>/sendMessage   guarda el mensaje y responde como Telegram
//   POST /bot<token>/getMe         responde un bot falso
//   GET  /mensajes                 lista lo recibido: [{ recibido, token, chat_id, parse_mode, text }]
//
// Como Telegram, rechaza (400 "can't parse entities") un mensaje con parse_mode HTML que traiga
// etiquetas no permitidas o un "<" sin escapar: así la prueba detecta una plantilla rota.
import { createServer } from 'node:http'

const mensajes = []
const PERMITIDAS = new Set(['b', 'strong', 'i', 'em', 'u', 'ins', 's', 'strike', 'del', 'code', 'pre', 'a', 'span', 'tg-spoiler', 'blockquote'])

function htmlValido(texto) {
    const etiquetas = texto.match(/<[^>]*>?/g) ?? []
    for (const e of etiquetas) {
        const m = /^<\/?([a-z-]+)(\s[^>]*)?>$/.exec(e)
        if (!m || !PERMITIDAS.has(m[1])) return `etiqueta no permitida o "<" sin escapar: ${e}`
    }
    return null
}

async function cuerpo(req) {
    const partes = []
    for await (const p of req) partes.push(p)
    const crudo = Buffer.concat(partes).toString('utf8')
    const tipo = req.headers['content-type'] ?? ''
    if (tipo.includes('application/json')) return JSON.parse(crudo || '{}')
    if (tipo.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(crudo))
    if (tipo.includes('multipart/form-data')) {
        const salida = {}
        for (const m of crudo.matchAll(/name="([^"]+)"\r\n\r\n([\s\S]*?)\r\n--/g)) salida[m[1]] = m[2]
        return salida
    }
    return { crudo }
}

function responder(res, estado, datos) {
    res.writeHead(estado, { 'content-type': 'application/json' })
    res.end(JSON.stringify(datos))
}

createServer(async (req, res) => {
    try {
        if (req.method === 'GET' && req.url === '/mensajes') return responder(res, 200, mensajes)
        if (req.method === 'GET' && req.url === '/salud') return responder(res, 200, { ok: true })
        const ruta = /^\/bot([^/]+)\/(\w+)$/.exec(req.url ?? '')
        if (!ruta) return responder(res, 404, { ok: false, error_code: 404, description: 'Not Found' })
        const [, token, metodo] = ruta
        const datos = await cuerpo(req)
        if (metodo === 'getMe') {
            return responder(res, 200, { ok: true, result: { id: 1, is_bot: true, first_name: 'falso', username: 'falso_bot' } })
        }
        if (metodo !== 'sendMessage') return responder(res, 404, { ok: false, error_code: 404, description: 'Not Found' })
        const text = String(datos.text ?? '')
        if (String(datos.parse_mode ?? '').toUpperCase() === 'HTML') {
            const error = htmlValido(text)
            if (error) {
                console.log(JSON.stringify({ rechazado: true, error, text }))
                return responder(res, 400, { ok: false, error_code: 400, description: `Bad Request: can't parse entities: ${error}` })
            }
        }
        const mensaje = { recibido: new Date().toISOString(), token, chat_id: String(datos.chat_id ?? ''), parse_mode: datos.parse_mode ?? null, text }
        mensajes.push(mensaje)
        console.log(JSON.stringify(mensaje))
        return responder(res, 200, {
            ok: true,
            result: { message_id: mensajes.length, date: Math.floor(Date.now() / 1000), chat: { id: Number(datos.chat_id) || 0, type: 'group' }, text },
        })
    } catch (error) {
        return responder(res, 500, { ok: false, error_code: 500, description: String(error) })
    }
}).listen(Number(process.env.PORT ?? 8080), () => console.log('telegram-falso escuchando'))
