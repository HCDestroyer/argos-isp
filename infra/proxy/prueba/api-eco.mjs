// Hace de API detrás del proxy en la prueba del webhook (infra/proxy/probar-webhook.sh): recibe
// POST /api/v1/pasarela/webhook/<proveedor>, verifica la firma como la pasarela falsa de A3
// (X-Pasarela-Firma: t=<unix>,v1=hex(HMAC_SHA256(secreto, "<t>.<cuerpo crudo>"))) y devuelve lo
// que recibió: sha256 del cuerpo, largo y cabeceras de contenido.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'

const SECRETO = process.env.PASARELA_FALSA_SECRETO ?? 'secreto-de-prueba'

function firmaValida(cabecera, crudo) {
    if (!cabecera) return false
    const partes = Object.fromEntries(cabecera.split(',').map((p) => p.split('=')))
    if (!partes.t || !partes.v1) return false
    const esperada = createHmac('sha256', SECRETO).update(`${partes.t}.`).update(crudo).digest('hex')
    const a = Buffer.from(esperada)
    const b = Buffer.from(partes.v1)
    return a.length === b.length && timingSafeEqual(a, b)
}

createServer(async (req, res) => {
    const partes = []
    for await (const p of req) partes.push(p)
    const crudo = Buffer.concat(partes)
    if (req.url === '/health') {
        res.writeHead(200).end('ok')
        return
    }
    if (req.method !== 'POST' || !req.url?.startsWith('/api/v1/pasarela/webhook/')) {
        res.writeHead(404).end()
        return
    }
    const valida = firmaValida(req.headers['x-pasarela-firma'], crudo)
    res.writeHead(valida ? 200 : 401, { 'content-type': 'application/json' })
    res.end(
        JSON.stringify({
            firma_valida: valida,
            sha256: createHash('sha256').update(crudo).digest('hex'),
            longitud: crudo.length,
            content_type: req.headers['content-type'] ?? null,
            content_encoding: req.headers['content-encoding'] ?? null,
        }),
    )
}).listen(3333, () => console.log('api-eco escuchando en 3333'))
