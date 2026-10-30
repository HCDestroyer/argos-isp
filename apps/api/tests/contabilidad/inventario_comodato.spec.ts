import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { soloEmpresaPrincipal, unico } from '#tests/ayudas'
import { unicoBd } from '#tests/billing/ayudas_billing'
import { errorDe, saldoCuenta, servicioEn } from '#tests/contabilidad/ayudas_contabilidad'
import { afirmarLibro, verificarLibro } from '#tests/contabilidad/verificar_libro'
import { prepararEmpresasGt, type EmpresasGt } from '#tests/ledger/ayudas_bancos'
import { haceMeses, proveedorEn } from '#tests/ledger/ayudas_compras'
import { bodegaEn, productoEn, saldoInventario } from '#tests/inventario/ayudas_inventario'
import { CUENTAS } from '#ledger/plan_cuentas'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import { dec } from '#ledger/dinero'
import { balanceSaldos } from '#ledger/estados_financieros'
import { ConsumidorInventario } from '#inventario/consumidor'
import RegistrarAsiento from '#ledger/actions/registrar_asiento'
import RegistrarCompra from '#ledger/actions/registrar_compra'
import AnularCompra from '#ledger/actions/anular_compra'
import DepreciarActivos from '#ledger/actions/depreciar_activos'
import DarDeBajaActivo from '#ledger/actions/dar_de_baja_activo'
import CerrarPeriodo from '#ledger/actions/cerrar_periodo'
import CerrarEjercicio from '#ledger/actions/cerrar_ejercicio'
import AsignarComodato from '#inventario/actions/asignar_comodato'
import DevolverComodato from '#inventario/actions/devolver_comodato'
import DeclararPerdidaComodato from '#inventario/actions/declarar_perdida_comodato'
import CargarSaldoInicial from '#inventario/actions/cargar_saldo_inicial'

/**
 * Auditor contable · inventario fase B (rama `a3/inventario-b`, `contratos/inventario.md` §5, §8.3 y
 * «Desvíos de la fase B»): unidades por serie, comodato con su activo fijo, devolución a valor en
 * libros, pérdida, equipos por recuperar y devolución al proveedor. Los invariantes están en el inv.
 * 24 (unidades = kardex = saldos, §8.3 comodato = activo) y en 15.alta/15.baja_de_activo (los
 * asientos del comodato, origen `inventario`).
 *
 * Hallazgos de la fase B (H42 y H43 arreglados por A3 en c15a016; detalle en `.claude/integration/a3.md`):
 *
 * - **H42** (alta, arreglado: 409 `unidades_en_uso` si la unidad no está tal como entró): anular la compra de una unidad que estuvo en comodato y volvió a la misma bodega
 *   pasa (`revertirEntradasDeLaCompra` solo mira que esté `disponible` en su bodega): el reverso saca
 *   el costo de compra, pero la unidad vale su valor en libros. Con otras unidades en la bodega, la
 *   diferencia se le descuenta a ellas (inv. 24.saldo_de_serie_distinto_de_sus_unidades); si era la
 *   única, responde `valor_insuficiente` por casualidad.
 * - **H43** (alta, arreglado: 409 `activo_en_comodato`): `activos.dar_de_baja` acepta el activo de una unidad en comodato (retiro a 5.3.06
 *   o venta). El activo queda dado de baja con la unidad `en_comodato` (inv. 24.comodato_sin_su_activo)
 *   y la devolución del equipo ya no se puede registrar: la unidad queda varada fuera del inventario.
 */

