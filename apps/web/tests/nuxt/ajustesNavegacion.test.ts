import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defineComponent, h, type Component } from 'vue'
import UApp from '@nuxt/ui/components/App.vue'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import { bd } from '~~/fixtures/bd'
import { meAdmin } from '~~/fixtures/auth/sesiones'
import { configuracionFel } from '~~/fixtures/fel/rutas'
import AjustesNavegacion from '~/components/AjustesNavegacion.vue'
import PaginaAjustes from '~/pages/configuracion/index.vue'
import PaginaEmpresas from '~/pages/configuracion/empresas.vue'
import { esperar } from '../ayudas/esperar'

/**
 * Navegación de Ajustes (plan del menú y Ajustes, lote 2; respuestas del PM del 26 nov 2026): la
 * página de tarjetas y la lista de la izquierda dentro de cada ajuste salen del mismo catálogo, con
 * un solo buscador, solo lo permitido y sin grupos vacíos.
 */
function enApp(componente: Component, props: Record<string, unknown> = {}) {
    return defineComponent({ render: () => h(UApp, null, { default: () => h(componente, props) }) })
}

const montadas: { unmount: () => void }[] = []

async function montar(componente: Component, route: string, props: Record<string, unknown> = {}) {
    const vista = await mountSuspended(enApp(componente, props), { route, attachTo: document.body })
    montadas.push(vista)
    await flushPromises()
    return vista
}

function todos(selector: string): HTMLElement[] {
    return [...document.body.querySelectorAll<HTMLElement>(selector)]
}

function buscador(): HTMLInputElement {
    const campo = document.body.querySelector<HTMLInputElement>('input[data-prueba="buscar-ajuste"], [data-prueba="buscar-ajuste"] input')
    if (!campo) {
        throw new Error('Sin buscador')
    }
    return campo
}

async function escribir(texto: string) {
    const campo = buscador()
    campo.value = texto
    campo.dispatchEvent(new Event('input'))
    await flushPromises()
}

async function tecla(key: string) {
    buscador().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
    await flushPromises()
}

beforeEach(async () => {
    reiniciarFixtures()
    sesionFixture('fixture-admin')
    useUsuarioActual().value = meAdmin
    useEmpresaActiva().inicializar()
    await flushPromises()
})

afterEach(() => {
    sesionFixture(null)
    useUsuarioActual().value = null
    localStorage.clear()
    for (const vista of montadas.splice(0)) {
        vista.unmount()
    }
    document.body.innerHTML = ''
})

describe('Ajustes · página de tarjetas', () => {
    it('el admin ve los 8 grupos con sus ajustes; cada fila lleva a su pantalla', async () => {
        await montar(PaginaAjustes, '/configuracion')
        expect(document.querySelector('h1')?.textContent).toContain('Ajustes')
        expect(todos('[data-grupo-ajustes]').map(g => g.dataset.grupoAjustes)).toEqual(SECCIONES_CONFIGURACION.map(s => s.id))
        expect(todos('[data-ajuste]')).toHaveLength(29)
        expect(document.querySelector('[data-ajuste="reglas-cobro"]')?.getAttribute('href')).toBe('/configuracion/reglas-cobro')
        expect(document.body.textContent).not.toContain('Configuración')
    })

    it('un rol con pocos permisos ve solo lo suyo y ningún grupo vacío', async () => {
        useUsuarioActual().value = { ...meAdmin, roles: ['contabilidad'], permisos: ['fiscal.ver', 'fel.ver', 'cuentas_bancarias.ver', 'bancos.ver', 'ajustes_cobro.ver', 'reportes.ver'] }
        await montar(PaginaAjustes, '/configuracion')
        expect(todos('[data-grupo-ajustes]').map(g => g.dataset.grupoAjustes)).toEqual(['config-empresa', 'config-cobro', 'config-apariencia'])
        expect(todos('[data-ajuste]').map(a => a.dataset.ajuste)).toEqual(['fiscal', 'fel', 'reglas-cobro', 'cuentas-bancarias', 'bancos-origen', 'proveedores-cobro', 'config-reportes'])
        await escribir('logo')
        expect(document.querySelector('[data-prueba="ajustes-sin-resultados"]')?.textContent).toContain('Nada coincide con «logo»')
    })

    it('buscar «correo»: 4 resultados con su grupo; sin resultados, «Borrar búsqueda»', async () => {
        await montar(PaginaAjustes, '/configuracion')
        await escribir('correo')
        expect(document.querySelector('[data-prueba="resultados-ajustes"]')?.textContent).toContain('4 resultados para «correo»')
        expect(todos('[data-ajuste]').map(a => a.dataset.ajuste).sort()).toEqual(['empresa', 'empresas', 'notificaciones', 'notificaciones-plantillas'])
        expect(todos('[data-grupo-ajustes]')).toHaveLength(0)
        await escribir('xyz')
        const vacio = document.querySelector<HTMLElement>('[data-prueba="ajustes-sin-resultados"]')
        expect(vacio?.textContent).toContain('Nada coincide con «xyz»')
        todos('button').find(b => b.textContent?.includes('Borrar búsqueda'))?.click()
        await flushPromises()
        expect(buscador().value).toBe('')
        expect(todos('[data-grupo-ajustes]')).toHaveLength(8)
    })

    it('teclado: flechas mueven, Enter abre el elegido y Esc borra', async () => {
        await montar(PaginaAjustes, '/configuracion')
        await escribir('plantillas')
        const ids = () => todos('[data-ajuste]').map(a => a.dataset.ajuste)
        expect(ids()[0]).toBe('plantillas')
        expect(document.querySelector('[data-activo="true"]')?.getAttribute('data-ajuste')).toBe('plantillas')
        await tecla('ArrowDown')
        expect(document.querySelector('[data-activo="true"]')?.getAttribute('data-ajuste')).toBe(ids()[1])
        await tecla('ArrowUp')
        await tecla('ArrowUp')
        expect(document.querySelector('[data-activo="true"]')?.getAttribute('data-ajuste')).toBe(ids().at(-1))
        await tecla('Escape')
        expect(buscador().value).toBe('')
        await escribir('mora')
        await tecla('Enter')
        await esperar(() => expect(useRoute().path).toBe('/plantillas'))
    })
})

