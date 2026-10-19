import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import meAdmin from '~~/fixtures/auth/me.admin.json'
import { facturadoCobrado, ingresos, iva } from '~~/fixtures/reportes/reportes'
import PaginaReporte from '~/pages/reportes/[reporte].vue'
import { esperar } from '../ayudas/esperar'

/**
 * Semana 3 (3.ª tanda) · tarea 2: reportes con histórico importado y notas de crédito (A3, filas
 * 76 y 78 de `a3.md`): `origen=sistema|importado`, columnas agregadas y `cobrado` sin notas.
 */
describe('reportes con histórico y notas de crédito', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
    })

    it('los fixtures traen las columnas agregadas en el orden de la API', () => {
        expect(ingresos.columnas.map(c => c.clave).slice(-2)).toEqual(['pagos_importados', 'monto_importado'])
        expect(facturadoCobrado.columnas.map(c => c.clave).slice(-3)).toEqual(['acreditado', 'facturado_importado', 'cobrado_importado'])
        expect(iva.columnas.map(c => c.clave)).toEqual([
            'periodo', 'facturas', 'base', 'iva_facturado', 'facturas_anuladas', 'base_anulada', 'iva_anulado',
            'notas_credito', 'base_acreditada', 'iva_acreditado', 'iva_neto', 'iva_libro',
        ])
    })

    it('solo ingresos y facturado vs cobrado mandan origen', async () => {
        expect(CONSULTAS_REPORTE.ingresos({ origen: 'importado' }).origen).toBe('importado')
        expect(CONSULTAS_REPORTE['facturado-vs-cobrado']({ origen: 'sistema' }).origen).toBe('sistema')
        expect(CONSULTAS_REPORTE.iva({ origen: 'sistema' })).not.toHaveProperty('origen')
        expect(REPORTES.ingresos.filtros).toContain('origen')
        expect(REPORTES['cobranza-diaria'].filtros).not.toContain('origen')

        const importado = await useReportes().reporte('ingresos', { origen: 'importado' })
        expect(importado.ok && importado.data.filas.map(f => [f.periodo, f.pagos, f.monto])).toEqual([['2026-09', 40, '7000.00']])
        const sistema = await useReportes().reporte('facturado-vs-cobrado', { origen: 'sistema' })
        const agosto = sistema.ok ? sistema.data.filas[0] : null
        expect(agosto).toMatchObject({ periodo: '2026-08', facturado: '81480.00', cobrado: '77929.10', acreditado: '175.00', pendiente: '3375.90' })
    })

    it('facturado vs cobrado: pendiente = facturado − cobrado − notas de crédito', () => {
        for (const fila of facturadoCobrado.filas) {
            const pendiente = Number(fila.facturado) - Number(fila.cobrado) - Number(fila.acreditado)
            expect(pendiente.toFixed(2)).toBe(fila.pendiente)
        }
        for (const fila of iva.filas) {
            const neto = Number(fila.iva_facturado) - Number(fila.iva_anulado) - Number(fila.iva_acreditado)
            expect(neto.toFixed(2)).toBe(fila.iva_neto)
        }
    })

    it('la pantalla: selector de origen, columnas nuevas y la nota de «cobrado»', async () => {
        const vista = await mountSuspended(PaginaReporte, { route: '/reportes/facturado-vs-cobrado?origen=importado' })
        await esperar(() => expect(vista.find('[data-prueba="tabla-reporte"]').exists()).toBe(true))
        expect(vista.find('[data-prueba="filtro-origen"]').exists()).toBe(true)
        expect(vista.find('[data-prueba="nota-reporte"]').text()).toContain('«Cobrado» ya no incluye las notas de crédito')
        const encabezados = vista.find('[data-prueba="tabla-reporte"]').text()
        for (const titulo of ['Notas de crédito', 'Facturado importado', 'Cobrado importado']) {
            expect(encabezados).toContain(titulo)
        }
        await esperar(() => expect(vista.find('[data-prueba="total-facturado"]').text()).toBe('Q 12,400.00'))
        expect(useRoute().query.origen).toBe('importado')
    })

    it('IVA muestra notas de crédito, base e IVA acreditados', async () => {
        const vista = await mountSuspended(PaginaReporte, { route: '/reportes/iva' })
        await esperar(() => expect(vista.find('[data-prueba="total-iva_acreditado"]').text()).toBe('Q 18.75'))
        expect(vista.find('[data-prueba="total-base_acreditada"]').text()).toBe('Q 156.25')
        expect(vista.find('[data-prueba="filtro-origen"]').exists()).toBe(false)
    })
})
