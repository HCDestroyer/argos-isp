import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import { bd } from '~~/fixtures/bd'
import { meAdmin, meCajero } from '~~/fixtures/auth/sesiones'
import PaginaCaja from '~/pages/caja/index.vue'
import { esperar } from '../ayudas/esperar'

/** Alta de caja por empresa (`POST /cajas`, `cajas.crear`, A3). */
describe('alta de caja', () => {
    beforeEach(async () => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
        await flushPromises()
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
        localStorage.clear()
    })

    it('API: crea la caja con su subcuenta en la empresa elegida; el nombre repetido en la misma empresa es 409', async () => {
        const creada = await useCajas().crear({ nombre: 'Ventanilla 2', cajero_id: null, empresa_id: 2 }, nuevaClaveIdempotencia())
        expect(creada.ok && creada.data.empresa_id).toBe(2)
        const cuenta = bd.cuentas.find(c => creada.ok && c.id === creada.data.cuenta_id)
        expect(cuenta?.codigo).toMatch(/^1\.1\.01\.\d{2}$/)
        expect(cuenta?.empresa_id).toBe(2)

        const repetida = await useCajas().crear({ nombre: 'Caja Sur', cajero_id: null, empresa_id: 2 }, nuevaClaveIdempotencia())
        expect(!repetida.ok && repetida.problema.status).toBe(409)
        expect(!repetida.ok && codigoProblema(repetida.problema)).toBe('caja_duplicada')
        // El mismo nombre en otra empresa sí vale.
        const otra = await useCajas().crear({ nombre: 'Caja Sur', cajero_id: null, empresa_id: 1 }, nuevaClaveIdempotencia())
        expect(otra.ok).toBe(true)
    })

    it('API: sin cajas.crear (cajero), 403', async () => {
        sesionFixture('fixture-cajero')
        useUsuarioActual().value = meCajero
        const resultado = await useCajas().crear({ nombre: 'Otra', cajero_id: null, empresa_id: 1 }, nuevaClaveIdempotencia())
        expect(!resultado.ok && resultado.problema.status).toBe(403)
    })

    it('en pantalla: «Nueva caja» (en «Más») muestra el error de la API; el cajero no la tiene', async () => {
        const vista = await mountSuspended(PaginaCaja, { route: '/caja' })
        await esperar(() => expect(vista.find('[data-prueba="mas-cajas"]').exists()).toBe(true))
        const estado = (vista.vm as unknown as { $: { setupState: { administrarAbierto: boolean, altaAbierta: boolean } } }).$.setupState
        // «Cajas e impresión»: cada caja dice de qué empresa es.
        estado.administrarAbierto = true
        await esperar(() => expect(document.querySelector('[data-caja="4"]')?.textContent).toContain('Fibra del Sur'))
        estado.administrarAbierto = false

        estado.altaAbierta = true
        await esperar(() => expect(document.querySelector('#form-crear-caja')).not.toBeNull())
        const nombre = document.querySelector<HTMLInputElement>('#form-crear-caja input')
        expect(nombre).not.toBeNull()
        if (!nombre) {
            return
        }
        nombre.value = 'Caja Sur'
        nombre.dispatchEvent(new Event('input'))
        await flushPromises()
        document.querySelector('#form-crear-caja')?.dispatchEvent(new Event('submit'))
        // Sin empresa elegida (Todas), la API responde 422 empresa_requerida y se ve.
        await esperar(() => expect(document.querySelector('#form-crear-caja')?.textContent).toContain('Elige la empresa de la caja'))
        expect(bd.cajas).toHaveLength(5)
        vista.unmount()

        sesionFixture('fixture-cajero')
        useUsuarioActual().value = meCajero
        await flushPromises()
        const cajero = await mountSuspended(PaginaCaja, { route: '/caja' })
        await esperar(() => expect(cajero.find('[data-prueba="contadores-cajas"]').exists()).toBe(true))
        const items = (cajero.vm as unknown as { $: { setupState: { itemsMas: { label: string }[][] } } }).$.setupState.itemsMas
        expect(items.flat().map(i => i.label)).not.toContain('Nueva caja')
        cajero.unmount()
    })

    it('en pantalla: con la empresa elegida, la caja nueva queda en esa empresa', async () => {
        useEmpresaActiva().elegir(2)
        await flushPromises()
        const vista = await mountSuspended(PaginaCaja, { route: '/caja' })
        await esperar(() => expect(vista.find('[data-prueba="mas-cajas"]').exists()).toBe(true))
        const estado = (vista.vm as unknown as { $: { setupState: { altaAbierta: boolean } } }).$.setupState
        estado.altaAbierta = true
        await esperar(() => expect(document.querySelector('#form-crear-caja input')).not.toBeNull())
        const nombre = document.querySelector<HTMLInputElement>('#form-crear-caja input')
        if (!nombre) {
            return
        }
        nombre.value = 'Ventanilla Sur'
        nombre.dispatchEvent(new Event('input'))
        await flushPromises()
        document.querySelector('#form-crear-caja')?.dispatchEvent(new Event('submit'))
        await esperar(() => expect(bd.cajas.some(c => c.nombre === 'Ventanilla Sur' && c.empresa_id === 2)).toBe(true))
        vista.unmount()
    })
})
