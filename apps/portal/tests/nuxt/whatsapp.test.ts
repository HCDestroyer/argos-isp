import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { fijarFallaFixture, fijarSesionFixture, fijarWhatsappFixture, limpiarFallasFixture } from '~~/fixtures'
import CuentaWhatsapp from '~/components/cuenta/Whatsapp.vue'

/**
 * «Acepta avisos por WhatsApp» en "Mi cuenta" (contrato Iris 0.6.0 §6.4) contra los fixtures:
 * solo con WhatsApp encendido, la baja que vino de Iris, el conector apagado y los errores con
 * «Reintentar» sin pintar un estado que no se leyó.
 */

async function hastaQue(condicion: () => boolean, pasos = 50) {
    for (let paso = 0; paso < pasos && !condicion(); paso++) {
        await flushPromises()
    }
    if (!condicion()) {
        throw new Error(`La condición no se cumplió en ${pasos} pasos`)
    }
}

async function montar() {
    fijarSesionFixture(true)
    const wrapper = await mountSuspended(CuentaWhatsapp)
    await hastaQue(() => !wrapper.find('[data-testid="whatsapp-cargando"]').exists())
    return wrapper
}

function casilla(wrapper: Awaited<ReturnType<typeof montar>>) {
    return wrapper.find('[role="checkbox"]')
}

function reintentar(wrapper: Awaited<ReturnType<typeof montar>>, testid: string) {
    const boton = wrapper.find(`[data-testid="${testid}"]`).findAll('button').find(b => b.text().includes('Reintentar'))
    expect(boton).toBeDefined()
    return boton!.trigger('click')
}

afterEach(() => {
    fijarWhatsappFixture(null)
    limpiarFallasFixture()
    fijarSesionFixture(false)
})

describe('avisos por WhatsApp en el portal', () => {
    it('con WhatsApp apagado para la empresa no se muestra nada', async () => {
        fijarWhatsappFixture('apagado')
        const wrapper = await montar()
        expect(wrapper.find('[data-testid="whatsapp"]').exists()).toBe(false)
        expect(casilla(wrapper).exists()).toBe(false)
    })

    it('sin elegir: casilla sin marcar; al marcarla se guarda y queda «por confirmar»', async () => {
        fijarWhatsappFixture('nuevo')
        const wrapper = await montar()
        expect(casilla(wrapper).attributes('aria-checked')).toBe('false')
        expect(wrapper.find('[data-testid="whatsapp-estado"]').text()).toContain('No recibes avisos por WhatsApp')

        await casilla(wrapper).trigger('click')
        await hastaQue(() => wrapper.find('[data-testid="whatsapp-activos"]').exists())
        expect(casilla(wrapper).attributes('aria-checked')).toBe('true')
        expect(wrapper.find('[data-testid="whatsapp-estado"]').text()).toContain('Lo estamos confirmando con WhatsApp')
    })

    it('quitar la casilla da de baja', async () => {
        fijarWhatsappFixture('acepta')
        const wrapper = await montar()
        expect(casilla(wrapper).attributes('aria-checked')).toBe('true')
        await casilla(wrapper).trigger('click')
        await hastaQue(() => !wrapper.find('[data-testid="whatsapp-activos"]').exists())
        expect(casilla(wrapper).attributes('aria-checked')).toBe('false')
        expect(wrapper.find('[data-testid="whatsapp-estado"]').text()).toContain('Desactivados')
    })

    it('una baja dada en el chat de Iris se explica y se puede volver a aceptar', async () => {
        fijarWhatsappFixture('baja_iris')
        const wrapper = await montar()
        expect(wrapper.find('[data-testid="whatsapp-baja-iris"]').text()).toContain('Te diste de baja desde el chat de WhatsApp')
        expect(casilla(wrapper).attributes('aria-checked')).toBe('false')
        await casilla(wrapper).trigger('click')
        await hastaQue(() => wrapper.find('[data-testid="whatsapp-activos"]').exists())
        expect(wrapper.find('[data-testid="whatsapp-baja-iris"]').exists()).toBe(false)
    })

    it('conector Iris apagado: aviso con «Reintentar» y sin casilla ni estado', async () => {
        fijarWhatsappFixture('sin_conector')
        const wrapper = await montar()
        expect(wrapper.find('[data-testid="whatsapp-no-disponible"]').text()).toContain('no están disponibles')
        expect(casilla(wrapper).exists()).toBe(false)
        expect(wrapper.find('[data-testid="whatsapp-activos"]').exists()).toBe(false)
        expect(wrapper.find('[data-testid="whatsapp-estado"]').exists()).toBe(false)

        fijarWhatsappFixture('acepta')
        await reintentar(wrapper, 'whatsapp-no-disponible')
        await hastaQue(() => casilla(wrapper).exists())
        expect(casilla(wrapper).attributes('aria-checked')).toBe('true')
    })

    it('si la API falla al leer: error con «Reintentar» y ningún estado inventado', async () => {
        fijarWhatsappFixture('acepta')
        fijarFallaFixture('GET /api/v1/portal/whatsapp', { status: 502, cuerpo: '<html>Bad gateway</html>' })
        const wrapper = await montar()
        expect(wrapper.find('[data-testid="whatsapp-error"]').text()).toContain('No pudimos leer tus avisos por WhatsApp')
        expect(casilla(wrapper).exists()).toBe(false)
        expect(wrapper.text()).not.toContain('Activos')

        fijarFallaFixture('GET /api/v1/portal/whatsapp', null)
        await reintentar(wrapper, 'whatsapp-error')
        await hastaQue(() => casilla(wrapper).exists())
    })

    it('si falla al guardar: la casilla vuelve al estado de la API y «Reintentar» lo manda otra vez', async () => {
        fijarWhatsappFixture('nuevo')
        const wrapper = await montar()
        fijarFallaFixture('POST /api/v1/portal/whatsapp', 'sin_conexion')
        await casilla(wrapper).trigger('click')
        await hastaQue(() => wrapper.find('[data-testid="whatsapp-error-guardar"]').exists())
        expect(casilla(wrapper).attributes('aria-checked')).toBe('false')

        fijarFallaFixture('POST /api/v1/portal/whatsapp', null)
        await reintentar(wrapper, 'whatsapp-error-guardar')
        await hastaQue(() => wrapper.find('[data-testid="whatsapp-activos"]').exists())
        expect(wrapper.find('[data-testid="whatsapp-error-guardar"]').exists()).toBe(false)
    })

    it('la elección no llegó a Iris: lo dice y «Reintentar» la reenvía', async () => {
        fijarWhatsappFixture('fallido')
        const wrapper = await montar()
        expect(wrapper.find('[data-testid="whatsapp-entrega-fallida"]').text()).toContain('no llegó a WhatsApp')
        await reintentar(wrapper, 'whatsapp-entrega-fallida')
        await hastaQue(() => !wrapper.find('[data-testid="whatsapp-entrega-fallida"]').exists())
        expect(wrapper.find('[data-testid="whatsapp-estado"]').text()).toContain('Lo estamos confirmando')
    })
})
