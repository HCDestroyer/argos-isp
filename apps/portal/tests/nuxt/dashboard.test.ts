import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
    fijarEmpresaFixture,
    fijarPromesaFixture,
    fijarSesionFixture,
    fijarTelegramFixture,
} from '~~/fixtures'
import { EMPRESA_FIXTURE, EMPRESA_SIN_CONFIGURAR } from '~~/fixtures/empresa'
import { CUENTA_FIXTURE } from '~~/fixtures/cuenta'
import PaginaCuenta from '~/pages/cuenta.vue'
import PaginaCorte from '~/pages/corte.vue'
import Layout from '~/layouts/default.vue'

/** Dashboard del cliente: accesos rápidos, secciones, barra inferior y sesión en /corte. */

const { navegar } = vi.hoisted(() => ({ navegar: vi.fn() }))
mockNuxtImport('navigateTo', () => navegar)

const montados: { unmount: () => void }[] = []

async function esperar() {
    for (let i = 0; i < 8; i += 1) {
        await flushPromises()
    }
}

async function montarCuenta(ruta = '/cuenta') {
    clearNuxtData('portal:cuenta')
    clearNuxtData(clave => clave.startsWith('portal:empresa'))
    const wrapper = await mountSuspended(PaginaCuenta, { route: ruta })
    montados.push(wrapper)
    await esperar()
    return wrapper
}

function ids(wrapper: Awaited<ReturnType<typeof montarCuenta>>): string[] {
    return wrapper.findAll('[data-testid="accesos-rapidos"] [data-testid]').map(e => e.attributes('data-testid')!)
}

const BASE: EntradaAccesos = {
    modo: 'sesion',
    empresa: EMPRESA_FIXTURE,
    montoAdeudado: '525.00',
    retirado: false,
    promesaDisponible: true,
    telegram: { disponible: true, vinculado: false },
    soporte: { etiqueta: 'Llamar al 7765-4321', to: 'tel:77654321', externo: true },
}

afterEach(() => {
    for (const wrapper of montados.splice(0)) {
        wrapper.unmount()
    }
    fijarSesionFixture(false)
    fijarPromesaFixture(null)
    fijarTelegramFixture(true)
    fijarEmpresaFixture(EMPRESA_FIXTURE)
    navegar.mockReset()
    try {
        localStorage.clear()
    }
    catch {
        // sin almacenamiento
    }
    useSesionPortal().cerrar()
    window.history.replaceState({}, '', '/')
})

describe('accesos rápidos: solo lo que la API aceptaría ahora', () => {
    const idsDe = (entrada: Partial<EntradaAccesos>) => accesosRapidos({ ...BASE, ...entrada }).map(a => a.id)

    it('con todo disponible: los siete, en orden', () => {
        expect(idsDe({})).toEqual(['pagar', 'comprobante', 'deposito', 'promesa', 'facturas', 'telegram', 'soporte'])
    })

    it('sin saldo: ni pagar ni prometer (la API diría sin_deuda)', () => {
        expect(idsDe({ montoAdeudado: '0.00' })).not.toContain('pagar')
        expect(idsDe({ montoAdeudado: '0.00' })).not.toContain('promesa')
        expect(idsDe({ montoAdeudado: null })).not.toContain('pagar')
    })

    it('sin pasarela no hay "Pagar"; con un pago en camino tampoco', () => {
        expect(idsDe({ empresa: { ...EMPRESA_FIXTURE, pago_en_linea: false } })).not.toContain('pagar')
        expect(idsDe({ pagoEnCamino: true })).not.toContain('pagar')
    })

    it('sin cuentas de depósito no se ofrece subir comprobante (la API exige la cuenta)', () => {
        const sinCuentas = idsDe({ empresa: { ...EMPRESA_FIXTURE, cuentas_deposito: [] } })
        expect(sinCuentas).not.toContain('comprobante')
        expect(sinCuentas).toContain('deposito')
        expect(idsDe({ empresa: EMPRESA_SIN_CONFIGURAR })).not.toContain('deposito')
    })

    it('promesa solo con condiciones disponibles; mientras se leen, no aparece', () => {
        expect(idsDe({ promesaDisponible: false })).not.toContain('promesa')
        expect(idsDe({ promesaDisponible: null })).not.toContain('promesa')
        expect(promesaPermitida({ disponible: true, pago_previo: '262.50', monto_promesa: '350.00' })).toBe(false)
        expect(promesaPermitida({ disponible: true, pago_previo: null, monto_promesa: '350.00' })).toBe(true)
        // sin nada vencido no se ofrece aunque diga disponible
        expect(promesaPermitida({ disponible: true, pago_previo: null, monto_promesa: '0.00' })).toBe(false)
        expect(promesaPermitida({ disponible: true, pago_previo: null, monto_promesa: null })).toBe(false)
        expect(promesaPermitida(null)).toBeNull()
    })

    it('Telegram: solo con sesión, bot configurado y sin vincular', () => {
        expect(idsDe({ telegram: { disponible: false, vinculado: false } })).not.toContain('telegram')
        expect(idsDe({ telegram: { disponible: true, vinculado: true } })).not.toContain('telegram')
        expect(idsDe({ modo: 'ip' })).not.toContain('telegram')
    })

    it('mientras la empresa no se lee, solo facturas y soporte', () => {
        expect(idsDe({ empresa: null, promesaDisponible: false, telegram: null })).toEqual(['facturas', 'soporte'])
    })

    it('por IP, "Facturas" lleva a entrar con el código', () => {
        const facturas = accesosRapidos({ ...BASE, modo: 'ip' }).find(a => a.id === 'facturas')
        expect(facturas?.to).toBe('/entrar?por_ip=1')
    })

    it('soporte: teléfono de la empresa o /contacto', () => {
        expect(soporteDe(EMPRESA_FIXTURE).to).toBe('tel:77654321')
        expect(soporteDe(EMPRESA_SIN_CONFIGURAR).to).toBe('/contacto')
    })
})

