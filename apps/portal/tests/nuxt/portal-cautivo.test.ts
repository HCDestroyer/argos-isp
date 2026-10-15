import { describe, expect, it } from 'vitest'
import {
    RUTAS_DETECCION,
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
    it('las rutas de detección de Android, Apple, Windows y Firefox redirigen a /corte con cualquier Host', () => {
        const casos = [
            ['connectivitycheck.gstatic.com', '/generate_204'],
            ['clients3.google.com', '/gen_204'],
            ['captive.apple.com', '/hotspot-detect.html'],
            ['www.apple.com', '/library/test/success.html'],
            ['www.msftncsi.com', '/ncsi.txt'],
            ['www.msftconnecttest.com', '/connecttest.txt'],
            ['detectportal.firefox.com', '/success.txt'],
            ['nmcheck.gnome.org', '/check_network_status.txt'],
        ]
        for (const [host, ruta] of casos) {
            expect(redireccionPortalCautivo({ host, ruta: ruta! }, CON_URL)).toBe('http://portal.argosisp.example/corte')
            expect(redireccionPortalCautivo({ host, ruta: ruta! }, SIN_URL)).toBe('/corte')
        }
        // Incluso si la prueba llega con el Host del portal.
        expect(redireccionPortalCautivo({ host: 'portal.argosisp.example', ruta: '/generate_204' }, CON_URL))
            .toBe('http://portal.argosisp.example/corte')
        expect(RUTAS_DETECCION.size).toBeGreaterThanOrEqual(10)
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
        for (const ruta of ['/corte', '/_nuxt/entry.js', '/api/v1/portal/quien-soy', '/api/_nuxt_icon/lucide.json', '/favicon.ico']) {
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
