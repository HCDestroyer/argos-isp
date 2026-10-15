import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, unico } from '#tests/ayudas'
import { crearServicio, crearSesion } from '#tests/portal/ayudas_portal'
import { normalizarIp, resolverIpOrigen } from '#portal/ip_origen'
import { nombreParcial } from '#portal/actions/identificar_por_ip'

/**
 * GET /api/v1/portal/quien-soy contra Postgres real.
 * El cliente de pruebas conecta desde 127.0.0.1: con 127.0.0.1 como proxy confiable, la IP del
 * cliente viaja en X-Forwarded-For igual que la pone el portal (Nitro).
 */

const RUTA = '/api/v1/portal/quien-soy'
const CAMPOS = [
    'identificado',
    'ip',
    'nombre_parcial',
    'estado',
    'promesa_activa',
    'monto_adeudado',
    'facturas_vencidas',
]

test.group('Portal: quien-soy por IP', (group) => {
    group.each.setup(() => {
        const previo = { ...process.env }
        process.env.PORTAL_PROXIES_CONFIABLES = '127.0.0.1/32, ::1'
        delete process.env.PORTAL_CABECERA_IP
        // Contadores del límite de peticiones propios de cada prueba.
        process.env.PORTAL_LIMITE_PREFIJO = unico('prueba-quien-soy')
        return () => {
            delete process.env.PORTAL_LIMITE_PREFIJO
            process.env.PORTAL_PROXIES_CONFIABLES = previo.PORTAL_PROXIES_CONFIABLES
            if (previo.PORTAL_PROXIES_CONFIABLES === undefined) delete process.env.PORTAL_PROXIES_CONFIABLES
            if (previo.PORTAL_CABECERA_IP !== undefined) {
                process.env.PORTAL_CABECERA_IP = previo.PORTAL_CABECERA_IP
            }
        }
    })

    test('IPv4 de una sesión activa: nombre parcial, estado y montos con decimal exacto', async ({
        client,
        assert,
    }) => {
        const s = await crearServicio()
        await crearSesion(s, {
            ipv4: '198.51.100.10',
            enlace: '2001:db8:100:1::/64',
            delegado: '2001:db8:200:100::/56',
        })

        const respuesta = await estado(client.get(RUTA).header('X-Forwarded-For', '198.51.100.10'), 200)
        const cuerpo = respuesta.body()
        assert.deepEqual(cuerpo, {
            identificado: true,
            ip: '198.51.100.10',
            nombre_parcial: 'María J.',
            estado: 'suspendido',
            promesa_activa: false,
            monto_adeudado: '399.75',
            facturas_vencidas: { cantidad: 2, total: '299.75' },
        })
        assert.equal(respuesta.header('cache-control'), 'no-store')
    })

    test('nunca expone datos personales completos', async ({ client, assert }) => {
        const s = await crearServicio({ nombre: 'Juan Carlos Pérez' })
        await crearSesion(s, { ipv4: '198.51.100.11' })

        const respuesta = await estado(client.get(RUTA).header('X-Forwarded-For', '198.51.100.11'), 200)
        assert.sameMembers(Object.keys(respuesta.body()), CAMPOS)
        const texto = JSON.stringify(respuesta.body())
        for (const dato of [
            'Juan Carlos',
            'Pérez',
            'example.com',
            '5555-1234',
            '1234567-8',
            'zona 1',
            'ppp-',
        ]) {
            assert.notInclude(texto, dato)
        }
        assert.equal(respuesta.body().nombre_parcial, 'Juan C.')
    })

    test('IPv6 dentro del prefijo delegado /56 y del /64 de enlace', async ({ client, assert }) => {
        const s = await crearServicio({ estado: 'limitado', promesa: true })
        await crearSesion(s, {
            ipv4: '198.51.100.12',
            enlace: '2001:db8:100:2::/64',
            delegado: '2001:db8:200:200::/56',
        })

        const delegado = await estado(
            client.get(RUTA).header('X-Forwarded-For', '2001:db8:200:2ab:a00:27ff:fe4e:66a1'),
            200,
        )
        assert.containsSubset(delegado.body(), {
            identificado: true,
            ip: '2001:db8:200:2ab:a00:27ff:fe4e:66a1',
            estado: 'limitado',
            promesa_activa: true,
            monto_adeudado: '399.75',
        })

        const enlace = await estado(client.get(RUTA).header('X-Forwarded-For', '2001:DB8:100:2::5'), 200)
        assert.containsSubset(enlace.body(), {
            identificado: true,
            ip: '2001:db8:100:2::5',
            estado: 'limitado',
        })

        // Fuera del /56 (2001:db8:200:300::/56): no es de este servicio.
        const fuera = await estado(client.get(RUTA).header('X-Forwarded-For', '2001:db8:200:300::1'), 200)
        assert.isFalse(fuera.body().identificado)
    })

    test('sin sesión viva usa las asignaciones vigentes IPv4 e IPv6', async ({ client, assert }) => {
        const s = await crearServicio({ estado: 'activo' })
        const [red] = await db
            .table('network.redes_ipv4')
            .insert({ router_id: s.routerId, cidr: '10.10.1.0/24', tipo: 'estatico' })
            .returning('id')
        await db
            .table('network.ipv4_asignaciones')
            .insert({ servicio_id: s.servicioId, red_id: red.id, ip: '10.10.1.7/32' })
        await db
            .table('network.ipv6_asignaciones')
            .insert({ servicio_id: s.servicioId, prefijo: '2001:db8:300:100::/56', tipo: 'delegacion' })

        const v4 = await estado(client.get(RUTA).header('X-Forwarded-For', '10.10.1.7'), 200)
        assert.containsSubset(v4.body(), { identificado: true, estado: 'activo', monto_adeudado: '399.75' })

        const v6 = await estado(client.get(RUTA).header('X-Forwarded-For', '2001:db8:300:1ff::9'), 200)
        assert.containsSubset(v6.body(), { identificado: true, estado: 'activo' })
    })

    test('una sesión cerrada no identifica; la sesión activa más reciente gana', async ({
        client,
        assert,
    }) => {
        const viejo = await crearServicio({ estado: 'retirado' })
        await crearSesion(viejo, { ipv4: '198.51.100.13', fin: new Date().toISOString() })

        const cerrada = await estado(client.get(RUTA).header('X-Forwarded-For', '198.51.100.13'), 200)
        assert.deepEqual(cerrada.body(), {
            identificado: false,
            ip: '198.51.100.13',
            nombre_parcial: null,
            estado: null,
            promesa_activa: null,
            monto_adeudado: null,
            facturas_vencidas: null,
        })

        const nuevo = await crearServicio({ estado: 'activo', nombre: 'Pedro' })
        await crearSesion(nuevo, { ipv4: '198.51.100.13' })
        const activa = await estado(client.get(RUTA).header('X-Forwarded-For', '198.51.100.13'), 200)
        assert.containsSubset(activa.body(), {
            identificado: true,
            estado: 'activo',
            nombre_parcial: 'Pedro',
        })
    })

    test('sin proxies confiables ignora X-Forwarded-For y usa la IP del socket', async ({
        client,
        assert,
    }) => {
        const s = await crearServicio()
        await crearSesion(s, { ipv4: '198.51.100.14' })
        delete process.env.PORTAL_PROXIES_CONFIABLES

        const respuesta = await estado(client.get(RUTA).header('X-Forwarded-For', '198.51.100.14'), 200)
        assert.isFalse(respuesta.body().identificado)
        assert.equal(respuesta.body().ip, '127.0.0.1')
    })

    test('un X-Forwarded-For falso del cliente queda a la izquierda y no se usa', async ({
        client,
        assert,
    }) => {
        const victima = await crearServicio()
        await crearSesion(victima, { ipv4: '198.51.100.15' })

        // El cliente 203.0.113.50 manda "198.51.100.15"; el portal agrega su IP de socket al final.
        const respuesta = await estado(
            client.get(RUTA).header('X-Forwarded-For', '198.51.100.15, 203.0.113.50'),
            200,
        )
        assert.equal(respuesta.body().ip, '203.0.113.50')
        assert.isFalse(respuesta.body().identificado)
    })

    test('cabecera configurable con PORTAL_CABECERA_IP', async ({ client, assert }) => {
        const s = await crearServicio()
        await crearSesion(s, { ipv4: '198.51.100.16' })
        process.env.PORTAL_CABECERA_IP = 'X-Real-IP'

        const respuesta = await estado(
            client.get(RUTA).header('X-Real-IP', '198.51.100.16').header('X-Forwarded-For', '203.0.113.1'),
            200,
        )
        assert.containsSubset(respuesta.body(), { identificado: true, ip: '198.51.100.16' })
    })

    test('se audita como portal.quien_soy, canal portal, con el servicio', async ({ client, assert }) => {
        const s = await crearServicio()
        await crearSesion(s, { ipv4: '198.51.100.17' })
        const requestId = unico('quien-soy')

        await estado(
            client.get(RUTA).header('X-Forwarded-For', '198.51.100.17').header('X-Request-Id', requestId),
            200,
        )
        const accion = await db.from('audit.acciones').where('request_id', requestId).firstOrFail()
        assert.equal(accion.accion, 'portal.quien_soy')
        assert.equal(accion.canal, 'portal')
        assert.equal(accion.resultado, 'ok')
        assert.equal(accion.entidad_tipo, 'servicio')
        assert.equal(Number(accion.entidad_id), s.servicioId)
        assert.deepEqual(accion.entrada, { ip: '198.51.100.17' })
    })
})

