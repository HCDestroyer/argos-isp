import { test } from '@japa/runner'
import { randomUUID } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, soloEmpresaPrincipal, unico, usuarioConRoles } from '#tests/ayudas'
import { servicioEn } from '#tests/contabilidad/ayudas_contabilidad'
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'
import {
    afirmarCuadre,
    bodegaEn,
    comprarInventario,
    productoEn,
    saldoInventario,
} from '#tests/inventario/ayudas_inventario'
import { firmaIris, pngFirma, tecnicoConBodega } from '#tests/inventario/ayudas_fase_d'
import GenerarTokenIris from '#core/actions/generar_token_iris'
import { usuarioIris } from '#core/integraciones_iris'
import RecibirWebhookIris from '#integraciones/iris/actions/recibir_webhook_iris'

/**
 * Bodega de cuadrilla (contrato Iris 0.11.0 §3.9, A47; decisiones del PM §10.6 a–m): la membresía llega
 * de Iris por `cuadrilla.*`, el consumo sale primero de la cuadrilla y luego de la personal, el actor
 * (`X-Iris-Actor`) debe ser el miembro, la bodega se valida antes del stock, la membresía se evalúa en la
 * hora del teléfono y solo el jefe recibe los traslados.
 */

async function tokenIris() {
    const { token } = await new GenerarTokenIris().execute({ nombre: unico('Iris') }, contextoPrueba())
    const id = (await usuarioIris())!
    await db.from('core.usuarios').where('id', id).update({ activo: true, alcance_global: true })
    await db.from('core.usuarios_empresas').where('usuario_id', id).delete()
    return token
}

async function webhookCuadrilla(evento: string, payload: Record<string, unknown>) {
    return new RecibirWebhookIris().execute(
        {
            webhook_id: randomUUID(),
            evento,
            ocurrido_en: new Date().toISOString(),
            payload,
            cuerpo: { evento, payload },
        },
        contextoPrueba(),
    )
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))

