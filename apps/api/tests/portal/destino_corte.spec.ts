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
        await crearSesion(s, { ipv4: '198.51.100.77' })
        const pedir = async (ip: string) => {
            const r = await estado(
                client.get('/api/v1/portal/destino-corte').header('X-Forwarded-For', ip),
                200,
            )
            return r.body()
        }
        assert.deepEqual(await pedir('198.51.100.77'), { url: null })
        await db.from('core.empresas').where('id', 1).update({ url_corte: URL_OPERADOR })
        assert.deepEqual(await pedir('198.51.100.77'), { url: URL_OPERADOR })
        // IP que no es de ningún servicio: null (la /corte del portal)
        assert.deepEqual(await pedir('203.0.113.250'), { url: null })
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
