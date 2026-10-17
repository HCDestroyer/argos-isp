import { mountSuspended } from '@nuxt/test-utils/runtime'
import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'
import GraficaColumnas from '~/components/GraficaColumnas.vue'

describe('gráficas del panel', () => {
    const series: SerieGrafica[] = [
        { id: 'facturado', nombre: 'Facturado', valores: ['1200.50', '980.00', null] },
        { id: 'cobrado', nombre: 'Cobrado', valores: ['1000.25', '1100.10', '0.00'] },
    ]

    it('el eje va de 0 a un tope redondo que cubre el máximo', () => {
        expect(marcasEje(new Decimal('1200.50')).map(m => m.toNumber())).toEqual([0, 500, 1000, 1500])
        expect(marcasEje(new Decimal(7), 4, true).map(m => m.toNumber())).toEqual([0, 2, 4, 6, 8])
        expect(marcasEje(new Decimal(3), 4, true).map(m => m.toNumber())).toEqual([0, 1, 2, 3])
        expect(marcasEje(new Decimal(0)).map(m => m.toNumber())).toEqual([0, 1])
    })

    it('máximo y totales con decimal.js: agrupada por valor, apilada por suma', () => {
        expect(maximoGrafica(series, 3, false).toFixed(2)).toBe('1200.50')
        expect(maximoGrafica(series, 3, true).toFixed(2)).toBe('2200.75')
        expect(totalesPorCategoria(series, 3).map(t => t.toFixed(2))).toEqual(['2200.75', '2080.10', '0.00'])
    })

    it('etiquetas compactas del eje y valores completos del tooltip', () => {
        expect(etiquetaCompacta(new Decimal(0), 'quetzales')).toBe('Q 0')
        expect(etiquetaCompacta(new Decimal(2500), 'quetzales')).toBe('Q 2.5K')
        expect(etiquetaCompacta(new Decimal(1_200_000), 'quetzales')).toBe('Q 1.2M')
        expect(etiquetaCompacta(new Decimal(250), 'quetzales')).toBe('Q 250')
        expect(etiquetaCompacta(new Decimal(12), 'entero')).toBe('12')
        expect(etiquetaValor('1234.5', 'quetzales')).toBe('Q 1,234.50')
        expect(etiquetaValor(1234, 'entero')).toBe('1,234')
        expect(etiquetaValor(null, 'quetzales')).toBe('—')
    })

    it('columna con extremo redondeado y base recta; vacía si no tiene alto', () => {
        expect(trayectoColumna(10, 20, 24, 100)).toBe('M10,120V24Q10,20 14,20H30Q34,20 34,24V120Z')
        expect(trayectoColumna(10, 20, 24, 100, false)).toBe('M10,120V20Q10,20 10,20H34Q34,20 34,20V120Z')
        expect(trayectoColumna(10, 20, 24, 0)).toBe('')
    })

    it('colores por rol: categórica en orden fijo y secuencial para datos ordenados', () => {
        expect(colorSerie('categorica', 0)).toBe(CATEGORICAL.light[0])
        expect(colorSerie('categorica', 1, 'dark')).toBe(CATEGORICAL.dark[1])
        expect(colorSerie('categorica', 9)).toBe(CATEGORICAL.light[4])
        expect(colorSerie('secuencial', 3)).toBe(SECUENCIAL.light[3])
        expect(colorSerie('secuencial', 0, 'dark')).toBe(SECUENCIAL.dark[0])
    })

    it('la vista de tabla repite cada valor (con total en la apilada)', async () => {
        const vista = await mountSuspended(GraficaColumnas, {
            props: { titulo: 'Facturado y cobrado', categorias: ['ago', 'sep', 'oct'], categoriasLargas: ['agosto 2026', 'septiembre 2026', 'octubre 2026'], series, apilada: true },
        })
        expect(vista.text()).toContain('Facturado')
        expect(vista.text()).toContain('Cobrado')
        await vista.get('button').trigger('click')
        expect(vista.text()).toContain('septiembre 2026')
        expect(vista.text()).toContain('Q 2,200.75')
        expect(vista.text()).toContain('—')
    })
})
