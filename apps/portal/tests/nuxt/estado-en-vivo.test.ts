import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import PaginaCorte from '~/pages/corte.vue'

/**
 * Estado en vivo de /corte (tarea 6) contra los fixtures: `?fixture=reactivacion` responde
 * suspendido en la primera consulta a /portal/estado y activo desde la segunda.
 */

function usarEscenario(fixture: string) {
    window.history.replaceState({}, '', `/corte?fixture=${fixture}`)
}

async function esperarHasta(condicion: () => boolean, ms = 2_000) {
    const fin = Date.now() + ms
    while (!condicion()) {
        if (Date.now() > fin) {
            throw new Error('La condición no se cumplió a tiempo')
        }
        await new Promise(resolve => setTimeout(resolve, 10))
    }
}

/** Monta el composable con intervalos cortos y devuelve su estado. */
async function montarVigilancia(opciones: { intervaloMs: number, duracionMs: number }) {
    let estado!: ReturnType<typeof useEstadoServicio>
    const Prueba = defineComponent({
        setup() {
            estado = useEstadoServicio(opciones)
            return () => h('div')
        },
    })
    const wrapper = await mountSuspended(Prueba)
    return { estado, wrapper }
}

afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    window.history.replaceState({}, '', '/')
})

describe('useEstadoServicio', () => {
    it('consulta hasta ver activo y se detiene', async () => {
        usarEscenario('reactivacion')
        await useApi().GET('/api/v1/portal/quien-soy') // reinicia el contador del fixture
        const espia = vi.spyOn(useApi(), 'GET')
        const { estado, wrapper } = await montarVigilancia({ intervaloMs: 20, duracionMs: 2_000 })

        estado.vigilar()
        expect(estado.vigilando.value).toBe(true)
        await esperarHasta(() => estado.activo.value)
        expect(estado.vigilando.value).toBe(false)
        expect(estado.ultimo.value).toEqual({ identificado: true, estado: 'activo', monto_adeudado: '0.00' })

        const llamadas = espia.mock.calls.length
        await new Promise(resolve => setTimeout(resolve, 80))
        expect(espia.mock.calls.length).toBe(llamadas)
        expect(espia.mock.calls.every(llamada => (llamada as unknown[])[0] === '/api/v1/portal/estado')).toBe(true)
        wrapper.unmount()
    })

    it('se rinde al terminar el plazo sin ver activo', async () => {
        usarEscenario('suspendido')
        const { estado, wrapper } = await montarVigilancia({ intervaloMs: 20, duracionMs: 100 })

        estado.vigilar()
        await esperarHasta(() => estado.agotado.value)
        expect(estado.vigilando.value).toBe(false)
        expect(estado.activo.value).toBe(false)

        // Volver a pedirlo reinicia el plazo.
        estado.vigilar()
        expect(estado.agotado.value).toBe(false)
        expect(estado.vigilando.value).toBe(true)
        wrapper.unmount()
        expect(estado.vigilando.value).toBe(false)
    })

    it('vigilar dos veces no duplica las consultas', async () => {
        usarEscenario('suspendido')
        const espia = vi.spyOn(useApi(), 'GET')
        const { estado, wrapper } = await montarVigilancia({ intervaloMs: 50, duracionMs: 10_000 })

        estado.vigilar()
        estado.vigilar()
        estado.vigilar()
        await new Promise(resolve => setTimeout(resolve, 130))
        // Inmediata + a los 50 ms + a los 100 ms: 3, nunca 9.
        expect(espia.mock.calls.length).toBeLessThanOrEqual(3)
        wrapper.unmount()
    })
})

describe('/corte con estado en vivo', () => {
    async function montarCorte(fixture: string) {
        usarEscenario(fixture)
        clearNuxtData('portal:quien-soy')
        const wrapper = await mountSuspended(PaginaCorte)
        await flushPromises()
        return wrapper
    }

    it('con promesa activa vigila desde que carga y muestra "Ya tienes servicio" al ver activo', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
        const wrapper = await montarCorte('reactivacion')
        expect(wrapper.find('[data-testid="estado-en-vivo"]').text()).toContain('Revisando tu servicio')

        await vi.advanceTimersByTimeAsync(5_000)
        await flushPromises()

        const reactivado = wrapper.find('[data-testid="servicio-reactivado"]')
        expect(reactivado.exists()).toBe(true)
        expect(reactivado.text()).toContain('Ya tienes servicio')
        const seguir = wrapper.findAll('a').find(a => a.text().includes('Seguir navegando'))
        expect(seguir?.attributes('href')).toBe('http://example.com/')
        // Sin datos personales ni montos en la vista de reactivación.
        expect(wrapper.text()).not.toContain('Juan P.')
        expect(wrapper.find('[data-testid="monto-adeudado"]').exists()).toBe(false)
        wrapper.unmount()
    })

    it('"Ya pagué: revisar mi servicio" empieza a vigilar', async () => {
        const wrapper = await montarCorte('suspendido')
        const revisar = wrapper.findAll('button').find(b => b.text().includes('Ya pagué'))
        expect(revisar).toBeDefined()
        await revisar!.trigger('click')
        expect(wrapper.find('[data-testid="estado-en-vivo"]').text()).toContain('Revisando tu servicio')
        wrapper.unmount()
    })

    it('al volver a la pestaña empieza a vigilar', async () => {
        const wrapper = await montarCorte('suspendido')
        expect(wrapper.find('[data-testid="estado-en-vivo"]').text()).not.toContain('Revisando')
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
        document.dispatchEvent(new Event('visibilitychange'))
        await flushPromises()
        expect(wrapper.find('[data-testid="estado-en-vivo"]').text()).toContain('Revisando tu servicio')
        wrapper.unmount()
    })

    it('servicio ya activo o IP desconocida: no vigila', async () => {
        const activo = await montarCorte('activo')
        expect(activo.find('[data-testid="estado-en-vivo"]').exists()).toBe(false)
        activo.unmount()
        const desconocido = await montarCorte('desconocido')
        expect(desconocido.find('[data-testid="estado-en-vivo"]').exists()).toBe(false)
        desconocido.unmount()
    })
})
