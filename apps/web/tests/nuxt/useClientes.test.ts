import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures } from '~~/fixtures'

function iniciarSesion(token: 'fixture-admin' | 'fixture-cajero') {
    useNuxtApp().$tokenSesion.value = token
}

describe('useClientes · lista y búsqueda', () => {
    beforeEach(() => {
        reiniciarFixtures()
        iniciarSesion('fixture-admin')
    })

    afterEach(() => {
        useNuxtApp().$tokenSesion.value = null
    })

    it('lista la primera página con cursor hacia la siguiente', async () => {
        const resultado = await useClientes().listar()
        expect(resultado.ok).toBe(true)
        if (resultado.ok) {
            expect(resultado.data.data).toHaveLength(LIMITE_CLIENTES)
            expect(resultado.data.nextCursor).not.toBeNull()
        }
    })

    it.each([
        ['nombre sin acentos', 'bendicion', 'Farmacia La Bendición'],
        ['NIT', '7788990-K', 'Pedro Antonio Xicará'],
        ['teléfono', '55014193', 'Ana Lucía Morales'],
        ['usuario PPP', 'ana.lucia4', 'Ana Lucía Morales'],
        ['IP', '100.64.20.15', 'Ana Lucía Morales'],
    ])('busca por %s', async (_campo, q, esperado) => {
        const resultado = await useClientes().listar({ q })
        expect(resultado.ok && resultado.data.data.map(cliente => cliente.nombre)).toEqual([esperado])
    })

    it('filtra por zona', async () => {
        const resultado = await useClientes().listar({ zona_id: 4 })
        expect(resultado.ok).toBe(true)
        if (resultado.ok) {
            expect(resultado.data.data.length).toBeGreaterThan(0)
            expect(resultado.data.data.every(cliente => cliente.zona_id === 4)).toBe(true)
        }
    })

    it('sin sesión devuelve un Problem 401', async () => {
        useNuxtApp().$tokenSesion.value = null
        const resultado = await useClientes().listar()
        expect(resultado.ok).toBe(false)
        if (!resultado.ok) {
            expect(resultado.problema.status).toBe(401)
        }
    })

    it('el cajero ve las zonas (zonas.ver en su rol desde el día 4, como el seed de A1)', async () => {
        expect((await useZonas().listar()).ok).toBe(true)
        iniciarSesion('fixture-cajero')
        expect((await useZonas().listar()).ok).toBe(true)
    })
})

describe('usePaginacionCursor', () => {
    beforeEach(() => {
        reiniciarFixtures()
        iniciarSesion('fixture-admin')
    })

    it('avanza y retrocede con la pila de cursores', async () => {
        const lista = usePaginacionCursor(cursor => useClientes().listar({}, cursor))
        await lista.recargar()
        const primera = lista.filas.value.map(cliente => cliente.id)
        expect(lista.pagina.value).toBe(1)
        expect(lista.hayAnterior.value).toBe(false)
        expect(lista.haySiguiente.value).toBe(true)

        await lista.siguiente()
        expect(lista.pagina.value).toBe(2)
        expect(lista.haySiguiente.value).toBe(false)
        expect(lista.filas.value.some(cliente => primera.includes(cliente.id))).toBe(false)

        await lista.anterior()
        expect(lista.pagina.value).toBe(1)
        expect(lista.filas.value.map(cliente => cliente.id)).toEqual(primera)
    })

    it('guarda el problema y vacía las filas si la API falla', async () => {
        useNuxtApp().$tokenSesion.value = null
        const lista = usePaginacionCursor(cursor => useClientes().listar({}, cursor))
        await lista.recargar()
        expect(lista.filas.value).toEqual([])
        expect(lista.problema.value?.status).toBe(401)
        expect(lista.haySiguiente.value).toBe(false)
    })

    it('ignora respuestas viejas cuando llega una búsqueda más reciente', async () => {
        let q = 'zzz-sin-resultados'
        const lista = usePaginacionCursor(cursor => useClientes().listar({ q }, cursor))
        const vieja = lista.recargar()
        q = 'bendicion'
        const nueva = lista.recargar()
        await Promise.all([vieja, nueva])
        expect(lista.filas.value.map(cliente => cliente.nombre)).toEqual(['Farmacia La Bendición'])
    })
})
