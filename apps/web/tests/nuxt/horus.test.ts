import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reiniciarFixtures, sesionFixture, simularFalla } from '~~/fixtures'
import { bd } from '~~/fixtures/bd'
import { TICKET_SIN_VINCULAR, TICKET_VINCULADO } from '~~/fixtures/horus/datos'
import meAdmin from '~~/fixtures/auth/me.admin.json'
import meCajero from '~~/fixtures/auth/me.cajero.json'
import { UApp } from '#components'
import PaginaHorus from '~/pages/configuracion/integraciones/horus.vue'
import PaginaSso from '~/pages/sso/entrar.vue'
import PaginaPerfil from '~/pages/perfil.vue'
import PaginaServicios from '~/pages/servicios/index.vue'
import ServicioHorus from '~/components/ServicioHorus.vue'
import VerEnHorusBoton from '~/components/VerEnHorusBoton.vue'

/** Integración con Horus (contrato 1.2.0): configuración, "Ver en Horus", autologin y seguridad. */

const conApp = (componente: Component, props: Record<string, unknown> = {}) => defineComponent({
    render: () => h(UApp, null, { default: () => h(componente, props) }),
})

/** Texto de lo que se teletransporta a `body` (modales, popovers, toasts). */
const cuerpo = () => document.body.textContent ?? ''

function botonEnBody(texto: string): HTMLButtonElement | undefined {
    return [...document.body.querySelectorAll('button')].find(b => (b.textContent ?? '').trim() === texto)
}

describe('horus · utilidades', () => {
    const ahora = Date.parse('2026-10-17T12:00:00Z')

    it('"Dato de hace X" solo con el último dato conocido', () => {
        expect(marcaDatoViejo(false, '2026-10-17T11:48:00Z', ahora)).toBeNull()
        expect(marcaDatoViejo(true, '2026-10-17T11:48:00Z', ahora)).toBe('Dato de hace 12 min')
        expect(marcaDatoViejo(true, '2026-10-17T09:00:00Z', ahora)).toBe('Dato de hace 3 h')
        expect(marcaDatoViejo(true, '2026-10-14T12:00:00Z', ahora)).toBe('Dato de hace 3 días')
        expect(marcaDatoViejo(true, null, ahora)).toBe('Dato de una lectura anterior')
    })

    it('cuenta regresiva del enlace (15 min) y vencido', () => {
        expect(tiempoRestante('2026-10-17T12:15:00Z', ahora)).toBe('15:00')
        expect(tiempoRestante('2026-10-17T12:00:59Z', ahora)).toBe('00:59')
        expect(tiempoRestante('2026-10-17T11:59:00Z', ahora)).toBeNull()
    })

    it('seguridad de la consulta 360: estado, hallazgos y valores desconocidos', () => {
        const leida = leerSeguridad({ security: { state: 'compromised', open_findings: 2, findings: [{ id: 7, kind: 'botnet_c2', severity: 'critical', opened_at: '2026-10-17T10:00:00Z', summary: 'C2' }, { sin: 'id' }] } })
        expect(leida).toEqual({ estado: 'compromised', hallazgos_abiertos: 2, hallazgos: [{ id: '7', tipo: 'botnet_c2', severidad: 'critical', abierto_en: '2026-10-17T10:00:00Z', resumen: 'C2' }] })
        expect(leerSeguridad({ customer: {} })).toBeNull()
        expect(leerSeguridad(null)).toBeNull()
        expect(leerSeguridad({ security: { state: 'raro' } })?.estado).toBe('desconocido')
        expect(motivoSinSeguridad({ meta: { omitted: [{ block: 'consumption', reason: 'not_requested' }, { block: 'security', reason: 'permission' }] } })).toContain('permiso de seguridad')
        // Cada estado lleva icono + texto + color.
        for (const presentacion of Object.values(ESTADOS_SEGURIDAD)) {
            expect(presentacion.etiqueta).not.toBe('')
            expect(presentacion.icono).toMatch(/^i-lucide-/)
        }
    })

    it('pausa de Horus: `reintentar_en` del problem+json y su texto en hora de Guatemala', () => {
        const problema = { type: 'urn:argosisp:problema:horus_error', title: 'Horus no respondió', status: 502, reintentar_en: '2026-10-17T12:04:00.000Z' }
        expect(reintentarEnDe(problema)).toBe('2026-10-17T12:04:00.000Z')
        expect(reintentarEnDe({ type: 'about:blank', title: 'x', status: 500 })).toBeNull()
        expect(textoPausaHorus('2026-10-17T12:04:00.000Z', ahora)).toBe('Horus en pausa hasta las 06:04')
        expect(textoPausaHorus('2026-10-17T11:59:00.000Z', ahora)).toBeNull()
        expect(textoPausaHorus(null, ahora)).toBeNull()
    })

    it('/sso/entrar: ticket del fragmento y solo rutas locales', () => {
        expect(ticketDelFragmento(`#${TICKET_VINCULADO}`)).toBe(TICKET_VINCULADO)
        expect(ticketDelFragmento('#corto')).toBeNull()
        expect(ticketDelFragmento('')).toBeNull()
        expect(rutaLocalSegura('/servicios/812')).toBe('/servicios/812')
        expect(rutaLocalSegura('//malo.example/x')).toBe('/')
        expect(rutaLocalSegura('https://malo.example')).toBe('/')
        expect(rutaLocalSegura('/\\malo')).toBe('/')
        expect(mensajeErrorSso({ type: 'urn:argosisp:problema:ticket_invalido', title: 'x', status: 410 }).titulo).toBe('El enlace venció')
    })
})

