import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, soloEmpresaPrincipal, unico, usuarioConRoles } from '#tests/ayudas'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import { dec } from '#ledger/dinero'
import { errorDe, servicioEn } from '#tests/contabilidad/ayudas_contabilidad'
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'
import { haceMeses, partidas, proveedorEn } from '#tests/ledger/ayudas_compras'
import {
    afirmarCuadre,
    bodegaEn,
    comprarInventario,
    productoEn,
    saldoInventario,
} from '#tests/inventario/ayudas_inventario'
import { ConsumidorInventario } from '#inventario/consumidor'
import { verificarLibro } from '#tests/contabilidad/verificar_libro'
import RegistrarCompra from '#ledger/actions/registrar_compra'
import AnularCompra from '#ledger/actions/anular_compra'
import DepreciarActivos from '#ledger/actions/depreciar_activos'
import AsignarComodato from '#inventario/actions/asignar_comodato'
import DevolverComodato from '#inventario/actions/devolver_comodato'
import DeclararPerdidaComodato from '#inventario/actions/declarar_perdida_comodato'
import TrasladarInventario from '#inventario/actions/trasladar_inventario'
import DarDeBajaInventario from '#inventario/actions/dar_de_baja_inventario'
import CargarSaldoInicial from '#inventario/actions/cargar_saldo_inicial'
import DarDeBajaActivo from '#ledger/actions/dar_de_baja_activo'
import type { ContextoAccion } from '#shared/contexto'

/**
 * Inventario interno, fase B (`contratos/inventario.md` §10): casos 2, 3, 6 y 8, más la devolución
 * al proveedor con NCRE, la pérdida de un comodato y las rutas.
 */

/** Compra al crédito de ONU con sus series; base Q300 cada una (Q336 con IVA). */
async function comprarOnus(
    empresaId: number,
    ctx: ContextoAccion,
    datos: { producto_id: number; bodega_id: number; series: string[]; fecha?: string; proveedorId?: number },
) {
    let proveedorId = datos.proveedorId
    if (!proveedorId) {
        const proveedor = await proveedorEn(empresaId, ctx)
        proveedorId = proveedor.id
    }
    return new RegistrarCompra().execute(
        {
            proveedor_id: proveedorId,
            tipo_documento: 'FACT',
            numero: unico('F'),
            fecha_documento: datos.fecha ?? haceMeses(0),
            condicion: 'credito',
            lineas: [
                {
                    descripcion: 'ONU GPON',
                    tipo: 'bien',
                    total: dec('336').times(datos.series.length).toFixed(2),
                    cantidad: datos.series.length,
                    producto_id: datos.producto_id,
                    bodega_id: datos.bodega_id,
                    unidades: datos.series.map((serie) => ({ serie })),
                },
            ],
        },
        ctx,
    )
}

async function unidadesDeCompra(compraId: number) {
    return (await db
        .from('inventario.unidades')
        .where('compra_id', compraId)
        .orderBy('id')
        .select('*')) as Array<{
        id: number
        serie: string
        estado: string
        costo: string
        bodega_id: number | null
        activo_id: number | null
        condicion: string
    }>
}

async function eventos(nombre: string, unidadId: number) {
    return db
        .from('audit.outbox')
        .where('evento', nombre)
        .whereRaw(`payload->>'unidad_id' = ?`, [String(unidadId)])
}

