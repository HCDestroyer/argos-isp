import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { soloEmpresaPrincipal } from '#tests/ayudas'
import { unicoBd } from '#tests/billing/ayudas_billing'
import { servicioFacturado } from '#tests/contabilidad/ayudas_contabilidad'
import { afirmarLibro, huellaTablas } from '#tests/contabilidad/verificar_libro'
import { prepararEmpresasGt, type EmpresasGt } from '#tests/ledger/ayudas_bancos'
import { proveedorEn } from '#tests/ledger/ayudas_compras'
import { tableroFiscal } from '#fiscal/tablero'
import { consejosFiscales } from '#fiscal/consejos'
import { calcularChecks, reservaIncobrables } from '#ledger/checks'
import type { Bloque } from '#fiscal/bloques'
import RegistrarPago from '#billing/actions/registrar_pago'
import RegistrarCompra from '#ledger/actions/registrar_compra'
import AnularCompra from '#ledger/actions/anular_compra'
import RegistrarActivo from '#ledger/actions/registrar_activo'
import DarDeBajaActivo from '#ledger/actions/dar_de_baja_activo'
import ProvisionarCartera from '#ledger/actions/provisionar_cartera'

/**
 * Auditor contable · bloques del libro del tablero (fase 8 PR D; contrato §22 PR D, §15 #90–#91):
 * `compras_sin_nit` = `ledger.compras` vigentes del año desde `consumidor_final_limite` sin NIT del
 * proveedor; `incobrables` = la misma base, tope y estimación que el check `incobrables` (con la
 * consulta de antes del refactor) y que `cartera.provisionar`; `depreciacion` = `ledger.activos` sin
 * baja bajo el máximo de su clase. Multiempresa y nada se escribe.
 */

const HOY = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Guatemala' })
const MES = HOY.slice(0, 7)
const ANIO = HOY.slice(0, 4)
const datos = (b: Bloque) => b.datos as Record<string, any>

async function compra(e: EmpresasGt, proveedorId: number, total: string) {
    return new RegistrarCompra().execute(
        {
            proveedor_id: proveedorId,
            tipo_documento: 'FACT',
            numero: await unicoBd('D'),
            fecha_documento: HOY,
            condicion: 'credito',
            lineas: [{ descripcion: 'Servicio', total }],
        },
        e.ctx,
    )
}

/** Compras sin NIT recalculadas desde `ledger.compras` y `ledger.proveedores`. */
async function comprasSinNitDelLibro(empresaId: number) {
    const { rows } = (await db.rawQuery(
        `SELECT count(*)::int AS cantidad, coalesce(sum(co.total), 0)::numeric(14,2)::text AS total,
                coalesce(array_agg(co.id ORDER BY co.fecha, co.id) FILTER (WHERE co.id IS NOT NULL), '{}') AS ids
           FROM ledger.compras co JOIN ledger.proveedores p ON p.id = co.proveedor_id
          WHERE co.empresa_id = ? AND extract(year FROM co.fecha) = ? AND co.fecha <= ?
            AND co.total >= 2500 AND co.tipo_documento <> 'NCRE'
            AND co.id NOT IN (SELECT compra_id FROM ledger.compras_anulaciones)
            AND (p.tipo_documento <> 'nit' OR p.tipo = 'sin_documento' OR upper(p.nit) IN ('CF', 'C/F', 'C.F.'))`,
        [empresaId, Number(ANIO), HOY],
    )) as { rows: Array<{ cantidad: number; total: string; ids: number[] }> }
    return rows[0]!
}

/** La consulta del check `incobrables` antes del refactor de la PR D (base y estimación). */
async function incobrablesComoAntes(empresaId: number, fin: string) {
    const { rows } = (await db.rawQuery(
        `SELECT (SELECT coalesce(sum(s), 0)::numeric(14,2)::text FROM (
                    SELECT m.cliente_id, sum(m.debe - m.haber) AS s
                      FROM ledger.movimientos m JOIN ledger.asientos a ON a.id = m.asiento_id
                      JOIN ledger.cuentas cu ON cu.id = m.cuenta_id
                     WHERE cu.codigo = '1.1.03' AND a.empresa_id = ? AND a.fecha <= ?::date
                     GROUP BY m.cliente_id) x WHERE s > 0) AS base,
                (SELECT coalesce(sum(m.haber - m.debe), 0)::numeric(14,2)::text
                   FROM ledger.movimientos m JOIN ledger.asientos a ON a.id = m.asiento_id
                   JOIN ledger.cuentas cu ON cu.id = m.cuenta_id
                  WHERE cu.codigo = '1.1.12' AND a.empresa_id = ? AND a.fecha <= ?::date) AS estimacion`,
        [empresaId, fin, empresaId, fin],
    )) as { rows: Array<{ base: string; estimacion: string }> }
    const base = rows[0]!.base
    return { base, tope: (Math.round(Number(base) * 3) / 100).toFixed(2), estimacion: rows[0]!.estimacion }
}

