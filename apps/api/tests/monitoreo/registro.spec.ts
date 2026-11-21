import { test } from '@japa/runner'
import { randomUUID } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { estado, usuarioConRoles } from '#tests/ayudas'
import { fijarFuentesSalud } from '#monitoreo/salud'
import { enmascararTexto, registroSistema, type EntradaRegistro } from '#monitoreo/registro'

/** Registro del sistema (`GET /api/v1/sistema/registro`, contrato `salud.md` §3). */

const nunca = () => new Promise<never>(() => {})

/** Siembra una fila de cada fuente con una marca propia en el `request_id` o el payload. */
async function sembrar(marca: string) {
    const hace = (s: number) => new Date(Date.now() - s * 1000)
    await db.table('audit.acciones').multiInsert([
        {
            actor_tipo: 'sistema',
            canal: 'cron',
            accion: 'facturas.generar',
            resultado: 'error',
            error: `connect ECONNREFUSED · password=superSecreta123 token: atk_abcdefghijk ${marca}`,
            request_id: `${marca}-1`,
            entidad_tipo: 'factura',
            entidad_id: 99,
            created_at: hace(50),
        },
        {
            actor_tipo: 'usuario',
            canal: 'api',
            accion: 'libro.bloquear',
            resultado: 'error',
            error: `E_REGLA_NEGOCIO: periodo cerrado ${marca}`,
            request_id: `${marca}-2`,
            created_at: hace(40),
        },
        {
            actor_tipo: 'usuario',
            canal: 'api',
            accion: 'clientes.crear',
            resultado: 'ok',
            request_id: `${marca}-ok`,
            created_at: hace(30),
        },
    ])
    await db.table('audit.red').insert({
        tipo: 'routeros',
        comando: JSON.stringify({
            operacion: 'aplicar',
            ruta: '/ppp/secret',
            password: 'nunca-visible',
            request_id: `${marca}-3`,
        }),
        respuesta: JSON.stringify({ error: `timeout ${marca}`, secret: 'x' }),
        ok: false,
        created_at: hace(20),
    })
    await db.table('audit.outbox').multiInsert([
        {
            evento: 'coa.fallido',
            payload: JSON.stringify({
                servicio_id: 7,
                nas_ip: '10.0.0.1',
                tipo: 'disconnect',
                error: `NAK ${marca}`,
            }),
            request_id: `${marca}-4`,
            created_at: hace(10),
        },
        {
            evento: 'aaa.recuperado',
            payload: JSON.stringify({ nodo: marca, hasta: new Date().toISOString() }),
            request_id: `${marca}-5`,
            created_at: hace(5),
        },
        // otro evento del catálogo: no es operativo, no sale
        {
            evento: 'cliente.actualizado',
            payload: JSON.stringify({ cliente_id: 1, campos: [] }),
            request_id: `${marca}-6`,
            created_at: hace(4),
        },
    ])
}

function propias(data: EntradaRegistro[], marca: string) {
    return data.filter(
        (e) =>
            e.request_id?.startsWith(marca) || (e.detalle ?? '').includes(marca) || e.titulo.includes(marca),
    )
}

/** Recorre todas las páginas con el filtro dado. */
async function todas(consulta: Parameters<typeof registroSistema>[0]) {
    const salida: EntradaRegistro[] = []
    let cursor: string | undefined
    for (let i = 0; i < 100; i++) {
        const pagina = await registroSistema({ ...consulta, cursor })
        salida.push(...pagina.data)
        if (!pagina.nextCursor) break
        cursor = pagina.nextCursor
    }
    return salida
}

