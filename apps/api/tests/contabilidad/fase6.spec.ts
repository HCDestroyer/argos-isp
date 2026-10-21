import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'
import { contextoPrueba, soloEmpresaPrincipal, usuarioConRoles } from '#tests/ayudas'
import { errorDe, prepararEmpresas } from '#tests/contabilidad/ayudas_contabilidad'
import { afirmarLibro, verificarLibro } from '#tests/contabilidad/verificar_libro'
import { hoyGuatemala } from '#ledger/fechas'
import RegistrarAsiento from '#ledger/actions/registrar_asiento'
import RevertirAsiento from '#ledger/actions/revertir_asiento'
import CerrarPeriodo from '#ledger/actions/cerrar_periodo'
import ReabrirPeriodo from '#ledger/actions/reabrir_periodo'
import BloquearLibro from '#ledger/actions/bloquear_libro'
import BloquearDuro from '#ledger/actions/bloquear_duro'
import CrearExcepcionBloqueo from '#ledger/actions/crear_excepcion_bloqueo'
import RevocarExcepcionBloqueo from '#ledger/actions/revocar_excepcion_bloqueo'
import ImportarExtracto from '#ledger/actions/importar_extracto'
import type { ContextoAccion } from '#shared/contexto'

/**
 * Auditor contable · fase 6, PR A (bloqueos; contrato de localización fiscal §9.2, §10.4 y §20).
 * Activa los criterios pendientes «un periodo con bloqueo duro rechaza cualquier asiento» y «el
 * bloqueo duro exige cero líneas del extracto sin conciliar» de `pendientes_fases.spec.ts` y prueba
 * que el inv. 17 detecta lo que los triggers impiden (las violaciones se fabrican en una transacción
 * que se revierte, con los triggers apagados).
 *
 * Código bajo el duro: **409 `bloqueo_duro`** (tabla de errores §11 y desvío (c) de §20), no 422
 * `periodo_cerrado` como decía mi criterio pendiente: el contrato manda; el mes cerrado sin duro sigue
 * siendo 422 `periodo_cerrado`.
 */

const hoy = () => hoyGuatemala()
const dia = (fecha: string, dias: number) =>
    DateTime.fromISO(fecha, { zone: 'utc' }).plus({ days: dias }).toISODate()!
const finHaceMeses = (n: number) =>
    DateTime.fromISO(hoy(), { zone: 'utc' }).minus({ months: n }).endOf('month').toISODate()!

function ajuste(ctx: ContextoAccion, empresaId: number, fecha: string, trasladar = false) {
    return new RegistrarAsiento().execute(
        {
            empresa_id: empresaId,
            fecha,
            descripcion: 'Ajuste del auditor (bloqueos)',
            origen_tipo: 'ajuste',
            trasladar_si_bloqueado: trasladar,
            movimientos: [
                { cuenta: '5.2.99', debe: '10.00' },
                { cuenta: '1.1.02.01', haber: '10.00' },
            ],
        },
        ctx,
    )
}

/** Corre `paso` en una transacción que se revierte, con los triggers de usuario de `tablas` apagados. */
async function fabricado(
    empresas: number[],
    tablas: string[],
    paso: (trx: TransactionClientContract) => Promise<void>,
): Promise<string[]> {
    const trx = await db.transaction()
    try {
        for (const t of tablas) await trx.rawQuery(`ALTER TABLE ${t} DISABLE TRIGGER USER`)
        await paso(trx)
        for (const t of tablas) await trx.rawQuery(`ALTER TABLE ${t} ENABLE TRIGGER USER`)
        const violaciones = await verificarLibro(empresas, { cliente: trx, incluirHallazgosAbiertos: true })
        return violaciones.map((v) => v.invariante.split(' ')[0]!)
    } finally {
        await trx.rollback()
    }
}