/** Activos sin baja bajo el máximo de su clase, recalculados desde `ledger.activos`. */
async function activosDelLibro(empresaId: number) {
    const maximos: Record<string, number> = {
        equipo_red: 10,
        computacion: 33.33,
        mobiliario: 20,
        vehiculos: 20,
        herramientas: 25,
        edificios: 5,
        otros: 10,
    }
    const filas = (await db
        .from('ledger.activos as a')
        .where('a.empresa_id', empresaId)
        .whereNotExists((q) => q.from('ledger.activos_bajas as b').whereRaw('b.activo_id = a.id'))
        .select(
            'a.id',
            'a.clase',
            'a.costo',
            'a.valor_residual',
            'a.tasa_anual',
            db.raw(`a.depreciacion_inicial + coalesce((SELECT sum(c.monto) FROM ledger.activos_cuotas c
                     WHERE c.activo_id = a.id
                       AND NOT EXISTS (SELECT 1 FROM ledger.asientos r WHERE r.reversa_de = c.asiento_id)), 0) AS acumulada`),
        )) as Array<Record<string, any>>
    const r = (n: number) => Math.round(n * 100) / 100
    // H38: cada deducción anual acotada a lo que queda por depreciar; sin saldo o sin diferencia no se lista
    const calculados = filas
        .filter((a) => Number(a.tasa_anual) < maximos[a.clase]!)
        .map((a) => {
            const dep = Number(a.costo) - Number(a.valor_residual)
            const resto = r(dep - Number(a.acumulada))
            const actual = Math.min(r((dep * Number(a.tasa_anual)) / 100), resto)
            const maxima = Math.min(r((dep * maximos[a.clase]!) / 100), resto)
            return { id: Number(a.id), resto, diferencia: r(maxima - actual) }
        })
        .filter((x) => x.resto > 0 && x.diferencia > 0)
    return {
        activos: filas.length,
        bajo: calculados.map((x) => x.id).sort(),
        diferencia: calculados.reduce((s, x) => s + x.diferencia, 0).toFixed(2),
    }
}