test.group('Inventario · fase B', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('2. compra de 3 ONU con serie y comodato: activo por su costo, depreciación el mes siguiente; devolución a su valor en libros sin resultado', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const onu = await productoEn(e.B, e.ctx, { nombre: 'ONU GPON', tipo: 'equipo', seguimiento: 'serie' })
        const bodega = await bodegaEn(e.B, e.ctx)
        const series = [unico('ZTEG'), unico('ZTEG'), unico('ZTEG')]
        const compra = await comprarOnus(e.B, e.ctx, {
            producto_id: onu.id,
            bodega_id: bodega.id,
            series,
            fecha: haceMeses(2, 5),
        })
        const unidades = await unidadesDeCompra(compra.id)
        assert.deepEqual(
            unidades.map((u) => [u.serie, u.estado, u.costo]),
            series.map((s) => [s.toUpperCase(), 'disponible', '300.00']),
        )
        assert.deepEqual(await saldoInventario(onu.id, bodega.id), ['3.000', '900.00'])

        const { servicioId } = await servicioEn(e.B)
        const unidad = unidades[0]!
        const asignada = await new AsignarComodato().execute(
            { servicio_id: servicioId, unidad_id: unidad.id, fecha: haceMeses(2, 10) },
            e.ctx,
        )
        assert.equal(asignada.estado, 'en_comodato')
        assert.equal(asignada.servicio_id, servicioId)
        assert.isNull(asignada.bodega_id)
        const activo = await db.from('ledger.activos').where('id', asignada.activo_id!).first()
        assert.equal(activo.costo, '300.00')
        assert.equal(Number(activo.unidad_id), unidad.id)
        assert.equal(activo.clase, 'equipo_red')
        // depreciación desde el mes siguiente al préstamo
        assert.equal(activo.inicio_depreciacion.toISOString().slice(0, 10), haceMeses(1, 1))
        const asignacion = await db
            .from('inventario.movimientos')
            .where({ unidad_id: unidad.id, tipo: 'asignacion_comodato' })
            .first()
        assert.deepEqual(await partidas('inventario', Number(asignacion.id)), [
            [`${CUENTAS_GT.PROPIEDAD_PLANTA_EQUIPO}.01`, '300.00', '0.00', null],
            [CUENTAS_GT.INVENTARIOS, '0.00', '300.00', null],
        ])
        assert.lengthOf(await eventos('inventario.comodato_asignado', unidad.id), 1)
        assert.deepEqual(await saldoInventario(onu.id, bodega.id), ['2.000', '600.00'])

        // el cron deprecia el mes anterior: una cuota
        await new DepreciarActivos().execute({ activo_id: asignada.activo_id! }, e.ctx)
        const cuotas = await db.from('ledger.activos_cuotas').where('activo_id', asignada.activo_id!)
        assert.lengthOf(cuotas, 1)
        const cuota = dec(cuotas[0]!.monto)
        const libros = dec('300').minus(cuota).toFixed(2)

        const usada = await bodegaEn(e.B, e.ctx)
        const devuelta = await new DevolverComodato().execute(
            { servicio_id: servicioId, unidad_id: unidad.id, bodega_id: usada.id },
            e.ctx,
        )
        assert.equal(devuelta.estado, 'disponible')
        assert.equal(devuelta.condicion, 'usado')
        assert.equal(devuelta.costo, libros)
        assert.isNull(devuelta.activo_id)
        assert.isNull(devuelta.servicio_id)
        const baja = await db.from('ledger.activos_bajas').where('activo_id', asignada.activo_id!).first()
        assert.equal(baja.tipo, 'devolucion_comodato')
        assert.equal(baja.valor_libros, libros)
        const devolucion = await db
            .from('inventario.movimientos')
            .where({ unidad_id: unidad.id, tipo: 'devolucion_comodato' })
            .first()
        assert.equal(devolucion.costo_total, libros)
        // sin resultado: 1.1.14 (libros) + 1.2.02.01 (acumulada) / 1.2.01.01 (costo)
        assert.deepEqual(await partidas('inventario', Number(devolucion.id)), [
            [CUENTAS_GT.INVENTARIOS, libros, '0.00', null],
            [`${CUENTAS_GT.DEPRECIACION_ACUMULADA}.01`, cuota.toFixed(2), '0.00', null],
            [`${CUENTAS_GT.PROPIEDAD_PLANTA_EQUIPO}.01`, '0.00', '300.00', null],
        ])
        assert.deepEqual(await saldoInventario(onu.id, usada.id), ['1.000', libros])
        const devuelto = await eventos('inventario.comodato_devuelto', unidad.id)
        assert.lengthOf(devuelto, 1)
        assert.equal(devuelto[0].payload.bodega_id, usada.id)
        // se puede volver a prestar: activo nuevo por su valor en libros
        const otraVez = await new AsignarComodato().execute(
            { servicio_id: servicioId, unidad_id: unidad.id },
            e.ctx,
        )
        const activo2 = await db.from('ledger.activos').where('id', otraVez.activo_id!).first()
        assert.equal(activo2.costo, libros)
        await afirmarCuadre(assert, e.B)
    })

    test('3. retiro del servicio: sus equipos quedan por recuperar (el evento procesado dos veces, mismo resultado); al reactivarse vuelven a comodato', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const onu = await productoEn(e.B, e.ctx, { tipo: 'equipo', seguimiento: 'serie' })
        const bodega = await bodegaEn(e.B, e.ctx)
        const compra = await comprarOnus(e.B, e.ctx, {
            producto_id: onu.id,
            bodega_id: bodega.id,
            series: [unico('S'), unico('S')],
        })
        const [a, b] = await unidadesDeCompra(compra.id)
        const { servicioId } = await servicioEn(e.B)
        await new AsignarComodato().execute({ servicio_id: servicioId, unidad_id: a!.id }, e.ctx)
        await new AsignarComodato().execute({ servicio_id: servicioId, unidad_id: b!.id }, e.ctx)

        await db.from('core.servicios').where('id', servicioId).update({ estado: 'retirado' })
        const consumidor = new ConsumidorInventario()
        const evento = {
            id: unico('ev'),
            evento: 'servicio.estado_cambiado',
            payload: {
                servicio_id: servicioId,
                empresa_id: e.B,
                de: 'suspendido',
                a: 'retirado',
                motivo: 'baja',
            },
        }
        await consumidor.procesar(evento)
        await consumidor.procesar(evento)
        const estados = await db.from('inventario.unidades').whereIn('id', [a!.id, b!.id]).select('estado')
        assert.deepEqual(
            estados.map((u) => u.estado),
            ['por_recuperar', 'por_recuperar'],
        )
        assert.lengthOf(await eventos('inventario.equipo_por_recuperar', a!.id), 1)
        assert.lengthOf(await eventos('inventario.equipo_por_recuperar', b!.id), 1)
        // el activo sigue vigente (sin asiento)
        const bajas = await db
            .from('ledger.activos_bajas')
            .whereIn('activo_id', db.from('inventario.unidades').whereIn('id', [a!.id]).select('activo_id'))
        assert.lengthOf(bajas, 0)
        const reporte = await db
            .from('inventario.unidades')
            .where({ servicio_id: servicioId, estado: 'por_recuperar' })
        assert.lengthOf(reporte, 2)

        // un servicio retirado no recibe comodatos
        const otra = await comprarOnus(e.B, e.ctx, {
            producto_id: onu.id,
            bodega_id: bodega.id,
            series: [unico('S')],
        })
        const [c] = await unidadesDeCompra(otra.id)
        const retirado = await errorDe(
            new AsignarComodato().execute({ servicio_id: servicioId, unidad_id: c!.id }, e.ctx),
        )
        assert.equal(retirado.codigo, 'servicio_retirado')

        // se recupera uno; el otro vuelve a comodato si el servicio vuelve
        await new DevolverComodato().execute(
            { servicio_id: servicioId, unidad_id: a!.id, bodega_id: bodega.id },
            e.ctx,
        )
        await db.from('core.servicios').where('id', servicioId).update({ estado: 'activo' })
        await consumidor.procesar({
            ...evento,
            id: unico('ev'),
            payload: { ...evento.payload, de: 'retirado', a: 'activo' },
        })
        const fila = await db.from('inventario.unidades').where('id', b!.id).first()
        assert.equal(fila.estado, 'en_comodato')
        await afirmarCuadre(assert, e.B)
    })

    test('6. anular una compra cuyas unidades ya se asignaron: 409 unidades_en_uso; sin uso, la anulación las deja anuladas y la serie se puede volver a registrar', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const onu = await productoEn(e.B, e.ctx, { tipo: 'equipo', seguimiento: 'serie' })
        const bodega = await bodegaEn(e.B, e.ctx)
        const series = [unico('S'), unico('S')]
        const compra = await comprarOnus(e.B, e.ctx, { producto_id: onu.id, bodega_id: bodega.id, series })
        const [a] = await unidadesDeCompra(compra.id)
        const { servicioId } = await servicioEn(e.B)
        await new AsignarComodato().execute({ servicio_id: servicioId, unidad_id: a!.id }, e.ctx)
        const enUso = await errorDe(
            new AnularCompra().execute({ compra_id: compra.id, motivo: 'error' }, e.ctx),
        )
        assert.equal(enUso.status, 409)
        assert.equal(enUso.codigo, 'unidades_en_uso')

        const otra = await comprarOnus(e.B, e.ctx, {
            producto_id: onu.id,
            bodega_id: bodega.id,
            series: [unico('S')],
        })
        await new AnularCompra().execute({ compra_id: otra.id, motivo: 'factura equivocada' }, e.ctx)
        const [anulada] = await unidadesDeCompra(otra.id)
        assert.equal(anulada!.estado, 'anulada')
        assert.isNull(anulada!.bodega_id)
        // la misma serie vuelve a entrar con la compra corregida
        await comprarOnus(e.B, e.ctx, { producto_id: onu.id, bodega_id: bodega.id, series: [anulada!.serie] })
        await afirmarCuadre(assert, e.B)
    })

    test('8. serie o MAC repetida: 422 serie_duplicada; una unidad en comodato no se traslada ni se da de baja', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const router = await productoEn(e.B, e.ctx, {
            nombre: 'Router',
            tipo: 'equipo',
            seguimiento: 'serie',
        })
        const bodega = await bodegaEn(e.B, e.ctx)
        const otraBodega = await bodegaEn(e.B, e.ctx)
        const serie = unico('RT')
        const inicial = await new CargarSaldoInicial().execute(
            {
                producto_id: router.id,
                bodega_id: bodega.id,
                unidad: { serie, mac: 'aa-bb-cc-00-11-22' },
                costo_total: '250.00',
            },
            e.ctx,
        )
        const unidad = await db.from('inventario.unidades').where('id', inicial.unidad_id!).first()
        assert.equal(unidad.mac, 'AA:BB:CC:00:11:22')
        const porSerie = await errorDe(
            new CargarSaldoInicial().execute(
                {
                    producto_id: router.id,
                    bodega_id: bodega.id,
                    unidad: { serie: serie.toLowerCase() },
                    costo_total: '1.00',
                },
                e.ctx,
            ),
        )
        assert.equal(porSerie.status, 422)
        assert.equal(porSerie.codigo, 'serie_duplicada')
        const proveedor = await proveedorEn(e.B, e.ctx)
        const repetidaMac = await errorDe(
            new RegistrarCompra().execute(
                {
                    proveedor_id: proveedor.id,
                    tipo_documento: 'FACT',
                    numero: unico('F'),
                    fecha_documento: haceMeses(0),
                    condicion: 'credito',
                    lineas: [
                        {
                            descripcion: 'Routers',
                            tipo: 'bien',
                            total: '672.00',
                            cantidad: 2,
                            producto_id: router.id,
                            bodega_id: bodega.id,
                            unidades: [{ mac: 'AABBCC001122' }, { serie: unico('RT') }],
                        },
                    ],
                },
                e.ctx,
            ),
        )
        assert.equal(repetidaMac.codigo, 'serie_duplicada')
        const enPeticion = await errorDe(
            new RegistrarCompra().execute(
                {
                    proveedor_id: proveedor.id,
                    tipo_documento: 'FACT',
                    numero: unico('F'),
                    fecha_documento: haceMeses(0),
                    condicion: 'credito',
                    lineas: [
                        {
                            descripcion: 'Routers',
                            tipo: 'bien',
                            total: '672.00',
                            cantidad: 2,
                            producto_id: router.id,
                            bodega_id: bodega.id,
                            unidades: [{ serie: 'MISMA-1' }, { serie: 'misma-1' }],
                        },
                    ],
                },
                e.ctx,
            ),
        )
        assert.equal(enPeticion.codigo, 'serie_duplicada')
        const sinUnidades = await errorDe(
            comprarInventario(e.B, e.ctx, {
                producto_id: router.id,
                bodega_id: bodega.id,
                cantidad: 1,
                total: '336.00',
            }),
        )
        assert.include(sinUnidades.reglas, 'requiere_unidades')

        const { servicioId } = await servicioEn(e.B)
        await new AsignarComodato().execute({ servicio_id: servicioId, unidad_id: unidad.id }, e.ctx)
        const traslado = await errorDe(
            new TrasladarInventario().execute(
                {
                    producto_id: router.id,
                    bodega_origen_id: bodega.id,
                    bodega_destino_id: otraBodega.id,
                    unidad_ids: [unidad.id],
                },
                e.ctx,
            ),
        )
        assert.equal(traslado.codigo, 'unidad_en_comodato')
        const baja = await errorDe(
            new DarDeBajaInventario().execute(
                {
                    producto_id: router.id,
                    bodega_id: bodega.id,
                    unidad_id: unidad.id,
                    causa: 'danado',
                    motivo: 'golpe',
                },
                e.ctx,
            ),
        )
        assert.equal(baja.codigo, 'unidad_en_comodato')
        const dosVeces = await errorDe(
            new AsignarComodato().execute({ servicio_id: servicioId, unidad_id: unidad.id }, e.ctx),
        )
        assert.equal(dosVeces.codigo, 'unidad_en_comodato')

        // pérdida: el activo se da de baja a 5.3.06; la unidad queda dada de baja
        const perdida = await new DeclararPerdidaComodato().execute(
            { servicio_id: servicioId, unidad_id: unidad.id, motivo: 'el cliente no lo devolvió' },
            e.ctx,
        )
        assert.equal(perdida.estado, 'dada_de_baja')
        const activoFila = await db.from('ledger.activos').where('unidad_id', unidad.id).first()
        const activoId = activoFila.id
        const partidasBaja = await partidas('baja_activo', Number(activoId))
        assert.deepEqual(partidasBaja, [
            [CUENTAS_GT.PERDIDA_BAJA_ACTIVOS, '250.00', '0.00', null],
            [`${CUENTAS_GT.PROPIEDAD_PLANTA_EQUIPO}.01`, '0.00', '250.00', null],
        ])
        await afirmarCuadre(assert, e.B)
    })

    test('devolución al proveedor con NCRE: por cantidad al costo de la compra y por serie; anular la NCRE las reingresa', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const cable = await productoEn(e.B, e.ctx)
        const onu = await productoEn(e.B, e.ctx, { tipo: 'equipo', seguimiento: 'serie' })
        const bodega = await bodegaEn(e.B, e.ctx)
        const proveedor = await proveedorEn(e.B, e.ctx)
        // con una línea de servicio, la NCRE puede pasar de lo que entró sin pasar del saldo de la compra
        const compra = await new RegistrarCompra().execute(
            {
                proveedor_id: proveedor.id,
                tipo_documento: 'FACT',
                numero: unico('F'),
                fecha_documento: haceMeses(0),
                condicion: 'credito',
                lineas: [
                    {
                        descripcion: 'Cable',
                        tipo: 'bien',
                        total: '56.00',
                        cantidad: 10,
                        producto_id: cable.id,
                        bodega_id: bodega.id,
                    },
                    { descripcion: 'Flete', tipo: 'servicio', total: '112.00' },
                ],
            },
            e.ctx,
        )
        const ncre = (lineas: unknown[], referencia = compra.id) =>
            new RegistrarCompra().execute(
                {
                    proveedor_id: proveedor.id,
                    tipo_documento: 'NCRE',
                    numero: unico('NC'),
                    fecha_documento: haceMeses(0),
                    condicion: 'credito',
                    compra_referencia_id: referencia,
                    lineas: lineas as never,
                },
                e.ctx,
            )
        const distinta = await errorDe(
            ncre([
                {
                    descripcion: 'Devolución',
                    tipo: 'bien',
                    total: '20.00',
                    cantidad: 3,
                    producto_id: cable.id,
                    bodega_id: bodega.id,
                },
            ]),
        )
        assert.equal(distinta.codigo, 'devolucion_distinta_del_costo')
        const excede = await errorDe(
            ncre([
                {
                    descripcion: 'Devolución',
                    tipo: 'bien',
                    total: '61.60',
                    cantidad: 11,
                    producto_id: cable.id,
                    bodega_id: bodega.id,
                },
            ]),
        )
        assert.include(excede.reglas, 'devolucion_excede_compra')
        const nota = await ncre([
            {
                descripcion: 'Devolución',
                tipo: 'bien',
                total: '16.80',
                cantidad: 3,
                producto_id: cable.id,
                bodega_id: bodega.id,
            },
        ])
        assert.deepEqual(await partidas('compra', nota.id), [
            [CUENTAS_GT.INVENTARIOS, '0.00', '15.00', '-C_BASE_BIEN'],
            [CUENTAS_GT.IVA_CREDITO, '0.00', '1.80', '-C_IVA'],
            [CUENTAS_GT.PROVEEDORES, '16.80', '0.00', null],
        ])
        const salida = await db
            .from('inventario.movimientos')
            .where({ origen_tipo: 'compra', origen_id: nota.id })
            .first()
        assert.equal(salida.tipo, 'devolucion_proveedor')
        assert.equal(salida.costo_total, '-15.00')
        assert.deepEqual(await saldoInventario(cable.id, bodega.id), ['7.000', '35.00'])
        await new AnularCompra().execute({ compra_id: nota.id, motivo: 'nota repetida' }, e.ctx)
        assert.deepEqual(await saldoInventario(cable.id, bodega.id), ['10.000', '50.00'])
        await afirmarCuadre(assert, e.B)

        // serie: la ONU de esa compra vuelve al proveedor
        const conOnus = await comprarOnus(e.B, e.ctx, {
            producto_id: onu.id,
            bodega_id: bodega.id,
            series: [unico('S'), unico('S')],
            proveedorId: proveedor.id,
        })
        const [x] = await unidadesDeCompra(conOnus.id)
        const notaOnu = await ncre(
            [
                {
                    descripcion: 'ONU defectuosa',
                    tipo: 'bien',
                    total: '336.00',
                    cantidad: 1,
                    producto_id: onu.id,
                    bodega_id: bodega.id,
                    unidad_ids: [x!.id],
                },
            ],
            conOnus.id,
        )
        const devuelta = await db.from('inventario.unidades').where('id', x!.id).first()
        assert.equal(devuelta.estado, 'devuelta_proveedor')
        assert.deepEqual(await saldoInventario(onu.id, bodega.id), ['1.000', '300.00'])
        await new AnularCompra().execute({ compra_id: notaOnu.id, motivo: 'no se devolvió' }, e.ctx)
        const vuelve = await db.from('inventario.unidades').where('id', x!.id).first()
        assert.equal(vuelve.estado, 'disponible')
        assert.deepEqual(await saldoInventario(onu.id, bodega.id), ['2.000', '600.00'])
        await afirmarCuadre(assert, e.B)
    })

    test('rutas: unidades por serie o MAC, equipos del servicio, por recuperar y permisos del técnico', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const cabecera = { 'X-Empresa-Id': String(e.B) }
        const onu = await productoEn(e.B, e.ctx, { tipo: 'equipo', seguimiento: 'serie' })
        const bodega = await bodegaEn(e.B, e.ctx)
        await new CargarSaldoInicial().execute(
            {
                producto_id: onu.id,
                bodega_id: bodega.id,
                unidad: { mac: '00:11:22:33:44:55' },
                costo_total: '200.00',
            },
            e.ctx,
        )
        const { servicioId } = await servicioEn(e.B)
        const tecnico = await usuarioConRoles(['tecnico'])
        const buscadas = await estado(
            client
                .get('/api/v1/inventario/unidades')
                .bearerToken(tecnico.token)
                .headers(cabecera)
                .qs({ q: '001122334455' }),
            200,
        )
        assert.lengthOf(buscadas.body().data, 1)
        const unidad = buscadas.body().data[0]
        const asignada = await estado(
            client
                .post(`/api/v1/servicios/${servicioId}/equipos`)
                .bearerToken(tecnico.token)
                .headers(cabecera)
                .header('Idempotency-Key', unico('c'))
                .json({ unidad_id: unidad.id }),
            201,
        )
        assert.equal(asignada.body().estado, 'en_comodato')
        const equipos = await estado(
            client
                .get(`/api/v1/servicios/${servicioId}/equipos`)
                .bearerToken(tecnico.token)
                .headers(cabecera),
            200,
        )
        assert.equal(equipos.body()[0].valor_libros, '200.00')
        // el técnico no declara pérdidas
        await estado(
            client
                .post(`/api/v1/servicios/${servicioId}/equipos/${unidad.id}/perdida`)
                .bearerToken(tecnico.token)
                .headers(cabecera)
                .json({ motivo: 'perdido' }),
            403,
        )
        const historial = await estado(
            client.get(`/api/v1/inventario/unidades/${unidad.id}`).bearerToken(e.token).headers(cabecera),
            200,
        )
        assert.deepEqual(
            historial.body().historial.map((m: { tipo: string }) => m.tipo),
            ['saldo_inicial', 'asignacion_comodato'],
        )
        await db.from('core.servicios').where('id', servicioId).update({ estado: 'retirado' })
        await new ConsumidorInventario().procesar({
            id: unico('ev'),
            evento: 'servicio.estado_cambiado',
            payload: {
                servicio_id: servicioId,
                empresa_id: e.B,
                de: 'activo',
                a: 'retirado',
                motivo: 'baja',
            },
        })
        const porRecuperar = await estado(
            client.get('/api/v1/reportes/equipos-por-recuperar').bearerToken(e.token).headers(cabecera),
            200,
        )
        assert.deepEqual(
            porRecuperar.body().data.map((u: { id: number }) => u.id),
            [unidad.id],
        )
        await estado(
            client
                .post(`/api/v1/servicios/${servicioId}/equipos/${unidad.id}/devolver`)
                .bearerToken(tecnico.token)
                .headers(cabecera)
                .json({ bodega_id: bodega.id }),
            200,
        )
        await afirmarCuadre(assert, e.B)
    })

    test('equipo totalmente depreciado: vuelve a Q0, se presta otra vez con un activo en Q0 sin asientos; activos.dar_de_baja no toca un comodato (409)', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const onu = await productoEn(e.B, e.ctx, { tipo: 'equipo', seguimiento: 'serie' })
        const bodega = await bodegaEn(e.B, e.ctx)
        const inicial = await new CargarSaldoInicial().execute(
            {
                producto_id: onu.id,
                bodega_id: bodega.id,
                unidad: { serie: unico('V') },
                costo_total: '120.00',
                fecha: '2014-02-05',
            },
            e.ctx,
        )
        const unidadId = inicial.unidad_id!
        const { servicioId } = await servicioEn(e.B)
        const prestada = await new AsignarComodato().execute(
            { servicio_id: servicioId, unidad_id: unidadId, fecha: '2014-02-10' },
            e.ctx,
        )
        const baja = await errorDe(
            new DarDeBajaActivo().execute(
                { activo_id: prestada.activo_id!, tipo: 'retiro', motivo: 'retiro' },
                e.ctx,
            ),
        )
        assert.equal(baja.status, 409)
        assert.equal(baja.codigo, 'activo_en_comodato')
        await new DepreciarActivos().execute({ activo_id: prestada.activo_id! }, e.ctx)
        const devuelta = await new DevolverComodato().execute(
            { servicio_id: servicioId, unidad_id: unidadId, bodega_id: bodega.id },
            e.ctx,
        )
        assert.equal(devuelta.costo, '0.00')
        const otraVez = await new AsignarComodato().execute(
            { servicio_id: servicioId, unidad_id: unidadId },
            e.ctx,
        )
        const activo = await db.from('ledger.activos').where('id', otraVez.activo_id!).first()
        assert.equal(activo.costo, '0.00')
        const asignacion = await db
            .from('inventario.movimientos')
            .where({ unidad_id: unidadId, tipo: 'asignacion_comodato' })
            .orderBy('id', 'desc')
            .first()
        assert.isNull(asignacion.asiento_id)
        await new DevolverComodato().execute(
            { servicio_id: servicioId, unidad_id: unidadId, bodega_id: bodega.id },
            e.ctx,
        )
        const bajaCero = await db.from('ledger.activos_bajas').where('activo_id', otraVez.activo_id!).first()
        assert.equal(bajaCero.tipo, 'devolucion_comodato')
        assert.isNull(bajaCero.asiento_id)
        // el activo en Q0 (decisión del líder) no tiene asiento de alta ni de baja: el auditor lo suma a
        // 15.alta_… y 15.baja_… (`a3.md`); mientras, solo esas filas de ese activo se descartan aquí
        const todas = await verificarLibro(e.B)
        const violaciones = todas
            .map((v) =>
                /^15\.(alta|baja)_de_activo_mal_contabilizada/.test(v.invariante)
                    ? {
                          ...v,
                          detalle: (v.detalle as Array<{ id?: number; activo_id?: number }>).filter(
                              (d) => Number(d.activo_id ?? d.id) !== Number(otraVez.activo_id),
                          ),
                      }
                    : v,
            )
            .filter((v) => !Array.isArray(v.detalle) || v.detalle.length > 0)
        assert.deepEqual(violaciones, [])
    })
})
