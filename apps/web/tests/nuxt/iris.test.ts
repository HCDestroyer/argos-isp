import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reiniciarFixtures, sesionFixture, simularFalla } from '~~/fixtures'
import { bd } from '~~/fixtures/bd'
import { enviosIrisEjemplo } from '~~/fixtures/iris/datos'
import { meAdmin } from '~~/fixtures/auth/sesiones'
import { UApp } from '#components'
import PaginaIris from '~/pages/configuracion/integraciones/iris.vue'
import PaginaIntegraciones from '~/pages/configuracion/integraciones/index.vue'
import { esperar } from '../ayudas/esperar'

/** Configuración → Integraciones → Iris (`contratos/iris.md` §1 y §2.3). */

const conApp = (componente: Component) => defineComponent({
    render: () => h(UApp, null, { default: () => h(componente) }),
})

/** Texto de lo que se teletransporta a `body` (modales, toasts). */
const cuerpo = () => document.body.textContent ?? ''

function botonEnBody(texto: string): HTMLButtonElement | undefined {
    return [...document.body.querySelectorAll('button')].find(b => (b.textContent ?? '').trim() === texto)
}

function botonEn(raiz: { findAll: (selector: string) => { text: () => string, trigger: (evento: string) => Promise<void> }[] }, texto: string) {
    const boton = raiz.findAll('button').find(b => b.text().trim() === texto)
    if (!boton) {
        throw new Error(`No hay botón «${texto}»`)
    }
    return boton
}

const TOKEN_IRIS = 'iris_pat_AbCdEf0123456789XyZ'

describe('iris · utilidades', () => {
    it('estado del conector y alcance de los envíos', () => {
        const base = { ...bd.iris.conector }
        expect(presentacionConectorIris(base).etiqueta).toBe('Sin conectar')
        expect(presentacionConectorIris({ ...base, version: 3 }).etiqueta).toBe('Apagada')
        expect(presentacionConectorIris({ ...base, version: 3, activo: true }).etiqueta).toBe('Activa')
        expect(irisListoParaActivar(base)).toBe(false)
        expect(irisListoParaActivar({ ...base, url_base: 'https://iris.isp.gt', token: '***' })).toBe(true)
        expect(textoAlcanceIris(null)).toContain('no se envía nada')
        expect(textoAlcanceIris({ global: true, empresas: [] })).toBe('Todas las empresas')
        expect(textoAlcanceIris({ global: false, empresas: [1, 2] })).toBe('2 empresas')
        for (const presentacion of Object.values(ESTADOS_ENVIO_IRIS)) {
            expect(presentacion.etiqueta).not.toBe('')
            expect(presentacion.icono).toMatch(/^i-lucide-/)
        }
    })

    it('el esquema del formulario es espejo de ConfigurarIris', () => {
        const valido = { url_base: 'https://iris.isp.gt', webhook_salida_url: '', token: TOKEN_IRIS, webhook_salida_secreto: '' }
        expect(esquemaConectorIris.safeParse(valido).success).toBe(true)
        expect(esquemaConectorIris.safeParse({ ...valido, token: 'hf_pat_AbCdEf0123456789' }).success).toBe(false)
        expect(esquemaConectorIris.safeParse({ ...valido, url_base: 'iris.isp.gt' }).success).toBe(false)
        expect(esquemaConectorIris.safeParse({ ...valido, webhook_salida_secreto: 'corto' }).success).toBe(false)
    })
})

