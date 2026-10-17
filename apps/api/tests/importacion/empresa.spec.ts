import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { EmpresaImportacionRequerida, importar } from '#importacion/importador'
import { leerDumpMikrowisp } from '#importacion/origenes/mikrowisp'
import { crearPlantillaFila } from '#tests/billing/ayudas_billing'
import { archivoSintetico } from '#tests/importacion/ayudas_importacion'
import { crearEmpresaFila } from '#tests/core/fabricas'
import { soloEmpresaPrincipal } from '#tests/ayudas'

/**
 * Importación y multiempresa (`contratos/multiempresa.md`): `--empresa=<id|nit>` asigna todo lo
 * importado a esa empresa (servicios y lo que cuelga de ellos, empresa sugerida de zonas y
 * routers, auditoría y archivo del origen); sin ella, con varias empresas activas, la corrida
 * falla antes de tocar nada. Y `--excluir-tablas` deja tablas sin equivalente fuera del archivo.
 */
test.group('importacion · empresa de la corrida', (group) => {
    let FIXTURE: string
    group.setup(async () => {
        FIXTURE = await archivoSintetico('mikrowisp')
    })
    group.each.teardown(() => soloEmpresaPrincipal())

    test('con dos empresas activas y sin --empresa falla con la lista y no guarda nada', async ({
        assert,
    }) => {
        const otra = await crearEmpresaFila({ nombre_comercial: 'Fibra Sur' })
        const antes = (await db.from('core.servicios').count('* as n').first()) as { n: string }
        const trx = await db.transaction()
        try {
            await importar(await leerDumpMikrowisp(FIXTURE), { sistema: 'mikrowisp', dryRun: true, trx })
            assert.fail('debía fallar')
        } catch (error) {
            assert.instanceOf(error, EmpresaImportacionRequerida)
            const mensaje = (error as Error).message
            assert.include(mensaje, 'Hay 2 empresas activas')
            assert.include(mensaje, `${otra} (Fibra Sur`)
            assert.include(mensaje, '--empresa=<id|nit>')
        } finally {
            await trx.rollback()
        }
        const despues = (await db.from('core.servicios').count('* as n').first()) as { n: string }
        assert.equal(despues.n, antes.n)
    })

    test('--empresa inexistente o desactivada falla con un mensaje claro', async ({ assert }) => {
        const desactivada = await crearEmpresaFila({ activa: false })
        const fuente = await leerDumpMikrowisp(FIXTURE)
        for (const [valor, texto] of [
            ['999999', 'no hay ninguna empresa con ese id o NIT'],
            [String(desactivada), 'está desactivada'],
        ] as const) {
            const trx = await db.transaction()
            try {
                await importar(fuente, { sistema: 'mikrowisp', dryRun: true, trx, empresa: valor })
                assert.fail('debía fallar')
            } catch (error) {
                assert.instanceOf(error, EmpresaImportacionRequerida)
                assert.include((error as Error).message, texto)
            } finally {
                await trx.rollback()
            }
        }
    })

    test('--empresa=<id> asigna servicios, facturas, zonas, routers, auditoría y archivo a esa empresa', async ({
        assert,
    }) => {
        await crearEmpresaFila({ nombre_comercial: 'Cable Norte' })
        const empresa = await crearEmpresaFila({ nombre_comercial: 'Fibra Sur' })
        const plantillaId = await crearPlantillaFila()
        const trx = await db.transaction()
        try {
            const r = await importar(await leerDumpMikrowisp(FIXTURE), {
                sistema: 'mikrowisp',
                dryRun: false,
                trx,
                plantillaId,
                empresa: String(empresa),
            })
            assert.deepEqual(r.empresa.id, empresa)
            assert.equal(r.empresa.nombre, 'Fibra Sur')
            assert.isAbove(r.resumen.servicios.creados, 0)
            assert.isTrue(r.saldos.cuadra)

            // Lo que creó esta corrida (otras pruebas pueden haber dejado importaciones confirmadas)
            const creados = async (accion: string) =>
                (
                    (await trx
                        .from('audit.acciones')
                        .where({ request_id: r.request_id, accion, resultado: 'ok' })
                        .select('entidad_id')) as Array<{ entidad_id: number }>
                ).map((a) => Number(a.entidad_id))
            const idsServicios = await creados('servicios.crear')
            assert.lengthOf(idsServicios, r.resumen.servicios.creados)
            const servicios = (await trx
                .from('core.servicios')
                .whereIn('id', idsServicios)
                .distinct('empresa_id')) as Array<{ empresa_id: number }>
            assert.deepEqual(
                servicios.map((x) => Number(x.empresa_id)),
                [empresa],
            )
            const facturas = (await trx
                .from('billing.facturas as f')
                .join('core.servicios as s', 's.id', 'f.servicio_id')
                .whereIn('s.id', idsServicios)
                .distinct('s.empresa_id')) as Array<{ empresa_id: number }>
            assert.isNotEmpty(facturas)
            assert.deepEqual(
                facturas.map((f) => Number(f.empresa_id)),
                [empresa],
            )
            const idsRouters = await creados('routers.crear')
            assert.isNotEmpty(idsRouters)
            const routers = (await trx
                .from('network.routers')
                .whereIn('id', idsRouters)
                .distinct('empresa_sugerida_id')) as Array<{ empresa_sugerida_id: number }>
            assert.deepEqual(
                routers.map((x) => Number(x.empresa_sugerida_id)),
                [empresa],
            )
            assert.isAbove(r.resumen.zonas.creados, 0)
            const zonas = (await trx
                .from('audit.acciones as a')
                .join('core.zonas as z', 'z.id', 'a.entidad_id')
                .where({ 'a.request_id': r.request_id, 'a.accion': 'zonas.crear', 'a.resultado': 'ok' })
                .distinct('z.empresa_sugerida_id')) as Array<{ empresa_sugerida_id: number }>
            assert.deepEqual(
                zonas.map((z) => Number(z.empresa_sugerida_id)),
                [empresa],
            )
            const archivo = (await trx
                .from('importacion.filas_origen')
                .where({ origen: 'mikrowisp', request_id: r.request_id })
                .distinct('empresa_id')) as Array<{ empresa_id: number }>
            assert.deepEqual(
                archivo.map((a) => Number(a.empresa_id)),
                [empresa],
            )
            const auditoria = (await trx
                .from('audit.acciones')
                .where('request_id', r.request_id)
                .distinct('empresa_id')) as Array<{ empresa_id: number }>
            assert.deepEqual(
                auditoria.map((a) => Number(a.empresa_id)),
                [empresa],
            )
        } finally {
            await trx.rollback()
        }
    })

    test('--empresa por NIT; una segunda corrida con otra empresa no mueve lo ya importado y lo reporta', async ({
        assert,
    }) => {
        const norte = await crearEmpresaFila({ nombre_comercial: 'Cable Norte' })
        const sur = await crearEmpresaFila({ nombre_comercial: 'Fibra Sur' })
        const nitSur = (
            (await db.from('core.empresas').where('id', sur).select('nit').firstOrFail()) as { nit: string }
        ).nit
        const plantillaId = await crearPlantillaFila()
        const trx = await db.transaction()
        try {
            const primera = await importar(await leerDumpMikrowisp(FIXTURE), {
                sistema: 'mikrowisp',
                dryRun: false,
                trx,
                plantillaId,
                empresa: `${nitSur.slice(0, -1)}-${nitSur.slice(-1)}`.toLowerCase(),
            })
            assert.equal(primera.empresa.id, sur)
            const segunda = await importar(await leerDumpMikrowisp(FIXTURE), {
                sistema: 'mikrowisp',
                dryRun: true,
                trx,
                plantillaId,
                empresa: norte,
            })
            assert.equal(segunda.resumen.servicios.creados, 0)
            // Los que la primera corrida dejó en Fibra Sur salen en el reporte, ninguno se movió
            const enSur = segunda.diferencias.servicios_otra_empresa.filter((x) => x.empresa_id === sur)
            assert.lengthOf(enSur, primera.resumen.servicios.creados)
            const movidos = await trx
                .from('core.servicios')
                .whereIn(
                    'id',
                    enSur.map((x) => x.servicio_id),
                )
                .whereNot('empresa_id', sur)
            assert.lengthOf(movidos, 0)
        } finally {
            await trx.rollback()
        }
    })
})

