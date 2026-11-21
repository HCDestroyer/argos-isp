import { test } from '@japa/runner'
import { randomUUID } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, soloEmpresaPrincipal, unico } from '#tests/ayudas'
import { servicioEn } from '#tests/contabilidad/ayudas_contabilidad'
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'
import { afirmarLibroCuadrado } from '#tests/ledger/ayudas_libro'
import { afirmarCuadre, bodegaEn, productoEn } from '#tests/inventario/ayudas_inventario'
import { comprarSeries, tecnicoConBodega } from '#tests/inventario/ayudas_fase_d'
import GenerarTokenIris from '#core/actions/generar_token_iris'
import { usuarioIris } from '#core/integraciones_iris'

/**
 * Equipos del cliente (contrato Iris 0.12.0 §3.10, A48): cambio de equipo en una sola transacción,
 * revisión y garantía, intentos de recuperación, declarar no recuperado con el cobro «Equipo no devuelto»,
 * la cola de cobros propuestos y la lectura de una unidad para Iris sin costos.
 */

async function tokenIris() {
    const { token } = await new GenerarTokenIris().execute({ nombre: unico('Iris') }, contextoPrueba())
    const id = (await usuarioIris())!
    await db.from('core.usuarios').where('id', id).update({ activo: true, alcance_global: true })
    await db.from('core.usuarios_empresas').where('usuario_id', id).delete()
    return token
}

