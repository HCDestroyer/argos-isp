import { fileURLToPath } from 'node:url'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { leerDirectorio } from '#importacion/origenes/csv'
import { importar } from '#importacion/importador'
import { formatearReporte, type ReporteImportacion } from '#importacion/reporte'
import type { FuenteCanonica } from '#importacion/canonico'
import { contextoSistema } from '#shared/contexto'
import { hoyGuatemala } from '#ledger/fechas'
import CrearPlantilla from '#billing/actions/crear_plantilla'
import EmitirFactura from '#billing/actions/emitir_factura'
import { PLANTILLAS_FABRICA } from '#billing/plantillas_fabrica'
import { configuracionDeServicio, leerServicio } from '#billing/configuracion'
import {
    claveFactura,
    periodosDesde,
    periodosHasta,
    primerPeriodoTrasAsignacion,
    sumarDias,
} from '#billing/periodos'

/**
 * Plantillas de fábrica (A3, 18 nov) e importador: sin `--plantilla`, los servicios entran con la
 * plantilla por defecto («Genera 1 · vence 15»). Sin `facturar_desde`, `generarFacturas` les
 * emitiría todos los periodos desde `fecha_instalacion` (el ejemplo instala en 2024). El importador
 * deja `billing.servicios_facturar_desde` (`importacion.fijar_facturar_desde`) con el criterio de
 * la asignación de A3 y, si hay facturas importadas posteriores, después de la última.
 *
 * Todo corre en una transacción externa que se revierte (como `importador.spec.ts`).
 */

const EJEMPLO = fileURLToPath(new URL('../../../../scripts/importacion/ejemplo/', import.meta.url))
const FABRICA = PLANTILLAS_FABRICA[0]!

/** Instalación con la plantilla de fábrica por defecto (dentro de `trx`): su id. */
async function conPlantillaFabrica(trx: TransactionClientContract): Promise<number> {
    await trx.from('billing.plantillas_facturacion').where('por_defecto', true).update({ por_defecto: false })
    const existente = (await trx
        .from('billing.plantillas_facturacion')
        .where('nombre', FABRICA.nombre)
        .select('id')
        .first()) as { id: number } | null
    if (existente) {
        await trx
            .from('billing.plantillas_facturacion')
            .where('id', existente.id)
            .update({ por_defecto: true, retirada_en: null })
        return Number(existente.id)
    }
    const { por_defecto_si_no_hay: marcable, ...entrada } = FABRICA
    const creada = await new CrearPlantilla().execute(
        { ...entrada, por_defecto: Boolean(marcable) },
        contextoSistema('consola'),
        { trx },
    )
    return Number((creada as { id: number }).id)
}

/** Servicios creados por la corrida, con su `facturar_desde` y origen guardados. */
async function serviciosCreados(trx: TransactionClientContract, r: ReporteImportacion) {
    const filas = (await trx
        .from('audit.acciones as a')
        .join('core.servicios as s', 's.id', 'a.entidad_id')
        .leftJoin('billing.servicios_facturar_desde as fd', 'fd.servicio_id', 's.id')
        .where({ 'a.request_id': r.request_id, 'a.accion': 'servicios.crear', 'a.resultado': 'ok' })
        .select(
            's.id',
            's.plantilla_facturacion_id',
            'fd.origen',
            trx.raw(`to_char(fd.facturar_desde, 'YYYY-MM-DD') as facturar_desde`),
        )) as Array<{
        id: number
        plantilla_facturacion_id: number | null
        origen: string | null
        facturar_desde: string | null
    }>
    return filas.map((f) => ({ ...f, id: Number(f.id) }))
}

