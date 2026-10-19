import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
    BOT_FIXTURE,
    BOT_SUR_FIXTURE,
    CODIGO_TELEGRAM_FIXTURE,
    fijarCuentaFixture,
    fijarSesionFixture,
    fijarTelegramFixture,
} from '~~/fixtures'
import CuentaTelegram from '~/components/cuenta/Telegram.vue'
import CuentaContacto from '~/components/cuenta/Contacto.vue'
import { CONTACTO_FIXTURE, CUENTA_DOS_EMPRESAS_FIXTURE } from '~~/fixtures/cuenta'
import { MARCA_FIXTURE, MARCA_SUR_FIXTURE } from '~~/fixtures/empresa'

/**
 * Vincular Telegram desde "Mis datos" contra los fixtures: tras pedir el enlace, la segunda
 * consulta de `GET /portal/telegram` responde vinculado (simula el `/start` del bot).
 */

/**
 * Intervalo de consulta en las pruebas. Con el reloj falso, el tiempo real que tarde la máquina
 * (montar, responder los fixtures) nunca llega a un ciclo: cada consulta al bot la provoca la prueba
 * con `ciclosHasta`, y lo que se ve entre una y otra no depende de la carga.
 */
const CICLO_MS = 60_000

/** Deja terminar lo que esté en vuelo (sin temporizadores) hasta que se cumpla la condición. */
async function hastaQue(condicion: () => boolean, pasos = 50) {
    for (let paso = 0; paso < pasos; paso++) {
        if (condicion()) {
            return
        }
        await flushPromises()
    }
    if (!condicion()) {
        throw new Error(`La condición no se cumplió en ${pasos} pasos`)
    }
}

/** Avanza el reloj falso de ciclo en ciclo de consulta hasta que se cumpla la condición. */
async function ciclosHasta(condicion: () => boolean, ciclos = 5) {
    for (let ciclo = 0; ciclo < ciclos; ciclo++) {
        await flushPromises()
        if (condicion()) {
            return
        }
        await vi.advanceTimersByTimeAsync(CICLO_MS)
        await hastaQue(condicion).catch(() => undefined)
    }
    if (!condicion()) {
        throw new Error(`La condición no se cumplió en ${ciclos} ciclos de consulta`)
    }
}

async function montar(vinculado = false, intervaloMs = CICLO_MS, empresa: { id: number, nombre_comercial: string } | null = null) {
    const wrapper = await mountSuspended(CuentaTelegram, { props: { vinculado, intervaloMs, empresa } })
    await flushPromises()
    await flushPromises()
    return wrapper
}

beforeEach(() => {
    // shouldAdvanceTime: el montaje de Nuxt (router) usa setTimeout; los ciclos los avanza la prueba.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], shouldAdvanceTime: true })
})

afterEach(() => {
    vi.useRealTimers()
    sessionStorage.clear()
    fijarSesionFixture(false)
    fijarTelegramFixture(true)
    fijarCuentaFixture(null)
})