test.group('Inventario · equipos del cliente (Iris 0.12.0, A48)', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('cambio, garantía, intentos, no recuperado, cola de cobros y lectura de Iris', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const cabecera = { 'X-Empresa-Id': String(e.B) }
        const iris = await tokenIris()
        const central = await bodegaEn(e.B, e.ctx)
        const onu = await productoEn(e.B, e.ctx, {
            nombre: 'ONU GPON',
            unidad: 'unidad',
            tipo: 'equipo',
            seguimiento: 'serie',
        })
        const [a, b, c] = await comprarSeries(e.B, e.ctx, {
            producto_id: onu.id,
            bodega_id: central.id,
            n: 3,
        })
        const tecnico = await tecnicoConBodega(e.B, e.ctx)
        const otroTecnico = await tecnicoConBodega(e.B, e.ctx)
        await estado(
            client
                .post('/api/v1/inventario/traslados')
                .bearerToken(e.token)
                .headers(cabecera)
                .json({
                    producto_id: onu.id,
                    bodega_origen_id: central.id,
                    bodega_destino_id: tecnico.bodega.id,
                    unidad_ids: [b!.id],
                }),
            201,
        )
        const { servicioId, clienteId } = await servicioEn(e.B)
        await estado(
            client
                .post(`/api/v1/servicios/${servicioId}/equipos`)
                .bearerToken(e.token)
                .headers(cabecera)
                .json({ unidad_id: a!.id }),
            201,
        )

        const orden = `orden-${randomUUID()}`
        const ahora = new Date().toISOString()
        const cuerpo = (extra: Record<string, unknown> = {}) => ({
            sale: { unidad_id: a!.id },
            entra: { serie: b!.serie.toLowerCase() },
            motivo: 'garantia',
            destino_sale: 'garantia',
            cobro_propuesto: { motivo: 'golpe', nota: 'Carcasa rota' },
            nota: null,
            tecnico: { id_externo: String(tecnico.usuario.id) },
            fecha: ahora,
            recibido_en_iris: ahora,
            origen_tipo: 'iris_orden',
            origen_id: orden,
            ...extra,
        })
        const cambiar = (
            datos: Record<string, unknown>,
            actor: string | null = 'usuario:u-t',
            clave = `iris:cambio:${orden}:${a!.id}`,
        ) => {
            const p = client
                .post(`/api/v1/servicios/${servicioId}/equipos/cambiar`)
                .bearerToken(iris)
                .headers(cabecera)
                .header('Idempotency-Key', clave)
            if (actor) p.header('X-Iris-Actor', actor)
            return p.json(datos)
        }

        // 1. errores antes de cambiar nada
        const sinActor = await estado(cambiar(cuerpo(), null, unico('k')), 400)
        assert.match(sinActor.body().type, /cabecera_iris_requerida$/)
        const ia = await estado(cambiar(cuerpo(), 'asistente_ia', unico('k')), 403)
        assert.match(ia.body().type, /actor_ia_no_permitido$/)
        const funciona = await estado(
            cambiar(cuerpo({ motivo: 'danado', destino_sale: 'funciona' }), 'usuario:u-t', unico('k')),
            422,
        )
        assert.equal(funciona.body().errors[0].field, 'destino_sale')
        const otraBodega = await estado(
            cambiar(cuerpo({ entra: { unidad_id: c!.id } }), 'usuario:u-t', unico('k')),
            409,
        )
        assert.match(otraBodega.body().type, /unidad_en_otra_bodega$/)
        const noEsDelServicio = await estado(
            cambiar(
                cuerpo({ sale: { unidad_id: c!.id }, entra: { unidad_id: b!.id } }),
                'usuario:u-t',
                unico('k'),
            ),
            409,
        )
        assert.match(noEsDelServicio.body().type, /unidad_no_es_del_servicio$/)
        const fuera = await estado(
            cambiar(
                cuerpo({ fecha: new Date(Date.now() - 80 * 3600 * 1000).toISOString() }),
                'usuario:u-t',
                unico('k'),
            ),
            422,
        )
        assert.equal(fuera.body().errors[0].rule, 'ventana')

        // 2. el cambio: A vuelve a la bodega del técnico en garantía, B queda en comodato
        const cambio = await estado(cambiar(cuerpo()), 200)
        assert.containSubset(cambio.body(), {
            sale: { unidad_id: a!.id, estado: 'garantia' },
            entra: { unidad_id: b!.id, estado: 'en_comodato' },
        })
        const repetido = await estado(cambiar(cuerpo()), 200)
        assert.equal(repetido.header('idempotent-replayed'), 'true')
        const filaA = await db.from('inventario.unidades').where('id', a!.id).firstOrFail()
        assert.equal(filaA.estado, 'en_reparacion')
        assert.equal(Number(filaA.bodega_id), tecnico.bodega.id)
        const evento = await db
            .from('audit.outbox')
            .where('evento', 'inventario.equipo_cambiado')
            .whereRaw(`(payload->>'cambio_id')::bigint = ?`, [cambio.body().cambio_id])
            .firstOrFail()
        assert.containSubset(evento.payload, {
            servicio_id: servicioId,
            cliente_id: clienteId,
            motivo: 'garantia',
            destino_sale: 'garantia',
            cobro_propuesto: true,
            origen_externo_id: orden,
        })
        assert.notProperty(evento.payload, 'nota')
        const estados = await db
            .from('audit.outbox')
            .where('evento', 'inventario.unidad_estado_cambiado')
            .whereRaw(`(payload->>'unidad_id')::bigint = ?`, [a!.id])
            .orderBy('id')
            .select('payload')
        assert.deepEqual(
            estados.map((f: { payload: { de: string; a: string } }) => [f.payload.de, f.payload.a]),
            [
                ['disponible', 'en_comodato'],
                ['en_comodato', 'garantia'],
            ],
        )

        // 3. Iris lee la unidad sin costos; el historial dice garantía
        const leida = await estado(
            client
                .get(`/api/v1/inventario/unidades/${a!.id}?servicio_id=${servicioId}`)
                .bearerToken(iris)
                .headers(cabecera)
                .header('X-Iris-Actor', 'usuario:u-t'),
            200,
        )
        assert.equal(leida.body().estado, 'garantia')
        assert.equal(leida.body().modelo, 'ONU GPON')
        assert.notProperty(leida.body(), 'costo')
        assert.deepEqual(leida.body().historial.at(-1), {
            ...leida.body().historial.at(-1),
            de: 'en_comodato',
            a: 'garantia',
            motivo: 'cambio_equipo',
            servicio_id: servicioId,
        })
        await estado(
            client.get(`/api/v1/inventario/unidades/${a!.id}`).bearerToken(iris).headers(cabecera),
            400,
        )

        // 4. el personal envía a garantía y el proveedor la reemplaza
        await estado(
            client
                .post(`/api/v1/inventario/unidades/${a!.id}/enviar-garantia`)
                .bearerToken(e.token)
                .headers(cabecera)
                .json({ proveedor_nombre: 'Proveedor ONU', rma: 'RMA-1', vence_en: '2026-12-31' }),
            200,
        )
        // reparada no vale con la garantía abierta
        await estado(
            client
                .post(`/api/v1/inventario/unidades/${a!.id}/marcar-reparada`)
                .bearerToken(e.token)
                .headers(cabecera)
                .json({ motivo: 'probada en banco' }),
            409,
        )
        const nuevaSerie = unico('REP').toUpperCase()
        const reemplazada = await estado(
            client
                .post(`/api/v1/inventario/unidades/${a!.id}/resolver-garantia`)
                .bearerToken(e.token)
                .headers(cabecera)
                .json({ resultado: 'reemplazada', serie: nuevaSerie }),
            200,
        )
        assert.containSubset(reemplazada.body(), {
            estado: 'disponible',
            condicion: 'nuevo',
            serie: nuevaSerie,
        })
        const detalle = await estado(
            client.get(`/api/v1/inventario/unidades/${a!.id}`).bearerToken(e.token).headers(cabecera),
            200,
        )
        assert.containSubset(detalle.body().garantias[0], {
            rma: 'RMA-1',
            resultado: 'reemplazada',
            serie_anterior: a!.serie,
        })
        assert.deepEqual(
            detalle
                .body()
                .historial_estados.slice(-2)
                .map((h: { de: string; a: string }) => [h.de, h.a]),
            [
                ['en_comodato', 'garantia'],
                ['garantia', 'disponible'],
            ],
        )

        // 5. la cola de cobros: el propuesto del cambio se aprueba con su monto (cargo único)
        const cola = await estado(
            client
                .get('/api/v1/inventario/cobros-equipo?estado=propuesto')
                .bearerToken(e.token)
                .headers(cabecera),
            200,
        )
        const propuesto = cola
            .body()
            .data.find((x: { id: number }) => x.id === cambio.body().cobro_propuesto_id)
        assert.containSubset(propuesto, {
            origen: 'cambio_equipo',
            motivo: 'golpe',
            monto: null,
            estado: 'propuesto',
        })
        const aprobado = await estado(
            client
                .post(`/api/v1/inventario/cobros-equipo/${propuesto.id}/aprobar`)
                .bearerToken(e.token)
                .headers(cabecera)
                .json({ version: propuesto.version, monto: '112.00' }),
            200,
        )
        assert.containSubset(aprobado.body(), { estado: 'aprobado', monto: '112.00' })
        const factura = await db
            .from('billing.facturas')
            .where('id', aprobado.body().factura_id)
            .firstOrFail()
        assert.equal(factura.total, '112.00')
        assert.equal(Number(factura.cliente_id), clienteId)
        await estado(
            client
                .post(`/api/v1/inventario/cobros-equipo/${propuesto.id}/rechazar`)
                .bearerToken(e.token)
                .headers(cabecera)
                .json({ version: aprobado.body().version, motivo: 'ya se cobró' }),
            409,
        )

        // 6. no se pudo recuperar B: intentos (uno por día), foto obligatoria si se negó
        const noRecuperado = (datos: Record<string, unknown>, actor = 'usuario:u-t') =>
            client
                .post(`/api/v1/servicios/${servicioId}/equipos/${b!.id}/no-recuperado`)
                .bearerToken(iris)
                .headers(cabecera)
                .header('X-Iris-Actor', actor)
                .header('Idempotency-Key', `iris:no_recuperado:${randomUUID()}:${b!.id}`)
                .json({
                    motivo: 'cliente_ausente',
                    ubicacion: { lat: 14.6349, lng: -90.5069, precision_m: 8 },
                    fecha: new Date().toISOString(),
                    recibido_en_iris: new Date().toISOString(),
                    origen_tipo: 'iris_orden',
                    origen_id: orden,
                    ...datos,
                })
        const sinFoto = await estado(noRecuperado({ motivo: 'se_nego' }), 422)
        assert.equal(sinFoto.body().errors[0].field, 'foto_ref')
        const intento = await estado(noRecuperado({}), 201)
        assert.containSubset(intento.body(), { intento_n: 1, estado: 'por_recuperar' })
        const otroDia = await estado(noRecuperado({}), 429)
        assert.match(otroDia.body().type, /demasiados_intentos$/)
        const aviso = await db
            .from('audit.outbox')
            .where('evento', 'inventario.recuperacion_intentada')
            .whereRaw(`(payload->>'intento_id')::bigint = ?`, [intento.body().id])
            .firstOrFail()
        assert.equal(aviso.payload.serie_enmascarada, `…${b!.serie.slice(-4)}`)

        // 7. declarar no recuperada: falta otro técnico
        const declarar = () =>
            client
                .post(`/api/v1/inventario/unidades/${b!.id}/declarar-no-recuperada`)
                .bearerToken(e.token)
                .headers(cabecera)
                .header('Idempotency-Key', unico('d'))
                .json({ motivo: 'el cliente no lo entrega', monto: '336.00' })
        const insuficiente = await estado(declarar(), 422)
        assert.match(insuficiente.body().type, /intentos_insuficientes$/)
        // un segundo técnico, ayer (dentro de la ventana de 72 h)
        const ayer = new Date(Date.now() - 26 * 3600 * 1000).toISOString()
        const segundo = await estado(
            noRecuperado(
                {
                    motivo: 'se_nego',
                    foto_ref: 'adj-123',
                    fecha: ayer,
                    tecnico: { id_externo: String(otroTecnico.usuario.id) },
                },
                'usuario:u-otro',
            ),
            201,
        )
        assert.equal(segundo.body().intento_n, 2)
        const declarada = await estado(declarar(), 200)
        assert.containSubset(declarada.body(), { estado: 'no_recuperada', estado_equipo: 'no_recuperada' })
        assert.isNotNull(declarada.body().factura_id)
        const baja = await db
            .from('ledger.activos_bajas as b')
            .join('ledger.activos as a', 'a.id', 'b.activo_id')
            .where('a.unidad_id', b!.id)
            .select('b.tipo')
            .firstOrFail()
        assert.equal(baja.tipo, 'retiro')

        // 8. Iris ya no declara pérdidas
        await estado(
            client
                .post(`/api/v1/servicios/${servicioId}/equipos/${b!.id}/perdida`)
                .bearerToken(iris)
                .headers(cabecera)
                .json({ motivo: 'perdido' }),
            403,
        )

        await afirmarCuadre(assert, e.B)
        await afirmarLibroCuadrado(assert)
    })
})
