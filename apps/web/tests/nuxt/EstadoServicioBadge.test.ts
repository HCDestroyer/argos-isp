import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import EstadoServicioBadge from '~/components/EstadoServicioBadge.vue'

describe('EstadoServicioBadge', () => {
    it.each([
        ['activo', 'Activo', 'success', 'text-success'],
        ['limitado', 'Limitado', 'warning', 'text-warning'],
        ['suspendido', 'Suspendido', 'error', 'text-error'],
        ['retirado', 'Retirado', 'neutral', 'text-default'],
    ] as const)('%s se muestra como %s en color %s', async (estado, etiqueta, color, clase) => {
        const wrapper = await mountSuspended(EstadoServicioBadge, { props: { estado } })
        expect(wrapper.text()).toContain(etiqueta)
        expect(ESTADOS_SERVICIO[estado].color).toBe(color)
        expect(wrapper.classes()).toContain(clase)
    })
})
