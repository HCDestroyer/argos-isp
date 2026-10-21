import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import { contextoPrueba, estado, soloEmpresaPrincipal, usuarioConRoles } from '#tests/ayudas'
import {
    errorDe,
    facturasDelServicio,
    prepararEmpresas,
    servicioEn,
} from '#tests/contabilidad/ayudas_contabilidad'
import { afirmarLibro } from '#tests/contabilidad/verificar_libro'
import { hoyGuatemala } from '#ledger/fechas'
import RegistrarAsiento from '#ledger/actions/registrar_asiento'
import RevertirAsiento from '#ledger/actions/revertir_asiento'
import CerrarPeriodo from '#ledger/actions/cerrar_periodo'
import ReabrirPeriodo from '#ledger/actions/reabrir_periodo'
import BloquearLibro from '#ledger/actions/bloquear_libro'
import DesbloquearLibro from '#ledger/actions/desbloquear_libro'
import BloquearDuro from '#ledger/actions/bloquear_duro'
import CrearExcepcionBloqueo from '#ledger/actions/crear_excepcion_bloqueo'
import RevocarExcepcionBloqueo from '#ledger/actions/revocar_excepcion_bloqueo'
import ImportarExtracto from '#ledger/actions/importar_extracto'
import GenerarFacturas from '#billing/actions/generar_facturas'
import VencerFacturas from '#billing/actions/vencer_facturas'
import type { ContextoAccion } from '#shared/contexto'

/**
 * Fase 6 · PR A (contrato de localización fiscal §9.2 y §10.4): bloqueos por tipo con excepciones,
 * traslado de los asientos automáticos al primer día abierto, bloqueo duro y triggers en dos
 * niveles. Cada prueba usa empresas nuevas (un bloqueo no afecta al resto de la suite) y termina
 * en `afirmarLibro`.
 */

const hoy = () => hoyGuatemala()
const dia = (fecha: string, dias: number) =>
    DateTime.fromISO(fecha, { zone: 'utc' }).plus({ days: dias }).toISODate()!
/** Último día del mes de hace `n` meses. */
const finHaceMeses = (n: number) =>
    DateTime.fromISO(hoy(), { zone: 'utc' }).minus({ months: n }).endOf('month').toISODate()!

function ajuste(
    ctx: ContextoAccion,
    empresaId: number,
    fecha: string,
    extra: { diario?: string; trasladar_si_bloqueado?: boolean; cuentas?: [string, string] } = {},
) {
    const [debe, haber] = extra.cuentas ?? ['5.2.99', '1.1.02.01']
    return new RegistrarAsiento().execute(
        {
            empresa_id: empresaId,
            fecha,
            descripcion: 'Ajuste de prueba (bloqueos)',
            origen_tipo: 'ajuste',
            diario: extra.diario,
            trasladar_si_bloqueado: extra.trasladar_si_bloqueado,
            movimientos: [
                { cuenta: debe, debe: '10.00' },
                { cuenta: haber, haber: '10.00' },
            ],
        },
        ctx,
    )
}

async function eventos(nombre: string, empresaId: number) {
    return (await db
        .from('audit.outbox')
        .where('evento', nombre)
        .whereRaw(`(payload->>'empresa_id')::bigint = ?`, [empresaId])
        .orderBy('id')
        .select('payload')) as Array<{ payload: Record<string, unknown> }>
}

