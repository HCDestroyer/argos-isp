import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, soloEmpresaPrincipal, unico, usuarioConRoles } from '#tests/ayudas'
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'
import {
    afirmarCuadre,
    bodegaEn,
    comprarInventario,
    contarMovimientos,
    productoEn,
    saldoInventario,
} from '#tests/inventario/ayudas_inventario'
import { afirmarTransito, comprarSeries, pngFirma, tecnicoConBodega } from '#tests/inventario/ayudas_fase_d'
import { sha256 } from '#inventario/archivos'

/**
 * Fase D, pedido 1 (`contratos/inventario.md` D.1): orden de traslado que recibe quien recibe. Estados,
 * bodega «en tránsito», recepción con firma digital, en papel o aceptación, faltantes que vuelven al
 * origen, cancelación, PDF, archivos, permisos y los checks D.8 en cada paso.
 */

async function preparar() {
    const e = await prepararEmpresasGt()
    const cabecera = { 'X-Empresa-Id': String(e.B) }
    const cable = await productoEn(e.B, e.ctx)
    const onu = await productoEn(e.B, e.ctx, {
        nombre: 'ONU GPON',
        unidad: 'unidad',
        tipo: 'equipo',
        seguimiento: 'serie',
    })
    const central = await bodegaEn(e.B, e.ctx)
    await comprarInventario(e.B, e.ctx, {
        producto_id: cable.id,
        bodega_id: central.id,
        cantidad: 100,
        total: '112.00',
    })
    const onus = await comprarSeries(e.B, e.ctx, { producto_id: onu.id, bodega_id: central.id, n: 3 })
    const tecnico = await tecnicoConBodega(e.B, e.ctx)
    return { e, cabecera, cable, onu, central, onus, tecnico }
}

async function enviar(
    client: any,
    token: string,
    cabecera: Record<string, string>,
    cuerpo: Record<string, unknown>,
    status = 201,
) {
    const respuesta = await estado(
        client
            .post('/api/v1/inventario/traslados/enviar')
            .bearerToken(token)
            .headers(cabecera)
            .header('Idempotency-Key', unico('orden'))
            .json(cuerpo),
        status,
    )
    return respuesta.body()
}

