import { test } from '@japa/runner'
import { soloEmpresaPrincipal } from '#tests/ayudas'
import { crearClienteFila } from '#tests/core/fabricas'
import RegistrarPago from '#billing/actions/registrar_pago'
import CastigarCartera from '#ledger/actions/castigar_cartera'
import { saldoCuenta, sacarDeLaColaFel } from '#tests/contabilidad/ayudas_contabilidad'
import { verificarLibro } from '#tests/contabilidad/verificar_libro'
import { cola, datosNit, dtesDe, empresasFel, servicioFel } from '#tests/fiscal/ayudas_fel'
import { haceMeses, partidas, proveedorEn } from '#tests/ledger/ayudas_compras'
import { unico } from '#tests/ayudas'
import { verActivo } from '#ledger/activos'
import db from '@adonisjs/lucid/services/db'
import RegistrarCompra from '#ledger/actions/registrar_compra'
import DepreciarActivos from '#ledger/actions/depreciar_activos'
import DarDeBajaActivo from '#ledger/actions/dar_de_baja_activo'
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'

/**
 * Auditor contable · HALLAZGOS de la fase 5 (compras, retenciones, activos y diferidos;
 * `a3/fase5-compras`). `.fails(motivo)` mientras el hallazgo exista; su invariante está en
 * `HALLAZGOS_ABIERTOS` y la prueba lo enciende.
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

    test('H19 (caso B) · retención de IVA recibida en el pago que recupera un aviso castigado sin DTE: 1.1.05 por un IVA que nunca se declaró', async ({
        assert,
    }) => {
        // Producto: app/billing/actions/registrar_pago.ts + app/ledger/retenciones.ts (validarRetencionesRecibidas no
        // mira qué documento cubre la constancia) y app/ledger/cartera.ts (H17: el IVA recuperado vuelve a 2.1.11).
        // El aviso castigado nunca tendrá DTE (la cola omite las castigadas): el IVA de lo recuperado queda en 2.1.11
        // sin documento y la constancia lleva 1.1.05 (crédito contra la SAT) por una retención sobre un IVA que no se
        // declara; la constancia no tiene DTE al que referir.
        const e = await empresasFel('obligatoria')
        const s = await servicioFel(e, 'pagar', '150.00', await crearClienteFila(datosNit()))
        const k = await new CastigarCartera().execute(
            { facturas: [s.facturas[0]!.id], motivo: 'incobrable', evidencia: 'gestión documentada' },
            e.ctx,
        )
        assert.equal(k.iva, '16.07')
        const pago = await new RegistrarPago().execute(
            {
                cliente_id: s.clienteId,
                metodo: 'caja',
                monto: '140.00',
                empresa_id: e.B,
                retenciones: [{ codigo: 'RET_IVA_ESP', numero: 'CT-H19B', monto: '10.00' }],
            },
            e.ctx,
        )
        // asiento resultante (hoy): Caja 140.00 + 1.1.05 10.00 / 4.2.03 133.93 + 2.1.11 16.07
        const asiento = await partidas('pago', pago.id)
        const lineas = asiento.map(([c, d, h]) => `${c} ${d}/${h}`)
        assert.includeMembers(lineas, ['4.2.03 0.00/133.93', '2.1.11 0.00/16.07', '1.1.05 10.00/0.00'])
        await cola(e)
        assert.lengthOf(
            await dtesDe('factura', s.facturas[0]!.id),
            0,
            'el aviso castigado nunca se certifica',
        )
        assert.deepEqual(await verificarLibro(e.B, { incluirHallazgosAbiertos: true }), [])
    }).fails(
        'H19: constancia de IVA recibida sobre IVA recuperado de un aviso castigado sin DTE (15.retencion_iva_sin_dte)',
    )

    test('H20 · una baja con fecha anterior a cuotas ya registradas deja depreciado el activo después de su baja', async ({
        assert,
    }) => {
        // Producto: app/ledger/actions/dar_de_baja_activo.ts acepta cualquier fecha ≤ hoy y deprecia «hasta el mes anterior
        // al de la baja», pero no mira las cuotas que el cron ya registró de ese mes en adelante: la baja cancela una
        // depreciación acumulada que incluye meses en que el activo ya no estaba (gasto 5.3.01 de más y resultado de la
        // baja de menos). Debería rechazar la fecha (422) o revertir esas cuotas.
        const e = await prepararEmpresasGt()
        const proveedor = await proveedorEn(e.B, e.ctx)
        const compra = await new RegistrarCompra().execute(
            {
                proveedor_id: proveedor.id,
                tipo_documento: 'FACT',
                numero: unico('H20'),
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
        assert.deepEqual(await verificarLibro(e.B, { incluirHallazgosAbiertos: true }), [])
        assert.equal(
            baja.baja!.valor_libros,
            '9833.34',
            `acumulada ${activo.depreciacion_acumulada} con ${activo.cuotas} cuotas`,
        )
    }).fails('H20: la baja retroactiva conserva las cuotas posteriores (15.cuota_posterior_a_la_baja)')
})
