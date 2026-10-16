import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import AsignarResponsablePago from '#core/actions/asignar_responsable_pago'
import { contextoPrueba, estado, unico, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila, crearServicioFila, crearZonaFila } from '#tests/core/fabricas'

/**
 * Responsable de pago (decisión del PM, día 4): `clientes.asignar_responsable_pago`,
 * `clientes.quitar_responsable_pago`, `GET /clientes/:id/dependientes` y el filtro del listado.
 */

async function cambios(clienteId: number, requestId: string) {
    const filas = await db
        .from('audit.cambios')
        .where({ entidad_tipo: 'cliente', entidad_id: clienteId, request_id: requestId })
        .select('campo', 'antes', 'despues')
    return filas as Array<{ campo: string; antes: unknown; despues: unknown }>
}

function asignar(
    client: any,
    token: string,
    id: number,
    cuerpo: Record<string, unknown>,
    requestId?: string,
) {
    const peticion = client.post(`/api/v1/clientes/${id}/responsable-pago`).bearerToken(token)
    if (requestId) peticion.header('X-Request-Id', requestId)
    return peticion.json(cuerpo)
}

test.group('Clientes · responsable de pago', () => {
    test('asignar deja diff, auditoría con motivo y la vista trae id y nombre; repetir no cambia', async ({
        client,
        assert,
    }) => {
        const { token, usuario } = await usuarioConRoles(['soporte'])
        const nombreMama = unico('Mamá')
        const mama = await crearClienteFila({ nombre: nombreMama })
        const hija = await crearClienteFila()

        const req1 = unico('req')
        const r = await estado(
            asignar(client, token, hija, { responsable_id: mama, motivo: 'Paga la hija' }, req1),
            200,
        )
        assert.equal(r.body().responsable_pago_id, mama)
        assert.equal(r.body().responsable_pago_nombre, nombreMama)
        assert.equal(r.body().version, 2)
        assert.deepEqual(await cambios(hija, req1), [
            { campo: 'responsable_pago_id', antes: null, despues: mama },
        ])
        const accion = await db.from('audit.acciones').where('request_id', req1).firstOrFail()
        assert.equal(accion.accion, 'clientes.asignar_responsable_pago')
        assert.equal(accion.entidad_id, hija)
        assert.equal(accion.actor_id, usuario.id)
        assert.equal(accion.entrada.motivo, 'Paga la hija')

        const ver = await estado(client.get(`/api/v1/clientes/${hija}`).bearerToken(token), 200)
        assert.equal(ver.body().responsable_pago_id, mama)
        assert.equal(ver.body().responsable_pago_nombre, nombreMama)
        const verMama = await estado(client.get(`/api/v1/clientes/${mama}`).bearerToken(token), 200)
        assert.isNull(verMama.body().responsable_pago_id)
        assert.isNull(verMama.body().responsable_pago_nombre)

        // mismo responsable: sin cambios ni versión nueva
        const req2 = unico('req')
        const igual = await estado(asignar(client, token, hija, { responsable_id: mama }, req2), 200)
        assert.equal(igual.body().version, 2)
        assert.lengthOf(await cambios(hija, req2), 0)

        // otro responsable reemplaza al anterior (como máximo uno)
        const papa = await crearClienteFila()
        const req3 = unico('req')
        await estado(asignar(client, token, hija, { responsable_id: papa }, req3), 200)
        assert.deepEqual(await cambios(hija, req3), [
            { campo: 'responsable_pago_id', antes: mama, despues: papa },
        ])
    })

    test('quitar deja diff; sin responsable es un no-op', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['cajero'])
        const mama = await crearClienteFila()
        const hijo = await crearClienteFila()
        await estado(asignar(client, token, hijo, { responsable_id: mama }), 200)

        const req = unico('req')
        const sin = await estado(
            client
                .post(`/api/v1/clientes/${hijo}/quitar-responsable-pago`)
                .bearerToken(token)
                .header('X-Request-Id', req)
                .json({ motivo: 'Ya paga él' }),
            200,
        )
        assert.isNull(sin.body().responsable_pago_id)
        assert.isNull(sin.body().responsable_pago_nombre)
        assert.deepEqual(await cambios(hijo, req), [
            { campo: 'responsable_pago_id', antes: mama, despues: null },
        ])
        const accion = await db.from('audit.acciones').where('request_id', req).firstOrFail()
        assert.equal(accion.accion, 'clientes.quitar_responsable_pago')

        const req2 = unico('req')
        const otra = await estado(
            client
                .post(`/api/v1/clientes/${hijo}/quitar-responsable-pago`)
                .bearerToken(token)
                .header('X-Request-Id', req2),
            200,
        )
        assert.equal(otra.body().version, sin.body().version)
        assert.lengthOf(await cambios(hijo, req2), 0)
    })

    test('422 si es él mismo, si el responsable no existe, ciclo o segundo nivel; 404 sin cliente', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const a = await crearClienteFila()
        const b = await crearClienteFila()
        const c = await crearClienteFila()

        const mismo = await estado(asignar(client, token, a, { responsable_id: a }), 422)
        assert.equal(mismo.body().errors[0].field, 'responsable_id')
        const noExiste = await estado(asignar(client, token, a, { responsable_id: 999999999 }), 422)
        assert.equal(noExiste.body().errors[0].field, 'responsable_id')
        await estado(asignar(client, token, 999999999, { responsable_id: a }), 404)
        await estado(
            client.post('/api/v1/clientes/999999999/quitar-responsable-pago').bearerToken(token),
            404,
        )

        // A paga por B
        await estado(asignar(client, token, b, { responsable_id: a }), 200)
        // ciclo: B paga por A
        const ciclo = await estado(asignar(client, token, a, { responsable_id: b }), 422)
        assert.equal(ciclo.body().errors[0].field, 'responsable_id')
        // segundo nivel: B (dependiente) paga por C
        await estado(asignar(client, token, c, { responsable_id: b }), 422)
        // segundo nivel: C paga por A (A ya es responsable de B)
        await estado(asignar(client, token, a, { responsable_id: c }), 422)
        // varios dependientes del mismo responsable sí
        await estado(asignar(client, token, c, { responsable_id: a }), 200)

        const filaA = await db.from('core.clientes').where('id', a).firstOrFail()
        assert.isNull(filaA.responsable_pago_id)
        // el error queda auditado
        const errores = await db
            .from('audit.acciones')
            .where({ accion: 'clientes.asignar_responsable_pago', entidad_id: a })
            .whereNot('resultado', 'ok')
            .count('* as n')
            .firstOrFail()
        assert.isAbove(Number(errores.n), 0)
    })

    test('la base de datos impide nivel 2 y autorreferencia aunque no pase por la acción', async ({
        assert,
    }) => {
        const a = await crearClienteFila()
        const b = await crearClienteFila()
        const c = await crearClienteFila()
        await assert.rejects(() => db.from('core.clientes').where('id', a).update({ responsable_pago_id: a }))
        await db.from('core.clientes').where('id', b).update({ responsable_pago_id: a })
        await assert.rejects(() => db.from('core.clientes').where('id', c).update({ responsable_pago_id: b }))
        await assert.rejects(() => db.from('core.clientes').where('id', a).update({ responsable_pago_id: c }))
        // sin cascada: el responsable con dependientes no se puede borrar
        await assert.rejects(() => db.from('core.clientes').where('id', a).delete())
    })

    test('dependientes: número de servicios y estado resumido; filtro del listado; la relación sobrevive al retiro', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['cajero'])
        const nombreMama = unico('Pagadora')
        const pagadora = await crearClienteFila({ nombre: nombreMama })
        const conVarios = await crearClienteFila({ nit_cui: '1234567' })
        const sinServicios = await crearClienteFila()
        const retirado = await crearClienteFila()
        const ajeno = await crearClienteFila()
        await crearServicioFila({ cliente_id: conVarios, estado: 'activo' })
        await crearServicioFila({ cliente_id: conVarios, estado: 'suspendido' })
        await crearServicioFila({ cliente_id: conVarios, estado: 'retirado' })
        await crearServicioFila({ cliente_id: retirado, estado: 'retirado' })
        // el responsable no tiene servicios: la relación se mantiene igual
        for (const id of [conVarios, sinServicios, retirado]) {
            await estado(asignar(client, token, id, { responsable_id: pagadora }), 200)
        }

        const r = await estado(
            client.get(`/api/v1/clientes/${pagadora}/dependientes`).bearerToken(token),
            200,
        )
        assert.deepEqual(r.body(), {
            data: [
                {
                    id: conVarios,
                    nombre: r.body().data[0].nombre,
                    nit_cui: '1234567',
                    servicios: 2,
                    estado_servicio: 'suspendido',
                },
                {
                    id: sinServicios,
                    nombre: r.body().data[1].nombre,
                    nit_cui: null,
                    servicios: 0,
                    estado_servicio: null,
                },
                {
                    id: retirado,
                    nombre: r.body().data[2].nombre,
                    nit_cui: null,
                    servicios: 0,
                    estado_servicio: 'retirado',
                },
            ],
            nextCursor: null,
        })

        // paginación por cursor
        const p1 = await estado(
            client.get(`/api/v1/clientes/${pagadora}/dependientes`).qs({ limit: 2 }).bearerToken(token),
            200,
        )
        assert.lengthOf(p1.body().data, 2)
        const p2 = await estado(
            client
                .get(`/api/v1/clientes/${pagadora}/dependientes`)
                .qs({ limit: 2, cursor: p1.body().nextCursor })
                .bearerToken(token),
            200,
        )
        assert.deepEqual(
            p2.body().data.map((d: { id: number }) => d.id),
            [retirado],
        )

        const vacio = await estado(
            client.get(`/api/v1/clientes/${ajeno}/dependientes`).bearerToken(token),
            200,
        )
        assert.deepEqual(vacio.body(), { data: [], nextCursor: null })
        await estado(client.get('/api/v1/clientes/999999999/dependientes').bearerToken(token), 404)

        // filtro del listado y q sigue igual
        const lista = await estado(
            client.get('/api/v1/clientes').qs({ responsable_pago_id: pagadora }).bearerToken(token),
            200,
        )
        assert.sameMembers(
            lista.body().data.map((c: { id: number }) => c.id),
            [conVarios, sinServicios, retirado],
        )
        assert.isTrue(
            lista
                .body()
                .data.every(
                    (c: { responsable_pago_nombre: string }) => c.responsable_pago_nombre === nombreMama,
                ),
        )
        const porNombre = await estado(
            client.get('/api/v1/clientes').qs({ q: nombreMama }).bearerToken(token),
            200,
        )
        assert.deepEqual(
            porNombre.body().data.map((c: { id: number }) => c.id),
            [pagadora],
        )
    })

    test('permisos: lectura y tecnico 403; alcance por zona en cliente y responsable', async ({ client }) => {
        const a = await crearClienteFila()
        const b = await crearClienteFila()
        for (const rol of ['lectura', 'tecnico', 'contabilidad']) {
            const { token } = await usuarioConRoles([rol])
            await estado(asignar(client, token, b, { responsable_id: a }), 403)
            await estado(client.post(`/api/v1/clientes/${b}/quitar-responsable-pago`).bearerToken(token), 403)
        }
        const lector = await usuarioConRoles(['lectura'])
        await estado(client.get(`/api/v1/clientes/${a}/dependientes`).bearerToken(lector.token), 200)

        const zonaA = await crearZonaFila()
        const zonaB = await crearZonaFila()
        const { token, usuario } = await usuarioConRoles([])
        const rol = await db.from('core.roles').where('nombre', 'cajero').firstOrFail()
        await db
            .table('core.usuarios_roles')
            .insert({ usuario_id: usuario.id, role_id: rol.id, alcance_tipo: 'zona', alcance_id: zonaA })
        const enA = await crearClienteFila({ zona_id: zonaA })
        const enA2 = await crearClienteFila({ zona_id: zonaA })
        const enB = await crearClienteFila({ zona_id: zonaB })
        await estado(asignar(client, token, enA, { responsable_id: enB }), 403)
        await estado(asignar(client, token, enB, { responsable_id: enA }), 403)
        await estado(asignar(client, token, enA, { responsable_id: enA2 }), 200)
        await estado(client.get(`/api/v1/clientes/${enB}/dependientes`).bearerToken(token), 403)
    })

    test('asignaciones concurrentes cruzadas no forman ciclo', async ({ assert }) => {
        const a = await crearClienteFila()
        const b = await crearClienteFila()
        const resultados = await Promise.allSettled([
            new AsignarResponsablePago().execute({ id: a, responsable_id: b }, contextoPrueba()),
            new AsignarResponsablePago().execute({ id: b, responsable_id: a }, contextoPrueba()),
        ])
        assert.equal(resultados.filter((r) => r.status === 'fulfilled').length, 1)
        const filas = await db.from('core.clientes').whereIn('id', [a, b]).select('responsable_pago_id')
        assert.equal(filas.filter((f) => f.responsable_pago_id !== null).length, 1)
    })
})
