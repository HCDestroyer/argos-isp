/**
 * Portal contra el servidor Nitro de producción (una sola compilación para todo el archivo).
 *
 * Sondas de portal cautivo (semana 3, tarea 1, pedido de A6):
 * Un cliente suspendido que hace la prueba de conectividad de su sistema operativo debe recibir
 * 302 a `/corte` (el aviso "Iniciar sesión en la red"), nunca el 204 ni el texto "de éxito" que
 * esperan Android, Apple, Windows o Firefox.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { setup, startServer } from '@nuxt/test-utils/e2e'
import { SONDAS } from '../../server/utils/portalCautivo'
import { hashScript, scriptsEnLinea } from '../../server/utils/cabecerasSeguridad'
import { BUILD_PRUEBAS, RAIZ_PORTAL, levantarApiFalsa, pedir, type Respuesta } from './ayudas'

const api = await levantarApiFalsa()
const URL_PUBLICA = 'http://portal.argosisp.example'

await setup({
    rootDir: RAIZ_PORTAL,
    buildDir: BUILD_PRUEBAS,
    server: true,
    build: true,
    env: {
        NUXT_API_BASE_INTERNAL: api.url,
        NUXT_PORTAL_URL_PUBLICA: URL_PUBLICA,
        NUXT_PORTAL_HOSTS: '192.0.2.20,2001:db8:ffff::20',
    },
})

afterAll(() => api.cerrar())

function esperarRedireccionACorte(respuesta: Respuesta, destino: string): void {
    expect(respuesta.status).toBe(302)
    expect(respuesta.headers.location).toBe(destino)
    expect(respuesta.headers['cache-control']).toContain('no-store')
}

/** Lo que la sonda espera cuando hay Internet: el portal nunca lo responde. */
function esperarSinExito(respuesta: Respuesta, sonda: (typeof SONDAS)[number]): void {
    expect(respuesta.status).not.toBe(204)
    expect(respuesta.status).not.toBe(sonda.exito.status)
    if (sonda.exito.cuerpo) {
        expect(respuesta.cuerpo).not.toContain(sonda.exito.cuerpo.trim())
    }
}

describe('sondas de portal cautivo (con URL pública)', () => {
    it.each(SONDAS.map(sonda => [sonda.sistema, sonda] as const))('%s: 302 a /corte, nunca su respuesta de éxito', async (_sistema, sonda) => {
        for (const metodo of ['GET', 'HEAD']) {
            const respuesta = await pedir(sonda.ruta, { host: sonda.host, metodo })
            esperarRedireccionACorte(respuesta, `${URL_PUBLICA}/corte`)
            esperarSinExito(respuesta, sonda)
        }
        // También si llega por la IP del portal (dst-nat de IPv4, o [portalV6]:80 por IPv6).
        for (const host of ['192.0.2.20', '[2001:db8:ffff::20]:80', 'portal.argosisp.example']) {
            esperarRedireccionACorte(await pedir(sonda.ruta, { host }), `${URL_PUBLICA}/corte`)
        }
        // Con query de caché (Android y Windows agregan parámetros a veces).
        esperarRedireccionACorte(await pedir(`${sonda.ruta}?t=1`, { host: sonda.host }), `${URL_PUBLICA}/corte`)
    })

    it('las sondas que piden la raíz de su host también reciben 302 a /corte', async () => {
        for (const host of ['captive.apple.com', 'networkcheck.kde.org', 'connectivity-check.ubuntu.com', 'neverssl.com']) {
            esperarRedireccionACorte(await pedir('/', { host }), `${URL_PUBLICA}/corte`)
        }
    })

    it('/corte responde la página (200 HTML), sin el texto de éxito de ninguna sonda', async () => {
        const respuesta = await pedir('/corte', { host: 'portal.argosisp.example' })
        expect(respuesta.status).toBe(200)
        expect(respuesta.headers['content-type']).toContain('text/html')
        for (const texto of ['<TITLE>Success</TITLE>', 'Microsoft Connect Test', 'Microsoft NCSI', 'NetworkManager is online']) {
            expect(respuesta.cuerpo).not.toContain(texto)
        }
    })

    it('ninguna sonda llega a la API', () => {
        expect(api.rutas).toEqual([])
    })
})

describe('sondas de portal cautivo (sin URL pública: laboratorio sin DNS)', () => {
    // El contexto de `setup()` solo existe dentro de cada prueba (su beforeEach), no en beforeAll:
    // se reinicia el servidor (sin recompilar) antes de la primera prueba del bloque.
    let reiniciado = false
    beforeEach(async () => {
        if (reiniciado) return
        await startServer({
            env: {
                NUXT_API_BASE_INTERNAL: api.url,
                NUXT_PORTAL_URL_PUBLICA: '',
                NUXT_PORTAL_HOSTS: '',
            },
        })
        reiniciado = true
    })

    it.each(SONDAS.map(sonda => [sonda.sistema, sonda] as const))('%s: 302 relativo a /corte', async (_sistema, sonda) => {
        const respuesta = await pedir(sonda.ruta, { host: sonda.host })
        esperarRedireccionACorte(respuesta, '/corte')
        esperarSinExito(respuesta, sonda)
    })

    it('/corte se sirve en el Host ajeno sin bucle de redirecciones', async () => {
        const respuesta = await pedir('/corte', { host: 'connectivitycheck.gstatic.com' })
        expect(respuesta.status).toBe(200)
        expect(respuesta.headers['content-type']).toContain('text/html')
    })

    it('el favicon (marca de ArgosIsp) se sirve en el Host ajeno', async () => {
        const respuesta = await pedir('/favicon.svg', { host: 'captive.apple.com' })
        expect(respuesta.status).toBe(200)
        expect(respuesta.headers['content-type']).toContain('image/svg+xml')
        expect(respuesta.cuerpo).toContain('#0f766e')
    })
})

