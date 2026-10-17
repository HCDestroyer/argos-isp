import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, unico } from '#tests/ayudas'
import { crearClienteFila, crearRouterFila, crearServicioFila, ipUnica } from '#tests/core/fabricas'
import type { RegistroAccounting } from '#network/sesiones/registro'
import IniciarSesion from '#network/sesiones/actions/iniciar_sesion'
import ActualizarSesion from '#network/sesiones/actions/actualizar_sesion'
import TerminarSesion from '#network/sesiones/actions/terminar_sesion'
import {
    ejecutarCierreColgadas,
    JOB_CERRAR_COLGADAS,
    programarCronSesiones,
} from '#network/sesiones/colgadas'

/**
 * Semana 3 · tarea 4 de A2: cierre automático de sesiones sin Stop ni Interim-Update en N
 * intervalos (cron con lock), `sesion.terminada` con `motivo: 'sin_interim'`, y lo que pasa si el
 * NAS demuestra después que la sesión seguía viva (Interim) o cuándo terminó (Stop).
 */

const UMBRAL_S = 900 // 3 × 300 s
const MIN = 60_000

interface Escenario {
    servicioId: number
    nasIp: string
    userPpp: string
}

async function escenario(nasIp = ipUnica()): Promise<Escenario> {
    const existente = (await db.from('network.routers').whereRaw('nas_ip = ?::inet', [nasIp]).first()) as {
        id: number
    } | null
    const routerId = existente?.id ?? (await crearRouterFila({ nas_ip: nasIp }))
    const userPpp = unico('ppp')
    const servicioId = await crearServicioFila({
        cliente_id: await crearClienteFila(),
        router_id: routerId,
        user_ppp: userPpp,
        ipv6_modo: 'ninguno',
    })
    return { servicioId, nasIp, userPpp }
}

function registro(e: Escenario, parcial: Partial<RegistroAccounting> = {}): RegistroAccounting {
    return {
        tipo: 'Start',
        nas_ip: e.nasIp,
        acct_session_id: unico('ses'),
        user_ppp: e.userPpp,
        ipv4: '10.10.9.10',
        prefijo_enlace_v6: null,
        prefijo_delegado_v6: null,
        bytes_in: '0',
        bytes_out: '0',
        duracion_s: null,
        causa_fin: null,
        evento_en: new Date().toISOString(),
        ...parcial,
    }
}

/** Abre una sesión y finge que su último accounting fue hace `minutos`. */
async function abrir(e: Escenario, minutos = 0) {
    const r = registro(e)
    const { sesionId } = await new IniciarSesion().execute(r, contextoPrueba())
    const ultimo = new Date(Date.now() - minutos * MIN)
    await db.rawQuery('UPDATE network.sesiones SET inicio = ?, updated_at = ? WHERE id = ?', [
        new Date(ultimo.getTime() - 60 * MIN),
        ultimo,
        sesionId!,
    ])
    return { id: sesionId!, acctSessionId: r.acct_session_id, ultimo }
}

async function fila(id: number) {
    return (await db.from('network.sesiones').where('id', id).first()) as {
        fin: Date | null
        causa_fin: string | null
        bytes_in: string
    }
}

async function finDe(id: number) {
    const f = await fila(id)
    return f.fin
}

async function causaDe(id: number) {
    const f = await fila(id)
    return f.causa_fin
}

async function nombres(acctSessionId: string) {
    const lista = await eventos(acctSessionId)
    return lista.map((x) => x.evento as string)
}

async function eventos(acctSessionId: string) {
    return db
        .from('audit.outbox')
        .whereIn('evento', ['sesion.iniciada', 'sesion.terminada'])
        .whereRaw("payload->>'acct_session_id' = ?", [acctSessionId])
        .orderBy('id')
        .select('evento', 'payload')
}

async function auditoriasCron(desde: Date) {
    return db
        .from('audit.acciones')
        .where('accion', 'sesiones.cerrar_colgadas')
        .where('created_at', '>=', desde)
        .orderBy('id')
        .select('resultado', 'canal', 'entrada', 'request_id')
}