describe('Ajustes · lista dentro de cada ajuste', () => {
    it('la pantalla abierta queda resaltada; migas y título salen del catálogo', async () => {
        await montar(PaginaEmpresas, '/configuracion/empresas')
        const lista = document.querySelector('[data-prueba="navegacion-ajustes"]')
        expect(lista?.querySelector('[aria-current="page"]')?.getAttribute('data-ajuste')).toBe('empresas')
        expect(lista?.querySelectorAll('[data-ajuste]')).toHaveLength(29)
        expect(document.querySelector('[data-prueba="migas"]')?.textContent).toMatch(/Ajustes.*Empresa y fiscal.*Datos de la empresa/)
        expect(document.querySelector('h1')?.textContent?.trim()).toBe('Datos de la empresa')
        expect(document.querySelector('[data-prueba="grupo-ajuste"]')?.textContent?.trim()).toBe('Empresa y fiscal')
        expect(document.querySelector('[data-prueba="volver-ajustes"]')?.getAttribute('href')).toBe('/configuracion')
        expect(document.querySelector('[data-prueba="pestanas-configuracion"]')).toBeNull()
    })

    it('cada enlace se oculta sin el permiso de su destino; Importar solo con el rol admin', async () => {
        useUsuarioActual().value = { ...meAdmin, roles: ['soporte'], permisos: meAdmin.permisos.filter(p => p !== 'usuarios.ver') }
        await montar(AjustesNavegacion, '/configuracion/empresas', { variante: 'lateral' })
        const ids = todos('[data-ajuste]').map(a => a.dataset.ajuste)
        expect(ids).not.toContain('usuarios')
        expect(ids).not.toContain('importar')
        expect(ids).toContain('roles')
    })

    it('indicador de atención: FEL en contingencia solo si la API lo dijo', async () => {
        useEmpresaActiva().elegir(1)
        bd.fel.configuraciones[1] = { ...configuracionFel(1), contingencia_activa: true, contingencia_motivo: 'Caída del certificador', contingencia_desde: '2026-11-20T10:00:00.000Z' }
        await montar(AjustesNavegacion, '/configuracion/empresas', { variante: 'lateral' })
        await esperar(() => expect(document.querySelector('[data-atencion="fel"]')?.getAttribute('title')).toBe('Contingencia activa'))
        for (const vista of montadas.splice(0)) {
            vista.unmount()
        }
        document.body.innerHTML = ''
        bd.fallas['GET /api/v1/fel/configuracion'] = 500
        await montar(AjustesNavegacion, '/configuracion/empresas', { variante: 'indice' })
        expect(document.querySelector('[data-atencion]')).toBeNull()
    })
})
