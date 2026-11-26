import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import { meAdmin } from '~~/fixtures/auth/sesiones'
import ContaIndicador from '~/components/ContaIndicador.vue'
import PaginaCaja from '~/pages/caja/index.vue'
import PaginaCartera from '~/pages/cartera/index.vue'
import PaginaFinanzas from '~/pages/finanzas/index.vue'
import { esperar } from '../ayudas/esperar'

/**
 * Plan de contabilidad, lote P3: el indicador con ayuda «?» (tablero PlanIndicadorAyuda). Cinco
 * estados, la ayuda siempre con sus cuatro partes y el «?» alcanzable con el teclado.
 */
describe('P3 · ContaIndicador y su ayuda', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
        useEmpresaActiva().elegir(1)
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
        localStorage.clear()
    })

    it('cada indicador tiene sus cuatro partes en palabras simples y un destino que existe', () => {
        const router = useRouter()
        for (const [clave, ayuda] of Object.entries(AYUDA_INDICADORES) as [string, AyudaIndicador][]) {
            expect(ayuda.titulo.length, clave).toBeGreaterThan(2)
            expect(ayuda.queEs.length, `${clave} qué es`).toBeGreaterThan(10)
            expect(ayuda.comoSeCalcula.length, `${clave} cómo se calcula`).toBeGreaterThan(10)
            expect(ayuda.queHacer.length, `${clave} qué hacer`).toBeGreaterThan(10)
            expect(ayuda.nombreContable.length, `${clave} nombre contable`).toBeGreaterThan(3)
            if (ayuda.accion) {
                expect(router.resolve(ayuda.accion.to).matched.length, `${clave} → ${ayuda.accion.to}`).toBeGreaterThan(0)
            }
        }
    })

    it('los nueve indicadores del plan llevan las palabras acordadas y su nombre contable', () => {
        expect(AYUDA_INDICADORES['te-deben'].nombreContable).toBe('Cuentas por cobrar (1.1.03)')
        expect(AYUDA_INDICADORES['debes-proveedores'].nombreContable).toBe('Cuentas por pagar (2.1.03)')
        expect(AYUDA_INDICADORES['dinero-disponible'].nombreContable).toBe('Cajas y bancos (1.1.01, 1.1.02)')
        expect(AYUDA_INDICADORES['dinero-en-camino'].nombreContable).toBe('Fondos en tránsito (1.1.11)')
        expect(AYUDA_INDICADORES['saldo-a-favor'].nombreContable).toBe('Anticipos de clientes (2.1.01)')
        expect(AYUDA_INDICADORES['impuestos-mes'].titulo).toBe('Impuestos del mes')
        expect(AYUDA_INDICADORES['ganancia-mes'].nombreContable).toBe('Resultado del periodo')
        expect(AYUDA_INDICADORES['cobrado-mes'].nombreContable).toBe('Cobranza')
        expect(AYUDA_INDICADORES['no-se-cobrara'].nombreContable).toBe('Castigo de cartera')
    })

    it('estados: bien, atención y urgente con ícono y texto; el color nunca va solo', async () => {
        for (const [estado, texto] of [['bien', 'Bien'], ['atencion', 'Atención'], ['urgente', 'Urgente']] as const) {
            const vista = await mountSuspended(ContaIndicador, { props: { clave: 'te-deben', icono: 'i-lucide-users', valor: 'Q 15,840.50', estado, detalle: '64 facturas de 41 clientes' } })
            const pastilla = vista.get('[data-prueba="kpi-estado"]')
            expect(pastilla.text()).toBe(texto)
            expect(vista.get('[data-prueba="kpi-conta"]').attributes('data-estado')).toBe(estado)
            expect(vista.text()).toContain('Te deben')
            expect(vista.text()).toContain('Q 15,840.50')
            expect(vista.text()).toContain('64 facturas de 41 clientes')
        }
    })

    it('sin datos dice por qué y no pone cifra; cargando es un esqueleto', async () => {
        const sin = await mountSuspended(ContaIndicador, { props: { clave: 'ingreso-recurrente', icono: 'i-lucide-trending-up', valor: null, sinDatos: 'Aparece al emitir el primer mes' } })
        expect(sin.get('[data-prueba="kpi-conta"]').attributes('data-estado')).toBe('sin-datos')
        expect(sin.text()).toContain('Aún sin datos')
        expect(sin.text()).toContain('Aparece al emitir el primer mes')
        expect(sin.text()).not.toMatch(/Q\s?\d/)
        const cargando = await mountSuspended(ContaIndicador, { props: { clave: 'te-deben', icono: 'i-lucide-users', valor: null } })
        expect(cargando.get('[data-prueba="kpi-conta"]').attributes('data-estado')).toBe('cargando')
    })

    it('error: «No se pudo leer» con «Reintentar» que avisa, nunca Q 0.00', async () => {
        const vista = await mountSuspended(ContaIndicador, { props: { clave: 'debes-proveedores', icono: 'i-lucide-truck', valor: 'Q 0.00', problema: { type: 'about:blank', title: 'Falló', status: 500 } } })
        expect(vista.get('[data-prueba="kpi-conta"]').attributes('data-estado')).toBe('error')
        expect(vista.text()).toContain('No se pudo leer')
        expect(vista.text()).not.toContain('Q 0.00')
        const boton = vista.findAll('button').find(b => b.text() === 'Reintentar')
        expect(boton).toBeDefined()
        await boton?.trigger('click')
        expect(vista.emitted('reintentar')).toHaveLength(1)
    })

    it('el «?» es un botón con nombre, se alcanza con Tab y abre la ayuda con sus cuatro partes', async () => {
        const vista = await mountSuspended(ContaIndicador, { props: { clave: 'te-deben', icono: 'i-lucide-users', valor: 'Q 15,840.50' }, attachTo: document.body })
        const ayuda = vista.get('[data-prueba="indicador-ayuda"]')
        expect(ayuda.element.tagName).toBe('BUTTON')
        expect(ayuda.attributes('aria-label')).toBe('Qué es: Te deben')
        expect(ayuda.attributes('tabindex')).not.toBe('-1')
        await ayuda.trigger('click')
        await esperar(() => expect(document.body.querySelector('[data-ayuda-indicador="te-deben"]')).not.toBeNull())
        const cuerpo = document.body.querySelector('[data-ayuda-indicador="te-deben"]')?.textContent ?? ''
        for (const parte of ['Qué es', 'Cómo se calcula', 'Qué hacer', 'Nombre contable: Cuentas por cobrar (1.1.03)']) {
            expect(cuerpo, parte).toContain(parte)
        }
        expect(cuerpo).toContain('Lo que tus clientes aún no han pagado de sus facturas.')
        expect(cuerpo).toContain('Abrir el manual')
    })

    it('con toda la tarjeta enlazada y permiso, el nombre lleva al detalle; sin permiso no enlaza', async () => {
        const con = await mountSuspended(ContaIndicador, { props: { clave: 'cartera-vencida', icono: 'i-lucide-triangle-alert', valor: 'Q 1.00', to: '/cartera' } })
        expect(con.find('[data-prueba="kpi-enlace"]').attributes('href')).toBe('/cartera')
        useUsuarioActual().value = { ...meAdmin, permisos: [] }
        const sin = await mountSuspended(ContaIndicador, { props: { clave: 'cartera-vencida', icono: 'i-lucide-triangle-alert', valor: 'Q 1.00', to: '/cartera' } })
        expect(sin.find('[data-prueba="kpi-enlace"]').exists()).toBe(false)
    })

    it('las pantallas de Finanzas, Cartera y Cajas dan un «?» a cada indicador', async () => {
        const finanzas = await mountSuspended(PaginaFinanzas, { route: '/finanzas' })
        await esperar(() => expect(finanzas.findAll('[data-prueba="kpi-conta"]').length).toBeGreaterThanOrEqual(6))
        const tarjetas = finanzas.findAll('[data-prueba="kpi-conta"]')
        expect(tarjetas.every(t => t.find('[data-prueba="indicador-ayuda"]').exists())).toBe(true)

        const cartera = await mountSuspended(PaginaCartera, { route: '/cartera' })
        await esperar(() => expect(cartera.findAll('[data-prueba="kpi-conta"]')).toHaveLength(3))
        expect(cartera.findAll('[data-prueba="indicador-ayuda"]')).toHaveLength(3)

        const caja = await mountSuspended(PaginaCaja, { route: '/caja' })
        await esperar(() => expect(caja.findAll('[data-contador]')).toHaveLength(4))
        expect(caja.findAll('[data-prueba="indicador-ayuda"]')).toHaveLength(4)
    })
})
