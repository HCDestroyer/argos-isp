import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reiniciarFixtures, sesionFixture, simularFalla } from '~~/fixtures'
import BitacoraDetalle from '~/components/BitacoraDetalle.vue'
import PaginaBitacora from '~/pages/bitacora/index.vue'

describe('tarea 14 · bitácora', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
    })

    afterEach(() => {
        sesionFixture(null)
    })

    it('filtros por actor, canal, acción, entidad y fecha (días de Guatemala en UTC)', async () => {
        const api = useBitacora()
        const suspender = await api.acciones({ accion: 'servicios.suspender' })
        expect(suspender.ok && suspender.data.data.length).toBeGreaterThan(0)
        expect(suspender.ok && suspender.data.data.every(a => a.accion === 'servicios.suspender')).toBe(true)

        const sistema = await api.acciones({ actor_id: 1, canal: 'panel' })
        expect(sistema.ok && sistema.data.data.every(a => a.actor_id === 1 && a.canal === 'panel')).toBe(true)

        const delDia = await api.acciones({ desde: inicioDiaGuatemala('2026-10-10'), hasta: finDiaGuatemala('2026-10-10') })
        expect(delDia.ok).toBe(true)
        if (delDia.ok) {
            expect(delDia.data.data.length).toBeGreaterThan(0)
            expect(delDia.data.data.every(a => fechaGuatemala(a.created_at) === '2026-10-10')).toBe(true)
        }
    })

    it('historial de cambios por entidad: la contraseña PPPoE llega y se muestra como ***', async () => {
        const cambios = await useBitacora().cambios({ entidad_tipo: 'servicio', entidad_id: 1 })
        expect(cambios.ok).toBe(true)
        if (!cambios.ok) {
            return
        }
        const clave = cambios.data.data.find(c => c.campo === 'pass_ppp')
        expect(clave?.despues).toBe('***')
        expect(valorCambio(clave?.despues)).toBe('***')
        expect(valorCambio(null)).toBe('vacío')
        expect(valorCambio(3)).toBe('3')
        expect(cambios.data.data.every(c => c.entidad_tipo === 'servicio' && c.entidad_id === 1)).toBe(true)
    })

    it('la pestaña de cambios muestra *** tal cual', async () => {
        const vista = await mountSuspended(PaginaBitacora, { route: '/bitacora?tab=cambios&tipo=servicio&entidad=1' })
        await vi.waitFor(() => expect(vista.find('[data-campo="pass_ppp"]').exists()).toBe(true))
        expect(vista.get('[data-campo="pass_ppp"]').text()).toBe('***')
    })

    it('el detalle muestra la entrada y el request_id', async () => {
        const lista = await useBitacora().acciones({ accion: 'servicios.crear', limit: 1 })
        const accion = lista.ok ? lista.data.data[0] : undefined
        expect(accion).toBeDefined()
        const vista = await mountSuspended(BitacoraDetalle, { props: { accion: accion ?? null, open: true } })
        await vi.waitFor(() => expect(document.body.querySelector('[data-prueba="entrada"]')).not.toBeNull())
        expect(document.body.querySelector('[data-prueba="entrada"]')?.textContent).toContain('"pass_ppp": "***"')
        expect(document.body.textContent).toContain(accion?.request_id ?? '')
        vista.unmount()
    })

    it('con la API en error la página muestra el Problem y no una lista vacía', async () => {
        simularFalla('GET /api/v1/bitacora/acciones', 500)
        const vista = await mountSuspended(PaginaBitacora, { route: '/bitacora' })
        await vi.waitFor(() => expect(vista.text()).toContain('Error interno'))
        expect(vista.text()).toContain('Reintentar')
        expect(vista.text()).not.toContain('La bitácora está vacía')
    })
})
