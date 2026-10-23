import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import { estado, soloEmpresaPrincipal, usuarioConRoles } from '#tests/ayudas'
import { servicioFacturado } from '#tests/contabilidad/ayudas_contabilidad'
import { llevarFacturasA } from '#tests/contabilidad/ayudas_libros'
import { afirmarLibro, huellaTablas } from '#tests/contabilidad/verificar_libro'
import { prepararEmpresasGt, type EmpresasGt } from '#tests/ledger/ayudas_bancos'
import { crearEmpresaFila } from '#tests/core/fabricas'
import { relojFiscal } from '#fiscal/comun'
import { libroVentasLegal } from '#fiscal/libros_legales'
import { compararRegimenes, BLOQUES_COMPARADOR, type ComparadorEmpresa } from '#fiscal/comparador'
import type { Bloque } from '#fiscal/bloques'
import EditarParametro from '#fiscal/actions/editar_parametro'
import RegistrarAsiento from '#ledger/actions/registrar_asiento'
import CerrarPeriodo from '#ledger/actions/cerrar_periodo'
import CerrarEjercicio from '#ledger/actions/cerrar_ejercicio'

/**
 * Auditor contable · comparador de regímenes (fase 8 PR B; contrato de localización fiscal §9.4 y
 * §22 PR B, inv. E.1, §15 #86–#88). Simulación: cada cifra se recalcula aquí con fórmulas propias
 * desde el libro (R mes a mes con el libro de ventas legal de cada mes; ingresos y gastos del mayor
 * sin el cierre anual; activo al cierre del último mes) y los parámetros vigentes (escala del art. 44,
 * 7 % del art. 46, 25 %, ISO 1 %). Una empresa no ve las cifras de otra y nada se escribe.
 */

const HOY = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Guatemala' })
const MES = HOY.slice(0, 7)
const ULTIMO = DateTime.fromISO(`${MES}-01`).minus({ days: 1 })
const MES_1 = ULTIMO.toFormat('yyyy-MM') // último mes terminado
const MES_2 = ULTIMO.minus({ months: 1 }).toFormat('yyyy-MM')
const ANIO = Number(HOY.slice(0, 4))

async function parametro(e: EmpresasGt, empresaId: number, clave: string, valor: unknown) {
    await new EditarParametro().execute(
        {
            empresa_id: empresaId,
            clave,
            valor,
            vigente_desde: '2014-01-01',
            motivo: `Auditor: comparador (${clave})`,
        },
        e.ctx,
    )
}

/** Factura de un servicio llevada (con su asiento) a `fecha`. */
async function ventaEn(empresaId: number, precio: string, fecha: string | null) {
    const v = await servicioFacturado(empresaId, `${MES}-01`, { precio, instalacion: `${MES}-01` })
    if (fecha) await llevarFacturasA([v.facturas[0]!.id], fecha)
    return v
}

function asiento(
    e: EmpresasGt,
    empresaId: number,
    fecha: string,
    debe: string,
    haber: string,
    monto: string,
) {
    return new RegistrarAsiento().execute(
        {
            empresa_id: empresaId,
            fecha,
            descripcion: 'Movimiento del auditor (comparador)',
            origen_tipo: 'ajuste',
            movimientos: [
                { cuenta: debe, debe: monto },
                { cuenta: haber, haber: monto },
            ],
        },
        e.ctx,
    )
}

const datos = (b: Bloque) => b.datos as Record<string, any>
const q = (n: number) => (Math.round(n * 100 + Number.EPSILON) / 100).toFixed(2)

/** Escala del art. 44 sobre la base de un mes (independiente de `escalaOpcional`). */
const escala = (base: number) => (base <= 0 ? 0 : base <= 30000 ? base * 0.05 : 1500 + (base - 30000) * 0.07)

/** R de cada mes del rango con el libro de ventas legal de ese mes. */
async function rPorMes(empresaId: number, desde: string, hasta: string) {
    const salida: Array<{ mes: string; ventas: string }> = []
    for (let m = DateTime.fromISO(desde); m <= DateTime.fromISO(hasta); m = m.plus({ months: 1 })) {
        const libro = await libroVentasLegal(empresaId, {
            desde: m.toISODate()!,
            hasta: m.endOf('month').toISODate()!,
        })
        let base = 0
        for (const f of libro.reporte.filas as Array<Record<string, any>>) {
            for (const c of ['bienes', 'servicios', 'exportacion', 'exento']) base += Number(f[c] ?? 0)
        }
        salida.push({ mes: m.toFormat('yyyy-MM'), ventas: q(base) })
    }
    return salida
}

