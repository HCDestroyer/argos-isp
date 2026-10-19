import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { soloEmpresaPrincipal, unico } from '#tests/ayudas'
import { crearClienteFila } from '#tests/core/fabricas'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import { verActivo } from '#ledger/activos'
import RegistrarPago from '#billing/actions/registrar_pago'
import CastigarCartera from '#ledger/actions/castigar_cartera'
import RegistrarCompra from '#ledger/actions/registrar_compra'
import DepreciarActivos from '#ledger/actions/depreciar_activos'
import DarDeBajaActivo from '#ledger/actions/dar_de_baja_activo'
import RegistrarPagoProveedor from '#ledger/actions/registrar_pago_proveedor'
import CerrarPeriodo from '#ledger/actions/cerrar_periodo'
import { errorDe, sacarDeLaColaFel, saldoCuenta } from '#tests/contabilidad/ayudas_contabilidad'
import { afirmarLibro, verificarLibro } from '#tests/contabilidad/verificar_libro'
import { datosNit, empresasFel, servicioFel } from '#tests/fiscal/ayudas_fel'
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'
import { haceMeses, partidas, proveedorEn } from '#tests/ledger/ayudas_compras'
import type { ContextoAccion } from '#shared/contexto'

/**
 * Fase 5 · decisiones del líder sobre los hallazgos del auditor: H19 (constancia de IVA sobre lo
 * recuperado de un aviso castigado sin DTE), H20 (baja retroactiva de un activo) y sus
 * observaciones (un mismo lock por activo; un pago a proveedor no precede a su compra).
 */

const DEPRECIACIONES = CUENTAS_GT.DEPRECIACIONES

async function activoDepreciado(ctx: ContextoAccion, empresaId: number) {
    const proveedor = await proveedorEn(empresaId, ctx)
    const compra = await new RegistrarCompra().execute(
        {
            proveedor_id: proveedor.id,
            tipo_documento: 'FACT',
            numero: unico('H20'),
            fecha_documento: haceMeses(6, 5),
            condicion: 'credito',
            retenciones: [],
            lineas: [
                { descripcion: 'OLT', tipo: 'activo_fijo', clase_activo: 'equipo_red', total: '11200.00' },
            ],
        },
        ctx,
    )
    const fila = await db.from('ledger.activos').where('compra_id', compra.id).select('id').firstOrFail()
    const corrida = await new DepreciarActivos().execute({ empresa_id: empresaId }, ctx)
    return { activoId: Number(fila.id), cuotas: corrida.cuotas }
}

