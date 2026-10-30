import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reiniciarFixtures, sesionFixture, simularFalla } from '~~/fixtures'
import { bd } from '~~/fixtures/bd'
import { meAdmin, meCajero } from '~~/fixtures/auth/sesiones'
import { ORIGENES_IRIS_FIXTURES } from '~~/fixtures/iris/datos'
import { UApp } from '#components'
import PaginaAutorizar from '~/pages/integraciones/iris/autorizar.vue'
import { esperar } from '../ayudas/esperar'

/**
 * «Conectar con un botón» (`contratos/iris.md` §1.4): la pantalla de autorización que abre Iris.
 * Origen conocido, origen desconocido con el dominio escrito, sin permiso, enlace incompleto y
 * rechazo sin llamar a la API.
 */

const conApp = (componente: Component) => defineComponent({
    render: () => h(UApp, null, { default: () => h(componente) }),
})

const STATE = 'st4te-de-iris_0123456789'
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
const ORIGEN_CONOCIDO = ORIGENES_IRIS_FIXTURES[0] ?? ''
const ORIGEN_DESCONOCIDO = 'https://iris.otro-isp.gt'

function ruta(iris: string, extra: Record<string, string> = {}): string {
    const query = new URLSearchParams({ iris, state: STATE, code_challenge: CHALLENGE, code_challenge_method: 'S256', ...extra })
    return `/integraciones/iris/autorizar?${query.toString()}`
}

async function montar(destino: string) {
    return mountSuspended(conApp(PaginaAutorizar), { route: destino })
}

describe('iris · autorizar (reglas)', () => {
    it('lee los parámetros: incompleto, método distinto de S256 y completo', () => {
        expect(leerParametrosAutorizacion({ iris: 'https://iris.isp.gt', state: STATE })).toEqual({ ok: false, motivo: 'incompleto', faltan: ['code_challenge', 'code_challenge_method'] })
        expect(leerParametrosAutorizacion({ iris: 'https://iris.isp.gt', state: STATE, code_challenge: CHALLENGE, code_challenge_method: 'plain' })).toMatchObject({ ok: false, motivo: 'metodo' })
        expect(leerParametrosAutorizacion({ iris: ['https://iris.isp.gt'], state: STATE, code_challenge: CHALLENGE, code_challenge_method: 'S256' })).toEqual({
            ok: true,
            parametros: { iris: 'https://iris.isp.gt', state: STATE, code_challenge: CHALLENGE, code_challenge_method: 'S256' },
        })
    })

    it('dominio con puerto y sin distinguir mayúsculas; rechazo y vuelta dentro del origen', () => {
        expect(dominioCoincide('https://iris.isp.gt:8443', 'IRIS.isp.gt:8443 ')).toBe(true)
        expect(dominioCoincide('https://iris.isp.gt:8443', 'iris.isp.gt')).toBe(false)
        expect(dominioCoincide('https://iris.isp.gt', 'https://iris.isp.gt')).toBe(false)
        expect(urlRechazoIris('https://iris.isp.gt', 'a b&c')).toBe('https://iris.isp.gt/administracion/integraciones/argos/vuelta#error=rechazado&state=a%20b%26c')
        expect(destinoDentroDeIris('https://iris.isp.gt/administracion/integraciones/argos/vuelta#codigo=x', 'https://iris.isp.gt')).toBe(true)
        expect(destinoDentroDeIris('https://malo.gt/administracion/integraciones/argos/vuelta#codigo=x', 'https://iris.isp.gt')).toBe(false)
    })

    it('errores en español: 422 por código, sin conexión con Reintentar', () => {
        const problema = (codigo: string) => ({ type: `urn:argosisp:problema:${codigo}`, title: 'x', status: 422, detail: 'detalle' })
        expect(mensajeErrorAutorizacion(problema('code_challenge_invalido')).titulo).toBe('El enlace de Iris no es válido')
        expect(mensajeErrorAutorizacion(problema('iris_origen_no_confirmado')).titulo).toBe('Confirma el dominio de Iris')
        expect(mensajeErrorAutorizacion(problema('iris_origen_invalido')).titulo).toBe('La dirección de Iris no es válida')
        expect(mensajeErrorAutorizacion({ ...problema('validacion'), errors: [{ field: 'state', message: 'State inválido' }] }).detalle).toContain('State inválido')
        expect(mensajeErrorAutorizacion(PROBLEMA_SIN_CONEXION)).toMatchObject({ titulo: 'Sin conexión con Argos', reintentable: true })
    })
})