/** Ingresos, gastos y no deducibles del mayor en el rango, con y sin el cierre anual. */
async function resultadosDelMayor(empresaId: number, desde: string, hasta: string, conCierre = false) {
    const { rows } = (await db.rawQuery(
        `SELECT coalesce(sum(m.haber - m.debe) FILTER (WHERE c.tipo = 'ingreso'), 0)::numeric(14,2)::text AS ingresos,
                coalesce(sum(m.debe - m.haber) FILTER (WHERE c.tipo = 'gasto'), 0)::numeric(14,2)::text AS gastos,
                coalesce(sum(m.debe - m.haber) FILTER (WHERE c.tipo = 'gasto' AND c.categoria_fiscal = 'no_deducible'), 0)::numeric(14,2)::text AS nd
           FROM ledger.movimientos m JOIN ledger.asientos a ON a.id = m.asiento_id
           JOIN ledger.cuentas c ON c.id = m.cuenta_id
          WHERE a.empresa_id = ? AND a.fecha BETWEEN ? AND ? AND (? OR a.origen_tipo IS DISTINCT FROM 'cierre_anual')`,
        [empresaId, desde, hasta, conCierre],
    )) as { rows: Array<{ ingresos: string; gastos: string; nd: string }> }
    return rows[0]!
}

async function activoAl(empresaId: number, fecha: string) {
    const { rows } = (await db.rawQuery(
        `SELECT coalesce(sum(m.debe - m.haber), 0)::numeric(14,2)::text AS n
           FROM ledger.movimientos m JOIN ledger.asientos a ON a.id = m.asiento_id
           JOIN ledger.cuentas c ON c.id = m.cuenta_id
          WHERE a.empresa_id = ? AND a.fecha <= ? AND c.tipo = 'activo'`,
        [empresaId, fecha],
    )) as { rows: Array<{ n: string }> }
    return Number(rows[0]!.n)
}

/** Las fórmulas de §22 PR B recalculadas aquí desde R por mes, el mayor y el activo. */
function esperado(
    meses: Array<{ mes: string; ventas: string }>,
    r: { ingresos: string; gastos: string; nd: string },
    activo: number,
    crecimiento: number,
) {
    const n = meses.length
    const R = meses.reduce((s, x) => s + Number(x.ventas), 0)
    const renta = Number(r.ingresos) - Number(r.gastos) + Number(r.nd)
    const m = R > 0 ? renta / R : 0
    const op = meses.reduce((s, x) => s + Number(q(escala(Number(x.ventas)))), 0)
    const ut = Number(q(Math.max(renta, 0) * 0.25))
    const anual = (v: number) => (n === 12 ? v : Number(q((v * 12) / n)))
    const opAnual = anual(op)
    const utAnual = anual(ut)
    const RAnual = anual(R)
    // H37 (2034f27, 91033d7): el ISO de un año usa los ingresos anualizados como el resto
    const iso = Number(q(Math.max(activo, RAnual, 0) * 0.01))
    let ventas = Number(meses.at(-1)!.ventas)
    const proyectados = []
    for (let i = 0; i < 12; i++) {
        ventas *= 1 + crecimiento / 100
        proyectados.push(Number(q(ventas)))
    }
    const RP = proyectados.reduce((s, v) => s + v, 0)
    const isrUtP = Number(q(Math.max(RP * m, 0) * 0.25))
    return {
        datos: {
            meses_con_datos: n,
            ventas_sin_iva: q(R),
            ingresos: r.ingresos,
            gastos: r.gastos,
            no_deducibles: r.nd,
            renta_fiscal: q(renta),
            margen_fiscal: q(m * 100),
        },
        opcional: {
            isr_escala: q(op),
            isr_plano_art46: q(R * 0.07),
            tasa_efectiva: R > 0 ? q((op / R) * 100) : '0.00',
        },
        utilidades: { tasa: '25.00', renta_imponible: q(renta), isr: q(ut), perdida: renta < 0 },
        iso_piso: {
            activo_neto: q(activo),
            ingresos_brutos: q(R),
            ingresos_anuales: q(RAnual),
            ingresos_anualizados: n !== 12,
            iso_anual: q(iso),
        },
        comparacion: {
            meses_base: n,
            anualizado: n !== 12,
            ventas_anuales: q(RAnual),
            isr_opcional_anual: q(opAnual),
            isr_utilidades_anual: q(utAnual),
            utilidades_con_iso: q(Math.max(utAnual, iso)),
            iso_es_piso: iso > utAnual,
            diferencia: q(Math.max(utAnual, iso) - opAnual),
            margen_fiscal: q(m * 100),
            margen_equilibrio: q((opAnual / (0.25 * RAnual)) * 100),
            margen_equilibrio_art46: q(((R * 0.07) / (0.25 * R)) * 100),
        },
        proyeccion: {
            crecimiento_mensual: q(crecimiento),
            ventas: q(RP),
            isr_opcional: q(proyectados.reduce((s, v) => s + Number(q(escala(v))), 0)),
            isr_utilidades: q(isrUtP),
            utilidades_con_iso: q(Math.max(isrUtP, iso)),
            meses: proyectados.map((v) => q(v)),
        },
    }
}