test.group('monitoreo · registro del sistema', (group) => {
    group.each.setup(() => {
        // sin Redis en estas pruebas: el registro sale sin los jobs y no falla
        fijarFuentesSalud({
            colas: () => new Map([['notify-envios', { getJobCounts: nunca, getFailed: nunca }]]),
        })
        return () => fijarFuentesSalud()
    })

    test('fuentes, niveles, orígenes, orden y sin secretos', async ({ client, assert }) => {
        const marca = `reg-${randomUUID().slice(0, 8)}`
        await sembrar(marca)
        const { token } = await usuarioConRoles(['admin'])
        const r = await estado(client.get('/api/v1/sistema/registro?limit=100').bearerToken(token), 200)
        const filas = propias(r.body().data, marca)
        assert.lengthOf(filas, 5)
        // del más nuevo al más viejo
        const momentos = filas.map((f) => f.momento)
        assert.deepEqual(momentos, [...momentos].sort().reverse())

        const [recuperado, coa, red, libro, accion] = filas
        assert.include(recuperado, { nivel: 'info', origen: 'radius' })
        assert.include(recuperado!.titulo, 'volvió a responder')
        assert.include(coa, { nivel: 'error', origen: 'coa', titulo: 'Falló un Disconnect' })
        assert.deepEqual(coa!.entidad, { tipo: 'servicio', id: '7' })
        assert.include(red, { nivel: 'error', origen: 'red' })
        assert.include(red!.detalle ?? '', '/ppp/secret')
        assert.include(libro, { nivel: 'advertencia', origen: 'contabilidad' })
        assert.include(accion, { nivel: 'error', origen: 'api' })
        assert.deepEqual(accion!.entidad, { tipo: 'factura', id: '99' })
        assert.match(accion!.id, /^accion:\d+$/)

        const texto = JSON.stringify(filas)
        for (const secreto of ['superSecreta123', 'atk_abcdefghijk', 'nunca-visible']) {
            assert.notInclude(texto, secreto)
        }
        assert.include(accion!.detalle ?? '', 'password=***')
    })

    test('filtros nivel y origen; paginación por cursor estable aunque lleguen filas nuevas', async ({
        assert,
    }) => {
        const marca = `reg-${randomUUID().slice(0, 8)}`
        await sembrar(marca)
        const errores = propias(await todas({ nivel: 'error', limit: 2 }), marca)
        assert.lengthOf(errores, 3)
        assert.isTrue(errores.every((e) => e.nivel === 'error'))
        const radius = propias(await todas({ origen: 'radius' }), marca)
        assert.lengthOf(radius, 1)

        // página 1 de 2 filas, luego llega una nueva: la página 2 sigue donde iba, sin repetir
        const p1 = await registroSistema({ limit: 2 })
        await db.table('audit.outbox').insert({
            evento: 'coa.fallido',
            payload: JSON.stringify({ nas_ip: '10.0.0.2', tipo: 'coa', error: `nuevo ${marca}` }),
        })
        const p2 = await registroSistema({ limit: 2, cursor: p1.nextCursor! })
        const ids1 = p1.data.map((e) => e.id)
        for (const e of p2.data) assert.notInclude(ids1, e.id)
        assert.notInclude(
            p2.data.map((e) => e.detalle ?? ''),
            `NAS 10.0.0.2 · nuevo ${marca}`,
        )
    })

    test('validación: cursor inválido, desde de más de 31 días, nivel desconocido → 422', async ({
        client,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        await estado(client.get('/api/v1/sistema/registro?cursor=basura').bearerToken(token), 422)
        const viejo = new Date(Date.now() - 40 * 86_400_000).toISOString()
        await estado(client.get(`/api/v1/sistema/registro?desde=${viejo}`).bearerToken(token), 422)
        await estado(client.get('/api/v1/sistema/registro?nivel=critico').bearerToken(token), 422)
    })

    test('jobs fallidos de las colas entran con origen colas', async ({ assert }) => {
        const marca = `job-${randomUUID().slice(0, 8)}`
        fijarFuentesSalud({
            colas: () =>
                new Map([
                    [
                        'notify-envios',
                        {
                            getJobCounts: async () => ({}),
                            getFailed: async () => [
                                {
                                    id: '1',
                                    name: 'envio',
                                    failedReason: `SMTP caído password=x ${marca}`,
                                    finishedOn: Date.now(),
                                    timestamp: Date.now(),
                                },
                            ],
                        },
                    ],
                ]),
        })
        const pagina = await registroSistema({ origen: 'colas' })
        const job = pagina.data.find((e) => (e.detalle ?? '').includes(marca))
        assert.exists(job)
        assert.include(job!, { id: 'job:notify-envios:1', nivel: 'error', origen: 'colas' })
        assert.include(job!.detalle ?? '', 'password=***')
    })

    test('enmascararTexto: pares clave=valor y tokens', ({ assert }) => {
        assert.equal(enmascararTexto('radius_secret="abc def" ok'), 'radius_secret=*** ok')
        assert.equal(enmascararTexto('Authorization: Bearer abc.def.ghi'), 'Authorization: Bearer ***')
        assert.equal(enmascararTexto('contraseña: hola'), 'contraseña: ***')
        assert.isNull(enmascararTexto(null))
    })

    test('lectura con los privilegios de la API (argosisp_app)', async ({ assert }) => {
        const marca = `reg-${randomUUID().slice(0, 8)}`
        await sembrar(marca)
        const trx: TransactionClientContract = await db.transaction()
        try {
            await trx.rawQuery('SET LOCAL ROLE argosisp_app')
            const pagina = await registroSistema({ limit: 100 }, trx)
            assert.lengthOf(propias(pagina.data, marca), 5)
        } finally {
            await trx.rollback()
        }
    })

    test('permisos: 403 sin sistema.ver_registro', async ({ client }) => {
        const { token } = await usuarioConRoles(['soporte'])
        await estado(client.get('/api/v1/sistema/registro').bearerToken(token), 403)
    })
})
