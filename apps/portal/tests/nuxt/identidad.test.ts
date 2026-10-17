import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import LogoArgos from '~/components/LogoArgos.vue'
import Layout from '~/layouts/default.vue'

/** Identidad "vidrio y luz": logo y materiales del layout. */

describe('logo de ArgosIsp', () => {
    it('marca: cuadro teal 700 con radio 7/32 y trazo blanco', async () => {
        const wrapper = await mountSuspended(LogoArgos)
        const rect = wrapper.find('rect')
        expect(rect.exists()).toBe(true)
        expect(rect.attributes('rx')).toBe('14')
        expect(rect.classes()).toContain('fill-(--ui-color-primary-700)')
        expect(wrapper.find('g').attributes('stroke')).toBe('white')
        expect(wrapper.attributes('aria-hidden')).toBe('true')
    })

    it('línea: sin cuadro y en currentColor', async () => {
        const wrapper = await mountSuspended(LogoArgos, { props: { variante: 'linea' } })
        expect(wrapper.find('rect').exists()).toBe(false)
        expect(wrapper.find('g').attributes('stroke')).toBe('currentColor')
    })

    it('el favicon es la misma figura que la marca', () => {
        const favicon = readFileSync(resolve(process.cwd(), 'public/favicon.svg'), 'utf8')
        expect(favicon).toContain('rx="14" fill="#0f766e"')
        for (const d of ['M5 42C14.5 27 49.5 27 59 42C49.5 57 14.5 57 5 42Z', 'M22.75 25.98A18.5 18.5 0 0 1 41.25 25.98', 'M15.31 15.29A31.5 31.5 0 0 1 48.69 15.29']) {
            expect(favicon).toContain(d)
        }
    })
})

describe('layout: aura y vidrio', () => {
    it('monta el aura, la barra superior de vidrio y la marca', async () => {
        const wrapper = await mountSuspended(Layout, { route: '/' })
        await flushPromises()
        const aura = wrapper.find('[data-testid="app-aura"]')
        expect(aura.classes()).toContain('app-aura')
        expect(aura.classes()).not.toContain('app-aura-lite')
        expect(aura.attributes('aria-hidden')).toBe('true')
        expect(wrapper.find('header').classes()).toContain('chrome-material')
        expect(wrapper.find('header [data-testid="logo-argos"]').exists()).toBe(true)
    })

    it('en /corte el aura es la liviana (sin difuminado ni deriva)', async () => {
        const wrapper = await mountSuspended(Layout, { route: '/corte' })
        await flushPromises()
        expect(wrapper.find('[data-testid="app-aura"]').classes()).toContain('app-aura-lite')
    })
})
