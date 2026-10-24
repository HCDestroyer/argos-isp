import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import { meAdmin } from '~~/fixtures/auth/sesiones'
import ClienteEstadoCuenta from '~/components/ClienteEstadoCuenta.vue'
import PaginaCliente from '~/pages/clientes/[id]/index.vue'
import PaginaPago from '~/pages/pagos/[id].vue'
import PaginaServicio from '~/pages/servicios/[id].vue'
import { bd } from '~~/fixtures/bd'
import { esperar } from '../ayudas/esperar'

describe('semana 3 (2.ª tanda) · tarea 4: datos de importación visibles', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
    })

    it('lee el origen del cliente y de los movimientos importados', () => {
        expect(origenExterno({ externo: { sistema: 'mikrowisp', id: '1042' } })).toEqual({ sistema: 'Mikrowisp', idExterno: '1042' })
        expect(textoImportado({ sistema: 'Mikrowisp', idExterno: '1042' })).toBe('Importado de Mikrowisp #1042')
        expect(origenExterno({ externo: null })).toBeNull()

        // Las tres descripciones que escribe la API (`contratos/importacion.md`).
        expect(origenMovimiento({ descripcion: 'Pago histórico 12 (mikrowisp:pago:987) · deposito · facturas 40' }))
            .toEqual({ sistema: 'Mikrowisp', idExterno: 'mikrowisp:pago:987', descripcion: 'Pago histórico 12 · deposito · facturas 40' })
        expect(origenMovimiento({ descripcion: 'Factura importada 40 (mikrowisp:factura:7) · servicio 3 · periodo 2026-09-01' })?.idExterno).toBe('mikrowisp:factura:7')
        expect(origenMovimiento({ descripcion: 'Saldo inicial importado (mikrowisp:saldo:123)' }))
            .toEqual({ sistema: 'Mikrowisp', idExterno: 'mikrowisp:saldo:123', descripcion: 'Saldo inicial importado' })
        // Un pago normal con paréntesis no se toma por importado.
        expect(origenMovimiento({ descripcion: 'Depósito (ref. abc:def:1) · aviso 3' })).toBeNull()
        expect(esPagoHistorico({ historico: true })).toBe(true)
        expect(esPagoHistorico({})).toBe(false)
    })

    it('ficha: "Importado de Mikrowisp" discreto y sin repetir mikrowisp_id como campo', async () => {
        const vista = await mountSuspended(PaginaCliente, { route: '/clientes/8' })
        await esperar(() => expect(vista.find('[data-prueba="cliente-importado"]').exists()).toBe(true))
        expect(vista.get('[data-prueba="cliente-importado"]').text()).toBe('Importado de Mikrowisp #1042')
        expect(vista.text()).not.toContain('mikrowisp_id')
        vista.unmount()

        const otro = await mountSuspended(PaginaCliente, { route: '/clientes/1' })
        await esperar(() => expect(otro.text()).toContain('Cliente #1'))
        expect(otro.find('[data-prueba="cliente-importado"]').exists()).toBe(false)
        otro.unmount()
    })

    it('ficha del servicio: «Importado de Mikrowisp #id» desde Servicio.externo', async () => {
        const importado = bd.servicios.find(servicio => servicio.externo !== null)
        expect(importado?.cliente_id).toBe(8)
        const vista = await mountSuspended(PaginaServicio, { route: `/servicios/${importado?.id}` })
        await esperar(() => expect(vista.find('[data-prueba="servicio-importado"]').exists()).toBe(true))
        expect(vista.get('[data-prueba="servicio-importado"]').text()).toBe('Importado de Mikrowisp #2088')
        vista.unmount()
        const otro = await mountSuspended(PaginaServicio, { route: '/servicios/1' })
        await esperar(() => expect(otro.text()).toContain('Servicio #1'))
        expect(otro.find('[data-prueba="servicio-importado"]').exists()).toBe(false)
        otro.unmount()
    })

    it('estado de cuenta: el pago histórico muestra su origen aparte', async () => {
        const vista = await mountSuspended(ClienteEstadoCuenta, { props: { clienteId: 8 } })
        await esperar(() => expect(vista.find('[data-prueba="movimiento-importado"]').exists()).toBe(true))
        expect(vista.get('[data-prueba="movimiento-importado"]').text()).toBe('Importado de Mikrowisp · mikrowisp:pago:987')
        expect(vista.text()).toContain('Pago histórico 9001 · deposito · ref. MW-987 · anticipo')
        expect(vista.findAll('[data-prueba="movimiento-importado"]')).toHaveLength(1)
        vista.unmount()
    })

    it('pago histórico: insignia "Importado" en el detalle', async () => {
        const vista = await mountSuspended(PaginaPago, { route: '/pagos/9001' })
        await esperar(() => expect(vista.find('[data-prueba="pago-historico"]').exists()).toBe(true))
        expect(vista.text()).toContain('no pasó por caja ni bancos')
        vista.unmount()
        const normal = await mountSuspended(PaginaPago, { route: '/pagos/5101' })
        await esperar(() => expect(normal.text()).toContain('Pago #'))
        expect(normal.find('[data-prueba="pago-historico"]').exists()).toBe(false)
        normal.unmount()
    })
})
