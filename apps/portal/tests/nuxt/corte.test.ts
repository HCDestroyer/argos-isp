import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import PaginaCorte from '~/pages/corte.vue'

describe('página /corte', () => {
    it('muestra estado, monto y facturas vencidas con las acciones deshabilitadas', async () => {
        const wrapper = await mountSuspended(PaginaCorte)
        await flushPromises()

        const texto = wrapper.text()
        expect(texto).toContain('Tu servicio está suspendido')
        expect(texto).toContain('Q 350.00')
        expect(texto).toContain('A-000123')
        expect(texto).toContain('10/08/2026')

        const botones = wrapper.findAll('button')
        const etiquetas = ['Pagar en línea', 'Ver datos de depósito', 'Subir comprobante', 'Solicitar promesa de pago']
        for (const etiqueta of etiquetas) {
            const boton = botones.find(b => b.text().includes(etiqueta))
            expect(boton?.attributes('disabled')).toBeDefined()
        }
    })
})
