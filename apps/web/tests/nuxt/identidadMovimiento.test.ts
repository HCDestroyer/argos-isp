import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import NumeroVivo from '~/components/NumeroVivo.vue'

describe('números vivos', () => {
    it('el texto sigue siendo el número (lectores, copiar, pruebas) y cada dígito rueda a su valor', async () => {
        const vista = await mountSuspended(NumeroVivo, { props: { valor: 'Q 98,450.00' } })
        expect(vista.text()).toBe('Q 98,450.00')
        const digitos = vista.findAll('.roll-digit')
        expect(digitos.map(d => d.attributes('data-d')).join('')).toBe('9845000')
        expect(vista.classes()).not.toContain('ping-a')
    })

    it('solo destella cuando el dato cambia, alternando para reiniciar la animación', async () => {
        const vista = await mountSuspended(NumeroVivo, { props: { valor: '412' } })
        await vista.setProps({ valor: '413' })
        expect(vista.classes()).toContain('ping-a')
        expect(vista.findAll('.roll-digit').at(-1)?.attributes('data-d')).toBe('3')
        await vista.setProps({ valor: '414' })
        expect(vista.classes()).toContain('ping-b')
        await vista.setProps({ valor: '414' })
        expect(vista.classes()).toContain('ping-b')
    })
})
