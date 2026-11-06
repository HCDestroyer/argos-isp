import { test } from '@japa/runner'
import { dnsDeDocumentacion, esIpDocumentacion } from '#network/conexion/dns'
import { valoresServicio } from '#network/conexion/servicio'
import { configCorte, estadoCorteRouter } from '#network/routeros/corte_router'
import { ReglaNegocio } from '#shared/errores'

/**
 * DNS del router (bug del 6 nov): Argos nunca fija resolutores de documentación (RFC 5737 / 3849) y,
 * sin `ROUTERS_SERVICIO_DNS_V4`, el script no toca los `servers` del router.
 */

const SERVICIO: NodeJS.ProcessEnv = {
    ROUTERS_SERVICIO_WAN_INTERFAZ: 'ether1',
    ROUTERS_SERVICIO_POOL_V4_RANGOS: '10.10.0.10-10.10.0.250',
    ROUTERS_SERVICIO_CLIENTES_V4: '10.10.0.0/16',
    ROUTERS_SERVICIO_POOL_V6_ENLACE_PREFIJO: '2001:db8:100::/48',
    ROUTERS_SERVICIO_POOL_V6_PD_PREFIJO: '2001:db8:200::/40',
    ROUTERS_SERVICIO_PORTAL_V4: '192.0.2.20',
    ROUTERS_SERVICIO_PORTAL_V6: '2001:db8:ffff::20',
    ROUTERS_SERVICIO_PORTAL_FQDN: 'portal.argosisp.example',
}

const ROUTER = { interfaz_clientes: 'ether2' }

test.group('Red · DNS del router', () => {
    test('esIpDocumentacion: 192.0.2/24, 198.51.100/24, 203.0.113/24 y 2001:db8::/32', ({ assert }) => {
        for (const ip of [
            '192.0.2.53',
            '198.51.100.53',
            '203.0.113.1',
            '2001:db8:ffff::53',
            '2001:DB8::1',
            '[2001:db8::1]',
        ]) {
            assert.isTrue(esIpDocumentacion(ip), ip)
        }
        for (const ip of [
            '1.1.1.1',
            '8.8.8.8',
            '192.0.3.1',
            '198.51.101.1',
            '10.0.0.1',
            '2606:4700:4700::1111',
            '2001:db9::1',
            'no-es-ip',
            '',
        ]) {
            assert.isFalse(esIpDocumentacion(ip), ip)
        }
        assert.deepEqual(dnsDeDocumentacion('1.1.1.1, 192.0.2.53;8.8.8.8 203.0.113.9'), [
            '192.0.2.53',
            '203.0.113.9',
        ])
        assert.deepEqual(dnsDeDocumentacion(undefined), [])
    })

    test('valoresServicio: dns_v4 opcional; vacío = cadena vacía (el script no toca servers)', ({
        assert,
    }) => {
        const v = valoresServicio(ROUTER, ['10.10.0.1'], { ...SERVICIO })
        assert.equal(v.dns_v4, '')
        assert.equal(v.dns_v6, '')
        const con = valoresServicio(ROUTER, ['10.10.0.1'], {
            ...SERVICIO,
            ROUTERS_SERVICIO_DNS_V4: '1.1.1.1,8.8.8.8',
            ROUTERS_SERVICIO_DNS_V6: '2606:4700:4700::1111',
        })
        assert.equal(con.dns_v4, '1.1.1.1,8.8.8.8')
        assert.equal(con.dns_v6, '2606:4700:4700::1111')
    })

    test('valoresServicio: DNS de documentación → 422 dns_documentacion con cada IP', ({ assert }) => {
        try {
            valoresServicio(ROUTER, ['10.10.0.1'], {
                ...SERVICIO,
                ROUTERS_SERVICIO_DNS_V4: '192.0.2.53,198.51.100.53',
                ROUTERS_SERVICIO_DNS_V6: '2001:db8:ffff::53',
            })
            assert.fail('debía rechazar')
        } catch (error) {
            assert.instanceOf(error, ReglaNegocio)
            const json = (error as ReglaNegocio).toJSON()
            assert.equal(json.status, 422)
            assert.equal(json.type, 'urn:argosisp:problema:dns_documentacion')
            assert.include(json.detail, 'ROUTERS_SERVICIO_DNS_V4 y ROUTERS_SERVICIO_DNS_V6')
            assert.include(json.detail, '192.0.2.53, 198.51.100.53, 2001:db8:ffff::53')
            assert.deepEqual(
                json.errors?.map((e) => e.field),
                ['ROUTERS_SERVICIO_DNS_V4', 'ROUTERS_SERVICIO_DNS_V4', 'ROUTERS_SERVICIO_DNS_V6'],
            )
        }
        // se rechaza aunque falten otros datos: primero lo que rompe el router
        assert.throws(
            () => valoresServicio(ROUTER, [], { ROUTERS_SERVICIO_DNS_V4: '203.0.113.53' }),
            /documentación/,
        )
    })

    test('corte: DNS de documentación en el entorno → aviso con cómo corregir el router', ({ assert }) => {
        const opciones = { fasttrack: false, redes_v4: [], gateways_v4: ['10.10.0.1'] }
        const doc = estadoCorteRouter(
            configCorte({
                ...SERVICIO,
                ROUTERS_SERVICIO_DNS_V4: '192.0.2.53',
                ROUTERS_SERVICIO_DNS_V6: '2001:db8::53',
            }),
            opciones,
            [],
        )
        const aviso = doc.avisos.find((a) => a.includes('documentación'))
        assert.exists(aviso)
        assert.include(aviso!, '192.0.2.53, 2001:db8::53')
        assert.include(aviso!, '/ip dns set servers=')

        const real = estadoCorteRouter(
            configCorte({ ...SERVICIO, ROUTERS_SERVICIO_DNS_V4: '1.1.1.1' }),
            opciones,
            [],
        )
        assert.isFalse(real.avisos.some((a) => a.includes('documentación')))
        // sin DNS en el entorno: argos-dns lleva solo el DNS del router (el gateway)
        const sinDns = estadoCorteRouter(configCorte({ ...SERVICIO }), opciones, [])
        assert.deepEqual(
            sinDns.entradas.filter((e) => e.list === 'argos-dns').map((e) => e.address),
            ['10.10.0.1'],
        )
    })
})
