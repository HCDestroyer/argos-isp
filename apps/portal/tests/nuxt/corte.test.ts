import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import PaginaCorte from '~/pages/corte.vue'

async function montarCorte(fixture?: string) {
    window.history.replaceState({}, '', fixture ? `/corte?fixture=${fixture}` : '/corte')
    clearNuxtData('portal:quien-soy')
    const wrapper = await mountSuspended(PaginaCorte)
    await flushPromises()
    return wrapper
}

function boton(wrapper: Awaited<ReturnType<typeof montarCorte>>, etiqueta: string) {
    return wrapper.findAll('button, a').find(b => b.text().includes(etiqueta))
}

afterEach(() => {
    window.history.replaceState({}, '', '/')
})

describe('página /corte', () => {
    it('suspendido: estado, monto, facturas vencidas (cantidad y total) y acciones', async () => {
        const wrapper = await montarCorte()
        const texto = wrapper.text()
        expect(texto).toContain('Hola, Juan P.')
        expect(texto).toContain('Tu servicio está suspendido')
        expect(wrapper.find('[data-testid="monto-adeudado"]').text()).toBe('Q 525.00')
        const vencidas = wrapper.find('[data-testid="facturas-vencidas"]').text()
        expect(vencidas).toContain('2 facturas vencidas')
        expect(vencidas).toContain('Q 350.00')

        expect(boton(wrapper, 'Pagar en línea')?.attributes('disabled')).toBeDefined()
        expect(boton(wrapper, 'Subir comprobante')?.attributes('disabled')).toBeDefined()
        expect(boton(wrapper, 'Solicitar promesa')?.attributes('disabled')).toBeDefined()
        expect(boton(wrapper, 'Ver datos de depósito')?.attributes('disabled')).toBeUndefined()
        expect(texto).toContain('Contacta a soporte')
    })

    it('activo con promesa: sin vencidas y sin botón de promesa', async () => {
        const wrapper = await montarCorte('activo')
        const texto = wrapper.text()
        expect(texto).toContain('Tu servicio está activo')
        expect(texto).toContain('Sin facturas vencidas')
        expect(texto).toContain('Tienes una promesa de pago activa')
        expect(boton(wrapper, 'Solicitar promesa')).toBeUndefined()
    })

    it('IP desconocida: no muestra montos ni nombre, sí depósito y contacto', async () => {
        const wrapper = await montarCorte('desconocido')
        const texto = wrapper.text()
        expect(texto).toContain('No pudimos identificar tu servicio')
        expect(texto).not.toContain('Hola,')
        expect(wrapper.find('[data-testid="monto-adeudado"]').exists()).toBe(false)
        expect(texto).toContain('Conexión desde 203.0.113.9')
        expect(boton(wrapper, 'Ver datos de depósito')).toBeDefined()
    })

    it('no usa controles HTML crudos fuera de los de Nuxt UI', async () => {
        const wrapper = await montarCorte()
        expect(wrapper.findAll('input, select, textarea, table')).toHaveLength(0)
    })
})
