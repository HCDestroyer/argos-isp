import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, soloEmpresaPrincipal, usuarioConRoles } from '#tests/ayudas'
import { afirmarLibroCuadrado, nuevaCaja, saldoTexto } from '#tests/ledger/ayudas_libro'
import { crearEmpresaFila, crearZonaFila } from '#tests/core/fabricas'
import {
    cuentaBancariaPrueba,
    bancoId,
    eventosDe,
    facturasDe,
    reglasPromesaSinTopeFacturacion,
    servicioCortado,
    unicoBd,
} from '#tests/billing/ayudas_billing'
import RegistrarPago from '#billing/actions/registrar_pago'
import AnularPago from '#billing/actions/anular_pago'
import CrearPromesaPago from '#billing/actions/crear_promesa_pago'
import AnularFactura from '#billing/actions/anular_factura'
import AbrirCaja from '#ledger/actions/abrir_caja'
import CerrarCaja from '#ledger/actions/cerrar_caja'
import RegistrarEgreso from '#ledger/actions/registrar_egreso'
import { aTexto, dec } from '#ledger/dinero'
import { hoyGuatemala } from '#ledger/fechas'
import { ConsumidorResumenes, refrescarResumenes } from '#billing/reportes/resumenes'
import { aCsv } from '#billing/reportes/exportar'
import { carteraVencida, ivaDelPeriodo } from '#billing/reportes/reportes'

/**
 * Reportes (semana 2): cada uno cuadra contra el libro con datos de prueba, exporta CSV y XLSX,
 * y el dashboard se refresca por evento (no por intervalo) de forma idempotente.
 */

const CORTE = '2026-10-16'
// Día de la prueba, tomado al empezar cada prueba (`tomarDia` en el setup de cada grupo), nunca al
// importar el archivo: Japa importa todos los archivos al arrancar y una corrida que cruza la
// medianoche de Guatemala (06:00 UTC) o el fin de mes comparaba contra el día anterior, mientras la app
// (`hoyGuatemala()`, `relojFiscal`) ya leía el siguiente.
let MES = ''
function tomarDia() {
    MES = hoyGuatemala().slice(0, 7)
}

/** Σ (debe − haber) de las cuentas cuyo código empieza con `prefijo`, filtrado por asientos. */
async function netoLibro(
    prefijos: string[],
    filtro: (q: ReturnType<typeof db.from>) => void,
): Promise<string> {
    const q = db
        .from('ledger.movimientos as m')
        .join('ledger.asientos as a', 'a.id', 'm.asiento_id')
        .join('ledger.cuentas as c', 'c.id', 'm.cuenta_id')
        .where((w) => {
            for (const p of prefijos) w.orWhere('c.codigo', 'like', `${p}%`)
        })
    filtro(q)
    const fila = (await q
        .select(
            db.raw('coalesce(sum(m.debe), 0)::text as debe'),
            db.raw('coalesce(sum(m.haber), 0)::text as haber'),
        )
        .first()) as { debe: string; haber: string }
    return aTexto(dec(fila.debe).minus(fila.haber))
}

/**
 * Saldo del auxiliar CxC de una empresa. La cartera general se compara en una empresa propia de la
 * prueba, nunca contra la empresa principal: allí otras suites insertan facturas directo, sin
 * asiento (fixtures de notify, portal y núcleo), y registran asientos crudos de CxC sin factura
 * (`tests/ledger/`). Japa toma los archivos con `fast-glob` sin ordenar, así que cuáles corrieron
 * antes cambia de una corrida a otra.
 */
async function saldoCxcDeEmpresa(empresaId: number): Promise<string> {
    return netoLibro(['1.1.03'], (q) => q.where('a.empresa_id', empresaId))
}

