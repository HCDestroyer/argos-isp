import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reiniciarFixtures } from '~~/fixtures'
import meAdmin from '~~/fixtures/auth/me.admin.json'
import meCajero from '~~/fixtures/auth/me.cajero.json'
import PaginaCuentas from '~/pages/configuracion/cuentas-bancarias.vue'

describe('configuración · cuentas bancarias', () => {
    beforeEach(() => {
        reiniciarFixtures()
        useNuxtApp().$tokenSesion.value = 'fixture-admin'
        useUsuarioActual().value = meAdmin
    })

    afterEach(() => {
        useNuxtApp().$tokenSesion.value = null
        useUsuarioActual().value = null
    })

    it('el esquema es espejo del validador (número 3–40, alias 2–80, banco obligatorio)', () => {
        expect(esquemaCuentaBancaria.safeParse({ banco_id: 1, numero: '3-123-45678-9', alias: 'Monetaria', moneda: 'GTQ', activa: true }).success).toBe(true)
        const malo = esquemaCuentaBancaria.safeParse({ banco_id: undefined, numero: '12', alias: 'M', moneda: 'GTQ', activa: true })
        expect(malo.success).toBe(false)
        expect(new Set(malo.error?.issues.map(i => i.path[0]))).toEqual(new Set(['banco_id', 'numero', 'alias']))
    })

    it('crea, rechaza el número repetido (409) y edita con versión (409 si cambió)', async () => {
        const creada = await useCuentasBancarias().crear({ banco_id: 1, numero: '3-123-45678-9', alias: 'Monetaria', moneda: 'GTQ', activa: true })
        expect(creada.ok && creada.data.cuenta_codigo).toMatch(/^1\.1\.02\.\d{2}$/)

        const repetida = await useCuentasBancarias().crear({ banco_id: 1, numero: '3-123-45678-9', alias: 'Otra', moneda: 'GTQ' })
        expect(!repetida.ok && repetida.problema.status).toBe(409)

        if (!creada.ok) {
            return
        }
        const editada = await useCuentasBancarias().editar(creada.data.id, { version: creada.data.version, activa: false })
        expect(editada.ok && editada.data.activa).toBe(false)

        const vieja = await useCuentasBancarias().editar(creada.data.id, { version: creada.data.version, alias: 'Vieja' })
        expect(!vieja.ok && vieja.problema.status).toBe(409)
    })

    it('la pantalla lista, filtra inactivas y muestra el botón de crear solo con cuentas_bancarias.editar', async () => {
        const vista = await mountSuspended(PaginaCuentas)
        await vi.waitFor(() => expect(vista.findAll('[data-cuenta]')).toHaveLength(4))
        expect(vista.text()).toContain('Nueva cuenta')
        expect(vista.text()).toContain('Inactiva')

        useNuxtApp().$tokenSesion.value = 'fixture-cajero'
        useUsuarioActual().value = meCajero
        const cajero = await mountSuspended(PaginaCuentas)
        await vi.waitFor(() => expect(cajero.findAll('[data-cuenta]').length).toBeGreaterThan(0))
        expect(cajero.find('[aria-label^="Editar"]').exists()).toBe(false)
        expect(cajero.text()).not.toContain('Nueva cuenta')
    })
})
