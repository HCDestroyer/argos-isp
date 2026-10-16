import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { fijarPromesaFixture, fijarSesionFixture } from '~~/fixtures'
import { condicionesFixture, diaFixture } from '~~/fixtures/promesas'
import PaginaCorte from '~/pages/corte.vue'
import PaginaCuenta from '~/pages/cuenta.vue'
import SolicitarPromesa from '~/components/promesa/Solicitar.vue'

async function esperar() {
    for (let i = 0; i < 6; i += 1) {
        await flushPromises()
    }
}

async function montarModal(props: Record<string, unknown> = {}) {
    const wrapper = await mountSuspended(SolicitarPromesa, { props: { open: true, ...props } })
    await esperar()
    return wrapper
}

function enDocumento(selector: string): HTMLElement | null {
    return document.querySelector<HTMLElement>(selector)
}

function texto(): string {
    return document.body.textContent ?? ''
}

async function enviarFormulario() {
    document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await esperar()
}

function escribir(selector: string, valor: string) {
    const campo = document.querySelector<HTMLInputElement>(selector)!
    campo.value = valor
    campo.dispatchEvent(new Event('input', { bubbles: true }))
}

afterEach(() => {
    fijarPromesaFixture(null)
    fijarSesionFixture(false)
    document.body.innerHTML = ''
    window.history.replaceState({}, '', '/')
})

describe('esquema y textos de la promesa', () => {
    const condiciones = condicionesFixture()
    const esquema = esquemaPromesa(condiciones)

    it('espejo del validador: fecha YYYY-MM-DD dentro del plazo y monto con 2 decimales hasta la deuda', () => {
        expect(esquema.safeParse({ vence_el: diaFixture(1), monto: '350.00' }).success).toBe(true)
        expect(esquema.safeParse({ vence_el: diaFixture(0), monto: '525' }).success).toBe(true)

        const mensajes = (datos: { vence_el: string, monto: string }) =>
            esquema.safeParse(datos).error?.issues.map(i => i.message) ?? []
        expect(mensajes({ vence_el: diaFixture(4), monto: '10' })[0]).toContain('La fecha no puede pasar del')
        expect(mensajes({ vence_el: diaFixture(-1), monto: '10' })).toContain('La fecha ya pasó')
        expect(mensajes({ vence_el: '', monto: '10' })).toContain('Elige una fecha')
        expect(mensajes({ vence_el: diaFixture(1), monto: '525.01' })).toContain('El monto no puede pasar de Q 525.00')
        expect(mensajes({ vence_el: diaFixture(1), monto: '0' })).toContain('El monto debe ser mayor que 0')
        expect(mensajes({ vence_el: diaFixture(1), monto: 'Q10' })[0]).toContain('sin la Q')
        expect(mensajes({ vence_el: diaFixture(1), monto: '10.555' })[0]).toContain('hasta 2 decimales')
    })

    it('plazo legible e Idempotency-Key v4 nueva en cada llamada', () => {
        const [anio, mes, dia] = diaFixture(3).split('-')
        expect(textoPlazo(condiciones)).toBe(`hasta 3 días (a más tardar el ${dia}/${mes}/${anio})`)
        expect(textoPlazo({ plazo_max_dias: null, fecha_maxima: null })).toBeNull()
        expect(montoEnTexto('318.33')).toBe('Q\u00A0318.33')
        const clave = claveIdempotencia()
        expect(clave).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
        expect(claveIdempotencia()).not.toBe(clave)
    })
})

