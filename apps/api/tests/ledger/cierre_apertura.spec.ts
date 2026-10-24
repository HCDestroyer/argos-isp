import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, soloEmpresaPrincipal, unico, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila } from '#tests/core/fabricas'
import { errorDe, saldoCuenta } from '#tests/contabilidad/ayudas_contabilidad'
import { afirmarLibro } from '#tests/contabilidad/verificar_libro'
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'
import ImportarFacturaPendiente from '#billing/actions/importar_factura_pendiente'
import RegistrarSaldoInicial from '#billing/actions/registrar_saldo_inicial'
import CerrarApertura from '#ledger/actions/cerrar_apertura'
import CerrarPeriodo from '#ledger/actions/cerrar_periodo'
import RevertirAsiento from '#ledger/actions/revertir_asiento'
import VerificarCierre from '#ledger/actions/verificar_cierre'
import type { ContextoAccion } from '#shared/contexto'

/**
 * Cierre de los saldos de apertura (contrato de localización fiscal §23): `libro.cerrar_apertura`
 * traslada el saldo neto de 2.9.01 a patrimonio, deja `apertura_cero` en ok, es idempotente, respeta
 * el mes cerrado y no toca la otra empresa. Cada prueba termina en `afirmarLibro`.
 */

async function importar(
    ctx: ContextoAccion,
    empresaId: number,
    clienteId: number,
    fecha: string,
    total: string,
) {
    return new ImportarFacturaPendiente().execute(
        {
            origen: 'prueba_apertura',
            id_externo: unico('f'),
            cliente_id: clienteId,
            empresa_id: empresaId,
            cargo_unico: true,
            emitida_en: fecha,
            total,
        },
        ctx,
    )
}

async function tienePermiso(rol: string, permiso: string): Promise<boolean> {
    const fila = await db
        .from('core.roles_permisos as rp')
        .join('core.roles as r', 'r.id', 'rp.role_id')
        .join('core.permisos as p', 'p.id', 'rp.permiso_id')
        .where('r.nombre', rol)
        .where('p.nombre', permiso)
        .first()
    return Boolean(fila)
}

async function apertura(empresaId: number, hasta: string): Promise<string> {
    const fila = (await db
        .from('ledger.movimientos as m')
        .join('ledger.asientos as a', 'a.id', 'm.asiento_id')
        .join('ledger.cuentas as c', 'c.id', 'm.cuenta_id')
        .where('a.empresa_id', empresaId)
        .where('c.codigo', '2.9.01')
        .where('a.fecha', '<=', hasta)
        .select(db.raw('coalesce(sum(m.debe - m.haber), 0)::numeric(14,2)::text as s'))
        .firstOrFail()) as { s: string }
    return fila.s
}

