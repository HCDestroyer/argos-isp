import { test } from '@japa/runner'
import { soloEmpresaPrincipal } from '#tests/ayudas'
import { unicoBd } from '#tests/billing/ayudas_billing'
import { crearClienteFila } from '#tests/core/fabricas'
import RegistrarPago from '#billing/actions/registrar_pago'
import CastigarCartera from '#ledger/actions/castigar_cartera'
import { errorDe, saldoCuenta, sacarDeLaColaFel } from '#tests/contabilidad/ayudas_contabilidad'
import { verificarLibro } from '#tests/contabilidad/verificar_libro'
import { cola, datosNit, dtesDe, empresasFel, servicioFel } from '#tests/fiscal/ayudas_fel'
import { haceMeses, partidas, proveedorEn } from '#tests/ledger/ayudas_compras'
import { verActivo } from '#ledger/activos'
import db from '@adonisjs/lucid/services/db'
import RegistrarCompra from '#ledger/actions/registrar_compra'
import DepreciarActivos from '#ledger/actions/depreciar_activos'
import DarDeBajaActivo from '#ledger/actions/dar_de_baja_activo'
import AnularCompra from '#ledger/actions/anular_compra'
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'

/**
 * Auditor contable · HALLAZGOS de la fase 5 (compras, retenciones, activos y diferidos;
 * `a3/fase5-compras`). H19 y H20 ya corregidos por A3 (decisiones del líder): sus pruebas verifican
 * la corrección; mientras un hallazgo esté abierto va `.fails(motivo)` con su invariante en
 * `HALLAZGOS_ABIERTOS`.
 */

