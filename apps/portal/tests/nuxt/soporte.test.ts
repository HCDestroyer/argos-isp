import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fijarFallaFixture, fijarSesionFixture, fijarSoporteFixture, limpiarFallasFixture } from '~~/fixtures'
import { A_CARGO_FIXTURE } from '~~/fixtures/soporte'
import PaginaCuenta from '~/pages/cuenta.vue'
import PaginaNuevo from '~/pages/soporte/nuevo.vue'
import PaginaTicket from '~/pages/soporte/[id].vue'
import CuentaContactos from '~/components/cuenta/Contactos.vue'
import CuentaACargo from '~/components/cuenta/ACargo.vue'

/**
 * Soporte con Iris en el portal (contrato Iris 0.9.0 §11, A30 y A31), «Mis contactos» (§3.5) y
 * «Está a cargo de» (§3.8) contra los fixtures: errores visibles con «Reintentar», la sesión de
 * `/corte` reducida y nada inventado.
 */

const { navegar } = vi.hoisted(() => ({ navegar: vi.fn() }))
mockNuxtImport('navigateTo', () => navegar)

async function esperar() {
    for (let i = 0; i < 10; i += 1) {
        await flushPromises()
    }
}

/** El `input` o `textarea` de un campo de Nuxt UI (el `data-testid` puede quedar en él o en su envoltorio). */
function campo(wrapper: { find: (selector: string) => ReturnType<Awaited<ReturnType<typeof mountSuspended>>['find']> }, testid: string) {
    const directo = wrapper.find(`input[data-testid="${testid}"], textarea[data-testid="${testid}"]`)
    return directo.exists() ? directo : wrapper.find(`[data-testid="${testid}"] input, [data-testid="${testid}"] textarea`)
}

function limpiarDatos() {
    clearNuxtData(clave => ['portal:cuenta', 'portal:soporte', 'portal:a-cargo', 'portal:puntos'].includes(clave))
}

async function montarSoporte() {
    limpiarDatos()
    fijarSesionFixture(true)
    useSesionPortal().confirmar()
    const wrapper = await mountSuspended(PaginaCuenta, { route: '/cuenta?seccion=soporte' })
    await esperar()
    return wrapper
}

afterEach(() => {
    fijarSesionFixture(false)
    fijarSoporteFixture(null)
    limpiarFallasFixture()
    navegar.mockReset()
    useSesionPortal().cerrar()
})

describe('textos y reglas de soporte', () => {
    it('la sección solo aparece con Iris conectado', () => {
        expect(seccionesVisibles(false, false).map(s => s.seccion)).not.toContain('soporte')
        expect(seccionesVisibles(false, true).map(s => s.seccion)).toContain('soporte')
        expect(soporteVisible(null)).toBe(false)
        expect(soporteVisible({ estado: 'sin_iris', detalle: null, capacidades: null, contactos: false, sesion: 'documento', empresas: [] })).toBe(false)
        expect(soporteVisible({ estado: 'apagado', detalle: 'x', capacidades: null, contactos: false, sesion: 'documento', empresas: [1] })).toBe(true)
    })

    it('qué pide cada solicitud y los adjuntos', () => {
        expect(pideServicio('cambio_plan')).toBe('obligatorio')
        expect(pideServicio('alta')).toBe('no')
        expect(pideDireccion('traslado')).toBe(true)
        expect(pideDireccion('cambio_plan')).toBe(false)
        const grande = new File([new Uint8Array(1)], 'a.jpg')
        Object.defineProperty(grande, 'size', { value: 11 * 1024 * 1024 })
        expect(errorAdjuntos([grande])).toContain('más de 10 MB')
        expect(errorAdjuntos([1, 2, 3, 4].map(n => new File([], `${n}.jpg`)))).toContain('hasta 3')
        expect(numeroLegible('+50255123344')).toBe('+502 5512-3344')
        expect(nombreServicioACargo({ id: 88, codigo: 'S-000412', nombre: 'Casa' })).toBe('S-000412 · Casa')
    })
})

describe('sección Soporte en /cuenta', () => {
    it('disponible: tickets con su estado y pestaña de solicitudes', async () => {
        fijarSoporteFixture('disponible')
        const wrapper = await montarSoporte()
        const lista = wrapper.find('[data-testid="soporte-tickets"]')
        expect(lista.text()).toContain('Internet lento en la noche')
        expect(lista.text()).toContain('En proceso')
        expect(lista.text()).toContain('Resuelto')
        expect(wrapper.find('[data-testid="soporte-reportar"]').exists()).toBe(true)
        expect(wrapper.find('[data-testid="soporte-pestanas"]').text()).toContain('Solicitudes')
    })

    it('Iris apagado o anterior: el error con «Reintentar», sin lista', async () => {
        fijarSoporteFixture('apagado')
        const wrapper = await montarSoporte()
        const alerta = wrapper.find('[data-testid="soporte-no-disponible"]')
        expect(alerta.exists()).toBe(true)
        expect(alerta.text()).toContain('Reintentar')
        expect(wrapper.find('[data-testid="soporte-tickets"]').exists()).toBe(false)
        expect(wrapper.find('[data-testid="soporte-reportar"]').exists()).toBe(false)
    })

    it('si no se puede leer la disponibilidad, el error con «Reintentar»', async () => {
        fijarFallaFixture('GET /api/v1/portal/soporte', { status: 502 })
        const wrapper = await montarSoporte()
        expect(wrapper.find('[data-testid="soporte-no-disponible"]').text()).toContain('Reintentar')
    })

    it('sesión de /corte: sin asunto, sin detalle y sin solicitudes', async () => {
        fijarSoporteFixture('ip')
        const wrapper = await montarSoporte()
        const lista = wrapper.find('[data-testid="soporte-tickets"]')
        expect(lista.text()).toContain('Ticket TK-001042')
        expect(lista.text()).not.toContain('Internet lento')
        expect(lista.find('a[href]').exists()).toBe(false)
        expect(wrapper.find('[data-testid="soporte-pestanas"]').text()).not.toContain('Solicitudes')
    })
})

