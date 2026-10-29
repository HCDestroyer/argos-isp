import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import { estado, soloEmpresaPrincipal, usuarioConRoles } from '#tests/ayudas'
import { unicoBd } from '#tests/billing/ayudas_billing'
import { crearEmpresaFila } from '#tests/core/fabricas'
import { saldoCuenta, servicioFacturado } from '#tests/contabilidad/ayudas_contabilidad'
import { afirmarLibro, huellaTablas } from '#tests/contabilidad/verificar_libro'
import { llevarFacturasA } from '#tests/contabilidad/ayudas_libros'
import { prepararEmpresasGt, type EmpresasGt } from '#tests/ledger/ayudas_bancos'
import { proveedorEn } from '#tests/ledger/ayudas_compras'
import { eventos } from '#tests/fiscal/ayudas_fiscal'
import { relojFiscal } from '#fiscal/comun'
import { libroVentasLegal } from '#fiscal/libros_legales'
import { calcularDatos } from '#fiscal/declaraciones'
import { tableroFiscal, BLOQUES_TABLERO, type TableroEmpresa } from '#fiscal/tablero'
import type { Bloque } from '#fiscal/bloques'
import CambiarRegimen from '#fiscal/actions/cambiar_regimen'
import EditarParametro from '#fiscal/actions/editar_parametro'
import CalcularDeclaracion from '#fiscal/actions/calcular_declaracion'
import RevisarDeclaracion from '#fiscal/actions/revisar_declaracion'
import RegistrarPagoDeclaracion from '#fiscal/actions/registrar_pago_declaracion'
import MarcarDeclaracionPresentada from '#fiscal/actions/marcar_declaracion_presentada'
import AnularPagoDeclaracion from '#fiscal/actions/anular_pago_declaracion'
import RegistrarCompra from '#ledger/actions/registrar_compra'
import EmitirNotaCredito from '#billing/actions/emitir_nota_credito'

/**
 * Auditor contable · tablero fiscal (fase 8 PR A; contrato de localización fiscal §9.4 y §22,
 * desvíos (a)–(d), §15 #84–#85). El tablero solo lee: cada cifra se compara contra el libro de
 * ventas legal, el borrador (`calcularDatos`) y el mayor; un bloque en error nunca trae cifras ni
 * tumba los demás; una empresa no ve las cifras de otra; y nada se escribe (huella de cada tabla de
 * `ledger`, `fiscal` y `audit` antes y después).
 */

const HOY = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Guatemala' })
const MES = HOY.slice(0, 7)
const ANTERIOR = DateTime.fromISO(`${MES}-01`).minus({ months: 1 }).toFormat('yyyy-MM')
const SIGUIENTE = DateTime.fromISO(`${MES}-01`).plus({ months: 1 }).toFormat('yyyy-MM')

async function parametro(e: EmpresasGt, empresaId: number, clave: string, valor: unknown) {
    await new EditarParametro().execute(
        {
            empresa_id: empresaId,
            clave,
            valor,
            vigente_desde: '2014-01-01',
            motivo: `Auditor: tablero (${clave})`,
        },
        e.ctx,
    )
}

const venta = (empresaId: number, precio: string) =>
    servicioFacturado(empresaId, `${MES}-01`, { precio, instalacion: `${MES}-01` })

async function compra(e: EmpresasGt, empresaId: number, total: string) {
    const proveedor = await proveedorEn(empresaId, e.ctx)
    return new RegistrarCompra().execute(
        {
            proveedor_id: proveedor.id,
            tipo_documento: 'FACT',
            numero: await unicoBd('D'),
            fecha_documento: HOY,
            periodo_iva: `${MES}-01`,
            condicion: 'credito',
            lineas: [{ descripcion: 'Enlace de tránsito', total }],
        },
        e.ctx,
    )
}

const datos = (b: Bloque) => b.datos as Record<string, any>
async function deEmpresa(empresaId: number) {
    const tablero = await tableroFiscal([empresaId])
    return tablero.empresas[0]!
}

