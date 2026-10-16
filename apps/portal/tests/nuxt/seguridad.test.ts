import { describe, expect, it } from 'vitest'
import { CABECERAS_BASE, cspDeHtml, hashScript, politicaCsp, scriptsEnLinea } from '~~/server/utils/cabecerasSeguridad'
import { destinoReenvio, origenPermitido } from '~~/server/utils/reenvioApi'

const API = 'http://api:3333'

describe('proxy a la API: solo /api/v1/portal/**', () => {
    it('reenvía las rutas del portal con su query', () => {
        expect(destinoReenvio('/api/v1/portal/quien-soy', API)).toBe('http://api:3333/api/v1/portal/quien-soy')
        expect(destinoReenvio('/api/v1/portal/facturas?cursor=abc&limit=10', API))
            .toBe('http://api:3333/api/v1/portal/facturas?cursor=abc&limit=10')
    })

    it('nunca sale del prefijo: ../, %2e%2e, barras invertidas y otras rutas de la API', () => {
        for (const ruta of [
            '/api/v1/portal/../clientes',
            '/api/v1/portal/%2e%2e/clientes',
            '/api/v1/portal/%2E%2E/%2e%2e/v1/usuarios',
            '/api/v1/portal/.%2e/clientes',
            '/api/v1/portal/..\\clientes',
            '/api/v1/portal/../../../internal/aaa/authorize',
            '/api/v1/clientes',
            '/api/v1/portalx/clientes',
        ]) {
            expect(destinoReenvio(ruta, API), ruta).toBeNull()
        }
    })
})

describe('protección CSRF del proxy', () => {
    it('GET siempre; POST solo del mismo origen', () => {
        expect(origenPermitido('GET', 'portal.example', 'https://malo.example', 'cross-site')).toBe(true)
        expect(origenPermitido('POST', 'portal.example', 'http://portal.example', 'same-origin')).toBe(true)
        expect(origenPermitido('POST', 'portal.example:3001', 'http://portal.example:3001', undefined)).toBe(true)
        expect(origenPermitido('POST', 'portal.example', undefined, undefined)).toBe(true)
    })

    it('rechaza otro sitio, otro puerto, origen nulo o Sec-Fetch-Site ajeno', () => {
        expect(origenPermitido('POST', 'portal.example', 'http://malo.example', undefined)).toBe(false)
        expect(origenPermitido('PUT', 'portal.example', 'http://portal.example:8080', undefined)).toBe(false)
        expect(origenPermitido('POST', 'portal.example', 'null', undefined)).toBe(false)
        expect(origenPermitido('POST', 'portal.example', undefined, 'cross-site')).toBe(false)
        expect(origenPermitido('DELETE', 'portal.example', undefined, 'same-site')).toBe(false)
    })
})

describe('cabeceras de seguridad', () => {
    it('toda respuesta: sin iframes, sin sniffing, sin referer hacia afuera', () => {
        expect(CABECERAS_BASE['X-Frame-Options']).toBe('DENY')
        expect(CABECERAS_BASE['X-Content-Type-Options']).toBe('nosniff')
        expect(CABECERAS_BASE['Referrer-Policy']).toBe('same-origin')
    })

    it('scripts en línea: ejecutables sí (incluido importmap), datos JSON y externos no', () => {
        const html = [
            '<script type="importmap">{"imports":{}}</script>',
            '<script type="module" src="/_nuxt/a.js" crossorigin></script>',
            '<script>window.__NUXT__={}</script>',
            '<script type="application/json" id="__NUXT_DATA__">[1]</script>',
            '<script type="text/javascript">uno()</script>',
        ].join('')
        expect(scriptsEnLinea(html)).toEqual(['{"imports":{}}', 'window.__NUXT__={}', 'uno()'])
    })

    it('CSP: solo el mismo origen, hashes en vez de unsafe-inline, sin iframes', () => {
        const csp = cspDeHtml('<script>window.__NUXT__={}</script>')
        expect(csp).toContain(`script-src 'self' ${hashScript('window.__NUXT__={}')}`)
        expect(csp).toContain('frame-ancestors \'none\'')
        expect(csp).toContain('connect-src \'self\'')
        expect(csp).toContain('object-src \'none\'')
        expect(csp).not.toMatch(/script-src[^;]*unsafe-(inline|eval)/)
        expect(csp).not.toMatch(/https?:\/\//)
        expect(politicaCsp(['a', 'a'])).toContain('script-src \'self\' a;')
    })
})