function comprobar(assert: any, c: ComparadorEmpresa, e: ReturnType<typeof esperado>, meses: unknown) {
    for (const nombre of BLOQUES_COMPARADOR) assert.equal(c.bloques[nombre].estado, 'ok', nombre)
    assert.include(datos(c.bloques.datos), e.datos)
    assert.deepEqual(datos(c.bloques.datos).meses, meses, 'R mes a mes = libro de ventas de cada mes')
    assert.include(datos(c.bloques.opcional), e.opcional)
    assert.include(datos(c.bloques.utilidades), e.utilidades)
    assert.include(datos(c.bloques.iso_piso), e.iso_piso)
    assert.include(datos(c.bloques.comparacion), e.comparacion)
    const { meses: proyectados, ...proyeccion } = e.proyeccion
    assert.include(datos(c.bloques.proyeccion), proyeccion)
    assert.deepEqual(
        (datos(c.bloques.proyeccion).meses as Array<{ ventas: string }>).map((x) => x.ventas),
        proyectados,
    )
}

/**
 * B (utilidades, libros desde enero): ventas sin IVA de 40,000 y 50,000 en los dos últimos meses
 * terminados, una del mes en curso (fuera), 30,000 de gasto y 1,000 no deducible pagados del banco.
 * C (libros desde el año pasado, 12 meses): ingreso y gasto manuales del año pasado cerrado con
 * `cerrarEjercicio` y una venta de 20,000 este año.
 */
async function escenario() {
    const e = await prepararEmpresasGt()
    await parametro(e, e.B, 'inicio_libros', `${ANIO}-01-01`)
    await ventaEn(e.B, '44800.00', `${MES_2}-15`)
    await ventaEn(e.B, '56000.00', `${MES_1}-15`)
    await ventaEn(e.B, '11200.00', null)
    await asiento(e, e.B, `${MES_1}-20`, '5.2.99', '1.1.02.01', '30000.00')
    await asiento(e, e.B, `${MES_2}-20`, '5.4.01', '1.1.02.01', '1000.00')

    await parametro(e, e.C, 'inicio_libros', `${ANIO - 1}-01-01`)
    await asiento(e, e.C, `${ANIO - 1}-11-10`, '1.1.02.01', '4.1.01', '8000.00')
    await asiento(e, e.C, `${ANIO - 1}-12-10`, '5.2.99', '1.1.02.01', '2000.00')
    for (let mes = 1; mes <= 11; mes++) {
        await new CerrarPeriodo().execute({ empresa_id: e.C, anio: ANIO - 1, mes }, e.ctx)
    }
    await new CerrarEjercicio().execute({ empresa_id: e.C, anio: ANIO - 1, isr: { monto: '0.00' } }, e.ctx)
    await ventaEn(e.C, '22400.00', `${ANIO}-03-15`)
    return e
}