describe('vincular Telegram', () => {
    it('genera el enlace profundo, espera al bot y muestra "Vinculado"', async () => {
        fijarSesionFixture(true)
        const wrapper = await montar()
        expect(wrapper.find('[data-testid="telegram-vinculado"]').exists()).toBe(false)

        await wrapper.find('[data-testid="telegram-vincular"]').trigger('click')
        await flushPromises()
        const abrir = wrapper.find('[data-testid="telegram-abrir"]')
        expect(abrir.attributes('href')).toBe(`https://t.me/${BOT_FIXTURE}?start=${CODIGO_TELEGRAM_FIXTURE}`)
        expect(wrapper.find('[data-testid="telegram-codigo"]').text()).toBe(`/start ${CODIGO_TELEGRAM_FIXTURE}`)
        expect(abrir.attributes('target')).toBe('_blank')
        expect(wrapper.text()).toContain(`@${BOT_FIXTURE}`)

        await ciclosHasta(() => wrapper.find('[data-testid="telegram-vinculado"]').exists())
        expect(wrapper.find('[data-testid="telegram-vinculado"]').text()).toContain('Vinculado')
        expect(wrapper.find('[data-testid="telegram-desvincular"]').exists()).toBe(true)
        expect(wrapper.emitted('cambio')).toEqual([[true]])
    })

    it('al recargar con un código vigente sigue esperando al bot sin mostrar el código', async () => {
        fijarSesionFixture(true)
        await useApi().POST('/api/v1/portal/telegram/vincular', { body: {} })
        sessionStorage.setItem('argos:telegram:vence', String(Date.now() + 10 * CICLO_MS))
        // El fixture da el chat por vinculado en la segunda consulta (la primera es la del montaje):
        // hasta que la prueba avance un ciclo se ve "esperando", por lenta que vaya la máquina.
        const wrapper = await montar()
        expect(wrapper.text()).toContain('Esperando la confirmación del bot de Telegram')
        expect(wrapper.find('[data-testid="telegram-codigo"]').exists()).toBe(false)
        await ciclosHasta(() => wrapper.find('[data-testid="telegram-vinculado"]').exists())
        expect(sessionStorage.getItem('argos:telegram:vence')).toBeNull()
    })

    it('desvincular pide confirmación y vuelve a ofrecer "Vincular Telegram"', async () => {
        fijarSesionFixture(true)
        const wrapper = await montar()
        await wrapper.find('[data-testid="telegram-vincular"]').trigger('click')
        await ciclosHasta(() => wrapper.find('[data-testid="telegram-vinculado"]').exists())

        await wrapper.find('[data-testid="telegram-desvincular"]').trigger('click')
        await flushPromises()
        const confirmar = document.querySelector<HTMLElement>('[data-testid="telegram-confirmar-desvincular"]')
        expect(confirmar).not.toBeNull()
        confirmar!.click()
        await hastaQue(() => wrapper.find('[data-testid="telegram-vincular"]').exists())
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

describe('Telegram por empresa (un bot por empresa)', () => {
    it('la tarjeta de Fibra Sur vincula SU bot; la de Red Altiplano sigue sin vincular', async () => {
        fijarSesionFixture(true)
        fijarCuentaFixture(CUENTA_DOS_EMPRESAS_FIXTURE)
        const sur = await montar(false, CICLO_MS, MARCA_SUR_FIXTURE)
        expect(sur.attributes('data-testid')).toBe(`telegram-empresa-${MARCA_SUR_FIXTURE.id}`)
        expect(sur.text()).toContain(`Telegram de ${MARCA_SUR_FIXTURE.nombre_comercial}`)
        expect(sur.text()).toContain(`@${BOT_SUR_FIXTURE}`)

        await sur.find('[data-testid="telegram-vincular"]').trigger('click')
        await flushPromises()
        expect(sur.find('[data-testid="telegram-abrir"]').attributes('href'))
            .toBe(`https://t.me/${BOT_SUR_FIXTURE}?start=${CODIGO_TELEGRAM_FIXTURE}`)
        await ciclosHasta(() => sur.find('[data-testid="telegram-vinculado"]').exists())
        expect(sur.emitted('cambio')).toEqual([[true]])

        // El bot de la otra empresa no le escribe todavía: su tarjeta ofrece vincularlo
        const norte = await montar(false, CICLO_MS, MARCA_FIXTURE)
        expect(norte.find('[data-testid="telegram-vinculado"]').exists()).toBe(false)
        expect(norte.find('[data-testid="telegram-vincular"]').text()).toContain(`Vincular Telegram de ${MARCA_FIXTURE.nombre_comercial}`)
        expect(norte.text()).toContain(`@${BOT_FIXTURE}`)
        // La espera de cada tarjeta se guarda aparte
        expect(sessionStorage.getItem('argos:telegram:vence')).toBeNull()
    })
})
