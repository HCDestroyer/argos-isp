import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures } from '~~/fixtures'

describe('filtros de clientes · URL y parámetros de la API', () => {
    it('lee la URL e ignora lo que no entiende', () => {
        const filtros = leerFiltrosClientes({
            q: 'pérez',
            zona: '3',
            estado: 'suspendido',
            router: 'abc',
            plan: '-2',
            deuda: '1',
            promesa: 'no',
        })
        expect(filtros).toEqual({
            q: 'pérez',
            zonaId: 3,
            estado: 'suspendido',
            routerId: null,
            planId: null,
            conDeuda: true,
            conPromesa: false,
        })
        expect(leerFiltrosClientes({ estado: 'cortado' }).estado).toBeNull()
    })

    it('ida y vuelta por la URL sin perder filtros', () => {
        const filtros: EstadoFiltrosClientes = {
            q: ' ana ',
            zonaId: 2,
            estado: 'limitado',
            routerId: 1,
            planId: 4,
            conDeuda: true,
            conPromesa: true,
        }
        const query = queryFiltrosClientes(filtros)
        expect(query).toEqual({ q: 'ana', zona: '2', estado: 'limitado', router: '1', plan: '4', deuda: '1', promesa: '1' })
        expect(leerFiltrosClientes(query)).toEqual({ ...filtros, q: 'ana' })
        expect(queryFiltrosClientes({ ...FILTROS_CLIENTES_VACIOS })).toEqual({})
    })

    it('manda los nombres del contrato y no manda banderas apagadas', () => {
        expect(filtrosApiClientes({ ...FILTROS_CLIENTES_VACIOS, estado: 'suspendido', routerId: 1, planId: 2, conDeuda: true }))
            .toEqual({ estado_servicio: 'suspendido', router_id: 1, plan_id: 2, con_deuda_vencida: true })
        const apagadas = filtrosApiClientes({ ...FILTROS_CLIENTES_VACIOS })
        expect(apagadas).toEqual({})
        expect('con_deuda_vencida' in apagadas).toBe(false)
        expect('con_promesa_activa' in apagadas).toBe(false)
    })

    it('cuenta los filtros activos sin contar la búsqueda', () => {
        expect(contarFiltrosClientes({ ...FILTROS_CLIENTES_VACIOS, q: 'ana' })).toBe(0)
        expect(hayFiltrosClientes({ ...FILTROS_CLIENTES_VACIOS, q: 'ana' })).toBe(true)
        expect(contarFiltrosClientes({ ...FILTROS_CLIENTES_VACIOS, zonaId: 1, conDeuda: true, conPromesa: true })).toBe(3)
        expect(hayFiltrosClientes({ ...FILTROS_CLIENTES_VACIOS, q: '   ' })).toBe(false)
    })

    it('accesos rápidos: Todos, Cortados y Con deuda', () => {
        const base: EstadoFiltrosClientes = { ...FILTROS_CLIENTES_VACIOS, zonaId: 2 }
        expect(accesoRapidoClientes(base)).toBe('todos')

        const cortados = aplicarAccesoRapidoClientes(base, 'cortados')
        expect(cortados).toMatchObject({ estado: 'suspendido', conDeuda: false, zonaId: 2 })
        expect(accesoRapidoClientes(cortados)).toBe('cortados')

        const deuda = aplicarAccesoRapidoClientes(cortados, 'deuda')
        expect(deuda).toMatchObject({ estado: null, conDeuda: true, zonaId: 2 })
        expect(accesoRapidoClientes(deuda)).toBe('deuda')

        expect(accesoRapidoClientes({ ...base, estado: 'activo' })).toBeNull()
        expect(aplicarAccesoRapidoClientes(deuda, 'todos')).toMatchObject({ estado: null, conDeuda: false, zonaId: 2 })
    })
})

describe('filtros de clientes · contra los fixtures', () => {
    beforeEach(() => {
        reiniciarFixtures()
        useNuxtApp().$tokenSesion.value = 'fixture-admin'
    })

    afterEach(() => {
        useNuxtApp().$tokenSesion.value = null
    })

    async function ids(filtros: EstadoFiltrosClientes): Promise<number[]> {
        const resultado = await useClientes().listar({ ...filtrosApiClientes(filtros), limit: 200 })
        expect(resultado.ok).toBe(true)
        return resultado.ok ? resultado.data.data.map(c => c.id).sort((a, b) => a - b) : []
    }

    it('"Cortados" trae solo clientes con un servicio suspendido', async () => {
        const cortados = await ids({ ...FILTROS_CLIENTES_VACIOS, estado: 'suspendido' })
        expect(cortados).toEqual([2, 12, 22])
    })

    it('"Con deuda" trae clientes con avisos vencidos y combina con estado', async () => {
        const todos = await ids({ ...FILTROS_CLIENTES_VACIOS })
        const conDeuda = await ids({ ...FILTROS_CLIENTES_VACIOS, conDeuda: true })
        expect(conDeuda.length).toBeGreaterThan(0)
        expect(conDeuda.length).toBeLessThan(todos.length)
        const cortadosConDeuda = await ids({ ...FILTROS_CLIENTES_VACIOS, estado: 'suspendido', conDeuda: true })
        expect(cortadosConDeuda.every(id => conDeuda.includes(id))).toBe(true)
    })

    it('con promesa activa', async () => {
        expect(await ids({ ...FILTROS_CLIENTES_VACIOS, conPromesa: true })).toEqual([12])
    })

    it('servicios: zona y deuda vencida', async () => {
        const deZona = new Set(await ids({ ...FILTROS_CLIENTES_VACIOS, zonaId: 3 }))
        const conDeuda = new Set(await ids({ ...FILTROS_CLIENTES_VACIOS, conDeuda: true }))
        const resultado = await useServicios().listar({ zona_id: 3, con_deuda_vencida: true, limit: 200 })
        expect(resultado.ok).toBe(true)
        const servicios = resultado.ok ? resultado.data.data : []
        expect(servicios.length).toBeGreaterThan(0)
        expect(servicios.every(s => deZona.has(s.cliente_id) && conDeuda.has(s.cliente_id))).toBe(true)
    })
})
