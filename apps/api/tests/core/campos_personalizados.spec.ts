import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import type { ApiClient } from '@japa/api-client'
import { contextoPrueba, estado, unico, usuarioConRoles } from '#tests/ayudas'
import CrearCliente from '#core/actions/crear_cliente'

/**
 * Catálogo de campos personalizados del cliente (pedido de A4, `a4.md`): CRUD con permisos,
 * `version`, auditoría, y validación de `campos_personalizados` en el alta y la edición del
 * cliente (tipo, opciones, requeridos; claves fuera del catálogo intactas).
 *
 * El catálogo es global: cada prueba lo vacía al terminar para no exigir sus campos a las altas
 * de otras suites.
 */

function clave() {
    return unico('campo').replace(/-/g, '_').toLowerCase()
}

async function campo(client: ApiClient, token: string, cuerpo: Record<string, unknown>) {
    const respuesta = await estado(
        client.post('/api/v1/campos-personalizados').bearerToken(token).json(cuerpo),
        201,
    )
    return respuesta.body() as { id: number; clave: string; version: number }
}

test.group('Campos personalizados · catálogo', (group) => {
    group.each.teardown(async () => {
        await db.from('core.campos_personalizados').delete()
    })

    test('admin crea, edita, desactiva y activa; queda en audit.acciones y audit.cambios', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const c = clave()
        const creado = await estado(
            client
                .post('/api/v1/campos-personalizados')
                .bearerToken(token)
                .json({
                    clave: c,
                    etiqueta: ' Plan de TV ',
                    tipo: 'opcion',
                    opciones: ['Básico', 'Premium'],
                }),
            201,
        )
        assert.containSubset(creado.body(), {
            clave: c,
            etiqueta: 'Plan de TV',
            tipo: 'opcion',
            opciones: ['Básico', 'Premium'],
            requerido: false,
            orden: 0,
            activo: true,
            version: 1,
        })
        const id = creado.body().id as number

        const editado = await estado(
            client
                .put(`/api/v1/campos-personalizados/${id}`)
                .bearerToken(token)
                .json({ version: 1, opciones: ['Básico', 'Premium', 'Deportes'], requerido: true, orden: 5 }),
            200,
        )
        assert.containSubset(editado.body(), { requerido: true, orden: 5, version: 2 })
        assert.deepEqual(editado.body().opciones, ['Básico', 'Premium', 'Deportes'])

        // la misma version otra vez → 409
        await estado(
            client
                .put(`/api/v1/campos-personalizados/${id}`)
                .bearerToken(token)
                .json({ version: 1, orden: 1 }),
            409,
        )

        const inactivo = await estado(
            client
                .post(`/api/v1/campos-personalizados/${id}/desactivar`)
                .bearerToken(token)
                .json({ version: 2 }),
            200,
        )
        assert.isFalse(inactivo.body().activo)
        const activos = await estado(
            client.get('/api/v1/campos-personalizados').bearerToken(token).qs({ activo: true }),
            200,
        )
        assert.notInclude(
            activos.body().map((f: { id: number }) => f.id),
            id,
        )
        const activo = await estado(
            client
                .post(`/api/v1/campos-personalizados/${id}/activar`)
                .bearerToken(token)
                .json({ version: 3 }),
            200,
        )
        assert.isTrue(activo.body().activo)

        const acciones = (await db
            .from('audit.acciones')
            .where('entidad_tipo', 'campo_personalizado')
            .where('entidad_id', id)
            .orderBy('id')
            .select('accion')) as Array<{ accion: string }>
        assert.deepEqual(
            acciones.map((a) => a.accion),
            [
                'campos_personalizados.crear',
                'campos_personalizados.editar',
                'campos_personalizados.editar',
                'campos_personalizados.desactivar',
                'campos_personalizados.activar',
            ],
        )
        const cambios = (await db
            .from('audit.cambios')
            .where('entidad_tipo', 'campo_personalizado')
            .where('entidad_id', id)
            .select('campo')) as Array<{ campo: string }>
        assert.includeMembers(
            cambios.map((f) => f.campo),
            ['clave', 'opciones', 'requerido', 'activo'],
        )
    })

    test('clave repetida → 409; opciones solo con opcion; clave y tipo no se editan', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const c = clave()
        const creado = await campo(client, token, { clave: c, etiqueta: 'Contrato', tipo: 'texto' })
        const repetido = await estado(
            client
                .post('/api/v1/campos-personalizados')
                .bearerToken(token)
                .json({ clave: c, etiqueta: 'Otra', tipo: 'numero' }),
            409,
        )
        assert.equal(repetido.body().type, 'urn:argosisp:problema:campo_duplicado')

        const sinOpciones = await estado(
            client
                .post('/api/v1/campos-personalizados')
                .bearerToken(token)
                .json({ clave: clave(), etiqueta: 'X', tipo: 'opcion' }),
            422,
        )
        assert.equal(sinOpciones.body().errors[0].field, 'opciones')
        await estado(
            client
                .post('/api/v1/campos-personalizados')
                .bearerToken(token)
                .json({ clave: clave(), etiqueta: 'X', tipo: 'texto', opciones: ['a'] }),
            422,
        )
        await estado(
            client
                .post('/api/v1/campos-personalizados')
                .bearerToken(token)
                .json({ clave: clave(), etiqueta: 'X', tipo: 'opcion', opciones: ['a', 'a'] }),
            422,
        )
        await estado(
            client
                .post('/api/v1/campos-personalizados')
                .bearerToken(token)
                .json({ clave: 'Con Espacio', etiqueta: 'X', tipo: 'texto' }),
            422,
        )

        // clave y tipo no se aceptan al editar: se ignoran
        const editado = await estado(
            client
                .put(`/api/v1/campos-personalizados/${creado.id}`)
                .bearerToken(token)
                .json({ version: 1, clave: 'otra', tipo: 'numero', etiqueta: 'Contrato firmado' }),
            200,
        )
        assert.containSubset(editado.body(), { clave: c, tipo: 'texto', etiqueta: 'Contrato firmado' })
    })

    test('permisos: soporte lee el catálogo pero no lo cambia', async ({ client, assert }) => {
        const soporte = await usuarioConRoles(['soporte'])
        const lectura = await usuarioConRoles(['lectura'])
        const { token } = await usuarioConRoles(['admin'])
        await campo(client, token, { clave: clave(), etiqueta: 'Referencia', tipo: 'texto' })
        const lista = await estado(
            client.get('/api/v1/campos-personalizados').bearerToken(soporte.token),
            200,
        )
        assert.isAtLeast(lista.body().length, 1)
        await estado(client.get('/api/v1/campos-personalizados').bearerToken(lectura.token), 200)
        await estado(
            client
                .post('/api/v1/campos-personalizados')
                .bearerToken(soporte.token)
                .json({ clave: clave(), etiqueta: 'X', tipo: 'texto' }),
            403,
        )
    })
})

