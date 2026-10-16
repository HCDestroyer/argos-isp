import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fijarEmpresaFixture, fijarPagoFixture, fijarSesionFixture, pagosIniciadosFixture } from '~~/fixtures'
import { EMPRESA_FIXTURE } from '~~/fixtures/empresa'
import { PAGO_EN_LINEA_ID_FIXTURE } from '~~/fixtures/pagos'
import PagoEnLinea from '~/components/pago/EnLinea.vue'
import PaginaCorte from '~/pages/corte.vue'

/**
 * Pago en línea (semana 2) contra los fixtures: el botón crea el cobro y sale a la pasarela; el
 * retorno `/corte?pago=<id>` sigue el cobro y el estado hasta "Ya tienes servicio" o el error.
 * Sin tiempos reales: temporizadores falsos y avances explícitos de 5 s.
 */

const { salir } = vi.hoisted(() => ({ salir: vi.fn() }))

mockNuxtImport('salirALaPasarela', () => salir)

const montados: { unmount: () => void }[] = []

async function montar(...args: Parameters<typeof mountSuspended>) {
    const wrapper = await mountSuspended(...args)
    montados.push(wrapper)
    return wrapper
}

async function esperar() {
    for (let i = 0; i < 8; i += 1) {
        await flushPromises()
    }
}

async function montarBoton() {
    clearNuxtData('portal:empresa')
    const wrapper = await montar(PagoEnLinea)
    await esperar()
    return wrapper
}

async function montarRetorno(id: number | string) {
    window.history.replaceState({}, '', `/corte?pago=${id}`)
    clearNuxtData('portal:quien-soy')
    clearNuxtData('portal:empresa')
    const wrapper = await montar(PaginaCorte, { route: `/corte?pago=${id}` })
    await esperar()
    return wrapper
}

/** Avanza el reloj falso un ciclo del estado en vivo (5 s) y deja resolver las consultas. */
async function cicloDe5s() {
    await vi.advanceTimersByTimeAsync(5_000)
    await esperar()
}

beforeEach(() => {
    // shouldAdvanceTime: el montaje de Nuxt (router) usa setTimeout; los ciclos de 5 s los avanza la prueba.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], shouldAdvanceTime: true })
})

afterEach(() => {
    while (montados.length > 0) {
        montados.pop()!.unmount()
    }
    vi.useRealTimers()
    vi.restoreAllMocks()
    salir.mockReset()
    fijarPagoFixture(null)
    fijarEmpresaFixture(EMPRESA_FIXTURE)
    fijarSesionFixture(false)
    window.history.replaceState({}, '', '/')
})

describe('botón "Pagar en línea"', () => {
    it('crea el cobro con Idempotency-Key y sale a la página de pago del proveedor', async () => {
        fijarPagoFixture('pagado')
        const post = vi.spyOn(useApi(), 'POST')
        const wrapper = await montarBoton()
        const pagar = wrapper.find('[data-testid="pagar-en-linea"]')
        expect(pagar.attributes('disabled')).toBeUndefined()

        await pagar.trigger('click')
        await esperar()

        expect(pagosIniciadosFixture()).toBe(1)
        const [ruta, opciones] = post.mock.calls[0] as unknown as [string, { body: unknown, params: { header: Record<string, string> } }]
        expect(ruta).toBe('/api/v1/portal/pagos/iniciar')
        expect(opciones.body).toEqual({})
        expect(opciones.params.header['Idempotency-Key']).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
        expect(salir).toHaveBeenCalledWith({
            id: PAGO_EN_LINEA_ID_FIXTURE,
            url_pago: expect.stringContaining(`/corte?pago=${PAGO_EN_LINEA_ID_FIXTURE}`),
        })
    })

    it('con sesión manda el servicio de /cuenta', async () => {
        fijarSesionFixture(true)
        const post = vi.spyOn(useApi(), 'POST')
        clearNuxtData('portal:empresa')
        const wrapper = await montar(PagoEnLinea, { props: { servicioId: 7 } })
        await esperar()
        await wrapper.find('[data-testid="pagar-en-linea"]').trigger('click')
        await esperar()
        const [, opciones] = post.mock.calls[0] as unknown as [string, { body: unknown }]
        expect(opciones.body).toEqual({ servicio_id: 7 })
    })

    it('si la pasarela no responde muestra el error, no sale y el reintento lleva otra clave', async () => {
        fijarPagoFixture('sin_pasarela')
        const post = vi.spyOn(useApi(), 'POST')
        const wrapper = await montarBoton()

        await wrapper.find('[data-testid="pagar-en-linea"]').trigger('click')
        await esperar()
        const error = wrapper.find('[data-testid="pagar-en-linea-error"]')
        expect(error.exists()).toBe(true)
        expect(error.text()).toContain('Paga por depósito o en nuestra oficina')
        expect(salir).not.toHaveBeenCalled()

        await wrapper.find('[data-testid="pagar-en-linea"]').trigger('click')
        await esperar()
        const claves = post.mock.calls.map(llamada => (llamada as unknown as [string, { params: { header: Record<string, string> } }])[1].params.header['Idempotency-Key'])
        expect(claves).toHaveLength(2)
        expect(claves[0]).not.toBe(claves[1])
    })

    it('sin pasarela configurada se ve apagado y no llama a la API', async () => {
        fijarEmpresaFixture({ ...EMPRESA_FIXTURE, pago_en_linea: false })
        const wrapper = await montarBoton()
        const pagar = wrapper.find('[data-testid="pagar-en-linea"]')
        expect(pagar.attributes('disabled')).toBeDefined()
        expect(wrapper.text()).toContain('El pago en línea no está disponible ahora')
        await pagar.trigger('click')
        expect(pagosIniciadosFixture()).toBe(0)
    })
})

