import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import { cifrar, claveDesdeTexto } from '#shared/cifrado'
import { contextoPrueba, unico } from '#tests/ayudas'
import { crearClienteFila, crearRouterFila, crearServicioFila, ipUnica } from '#tests/core/fabricas'
import type { RegistroAccounting } from '#network/sesiones/registro'
import IniciarSesion from '#network/sesiones/actions/iniciar_sesion'
import ActualizarSesion from '#network/sesiones/actions/actualizar_sesion'
import TerminarSesion from '#network/sesiones/actions/terminar_sesion'
import CerrarSesionesNas from '#network/sesiones/actions/cerrar_sesiones_nas'
import { contactoRouterOS, reiniciarContactos } from '#network/sesiones/contacto'
import { RouterOSFalso } from '#network/routeros/falso'
import { clienteDeRouter } from '#network/routeros/router'
import { bitacoraRed, type OpcionesDispatcher } from '#network/routeros/dispatcher'
import { routerDispatcher } from '#network/routeros/consultas'
import { cronsRouterOS, ejecutarCronRouterOS } from '#network/routeros/jobs'
import SondearRouters, { type ResultadoSondear } from '#network/routeros/actions/sondear_routers'

/**
 * Fuentes del contacto de los routers (`Router.en_linea`, fila 70 de `.claude/integration/a1.md`):
 * accounting de cada NAS, respuestas 2xx de la API REST y el sondeo periódico. Postgres real y el
 * RouterOS falso.
 */

async function contacto(routerId: number) {
    return db.from('network.routers_contacto').where('router_id', routerId).first() as Promise<{
        ultimo_contacto: Date
        fuente: string
        updated_at: Date
    } | null>
}

async function nas() {
    const nasIp = ipUnica()
    const routerId = await crearRouterFila({ nas_ip: nasIp })
    const clienteId = await crearClienteFila()
    const userPpp = unico('ppp')
    await crearServicioFila({ cliente_id: clienteId, router_id: routerId, user_ppp: userPpp })
    return { routerId, nasIp, userPpp }
}

