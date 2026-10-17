import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures } from '~~/fixtures'

describe('tarea 11 · pagos', () => {
    beforeEach(() => {
        reiniciarFixtures()
        useNuxtApp().$tokenSesion.value = 'fixture-admin'
    })

    afterEach(() => {
        useNuxtApp().$tokenSesion.value = null
    })

    it('lista con filtros: cliente, método, estado y fechas de Guatemala en UTC', async () => {
        const api = usePagos()
        const todos = await api.listar()
        expect(todos.ok && todos.data.data.length).toBeGreaterThan(0)

        const delCliente = await api.listar({ cliente_id: 1 })
        expect(delCliente.ok && delCliente.data.data.every(p => p.cliente_id === 1)).toBe(true)

        const deposito = await api.listar({ metodo: 'deposito' })
        // El único depósito de los fixtures es el pago histórico importado del cliente 8.
        expect(deposito.ok && deposito.data.data.map(p => [p.id, p.historico])).toEqual([[9001, true]])

        // Pagos del 5 de octubre (fixtures: 16:20 UTC = 10:20 en Guatemala).
        const delDia = await api.listar({ desde: inicioDiaGuatemala('2026-10-05'), hasta: finDiaGuatemala('2026-10-05') })
        expect(delDia.ok).toBe(true)
        if (delDia.ok) {
            expect(delDia.data.data.length).toBeGreaterThan(0)
            expect(delDia.data.data.every(p => fechaGuatemala(p.created_at) === '2026-10-05')).toBe(true)
        }
    })

    it('anular con motivo: la factura vuelve a deber y el libro tiene el reverso', async () => {
        const pago = 109 + 5000
        const antes = await useFacturas().ver(109)
        expect(antes.ok && antes.data.estado).toBe('pagada')

        const anulado = await usePagos().anular(pago, 'El depósito fue rechazado', nuevaClaveIdempotencia())
        expect(anulado.ok).toBe(true)
        if (anulado.ok) {
            expect(anulado.data.estado).toBe('anulado')
            expect(anulado.data.motivo_anulacion).toBe('El depósito fue rechazado')
            expect(anulado.data.anulado_en).not.toBeNull()
        }

        const despues = await useFacturas().ver(109)
        expect(despues.ok && despues.data.pagado).toBe('0.00')

        const asientos = await useLibro().asientosDe('pago', pago, '2026-09-01')
        expect(asientos.ok && asientos.data.map(a => a.reversa_de !== null)).toEqual([false, true])
        expect(asientos.ok && cuadra(totalesAsientos(asientos.data))).toBe(true)

        const otraVez = await usePagos().anular(pago, 'Otra vez', nuevaClaveIdempotencia())
        expect(!otraVez.ok && otraVez.problema.type).toBe('urn:argosisp:problema:pago_anulado')

        const anulados = await usePagos().listar({ estado: 'anulado' })
        expect(anulados.ok && anulados.data.data.map(p => p.id)).toEqual([pago])
    })

    it('anular exige pagos.anular: el cajero no puede', async () => {
        useNuxtApp().$tokenSesion.value = 'fixture-cajero'
        const resultado = await usePagos().anular(109 + 5000, 'Prueba de permisos', nuevaClaveIdempotencia())
        expect(!resultado.ok && resultado.problema.status).toBe(403)
    })

    it('un cobro nuevo aparece en la lista y en el libro', async () => {
        const cobro = await usePagos().registrar({ cliente_id: 2, metodo: 'caja', monto: '150.00' }, nuevaClaveIdempotencia())
        expect(cobro.ok).toBe(true)
        if (!cobro.ok) {
            return
        }
        const lista = await usePagos().listar({ cliente_id: 2 })
        expect(lista.ok && lista.data.data[0]?.id).toBe(cobro.data.id)
        const asientos = await useLibro().asientosDe('pago', cobro.data.id, sumarDiasFecha(fechaGuatemala(cobro.data.created_at), -1))
        expect(asientos.ok && asientos.data).toHaveLength(1)
    })
})
