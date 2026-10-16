import { mountSuspended } from '@nuxt/test-utils/runtime'
import Decimal from 'decimal.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reiniciarFixtures, simularFalla } from '~~/fixtures'
import meAdmin from '~~/fixtures/auth/me.admin.json'
import { cierresCaja, cobranzaDiaria, egresos } from '~~/fixtures/reportes/reportes'
import PaginaReporte from '~/pages/reportes/[reporte].vue'
import PaginaReportes from '~/pages/reportes/index.vue'

describe('semana 2 · reportes', () => {
    beforeEach(() => {
        reiniciarFixtures()
        useNuxtApp().$tokenSesion.value = 'fixture-admin'
        useUsuarioActual().value = meAdmin
    })

    afterEach(() => {
        useNuxtApp().$tokenSesion.value = null
        useUsuarioActual().value = null
    })

    it('oculta los id con nombre al lado y la clave de la categoría; deja el turno', () => {
        expect(columnasVisibles(cobranzaDiaria.columnas).map(c => c.clave)).not.toContain('caja_id')
        expect(columnasVisibles(cierresCaja.columnas).map(c => c.clave).slice(0, 2)).toEqual(['turno_id', 'caja'])
        expect(columnasVisibles(egresos.columnas).map(c => c.clave)).toEqual(['periodo', 'categoria_nombre', 'cuenta_codigo', 'egresos', 'monto'])
    })

    it('totales con decimal.js (sin errores de coma flotante); porcentajes de la API', () => {
        const columnas: ColumnaReporte[] = [
            { clave: 'periodo', titulo: 'Periodo', tipo: 'texto' },
            { clave: 'monto', titulo: 'Monto', tipo: 'dinero' },
            { clave: 'pagos', titulo: 'Pagos', tipo: 'entero' },
            { clave: 'pct', titulo: '%', tipo: 'porcentaje' },
        ]
        const totales = totalesReporte(columnas, [{ monto: '0.10', pagos: 1, pct: 10 }, { monto: '0.20', pagos: 2, pct: 30 }], { pct: 25.5 })
        expect(totales.periodo).toBeNull()
        expect(totales.monto instanceof Decimal && totales.monto.toFixed(2)).toBe('0.30')
        expect(totales.pagos instanceof Decimal && totales.pagos.toNumber()).toBe(3)
        expect(totales.pct).toBe(25.5)
    })

    it('formatea cada celda por tipo: quetzales, miles, %, fechas y etiquetas', () => {
        const col = (clave: string, tipo: ColumnaReporte['tipo']): ColumnaReporte => ({ clave, titulo: clave, tipo })
        expect(celdaReporte(col('monto', 'dinero'), '1234.5')).toBe('Q 1,234.50')
        expect(celdaReporte(col('pagos', 'entero'), 12345)).toBe('12,345')
        expect(celdaReporte(col('pct', 'porcentaje'), 62.19)).toBe('62.19 %')
        expect(celdaReporte(col('turno_id', 'id'), 7)).toBe('#7')
        expect(celdaReporte(col('periodo', 'texto'), '2026-10')).toBe('octubre 2026')
        expect(celdaReporte(col('fecha', 'fecha'), '2026-10-16')).toBe('16/10/2026')
        expect(celdaReporte(col('metodo', 'texto'), 'caja')).toBe('Efectivo en caja')
        expect(celdaReporte(col('canal', 'texto'), 'portal')).toBe('Portal del cliente')
        expect(celdaReporte(col('motivo', 'texto'), null)).toBe('—')
        expect(esNegativo(col('diferencia', 'dinero'), '-20.00')).toBe(true)
        expect(esNegativo(col('diferencia', 'dinero'), '0.00')).toBe(false)
    })

    it('cada reporte pide solo los filtros que acepta', async () => {
        const iva = await useReportes().reporte('iva', { desde: '2026-10-01', metodo_pago: 'caja', zona_id: 3 })
        expect(iva.ok && iva.data.filtros).toEqual({ desde: '2026-10-01', hasta: '2026-10-16' })

        const cobranza = await useReportes().reporte('cobranza-diaria', { metodo_pago: 'transferencia' })
        expect(cobranza.ok && cobranza.data.filas.map(f => f.metodo)).toEqual(['transferencia'])

        const invalido = await useReportes().reporte('ingresos', { desde: '16/10/2026' })
        expect(!invalido.ok && invalido.problema.status).toBe(422)
    })

    it('descarga el CSV con los mismos filtros y el Excel como archivo', async () => {
        const archivo = await useReportes().descargar('cobranza-diaria', { metodo_pago: 'caja' }, 'csv')
        expect(archivo.ok).toBe(true)
        if (archivo.ok) {
            const texto = await archivo.data.text()
            expect(texto.split('\n')[0]).toBe('Fecha,Método,Caja,Nombre de caja,Pagos,Cobrado,Anulados,Monto anulado')
            expect(texto).toContain('Total,,,,37,7515.00,1,175.00')
        }
        const excel = await useReportes().descargar('iva', {}, 'xlsx')
        expect(excel.ok && excel.data.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        expect(nombreDescarga('iva', 'xlsx', '2026-10-16')).toBe('iva-2026-10-16.xlsx')
    })

    it('el índice lista los nueve reportes', async () => {
        const vista = await mountSuspended(PaginaReportes, { route: '/reportes' })
        for (const clave of CLAVES_REPORTE) {
            expect(vista.find(`[data-prueba="reporte-${clave}"]`).exists()).toBe(true)
        }
    })

    it('la pantalla muestra la tabla con la fila de totales', async () => {
        const vista = await mountSuspended(PaginaReporte, { route: '/reportes/facturado-vs-cobrado' })
        await vi.waitFor(() => expect(vista.find('[data-prueba="tabla-reporte"]').exists()).toBe(true))
        await vi.waitFor(() => expect(vista.find('[data-prueba="total-facturado"]').text()).toBe('Q 288,450.00'))
        expect(vista.find('[data-prueba="total-cobrado"]').text()).toBe('Q 243,415.50')
        expect(vista.find('[data-prueba="total-cobranza_pct"]').text()).toBe('84.39 %')
        expect(vista.text()).toContain('octubre 2026')
        expect(vista.text()).toContain('Del 01/11/2025 al 16/10/2026')
    })

    it('con error muestra el aviso y no la tabla ni totales', async () => {
        simularFalla('GET /api/v1/reportes/iva', 500)
        const vista = await mountSuspended(PaginaReporte, { route: '/reportes/iva' })
        await vi.waitFor(() => expect(vista.find('[data-prueba="reporte-error"]').exists()).toBe(true))
        expect(vista.text()).toContain('Reintentar')
        expect(vista.find('[data-prueba="tabla-reporte"]').exists()).toBe(false)
        expect(vista.text()).not.toContain('Q ')
    })

    it('un reporte desconocido no pide nada', async () => {
        const vista = await mountSuspended(PaginaReporte, { route: '/reportes/inventado' })
        expect(vista.text()).toContain('Ese reporte no existe')
    })
})