describe('seguridad (semana 3, tarea 3)', () => {
    let reiniciado = false
    beforeEach(async () => {
        if (reiniciado) return
        await startServer({
            env: { NUXT_API_BASE_INTERNAL: api.url, NUXT_PORTAL_URL_PUBLICA: URL_PUBLICA, NUXT_PORTAL_HOSTS: '' },
        })
        api.rutas.length = 0
        reiniciado = true
    })

    const HOST = 'portal.argosisp.example'

    it.each(['/corte', '/entrar', '/cuenta', '/contacto'])('%s: CSP con el hash de cada script en línea, sin iframes ni X-Powered-By', async (ruta) => {
        const respuesta = await pedir(ruta, { host: HOST })
        expect(respuesta.status).toBe(200)
        const csp = String(respuesta.headers['content-security-policy'])
        expect(csp).toContain('frame-ancestors \'none\'')
        expect(csp).not.toMatch(/script-src[^;]*unsafe-(inline|eval)/)
        expect(csp).not.toMatch(/https?:\/\//)
        const scripts = scriptsEnLinea(respuesta.cuerpo)
        expect(scripts.length).toBeGreaterThan(0)
        for (const script of scripts) {
            expect(csp).toContain(hashScript(script))
        }
        expect(respuesta.headers['x-frame-options']).toBe('DENY')
        expect(respuesta.headers['x-content-type-options']).toBe('nosniff')
        expect(respuesta.headers['referrer-policy']).toBe('same-origin')
        expect(respuesta.headers['x-powered-by']).toBeUndefined()
    })

    it('redirecciones del portal cautivo y respuestas del proxy también llevan las cabeceras', async () => {
        for (const respuesta of [
            await pedir('/generate_204', { host: 'connectivitycheck.gstatic.com' }),
            await pedir('/api/v1/portal/quien-soy', { host: HOST }),
        ]) {
            expect(respuesta.headers['x-frame-options']).toBe('DENY')
            expect(respuesta.headers['x-content-type-options']).toBe('nosniff')
        }
    })

    it('el proxy nunca sale de /api/v1/portal/ (../, %2e%2e): 404 y la API no recibe nada', async () => {
        api.rutas.length = 0
        for (const ruta of ['/api/v1/portal/../clientes', '/api/v1/portal/%2e%2e/clientes', '/api/v1/portal/%2E%2E/%2e%2e/v1/usuarios']) {
            const respuesta = await pedir(ruta, { host: HOST })
            expect(respuesta.status, ruta).toBe(404)
        }
        expect(api.rutas).toEqual([])
    })

    it('POST desde otro sitio: 403 sin llegar a la API; desde el portal pasa', async () => {
        api.rutas.length = 0
        const cuerpo = { metodo: 'POST', headers: { 'content-type': 'application/json' } }
        const ajeno = await pedir('/api/v1/portal/promesas', { ...cuerpo, host: HOST, headers: { ...cuerpo.headers, origin: 'http://malo.example' } })
        expect(ajeno.status).toBe(403)
        expect(ajeno.headers['content-type']).toContain('application/problem+json')
        const formulario = await pedir('/api/v1/portal/comprobantes', { metodo: 'POST', host: HOST, headers: { 'sec-fetch-site': 'cross-site' } })
        expect(formulario.status).toBe(403)
        expect(api.rutas).toEqual([])

        const propio = await pedir('/api/v1/portal/salir', { metodo: 'POST', host: HOST, headers: { 'origin': URL_PUBLICA, 'sec-fetch-site': 'same-origin' } })
        expect(propio.status).toBe(200)
        expect(api.rutas).toEqual(['/api/v1/portal/salir'])
    })
})

describe('proxy a la API caída (piloto, tarea 2)', () => {
    let reiniciado = false
    beforeEach(async () => {
        if (reiniciado) return
        // Puerto 9 (discard) en 127.0.0.1: conexión rechazada, como una API caída.
        await startServer({ env: { NUXT_API_BASE_INTERNAL: 'http://127.0.0.1:9' } })
        reiniciado = true
    })

    it('responde 502 problem+json en español, sin URLs internas, y la página sigue cargando', async () => {
        const respuesta = await pedir('/api/v1/portal/quien-soy', { host: 'portal.argosisp.example' })
        expect(respuesta.status).toBe(502)
        expect(respuesta.headers['content-type']).toContain('application/problem+json')
        expect(respuesta.headers['cache-control']).toContain('no-store')
        const problema = JSON.parse(respuesta.cuerpo) as { status: number, title: string, detail: string }
        expect(problema).toMatchObject({ status: 502, title: 'Servicio no disponible' })
        expect(problema.detail).toContain('No pudimos contactar al sistema')
        expect(respuesta.cuerpo).not.toContain('127.0.0.1')

        // El HTML de /corte no depende de la API (se consulta en el navegador).
        expect((await pedir('/corte', { host: 'portal.argosisp.example' })).status).toBe(200)
    })
})
