import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eventosAnunciosFixture, fijarAnunciosFixture, fijarFallaFixture, fijarSesionFixture, limpiarFallasFixture } from '~~/fixtures'
import { ANUNCIOS_FIXTURE } from '~~/fixtures/anuncios'
import PaginaCorte from '~/pages/corte.vue'
import PaginaCuenta from '~/pages/cuenta.vue'
import Carrusel from '~/components/promo/Carrusel.vue'
import { reiniciarEventosAnuncios } from '~/composables/useAnuncios'

/** `prefers-reduced-motion` del sistema para la prueba. */
function movimiento(reducido: boolean) {
    vi.stubGlobal('matchMedia', (consulta: string) => ({
        matches: consulta.includes('reduced-motion') ? reducido : false,
        media: consulta,
        addEventListener: () => {},
        removeEventListener: () => {},
    }))
}

/** IntersectionObserver que da todo por visible en cuanto se observa. */
class SiempreVisible {
    constructor(private readonly alCambiar: (entradas: Array<{ isIntersecting: boolean }>) => void) {}
    observe() {
        this.alCambiar([{ isIntersecting: true }])
    }

    unobserve() {}
    disconnect() {}
    takeRecords() {
        return []
    }
}

const montados: Array<{ unmount: () => void }> = []

async function montarCorte() {
    window.history.replaceState({}, '', '/corte')
    clearNuxtData('portal:quien-soy')
    const wrapper = await mountSuspended(PaginaCorte)
    montados.push(wrapper)
    await flushPromises()
    await flushPromises()
    return wrapper
}

beforeEach(() => {
    reiniciarEventosAnuncios()
    movimiento(false)
    vi.stubGlobal('IntersectionObserver', SiempreVisible)
})

afterEach(() => {
    for (const wrapper of montados.splice(0)) {
        wrapper.unmount()
    }
    fijarAnunciosFixture(null)
    limpiarFallasFixture()
    fijarSesionFixture(false)
    vi.unstubAllGlobals()
    window.history.replaceState({}, '', '/')
})