/** Lo que `generarFacturas` emitiría hoy al servicio (su misma regla) y lo que emitiría sin `facturar_desde`. */
async function periodosPendientes(trx: TransactionClientContract, servicioId: number, desde: string | null) {
    const servicio = await leerServicio(trx, servicioId)
    const config = (await configuracionDeServicio(trx, servicio))!
    const claves = new Set(
        (
            (await trx
                .from('billing.facturas')
                .where('servicio_id', servicioId)
                .select('clave_unica')) as Array<{
                clave_unica: string
            }>
        ).map((f) => f.clave_unica),
    )
    const todos = periodosHasta(config, servicio.inicio, hoyGuatemala())
    const sinFacturar = (lista: typeof todos) =>
        lista.filter((p) => !claves.has(claveFactura(servicioId, p.periodo)))
    return {
        servicio,
        config,
        todos,
        sinFiltro: sinFacturar(todos),
        conFiltro: sinFacturar(periodosDesde(todos, desde)),
    }
}

test.group('importacion · facturar desde (plantillas de fábrica)', () => {
    test('sin --plantilla toma la de fábrica y no emite periodos atrasados', async ({ assert }) => {
        const fuente = await leerDirectorio(EJEMPLO)
        const trx = await db.transaction()
        try {
            const fabrica = await conPlantillaFabrica(trx)
            const r = await importar(fuente, { sistema: 'mikrowisp', dryRun: false, trx })
            assert.equal(r.facturacion.plantilla_id, fabrica)
            assert.isEmpty(
                r.errores.filter((e) => e.accion === 'importacion.fijar_facturar_desde'),
                JSON.stringify(r.errores),
            )

            const creados = await serviciosCreados(trx, r)
            assert.isAbove(creados.length, 0)
            assert.lengthOf(r.facturacion.servicios, creados.length)
            const hoy = hoyGuatemala()
            let atrasadosSinArreglo = 0
            for (const s of creados) {
                assert.equal(s.plantilla_facturacion_id, fabrica)
                assert.equal(s.origen, 'importacion', `servicio ${s.id} sin facturar_desde`)
                const p = await periodosPendientes(trx, s.id, s.facturar_desde)
                // mismo criterio que la asignación de A3 (ninguna factura importada posterior en el ejemplo)
                assert.equal(
                    s.facturar_desde,
                    primerPeriodoTrasAsignacion(p.config, p.servicio.inicio, sumarDias(hoy, 1)),
                )
                assert.isTrue(s.facturar_desde! > hoy, `${s.facturar_desde} > ${hoy}`)
                // generarFacturas no tendría nada que emitir hoy; sin facturar_desde, sí (los atrasados)
                assert.deepEqual(p.conFiltro, [], `servicio ${s.id}`)
                atrasadosSinArreglo += p.sinFiltro.length
                // EmitirFactura tampoco emite un periodo anterior
                if (p.todos.length > 0) {
                    const emitida = await new EmitirFactura().execute(
                        { servicio_id: s.id, periodo: p.todos[0]! },
                        contextoSistema('consola'),
                        { trx },
                    )
                    assert.isFalse(emitida.creada)
                    assert.equal(emitida.motivo, 'antes_de_facturar_desde')
                }
                // diff en audit.cambios
                const cambio = (await trx
                    .from('audit.cambios')
                    .where({ entidad_tipo: 'servicio', entidad_id: s.id, campo: 'facturar_desde' })
                    .orderBy('id', 'desc')
                    .first()) as { despues: unknown } | null
                assert.exists(cambio, `sin audit.cambios del servicio ${s.id}`)
                assert.include(JSON.stringify(cambio!.despues), s.facturar_desde!)
            }
            // la prueba tiene sentido: el ejemplo instala en 2024, habría decenas de periodos atrasados
            assert.isAbove(atrasadosSinArreglo, 10)
            assert.include(formatearReporte(r), 'nada hacia atrás')
            const auditadas = (await trx
                .from('audit.acciones')
                .where({
                    request_id: r.request_id,
                    accion: 'importacion.fijar_facturar_desde',
                    resultado: 'ok',
                })
                .count('* as n')
                .first()) as { n: string }
            assert.equal(Number(auditadas.n), creados.length)

            // idempotente: la segunda corrida no crea servicios ni mueve las fechas
            const segunda = await importar(fuente, { sistema: 'mikrowisp', dryRun: false, trx })
            assert.equal(segunda.resumen.servicios.creados, 0)
            assert.isEmpty(segunda.facturacion.servicios)
            const despues = await serviciosCreados(trx, r)
            assert.deepEqual(
                despues.map((s) => s.facturar_desde),
                creados.map((s) => s.facturar_desde),
            )
        } finally {
            await trx.rollback()
        }
    })

    test('con facturas importadas del ciclo siguiente, facturar_desde queda después: no se duplica el periodo', async ({
        assert,
    }) => {
        const original = await leerDirectorio(EJEMPLO)
        const trx = await db.transaction()
        try {
            await conPlantillaFabrica(trx)
            // «Genera 1»: el siguiente ciclo tras hoy empieza el día 1 del mes que viene; el origen ya
            // emitió esa factura (y la de octubre) del servicio 1001
            const hoy = hoyGuatemala()
            const [anio, mes] = hoy.split('-').map(Number) as [number, number]
            const siguiente = `${mes === 12 ? anio + 1 : anio}-${String((mes % 12) + 1).padStart(2, '0')}-01`
            const fuente: FuenteCanonica = {
                ...original,
                facturas: [
                    ...original.facturas,
                    {
                        ...original.facturas.find((f) => f.id === '5001')!,
                        id: '5901',
                        periodo: siguiente,
                        vence: null,
                        concepto: 'Internet del mes siguiente (emitida en el origen)',
                    },
                ],
            }
            const r = await importar(fuente, { sistema: 'mikrowisp', dryRun: false, trx })
            const s1001 = r.facturacion.servicios.find((s) => s.servicio_origen === '1001')
            assert.exists(s1001, JSON.stringify(r.errores))
            assert.equal(s1001!.ultimo_periodo_importado, siguiente)
            const importada = (await trx
                .from('billing.facturas')
                .where({ origen: 'mikrowisp', clave_externa: 'mikrowisp:factura:5901' })
                .select('servicio_id')
                .firstOrFail()) as { servicio_id: number }
            const id1001 = Number(importada.servicio_id)

            const p = await periodosPendientes(trx, id1001, s1001!.facturar_desde)
            const base = primerPeriodoTrasAsignacion(p.config, p.servicio.inicio, sumarDias(hoy, 1))
            assert.equal(base, siguiente)
            assert.equal(
                s1001!.facturar_desde,
                primerPeriodoTrasAsignacion(p.config, p.servicio.inicio, sumarDias(siguiente, 1)),
            )
            assert.isTrue(s1001!.facturar_desde > siguiente)

            // el periodo importado existe una sola vez, y generarFacturas no emitiría otro
            const delPeriodo = (await trx
                .from('billing.facturas')
                .where('servicio_id', id1001)
                .where('periodo', siguiente)
                .count('* as n')
                .first()) as { n: string }
            assert.equal(Number(delPeriodo.n), 1)
            assert.deepEqual(p.conFiltro, [])
            const repetida = await new EmitirFactura().execute(
                {
                    servicio_id: id1001,
                    periodo: periodosHasta(p.config, p.servicio.inicio, siguiente).at(-1)!,
                },
                contextoSistema('consola'),
                { trx },
            )
            assert.isFalse(repetida.creada)

            // los demás servicios siguen con el criterio de la asignación
            const creados = await serviciosCreados(trx, r)
            const otros = creados.filter((x) => x.id !== id1001)
            assert.isAbove(otros.length, 0)
            for (const s of otros) {
                const q = await periodosPendientes(trx, s.id, s.facturar_desde)
                assert.equal(
                    s.facturar_desde,
                    primerPeriodoTrasAsignacion(q.config, q.servicio.inicio, sumarDias(hoy, 1)),
                )
            }
        } finally {
            await trx.rollback()
        }
    })
})
