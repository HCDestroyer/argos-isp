import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { soloEmpresaPrincipal } from '#tests/ayudas'
import RegistrarPago from '#billing/actions/registrar_pago'
import ActualizarLocalizacion from '#fiscal/actions/actualizar_localizacion'
import EditarParametro from '#fiscal/actions/editar_parametro'
import EditarImpuesto from '#fiscal/actions/editar_impuesto'
import SellarAsientos from '#ledger/actions/sellar_asientos'
import { valorParametro } from '#fiscal/parametros'
import { impuesto } from '#fiscal/impuestos'
import { CUENTAS } from '#ledger/plan_cuentas'
import { HASH_INICIAL, asientosCanonicos, calcularHash, verificarCadena } from '#ledger/sellos'
import { prepararEmpresas, servicioFacturado } from '#tests/contabilidad/ayudas_contabilidad'
import {
    afirmarLibro,
    compararFotoLibro,
    fotoLibro,
    marcasAuditoria,
} from '#tests/contabilidad/verificar_libro'

/**
 * Auditor contable · invariantes de la localización fiscal, fase 2 (contrato §4, §10.10 y §12),
 * activados desde `pendientes_fases.spec.ts`. Cada uno arma su escenario con las acciones y termina
 * en `afirmarLibro`.
 */

async function cuentasGt() {
    return (await db
        .from('ledger.cuentas')
        .orderBy('id')
        .select('id', 'codigo', 'tipo', 'naturaleza', 'pais')) as Array<Record<string, unknown>>
}