/** Asiento de 10.00 insertado a mano (sin la acción) con la fecha y los campos dados. */
async function asientoDirecto(
    trx: TransactionClientContract,
    empresaId: number,
    fecha: string,
    extra: Record<string, unknown> = {},
) {
    const [fila] = (await trx
        .insertQuery()
        .table('ledger.asientos')
        .insert({ empresa_id: empresaId, fecha, descripcion: 'directo', origen_tipo: 'ajuste', ...extra })
        .returning('id')) as Array<{ id: number }>
    const cuenta = async (codigo: string) => {
        const c = await trx.from('ledger.cuentas').where('codigo', codigo).select('id').firstOrFail()
        return Number(c.id)
    }
    await trx
        .insertQuery()
        .table('ledger.movimientos')
        .insert([
            { asiento_id: fila!.id, cuenta_id: await cuenta('5.2.99'), debe: '10.00', haber: '0.00' },
            { asiento_id: fila!.id, cuenta_id: await cuenta('1.1.02.01'), debe: '0.00', haber: '10.00' },
        ])
    return Number(fila!.id)
}

/** Empresa C con el mes de hace dos meses cerrado y el bloqueo duro hasta su último día. */
async function conDuro() {
    const e = await prepararEmpresas()
    const hasta = finHaceMeses(2)
    const mes = DateTime.fromISO(hasta, { zone: 'utc' })
    const previo = await ajuste(e.ctx, e.C, dia(hasta, -3))
    await new CerrarPeriodo().execute({ empresa_id: e.C, anio: mes.year, mes: mes.month }, e.ctx)
    await new BloquearDuro().execute(
        { empresa_id: e.C, hasta, motivo: 'Libros entregados', confirmacion: `BLOQUEO DURO hasta ${hasta}` },
        e.ctx,
    )
    return { e, hasta, mes, previo }
}

