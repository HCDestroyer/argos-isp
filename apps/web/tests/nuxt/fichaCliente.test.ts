import Decimal from 'decimal.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures } from '~~/fixtures'

describe('ficha del cliente · composables', () => {
    beforeEach(() => {
        reiniciarFixtures()
        useNuxtApp().$tokenSesion.value = 'fixture-admin'
    })

    afterEach(() => {
        useNuxtApp().$tokenSesion.value = null
    })

    it('useClientes.ver trae el cliente o un 404', async () => {
        const encontrado = await useClientes().ver(3)
        expect(encontrado.ok && encontrado.data.tipo).toBe('empresa')

        const ausente = await useClientes().ver(999)
        expect(!ausente.ok && ausente.problema.status).toBe(404)
    })

    it('useServicios.listar filtra por cliente', async () => {
        const resultado = await useServicios().listar({ cliente_id: 11 })
        expect(resultado.ok).toBe(true)
        if (resultado.ok) {
            expect(resultado.data.data).toHaveLength(2)
            expect(resultado.data.data.every(servicio => servicio.cliente_id === 11)).toBe(true)
        }
    })

    it('el saldo del estado de cuenta es la suma de cargos menos abonos', async () => {
        const resultado = await useClientes().estadoCuenta(12)
        expect(resultado.ok).toBe(true)
        if (resultado.ok) {
            const { saldo, movimientos, facturas_pendientes: pendientes } = resultado.data
            const suma = movimientos.reduce((total, m) => total.plus(m.cargo).minus(m.abono), new Decimal(0))
            expect(suma.toFixed(2)).toBe(saldo)
            expect(movimientos.at(-1)?.saldo).toBe(saldo)
            const porCobrar = pendientes.reduce((total, f) => total.plus(f.total).minus(f.pagado), new Decimal(0))
            expect(porCobrar.toFixed(2)).toBe(saldo)
        }
    })

    it('el estado de cuenta exige clientes.estado_cuenta', async () => {
        useNuxtApp().$tokenSesion.value = 'fixture-cajero'
        expect((await useClientes().estadoCuenta(12)).ok).toBe(true)
    })

    it('useBitacora.deEntidades une cliente y servicios del más reciente al más viejo', async () => {
        const resultado = await useBitacora().deEntidades([
            { tipo: 'cliente', id: 12 },
            { tipo: 'servicio', id: 14 },
        ])
        expect(resultado.ok).toBe(true)
        if (resultado.ok) {
            const tipos = new Set(resultado.data.map(accion => accion.entidad_tipo))
            expect(tipos).toEqual(new Set(['cliente', 'servicio']))
            const fechas = resultado.data.map(accion => accion.created_at)
            expect(fechas).toEqual([...fechas].sort().reverse())
            expect(resultado.data.some(accion => accion.resultado === 'error')).toBe(true)
        }
    })

    it('useBitacora.deEntidades devuelve el primer problema (cajero sin bitacora.ver)', async () => {
        useNuxtApp().$tokenSesion.value = 'fixture-cajero'
        const resultado = await useBitacora().deEntidades([{ tipo: 'cliente', id: 1 }])
        expect(!resultado.ok && resultado.problema.status).toBe(403)
    })

    it('etiquetas de la línea de tiempo', () => {
        expect(etiquetaAccion('servicios.suspender')).toBe('Servicio suspendido')
        expect(etiquetaAccion('algo.nuevo')).toBe('algo.nuevo')
        const base = {
            id: 1,
            canal: 'cron',
            accion: 'servicios.suspender',
            entidad_tipo: 'servicio',
            entidad_id: 4,
            entrada: {},
            resultado: 'ok' as const,
            error: null,
            request_id: null,
            created_at: '2026-10-11T14:00:00Z',
        }
        expect(etiquetaActor({ ...base, actor_tipo: 'sistema', actor_id: null })).toBe('Sistema')
        expect(etiquetaActor({ ...base, actor_tipo: 'usuario', actor_id: 7 })).toBe('Usuario #7')
        expect(etiquetaEntidad({ ...base, actor_tipo: 'sistema', actor_id: null })).toBe('servicio 4')
        expect(iconoAccion({ ...base, actor_tipo: 'sistema', actor_id: null, resultado: 'error' })).toBe('i-lucide-triangle-alert')
    })
})