describe('grupos por empresa', () => {
    it('con una sola empresa, un grupo con el total de sus servicios', () => {
        const grupos = agruparPorEmpresa([
            { ...CUENTA_FIXTURE.servicios[0]!, id: 1, monto_adeudado: '100.10' },
            { ...CUENTA_FIXTURE.servicios[0]!, id: 2, monto_adeudado: '0.20' },
        ], 1)
        expect(grupos).toHaveLength(1)
        expect(grupos[0]!.montoAdeudado).toBe('100.30')
        expect(grupos[0]!.empresa.nombre_comercial).toBe('Red Altiplano')
        expect(agruparPorEmpresa([], null)).toEqual([])
    })

    it('estado más urgente para el encabezado', () => {
        expect(estadoMasUrgente([{ estado: 'activo' }, { estado: 'suspendido' }, { estado: 'limitado' }])).toBe('suspendido')
        expect(estadoMasUrgente([])).toBeNull()
    })
})

describe('/cuenta: inicio y secciones', () => {
    it('inicio: encabezado compacto y accesos según la API', async () => {
        fijarSesionFixture(true)
        const wrapper = await montarCuenta()
        expect(wrapper.find('[data-testid="resumen-cuenta"]').text()).toContain('Q 550.00')
        expect(wrapper.find('[data-testid="resumen-cuenta"]').text()).toContain('Suspendido')
        expect(ids(wrapper)).toEqual([
            'acceso-pagar',
            'acceso-comprobante',
            'acceso-deposito',
            'acceso-promesa',
            'acceso-facturas',
            'acceso-telegram',
            'acceso-soporte',
        ])
        expect(wrapper.find('[data-testid="acceso-facturas"]').attributes('href')).toBe('/cuenta?seccion=facturas')
        // Un solo grupo: sin cabecera de marca por empresa.
        expect(wrapper.find('[data-testid="seccion-inicio"] img').exists()).toBe(false)
    })

    it('con una promesa abierta, "Prometer pago" no aparece (la API diría 409)', async () => {
        fijarSesionFixture(true)
        fijarPromesaFixture('con_promesa')
        const wrapper = await montarCuenta()
        expect(ids(wrapper)).not.toContain('acceso-promesa')
        expect(wrapper.find('[data-testid="pedir-promesa"]').exists()).toBe(false)
    })

    it('sin bot de Telegram no se ofrece vincularlo', async () => {
        fijarSesionFixture(true)
        fijarTelegramFixture(false)
        const wrapper = await montarCuenta()
        expect(ids(wrapper)).not.toContain('acceso-telegram')
    })

    it('"Pagar en línea" lleva a la sección Pagar', async () => {
        fijarSesionFixture(true)
        const wrapper = await montarCuenta()
        await wrapper.find('[data-testid="acceso-pagar"]').trigger('click')
        expect(navegar).toHaveBeenCalledWith('/cuenta?seccion=pagar')
    })

    // Un montaje de /cuenta por prueba: tres en una sola sumaban el tiempo de los tres.
    it.each(['pagar', 'facturas', 'cuenta'] as const)('la sección %s se elige por la URL', async (seccion) => {
        fijarSesionFixture(true)
        const wrapper = await montarCuenta(`/cuenta?seccion=${seccion}`)
        expect(wrapper.find(`[data-testid="seccion-${seccion}"]`).exists(), seccion).toBe(true)
    })

    it('una sección desconocida o sin sección es el inicio', () => {
        expect(seccionDeLaRuta('otra')).toBe('inicio')
        expect(seccionDeLaRuta(undefined)).toBe('inicio')
    })

    it('"Actualizar" vuelve a leer la cuenta', async () => {
        fijarSesionFixture(true)
        const get = vi.spyOn(useApi(), 'GET')
        const wrapper = await montarCuenta()
        get.mockClear()
        await wrapper.find('[data-testid="actualizar-cuenta"]').trigger('click')
        await esperar()
        expect((get.mock.calls as unknown as [string][]).some(([ruta]) => ruta === '/api/v1/portal/cuenta')).toBe(true)
        get.mockRestore()
    })
})