test.group('Auditor contable · fase 6 (bloqueos)', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('un periodo con bloqueo duro rechaza cualquier asiento (409 bloqueo_duro), también directo y con excepción; el reverso va a hoy; no se reabre ni retrocede', async ({
        assert,
    }) => {
        const { e, hasta, mes, previo } = await conDuro()
        for (const fecha of [hasta, dia(hasta, -40)]) {
            const error = await errorDe(ajuste(e.ctx, e.C, fecha))
            assert.deepEqual([error.status, error.codigo], [409, 'bloqueo_duro'], fecha)
        }
        // ni el traslado de un automático lo deja bajo el duro: va al primer día abierto
        const auto = await ajuste(e.ctx, e.C, hasta, true)
        assert.isTrue(auto.fecha > hasta, `${auto.fecha} > ${hasta}`)
        assert.equal(auto.fecha_documento, hasta)
        // con una excepción global para todos: igual 409
        await new CrearExcepcionBloqueo().execute(
            {
                empresa_id: e.C,
                tipo: 'global',
                motivo: 'no cubre el duro',
                hasta_en: DateTime.now().plus({ hours: 1 }).toISO(),
            },
            e.ctx,
        )
        const conExcepcion = await errorDe(ajuste(e.ctx, e.C, hasta))
        assert.equal(conExcepcion.codigo, 'bloqueo_duro')
        // directo (sin la acción): el trigger lo rechaza
        const trx = await db.transaction()
        await assert.rejects(() => asientoDirecto(trx, e.C, hasta), /bloqueo duro/)
        await trx.rollback()
        // el asiento de antes del duro se corrige con un reverso fechado hoy
        const reverso = await new RevertirAsiento().execute(
            { asiento_id: previo.id, motivo: 'corrección posterior al duro' },
            e.ctx,
        )
        const fila = await db
            .from('ledger.asientos')
            .where('id', reverso.id)
            .select(db.raw(`to_char(fecha, 'YYYY-MM-DD') as fecha`))
            .firstOrFail()
        assert.isTrue(fila.fecha > hasta, `${fila.fecha} > ${hasta}`)
        // reabrir: 409 bloqueo_duro; el duro no retrocede
        const reabrir = await errorDe(
            new ReabrirPeriodo().execute(
                { empresa_id: e.C, anio: mes.year, mes: mes.month, motivo: 'corregir' },
                e.ctx,
            ),
        )
        assert.deepEqual([reabrir.status, reabrir.codigo], [409, 'bloqueo_duro'])
        const atras = dia(hasta, -1)
        const regresivo = await errorDe(
            new BloquearDuro().execute(
                {
                    empresa_id: e.C,
                    hasta: atras,
                    motivo: 'atrás',
                    confirmacion: `BLOQUEO DURO hasta ${atras}`,
                },
                e.ctx,
            ),
        )
        assert.equal(regresivo.codigo, 'bloqueo_regresivo')
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('el bloqueo duro exige cero líneas del extracto sin conciliar (422 bloqueo_duro_requisitos)', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const hasta = finHaceMeses(2)
        const mes = DateTime.fromISO(hasta, { zone: 'utc' })
        await new CerrarPeriodo().execute({ empresa_id: e.B, anio: mes.year, mes: mes.month }, e.ctx)
        await new ImportarExtracto().execute(
            {
                empresa_id: e.B,
                cuenta_bancaria_id: e.cuentas.get(e.B)!,
                desde: mes.startOf('month').toISODate()!,
                hasta,
                saldo_inicial: '0.00',
                saldo_final: '5.00',
                lineas: [{ fecha: hasta, descripcion: 'INTERESES', monto: '5.00' }],
            },
            e.ctx,
        )
        const error = await errorDe(
            new BloquearDuro().execute(
                { empresa_id: e.B, hasta, motivo: 'Libros', confirmacion: `BLOQUEO DURO hasta ${hasta}` },
                e.ctx,
            ),
        )
        assert.equal(error.codigo, 'bloqueo_duro_requisitos')
        assert.include(error.reglas, 'extractos_sin_conciliar')
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('inv. 17: detecta un asiento bajo el duro o bajo un bloqueo sin su excepción, un duro que retrocede, un mes reabierto y un traslado al revés', async ({
        assert,
    }) => {
        const { e, hasta, mes } = await conDuro()
        const global = dia(hoy(), -3)
        await new BloquearLibro().execute(
            { empresa_id: e.C, tipo: 'global', hasta: global, motivo: 'Revisado' },
            e.ctx,
        )
        const { usuario } = await usuarioConRoles(['contabilidad'])
        const excepcion = await new CrearExcepcionBloqueo().execute(
            {
                empresa_id: e.C,
                tipo: 'global',
                usuario_id: usuario.id,
                motivo: 'Ajuste de auditoría',
                hasta_en: DateTime.now().plus({ hours: 1 }).toISO(),
            },
            e.ctx,
        )
        const conExcepcion = await ajuste(contextoPrueba(usuario.id), e.C, global)
        assert.equal(conExcepcion.excepcion_id, excepcion.id)
        await new RevocarExcepcionBloqueo().execute({ excepcion_id: excepcion.id, motivo: 'terminó' }, e.ctx)
        const otra = await errorDe(ajuste(contextoPrueba(usuario.id), e.C, global))
        assert.equal(otra.codigo, 'periodo_bloqueado')
        await afirmarLibro(assert, [e.B, e.C])

        const empresas = [e.B, e.C]
        const casos: Array<[string, string[], (trx: TransactionClientContract) => Promise<void>]> = [
            [
                '17.asiento_bajo_bloqueo',
                ['ledger.asientos', 'ledger.movimientos'],
                async (trx) => {
                    await asientoDirecto(trx, e.C, hasta)
                },
            ],
            [
                '17.asiento_bajo_bloqueo',
                ['ledger.asientos', 'ledger.movimientos'],
                async (trx) => {
                    // bajo el global, sin excepción
                    await asientoDirecto(trx, e.C, global)
                },
            ],
            [
                '17.asiento_bajo_bloqueo',
                ['ledger.asientos', 'ledger.movimientos'],
                async (trx) => {
                    // con la excepción ya revocada
                    await asientoDirecto(trx, e.C, global, {
                        excepcion_id: excepcion.id,
                        created_by: usuario.id,
                    })
                },
            ],
            [
                '17.bloqueo_regresivo',
                ['ledger.bloqueos'],
                async (trx) => {
                    await trx
                        .insertQuery()
                        .table('ledger.bloqueos')
                        .insert({
                            empresa_id: e.C,
                            tipo: 'duro',
                            hasta: dia(hasta, -1),
                            anterior: hasta,
                            motivo: 'atrás',
                            confirmacion: 'x',
                        })
                },
            ],
            [
                '17.reapertura_bajo_duro',
                ['ledger.reaperturas_mensuales'],
                async (trx) => {
                    const cierre = await trx
                        .from('ledger.cierres_mensuales')
                        .where({ empresa_id: e.C, periodo: mes.startOf('month').toISODate()! })
                        .firstOrFail()
                    await trx
                        .insertQuery()
                        .table('ledger.reaperturas_mensuales')
                        .insert({ cierre_id: cierre.id, motivo: 'x' })
                },
            ],
            [
                '17.fecha_documento_mal_trasladada',
                ['ledger.asientos', 'ledger.movimientos'],
                async (trx) => {
                    // «trasladado» hacia atrás y sin bloqueo en su fecha real
                    await asientoDirecto(trx, e.C, hoy(), { fecha_documento: dia(hoy(), 1) })
                },
            ],
        ]
        for (const [invariante, tablas, paso] of casos) {
            assert.include(await fabricado(empresas, tablas, paso), invariante)
        }
        await afirmarLibro(assert, empresas)
    })

    test('triggers sin la acción: excepción de otro usuario, compra o pago a proveedor bajo compras fuera de su diario y un bloqueo antes del duro se rechazan', async ({
        assert,
    }) => {
        const { e, hasta } = await conDuro()
        const bloqueado = dia(hoy(), -3)
        await new BloquearLibro().execute(
            { empresa_id: e.C, tipo: 'global', hasta: bloqueado, motivo: 'Revisado' },
            e.ctx,
        )
        await new BloquearLibro().execute(
            { empresa_id: e.C, tipo: 'compras', hasta: bloqueado, motivo: 'Compras revisadas' },
            e.ctx,
        )
        const { usuario: duenio } = await usuarioConRoles(['contabilidad'])
        const { usuario: otro } = await usuarioConRoles(['contabilidad'])
        const excepcion = await new CrearExcepcionBloqueo().execute(
            {
                empresa_id: e.C,
                tipo: 'global',
                usuario_id: duenio.id,
                motivo: 'Solo para el dueño',
                hasta_en: DateTime.now().plus({ hours: 1 }).toISO(),
            },
            e.ctx,
        )
        const global = await db
            .from('ledger.bloqueos')
            .where({ empresa_id: e.C, tipo: 'global' })
            .firstOrFail()
        const rechazado = async (
            paso: (trx: TransactionClientContract) => Promise<unknown>,
            motivo: string,
        ) => {
            const trx = await db.transaction()
            try {
                await paso(trx)
                await trx.rawQuery('SET CONSTRAINTS ALL IMMEDIATE')
                assert.fail(`debía rechazarse: ${motivo}`)
            } catch (error) {
                assert.notInclude(String(error), 'debía rechazarse', motivo)
            } finally {
                await trx.rollback()
            }
        }
        // la excepción del dueño no cubre a otro usuario
        await rechazado(
            (trx) => asientoDirecto(trx, e.C, bloqueado, { excepcion_id: excepcion.id, created_by: otro.id }),
            'excepción de otro usuario',
        )
        // con la del dueño y solo el global: entra (control)
        const trxOk = await db.transaction()
        await asientoDirecto(trxOk, e.C, bloqueado, { excepcion_id: excepcion.id, created_by: duenio.id })
        await trxOk.rawQuery('SET CONSTRAINTS ALL IMMEDIATE')
        await trxOk.rollback()
        // compras: un pago a proveedor fuera del diario de compras, bajo el bloqueo de compras (con la
        // excepción global del dueño, que no cubre compras)
        await rechazado(
            (trx) =>
                asientoDirecto(trx, e.C, bloqueado, {
                    origen_tipo: 'pago_proveedor',
                    origen_id: 1,
                    excepcion_id: excepcion.id,
                    created_by: duenio.id,
                }),
            'pago a proveedor bajo compras',
        )
        // un bloqueo nuevo antes del duro, directo
        await rechazado(
            (trx) =>
                trx
                    .insertQuery()
                    .table('ledger.bloqueos')
                    .insert({
                        empresa_id: e.C,
                        tipo: 'global',
                        hasta: dia(hasta, -5),
                        motivo: 'antes del duro',
                    }),
            'bloqueo antes del duro',
        )
        assert.exists(global)
        await afirmarLibro(assert, [e.B, e.C])
    })
})
