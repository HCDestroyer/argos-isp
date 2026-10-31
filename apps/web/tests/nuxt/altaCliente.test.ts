import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Schema } from '@argosisp/contracts'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import { bd } from '~~/fixtures/bd'

describe('esquemaCliente (espejo de crearClienteValidator)', () => {
    it('convierte vacíos en null, el NIT sin guion y en mayúsculas, y la zona a número', () => {
        const salida = esquemaCliente.parse({
            ...entradaDesdeCliente(),
            nombre: '  Rosa Pérez ',
            tipo_documento_fiscal: 'nit',
            nit_cui: '576937-k',
            zona: '3',
        })
        expect(salida).toMatchObject({ nombre: 'Rosa Pérez', tipo_documento_fiscal: 'nit', nit_cui: '576937K', pais_fiscal: 'GT', email: null, telefono: null })
        expect(cuerpoCliente(salida)).toMatchObject({ zona_id: 3 })
        expect(cuerpoCliente(salida)).not.toHaveProperty('zona')
    })

    it('sin zona manda zona_id null', () => {
        const salida = esquemaCliente.parse({ ...entradaDesdeCliente(), nombre: 'Ana' })
        expect(cuerpoCliente(salida).zona_id).toBeNull()
    })

    // Espejo de `validarDocumentoFiscal` (A1): NIT con módulo 11 (SAT 16693949, INFILE 12521337),
    // CUI con departamento 01-22 y municipio, pasaporte de 3 a 20, CF sin número.
    it.each([
        ['cf', '', true],
        ['cf', '1234567-9', false],
        ['nit', '1234567-9', true],
        ['nit', '1669394-9', true],
        ['nit', '12521337', true],
        ['nit', '576937K', true],
        ['nit', '1234567-8', false],
        ['nit', '', false],
        ['cui', '2984561320101', true],
        ['cui', '2984561322301', false],
        ['cui', '298456132010', false],
        ['pasaporte', 'A1234567', true],
        ['pasaporte', 'AB', false],
    ] as const)('%s %s válido: %s', (tipo, nit, valido) => {
        const resultado = esquemaCliente.safeParse({ ...entradaDesdeCliente(), nombre: 'Ana', tipo_documento_fiscal: tipo, nit_cui: nit })
        expect(resultado.success).toBe(valido)
    })

    it('NIT y CUI son de Guatemala: con otro país va pasaporte (error en pais_fiscal)', () => {
        const resultado = esquemaCliente.safeParse({ ...entradaDesdeCliente(), nombre: 'Ana', tipo_documento_fiscal: 'nit', nit_cui: '1234567-9', pais_fiscal: 'sv' })
        expect(resultado.success).toBe(false)
        expect(resultado.error?.issues.map(i => i.path.join('.'))).toEqual(['pais_fiscal'])
        expect(esquemaCliente.safeParse({ ...entradaDesdeCliente(), nombre: 'Ana', tipo_documento_fiscal: 'pasaporte', nit_cui: 'A1234567', pais_fiscal: 'SV' }).success).toBe(true)
    })

    it('consumidor final manda nit_cui null y un cliente viejo sin tipo lo deduce del número', () => {
        const cf = esquemaCliente.parse({ ...entradaDesdeCliente(), nombre: 'Ana' })
        expect(cf).toMatchObject({ tipo_documento_fiscal: 'cf', nit_cui: null })
        // La API ya siempre manda el tipo (obligatorio en el OpenAPI); el panel igual se defiende de uno viejo.
        const viejo = { ...bd.clientes[3]!, tipo_documento_fiscal: undefined } as unknown as Schema<'Cliente'>
        expect(entradaDesdeCliente(viejo)).toMatchObject({ tipo_documento_fiscal: 'cui', nit_cui: '2984561320101' })
    })

    it('la API rechaza un NIT con dígito verificador malo con el mismo mensaje (422 en nit_cui)', async () => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        const malo = await useClientes().crear({ nombre: 'Verificador Malo', tipo_documento_fiscal: 'nit', nit_cui: '1234567-8' }, nuevaClaveIdempotencia())
        expect(!malo.ok && erroresDeFormulario(malo.problema)).toEqual([{ name: 'nit_cui', message: 'El NIT no es válido (dígito verificador)' }])
        const bueno = await useClientes().crear({ nombre: 'Verificador Bueno', tipo_documento_fiscal: 'nit', nit_cui: '1234567-9' }, nuevaClaveIdempotencia())
        expect(bueno.ok && bueno.data).toMatchObject({ nit_cui: '12345679', tipo_documento_fiscal: 'nit', nit_cui_invalido: false })
        sesionFixture(null)
    })

    it('rechaza nombre corto, correo y coordenadas inválidas con mensajes en español', () => {
        const resultado = esquemaCliente.safeParse({ ...entradaDesdeCliente(), nombre: 'A', email: 'no-es-correo', coordenadas: '14.6' })
        expect(resultado.success).toBe(false)
        const campos = resultado.error?.issues.map(issue => issue.path.join('.'))
        expect(campos).toEqual(expect.arrayContaining(['nombre', 'email', 'coordenadas']))
    })

    it('entradaDesdeCliente rellena el formulario de edición', async () => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        const resultado = await useClientes().ver(3)
        expect(resultado.ok).toBe(true)
        if (resultado.ok) {
            const entrada = entradaDesdeCliente(resultado.data)
            expect(entrada).toMatchObject({ nombre: 'Comercial El Progreso, S.A.', tipo: 'empresa', zona: '2', movil: '' })
        }
        sesionFixture(null)
    })
})

describe('useClientes · alta y edición', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
    })

    afterEach(() => {
        sesionFixture(null)
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
        expect(editado.ok && editado.data.telefono).toBe('+502 5555-0000')

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
        sesionFixture('fixture-cajero')
        const resultado = await useClientes().crear({ nombre: 'Sin permiso' }, nuevaClaveIdempotencia())
        expect(!resultado.ok && resultado.problema.status).toBe(403)
    })
})
