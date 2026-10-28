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
 * acumula 5 sesiones terminadas en 120 min (valores por defecto), a lo sumo una vez por ventana,
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

test.group('network · caídas repetidas', () => {
    test('valores por defecto: 5 sesiones en 120 min, causas de Argos y del router ignoradas', ({
        assert,
    }) => {
        assert.deepEqual(configCaidas(), {
            umbral: 5,
            ventanaMinutos: 120,
            causasIgnoradas: [...CAUSAS_IGNORADAS_POR_DEFECTO],
        })
    })

    test('la quinta caída en la ventana emite servicio.caidas_repetidas una vez, con su fila', async ({
        assert,
    }) => {
        const e = await escenario()
        const base = haceDiezHoras()
        for (const [i, minuto] of [0, 15, 30, 45].entries()) {
            const r = (await procesarAccounting(
                stop(e, base, minuto, i === 1 ? 'User-Request' : 'Lost-Carrier'),
                randomUUID(),
            )) as ResultadoAccounting
            assert.deepEqual(r.eventos, ['sesion.terminada'])
        }
        assert.lengthOf(await avisos(e.servicioId), 0)

        const quinta = stop(e, base, 60, 'Sesion-Reemplazada')
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
            sesiones: 5,
            desde: base.toISOString(),
            hasta: quinta.evento_en,
            umbral: 5,
            ventana_minutos: 120,
            causas: { 'Lost-Carrier': 3, 'Sesion-Reemplazada': 1, 'User-Request': 1 },
        })
        const filas = await db.from('network.caidas_repetidas').where('servicio_id', e.servicioId)
        assert.lengthOf(filas, 1)
        assert.equal(filas[0].sesiones, 5)
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

    test('a lo sumo una vez por ventana: más caídas no repiten; pasada la ventana, 5 nuevas sí', async ({
        assert,
    }) => {
        const e = await escenario()
        const base = haceDiezHoras()
        for (const minuto of [0, 10, 20, 30, 40, 50, 60, 70]) {
            await procesarAccounting(stop(e, base, minuto), randomUUID())
        }
        const primero = await avisos(e.servicioId)
        assert.lengthOf(primero, 1, 'una sola vez con 8 caídas en la ventana')
        assert.equal(primero[0].payload.hasta, stop(e, base, 40).evento_en)

        // El aviso terminó en el minuto 40: hasta el minuto 160 su ventana bloquea uno nuevo.
        for (const minuto of [100, 130, 150]) await procesarAccounting(stop(e, base, minuto), randomUUID())
        assert.lengthOf(await avisos(e.servicioId), 1)

        // Minuto 165: la ventana (45, 165] ya no incluye el aviso del minuto 40 y tiene 50, 60, 70,
        // 100, 130, 150 y 165 → segundo aviso.
        await procesarAccounting(stop(e, base, 165), randomUUID())
        const lista = await avisos(e.servicioId)
        assert.lengthOf(lista, 2)
        assert.equal(lista[1].payload.sesiones, 7)
        assert.equal(lista[1].payload.desde, stop(e, base, 50).evento_en)
        assert.isTrue(new Date(lista[1].payload.desde) > new Date(lista[0].payload.hasta))
    })

    test('no cuentan Admin-Reset (Disconnect de Argos), NAS-Reboot ni sin_interim; caídas espaciadas tampoco', async ({
        assert,
    }) => {
        const e = await escenario()
        const base = haceDiezHoras()
        await procesarAccounting(stop(e, base, 0), randomUUID())
        await procesarAccounting(stop(e, base, 5, 'Admin-Reset'), randomUUID())
        await procesarAccounting(stop(e, base, 10), randomUUID())
        await procesarAccounting(stop(e, base, 15, 'NAS-Reboot'), randomUUID())
        await procesarAccounting(stop(e, base, 20), randomUUID())
        await procesarAccounting(stop(e, base, 25, 'sin_interim'), randomUUID())
        await procesarAccounting(stop(e, base, 30), randomUUID())
        assert.lengthOf(await avisos(e.servicioId), 0, '4 caídas que cuentan y 3 ignoradas')

        // Otro servicio: 5 caídas, una cada 40 min (160 min): nunca 5 en 120 min.
        const otro = await escenario()
        for (const minuto of [0, 40, 80, 120, 160]) {
            await procesarAccounting(stop(otro, base, minuto), randomUUID())
        }
        assert.lengthOf(await avisos(otro.servicioId), 0)
        assert.lengthOf(await db.from('network.caidas_repetidas').where('servicio_id', otro.servicioId), 0)
    })
})