/** Compra al crédito de equipos de serie: base Q300 cada uno (Q336 con IVA). */
async function comprarEquipos(
    e: EmpresasGt,
    productoId: number,
    bodegaId: number,
    n: number,
    fecha?: string,
) {
    const series = await Promise.all(Array.from({ length: n }, () => unicoBd('ZTEG')))
    const proveedor = await proveedorEn(e.B, e.ctx)
    const compra = await new RegistrarCompra().execute(
        {
            proveedor_id: proveedor.id,
            tipo_documento: 'FACT',
            numero: await unicoBd('F'),
            fecha_documento: fecha ?? haceMeses(0),
            condicion: 'credito',
            lineas: [
                {
                    descripcion: 'ONU GPON',
                    tipo: 'bien',
                    total: dec('336').times(n).toFixed(2),
                    cantidad: n,
                    producto_id: productoId,
                    bodega_id: bodegaId,
                    unidades: series.map((serie) => ({ serie })),
                },
            ],
        },
        e.ctx,
    )
    const unidades = (await db
        .from('inventario.unidades')
        .where('compra_id', compra.id)
        .orderBy('id')
        .select('id', 'serie', 'costo')) as Array<{ id: number; serie: string; costo: string }>
    return { compra, proveedor, unidades: unidades.map((u) => ({ ...u, id: Number(u.id) })) }
}

async function escenario(n = 2, fecha?: string) {
    const e = await prepararEmpresasGt()
    const onu = await productoEn(e.B, e.ctx, { nombre: 'ONU GPON', tipo: 'equipo', seguimiento: 'serie' })
    const bodega = await bodegaEn(e.B, e.ctx)
    const comprada = await comprarEquipos(e, onu.id, bodega.id, n, fecha)
    const { servicioId, clienteId } = await servicioEn(e.B)
    return { e, onu, bodega, servicioId, clienteId, ...comprada }
}

async function nombresDeViolaciones(empresas: number[]) {
    const violaciones = await verificarLibro(empresas)
    return violaciones.map((v) => v.invariante.split(' ')[0]!)
}

/** Movimientos (código, debe − haber) del asiento. */
async function partidasDe(asientoId: number) {
    const filas = (await db
        .from('ledger.movimientos as m')
        .join('ledger.cuentas as c', 'c.id', 'm.cuenta_id')
        .where('m.asiento_id', asientoId)
        .orderBy('m.id')
        .select('c.codigo', db.raw('(m.debe - m.haber)::text as neto'))) as Array<{
        codigo: string
        neto: string
    }>
    return filas.map((f) => [f.codigo, f.neto])
}

async function acumulada(activoId: number) {
    const fila = (await db
        .from('ledger.activos_cuotas')
        .where('activo_id', activoId)
        .select(db.raw('coalesce(sum(monto), 0)::text as total'))
        .first()) as { total: string }
    return dec(fila.total)
}

function evento(servicioId: number, empresaId: number, de: string, a: string) {
    return {
        id: unico('ev'),
        evento: 'servicio.estado_cambiado',
        payload: { servicio_id: servicioId, empresa_id: empresaId, de, a, motivo: 'auditoría' },
    }
}

