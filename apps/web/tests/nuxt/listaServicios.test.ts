import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'

describe('lista de servicios · filtros del contrato', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
    })

    afterEach(() => {
        sesionFixture(null)
    })

    async function filas(filtros: FiltrosServicios) {
        const resultado = await useServicios().listar({ limit: 200, ...filtros })
        expect(resultado.ok).toBe(true)
        return resultado.ok ? resultado.data.data : []
    }

    it('"Cortados" filtra por estado suspendido', async () => {
        const cortados = await filas({ estado: 'suspendido' })
        expect(cortados.length).toBeGreaterThan(0)
        expect(cortados.every(s => s.estado === 'suspendido')).toBe(true)
    })

    it('combina estado, router y plan', async () => {
        const todos = await filas({})
        const combinados = await filas({ estado: 'activo', router_id: 1, plan_id: 2 })
        expect(combinados.length).toBeGreaterThan(0)
        expect(combinados.length).toBeLessThan(todos.length)
        expect(combinados.every(s => s.estado === 'activo' && s.router_id === 1 && s.plan_id === 2)).toBe(true)
    })

    it('filtra por cliente y busca por usuario PPP o IP', async () => {
        const delCliente = await filas({ cliente_id: 3 })
        expect(delCliente).toHaveLength(2)

        const [primero] = delCliente
        expect(primero).toBeDefined()
        const porUsuario = await filas({ q: primero?.user_ppp?.slice(0, 6) })
        expect(porUsuario.some(s => s.id === primero?.id)).toBe(true)

        const porIp = await filas({ q: primero?.ipv4 ?? '' })
        expect(porIp.map(s => s.id)).toEqual([primero?.id])
    })

    it('cada servicio trae los nombres de cliente, plan, router y zona', async () => {
        const todos = await filas({})
        expect(todos.length).toBeGreaterThan(0)
        for (const servicio of todos) {
            expect(nombreCliente(servicio)).not.toMatch(/^Cliente #/)
            expect(nombrePlan(servicio)).not.toMatch(/^Plan #/)
            expect(nombreRouter(servicio)).not.toMatch(/^Router #/)
        }
        expect(todos.some(s => nombreZona(s) !== null)).toBe(true)
        // El cajero no tiene routers.ver, pero ve el nombre del router en el servicio.
        sesionFixture('fixture-cajero')
        const delCajero = await filas({})
        expect(delCajero.every(s => s.router_nombre)).toBe(true)
    })

    it('sin nombres en la respuesta, muestra el id', () => {
        const servicio = { cliente_id: 4, cliente_nombre: '', plan_id: 2, plan_nombre: '', router_id: 1, router_nombre: '', zona_nombre: null }
        expect(nombreCliente(servicio)).toBe('Cliente #4')
        expect(nombrePlan(servicio)).toBe('Plan #2')
        expect(nombreRouter(servicio)).toBe('Router #1')
        expect(nombreZona(servicio)).toBeNull()
    })

    it('una búsqueda vacía no manda q', async () => {
        const conVacio = await filas({ q: '' })
        const sinQ = await filas({})
        expect(conVacio.length).toBe(sinQ.length)
    })

    it('los filtros de estado usan los valores del contrato', () => {
        expect(ESTADOS_FILTRO.map(e => e.estado)).toEqual(['pendiente_instalacion', 'activo', 'limitado', 'suspendido', 'retirado'])
        expect(ESTADOS_FILTRO.find(e => e.estado === 'suspendido')?.etiqueta).toContain('Cortado')
        expect(esEstadoServicio('suspendido')).toBe(true)
        expect(esEstadoServicio('cortado')).toBe(false)
    })
})