describe('iris · pantalla', () => {
    beforeEach(async () => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
        await flushPromises()
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
        vi.restoreAllMocks()
    })

    it('sin conectar por defecto; configuración a mano con el 422 en su campo; activarla', async () => {
        const vista = await mountSuspended(conApp(PaginaIris), { route: '/configuracion/integraciones/iris' })
        await esperar(() => expect(vista.find('[data-prueba="estado-conector-iris"]').text()).toBe('Sin conectar'))
        expect(vista.get('[data-prueba="interruptor-iris"]').attributes('disabled')).toBeDefined()

        await vista.get('input[data-prueba="url-iris"]').setValue('https://iris.isp.gt')
        await botonEn(vista, 'Escribir').trigger('click')
        await esperar(() => expect(vista.find('input[data-prueba="secreto-token"]').exists()).toBe(true))
        await vista.get('input[data-prueba="secreto-token"]').setValue(TOKEN_IRIS)
        await vista.get('form:has([data-prueba="url-iris"])').trigger('submit')
        await esperar(() => expect(bd.iris.conector.version).toBe(1))
        expect(bd.iris.conector).toMatchObject({ url_base: 'https://iris.isp.gt', token: '***', activo: false })
        await esperar(() => expect(vista.find('[data-prueba="estado-conector-iris"]').text()).toBe('Apagada'))
        // El token nunca vuelve: el formulario lo muestra como guardado.
        expect(vista.html()).not.toContain(TOKEN_IRIS)

        await vista.get('[data-prueba="interruptor-iris"]').trigger('click')
        await esperar(() => expect(bd.iris.conector.activo).toBe(true))
        await esperar(() => expect(vista.find('[data-prueba="estado-conector-iris"]').text()).toBe('Activa'))
        expect(bd.acciones.filter(a => a.accion === 'iris.configurar')).toHaveLength(2)
    })

    it('un token que no es iris_pat_ lo rechaza la API y se ve en el campo', async () => {
        const vista = await mountSuspended(conApp(PaginaIris), { route: '/configuracion/integraciones/iris' })
        await esperar(() => expect(vista.find('input[data-prueba="url-iris"]').exists()).toBe(true))
        // Sin pasar por el esquema del formulario: lo que valida es la API (fixture = ConfigurarIris).
        const resultado = await useIris().guardar({ version: 0, token: 'hf_pat_AbCdEf0123456789' })
        expect(resultado.ok).toBe(false)
        expect(resultado.ok ? null : resultado.problema.errors?.[0]?.message).toBe('El token de Iris empieza con iris_pat_')
        expect(bd.iris.conector.version).toBe(0)
    })

    it('el enlace de conexión se muestra una sola vez, con copiar, la instrucción y los 15 minutos', async () => {
        const vista = await mountSuspended(conApp(PaginaIris), { route: '/configuracion/integraciones/iris' })
        await esperar(() => expect(vista.find('[data-prueba="generar-enlace-iris"]').exists()).toBe(true))
        expect(vista.get('[data-prueba="generar-enlace-iris"]').text()).toBe('Generar enlace de conexión')
        await vista.get('[data-prueba="generar-enlace-iris"]').trigger('click')
        await esperar(() => expect(document.body.querySelector('[data-prueba="valor-Enlace"]')).not.toBeNull())
        const enlace = document.body.querySelector('[data-prueba="valor-Enlace"]')?.textContent ?? ''
        expect(enlace).toMatch(/\/conectar#\w+/)
        expect(cuerpo()).toContain('Pégalo en Iris → Administración → Integraciones → Conectar. Vence en 15 minutos y sirve una sola vez')
        expect(document.body.querySelector('[data-prueba="caducidad"]')?.textContent).toMatch(/Vence en (14:5\d|15:00)/)
        expect(botonEnBody('Copiar')).toBeDefined()
        expect(bd.acciones.some(a => a.accion === 'iris.generar_enlace')).toBe(true)

        botonEnBody('Ya lo copié, cerrar')?.click()
        await esperar(() => expect(cuerpo()).not.toContain(enlace))
        expect(vista.html()).not.toContain(enlace)
    })

    it('token atk_ para Iris: se ve una vez, la lista no trae su valor y se revoca con confirmación', async () => {
        const vista = await mountSuspended(conApp(PaginaIris), { route: '/configuracion/integraciones/iris' })
        await esperar(() => expect(vista.find('[data-prueba="generar-token-iris"]').exists()).toBe(true))
        await vista.get('[data-prueba="generar-token-iris"]').trigger('click')
        await esperar(() => expect(document.body.querySelector('[data-prueba="confirmar-token-iris"]')).not.toBeNull())
        document.body.querySelector<HTMLButtonElement>('[data-prueba="confirmar-token-iris"]')?.click()
        await esperar(() => expect(document.body.querySelector('[data-prueba="valor-Token"]')).not.toBeNull())
        const token = document.body.querySelector('[data-prueba="valor-Token"]')?.textContent ?? ''
        expect(token).toMatch(/^atk_/)
        botonEnBody('Ya lo copié, cerrar')?.click()
        await esperar(() => expect(cuerpo()).not.toContain(token))

        await esperar(() => expect(vista.find('[data-prueba="revocar-token-1"]').exists()).toBe(true))
        expect(vista.get('[data-prueba="tabla-tokens-iris"]').text()).toContain('Iris')
        expect(vista.html()).not.toContain(token)
        await vista.get('[data-prueba="revocar-token-1"]').trigger('click')
        await esperar(() => expect(document.body.querySelector('[data-prueba="confirmar-accion"]')).not.toBeNull())
        document.body.querySelector<HTMLButtonElement>('[data-prueba="confirmar-accion"]')?.click()
        await esperar(() => expect(bd.iris.tokens[0]?.revocado_en).not.toBeNull())
    })

    it('envíos recientes: resumen, último fallo, estados con texto y "Ver más"', async () => {
        const ejemplo = enviosIrisEjemplo()
        const relleno = Array.from({ length: 22 }, (_, i) => ({ ...ejemplo[0]!, id: 10 + i, evento_id: `argos-evt-${200 + i}` }))
        bd.iris.envios = [...ejemplo, ...relleno]
        const vista = await mountSuspended(conApp(PaginaIris), { route: '/configuracion/integraciones/iris' })
        await esperar(() => expect(vista.find('[data-prueba="resumen-envios-iris"]').exists()).toBe(true))
        const resumen = vista.get('[data-prueba="resumen-envios-iris"]').text()
        expect(resumen).toContain('Pendientes')
        expect(resumen).toMatch(/Pendientes\s*1/)
        expect(resumen).toMatch(/Fallidos\s*1/)
        expect(vista.get('[data-prueba="sin-destino-iris"]').text()).toContain('No se envía nada a Iris')
        expect(vista.get('[data-prueba="ultimo-fallo-iris"]').text()).toContain('Iris respondió 503: mantenimiento')

        const tabla = () => vista.get('[data-prueba="tabla-envios-iris"]')
        expect(tabla().findAll('tbody tr')).toHaveLength(20)
        await vista.get('[data-prueba="mas-envios-iris"]').trigger('click')
        await esperar(() => expect(tabla().findAll('tbody tr')).toHaveLength(25))
        expect(vista.find('[data-prueba="mas-envios-iris"]').exists()).toBe(false)
        expect(tabla().text()).toContain('Fallido')
        expect(tabla().text()).toContain('Pendiente')
        expect(tabla().text()).toContain('Iris respondió 404: conector desconocido')
    })

    it('errores visibles con "Reintentar": sin conector ni envíos no hay estado ni contadores inventados', async () => {
        simularFalla('GET /api/v1/integraciones/iris', 500)
        simularFalla('GET /api/v1/integraciones/iris/envios/resumen', 501)
        simularFalla('GET /api/v1/integraciones/iris/tokens', 500)
        const vista = await mountSuspended(conApp(PaginaIris), { route: '/configuracion/integraciones/iris' })
        await esperar(() => expect(vista.findAll('button').filter(b => b.text().trim() === 'Reintentar')).toHaveLength(3))
        expect(vista.find('[data-prueba="estado-conector-iris"]').exists()).toBe(false)
        expect(vista.find('[data-prueba="interruptor-iris"]').exists()).toBe(false)
        expect(vista.find('[data-prueba="resumen-envios-iris"]').exists()).toBe(false)
        expect(vista.find('[data-prueba="tabla-envios-iris"]').exists()).toBe(false)
        expect(vista.find('[data-prueba="tabla-tokens-iris"]').exists()).toBe(false)

        // Al volver la API, "Reintentar" carga los datos reales.
        bd.fallas = {}
        const envios = vista.get('[data-prueba="envios-iris"]')
        await botonEn(envios, 'Reintentar').trigger('click')
        await esperar(() => expect(vista.find('[data-prueba="resumen-envios-iris"]').exists()).toBe(true))
        await botonEn(vista, 'Reintentar').trigger('click')
        await esperar(() => expect(vista.find('[data-prueba="estado-conector-iris"]').text()).toBe('Sin conectar'))
    })

    it('un enlace que no se pudo generar se ve con "Reintentar" y no abre nada', async () => {
        simularFalla('POST /api/v1/integraciones/iris/enlace', 500)
        const vista = await mountSuspended(conApp(PaginaIris), { route: '/configuracion/integraciones/iris' })
        await esperar(() => expect(vista.find('[data-prueba="generar-enlace-iris"]').exists()).toBe(true))
        await vista.get('[data-prueba="generar-enlace-iris"]').trigger('click')
        await esperar(() => expect(vista.text()).toContain('Reintentar'))
        expect(document.body.querySelector('[data-prueba="valor-Enlace"]')).toBeNull()
    })

    it('sin iris.configurar: ni enlace, ni interruptor activo, ni guardar', async () => {
        useUsuarioActual().value = { ...meAdmin, permisos: meAdmin.permisos.filter(p => !['iris.configurar', 'iris.generar_token', 'iris.revocar_token'].includes(p)) }
        bd.iris.tokens = [{ id: 1, usuario_id: 901, nombre: 'Iris', alcances: { permisos: ['clientes.ver'] }, ultimo_uso: null, revocado_en: null, created_at: '2026-10-30T15:00:00.000Z' }]
        const vista = await mountSuspended(conApp(PaginaIris), { route: '/configuracion/integraciones/iris' })
        await esperar(() => expect(vista.find('[data-prueba="estado-conector-iris"]').exists()).toBe(true))
        await esperar(() => expect(vista.get('[data-prueba="tabla-tokens-iris"]').text()).toContain('Vigente'))
        expect(vista.find('[data-prueba="generar-enlace-iris"]').exists()).toBe(false)
        expect(vista.find('[data-prueba="guardar-iris"]').exists()).toBe(false)
        expect(vista.find('[data-prueba="generar-token-iris"]').exists()).toBe(false)
        expect(vista.find('[data-prueba="revocar-token-1"]').exists()).toBe(false)
        expect(vista.get('[data-prueba="interruptor-iris"]').attributes('disabled')).toBeDefined()
    })

    it('índice de integraciones: tarjeta de Iris con su estado, solo con iris.ver', async () => {
        const vista = await mountSuspended(conApp(PaginaIntegraciones), { route: '/configuracion/integraciones' })
        await esperar(() => expect(vista.find('[data-prueba="estado-tarjeta-iris"]').text()).toBe('Sin conectar'))
        expect(vista.get('[data-prueba="configurar-iris"]').attributes('href')).toBe('/configuracion/integraciones/iris')
        expect(vista.find('[data-prueba="tarjeta-horus"]').exists()).toBe(true)

        useUsuarioActual().value = { ...meAdmin, permisos: meAdmin.permisos.filter(p => p !== 'iris.ver') }
        const sinIris = await mountSuspended(conApp(PaginaIntegraciones), { route: '/configuracion/integraciones' })
        await esperar(() => expect(sinIris.find('[data-prueba="estado-tarjeta-horus"]').exists()).toBe(true))
        expect(sinIris.find('[data-prueba="tarjeta-iris"]').exists()).toBe(false)
    })

    it('menú: Configuración → Iris con el permiso iris.ver', () => {
        const seccion = SECCIONES_PANEL.find(s => s.id === 'integracion-iris')
        expect(seccion).toMatchObject({ ruta: '/configuracion/integraciones/iris', permiso: 'iris.ver' })
        expect(grupoDeRuta('/configuracion/integraciones/iris')?.id).toBe('configuracion')
    })
})