test.group('network · sesiones colgadas (semana 3, tarea 4)', () => {
    test('cierra las abiertas sin accounting en N intervalos con sin_interim y emite sesion.terminada', async ({
        assert,
    }) => {
        const inicioPrueba = new Date(Date.now() - 1000)
        const viva = await escenario()
        const colgada = await escenario(viva.nasIp)
        const sv = await abrir(viva, 2) // Interim hace 2 min: el NAS sigue mandando accounting
        const sc = await abrir(colgada, 20) // 20 min > 15 min

        const r = await ejecutarCierreColgadas({ umbralS: UMBRAL_S })
        assert.isFalse(r.omitido)
        assert.include(r.cerradas, sc.id)
        assert.notInclude(r.cerradas, sv.id)

        const f = await fila(sc.id)
        assert.equal(f.causa_fin, 'sin_interim')
        // fin = último accounting, no la hora del cron
        assert.equal(new Date(f.fin!).getTime(), sc.ultimo.getTime())
        assert.isNull(await finDe(sv.id))

        const ev = await eventos(sc.acctSessionId)
        assert.deepEqual(
            ev.map((x) => x.evento),
            ['sesion.iniciada', 'sesion.terminada'],
        )
        assert.include(ev[1]!.payload, {
            servicio_id: colgada.servicioId,
            nas_ip: colgada.nasIp,
            acct_session_id: sc.acctSessionId,
            motivo: 'sin_interim',
        })

        const audit = await auditoriasCron(inicioPrueba)
        assert.lengthOf(audit, 1)
        assert.include(audit[0], { resultado: 'ok', canal: 'cron' })
        assert.equal(audit[0]!.entrada.umbral_s, UMBRAL_S)
        const cambio = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'sesion', entidad_id: sc.id, campo: 'causa_fin' })
            .select('antes', 'despues', 'request_id')
            .first()
        assert.deepEqual(cambio, { antes: null, despues: 'sin_interim', request_id: audit[0]!.request_id })

        // Idempotente: una segunda corrida no cierra nada, no emite ni deja auditoría.
        const otra = await ejecutarCierreColgadas({ umbralS: UMBRAL_S })
        assert.notInclude(otra.cerradas, sc.id)
        assert.lengthOf(await eventos(sc.acctSessionId), 2)
        assert.lengthOf(await auditoriasCron(inicioPrueba), otra.cerradas.length > 0 ? 2 : 1)
    })

    test('no cierra nada de un NAS que no manda accounting (aaa o worker caídos)', async ({ assert }) => {
        const e = await escenario()
        const otra = await escenario(e.nasIp)
        const a = await abrir(e, 30)
        const b = await abrir(otra, 40)
        const r = await ejecutarCierreColgadas({ umbralS: UMBRAL_S })
        assert.notInclude(r.cerradas, a.id)
        assert.notInclude(r.cerradas, b.id)
        assert.include(r.nas_silenciosos, e.nasIp)
        assert.isNull(await finDe(a.id))

        // Cuando el NAS vuelve a mandar accounting (un Start nuevo), las colgadas se cierran.
        await abrir(await escenario(e.nasIp), 0)
        const despues = await ejecutarCierreColgadas({ umbralS: UMBRAL_S })
        assert.includeMembers(despues.cerradas, [a.id, b.id])
        assert.notInclude(despues.nas_silenciosos, e.nasIp)
    })

    test('procesa todo lo pendiente por lotes, una auditoría por lote', async ({ assert }) => {
        const inicioPrueba = new Date(Date.now() - 1000)
        const vivo = await escenario()
        await abrir(vivo, 1)
        const ids: number[] = []
        for (let i = 0; i < 5; i++) {
            const s = await abrir(await escenario(vivo.nasIp), 30)
            ids.push(s.id)
        }
        const r = await ejecutarCierreColgadas({ umbralS: UMBRAL_S, lote: 2 })
        assert.includeMembers(r.cerradas, ids)
        assert.isAtLeast(r.lotes, 3)
        const audit = await auditoriasCron(inicioPrueba)
        assert.isAtLeast(audit.length, 3)
        for (const id of ids) assert.equal(await causaDe(id), 'sin_interim')
    })

    test('con el lock tomado por otra réplica, la corrida se omite', async ({ assert }) => {
        const vivo = await escenario()
        await abrir(vivo, 1)
        const colgada = await abrir(await escenario(vivo.nasIp), 30)

        let soltar!: () => void
        const liberado = new Promise<void>((r) => (soltar = r))
        let tomado!: () => void
        const lockTomado = new Promise<void>((r) => (tomado = r))
        const otra = db.transaction(async (trx) => {
            await trx.rawQuery("SELECT pg_advisory_xact_lock(4104, hashtext('cerrar_colgadas'))")
            tomado()
            await liberado
        })
        await lockTomado
        const r = await ejecutarCierreColgadas({ umbralS: UMBRAL_S })
        assert.isTrue(r.omitido)
        assert.isNull(await finDe(colgada.id))
        soltar()
        await otra

        const r2 = await ejecutarCierreColgadas({ umbralS: UMBRAL_S })
        assert.isFalse(r2.omitido)
        assert.include(r2.cerradas, colgada.id)
    })

    test('un Interim posterior reabre la sesión cerrada por sin_interim y emite sesion.iniciada', async ({
        assert,
    }) => {
        const vivo = await escenario()
        await abrir(vivo, 1)
        const e = await escenario(vivo.nasIp)
        const s = await abrir(e, 30)
        await ejecutarCierreColgadas({ umbralS: UMBRAL_S })
        assert.equal(await causaDe(s.id), 'sin_interim')

        const r = await new ActualizarSesion().execute(
            registro(e, {
                tipo: 'Interim-Update',
                acct_session_id: s.acctSessionId,
                bytes_in: '5000',
                duracion_s: 3600,
            }),
            contextoPrueba(),
        )
        assert.include(r, { sesionId: s.id, efecto: 'reabierta' })
        const f = await fila(s.id)
        assert.isNull(f.fin)
        assert.isNull(f.causa_fin)
        assert.equal(f.bytes_in, '5000')
        assert.deepEqual(await nombres(s.acctSessionId), [
            'sesion.iniciada',
            'sesion.terminada',
            'sesion.iniciada',
        ])
        const cambios = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'sesion', entidad_id: s.id })
            .whereIn('campo', ['fin', 'causa_fin'])
            .orderBy('id')
            .select('campo', 'antes', 'despues')
        assert.deepEqual(
            cambios.findLast((c) => c.campo === 'causa_fin'),
            {
                campo: 'causa_fin',
                antes: 'sin_interim',
                despues: null,
            },
        )
    })

    test('no reabre si el usuario ya tiene otra sesión abierta, ni si la cerró el NAS', async ({
        assert,
    }) => {
        const vivo = await escenario()
        await abrir(vivo, 1)
        const e = await escenario(vivo.nasIp)
        const vieja = await abrir(e, 30)
        await ejecutarCierreColgadas({ umbralS: UMBRAL_S })
        await abrir(e, 0) // reconectó con otra sesión
        const r = await new ActualizarSesion().execute(
            registro(e, { tipo: 'Interim-Update', acct_session_id: vieja.acctSessionId }),
            contextoPrueba(),
        )
        assert.equal(r.efecto, 'ignorada')
        assert.equal(await causaDe(vieja.id), 'sin_interim')

        // Cerrada por Stop del NAS: un Interim tardío sigue sin reabrirla (regla de siempre).
        const otra = await escenario(vivo.nasIp)
        const s = await abrir(otra, 0)
        await new TerminarSesion().execute(
            registro(otra, { tipo: 'Stop', acct_session_id: s.acctSessionId, causa_fin: 'User-Request' }),
            contextoPrueba(),
        )
        const tarde = await new ActualizarSesion().execute(
            registro(otra, {
                tipo: 'Interim-Update',
                acct_session_id: s.acctSessionId,
                evento_en: new Date(Date.now() + 1000).toISOString(),
            }),
            contextoPrueba(),
        )
        assert.equal(tarde.efecto, 'ignorada')
    })

    test('un Stop posterior corrige fin y causa sin repetir sesion.terminada', async ({ assert }) => {
        const vivo = await escenario()
        await abrir(vivo, 1)
        const e = await escenario(vivo.nasIp)
        const s = await abrir(e, 30)
        await ejecutarCierreColgadas({ umbralS: UMBRAL_S })

        const finReal = new Date(s.ultimo.getTime() + 2 * MIN)
        const r = await new TerminarSesion().execute(
            registro(e, {
                tipo: 'Stop',
                acct_session_id: s.acctSessionId,
                causa_fin: 'Lost-Carrier',
                bytes_in: '9000',
                evento_en: finReal.toISOString(),
            }),
            contextoPrueba(),
        )
        assert.include(r, { efecto: 'corregida' })
        const f = await fila(s.id)
        assert.equal(f.causa_fin, 'Lost-Carrier')
        assert.equal(new Date(f.fin!).getTime(), finReal.getTime())
        assert.equal(f.bytes_in, '9000')
        assert.deepEqual(await nombres(s.acctSessionId), ['sesion.iniciada', 'sesion.terminada'])
    })

    test('el job repetible se programa en sesiones-cron y se quita con cada 0', async ({ assert }) => {
        const prefijo = unico('ciprueba-colgadas')
        const cola = await programarCronSesiones({ prefijo, cadaMs: 60_000 })
        try {
            const programados = await cola.getJobSchedulers()
            assert.deepEqual(
                programados.map((p) => [p.key, p.every]),
                [[JOB_CERRAR_COLGADAS, 60_000]],
            )
            const quitada = await programarCronSesiones({ prefijo, cadaMs: 0 })
            await quitada.close()
            assert.lengthOf(await cola.getJobSchedulers(), 0)
        } finally {
            await cola.obliterate({ force: true })
            await cola.close()
        }
    })
})