describe('modal "Solicitar promesa de pago"', () => {
    it('muestra los límites antes de enviar y prellena fecha máxima y saldo vencido', async () => {
        await montarModal()
        const limites = enDocumento('[data-testid="promesa-limites"]')!.textContent ?? ''
        expect(limites).toContain('Fecha de pago: hasta 3 días')
        expect(limites).toContain('Monto: hasta Q\u00A0525.00')
        const fecha = document.querySelector<HTMLInputElement>('input[type="date"]')!
        expect(fecha.value).toBe(diaFixture(3))
        expect(fecha.min).toBe(diaFixture(0))
        expect(fecha.max).toBe(diaFixture(3))
        expect(document.querySelector<HTMLInputElement>('input[inputmode="decimal"]')!.value).toBe('350.00')
    })

    it('aprobada: emite el resultado y cierra', async () => {
        fijarPromesaFixture('aprobada')
        const wrapper = await montarModal()
        await enviarFormulario()
        const emitido = wrapper.emitted('resultado')?.[0]?.[0] as PromesaSolicitada
        expect(emitido.resultado).toBe('aprobada')
        expect(emitido.servicio_estado).toBe('activo')
        expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false])
    })

    it('rechazada por cupo: motivo legible (nunca el código) y contacto en lugar de "Cambiar"', async () => {
        fijarPromesaFixture('rechazada')
        await montarModal()
        await enviarFormulario()
        const rechazo = enDocumento('[data-testid="promesa-rechazada"]')!.textContent ?? ''
        expect(rechazo).toContain('No pudimos aprobar tu promesa')
        expect(rechazo).toContain('Ya usaste las promesas de pago disponibles para este periodo')
        expect(rechazo).not.toMatch(/max_por_periodo|rechazada/)
        expect(enDocumento('[data-testid="promesa-corregir"]')).toBeNull()
        expect(enDocumento('[data-testid="promesa-contacto"]')!.getAttribute('href')).toBe('/contacto')
    })

    it('rechazada por el plazo: se puede cambiar la fecha', async () => {
        fijarPromesaFixture('rechazada_fecha')
        await montarModal()
        await enviarFormulario()
        expect(enDocumento('[data-testid="promesa-rechazada"]')!.textContent).toContain('próximos 3 días')
        expect(enDocumento('[data-testid="promesa-contacto"]')).toBeNull()
        const corregir = enDocumento('[data-testid="promesa-corregir"]') as HTMLElement
        corregir.click()
        await esperar()
        expect(document.querySelector('form')).not.toBeNull()
    })

    it('pendiente de aprobación: lo dice con el monto y la fecha', async () => {
        fijarPromesaFixture('pendiente_aprobacion')
        await montarModal()
        await enviarFormulario()
        expect(enDocumento('[data-testid="promesa-pendiente"]')!.textContent).toContain('pendiente de aprobación')
        expect(texto()).toContain('Prometiste pagar Q\u00A0350.00')
    })

    it('con una promesa abierta: no disponible, sin formulario', async () => {
        fijarPromesaFixture('con_promesa')
        await montarModal()
        expect(enDocumento('[data-testid="promesa-no-disponible"]')!.textContent).toContain('Ya tienes una promesa de pago activa.')
        expect(document.querySelector('form')).toBeNull()
    })

    it('monto mayor que la deuda: no se envía y el error queda en el campo', async () => {
        const wrapper = await montarModal()
        escribir('input[inputmode="decimal"]', '600.00')
        await enviarFormulario()
        expect(texto()).toContain('El monto no puede pasar de Q 525.00')
        expect(wrapper.emitted('resultado')).toBeUndefined()
    })
})

describe('/corte y /cuenta con promesa', () => {
    it('/corte: promesa aprobada → aviso y, con el estado en vivo, "Ya tienes servicio"', async () => {
        window.history.replaceState({}, '', '/corte')
        clearNuxtData('portal:quien-soy')
        fijarPromesaFixture('aprobada')
        const wrapper = await mountSuspended(PaginaCorte)
        await esperar()
        const boton = wrapper.find('[data-testid="solicitar-promesa"]')
        expect(boton.attributes('disabled')).toBeUndefined()
        await boton.trigger('click')
        await esperar()
        await enviarFormulario()
        await esperar()
        expect(wrapper.find('[data-testid="servicio-reactivado"]').text()).toContain('Ya tienes servicio')
        // la reactivación llega casi al instante: la promesa se recuerda en esa misma pantalla
        const recordatorio = wrapper.find('[data-testid="reactivado-promesa"]').text()
        expect(recordatorio).toContain('Recuerda tu promesa de pago')
        expect(recordatorio).toContain('Pagarás Q\u00A0350.00 a más tardar el')
    })

    it('/corte: pendiente → aviso en la página y ya no ofrece otra promesa', async () => {
        window.history.replaceState({}, '', '/corte')
        clearNuxtData('portal:quien-soy')
        fijarPromesaFixture('pendiente_aprobacion')
        const wrapper = await mountSuspended(PaginaCorte)
        await esperar()
        await wrapper.find('[data-testid="solicitar-promesa"]').trigger('click')
        await esperar()
        await enviarFormulario()
        expect(wrapper.find('[data-testid="promesa-pendiente-corte"]').exists()).toBe(true)
        expect(wrapper.find('[data-testid="solicitar-promesa"]').exists()).toBe(false)
        expect(wrapper.find('[data-testid="servicio-reactivado"]').exists()).toBe(false)
    })

    it('/cuenta: pedir promesa del servicio suspendido; aprobada → "Ya tienes servicio"', async () => {
        fijarSesionFixture(true)
        fijarPromesaFixture('aprobada')
        clearNuxtData('portal:cuenta')
        const wrapper = await mountSuspended(PaginaCuenta)
        await esperar()
        await wrapper.find('[data-testid="pedir-promesa"]').trigger('click')
        await esperar()
        expect(enDocumento('[data-testid="promesa-limites"]')).not.toBeNull()
        await enviarFormulario()
        await esperar()
        expect(wrapper.find('[data-testid="promesa-aprobada"]').text()).toContain('Ya tienes servicio')
        expect(wrapper.find('[data-testid="pedir-promesa"]').exists()).toBe(false)
    })
})
