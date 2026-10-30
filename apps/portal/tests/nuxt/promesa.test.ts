import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { fijarPromesaFixture, fijarSesionFixture } from '~~/fixtures'
import { condicionesConPagoPrevioFixture, condicionesFixture, diaFixture } from '~~/fixtures/promesas'
import { PROMESAS_FIXTURE } from '~~/fixtures/cuenta'
import PaginaCorte from '~/pages/corte.vue'
import PaginaCuenta from '~/pages/cuenta.vue'
import SolicitarPromesa from '~/components/promesa/Solicitar.vue'
import PromesasCuenta from '~/components/cuenta/Promesas.vue'

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

afterEach(() => {
    fijarPromesaFixture(null)
    fijarSesionFixture(false)
    document.body.innerHTML = ''
    window.history.replaceState({}, '', '/')
})

describe('esquema y textos de la promesa', () => {
    const condiciones = condicionesFixture()
    const esquema = esquemaPromesa(condiciones)

    it('espejo del validador: solo la fecha YYYY-MM-DD dentro del plazo; el monto no lo escribe el cliente', () => {
        expect(esquema.safeParse({ vence_el: diaFixture(1) }).success).toBe(true)
        expect(esquema.safeParse({ vence_el: diaFixture(0) }).success).toBe(true)
        // un monto (de un formulario viejo) no forma parte de los datos que se envían
        expect(esquema.parse({ vence_el: diaFixture(1), monto: '10.00' })).toEqual({ vence_el: diaFixture(1) })

        const mensajes = (datos: { vence_el: string }) =>
            esquema.safeParse(datos).error?.issues.map(i => i.message) ?? []
        expect(mensajes({ vence_el: diaFixture(4) })[0]).toContain('Elige una fecha hasta el')
        expect(mensajes({ vence_el: diaFixture(-1) })).toContain('Esa fecha ya pasó: elige hoy o un día posterior')
        expect(mensajes({ vence_el: '' })).toContain('Elige el día en que vas a pagar')
    })

    it('lo que cubre: concepto de cada factura y solo con algo vencido', () => {
        expect(conceptoCubierta({ tipo: 'servicio', periodo: '2026-10-01' })).toBe('Servicio de octubre 2026')
        expect(conceptoCubierta({ tipo: 'mora', periodo: '2026-09-01' })).toBe('Recargo por mora')
        expect(conceptoCubierta({ tipo: 'cargo', periodo: '2026-09-01' })).toBe('Cargo de septiembre 2026')
        expect(hayVencidoQuePrometer(condiciones)).toBe(true)
        expect(hayVencidoQuePrometer({ monto_promesa: '0.00' })).toBe(false)
        expect(hayVencidoQuePrometer({ monto_promesa: null })).toBe(false)
        expect(hayVencidoQuePrometer(null)).toBe(false)
        expect(textoCoberturaPromesa(1)).toBe('Cubre 1 factura vencida: se cumple al pagarla')
        expect(textoCoberturaPromesa(3)).toBe('Cubre 3 facturas vencidas: se cumple al pagarlas todas')
    })

    it('con pago previo (abono o deuda máxima de limitesPromesa) el mismo esquema no deja enviar', () => {
        const conPrevio = condicionesConPagoPrevioFixture()
        const resultado = esquemaPromesa(conPrevio).safeParse({ vence_el: diaFixture(1) })
        expect(resultado.success).toBe(false)
        expect(resultado.error?.issues.map(i => i.message)).toContain('Primero paga Q 262.50; después solicita la promesa')
        expect(resultado.error?.issues[0]?.path).toEqual(['vence_el'])
        // pago_previo null o "0.00": nada que pagar antes
        expect(esquemaPromesa({ ...conPrevio, pago_previo: '0.00' }).safeParse({ vence_el: diaFixture(1) }).success).toBe(true)

        const explicacion = textoPagoPrevio(conPrevio)
        expect(explicacion).not.toContain('abonar')
        expect(explicacion).toContain('Paga en línea, en la oficina o por depósito')
        expect(textoPagoPrevio({ deuda_maxima: null })).toBe('Paga en línea, en la oficina o por depósito y luego solicita la promesa: cubrirá lo que quede vencido.')
        expect(explicacion).toContain('Tu saldo vencido (Q\u00A0350.00) pasa del máximo para una promesa (Q\u00A0300.00)')
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
    it('muestra los límites y todo lo vencido que cubre; solo se elige la fecha', async () => {
        await montarModal()
        const limites = enDocumento('[data-testid="promesa-limites"]')!.textContent ?? ''
        expect(limites).toContain('Fecha de pago: hasta 3 días')
        const fecha = document.querySelector<HTMLInputElement>('input[type="date"]')!
        expect(fecha.value).toBe(diaFixture(3))
        expect(fecha.min).toBe(diaFixture(0))
        expect(fecha.max).toBe(diaFixture(3))
        // sin campo de monto: lo calcula Argos
        expect(document.querySelector('input[inputmode="decimal"]')).toBeNull()
        expect(document.querySelectorAll('form input:not([type="hidden"])')).toHaveLength(1)

        const cubre = enDocumento('[data-testid="promesa-cubre"]')!.textContent ?? ''
        expect(cubre).toContain('Prometes pagar Q\u00A0350.00 (todo lo vencido)')
        expect(cubre).toContain('se cumple cuando pagas todas estas facturas')
        const facturas = [...document.querySelectorAll<HTMLElement>('[data-testid="promesa-factura"]')].map(f => f.textContent ?? '')
        expect(facturas).toHaveLength(2)
        expect(facturas[0]).toContain('Servicio de septiembre 2026')
        expect(facturas[0]).toContain('venció el 10/09/2026')
        expect(facturas[0]).toContain('Q\u00A0175.00')
        expect(facturas[1]).toContain('Servicio de octubre 2026')
    })

    it('el envío solo lleva la fecha y la respuesta trae el total vencido', async () => {
        fijarPromesaFixture('aprobada')
        const wrapper = await montarModal()
        await enviarFormulario()
        const emitido = wrapper.emitted('resultado')?.[0]?.[0] as PromesaSolicitada
        expect(emitido.monto).toBe('350.00')
        expect(emitido.facturas.map(f => f.factura_id)).toEqual([1150, 1203])
    })

    it('sin facturas vencidas: no hay promesa que pedir', async () => {
        fijarPromesaFixture('sin_vencido')
        await montarModal()
        expect(enDocumento('[data-testid="promesa-no-disponible"]')!.textContent).toContain('No tienes facturas vencidas')
        expect(document.querySelector('form')).toBeNull()
    })

    it('con pago previo: muestra el límite y cuánto pagar antes, y no deja enviar', async () => {
        fijarPromesaFixture('con_pago_previo')
        const wrapper = await montarModal()
        const limites = enDocumento('[data-testid="promesa-limites"]')!.textContent ?? ''
        expect(limites).toContain('Fecha de pago: hasta 3 días')
        expect(limites).toContain('abonar el 50% de tu deuda')
        expect(limites).toContain('te faltan Q\u00A0262.50')
        // aun así dice qué cubrirá
        expect(enDocumento('[data-testid="promesa-cubre"]')!.textContent).toContain('Q\u00A0350.00')
        expect(limites).toContain('Saldo vencido máximo para prometer: Q\u00A0300.00')
        expect(enDocumento('[data-testid="promesa-falta-abono"]')!.textContent).toContain('Antes de prometer debes pagar Q\u00A0262.50')
        expect(enDocumento('[data-testid="promesa-enviar"]')!.hasAttribute('disabled')).toBe(true)
        await enviarFormulario()
        expect(wrapper.emitted('resultado')).toBeUndefined()
        expect(texto()).toContain('Primero paga Q 262.50')
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
        expect(texto()).toContain('Prometiste pagar Q\u00A0350.00 (todo lo vencido)')
    })

    it('con una promesa abierta: no disponible, sin formulario', async () => {
        fijarPromesaFixture('con_promesa')
        await montarModal()
        expect(enDocumento('[data-testid="promesa-no-disponible"]')!.textContent).toContain('Ya tienes una promesa de pago activa.')
        expect(document.querySelector('form')).toBeNull()
    })

    it('fecha fuera del plazo: no se envía y el error queda en el campo', async () => {
        const wrapper = await montarModal()
        const campo = document.querySelector<HTMLInputElement>('input[type="date"]')!
        campo.value = diaFixture(9)
        campo.dispatchEvent(new Event('input', { bubbles: true }))
        await enviarFormulario()
        expect(texto()).toContain('Elige una fecha hasta el')
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

describe('lista de promesas de /cuenta', () => {
    it('la que cubre lo vencido dice cuántas facturas; la de antes del cambio (regla monto), no', async () => {
        fijarSesionFixture(true)
        const wrapper = await mountSuspended(PromesasCuenta)
        await esperar()
        const tarjetas = wrapper.findAll('[data-testid="promesa"]')
        expect(tarjetas).toHaveLength(PROMESAS_FIXTURE.length)
        const [nueva, vieja] = PROMESAS_FIXTURE
        expect(nueva!.regla_cumplimiento).toBe('facturas')
        expect(vieja!.regla_cumplimiento).toBe('monto')
        expect(tarjetas[0]!.find('[data-testid="promesa-cubre-facturas"]').text()).toBe('Cubre 1 factura vencida: se cumple al pagarla')
        expect(tarjetas[1]!.find('[data-testid="promesa-cubre-facturas"]').exists()).toBe(false)
    })
})
