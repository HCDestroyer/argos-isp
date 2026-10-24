import Decimal from 'decimal.js'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture, simularFalla } from '~~/fixtures'
import meAdmin from '~~/fixtures/auth/me.admin.json'
import meCajero from '~~/fixtures/auth/me.cajero.json'
import { bd } from '~~/fixtures/bd'
import { esperadoDelTurno } from '~~/fixtures/cajas/rutas'
import PaginaCaja from '~/pages/caja/index.vue'
import { esperar } from '../ayudas/esperar'

describe('tarea 12 · caja', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-cajero')
    })

    afterEach(() => {
        sesionFixture(null)
    })

    it('denominaciones y esperado provisional con decimal.js', () => {
        expect(totalDenominaciones({ 200: 2, 100: 1, 0.25: 3, 0.05: 1 }).toFixed(2)).toBe('500.80')
        expect(totalDenominaciones({ 200: -1, 50: 1.5 }).toFixed(2)).toBe('0.00')
        const pagos = [
            { metodo: 'caja', estado: 'registrado', monto: '150.00' },
            { metodo: 'caja', estado: 'anulado', monto: '99.00' },
            { metodo: 'deposito', estado: 'registrado', monto: '300.00' },
        ] as const
        expect(esperadoProvisional('500.00', pagos.map(p => ({ ...base(), ...p })), [], 41).toFixed(2)).toBe('650.00')
        // Como `CerrarCaja`: resta los egresos en efectivo vigentes de este turno (no anulados, no de otro turno ni banco).
        const egresos = [
            { metodo: 'caja', estado: 'registrado', turno_id: 41, monto: '120.00' },
            { metodo: 'caja', estado: 'anulado', turno_id: 41, monto: '50.00' },
            { metodo: 'caja', estado: 'registrado', turno_id: 40, monto: '30.00' },
            { metodo: 'banco', estado: 'registrado', turno_id: null, monto: '900.00' },
        ] as const
        expect(esperadoProvisional('500.00', pagos.map(p => ({ ...base(), ...p })), egresos, 41).toFixed(2)).toBe('530.00')
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

    it('con egresos.ver el esperado provisional resta el egreso en efectivo y coincide con el cierre', async () => {
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
        const egreso = await useEgresos().registrar({ categoria: 'otros', monto: '120.00', metodo: 'caja', caja_id: 1 }, nuevaClaveIdempotencia())
        expect(egreso.ok && egreso.data.turno_id).toBe(41)
        const turno = bd.turnos.find(t => t.id === 41)
        expect(turno).toBeDefined()
        const oficial = turno ? esperadoDelTurno(turno) : new Decimal(0)

        const vista = await mountSuspended(PaginaCaja, { route: '/caja?caja=1' })
        await esperar(() => expect(vista.find('[data-prueba="turno-esperado"]').exists()).toBe(true))
        expect(vista.get('[data-prueba="turno-esperado"]').text()).toContain(formatearQuetzales(oficial))
        expect(vista.get('[data-prueba="turno-egresos"]').text()).toContain('− Q 120.00')
        vista.unmount()

        const cerrado = await useCajas().cerrar(1, { contado: oficial.toFixed(2) }, nuevaClaveIdempotencia())
        expect(cerrado.ok && [cerrado.data.esperado, cerrado.data.diferencia]).toEqual([oficial.toFixed(2), '0.00'])
        useUsuarioActual().value = null
    })

    it('el cajero (solo cajas.ver) lee los egresos de su turno y ve el esperado provisional', async () => {
        useUsuarioActual().value = meCajero
        const turno = bd.turnos.find(t => t.caja_id === 1 && t.cerrado_en === null)
        const oficial = turno ? esperadoDelTurno(turno) : new Decimal(0)
        const vista = await mountSuspended(PaginaCaja, { route: '/caja?caja=1' })
        await esperar(() => expect(vista.find('[data-prueba="turno-abierto"]').exists()).toBe(true))
        await esperar(() => expect(vista.find('[data-prueba="turno-esperado"]').exists()).toBe(true))
        expect(vista.get('[data-prueba="turno-esperado"]').text()).toContain(formatearQuetzales(oficial))
        expect(vista.find('[data-prueba="sin-esperado"]').exists()).toBe(false)
        vista.unmount()
        useUsuarioActual().value = null
    })

    it('con solo cajas.ver, GET /egresos exige caja_id o turno_id (como la API)', async () => {
        const sinCaja = await useEgresos().listar({})
        expect(!sinCaja.ok && sinCaja.problema.status).toBe(422)
        const conTurno = await useEgresos().listar({ caja_id: 1, turno_id: 41 })
        expect(conTurno.ok).toBe(true)
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
        await esperar(() => expect(vista.text()).toContain('No implementado'))
        expect(vista.text()).toContain('Reintentar')
        expect(vista.text()).not.toContain('Q ')
        expect(vista.find('[data-prueba="turno-abierto"]').exists()).toBe(false)
    })
})

function base() {
    return {
        id: 1, empresa_id: 1, cobro_id: null, cliente_id: 1, metodo: 'caja' as const, monto: '0.00', comision: '0.00', referencia: null, caja_id: 1,
        pasarela: null, estado: 'registrado' as const, nota: null, registrado_por: 2, aplicaciones: [],
        anulado_en: null, motivo_anulacion: null, version: 1, created_at: '2026-10-15T14:00:00.000Z', updated_at: '2026-10-15T14:00:00.000Z',
    }
}