test.group('Inventario · órdenes de traslado (fase D)', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('enviar: sale del origen a tránsito sin asiento, correlativo por empresa, no disponible en ningún lado', async ({
        client,
        assert,
    }) => {
        const { e, cabecera, cable, onu, central, onus, tecnico } = await preparar()
        const antes = await contarMovimientos(e.B)
        const orden = await enviar(client, e.token, cabecera, {
            bodega_origen_id: central.id,
            bodega_destino_id: tecnico.bodega.id,
            motivo: 'Material para la semana',
            lineas: [
                { producto_id: cable.id, cantidad: '10' },
                { producto_id: onu.id, unidad_ids: [onus[0]!.id, onus[1]!.id] },
            ],
        })
        assert.equal(orden.estado, 'en_transito')
        assert.equal(orden.lineas.length, 2)
        assert.equal(orden.lineas[0].costo_total, '10.00')
        assert.equal(orden.lineas[1].costo_total, '600.00')
        assert.deepEqual(
            orden.lineas[1].unidades.map((u: { recibida: boolean | null }) => u.recibida),
            [null, null],
        )
        assert.equal(orden.usuario_destino_id, tecnico.usuario.id)
        const despues = await contarMovimientos(e.B)
        assert.equal(despues.asientos, antes.asientos, 'sin asiento')
        assert.equal(despues.kardex - antes.kardex, 2 + 4)
        // el origen ya no lo tiene, el destino aún no
        assert.deepEqual(await saldoInventario(cable.id, central.id), ['90.000', '90.00'])
        assert.deepEqual(await saldoInventario(cable.id, tecnico.bodega.id), ['0.000', '0.00'])
        const transito = await db
            .from('inventario.bodegas')
            .where({ empresa_id: e.B, tipo: 'transito' })
            .firstOrFail()
        assert.deepEqual(await saldoInventario(cable.id, transito.id), ['10.000', '10.00'])
        const unidad = await db.from('inventario.unidades').where('id', onus[0]!.id).firstOrFail()
        assert.equal(Number(unidad.bodega_id), Number(transito.id))
        assert.equal(unidad.estado, 'disponible', 'la unidad conserva su estado; la bodega dice que viaja')
        // nada se opera sobre lo que viaja
        const consumo = await estado(
            client
                .post('/api/v1/inventario/consumos')
                .bearerToken(e.token)
                .headers(cabecera)
                .json({ producto_id: cable.id, bodega_id: transito.id, cantidad: '1' }),
            422,
        )
        assert.equal(consumo.body().errors[0].rule, 'bodega_transito')
        const baja = await estado(
            client.post('/api/v1/inventario/bajas').bearerToken(e.token).headers(cabecera).json({
                producto_id: onu.id,
                bodega_id: central.id,
                unidad_id: onus[0]!.id,
                causa: 'danado',
                motivo: 'prueba',
            }),
            409,
        )
        assert.equal(baja.body().type, 'urn:argosisp:problema:unidad_en_transito')
        await estado(
            client
                .post(`/api/v1/bodegas/${transito.id}/desactivar`)
                .bearerToken(e.token)
                .headers(cabecera)
                .json({ version: 1 }),
            409,
        )
        // correlativo
        const otra = await enviar(client, e.token, cabecera, {
            bodega_origen_id: central.id,
            bodega_destino_id: tecnico.bodega.id,
            lineas: [{ producto_id: cable.id, cantidad: '5' }],
        })
        assert.equal(otra.numero, orden.numero + 1)
        // todo o nada: existencia insuficiente en una línea no deja nada
        const sinNada = await contarMovimientos(e.B)
        const falla = await enviar(
            client,
            e.token,
            cabecera,
            {
                bodega_origen_id: central.id,
                bodega_destino_id: tecnico.bodega.id,
                lineas: [
                    { producto_id: onu.id, unidad_ids: [onus[2]!.id] },
                    { producto_id: cable.id, cantidad: '1000' },
                ],
            },
            409,
        )
        assert.equal(falla.type, 'urn:argosisp:problema:existencia_insuficiente')
        assert.deepEqual(await contarMovimientos(e.B), sinNada)
        // producto repetido
        await enviar(
            client,
            e.token,
            cabecera,
            {
                bodega_origen_id: central.id,
                bodega_destino_id: tecnico.bodega.id,
                lineas: [
                    { producto_id: cable.id, cantidad: '1' },
                    { producto_id: cable.id, cantidad: '1' },
                ],
            },
            422,
        )
        const evento = await db
            .from('audit.outbox')
            .where('evento', 'inventario.traslado_enviado')
            .whereRaw(`payload->>'orden_id' = ?`, [String(orden.id)])
            .firstOrFail()
        assert.equal(evento.payload.usuario_destino_id, tecnico.usuario.id)
        assert.lengthOf(evento.payload.lineas, 2)
        await afirmarTransito(assert, e.B)
        await afirmarCuadre(assert, e.B)
    })

    test('recibir con firma digital y faltantes: lo recibido al destino, lo faltante al origen al costo de la línea', async ({
        client,
        assert,
    }) => {
        const { e, cabecera, cable, onu, central, onus, tecnico } = await preparar()
        // compra a otro precio para que el promedio no sea redondo: 100 a 1.00 + 3 a 2.00 → 106 / 103
        await comprarInventario(e.B, e.ctx, {
            producto_id: cable.id,
            bodega_id: central.id,
            cantidad: 3,
            total: '6.72',
        })
        const orden = await enviar(client, e.token, cabecera, {
            bodega_origen_id: central.id,
            bodega_destino_id: tecnico.bodega.id,
            lineas: [
                { producto_id: cable.id, cantidad: '10' },
                { producto_id: onu.id, unidad_ids: onus.map((u) => u.id) },
            ],
        })
        const costoLinea = orden.lineas[0].costo_total
        assert.equal(costoLinea, '10.29')
        await afirmarTransito(assert, e.B)

        // otro técnico no la recibe
        const otro = await tecnicoConBodega(e.B, e.ctx)
        await estado(
            client
                .post(`/api/v1/inventario/traslados/${orden.id}/recibir`)
                .bearerToken(otro.token)
                .headers(cabecera)
                .json({ firma: pngFirma().toString('base64') }),
            403,
        )
        // por defecto la empresa exige firma: aceptar sin firma no se puede
        const sinFirma = await estado(
            client
                .post(`/api/v1/inventario/traslados/${orden.id}/recibir`)
                .bearerToken(tecnico.token)
                .headers(cabecera)
                .json({}),
            422,
        )
        assert.equal(sinFirma.body().errors[0].field, 'firma')
        // firma inválida: no es PNG, o mide muy poco
        await estado(
            client
                .post(`/api/v1/inventario/traslados/${orden.id}/recibir`)
                .bearerToken(tecnico.token)
                .headers(cabecera)
                .json({ firma: Buffer.from('no soy un png').toString('base64') }),
            422,
        )
        const chica = await estado(
            client
                .post(`/api/v1/inventario/traslados/${orden.id}/recibir`)
                .bearerToken(tecnico.token)
                .headers(cabecera)
                .json({ firma: pngFirma(20, 10).toString('base64') }),
            422,
        )
        assert.equal(chica.body().errors[0].rule, 'dimensiones')

        const firma = pngFirma()
        const recibida = await estado(
            client
                .post(`/api/v1/inventario/traslados/${orden.id}/recibir`)
                .bearerToken(tecnico.token)
                .headers(cabecera)
                .header('Idempotency-Key', unico('rec'))
                .json({
                    firma: `data:image/png;base64,${firma.toString('base64')}`,
                    observaciones: 'Faltaron 3 metros y una ONU',
                    lineas: [
                        { linea_id: orden.lineas[0].id, cantidad_recibida: '7' },
                        { linea_id: orden.lineas[1].id, unidad_ids_faltantes: [onus[2]!.id] },
                    ],
                }),
            200,
        )
        const r = recibida.body()
        assert.equal(r.estado, 'recibida_con_diferencias')
        assert.equal(r.metodo_recepcion, 'firma_digital')
        assert.equal(r.recibido_por, tecnico.usuario.id)
        assert.equal(r.registrado_por, tecnico.usuario.id)
        assert.equal(r.firma_sha256, sha256(firma))
        assert.equal(r.lineas[0].cantidad_recibida, '7.000')
        assert.equal(r.lineas[0].costo_recibido, '7.20')
        assert.equal(r.lineas[0].faltante, '3.000')
        assert.deepEqual(
            r.lineas[1].unidades.map((u: { recibida: boolean }) => u.recibida),
            [true, true, false],
        )
        // destino: 7 del cable a 7.20 y dos ONU; origen: recupera 3 del cable a 3.09 y la ONU que faltó
        assert.deepEqual(await saldoInventario(cable.id, tecnico.bodega.id), ['7.000', '7.20'])
        assert.deepEqual(await saldoInventario(onu.id, tecnico.bodega.id), ['2.000', '600.00'])
        assert.deepEqual(await saldoInventario(onu.id, central.id), ['1.000', '300.00'])
        assert.deepEqual(await saldoInventario(cable.id, central.id), ['96.000', '98.80'])
        // otra vez: ya no está en tránsito
        const otraVez = await estado(
            client
                .post(`/api/v1/inventario/traslados/${orden.id}/recibir`)
                .bearerToken(tecnico.token)
                .headers(cabecera)
                .json({ firma: firma.toString('base64') }),
            409,
        )
        assert.equal(otraVez.body().type, 'urn:argosisp:problema:orden_no_en_transito')

        // auditoría: la huella de la firma, nunca el binario
        const auditoria = await db
            .from('audit.acciones')
            .where({ accion: 'inventario.recibir_traslado', resultado: 'ok', entidad_id: orden.id })
            .firstOrFail()
        const entrada = JSON.stringify(auditoria.entrada)
        assert.notInclude(entrada, firma.toString('base64').slice(0, 40))
        assert.equal(auditoria.entrada.firma.sha256, sha256(firma))
        assert.equal(auditoria.entrada.auditoria.metodo_recepcion, 'firma_digital')
        assert.equal(auditoria.entrada.firma_ip !== undefined, true)
        // evento
        const evento = await db
            .from('audit.outbox')
            .where('evento', 'inventario.traslado_recibido')
            .whereRaw(`payload->>'orden_id' = ?`, [String(orden.id)])
            .firstOrFail()
        assert.equal(evento.payload.estado, 'recibida_con_diferencias')
        assert.lengthOf(evento.payload.faltantes, 2)

        // la firma y el PDF
        const png = await estado(
            client
                .get(`/api/v1/inventario/traslados/${orden.id}/firma`)
                .bearerToken(tecnico.token)
                .headers(cabecera),
            200,
        )
        assert.equal(png.header('etag'), `"${sha256(firma)}"`)
        const pdf = await estado(
            client.get(`/api/v1/inventario/traslados/${orden.id}/pdf`).bearerToken(e.token).headers(cabecera),
            200,
        )
        assert.equal(pdf.header('content-type'), 'application/pdf')
        assert.isAbove(Number(pdf.header('content-length') ?? 0), 1000)
        // el PDF mismo: con la firma digital en «Recibe» y el estado
        const { trasladoPdf, estadoLegible } = await import('#inventario/traslado_pdf')
        const { verOrdenTraslado } = await import('#inventario/ordenes_traslado')
        const detalle = await verOrdenTraslado(orden.id)
        assert.match(estadoLegible(detalle), /^Recibida por .* \(firma digital\), con diferencias$/)
        const binario = await trasladoPdf({ orden: detalle, empresa: { nombre: 'ISP', nit: null }, firma })
        assert.equal(binario.subarray(0, 5).toString('latin1'), '%PDF-')

        // lista de diferencias por investigar
        const lista = await estado(
            client
                .get('/api/v1/inventario/traslados?estado=recibida_con_diferencias')
                .bearerToken(e.token)
                .headers(cabecera),
            200,
        )
        assert.include(
            lista.body().data.map((o: { id: number }) => o.id),
            orden.id,
        )
        await afirmarTransito(assert, e.B)
        await afirmarCuadre(assert, e.B)
    })

    test('firma en papel: la registra un encargado en nombre del técnico; el escaneo se adjunta una vez', async ({
        client,
        assert,
    }) => {
        const { e, cabecera, cable, central, tecnico } = await preparar()
        const orden = await enviar(client, e.token, cabecera, {
            bodega_origen_id: central.id,
            bodega_destino_id: tecnico.bodega.id,
            lineas: [{ producto_id: cable.id, cantidad: '20' }],
        })
        // el PDF en tránsito, con los espacios en blanco
        await estado(
            client
                .get(`/api/v1/inventario/traslados/${orden.id}/pdf`)
                .bearerToken(tecnico.token)
                .headers(cabecera),
            200,
        )
        // el propio técnico no registra papel (lo hace un encargado)
        await estado(
            client
                .post(`/api/v1/inventario/traslados/${orden.id}/recibir`)
                .bearerToken(tecnico.token)
                .headers(cabecera)
                .json({ metodo_recepcion: 'firma_papel' }),
            403,
        )
        // recibido_por que no es el técnico de la bodega
        await estado(
            client
                .post(`/api/v1/inventario/traslados/${orden.id}/recibir`)
                .bearerToken(e.token)
                .headers(cabecera)
                .json({ metodo_recepcion: 'firma_papel', recibido_por: { id_externo: String(e.usuarioId) } }),
            422,
        )
        const papel = await estado(
            client
                .post(`/api/v1/inventario/traslados/${orden.id}/recibir`)
                .bearerToken(e.token)
                .headers(cabecera)
                .json({
                    metodo_recepcion: 'firma_papel',
                    recibido_por: { correo: tecnico.usuario.email.toUpperCase() },
                }),
            200,
        )
        assert.equal(papel.body().estado, 'recibida')
        assert.equal(papel.body().metodo_recepcion, 'firma_papel')
        assert.equal(papel.body().recibido_por, tecnico.usuario.id)
        assert.equal(papel.body().registrado_por, e.usuarioId)
        assert.isNull(papel.body().firma_sha256)
        assert.deepEqual(await saldoInventario(cable.id, tecnico.bodega.id), ['20.000', '20.00'])

        const escaneo = pngFirma(800, 1000)
        const documento = await estado(
            client
                .post(`/api/v1/inventario/traslados/${orden.id}/documento`)
                .bearerToken(e.token)
                .headers(cabecera)
                .file('archivo', escaneo, { filename: 'orden.png' }),
            200,
        )
        assert.equal(documento.body().documento_sha256, sha256(escaneo))
        const otraVez = await estado(
            client
                .post(`/api/v1/inventario/traslados/${orden.id}/documento`)
                .bearerToken(e.token)
                .headers(cabecera)
                .file('archivo', escaneo, { filename: 'orden.png' }),
            409,
        )
        assert.equal(otraVez.body().type, 'urn:argosisp:problema:documento_registrado')
        const bajado = await estado(
            client
                .get(`/api/v1/inventario/traslados/${orden.id}/documento`)
                .bearerToken(e.token)
                .headers(cabecera),
            200,
        )
        assert.equal(bajado.header('etag'), `"${sha256(escaneo)}"`)
        await afirmarTransito(assert, e.B)
        await afirmarCuadre(assert, e.B)
    })

    test('aceptación sin firma solo si la empresa no la exige; firma como archivo en multipart', async ({
        client,
        assert,
    }) => {
        const { e, cabecera, cable, central, tecnico } = await preparar()
        const cuerpo = {
            bodega_origen_id: central.id,
            bodega_destino_id: tecnico.bodega.id,
            lineas: [{ producto_id: cable.id, cantidad: '4' }],
        }
        const primera = await enviar(client, e.token, cabecera, cuerpo)
        // multipart: firma como archivo y lineas como texto JSON
        const firma = pngFirma(200, 80)
        const multipart = await estado(
            client
                .post(`/api/v1/inventario/traslados/${primera.id}/recibir`)
                .bearerToken(tecnico.token)
                .headers(cabecera)
                .field('lineas', JSON.stringify([{ linea_id: primera.lineas[0].id, cantidad_recibida: '4' }]))
                .file('firma', firma, { filename: 'firma.png' }),
            200,
        )
        assert.equal(multipart.body().metodo_recepcion, 'firma_digital')
        assert.equal(multipart.body().firma_sha256, sha256(firma))

        // la configuración: el técnico no la cambia; el admin sí
        const config = await estado(
            client.get('/api/v1/inventario/configuracion').bearerToken(e.token).headers(cabecera),
            200,
        )
        assert.deepEqual(config.body(), { empresa_id: e.B, traslado_firma_obligatoria: true, version: 0 })
        await estado(
            client
                .post('/api/v1/inventario/configuracion')
                .bearerToken(tecnico.token)
                .headers(cabecera)
                .json({ traslado_firma_obligatoria: false, version: 0 }),
            403,
        )
        const cambiada = await estado(
            client
                .post('/api/v1/inventario/configuracion')
                .bearerToken(e.token)
                .headers(cabecera)
                .json({ traslado_firma_obligatoria: false, version: 0 }),
            200,
        )
        assert.deepEqual(cambiada.body(), { empresa_id: e.B, traslado_firma_obligatoria: false, version: 1 })
        await estado(
            client
                .post('/api/v1/inventario/configuracion')
                .bearerToken(e.token)
                .headers(cabecera)
                .json({ traslado_firma_obligatoria: true, version: 0 }),
            409,
        )
        const segunda = await enviar(client, e.token, cabecera, cuerpo)
        const aceptada = await estado(
            client
                .post(`/api/v1/inventario/traslados/${segunda.id}/recibir`)
                .bearerToken(tecnico.token)
                .headers(cabecera)
                .json({ observaciones: 'Todo bien' }),
            200,
        )
        assert.equal(aceptada.body().metodo_recepcion, 'aceptacion_sistema')
        assert.equal(aceptada.body().recibido_por, tecnico.usuario.id)
        assert.deepEqual(await saldoInventario(cable.id, tecnico.bodega.id), ['8.000', '8.00'])
        await afirmarTransito(assert, e.B)
        await afirmarCuadre(assert, e.B)
    })

    test('cancelar: solo en tránsito y con motivo; todo vuelve al origen al mismo costo', async ({
        client,
        assert,
    }) => {
        const { e, cabecera, cable, onu, central, onus, tecnico } = await preparar()
        const orden = await enviar(client, e.token, cabecera, {
            bodega_origen_id: central.id,
            bodega_destino_id: tecnico.bodega.id,
            lineas: [
                { producto_id: cable.id, cantidad: '30' },
                { producto_id: onu.id, unidad_ids: [onus[0]!.id] },
            ],
        })
        // el técnico destino (con zona) no opera el origen de otro? el origen es una bodega sin zona: puede
        const lector = await usuarioConRoles(['lectura'])
        await estado(
            client
                .post(`/api/v1/inventario/traslados/${orden.id}/cancelar`)
                .bearerToken(lector.token)
                .headers(cabecera)
                .json({ motivo: 'Ya no se necesita' }),
            403,
        )
        await estado(
            client
                .post(`/api/v1/inventario/traslados/${orden.id}/cancelar`)
                .bearerToken(e.token)
                .headers(cabecera)
                .json({ motivo: 'x' }),
            422,
        )
        const cancelada = await estado(
            client
                .post(`/api/v1/inventario/traslados/${orden.id}/cancelar`)
                .bearerToken(e.token)
                .headers(cabecera)
                .json({ motivo: 'Ya no se necesita' }),
            200,
        )
        assert.equal(cancelada.body().estado, 'cancelada')
        assert.deepEqual(await saldoInventario(cable.id, central.id), ['100.000', '100.00'])
        assert.deepEqual(await saldoInventario(onu.id, central.id), ['3.000', '900.00'])
        const unidad = await db.from('inventario.unidades').where('id', onus[0]!.id).firstOrFail()
        assert.equal(Number(unidad.bodega_id), central.id)
        await estado(
            client
                .post(`/api/v1/inventario/traslados/${orden.id}/recibir`)
                .bearerToken(tecnico.token)
                .headers(cabecera)
                .json({ firma: pngFirma().toString('base64') }),
            409,
        )
        await estado(
            client
                .post(`/api/v1/inventario/traslados/${orden.id}/cancelar`)
                .bearerToken(e.token)
                .headers(cabecera)
                .json({ motivo: 'Otra vez' }),
            409,
        )
        const evento = await db
            .from('audit.outbox')
            .where('evento', 'inventario.traslado_cancelado')
            .whereRaw(`payload->>'orden_id' = ?`, [String(orden.id)])
            .firstOrFail()
        assert.equal(evento.payload.motivo, 'Ya no se necesita')
        // la unidad vuelve a poder moverse
        await estado(
            client.post('/api/v1/inventario/bajas').bearerToken(e.token).headers(cabecera).json({
                producto_id: onu.id,
                bodega_id: central.id,
                unidad_id: onus[0]!.id,
                causa: 'danado',
                motivo: 'prueba después de cancelar',
            }),
            201,
        )
        await afirmarTransito(assert, e.B)
        await afirmarCuadre(assert, e.B)
    })
})