function registro(
    e: { nasIp: string; userPpp: string },
    parcial: Partial<RegistroAccounting> = {},
): RegistroAccounting {
    return {
        tipo: 'Start',
        nas_ip: e.nasIp,
        acct_session_id: unico('ses'),
        user_ppp: e.userPpp,
        ipv4: null,
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

const ctx = () => contextoPrueba()

test.group('Contacto de routers · accounting', (group) => {
    group.each.setup(() => reiniciarContactos())

    test('Start, Interim y Stop anotan el contacto del NAS con el Event-Timestamp', async ({ assert }) => {
        const e = await nas()
        const inicio = new Date(Date.now() - 120_000)
        const r = registro(e, { evento_en: inicio.toISOString() })
        await new IniciarSesion().execute(r, ctx())
        const tras = await contacto(e.routerId)
        assert.equal(tras?.fuente, 'accounting')
        assert.equal(new Date(tras!.ultimo_contacto).getTime(), inicio.getTime())

        // Interim y Stop un minuto después (otro proceso: sin el freno local)
        reiniciarContactos()
        const interim = new Date(inicio.getTime() + 60_000)
        await new ActualizarSesion().execute(
            { ...r, tipo: 'Interim-Update', evento_en: interim.toISOString() },
            ctx(),
        )
        assert.equal(new Date((await contacto(e.routerId))!.ultimo_contacto).getTime(), interim.getTime())

        reiniciarContactos()
        const fin = new Date(inicio.getTime() + 115_000)
        await new TerminarSesion().execute(
            { ...r, tipo: 'Stop', evento_en: fin.toISOString(), causa_fin: 'User-Request' },
            ctx(),
        )
        assert.equal(new Date((await contacto(e.routerId))!.ultimo_contacto).getTime(), fin.getTime())
    })

    test('Interim-Update seguidos del mismo NAS: una sola escritura por minuto', async ({ assert }) => {
        const e = await nas()
        const r = registro(e)
        await new IniciarSesion().execute(r, ctx())
        const primera = await contacto(e.routerId)
        for (let i = 1; i <= 5; i++) {
            const en = new Date(Date.now() + i * 1000).toISOString()
            await new ActualizarSesion().execute({ ...r, tipo: 'Interim-Update', evento_en: en }, ctx())
        }
        const despues = await contacto(e.routerId)
        assert.equal(
            new Date(despues!.updated_at).getTime(),
            new Date(primera!.updated_at).getTime(),
            'el freno de 60 s no tocó la fila',
        )
    })

    test('un Event-Timestamp en el futuro (reloj del NAS adelantado) se recorta a ahora', async ({
        assert,
    }) => {
        const e = await nas()
        const antes = Date.now()
        await new IniciarSesion().execute(
            registro(e, { evento_en: new Date(Date.now() + 3_600_000).toISOString() }),
            ctx(),
        )
        const fila = await contacto(e.routerId)
        assert.isAtMost(new Date(fila!.ultimo_contacto).getTime(), Date.now())
        assert.isAtLeast(new Date(fila!.ultimo_contacto).getTime(), antes - 1000)
    })

    test('Accounting-On anota siempre (reinicio del NAS), aunque haya habido accounting hace poco', async ({
        assert,
    }) => {
        const e = await nas()
        const hace = new Date(Date.now() - 50_000)
        await new IniciarSesion().execute(registro(e, { evento_en: hace.toISOString() }), ctx())
        const ahora = new Date()
        await new CerrarSesionesNas().execute(
            registro(e, {
                tipo: 'Accounting-On',
                acct_session_id: '',
                user_ppp: '',
                evento_en: ahora.toISOString(),
            }),
            ctx(),
        )
        assert.equal(new Date((await contacto(e.routerId))!.ultimo_contacto).getTime(), ahora.getTime())
    })

    test('un NAS que no es de ningún router no escribe nada', async ({ assert }) => {
        const antes = await db.from('network.routers_contacto').count('* as n').first()
        await new CerrarSesionesNas().execute(
            registro({ nasIp: ipUnica(), userPpp: '' }, { tipo: 'Accounting-On', acct_session_id: '' }),
            ctx(),
        )
        const despues = await db.from('network.routers_contacto').count('* as n').first()
        assert.equal(Number(despues?.n), Number(antes?.n))
    })
})

test.group('Contacto de routers · API REST y sondeo', (group) => {
    let falso: RouterOSFalso

    group.setup(async () => {
        falso = new RouterOSFalso()
        await falso.levantar()
        return () => falso.cerrar()
    })
    group.each.setup(() => reiniciarContactos())

    /** Como `fabricaPorDefecto`, contra el falso y con backoff corto. */
    const OPCIONES: OpcionesDispatcher = {
        clientes: (router, op = {}) =>
            clienteDeRouter(router, {
                clave: claveDesdeTexto(env.get('AAA_PPP_KEY')),
                bitacora: bitacoraRed,
                contacto: op.sinContacto ? null : contactoRouterOS,
                timeoutMs: 300,
                reintentos: 0,
                esperaMs: 5,
            }),
    }

    async function routerConApi(conCredenciales = true) {
        const id = await crearRouterFila({ nas_ip: ipUnica() })
        await db
            .from('network.routers')
            .where('id', id)
            .update({
                host: falso.url,
                api_tls_verificar: false,
                ...(conCredenciales
                    ? { api_usuario: falso.usuario, api_password: cifrar(falso.password) }
                    : { api_usuario: null, api_password: null }),
            })
        return id
    }

    async function cliente(id: number) {
        const router = await routerDispatcher(id)
        return OPCIONES.clientes!(router!.api)
    }

    test('una respuesta 2xx del router anota el contacto (fuente routeros); un fallo no', async ({
        assert,
    }) => {
        const id = await routerConApi()
        const c = await cliente(id)
        try {
            await c.listar('/queue/simple')
            const fila = await contacto(id)
            assert.equal(fila?.fuente, 'routeros')
            assert.isAbove(new Date(fila!.ultimo_contacto).getTime(), Date.now() - 10_000)

            const otro = await routerConApi()
            const c2 = await cliente(otro)
            falso.fallar(1, 500)
            await assert.rejects(() => c2.listar('/queue/simple'))
            c2.cerrar()
            assert.isNull(await contacto(otro))
        } finally {
            c.cerrar()
        }
    })

    test('sondeo: responde → fuente sondeo; sin credenciales o con contacto reciente no se sondea', async ({
        assert,
    }) => {
        const sondear = await routerConApi()
        const sinCredenciales = await routerConApi(false)
        const reciente = await routerConApi()
        const c = await cliente(reciente)
        await c.probar()
        c.cerrar()

        const salida = await ejecutarCronRouterOS('sondear', OPCIONES)
        assert.isFalse(salida.omitido)
        const r = salida.resultado![0] as ResultadoSondear
        assert.include(r.respondieron, sondear)
        assert.notInclude(r.sondeados, sinCredenciales)
        assert.notInclude(r.sondeados, reciente)
        const [delSondeo, delReciente] = await Promise.all([contacto(sondear), contacto(reciente)])
        assert.equal(delSondeo?.fuente, 'sondeo')
        assert.isNull(await contacto(sinCredenciales), 'sin credenciales queda sin dato')
        assert.equal(delReciente?.fuente, 'routeros')
    })

    async function filasAuditoria(requestId: string) {
        return db.from('audit.acciones').where('accion', 'routeros.sondear').where('request_id', requestId)
    }

    async function filasRed(routerId: number) {
        return db
            .from('audit.red')
            .where('router_id', routerId)
            .whereRaw("comando->>'operacion' = 'sondear'")
            .orderBy('created_at')
    }

    test('sondeo sin fallos: no deja fila en audit.acciones; cada GET queda en audit.red', async ({
        assert,
    }) => {
        const a = await routerConApi()
        const b = await routerConApi()
        const c = ctx()
        const salida = await new SondearRouters(OPCIONES).execute(
            { sin_contacto_desde_s: 300, router_ids: [a, b] },
            c,
        )
        assert.deepEqual(salida.respondieron, [a, b])
        assert.lengthOf(await filasAuditoria(c.requestId), 0, 'corrida sin fallos: sin fila (regla 9)')
        for (const id of [a, b]) {
            const red = await filasRed(id)
            assert.lengthOf(red, 1)
            assert.isTrue(red[0].ok)
            assert.equal(red[0].tipo, 'routeros')
            assert.isNull(red[0].servicio_id)
            assert.include(red[0].comando, {
                metodo: 'GET',
                ruta: '/system/resource',
                request_id: c.requestId,
            })
            assert.equal(red[0].respuesta.status, 200)
        }
    })

    test('sondeo con un router que no responde: deja fila en audit.acciones y el GET fallido en audit.red', async ({
        assert,
    }) => {
        const bueno = await routerConApi()
        const malo = await routerConApi()
        // Puerto cerrado: conexión rechazada al instante
        await db.from('network.routers').where('id', malo).update({ host: 'http://127.0.0.1:1' })
        const c = ctx()
        const salida = await new SondearRouters(OPCIONES).execute(
            { sin_contacto_desde_s: 300, router_ids: [bueno, malo] },
            c,
        )
        assert.deepEqual(salida.respondieron, [bueno])
        assert.deepEqual(
            salida.sin_respuesta.map((s) => s.router_id),
            [malo],
        )
        const auditoria = await filasAuditoria(c.requestId)
        assert.lengthOf(auditoria, 1)
        assert.equal(auditoria[0].resultado, 'ok')
        const [redMalo, redBueno] = await Promise.all([filasRed(malo), filasRed(bueno)])
        assert.lengthOf(redMalo, 1)
        assert.isFalse(redMalo[0].ok)
        assert.isString(redMalo[0].respuesta.error)
        assert.lengthOf(redBueno, 1)
        assert.isTrue(redBueno[0].ok)
        assert.isNull(await contacto(malo))
    })

    test('sondeo: router caído → sin_respuesta y no escribe', async ({ assert }) => {
        const id = await routerConApi()
        await falso.caer()
        try {
            const salida = await ejecutarCronRouterOS('sondear', OPCIONES)
            const r = salida.resultado![0] as ResultadoSondear
            assert.include(
                r.sin_respuesta.map((s) => s.router_id),
                id,
            )
            assert.isNull(await contacto(id))
        } finally {
            await falso.levantar()
        }
    })

    test('sondeo con lock: si otra instancia lo tiene, se omite', async ({ assert }) => {
        await db.transaction(async (trx) => {
            await trx.rawQuery('SELECT pg_advisory_xact_lock(4103, hashtext(?))', ['sondear'])
            const salida = await ejecutarCronRouterOS('sondear', OPCIONES)
            assert.isTrue(salida.omitido)
        })
    })

    test('el cron sondear se programa cada AAA_INTERIM_SEGUNDOS por defecto', ({ assert }) => {
        assert.equal(cronsRouterOS().sondear, (env.get('AAA_INTERIM_SEGUNDOS') ?? 300) * 1000)
    })
})
