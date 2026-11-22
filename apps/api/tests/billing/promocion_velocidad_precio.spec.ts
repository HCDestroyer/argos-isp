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

/**
 * Facturación con promoción de velocidad en un router con velocidad por plan (decisiones del PM 18 y
 * 34): el tramo abierto cambia `plan_id` al plan destino, pero se factura el plan original
 * (`sqlPlanFacturablePromocion`), salvo que la promoción tenga `precio`: entonces ese precio.
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
        assert.isNull(servicio.promocion_precio)
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
        assert.notProperty(snap, 'promocion_velocidad')
        await afirmarLibroCuadrado(assert)

        // al cerrar el tramo vuelve al plan original y el precio sigue igual
        await ejecutarCronCore('promociones_velocidad', new Date(fin.getTime() + 60_000))
        assert.equal(await planDelServicio(e.servicioId), e.planId)
        assert.equal(await leerPrecioEfectivo(db.connection(), e.servicioId), '150.00')
    })

    test('con `precio` en la promoción, la factura cobra el precio de la promoción mientras dura', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const e = await servicioEnPcq()
        // el precio de la promoción manda también sobre un costo_override
        await db.from('core.servicios').where('id', e.servicioId).update({ costo_override: '120.00' })
        const { promo, fin } = await crearPromocion(client, token, e.servicioId, e.destino, {
            precio: '199.00',
        })
        assert.equal(await planDelServicio(e.servicioId), e.destino)
        const tramo = await db
            .from('core.promociones_velocidad_tramos')
            .where({ promocion_id: promo.id, servicio_id: e.servicioId, estado: 'abierto' })
            .firstOrFail()

        assert.equal(await leerPrecioEfectivo(db.connection(), e.servicioId), '199.00')
        const servicio = await leerServicio(db.connection(), e.servicioId)
        assert.equal(servicio.precio, '199.00')
        assert.equal(servicio.plan_id, e.planId)
        assert.deepEqual(servicio.promocion_precio, {
            promocion_id: Number(promo.id),
            tramo_id: Number(tramo.id),
        })
        assert.equal(await montoVistaPrevia(client, token, e.servicioId), '199.00')

        await generar(e.servicioId, '2026-09-01')
        const [factura] = await facturasDe(e.servicioId)
        assert.equal(factura!.total, '199.00')
        // IVA incluido: 199 / 1.12 = 177.68; IVA 21.32
        assert.equal(factura!.subtotal, '177.68')
        assert.equal(factura!.iva, '21.32')
        const snap = await snapshot(factura!.id)
        assert.equal(snap.precio, '199.00')
        assert.equal(Number(snap.plan_id), e.planId)
        assert.deepEqual(snap.promocion_velocidad, {
            promocion_id: Number(promo.id),
            tramo_id: Number(tramo.id),
        })
        await afirmarLibroCuadrado(assert)

        // al cerrar el tramo vuelve el costo_override
        await ejecutarCronCore('promociones_velocidad', new Date(fin.getTime() + 60_000))
        assert.equal(await leerPrecioEfectivo(db.connection(), e.servicioId), '120.00')
        await generar(e.servicioId, '2026-10-01')
        const facturas = await facturasDe(e.servicioId)
        assert.deepEqual(
            facturas.map((f) => f.total),
            ['199.00', '120.00'],
        )
        await afirmarLibroCuadrado(assert)
    })
})
