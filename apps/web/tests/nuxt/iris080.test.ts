import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import { bd } from '~~/fixtures/bd'
import { meAdmin } from '~~/fixtures/auth/sesiones'
import { conectorIrisCanjeConfirmado, conectorIrisInicial, ORIGENES_IRIS_FIXTURES, sincronizacionIrisEjemplo } from '~~/fixtures/iris/datos'
import { UApp } from '#components'
import ComprobanteRevision from '~/components/ComprobanteRevision.vue'
import CuentaBancariaFormulario from '~/components/CuentaBancariaFormulario.vue'
import PaginaCuentas from '~/pages/configuracion/cuentas-bancarias.vue'
import PaginaIris from '~/pages/configuracion/integraciones/iris.vue'
import PaginaAutorizar from '~/pages/integraciones/iris/autorizar.vue'
import PaginaPromesas from '~/pages/promesas/index.vue'
import PaginaServicio from '~/pages/servicios/[id]/index.vue'
import { esperar } from '../ayudas/esperar'

/**
 * Contrato Iris ↔ Argos 0.8.0, parte del panel (A4): titular y tipo de las cuentas bancarias, cuenta
 * desactivada en llano, filtro por motivo de reconexión, contrato, sincronización y alcance en la
 * pantalla del conector, aviso de copia al aprobar, `precio_mensual` en la ficha y la bitácora.
 */

const conApp = (componente: Component) => defineComponent({
    render: () => h(UApp, null, { default: () => h(componente) }),
})

function enCuerpo(selector: string): HTMLElement | null {
    return document.body.querySelector<HTMLElement>(selector)
}

beforeEach(() => {
    reiniciarFixtures()
    sesionFixture('fixture-admin')
    useUsuarioActual().value = meAdmin
})

afterEach(() => {
    sesionFixture(null)
    useUsuarioActual().value = null
    document.body.innerHTML = ''
})

describe('iris 0.8.0 · cuentas bancarias', () => {
    it('el esquema exige titular (2–120) y tipo (monetaria o ahorro)', () => {
        const base = { banco_id: 1, numero: '3-123-45678-9', alias: 'Monetaria', moneda: 'GTQ', activa: true }
        expect(esquemaCuentaBancaria.safeParse({ ...base, titular: 'ArgosNet, S.A.', tipo: 'ahorro' }).success).toBe(true)
        const sinDatos = esquemaCuentaBancaria.safeParse(base)
        expect(new Set(sinDatos.error?.issues.map(i => i.path[0]))).toEqual(new Set(['titular', 'tipo']))
        const malos = esquemaCuentaBancaria.safeParse({ ...base, titular: 'A', tipo: 'corriente' })
        expect(new Set(malos.error?.issues.map(i => i.path[0]))).toEqual(new Set(['titular', 'tipo']))
        expect(esquemaCuentaBancaria.safeParse({ ...base, titular: 'x'.repeat(121), tipo: 'monetaria' }).success).toBe(false)
        expect(TIPOS_CUENTA_BANCARIA).toEqual({ monetaria: 'Monetaria', ahorro: 'Ahorro' })
    })

    it('los fixtures guardan titular y tipo al crear y al editar (ausente = sin cambio)', async () => {
        const creada = await useCuentasBancarias().crear({ banco_id: 1, numero: '3-999-00001-1', alias: 'Cobros', titular: ' ArgosNet, S.A. ', tipo: 'ahorro', moneda: 'GTQ', activa: true })
        expect(creada.ok && [creada.data.titular, creada.data.tipo]).toEqual(['ArgosNet, S.A.', 'ahorro'])
        if (!creada.ok) {
            return
        }
        const sinCambio = await useCuentasBancarias().editar(creada.data.id, { version: creada.data.version, alias: 'Cobros 2' })
        expect(sinCambio.ok && [sinCambio.data.titular, sinCambio.data.tipo]).toEqual(['ArgosNet, S.A.', 'ahorro'])
        const invalida = await useCuentasBancarias().crear({ banco_id: 1, numero: '3-999-00002-1', alias: 'Otra', titular: 'A', moneda: 'GTQ' })
        expect(!invalida.ok && invalida.problema.errors?.map(e => e.field)).toEqual(['titular'])
    })

    it('el formulario pide titular y tipo; la lista marca las cuentas viejas sin ellos', async () => {
        const vista = await mountSuspended(PaginaCuentas)
        await esperar(() => expect(vista.findAll('[data-cuenta]')).toHaveLength(4))
        expect(vista.text()).toContain('ArgosNet, S.A.')
        expect(vista.findAll('[data-prueba="cuenta-sin-titular"]').length).toBeGreaterThan(0)
        vista.unmount()

        const formulario = await mountSuspended(conApp(defineComponent({
            render: () => h(CuentaBancariaFormulario, { open: true, cuenta: bd.cuentasBancarias[2] ?? null, bancos: bd.bancos }),
        })))
        await esperar(() => expect(enCuerpo('[data-prueba="cuenta-titular"]')).not.toBeNull())
        expect(document.body.textContent).toContain('Titular')
        expect(document.body.textContent).toContain('Tipo')
        formulario.unmount()
    })
})

