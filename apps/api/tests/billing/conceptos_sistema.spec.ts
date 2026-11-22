import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, soloEmpresaPrincipal } from '#tests/ayudas'
import { prepararEmpresas } from '#tests/contabilidad/ayudas_contabilidad'
import { Problema } from '#shared/errores'
import { crearEmpresaFila } from '#tests/core/fabricas'
import CrearConceptoCargo from '#billing/actions/crear_concepto_cargo'
import EditarConceptoCargo from '#billing/actions/editar_concepto_cargo'
import { SQL_BACKFILL } from '../../database/migrations/1795323977903_alter_conceptos_cargo_codigo_sistema.js'

/**
 * `billing.conceptos_cargo.codigo_sistema` (contrato Iris 0.14.3): el concepto sembrado de instalación
 * de cada empresa lleva `instalacion`, único por empresa y fijo. Siembra, backfill, protección (acción
 * con `422 concepto_de_sistema` y trigger) y `GET /conceptos-cargo`.
 */

const TIPO_422 = 'urn:argosisp:problema:concepto_de_sistema'

async function problemaDe(accion: () => Promise<unknown>): Promise<Problema> {
    try {
        await accion()
    } catch (error) {
        if (error instanceof Problema) return error
        throw error
    }
    throw new Error('Se esperaba un error de dominio y la acción terminó bien')
}

async function deSistema(empresaId: number) {
    return db
        .from('billing.conceptos_cargo')
        .where('empresa_id', empresaId)
        .whereNotNull('codigo_sistema')
        .select('id', 'nombre', 'codigo_sistema', 'activo', 'version')
}

async function porNombre(empresaId: number, nombre: string) {
    const fila = await db
        .from('billing.conceptos_cargo')
        .where({ empresa_id: empresaId, nombre })
        .select('id', 'version', 'codigo_sistema')
        .firstOrFail()
    return { id: Number(fila.id), version: Number(fila.version), codigo_sistema: fila.codigo_sistema }
}

