import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Schema } from '@argosisp/contracts'
import { reiniciarFixtures, sesionFixture, simularFalla } from '~~/fixtures'
import { meAdmin } from '~~/fixtures/auth/sesiones'
import { tareasDe, tareasSemilla } from '~~/fixtures/sistema/datos'
import PaginaTareas from '~/pages/sistema/tareas.vue'
import { esperar } from '../ayudas/esperar'

/** Tareas programadas (`/sistema/tareas`, tablero `SistemaCrons.dc.html`). */
describe('tareas programadas', () => {
    beforeEach(async () => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
        await flushPromises()
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
    })

    it('los fixtures tienen la forma de la API', () => {
        const lista: Schema<'TareasProgramadas'> = tareasDe(tareasSemilla, Date.now())
        expect(lista.data.length).toBe(tareasSemilla.length)
        const vencer = lista.data.find(t => t.clave === 'billing.vencer')!
        expect(vencer.ultima?.repeticiones).toBe(1)
        expect(vencer.ultima_correcta).not.toBeNull()
    })

    it('lista las tareas con estado (ícono y texto), filtros y el punto que crece solo con atención', async () => {
        const vista = await mountSuspended(PaginaTareas, { route: '/sistema/tareas' })
        await esperar(() => expect(vista.find('[data-prueba="lista-tareas"]').exists()).toBe(true))
        expect(vista.get('[data-prueba="resumen-tareas"]').text()).toContain('2 necesitan atención')
        const corte = vista.get('[data-prueba="tarea-billing.corte"]')
        expect(corte.text()).toContain('Corte por hora')
        expect(corte.text()).toContain('Correcta')
        expect(corte.text()).toContain('3 servicios cambiaron de estado')
        expect(vista.findAll('[data-prueba="punto-atencion"]')).toHaveLength(2)
        expect(vista.get('[data-prueba="aviso-atrasada"]').text()).toContain('billing:worker')

        // Filtro «Con error» y buscador
        const pestanaError = vista.findAll('[role="tab"]').find(t => t.text().includes('Con error'))!
        await pestanaError.trigger('mousedown', { button: 0 })
        await pestanaError.trigger('click')
        await esperar(() => expect(vista.findAll('[data-prueba^="tarea-"]')).toHaveLength(1))
        expect(vista.find('[data-prueba="tarea-fiscal.fel"]').exists()).toBe(true)
    })

    it('el detalle muestra lock e historial y «Ejecutar ahora» confirma y encola', async () => {
        const vista = await mountSuspended(PaginaTareas, { route: '/sistema/tareas' })
        await esperar(() => expect(vista.find('[data-prueba="tarea-billing.vencer"]').exists()).toBe(true))
        await vista.get('[data-prueba="tarea-billing.vencer"]').trigger('click')
        await esperar(() => expect(vista.findAll('[data-prueba^="corrida-"]').length).toBe(3))
        const detalle = vista.get('[data-prueba="detalle-tarea"]')
        expect(detalle.text()).toContain('Vencimiento y mora')
        expect(detalle.get('[data-prueba="lock-tarea"]').text()).toContain('Libre')
        expect(detalle.text()).toContain('×6')
        expect(detalle.text()).toContain('A mano')

        await detalle.get('[data-prueba="ejecutar-tarea"]').trigger('click')
        await esperar(() => expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain('¿Ejecutar «Vencimiento y mora» ahora?'))
        const confirmar = [...document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(b => b.textContent?.includes('Ejecutar ahora'))!
        confirmar.click()
        await esperar(() => expect(document.body.querySelector('[role="dialog"]')).toBeNull())
    })

    it('una tarea en curso no se puede ejecutar y muestra quién tiene el lock', async () => {
        const vista = await mountSuspended(PaginaTareas, { route: '/sistema/tareas' })
        await esperar(() => expect(vista.find('[data-prueba="tarea-billing.generar"]').exists()).toBe(true))
        expect(vista.get('[data-prueba="tarea-billing.generar"]').text()).toContain('en worker-2')
        await vista.get('[data-prueba="tarea-billing.generar"]').trigger('click')
        await esperar(() => expect(vista.get('[data-prueba="lock-tarea"]').text()).toContain('Tomado por worker-2'))
        expect(vista.get('[data-prueba="ejecutar-tarea"]').attributes('disabled')).toBeDefined()
    })

    it('si la API falla se ve el error con «Reintentar», sin tareas inventadas', async () => {
        simularFalla('GET /api/v1/sistema/crons', 500)
        const vista = await mountSuspended(PaginaTareas, { route: '/sistema/tareas' })
        await esperar(() => expect(vista.text()).toContain('Reintentar'))
        expect(vista.find('[data-prueba="lista-tareas"]').exists()).toBe(false)
        expect(vista.text()).not.toContain('necesitan atención')
    })
})
