import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { manifiestoPwa, nombreCorto, TEMA_MARCA } from '~~/server/utils/manifiesto'
import { politicaCsp } from '~~/server/utils/cabecerasSeguridad'
import { redireccionPortalCautivo } from '~~/server/utils/portalCautivo'

describe('manifiesto PWA', () => {
    it('standalone, teal de la marca, sin salir del origen', () => {
        const manifiesto = manifiestoPwa('Red Altiplano')
        expect(manifiesto.display).toBe('standalone')
        expect(manifiesto.theme_color).toBe(TEMA_MARCA)
        expect(TEMA_MARCA).toBe('#0f766e')
        expect(manifiesto.name).toBe('Red Altiplano · Portal del cliente')
        expect(manifiesto.short_name).toBe('Mi servicio')
        expect(manifiesto.start_url.startsWith('/')).toBe(true)
        expect(manifiesto.scope).toBe('/')
        for (const icono of manifiesto.icons) {
            expect(icono.src.startsWith('/')).toBe(true)
        }
    })

    it('íconos de la marca: 192, 512 y maskable, y existen en public/', () => {
        const manifiesto = manifiestoPwa('X')
        expect(manifiesto.icons.map(i => `${i.sizes}:${i.purpose}`)).toEqual(expect.arrayContaining(['192x192:any', '512x512:any', '512x512:maskable']))
        for (const icono of manifiesto.icons) {
            expect(existsSync(resolve(process.cwd(), `public${icono.src}`)), icono.src).toBe(true)
        }
        expect(existsSync(resolve(process.cwd(), 'public/iconos/apple-touch-icon.png'))).toBe(true)
    })

    it('nombre corto: el de la empresa si cabe bajo el ícono', () => {
        expect(nombreCorto('Netcom')).toBe('Netcom')
        expect(nombreCorto('Cablevisión del Altiplano')).toBe('Mi servicio')
        expect(manifiestoPwa('   ').name).toBe('ArgosIsp · Portal del cliente')
    })

    it('la CSP permite el manifiesto del mismo origen', () => {
        expect(politicaCsp([])).toContain('manifest-src \'self\'')
    })

    it('portal cautivo: el manifiesto y los íconos se sirven con Host ajeno', () => {
        const config = { urlPublica: '', hosts: '' }
        for (const ruta of ['/manifest.webmanifest', '/iconos/icono-192.png', '/iconos/apple-touch-icon.png']) {
            expect(redireccionPortalCautivo({ host: 'example.com', ruta }, config), ruta).toBeNull()
        }
    })
})