describe('promociones en /corte', () => {
    it('sin anuncios la página queda igual: ni sección, ni título, ni espacio reservado', async () => {
        fijarAnunciosFixture([])
        const wrapper = await montarCorte()
        expect(wrapper.find('[data-testid="promociones-pagina_corte"]').exists()).toBe(false)
        expect(wrapper.text()).not.toContain('Promociones')
    })

    it('un anuncio: tarjeta sin carrusel, debajo de pagar y de pedir promesa', async () => {
        fijarAnunciosFixture([ANUNCIOS_FIXTURE[0]!])
        const wrapper = await montarCorte()
        const seccion = wrapper.find('[data-testid="promociones-pagina_corte"]')
        expect(seccion.exists()).toBe(true)
        expect(seccion.find('[data-testid="promo-carrusel"]').exists()).toBe(false)
        expect(seccion.findAll('[data-testid="promo-tarjeta"]')).toHaveLength(1)

        // Orden en el documento: pagar y promesa primero; la promo después. Nunca en un modal.
        const html = wrapper.html()
        const promo = html.indexOf('data-testid="promociones-pagina_corte"')
        expect(html.indexOf('data-testid="pagar-en-linea"')).toBeGreaterThan(-1)
        expect(html.indexOf('data-testid="pagar-en-linea"')).toBeLessThan(promo)
        expect(html.indexOf('data-testid="solicitar-promesa"')).toBeGreaterThan(-1)
        expect(html.indexOf('data-testid="solicitar-promesa"')).toBeLessThan(promo)
        expect(seccion.element.closest('[role="dialog"]')).toBeNull()
    })

    it('imagen con tamaño fijo, carga diferida y texto alternativo', async () => {
        fijarAnunciosFixture([ANUNCIOS_FIXTURE[0]!])
        const wrapper = await montarCorte()
        const imagen = wrapper.find('[data-testid="promo-imagen"]')
        expect(imagen.attributes('loading')).toBe('lazy')
        expect(imagen.attributes('width')).toBe('512')
        expect(imagen.attributes('height')).toBe('512')
        expect(imagen.attributes('alt')).toBe(ANUNCIOS_FIXTURE[0]!.imagen!.alt)
    })

    it('el texto del anuncio se muestra como texto, nunca como HTML', async () => {
        fijarAnunciosFixture([{ ...ANUNCIOS_FIXTURE[2]!, titulo: '<b>Gratis</b>', texto: '<img src=x onerror=alert(1)>' }])
        const wrapper = await montarCorte()
        const tarjeta = wrapper.find('[data-testid="promo-tarjeta"]')
        expect(tarjeta.text()).toContain('<b>Gratis</b>')
        expect(tarjeta.text()).toContain('<img src=x onerror=alert(1)>')
        expect(tarjeta.find('b').exists()).toBe(false)
        expect(tarjeta.findAll('img')).toHaveLength(0)
    })

    it('cuenta la vista al estar en pantalla y el clic del botón, sin datos personales', async () => {
        fijarAnunciosFixture([ANUNCIOS_FIXTURE[0]!])
        const wrapper = await montarCorte()
        await wrapper.find('[data-testid="promo-boton"]').trigger('click')
        await flushPromises()
        const eventos = eventosAnunciosFixture()
        expect(eventos.map(e => [e.id, e.tipo, e.lugar])).toEqual([
            [101, 'vista', 'pagina_corte'],
            [101, 'clic', 'pagina_corte'],
        ])
        // el visitante es un UUID por sesión del navegador, el mismo en los dos eventos
        expect(eventos[0]!.visitante).toMatch(/^[0-9a-f-]{36}$/)
        expect(eventos[1]!.visitante).toBe(eventos[0]!.visitante)
    })

    it('varios anuncios: carrusel con flechas, puntos y pausa; sin autoavance con movimiento reducido', async () => {
        fijarAnunciosFixture(ANUNCIOS_FIXTURE)
        const wrapper = await montarCorte()
        const carrusel = wrapper.find('[data-testid="promo-carrusel"]')
        expect(carrusel.exists()).toBe(true)
        expect(carrusel.findAll('[data-testid="promo-tarjeta"]')).toHaveLength(3)
        // flechas con su nombre accesible (el de la traducción de Nuxt UI)
        for (const flecha of ['prev', 'next']) {
            expect(carrusel.find(`[data-slot="${flecha}"]`).attributes('aria-label')).toBeTruthy()
        }
        expect(carrusel.find('[role="tablist"]').exists()).toBe(true)
        expect(carrusel.find('[aria-roledescription="carousel"]').attributes('aria-label')).toBe('Promociones')
        // cada diapositiva dice cuál es
        expect(carrusel.findAll('article').map(a => a.attributes('aria-label'))).toEqual([
            `1 de 3: ${ANUNCIOS_FIXTURE[0]!.titulo}`,
            `2 de 3: ${ANUNCIOS_FIXTURE[1]!.titulo}`,
            `3 de 3: ${ANUNCIOS_FIXTURE[2]!.titulo}`,
        ])

        const pausa = carrusel.find('[data-testid="promo-pausa"]')
        expect(pausa.attributes('aria-pressed')).toBe('false')
        await pausa.trigger('click')
        expect(carrusel.find('[data-testid="promo-pausa"]').attributes('aria-pressed')).toBe('true')
        expect(carrusel.find('[data-testid="promo-pausa"]').text()).toContain('Reanudar')
    })

    it('el carrusel solo avanza solo sin movimiento reducido y sin pausa', async () => {
        movimiento(true)
        const quieto = await mountSuspended(Carrusel, { props: { anuncios: ANUNCIOS_FIXTURE, visible: true } })
        await flushPromises()
        expect(quieto.findComponent({ name: 'UCarousel' }).props('autoplay')).toBe(false)
        expect(quieto.find('[data-testid="promo-pausa"]').exists()).toBe(false)

        movimiento(false)
        const movil = await mountSuspended(Carrusel, { props: { anuncios: ANUNCIOS_FIXTURE, visible: true } })
        await flushPromises()
        expect(movil.findComponent({ name: 'UCarousel' }).props('autoplay')).toMatchObject({
            delay: 8000,
            stopOnMouseEnter: true,
            stopOnFocusIn: true,
        })
        await movil.find('[data-testid="promo-pausa"]').trigger('click')
        expect(movil.findComponent({ name: 'UCarousel' }).props('autoplay')).toBe(false)
    })

    it('si la lectura falla, aviso con Reintentar (sin inventar promociones)', async () => {
        fijarFallaFixture('GET /api/v1/portal/anuncios', { status: 502, cuerpo: { type: 'about:blank', title: 'Servicio no disponible', status: 502 } })
        const wrapper = await montarCorte()
        const error = wrapper.find('[data-testid="promociones-error"]')
        expect(error.exists()).toBe(true)
        expect(error.text()).toContain('No pudimos cargar las promociones')
        expect(wrapper.find('[data-testid="promo-tarjeta"]').exists()).toBe(false)

        limpiarFallasFixture()
        fijarAnunciosFixture([ANUNCIOS_FIXTURE[1]!])
        const reintentar = error.findAll('button').find(b => b.text().includes('Reintentar'))!
        await reintentar.trigger('click')
        await flushPromises()
        expect(wrapper.find('[data-testid="promociones-error"]').exists()).toBe(false)
        expect(wrapper.find('[data-testid="promo-tarjeta"]').text()).toContain('Refiere a un vecino')
    })
})

describe('promociones en el inicio de /cuenta', () => {
    it('con sesión las muestra al final del inicio, en su lugar (portal_inicio)', async () => {
        fijarSesionFixture(true)
        fijarAnunciosFixture(ANUNCIOS_FIXTURE.slice(0, 2))
        clearNuxtData('portal:cuenta')
        const wrapper = await mountSuspended(PaginaCuenta, { route: '/cuenta' })
        await flushPromises()
        await flushPromises()
        const seccion = wrapper.find('[data-testid="seccion-inicio"] [data-testid="promociones-portal_inicio"]')
        expect(seccion.exists()).toBe(true)
        expect(seccion.findAll('[data-testid="promo-tarjeta"]')).toHaveLength(2)
        await flushPromises()
        expect(eventosAnunciosFixture().every(e => e.lugar === 'portal_inicio')).toBe(true)
    })
})
