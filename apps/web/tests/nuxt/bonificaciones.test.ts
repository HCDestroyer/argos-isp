import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import meAdmin from '~~/fixtures/auth/me.admin.json'
import meCajero from '~~/fixtures/auth/me.cajero.json'
import { bd } from '~~/fixtures/bd'
import ClienteEstadoCuenta from '~/components/ClienteEstadoCuenta.vue'
import PaginaBonificacion from '~/pages/bonificaciones/[id].vue'
import PaginaBonificaciones from '~/pages/bonificaciones/index.vue'
import PaginaReporte from '~/pages/reportes/[reporte].vue'
import PaginaServicio from '~/pages/servicios/[id].vue'

/**
 * Bonificaciones (A3, `a3/decisiones-pm`): nunca una factura de Q0. Un periodo regalado o un cargo
 * único sin costo queda como bonificación (`GET /bonificaciones[/:id]`), con su motivo, periodo y
 * bruto; `POST /facturas/cargo-unico` responde `{documento, factura, bonificacion}`; el reporte
 * `bonificaciones` y el origen `bonificacion` del libro.
 */
describe('bonificaciones', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
    })

    it('utilidades: periodo legible, ocupa periodo, origen y su ruta en el libro', () => {
        expect(periodoBonificacion({ periodo: '2026-10-01', clave_unica: '5-2026-10-01' })).toBe('octubre 2026')
        expect(periodoBonificacion({ periodo: '2026-10-05', clave_unica: 'cargo-abc' })).toBe('05/10/2026')
        expect(ocupaPeriodo({ clave_unica: '5-2026-10-01' })).toBe(true)
        expect(ocupaPeriodo({ clave_unica: 'cargo-abc' })).toBe(false)
        expect(origenBonificacionVisual('canje').etiqueta).toBe('Canje de lealtad')
        expect(origenBonificacionVisual('regalo_nuevo').etiqueta).toBe('Regalo nuevo')
        expect(origenAsiento('bonificacion').etiqueta).not.toBe('Bonificacion')
        expect(rutaOrigen({ origen_tipo: 'bonificacion', origen_id: 3 })).toBe('/bonificaciones/3')
    })

    it('esquema del cargo: con total Q0 pide motivo y explicación; el cuerpo solo los manda en Q0', () => {
        const linea = { concepto_id: 1, descripcion: '', cantidad: '1', precio_unitario: '250', descuento: '250', descuento_concepto: 'Promoción' }
        const sinMotivo = esquemaCargoUnico.safeParse({ vence_en: '', lineas: [linea], motivo_sin_costo_id: null, motivo_sin_costo_texto: '' })
        expect(sinMotivo.success).toBe(false)
        expect(sinMotivo.error?.issues.map(i => i.path.join('.'))).toEqual(['motivo_sin_costo_id', 'motivo_sin_costo_texto'])

        const conCosto = esquemaCargoUnico.parse({ vence_en: '', lineas: [{ ...linea, descuento: '50' }], motivo_sin_costo_id: 2, motivo_sin_costo_texto: 'x' })
        expect(totalCargoUnico(conCosto.lineas)?.toFixed(2)).toBe('200.00')
        const cuerpo = cuerpoCargoUnico({ servicio_id: 1 }, conCosto)
        expect(cuerpo).toMatchObject({ servicio_id: 1, motivo_sin_costo_id: null, motivo_sin_costo_texto: null })
        expect(cuerpo.lineas[0]).toEqual({ concepto_id: 1, descripcion: null, cantidad: '1', precio_unitario: '250.00', descuentos: [{ concepto: 'Promoción', monto: '50.00' }] })

        const excede = esquemaCargoUnico.safeParse({ vence_en: '', lineas: [{ ...linea, descuento: '300' }], motivo_sin_costo_id: null, motivo_sin_costo_texto: '' })
        expect(excede.error?.issues.some(i => i.path.join('.') === 'lineas.0.descuento')).toBe(true)
    })

    it('cargo único con total > 0: factura con sus líneas y el descuento', async () => {
        const r = await useCargoUnico().emitir({ servicio_id: 1, lineas: [{ concepto_id: 2, precio_unitario: '560.00', descuentos: [{ concepto: 'Promoción', monto: '60.00' }] }] }, nuevaClaveIdempotencia())
        expect(r.ok).toBe(true)
        if (!r.ok) {
            return
        }
        expect(r.data.documento).toBe('factura')
        expect(r.data.bonificacion).toBeNull()
        expect(r.data.factura).toMatchObject({ total: '500.00', cargo_unico: true, servicio_id: 1 })
        const leida = await useFacturas().ver(r.data.factura?.id ?? 0)
        expect(leida.ok && leida.data.lineas.map(l => [l.concepto, l.total])).toEqual([['Router Wi-Fi', '560.00'], ['Promoción', '-60.00']])
    })

    it('cargo único sin costo: bonificación con asiento; motivo obligatorio y permiso propio', async () => {
        const lineas = [{ concepto_id: 1, precio_unitario: '250.00', descuentos: [{ concepto: 'Campaña', monto: '250.00' }] }]
        const sinMotivo = await useCargoUnico().emitir({ servicio_id: 2, lineas }, nuevaClaveIdempotencia())
        expect(!sinMotivo.ok && sinMotivo.problema.status).toBe(422)

        const r = await useCargoUnico().emitir({ servicio_id: 2, lineas, motivo_sin_costo_id: 1, motivo_sin_costo_texto: 'Campaña de octubre' }, nuevaClaveIdempotencia())
        expect(r.ok).toBe(true)
        if (!r.ok || !r.data.bonificacion) {
            return
        }
        expect(r.data).toMatchObject({ documento: 'bonificacion', factura: null })
        expect(r.data.bonificacion).toMatchObject({ origen: 'cargo_sin_costo', bruto: '250.00', base: '223.21', motivo_nombre: 'Promoción de instalación' })
        expect(r.data.bonificacion.clave_unica.startsWith('cargo-')).toBe(true)
        expect(bd.facturas.some(f => f.total === '0.00')).toBe(false)
        const asiento = bd.asientos.find(a => a.origen_tipo === 'bonificacion' && a.origen_id === r.data.bonificacion?.id)
        expect(asiento?.movimientos.map(m => [m.debe, m.haber])).toEqual([['223.21', '0.00'], ['0.00', '223.21']])

        sesionFixture('fixture-cajero')
        useUsuarioActual().value = meCajero
        const cajero = await useCargoUnico().emitir({ servicio_id: 2, lineas, motivo_sin_costo_id: 1, motivo_sin_costo_texto: 'x' }, nuevaClaveIdempotencia())
        expect(!cajero.ok && cajero.problema.status).toBe(403)
    })

    it('concepto inactivo o de otra empresa: 422', async () => {
        const inactivo = await useCargoUnico().emitir({ servicio_id: 1, lineas: [{ concepto_id: 4, precio_unitario: '10.00' }] }, nuevaClaveIdempotencia())
        expect(!inactivo.ok && inactivo.problema.status).toBe(422)
        const otra = await useCargoUnico().emitir({ servicio_id: 1, lineas: [{ concepto_id: 5, precio_unitario: '10.00' }] }, nuevaClaveIdempotencia())
        expect(!otra.ok && otra.problema.status).toBe(422)
    })

    it('lista: filtra por origen y por servicio; la ficha muestra motivo, bruto y el asiento', async () => {
        const canjes = await useBonificaciones().listar({ origen: 'canje' })
        expect(canjes.ok && canjes.data.data.map(b => b.id)).toEqual([1])
        const delServicio = await useBonificaciones().listar({ servicio_id: 1 })
        expect(delServicio.ok && delServicio.data.data.map(b => b.id)).toEqual([3])

        const lista = await mountSuspended(PaginaBonificaciones, { route: '/bonificaciones' })
        await vi.waitFor(() => expect(lista.find('[data-prueba="tabla-bonificaciones"]').text()).toContain('Cortesía comercial'))
        expect(lista.text()).toContain('agosto 2026')
        lista.unmount()

        const ficha = await mountSuspended(PaginaBonificacion, { route: '/bonificaciones/3' })
        await vi.waitFor(() => expect(ficha.find('[data-prueba="ficha-bonificacion"]').exists()).toBe(true))
        expect(ficha.find('[data-prueba="bonificacion-origen"]').text()).toBe('Cargo sin costo')
        expect(ficha.find('[data-prueba="bonificacion-motivo"]').text()).toContain('Promoción de instalación')
        expect(ficha.find('[data-prueba="bonificacion-bruto"]').text()).toContain('Q 250.00')
        await vi.waitFor(() => expect(ficha.text()).toContain('Descuentos y bonificaciones'))
        ficha.unmount()
    })

    it('ficha del servicio y estado de cuenta: muestran los periodos bonificados', async () => {
        const servicio = await mountSuspended(PaginaServicio, { route: '/servicios/5' })
        await vi.waitFor(() => expect(servicio.find('[data-prueba="periodos-bonificados"] [data-bonificacion="1"]').exists()).toBe(true))
        expect(servicio.find('[data-prueba="periodos-bonificados"]').text()).toContain('agosto 2026')
        expect(servicio.find('[data-prueba="abrir-cargo-unico"]').exists()).toBe(true)
        servicio.unmount()

        const cuenta = await mountSuspended(ClienteEstadoCuenta, { props: { clienteId: 6 } })
        await vi.waitFor(() => expect(cuenta.find('[data-prueba="periodos-bonificados"] [data-bonificacion="2"]').exists()).toBe(true))
        expect(cuenta.find('[data-prueba="periodos-bonificados"]').text()).toContain('Q 450.00')
        cuenta.unmount()
    })

    it('reporte: por mes, motivo y origen, con totales; reemplaza a «Facturas sin costo»', async () => {
        const r = await useReportes().reporte('bonificaciones', { origen_bonificacion: 'canje' })
        expect(r.ok).toBe(true)
        if (!r.ok) {
            return
        }
        expect(r.data.filas).toEqual([expect.objectContaining({ periodo: '2026-08', motivo: 'Programa de lealtad', origen: 'canje', bonificaciones: 1, valor_bruto: '150.00', base: '133.93' })])
        expect(REPORTES.bonificaciones).toBeDefined()
        expect(Object.keys(REPORTES)).not.toContain('facturas-sin-costo')

        const vista = await mountSuspended(PaginaReporte, { route: '/reportes/bonificaciones' })
        await vi.waitFor(() => expect(vista.text()).toContain('Cortesía comercial'))
        expect(vista.find('[data-prueba="filtro-origen-bonificacion"]').exists()).toBe(true)
        expect(vista.find('[data-prueba="filtro-motivo"]').exists()).toBe(true)
        vista.unmount()
    })
})