/** Suma independiente del libro de ventas legal (filas, no sus totales). */
async function sumaLibro(empresaId: number, desde: string) {
    const libro = await libroVentasLegal(empresaId, { desde, hasta: HOY })
    let base = 0
    let iva = 0
    let total = 0
    for (const f of libro.reporte.filas as Array<Record<string, any>>) {
        for (const c of ['bienes', 'servicios', 'exportacion', 'exento']) {
            base += Math.round(Number(f[c] ?? 0) * 100)
        }
        iva += Math.round(Number(f.iva ?? 0) * 100)
        total += Math.round(Number(f.total ?? 0) * 100)
    }
    const texto = (n: number) => (n / 100).toFixed(2)
    return {
        documentos: libro.reporte.filas.length,
        base: texto(base),
        iva: texto(iva),
        total: texto(total),
        totalLibro: String(libro.reporte.totales.total),
    }
}

/** IVA débito del mes en el mayor (2.1.02 sin la liquidación) hasta hoy. */
async function debitoDelMayor(empresaId: number) {
    const { rows } = (await db.rawQuery(
        `SELECT coalesce(sum(m.haber - m.debe), 0)::numeric(14,2)::text AS n
           FROM ledger.movimientos m JOIN ledger.asientos a ON a.id = m.asiento_id
           JOIN ledger.cuentas c ON c.id = m.cuenta_id
          WHERE a.empresa_id = ? AND c.codigo = '2.1.02' AND a.fecha BETWEEN ? AND ?
            AND a.origen_tipo IS DISTINCT FROM 'liquidacion_impuesto'`,
        [empresaId, `${MES}-01`, HOY],
    )) as { rows: Array<{ n: string }> }
    return rows[0]!.n
}

/** Un bloque en error o que no aplica nunca trae cifras; uno ok nunca trae error. */
function bloquesCoherentes(assert: any, t: TableroEmpresa) {
    assert.sameMembers(Object.keys(t.bloques), [...BLOQUES_TABLERO], `empresa ${t.empresa_id}`)
    for (const [nombre, b] of Object.entries(t.bloques)) {
        const donde = `empresa ${t.empresa_id} · ${nombre}`
        if (b.estado === 'ok') {
            assert.isNotNull(b.datos, donde)
            assert.isNull(b.error, donde)
        } else if (b.estado === 'error') {
            assert.isNull(b.datos, donde)
            assert.isNotNull(b.error, donde)
            assert.isAtLeast(b.error!.status, 400, donde)
            assert.isString(b.error!.type, donde)
        } else {
            assert.equal(b.estado, 'no_aplica', donde)
            assert.isNull(b.datos, donde)
            assert.isNull(b.error, donde)
            assert.match(String(b.motivo), /^regimen_/, donde)
        }
    }
}

