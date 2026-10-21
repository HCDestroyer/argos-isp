import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import { bd } from '~~/fixtures/bd'
import meAdmin from '~~/fixtures/auth/me.admin.json'
import PaginaCobro from '~/pages/cobro/index.vue'
import { esperar } from '../ayudas/esperar'
import { fijarHoyFixtures, soltarReloj } from '../ayudas/reloj'

/**
 * Cobro repartido (A3, `contratos/multiempresa.md`): un cobro en efectivo con avisos de ArgosNet
 * (310) y de Fibra del Sur (410) del cliente 3 se registra como un pago por empresa con el mismo
 * `cobro_id`, cada uno en la caja abierta de su empresa. El recibo `GET /cobros/:id` trae una
 * sección por empresa. Sin caja abierta en una de ellas: 422 `caja_no_abierta`.
 */
describe('cobro repartido por empresa', () => {
    beforeEach(async () => {
        // El cobro marca por defecto lo vencido a la fecha: tiene que ser la de los fixtures.
        fijarHoyFixtures()
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
        await flushPromises()
    })

    afterEach(() => {
        soltarReloj()
        sesionFixture(null)
        useUsuarioActual().value = null
        localStorage.clear()
    })

    function cerrarCajaSur() {
        const caja = bd.cajas.find(c => c.empresa_id === 2)
        if (caja) {
            caja.turno_abierto_id = null
        }
    }

    it('API: un pago por empresa con el mismo cobro_id y el recibo con una sección por empresa', async () => {
        const resultado = await usePagos().registrar({
            cliente_id: 3,
            metodo: 'caja',
            monto: '900.00',
            facturas: [310, 410],
        }, nuevaClaveIdempotencia())
        expect(resultado.ok).toBe(true)
        if (!resultado.ok) {
            return
        }
        const pagos = resultado.data.pagos ?? []
        expect(pagos.map(p => p.empresa_id)).toEqual([1, 2])
        expect(new Set(pagos.map(p => p.cobro_id)).size).toBe(1)
        expect(pagos[1]?.caja_id).toBe(bd.cajas.find(c => c.empresa_id === 2)?.id)

        const cobro = await usePagos().cobro(resultado.data.cobro_id ?? 0)
        expect(cobro.ok && cobro.data.monto).toBe('900.00')
        expect(cobro.ok && cobro.data.secciones.map(s => s.empresa.nombre_comercial)).toEqual(['ArgosNet', 'Fibra del Sur'])
    })

    it('API: sin caja abierta en Fibra del Sur, 422 caja_no_abierta con la empresa en errors[0].rule', async () => {
        cerrarCajaSur()
        const resultado = await usePagos().registrar({ cliente_id: 3, metodo: 'caja', monto: '900.00', facturas: [310, 410] }, nuevaClaveIdempotencia())
        expect(resultado.ok).toBe(false)
        if (resultado.ok) {
            return
        }
        expect(codigoProblema(resultado.problema)).toBe('caja_no_abierta')
        expect(empresaSinCaja(resultado.problema)).toBe(2)
        expect(empresaSinCaja({ ...resultado.problema, type: 'urn:argosisp:problema:otro' })).toBeNull()
    })

    it('API: un depósito a la cuenta de una empresa no paga avisos de otra; agente no se reparte', async () => {
        const cuenta = bd.cuentasBancarias.find(c => c.empresa_id === 1 && c.activa && c.moneda === 'GTQ')
        const deposito = await usePagos().registrar({
            cliente_id: 3,
            metodo: 'deposito',
            monto: '900.00',
            facturas: [310, 410],
            referencia: 'DEP-REPARTO-1',
            cuenta_bancaria_id: cuenta?.id ?? 0,
        }, nuevaClaveIdempotencia())
        expect(!deposito.ok && codigoProblema(deposito.problema)).toBe('cuenta_de_otra_empresa')
        expect(!deposito.ok && deposito.problema.errors?.[0]?.field).toBe('facturas.1')

        const agente = await usePagos().registrar({ cliente_id: 3, metodo: 'agente', monto: '900.00', facturas: [310, 410] }, nuevaClaveIdempotencia())
        expect(!agente.ok && codigoProblema(agente.problema)).toBe('pago_de_varias_empresas')
    })

    it('en pantalla: el cobro muestra los pagos por empresa y el recibo con las dos empresas', async () => {
        const vista = await mountSuspended(PaginaCobro, { route: '/cobro?cliente=3' })
        await esperar(() => expect(vista.find('[data-factura="410"]').exists()).toBe(true))
        await vista.get('[data-factura="310"] button[role="checkbox"]').trigger('click')
        await vista.get('[data-factura="410"] button[role="checkbox"]').trigger('click')
        await esperar(() => expect(vista.find('[data-prueba="reparto-empresas"]').exists()).toBe(true))

        await vista.get('form').trigger('submit')
        await esperar(() => expect(vista.find('[data-prueba="pagos-por-empresa"]').exists()).toBe(true))
        const partes = vista.get('[data-prueba="pagos-por-empresa"]').text()
        expect(partes).toContain('ArgosNet')
        expect(partes).toContain('Fibra del Sur')
        expect(partes).toContain('Q 900.00')
        await esperar(() => expect(vista.find('[data-prueba="recibo-cobro"]').exists()).toBe(true))
        expect(vista.findAll('[data-prueba="recibo-cobro"] section[data-empresa]')).toHaveLength(2)
        expect(vista.get('[data-prueba="total-cobro"]').text()).toContain('Q 900.00')
    })

    it('en pantalla: sin caja abierta en una empresa, el aviso la nombra y ofrece abrir caja', async () => {
        cerrarCajaSur()
        const vista = await mountSuspended(PaginaCobro, { route: '/cobro?cliente=3' })
        await esperar(() => expect(vista.find('[data-factura="410"]').exists()).toBe(true))
        await vista.get('[data-factura="310"] button[role="checkbox"]').trigger('click')
        await vista.get('[data-factura="410"] button[role="checkbox"]').trigger('click')
        await flushPromises()
        await vista.get('form').trigger('submit')
        await esperar(() => expect(vista.find('[data-prueba="caja-no-abierta"]').exists()).toBe(true))
        const aviso = vista.get('[data-prueba="caja-no-abierta"]')
        expect(aviso.text()).toContain('No tienes caja abierta en Fibra del Sur')
        expect(aviso.find('a[href="/caja"]').exists()).toBe(true)
    })
})
