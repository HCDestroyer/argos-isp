import { randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { unico } from '#tests/ayudas'
import { crearClienteFila, crearRouterFila, crearServicioFila, ipUnica } from '#tests/core/fabricas'
import type { RegistroAccounting } from '#network/sesiones/registro'
import { procesarAccounting } from '#network/sesiones/cola'
import type { ResultadoAccounting } from '#network/sesiones/sesiones'
import { CAUSAS_IGNORADAS_POR_DEFECTO, configCaidas } from '#network/sesiones/caidas'

/**
 * Caídas repetidas (pedido A6 de Iris): `servicio.caidas_repetidas` por outbox cuando un servicio
 * acumula 3 sesiones terminadas en 60 min (de fábrica, decisión del PM 31; ajustes `caidas.*` por
 * empresa), a lo sumo una vez por ventana,
 * sin contar las causas que provoca Argos o el router entero. Postgres real, accounting por la
 * misma función que usa el worker de BullMQ.
 */

interface Escenario {
    servicioId: number
    clienteId: number
    routerId: number
    nasIp: string
    userPpp: string
}

async function escenario(): Promise<Escenario> {
    const nasIp = ipUnica()
    const routerId = await crearRouterFila({ nas_ip: nasIp })
    const clienteId = await crearClienteFila()
    const userPpp = unico('ppp')
    const servicioId = await crearServicioFila({
        cliente_id: clienteId,
        router_id: routerId,
        user_ppp: userPpp,
    })
    return { servicioId, clienteId, routerId, nasIp, userPpp }
}

/** Stop de una sesión de 60 s que terminó `minuto` minutos después de `base`. */
function stop(e: Escenario, base: Date, minuto: number, causa = 'Lost-Carrier'): RegistroAccounting {
    return {
        tipo: 'Stop',
        nas_ip: e.nasIp,
        acct_session_id: unico('ses'),
        user_ppp: e.userPpp,
        ipv4: '10.10.1.10',
        prefijo_enlace_v6: null,
        prefijo_delegado_v6: null,
        bytes_in: '100',
        bytes_out: '200',
        duracion_s: 60,
        causa_fin: causa,
        evento_en: new Date(base.getTime() + minuto * 60_000).toISOString(),
    }
}

const avisos = (servicioId: number) =>
    db
        .from('audit.outbox')
        .where('evento', 'servicio.caidas_repetidas')
        .whereRaw(`(payload->>'servicio_id')::bigint = ?`, [servicioId])
        .orderBy('id')

/** Base 10 h atrás: todas las sesiones de la prueba quedan en el pasado. */
const haceDiezHoras = () => new Date(Date.now() - 10 * 3_600_000)

test.group('network · caídas repetidas', (group) => {
    group.each.setup(async () => {
        await db.from('core.ajustes_operacion').delete()
    })
    group.teardown(async () => {
        await db.from('core.ajustes_operacion').delete()
    })

    test('valores de fábrica: 3 sesiones en 60 min, causas de Argos y del router ignoradas', async ({
        assert,
    }) => {
        assert.deepEqual(await configCaidas(), {
            umbral: 3,
            ventanaMinutos: 60,
            causasIgnoradas: [...CAUSAS_IGNORADAS_POR_DEFECTO],
        })
    })

    test('la tercera caída en la ventana emite servicio.caidas_repetidas una vez, con su fila', async ({
        assert,
    }) => {
        const e = await escenario()
        const base = haceDiezHoras()
        for (const [i, minuto] of [0, 15].entries()) {
            const r = (await procesarAccounting(
                stop(e, base, minuto, i === 1 ? 'User-Request' : 'Lost-Carrier'),
                randomUUID(),
            )) as ResultadoAccounting
            assert.deepEqual(r.eventos, ['sesion.terminada'])
        }
        assert.lengthOf(await avisos(e.servicioId), 0)

        const quinta = stop(e, base, 30, 'Sesion-Reemplazada')
        const r = (await procesarAccounting(quinta, randomUUID())) as ResultadoAccounting
        assert.deepEqual(r.eventos, ['sesion.terminada', 'servicio.caidas_repetidas'])

        const lista = await avisos(e.servicioId)
        assert.lengthOf(lista, 1)
        const servicio = await db.from('core.servicios').where('id', e.servicioId).firstOrFail()
        assert.deepEqual(lista[0].payload, {
            servicio_id: e.servicioId,
            empresa_id: Number(servicio.empresa_id),
            cliente_id: e.clienteId,
            router_id: e.routerId,
            sesion_id: r.sesionId,
            sesiones: 3,
            desde: base.toISOString(),
            hasta: quinta.evento_en,
            umbral: 3,
            ventana_minutos: 60,
            causas: { 'Lost-Carrier': 1, 'Sesion-Reemplazada': 1, 'User-Request': 1 },
        })
        const filas = await db.from('network.caidas_repetidas').where('servicio_id', e.servicioId)
        assert.lengthOf(filas, 1)
        assert.equal(filas[0].sesiones, 3)
        assert.equal(Number(filas[0].sesion_id), r.sesionId)

        // Mismo outbox y misma transacción que la acción auditada que cerró la sesión.
        const accion = await db
            .from('audit.acciones')
            .where('accion', 'sesiones.terminar')
            .where('entidad_id', r.sesionId!)
            .firstOrFail()
        assert.equal(accion.resultado, 'ok')
        assert.equal(lista[0].request_id, accion.request_id)

        // El mismo Stop otra vez (entrega al menos una vez) no repite nada.
        assert.deepInclude(await procesarAccounting(quinta, randomUUID()), {
            efecto: 'ignorada',
            eventos: [],
        })
        assert.lengthOf(await avisos(e.servicioId), 1)
    })

    test('a lo sumo una vez por ventana: más caídas no repiten; pasada la ventana, 3 nuevas sí', async ({
        assert,
    }) => {
        const e = await escenario()
        const base = haceDiezHoras()
        for (const minuto of [0, 10, 20, 30, 40]) {
            await procesarAccounting(stop(e, base, minuto), randomUUID())
        }
        const primero = await avisos(e.servicioId)
        assert.lengthOf(primero, 1, 'una sola vez con 5 caídas en la ventana')
        assert.equal(primero[0].payload.hasta, stop(e, base, 20).evento_en)

        // El aviso terminó en el minuto 20: hasta el minuto 80 su ventana bloquea uno nuevo.
        for (const minuto of [50, 70]) await procesarAccounting(stop(e, base, minuto), randomUUID())
        assert.lengthOf(await avisos(e.servicioId), 1)

        // Minuto 85: la ventana (25, 85] ya no incluye el aviso del minuto 20 y tiene 30, 40, 50, 70 y
        // 85 → segundo aviso.
        await procesarAccounting(stop(e, base, 85), randomUUID())
        const lista = await avisos(e.servicioId)
        assert.lengthOf(lista, 2)
        assert.equal(lista[1].payload.sesiones, 5)
        assert.equal(lista[1].payload.desde, stop(e, base, 30).evento_en)
        assert.isTrue(new Date(lista[1].payload.desde) > new Date(lista[0].payload.hasta))
    })

    test('no cuentan Admin-Reset (Disconnect de Argos), NAS-Reboot ni sin_interim; caídas espaciadas tampoco', async ({
        assert,
    }) => {
        const e = await escenario()
        const base = haceDiezHoras()
        await procesarAccounting(stop(e, base, 0), randomUUID())
        await procesarAccounting(stop(e, base, 5, 'Admin-Reset'), randomUUID())
        await procesarAccounting(stop(e, base, 15, 'NAS-Reboot'), randomUUID())
        await procesarAccounting(stop(e, base, 20), randomUUID())
        await procesarAccounting(stop(e, base, 25, 'sin_interim'), randomUUID())
        assert.lengthOf(await avisos(e.servicioId), 0, '2 caídas que cuentan y 3 ignoradas')

        // Otro servicio: 4 caídas, una cada 40 min: nunca 3 en 60 min.
        const otro = await escenario()
        for (const minuto of [0, 40, 80, 120]) {
            await procesarAccounting(stop(otro, base, minuto), randomUUID())
        }
        assert.lengthOf(await avisos(otro.servicioId), 0)
        assert.lengthOf(await db.from('network.caidas_repetidas').where('servicio_id', otro.servicioId), 0)
    })

    test('ajustes por empresa: umbral propio y apagado', async ({ assert }) => {
        const e = await escenario()
        const servicio = await db.from('core.servicios').where('id', e.servicioId).firstOrFail()
        await db.table('core.ajustes_operacion').insert({
            empresa_id: servicio.empresa_id,
            clave: 'caidas.umbral',
            valor: JSON.stringify(2),
        })
        const base = haceDiezHoras()
        await procesarAccounting(stop(e, base, 0), randomUUID())
        await procesarAccounting(stop(e, base, 5), randomUUID())
        const lista = await avisos(e.servicioId)
        assert.lengthOf(lista, 1)
        assert.equal(lista[0].payload.umbral, 2)

        await db.table('core.ajustes_operacion').insert({
            empresa_id: servicio.empresa_id,
            clave: 'caidas.activo',
            valor: JSON.stringify(false),
        })
        for (const minuto of [200, 205, 210]) await procesarAccounting(stop(e, base, minuto), randomUUID())
        assert.lengthOf(await avisos(e.servicioId), 1)
    })
})
