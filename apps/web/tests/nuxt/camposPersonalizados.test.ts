import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import { meAdmin } from '~~/fixtures/auth/sesiones'
import { bd } from '~~/fixtures/bd'
import { UApp } from '#components'
import PaginaCampos from '~/pages/campos-personalizados.vue'
import PaginaRouters from '~/pages/routers/index.vue'
import RouterContacto from '~/components/RouterContacto.vue'
import { esperar } from '../ayudas/esperar'

/** Catálogo de campos personalizados (A1) y contacto de los routers (`en_linea`, `ultimo_contacto`). */

function conApp(componente: Parameters<typeof h>[0]) {
    return defineComponent({ render: () => h(UApp, null, { default: () => h(componente) }) })
}

beforeEach(() => {
    reiniciarFixtures()
    sesionFixture('fixture-admin')
    useUsuarioActual().value = meAdmin
    useEmpresaActiva().elegir(1)
})

afterEach(() => {
    sesionFixture(null)
    useUsuarioActual().value = null
})

describe('campos personalizados', () => {
    it('el esquema espeja al validador: clave, opciones solo con lista, orden', () => {
        const base = { clave: 'poste', etiqueta: 'Poste', tipo: 'texto' as const, opciones: [], requerido: false, orden: 0 }
        expect(esquemaCampoPersonalizado.safeParse(base).success).toBe(true)
        expect(esquemaCampoPersonalizado.safeParse({ ...base, clave: '1poste' }).success).toBe(false)
        expect(esquemaCampoPersonalizado.safeParse({ ...base, clave: 'Poste' }).success).toBe(false)
        expect(esquemaCampoPersonalizado.safeParse({ ...base, tipo: 'opcion' }).success).toBe(false)
        expect(esquemaCampoPersonalizado.safeParse({ ...base, opciones: ['a'] }).success).toBe(false)
        expect(esquemaCampoPersonalizado.safeParse({ ...base, tipo: 'opcion', opciones: ['a', 'a'] }).success).toBe(false)
        expect(esquemaCampoPersonalizado.safeParse({ ...base, orden: 10001 }).success).toBe(false)
        expect(claveDesdeEtiqueta('Número de poste (zona)')).toBe('numero_de_poste_zona')
        expect(claveDesdeEtiqueta('3 Árboles')).toBe('arboles')
    })

    it('crear, clave repetida 409, editar con versión, desactivar y activar', async () => {
        const campos = useCamposPersonalizados()
        const creado = await campos.crear({ clave: 'color_casa', etiqueta: 'Color de la casa', tipo: 'opcion', opciones: ['Blanca', 'Azul'] })
        expect(creado.ok && creado.data).toMatchObject({ clave: 'color_casa', requerido: false, orden: 0, activo: true, version: 1 })
        const repetido = await campos.crear({ clave: 'color_casa', etiqueta: 'Otra', tipo: 'texto' })
        expect(!repetido.ok && repetido.problema).toMatchObject({ status: 409, type: 'urn:argosisp:problema:campo_duplicado' })
        const sinOpciones = await campos.crear({ clave: 'vacio', etiqueta: 'Vacío', tipo: 'opcion', opciones: [] })
        expect(!sinOpciones.ok && sinOpciones.problema.errors?.[0]?.field).toBe('opciones')
        const id = creado.ok ? creado.data.id : 0
        const editado = await campos.editar(id, { version: 1, etiqueta: 'Color', requerido: true })
        expect(editado.ok && editado.data).toMatchObject({ etiqueta: 'Color', requerido: true, version: 2 })
        const viejo = await campos.editar(id, { version: 1, orden: 5 })
        expect(!viejo.ok && viejo.problema.status).toBe(409)
        const inactivo = await campos.desactivar({ id, version: 2 })
        expect(inactivo.ok && inactivo.data).toMatchObject({ activo: false, version: 3 })
        const activos = await campos.listar(true)
        expect(activos.ok && activos.data.map(c => c.clave)).not.toContain('color_casa')
        const activo = await campos.activar({ id, version: 3 })
        expect(activo.ok && activo.data.activo).toBe(true)
    })

    it('la pantalla lista el catálogo en orden, con su tipo y estado, y resalta ?campo=', async () => {
        const pagina = await mountSuspended(conApp(PaginaCampos), { route: '/campos-personalizados?campo=2' })
        await esperar(() => expect(pagina.find('[data-campo="medio_contacto"]').exists()).toBe(true))
        const tabla = pagina.find('[data-prueba="tabla-campos"]').text()
        expect(tabla.indexOf('Referencia de la casa')).toBeLessThan(tabla.indexOf('Número de poste'))
        expect(tabla).toContain('Vecino · Redes sociales · Volante')
        expect(pagina.find('[data-prueba="estado-campo-numero_poste"]').text()).toBe('Inactivo')
        expect(pagina.find('[data-campo="medio_contacto"]').classes()).toContain('ring-2')
        expect(pagina.find('[data-prueba="nuevo-campo"]').exists()).toBe(true)
    })

    it('si la API falla, muestra el error con Reintentar y ninguna fila', async () => {
        bd.fallas['GET /api/v1/campos-personalizados'] = 500
        const pagina = await mountSuspended(conApp(PaginaCampos))
        await esperar(() => expect(pagina.text()).toContain('Reintentar'))
        expect(pagina.find('[data-prueba="tabla-campos"]').exists()).toBe(false)
    })

    it('la bitácora lleva al catálogo', () => {
        expect(rutaEntidad('campo_personalizado', 3)).toBe('/campos-personalizados?campo=3')
    })
})