describe('barra de navegación del cliente', () => {
    it('sin sesión no aparece; con sesión, cuatro destinos de 44 px con la sección marcada', async () => {
        const sinSesion = await mountSuspended(Layout, { route: '/cuenta' })
        montados.push(sinSesion)
        expect(sinSesion.find('[data-testid="navegacion-inferior"]').exists()).toBe(false)

        useSesionPortal().confirmar()
        const conSesion = await mountSuspended(Layout, { route: '/cuenta?seccion=facturas' })
        montados.push(conSesion)
        await esperar()
        const barra = conSesion.find('[data-testid="navegacion-inferior"]')
        expect(barra.exists()).toBe(true)
        expect(barra.classes()).toContain('pb-[env(safe-area-inset-bottom)]')
        const destinos = barra.findAll('a')
        expect(destinos.map(d => d.text())).toEqual(['Inicio', 'Pagar', 'Facturas', 'Cuenta'])
        for (const destino of destinos) {
            expect(destino.classes()).toContain('min-h-14')
        }
        expect(barra.find('[data-testid="nav-facturas"]').attributes('aria-current')).toBe('page')
        expect(barra.find('[data-testid="nav-inicio"]').attributes('aria-current')).toBeUndefined()
        expect(conSesion.find('[data-testid="navegacion-superior"]').exists()).toBe(true)
    })
})

describe('/corte y la sesión', () => {
    async function montarCorte() {
        window.history.replaceState({}, '', '/corte')
        clearNuxtData('portal:quien-soy')
        clearNuxtData(clave => clave.startsWith('portal:empresa'))
        const wrapper = await mountSuspended(PaginaCorte)
        montados.push(wrapper)
        await esperar()
        return wrapper
    }

    it('sin pista de sesión no pide la cuenta (ni un 401 por visita)', async () => {
        const get = vi.spyOn(useApi(), 'GET')
        const wrapper = await montarCorte()
        expect((get.mock.calls as unknown as [string][]).some(([ruta]) => ruta === '/api/v1/portal/cuenta')).toBe(false)
        expect(wrapper.find('[data-testid="ver-mi-cuenta"]').attributes('href')).toBe('/entrar?por_ip=1')
        get.mockRestore()
    })

    it('con sesión: facturas lleva a /cuenta y ofrece vincular Telegram', async () => {
        fijarSesionFixture(true)
        localStorage.setItem('argos:portal:sesion', '1')
        const wrapper = await montarCorte()
        expect(useSesionPortal().activa.value).toBe(true)
        expect(wrapper.find('[data-testid="ver-mi-cuenta"]').attributes('href')).toBe('/cuenta?seccion=facturas')
        expect(wrapper.find('[data-testid="acceso-telegram"]').exists()).toBe(true)
    })

    it('pista vieja con la sesión vencida: la borra y sigue por IP', async () => {
        localStorage.setItem('argos:portal:sesion', '1')
        await montarCorte()
        expect(useSesionPortal().activa.value).toBe(false)
        expect(localStorage.getItem('argos:portal:sesion')).toBeNull()
    })

    it('"Prometer pago" por IP solo si las condiciones lo permiten', async () => {
        fijarPromesaFixture('con_pago_previo')
        const wrapper = await montarCorte()
        expect(wrapper.find('[data-testid="solicitar-promesa"]').exists()).toBe(false)
    })
})