describe('iris · autorizar (pantalla)', () => {
    let assign: ReturnType<typeof vi.spyOn>

    beforeEach(async () => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
        assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined)
        await flushPromises()
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
        vi.restoreAllMocks()
    })

    it('origen conocido: muestra el origen y todas las empresas; aprobar audita y vuelve a Iris con el código', async () => {
        const vista = await montar(ruta(`${ORIGEN_CONOCIDO}/`))
        await esperar(() => expect(vista.find('[data-prueba="autorizar-titulo"]').exists()).toBe(true))
        expect(vista.get('[data-prueba="autorizar-titulo"]').text()).toBe(`Iris en ${ORIGEN_CONOCIDO} pide conectarse con Argos`)
        expect(vista.get('[data-prueba="autorizar-alcance-global"]').text()).toBe('Todas las empresas, también las futuras')
        expect(vista.find('[data-prueba="autorizar-origen-desconocido"]').exists()).toBe(false)
        expect(vista.find('[data-prueba="autorizar-dominio"]').exists()).toBe(false)

        await vista.get('form').trigger('submit')
        await esperar(() => expect(assign).toHaveBeenCalledTimes(1))
        const destino = String(assign.mock.calls[0]?.[0])
        expect(destino.startsWith(`${ORIGEN_CONOCIDO}/administracion/integraciones/argos/vuelta#codigo=`)).toBe(true)
        expect(destino).toContain(`&state=${STATE}`)
        expect(bd.acciones.filter(a => a.accion === 'iris.autorizar')).toHaveLength(1)
    })

    it('con alcance por empresas lista nombre y NIT', async () => {
        bd.iris.alcanceUsuario = { global: false, empresas: [2] }
        const vista = await montar(ruta(ORIGEN_CONOCIDO))
        await esperar(() => expect(vista.find('[data-prueba="autorizar-empresas"]').exists()).toBe(true))
        expect(vista.get('[data-prueba="autorizar-empresas"]').text()).toContain('Fibra del Sur')
        expect(vista.get('[data-prueba="autorizar-empresas"]').text()).toContain('NIT 7788990-1')
        expect(vista.get('[data-prueba="autorizar-empresas"]').text()).not.toContain('ArgosNet')
    })

    it('origen desconocido: aviso fuerte y «Aprobar» deshabilitado hasta escribir el dominio', async () => {
        const vista = await montar(ruta(ORIGEN_DESCONOCIDO))
        await esperar(() => expect(vista.find('[data-prueba="autorizar-origen-desconocido"]').exists()).toBe(true))
        expect(vista.get('[data-prueba="autorizar-origen-desconocido"]').text()).toContain('Solo aprueba si tú abriste esta conexión desde tu Iris')
        const aprobar = () => vista.get('[data-prueba="autorizar-aprobar"]')
        expect(aprobar().attributes('disabled')).toBeDefined()

        await vista.get('input[data-prueba="autorizar-dominio"]').setValue('iris.otro-isp.g')
        expect(aprobar().attributes('disabled')).toBeDefined()
        await vista.get('input[data-prueba="autorizar-dominio"]').setValue('Iris.Otro-ISP.gt')
        await esperar(() => expect(aprobar().attributes('disabled')).toBeUndefined())

        await vista.get('form').trigger('submit')
        await esperar(() => expect(assign).toHaveBeenCalledTimes(1))
        expect(String(assign.mock.calls[0]?.[0]).startsWith(`${ORIGEN_DESCONOCIDO}/administracion/integraciones/argos/vuelta#codigo=`)).toBe(true)
        expect(bd.acciones.find(a => a.accion === 'iris.autorizar')?.entrada).toMatchObject({ origen_conocido: false, codigo: '***' })
    })

    it('el 422 de la API se muestra en español y no sale del panel', async () => {
        const vista = await montar(ruta(ORIGEN_CONOCIDO, { code_challenge: 'corto' }))
        await esperar(() => expect(vista.find('[data-prueba="autorizar-aprobar"]').exists()).toBe(true))
        await vista.get('form').trigger('submit')
        await esperar(() => expect(vista.find('[data-prueba="autorizar-error-aprobar"]').exists()).toBe(true))
        expect(vista.get('[data-prueba="autorizar-error-aprobar"]').text()).toContain('El enlace de Iris no es válido')
        expect(assign).not.toHaveBeenCalled()
    })

    it('rechazar vuelve a Iris con error=rechazado y el state, sin llamar a la API', async () => {
        const vista = await montar(ruta(ORIGEN_DESCONOCIDO))
        await esperar(() => expect(vista.find('[data-prueba="autorizar-rechazar"]').exists()).toBe(true))
        const acciones = bd.acciones.length
        await vista.get('[data-prueba="autorizar-rechazar"]').trigger('click')
        expect(assign).toHaveBeenCalledWith(`${ORIGEN_DESCONOCIDO}/administracion/integraciones/argos/vuelta#error=rechazado&state=${STATE}`)
        expect(bd.acciones.length).toBe(acciones)
    })

    it('sin iris.configurar: mensaje para pedirlo y ni vista previa ni botones', async () => {
        sesionFixture('fixture-cajero')
        useUsuarioActual().value = meCajero
        const vista = await montar(ruta(ORIGEN_CONOCIDO))
        await esperar(() => expect(vista.find('[data-prueba="autorizar-sin-permiso"]').exists()).toBe(true))
        expect(vista.get('[data-prueba="autorizar-sin-permiso"]').text()).toContain('Pídele a un administrador')
        expect(vista.find('[data-prueba="autorizar-aprobar"]').exists()).toBe(false)
        expect(vista.find('[data-prueba="autorizar-rechazar"]').exists()).toBe(false)
        expect(vista.text()).not.toContain(ORIGEN_CONOCIDO)
    })

    it('parámetros faltantes: «Enlace incompleto» sin botones', async () => {
        const vista = await montar(`/integraciones/iris/autorizar?iris=${encodeURIComponent(ORIGEN_CONOCIDO)}&state=${STATE}`)
        await esperar(() => expect(vista.find('[data-prueba="autorizar-incompleto"]').exists()).toBe(true))
        expect(vista.get('[data-prueba="autorizar-incompleto"]').text()).toContain('Enlace incompleto')
        expect(vista.find('[data-prueba="autorizar-rechazar"]').exists()).toBe(false)
    })

    it('vista previa caída: error con «Reintentar» y sin «Rechazar»; al reintentar carga', async () => {
        simularFalla('GET /api/v1/integraciones/iris/autorizar/vista-previa', 503)
        const vista = await montar(ruta(ORIGEN_CONOCIDO))
        await esperar(() => expect(vista.find('[data-prueba="autorizar-error"]').exists()).toBe(true))
        expect(vista.find('[data-prueba="autorizar-rechazar"]').exists()).toBe(false)
        const reintentar = vista.findAll('button').find(b => b.text().trim() === 'Reintentar')
        expect(reintentar).toBeDefined()
        delete bd.fallas['GET /api/v1/integraciones/iris/autorizar/vista-previa']
        await reintentar?.trigger('click')
        await esperar(() => expect(vista.find('[data-prueba="autorizar-titulo"]').exists()).toBe(true))
    })

    it('origen inválido (http): error sin botones', async () => {
        const vista = await montar(ruta('http://iris.isp.gt'))
        await esperar(() => expect(vista.find('[data-prueba="autorizar-error"]').exists()).toBe(true))
        expect(vista.get('[data-prueba="autorizar-error"]').text()).toContain('La dirección de Iris no es válida')
        expect(vista.findAll('button').some(b => b.text().trim() === 'Reintentar')).toBe(false)
        expect(vista.find('[data-prueba="autorizar-rechazar"]').exists()).toBe(false)
    })
})