describe('horus · pantallas', () => {
    beforeEach(async () => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
        useEstadoConectorHorus().value = null
        usePausaHorus().value = null
        await flushPromises()
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
        vi.restoreAllMocks()
    })

    it('configuración: apagada por defecto; conectar con enlace de Horus la deja apagada; activarla', async () => {
        const vista = await mountSuspended(conApp(PaginaHorus), { route: '/configuracion/integraciones/horus' })
        await vi.waitFor(() => expect(vista.find('[data-prueba="estado-conector"]').text()).toBe('Apagada'))
        expect(vista.get('[data-prueba="interruptor-horus"]').attributes('disabled')).toBeDefined()

        await vista.get('input[data-prueba="enlace-horus"]').setValue('https://horus.isp.gt/conectar#vencido123')
        await vista.get('form:has([data-prueba="enlace-horus"])').trigger('submit')
        await vi.waitFor(() => expect(vista.text()).toContain('El enlace de Horus venció o ya se usó'))

        await vista.get('input[data-prueba="enlace-horus"]').setValue('https://horus.isp.gt/conectar#abc123def456')
        await vista.get('form:has([data-prueba="enlace-horus"])').trigger('submit')
        await vi.waitFor(() => expect(bd.horus.conector.version).toBe(1))
        expect(bd.horus.conector.activo).toBe(false)
        expect(bd.horus.conector.url_base).toBe('https://horus.isp.gt')
        await vi.waitFor(() => expect(vista.find('[data-prueba="estado-conector"]').text()).toBe('Apagada'))
        // El canje también emite el token atk_ de Horus (sin su valor en la lista).
        await vi.waitFor(() => expect(vista.get('[data-prueba="tabla-tokens-horus"]').text()).toContain('Horus (enlace de conexión)'))

        await vista.get('[data-prueba="interruptor-horus"]').trigger('click')
        await vi.waitFor(() => expect(bd.horus.conector.activo).toBe(true))
        await vi.waitFor(() => expect(vista.find('[data-prueba="estado-conector"]').text()).toBe('Activa'))
        expect(useEstadoConectorHorus().value).toBe('activo')
        expect(bd.acciones.some(a => a.accion === 'horus.conectar_enlace')).toBe(true)
    })

    it('el enlace de conexión y el token atk_ se muestran una sola vez, con la caducidad visible', async () => {
        const vista = await mountSuspended(conApp(PaginaHorus), { route: '/configuracion/integraciones/horus' })
        await vi.waitFor(() => expect(vista.find('[data-prueba="generar-enlace"]').exists()).toBe(true))
        await vista.get('[data-prueba="generar-enlace"]').trigger('click')
        await vi.waitFor(() => expect(document.body.querySelector('[data-prueba="valor-Enlace"]')).not.toBeNull())
        const enlace = document.body.querySelector('[data-prueba="valor-Enlace"]')?.textContent ?? ''
        expect(enlace).toMatch(/\/conectar#\w+/)
        expect(document.body.querySelector('[data-prueba="caducidad"]')?.textContent).toMatch(/Vence en (14:5\d|15:00)/)
        botonEnBody('Ya lo copié, cerrar')?.click()
        await vi.waitFor(() => expect(cuerpo()).not.toContain(enlace))

        await vista.get('[data-prueba="generar-token-horus"]').trigger('click')
        await vi.waitFor(() => expect(document.body.querySelector('[data-prueba="confirmar-token-horus"]')).not.toBeNull())
        document.body.querySelector<HTMLButtonElement>('[data-prueba="confirmar-token-horus"]')?.click()
        await vi.waitFor(() => expect(document.body.querySelector('[data-prueba="valor-Token"]')).not.toBeNull())
        const token = document.body.querySelector('[data-prueba="valor-Token"]')?.textContent ?? ''
        expect(token).toMatch(/^atk_/)
        botonEnBody('Ya lo copié, cerrar')?.click()
        await vi.waitFor(() => expect(cuerpo()).not.toContain(token))
        // La lista nunca trae el valor; revocar con confirmación.
        await vi.waitFor(() => expect(vista.find('[data-prueba="revocar-token-1"]').exists()).toBe(true))
        expect(vista.html()).not.toContain(token)
        await vista.get('[data-prueba="revocar-token-1"]').trigger('click')
        await vi.waitFor(() => expect(document.body.querySelector('[data-prueba="confirmar-accion"]')).not.toBeNull())
        document.body.querySelector<HTMLButtonElement>('[data-prueba="confirmar-accion"]')?.click()
        await vi.waitFor(() => expect(bd.horus.tokens[0]?.revocado_en).not.toBeNull())
    })

    it('sin conector legible: el error con "Reintentar", no un estado inventado', async () => {
        simularFalla('GET /api/v1/integraciones/horus', 500)
        const vista = await mountSuspended(conApp(PaginaHorus), { route: '/configuracion/integraciones/horus' })
        await vi.waitFor(() => expect(vista.text()).toContain('Reintentar'))
        expect(vista.find('[data-prueba="estado-conector"]').exists()).toBe(false)
    })

    it('"Ver en Horus": deshabilitado con explicación si está apagado o falta el permiso', async () => {
        const apagado = await mountSuspended(conApp(VerEnHorusBoton, { tipo: 'cliente', idExterno: 1 }))
        await vi.waitFor(() => expect(apagado.get('[data-prueba="ver-en-horus-cliente"]').attributes('disabled')).toBeDefined())
        await apagado.get('[data-prueba="por-que-horus"]').trigger('click')
        await vi.waitFor(() => expect(cuerpo()).toContain(EXPLICACION_HORUS.apagado))

        useEstadoConectorHorus().value = null
        bd.horus.conector.activo = true
        useUsuarioActual().value = meCajero
        const sinPermiso = await mountSuspended(conApp(VerEnHorusBoton, { tipo: 'cliente', idExterno: 1 }))
        expect(sinPermiso.get('[data-prueba="ver-en-horus-cliente"]').attributes('disabled')).toBeDefined()
        await sinPermiso.get('[data-prueba="por-que-horus"]').trigger('click')
        await vi.waitFor(() => expect(cuerpo()).toContain(EXPLICACION_HORUS.sinPermiso))
    })

    it('"Ver en Horus" se deshabilita antes del clic con `GET /integraciones/horus/estado` y con Horus en pausa', async () => {
        bd.horus.conector = { ...bd.horus.conector, activo: true, url_base: 'https://horus.isp.gt', token: '***' }
        const activo = await mountSuspended(conApp(VerEnHorusBoton, { tipo: 'cliente', idExterno: 1 }))
        await vi.waitFor(() => expect(useEstadoConectorHorus().value).toBe('activo'))
        expect(activo.get('[data-prueba="ver-en-horus-cliente"]').attributes('disabled')).toBeUndefined()

        // Sin `horus.ver`: el estado sale igual del endpoint de `horus.abrir`.
        useEstadoConectorHorus().value = null
        bd.horus.conector = { ...bd.horus.conector, salud: { ...bd.horus.conector.salud, pausa_hasta: new Date(Date.now() + 5 * 60_000).toISOString() } }
        useUsuarioActual().value = { ...meAdmin, permisos: meAdmin.permisos.filter(p => p !== 'horus.ver') }
        const enPausa = await mountSuspended(conApp(VerEnHorusBoton, { tipo: 'cliente', idExterno: 1 }))
        await vi.waitFor(() => expect(enPausa.get('[data-prueba="ver-en-horus-cliente"]').attributes('disabled')).toBeDefined())
        await enPausa.get('[data-prueba="por-que-horus"]').trigger('click')
        await vi.waitFor(() => expect(cuerpo()).toMatch(/Horus en pausa hasta las \d\d:\d\d/))
    })

    it('"Ver en Horus" abre la URL que da la API en otra pestaña (el navegador no pide el ticket)', async () => {
        bd.horus.conector = { ...bd.horus.conector, activo: true, url_base: 'https://horus.isp.gt', token: '***' }
        const ventana = { opener: {}, location: { replace: vi.fn() }, close: vi.fn() }
        const abrir = vi.spyOn(window, 'open').mockReturnValue(ventana as unknown as Window)
        const vista = await mountSuspended(conApp(VerEnHorusBoton, { tipo: 'servicio', idExterno: 1 }))
        await vi.waitFor(() => expect(useEstadoConectorHorus().value).toBe('activo'))
        await vista.get('[data-prueba="ver-en-horus-servicio"]').trigger('click')
        await vi.waitFor(() => expect(ventana.location.replace).toHaveBeenCalled())
        expect(abrir).toHaveBeenCalledWith('', '_blank')
        expect(ventana.opener).toBeNull()
        expect(ventana.location.replace.mock.calls[0]?.[0]).toMatch(/^https:\/\/horus\.example\.test\/sso\/entrar#tkt_servicio_1_/)
    })

    it('ficha del servicio: seguridad, hallazgo y "Dato de hace X"; sin dato, error con "Reintentar"; apagado, nada', async () => {
        bd.horus.conector.activo = true
        const uno = await mountSuspended(conApp(ServicioHorus, { servicioId: 1 }))
        await vi.waitFor(() => expect(uno.find('[data-prueba="seguridad-horus"]').exists()).toBe(true))
        expect(uno.get('[data-prueba="seguridad-horus"]').attributes('data-estado')).toBe('suspected')
        expect(uno.get('[data-prueba="seguridad-horus"]').text()).toContain('Sospechoso · 1 hallazgo abierto')
        expect(uno.get('[data-prueba="hallazgos-horus"]').text()).toContain('Escaneo saliente')
        expect(uno.find('[data-prueba="seguridad-dato-viejo"]').exists()).toBe(false)

        const dos = await mountSuspended(conApp(ServicioHorus, { servicioId: 2 }))
        await vi.waitFor(() => expect(dos.find('[data-prueba="seguridad-dato-viejo"]').exists()).toBe(true))
        expect(dos.get('[data-prueba="seguridad-dato-viejo"]').text()).toBe('Dato de hace 12 min')
        expect(dos.get('[data-prueba="horus-stale"]').text()).toContain('Horus respondió 503')
        expect(dos.get('[data-prueba="horus-pausa"]').text()).toMatch(/Horus en pausa hasta las \d\d:\d\d/)
        expect(uno.find('[data-prueba="horus-pausa"]').exists()).toBe(false)

        const tres = await mountSuspended(conApp(ServicioHorus, { servicioId: 3 }))
        await vi.waitFor(() => expect(tres.find('[data-prueba="horus-sin-datos"]').exists()).toBe(true))
        expect(tres.text()).toContain('Reintentar')
        expect(tres.find('[data-prueba="seguridad-horus"]').exists()).toBe(false)

        bd.horus.conector.activo = false
        const apagado = await mountSuspended(conApp(ServicioHorus, { servicioId: 1 }))
        await vi.waitFor(() => expect(apagado.find('[data-prueba="bloque-horus"]').exists()).toBe(false))
    })

    it('lista de servicios: insignia de seguridad por fila solo con Horus activo', async () => {
        const apagada = await mountSuspended(conApp(PaginaServicios), { route: '/servicios' })
        await vi.waitFor(() => expect(apagada.text()).toContain('Servicio'))
        await flushPromises()
        expect(apagada.find('[data-prueba="seguridad-horus"]').exists()).toBe(false)
        apagada.unmount()

        bd.horus.conector.activo = true
        bd.servicios = bd.servicios.filter(s => s.id <= 3)
        const vista = await mountSuspended(conApp(PaginaServicios), { route: '/servicios' })
        await vi.waitFor(() => expect(vista.find('[data-estado="suspected"]').exists()).toBe(true))
        expect(vista.find('[data-estado="clean"]').text()).toContain('Dato de hace 12 min')
        // El servicio 3 no tiene identidad en Horus: sin insignia (nunca un "Limpio" inventado).
        expect(vista.findAll('[data-prueba="seguridad-horus"]')).toHaveLength(2)
    })

    it('/sso/entrar con vinculación: abre la sesión, borra el ticket de la URL y va al destino', async () => {
        sesionFixture(null)
        useUsuarioActual().value = null
        const navegar = vi.spyOn(useRouter(), 'replace')
        await mountSuspended(PaginaSso, { route: `/sso/entrar#${TICKET_VINCULADO}` })
        await vi.waitFor(() => expect(useUsuarioActual().value?.email).toBe('admin@argos.test'))
        expect(window.location.hash).toBe('')
        expect(useCsrf().value).toMatch(/^csrf-/)
        await vi.waitFor(() => expect(navegar.mock.calls.some(([destino]) => JSON.stringify(destino).includes('/servicios/1'))).toBe(true))
    })

    it('/sso/entrar sin vinculación: login normal que vincula; un ticket usado responde "venció"', async () => {
        sesionFixture(null)
        useUsuarioActual().value = null
        const vista = await mountSuspended(PaginaSso, { route: `/sso/entrar#${TICKET_SIN_VINCULAR}` })
        await vi.waitFor(() => expect(vista.find('[data-prueba="sso-vincular"]').exists()).toBe(true))
        expect(vista.text()).toContain('Luis Pérez (Horus)')
        expect(useUsuarioActual().value).toBeNull()
        await vista.get('input[type="email"]').setValue('admin@argos.test')
        await vista.get('input[type="password"]').setValue('cualquiera')
        await vista.get('form').trigger('submit')
        await vi.waitFor(() => expect(useUsuarioActual().value?.email).toBe('admin@argos.test'))
        expect(bd.horus.vinculaciones.some(v => v.id_externo === 'u-42' && v.usuario_id === 1)).toBe(true)

        await useRouter().replace(`/sso/entrar#${TICKET_SIN_VINCULAR}`)
        window.history.replaceState(null, '', `/sso/entrar#${TICKET_SIN_VINCULAR}`)
        const otra = await mountSuspended(PaginaSso, { route: `/sso/entrar#${TICKET_SIN_VINCULAR}` })
        await vi.waitFor(() => expect(otra.find('[data-prueba="sso-error"]').exists()).toBe(true))
        expect(otra.get('[data-prueba="sso-error"]').text()).toContain('El enlace venció')
    })

    it('Mi cuenta: lista y quita mis vinculaciones', async () => {
        const vista = await mountSuspended(conApp(PaginaPerfil), { route: '/perfil' })
        await vi.waitFor(() => expect(vista.get('[data-prueba="tabla-vinculaciones"]').text()).toContain('Ana López (Horus)'))
        await vista.get('[data-prueba="quitar-vinculacion-1"]').trigger('click')
        await vi.waitFor(() => expect(document.body.querySelector('[data-prueba="confirmar-accion"]')).not.toBeNull())
        document.body.querySelector<HTMLButtonElement>('[data-prueba="confirmar-accion"]')?.click()
        await vi.waitFor(() => expect(bd.horus.vinculaciones[0]?.revocada_en).not.toBeNull())
        await vi.waitFor(() => expect(vista.get('[data-prueba="tabla-vinculaciones"]').text()).toContain('Sin cuentas vinculadas'))
    })
})
