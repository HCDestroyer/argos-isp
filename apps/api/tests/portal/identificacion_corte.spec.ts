import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, unico } from '#tests/ayudas'
import { crearServicio, crearSesion } from '#tests/portal/ayudas_portal'
import { generarCodigoCorte, normalizarCodigoCorte } from '#portal/codigos_corte'
import { clasificarIp, identificarOrigen } from '#portal/identificacion'

/**
 * Identificación del suspendido en la página de corte (`contratos/corte-identificacion.md` §4.1), contra
 * Postgres real. Reproduce el bug del PM (v1.12.0): el router hace masquerade y el portal ve la IP
 * pública del router, o la de Docker detrás de NPM; con esas IPs nunca se identifica a nadie, y con el
 * código de corte del router sí, sin importar la IP.
 *
 * El cliente de pruebas conecta desde 127.0.0.1 (proxy confiable): la IP de origen viaja en
 * `X-Forwarded-For` como la pone el portal.
 */

const QUIEN_SOY = '/api/v1/portal/quien-soy'

async function conCodigo(servicioId: number, datos: { cerrado_hace_min?: number } = {}) {
    const codigo = generarCodigoCorte()
    const servicio = await db
        .from('core.servicios')
        .where('id', servicioId)
        .select('empresa_id')
        .firstOrFail()
    await db.table('core.codigos_corte').insert({
        servicio_id: servicioId,
        empresa_id: servicio.empresa_id,
        codigo,
        cerrado_en:
            datos.cerrado_hace_min === undefined
                ? null
                : db.raw(`now() - make_interval(mins => ?)`, [datos.cerrado_hace_min]),
    })
    return codigo
}

