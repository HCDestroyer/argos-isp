import Decimal from 'decimal.js'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reiniciarFixtures, simularFalla } from '~~/fixtures'
import PaginaCaja from '~/pages/caja/index.vue'

describe('tarea 12 · caja', () => {
    beforeEach(() => {
        reiniciarFixtures()
        useNuxtApp().$tokenSesion.value = 'fixture-cajero'
    })

    afterEach(() => {
        useNuxtApp().$tokenSesion.value = null
    })

    it('denominaciones y esperado provisional con decimal.js', () => {
        expect(totalDenominaciones({ 200: 2, 100: 1, 0.25: 3, 0.05: 1 }).toFixed(2)).toBe('500.80')
        expect(totalDenominaciones({ 200: -1, 50: 1.5 }).toFixed(2)).toBe('0.00')
        const pagos = [
            { metodo: 'caja', estado: 'registrado', monto: '150.00' },
            { metodo: 'caja', estado: 'anulado', monto: '99.00' },
            { metodo: 'deposito', estado: 'registrado', monto: '300.00' },
        ] as const
        expect(esperadoProvisional('500.00', pagos.map(p => ({ ...base(), ...p }))).toFixed(2)).toBe('650.00')
        expect(etiquetaDiferencia('-5')).toBe('Faltante Q 5.00')
        expect(etiquetaDiferencia('20.5')).toBe('Sobrante Q 20.50')
        expect(colorDiferencia('0.00')).toBe('success')
    })

    it('el motivo es obligatorio si contado ≠ esperado (espejo de cerrarCajaValidator)', () => {
        const esquema = esquemaCierre(new Decimal('650.00'))
        expect(esquema.safeParse({ contado: '650.00', motivo: '' }).success).toBe(true)
        expect(esquema.safeParse({ contado: '645.00', motivo: '' }).success).toBe(false)
        expect(esquema.safeParse({ contado: '645.00', motivo: 'Vuelto mal entregado' }).success).toBe(true)
        expect(esquema.safeParse({ contado: '645,00', motivo: 'x' }).success).toBe(false)
        // Sin esperado (cobros sin leer) decide la API.
        expect(esquemaCierre(null).safeParse({ contado: '1.00', motivo: '' }).success).toBe(true)
    })

    it('cerrar con diferencia: la API calcula esperado y diferencia y exige motivo', async () => {
        const api = useCajas()
        const cobro = await usePagos().registrar({ cliente_id: 2, metodo: 'caja', caja_id: 1, monto: '150.00' }, nuevaClaveIdempotencia())
        expect(cobro.ok).toBe(true)

        const sinMotivo = await api.cerrar(1, { contado: '640.00', motivo: null }, nuevaClaveIdempotencia())
        expect(!sinMotivo.ok && sinMotivo.problema.errors?.[0]?.field).toBe('motivo')

        const cerrado = await api.cerrar(1, { contado: '640.00', motivo: 'Faltaron Q 10.00' }, nuevaClaveIdempotencia())
        expect(cerrado.ok).toBe(true)
        if (cerrado.ok) {
            expect(cerrado.data.esperado).toBe('650.00')
            expect(cerrado.data.diferencia).toBe('-10.00')
            expect(cerrado.data.cerrado_en).not.toBeNull()
        }
        const cajas = await api.listar()
        expect(cajas.ok && cajas.data.find(c => c.id === 1)?.turno_abierto_id).toBeNull()
    })

    it('abrir turno con fondo inicial; abrir dos veces es 409', async () => {
        const api = useCajas()
        const turno = await api.abrir(3, '250.00', nuevaClaveIdempotencia())
        expect(turno.ok && turno.data.fondo_inicial).toBe('250.00')
        const otra = await api.abrir(3, '250.00', nuevaClaveIdempotencia())
        expect(!otra.ok && otra.problema.type).toBe('urn:argosisp:problema:turno_abierto')
        const turnos = await api.turnos(3)
        expect(turnos.ok && turnos.data.data[0]?.cerrado_en).toBeNull()
    })

    it('con GET /cajas en 501 la página muestra el error y ningún monto', async () => {
        simularFalla('GET /api/v1/cajas', 501)
        const vista = await mountSuspended(PaginaCaja)
        await vi.waitFor(() => expect(vista.text()).toContain('No implementado'))
        expect(vista.text()).toContain('Reintentar')
        expect(vista.text()).not.toContain('Q ')
        expect(vista.find('[data-prueba="turno-abierto"]').exists()).toBe(false)
    })
})

function base() {
    return {
        id: 1, cliente_id: 1, metodo: 'caja' as const, monto: '0.00', comision: '0.00', referencia: null, caja_id: 1,
        pasarela: null, estado: 'registrado' as const, nota: null, registrado_por: 2, aplicaciones: [],
        anulado_en: null, motivo_anulacion: null, version: 1, created_at: '2026-10-15T14:00:00.000Z', updated_at: '2026-10-15T14:00:00.000Z',
    }
}
