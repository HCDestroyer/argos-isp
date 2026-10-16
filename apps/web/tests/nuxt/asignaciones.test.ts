import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reiniciarFixtures, simularFalla } from '~~/fixtures'
import ServicioAsignaciones from '~/components/ServicioAsignaciones.vue'

describe('ficha de servicio · historial de asignaciones', () => {
    beforeEach(() => {
        reiniciarFixtures()
        useNuxtApp().$tokenSesion.value = 'fixture-cajero'
    })

    afterEach(() => {
        useNuxtApp().$tokenSesion.value = null
    })

    it('el tramo vigente va primero con fin null', async () => {
        const resultado = await useServicios().asignaciones(4)
        expect(resultado.ok).toBe(true)
        if (resultado.ok) {
            expect(resultado.data.data[0]?.fin).toBeNull()
            expect(resultado.data.data).toHaveLength(2)
            expect(resultado.data.data[1]?.fin).not.toBeNull()
        }
    })

    it('muestra el vigente y, con error, solo el aviso con Reintentar', async () => {
        const vista = await mountSuspended(ServicioAsignaciones, { props: { servicioId: 4 } })
        await vi.waitFor(() => expect(vista.text()).toContain('Vigente'))
        expect(vista.text()).toContain('edicion: plan, ipv4')

        simularFalla('GET /api/v1/servicios/:id/asignaciones', 500)
        const conError = await mountSuspended(ServicioAsignaciones, { props: { servicioId: 4 } })
        await vi.waitFor(() => expect(conError.text()).toContain('Reintentar'))
        expect(conError.text()).not.toContain('Vigente')
    })
})