test.group('Auditor contable · fase 2 (localización fiscal)', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('instalar gt-2026.1 dos veces no agrega cuentas ni cambia CUENTAS.*', async ({ assert }) => {
        const e = await prepararEmpresas()
        const s = await servicioFacturado(e.B, '2026-10-01', { precio: '150.00', instalacion: '2026-10-01' })
        await new RegistrarPago().execute(
            { cliente_id: s.clienteId, metodo: 'caja', monto: '150.00', empresa_id: e.B },
            e.ctx,
        )
        const marcas = await marcasAuditoria()
        const antesLibro = await fotoLibro([e.B], marcas.acciones, marcas.outbox)
        const primera = await new ActualizarLocalizacion().execute({ empresa_id: e.B }, e.ctx)
        const cuentas = await cuentasGt()
        const segunda = await new ActualizarLocalizacion().execute({ empresa_id: e.B }, e.ctx)
        assert.isFalse(primera.resumen.ya_instalada)
        assert.isTrue(segunda.resumen.ya_instalada)
        assert.deepEqual(segunda.resumen.cuentas, [])
        assert.deepEqual(await cuentasGt(), cuentas)

        // los códigos de CUENTAS de hoy conservan id, tipo y naturaleza; las de patrimonio no tienen movimientos
        const porCodigo = new Map(cuentas.map((c) => [String(c.codigo), c]))
        for (const codigo of Object.values(CUENTAS)) {
            assert.isDefined(porCodigo.get(codigo), codigo)
            assert.equal(porCodigo.get(codigo)!.pais, 'GT')
        }
        const patrimonio = await db
            .from('ledger.movimientos as m')
            .join('ledger.cuentas as c', 'c.id', 'm.cuenta_id')
            .where('c.tipo', 'patrimonio')
            .count('* as n')
            .first()
        assert.equal(Number(patrimonio.n), 0)

        assert.deepEqual(
            compararFotoLibro(antesLibro, await fotoLibro([e.B], marcas.acciones, marcas.outbox)),
            [],
        )
        await afirmarLibro(assert, e.B)
    })

    test('un parámetro con vigencia futura no cambia el pasado', async ({ assert }) => {
        const e = await prepararEmpresas()
        await new ActualizarLocalizacion().execute({ empresa_id: e.B }, e.ctx)
        const ctx = { ...e.ctx, empresaId: e.B }
        const antes = await servicioFacturado(e.B, '2026-10-01', {
            precio: '150.00',
            instalacion: '2026-09-01',
        })

        const ventana = await valorParametro(e.B, 'credito_fiscal_ventana_meses', '2026-10-01')
        await new EditarParametro().execute(
            {
                clave: 'credito_fiscal_ventana_meses',
                valor: 3,
                vigente_desde: '2099-01-01',
                motivo: 'Reforma',
            },
            ctx,
        )
        await new EditarImpuesto().execute(
            {
                codigo: 'IVA12',
                tasa: '13.00',
                vigente_desde: '2099-01-01',
                motivo: 'Reforma',
                empresa_id: e.B,
            },
            ctx,
        )
        // el valor de cada fecha sigue siendo el suyo
        assert.equal(await valorParametro(e.B, 'credito_fiscal_ventana_meses', '2026-10-01'), ventana)
        assert.equal(await valorParametro(e.B, 'credito_fiscal_ventana_meses', '2099-01-01'), 3)
        assert.equal(await impuesto(e.B, 'IVA12', '2026-10-01').then((r) => r.tasa), '12.00')
        assert.equal(await impuesto(e.B, 'IVA12', '2099-01-01').then((r) => r.tasa), '13.00')

        // facturar después con la versión futura ya registrada da el mismo IVA que antes
        const despues = await servicioFacturado(e.B, '2026-10-01', {
            precio: '150.00',
            instalacion: '2026-09-01',
        })
        assert.deepEqual(
            despues.facturas.map((f) => [f.total, f.iva]),
            antes.facturas.map((f) => [f.total, f.iva]),
        )
        assert.isTrue(antes.facturas.every((f) => f.iva === '16.07'))

        // los valores con vigencia son solo inserción
        for (const sql of [
            `UPDATE fiscal.parametros_valores SET motivo = 'x' WHERE empresa_id = ${e.B}`,
            `DELETE FROM fiscal.parametros_valores WHERE empresa_id = ${e.B}`,
        ]) {
            const trx = await db.transaction()
            await assert.rejects(() => trx.rawQuery(sql))
            await trx.rollback()
        }
        await afirmarLibro(assert, e.B)
    })

    test('la cadena de hash de los asientos es íntegra', async ({ assert }) => {
        const e = await prepararEmpresas()
        const s = await servicioFacturado(e.B, '2026-10-01', { precio: '150.00', instalacion: '2026-08-01' })
        await new RegistrarPago().execute(
            { cliente_id: s.clienteId, metodo: 'caja', monto: '200.00', empresa_id: e.B },
            e.ctx,
        )
        await new SellarAsientos().execute({ empresa_id: e.B }, e.ctx)

        // recalcular toda la cadena desde el primer asiento da el mismo último hash
        const sellos = (await db
            .from('ledger.asientos_sellos')
            .where('empresa_id', e.B)
            .orderBy('sello')
            .select('asiento_id', 'sello', 'hash')) as Array<{
            asiento_id: number
            sello: number
            hash: string
        }>
        const asientos = await db.from('ledger.asientos').where('empresa_id', e.B).count('* as n').first()
        assert.lengthOf(sellos, Number(asientos.n))
        const canonicos = await asientosCanonicos(
            db.connection(),
            sellos.map((x) => Number(x.asiento_id)),
        )
        let hash = HASH_INICIAL
        for (const sello of sellos) hash = calcularHash(hash, canonicos.get(Number(sello.asiento_id))!)
        assert.equal(hash, sellos.at(-1)!.hash)
        const verificada = await verificarCadena(e.B)
        assert.isTrue(verificada.verificado)
        assert.equal(verificada.ultimo_hash, hash)

        // cualquier alteración (aun como dueño de las tablas) rompe la verificación en ese sello
        const victima = sellos[1]!
        const trx = await db.transaction()
        await trx.rawQuery(`ALTER TABLE ledger.movimientos DISABLE TRIGGER movimientos_inmutable`)
        await trx.rawQuery(
            `UPDATE ledger.movimientos SET cliente_id = cliente_id WHERE asiento_id = ? AND cliente_id IS NOT NULL`,
            [victima.asiento_id],
        )
        await trx.rawQuery(
            `UPDATE ledger.movimientos SET cuadricula = '+V_BASE', impuesto_codigo = 'IVA12'
              WHERE id = (SELECT min(id) FROM ledger.movimientos WHERE asiento_id = ?)`,
            [victima.asiento_id],
        )
        const rota = await verificarCadena(e.B, {}, trx)
        await trx.rollback()
        assert.containSubset(rota, {
            verificado: false,
            ruptura: { sello: victima.sello, motivo: 'hash_distinto' },
        })
        assert.isTrue(await verificarCadena(e.B).then((r) => r.verificado))
        await afirmarLibro(assert, e.B)
    })
})