test.group('Auditor contable · bloques del libro del tablero', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('compras sin NIT, incobrables (= check de antes del refactor = cartera.provisionar) y depreciación = libro; multiempresa; nada se escribe', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()

        // cartera: dos clientes con saldo, uno pagó una parte (base = Σ saldos deudores)
        const s1 = await servicioFacturado(e.B, `${MES}-01`, { precio: '224.00', instalacion: `${MES}-01` })
        const s2 = await servicioFacturado(e.B, `${MES}-01`, { precio: '560.00', instalacion: `${MES}-01` })
        await new RegistrarPago().execute(
            { cliente_id: s2.clienteId, metodo: 'caja', monto: '100.00', empresa_id: e.B },
            e.ctx,
        )
        void s1
        await servicioFacturado(e.C, `${MES}-01`, { precio: '1120.00', instalacion: `${MES}-01` })

        // compras: CUI desde el límite (cuenta), CUI justo en el límite (cuenta), CUI anulada, NIT, CUI debajo; y C
        const cui = await proveedorEn(e.B, e.ctx, {
            tipo_documento: 'cui',
            nit: '1234567890101',
            regimen_isr: 'utilidades',
        })
        const nit = await proveedorEn(e.B, e.ctx, { regimen_isr: 'utilidades' })
        const sobre = await compra(e, cui.id, '3360.00')
        const justo = await compra(e, cui.id, '2500.00')
        const anulada = await compra(e, cui.id, '5600.00')
        await new AnularCompra().execute({ compra_id: anulada.id, motivo: 'auditoría' }, e.ctx)
        await compra(e, nit.id, '11200.00')
        await compra(e, cui.id, '2499.99')
        const cuiC = await proveedorEn(e.C, e.ctx, {
            tipo_documento: 'cui',
            nit: '1234567890101',
            regimen_isr: 'utilidades',
        })
        await compra(e, cuiC.id, '9000.00')

        // activos: bajo el máximo, al máximo, bajo el máximo dado de baja y uno de C
        const bajo = await new RegistrarActivo().execute(
            {
                empresa_id: e.B,
                clase: 'computacion',
                descripcion: 'OLT',
                fecha_alta: HOY,
                costo: '6000.00',
                valor_residual: '600.00',
                tasa_anual: '20.00',
                contrapartida: '3.1.01',
            },
            e.ctx,
        )
        await new RegistrarActivo().execute(
            {
                empresa_id: e.B,
                clase: 'mobiliario',
                descripcion: 'Rack',
                fecha_alta: HOY,
                costo: '3000.00',
                contrapartida: '3.1.01',
            },
            e.ctx,
        )
        const retirado = await new RegistrarActivo().execute(
            {
                empresa_id: e.B,
                clase: 'vehiculos',
                descripcion: 'Pickup',
                fecha_alta: HOY,
                costo: '50000.00',
                tasa_anual: '10.00',
                contrapartida: '3.1.01',
            },
            e.ctx,
        )
        await new DarDeBajaActivo().execute(
            { activo_id: retirado.id, tipo: 'retiro', motivo: 'auditoría', fecha: HOY },
            e.ctx,
        )
        await new RegistrarActivo().execute(
            {
                empresa_id: e.C,
                clase: 'edificios',
                descripcion: 'Nodo',
                fecha_alta: HOY,
                costo: '90000.00',
                tasa_anual: '2.00',
                contrapartida: '3.1.01',
            },
            e.ctx,
        )

        const huella = await huellaTablas()
        const t = await tableroFiscal([e.B, e.C])
        assert.deepEqual(await huellaTablas(), huella, 'el tablero no escribe')
        const [tB, tC] = [e.B, e.C].map((id) => t.empresas.find((x) => x.empresa_id === id)!)

        // compras sin NIT = ledger.compras
        const libroB = await comprasSinNitDelLibro(e.B)
        assert.deepEqual(libroB.ids.map(Number), [sobre.id, justo.id])
        const cB = datos(tB!.bloques.compras_sin_nit)
        assert.include(cB, { cantidad: libroB.cantidad, total: libroB.total, limite: '2500.00' })
        assert.deepEqual(
            (cB.compras as any[]).map((x) => x.compra_id),
            libroB.ids.map(Number),
        )
        const libroC = await comprasSinNitDelLibro(e.C)
        assert.include(datos(tC!.bloques.compras_sin_nit), { cantidad: libroC.cantidad, total: libroC.total })
        assert.equal(libroC.total, '9000.00')

        // incobrables = consulta del check antes del refactor = check de hoy = reservaIncobrables
        for (const [x, empresa] of [
            [tB, e.B],
            [tC, e.C],
        ] as const) {
            const antes = await incobrablesComoAntes(empresa, `${ANIO}-12-31`)
            const i = datos(x!.bloques.incobrables)
            assert.include(
                i,
                { base: antes.base, tope: antes.tope, estimacion: antes.estimacion },
                String(empresa),
            )
            const checks = await calcularChecks(db.connection(), empresa, 'anual', `${ANIO}-01-01`)
            const check = checks.find((k) => k.clave === 'incobrables')
            assert.deepEqual(
                [check!.esperado, check!.obtenido, check!.resultado, check!.detalle],
                [
                    `<= ${antes.tope}`,
                    antes.estimacion,
                    'ok',
                    { base: antes.base, porcentaje: '3', tope: antes.tope },
                ],
            )
            const r = await reservaIncobrables(db.connection(), empresa, HOY)
            assert.deepEqual([r.base.toFixed(2), r.tope.toFixed(2)], [i.base, i.tope])
        }
        assert.equal(datos(tB!.bloques.incobrables).base, '684.00', '224 + 560 − 100')

        // depreciación = ledger.activos
        const actB = await activosDelLibro(e.B)
        const dB = datos(tB!.bloques.depreciacion)
        assert.include(dB, {
            activos: actB.activos,
            bajo_maximo: actB.bajo.length,
            diferencia_anual: actB.diferencia,
        })
        assert.deepEqual(
            (dB.detalle as any[]).map((x) => x.activo_id),
            [bajo.id],
        )
        assert.equal(actB.diferencia, '719.82', '(6,000 − 600) × (33.33 % − 20 %)')
        const actC = await activosDelLibro(e.C)
        assert.include(datos(tC!.bloques.depreciacion), {
            activos: actC.activos,
            diferencia_anual: actC.diferencia,
        })

        // consejos con esas cifras
        const k = await consejosFiscales([e.B], null)
        const consejo = (clave: string) => k.empresas[0]!.consejos.find((x) => x.clave === clave)!
        assert.deepEqual(consejo('compras_sin_nit').datos, {
            cantidad: 2,
            total: libroB.total,
            limite: '2500.00',
        })
        assert.deepEqual(consejo('incobrables_sin_usar').datos, {
            tope: datos(tB!.bloques.incobrables).tope,
            estimacion: '0.00',
            disponible: datos(tB!.bloques.incobrables).tope,
        })
        assert.deepEqual(consejo('depreciacion_bajo_maximo').datos, {
            activos: 1,
            diferencia_anual: actB.diferencia,
        })

        // la provisión usa la misma base y el mismo tope; después la reserva queda usada
        const provision = await new ProvisionarCartera().execute(
            { empresa_id: e.B, anio: Number(ANIO), fecha: HOY },
            e.ctx,
        )
        assert.deepEqual(
            [provision.base, provision.tope],
            [datos(tB!.bloques.incobrables).base, datos(tB!.bloques.incobrables).tope],
        )
        const tras = await tableroFiscal([e.B, e.C])
        assert.include(datos(tras.empresas.find((x) => x.empresa_id === e.B)!.bloques.incobrables), {
            estimacion: provision.tope,
            disponible: '0.00',
            sobre_tope: false,
        })
        assert.deepEqual(
            tras.empresas.find((x) => x.empresa_id === e.C),
            tC,
            'la provisión de B no mueve C',
        )
        const k2 = await consejosFiscales([e.B], null)
        assert.equal(
            k2.empresas[0]!.consejos.find((x) => x.clave === 'incobrables_sin_usar')!.estado,
            'no_aplica',
        )
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('H38 (arreglado en ca46938): depreciación bajo el máximo no promete gasto de un activo ya depreciado', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        // inventario inicial casi depreciado: queda Q0.01 por depreciar
        await new RegistrarActivo().execute(
            {
                empresa_id: e.B,
                clase: 'computacion',
                descripcion: 'Servidor viejo',
                fecha_alta: HOY,
                costo: '10000.00',
                depreciacion_inicial: '9999.99',
                tasa_anual: '5.00',
                contrapartida: '3.1.01',
            },
            e.ctx,
        )
        // otro con lo que queda entre las dos deducciones: 10,000 − 7,500 = 2,500 por depreciar;
        // al 20 % deduce 2,000 y al máximo (33.33 % = 3,333) solo los 2,500: diferencia 500
        const parcial = await new RegistrarActivo().execute(
            {
                empresa_id: e.B,
                clase: 'computacion',
                descripcion: 'Servidor a medias',
                fecha_alta: HOY,
                costo: '10000.00',
                depreciacion_inicial: '7500.00',
                tasa_anual: '20.00',
                contrapartida: '3.1.01',
            },
            e.ctx,
        )
        const t = await tableroFiscal([e.B])
        const d = datos(t.empresas[0]!.bloques.depreciacion)
        const libro = await activosDelLibro(e.B)
        assert.include(d, { activos: 2, bajo_maximo: 1, diferencia_anual: libro.diferencia })
        assert.deepEqual(libro.bajo, [parcial.id])
        assert.include(d.detalle[0], {
            activo_id: parcial.id,
            acumulada: '7500.00',
            por_depreciar: '2500.00',
            depreciacion_anual: '2000.00',
            depreciacion_anual_maxima: '2500.00',
            diferencia_anual: '500.00',
        })
        const k = await consejosFiscales([e.B], null)
        assert.deepEqual(k.empresas[0]!.consejos.find((x) => x.clave === 'depreciacion_bajo_maximo')!.datos, {
            activos: 1,
            diferencia_anual: '500.00',
        })
        await afirmarLibro(assert, [e.B, e.C])
    })
})