describe('iris 0.8.0 · cuenta desactivada en llano', () => {
    it('el fixture de pagos responde `inactiva` (no `exists`) y el panel lo traduce', async () => {
        const inactiva = bd.cuentasBancarias.find(c => !c.activa)!
        const pago = await usePagos().registrar({ cliente_id: 2, metodo: 'deposito', monto: '10.00', referencia: 'R-1', cuenta_bancaria_id: inactiva.id }, nuevaClaveIdempotencia())
        expect(pago.ok).toBe(false)
        if (pago.ok) {
            return
        }
        expect(pago.problema.errors?.find(e => e.field === 'cuenta_bancaria_id')?.rule).toBe('inactiva')
        expect(esCuentaInactiva(pago.problema)).toBe(true)
        expect(erroresConCuentaInactiva(pago.problema).find(e => e.name === 'cuenta_bancaria_id')?.message).toBe(MENSAJE_CUENTA_INACTIVA)

        const inexistente = await usePagos().registrar({ cliente_id: 2, metodo: 'deposito', monto: '10.00', referencia: 'R-2', cuenta_bancaria_id: 999 }, nuevaClaveIdempotencia())
        expect(!inexistente.ok && inexistente.problema.errors?.find(e => e.field === 'cuenta_bancaria_id')?.rule).toBe('exists')
        expect(!inexistente.ok && esCuentaInactiva(inexistente.problema)).toBe(false)
    })

    it('aprobar un comprobante de una cuenta que se desactivó lo explica en llano', async () => {
        const comprobante = bd.comprobantes.find(c => c.estado === 'pendiente' && c.cuenta_bancaria_id !== null)!
        const cuenta = bd.cuentasBancarias.find(c => c.id === comprobante.cuenta_bancaria_id)!
        cuenta.activa = false
        const vista = await mountSuspended(conApp(defineComponent({
            render: () => h(ComprobanteRevision, { comprobanteId: comprobante.id }),
        })))
        await esperar(() => expect(vista.find('[data-prueba="aprobar-comprobante"]').exists()).toBe(true))
        await vista.find('[data-prueba="aprobar-comprobante"]').trigger('click')
        await esperar(() => expect(vista.find('[data-prueba="cuenta-inactiva"]').exists()).toBe(true))
        expect(vista.find('[data-prueba="cuenta-inactiva"]').text()).toContain('cuenta desactivada')
        expect(vista.find('[data-prueba="cuenta-inactiva"]').text()).toContain('Ajustes → Cuentas bancarias')
        vista.unmount()
    })
})

describe('iris 0.8.0 · promesas por motivo de reconexión', () => {
    it('filtra por motivo con `motivo_reconexion` y se oculta con «Promesa»', async () => {
        const vista = await mountSuspended(PaginaPromesas, { route: '/promesas?motivo_reconexion=sin_personal' })
        await esperar(() => expect(vista.findAll('[data-prueba="promesa-motivo-reconexion"]').length).toBe(1))
        expect(vista.find('[data-prueba="promesa-motivo-reconexion"]').text()).toBe('Sin personal de caja')
        expect(vista.find('[data-prueba="filtro-motivo-reconexion"]').exists()).toBe(true)
        expect(useRoute().query.motivo_reconexion).toBe('sin_personal')
        vista.unmount()

        const promesas = await mountSuspended(PaginaPromesas, { route: '/promesas?tipo=promesa&motivo_reconexion=fuera_de_horario' })
        await flushPromises()
        expect(promesas.find('[data-prueba="filtro-motivo-reconexion"]').exists()).toBe(false)
        promesas.unmount()
    })

    it('el fixture aplica el motivo como la API (implica reconexión temporal; inválido = 422)', async () => {
        const fuera = await usePromesas().listar({ motivo_reconexion: 'fuera_de_horario' })
        expect(fuera.ok && fuera.data.data.map(p => [p.tipo, p.motivo_reconexion])).toEqual([['reconexion_temporal', 'fuera_de_horario']])
        const vacia = await usePromesas().listar({ tipo: 'promesa', motivo_reconexion: 'sin_personal' })
        expect(vacia.ok && vacia.data.data).toEqual([])
    })
})

