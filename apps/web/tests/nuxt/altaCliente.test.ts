import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures } from '~~/fixtures'

describe('esquemaCliente (espejo de crearClienteValidator)', () => {
    it('convierte vacíos en null, NIT a mayúsculas y la zona a número', () => {
        const salida = esquemaCliente.parse({
            ...entradaDesdeCliente(),
            nombre: '  Rosa Pérez ',
            nit_cui: '7788990-k',
            zona: '3',
        })
        expect(salida).toMatchObject({ nombre: 'Rosa Pérez', nit_cui: '7788990-K', email: null, telefono: null })
        expect(cuerpoCliente(salida)).toMatchObject({ zona_id: 3 })
        expect(cuerpoCliente(salida)).not.toHaveProperty('zona')
    })

    it('sin zona manda zona_id null', () => {
        const salida = esquemaCliente.parse({ ...entradaDesdeCliente(), nombre: 'Ana' })
        expect(cuerpoCliente(salida).zona_id).toBeNull()
    })

    it.each([
        ['CF', true],
        ['1234567-8', true],
        ['12345678', true],
        ['2984561320101', true],
        ['123-45', false],
        ['ABC', false],
    ])('NIT/CUI %s válido: %s', (nit, valido) => {
        const resultado = esquemaCliente.safeParse({ ...entradaDesdeCliente(), nombre: 'Ana', nit_cui: nit })
        expect(resultado.success).toBe(valido)
    })

    it('rechaza nombre corto, correo y coordenadas inválidas con mensajes en español', () => {
        const resultado = esquemaCliente.safeParse({ ...entradaDesdeCliente(), nombre: 'A', email: 'no-es-correo', coordenadas: '14.6' })
        expect(resultado.success).toBe(false)
        const campos = resultado.error?.issues.map(issue => issue.path.join('.'))
        expect(campos).toEqual(expect.arrayContaining(['nombre', 'email', 'coordenadas']))
    })

    it('entradaDesdeCliente rellena el formulario de edición', async () => {
        reiniciarFixtures()
        useNuxtApp().$tokenSesion.value = 'fixture-admin'
        const resultado = await useClientes().ver(3)
        expect(resultado.ok).toBe(true)
        if (resultado.ok) {
            const entrada = entradaDesdeCliente(resultado.data)
            expect(entrada).toMatchObject({ nombre: 'Comercial El Progreso, S.A.', tipo: 'empresa', zona: '2', movil: '' })
        }
        useNuxtApp().$tokenSesion.value = null
    })
})

describe('useClientes · alta y edición', () => {
    beforeEach(() => {
        reiniciarFixtures()
        useNuxtApp().$tokenSesion.value = 'fixture-admin'
    })

    afterEach(() => {
        useNuxtApp().$tokenSesion.value = null
    })

    it('crear con la misma Idempotency-Key no duplica el cliente', async () => {
        const clave = nuevaClaveIdempotencia()
        const datos = { nombre: 'Cliente Idempotente', nit_cui: 'CF' }
        const primero = await useClientes().crear(datos, clave)
        const segundo = await useClientes().crear(datos, clave)
        expect(primero.ok && segundo.ok).toBe(true)
        if (primero.ok && segundo.ok) {
            expect(segundo.data.id).toBe(primero.data.id)
        }
        const busqueda = await useClientes().listar({ q: 'Idempotente' })
        expect(busqueda.ok && busqueda.data.data).toHaveLength(1)
    })

    it('un 422 trae errors[] que se pasan al formulario', async () => {
        const resultado = await useClientes().crear({ nombre: 'duplicado' }, nuevaClaveIdempotencia())
        expect(resultado.ok).toBe(false)
        if (!resultado.ok) {
            expect(resultado.problema.status).toBe(422)
            expect(erroresDeFormulario(resultado.problema)).toEqual([
                { name: 'nombre', message: expect.stringContaining('Ya existe') },
            ])
        }
    })

    it('editar sube la versión y una versión vieja responde 409', async () => {
        const editado = await useClientes().editar(5, { telefono: '55550000', version: 1 })
        expect(editado.ok && editado.data.version).toBe(2)
        expect(editado.ok && editado.data.telefono).toBe('55550000')

        const viejo = await useClientes().editar(5, { telefono: '55551111', version: 1 })
        expect(!viejo.ok && viejo.problema.status).toBe(409)
    })

    it('el alta queda en la línea de tiempo del cliente', async () => {
        const creado = await useClientes().crear({ nombre: 'Con Bitácora' }, nuevaClaveIdempotencia())
        expect(creado.ok).toBe(true)
        if (creado.ok) {
            const linea = await useBitacora().acciones({ cliente_id: creado.data.id, excluir_canal: 'portal' })
            expect(linea.ok && linea.data.data.map(accion => accion.accion)).toEqual(['clientes.crear'])
            expect(linea.ok && linea.data.data[0]?.actor_nombre).toBe('Ana Administradora')
        }
    })

    it('el cajero no puede crear clientes', async () => {
        useNuxtApp().$tokenSesion.value = 'fixture-cajero'
        const resultado = await useClientes().crear({ nombre: 'Sin permiso' }, nuevaClaveIdempotencia())
        expect(!resultado.ok && resultado.problema.status).toBe(403)
    })
})
