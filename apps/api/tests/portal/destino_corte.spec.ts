import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { cifrar, claveDesdeTexto } from '#shared/cifrado'
import env from '#start/env'
import { contextoPrueba, estado, soloEmpresaPrincipal, unico, usuarioConRoles } from '#tests/ayudas'
import { crearEscenarioRouter } from '#tests/core/fabricas'
import { crearServicio, crearSesion } from '#tests/portal/ayudas_portal'
import { RouterOSFalso } from '#network/routeros/falso'
import { clienteDeRouter } from '#network/routeros/router'
import ReconciliarRouterOS from '#network/routeros/actions/reconciliar_router'
import { ConsumidorRouterOS } from '#network/routeros/consumidor'
import { bitacoraRed, type OpcionesDispatcher } from '#network/routeros/dispatcher'

/**
 * URL de corte por empresa (`empresas.url_corte`, pedido del PM; `contratos/control-velocidad.md` §10.6):
 * se edita con `empresas.editar` (validada `http(s)://`), emite `portal.config_cambiada`, su host entra en
 * el walled garden (`argos-walled`) de los routers y `GET /portal/destino-corte` la devuelve para la IP
 * de un servicio de esa empresa (el portal responde 302 a ella).
 */

const URL_OPERADOR = 'https://pagos.isp.example/corte'

const OPCIONES: OpcionesDispatcher = {
    clientes: (router) =>
        clienteDeRouter(router, {
            clave: claveDesdeTexto(env.get('AAA_PPP_KEY')),
            bitacora: bitacoraRed,
            timeoutMs: 500,
            reintentos: 1,
            esperaMs: 5,
        }),
}

async function fijarUrl(client: any, token: string, id: number, url: string | null, status = 200) {
    const actual = await estado(client.get(`/api/v1/empresas/${id}`).bearerToken(token), 200)
    return estado(
        client
            .put(`/api/v1/empresas/${id}`)
            .bearerToken(token)
            .json({ version: actual.body().version, url_corte: url }),
        status,
    )
}

/** NIT válido (módulo 11) al azar, como en `tests/core/empresas.spec.ts`. */
function nitAleatorio(): string {
    const cuerpo = String(Math.floor(1_000_000 + Math.random() * 8_999_999))
    let factor = cuerpo.length + 1
    let total = 0
    for (const c of cuerpo) {
        total += Number(c) * factor
        factor--
    }
    const modulo = (11 - (total % 11)) % 11
    return `${cuerpo}${modulo === 10 ? 'K' : modulo}`
}

/** Empresa propia de la prueba (no se toca la 1: otras pruebas esperan su versión 0). */
async function crearEmpresa(client: any, token: string): Promise<number> {
    const nit = nitAleatorio()
    const r = await estado(
        client
            .post('/api/v1/empresas')
            .bearerToken(token)
            .json({
                nit: `${nit.slice(0, -1)}-${nit.slice(-1)}`,
                razon_social: 'Cable del Sur, S.A.',
                nombre_comercial: unico('Sur'),
            }),
        201,
    )
    return Number(r.body().id)
}