describe('iris 0.8.0 · pantalla del conector', () => {
    it('utilidades: contratos, progreso y alcance en palabras', () => {
        expect(compararContratos('0.8.0', '0.7.10')).toBeGreaterThan(0)
        expect(compararContratos('0.7.1', '0.8.0')).toBeLessThan(0)
        expect(estadoContratoIris(null)).toBe('sin_dato')
        expect(estadoContratoIris('0.7.1')).toBe('anterior')
        expect(estadoContratoIris('0.8.0')).toBe('al_dia')
        expect(estadoContratoIris('0.9.2')).toBe('al_dia')
        expect(textoProgresoEtapa({ procesados: 120, total: 300, estado: 'en_curso' })).toBe('120 de 300')
        expect(textoProgresoEtapa({ procesados: 0, total: null, estado: 'pendiente' })).toBe('Sin empezar')
        expect(textoProgresoEtapa({ procesados: 1, total: null, estado: 'en_curso' })).toBe('1 copiado')
        expect(porcentajeEtapa({ procesados: 120, total: 300 })).toBe(40)
        expect(porcentajeEtapa({ procesados: 0, total: 0 })).toBe(100)
        expect(porcentajeEtapa({ procesados: 3, total: null })).toBeNull()
        const nombre = (id: number) => (id === 1 ? 'ArgosNet' : 'Fibra del Sur')
        expect(textoAlcanceTecnicoIris({ global: false, empresas: [1, 2] }, nombre)).toBe('ArgosNet, Fibra del Sur')
        expect(textoAlcanceTecnicoIris({ global: true, empresas: [] }, nombre)).toContain('Alcance global')
        expect(textoAlcanceTecnicoIris(null, nombre)).toContain('Todavía no hay usuario técnico')
        expect(etapasOrdenadas(sincronizacionIrisEjemplo()).map(e => e.recurso)).toEqual(Object.keys(RECURSOS_SINCRONIZACION_IRIS))
    })

    it('sin sincronización: «Iris aún no ha informado la sincronización»; contrato sin dato apaga funciones', async () => {
        bd.iris.conector = structuredClone(conectorIrisInicial)
        const vista = await mountSuspended(conApp(PaginaIris))
        await esperar(() => expect(vista.find('[data-prueba="sin-sincronizacion-iris"]').exists()).toBe(true))
        expect(vista.find('[data-prueba="sin-sincronizacion-iris"]').text()).toContain('Iris aún no ha informado la sincronización')
        expect(vista.find('[data-prueba="contrato-iris-valor"]').text()).toContain('Iris aún no lo ha informado')
        expect(vista.find('[data-prueba="funciones-apagadas-iris"]').exists()).toBe(true)
        vista.unmount()
    })

    it('con Iris 0.7.1: contratos de los dos lados, funciones apagadas, etapas con errores y alcance por empresa', async () => {
        bd.iris.conector = { ...conectorIrisCanjeConfirmado(new Date('2026-11-18T14:00:00.000Z')), contrato: '0.7.1', sincronizacion: sincronizacionIrisEjemplo('con_errores') }
        bd.iris.alcanceUsuario = { global: false, empresas: [1, 2] }
        const vista = await mountSuspended(conApp(PaginaIris))
        await esperar(() => expect(vista.find('[data-prueba="etapas-sincronizacion-iris"]').exists()).toBe(true))
        await esperar(() => expect(vista.find('[data-prueba="contrato-argos"]').text()).toContain('0.8.0'))
        expect(vista.find('[data-prueba="contrato-iris-valor"]').text()).toContain('0.7.1')

        const apagadas = vista.find('[data-prueba="funciones-apagadas-iris"]')
        expect(apagadas.text()).toContain('anterior a 0.8.0')
        expect(apagadas.text()).toContain('cuenta bancaria')
        expect(apagadas.text()).toContain('cuenta bancaria')
        expect(apagadas.text()).not.toContain('precio mensual')

        expect(vista.find('[data-prueba="estado-sincronizacion-iris"]').text()).toBe('Con errores')
        const filas = vista.findAll('[data-recurso]')
        expect(filas.map(f => f.attributes('data-recurso'))).toEqual(['empresas', 'zonas', 'planes', 'routers', 'bancos', 'cuentas_bancarias', 'clientes', 'servicios'])
        const cuentas = vista.find('[data-recurso="cuentas_bancarias"]')
        expect(cuentas.text()).toContain('Cuentas bancarias')
        expect(cuentas.text()).toContain('3 de 4')
        expect(cuentas.find('[data-prueba="error-etapa"]').text()).toBe('Iris informó: Una cuenta sin titular no se pudo copiar')
        // hora de Guatemala (UTC−6)
        expect(cuentas.text()).toContain(`Terminó el ${formatearFechaHora('2026-11-18T15:02:00.000Z')}`)
        expect(formatearFechaHora('2026-11-18T15:02:00.000Z')).toContain('09:02')

        await esperar(() => expect(vista.find('[data-prueba="empresas-alcance-iris"]').text()).toBe('ArgosNet, Fibra del Sur'))
        expect(vista.find('[data-prueba="alcance-global-iris"]').exists()).toBe(false)

        // nunca secretos; la vía manual rotulada como recuperación
        expect(vista.text()).not.toMatch(/iris_pat_[A-Za-z0-9]|atk_[A-Za-z0-9]/)
        expect(vista.find('[data-prueba="recuperacion-manual-iris"]').text()).toBe('Vía de recuperación (avanzado)')
        expect(vista.find('[data-prueba="recuperacion-tokens-iris"]').text()).toBe('Vía de recuperación (avanzado)')
        expect(vista.find('[data-prueba="aviso-copia-enlace-iris"]').text()).toContain(AVISO_COPIA_IRIS)
        vista.unmount()
    })

    it('con Iris 0.8.0 y alcance global: funciones al día y la marca «Alcance global»', async () => {
        bd.iris.conector = { ...conectorIrisCanjeConfirmado(), contrato: '0.8.0', sincronizacion: sincronizacionIrisEjemplo('en_curso') }
        bd.iris.alcanceUsuario = { global: true, empresas: [] }
        const vista = await mountSuspended(conApp(PaginaIris))
        await esperar(() => expect(vista.find('[data-prueba="alcance-global-iris"]').exists()).toBe(true))
        expect(vista.find('[data-prueba="funciones-apagadas-iris"]').exists()).toBe(false)
        expect(vista.find('[data-prueba="funciones-al-dia-iris"]').exists()).toBe(true)
        expect(vista.find('[data-recurso="servicios"]').text()).toContain('Sin empezar')
        expect(vista.find('[data-recurso="clientes"]').text()).toContain('120 de 300')
        vista.unmount()
    })
})

