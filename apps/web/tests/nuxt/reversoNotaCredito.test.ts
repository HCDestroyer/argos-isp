import Decimal from 'decimal.js'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import meAdmin from '~~/fixtures/auth/me.admin.json'
import meCajero from '~~/fixtures/auth/me.cajero.json'
import { bd } from '~~/fixtures/bd'
import { UApp } from '#components'
import AsientoContable from '~/components/AsientoContable.vue'
import PaginaFactura from '~/pages/facturas/[id].vue'
import { esperar } from '../ayudas/esperar'

/** Asiento sin documento (ajuste manual): el único tipo que se revierte directo. */
function ajusteManual(): Asiento {
    const id = Math.max(...bd.asientos.map(a => a.id)) + 1
    const asiento: Asiento = {
        id,
        empresa_id: 1,
        fecha: '2026-10-15',
        descripcion: 'Ajuste manual: redondeo de caja',
        origen_tipo: 'ajuste',
        origen_id: null,
        diario: 'VAR',
        reversa_de: null,
        created_by: 1,
        created_at: '2026-10-15T20:00:00.000Z',
        movimientos: [
            { id: id * 10 + 1, cuenta_id: 3, cuenta_codigo: '1.1.01.01', cuenta_nombre: 'Caja principal', cliente_id: null, debe: '0.50', haber: '0.00' },
            { id: id * 10 + 2, cuenta_id: 12, cuenta_codigo: '4.1.01', cuenta_nombre: 'Ingresos por servicio de internet', cliente_id: null, debe: '0.00', haber: '0.50' },
        ],
    }
    bd.asientos.push(asiento)
    return asiento
}

/**
 * Semana 3 (2.ª tanda) · tarea 6, lo publicado por A3: reverso de asiento y nota de crédito.
 */
