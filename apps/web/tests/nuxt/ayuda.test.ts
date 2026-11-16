import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { defineComponent, h } from 'vue'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import { meAdmin } from '~~/fixtures/auth/sesiones'
import AyudaBoton from '~/components/AyudaBoton.vue'
import { UApp } from '#components'

/**
 * Botón «Ayuda» (contrato `documentacion.md` §6). La clave que el panel manda al sitio de
 * documentación tiene que ser la ruta del archivo de la pantalla: si una pantalla nueva usa una
 * sintaxis de ruta que `claveAyuda` no entiende, esta prueba falla y no queda sin ayuda.
 */

const WEB = [process.cwd(), resolve(process.cwd(), 'apps/web')].find(ruta => existsSync(join(ruta, 'app/pages'))) ?? process.cwd()

/** Clave desde el archivo: `clientes/[id]/index.vue` → `/clientes/[id]`. */
function claveDeArchivo(archivo: string): string {
    const clave = `/${archivo.replace(/\.vue$/, '').replace(/(^|\/)index$/, '')}`.replace(/\/$/, '')
    return clave === '' ? '/' : clave
}

/** Los tooltips de Nuxt UI piden el proveedor de `UApp`, como en la app. */
const BotonEnApp = defineComponent({ render: () => h(UApp, null, { default: () => h(AyudaBoton) }) })

const ARCHIVOS = (readdirSync(join(WEB, 'app/pages'), { recursive: true }) as string[])
    .filter(nombre => nombre.endsWith('.vue'))
    .map(nombre => nombre.split('\\').join('/'))
    .sort()

describe('claveAyuda', () => {
    it('traduce la sintaxis de vue-router a la de los archivos', () => {
        expect(claveAyuda('/')).toBe('/')
        expect(claveAyuda('/clientes')).toBe('/clientes')
        expect(claveAyuda('/clientes/:id()')).toBe('/clientes/[id]')
        expect(claveAyuda('/clientes/:id()/editar')).toBe('/clientes/[id]/editar')
        expect(claveAyuda('/reportes/:reporte()')).toBe('/reportes/[reporte]')
        expect(claveAyuda('/a/:id?')).toBe('/a/[[id]]')
        expect(claveAyuda('/a/:resto(.*)*')).toBe('/a/[...resto]')
        expect(claveAyuda('/a/pre-:id()')).toBe('/a/pre-[id]')
    })

    it('arma la URL de la ayuda con o sin / final en el sitio', () => {
        expect(urlAyuda('https://docs.test/argos/', '/clientes/[id]'))
            .toBe('https://docs.test/argos/ayuda/?pantalla=%2Fclientes%2F%5Bid%5D')
        expect(urlAyuda('https://docs.test/argos', '/')).toBe('https://docs.test/argos/ayuda/?pantalla=%2F')
    })

    it('no da clave en /login ni sin ruta', () => {
        expect(claveAyudaDeRuta([{ path: '/login' }])).toBeNull()
        expect(claveAyudaDeRuta([])).toBeNull()
        expect(claveAyudaDeRuta([{ path: '/padre' }, { path: '/padre/:id()' }])).toBe('/padre/[id]')
    })

    it('cada archivo de app/pages tiene una ruta de Nuxt cuya clave es su ruta de archivo', () => {
        const rutas = useRouter().getRoutes()
        const claves = rutas.map(ruta => claveAyuda(ruta.path))
        const esperadas = ARCHIVOS.map(claveDeArchivo)
        expect(ARCHIVOS.length).toBeGreaterThan(100)
        const sinRuta = esperadas.filter(clave => !claves.includes(clave))
        expect(sinRuta).toEqual([])
        // Y al revés: ninguna ruta de una página da una clave que no sea un archivo.
        const sinArchivo = claves.filter(clave => !esperadas.includes(clave))
        expect(sinArchivo).toEqual([])
    })
})

describe('AyudaBoton', () => {
    // Con sesión: sin ella el middleware lleva a /login, donde el botón no aparece.
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
    })

    it('abre en otra pestaña la ayuda de la pantalla actual', async () => {
        const boton = await mountSuspended(BotonEnApp, { route: '/clientes/1' })
        const enlace = boton.find('[data-prueba="boton-ayuda"]')
        expect(enlace.exists()).toBe(true)
        expect(enlace.attributes('href')).toBe('https://hcdestroyer.github.io/argos-isp/ayuda/?pantalla=%2Fclientes%2F%5Bid%5D')
        expect(enlace.attributes('target')).toBe('_blank')
        expect(enlace.attributes('aria-label')).toContain('Ayuda')
        expect(enlace.attributes('title')).toBe('Ayuda de esta pantalla')
    })

    it('en el inicio manda la clave /', async () => {
        const boton = await mountSuspended(BotonEnApp, { route: '/' })
        expect(boton.find('[data-prueba="boton-ayuda"]').attributes('href')).toMatch(/pantalla=%2F$/)
    })

    it('no aparece en /login', async () => {
        sesionFixture(null)
        useUsuarioActual().value = null
        const boton = await mountSuspended(BotonEnApp, { route: '/login' })
        expect(boton.find('[data-prueba="boton-ayuda"]').exists()).toBe(false)
    })
})
