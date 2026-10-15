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

    it('la bitácora por cliente_id junta el cliente y sus servicios, del más reciente al más viejo', async () => {
        const resultado = await useBitacora().acciones({ cliente_id: 12, excluir_canal: 'portal', limit: 200 })
        expect(resultado.ok).toBe(true)
        if (resultado.ok) {
            const filas = resultado.data.data
            const tipos = new Set(filas.map(accion => accion.entidad_tipo))
            expect(tipos).toEqual(new Set(['cliente', 'servicio']))
            const servicios = new Set(filas.filter(a => a.entidad_tipo === 'servicio').map(a => a.entidad_id))
            const delCliente = await useServicios().listar({ cliente_id: 12 })
            expect([...servicios].every(id => delCliente.ok && delCliente.data.data.some(s => s.id === id))).toBe(true)
            const fechas = filas.map(accion => accion.created_at)
            expect(fechas).toEqual([...fechas].sort().reverse())
            expect(filas.some(accion => accion.resultado === 'error')).toBe(true)
            expect(filas.some(accion => accion.canal === 'portal')).toBe(false)
        }
    })

    it('la bitácora exige bitacora.ver (cajero)', async () => {
        useNuxtApp().$tokenSesion.value = 'fixture-cajero'
        const resultado = await useBitacora().acciones({ cliente_id: 1 })
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
        expect(etiquetaActor({ ...base, actor_tipo: 'usuario', actor_id: 1, actor_nombre: 'Ana Administradora' })).toBe('Ana Administradora')
        expect(etiquetaActor({ ...base, actor_tipo: 'agente', actor_id: 9, actor_nombre: 'Bot de cobro' })).toBe('Bot de cobro (Agente de IA)')
        expect(motivoAccion({ ...base, actor_tipo: 'usuario', actor_id: 1, entrada: { motivo: ' viaje ' } })).toBe('viaje')
        expect(motivoAccion({ ...base, actor_tipo: 'usuario', actor_id: 1 })).toBeNull()
        expect(etiquetaEntidad({ ...base, actor_tipo: 'sistema', actor_id: null })).toBe('servicio 4')
        expect(iconoAccion({ ...base, actor_tipo: 'sistema', actor_id: null, resultado: 'error' })).toBe('i-lucide-triangle-alert')
    })
})