test.group('Libro · cierre de los saldos de apertura (§23)', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('traslada 2.9.01 a 3.3.01, apertura_cero pasa y repetir no escribe', async ({ assert }) => {
        const e = await prepararEmpresasGt()
        const clienteB = await crearClienteFila()
        const clienteC = await crearClienteFila()
        await importar(e.ctx, e.B, clienteB, '2026-09-05', '300.00')
        await importar(e.ctx, e.B, clienteB, '2026-09-08', '50.25')
        // saldo a favor importado: 2.9.01 / Anticipos (resta del acreedor)
        await new RegistrarSaldoInicial().execute(
            {
                origen: 'prueba_apertura',
                id_externo: unico('s'),
                cliente_id: clienteB,
                empresa_id: e.B,
                monto: '-20.00',
                fecha: '2026-09-09',
            },
            e.ctx,
        )
        await importar(e.ctx, e.C, clienteC, '2026-09-05', '99.00')
        assert.equal(await apertura(e.B, '2026-09-30'), '-330.25')

        const antes = await new VerificarCierre().execute(
            { empresa_id: e.B, tipo: 'mensual', periodo: '2026-09' },
            e.ctx,
        )
        assert.equal(antes.checks.find((c) => c.clave === 'apertura_cero')?.estado, 'anomalia')

        const cierre = await new CerrarApertura().execute(
            { empresa_id: e.B, fecha: '2026-09-30', nota: 'importación terminada' },
            e.ctx,
        )
        assert.equal(cierre.trasladado, '-330.25')
        assert.equal(cierre.saldo, '0.00')
        assert.equal(cierre.cuenta_destino, '3.3.01')
        assert.isNotNull(cierre.asiento)
        assert.equal(cierre.asiento!.origen_tipo, 'ajuste')
        assert.equal(cierre.asiento!.diario, 'VAR')
        assert.deepEqual(
            cierre.asiento!.movimientos.map((m) => [m.cuenta_codigo, m.debe, m.haber]),
            [
                ['2.9.01', '330.25', '0.00'],
                ['3.3.01', '0.00', '330.25'],
            ],
        )
        assert.deepEqual(
            cierre.cierres.map((c) => [c.asiento_id, c.cuenta_destino, c.monto]),
            [[cierre.asiento!.id, '3.3.01', '-330.25']],
        )
        assert.equal(await saldoCuenta(e.B, '3.3.01'), '-330.25')
        // la otra empresa no se toca
        assert.equal(await apertura(e.C, '2026-09-30'), '-99.00')

        const despues = await new VerificarCierre().execute(
            { empresa_id: e.B, tipo: 'mensual', periodo: '2026-09' },
            e.ctx,
        )
        assert.equal(despues.checks.find((c) => c.clave === 'apertura_cero')?.estado, 'revisado')

        // idempotente: sin saldo no escribe
        const asientos = await db
            .from('ledger.asientos')
            .where('empresa_id', e.B)
            .count('* as n')
            .firstOrFail()
        const otra = await new CerrarApertura().execute({ empresa_id: e.B, fecha: '2026-09-30' }, e.ctx)
        assert.isNull(otra.asiento)
        assert.equal(otra.trasladado, '0.00')
        assert.lengthOf(otra.cierres, 1)
        const luego = await db.from('ledger.asientos').where('empresa_id', e.B).count('* as n').firstOrFail()
        assert.equal(luego.n, asientos.n)

        const auditoria = await db
            .from('audit.acciones')
            .where('accion', 'libro.cerrar_apertura')
            .where('entidad_id', cierre.asiento!.id)
            .count('* as n')
            .firstOrFail()
        assert.equal(Number(auditoria.n), 1)

        await afirmarLibro(assert, [e.B, e.C])
    })

    test('saldo deudor va a capital; el reverso lo deja de nuevo para volver a cerrar', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const cliente = await crearClienteFila()
        await new RegistrarSaldoInicial().execute(
            {
                origen: 'prueba_apertura',
                id_externo: unico('s'),
                cliente_id: cliente,
                empresa_id: e.B,
                monto: '-75.00',
                fecha: '2026-09-02',
            },
            e.ctx,
        )
        const cierre = await new CerrarApertura().execute(
            { empresa_id: e.B, fecha: '2026-09-30', cuenta_destino: '3.1.01' },
            e.ctx,
        )
        assert.equal(cierre.trasladado, '75.00')
        assert.deepEqual(
            cierre.asiento!.movimientos.map((m) => [m.cuenta_codigo, m.debe, m.haber]),
            [
                ['3.1.01', '75.00', '0.00'],
                ['2.9.01', '0.00', '75.00'],
            ],
        )
        await new RevertirAsiento().execute(
            { asiento_id: cierre.asiento!.id, motivo: 'iba a utilidades', fecha: '2026-09-30' },
            e.ctx,
        )
        assert.equal(await apertura(e.B, '2026-09-30'), '75.00')
        const otra = await new CerrarApertura().execute({ empresa_id: e.B, fecha: '2026-09-30' }, e.ctx)
        assert.equal(otra.cuenta_destino, '3.3.01')
        assert.deepEqual(
            otra.cierres.map((c) => [c.cuenta_destino, c.monto]),
            [['3.3.01', '75.00']],
        )
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('respeta el mes cerrado, la fecha futura y la cuenta destino', async ({ assert }) => {
        const e = await prepararEmpresasGt()
        const cliente = await crearClienteFila()
        await importar(e.ctx, e.B, cliente, '2026-08-05', '40.00')
        // agosto se cierra con la anomalía supervisada (importación en curso)
        const verificacion = await new VerificarCierre().execute(
            { empresa_id: e.B, tipo: 'mensual', periodo: '2026-08' },
            e.ctx,
        )
        const { default: RevisarCheck } = await import('#ledger/actions/revisar_check')
        for (const check of verificacion.checks.filter((c) => c.estado === 'anomalia')) {
            await new RevisarCheck().execute(
                { check_id: check.id, estado: 'supervisado', nota: 'importación en curso' },
                e.ctx,
            )
        }
        await new CerrarPeriodo().execute({ empresa_id: e.B, anio: 2026, mes: 8 }, e.ctx)

        const cerrado = await errorDe(
            new CerrarApertura().execute({ empresa_id: e.B, fecha: '2026-08-31' }, e.ctx),
        )
        assert.equal(cerrado.status, 422)
        assert.equal(cerrado.codigo, 'periodo_cerrado')
        const futuro = await errorDe(
            new CerrarApertura().execute({ empresa_id: e.B, fecha: '2999-01-01' }, e.ctx),
        )
        assert.deepEqual([futuro.status, futuro.reglas], [422, ['futuro']])
        const destino = await errorDe(
            new CerrarApertura().execute(
                { empresa_id: e.B, fecha: '2026-09-01', cuenta_destino: '3.3.03' as '3.3.01' },
                e.ctx,
            ),
        )
        assert.deepEqual([destino.status, destino.reglas], [422, ['enum']])

        // en el primer día abierto sí
        const cierre = await new CerrarApertura().execute({ empresa_id: e.B, fecha: '2026-09-01' }, e.ctx)
        assert.equal(cierre.trasladado, '-40.00')
        assert.equal(await apertura(e.B, '2026-09-01'), '0.00')
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('HTTP: permiso, Idempotency-Key, lectura y empresa', async ({ assert, client }) => {
        const e = await prepararEmpresasGt()
        const cliente = await crearClienteFila()
        await importar(e.ctx, e.B, cliente, '2026-09-05', '120.00')
        const { token: contador } = await usuarioConRoles(['contabilidad'])
        const { token: cajero } = await usuarioConRoles(['cajero'])
        assert.isTrue(await tienePermiso('contabilidad', 'libro.cerrar_apertura'))
        assert.isFalse(await tienePermiso('cajero', 'libro.cerrar_apertura'))

        await estado(
            client
                .post('/api/v1/libro/apertura/cerrar')
                .bearerToken(cajero)
                .header('X-Empresa-Id', String(e.B))
                .json({ fecha: '2026-09-30' }),
            403,
        )
        const leido = await estado(
            client
                .get('/api/v1/libro/apertura')
                .bearerToken(contador)
                .header('X-Empresa-Id', String(e.B))
                .qs({
                    fecha: '2026-09-30',
                }),
            200,
        )
        assert.deepEqual([leido.body().saldo, leido.body().cierres], ['-120.00', []])

        const clave = unico('k')
        const primero = await estado(
            client
                .post('/api/v1/libro/apertura/cerrar')
                .bearerToken(contador)
                .header('X-Empresa-Id', String(e.B))
                .header('Idempotency-Key', clave)
                .json({ fecha: '2026-09-30' }),
            200,
        )
        const repetido = await estado(
            client
                .post('/api/v1/libro/apertura/cerrar')
                .bearerToken(contador)
                .header('X-Empresa-Id', String(e.B))
                .header('Idempotency-Key', clave)
                .json({ fecha: '2026-09-30' }),
            200,
        )
        assert.equal(primero.body().asiento.id, repetido.body().asiento.id)
        assert.equal(primero.body().trasladado, '-120.00')

        const leidoC = await estado(
            client.get('/api/v1/libro/apertura').bearerToken(contador).header('X-Empresa-Id', String(e.C)),
            200,
        )
        assert.deepEqual([leidoC.body().empresa_id, leidoC.body().saldo], [e.C, '0.00'])
        await afirmarLibro(assert, [e.B, e.C])
    })
})