test.group('Auditor contable · tablero fiscal', (group) => {
    const original = relojFiscal.ahora
    group.each.teardown(async () => {
        relojFiscal.ahora = original
        await soloEmpresaPrincipal()
    })

    test('cifras = libro de ventas, borrador y mayor (B general con NCRE, C pequeño contribuyente); ISO sin iso_base_periodo en error sin cifras; una empresa no ve las de otra; nada se escribe', async ({
        assert,
        client,
    }) => {
        const e = await prepararEmpresasGt()
        await new CambiarRegimen().execute(
            {
                empresa_id: e.C,
                regimen: 'pequeno_contribuyente',
                vigente_desde: '2014-01-01',
                motivo: 'Inscripción',
            },
            e.ctx,
        )
        for (const empresa of [e.B, e.C]) await parametro(e, empresa, 'inicio_libros', '2026-01-01')
        await venta(e.B, '224.00') // IVA 24
        const conNota = await venta(e.B, '112.00') // IVA 12
        await new EmitirNotaCredito().execute(
            { factura_id: conNota.facturas[0]!.id, monto: '56.00', motivo: 'auditoría: descuento' },
            e.ctx,
        )
        await compra(e, e.B, '112.00') // crédito 12
        await venta(e.C, '336.00')
        // una venta de cada una en el mes anterior: el año no es el mes
        for (const [empresa, precio] of [
            [e.B, '448.00'],
            [e.C, '560.00'],
        ] as const) {
            const previa = await venta(empresa, precio)
            await llevarFacturasA([previa.facturas[0]!.id], `${ANTERIOR}-15`)
        }
        const sinLocalizacion = await crearEmpresaFila()

        const huella = await huellaTablas()
        const t = await tableroFiscal([e.B, e.C, sinLocalizacion])
        assert.deepEqual(await huellaTablas(), huella, 'el tablero no escribe nada')
        assert.deepEqual(
            t.empresas.map((x) => x.empresa_id),
            [e.B, e.C, sinLocalizacion].sort((a, b) => a - b),
        )
        const [tB, tC, tS] = [e.B, e.C, sinLocalizacion].map((id) =>
            t.empresas.find((x) => x.empresa_id === id)!,
        )
        for (const x of t.empresas) bloquesCoherentes(assert, x)

        // facturado (mes y año) = suma de las filas del libro de ventas legal, y su IVA = débito del mayor
        for (const [x, empresa] of [
            [tB, e.B],
            [tC, e.C],
        ] as const) {
            assert.equal(x!.bloques.facturado.estado, 'ok')
            for (const [clave, desde] of [
                ['mes', `${MES}-01`],
                ['anio', `${HOY.slice(0, 4)}-01-01`],
            ] as const) {
                const libro = await sumaLibro(empresa, desde)
                const bloque = datos(x!.bloques.facturado)[clave]
                assert.deepEqual(
                    [bloque.documentos, bloque.base, bloque.iva, bloque.total],
                    [libro.documentos, libro.base, libro.iva, libro.total],
                    `${empresa} ${clave}`,
                )
                assert.equal(Number(bloque.total), Number(libro.totalLibro))
                const porTipo = (bloque.por_tipo as Array<Record<string, any>>).reduce(
                    (s, p) => s + Math.round(Number(p.total) * 100),
                    0,
                )
                assert.equal((porTipo / 100).toFixed(2), bloque.total, 'por tipo suma el total')
            }
            assert.equal(datos(x!.bloques.facturado).mes.iva, await debitoDelMayor(empresa))
        }
        assert.equal(datos(tB!.bloques.facturado).mes.iva, '30.00', '24 + 12 − 6 de la nota')
        assert.equal(datos(tC!.bloques.facturado).mes.iva, '0.00')
        assert.equal(datos(tB!.bloques.facturado).anio.iva, '78.00', 'con los 48 del mes anterior')
        assert.equal(datos(tC!.bloques.facturado).mes.total, '336.00')

        // iva = el borrador del mes (calcularDatos) de cada régimen
        for (const [x, empresa, impuesto] of [
            [tB, e.B, 'iva_mensual'],
            [tC, e.C, 'pc_mensual'],
        ] as const) {
            const borrador = await calcularDatos(db.connection(), empresa, impuesto, `${MES}-01`)
            assert.equal(x!.bloques.iva.estado, 'ok')
            assert.equal(datos(x!.bloques.iva).impuesto, impuesto)
            assert.deepEqual(datos(x!.bloques.iva).totales, borrador.totales, impuesto)
        }
        assert.include(datos(tB!.bloques.iva).totales, {
            debito: '30.00',
            credito: '12.00',
            a_pagar: '18.00',
        })

        // pequeño contribuyente: acumulado del año = total del libro de ventas legal del año
        const anioC = await sumaLibro(e.C, `${HOY.slice(0, 4)}-01-01`)
        assert.equal(datos(tC!.bloques.pequeno_contribuyente).acumulado, anioC.total)
        assert.isAtLeast(Number(anioC.total), 896, 'el año incluye el mes anterior')
        assert.deepEqual(
            [tC!.bloques.isr.estado, tC!.bloques.iso.estado, tB!.bloques.pequeno_contribuyente.estado],
            ['no_aplica', 'no_aplica', 'no_aplica'],
        )

        // ISO de B sin iso_base_periodo: error sin cifras; ISR, IVA y los demás siguen
        assert.equal(tB!.bloques.iso.estado, 'error')
        assert.isNull(tB!.bloques.iso.datos)
        assert.match(tB!.bloques.iso.error!.type, /parametro_sin_confirmar$/)
        const otros = BLOQUES_TABLERO.filter((b) => b !== 'iso' && b !== 'pequeno_contribuyente')
        assert.isAtLeast(otros.length, 6)
        assert.deepEqual(
            otros.map((b) => [b, tB!.bloques[b].estado]),
            otros.map((b) => [b, 'ok']),
        )
        // sin localización: todos los bloques en error, ninguno con cifras
        assert.isTrue(
            BLOQUES_TABLERO.every((b) => tS!.bloques[b].estado === 'error' && tS!.bloques[b].datos === null),
        )
        assert.isNull(tS!.regimen)

        // multiempresa: B sola = B dentro de [B, C]; lo que pasa en C no mueve una cifra de B
        assert.deepEqual(await deEmpresa(e.B), tB)
        await venta(e.C, '112.00')
        await compra(e, e.C, '56.00')
        const huellaTrasC = await huellaTablas()
        const tB2 = await deEmpresa(e.B)
        assert.deepEqual(tB2, tB, 'la venta y la compra de C no tocan el tablero de B')
        const tC2 = await deEmpresa(e.C)
        assert.notDeepEqual(tC2.bloques.facturado, tC!.bloques.facturado)

        // API: un usuario de contabilidad con alcance solo en B ve solo B; todas y C → 403
        const restringido = await usuarioConRoles(['contabilidad'])
        await db.from('core.usuarios').where('id', restringido.usuario.id).update({ alcance_global: false })
        await db
            .table('core.usuarios_empresas')
            .insert({ usuario_id: restringido.usuario.id, empresa_id: e.B })
        const huellaAntesApi = await huellaTablas()
        const propia = await estado(client.get('/api/v1/fiscal/tablero').bearerToken(restringido.token), 200)
        assert.deepEqual(
            propia.body().empresas.map((x: any) => x.empresa_id),
            [e.B],
        )
        assert.deepEqual(propia.body().empresas[0], JSON.parse(JSON.stringify(tB2)))
        const conCabecera = await estado(
            client
                .get('/api/v1/fiscal/tablero')
                .bearerToken(restringido.token)
                .headers({ 'X-Empresa-Id': String(e.B) }),
            200,
        )
        assert.deepEqual(conCabecera.body().empresas, propia.body().empresas)
        const ajena = await client
            .get('/api/v1/fiscal/tablero')
            .bearerToken(restringido.token)
            .headers({ 'X-Empresa-Id': String(e.C) })
        assert.equal(ajena.status(), 403, 'la empresa de otro')
        const todas = await client
            .get('/api/v1/fiscal/tablero')
            .bearerToken(restringido.token)
            .qs({ empresas: 'todas' })
        assert.equal(todas.status(), 403, 'el consolidado solo con alcance global')
        // con alcance global: todas las activas, cada una con sus propias cifras
        const global = await estado(
            client.get('/api/v1/fiscal/tablero').bearerToken(e.token).qs({ empresas: 'todas' }),
            200,
        )
        const deB = global.body().empresas.find((x: any) => x.empresa_id === e.B)
        assert.deepEqual(deB, JSON.parse(JSON.stringify(tB2)))
        for (const x of global.body().empresas) bloquesCoherentes(assert, x)

        // nada se escribió: ni el tablero ni la API (las únicas diferencias son la venta y la compra de C)
        assert.deepEqual(await huellaTablas(), huellaTrasC, 'el tablero de B no escribe')
        assert.deepEqual(
            huellaAntesApi,
            huellaTrasC,
            'cambiar el alcance del usuario no toca ledger/fiscal/audit',
        )
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('vencimientos: a_pagar = saldo de la declaración en su cuenta por pagar; mora = a_pagar × mora_tributaria × días; pago_id del evento = la fila del pago', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        await parametro(e, e.B, 'inicio_libros', '2026-01-01')
        await venta(e.B, '224.00')
        await compra(e, e.B, '112.00')
        relojFiscal.ahora = () => new Date(`${SIGUIENTE}-05T18:00:00Z`)
        const d = await new CalcularDeclaracion().execute(
            { empresa_id: e.B, impuesto: 'iva_mensual', periodo: MES },
            e.ctx,
        )
        // calculada sin revisar: está en el tablero con el a_pagar del borrador y sin asiento
        const calculada = await deEmpresa(e.B)
        const antesDeRevisar = datos(calculada.bloques.vencimientos).obligaciones.find(
            (o: any) => o.declaracion_id === d.id,
        )
        assert.include(antesDeRevisar, { a_pagar: d.totales.a_pagar, vencida: false, mora_estimada: null })
        await new RevisarDeclaracion().execute({ declaracion_id: d.id }, e.ctx)
        assert.equal(await saldoCuenta(e.B, '2.1.06'), '-12.00')

        const vence = DateTime.fromISO(d.vence_en, { zone: 'utc' })
        relojFiscal.ahora = () => new Date(`${vence.plus({ days: 7 }).toISODate()}T18:00:00Z`)
        const huella = await huellaTablas()
        const t = await deEmpresa(e.B)
        assert.deepEqual(await huellaTablas(), huella, 'el tablero no escribe')
        const v = datos(t.bloques.vencimientos)
        const fila = v.obligaciones.find((o: any) => o.declaracion_id === d.id)
        assert.include(fila, { vencida: true, dias_restantes: -7, a_pagar: '12.00' })
        // 12.00 × 0.05 % × 7 = 0.042 → 0.04
        assert.equal(fila.mora_estimada, '0.04')
        assert.equal(v.vencidas, v.obligaciones.filter((o: any) => o.vencida).length)
        // todas las obligaciones del bloque son de B, abiertas y dentro de 30 días
        const deB = await db
            .from('fiscal.obligaciones')
            .where('empresa_id', e.B)
            .whereIn('estado', ['pendiente', 'borrador'])
            .where('vence_en', '<=', v.hasta)
            .select('id')
        assert.sameMembers(
            v.obligaciones.map((o: any) => o.obligacion_id),
            deB.map((o) => Number(o.id)),
        )

        const pagada = await new RegistrarPagoDeclaracion().execute(
            {
                declaracion_id: d.id,
                metodo: 'cuenta_bancaria',
                cuenta_bancaria_id: e.cuentas.get(e.B)!,
                fecha: HOY,
            },
            e.ctx,
        )
        const filaPago = await db
            .from('fiscal.declaraciones_pagos')
            .where('declaracion_id', d.id)
            .firstOrFail()
        const evento = await eventos('declaracion.pagada', 'declaracion_id', d.id)
        assert.lengthOf(evento, 1)
        assert.equal(evento[0]!.pago_id, Number(filaPago.id))
        assert.equal(evento[0]!.pago_id, pagada.pago!.id)
        assert.equal(evento[0]!.monto, filaPago.total)

        // presentada: sale de los vencimientos
        await new MarcarDeclaracionPresentada().execute(
            { declaracion_id: d.id, numero_formulario: '2237-9', fecha_presentacion: `${SIGUIENTE}-05` },
            e.ctx,
        )
        const presentada = await deEmpresa(e.B)
        assert.notInclude(
            datos(presentada.bloques.vencimientos).obligaciones.map((o: any) => o.declaracion_id),
            d.id,
        )
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('H36 (arreglado en 2034f27): vencimientos resta el pago: una declaración pagada a tiempo queda con 0.00 pendiente y sin mora', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        await venta(e.B, '224.00')
        await compra(e, e.B, '112.00')
        relojFiscal.ahora = () => new Date(`${SIGUIENTE}-05T18:00:00Z`)
        const d = await new CalcularDeclaracion().execute(
            { empresa_id: e.B, impuesto: 'iva_mensual', periodo: MES },
            e.ctx,
        )
        await new RevisarDeclaracion().execute({ declaracion_id: d.id }, e.ctx)
        // pagada el día 5, antes del vencimiento: nada queda por pagar ni corre mora
        await new RegistrarPagoDeclaracion().execute(
            {
                declaracion_id: d.id,
                metodo: 'cuenta_bancaria',
                cuenta_bancaria_id: e.cuentas.get(e.B)!,
                fecha: HOY,
            },
            e.ctx,
        )
        assert.equal(await saldoCuenta(e.B, '2.1.06'), '0.00')
        const vence = DateTime.fromISO(d.vence_en, { zone: 'utc' })
        relojFiscal.ahora = () => new Date(`${vence.plus({ days: 10 }).toISODate()}T18:00:00Z`)
        const tras = await deEmpresa(e.B)
        const fila = datos(tras.bloques.vencimientos).obligaciones.find((o: any) => o.declaracion_id === d.id)
        // o no aparece, o aparece con 0.00 por pagar, lo pagado y sin mora
        assert.isTrue(
            !fila || (fila.a_pagar === '0.00' && [null, '0.00'].includes(fila.mora_estimada)),
            JSON.stringify(fila),
        )
        if (fila) assert.equal(fila.pagado, '12.00')
        const deVencimientos = async () => {
            const t = await deEmpresa(e.B)
            return datos(t.bloques.vencimientos).obligaciones.find((o: any) => o.declaracion_id === d.id)
        }
        /** pendiente independiente: a_pagar de la última versión − Σ impuesto de los pagos sin anular */
        const pendienteDelLibro = async () => {
            const { rows } = (await db.rawQuery(
                `SELECT (SELECT (totales ->> 'a_pagar')::numeric FROM fiscal.declaraciones
                          WHERE empresa_id = ? AND impuesto = 'iva_mensual' AND periodo_desde = ?
                          ORDER BY version DESC LIMIT 1)
                      - coalesce((SELECT sum(p.impuesto) FROM fiscal.declaraciones_pagos p
                                   JOIN fiscal.declaraciones x ON x.id = p.declaracion_id
                                  WHERE x.empresa_id = ? AND x.impuesto = 'iva_mensual' AND x.periodo_desde = ?
                                    AND NOT EXISTS (SELECT 1 FROM fiscal.declaraciones_pagos_anulaciones n WHERE n.pago_id = p.id)), 0)
                        AS pendiente`,
                [e.B, `${MES}-01`, e.B, `${MES}-01`],
            )) as { rows: Array<{ pendiente: string }> }
            return Number(rows[0]!.pendiente).toFixed(2)
        }

        // el pago se anula: vuelve el pendiente y su mora (12.00 × 0.05 % × 10 = 0.06)
        await new AnularPagoDeclaracion().execute({ declaracion_id: d.id, motivo: 'Boleta rechazada' }, e.ctx)
        const anulado = await deVencimientos()
        assert.include(anulado, { a_pagar: await pendienteDelLibro(), pagado: '0.00', mora_estimada: '0.06' })
        assert.equal(anulado.a_pagar, '12.00')
        // presentada sin pagar: sigue en vencimientos (corre mora), con su estado
        await new MarcarDeclaracionPresentada().execute(
            { declaracion_id: d.id, numero_formulario: '2237-8', fecha_presentacion: `${SIGUIENTE}-05` },
            e.ctx,
        )
        assert.include(await deVencimientos(), {
            estado: 'presentada',
            a_pagar: '12.00',
            mora_estimada: '0.06',
        })
        // presentada y pagada: sale
        await new RegistrarPagoDeclaracion().execute(
            {
                declaracion_id: d.id,
                metodo: 'cuenta_bancaria',
                cuenta_bancaria_id: e.cuentas.get(e.B)!,
                fecha: HOY,
            },
            e.ctx,
        )
        assert.equal(await pendienteDelLibro(), '0.00')
        assert.isUndefined(await deVencimientos())
        await afirmarLibro(assert, [e.B, e.C])
    })
})