test.group('Auditor contable · hallazgos de la fase 5', (group) => {
    group.each.teardown(async () => {
        await sacarDeLaColaFel()
        await soloEmpresaPrincipal()
    })

    test('H19 (caso A, consistente) · retención de IVA recibida en el pago que recupera una factura castigada con DTE', async ({
        assert,
    }) => {
        // El IVA ya se declaró con el DTE (el castigo de una factura certificada no toca el IVA): la recuperación
        // va entera a 4.2.03 y la constancia, a 1.1.05, refiere un DTE que existe.
        const e = await empresasFel('obligatoria')
        const s = await servicioFel(e, 'emitir', '150.00', await crearClienteFila(datosNit()))
        await cola(e)
        assert.equal(await dtesDe('factura', s.facturas[0]!.id).then((d) => d[0]?.estado), 'certificado')
        const k = await new CastigarCartera().execute(
            { facturas: [s.facturas[0]!.id], motivo: 'incobrable', evidencia: 'gestión documentada' },
            e.ctx,
        )
        assert.equal(k.iva, '0.00')
        const pago = await new RegistrarPago().execute(
            {
                cliente_id: s.clienteId,
                metodo: 'caja',
                monto: '140.00',
                empresa_id: e.B,
                retenciones: [{ codigo: 'RET_IVA_ESP', numero: 'CT-H19A', monto: '10.00' }],
            },
            e.ctx,
        )
        // asiento resultante: Caja 140.00 + 1.1.05 10.00 / 4.2.03 150.00
        const asiento = await partidas('pago', pago.id)
        const lineas = asiento.map(([c, d, h]) => `${c} ${d}/${h}`)
        assert.includeMembers(lineas, ['4.2.03 0.00/150.00', '1.1.05 10.00/0.00'])
        assert.lengthOf(lineas, 3)
        assert.equal(Number(await saldoCuenta(e.B, '2.1.11')), 0)
        assert.deepEqual(await verificarLibro(e.B, { incluirHallazgosAbiertos: true }), [])
    })

    test('H19 (caso B, corregido) · constancia de IVA en el pago que recupera un aviso castigado sin DTE: 422 retencion_sin_documento_fiscal y nada se escribe', async ({
        assert,
    }) => {
        // Decisión del líder: no hay DTE que respalde la constancia; el pago con la constancia de IVA se rechaza (la de
        // ISR y el pago sin constancia siguen; la prueba de A3, tests/ledger/hallazgos_fase5.spec.ts, los cubre).
        const e = await empresasFel('obligatoria')
        const s = await servicioFel(e, 'pagar', '150.00', await crearClienteFila(datosNit()))
        const k = await new CastigarCartera().execute(
            { facturas: [s.facturas[0]!.id], motivo: 'incobrable', evidencia: 'gestión documentada' },
            e.ctx,
        )
        assert.equal(k.iva, '16.07')
        const antes = await db.from('ledger.asientos').where('empresa_id', e.B).count('* as n').firstOrFail()
        const rechazo = await errorDe(
            new RegistrarPago().execute(
                {
                    cliente_id: s.clienteId,
                    metodo: 'caja',
                    monto: '140.00',
                    empresa_id: e.B,
                    retenciones: [{ codigo: 'RET_IVA_ESP', numero: 'CT-H19B', monto: '10.00' }],
                },
                e.ctx,
            ),
        )
        assert.equal(rechazo.status, 422)
        assert.equal(rechazo.codigo, 'retencion_sin_documento_fiscal')
        const despues = await db
            .from('ledger.asientos')
            .where('empresa_id', e.B)
            .count('* as n')
            .firstOrFail()
        assert.equal(Number(despues.n), Number(antes.n), 'el rechazo no escribe en el libro')
        // sin la constancia, el mismo cobro recupera el castigo con su IVA de vuelta a 2.1.11 (H17)
        await new RegistrarPago().execute(
            { cliente_id: s.clienteId, metodo: 'caja', monto: '150.00', empresa_id: e.B },
            e.ctx,
        )
        assert.equal(await saldoCuenta(e.B, '2.1.11'), '-16.07')
        assert.deepEqual(await verificarLibro(e.B), [])
    })

    test('H20 (corregido) · una baja con fecha anterior a cuotas ya registradas revierte esas cuotas, cada una en su mes', async ({
        assert,
    }) => {
        // Decisión del líder: la baja retroactiva revierte las cuotas del mes de la baja en adelante, cada reverso con la
        // fecha de su cuota; la depreciación acumulada de la baja es la inicial más las cuotas vigentes.
        const e = await prepararEmpresasGt()
        const proveedor = await proveedorEn(e.B, e.ctx)
        const compra = await new RegistrarCompra().execute(
            {
                proveedor_id: proveedor.id,
                tipo_documento: 'FACT',
                numero: await unicoBd('H20'),
                fecha_documento: haceMeses(6, 5),
                condicion: 'credito',
                retenciones: [],
                lineas: [
                    {
                        descripcion: 'OLT',
                        tipo: 'activo_fijo',
                        clase_activo: 'equipo_red',
                        total: '11200.00',
                    },
                ],
            },
            e.ctx,
        )
        const fila = await db.from('ledger.activos').where('compra_id', compra.id).select('id').firstOrFail()
        const corrida = await new DepreciarActivos().execute({ empresa_id: e.B }, e.ctx)
        assert.equal(corrida.cuotas, 5)
        const baja = await new DarDeBajaActivo().execute(
            {
                activo_id: Number(fila.id),
                tipo: 'retiro',
                motivo: 'robado en el nodo',
                fecha: haceMeses(3, 10),
            },
            e.ctx,
        )
        const activo = await verActivo(Number(fila.id))
        // al 10 del mes −3 solo correspondían 2 cuotas (meses −5 y −4): 166.66
        assert.deepEqual(await verificarLibro(e.B), [])
        assert.equal(
            baja.baja!.valor_libros,
            '9833.34',
            `acumulada ${activo.depreciacion_acumulada} con ${activo.cuotas} cuotas`,
        )
        assert.equal(activo.cuotas, 2)
        const reversos = (await db
            .from('ledger.activos_cuotas as q')
            .join('ledger.asientos as a', 'a.id', 'q.asiento_id')
            .join('ledger.asientos as r', 'r.reversa_de', 'q.asiento_id')
            .where('q.activo_id', Number(fila.id))
            .select(
                db.raw(`to_char(a.fecha, 'YYYY-MM-DD') as original`),
                db.raw(`to_char(r.fecha, 'YYYY-MM-DD') as reverso`),
            )) as Array<{
            original: string
            reverso: string
        }>
        assert.lengthOf(reversos, 3)
        for (const r of reversos) assert.equal(r.reverso, r.original, 'cada reverso en el mes de su cuota')
        // la depreciación no vuelve a registrar los meses revertidos
        const otra = await new DepreciarActivos().execute({ empresa_id: e.B }, e.ctx)
        assert.equal(otra.cuotas, 0)
        assert.deepEqual(await verificarLibro(e.B), [])
    })

    test('lock por activo: la depreciación que espera a la anulación de la compra no registra una cuota sobre el activo anulado', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const proveedor = await proveedorEn(e.B, e.ctx)
        const compra = await new RegistrarCompra().execute(
            {
                proveedor_id: proveedor.id,
                tipo_documento: 'FACT',
                numero: await unicoBd('LCK'),
                fecha_documento: haceMeses(3, 5),
                condicion: 'credito',
                retenciones: [],
                lineas: [
                    {
                        descripcion: 'OLT',
                        tipo: 'activo_fijo',
                        clase_activo: 'equipo_red',
                        total: '11200.00',
                    },
                ],
            },
            e.ctx,
        )
        const fila = await db.from('ledger.activos').where('compra_id', compra.id).select('id').firstOrFail()
        const trx = await db.transaction()
        let depreciacion: Promise<unknown> | null = null
        try {
            await new AnularCompra().execute(
                { compra_id: compra.id, motivo: 'documento equivocado' },
                e.ctx,
                { trx },
            )
            // la depreciación corre en otra conexión mientras la anulación no ha confirmado
            depreciacion = new DepreciarActivos().execute({ empresa_id: e.B }, e.ctx)
            await new Promise((listo) => setTimeout(listo, 400))
            await trx.commit()
        } catch (error) {
            await trx.rollback()
            throw error
        }
        await depreciacion
        const cuotas = await db.from('ledger.activos_cuotas').where('activo_id', Number(fila.id))
        assert.lengthOf(cuotas, 0, 'ninguna cuota sobre el activo de la compra anulada')
        assert.deepEqual(await verificarLibro(e.B), [])
    })
})