describe('contacto de los routers', () => {
    it('null es desconocido; true en línea; false fuera de línea', () => {
        expect(estadoContactoRouter({ en_linea: null, ultimo_contacto: null })).toBe('desconocido')
        expect(estadoContactoRouter({ en_linea: true, ultimo_contacto: '2026-10-24T15:00:00Z' })).toBe('en_linea')
        expect(estadoContactoRouter({ en_linea: false, ultimo_contacto: '2026-10-24T15:00:00Z' })).toBe('caido')
        expect(textoUltimoContacto({ en_linea: null, ultimo_contacto: null })).toBe('Nunca respondió')
        expect(textoUltimoContacto({ en_linea: true, ultimo_contacto: '2026-10-24T15:00:00Z' }, Date.parse('2026-10-24T15:05:00Z'))).toBe('hace 5 min')
    })

    it('la insignia muestra el estado y la fecha exacta en el título', async () => {
        const contacto = await mountSuspended(RouterContacto, { props: { router: { id: 9, en_linea: false, ultimo_contacto: '2026-10-24T15:00:00Z' } } })
        expect(contacto.find('[data-prueba="en-linea-9"]').text()).toBe('Fuera de línea')
        expect(contacto.find('[data-prueba="ultimo-contacto-9"]').attributes('title')).toBe(formatearFechaHora('2026-10-24T15:00:00Z'))
    })

    it('la lista muestra Desconocido mientras nada lo mide', async () => {
        const router = bd.routers[0]
        if (router) {
            Object.assign(router, { en_linea: true, ultimo_contacto: new Date(Date.now() - 120_000).toISOString() })
        }
        const pagina = await mountSuspended(conApp(PaginaRouters))
        await esperar(() => expect(pagina.find('[data-prueba="contacto-2"]').exists()).toBe(true))
        expect(pagina.find('[data-prueba="en-linea-1"]').text()).toBe('En línea')
        expect(pagina.find('[data-prueba="ultimo-contacto-1"]').text()).toBe('hace 2 min')
        expect(pagina.find('[data-prueba="en-linea-2"]').text()).toBe('Desconocido')
        expect(pagina.find('[data-prueba="ultimo-contacto-2"]').text()).toBe('Nunca respondió')
    })
})
