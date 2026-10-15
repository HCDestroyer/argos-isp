import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures } from '~~/fixtures'

describe('lista de servicios · filtros del contrato', () => {
    beforeEach(() => {
        reiniciarFixtures()
        useNuxtApp().$tokenSesion.value = 'fixture-admin'
    })

    afterEach(() => {
        useNuxtApp().$tokenSesion.value = null
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
        const porUsuario = await filas({ q: primero?.user_ppp.slice(0, 6) })
        expect(porUsuario.some(s => s.id === primero?.id)).toBe(true)

        const porIp = await filas({ q: primero?.ipv4 ?? '' })
        expect(porIp.map(s => s.id)).toEqual([primero?.id])
    })

    it('una búsqueda vacía no manda q', async () => {
        const conVacio = await filas({ q: '' })
        const sinQ = await filas({})
        expect(conVacio.length).toBe(sinQ.length)
    })

    it('los filtros de estado usan los valores del contrato', () => {
        expect(ESTADOS_FILTRO.map(e => e.estado)).toEqual(['activo', 'limitado', 'suspendido', 'retirado'])
        expect(ESTADOS_FILTRO.find(e => e.estado === 'suspendido')?.etiqueta).toContain('Cortado')
        expect(esEstadoServicio('suspendido')).toBe(true)
        expect(esEstadoServicio('cortado')).toBe(false)
    })
})
