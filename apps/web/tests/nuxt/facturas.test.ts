import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, simularFalla } from '~~/fixtures'
import AsientoContable from '~/components/AsientoContable.vue'

describe('tarea 10 · facturas', () => {
    beforeEach(() => {
        reiniciarFixtures()
        useNuxtApp().$tokenSesion.value = 'fixture-admin'
    })

    afterEach(() => {
        useNuxtApp().$tokenSesion.value = null
    })

    it('lista con los filtros del contrato: estado, cliente, servicio y periodo', async () => {
        const api = useFacturas()
        const vencidas = await api.listar({ estado: 'vencida' })
        expect(vencidas.ok).toBe(true)
        if (vencidas.ok) {
            expect(vencidas.data.data.length).toBeGreaterThan(0)
            expect(vencidas.data.data.every(f => f.estado === 'vencida')).toBe(true)
        }

        const delCliente = await api.listar({ cliente_id: 2, periodo: '2026-10-01' })
        expect(delCliente.ok && delCliente.data.data.map(f => f.id)).toEqual([210])

        const delServicio = await api.listar({ servicio_id: 2 })
        expect(delServicio.ok && delServicio.data.data.map(f => f.id)).toEqual([210, 209])
    })

    it('detalle con líneas, pagos aplicados y asientos que cuadran', async () => {
        const detalle = await useFacturas().ver(109)
        expect(detalle.ok).toBe(true)
        if (!detalle.ok) {
            return
        }
        expect(detalle.data.lineas).toHaveLength(1)
        expect(detalle.data.lineas[0]?.total).toBe(detalle.data.total)

        const pagos = await usePagos().deFactura(detalle.data.cliente_id, 109)
        expect(pagos.ok && pagos.data.map(p => p.aplicaciones.map(a => a.factura_id)).flat()).toContain(109)

        const asientos = await useLibro().asientosDe('factura', 109, sumarDiasFecha(fechaGuatemala(detalle.data.emitida_en), -1))
        expect(asientos.ok && asientos.data).toHaveLength(1)
        if (asientos.ok && asientos.data[0]) {
            const totales = totalesPartida(asientos.data[0].movimientos)
            expect(totales.debe.toFixed(2)).toBe(detalle.data.total)
            expect(cuadra(totales)).toBe(true)
        }
    })

    it('anular con motivo: la factura queda anulada y el libro tiene su reverso', async () => {
        const resultado = await useFacturas().anular(210, 'Se emitió con el plan equivocado', nuevaClaveIdempotencia())
        expect(resultado.ok && resultado.data.estado).toBe('anulada')

        const asientos = await useLibro().asientosDe('factura', 210, '2026-09-30')
        expect(asientos.ok).toBe(true)
        if (asientos.ok) {
            expect(asientos.data).toHaveLength(2)
            expect(asientos.data[1]?.reversa_de).toBe(asientos.data[0]?.id)
            expect(cuadra(totalesAsientos(asientos.data))).toBe(true)
            const [original, reverso] = asientos.data
            expect(reverso?.movimientos.map(m => m.haber)).toEqual(original?.movimientos.map(m => m.debe))
        }

        const otraVez = await useFacturas().anular(210, 'Repetida', nuevaClaveIdempotencia())
        expect(!otraVez.ok && otraVez.problema.status).toBe(422)
    })

    it('una factura con pagos no se anula y el motivo es obligatorio (422)', async () => {
        const pagada = await useFacturas().anular(109, 'Prueba de anulación', nuevaClaveIdempotencia())
        expect(!pagada.ok && pagada.problema.type).toBe('urn:argosisp:problema:factura_con_pagos')

        const sinMotivo = await useFacturas().anular(210, 'no', nuevaClaveIdempotencia())
        expect(!sinMotivo.ok && sinMotivo.problema.status).toBe(422)
    })

    it('anular exige facturas.anular: el cajero no puede', async () => {
        useNuxtApp().$tokenSesion.value = 'fixture-cajero'
        const resultado = await useFacturas().anular(210, 'Prueba de permisos', nuevaClaveIdempotencia())
        expect(!resultado.ok && resultado.problema.status).toBe(403)
    })

    it('con 501 (como hoy la API) la factura no cambia', async () => {
        simularFalla('POST /api/v1/facturas/:id/anular', 501)
        const resultado = await useFacturas().anular(210, 'Prueba de 501', nuevaClaveIdempotencia())
        expect(!resultado.ok && resultado.problema.status).toBe(501)
        const detalle = await useFacturas().ver(210)
        expect(detalle.ok && detalle.data.estado).toBe('vencida')
    })

    it('el asiento muestra Debe y Haber sumados con decimal.js', async () => {
        const diario = await useLibro().diario({ origen_tipo: 'factura', limit: 1 })
        expect(diario.ok).toBe(true)
        if (!diario.ok || !diario.data.data[0]) {
            return
        }
        const asiento = diario.data.data[0]
        const vista = await mountSuspended(AsientoContable, { props: { asiento } })
        const total = formatearQuetzales(totalesPartida(asiento.movimientos).debe)
        expect(vista.get('[data-prueba="total-debe"]').text()).toBe(total)
        expect(vista.get('[data-prueba="total-haber"]').text()).toBe(total)
        expect(vista.text()).not.toContain('No cuadra')
    })

    it('periodos: últimos 12 meses en Guatemala y etiqueta legible', () => {
        const periodos = periodosRecientes('2026-02-15', 3)
        expect(periodos).toEqual(['2026-02-01', '2026-01-01', '2025-12-01'])
        expect(etiquetaPeriodo('2026-10-01')).toBe('octubre 2026')
        expect(finDePeriodo('2026-02-01')).toBe('2026-02-28')
        expect(inicioDiaGuatemala('2026-10-15')).toBe('2026-10-15T06:00:00.000Z')
    })
})
