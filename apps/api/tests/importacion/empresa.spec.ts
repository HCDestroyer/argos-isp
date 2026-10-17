import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { EmpresaImportacionRequerida, importar } from '#importacion/importador'
import { cargaFinancieraA3, type CargaFinanciera } from '#importacion/carga_financiera'
import { formatearReporte } from '#importacion/reporte'
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

    test('--empresa llega explícito a facturas, pagos, promesas y saldos iniciales, y el reporte lo verifica por empresa', async ({
        assert,
    }) => {
        await crearEmpresaFila({ nombre_comercial: 'Cable Norte' })
        const empresa = await crearEmpresaFila({ nombre_comercial: 'Fibra Sur' })
        const plantillaId = await crearPlantillaFila()
        // Las entradas que reciben las acciones de A3 (el adaptador real, envuelto)
        const pedidas: Record<
            'facturas' | 'pagos' | 'promesas' | 'saldos',
            Array<number | null | undefined>
        > = {
            facturas: [],
            pagos: [],
            promesas: [],
            saldos: [],
        }
        const carga: CargaFinanciera = {
            ...cargaFinancieraA3,
            importarFactura: (e, ctx, t) => {
                pedidas.facturas.push(e.empresa_id)
                return cargaFinancieraA3.importarFactura(e, ctx, t)
            },
            registrarSaldoInicial: (e, ctx, t) => {
                pedidas.saldos.push(e.empresa_id)
                return cargaFinancieraA3.registrarSaldoInicial(e, ctx, t)
            },
            registrarPagoHistorico: (e, ctx, t) => {
                pedidas.pagos.push(e.empresa_id)
                return cargaFinancieraA3.registrarPagoHistorico!(e, ctx, t)
            },
            importarPromesa: (e, ctx, t) => {
                pedidas.promesas.push(e.empresa_id)
                return cargaFinancieraA3.importarPromesa!(e, ctx, t)
            },
        }
        const trx = await db.transaction()
        try {
            const r = await importar(await leerDumpMikrowisp(FIXTURE), {
                sistema: 'mikrowisp',
                dryRun: false,
                trx,
                plantillaId,
                carga,
                empresa: String(empresa),
            })
            for (const [nombre, lista] of Object.entries(pedidas)) {
                assert.isNotEmpty(lista, `${nombre}: la corrida llama la acción`)
                assert.deepEqual([...new Set(lista)], [empresa], `${nombre}: empresa_id explícito`)
            }

            // En la base: lo de la empresa (nueva en esta prueba) es exactamente lo de la corrida
            const enLaEmpresa = async (tabla: string) =>
                Number(
                    (
                        (await trx
                            .from(tabla)
                            .where({ origen: 'mikrowisp', empresa_id: empresa })
                            .count('* as n')
                            .first()) as { n: string }
                    ).n,
                )
            const porTabla = {
                facturas: ['billing.facturas', r.resumen.facturas],
                pagos: ['billing.pagos', r.resumen.pagos],
                promesas: ['billing.promesas', r.resumen.promesas],
                saldos_iniciales: ['billing.saldos_iniciales', r.resumen.saldos],
            } as const
            const fila = r.empresas.por_empresa.find((e) => e.empresa_id === empresa)!
            for (const [campo, [tabla, conteo]] of Object.entries(porTabla)) {
                const n = fila[campo as keyof typeof porTabla]
                assert.isAbove(n, 0, campo)
                assert.equal(n, conteo.creados + conteo.existentes, campo)
                assert.equal(await enLaEmpresa(tabla), n, tabla)
            }
            assert.equal(r.empresas.corrida, empresa)
            assert.deepEqual(
                r.empresas.por_empresa.map((e) => e.empresa_id),
                [empresa],
            )
            assert.lengthOf(r.empresas.fuera_de_empresa, 0)
            assert.equal(r.empresas.suma, r.saldos.suma_importada)
            assert.equal(fila.saldo, r.saldos.suma_importada)
            assert.isTrue(r.empresas.cuadra)
            assert.isTrue(r.saldos.cuadra)
            // Los asientos de lo importado también son de esa empresa (el libro de su NIT)
            const asientos = (await trx
                .from('ledger.asientos as a')
                .join('billing.facturas as f', (j) =>
                    j.on('f.id', 'a.origen_id').andOnVal('a.origen_tipo', 'factura'),
                )
                .where({ 'f.origen': 'mikrowisp', 'f.empresa_id': empresa })
                .distinct('a.empresa_id')) as Array<{ empresa_id: number }>
            assert.deepEqual(
                asientos.map((a) => Number(a.empresa_id)),
                [empresa],
            )
            assert.include(formatearReporte(r), `Empresas (CUADRA): empresa ${empresa} (corrida)`)
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
            // Lo ya importado sigue en Fibra Sur con su servicio: no cuenta como fuera de empresa
            assert.lengthOf(segunda.empresas.fuera_de_empresa, 0)
            assert.isTrue(segunda.empresas.cuadra)
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
