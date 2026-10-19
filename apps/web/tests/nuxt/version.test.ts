import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reiniciarFixtures, sesionFixture, simularFalla } from '~~/fixtures'
import meAdmin from '~~/fixtures/auth/me.admin.json'
import { bd } from '~~/fixtures/bd'
import { UApp } from '#components'
import MarkdownSeguro from '~/components/MarkdownSeguro.vue'
import MenuUsuario from '~/components/MenuUsuario.vue'
import QueCambioModal from '~/components/QueCambioModal.vue'
import { esperar } from '../ayudas/esperar'

/**
 * Versión instalada y "Qué cambió" (`GET /version`, A6): Markdown del CHANGELOG dibujado sin HTML
 * crudo, enlace a las notas, error con "Reintentar" y el aviso una vez por versión y por usuario.
 */
describe('versión y qué cambió', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
        window.localStorage.clear()
        useVersion().version.value = null
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
        vi.restoreAllMocks()
    })

    it('markdown seguro: títulos, listas, negrita, código y enlaces http; el HTML queda como texto', () => {
        const bloques = markdownSeguro('### Funcionalidades\n\n* **web:** lealtad ([#95](https://x.test/95))\n* `tipo = mora`\n\nTexto <b>crudo</b> y [malo](javascript:alert(1))')
        expect(bloques.map(b => b.tipo)).toEqual(['titulo', 'lista', 'parrafo'])
        const lista = bloques[1]
        expect(lista?.tipo === 'lista' && lista.elementos[0]).toEqual([
            { tipo: 'negrita', texto: 'web:' },
            { tipo: 'texto', texto: ' lealtad (' },
            { tipo: 'enlace', texto: '#95', url: 'https://x.test/95' },
            { tipo: 'texto', texto: ')' },
        ])
        const parrafo = bloques[2]
        expect(parrafo?.tipo === 'parrafo' && parrafo.partes).toEqual([
            { tipo: 'texto', texto: 'Texto <b>crudo</b> y ' },
            { tipo: 'texto', texto: 'malo' },
            { tipo: 'texto', texto: ')' },
        ])
        expect(markdownSeguro(null)).toEqual([])
        expect(markdownSeguro('1. uno\n2. dos')).toEqual([{ tipo: 'lista', ordenada: true, elementos: [[{ tipo: 'texto', texto: 'uno' }], [{ tipo: 'texto', texto: 'dos' }]] }])
    })

    it('aviso: solo una versión publicada distinta de la última vista; la primera vez no avisa', () => {
        expect(debeAvisarVersion('1.4.2', '1.4.1')).toBe(true)
        expect(debeAvisarVersion('1.4.2', '1.4.2')).toBe(false)
        expect(debeAvisarVersion('1.4.2', null)).toBe(false)
        expect(debeAvisarVersion('desarrollo', '1.4.1')).toBe(false)
        guardarVersionVista(7, '1.4.2')
        expect(leerVersionVista(7)).toBe('1.4.2')
        const espia = vi.spyOn(globalThis.localStorage, 'getItem').mockImplementation(() => {
            throw new Error('bloqueado')
        })
        expect(leerVersionVista(7)).toBeNull()
        espia.mockRestore()
    })

    it('el HTML del CHANGELOG se dibuja como texto, nunca como etiquetas', async () => {
        const vista = await mountSuspended(MarkdownSeguro, { props: { markdown: '* <script>alert("no")</script> se ve como texto\n* [notas](https://x.test)' } })
        expect(vista.find('script').exists()).toBe(false)
        expect(vista.text()).toContain('<script>alert("no")</script> se ve como texto')
        expect(vista.find('a').attributes('href')).toBe('https://x.test')
    })

    it('qué cambió: versión, cambios y notas; con error, Reintentar y nada más', async () => {
        const conApp = defineComponent({ render: () => h(UApp, null, { default: () => h(QueCambioModal, { open: true }) }) })
        const vista = await mountSuspended(conApp)
        await esperar(() => expect(document.body.querySelector('[data-prueba="version-cambios"]')).not.toBeNull())
        expect(document.body.textContent).toContain('Qué cambió en la versión 1.4.2')
        expect(document.body.textContent).toContain('programa de lealtad')
        expect(document.body.querySelector('[data-prueba="version-notas"]')?.getAttribute('href')).toBe('https://github.com/HCDestroyer/argos-isp/releases/tag/v1.4.2')
        vista.unmount()
        document.body.innerHTML = ''

        useVersion().version.value = null
        simularFalla('GET /api/v1/version', 500)
        const falla = await mountSuspended(defineComponent({ render: () => h(UApp, null, { default: () => h(QueCambioModal, { open: true }) }) }))
        await esperar(() => expect(document.body.querySelector('[data-prueba="version-error"]')).not.toBeNull())
        expect(document.body.textContent).toContain('Reintentar')
        expect(document.body.querySelector('[data-prueba="version-cambios"]')).toBeNull()
        falla.unmount()
    })

    it('desarrollo sin cambios: lo dice en lugar de dejar el modal vacío', async () => {
        bd.version = { version: 'desarrollo', commit: null, compilada: null, notas_url: null, cambios: null }
        const vista = await mountSuspended(defineComponent({ render: () => h(UApp, null, { default: () => h(QueCambioModal, { open: true }) }) }))
        await esperar(() => expect(document.body.textContent).toContain('Sin notas para esta versión'))
        expect(document.body.textContent).toContain('compilación de desarrollo')
        expect(document.body.querySelector('[data-prueba="version-notas"]')).toBeNull()
        vista.unmount()
    })

    it('el menú recuerda la versión vista por usuario y avisa al entrar a una nueva', async () => {
        guardarVersionVista(meAdmin.id, '1.4.1')
        const vista = await mountSuspended(defineComponent({ render: () => h(UApp, null, { default: () => h(MenuUsuario) }) }))
        await esperar(() => expect(leerVersionVista(meAdmin.id)).toBe('1.4.2'), { timeout: 5000 })
        await esperar(() => expect(useToast().toasts.value.map(t => t.title)).toContain('ArgosIsp se actualizó a la versión 1.4.2'))
        vista.unmount()
    })
})