test.group('Portal: URL de corte por empresa', (group) => {
    group.each.setup(() => {
        const previo = process.env.PORTAL_PROXIES_CONFIABLES
        process.env.PORTAL_PROXIES_CONFIABLES = '127.0.0.1/32, ::1'
        process.env.PORTAL_REDIS_PREFIJO = unico('prueba-destino-corte')
        return async () => {
            await db.from('core.empresas').update({ url_corte: null })
            // La empresa de la prueba no queda activa: las demás pruebas son de una sola empresa.
            await soloEmpresaPrincipal()
            delete process.env.PORTAL_REDIS_PREFIJO
            if (previo === undefined) delete process.env.PORTAL_PROXIES_CONFIABLES
            else process.env.PORTAL_PROXIES_CONFIABLES = previo
        }
    })

    test('empresas.editar: valida http(s)://, emite portal.config_cambiada solo si cambia', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const id = await crearEmpresa(client, token)
        const malo = await fijarUrl(client, token, id, 'ftp://pagos.isp.example', 422)
        assert.equal(malo.body().errors[0].field, 'url_corte')
        await fijarUrl(client, token, id, 'javascript:alert(1)', 422)

        const r = await fijarUrl(client, token, id, URL_OPERADOR)
        assert.equal(r.body().url_corte, URL_OPERADOR)
        const eventos = () =>
            db
                .from('audit.outbox')
                .where('evento', 'portal.config_cambiada')
                .whereRaw(`payload->>'empresa_id' = ?`, [String(id)])
        const primeros = await eventos()
        assert.lengthOf(primeros, 1)
        assert.deepEqual(primeros[0].payload, { empresa_id: id, campos: ['url_corte'] })
        // Sin cambio: sin evento; borrarla: otro evento
        await fijarUrl(client, token, id, URL_OPERADOR)
        assert.lengthOf(await eventos(), 1)
        await fijarUrl(client, token, id, null)
        assert.lengthOf(await eventos(), 2)
        // Diff en audit.cambios
        const cambio = await db
            .from('audit.cambios')
            .where('entidad_tipo', 'empresa')
            .where('entidad_id', String(id))
            .where('campo', 'url_corte')
            .orderBy('id', 'desc')
            .first()
        assert.isNotNull(cambio)
    })

    test('GET /portal/destino-corte: la URL de la empresa del servicio de la IP; null sin servicio o sin URL', async ({
        client,
        assert,
    }) => {
        const s = await crearServicio()
        await crearSesion(s, { ipv4: '198.51.100.177' })
        const pedir = async (ip: string) => {
            const r = await estado(
                client.get('/api/v1/portal/destino-corte').header('X-Forwarded-For', ip),
                200,
            )
            return r.body()
        }
        // Suspendido identificado por su IP: sin URL de la empresa, el código de su suspensión (§5 ter.1)
        const sinUrl = await pedir('198.51.100.177')
        assert.isNull(sinUrl.url)
        assert.match(sinUrl.codigo, /^[0-9A-HJKMNP-TV-Z]{13}$/)
        await db.from('core.empresas').where('id', 1).update({ url_corte: URL_OPERADOR })
        assert.deepEqual(await pedir('198.51.100.177'), { url: URL_OPERADOR, codigo: null })
        // IP que no es de ningún servicio: null (la /corte del portal)
        assert.deepEqual(await pedir('203.0.113.250'), { url: null, codigo: null })
    })

    test('primer salto por IP (contratos/corte-identificacion.md §5 ter.1): código de la suspensión, idempotente y solo suspendido', async ({
        client,
        assert,
    }) => {
        const s = await crearServicio()
        await crearSesion(s, { ipv4: '198.51.100.178' })
        const pedir = async (headers: Record<string, string>) => {
            let peticion = client
                .get('/api/v1/portal/destino-corte')
                .header('X-Forwarded-For', '198.51.100.178')
            for (const [k, v] of Object.entries(headers)) peticion = peticion.header(k, v)
            const r = await estado(peticion, 200)
            return r.body() as { url: string | null; codigo: string | null }
        }
        const emitidos = () =>
            db
                .from('audit.outbox')
                .where('evento', 'portal.codigo_corte_emitido')
                .whereRaw(`(payload->>'servicio_id')::bigint = ?`, [s.servicioId])
        const auditadas = () =>
            db
                .from('audit.acciones')
                .where('accion', 'portal.codigo_corte.emitir')
                .where('entidad_id', String(s.servicioId))

        const primero = await pedir({})
        assert.match(primero.codigo!, /^[0-9A-HJKMNP-TV-Z]{13}$/)
        // Repetida (cada sonda del sistema): el mismo código, sin otro evento ni otra fila de auditoría
        const repetida = await pedir({})
        assert.equal(repetida.codigo, primero.codigo)
        assert.lengthOf(await emitidos(), 1)
        const filas = await auditadas()
        assert.lengthOf(filas, 1)
        // La auditoría nunca lleva el código
        assert.notInclude(JSON.stringify(filas[0]), primero.codigo!)
        const [evento] = await emitidos()
        assert.notInclude(JSON.stringify(evento.payload), primero.codigo!)
        const fila = await db
            .from('core.codigos_corte')
            .where('servicio_id', s.servicioId)
            .whereNull('cerrado_en')
        assert.lengthOf(fila, 1)
        assert.equal(fila[0].codigo, primero.codigo)

        // Con el código en la petición identifica por código: no hace falta otro
        assert.deepEqual(await pedir({ 'X-Argos-Corte': primero.codigo! }), { url: null, codigo: null })

        // Reactivado: ya no se emite (la sesión sigue con la IP)
        await db.from('core.servicios').where('id', s.servicioId).update({ estado: 'activo' })
        await db
            .from('core.codigos_corte')
            .where('servicio_id', s.servicioId)
            .update({ cerrado_en: new Date() })
        assert.deepEqual(await pedir({}), { url: null, codigo: null })
        assert.lengthOf(
            await db.from('core.codigos_corte').where('servicio_id', s.servicioId).whereNull('cerrado_en'),
            0,
        )
    })

    test('IP de infraestructura (router o proxy): sin código aunque caiga en una sesión', async ({
        client,
        assert,
    }) => {
        const s = await crearServicio()
        // La IP del NAS del router del servicio: nunca identifica (ip_de_router), nunca recibe código
        const router = await db
            .from('network.routers')
            .where('id', s.routerId)
            .select(db.raw('host(nas_ip) AS ip'))
            .first()
        await crearSesion(s, { ipv4: router.ip })
        const r = await estado(
            client.get('/api/v1/portal/destino-corte').header('X-Forwarded-For', router.ip),
            200,
        )
        assert.deepEqual(r.body(), { url: null, codigo: null })
        assert.lengthOf(await db.from('core.codigos_corte').where('servicio_id', s.servicioId), 0)
    })

    test('el host de la URL entra en argos-walled del router; portal.config_cambiada reconcilia', async ({
        assert,
    }) => {
        const falso = new RouterOSFalso()
        await falso.levantar()
        try {
            const { routerId } = await crearEscenarioRouter()
            await db
                .from('network.routers')
                .where('id', routerId)
                .update({ host: falso.url, api_usuario: falso.usuario, api_password: cifrar(falso.password) })
            const walled = () =>
                falso
                    .tabla('/ip/firewall/address-list')
                    .filter((o) => o.list === 'argos-walled')
                    .map((o) => o.address)
            const reconciliar = () =>
                new ReconciliarRouterOS(OPCIONES).execute(
                    { router_id: routerId, motivo: 'portal' },
                    contextoPrueba(),
                )
            await reconciliar()
            assert.notInclude(walled(), 'pagos.isp.example')
            await db.from('core.empresas').where('id', 1).update({ url_corte: URL_OPERADOR })
            await reconciliar()
            assert.include(walled(), 'pagos.isp.example')
            assert.include(
                falso
                    .tabla('/ipv6/firewall/address-list')
                    .filter((o) => o.list === 'argos-walled')
                    .map((o) => o.address),
                'pagos.isp.example',
            )
            // Se quita la URL: sale del walled garden en la siguiente pasada
            await db.from('core.empresas').where('id', 1).update({ url_corte: null })
            await reconciliar()
            assert.notInclude(walled(), 'pagos.isp.example')
            assert.isTrue(new ConsumidorRouterOS(OPCIONES).acepta('portal.config_cambiada'))
        } finally {
            await falso.cerrar()
        }
    })
})
