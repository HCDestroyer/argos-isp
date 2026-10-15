import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'
import { formatearFecha, formatearFechaHora, formatearQuetzales } from '~/utils/formato'

describe('formatearQuetzales', () => {
    it('agrega Q, separador de miles y dos decimales', () => {
        expect(formatearQuetzales('1234.5')).toBe('Q 1,234.50')
        expect(formatearQuetzales('0')).toBe('Q 0.00')
        expect(formatearQuetzales('1234567.89')).toBe('Q 1,234,567.89')
        expect(formatearQuetzales('250.00')).toBe('Q 250.00')
    })

    it('redondea a centavos con mitad hacia arriba sin errores de coma flotante', () => {
        expect(formatearQuetzales('1.005')).toBe('Q 1.01')
        expect(formatearQuetzales('0.125')).toBe('Q 0.13')
        expect(formatearQuetzales(new Decimal('0.1').plus('0.2'))).toBe('Q 0.30')
    })

    it('muestra el signo antes de la Q en montos negativos', () => {
        expect(formatearQuetzales('-20')).toBe('-Q 20.00')
        expect(formatearQuetzales('-0.001')).toBe('Q 0.00')
    })

    it('acepta montos enormes sin perder precisión', () => {
        expect(formatearQuetzales('999999999999.99')).toBe('Q 999,999,999,999.99')
    })

    it('devuelve guion si el valor no es un monto', () => {
        expect(formatearQuetzales(null)).toBe('—')
        expect(formatearQuetzales(undefined)).toBe('—')
        expect(formatearQuetzales('')).toBe('—')
        expect(formatearQuetzales('abc')).toBe('—')
    })
})

describe('formatearFecha / formatearFechaHora', () => {
    it('convierte de UTC a America/Guatemala (UTC-6)', () => {
        // 05:30 UTC del 15 es 23:30 del 14 en Guatemala.
        expect(formatearFecha('2026-10-15T05:30:00Z')).toBe('14/10/2026')
        expect(formatearFechaHora('2026-10-15T05:30:00Z')).toBe('14/10/2026, 23:30')
        expect(formatearFechaHora(new Date('2026-10-19T15:00:00Z'))).toBe('19/10/2026, 09:00')
    })

    it('no mueve fechas sin hora (periodos, vencimientos)', () => {
        expect(formatearFecha('2026-11-01')).toBe('01/11/2026')
    })

    it('devuelve guion si no hay fecha válida', () => {
        expect(formatearFecha(null)).toBe('—')
        expect(formatearFecha('no-es-fecha')).toBe('—')
        expect(formatearFechaHora(undefined)).toBe('—')
    })
})