test.group('Portal: resolución de la IP de origen', () => {
    const config = { proxiesConfiables: '127.0.0.1, 172.16.0.0/12, fd00::/8', cabecera: 'x-forwarded-for' }

    test('normaliza IPv4 mapeada, corchetes, zona y mayúsculas', ({ assert }) => {
        assert.equal(normalizarIp('::ffff:198.51.100.1'), '198.51.100.1')
        assert.equal(normalizarIp('[2001:DB8::1]'), '2001:db8::1')
        assert.equal(normalizarIp('fe80::1%eth0'), 'fe80::1')
        assert.isNull(normalizarIp('no-es-ip'))
        assert.isNull(normalizarIp(undefined))
    })

    test('recorre la cadena desde la derecha saltando proxies confiables', ({ assert }) => {
        // cliente → proxy inverso (172.18.0.5) → portal (172.18.0.3) → API
        assert.equal(
            resolverIpOrigen('::ffff:172.18.0.3', '198.51.100.1, 172.18.0.5', config),
            '198.51.100.1',
        )
        assert.equal(resolverIpOrigen('fd00::3', '2001:db8::99', config), '2001:db8::99')
        // conexión directa de un cliente: la cabecera no cuenta
        assert.equal(resolverIpOrigen('203.0.113.7', '198.51.100.1', config), '203.0.113.7')
        // entrada ilegible: se queda la última IP conocida
        assert.equal(resolverIpOrigen('127.0.0.1', 'basura', config), '127.0.0.1')
    })

    test('una entrada inválida en PORTAL_PROXIES_CONFIABLES es error de configuración', ({ assert }) => {
        assert.throws(
            () =>
                resolverIpOrigen('127.0.0.1', '1.2.3.4', { proxiesConfiables: '10.0.0.0/40', cabecera: 'x' }),
            /entrada inválida/,
        )
    })

    test('nombre parcial: primer nombre e inicial', ({ assert }) => {
        assert.equal(nombreParcial('  maría   josé garcía '), 'maría J.')
        assert.equal(nombreParcial('Ferretería'), 'Ferretería')
        assert.isNull(nombreParcial('   '))
    })
})