test.group('Auditor contable · inventario fase B (comodato)', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('depreciación del comodato y devolución a valor en libros: 1.1.14 + 1.2.02 / 1.2.01, sin resultado; vuelve a prestarse a su valor en libros', async ({
        assert,
    }) => {
        const { e, onu, bodega, servicioId, unidades } = await escenario(2, haceMeses(3, 2))
        const asignada = await new AsignarComodato().execute(
            { servicio_id: servicioId, unidad_id: unidades[0]!.id, fecha: haceMeses(3, 20) },
            e.ctx,
        )
        await new DepreciarActivos().execute({ activo_id: asignada.activo_id! }, e.ctx)
        const depreciado = await acumulada(asignada.activo_id!)
        assert.isTrue(depreciado.gt(0), 'dos meses de depreciación')
        const devuelta = await new DevolverComodato().execute(
            { servicio_id: servicioId, unidad_id: unidades[0]!.id, bodega_id: bodega.id },
            e.ctx,
        )
        const libros = dec('300').minus(depreciado)
        assert.equal(devuelta.costo, libros.toFixed(2))
        const baja = await db
            .from('ledger.activos_bajas')
            .where('activo_id', asignada.activo_id!)
            .firstOrFail()
        assert.equal(baja.tipo, 'devolucion_comodato')
        const partidas = await partidasDe(Number(baja.asiento_id))
        const codigos = partidas.map(([c]) => c)
        assert.notInclude(codigos, CUENTAS_GT.GANANCIA_VENTA_ACTIVOS)
        assert.notInclude(codigos, CUENTAS_GT.PERDIDA_BAJA_ACTIVOS)
        assert.deepEqual(await saldoInventario(onu.id, bodega.id), [
            '2.000',
            dec('300').plus(libros).toFixed(2),
        ])
        // otra vez en comodato: el activo nuevo vale lo que valía en libros
        const otraVez = await new AsignarComodato().execute(
            { servicio_id: servicioId, unidad_id: unidades[0]!.id },
            e.ctx,
        )
        const activo = await db.from('ledger.activos').where('id', otraVez.activo_id!).firstOrFail()
        assert.equal(activo.costo, libros.toFixed(2))
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('devolución con fecha anterior a una cuota registrada: 422 cuotas_posteriores, sin escribir nada', async ({
        assert,
    }) => {
        const { e, bodega, servicioId, unidades } = await escenario(1, haceMeses(4, 2))
        const asignada = await new AsignarComodato().execute(
            { servicio_id: servicioId, unidad_id: unidades[0]!.id, fecha: haceMeses(4, 10) },
            e.ctx,
        )
        await new DepreciarActivos().execute({ activo_id: asignada.activo_id! }, e.ctx)
        const antes = await db.from('inventario.movimientos').where('empresa_id', e.B).count('* as n').first()
        const tarde = await errorDe(
            new DevolverComodato().execute(
                {
                    servicio_id: servicioId,
                    unidad_id: unidades[0]!.id,
                    bodega_id: bodega.id,
                    fecha: haceMeses(2, 15),
                },
                e.ctx,
            ),
        )
        assert.equal(tarde.codigo, 'cuotas_posteriores')
        const despues = await db
            .from('inventario.movimientos')
            .where('empresa_id', e.B)
            .count('* as n')
            .first()
        assert.equal(Number(despues.n), Number(antes.n))
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('pérdida del comodato: baja retiro del activo a 5.3.06 por su valor en libros, sin kardex; la unidad queda dada de baja', async ({
        assert,
    }) => {
        const { e, servicioId, unidades } = await escenario(1, haceMeses(3, 2))
        const asignada = await new AsignarComodato().execute(
            { servicio_id: servicioId, unidad_id: unidades[0]!.id, fecha: haceMeses(3, 5) },
            e.ctx,
        )
        const kardex = await db
            .from('inventario.movimientos')
            .where('empresa_id', e.B)
            .count('* as n')
            .first()
        const perdida = await new DeclararPerdidaComodato().execute(
            { servicio_id: servicioId, unidad_id: unidades[0]!.id, motivo: 'el cliente no lo devolvió' },
            e.ctx,
        )
        assert.equal(perdida.estado, 'dada_de_baja')
        const baja = await db
            .from('ledger.activos_bajas')
            .where('activo_id', asignada.activo_id!)
            .firstOrFail()
        assert.equal(baja.tipo, 'retiro')
        const libros = dec('300').minus(await acumulada(asignada.activo_id!))
        assert.equal(baja.valor_libros, libros.toFixed(2))
        assert.equal(await saldoCuenta(e.B, CUENTAS_GT.PERDIDA_BAJA_ACTIVOS), libros.toFixed(2))
        const despues = await db
            .from('inventario.movimientos')
            .where('empresa_id', e.B)
            .count('* as n')
            .first()
        assert.equal(Number(despues.n), Number(kardex.n), 'la pérdida no mueve el kardex')
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('NCRE de devolución por serie y su anulación: la unidad sale a su costo y vuelve; si el equipo ya se registró otra vez, 409 serie_duplicada', async ({
        assert,
    }) => {
        const { e, onu, bodega, compra, proveedor, unidades } = await escenario(2)
        const nota = await new RegistrarCompra().execute(
            {
                proveedor_id: proveedor.id,
                tipo_documento: 'NCRE',
                numero: await unicoBd('NC'),
                fecha_documento: haceMeses(0),
                condicion: 'credito',
                compra_referencia_id: compra.id,
                lineas: [
                    {
                        descripcion: 'Devolución ONU',
                        tipo: 'bien',
                        total: '336.00',
                        cantidad: 1,
                        producto_id: onu.id,
                        bodega_id: bodega.id,
                        unidad_ids: [unidades[0]!.id],
                    },
                ],
            } as never,
            e.ctx,
        )
        assert.deepEqual(await saldoInventario(onu.id, bodega.id), ['1.000', '300.00'])
        await afirmarLibro(assert, [e.B, e.C])
        // el proveedor repone el mismo equipo en otra compra: la serie vuelve a registrarse
        const repuesta = await new RegistrarCompra().execute(
            {
                proveedor_id: proveedor.id,
                tipo_documento: 'FACT',
                numero: await unicoBd('F'),
                fecha_documento: haceMeses(0),
                condicion: 'credito',
                lineas: [
                    {
                        descripcion: 'ONU repuesta',
                        tipo: 'bien',
                        total: '336.00',
                        cantidad: 1,
                        producto_id: onu.id,
                        bodega_id: bodega.id,
                        unidades: [{ serie: unidades[0]!.serie }],
                    },
                ],
            } as never,
            e.ctx,
        )
        const duplicada = await errorDe(
            new AnularCompra().execute({ compra_id: nota.id, motivo: 'auditoría' }, e.ctx),
        )
        assert.equal(duplicada.codigo, 'serie_duplicada')
        // anulada la reposición, la NCRE sí se anula y la unidad original vuelve a su costo
        await new AnularCompra().execute({ compra_id: repuesta.id, motivo: 'auditoría' }, e.ctx)
        await new AnularCompra().execute({ compra_id: nota.id, motivo: 'auditoría' }, e.ctx)
        const vuelta = await db.from('inventario.unidades').where('id', unidades[0]!.id).firstOrFail()
        assert.deepEqual([vuelta.estado, vuelta.costo], ['disponible', '300.00'])
        assert.deepEqual(await saldoInventario(onu.id, bodega.id), ['2.000', '600.00'])
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('retiro y reactivación del servicio dos veces, con el evento repetido: por recuperar ⇄ en comodato, sin asientos ni kardex', async ({
        assert,
    }) => {
        const { e, servicioId, unidades } = await escenario(1)
        await new AsignarComodato().execute({ servicio_id: servicioId, unidad_id: unidades[0]!.id }, e.ctx)
        const consumidor = new ConsumidorInventario()
        const asientos = await db.from('ledger.asientos').where('empresa_id', e.B).count('* as n').first()
        const kardex = await db
            .from('inventario.movimientos')
            .where('empresa_id', e.B)
            .count('* as n')
            .first()
        for (let vuelta = 0; vuelta < 2; vuelta++) {
            await db.from('core.servicios').where('id', servicioId).update({ estado: 'retirado' })
            const retiro = evento(servicioId, e.B, 'suspendido', 'retirado')
            await consumidor.procesar(retiro)
            await consumidor.procesar(retiro)
            const retirada = await db.from('inventario.unidades').where('id', unidades[0]!.id).firstOrFail()
            assert.equal(retirada.estado, 'por_recuperar')
            await db.from('core.servicios').where('id', servicioId).update({ estado: 'activo' })
            const vuelve = evento(servicioId, e.B, 'retirado', 'activo')
            await consumidor.procesar(vuelve)
            await consumidor.procesar(vuelve)
            const activa = await db.from('inventario.unidades').where('id', unidades[0]!.id).firstOrFail()
            assert.equal(activa.estado, 'en_comodato')
        }
        const avisos = await db
            .from('audit.outbox')
            .where('evento', 'inventario.equipo_por_recuperar')
            .whereRaw(`payload->>'unidad_id' = ?`, [String(unidades[0]!.id)])
        assert.lengthOf(avisos, 2, 'un aviso por retiro, no por evento repetido')
        const asientosDespues = await db
            .from('ledger.asientos')
            .where('empresa_id', e.B)
            .count('* as n')
            .first()
        const kardexDespues = await db
            .from('inventario.movimientos')
            .where('empresa_id', e.B)
            .count('* as n')
            .first()
        assert.equal(Number(asientosDespues.n), Number(asientos.n))
        assert.equal(Number(kardexDespues.n), Number(kardex.n))
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('multiempresa: una unidad de B a un servicio de C responde 404; concurrencia: la misma unidad a dos servicios a la vez, uno solo', async ({
        assert,
    }) => {
        const { e, servicioId, unidades } = await escenario(1)
        const deC = await servicioEn(e.C)
        const ajeno = await errorDe(
            new AsignarComodato().execute({ servicio_id: deC.servicioId, unidad_id: unidades[0]!.id }, e.ctx),
        )
        assert.equal(ajeno.status, 404)
        const otro = await servicioEn(e.B)
        const resultados = await Promise.allSettled([
            new AsignarComodato().execute({ servicio_id: servicioId, unidad_id: unidades[0]!.id }, e.ctx),
            new AsignarComodato().execute(
                { servicio_id: otro.servicioId, unidad_id: unidades[0]!.id },
                e.ctx,
            ),
        ])
        assert.deepEqual(resultados.map((r) => r.status).sort(), ['fulfilled', 'rejected'])
        const activos = await db.from('ledger.activos').where('unidad_id', unidades[0]!.id)
        assert.lengthOf(activos, 1, 'un solo activo para la unidad')
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('cierre anual con un equipo en comodato: 1.2.01 y 1.2.02 quedan, el gasto de depreciación cierra; la devolución después del cierre cuadra', async ({
        assert,
    }) => {
        const ANIO = 2024
        const e = await prepararEmpresasGt()
        const onu = await productoEn(e.B, e.ctx, { nombre: 'ONU GPON', tipo: 'equipo', seguimiento: 'serie' })
        const bodega = await bodegaEn(e.B, e.ctx)
        const inicial = await new CargarSaldoInicial().execute(
            {
                producto_id: onu.id,
                bodega_id: bodega.id,
                unidad: { serie: await unicoBd('ZTEG') },
                costo_total: '1200.00',
                fecha: `${ANIO}-01-10`,
            },
            e.ctx,
        )
        await new RegistrarAsiento().execute(
            {
                empresa_id: e.B,
                fecha: `${ANIO}-01-10`,
                descripcion: 'reclasificación de la apertura',
                origen_tipo: 'ajuste',
                movimientos: [
                    { cuenta: CUENTAS.SALDOS_APERTURA, debe: '1200.00' },
                    { cuenta: CUENTAS_GT.CAPITAL_SOCIAL, haber: '1200.00' },
                ],
            },
            e.ctx,
        )
        const { servicioId } = await servicioEn(e.B, { instalacion: `${ANIO}-02-01` })
        const asignada = await new AsignarComodato().execute(
            { servicio_id: servicioId, unidad_id: inicial.unidad_id!, fecha: `${ANIO}-02-15` },
            e.ctx,
        )
        await new DepreciarActivos().execute(
            { activo_id: asignada.activo_id!, hasta: `${ANIO}-12-01` },
            e.ctx,
        )
        const delAnio = await acumulada(asignada.activo_id!)
        for (let mes = 1; mes <= 11; mes++) {
            await new CerrarPeriodo().execute({ empresa_id: e.B, anio: ANIO, mes }, e.ctx)
        }
        await new CerrarEjercicio().execute({ empresa_id: e.B, anio: ANIO, isr: { monto: '0.00' } }, e.ctx)
        const balance = await balanceSaldos({ hasta: `${ANIO}-12-31` }, [e.B])
        const cuentas = new Map(balance.empresas[0]!.cuentas.map((c) => [c.codigo, c]))
        const activo = await db.from('ledger.activos').where('id', asignada.activo_id!).firstOrFail()
        const cuentaActivo = await db
            .from('ledger.cuentas')
            .where('id', activo.cuenta_activo_id)
            .firstOrFail()
        const codigoActivo = cuentaActivo.codigo as string
        assert.equal(cuentas.get(codigoActivo)?.saldo, '1200.00')
        assert.equal(cuentas.get(CUENTAS_GT.INVENTARIOS)?.saldo ?? '0.00', '0.00')
        assert.isTrue(balance.empresas[0]!.totales.cuadra)
        assert.isTrue(delAnio.gt(0))
        // hoy se devuelve: deprecia lo pendiente (2025 en adelante) y vuelve a valor en libros
        const devuelta = await new DevolverComodato().execute(
            { servicio_id: servicioId, unidad_id: inicial.unidad_id!, bodega_id: bodega.id },
            e.ctx,
        )
        const total = await acumulada(asignada.activo_id!)
        assert.equal(devuelta.costo, dec('1200').minus(total).toFixed(2))
        assert.equal(await saldoCuenta(e.B, codigoActivo), '0.00')
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('H42 (arreglado): anular la compra de una unidad que volvió del comodato saca el costo de compra, no su valor en libros', async ({
        assert,
    }) => {
        const { e, bodega, onu, compra, servicioId, unidades } = await escenario(1, haceMeses(3, 2))
        // otra compra del mismo equipo en la misma bodega
        await comprarEquipos(e, onu.id, bodega.id, 1)
        await new AsignarComodato().execute(
            { servicio_id: servicioId, unidad_id: unidades[0]!.id, fecha: haceMeses(3, 5) },
            e.ctx,
        )
        const devuelta = await new DevolverComodato().execute(
            { servicio_id: servicioId, unidad_id: unidades[0]!.id, bodega_id: bodega.id },
            e.ctx,
        )
        assert.isTrue(dec(devuelta.costo).lt(300), 'volvió a su valor en libros')
        const anulada = await new AnularCompra()
            .execute({ compra_id: compra.id, motivo: 'auditoría' }, e.ctx)
            .then(() => null)
            .catch((error) => error)
        // lo correcto: 409 unidades_en_uso (la unidad tiene movimientos después de entrar); si pasa,
        // la otra unidad queda en la bodega con un valor que no es su costo
        assert.deepEqual(
            { rechazada: anulada !== null, violaciones: await nombresDeViolaciones([e.B, e.C]) },
            { rechazada: true, violaciones: [] },
        )
    })

    test('H43 (arreglado): activos.dar_de_baja acepta el activo de una unidad en comodato; la devolución lo da de baja otra vez', async ({
        assert,
    }) => {
        const { e, bodega, servicioId, unidades } = await escenario(1)
        const asignada = await new AsignarComodato().execute(
            { servicio_id: servicioId, unidad_id: unidades[0]!.id },
            e.ctx,
        )
        const directa = await new DarDeBajaActivo()
            .execute(
                { activo_id: asignada.activo_id!, tipo: 'retiro', motivo: 'auditoría: baja directa' },
                e.ctx,
            )
            .then(() => null)
            .catch((error) => error)
        const devolucion = await new DevolverComodato()
            .execute({ servicio_id: servicioId, unidad_id: unidades[0]!.id, bodega_id: bodega.id }, e.ctx)
            .then(() => null)
            .catch((error) => error)
        // lo correcto: 409 en la baja directa (se devuelve o se declara perdida por el inventario)
        assert.deepEqual(
            {
                baja_directa_rechazada: directa !== null,
                devolucion_ok: devolucion === null,
                violaciones: await nombresDeViolaciones([e.B, e.C]),
            },
            { baja_directa_rechazada: true, devolucion_ok: true, violaciones: [] },
        )
    })
})
