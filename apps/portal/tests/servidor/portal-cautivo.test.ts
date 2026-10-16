/**
 * Sondas de portal cautivo contra el servidor Nitro real (tarea 1 de la semana 3, pedido de A6).
 *
 * Un cliente suspendido que hace la prueba de conectividad de su sistema operativo debe recibir
 * 302 a `/corte` (el aviso "Iniciar sesión en la red"), nunca el 204 ni el texto "de éxito" que
 * esperan Android, Apple, Windows o Firefox.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { setup, startServer } from '@nuxt/test-utils/e2e'
import { SONDAS } from '../../server/utils/portalCautivo'
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
})