describe('iris 0.8.0 · aprobación con el botón', () => {
    it('avisa que Iris copiará los clientes, los servicios y las cuentas bancarias', async () => {
        const query = new URLSearchParams({ iris: ORIGENES_IRIS_FIXTURES[0] ?? '', state: 'st4te-de-iris_0123456789', code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', code_challenge_method: 'S256' })
        const vista = await mountSuspended(conApp(PaginaAutorizar), { route: `/integraciones/iris/autorizar?${query.toString()}` })
        await esperar(() => expect(vista.find('[data-prueba="autorizar-aviso-copia"]').exists()).toBe(true))
        expect(vista.find('[data-prueba="autorizar-aviso-copia"]').text()).toContain('Iris copiará los clientes, los servicios y las cuentas bancarias de estas empresas')
        vista.unmount()
    })
})

describe('iris 0.8.0 · servicio y bitácora', () => {
    it('la ficha muestra `precio_mensual` en quetzales con dos decimales, sin depender de los planes', async () => {
        const servicio = bd.servicios.find(s => s.costo_override !== null)!
        expect(servicio.precio_mensual).toBe(servicio.costo_override)
        const normal = bd.servicios.find(s => s.costo_override === null)!
        expect(normal.precio_mensual).toBe(bd.planes.find(p => p.id === normal.plan_id)?.precio)
        expect(normal.moneda).toBe('GTQ')

        const vista = await mountSuspended(PaginaServicio, { route: `/servicios/${servicio.id}` })
        await esperar(() => expect(vista.find('[data-prueba="precio-mensual-servicio"]').exists()).toBe(true))
        expect(vista.find('[data-prueba="precio-mensual-servicio"]').text()).toContain(`${formatearQuetzales(servicio.costo_override!)} (precio especial)`)
        expect(formatearQuetzales('299.00')).toMatch(/Q\s?299\.00/)
        vista.unmount()
    })

    it('el alta y la edición del fixture recalculan `precio_mensual`', async () => {
        const servicio = bd.servicios.find(s => s.costo_override === null && s.estado === 'activo')!
        const editado = await useServicios().editar(servicio.id, { version: servicio.version, costo_override: '175.50' })
        expect(editado.ok && [editado.data.precio_mensual, editado.data.moneda]).toEqual(['175.50', 'GTQ'])
    })

    it('la bitácora nombra `iris.informar_sincronizacion`', () => {
        expect(etiquetaAccion('iris.informar_sincronizacion')).toBe('Iris informó el avance de su sincronización')
    })
})