describe('retorno /corte?pago=<id>', () => {
    it('"Procesando tu pago…" hasta la confirmación y luego "Ya tienes servicio" con el monto', async () => {
        fijarPagoFixture('pagado')
        const wrapper = await montarRetorno(PAGO_EN_LINEA_ID_FIXTURE)

        expect(wrapper.find('[data-testid="pago-procesando"]').text()).toContain('Procesando tu pago')
        // Con un pago en camino no se ofrece pagar otra vez.
        expect(wrapper.find('[data-testid="pagar-en-linea"]').exists()).toBe(false)
        const volver = wrapper.findAll('a').find(a => a.text().includes('Volver a la página de pago'))
        expect(volver?.attributes('href')).toContain('/api/v1/pasarela/falsa/')

        await cicloDe5s()
        await cicloDe5s()

        const reactivado = wrapper.find('[data-testid="servicio-reactivado"]')
        expect(reactivado.exists()).toBe(true)
        expect(reactivado.text()).toContain('Ya tienes servicio')
        expect(wrapper.find('[data-testid="reactivado-pago"]').text()).toContain('Q 300.00')
    })

    it('pago rechazado: error claro, se puede volver a pagar y "Entendido" lo descarta', async () => {
        fijarPagoFixture('fallido')
        const wrapper = await montarRetorno(PAGO_EN_LINEA_ID_FIXTURE)
        await cicloDe5s()

        const fallido = wrapper.find('[data-testid="pago-fallido"]')
        expect(fallido.text()).toContain('Tu pago no se completó')
        expect(fallido.text()).toContain('no se hizo ningún cobro')
        expect(wrapper.find('[data-testid="servicio-reactivado"]').exists()).toBe(false)
        expect(wrapper.find('[data-testid="pagar-en-linea"]').exists()).toBe(true)

        const get = vi.spyOn(useApi(), 'GET')
        await cicloDe5s()
        // Ni el cobro ni el estado se siguen consultando: ya no hay reactivación que esperar.
        expect(get).not.toHaveBeenCalled()

        await wrapper.findAll('button').find(b => b.text().includes('Entendido'))!.trigger('click')
        await esperar()
        expect(wrapper.find('[data-testid="pago-fallido"]').exists()).toBe(false)
    })

    it('enlace vencido: lo dice y ofrece volver a empezar', async () => {
        fijarPagoFixture('expirado')
        const wrapper = await montarRetorno(PAGO_EN_LINEA_ID_FIXTURE)
        await cicloDe5s()
        expect(wrapper.find('[data-testid="pago-expirado"]').text()).toContain('El enlace de pago venció')
        expect(wrapper.find('[data-testid="pagar-en-linea"]').exists()).toBe(true)
    })

    it('cobro ajeno o inexistente (404): "No encontramos ese pago" sin reintentar', async () => {
        const wrapper = await montarRetorno(7)
        expect(wrapper.find('[data-testid="pago-no-encontrado"]').text()).toContain('No encontramos ese pago')
        expect(wrapper.find('[data-testid="pagar-en-linea"]').exists()).toBe(true)
    })

    it('sin confirmación en 2 min: lo dice, ofrece revisar y volver a la página de pago', async () => {
        fijarPagoFixture('pendiente')
        const wrapper = await montarRetorno(PAGO_EN_LINEA_ID_FIXTURE)
        for (let i = 0; i < 25; i += 1) {
            await vi.advanceTimersByTimeAsync(5_000)
        }
        await esperar()
        const aviso = wrapper.find('[data-testid="pago-sin-confirmar"]')
        expect(aviso.text()).toContain('Aún no recibimos la confirmación de tu pago')
        expect(aviso.text()).toContain('Revisar de nuevo')
        expect(aviso.text()).toContain('Volver a la página de pago')
    })

    it('?pago con basura se ignora', async () => {
        const wrapper = await montarRetorno('abc')
        expect(wrapper.find('[data-testid="pago-procesando"]').exists()).toBe(false)
        expect(wrapper.find('[data-testid="pagar-en-linea"]').exists()).toBe(true)
    })
})

describe('utilidades del pago', () => {
    it('idPagoDeLaRuta y rutaRetornoPago', () => {
        expect(idPagoDeLaRuta('42')).toBe(42)
        expect(idPagoDeLaRuta(['9'])).toBe(9)
        expect(idPagoDeLaRuta('0')).toBeNull()
        expect(idPagoDeLaRuta('4e2')).toBeNull()
        expect(idPagoDeLaRuta(undefined)).toBeNull()
        expect(rutaRetornoPago(42)).toBe('/corte?pago=42')
    })
})