test.group('Campos personalizados · validación del cliente', (group) => {
    group.each.teardown(async () => {
        await db.from('core.campos_personalizados').delete()
    })

    test('cada valor debe ser de su tipo; null = vacío; claves fuera del catálogo intactas', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const [texto, numero, fecha, booleano, opcion] = [clave(), clave(), clave(), clave(), clave()]
        await campo(client, token, { clave: texto, etiqueta: 'Referencia', tipo: 'texto' })
        await campo(client, token, { clave: numero, etiqueta: 'Postes', tipo: 'numero' })
        await campo(client, token, { clave: fecha, etiqueta: 'Contrato', tipo: 'fecha' })
        await campo(client, token, { clave: booleano, etiqueta: 'Factura física', tipo: 'booleano' })
        await campo(client, token, {
            clave: opcion,
            etiqueta: 'Antena',
            tipo: 'opcion',
            opciones: ['LiteBeam', 'PowerBeam'],
        })

        const malo = await estado(
            client
                .post('/api/v1/clientes')
                .bearerToken(token)
                .json({
                    nombre: 'Cliente con campos malos',
                    campos_personalizados: {
                        [texto]: 12,
                        [numero]: '3',
                        [fecha]: '2026-02-30',
                        [booleano]: 'si',
                        [opcion]: 'NanoBeam',
                    },
                }),
            422,
        )
        assert.sameMembers(
            malo.body().errors.map((e: { field: string }) => e.field),
            [texto, numero, fecha, booleano, opcion].map((c) => `campos_personalizados.${c}`),
        )

        const bueno = await estado(
            client
                .post('/api/v1/clientes')
                .bearerToken(token)
                .json({
                    nombre: 'Cliente con campos buenos',
                    campos_personalizados: {
                        [texto]: 'Frente a la iglesia',
                        [numero]: 3,
                        [fecha]: '2026-02-28',
                        [booleano]: true,
                        [opcion]: null,
                        mikrowisp_id: '77',
                    },
                }),
            201,
        )
        assert.deepEqual(bueno.body().campos_personalizados, {
            [texto]: 'Frente a la iglesia',
            [numero]: 3,
            [fecha]: '2026-02-28',
            [booleano]: true,
            [opcion]: null,
            mikrowisp_id: '77',
        })

        // editar reemplaza completo y vuelve a validar
        await estado(
            client
                .put(`/api/v1/clientes/${bueno.body().id}`)
                .bearerToken(token)
                .json({ version: 1, campos_personalizados: { [opcion]: 'Otra' } }),
            422,
        )
        const editado = await estado(
            client
                .put(`/api/v1/clientes/${bueno.body().id}`)
                .bearerToken(token)
                .json({ version: 1, campos_personalizados: { [opcion]: 'PowerBeam' } }),
            200,
        )
        assert.deepEqual(editado.body().campos_personalizados, { [opcion]: 'PowerBeam' })
    })

    test('requeridos: en el alta y al guardar los campos; no al importador ni a otras ediciones', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const c = clave()
        const creado = await campo(client, token, {
            clave: c,
            etiqueta: 'Contrato',
            tipo: 'texto',
            requerido: true,
        })

        const sinCampo = await estado(
            client.post('/api/v1/clientes').bearerToken(token).json({ nombre: 'Sin contrato' }),
            422,
        )
        assert.deepEqual(sinCampo.body().errors, [
            { field: `campos_personalizados.${c}`, message: 'Contrato es obligatorio', rule: 'required' },
        ])
        await estado(
            client
                .post('/api/v1/clientes')
                .bearerToken(token)
                .json({ nombre: 'Contrato vacío', campos_personalizados: { [c]: '  ' } }),
            422,
        )
        const conCampo = await estado(
            client
                .post('/api/v1/clientes')
                .bearerToken(token)
                .json({ nombre: 'Con contrato', campos_personalizados: { [c]: 'C-1' } }),
            201,
        )

        // el importador (actor sistema) carga datos históricos sin el campo
        const importado = await new CrearCliente().execute({ nombre: 'Importado' }, contextoPrueba())
        assert.deepEqual(importado.campos_personalizados, {})

        // editar otros datos de un cliente sin el campo no lo exige; mandar los campos sí
        await estado(
            client
                .put(`/api/v1/clientes/${importado.id}`)
                .bearerToken(token)
                .json({ version: 1, telefono: '55550000' }),
            200,
        )
        await estado(
            client
                .put(`/api/v1/clientes/${conCampo.body().id}`)
                .bearerToken(token)
                .json({ version: 1, campos_personalizados: {} }),
            422,
        )

        // desactivado deja de exigirse y de validarse
        await estado(
            client
                .post(`/api/v1/campos-personalizados/${creado.id}/desactivar`)
                .bearerToken(token)
                .json({ version: 1 }),
            200,
        )
        await estado(
            client
                .post('/api/v1/clientes')
                .bearerToken(token)
                .json({ nombre: 'Ya no se exige', campos_personalizados: { [c]: 99 } }),
            201,
        )
    })
})
