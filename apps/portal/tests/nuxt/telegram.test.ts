import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { BOT_FIXTURE, fijarSesionFixture, fijarTelegramFixture } from '~~/fixtures'
import CuentaTelegram from '~/components/cuenta/Telegram.vue'
import CuentaContacto from '~/components/cuenta/Contacto.vue'
import { CONTACTO_FIXTURE } from '~~/fixtures/cuenta'

/**
 * Vincular Telegram desde "Mis datos" contra los fixtures: tras pedir el enlace, la segunda
 * consulta de `GET /portal/telegram` responde vinculado (simula el `/start` del bot).
 */

async function esperarHasta(condicion: () => boolean, ms = 2_000) {
    const fin = Date.now() + ms
    while (!condicion()) {
        if (Date.now() > fin) {
            throw new Error('La condición no se cumplió a tiempo')
        }
        await new Promise(resolve => setTimeout(resolve, 10))
    }
}

async function montar(vinculado = false) {
    const wrapper = await mountSuspended(CuentaTelegram, { props: { vinculado, intervaloMs: 20 } })
    await flushPromises()
    await flushPromises()
    return wrapper
}

afterEach(() => {
    fijarSesionFixture(false)
    fijarTelegramFixture(true)
})

describe('vincular Telegram', () => {
    it('genera el enlace profundo, espera al bot y muestra "Vinculado"', async () => {
        fijarSesionFixture(true)
        const wrapper = await montar()
        expect(wrapper.find('[data-testid="telegram-vinculado"]').exists()).toBe(false)

        await wrapper.find('[data-testid="telegram-vincular"]').trigger('click')
        await flushPromises()
        const abrir = wrapper.find('[data-testid="telegram-abrir"]')
        expect(abrir.attributes('href')).toMatch(new RegExp(`^https://t\\.me/${BOT_FIXTURE}\\?start=vt_[A-Za-z0-9_-]{32}$`))
        expect(abrir.attributes('target')).toBe('_blank')
        expect(wrapper.text()).toContain(`@${BOT_FIXTURE}`)

        await esperarHasta(() => wrapper.find('[data-testid="telegram-vinculado"]').exists())
        expect(wrapper.find('[data-testid="telegram-vinculado"]').text()).toContain('Vinculado')
        expect(wrapper.find('[data-testid="telegram-desvincular"]').exists()).toBe(true)
        expect(wrapper.emitted('cambio')).toEqual([[true]])
    })

    it('desvincular pide confirmación y vuelve a ofrecer "Vincular Telegram"', async () => {
        fijarSesionFixture(true)
        const wrapper = await montar()
        await wrapper.find('[data-testid="telegram-vincular"]').trigger('click')
        await esperarHasta(() => wrapper.find('[data-testid="telegram-vinculado"]').exists())

        await wrapper.find('[data-testid="telegram-desvincular"]').trigger('click')
        await flushPromises()
        const confirmar = document.querySelector<HTMLElement>('[data-testid="telegram-confirmar-desvincular"]')
        expect(confirmar).not.toBeNull()
        confirmar!.click()
        await esperarHasta(() => wrapper.find('[data-testid="telegram-vincular"]').exists())
        expect(wrapper.emitted('cambio')).toEqual([[true], [false]])
    })

    it('sin bot configurado el botón está apagado y lo explica', async () => {
        fijarSesionFixture(true)
        fijarTelegramFixture(false)
        const wrapper = await montar()
        const boton = wrapper.find('[data-testid="telegram-vincular"]')
        expect(boton.attributes('disabled')).toBeDefined()
        expect(wrapper.text()).toContain('aún no está disponible')
    })

    it('Telegram como canal preferido solo se habilita con el chat vinculado', async () => {
        const sinVincular = await mountSuspended(CuentaContacto, { props: { contacto: CONTACTO_FIXTURE } })
        const opcion = () => sinVincular.findAll('button[role="radio"], [role="radio"]')
            .find(r => r.attributes('value') === 'telegram' || r.attributes('id')?.includes('telegram'))
        expect(sinVincular.text()).toContain('Primero vincula Telegram')
        expect(opcion()?.attributes('disabled') ?? opcion()?.attributes('data-disabled')).toBeDefined()

        const vinculado = await mountSuspended(CuentaContacto, {
            props: { contacto: { ...CONTACTO_FIXTURE, telegram_vinculado: true } },
        })
        expect(vinculado.text()).not.toContain('Primero vincula Telegram')
    })
})
