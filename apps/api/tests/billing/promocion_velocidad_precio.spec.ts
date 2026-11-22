import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { ejecutarCronCore } from '#core/jobs'
import { leerPrecioEfectivo, leerServicio } from '#billing/configuracion'
import { EXTRAS_TODOS } from '#network/estrategia_velocidad'
import { limpiarClavesAaa } from '#tests/core/ayudas_aaa'
import { estado, unico, usuarioConRoles } from '#tests/ayudas'
import { crearEscenarioRouter, crearPlanFila } from '#tests/core/fabricas'
import { afirmarLibroCuadrado } from '#tests/ledger/ayudas_libro'
import { escenario, facturasDe, generar } from '#tests/billing/ayudas_billing'
import { DateTime } from 'luxon'
import { hoyGuatemala } from '#ledger/fechas'
import { aTexto, dec } from '#ledger/dinero'

/**
 * Facturación con promociones de velocidad (decisiones del PM 18 y 34; precio, 22 nov). Sin `precio`
 * la promoción es gratis: se cobra el plan original aunque un tramo PCQ haya cambiado `plan_id`. Con
 * `precio`, se cobra el precio normal más la diferencia proporcional por los días de sus tramos.
 */

const HORA = 3_600_000

/** Router PCQ: la cola es del plan, así que el tramo cambia el plan del servicio. */
function routerPcq() {
    const pcq = { aplicacion: 'pcq_plan', padre: 'ninguno', tipo_cola: 'pcq', extras: { ...EXTRAS_TODOS } }
    return { estrategia_velocidad: JSON.stringify({ pppoe: pcq, ip_estatica: pcq, dhcp_fija: pcq }) }
}

async function servicioEnPcq() {
    const { routerId } = await crearEscenarioRouter(routerPcq())
    const e = await escenario({ precio: '150.00', servicio: { router_id: routerId } })
    const destino = await crearPlanFila({ bajada_kbps: 60000, subida_kbps: 15000, precio: '400.00' })
    return { ...e, destino }
}

async function crearPromocion(client: any, token: string, servicioId: number, destino: number, extra = {}) {
    const ahora = Date.now()
    const fin = new Date(ahora + 24 * HORA)
    const r = await estado(
        client
            .post('/api/v1/promociones-velocidad')
            .bearerToken(token)
            .json({
                nombre: unico('Gamer'),
                modo: 'dias',
                inicio: new Date(ahora - HORA).toISOString(),
                fin: fin.toISOString(),
                servicio_ids: [servicioId],
                tipo_velocidad: 'plan_destino',
                plan_destino_id: destino,
                ...extra,
            }),
        201,
    )
    return { promo: r.body() as Record<string, any>, fin }
}

async function planDelServicio(servicioId: number): Promise<number> {
    const fila = await db.from('core.servicios').where('id', servicioId).select('plan_id').firstOrFail()
    return Number(fila.plan_id)
}

async function lineaDelPlan(facturaId: number) {
    return db
        .from('billing.facturas_lineas')
        .where('factura_id', facturaId)
        .orderBy('id')
        .select('concepto', 'total')
        .firstOrFail()
}

async function snapshot(facturaId: number): Promise<Record<string, any>> {
    const fila = await db
        .from('billing.facturas')
        .where('id', facturaId)
        .select('reglas_snapshot')
        .firstOrFail()
    return fila.reglas_snapshot as Record<string, any>
}

async function montoVistaPrevia(client: any, token: string, servicioId: number): Promise<string> {
    const r = await estado(
        client.get(`/api/v1/servicios/${servicioId}/periodos-facturables`).bearerToken(token),
        200,
    )
    const futuro = (r.body().periodos as Array<{ estado: string; monto: string }>).find(
        (p) => p.estado === 'futuro',
    )
    return futuro!.monto
}