test.group('Portal: identificación por código o IP (corte)', (group) => {
    group.each.setup(() => {
        const previo = { ...process.env }
        process.env.PORTAL_PROXIES_CONFIABLES = '127.0.0.1/32, ::1, 172.30.0.0/24'
        process.env.PORTAL_IPS_SERVIDOR = '167.250.223.15'
        process.env.PORTAL_REDIS_PREFIJO = unico('prueba-identificacion')
        return () => {
            for (const k of [
                'PORTAL_PROXIES_CONFIABLES',
                'PORTAL_IPS_SERVIDOR',
                'PORTAL_REDIS_PREFIJO',
                'PORTAL_LIMITE_PETICIONES',
                'PORTAL_LIMITE_CODIGOS_FALLIDOS',
            ]) {
                if (previo[k] === undefined) delete process.env[k]
                else process.env[k] = previo[k]
            }
        }
    })

    test('la IP de un router nunca identifica, aunque una sesión la tenga (masquerade)', async ({
        client,
        assert,
    }) => {
        const s = await crearServicio()
        const router = await db.from('network.routers').where('id', s.routerId).firstOrFail()
        const ipRouter = String(router.nas_ip).split('/')[0]!
        // Dato sucio: una sesión con la IP del router (el portal la vería por el masquerade)
        await crearSesion(s, { ipv4: ipRouter })
        const r = await estado(client.get(QUIEN_SOY).header('X-Forwarded-For', ipRouter), 200)
        assert.containsSubset(r.body(), {
            identificado: false,
            ip: ipRouter,
            nombre_parcial: null,
            monto_adeudado: null,
            identificado_por: null,
            motivo: 'ip_de_router',
        })
    })

    test('la IP del servidor o de la red de Docker (NPM sin proxies confiables) tampoco', async ({
        client,
        assert,
    }) => {
        const servidor = await estado(client.get(QUIEN_SOY).header('X-Forwarded-For', '167.250.223.15'), 200)
        assert.containsSubset(servidor.body(), { identificado: false, motivo: 'ip_de_servidor' })
        // Caddy sin ARGOSISP_PROXIES_CONFIABLES: la API ve la puerta de enlace de compose (confiable)
        const docker = await estado(client.get(QUIEN_SOY).header('X-Forwarded-For', '172.30.0.1'), 200)
        assert.containsSubset(docker.body(), { identificado: false, ip: '172.30.0.1', motivo: 'ip_de_proxy' })
        const nadie = await estado(client.get(QUIEN_SOY).header('X-Forwarded-For', '198.51.100.250'), 200)
        assert.containsSubset(nadie.body(), { identificado: false, motivo: 'ip_desconocida' })
    })

    test('con el código de corte identifica aunque la IP sea la del router (cabecera o ?c=)', async ({
        client,
        assert,
    }) => {
        const s = await crearServicio({ nombre: 'Juan Carlos Pérez' })
        const codigo = await conCodigo(s.servicioId)
        const router = await db.from('network.routers').where('id', s.routerId).firstOrFail()
        const ipRouter = String(router.nas_ip).split('/')[0]!

        const porCabecera = await estado(
            client.get(QUIEN_SOY).header('X-Forwarded-For', ipRouter).header('X-Argos-Corte', codigo),
            200,
        )
        assert.containsSubset(porCabecera.body(), {
            identificado: true,
            nombre_parcial: 'Juan C.',
            estado: 'suspendido',
            monto_adeudado: '399.75',
            identificado_por: 'codigo',
            motivo: null,
        })
        // Solo lo mínimo: nunca datos personales completos
        assert.notInclude(JSON.stringify(porCabecera.body()), 'Pérez')

        const porQuery = await estado(
            client.get(`${QUIEN_SOY}?c=${codigo.toLowerCase()}`).header('X-Forwarded-For', '172.30.0.1'),
            200,
        )
        assert.containsSubset(porQuery.body(), { identificado: true, identificado_por: 'codigo' })

        const estadoVivo = await estado(
            client
                .get('/api/v1/portal/estado')
                .header('X-Forwarded-For', ipRouter)
                .header('X-Argos-Corte', codigo),
            200,
        )
        assert.containsSubset(estadoVivo.body(), { identificado: true, estado: 'suspendido' })

        // La auditoría no guarda el código en claro
        const accion = await db
            .from('audit.acciones')
            .where('accion', 'portal.quien_soy')
            .where('entidad_id', s.servicioId)
            .orderBy('id', 'desc')
            .firstOrFail()
        assert.equal(accion.entrada.codigo, '***')
        assert.notInclude(JSON.stringify(accion.entrada), codigo)
    })

    test('código cerrado: sigue 30 min (gracia) y después ya no; dice codigo_vencido', async ({
        client,
        assert,
    }) => {
        const s = await crearServicio({ estado: 'activo' })
        const reciente = await conCodigo(s.servicioId, { cerrado_hace_min: 10 })
        const r1 = await estado(
            client.get(QUIEN_SOY).header('X-Forwarded-For', '203.0.113.7').header('X-Argos-Corte', reciente),
            200,
        )
        assert.containsSubset(r1.body(), { identificado: true, estado: 'activo', identificado_por: 'codigo' })

        const otro = await crearServicio()
        const viejo = await conCodigo(otro.servicioId, { cerrado_hace_min: 31 })
        const r2 = await estado(
            client.get(QUIEN_SOY).header('X-Forwarded-For', '203.0.113.7').header('X-Argos-Corte', viejo),
            200,
        )
        assert.containsSubset(r2.body(), { identificado: false, motivo: 'codigo_vencido' })

        // Código vencido pero la IP sí es del cliente (sin NAT): identifica por la IP
        await crearSesion(otro, { ipv4: '198.51.100.31' })
        const r3 = await estado(
            client.get(QUIEN_SOY).header('X-Forwarded-For', '198.51.100.31').header('X-Argos-Corte', viejo),
            200,
        )
        assert.containsSubset(r3.body(), { identificado: true, identificado_por: 'ip' })
    })

    test('límite por código: los suspendidos detrás del mismo NAT no comparten el cupo', async ({
        client,
        assert,
    }) => {
        process.env.PORTAL_LIMITE_PETICIONES = '2'
        const sa = await crearServicio()
        const sb = await crearServicio()
        const a = await conCodigo(sa.servicioId)
        const b = await conCodigo(sb.servicioId)
        const pedir = (codigo: string) =>
            client.get(QUIEN_SOY).header('X-Forwarded-For', '203.0.113.9').header('X-Argos-Corte', codigo)
        await estado(pedir(a), 200)
        await estado(pedir(a), 200)
        // Otro cliente, misma IP pública: su propio cupo
        await estado(pedir(b), 200)
        await estado(pedir(b), 200)
        const tercera = await pedir(a)
        tercera.assertStatus(429)
        assert.exists(tercera.header('retry-after'))
    })

    test('códigos inventados desde una IP: se corta rápido (PORTAL_LIMITE_CODIGOS_FALLIDOS)', async ({
        client,
    }) => {
        process.env.PORTAL_LIMITE_CODIGOS_FALLIDOS = '2'
        const pedir = () =>
            client
                .get(QUIEN_SOY)
                .header('X-Forwarded-For', '203.0.113.10')
                .header('X-Argos-Corte', generarCodigoCorte())
        await estado(pedir(), 200)
        await estado(pedir(), 200)
        const tercera = await pedir()
        tercera.assertStatus(429)
    })

    test('eco-ip: la IP vista y si es de infraestructura, sin datos de clientes', async ({
        client,
        assert,
    }) => {
        const s = await crearServicio()
        await crearSesion(s, { ipv4: '198.51.100.40' })
        const cliente = await estado(
            client.get('/api/v1/portal/eco-ip').header('X-Forwarded-For', '198.51.100.40'),
            200,
        )
        assert.deepEqual(cliente.body(), { ip: '198.51.100.40', infraestructura: null })
        const proxy = await estado(
            client.get('/api/v1/portal/eco-ip').header('X-Forwarded-For', '172.30.0.1'),
            200,
        )
        assert.deepEqual(proxy.body(), { ip: '172.30.0.1', infraestructura: 'ip_de_proxy' })
    })

    test('destino-corte con código: la url_corte de la empresa del servicio', async ({ client, assert }) => {
        const s = await crearServicio()
        const servicio = await db.from('core.servicios').where('id', s.servicioId).firstOrFail()
        const anterior = await db.from('core.empresas').where('id', servicio.empresa_id).firstOrFail()
        await db
            .from('core.empresas')
            .where('id', servicio.empresa_id)
            .update({ url_corte: 'https://pagos.isp.example/corte' })
        try {
            const codigo = await conCodigo(s.servicioId)
            const r = await estado(
                client
                    .get('/api/v1/portal/destino-corte')
                    .header('X-Forwarded-For', '203.0.113.11')
                    .header('X-Argos-Corte', codigo),
                200,
            )
            assert.deepEqual(r.body(), { url: 'https://pagos.isp.example/corte' })
        } finally {
            await db
                .from('core.empresas')
                .where('id', servicio.empresa_id)
                .update({ url_corte: anterior.url_corte })
        }
    })

    test('servicios/:id/codigo-corte: estado sin revelar el código', async ({ client, assert }) => {
        const { usuarioConRoles } = await import('#tests/ayudas')
        const { token } = await usuarioConRoles(['soporte'])
        const s = await crearServicio()
        const codigo = await conCodigo(s.servicioId)
        const r = await estado(
            client.get(`/api/v1/servicios/${s.servicioId}/codigo-corte`).bearerToken(token),
            200,
        )
        assert.containsSubset(r.body(), {
            servicio_id: s.servicioId,
            corte_identificacion: 'ip',
            activo: true,
            cerrado_en: null,
        })
        assert.notInclude(JSON.stringify(r.body()), codigo)
    })

    test('funciones: normalizar el código y clasificar IPs', async ({ assert }) => {
        const codigo = generarCodigoCorte()
        assert.match(codigo, /^[0-9A-HJKMNP-TV-Z]{13}$/)
        assert.equal(normalizarCodigoCorte(` ${codigo.toLowerCase()} `), codigo)
        assert.equal(normalizarCodigoCorte('O1L-'.padEnd(13, '0').replace(/-/g, '0')), '0110000000000')
        assert.isNull(normalizarCodigoCorte('corto'))
        assert.isNull(normalizarCodigoCorte(42))
        assert.equal(await clasificarIp('::ffff:172.30.0.5'), 'ip_de_proxy')
        assert.isNull(await clasificarIp('203.0.113.254'))
        assert.deepEqual(await identificarOrigen({ ip: '203.0.113.254', codigoInvalido: true }), {
            servicioId: null,
            por: null,
            motivo: 'codigo_vencido',
        })
    })
})
