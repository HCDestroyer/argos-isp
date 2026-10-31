import { test } from '@japa/runner'
import { randomUUID } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'
import { estado, soloEmpresaPrincipal, unico, usuarioConRoles } from '#tests/ayudas'
import { servicioEn } from '#tests/contabilidad/ayudas_contabilidad'
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'
import { afirmarCuadre, bodegaEn, comprarInventario, productoEn } from '#tests/inventario/ayudas_inventario'
import {
    afirmarTransito,
    comprarSeries,
    firmaIris,
    pngFirma,
    tecnicoConBodega,
} from '#tests/inventario/ayudas_fase_d'

/**
 * Fase D, pedido 6 (`contratos/inventario.md` D.6): el técnico, su bodega e Iris. `GET /inventario/mi-bodega`,
 * la recepción de un traslado registrada por Iris en nombre del técnico (con su firma) y el comodato de una
 * orden de Iris que sale de la bodega del técnico.
 */

test.group('Inventario · el técnico y su bodega (fase D, Iris)', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('mi bodega: la propia; la de otro solo con alcance global; recepción en nombre del técnico desde Iris', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const cabecera = { 'X-Empresa-Id': String(e.B) }
        const central = await bodegaEn(e.B, e.ctx)
        const cable = await productoEn(e.B, e.ctx)
        const onu = await productoEn(e.B, e.ctx, {
            nombre: 'ONU',
            unidad: 'unidad',
            tipo: 'equipo',
            seguimiento: 'serie',
        })
        await comprarInventario(e.B, e.ctx, {
            producto_id: cable.id,
            bodega_id: central.id,
            cantidad: 100,
            total: '112.00',
        })
        const onus = await comprarSeries(e.B, e.ctx, { producto_id: onu.id, bodega_id: central.id, n: 2 })
        const tecnico = await tecnicoConBodega(e.B, e.ctx)
        const enviar = (lineas: unknown[]) =>
            client
                .post('/api/v1/inventario/traslados/enviar')
                .bearerToken(e.token)
                .headers(cabecera)
                .json({ bodega_origen_id: central.id, bodega_destino_id: tecnico.bodega.id, lineas })
        const primera = await estado(
            enviar([
                { producto_id: cable.id, cantidad: '20' },
                { producto_id: onu.id, unidad_ids: [onus[0]!.id] },
            ]),
            201,
        )

        // Iris (alcance global) recibe en nombre del técnico con su firma, idempotente por su clave
        const firma = firmaIris(pngFirma(320, 120))
        const clave = `iris:recepcion:${randomUUID()}`
        const recibidoEn = new Date().toISOString()
        const recibir = () =>
            client
                .post(`/api/v1/inventario/traslados/${primera.body().id}/recibir`)
                .bearerToken(e.token)
                .headers(cabecera)
                .header('Idempotency-Key', clave)
                .json({
                    recibido_por: { id_externo: String(tecnico.usuario.id) },
                    metodo_recepcion: 'firma_digital',
                    firma,
                    recibido_en: recibidoEn,
                })
        const recibida = await estado(recibir(), 200)
        assert.equal(recibida.body().recibido_por, tecnico.usuario.id)
        assert.equal(recibida.body().registrado_por, e.usuarioId)
        assert.equal(recibida.body().metodo_recepcion, 'firma_digital')
        const otraVez = await estado(recibir(), 200)
        assert.equal(otraVez.body().version, recibida.body().version, 'misma respuesta por la clave')
        assert.equal(otraVez.header('idempotent-replayed'), 'true')

        const pendiente = await estado(enviar([{ producto_id: cable.id, cantidad: '5' }]), 201)

        // el técnico ve su bodega
        const mia = await estado(
            client.get('/api/v1/inventario/mi-bodega').bearerToken(tecnico.token).headers(cabecera),
            200,
        )
        const m = mia.body()
        assert.equal(m.bodega.id, tecnico.bodega.id)
        assert.deepEqual(
            m.existencias.map((x: { producto_id: number; cantidad: string }) => [x.producto_id, x.cantidad]),
            [
                [cable.id, '20.000'],
                [onu.id, '1.000'],
            ],
        )
        assert.deepEqual(
            m.unidades.map((u: { id: number }) => u.id),
            [onus[0]!.id],
        )
        assert.deepEqual(
            m.traslados_pendientes.map((o: { id: number }) => o.id),
            [pendiente.body().id],
        )
        assert.isAbove(m.kardex.length, 0)
        assert.isAtMost(m.kardex.length, 50)
        assert.isAbove(m.kardex[0].id, m.kardex[m.kardex.length - 1].id, 'el más reciente primero')
        assert.equal(m.existencias[0].modalidad, 'consumible_gasto')
        // la de otro técnico: no
        await estado(
            client
                .get(`/api/v1/inventario/mi-bodega?id_externo=${e.usuarioId}`)
                .bearerToken(tecnico.token)
                .headers(cabecera),
            403,
        )
        // Iris (alcance global) por id_externo o correo
        const porCorreo = await estado(
            client
                .get(`/api/v1/inventario/mi-bodega?correo=${encodeURIComponent(tecnico.usuario.email)}`)
                .bearerToken(e.token)
                .headers(cabecera),
            200,
        )
        assert.equal(porCorreo.body().bodega.id, tecnico.bodega.id)
        const desconocido = await estado(
            client
                .get(`/api/v1/inventario/mi-bodega?correo=${unico('nadie')}@x.local`)
                .bearerToken(e.token)
                .headers(cabecera),
            422,
        )
        assert.equal(desconocido.body().errors[0].rule, 'tecnico_no_encontrado')
        // un usuario sin bodega
        const lector = await usuarioConRoles(['lectura'])
        const sinBodega = await estado(
            client.get('/api/v1/inventario/mi-bodega').bearerToken(lector.token).headers(cabecera),
            404,
        )
        assert.equal(sinBodega.body().type, 'urn:argosisp:problema:tecnico_sin_bodega')

        // técnicos para vincular desde Iris
        const tecnicos = await estado(
            client.get('/api/v1/inventario/tecnicos?limit=100').bearerToken(e.token).headers(cabecera),
            200,
        )
        const fila = tecnicos
            .body()
            .data.find((x: { id_externo: string }) => x.id_externo === String(tecnico.usuario.id))
        assert.deepEqual(fila, {
            id_externo: String(tecnico.usuario.id),
            correo: tecnico.usuario.email,
            nombre: tecnico.usuario.nombre,
            bodegas: [{ id: tecnico.bodega.id, empresa_id: e.B, activa: true }],
        })
        // el mismo técnico con bodega en otra empresa: sin empresa, la lista de bodegas
        const otra = await bodegaEn(e.C, e.ctx, { tipo: 'tecnico', usuario_id: tecnico.usuario.id })
        const varias = await estado(
            client.get(`/api/v1/inventario/mi-bodega?id_externo=${tecnico.usuario.id}`).bearerToken(e.token),
            200,
        )
        assert.sameMembers(
            varias.body().bodegas.map((b: { id: number }) => b.id),
            [tecnico.bodega.id, otra.id],
        )
        assert.notProperty(varias.body(), 'bodega')
        const enC = await estado(
            client
                .get(`/api/v1/inventario/mi-bodega?id_externo=${tecnico.usuario.id}&empresa_id=${e.C}`)
                .bearerToken(e.token),
            200,
        )
        assert.equal(enC.body().bodega.id, otra.id)
        // un consumo sin servicio ni empresa con bodegas en dos empresas
        const sinEmpresa = await estado(
            client
                .post('/api/v1/inventario/consumos')
                .bearerToken(e.token)
                .json({
                    tecnico: { id_externo: String(tecnico.usuario.id) },
                    lineas: [{ producto_id: cable.id, cantidad: '1' }],
                }),
            422,
        )
        assert.equal(sinEmpresa.body().type, 'urn:argosisp:problema:empresa_requerida')
        await afirmarTransito(assert, e.B)
        await afirmarCuadre(assert, e.B)
    })

    test('comodato de una orden de Iris: sale de la bodega del técnico de la orden', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const cabecera = { 'X-Empresa-Id': String(e.B) }
        const central = await bodegaEn(e.B, e.ctx)
        const onu = await productoEn(e.B, e.ctx, {
            nombre: 'ONU',
            unidad: 'unidad',
            tipo: 'equipo',
            seguimiento: 'serie',
        })
        const onus = await comprarSeries(e.B, e.ctx, { producto_id: onu.id, bodega_id: central.id, n: 2 })
        const tecnico = await tecnicoConBodega(e.B, e.ctx)
        await db
            .table('inventario.configuracion')
            .insert({ empresa_id: e.B, traslado_firma_obligatoria: false })
        const orden = await estado(
            client
                .post('/api/v1/inventario/traslados/enviar')
                .bearerToken(e.token)
                .headers(cabecera)
                .json({
                    bodega_origen_id: central.id,
                    bodega_destino_id: tecnico.bodega.id,
                    lineas: [{ producto_id: onu.id, unidad_ids: [onus[0]!.id] }],
                }),
            201,
        )
        await estado(
            client
                .post(`/api/v1/inventario/traslados/${orden.body().id}/recibir`)
                .bearerToken(tecnico.token)
                .headers(cabecera)
                .json({}),
            200,
        )
        const { servicioId } = await servicioEn(e.B)
        const ordenIris = randomUUID()
        const cuerpo = (serie: string) => ({
            serie,
            tecnico: { id_externo: String(tecnico.usuario.id) },
            origen_tipo: 'iris_orden',
            origen_id: ordenIris,
        })
        // la otra ONU sigue en la central: no es de la bodega del técnico
        const ajena = await estado(
            client
                .post(`/api/v1/servicios/${servicioId}/equipos`)
                .bearerToken(e.token)
                .headers(cabecera)
                .json(cuerpo(onus[1]!.serie)),
            409,
        )
        assert.equal(ajena.body().type, 'urn:argosisp:problema:unidad_en_otra_bodega')
        const asignada = await estado(
            client
                .post(`/api/v1/servicios/${servicioId}/equipos`)
                .bearerToken(e.token)
                .headers(cabecera)
                .json(cuerpo(onus[0]!.serie)),
            201,
        )
        assert.equal(asignada.body().estado, 'en_comodato')
        const mov = await db
            .from('inventario.movimientos')
            .where({ unidad_id: onus[0]!.id, tipo: 'asignacion_comodato' })
            .firstOrFail()
        assert.equal(Number(mov.bodega_id), tecnico.bodega.id)
        assert.equal(mov.origen_externo_id, ordenIris)

        // devolución de la orden de retiro a la bodega del técnico
        const devuelta = await estado(
            client
                .post(`/api/v1/servicios/${servicioId}/equipos/${onus[0]!.id}/devolver`)
                .bearerToken(e.token)
                .headers(cabecera)
                .json({
                    tecnico: { correo: tecnico.usuario.email },
                    condicion: 'usado',
                    origen_tipo: 'iris_orden',
                    origen_id: ordenIris,
                }),
            200,
        )
        assert.equal(devuelta.body().bodega_id, tecnico.bodega.id)
        await afirmarCuadre(assert, e.B)
    })
})
