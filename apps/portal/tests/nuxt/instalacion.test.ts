import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fijarCuentaFixture, fijarEmpresaFixture, fijarPagoFixture, fijarSesionFixture } from '~~/fixtures'
import { QUIEN_SOY_PENDIENTE } from '~~/fixtures/corte'
import { CUENTA_FIXTURE, CUENTA_PENDIENTE_FIXTURE } from '~~/fixtures/cuenta'
import { EMPRESA_FIXTURE } from '~~/fixtures/empresa'
import { PAGO_EN_LINEA_ID_FIXTURE } from '~~/fixtures/pagos'
import PaginaCorte from '~/pages/corte.vue'
import PaginaCuenta from '~/pages/cuenta.vue'

/**
 * Servicio pendiente de instalación (`.claude/integration/contratos/instalacion.md` §3): el cliente
 * ve «Instalación pendiente» (icono + texto + color) y sus cargos únicos, sin corte, promesa ni
 * velocidad. La página de corte nunca lo muestra como cortado.
 */

const { navegar } = vi.hoisted(() => ({ navegar: vi.fn() }))
mockNuxtImport('navigateTo', () => navegar)

const montados: { unmount: () => void }[] = []

async function esperar() {
    for (let i = 0; i < 8; i += 1) {
        await flushPromises()
    }
}

async function montar(componente: Parameters<typeof mountSuspended>[0], ruta: string) {
    window.history.replaceState({}, '', ruta)
    clearNuxtData('portal:cuenta')
    clearNuxtData('portal:quien-soy')
    clearNuxtData(clave => clave.startsWith('portal:empresa'))
    const wrapper = await mountSuspended(componente, { route: ruta })
    montados.push(wrapper)
    await esperar()
    return wrapper
}

function boton(wrapper: Awaited<ReturnType<typeof montar>>, etiqueta: string) {
    return wrapper.findAll('button, a').find(b => b.text().includes(etiqueta))
}

/** Palabras de corte o de velocidad que un pendiente nunca debe ver. */
const PROHIBIDAS = ['suspendido', 'Suspendido', 'limitado', 'reactivar', 'Reactivar', 'velocidad', 'Prometer pago', 'Pedir promesa', 'vencida']

afterEach(() => {
    while (montados.length > 0) {
        montados.pop()!.unmount()
    }
    vi.useRealTimers()
    fijarSesionFixture(false)
    fijarCuentaFixture(null)
    fijarPagoFixture(null)
    fijarEmpresaFixture(EMPRESA_FIXTURE)
    navegar.mockReset()
    window.history.replaceState({}, '', '/')
})

describe('presentación del estado', () => {
    it('«Instalación pendiente» con icono Lucide y color informativo (nunca el rojo del corte)', () => {
        expect(ESTADOS_SERVICIO.pendiente_instalacion).toEqual({
            etiqueta: 'Instalación pendiente',
            color: 'info',
            icono: 'i-lucide-calendar-clock',
        })
        expect(esPendienteInstalacion('pendiente_instalacion')).toBe(true)
        expect(esPendienteInstalacion('suspendido')).toBe(false)
        expect(esPendienteInstalacion(null)).toBe(false)
    })

    it('mensajeCorte: nunca como cortado; con cargos invita a pagarlos', () => {
        const mensaje = mensajeCorte(QUIEN_SOY_PENDIENTE)
        expect(mensaje.titulo).toBe('Tu instalación está pendiente')
        expect(mensaje.descripcion).toContain('cuando el técnico termine la instalación')
        expect(mensaje.descripcion).toContain('pagar tus cargos pendientes')
        const sinCargos = mensajeCorte({ ...QUIEN_SOY_PENDIENTE, monto_adeudado: '0.00' })
        expect(sinCargos.descripcion).not.toContain('cargos')
        for (const texto of [mensaje.titulo, mensaje.descripcion]) {
            expect(texto).not.toMatch(/suspendido|limitado|velocidad|promesa/i)
        }
    })

    it('estado más urgente: va después de activo y antes de retirado (mismo orden que la API)', () => {
        expect(estadoMasUrgente([{ estado: 'pendiente_instalacion' }, { estado: 'activo' }])).toBe('activo')
        expect(estadoMasUrgente([{ estado: 'retirado' }, { estado: 'pendiente_instalacion' }])).toBe('pendiente_instalacion')
        expect(estadoMasUrgente([{ estado: 'pendiente_instalacion' }, { estado: 'suspendido' }])).toBe('suspendido')
    })
})

