import { test } from '@japa/runner'
import { createHash } from 'node:crypto'
import { appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import db from '@adonisjs/lucid/services/db'
import { estado, soloEmpresaPrincipal, usuarioConRoles } from '#tests/ayudas'
import { errorDe } from '#tests/contabilidad/ayudas_contabilidad'
import { afirmarLibro } from '#tests/contabilidad/verificar_libro'
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'
import { cola, configurarModo, empresasFel, servicioFel } from '#tests/fiscal/ayudas_fel'
import { CERO, aTexto, dec } from '#ledger/dinero'
import RegistrarAsiento from '#ledger/actions/registrar_asiento'
import CerrarPeriodo from '#ledger/actions/cerrar_periodo'
import BloquearLibro from '#ledger/actions/bloquear_libro'
import HabilitarLibro from '#fiscal/actions/habilitar_libro'
import EmitirLibro from '#fiscal/actions/emitir_libro'
import { construirLibro, libroDiarioLegal, libroMayorLegal } from '#fiscal/libros_legales'
import { contenidoEmision, directorioLibros, empresaDelLibroLegal } from '#fiscal/libros_emisiones'
import { formatearDinero, libroPdf } from '#fiscal/libros_pdf'
import { hoyGuatemala, inicioDeMes } from '#ledger/fechas'
import type { ContextoAccion } from '#shared/contexto'

/**
 * Fase 6 · PR D (contrato de localización fiscal §7): libros legales con folio. Vista previa con
 * marca de agua, emisión oficial solo de meses cerrados y bloqueados, folios correlativos dentro
 * de lo habilitado, SHA-256 y último hash de la cadena guardados, reimpresión con folios nuevos.
 * Cada prueba usa empresas nuevas con la localización GT y termina en `afirmarLibro`.
 */

function asiento(ctx: ContextoAccion, empresaId: number, fecha: string, monto: string, descripcion?: string) {
    return new RegistrarAsiento().execute(
        {
            empresa_id: empresaId,
            fecha,
            descripcion: descripcion ?? `Venta de contado ${fecha}`,
            origen_tipo: 'ajuste',
            movimientos: [
                { cuenta: '1.1.02.01', debe: monto },
                { cuenta: '4.1.01', haber: monto },
            ],
        },
        ctx,
    )
}

/** Páginas de un PDF de pdfkit (los diccionarios de página no van comprimidos). */
function paginasPdf(pdf: Buffer): number {
    return (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length
}

async function enero2024Cerrado(ctx: ContextoAccion, empresaId: number) {
    await asiento(ctx, empresaId, '2024-01-10', '100.00')
    await asiento(ctx, empresaId, '2024-01-20', '250.50')
    await asiento(ctx, empresaId, '2024-02-05', '1000.00')
    await new CerrarPeriodo().execute({ empresa_id: empresaId, anio: 2024, mes: 1 }, ctx)
    await new CerrarPeriodo().execute({ empresa_id: empresaId, anio: 2024, mes: 2 }, ctx)
}

test.group('Fase 6 · libros con folio', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('Diario y Mayor: partidas, totales por partida, saldos y vista previa con marca de agua', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        await enero2024Cerrado(e.ctx, e.B)
        await asiento(e.ctx, e.B, '2024-03-01', '40.00', 'Marzo abierto')

        const diario = await libroDiarioLegal(e.B, { desde: '2024-01-01', hasta: '2024-03-31' })
        const movimientos = diario.reporte.filas.filter((f) => f.fila === 'movimiento')
        const totales = diario.reporte.filas.filter((f) => f.fila === 'total')
        assert.lengthOf(movimientos, 8)
        assert.lengthOf(totales, 4)
        // enero y febrero cerrados: partidas 1, 2, 3; marzo abierto: sin partida
        assert.deepEqual(
            totales.map((f) => [f.partida, f.debe, f.haber]),
            [
                [1, '100.00', '100.00'],
                [2, '250.50', '250.50'],
                [3, '1000.00', '1000.00'],
                [null, '40.00', '40.00'],
            ],
        )
        assert.deepEqual([diario.reporte.totales.debe, diario.reporte.totales.haber], ['1390.50', '1390.50'])

        const mayor = await libroMayorLegal(e.B, { desde: '2024-02-01', hasta: '2024-02-29' })
        const ingresos = mayor.reporte.filas.filter((f) => f.cuenta === '4.1.01')
        assert.deepEqual(
            ingresos.map((f) => [f.fila, f.debe, f.haber, f.saldo]),
            [
                ['saldo_inicial', '0.00', '0.00', '350.50'],
                ['movimiento', '0.00', '1000.00', '1350.50'],
                ['saldo_final', '0.00', '1000.00', '1350.50'],
            ],
        )
        assert.deepEqual(
            [mayor.reporte.totales.debe, mayor.reporte.totales.haber, mayor.reporte.totales.saldo],
            ['1000.00', '1000.00', null],
        )

        const empresa = await empresaDelLibroLegal(db.connection(), e.B)
        const borrador = await libroPdf({ libro: diario, empresa, generado_en: new Date() })
        assert.equal(borrador.pdf.subarray(0, 5).toString('latin1'), '%PDF-')
        assert.equal(borrador.paginas, 1)
        assert.equal(paginasPdf(borrador.pdf), 1)
        assert.equal(formatearDinero('-1234567.5'), '-1,234,567.50')
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('emisión oficial: 422 sin cierre ni bloqueo, 422 sin folios, folios correlativos, SHA-256, hash de la cadena y reimpresión', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        await asiento(e.ctx, e.B, '2024-01-10', '100.00')
        await asiento(e.ctx, e.B, '2024-02-05', '1000.00')
        const emitir = (desde = '2024-01-15', hasta = '2024-02-10', formato: 'pdf' | 'xlsx' = 'pdf') =>
            new EmitirLibro().execute({ empresa_id: e.B, libro: 'diario', desde, hasta, formato }, e.ctx)

        const abierto = await errorDe(emitir())
        assert.deepEqual([abierto.status, abierto.codigo], [422, 'periodo_sin_bloqueo'])
        assert.deepEqual(abierto.reglas, ['mes_abierto', 'mes_abierto', 'sin_bloqueo'])

        await new CerrarPeriodo().execute({ empresa_id: e.B, anio: 2024, mes: 1 }, e.ctx)
        await new CerrarPeriodo().execute({ empresa_id: e.B, anio: 2024, mes: 2 }, e.ctx)
        await new BloquearLibro().execute(
            { empresa_id: e.B, tipo: 'global', hasta: '2024-01-31', motivo: 'Enero declarado' },
            e.ctx,
        )
        const corto = await errorDe(emitir())
        assert.deepEqual([corto.codigo, corto.reglas], ['periodo_sin_bloqueo', ['sin_bloqueo']])
        await new BloquearLibro().execute(
            { empresa_id: e.B, tipo: 'global', hasta: '2024-02-29', motivo: 'Febrero declarado' },
            e.ctx,
        )

        const sinFolios = await errorDe(emitir())
        assert.deepEqual([sinFolios.status, sinFolios.codigo], [422, 'folios_agotados'])

        const habilitar = (folio_desde: number, folio_hasta: number) =>
            new HabilitarLibro().execute(
                {
                    empresa_id: e.B,
                    libro: 'diario',
                    autorizacion: 'SAT-7121 2024-0001',
                    folio_desde,
                    folio_hasta,
                    fecha: '2024-01-02',
                },
                e.ctx,
            )
        const habilitacion = await habilitar(1, 2)
        assert.include(habilitacion, { folio_desde: 1, folio_hasta: 2, usados: 0, disponibles: 2 })
        const salto = await errorDe(habilitar(5, 10))
        assert.deepEqual([salto.status, salto.codigo], [422, 'habilitacion_no_correlativa'])

        const primera = await emitir()
        assert.include(primera, {
            libro: 'diario',
            desde: '2024-01-01',
            hasta: '2024-02-29',
            folio_inicial: 1,
            folio_final: 1,
            paginas: 1,
            formato: 'pdf',
            reimpresion: false,
            filas: 6,
        })
        const cierreFebrero = await db
            .from('ledger.cierres_mensuales')
            .where({ empresa_id: e.B, periodo: '2024-02-01' })
            .firstOrFail()
        assert.equal(primera.ultimo_hash, cierreFebrero.ultimo_hash)
        assert.equal(primera.ultimo_sello, cierreFebrero.ultimo_sello)
        const archivo = await contenidoEmision(primera.id)
        assert.equal(archivo.tipo, 'application/pdf')
        assert.equal(createHash('sha256').update(archivo.contenido).digest('hex'), primera.sha256)
        assert.equal(paginasPdf(archivo.contenido), primera.paginas)

        // mismo rango: reimpresión con el folio siguiente
        const segunda = await emitir('2024-01-01', '2024-02-29')
        assert.include(segunda, {
            folio_inicial: 2,
            folio_final: 2,
            reimpresion: true,
            reimpresion_de: primera.id,
        })
        const agotados = await errorDe(emitir())
        assert.deepEqual([agotados.status, agotados.codigo], [422, 'folios_agotados'])

        // otra habilitación correlativa y una emisión en XLSX con el folio de cada fila
        await habilitar(3, 10)
        const xlsx = await emitir('2024-01-01', '2024-01-31', 'xlsx')
        assert.include(xlsx, {
            folio_inicial: 3,
            formato: 'xlsx',
            reimpresion: true,
            reimpresion_de: segunda.id,
        })
        const hoja = await contenidoEmision(xlsx.id)
        assert.equal(hoja.contenido.subarray(0, 2).toString('latin1'), 'PK')

        // evento y auditoría
        const eventos = await db
            .from('audit.outbox')
            .where('evento', 'libro.emitido')
            .whereRaw(`(payload->>'empresa_id')::bigint = ?`, [e.B])
            .orderBy('id')
        assert.deepEqual(
            eventos.map((x) => [x.payload.emision_id, x.payload.folio_inicial, x.payload.reimpresion_de]),
            [
                [primera.id, 1, null],
                [segunda.id, 2, primera.id],
                [xlsx.id, 3, segunda.id],
            ],
        )
        assert.equal(eventos[0].payload.sha256, primera.sha256)
        const auditoria = await db
            .from('audit.acciones')
            .where('accion', 'libros.emitir')
            .where('entidad_id', primera.id)
            .firstOrFail()
        assert.equal(auditoria.empresa_id, e.B)

        // un archivo alterado en disco ya no se entrega
        const fila = await db.from('fiscal.libros_emisiones').where('id', primera.id).firstOrFail()
        await appendFile(join(directorioLibros(), fila.archivo), 'x')
        const alterado = await errorDe(contenidoEmision(primera.id))
        assert.deepEqual([alterado.status, alterado.codigo], [409, 'archivo_alterado'])

        // la empresa C no ve ni comparte los folios de B
        const otra = await errorDe(
            new EmitirLibro().execute({ empresa_id: e.C, libro: 'diario', desde: '2024-01-01' }, e.ctx),
        )
        assert.equal(otra.codigo, 'periodo_sin_bloqueo')
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('solo inserción: trigger de folios correlativos y UPDATE, DELETE y TRUNCATE rechazados', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        await new HabilitarLibro().execute(
            {
                empresa_id: e.B,
                libro: 'mayor',
                autorizacion: 'SAT-7121 2024-0002',
                folio_desde: 100,
                folio_hasta: 199,
                fecha: '2024-01-02',
            },
            e.ctx,
        )
        const intentar = (sql: string, bindings: unknown[] = []) =>
            db.transaction(async (trx) => {
                await trx.rawQuery(sql, bindings as never)
                throw new Error('no lo rechazó')
            })
        // la base exige el folio siguiente y no deja saltar la habilitación
        const insertar = (inicial: number, paginas: number) =>
            intentar(
                `INSERT INTO fiscal.libros_emisiones (empresa_id, libro, desde, hasta, folio_inicial, folio_final,
                     paginas, formato, archivo, tamano, sha256, filas)
                 VALUES (?, 'mayor', '2024-01-01', '2024-01-31', ?, ?, ?, 'pdf', 'x.pdf', 1, repeat('a', 64), 0)`,
                [e.B, inicial, inicial + paginas - 1, paginas],
            )
        await assert.rejects(() => insertar(101, 1), /debe empezar en el folio 100/)
        await assert.rejects(() => insertar(100, 101), /pasa del último folio habilitado/)
        await assert.rejects(
            () =>
                intentar(
                    `INSERT INTO fiscal.libros_habilitados (empresa_id, libro, autorizacion, folio_desde, folio_hasta, fecha)
                     VALUES (?, 'mayor', 'SAT-7121 2024-0003', 250, 300, '2024-01-02')`,
                    [e.B],
                ),
            /debe empezar en el folio 200/,
        )
        for (const tabla of ['fiscal.libros_habilitados']) {
            await assert.rejects(() => intentar(`UPDATE ${tabla} SET created_at = created_at`), /inmutable/)
            await assert.rejects(() => intentar(`DELETE FROM ${tabla}`), /inmutable/)
            await assert.rejects(() => intentar(`TRUNCATE ${tabla} CASCADE`), /inmutable/)
        }
        await assert.rejects(() => intentar('TRUNCATE fiscal.libros_emisiones CASCADE'), /inmutable/)
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('libro de ventas: DTE certificados y facturas sin FEL; compras y ventas emitidos sobre un mes vacío', async ({
        assert,
    }) => {
        const e = await empresasFel('obligatoria')
        const conDte = await servicioFel(e, 'emitir', '112.00')
        await cola(e)
        const mes = { desde: inicioDeMes(hoyGuatemala()), hasta: hoyGuatemala() }
        const ventas = await construirLibro('ventas', e.B, mes)
        const dte = ventas.reporte.filas.filter((f) => f.origen === 'dte')
        assert.isAtLeast(dte.length, 1)
        assert.include(dte[0], { tipo: 'FACT', total: conDte.facturas[0]!.total, estado: 'vigente' })
        assert.isNotNull(dte[0]!.autorizacion)
        assert.equal(dte[0]!.iva, conDte.facturas[0]!.iva)

        // sin FEL (empresa C desactivada): la factura con la fecha de su asiento
        await configurarModo(e, e.C, 'desactivada')
        const sinFel = await servicioFel(e, 'nunca', '224.00', undefined, e.C)
        const ventasC = await construirLibro('ventas', e.C, mes)
        assert.deepEqual(
            ventasC.reporte.filas.map((f) => [f.origen, f.documento, f.total, f.iva, f.nit]),
            sinFel.facturas.map((f) => ['interno', `Factura ${f.id}`, f.total, f.iva, 'CF']),
        )
        const ivaC = sinFel.facturas.reduce((s, f) => s.plus(dec(f.iva)), CERO)
        assert.equal(ventasC.reporte.totales.iva, aTexto(ivaC))

        // mes vacío, cerrado y bloqueado: una página y el folio siguiente
        await new CerrarPeriodo().execute({ empresa_id: e.C, anio: 2024, mes: 1 }, e.ctx)
        await new BloquearLibro().execute(
            { empresa_id: e.C, tipo: 'global', hasta: '2024-01-31', motivo: 'Enero declarado' },
            e.ctx,
        )
        for (const libro of ['ventas', 'compras'] as const) {
            await new HabilitarLibro().execute(
                {
                    empresa_id: e.C,
                    libro,
                    autorizacion: 'SAT-7121 2024-0009',
                    folio_desde: 1,
                    folio_hasta: 50,
                    fecha: '2024-01-02',
                },
                e.ctx,
            )
            const emision = await new EmitirLibro().execute(
                { empresa_id: e.C, libro, desde: '2024-01-01' },
                e.ctx,
            )
            assert.include(emision, { libro, folio_inicial: 1, paginas: 1, filas: 0 })
        }
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('HTTP: vista previa en PDF, habilitar, emitir con varias páginas, descargar y permisos', async ({
        assert,
        client,
    }) => {
        const e = await prepararEmpresasGt()
        for (let i = 1; i <= 45; i++) {
            await asiento(e.ctx, e.B, `2024-01-${String((i % 28) + 1).padStart(2, '0')}`, `${i}.00`)
        }
        await new CerrarPeriodo().execute({ empresa_id: e.B, anio: 2024, mes: 1 }, e.ctx)
        await new BloquearLibro().execute(
            { empresa_id: e.B, tipo: 'global', hasta: '2024-01-31', motivo: 'Enero declarado' },
            e.ctx,
        )
        const cabecera = { 'X-Empresa-Id': String(e.B) }
        const preview = await estado(
            client
                .get('/api/v1/libros/diario')
                .bearerToken(e.token)
                .headers(cabecera)
                .qs({ desde: '2024-01-01', hasta: '2024-01-31' }),
            200,
        )
        assert.equal(preview.body().reporte, 'libro-diario')
        assert.equal(preview.body().totales.debe, '1035.00')
        const pdf = await client
            .get('/api/v1/libros/diario')
            .bearerToken(e.token)
            .headers(cabecera)
            .qs({ desde: '2024-01-01', hasta: '2024-01-31', formato: 'pdf' })
        pdf.assertStatus(200)
        assert.equal(pdf.header('content-type'), 'application/pdf')
        for (const ruta of ['/api/v1/libros/compras', '/api/v1/libros/ventas', '/api/v1/libros/mayor']) {
            const r = await client.get(ruta).bearerToken(e.token).headers(cabecera).qs({ formato: 'pdf' })
            r.assertStatus(200)
            assert.equal(r.header('content-type'), 'application/pdf', ruta)
        }

        await estado(
            client.post('/api/v1/libros/habilitaciones').bearerToken(e.token).headers(cabecera).json({
                libro: 'diario',
                autorizacion: 'SAT-7121 2024-0100',
                folio_desde: 1,
                folio_hasta: 20,
                fecha: '2024-01-02',
            }),
            201,
        )
        const emision = await estado(
            client
                .post('/api/v1/libros/diario/emitir')
                .bearerToken(e.token)
                .headers({ ...cabecera, 'Idempotency-Key': `libro-${e.B}` })
                .json({ desde: '2024-01-01' }),
            201,
        )
        // 45 asientos de dos movimientos más su total: varias páginas, un folio por página
        assert.isAbove(emision.body().paginas, 1)
        assert.equal(emision.body().folio_final, emision.body().paginas)
        const archivo = await contenidoEmision(emision.body().id)
        assert.equal(paginasPdf(archivo.contenido), emision.body().paginas)
        const descarga = await client
            .get(`/api/v1/libros/emisiones/${emision.body().id}/archivo`)
            .bearerToken(e.token)
            .headers(cabecera)
        descarga.assertStatus(200)
        assert.equal(descarga.header('content-type'), 'application/pdf')

        const folios = await estado(
            client.get('/api/v1/libros/folios').bearerToken(e.token).headers(cabecera),
            200,
        )
        assert.containSubset(
            folios.body().find((f: { libro: string }) => f.libro === 'diario'),
            { siguiente: emision.body().paginas + 1, ultimo_habilitado: 20 },
        )
        const lista = await estado(
            client.get('/api/v1/libros/emisiones').bearerToken(e.token).headers(cabecera),
            200,
        )
        assert.equal(lista.body().data[0].id, emision.body().id)
        await estado(
            client.post('/api/v1/libros/inventarios/emitir').bearerToken(e.token).headers(cabecera).json({
                desde: '2024-01-01',
            }),
            404,
        )

        // cajero: ni vista previa ni emisión; contabilidad sí emite
        const cajero = await usuarioConRoles(['cajero'])
        await estado(client.get('/api/v1/libros/diario').bearerToken(cajero.token), 403)
        await estado(
            client
                .post('/api/v1/libros/diario/emitir')
                .bearerToken(cajero.token)
                .json({ desde: '2024-01-01' }),
            403,
        )
        const contador = await usuarioConRoles(['contabilidad'])
        await estado(
            client
                .post('/api/v1/libros/mayor/emitir')
                .bearerToken(contador.token)
                .headers(cabecera)
                .json({ desde: '2024-01-01' }),
            422,
        )
        await afirmarLibro(assert, [e.B, e.C])
    })
})