test.group('billing · reportes', (group) => {
    group.each.setup(tomarDia)
    group.each.teardown(() => soloEmpresaPrincipal())

    test('cartera vencida por antigüedad: tramos, agrupación por zona y router, cuadre con CxC', async ({
        client,
        assert,
    }) => {
        // empresa propia: la cartera de la empresa se compara con su CxC sin datos de otras suites
        const empresaId = await crearEmpresaFila()
        const datos = await servicioCortado({ servicio: { empresa_id: empresaId } })
        const zonaId = await crearZonaFila()
        await db.from('core.clientes').where('id', datos.clienteId).update({ zona_id: zonaId })
        const { token } = await usuarioConRoles(['contabilidad'])

        const respuesta = await estado(
            client
                .get('/api/v1/reportes/cartera-vencida')
                .qs({ cliente_id: datos.clienteId, corte: CORTE })
                .bearerToken(token),
            200,
        )
        const reporte = respuesta.body()
        assert.equal(reporte.reporte, 'cartera-vencida')
        // nulable solo viene (en true) en las columnas que pueden ser null; el OpenAPI lo declara
        const columnas = reporte.columnas as Array<{ clave: string; nulable?: boolean }>
        assert.isTrue(columnas.find((c) => c.clave === 'grupo_id')!.nulable)
        assert.notProperty(
            columnas.find((c) => c.clave === 'total')!,
            'nulable',
        )
        const { construirOpenApi } = await import('#shared/openapi/documento')
        const documento = JSON.parse(await construirOpenApi())
        const esquema = documento.components.schemas.ColumnaReporte
        assert.equal(esquema.properties.nulable.type, 'boolean')
        assert.notInclude(esquema.required, 'nulable')
        assert.lengthOf(reporte.filas, 1)
        const [fila] = reporte.filas
        // septiembre vence el 6/9 (40 días al 16/10) y octubre el 6/10 (10 días)
        assert.include(fila, {
            grupo_id: datos.clienteId,
            facturas: 2,
            por_vencer: '0.00',
            dias_0_30: '150.00',
            dias_31_60: '150.00',
            dias_61_90: '0.00',
            dias_mas_90: '0.00',
            vencido: '300.00',
            total: '300.00',
        })
        assert.equal(fila.total, await saldoTexto(datos.clienteId))

        const porZona = await estado(
            client
                .get('/api/v1/reportes/cartera-vencida')
                .qs({ zona_id: zonaId, agrupar: 'zona', corte: CORTE })
                .bearerToken(token),
            200,
        )
        assert.deepEqual(
            porZona.body().filas.map((f: { grupo_id: number; total: string }) => [f.grupo_id, f.total]),
            [[zonaId, '300.00']],
        )
        const servicio = await db.from('core.servicios').where('id', datos.servicioId).firstOrFail()
        const porRouter = await estado(
            client
                .get('/api/v1/reportes/cartera-vencida')
                .qs({ router_id: servicio.router_id, agrupar: 'router', corte: CORTE })
                .bearerToken(token),
            200,
        )
        assert.equal(porRouter.body().filas[0].dias_31_60, '150.00')

        // el total general de la cartera de la empresa es el saldo de su auxiliar CxC
        const general = await carteraVencida({ corte: CORTE }, undefined, {
            empresas: [empresaId],
            consolidado: false,
        })
        const clientes = (general.filas as Array<{ grupo_id: number }>).map((f) => f.grupo_id)
        assert.deepEqual(clientes, [datos.clienteId])
        assert.equal(general.totales.total, '300.00')
        assert.equal(general.totales.total, await saldoCxcDeEmpresa(empresaId))
        await afirmarLibroCuadrado(assert)
    })

    test('ingresos, cobranza diaria y facturado vs cobrado cuadran con el libro; anulados fuera', async ({
        client,
        assert,
    }) => {
        const datos = await servicioCortado()
        const cuenta = await cuentaBancariaPrueba()
        const { token } = await usuarioConRoles(['contabilidad'])
        const efectivo = await new RegistrarPago().execute(
            { cliente_id: datos.clienteId, metodo: 'caja', monto: '120.00' },
            contextoPrueba(),
        )
        await new RegistrarPago().execute(
            {
                cliente_id: datos.clienteId,
                metodo: 'transferencia',
                monto: '80.00',
                referencia: await unicoBd('t'),
                cuenta_bancaria_id: cuenta.id,
                banco_origen_id: await bancoId(),
            },
            contextoPrueba(),
        )
        const anulado = await new RegistrarPago().execute(
            { cliente_id: datos.clienteId, metodo: 'caja', monto: '10.00' },
            contextoPrueba(),
        )
        await new AnularPago().execute({ pago_id: anulado.id, motivo: 'prueba' }, contextoPrueba())

        const ingresos = await estado(
            client.get('/api/v1/reportes/ingresos').qs({ cliente_id: datos.clienteId }).bearerToken(token),
            200,
        )
        assert.deepEqual(
            ingresos
                .body()
                .filas.map((f: { periodo: string; metodo: string; pagos: number; monto: string }) => [
                    f.periodo,
                    f.metodo,
                    f.pagos,
                    f.monto,
                ]),
            [
                [MES, 'caja', 1, '120.00'],
                [MES, 'transferencia', 1, '80.00'],
            ],
        )
        assert.equal(ingresos.body().totales.monto, '200.00')
        // cuadre: débitos netos a Caja y Bancos de los asientos de pago de este cliente
        const filasPagos = await db.from('billing.pagos').where('cliente_id', datos.clienteId).select('id')
        const pagos = filasPagos.map((p) => p.id as number)
        const libro = await netoLibro(['1.1.01', '1.1.02', '5.1.02'], (q) =>
            q.where('a.origen_tipo', 'pago').whereIn('a.origen_id', pagos),
        )
        assert.equal(ingresos.body().totales.monto, libro)

        const cobranza = await estado(
            client
                .get('/api/v1/reportes/cobranza-diaria')
                .qs({ caja_id: efectivo.caja_id!, desde: hoyGuatemala(), hasta: hoyGuatemala() })
                .bearerToken(token),
            200,
        )
        const filaCaja = cobranza.body().filas.find((f: { metodo: string }) => f.metodo === 'caja')
        assert.isAtLeast(Number(filaCaja.anulados), 1)

        const facturado = await estado(
            client
                .get('/api/v1/reportes/facturado-vs-cobrado')
                .qs({ cliente_id: datos.clienteId, desde: '2026-09-01', hasta: '2026-10-31' })
                .bearerToken(token),
            200,
        )
        assert.deepEqual(
            facturado
                .body()
                .filas.map(
                    (f: { periodo: string; facturado: string; cobrado: string; pendiente: string }) => [
                        f.periodo,
                        f.facturado,
                        f.cobrado,
                        f.pendiente,
                    ],
                ),
            [
                ['2026-09', '150.00', '150.00', '0.00'],
                ['2026-10', '150.00', '50.00', '100.00'],
            ],
        )
        assert.equal(facturado.body().totales.pendiente, await saldoTexto(datos.clienteId))
        assert.equal(facturado.body().totales.cobranza_pct, 66.67)
        const cargos = await netoLibro(['1.1.03'], (q) =>
            q.where('m.cliente_id', datos.clienteId).whereIn('a.origen_tipo', ['factura', 'mora']),
        )
        assert.equal(facturado.body().totales.facturado, cargos)
        await afirmarLibroCuadrado(assert)
    })

    test('cierres de caja, IVA, egresos, promesas y altas/bajas cuadran', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['contabilidad'])

        // cierre con faltante: la diferencia es el asiento cierre_caja
        const cajaId = await nuevaCaja()
        await new AbrirCaja().execute({ caja_id: cajaId, fondo_inicial: '100.00' }, contextoPrueba())
        // la promesa del reporte va con el reloj real (se agrupa por el mes de hoy): sin el tope de la
        // siguiente facturación, que el 30 y 31 rechaza la promesa a dos días (`AHORA_PROMESAS`)
        const datos = await servicioCortado({
            plantilla: { reglas_promesa: reglasPromesaSinTopeFacturacion() },
        })
        await new RegistrarPago().execute(
            { cliente_id: datos.clienteId, metodo: 'caja', monto: '150.00', caja_id: cajaId },
            contextoPrueba(),
        )
        await new RegistrarEgreso().execute(
            { categoria: 'transito', monto: '30.00', metodo: 'caja', caja_id: cajaId },
            contextoPrueba(),
        )
        const turno = await new CerrarCaja().execute(
            { caja_id: cajaId, contado: '215.00', motivo: 'faltan 5' },
            contextoPrueba(),
        )
        const cierres = await estado(
            client.get('/api/v1/reportes/cierres-caja').qs({ caja_id: cajaId }).bearerToken(token),
            200,
        )
        assert.deepEqual(cierres.body().filas[0], {
            ...cierres.body().filas[0],
            turno_id: turno.id,
            fondo_inicial: '100.00',
            cobrado: '150.00',
            egresos: '30.00',
            esperado: '220.00',
            contado: '215.00',
            diferencia: '-5.00',
            motivo: 'faltan 5',
        })
        const sobrante = await netoLibro(['4.1.04'], (q) =>
            q.where('a.origen_tipo', 'cierre_caja').where('a.origen_id', turno.id),
        )
        const faltante = await netoLibro(['5.2.06'], (q) =>
            q.where('a.origen_tipo', 'cierre_caja').where('a.origen_id', turno.id),
        )
        assert.equal(aTexto(dec(sobrante).negated().minus(faltante)), cierres.body().totales.diferencia)

        // IVA: lo facturado y lo anulado en el mes cambian iva_neto igual que la cuenta 2.1.02
        // la ruta muestra la empresa activa (la 1): se compara contra el mismo libro
        const ivaAntes = await ivaDelPeriodo({ desde: `${MES}-01` }, { empresas: [1], consolidado: false })
        const antes = ivaAntes.filas.find((f) => f.periodo === MES)
        const otro = await servicioCortado({ precio: '112.00' })
        const [, octubre] = await facturasDe(otro.servicioId)
        await new AnularFactura().execute({ factura_id: octubre!.id, motivo: 'error' }, contextoPrueba())
        const iva = await estado(
            client
                .get('/api/v1/reportes/iva')
                .qs({ desde: `${MES}-01` })
                .bearerToken(token),
            200,
        )
        const despues = iva.body().filas.find((f: { periodo: string }) => f.periodo === MES)
        for (const fila of iva.body().filas) {
            assert.equal(fila.iva_neto, fila.iva_libro, `IVA de ${fila.periodo}`)
        }
        const delta = (clave: string) =>
            aTexto(dec(despues[clave]).minus(dec((antes?.[clave] as string) ?? '0')))
        assert.equal(delta('iva_facturado'), '24.00')
        assert.equal(delta('iva_anulado'), '12.00')
        assert.equal(delta('base'), '200.00')
        assert.equal(delta('iva_libro'), '12.00')

        // egresos por categoría = cuentas de gasto de los asientos de egreso
        const egresos = await estado(
            client
                .get('/api/v1/reportes/egresos')
                .qs({ categoria: 'transito', desde: `${MES}-01` })
                .bearerToken(token),
            200,
        )
        const vigentes = await db
            .from('ledger.egresos as e')
            .join('ledger.egresos_categorias as ec', 'ec.id', 'e.categoria_id')
            .where('ec.clave', 'transito')
            .whereNotExists((q) => q.from('ledger.egresos_anulaciones as an').whereRaw('an.egreso_id = e.id'))
            .select('e.id')
        const ids = vigentes.map((e) => e.id as number)
        const gasto = await netoLibro(['5.2.02'], (q) =>
            q
                .where('a.origen_tipo', 'egreso')
                .whereIn('a.origen_id', ids)
                .whereRaw(`to_char(a.fecha, 'YYYY-MM') >= ?`, [MES]),
        )
        assert.equal(egresos.body().totales.monto, gasto)

        // promesas del cliente: una activa
        await new CrearPromesaPago().execute(
            {
                servicio_id: datos.servicioId,
                vence_en: new Date(Date.now() + 2 * 86_400_000),
                monto: '150.00',
                canal: 'operador',
            },
            contextoPrueba(),
        )
        const reportePromesas = await estado(
            client.get('/api/v1/reportes/promesas').qs({ cliente_id: datos.clienteId }).bearerToken(token),
            200,
        )
        assert.include(reportePromesas.body().filas[0], {
            periodo: MES,
            canal: 'operador',
            creadas: 1,
            activas: 1,
        })
        assert.equal(reportePromesas.body().filas[0].monto_prometido, '150.00')

        // altas por instalación (septiembre) y la suspensión del corte (este mes), por router
        const servicio = await db.from('core.servicios').where('id', datos.servicioId).firstOrFail()
        const altas = await estado(
            client
                .get('/api/v1/reportes/altas-bajas')
                .qs({ router_id: servicio.router_id, desde: '2026-09-01' })
                .bearerToken(token),
            200,
        )
        const septiembre = altas.body().filas.find((f: { periodo: string }) => f.periodo === '2026-09')
        assert.equal(septiembre.altas, 1)
        assert.isAtLeast(altas.body().totales.suspensiones, 1)
        await afirmarLibroCuadrado(assert)
    })

    test('exportación CSV y XLSX; permiso reportes.ver', async ({ client, assert }) => {
        const datos = await servicioCortado()
        const { token } = await usuarioConRoles(['contabilidad'])
        const csv = await estado(
            client
                .get('/api/v1/reportes/cartera-vencida')
                .qs({ cliente_id: datos.clienteId, corte: CORTE, formato: 'csv' })
                .bearerToken(token),
            200,
        )
        assert.match(csv.header('content-type') ?? '', /^text\/csv/)
        assert.match(
            csv.header('content-disposition') ?? '',
            /attachment; filename="cartera-vencida-.*\.csv"/,
        )
        assert.isTrue(csv.text().startsWith(String.fromCharCode(0xfeff)), 'CSV con BOM')
        const lineas = csv.text().slice(1).trim().split('\r\n')
        assert.equal(
            lineas[0],
            'Id,Grupo,Facturas,Por vencer,0-30 días,31-60 días,61-90 días,Más de 90 días,Total vencido,Total pendiente',
        )
        assert.match(
            lineas[1]!,
            new RegExp(`^${datos.clienteId},.*,2,0.00,150.00,150.00,0.00,0.00,300.00,300.00$`),
        )
        assert.equal(lineas[2], 'Total,,2,0.00,150.00,150.00,0.00,0.00,300.00,300.00')

        const xlsx = await client
            .get('/api/v1/reportes/cartera-vencida')
            .qs({ cliente_id: datos.clienteId, corte: CORTE, formato: 'xlsx' })
            .bearerToken(token)
        xlsx.assertStatus(200)
        assert.match(xlsx.header('content-type') ?? '', /spreadsheetml\.sheet/)
        const contenido = Buffer.from(xlsx.text(), 'binary')
        assert.equal(contenido.subarray(0, 2).toString(), 'PK')
        assert.include(xlsx.text(), 'xl/worksheets/sheet1.xml')
        assert.include(xlsx.text(), '<v>300.00</v>')

        // CSV: comillas, comas y fórmulas neutralizadas
        const texto = aCsv({
            reporte: 'x',
            titulo: 'x',
            filtros: {},
            columnas: [{ clave: 'a', titulo: 'A', tipo: 'texto' }],
            filas: [{ a: 'Pérez, "Juan"' }, { a: '=HYPERLINK("x")' }],
            totales: { a: null },
            generado_en: '',
        }).toString('utf8')
        assert.include(texto, '"Pérez, ""Juan"""')
        assert.include(texto, `"'=HYPERLINK(""x"")"`)

        const { token: cajero } = await usuarioConRoles(['cajero'])
        await estado(client.get('/api/v1/reportes/ingresos').bearerToken(cajero), 403)
        await estado(client.get('/api/v1/dashboard/resumen').bearerToken(cajero), 403)
    })

    test('dashboard: vistas refrescadas por evento, no en vivo; repetir el evento es idempotente', async ({
        client,
        assert,
    }) => {
        await refrescarResumenes()
        const { token } = await usuarioConRoles(['contabilidad'])
        const leer = async () => {
            const respuesta = await estado(client.get('/api/v1/dashboard/resumen').bearerToken(token), 200)
            return respuesta.body()
        }
        const inicial = await leer()
        assert.lengthOf(inicial.series, 12)
        assert.equal(inicial.series.at(-1).periodo, MES)

        const datos = await servicioCortado()
        const pago = await new RegistrarPago().execute(
            { cliente_id: datos.clienteId, metodo: 'caja', monto: '150.00' },
            contextoPrueba(),
        )
        // sin procesar eventos el dashboard no cambia (no lee en vivo)
        const sinEvento = await leer()
        assert.equal(sinEvento.hoy.cobrado, inicial.hoy.cobrado)
        assert.equal(sinEvento.cartera_vencida.monto, inicial.cartera_vencida.monto)

        const consumidor = new ConsumidorResumenes()
        const procesar = async (evento: string, clave: string, valor: number) => {
            for (const fila of await eventosDe(evento, clave, valor)) {
                assert.isTrue(consumidor.acepta(fila.evento))
                await consumidor.procesar({ id: fila.id, evento: fila.evento, payload: fila.payload })
            }
        }
        // las facturas y el corte del escenario, y luego el pago
        const facturas = await facturasDe(datos.servicioId)
        for (const f of facturas) await procesar('factura.emitida', 'factura_id', f.id)
        await procesar('servicio.estado_cambiado', 'servicio_id', datos.servicioId)
        await procesar('pago.registrado', 'pago_id', pago.id)
        const conEvento = await leer()
        assert.equal(conEvento.hoy.cobrado, aTexto(dec(inicial.hoy.cobrado).plus('150.00')))
        assert.equal(conEvento.hoy.pagos, inicial.hoy.pagos + 1)
        assert.equal(conEvento.mes.cobrado, aTexto(dec(inicial.mes.cobrado).plus('150.00')))
        // el escenario dejó 300 vencidos y el pago cubrió 150
        assert.equal(
            conEvento.cartera_vencida.monto,
            aTexto(dec(inicial.cartera_vencida.monto).plus('150.00')),
        )
        assert.isAbove(
            Date.parse(conEvento.actualizado_en.resumen_cobros_diarios),
            Date.parse(inicial.actualizado_en.resumen_cobros_diarios),
        )

        // el mismo evento otra vez: mismo resultado
        await procesar('pago.registrado', 'pago_id', pago.id)
        const repetido = await leer()
        assert.equal(repetido.hoy.cobrado, conEvento.hoy.cobrado)
        assert.equal(repetido.mes.cobrado, conEvento.mes.cobrado)
        assert.deepEqual(repetido.series, conEvento.series)
        assert.deepEqual(repetido.servicios, conEvento.servicios)
        const refresco = await db
            .from('billing.resumenes_refrescos')
            .where('vista', 'resumen_cobros_diarios')
            .firstOrFail()
        const [evento] = await eventosDe('pago.registrado', 'pago_id', pago.id)
        assert.equal(Number(refresco.ultimo_evento_id), Number(evento.id))

        // un evento ajeno no se acepta
        assert.isFalse(consumidor.acepta('notificacion.enviada'))
    })
})