test.group('Auditor contable · comparador de regímenes', (group) => {
    const original = relojFiscal.ahora
    group.each.teardown(async () => {
        relojFiscal.ahora = original
        await soloEmpresaPrincipal()
    })

    test('cifras = libro de ventas por mes, mayor sin el cierre anual, activo y fórmulas de §22 PR B (con menos de 12 meses y con 12); multiempresa; nada se escribe', async ({
        assert,
        client,
    }) => {
        const e = await escenario()
        const huella = await huellaTablas()
        const r = await compararRegimenes([e.B, e.C], '2.00')
        assert.deepEqual(await huellaTablas(), huella, 'el comparador no escribe nada')
        const [cB, cC] = [e.B, e.C].map((id) => r.empresas.find((x) => x.empresa_id === id)!)
        assert.match(r.aviso, /no cambia el régimen/)

        // B: de enero al último mes terminado (menos de 12: anualiza)
        const hasta = ULTIMO.toISODate()!
        assert.deepEqual([cB!.desde, cB!.hasta], [`${ANIO}-01-01`, hasta])
        const mesesB = await rPorMes(e.B, `${ANIO}-01-01`, hasta)
        const mayorB = await resultadosDelMayor(e.B, `${ANIO}-01-01`, hasta)
        assert.deepEqual(mayorB, { ingresos: '90000.00', gastos: '31000.00', nd: '1000.00' })
        const eB = esperado(mesesB, mayorB, await activoAl(e.B, hasta), 2)
        comprobar(assert, cB!, eB, mesesB)
        assert.include(datos(cB!.bloques.datos), { ventas_sin_iva: '90000.00', margen_fiscal: '66.67' })
        assert.include(datos(cB!.bloques.opcional), { isr_escala: '5100.00', isr_plano_art46: '6300.00' })
        assert.include(datos(cB!.bloques.comparacion), {
            menor: 'opcional_simplificado',
            margen_equilibrio_art46: '28.00',
        })

        // C: 12 meses desde el mismo mes del año pasado; los resultados del año cerrado sin el cierre anual
        const desdeC = ULTIMO.startOf('month').minus({ months: 11 }).toISODate()!
        assert.deepEqual([cC!.desde, cC!.hasta], [desdeC, hasta])
        const mayorC = await resultadosDelMayor(e.C, desdeC, hasta)
        assert.deepEqual(mayorC, { ingresos: '28000.00', gastos: '2000.00', nd: '0.00' })
        const conCierre = await resultadosDelMayor(e.C, desdeC, hasta, true)
        assert.notDeepEqual(conCierre, mayorC, 'el cierre anual cae dentro de los 12 meses')
        const mesesC = await rPorMes(e.C, desdeC, hasta)
        comprobar(assert, cC!, esperado(mesesC, mayorC, await activoAl(e.C, hasta), 2), mesesC)
        assert.include(datos(cC!.bloques.comparacion), { anualizado: false, ventas_anuales: '20000.00' })

        // tendencia por defecto: 0 con un primer mes sin ventas (§15 #88)
        const sinCrecimiento = await compararRegimenes([e.B], null)
        assert.include(datos(sinCrecimiento.empresas[0]!.bloques.proyeccion), {
            crecimiento_mensual: '0.00',
            crecimiento_supuesto: 'tendencia',
        })

        // multiempresa: B sola = B en [B, C]; lo que pasa en C no mueve B
        const soloB = await compararRegimenes([e.B], '2.00')
        assert.deepEqual(soloB.empresas, [cB])
        await ventaEn(e.C, '11200.00', `${MES_1}-10`)
        await asiento(e, e.C, `${MES_1}-12`, '5.2.99', '1.1.02.01', '500.00')
        const trasC = await compararRegimenes([e.B, e.C], '2.00')
        assert.deepEqual(
            trasC.empresas.find((x) => x.empresa_id === e.B),
            cB,
        )
        assert.notDeepEqual(
            trasC.empresas.find((x) => x.empresa_id === e.C)!.bloques.datos,
            cC!.bloques.datos,
        )

        // API: contabilidad con alcance solo en B ve solo B; C y todas → 403; nada se escribe
        const restringido = await usuarioConRoles(['contabilidad'])
        await db.from('core.usuarios').where('id', restringido.usuario.id).update({ alcance_global: false })
        await db
            .table('core.usuarios_empresas')
            .insert({ usuario_id: restringido.usuario.id, empresa_id: e.B })
        const antesApi = await huellaTablas()
        const propia = await estado(
            client
                .get('/api/v1/fiscal/comparador')
                .bearerToken(restringido.token)
                .qs({ crecimiento: '2.00' }),
            200,
        )
        assert.deepEqual(propia.body().empresas, JSON.parse(JSON.stringify([cB])))
        const ajena = await client
            .get('/api/v1/fiscal/comparador')
            .bearerToken(restringido.token)
            .headers({ 'X-Empresa-Id': String(e.C) })
        assert.equal(ajena.status(), 403)
        const todas = await client
            .get('/api/v1/fiscal/comparador')
            .bearerToken(restringido.token)
            .qs({ empresas: 'todas' })
        assert.equal(todas.status(), 403)
        const global = await estado(
            client
                .get('/api/v1/fiscal/comparador')
                .bearerToken(e.token)
                .qs({ empresas: 'todas', crecimiento: '2.00' }),
            200,
        )
        assert.deepEqual(
            global.body().empresas.find((x: any) => x.empresa_id === e.B),
            JSON.parse(JSON.stringify(cB)),
        )
        assert.deepEqual(await huellaTablas(), antesApi, 'la API del comparador no escribe nada')
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('un bloque en error no trae cifras y sus dependientes responden 422 bloque_dependiente; sin localización, todo en error', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        await parametro(e, e.B, 'inicio_libros', `${MES}-01`) // ningún mes terminado
        const sinLocalizacion = await crearEmpresaFila()
        const huella = await huellaTablas()
        const r = await compararRegimenes([e.B, sinLocalizacion], null)
        assert.deepEqual(await huellaTablas(), huella)
        const [cB, cS] = [e.B, sinLocalizacion].map((id) => r.empresas.find((x) => x.empresa_id === id)!)
        assert.equal(cB!.bloques.datos.estado, 'error')
        assert.match(cB!.bloques.datos.error!.type, /sin_datos$/)
        for (const nombre of BLOQUES_COMPARADOR) {
            const b = cB!.bloques[nombre]
            assert.equal(b.estado, 'error', nombre)
            assert.isNull(b.datos, nombre)
            if (nombre !== 'datos') {
                assert.include(b.error!, { status: 422 }, nombre)
                assert.match(b.error!.type, /bloque_dependiente$/, nombre)
            }
        }
        assert.deepEqual([cB!.desde, cB!.hasta, cB!.crecimiento], [null, null, null])
        assert.isTrue(
            BLOQUES_COMPARADOR.every(
                (n) => cS!.bloques[n].estado === 'error' && cS!.bloques[n].datos === null,
            ),
        )
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('pérdida: utilidades sin ISR (0, no negativo) y el ISO del activo como piso; fórmulas iguales', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        await parametro(e, e.B, 'inicio_libros', `${ANIO}-01-01`)
        await asiento(e, e.B, `${MES_2}-01`, '1.1.02.01', '3.1.01', '1000000.00')
        await ventaEn(e.B, '56000.00', `${MES_1}-15`)
        await asiento(e, e.B, `${MES_1}-20`, '5.2.99', '1.1.02.01', '80000.00')
        const huella = await huellaTablas()
        const r = await compararRegimenes([e.B], '-1.50')
        assert.deepEqual(await huellaTablas(), huella)
        const c = r.empresas[0]!
        const hasta = ULTIMO.toISODate()!
        const meses = await rPorMes(e.B, `${ANIO}-01-01`, hasta)
        const mayor = await resultadosDelMayor(e.B, `${ANIO}-01-01`, hasta)
        assert.deepEqual(mayor, { ingresos: '50000.00', gastos: '80000.00', nd: '0.00' })
        const activo = await activoAl(e.B, hasta)
        assert.isAbove(activo, 900000)
        comprobar(assert, c, esperado(meses, mayor, activo, -1.5), meses)
        assert.include(datos(c.bloques.utilidades), {
            isr: '0.00',
            perdida: true,
            renta_imponible: '-30000.00',
        })
        assert.include(datos(c.bloques.comparacion), { iso_es_piso: true, menor: 'opcional_simplificado' })
        assert.equal(datos(c.bloques.comparacion).utilidades_con_iso, datos(c.bloques.iso_piso).iso_anual)
        assert.equal(datos(c.bloques.proyeccion).isr_utilidades, '0.00')
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('H37 (arreglado en 2034f27 y 91033d7): con menos de 12 meses el ISO como piso usa R anualizado, como el ISR de los dos regímenes', async ({
        assert,
    }) => {
        const e = await escenario()
        const r = await compararRegimenes([e.B], null)
        const iso = datos(r.empresas[0]!.bloques.iso_piso)
        const cmp = datos(r.empresas[0]!.bloques.comparacion)
        // activo al cierre < R: la base del ISO de un año es R anual = 90,000 × 12 / 9 = 120,000
        assert.isBelow(Number(iso.activo_neto), Number(cmp.ventas_anuales))
        assert.equal(cmp.iso_anual, q(Number(cmp.ventas_anuales) * 0.01))
        assert.include(iso, { ingresos_brutos: '90000.00', ingresos_anualizados: true })
        assert.equal(iso.ingresos_anuales, cmp.ventas_anuales)
    })
})