describe('reportar un problema y responder', () => {
    it('envía el reporte y muestra el número', async () => {
        fijarSoporteFixture('disponible')
        fijarSesionFixture(true)
        useSesionPortal().confirmar()
        limpiarDatos()
        const wrapper = await mountSuspended(PaginaNuevo, { route: '/soporte/nuevo' })
        await esperar()
        await campo(wrapper, 'ticket-asunto').setValue('Sin internet')
        await campo(wrapper, 'ticket-descripcion').setValue('La luz LOS está roja')
        await wrapper.find('form').trigger('submit')
        await esperar()
        expect(wrapper.find('[data-testid="ticket-creado"]').text()).toContain('TK-00')
    })

    it('un ticket resuelto se puede confirmar y queda cerrado', async () => {
        fijarSoporteFixture('disponible')
        fijarSesionFixture(true)
        const wrapper = await mountSuspended(PaginaTicket, { route: '/soporte/998' })
        await esperar()
        expect(wrapper.find('[data-testid="ticket-mensajes"]').text()).toContain('un técnico te llamará hoy')
        const boton = wrapper.find('[data-testid="ticket-confirmar"]').findAll('button').find(b => b.text().includes('Ya quedó'))
        await boton!.trigger('click')
        await esperar()
        expect(wrapper.find('[data-testid="ticket-estado"]').text()).toContain('Cerrado')
        expect(wrapper.find('[data-testid="ticket-respuesta"]').exists()).toBe(false)
    })

    it('si Iris no responde, el ticket muestra el error con «Reintentar»', async () => {
        fijarSoporteFixture('apagado')
        fijarSesionFixture(true)
        const wrapper = await mountSuspended(PaginaTicket, { route: '/soporte/998' })
        await esperar()
        expect(wrapper.find('[data-testid="ticket-problema"]').text()).toContain('Reintentar')
    })
})

describe('mis contactos y servicios a cargo', () => {
    it('lista los contactos sin el titular, con sus permisos', async () => {
        fijarSoporteFixture('disponible')
        fijarSesionFixture(true)
        const wrapper = await mountSuspended(CuentaContactos)
        await esperar()
        const filas = wrapper.findAll('[data-testid="contacto"]')
        expect(filas).toHaveLength(2)
        expect(filas[0]!.text()).toContain('Luis Pérez')
        expect(filas[0]!.text()).toContain('+502 5512-3344')
        expect(filas[0]!.text()).not.toContain('Pagar ·')
        expect(wrapper.text()).not.toContain('María José García López')
    })

    it('con la sesión de /corte pide entrar con código o contraseña', async () => {
        fijarSoporteFixture('ip')
        fijarSesionFixture(true)
        const wrapper = await mountSuspended(CuentaContactos)
        await esperar()
        expect(wrapper.text()).toContain('Entra con tu código o tu contraseña')
        expect(wrapper.find('[data-testid="contacto-agregar"]').exists()).toBe(false)
    })

    it('está a cargo de: código, nombre, saldo con consultar y reportar', async () => {
        fijarSoporteFixture('disponible')
        fijarSesionFixture(true)
        limpiarDatos()
        useSesionPortal().confirmar()
        const wrapper = await mountSuspended(CuentaACargo)
        await esperar()
        const tarjeta = wrapper.find('[data-testid="a-cargo-servicio"]')
        expect(tarjeta.text()).toContain('S-000412 · Casa de mamá')
        expect(tarjeta.text()).toContain('Q 150.00')
        const reportar = wrapper.find('[data-testid="a-cargo-reportar"]')
        expect(reportar.attributes('href')).toBe(`/soporte/nuevo?contacto=${A_CARGO_FIXTURE[0]!.contacto_id}&servicio=88`)
    })

    it('está a cargo de: tickets del servicio; solo los suyos se abren (§11.10)', async () => {
        fijarSoporteFixture('disponible')
        fijarSesionFixture(true)
        limpiarDatos()
        useSesionPortal().confirmar()
        const wrapper = await mountSuspended(CuentaACargo)
        await esperar()
        const filas = wrapper.find('[data-testid="a-cargo-tickets"]').findAll('[data-testid="ticket"]')
        expect(filas).toHaveLength(2)
        expect(filas[0]!.text()).toContain('Sin internet en casa de mamá')
        expect(filas[0]!.attributes('href')).toBe(`/soporte/2001?contacto=${A_CARGO_FIXTURE[0]!.contacto_id}&servicio=88`)
        expect(filas[1]!.text()).toContain('Ticket TK-002002')
        expect(filas[1]!.attributes('href')).toBeUndefined()
    })

    it('está a cargo de: si Iris falla, los tickets muestran el error con «Reintentar»', async () => {
        fijarSoporteFixture('disponible')
        fijarSesionFixture(true)
        limpiarDatos()
        useSesionPortal().confirmar()
        fijarFallaFixture('GET /api/v1/portal/soporte/tickets', {
            status: 403,
            cuerpo: { type: 'urn:argosisp:problema:servicio_fuera_del_contacto', title: 'Servicio fuera de tu cargo', status: 403, detail: 'Ese servicio ya no está a tu cargo.' },
        })
        const wrapper = await mountSuspended(CuentaACargo)
        await esperar()
        const tickets = wrapper.find('[data-testid="a-cargo-tickets"]')
        expect(tickets.text()).toContain('Ese servicio ya no está a tu cargo.')
        expect(tickets.text()).toContain('Reintentar')
    })
})