describe('/corte con un servicio pendiente de instalación', () => {
    it('muestra la instalación pendiente y sus cargos; sin vencidas, promesa ni espera de reactivación', async () => {
        const wrapper = await montar(PaginaCorte, '/corte?fixture=pendiente')
        const texto = wrapper.text()
        expect(texto).toContain('Hola, Ana L.')
        expect(texto).toContain('Tu instalación está pendiente')
        expect(texto).toContain('Instalación pendiente')
        expect(texto).toContain('Cargos pendientes')
        expect(wrapper.find('[data-testid="monto-adeudado"]').text()).toBe('Q 250.00')
        expect(wrapper.find('[data-testid="instalacion-pendiente"]').text()).toContain('el día de la instalación')

        // Nada de corte: ni vencidas en rojo, ni promesa, ni "revisar mi servicio".
        expect(wrapper.find('[data-testid="facturas-vencidas"]').exists()).toBe(false)
        expect(wrapper.find('[data-testid="estado-en-vivo"]').exists()).toBe(false)
        expect(wrapper.find('[data-testid="solicitar-promesa"]').exists()).toBe(false)
        for (const palabra of PROHIBIDAS) {
            expect(texto, palabra).not.toContain(palabra)
        }

        // Los cargos sí se pagan: en línea, por depósito o con comprobante.
        expect(boton(wrapper, 'Pagar en línea')?.attributes('disabled')).toBeUndefined()
        expect(boton(wrapper, 'Subir comprobante')).toBeDefined()
        expect(boton(wrapper, 'Ver datos de depósito')).toBeDefined()
    })

    it('el badge lleva icono + texto + color', async () => {
        const wrapper = await montar(PaginaCorte, '/corte?fixture=pendiente')
        const badge = wrapper.findAll('span').find(s => s.text() === 'Instalación pendiente' && s.classes().some(c => c.includes('info')))
        expect(badge, 'badge informativo').toBeDefined()
        expect(badge!.html()).toContain('calendar-clock')
    })

    it('pagar los cargos en línea: "Recibimos tu pago" sin prometer reactivación ni "Ya tienes servicio"', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], shouldAdvanceTime: true })
        fijarPagoFixture('pagado')
        const wrapper = await montar(PaginaCorte, `/corte?pago=${PAGO_EN_LINEA_ID_FIXTURE}&fixture=pendiente`)
        for (let i = 0; i < 3; i += 1) {
            await vi.advanceTimersByTimeAsync(5_000)
            await esperar()
        }
        const recibido = wrapper.find('[data-testid="pago-recibido-instalacion"]')
        expect(recibido.exists()).toBe(true)
        expect(recibido.text()).toContain('Lo abonamos a tus cargos')
        expect(wrapper.find('[data-testid="servicio-reactivado"]').exists()).toBe(false)
        expect(wrapper.text()).not.toContain('reactivando')
    })
})

describe('/cuenta con un servicio pendiente de instalación', () => {
    it('servicio con «Instalación pendiente» y sus cargos únicos; sin promesa ni aviso de corte', async () => {
        fijarSesionFixture(true)
        fijarCuentaFixture(CUENTA_PENDIENTE_FIXTURE)
        const wrapper = await montar(PaginaCuenta, '/cuenta')
        const servicio = wrapper.find('[data-testid="servicio-cuenta"]')
        expect(servicio.text()).toContain('Instalación pendiente')
        expect(servicio.find('[data-testid="instalacion-pendiente"]').text()).toContain('cuando el técnico termine la instalación')

        const cargos = servicio.findAll('[data-testid="cargo-instalacion"]')
        expect(cargos).toHaveLength(1)
        expect(cargos[0]!.text()).toContain('Cargo 1310')
        expect(cargos[0]!.text()).toContain('Q 250.00')

        expect(wrapper.find('[data-testid="aviso-reactivar"]').exists()).toBe(false)
        expect(wrapper.find('[data-testid="pedir-promesa"]').exists()).toBe(false)
        expect(boton(wrapper, 'Prometer pago')).toBeUndefined()
        for (const palabra of ['suspendido', 'Suspendido', 'velocidad', 'Bloqueado por suspensión']) {
            expect(wrapper.text(), palabra).not.toContain(palabra)
        }
    })

    it('un servicio instalado no cambia: sin bloque de instalación pendiente', async () => {
        fijarSesionFixture(true)
        fijarCuentaFixture(CUENTA_FIXTURE)
        const wrapper = await montar(PaginaCuenta, '/cuenta')
        expect(wrapper.find('[data-testid="instalacion-pendiente"]').exists()).toBe(false)
        expect(wrapper.find('[data-testid="cargos-instalacion"]').exists()).toBe(false)
        expect(wrapper.find('[data-testid="aviso-reactivar"]').exists()).toBe(true)
    })
})