describe('reverso de asiento y nota de crédito', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
        // Sin vaciar el body: tests/setup.ts desmonta todo después (vaciarlo antes rompía el desmontaje).
    })

    it('API: solo se revierte un asiento sin documento, una vez; los demás dicen qué anular', async () => {
        const ajuste = ajusteManual()
        const leido = await useLibro().asiento(ajuste.id)
        expect(leido.ok && leido.data).toMatchObject({ revertible: true, motivo_no_revertible: null, revertido_por: null })
        const reverso = await useLibro().revertir(ajuste.id, 'Se digitó dos veces', nuevaClaveIdempotencia())
        expect(reverso.ok && reverso.data).toMatchObject({ reversa_de: ajuste.id, revertible: false })
        const otraVez = await useLibro().revertir(ajuste.id, 'Otra vez', nuevaClaveIdempotencia())
        expect(!otraVez.ok && otraVez.problema.type).toBe('urn:argosisp:problema:asiento_revertido')

        const dePago = bd.asientos.find(a => a.origen_tipo === 'pago')
        const pago = dePago ? await useLibro().asiento(dePago.id) : null
        expect(pago?.ok && pago.data.motivo_no_revertible).toContain('anula el pago')
        const rechazo = dePago ? await useLibro().revertir(dePago.id, 'No aplica', nuevaClaveIdempotencia()) : null
        expect(rechazo && !rechazo.ok && rechazo.problema.type).toBe('urn:argosisp:problema:reverso_por_documento')
    })

    it('componente: "Revertir" solo en el libro, con permiso y si es revertible; si no, el motivo y el documento', async () => {
        const ajuste = ajusteManual()
        const diario = await useLibro().diario()
        const vista = diario.ok ? diario.data.data.find(a => a.id === ajuste.id) : undefined
        const dePago = diario.ok ? diario.data.data.find(a => a.origen_tipo === 'pago') : undefined
        expect(vista && dePago).toBeTruthy()
        if (!vista || !dePago) {
            return
        }
        const conApp = (asiento: Asiento, conReverso: boolean) => defineComponent({ render: () => h(UApp, null, { default: () => h(AsientoContable, { asiento, conReverso }) }) })
        const libro = await mountSuspended(conApp(vista, true))
        expect(libro.find(`[data-prueba="revertir-asiento-${ajuste.id}"]`).exists()).toBe(true)
        libro.unmount()

        const documento = await mountSuspended(conApp(dePago, true))
        expect(documento.find(`[data-prueba="no-revertible-${dePago.id}"]`).text()).toContain('anula el pago')
        expect(documento.find(`[data-prueba="no-revertible-${dePago.id}"]`).text()).toContain('Ir al documento')
        documento.unmount()

        const ficha = await mountSuspended(conApp(vista, false))
        expect(ficha.find(`[data-prueba="revertir-asiento-${ajuste.id}"]`).exists()).toBe(false)
        ficha.unmount()

        useUsuarioActual().value = meCajero
        const sinPermiso = await mountSuspended(conApp(vista, true))
        expect(sinPermiso.find(`[data-prueba="revertir-asiento-${ajuste.id}"]`).exists()).toBe(false)
        sinPermiso.unmount()
    })

    it('API: nota de crédito parcial y total; 422 si excede el saldo; 409 sin saldo; reactiva el servicio', async () => {
        const vencida = bd.facturas.find(f => f.estado === 'vencida' && new Decimal(f.pagado).isZero()
            && bd.facturas.filter(o => o.servicio_id === f.servicio_id && o.estado === 'vencida').length === 1)
        expect(vencida).toBeDefined()
        if (!vencida) {
            return
        }
        const saldo = new Decimal(vencida.total).minus(vencida.pagado)
        const deMas = await useFacturas().notaCredito(vencida.id, { monto: saldo.plus(1).toFixed(2), motivo: 'Falla en la zona' }, nuevaClaveIdempotencia())
        expect(!deMas.ok && deMas.problema.errors?.[0]?.field).toBe('monto')

        const parcial = await useFacturas().notaCredito(vencida.id, { monto: '10.00', motivo: 'Dos días sin servicio' }, nuevaClaveIdempotencia())
        expect(parcial.ok && parcial.data.factura).toMatchObject({ acreditado: '10.00', estado: 'vencida' })
        const resto = await useFacturas().notaCredito(vencida.id, { monto: saldo.minus(10).toFixed(2), motivo: 'Resto acreditado' }, nuevaClaveIdempotencia())
        expect(resto.ok && resto.data.factura.estado).toBe('pagada')
        expect(resto.ok && resto.data.factura.notas_credito?.length).toBe(2)
        const servicio = bd.servicios.find(s => s.id === vencida.servicio_id)
        if (servicio && !servicio.suspension_manual && resto.ok) {
            expect(resto.data.servicios[0]).toMatchObject({ servicio_id: servicio.id, estado: 'activo' })
        }
        const sinSaldo = await useFacturas().notaCredito(vencida.id, { monto: '1.00', motivo: 'Otra' }, nuevaClaveIdempotencia())
        expect(!sinSaldo.ok && sinSaldo.problema.type).toBe('urn:argosisp:problema:factura_sin_saldo')

        const lista = await useNotasCredito().listar({ factura_id: vencida.id })
        expect(lista.ok && lista.data.data.map(n => n.monto)).toEqual([saldo.minus(10).toFixed(2), '10.00'])
        const cuenta = await useClientes().estadoCuenta(vencida.cliente_id)
        expect(cuenta.ok && cuenta.data.movimientos.filter(m => m.tipo === 'nota_credito')).toHaveLength(2)
    })

    it('pantalla de factura: botón con permiso y estado, monto por defecto = saldo, notas y acreditado', async () => {
        const vencida = bd.facturas.find(f => f.estado === 'vencida')
        expect(vencida).toBeDefined()
        if (!vencida) {
            return
        }
        const conApp = defineComponent({ render: () => h(UApp, null, { default: () => h(PaginaFactura) }) })
        const vista = await mountSuspended(conApp, { route: `/facturas/${vencida.id}` })
        await esperar(() => expect(vista.find('[data-prueba="abrir-nota-credito"]').exists()).toBe(true))
        await vista.get('[data-prueba="abrir-nota-credito"]').trigger('click')
        const saldo = new Decimal(vencida.total).minus(vencida.pagado).toFixed(2)
        await esperar(() => expect(document.body.querySelector<HTMLInputElement>('[data-prueba="nota-monto"] input, input[data-prueba="nota-monto"]')?.value).toBe(saldo))
        vista.unmount()

        await useFacturas().notaCredito(vencida.id, { monto: '5.00', motivo: 'Compensación' }, nuevaClaveIdempotencia())
        const otra = await mountSuspended(conApp, { route: `/facturas/${vencida.id}` })
        await esperar(() => expect(otra.find('[data-prueba="notas-credito"]').exists()).toBe(true))
        expect(otra.get('[data-prueba="notas-credito"]').text()).toContain('Compensación')
        expect(otra.get('[data-prueba="factura-acreditado"]').text()).toContain('Q 5.00')
        otra.unmount()

        useUsuarioActual().value = meCajero
        const cajero = await mountSuspended(conApp, { route: `/facturas/${vencida.id}` })
        await esperar(() => expect(cajero.text()).toContain(`Factura #${vencida.id}`))
        expect(cajero.find('[data-prueba="abrir-nota-credito"]').exists()).toBe(false)
        cajero.unmount()
    })
})