test.group('importacion · --excluir-tablas', (group) => {
    let FIXTURE: string
    group.setup(async () => {
        FIXTURE = await archivoSintetico('mikrowisp')
    })

    test('una tabla sin equivalente queda fuera del archivo y del cuadre; una tabla que se importa no se puede excluir', async ({
        assert,
    }) => {
        const plantillaId = await crearPlantillaFila()
        const fuente = await leerDumpMikrowisp(FIXTURE)
        const vinculadas = new Set([...fuente.archivo!.vinculos.keys()].map((k) => k.split('#')[0]))
        const libre = fuente.archivo!.tablas.find((t) => t.filas.length > 0 && !vinculadas.has(t.tabla))!
        assert.exists(libre, 'el volcado sintético trae alguna tabla solo de archivo')

        const trx = await db.transaction()
        try {
            const r = await importar(fuente, {
                sistema: 'mikrowisp',
                dryRun: false,
                trx,
                plantillaId,
                excluirTablas: [libre.tabla.toUpperCase(), ' '],
            })
            assert.deepEqual(r.tablas_excluidas, [{ tabla: libre.tabla, filas: libre.filas.length }])
            assert.notInclude(
                r.tablas.map((t) => t.tabla),
                libre.tabla,
            )
            const guardadas = (await trx
                .from('importacion.filas_origen')
                .where({ origen: 'mikrowisp', tabla: libre.tabla })
                .count('* as n')
                .first()) as { n: string }
            assert.equal(Number(guardadas.n), 0)
            assert.isTrue(r.saldos.cuadra)
        } finally {
            await trx.rollback()
        }

        const mapeada = [...vinculadas][0]!
        for (const [tabla, texto] of [
            [mapeada, 'no se puede excluir'],
            ['radacct_que_no_existe', 'no está en el volcado'],
        ]) {
            const otra = await db.transaction()
            try {
                await importar(fuente, {
                    sistema: 'mikrowisp',
                    dryRun: true,
                    trx: otra,
                    excluirTablas: [tabla!],
                })
                assert.fail('debía fallar')
            } catch (error) {
                assert.include((error as Error).message, texto!)
            } finally {
                await otra.rollback()
            }
        }
    })
})
