import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
    API_CAIDA_FIXTURE,
    fijarAnunciosFixture,
    fijarFallaFixture,
    fijarSesionFixture,
    fijarSorteosFixture,
    limpiarFallasFixture,
} from '~~/fixtures'
import { ANUNCIOS_FIXTURE } from '~~/fixtures/anuncios'
import { SORTEO_ABIERTO_FIXTURE, SORTEO_EJECUTADO_FIXTURE } from '~~/fixtures/sorteos'
import PaginaCorte from '~/pages/corte.vue'
import PaginaCuenta from '~/pages/cuenta.vue'
import PaginaSorteo from '~/pages/sorteos/[id].vue'

/**
 * Sorteos en el portal (contrato `lealtad.md` §7 y §12): aviso del próximo en el carrusel (corte e
 * inicio), boletos y seudónimo en la cuenta, ganadores por seudónimo y la página pública de bases y
 * verificación.
 */

const { navegar } = vi.hoisted(() => ({ navegar: vi.fn() }))
mockNuxtImport('navigateTo', () => navegar)

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

async function esperar() {
    for (let i = 0; i < 6; i += 1) {
        await flushPromises()
    }
}

async function montarCorte() {
    window.history.replaceState({}, '', '/corte')
    clearNuxtData('portal:quien-soy')
    const wrapper = await mountSuspended(PaginaCorte)
    await esperar()
    return wrapper
}

async function montarCuenta(ruta: string) {
    clearNuxtData(clave => clave === 'portal:cuenta' || clave === 'portal:sorteos')
    useSesionPortal().confirmar()
    const wrapper = await mountSuspended(PaginaCuenta, { route: ruta })
    await esperar()
    return wrapper
}

async function montarSorteo(id: number) {
    clearNuxtData(clave => clave.startsWith('portal:sorteo-publico'))
    const wrapper = await mountSuspended(PaginaSorteo, { route: `/sorteos/${id}` })
    await esperar()
    return wrapper
}

beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', SiempreVisible)
})

afterEach(() => {
    fijarSorteosFixture(null)
    fijarAnunciosFixture(null)
    fijarSesionFixture(false)
    limpiarFallasFixture()
    useSesionPortal().cerrar()
    navegar.mockReset()
    vi.unstubAllGlobals()
})

describe('utilidades de sorteos', () => {
    it('solo imágenes del mismo origen; boletos en texto', () => {
        expect(imagenDelPortal('/api/v1/portal/premios/1.png')).toBe('/api/v1/portal/premios/1.png')
        expect(imagenDelPortal('https://cdn.example.com/a.png')).toBeNull()
        expect(imagenDelPortal('//cdn.example.com/a.png')).toBeNull()
        expect(imagenDelPortal(null)).toBeNull()
        expect(boletosEnTexto(1)).toBe('1 boleto')
        expect(boletosEnTexto(12)).toBe('12 boletos')
        expect(sorteoTerminado('ejecutado')).toBe(true)
        expect(sorteoTerminado('participacion_abierta')).toBe(false)
    })
})

describe('aviso del sorteo en el carrusel', () => {
    it('en /corte, junto a los anuncios y primero; enlace a las bases, sin «mis boletos»', async () => {
        fijarSorteosFixture(true)
        fijarAnunciosFixture(ANUNCIOS_FIXTURE.slice(0, 1))
        const wrapper = await montarCorte()
        const seccion = wrapper.find('[data-testid="promociones-pagina_corte"]')
        expect(seccion.find('h2').text()).toBe('Promociones y sorteos')
        const tarjetas = seccion.findAll('article')
        expect(tarjetas).toHaveLength(2)
        expect(tarjetas[0]!.attributes('data-testid')).toBe('aviso-sorteo')
        const aviso = tarjetas[0]!
        expect(aviso.text()).toContain(SORTEO_ABIERTO_FIXTURE.nombre)
        expect(aviso.text()).toContain('Gran premio: Televisor de 55"')
        expect(aviso.find('[data-testid="aviso-sorteo-bases"]').attributes('href')).toBe('/sorteos/31')
        expect(aviso.find('[data-testid="aviso-sorteo-boletos"]').exists()).toBe(false)
        expect(aviso.find('img').exists()).toBe(false)
    })

    it('sin sorteos publicados ni anuncios, /corte queda igual', async () => {
        const wrapper = await montarCorte()
        expect(wrapper.find('[data-testid="promociones-pagina_corte"]').exists()).toBe(false)
        expect(wrapper.find('[data-testid="aviso-sorteo"]').exists()).toBe(false)
    })

    it('en el inicio de /cuenta, con «Ver mis boletos»', async () => {
        fijarSesionFixture(true)
        fijarSorteosFixture(true)
        const wrapper = await montarCuenta('/cuenta')
        const seccion = wrapper.find('[data-testid="promociones-portal_inicio"]')
        expect(seccion.find('h2').text()).toBe('Sorteos')
        expect(seccion.find('[data-testid="aviso-sorteo-boletos"]').attributes('href')).toBe('/cuenta?seccion=sorteos')
    })
})