test.group('Inventario · bodega de cuadrilla (Iris 0.11.0, A47)', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('membresía de Iris, consumo por cuadrilla y personal, actor, membresía en el tiempo y jefe', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const cabecera = { 'X-Empresa-Id': String(e.B) }
        const iris = await tokenIris()
        const central = await bodegaEn(e.B, e.ctx)
        const cable = await productoEn(e.B, e.ctx)
        const conector = await productoEn(e.B, e.ctx, { nombre: 'Conector RJ45', unidad: 'unidad' })
        await comprarInventario(e.B, e.ctx, {
            producto_id: cable.id,
            bodega_id: central.id,
            cantidad: 100,
            total: '112.00',
        })
        await comprarInventario(e.B, e.ctx, {
            producto_id: conector.id,
            bodega_id: central.id,
            cantidad: 50,
            total: '56.00',
        })
        const jefe = await tecnicoConBodega(e.B, e.ctx)
        const miembro = await tecnicoConBodega(e.B, e.ctx)
        const ajeno = await tecnicoConBodega(e.B, e.ctx)
        const inactivo = await usuarioConRoles([])
        await db.from('core.usuarios').where('id', inactivo.usuario.id).update({ activo: false })
        const { servicioId } = await servicioEn(e.B)
        const cuadrillaId = `c-${randomUUID()}`

        // 1. cuadrilla.creada: el jefe y el miembro aceptados; sin I1 e inactivo rechazados
        const creada = await webhookCuadrilla('cuadrilla.creada', {
            cuadrilla_id: cuadrillaId,
            empresa_id: e.B,
            version: 1,
            nombre: 'Norte',
            miembros: [
                { usuario_id: 'u-jefe', id_externo: String(jefe.usuario.id) },
                { usuario_id: 'u-m', id_externo: String(miembro.usuario.id) },
                { usuario_id: 'u-sin', id_externo: null },
                { usuario_id: 'u-inactivo', id_externo: String(inactivo.usuario.id) },
            ],
            jefe_usuario_id: 'u-jefe',
        })
        assert.containSubset(creada, { estado: 'procesado', resultado: 'cuadrilla_aplicada' })
        const bodega = await db
            .from('inventario.bodegas')
            .where({ empresa_id: e.B, cuadrilla_id_iris: cuadrillaId })
            .firstOrFail()
        assert.equal(bodega.tipo, 'cuadrilla')
        assert.equal(Number(bodega.jefe_id), jefe.usuario.id)
        const miembros = await estado(
            client.get(`/api/v1/bodegas/${bodega.id}/miembros`).bearerToken(e.token).headers(cabecera),
            200,
        )
        assert.deepEqual(
            miembros
                .body()
                .miembros.map((m: { iris_usuario_id: string; aceptado: boolean; motivo: string | null }) => [
                    m.iris_usuario_id,
                    m.aceptado,
                    m.motivo,
                ]),
            [
                ['u-jefe', true, null],
                ['u-m', true, null],
                ['u-sin', false, 'sin_vinculo'],
                ['u-inactivo', false, 'usuario_inactivo'],
            ],
        )
        // la misma versión otra vez no se aplica
        const vieja = await webhookCuadrilla('cuadrilla.actualizada', {
            cuadrilla_id: cuadrillaId,
            empresa_id: e.B,
            version: 1,
            miembros: [],
            jefe_usuario_id: null,
        })
        assert.containSubset(vieja, { estado: 'ignorado', resultado: 'version_vieja' })

        // 2. traslado a la cuadrilla: solo el jefe lo recibe
        const enviado = await estado(
            client
                .post('/api/v1/inventario/traslados/enviar')
                .bearerToken(e.token)
                .headers(cabecera)
                .json({
                    bodega_origen_id: central.id,
                    bodega_destino_id: bodega.id,
                    lineas: [{ producto_id: cable.id, cantidad: '30' }],
                }),
            201,
        )
        const evento = await db
            .from('audit.outbox')
            .where('evento', 'inventario.traslado_enviado')
            .whereRaw(`(payload->>'traslado_id')::bigint = ?`, [enviado.body().id])
            .firstOrFail()
        assert.equal(evento.payload.cuadrilla_id, cuadrillaId)
        const recibir = (actor: string, idExterno: number) =>
            client
                .post(`/api/v1/inventario/traslados/${enviado.body().id}/recibir`)
                .bearerToken(iris)
                .headers(cabecera)
                .header('X-Iris-Actor', actor)
                .header('Idempotency-Key', `iris:recepcion:${randomUUID()}`)
                .json({
                    recibido_por: { id_externo: String(idExterno) },
                    metodo_recepcion: 'firma_digital',
                    firma: firmaIris(pngFirma(320, 120)),
                    recibido_en: new Date().toISOString(),
                })
        const noJefe = await estado(recibir('usuario:u-m', miembro.usuario.id), 403)
        assert.match(noJefe.body().type, /solo_jefe_recibe$/)
        const otroActor = await estado(recibir('usuario:u-m', jefe.usuario.id), 403)
        assert.match(otroActor.body().type, /solo_jefe_recibe$/)
        const recibida = await estado(recibir('usuario:u-jefe', jefe.usuario.id), 200)
        assert.equal(recibida.body().recibido_por, jefe.usuario.id)
        assert.deepEqual(await saldoInventario(cable.id, bodega.id), ['30.000', '30.00'])

        // la bodega personal del miembro tiene conectores (la cuadrilla no)
        await estado(
            client.post('/api/v1/inventario/traslados').bearerToken(e.token).headers(cabecera).json({
                producto_id: conector.id,
                bodega_origen_id: central.id,
                bodega_destino_id: miembro.bodega.id,
                cantidad: '10',
            }),
            201,
        )

        const consumir = (cuerpo: Record<string, unknown>, actor: string | null = 'usuario:u-m') => {
            const peticion = client
                .post('/api/v1/inventario/consumos')
                .bearerToken(iris)
                .headers(cabecera)
                .header('Idempotency-Key', `iris:consumo:${randomUUID()}`)
            if (actor) peticion.header('X-Iris-Actor', actor)
            return peticion.json({
                servicio_id: servicioId,
                origen_tipo: 'iris_orden',
                origen_id: `orden-${randomUUID()}`,
                ...cuerpo,
            })
        }
        const delMiembro = { tecnico: { id_externo: String(miembro.usuario.id) } }

        // 3. sin X-Iris-Actor sobre la cuadrilla: 400; con otro miembro: 403 actor_no_coincide
        const sinActor = await estado(
            consumir({ ...delMiembro, lineas: [{ producto_id: cable.id, cantidad: '5' }] }, null),
            400,
        )
        assert.match(sinActor.body().type, /cabecera_iris_requerida$/)
        const otro = await estado(
            consumir({ ...delMiembro, lineas: [{ producto_id: cable.id, cantidad: '5' }] }, 'usuario:u-jefe'),
            403,
        )
        assert.match(otro.body().type, /actor_no_coincide$/)
        // por correo sobre una cuadrilla: 422
        const porCorreo = await estado(
            consumir({
                tecnico: { correo: miembro.usuario.email },
                lineas: [{ producto_id: cable.id, cantidad: '5' }],
            }),
            422,
        )
        assert.equal(porCorreo.body().errors[0].field, 'tecnico.id_externo')

        // 4. alguien que no es miembro, con la bodega de la cuadrilla: 403 antes de mirar existencias
        for (const cantidad of ['1', '100000']) {
            const ajena = await estado(
                consumir(
                    {
                        tecnico: { id_externo: String(ajeno.usuario.id) },
                        bodega_id: bodega.id,
                        lineas: [{ producto_id: cable.id, cantidad }],
                    },
                    'usuario:u-ajeno',
                ),
                403,
            )
            assert.match(ajena.body().type, /no_es_miembro$/)
        }

        // 5. sin bodega_id: el cable sale de la cuadrilla y el conector de la personal; queda quién lo usó
        const consumo = await estado(
            consumir({
                ...delMiembro,
                lineas: [
                    { producto_id: cable.id, cantidad: '5' },
                    { producto_id: conector.id, cantidad: '2' },
                ],
            }),
            201,
        )
        const [mCable, mConector] = consumo.body().movimientos
        assert.equal(mCable.bodega_id, Number(bodega.id))
        assert.equal(mConector.bodega_id, miembro.bodega.id)
        assert.equal(mCable.actor_tecnico, 'usuario:u-m')
        assert.equal(mCable.actor_tecnico_id, miembro.usuario.id)
        assert.deepEqual(await saldoInventario(cable.id, Number(bodega.id)), ['25.000', '25.00'])

        // 6. sin existencia en ninguna: 409 con solo sus bodegas y lo pedido
        const sinExistencia = await estado(
            consumir({ ...delMiembro, lineas: [{ producto_id: cable.id, cantidad: '999' }] }),
            409,
        )
        assert.match(sinExistencia.body().type, /sin_existencia$/)
        assert.deepEqual(
            sinExistencia
                .body()
                .bodegas.map((b: { bodega_id: number; cuadrilla: boolean }) => [b.bodega_id, b.cuadrilla]),
            [
                [Number(bodega.id), true],
                [miembro.bodega.id, false],
            ],
        )
        assert.deepEqual(sinExistencia.body().bodegas[0].lineas, [
            { producto_id: cable.id, pedido: '999', existencia: '25' },
        ])

        // 7. mi-bodega: la cuadrilla primero, con su jefe, y la personal
        const mia = await estado(
            client
                .get(`/api/v1/inventario/mi-bodega?id_externo=${miembro.usuario.id}`)
                .bearerToken(iris)
                .headers(cabecera),
            200,
        )
        assert.deepEqual(
            mia
                .body()
                .bodegas.map((b: { bodega: { id: number }; cuadrilla: boolean }) => [
                    b.bodega.id,
                    b.cuadrilla,
                ]),
            [
                [Number(bodega.id), true],
                [miembro.bodega.id, false],
            ],
        )
        assert.deepEqual(mia.body().bodegas[0].jefe, {
            id_externo: String(jefe.usuario.id),
            nombre: jefe.usuario.nombre,
        })
        assert.equal(mia.body().bodega.id, miembro.bodega.id)

        // 8. membresía en el tiempo: se quita al miembro; lo de antes vale, lo de después no
        await espera(20)
        const antesDeQuitar = new Date()
        await espera(20)
        await webhookCuadrilla('cuadrilla.actualizada', {
            cuadrilla_id: cuadrillaId,
            empresa_id: e.B,
            version: 2,
            miembros: [{ usuario_id: 'u-jefe', id_externo: String(jefe.usuario.id) }],
            jefe_usuario_id: 'u-jefe',
        })
        const ahora = new Date()
        const antes = await estado(
            consumir({
                ...delMiembro,
                bodega_id: bodega.id,
                fecha: antesDeQuitar.toISOString(),
                recibido_en_iris: ahora.toISOString(),
                lineas: [{ producto_id: cable.id, cantidad: '1' }],
            }),
            201,
        )
        assert.equal(antes.body().ocurrido_en !== null, true)
        const despues = await estado(
            consumir({
                ...delMiembro,
                bodega_id: bodega.id,
                fecha: ahora.toISOString(),
                recibido_en_iris: ahora.toISOString(),
                lineas: [{ producto_id: cable.id, cantidad: '1' }],
            }),
            403,
        )
        assert.match(despues.body().type, /no_es_miembro$/)
        assert.equal(despues.body().errors[0].rule, 'fuera_de_membresia')
        // fuera de la ventana de 72 h: 422
        const fuera = await estado(
            consumir({
                ...delMiembro,
                fecha: new Date(ahora.getTime() - 73 * 3600 * 1000).toISOString(),
                recibido_en_iris: ahora.toISOString(),
                lineas: [{ producto_id: conector.id, cantidad: '1' }],
            }),
            422,
        )
        assert.equal(fuera.body().errors[0].rule, 'ventana')

        await afirmarCuadre(assert, e.B)
    })
})