test.group('Fase 6 · bloqueos del libro', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('global: solo avanza, rechaza fechas bloqueadas (422 periodo_bloqueado) y desbloquear retrocede con motivo', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresas()
        const hasta = dia(hoy(), -10)
        const { token } = await usuarioConRoles(['contabilidad'])
        const previo = await ajuste(e.ctx, e.B, hasta)

        const fijado = await estado(
            client
                .post('/api/v1/libro/bloqueos')
                .bearerToken(token)
                .header('X-Empresa-Id', String(e.B))
                .json({ empresa_id: e.B, tipo: 'global', hasta, motivo: 'Cierre del mes revisado' }),
            201,
        )
        assert.equal(fijado.body().tipo, 'global')
        assert.equal(fijado.body().hasta, hasta)
        assert.isNull(fijado.body().anterior)
        const [evento] = await eventos('libro.bloqueo_cambiado', e.B)
        assert.deepEqual(evento!.payload, { empresa_id: e.B, tipo: 'global', hasta, anterior: null })

        // la otra empresa sigue abierta
        await ajuste(e.ctx, e.C, hasta)

        const bloqueado = await errorDe(ajuste(e.ctx, e.B, hasta))
        assert.equal(bloqueado.status, 422)
        assert.equal(bloqueado.codigo, 'periodo_bloqueado')
        assert.deepEqual(bloqueado.reglas, ['global'])
        const despues = await ajuste(e.ctx, e.B, dia(hasta, 1))
        assert.isNull(despues.fecha_documento)
        assert.isNull(despues.excepcion_id)

        // un asiento bloqueado se revierte con fecha de hoy (abierta); con su fecha, 422
        const reverso = await errorDe(
            new RevertirAsiento().execute(
                { asiento_id: previo.id, motivo: 'con fecha bloqueada', fecha: hasta },
                e.ctx,
            ),
        )
        assert.equal(reverso.codigo, 'periodo_bloqueado')
        const reversoHoy = await new RevertirAsiento().execute(
            { asiento_id: previo.id, motivo: 'corrección' },
            e.ctx,
        )
        assert.equal(reversoHoy.fecha, hoy())

        // solo avanza; no futuro
        const regresivo = await errorDe(
            new BloquearLibro().execute(
                { empresa_id: e.B, tipo: 'global', hasta: dia(hasta, -1), motivo: 'atrás' },
                e.ctx,
            ),
        )
        assert.equal(regresivo.codigo, 'bloqueo_regresivo')
        const futuro = await errorDe(
            new BloquearLibro().execute(
                { empresa_id: e.B, tipo: 'global', hasta: dia(hoy(), 1), motivo: 'futuro' },
                e.ctx,
            ),
        )
        assert.deepEqual(futuro.reglas, ['bloqueo_futuro'])

        // vigentes por la API
        const vigentes = await estado(
            client.get('/api/v1/libro/bloqueos').bearerToken(token).header('X-Empresa-Id', String(e.B)),
            200,
        )
        assert.equal(vigentes.body()[0].vigentes.global, hasta)
        assert.isNull(vigentes.body()[0].vigentes.duro)

        // desbloquear: atrás o sin bloqueo, con su permiso
        const { token: lectura } = await usuarioConRoles(['lectura'])
        await estado(
            client
                .post('/api/v1/libro/bloqueos/desbloquear')
                .bearerToken(lectura)
                .header('X-Empresa-Id', String(e.B))
                .json({ empresa_id: e.B, hasta: null, motivo: 'sin permiso' }),
            403,
        )
        const quitado = await estado(
            client
                .post('/api/v1/libro/bloqueos/desbloquear')
                .bearerToken(token)
                .header('X-Empresa-Id', String(e.B))
                .json({ empresa_id: e.B, hasta: null, motivo: 'Corrección de una factura de septiembre' }),
            201,
        )
        assert.isNull(quitado.body().hasta)
        assert.equal(quitado.body().anterior, hasta)
        await ajuste(e.ctx, e.B, hasta)
        const sinBloqueo = await errorDe(
            new DesbloquearLibro().execute({ empresa_id: e.B, motivo: 'otra vez' }, e.ctx),
        )
        assert.equal(sinBloqueo.codigo, 'sin_bloqueo')
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('ventas, compras e impuestos: cada uno solo a sus asientos; impuestos no retrocede', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const hasta = dia(hoy(), -5)
        for (const tipo of ['ventas', 'compras', 'impuestos'] as const) {
            await new BloquearLibro().execute(
                { empresa_id: e.B, tipo, hasta, motivo: `Bloqueo ${tipo}` },
                e.ctx,
            )
        }
        // varios: pasa
        await ajuste(e.ctx, e.B, hasta)
        // diario de ventas
        const ventas = await errorDe(ajuste(e.ctx, e.B, hasta, { diario: 'VEN' }))
        assert.deepEqual([ventas.codigo, ventas.reglas], ['periodo_bloqueado', ['ventas']])
        // diario de compras
        const compras = await errorDe(ajuste(e.ctx, e.B, hasta, { diario: 'COM' }))
        assert.deepEqual([compras.codigo, compras.reglas], ['periodo_bloqueado', ['compras']])
        // una cuenta de impuesto (ledger.cuentas_con_impuesto)
        const impuestos = await errorDe(ajuste(e.ctx, e.B, hasta, { cuentas: ['5.2.99', '2.1.02'] }))
        assert.deepEqual([impuestos.codigo, impuestos.reglas], ['periodo_bloqueado', ['impuestos']])

        // impuestos no retrocede (ni por desbloquear ni por trigger)
        const atras = await errorDe(
            new DesbloquearLibro().execute(
                { empresa_id: e.B, tipo: 'impuestos', hasta: null, motivo: 'atrás' },
                e.ctx,
            ),
        )
        assert.equal(atras.codigo, 'bloqueo_regresivo')
        await assert.rejects(
            () =>
                db.table('ledger.bloqueos').insert({
                    empresa_id: e.B,
                    tipo: 'impuestos',
                    hasta: dia(hasta, -1),
                    motivo: 'directo en la base',
                }),
            /no retrocede/,
        )
        // las ventas sí
        await new DesbloquearLibro().execute(
            { empresa_id: e.B, tipo: 'ventas', hasta: dia(hasta, -1), motivo: 'Factura pendiente del día' },
            e.ctx,
        )
        await ajuste(e.ctx, e.B, hasta, { diario: 'VEN' })
        await afirmarLibro(assert, [e.B])
    })

    test('excepciones: con fin obligatorio, por usuario o para todos, solo su tipo; revocar la quita', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresas()
        const hasta = dia(hoy(), -3)
        await new BloquearLibro().execute(
            { empresa_id: e.B, tipo: 'global', hasta, motivo: 'Mes revisado' },
            e.ctx,
        )
        await new BloquearLibro().execute(
            { empresa_id: e.B, tipo: 'ventas', hasta, motivo: 'Ventas revisadas' },
            e.ctx,
        )
        const { usuario: contador, token: tokenContador } = await usuarioConRoles(['contabilidad'])
        const { usuario: otro } = await usuarioConRoles(['contabilidad'])
        const { token: tokenAdmin } = await usuarioConRoles(['admin'])
        const fin = DateTime.now().plus({ hours: 2 }).toISO()

        // contabilidad no crea excepciones (solo admin)
        await estado(
            client
                .post('/api/v1/libro/bloqueos/excepciones')
                .bearerToken(tokenContador)
                .header('X-Empresa-Id', String(e.B))
                .json({
                    empresa_id: e.B,
                    tipo: 'global',
                    usuario_id: contador.id,
                    motivo: 'yo',
                    hasta_en: fin,
                }),
            403,
        )
        const sinFin = await estado(
            client
                .post('/api/v1/libro/bloqueos/excepciones')
                .bearerToken(tokenAdmin)
                .header('X-Empresa-Id', String(e.B))
                .json({ empresa_id: e.B, tipo: 'global', usuario_id: contador.id, motivo: 'sin fin' }),
            422,
        )
        assert.equal(sinFin.body().type, 'urn:argosisp:problema:excepcion_sin_fin')
        const sobreDuro = await errorDe(
            new CrearExcepcionBloqueo().execute(
                { empresa_id: e.B, tipo: 'duro', motivo: 'no se puede', hasta_en: fin },
                e.ctx,
            ),
        )
        assert.equal(sobreDuro.codigo, 'excepcion_sin_fin')

        const creada = await estado(
            client
                .post('/api/v1/libro/bloqueos/excepciones')
                .bearerToken(tokenAdmin)
                .header('X-Empresa-Id', String(e.B))
                .json({
                    empresa_id: e.B,
                    tipo: 'global',
                    usuario_id: contador.id,
                    motivo: 'Ajuste de auditoría externa',
                    hasta_en: fin,
                }),
            201,
        )
        const excepcionId = creada.body().id as number
        assert.equal(creada.body().estado, 'vigente')

        // el usuario de la excepción entra (queda excepcion_id); otro no
        const conExcepcion = await ajuste(contextoPrueba(contador.id), e.B, hasta)
        assert.equal(conExcepcion.excepcion_id, excepcionId)
        assert.equal(conExcepcion.fecha, hasta)
        const otroUsuario = await errorDe(ajuste(contextoPrueba(otro.id), e.B, hasta))
        assert.deepEqual(otroUsuario.reglas, ['global'])
        // cubre solo su tipo: el diario de ventas sigue bloqueado
        const ventas = await errorDe(ajuste(contextoPrueba(contador.id), e.B, hasta, { diario: 'VEN' }))
        assert.deepEqual(ventas.reglas, ['ventas'])

        // listado por la API
        const lista = await estado(
            client
                .get('/api/v1/libro/bloqueos/excepciones?estado=vigente')
                .bearerToken(tokenContador)
                .header('X-Empresa-Id', String(e.B)),
            200,
        )
        assert.deepEqual(
            lista.body().data.map((x: { id: number; asientos: number }) => [x.id, x.asientos]),
            [[excepcionId, 1]],
        )

        const revocada = await new RevocarExcepcionBloqueo().execute(
            { excepcion_id: excepcionId, motivo: 'Ya terminó la auditoría' },
            e.ctx,
        )
        assert.equal(revocada.estado, 'revocada')
        assert.equal(revocada.asientos, 1)
        const yaNo = await errorDe(ajuste(contextoPrueba(contador.id), e.B, hasta))
        assert.equal(yaNo.codigo, 'periodo_bloqueado')
        const otraVez = await errorDe(
            new RevocarExcepcionBloqueo().execute({ excepcion_id: excepcionId, motivo: 'otra vez' }, e.ctx),
        )
        assert.equal(otraVez.codigo, 'excepcion_revocada')

        // una excepción para todos también cubre al sistema
        await new CrearExcepcionBloqueo().execute(
            { empresa_id: e.B, tipo: 'global', motivo: 'Para todos', hasta_en: fin },
            e.ctx,
        )
        const sistema = await ajuste(contextoPrueba(), e.B, hasta)
        assert.isNotNull(sistema.excepcion_id)

        // en la base: una excepción ajena o vencida no sirve
        await assert.rejects(
            () =>
                db.transaction(async (trx) => {
                    await trx.table('ledger.asientos').insert({
                        empresa_id: e.B,
                        fecha: hasta,
                        descripcion: 'directo con excepción revocada',
                        origen_tipo: 'ajuste',
                        excepcion_id: excepcionId,
                        created_by: contador.id,
                    })
                }),
            /bajo el bloqueo global/,
        )
        await afirmarLibro(assert, [e.B])
    })

    test('automáticos: van al primer día abierto con su fecha real en fecha_documento', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const finMes = finHaceMeses(1)
        const mesCerrado = DateTime.fromISO(finMes, { zone: 'utc' }).startOf('month')
        // mes anterior cerrado y bloqueo global hasta el día 5 de este mes
        await new CerrarPeriodo().execute(
            { empresa_id: e.B, anio: mesCerrado.year, mes: mesCerrado.month },
            e.ctx,
        )
        const inicioMes = DateTime.fromISO(hoy(), { zone: 'utc' }).startOf('month')
        const bloqueo = inicioMes.plus({ days: 4 }).toISODate()!
        if (bloqueo < hoy()) {
            await new BloquearLibro().execute(
                { empresa_id: e.B, tipo: 'global', hasta: bloqueo, motivo: 'Primeros días revisados' },
                e.ctx,
            )
        }
        const esperado = bloqueo < hoy() ? dia(bloqueo, 1) : inicioMes.toISODate()!

        const manual = await errorDe(ajuste(e.ctx, e.B, finMes))
        assert.equal(manual.codigo, 'periodo_cerrado')
        const auto = await ajuste(e.ctx, e.B, finMes, { trasladar_si_bloqueado: true })
        assert.equal(auto.fecha, esperado)
        assert.equal(auto.fecha_documento, finMes)
        assert.isNull(auto.excepcion_id)
        // abierto: no se traslada
        const abierto = await ajuste(e.ctx, e.B, hoy(), { trasladar_si_bloqueado: true })
        assert.equal(abierto.fecha, hoy())
        assert.isNull(abierto.fecha_documento)

        const fila = await db
            .from('ledger.asientos')
            .where('id', auto.id)
            .select(db.raw(`to_char(fecha_documento, 'YYYY-MM-DD') as fecha_documento`))
            .firstOrFail()
        assert.equal(fila.fecha_documento, finMes)
        await afirmarLibro(assert, [e.B])
    })

    test('triggers: inmediato para global y diferido (al commit) para ventas, compras e impuestos', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const hasta = dia(hoy(), -2)
        await ajuste(e.ctx, e.B, hoy(), { diario: 'VEN' }) // crea el diario VEN de la empresa
        await new BloquearLibro().execute({ empresa_id: e.B, tipo: 'ventas', hasta, motivo: 'Ventas' }, e.ctx)
        const ven = (await db
            .from('ledger.diarios')
            .where({ empresa_id: e.B, codigo: 'VEN' })
            .select('id')
            .firstOrFail()) as { id: number }
        const diarioVen = Number(ven.id)
        const cuentas = (await db
            .from('ledger.cuentas')
            .whereIn('codigo', ['5.2.99', '1.1.02.01'])
            .where('pais', 'GT')
            .select('id', 'codigo')) as Array<{ id: number; codigo: string }>
        const id = (c: string) => cuentas.find((x) => x.codigo === c)!.id

        // diferido: los INSERT pasan y el COMMIT falla (conexión propia: el COMMIT se ve tal cual)
        const knex = db.connection().getWriteClient()
        const conexion = (await knex.client.acquireConnection()) as {
            query: (sql: string, valores?: unknown[]) => Promise<{ rows: Array<{ id: number }> }>
        }
        let paso = false
        try {
            await conexion.query('BEGIN')
            const { rows } = await conexion.query(
                `INSERT INTO ledger.asientos (empresa_id, fecha, descripcion, origen_tipo)
                 VALUES ($1, $2, 'directo bajo el bloqueo de ventas', 'ajuste') RETURNING id`,
                [e.B, hasta],
            )
            const asientoId = rows[0]!.id
            await conexion.query(
                `INSERT INTO ledger.movimientos (asiento_id, cuenta_id, debe, haber) VALUES ($1, $2, 1, 0), ($1, $3, 0, 1)`,
                [asientoId, id('5.2.99'), id('1.1.02.01')],
            )
            await conexion.query(
                'INSERT INTO ledger.asientos_numeros (asiento_id, diario_id, anio, numero) VALUES ($1, $2, $3, 999999)',
                [asientoId, diarioVen, Number(hasta.slice(0, 4))],
            )
            paso = true
            await assert.rejects(() => conexion.query('COMMIT'), /bajo el bloqueo ventas/)
        } finally {
            await conexion.query('ROLLBACK').catch(() => undefined)
            await knex.client.releaseConnection(conexion)
        }
        assert.isTrue(paso, 'el trigger de ventas es diferido: los INSERT pasan y falla el COMMIT')
        const directo = await db
            .from('ledger.asientos')
            .where('descripcion', 'directo bajo el bloqueo de ventas')
            .first()
        assert.isNull(directo)

        // inmediato: global rechaza el INSERT mismo
        await new BloquearLibro().execute({ empresa_id: e.B, tipo: 'global', hasta, motivo: 'Global' }, e.ctx)
        let insertado = false
        await assert.rejects(
            () =>
                db.transaction(async (trx) => {
                    await trx.table('ledger.asientos').insert({
                        empresa_id: e.B,
                        fecha: hasta,
                        descripcion: 'directo bajo el bloqueo global',
                        origen_tipo: 'ajuste',
                    })
                    insertado = true
                }),
            /bajo el bloqueo global/,
        )
        assert.isFalse(insertado)
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('duro: confirmación exacta, requisitos, irreversible; nada ni con excepción, y no se reabre', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresas()
        const hasta = finHaceMeses(2)
        const mes = DateTime.fromISO(hasta, { zone: 'utc' })
        const { token: tokenContador } = await usuarioConRoles(['contabilidad'])
        const { token: tokenAdmin } = await usuarioConRoles(['admin'])
        const confirmacion = `BLOQUEO DURO hasta ${hasta}`

        // solo admin
        await estado(
            client
                .post('/api/v1/libro/bloqueos/duro')
                .bearerToken(tokenContador)
                .header('X-Empresa-Id', String(e.B))
                .json({ empresa_id: e.B, hasta, motivo: 'Libros entregados', confirmacion }),
            403,
        )
        const malaConfirmacion = await errorDe(
            new BloquearDuro().execute(
                { empresa_id: e.B, hasta, motivo: 'Libros entregados', confirmacion: 'BLOQUEO DURO' },
                e.ctx,
            ),
        )
        assert.equal(malaConfirmacion.codigo, 'confirmacion_invalida')

        // requisitos: el mes abierto y una línea de extracto sin conciliar
        await ajuste(e.ctx, e.B, mes.startOf('month').plus({ days: 2 }).toISODate()!)
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
        const requisitos = await errorDe(
            new BloquearDuro().execute(
                { empresa_id: e.B, hasta, motivo: 'Libros entregados', confirmacion },
                e.ctx,
            ),
        )
        assert.equal(requisitos.codigo, 'bloqueo_duro_requisitos')
        assert.sameMembers(requisitos.reglas, ['meses_abiertos', 'extractos_sin_conciliar'])

        // empresa C: el mes cerrado y sin extractos → se fija
        await new CerrarPeriodo().execute({ empresa_id: e.C, anio: mes.year, mes: mes.month }, e.ctx)
        const fijado = await estado(
            client
                .post('/api/v1/libro/bloqueos/duro')
                .bearerToken(tokenAdmin)
                .header('X-Empresa-Id', String(e.C))
                .json({ empresa_id: e.C, hasta, motivo: 'Libros entregados al contador', confirmacion }),
            201,
        )
        assert.equal(fijado.body().tipo, 'duro')

        // nada con fecha ≤ hasta: 409 bloqueo_duro, ni con excepción
        await new CrearExcepcionBloqueo().execute(
            {
                empresa_id: e.C,
                tipo: 'global',
                motivo: 'no cubre el duro',
                hasta_en: DateTime.now().plus({ hours: 1 }).toISO(),
            },
            e.ctx,
        )
        const bajoDuro = await errorDe(ajuste(e.ctx, e.C, hasta))
        assert.deepEqual([bajoDuro.status, bajoDuro.codigo], [409, 'bloqueo_duro'])
        // no se reabre
        const reabrir = await errorDe(
            new ReabrirPeriodo().execute(
                { empresa_id: e.C, anio: mes.year, mes: mes.month, motivo: 'corregir' },
                e.ctx,
            ),
        )
        assert.deepEqual([reabrir.status, reabrir.codigo], [409, 'bloqueo_duro'])
        // solo avanza; ningún otro queda antes; no se desbloquea
        const regresivo = await errorDe(
            new BloquearDuro().execute(
                {
                    empresa_id: e.C,
                    hasta: dia(hasta, -1),
                    motivo: 'atrás',
                    confirmacion: `BLOQUEO DURO hasta ${dia(hasta, -1)}`,
                },
                e.ctx,
            ),
        )
        assert.equal(regresivo.codigo, 'bloqueo_regresivo')
        const bajo = await errorDe(
            new BloquearLibro().execute(
                { empresa_id: e.C, tipo: 'global', hasta: dia(hasta, -10), motivo: 'antes del duro' },
                e.ctx,
            ),
        )
        assert.equal(bajo.codigo, 'bloqueo_bajo_duro')
        const desbloquear = await errorDe(
            new DesbloquearLibro().execute({ empresa_id: e.C, tipo: 'duro', motivo: 'quitar' }, e.ctx),
        )
        assert.equal(desbloquear.codigo, 'bloqueo_duro')
        await assert.rejects(
            () =>
                db.table('ledger.bloqueos').insert({
                    empresa_id: e.C,
                    tipo: 'duro',
                    hasta: dia(hasta, -1),
                    motivo: 'directo',
                    confirmacion: 'x',
                }),
            /solo avanza/,
        )
        await assert.rejects(
            () => db.from('ledger.bloqueos').where('empresa_id', e.C).update({ hasta: null }),
            /./,
        )
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('crons: una factura o una mora bajo bloqueo queda pendiente, se avisa y se reintenta', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const { servicioId } = await servicioEn(e.B, {
            instalacion: DateTime.fromISO(hoy(), { zone: 'utc' })
                .minus({ months: 2 })
                .startOf('month')
                .toISODate()!,
            plantilla: { mora_tipo: 'fija', mora_valor: '10.00' },
        })
        await new BloquearLibro().execute(
            { empresa_id: e.B, tipo: 'ventas', hasta: hoy(), motivo: 'Ventas de hoy' },
            e.ctx,
        )

        const bloqueada = await new GenerarFacturas().execute({ servicio_id: servicioId }, contextoPrueba())
        assert.equal(bloqueada.generadas, 0)
        assert.equal(bloqueada.errores, 0)
        assert.equal(bloqueada.bloqueados, 1)
        assert.deepEqual(
            bloqueada.bloqueos.map((b) => [b.empresa_id, b.tipo, b.hasta, b.documentos, b.ejemplos]),
            [[e.B, 'ventas', hoy(), 1, [servicioId]]],
        )
        const [aviso] = await eventos('libro.proceso_bloqueado', e.B)
        assert.equal(aviso!.payload.proceso, 'facturas.generar')
        assert.equal(aviso!.payload.tipo, 'ventas')
        assert.lengthOf(await facturasDelServicio(servicioId), 0)

        // sin bloqueo: la siguiente corrida factura todo lo pendiente
        await new DesbloquearLibro().execute(
            { empresa_id: e.B, tipo: 'ventas', hasta: null, motivo: 'Listo' },
            e.ctx,
        )
        const generada = await new GenerarFacturas().execute({ servicio_id: servicioId }, contextoPrueba())
        assert.isAbove(generada.generadas, 0)
        assert.equal(generada.bloqueados, 0)

        // mora: la factura vence igual, la mora queda pendiente
        await new BloquearLibro().execute(
            { empresa_id: e.B, tipo: 'ventas', hasta: hoy(), motivo: 'Otra vez' },
            e.ctx,
        )
        const vencimiento = await new VencerFacturas().execute({ servicio_id: servicioId }, contextoPrueba())
        assert.isAbove(vencimiento.vencidas, 0)
        assert.equal(vencimiento.moras, 0)
        assert.isAbove(vencimiento.bloqueados, 0)
        const avisos = await eventos('libro.proceso_bloqueado', e.B)
        assert.equal(avisos.at(-1)!.payload.proceso, 'facturas.vencer_pendientes')
        const sinMora = await facturasDelServicio(servicioId)
        assert.isFalse(sinMora.some((f) => f.tipo === 'mora'))

        await new DesbloquearLibro().execute(
            { empresa_id: e.B, tipo: 'ventas', hasta: null, motivo: 'Listo' },
            e.ctx,
        )
        const conMora = await new VencerFacturas().execute({ servicio_id: servicioId }, contextoPrueba())
        assert.isAbove(conMora.moras, 0)
        assert.equal(conMora.bloqueados, 0)
        await afirmarLibro(assert, [e.B])
    })
})