describe('/cuenta?seccion=sorteos', () => {
    it('abierto: boletos, seudónimo pendiente, regla de las bases y premios con imagen', async () => {
        fijarSesionFixture(true)
        fijarSorteosFixture(true)
        const wrapper = await montarCuenta('/cuenta?seccion=sorteos')
        const abierto = wrapper.find(`[data-testid="sorteo-${SORTEO_ABIERTO_FIXTURE.id}"]`)
        expect(abierto.find('[data-testid="estado-sorteo"]').text()).toBe('Participación abierta')
        expect(abierto.find('[data-testid="mis-boletos"]').text()).toContain('3')
        expect(abierto.find('[data-testid="mi-codigo"]').text()).toBe('Al cerrar la lista')
        expect(abierto.find('[data-testid="regla-participacion"]').text()).toBe(SORTEO_ABIERTO_FIXTURE.regla_participacion)
        const premios = abierto.findAll('[data-testid="premio-sorteo"]')
        expect(premios).toHaveLength(3)
        // la del mismo origen se pinta; la externa y la que no hay, con el ícono en su lugar
        expect(premios[0]!.find('[data-testid="imagen-premio"]').attributes('src')).toBe('/favicon.svg')
        expect(premios[1]!.find('[data-testid="imagen-premio-vacia"]').exists()).toBe(true)
        expect(premios[2]!.find('[data-testid="imagen-premio-vacia"]').exists()).toBe(true)
        expect(abierto.html()).not.toContain('cdn.example.com')
        expect(abierto.find('[data-testid="ganadores"]').exists()).toBe(false)
        expect(abierto.find('[data-testid="enlace-bases"]').attributes('href')).toBe('/sorteos/31')
    })

    it('ejecutado: ganadores por seudónimo y el suyo marcado', async () => {
        fijarSesionFixture(true)
        fijarSorteosFixture(true)
        const wrapper = await montarCuenta('/cuenta?seccion=sorteos')
        const ejecutado = wrapper.find(`[data-testid="sorteo-${SORTEO_EJECUTADO_FIXTURE.id}"]`)
        expect(ejecutado.find('[data-testid="ganaste"]').exists()).toBe(true)
        expect(ejecutado.find('[data-testid="mi-codigo"]').text()).toBe('K7Q-24M')
        const ganadores = ejecutado.findAll('[data-testid="ganador"]')
        expect(ganadores.map(g => g.find('p').text())).toEqual(['B2X-91P', 'K7Q-24M', 'Z4H-08C'])
        expect(ganadores[1]!.find('[data-testid="gane"]').exists()).toBe(true)
        expect(ganadores[1]!.text()).toContain('Router Wi-Fi 6')
        expect(ganadores[2]!.text()).toContain('Suplente 1')
    })

    it('sin sorteos: lo dice; si no se pueden leer: error con «Reintentar»', async () => {
        fijarSesionFixture(true)
        const vacia = await montarCuenta('/cuenta?seccion=sorteos')
        expect(vacia.find('[data-testid="sin-sorteos"]').exists()).toBe(true)
        vacia.unmount()

        fijarSorteosFixture(true)
        fijarFallaFixture('GET /api/v1/portal/sorteos', API_CAIDA_FIXTURE)
        const caida = await montarCuenta('/cuenta?seccion=sorteos')
        expect(caida.find('[data-testid="sorteos-error"]').text()).toContain('Reintentar')
        expect(caida.find('[data-testid="mis-boletos"]').exists()).toBe(false)
    })
})

describe('página pública /sorteos/:id', () => {
    it('sorteado: bases, ganadores por seudónimo, huellas y datos para verificar', async () => {
        const wrapper = await montarSorteo(SORTEO_EJECUTADO_FIXTURE.id)
        expect(wrapper.find('h1').text()).toBe(SORTEO_EJECUTADO_FIXTURE.nombre)
        expect(wrapper.find('[data-testid="base-participacion"]').text()).toContain('1 boleto por cada servicio')
        expect(wrapper.find('[data-testid="base-plazo"]').text()).toContain('30 días')
        expect(wrapper.find('[data-testid="base-resolucion"]').text()).toContain('GD-QZ-2026-118')
        expect(wrapper.find('[data-testid="base-valor-publico"]').text()).toContain('Lotería Santa Lucía')
        expect(wrapper.findAll('[data-testid="ganador"]')).toHaveLength(3)
        expect(wrapper.find('[data-testid="gane"]').exists()).toBe(false)
        expect(wrapper.find('[data-testid="bases-hash"]').text()).toMatch(/^[0-9a-f]{64}$/)
        expect(wrapper.find('[data-testid="compromiso"]').text()).toMatch(/^[0-9a-f]{64}$/)
        const descarga = wrapper.find('[data-testid="descargar-verificacion"]')
        expect(descarga.attributes('href')).toBe('/api/v1/portal/sorteos/27/verificacion')
        expect(descarga.attributes('download')).toBeDefined()
        expect(wrapper.findAll('button, input, table').filter(e => !e.attributes('class'))).toHaveLength(0)
    })

    it('abierto: sin ganadores ni descarga todavía; inexistente: lo dice', async () => {
        const abierto = await montarSorteo(SORTEO_ABIERTO_FIXTURE.id)
        expect(abierto.find('[data-testid="ganadores"]').exists()).toBe(false)
        expect(abierto.find('[data-testid="descargar-verificacion"]').exists()).toBe(false)
        expect(abierto.find('[data-testid="verificacion"]').text()).toContain('se publican aquí después del sorteo')
        abierto.unmount()

        const nada = await montarSorteo(999)
        expect(nada.find('[data-testid="sorteo-no-existe"]').exists()).toBe(true)
    })
})
