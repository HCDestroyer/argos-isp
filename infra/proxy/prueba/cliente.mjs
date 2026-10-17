// Cliente de la prueba del webhook (infra/proxy/probar-webhook.sh): manda webhooks firmados al
// proxy por HTTPS (Host api.localhost, certificado interno de Caddy) y comprueba que la "API"
// recibió exactamente los mismos bytes y que la firma sigue siendo válida.
import { createHash, createHmac } from 'node:crypto'
import { request } from 'node:https'
import { connect } from 'node:tls'
import { setTimeout as dormir } from 'node:timers/promises'
import { gzipSync } from 'node:zlib'

const SECRETO = process.env.PASARELA_FALSA_SECRETO ?? 'secreto-de-prueba'
const PROXY = process.env.PROXY_HOST ?? 'proxy'
const PUERTO = Number(process.env.PROXY_PUERTO ?? 443)
const DOMINIO = process.env.PROXY_DOMINIO_API ?? 'api.localhost'

// El healthcheck del proxy solo mira la API de administración de Caddy, que responde antes de que
// el certificado de DOMINIO exista (la emisión es asíncrona). Hasta entonces el handshake TLS con
// ese SNI recibe "alert internal error". Esperamos a que el handshake funcione, con un límite corto
// (no cubre el reintento de 60 s de Caddy si la emisión falla: eso debe fallar aquí, a la vista).
async function esperarTls(limiteMs = 20_000) {
    const hasta = Date.now() + limiteMs
    let ultimo
    while (Date.now() < hasta) {
        try {
            await new Promise((resolver, rechazar) => {
                const s = connect(
                    { host: PROXY, port: PUERTO, servername: DOMINIO, rejectUnauthorized: false },
                    () => {
                        s.end()
                        resolver()
                    },
                )
                s.once('error', rechazar)
            })
            return
        } catch (error) {
            ultimo = error
            await dormir(200)
        }
    }
    console.error(`FALLA el proxy no sirve TLS para ${DOMINIO} tras ${limiteMs} ms: ${ultimo?.message}`)
    process.exit(1)
}

function firmar(cuerpo, marca = Math.floor(Date.now() / 1000)) {
    const v1 = createHmac('sha256', SECRETO).update(`${marca}.`).update(cuerpo).digest('hex')
    return `t=${marca},v1=${v1}`
}

function enviar(cuerpo, cabeceras) {
    return new Promise((resolver, rechazar) => {
        const req = request(
            {
                host: PROXY,
                port: PUERTO,
                servername: DOMINIO,
                // certificado de la CA interna de Caddy (solo en la prueba)
                rejectUnauthorized: false,
                method: 'POST',
                path: '/api/v1/pasarela/webhook/falsa',
                headers: { host: DOMINIO, 'content-length': cuerpo.length, ...cabeceras },
            },
            (res) => {
                const partes = []
                res.on('data', (p) => partes.push(p))
                res.on('end', () => {
                    const texto = Buffer.concat(partes).toString('utf8')
                    try {
                        resolver({ status: res.statusCode, datos: JSON.parse(texto) })
                    } catch {
                        resolver({ status: res.statusCode, datos: null, texto })
                    }
                })
            },
        )
        req.on('error', rechazar)
        req.end(cuerpo)
    })
}

const json = Buffer.from(
    '{"id":"evt_prueba_1",  "tipo":"cobro.pagado","monto": "150.00","cliente":"Pérez Ñandú","nota":"a\\u00e9 \\"x\\"","orden":[3,1,2]}\n',
    'utf8',
)
const casos = [
    { nombre: 'JSON con espacios, acentos, escapes y salto final', cuerpo: json, tipo: 'application/json' },
    {
        nombre: 'formulario urlencoded',
        cuerpo: Buffer.from('id=evt_2&monto=150.00&nombre=P%C3%A9rez+%C3%91&extra=a%2Bb', 'utf8'),
        tipo: 'application/x-www-form-urlencoded',
    },
    {
        nombre: 'JSON comprimido (Content-Encoding gzip): el proxy no lo descomprime',
        cuerpo: gzipSync(json),
        tipo: 'application/json',
        codificacion: 'gzip',
    },
    {
        nombre: 'JSON grande (200 KB)',
        cuerpo: Buffer.from(JSON.stringify({ relleno: 'x'.repeat(200_000) }), 'utf8'),
        tipo: 'application/json',
    },
]

await esperarTls()

let fallas = 0
for (const caso of casos) {
    const cabeceras = { 'content-type': caso.tipo, 'x-pasarela-firma': firmar(caso.cuerpo) }
    if (caso.codificacion) cabeceras['content-encoding'] = caso.codificacion
    const r = await enviar(caso.cuerpo, cabeceras)
    const sha = createHash('sha256').update(caso.cuerpo).digest('hex')
    const ok =
        r.status === 200 &&
        r.datos?.firma_valida === true &&
        r.datos.sha256 === sha &&
        r.datos.longitud === caso.cuerpo.length &&
        r.datos.content_type === caso.tipo &&
        r.datos.content_encoding === (caso.codificacion ?? null)
    console.log(`${ok ? 'OK   ' : 'FALLA'} ${caso.nombre}: ${r.status} ${JSON.stringify(r.datos ?? r.texto)}`)
    if (!ok) fallas++
}

// Firma alterada: la API la rechaza y el proxy devuelve el 401 tal cual
const alterada = await enviar(json, {
    'content-type': 'application/json',
    'x-pasarela-firma': firmar(Buffer.from('otro')),
})
const okAlterada = alterada.status === 401 && alterada.datos?.firma_valida === false
console.log(`${okAlterada ? 'OK   ' : 'FALLA'} firma alterada: ${alterada.status}`)
if (!okAlterada) fallas++

process.exit(fallas === 0 ? 0 : 1)
