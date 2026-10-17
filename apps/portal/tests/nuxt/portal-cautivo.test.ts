import { describe, expect, it } from 'vitest'
import {
    RUTAS_DETECCION,
    SONDAS,
    esSonda,
    hostsDelPortal,
    nombreHost,
    redireccionPortalCautivo,
} from '~~/server/utils/portalCautivo'

const CON_URL = { urlPublica: 'http://portal.argosisp.example', hosts: '192.0.2.20, 2001:db8:ffff::20' }
const SIN_URL = { urlPublica: '', hosts: '' }

describe('nombreHost', () => {
    it('quita puerto, corchetes y mayúsculas', () => {
        expect(nombreHost('Portal.Example:8080')).toBe('portal.example')
        expect(nombreHost('[2001:db8::1]:80')).toBe('2001:db8::1')
        expect(nombreHost('2001:db8::1')).toBe('2001:db8::1')
        expect(nombreHost(undefined)).toBe('')
    })

    it('el portal reconoce sus hosts, los locales y el de la URL pública', () => {
        const hosts = hostsDelPortal(CON_URL)
        for (const host of ['portal.argosisp.example', '192.0.2.20', '2001:db8:ffff::20', 'localhost', '127.0.0.1', '::1']) {
            expect(hosts.has(host)).toBe(true)
        }
    })
})

describe('redireccionPortalCautivo', () => {
    it.each(SONDAS.map(sonda => [sonda.sistema, sonda.host, sonda.ruta] as const))(
        'sonda de %s (%s%s) redirige a /corte',
        (_sistema, host, ruta) => {
            expect(redireccionPortalCautivo({ host, ruta }, CON_URL)).toBe('http://portal.argosisp.example/corte')
            expect(redireccionPortalCautivo({ host, ruta }, SIN_URL)).toBe('/corte')
            // Incluso si la sonda llega con el Host del portal (IPv4, IPv6 o nombre).
            for (const propio of ['portal.argosisp.example', '192.0.2.20', '[2001:db8:ffff::20]:80', 'localhost:3001']) {
                expect(redireccionPortalCautivo({ host: propio, ruta }, CON_URL)).toBe('http://portal.argosisp.example/corte')
                expect(redireccionPortalCautivo({ host: propio, ruta }, SIN_URL)).toBe('/corte')
            }
        },
    )

    it('las sondas cubren Android, Apple, Windows, Firefox y Linux, y se reconocen sin mayúsculas ni barra final', () => {
        const rutas = [...RUTAS_DETECCION]
        for (const ruta of ['/generate_204', '/hotspot-detect.html', '/connecttest.txt', '/ncsi.txt', '/success.txt', '/check_network_status.txt']) {
            expect(rutas).toContain(ruta)
        }
        expect(esSonda('/Generate_204')).toBe(true)
        expect(esSonda('/hotspot-detect.html/')).toBe(true)
        expect(esSonda('/')).toBe(false)
        expect(esSonda('/corte')).toBe(false)
    })

    it('las sondas que piden la raíz de su host también aterrizan en /corte', () => {
        for (const host of ['captive.apple.com', 'networkcheck.kde.org', 'connectivity-check.ubuntu.com', 'neverssl.com']) {
            expect(redireccionPortalCautivo({ host, ruta: '/' }, CON_URL)).toBe('http://portal.argosisp.example/corte')
            expect(redireccionPortalCautivo({ host, ruta: '/' }, SIN_URL)).toBe('/corte')
        }
    })

    it('cualquier Host ajeno y cualquier ruta aterrizan en /corte', () => {
        expect(redireccionPortalCautivo({ host: 'example.com', ruta: '/' }, CON_URL)).toBe('http://portal.argosisp.example/corte')
        expect(redireccionPortalCautivo({ host: 'neverssl.com:80', ruta: '/noticias/hoy' }, CON_URL))
            .toBe('http://portal.argosisp.example/corte')
        expect(redireccionPortalCautivo({ host: 'example.com', ruta: '/corte' }, CON_URL))
            .toBe('http://portal.argosisp.example/corte')
        expect(redireccionPortalCautivo({ host: undefined, ruta: '/x' }, SIN_URL)).toBe('/corte')
    })

    it('sin URL pública, /corte y sus recursos se sirven en el Host ajeno (sin bucle)', () => {
        for (const ruta of ['/corte', '/_nuxt/entry.js', '/api/v1/portal/quien-soy', '/api/_nuxt_icon/lucide.json', '/favicon.ico', '/favicon.svg']) {
            expect(redireccionPortalCautivo({ host: 'example.com', ruta }, SIN_URL)).toBeNull()
        }
        expect(redireccionPortalCautivo({ host: 'example.com', ruta: '/' }, SIN_URL)).toBe('/corte')
    })

    it('una URL pública inválida cae a redirección relativa sin bucle', () => {
        const invalida = { urlPublica: 'no es url', hosts: '' }
        expect(redireccionPortalCautivo({ host: 'example.com', ruta: '/' }, invalida)).toBe('/corte')
        expect(redireccionPortalCautivo({ host: 'example.com', ruta: '/corte' }, invalida)).toBeNull()
    })

    it('el Host del portal navega normal', () => {
        for (const host of ['portal.argosisp.example', '192.0.2.20', '[2001:db8:ffff::20]', 'localhost:3001']) {
            expect(redireccionPortalCautivo({ host, ruta: '/' }, CON_URL)).toBeNull()
            expect(redireccionPortalCautivo({ host, ruta: '/mi-cuenta' }, CON_URL)).toBeNull()
        }
    })
})