test.group('billing · promoción de velocidad en router PCQ (decisión del PM 34)', (group) => {
    group.each.setup(() => limpiarClavesAaa())

    test('una factura emitida durante un tramo abierto cobra el plan original, no el destino', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const e = await servicioEnPcq()
        const filaPlan = await db.from('network.planes').where('id', e.planId).select('nombre').firstOrFail()
        const original = filaPlan.nombre as string
        const { fin } = await crearPromocion(client, token, e.servicioId, e.destino)

        // el tramo está abierto y el servicio está en el plan destino (Q400)
        assert.equal(await planDelServicio(e.servicioId), e.destino)

        // precio efectivo, leerServicio, precio_mensual de A1 y vista previa: el plan original
        assert.equal(await leerPrecioEfectivo(db.connection(), e.servicioId), '150.00')
        const servicio = await leerServicio(db.connection(), e.servicioId)
        assert.equal(servicio.precio, '150.00')
        assert.equal(servicio.plan_id, e.planId)
        assert.equal(servicio.plan_nombre, original)
        const http = await estado(client.get(`/api/v1/servicios/${e.servicioId}`).bearerToken(token), 200)
        assert.equal(http.body().precio_mensual, '150.00')
        assert.equal(await montoVistaPrevia(client, token, e.servicioId), '150.00')

        // generar facturas durante el tramo: cada periodo cobra Q150 del plan original
        await generar(e.servicioId, '2026-10-01')
        const facturas = await facturasDe(e.servicioId)
        assert.deepEqual(
            facturas.map((f) => [f.periodo, f.total]),
            [
                ['2026-09-01', '150.00'],
                ['2026-10-01', '150.00'],
            ],
        )
        const linea = await lineaDelPlan(facturas[0]!.id)
        assert.equal(linea.total, '150.00')
        assert.include(linea.concepto, original)
        const snap = await snapshot(facturas[0]!.id)
        assert.equal(snap.precio, '150.00')
        assert.equal(Number(snap.plan_id), e.planId)
        assert.notProperty(snap, 'promociones_velocidad')
        // gratis: ninguna línea de promoción
        const lineas = await db
            .from('billing.facturas_lineas')
            .whereIn(
                'factura_id',
                facturas.map((f) => f.id),
            )
            .select('concepto')
        assert.isUndefined(lineas.find((l) => String(l.concepto).startsWith('Promoción de velocidad')))
        await afirmarLibroCuadrado(assert)

        // al cerrar el tramo vuelve al plan original y el precio sigue igual
        await ejecutarCronCore('promociones_velocidad', new Date(fin.getTime() + 60_000))
        assert.equal(await planDelServicio(e.servicioId), e.planId)
        assert.equal(await leerPrecioEfectivo(db.connection(), e.servicioId), '150.00')
    })
})

/** Promoción con `precio` (multiplicador; la red no importa para cobrar) y sus tramos ya aplicados. */
async function promocionConPrecio(
    servicioId: number,
    precio: string,
    modo: 'dias' | 'franja',
    tramos: Array<{ inicio: string; fin: string; abierto?: boolean }>,
) {
    const s = await db.from('core.servicios').where('id', servicioId).select('empresa_id').firstOrFail()
    const nombre = unico('Gamer')
    const [promo] = (await db
        .table('core.promociones_velocidad')
        .insert({
            empresa_id: s.empresa_id,
            nombre,
            tipo_velocidad: 'multiplicador',
            multiplicador: '2',
            modo,
            inicio: tramos[0]!.inicio,
            fin: tramos.at(-1)!.fin,
            ...(modo === 'franja' ? { franja_inicio: '18:00', franja_fin: '23:00' } : {}),
            precio,
        })
        .returning('id')) as Array<{ id: number }>
    const ids: number[] = []
    for (const tr of tramos) {
        const [fila] = (await db
            .table('core.promociones_velocidad_tramos')
            .insert({
                promocion_id: promo!.id,
                servicio_id: servicioId,
                empresa_id: s.empresa_id,
                inicio: tr.inicio,
                fin: tr.fin,
                estado: tr.abierto ? 'abierto' : 'cerrado',
                cerrado_en: tr.abierto ? null : tr.fin,
                motivo_cierre: tr.abierto ? null : 'fin',
            })
            .returning('id')) as Array<{ id: number }>
        ids.push(Number(fila!.id))
    }
    return { promocionId: Number(promo!.id), nombre, tramos: ids }
}