test.group('Fase 5 · hallazgos H19 y H20', (group) => {
    group.each.teardown(async () => {
        await sacarDeLaColaFel()
        await soloEmpresaPrincipal()
    })

    test('H19 · constancia de IVA en el pago que recupera un aviso castigado sin DTE: 422 retencion_sin_documento_fiscal; la de ISR sigue', async ({
        assert,
    }) => {
        const e = await empresasFel('obligatoria')
        const s = await servicioFel(e, 'pagar', '150.00', await crearClienteFila(datosNit()))
        const k = await new CastigarCartera().execute(
            { facturas: [s.facturas[0]!.id], motivo: 'incobrable', evidencia: 'gestión documentada' },
            e.ctx,
        )
        assert.equal(k.iva, '16.07')
        const conIva = await errorDe(
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
        assert.equal(conIva.status, 422)
        assert.equal(conIva.codigo, 'retencion_sin_documento_fiscal')
        assert.deepEqual(conIva.reglas, ['documento_fiscal'])
        const registrados = await db.from('billing.pagos').where('cliente_id', s.clienteId).select('id')
        assert.lengthOf(registrados, 0, 'nada quedó registrado')

        // la de ISR no depende del DTE: se registra y la recuperación parte base e IVA como siempre
        const pago = await new RegistrarPago().execute(
            {
                cliente_id: s.clienteId,
                metodo: 'caja',
                monto: '140.00',
                empresa_id: e.B,
                retenciones: [{ codigo: 'RET_ISR_OPC', numero: 'CT-H19-ISR', monto: '10.00' }],
            },
            e.ctx,
        )
        const asiento = await partidas('pago', pago.id)
        const lineas = asiento.map(([c, d, h]) => `${c} ${d}/${h}`)
        assert.includeMembers(lineas, ['4.2.03 0.00/133.93', '2.1.11 0.00/16.07', '1.1.06 10.00/0.00'])
        await afirmarLibro(assert, e.B)
    })

    test('H20 · baja con fecha anterior a cuotas registradas: revierte del mes de la baja en adelante, cada reverso en su mes', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const { activoId, cuotas } = await activoDepreciado(e.ctx, e.B)
        assert.equal(cuotas, 5)
        const gastoAntes = await saldoCuenta(e.B, DEPRECIACIONES)
        const baja = await new DarDeBajaActivo().execute(
            { activo_id: activoId, tipo: 'retiro', motivo: 'robado en el nodo', fecha: haceMeses(3, 10) },
            e.ctx,
        )
        // al 10 del mes −3 solo correspondían 2 cuotas (meses −5 y −4): 166.66
        assert.equal(baja.baja!.valor_libros, '9833.34')
        const activo = await verActivo(activoId)
        assert.equal(activo.depreciacion_acumulada, '166.66')
        assert.equal(activo.cuotas, 2)
        assert.equal(activo.ultima_cuota, haceMeses(4))

        // tres reversos (meses −3, −2 y −1), cada uno con la fecha de su cuota
        const reversos = (await db
            .from('ledger.activos_cuotas as q')
            .join('ledger.asientos as o', 'o.id', 'q.asiento_id')
            .join('ledger.asientos as r', 'r.reversa_de', 'o.id')
            .where('q.activo_id', activoId)
            .orderBy('q.mes')
            .select(
                db.raw(`to_char(q.mes, 'YYYY-MM-DD') as mes`),
                db.raw(`(r.fecha = o.fecha) as misma_fecha`),
                'r.origen_tipo',
            )) as Array<{ mes: string; misma_fecha: boolean; origen_tipo: string }>
        assert.deepEqual(
            reversos.map((r) => [r.mes, r.misma_fecha, r.origen_tipo]),
            [
                [haceMeses(3), true, 'depreciacion'],
                [haceMeses(2), true, 'depreciacion'],
                [haceMeses(1), true, 'depreciacion'],
            ],
        )
        // el gasto de los meses sin activo se devuelve: 3 × 83.33
        assert.equal(
            (Number(gastoAntes) - Number(await saldoCuenta(e.B, DEPRECIACIONES))).toFixed(2),
            '249.99',
        )
        // repetir el cron no vuelve a depreciar el activo dado de baja
        const repetida = await new DepreciarActivos().execute({ empresa_id: e.B }, e.ctx)
        assert.equal(repetida.cuotas, 0)
        // auditor: `15.cuota_posterior_a_la_baja` y `15.baja_de_activo_mal_contabilizada` cuentan solo las
        // cuotas vigentes; una revertida exige su baja, un solo reverso y la fecha de su cuota
        assert.deepEqual(await verificarLibro(e.B), [])
    })

    test('H20 · si una cuota a revertir está en un periodo cerrado: 422 periodo_cerrado con el mes; nada cambia', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const { activoId } = await activoDepreciado(e.ctx, e.B)
        for (let m = 7; m >= 2; m--) {
            const mes = haceMeses(m)
            await new CerrarPeriodo().execute(
                { empresa_id: e.B, anio: Number(mes.slice(0, 4)), mes: Number(mes.slice(5, 7)) },
                e.ctx,
            )
        }
        const cerrado = await errorDe(
            new DarDeBajaActivo().execute(
                { activo_id: activoId, tipo: 'retiro', motivo: 'robado', fecha: haceMeses(3, 10) },
                e.ctx,
            ),
        )
        assert.equal(cerrado.status, 422)
        assert.equal(cerrado.codigo, 'periodo_cerrado')
        assert.deepEqual(cerrado.reglas, ['periodo_cerrado', 'periodo_cerrado'])
        assert.notExists(await db.from('ledger.activos_bajas').where('activo_id', activoId).first())
        const intacto = await verActivo(activoId)
        assert.equal(intacto.cuotas, 5)
        // del mes −1 (abierto) en adelante sí: revierte una cuota
        const baja = await new DarDeBajaActivo().execute(
            { activo_id: activoId, tipo: 'retiro', motivo: 'robado', fecha: haceMeses(1, 10) },
            e.ctx,
        )
        assert.equal(baja.depreciacion_acumulada, '333.32')
        assert.equal(baja.cuotas, 4)
    })

    test('observación del auditor · un pago a proveedor con fecha anterior a la compra que aplica: 422 pago_anterior_a_compra', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const proveedor = await proveedorEn(e.B, e.ctx)
        const compra = await new RegistrarCompra().execute(
            {
                proveedor_id: proveedor.id,
                tipo_documento: 'FACT',
                numero: unico('F'),
                fecha_documento: haceMeses(0),
                condicion: 'credito',
                retenciones: [],
                lineas: [{ descripcion: 'Tránsito', categoria: 'transito', total: '560.00' }],
            },
            e.ctx,
        )
        const pedido = {
            proveedor_id: proveedor.id,
            monto: '560.00',
            metodo: 'cuenta_bancaria' as const,
            cuenta_bancaria_id: e.cuentas.get(e.B)!,
        }
        const antes = await errorDe(
            new RegistrarPagoProveedor().execute({ ...pedido, fecha: haceMeses(1, 20) }, e.ctx),
        )
        assert.equal(antes.status, 422)
        assert.equal(antes.codigo, 'pago_anterior_a_compra')
        assert.deepEqual(antes.reglas, ['pago_anterior_a_compra'])
        const pago = await new RegistrarPagoProveedor().execute({ ...pedido, fecha: haceMeses(0) }, e.ctx)
        assert.deepEqual(
            pago.aplicaciones.map((a) => [a.compra_id, a.monto]),
            [[compra.id, '560.00']],
        )
        await afirmarLibro(assert, e.B)
    })
})