test.group('Facturas · concepto de sistema (codigo_sistema)', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('la siembra de una empresa nueva marca «Instalación» y solo ese', async ({ assert }) => {
        const e = await prepararEmpresas()
        for (const empresaId of [e.B, e.C]) {
            const filas = await db
                .from('billing.conceptos_cargo')
                .where('empresa_id', empresaId)
                .orderBy('nombre')
                .select('nombre', 'codigo_sistema', 'activo')
            assert.deepEqual(
                filas.map((f) => [f.nombre, f.codigo_sistema, f.activo]),
                [
                    ['Equipo', null, true],
                    ['Instalación', 'instalacion', true],
                    ['Otro', null, true],
                    ['Visita técnica', null, true],
                ],
            )
        }
        // la empresa principal (sembrada antes de la migración) también lo tiene, por el backfill
        assert.lengthOf(await deSistema(1), 1)
        // un segundo concepto de sistema en la misma empresa: índice único parcial
        await assert.rejects(() =>
            db.table('billing.conceptos_cargo').insert({
                empresa_id: e.B,
                nombre: 'Instalación 2',
                cuenta_codigo: '4.1.03',
                codigo_sistema: 'instalacion',
            }),
        )
        // volver a sembrar no duplica (aunque lo hayan renombrado)
        const inst = await porNombre(e.B, 'Instalación')
        await new EditarConceptoCargo().execute(
            { id: inst.id, version: inst.version, nombre: 'Instalación residencial' },
            e.ctx,
        )
        await db.rawQuery('SELECT billing.sembrar_catalogos_cargo(?)', [e.B])
        const marcados = await deSistema(e.B)
        assert.deepEqual(
            marcados.map((m) => [Number(m.id), m.nombre]),
            [[inst.id, 'Instalación residencial']],
        )
        assert.isFalse(
            Boolean(
                await db
                    .from('billing.conceptos_cargo')
                    .where({ empresa_id: e.B, nombre: 'Instalación' })
                    .first(),
            ),
        )
    })

    test('backfill: el primer concepto de cada empresa aunque esté renombrado; sin conceptos, la siembra', async ({
        assert,
    }) => {
        const renombrada = await crearEmpresaFila()
        const vacia = await crearEmpresaFila()
        const trx = await db.transaction()
        try {
            // estado anterior a la migración: sin código, «Instalación» renombrado y otra con ese nombre
            await trx.rawQuery(
                'ALTER TABLE billing.conceptos_cargo DISABLE TRIGGER conceptos_cargo_codigo_sistema',
            )
            await trx
                .from('billing.conceptos_cargo')
                .whereIn('empresa_id', [renombrada, vacia])
                .update({ codigo_sistema: null })
            const original = await trx
                .from('billing.conceptos_cargo')
                .where({ empresa_id: renombrada, nombre: 'Instalación' })
                .select('id')
                .firstOrFail()
            await trx
                .from('billing.conceptos_cargo')
                .where('id', original.id)
                .update({ nombre: 'Cobro de instalación' })
            await trx
                .table('billing.conceptos_cargo')
                .insert({ empresa_id: renombrada, nombre: 'Instalación', cuenta_codigo: '4.1.03' })
            await trx.from('billing.conceptos_cargo').where('empresa_id', vacia).delete()

            await trx.rawQuery(SQL_BACKFILL)
            await trx.rawQuery(SQL_BACKFILL) // idempotente

            const marcadoRenombrada = await trx
                .from('billing.conceptos_cargo')
                .where('empresa_id', renombrada)
                .whereNotNull('codigo_sistema')
                .select('id', 'nombre', 'codigo_sistema')
            assert.deepEqual(
                marcadoRenombrada.map((m) => [m.id, m.nombre, m.codigo_sistema]),
                [[original.id, 'Cobro de instalación', 'instalacion']],
            )
            const sembrada = await trx
                .from('billing.conceptos_cargo')
                .where('empresa_id', vacia)
                .orderBy('nombre')
                .select('nombre', 'codigo_sistema')
            assert.deepEqual(
                sembrada.map((f) => [f.nombre, f.codigo_sistema]),
                [
                    ['Equipo', null],
                    ['Instalación', 'instalacion'],
                    ['Otro', null],
                    ['Visita técnica', null],
                ],
            )
            // ninguna empresa queda sin su concepto ni con dos
            const sinUno = await trx.rawQuery(`
                SELECT e.id FROM core.empresas e
                 WHERE (SELECT count(*) FROM billing.conceptos_cargo k
                         WHERE k.empresa_id = e.id AND k.codigo_sistema = 'instalacion') <> 1`)
            assert.deepEqual(sinUno.rows, [])
        } finally {
            await trx.rollback()
        }
    })

    test('la acción no cambia, quita, asigna ni desactiva el código; el resto sí se edita', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const inst = await porNombre(e.B, 'Instalación')
        const visita = await porNombre(e.B, 'Visita técnica')
        const casos: Array<[string, () => Promise<unknown>, string]> = [
            [
                'cambiar',
                () =>
                    new EditarConceptoCargo().execute(
                        { id: inst.id, version: inst.version, codigo_sistema: 'equipo' },
                        e.ctx,
                    ),
                'codigo_sistema',
            ],
            [
                'quitar',
                () =>
                    new EditarConceptoCargo().execute(
                        { id: inst.id, version: inst.version, codigo_sistema: null },
                        e.ctx,
                    ),
                'codigo_sistema',
            ],
            [
                'asignar a otro',
                () =>
                    new EditarConceptoCargo().execute(
                        { id: visita.id, version: visita.version, codigo_sistema: 'instalacion' },
                        e.ctx,
                    ),
                'codigo_sistema',
            ],
            [
                'desactivar',
                () =>
                    new EditarConceptoCargo().execute(
                        { id: inst.id, version: inst.version, activo: false },
                        e.ctx,
                    ),
                'activo',
            ],
            [
                'crear con código',
                () =>
                    new CrearConceptoCargo().execute(
                        {
                            empresa_id: e.B,
                            nombre: 'Instalación bis',
                            cuenta_codigo: '4.1.03',
                            codigo_sistema: 'instalacion',
                        },
                        e.ctx,
                    ),
                'codigo_sistema',
            ],
        ]
        for (const [caso, accion, campo] of casos) {
            const error = await problemaDe(accion)
            assert.equal(error.status, 422, caso)
            assert.equal(error.tipo, TIPO_422, caso)
            assert.equal(error.errores?.[0]?.field, campo, caso)
        }
        // nada cambió
        const sinCambios = await deSistema(e.B)
        assert.deepEqual(
            sinCambios.map((m) => [Number(m.id), m.activo, Number(m.version)]),
            [[inst.id, true, inst.version]],
        )

        // el mismo código, nombre, cuenta e IVA: sí
        const editado = await new EditarConceptoCargo().execute(
            {
                id: inst.id,
                version: inst.version,
                codigo_sistema: 'instalacion',
                nombre: 'Instalación FTTH',
                cuenta_codigo: '4.1.04',
                gravable: false,
            },
            e.ctx,
        )
        assert.include(editado, {
            nombre: 'Instalación FTTH',
            codigo_sistema: 'instalacion',
            activo: true,
            version: inst.version + 1,
        })
        // otro concepto con codigo_sistema null explícito y desactivado: sí
        const v2 = await new EditarConceptoCargo().execute(
            { id: visita.id, version: visita.version, codigo_sistema: null, activo: false },
            e.ctx,
        )
        assert.include(v2, { activo: false, codigo_sistema: null })
    })

    test('la base impide cambiar, quitar o borrar el código aunque no se pase por la acción', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const inst = await porNombre(e.B, 'Instalación')
        const visita = await porNombre(e.B, 'Visita técnica')
        await assert.rejects(
            () => db.from('billing.conceptos_cargo').where('id', inst.id).update({ codigo_sistema: null }),
            /no se puede cambiar/,
        )
        await assert.rejects(
            () =>
                db
                    .from('billing.conceptos_cargo')
                    .where('id', visita.id)
                    .update({ codigo_sistema: 'instalacion' }),
            /no se puede cambiar/,
        )
        await assert.rejects(
            () => db.from('billing.conceptos_cargo').where('id', inst.id).delete(),
            /no se puede borrar/,
        )
        await assert.rejects(() =>
            db.from('billing.conceptos_cargo').where('id', inst.id).update({ codigo_sistema: 'otro_codigo' }),
        )
        const despues = await porNombre(e.B, 'Instalación')
        assert.equal(despues.codigo_sistema, 'instalacion')
    })

    test('GET /conceptos-cargo y /conceptos-cargo/:id devuelven codigo_sistema; PUT responde 422', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresas()
        const lista = await estado(
            client.get('/api/v1/conceptos-cargo').bearerToken(e.token).header('X-Empresa-Id', String(e.B)),
            200,
        )
        const filas = lista.body() as Array<{ nombre: string; codigo_sistema: string | null }>
        assert.isTrue(filas.every((f) => 'codigo_sistema' in f))
        assert.deepEqual(
            filas.filter((f) => f.codigo_sistema !== null).map((f) => [f.nombre, f.codigo_sistema]),
            [['Instalación', 'instalacion']],
        )
        assert.isTrue(filas.filter((f) => f.nombre !== 'Instalación').every((f) => f.codigo_sistema === null))

        const inst = await porNombre(e.B, 'Instalación')
        const uno = await estado(
            client
                .get(`/api/v1/conceptos-cargo/${inst.id}`)
                .bearerToken(e.token)
                .header('X-Empresa-Id', String(e.B)),
            200,
        )
        assert.equal(uno.body().codigo_sistema, 'instalacion')

        const r = await estado(
            client
                .put(`/api/v1/conceptos-cargo/${inst.id}`)
                .bearerToken(e.token)
                .header('X-Empresa-Id', String(e.B))
                .json({ version: inst.version, activo: false }),
            422,
        )
        assert.equal(r.body().type, TIPO_422)
        const q = await estado(
            client
                .put(`/api/v1/conceptos-cargo/${inst.id}`)
                .bearerToken(e.token)
                .header('X-Empresa-Id', String(e.B))
                .json({ version: inst.version, codigo_sistema: null }),
            422,
        )
        assert.equal(q.body().type, TIPO_422)
    })
})