async function lineasDe(facturaId: number) {
    const filas = await db
        .from('billing.facturas_lineas')
        .where('factura_id', facturaId)
        .orderBy('id')
        .select('concepto', 'tipo', 'total', 'iva')
    return filas.map((l) => [l.concepto as string, l.total as string])
}

/** Líneas de promoción de la factura (todas menos la del plan). */
async function lineasPromocionDe(facturaId: number) {
    const lineas = await lineasDe(facturaId)
    return lineas.slice(1)
}

async function cargosDe(servicioId: number) {
    const filas = await db
        .from('billing.promociones_cargos')
        .where('servicio_id', servicioId)
        .orderBy('id')
        .select('tramo_id', 'dias', 'factura_id', db.raw(`to_char(periodo, 'YYYY-MM-DD') as periodo`))
    return filas.map((c) => [Number(c.tramo_id), c.periodo as string, Number(c.dias), Number(c.factura_id)])
}

test.group('billing · promoción de velocidad con precio (decisión del PM, 22 nov)', () => {
    test('3 días de 30: precio normal más la diferencia proporcional en su propia línea, una sola vez', async ({
        assert,
    }) => {
        // septiembre 2026: 30 días; Guatemala = UTC−6
        const e = await escenario({ precio: '150.00' })
        const promo = await promocionConPrecio(e.servicioId, '300.00', 'dias', [
            { inicio: '2026-09-10T06:00:00Z', fin: '2026-09-13T06:00:00Z' },
        ])

        await generar(e.servicioId, '2026-09-01')
        const [factura] = await facturasDe(e.servicioId)
        // (300 − 150) × 3 / 30 = 15.00
        assert.equal(factura!.total, '165.00')
        assert.deepEqual(await lineasPromocionDe(factura!.id), [
            [`Promoción de velocidad ${promo.nombre}, 3 días`, '15.00'],
        ])
        const linea = await db
            .from('billing.facturas_lineas')
            .where('factura_id', factura!.id)
            .whereLike('concepto', 'Promoción de velocidad%')
            .firstOrFail()
        assert.equal(linea.iva, '1.61')
        assert.equal(linea.cuenta_codigo, '4.1.01')
        const snap = await snapshot(factura!.id)
        assert.equal(snap.precio, '150.00')
        assert.deepEqual(snap.promociones_velocidad, [
            {
                promocion_id: promo.promocionId,
                nombre: promo.nombre,
                periodo: '2026-09-01',
                dias: 3,
                dias_ciclo: 30,
                precio_promocion: '300.00',
                precio_normal: '150.00',
                monto: '15.00',
                tramos: [{ tramo_id: promo.tramos[0], dias: 3 }],
            },
        ])
        assert.deepEqual(await cargosDe(e.servicioId), [[promo.tramos[0], '2026-09-01', 3, factura!.id]])
        await afirmarLibroCuadrado(assert)

        // repetir y seguir: octubre no vuelve a cobrar los días de septiembre
        await generar(e.servicioId, '2026-09-01')
        await generar(e.servicioId, '2026-10-01')
        const facturas = await facturasDe(e.servicioId)
        assert.deepEqual(
            facturas.map((f) => [f.periodo, f.total]),
            [
                ['2026-09-01', '165.00'],
                ['2026-10-01', '150.00'],
            ],
        )
        assert.lengthOf(await cargosDe(e.servicioId), 1)
        await afirmarLibroCuadrado(assert)
    })

    test('precio igual o menor que el normal: no se suma nada (una promoción nunca abarata)', async ({
        assert,
    }) => {
        const e = await escenario({ precio: '150.00' })
        await promocionConPrecio(e.servicioId, '100.00', 'dias', [
            { inicio: '2026-09-10T06:00:00Z', fin: '2026-09-20T06:00:00Z' },
        ])
        await generar(e.servicioId, '2026-09-01')
        const [factura] = await facturasDe(e.servicioId)
        assert.equal(factura!.total, '150.00')
        assert.lengthOf(await lineasDe(factura!.id), 1)
        assert.lengthOf(await cargosDe(e.servicioId), 0)
    })

    test('franja horaria: cuenta los días con franja (la que cruza la medianoche, una vez)', async ({
        assert,
    }) => {
        const e = await escenario({ precio: '150.00' })
        const promo = await promocionConPrecio(e.servicioId, '240.00', 'franja', [
            // 18:00–23:00 de Guatemala el 5 y el 6; 22:00–02:00 el 7
            { inicio: '2026-09-06T00:00:00Z', fin: '2026-09-06T05:00:00Z' },
            { inicio: '2026-09-07T00:00:00Z', fin: '2026-09-07T05:00:00Z' },
            { inicio: '2026-09-08T04:00:00Z', fin: '2026-09-08T08:00:00Z' },
        ])
        await generar(e.servicioId, '2026-09-01')
        const [factura] = await facturasDe(e.servicioId)
        // (240 − 150) × 3 / 30 = 9.00
        assert.deepEqual(await lineasPromocionDe(factura!.id), [
            [`Promoción de velocidad ${promo.nombre}, 3 días`, '9.00'],
        ])
        assert.equal(factura!.total, '159.00')
        assert.lengthOf(await cargosDe(e.servicioId), 3)
    })

    test('tramo que cruza dos periodos y se cierra después de emitida la factura: lo que falta va en la siguiente', async ({
        assert,
    }) => {
        // el periodo del mes en curso todavía no termina: el tramo sigue abierto al emitir su factura
        const m1 = DateTime.fromISO(hoyGuatemala(), { zone: 'utc' }).startOf('month')
        const m2 = m1.plus({ months: 1 })
        const periodo1 = m1.toISODate()!
        const periodo2 = m2.toISODate()!
        const finTramo = m2.plus({ days: 2 }).plus({ hours: 6 }) // 3 del mes siguiente, 00:00 de Guatemala
        const e = await escenario({ precio: '150.00', fecha_instalacion: periodo1 })
        const promo = await promocionConPrecio(e.servicioId, '300.00', 'dias', [
            { inicio: m1.plus({ hours: 6 }).toISO()!, fin: finTramo.toISO()!, abierto: true },
        ])

        await generar(e.servicioId, periodo1)
        const [primera] = await facturasDe(e.servicioId)
        assert.equal(primera!.total, '150.00')
        assert.lengthOf(await cargosDe(e.servicioId), 0)

        // el cron cierra el tramo a su fin
        await ejecutarCronCore('promociones_velocidad', finTramo.plus({ minutes: 1 }).toJSDate())
        const tramo = await db
            .from('core.promociones_velocidad_tramos')
            .where('id', promo.tramos[0]!)
            .firstOrFail()
        assert.equal(tramo.estado, 'cerrado')

        await generar(e.servicioId, periodo2)
        await generar(e.servicioId, periodo2)
        const facturas = await facturasDe(e.servicioId)
        assert.lengthOf(facturas, 2)
        const segunda = facturas[1]!
        // mes en curso completo: 150 × n / n = 150.00; el siguiente, 2 días: 150 × 2 / días del mes
        const diasM1 = m1.daysInMonth!
        const diasM2 = m2.daysInMonth!
        const parte2 = aTexto(dec('150').times(2).div(diasM2))
        assert.deepEqual(await lineasPromocionDe(segunda.id), [
            [`Promoción de velocidad ${promo.nombre}, ${diasM1} días (periodo del ${periodo1})`, '150.00'],
            [`Promoción de velocidad ${promo.nombre}, 2 días`, parte2],
        ])
        assert.equal(segunda.total, aTexto(dec('300').plus(parte2)))
        assert.deepEqual(await cargosDe(e.servicioId), [
            [promo.tramos[0], periodo1, diasM1, segunda.id],
            [promo.tramos[0], periodo2, 2, segunda.id],
        ])
        await afirmarLibroCuadrado(assert)
    })
})
