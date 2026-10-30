import { test } from '@japa/runner'
import {
    PLANTILLAS,
    PlantillaInvalida,
    escapar,
    leerMikrotik,
    plantillaConexion,
    renderizar,
    variablesDe,
    variablesMikrotik,
} from '#network/conexion/render'
import { VARIABLES_SERVICIO } from '#network/conexion/servicio'
import { leerRedTunel, parsearAdmin } from '#network/conexion/config'

/**
 * Espejo de `infra/mikrotik/render.test.mjs` (A6) para el port de `render.ts`: mismos valores y mismas
 * reglas. Si cambia la referencia, cambian las dos pruebas.
 */
const VALORES: Record<string, string> = {
    router_id: '12',
    generado_en: '2026-10-28T22:30:00Z',
    argos_url: 'https://api.miisp.example',
    token: 'tokenDePrueba0123456789abcdefghijklmnop',
    wg_ip: '10.255.0.12',
    wg_servidor_ip: '10.255.0.1',
    wg_red: '10.255.0.0/16',
    wg_servidor_public_key: '4wRU35+Ojozg+fIrx/BA31AGmNDWUc8XYfAHQzH1w1A=',
    wg_servidor_endpoint: 'vpn.miisp.example',
    wg_servidor_puerto: '51820',
    radius_secret: 'secretoRadius$de?prueba"0123\\x',
    api_password: 'ClaveApi$0123456789abcdefghijklmnopq',
    api_nombre: 'router-12.argosisp',
    admin_ips: '203.0.113.7,198.51.100.0/24',
    api_ip_anterior: '192.168.88.1',
    pppoe_interfaz: 'ether2',
    wan_interfaz: 'ether1',
    ppp_local_v4: '10.10.0.1',
    pool_v4_rangos: '10.10.0.10-10.10.0.250',
    clientes_v4: '10.10.0.0/16',
    clientes_v6: '2001:db8:100::/48,2001:db8:200::/40',
    susp_rate_limit: '256k/256k',
    pool_v6_enlace_prefijo: '2001:db8:100::/48',
    pool_v6_pd_prefijo: '2001:db8:200::/40',
    portal_v4: '192.0.2.20',
    portal_v6: '2001:db8:ffff::20',
    portal_fqdn: 'portal.miisp.example',
    walled_garden: 'app.recurrente.com',
    dns_v4: '192.0.2.53,198.51.100.53',
    dns_v6: '2001:db8:ffff::53',
}

test.group('Conexión de routers · render (espejo de render.test.mjs)', () => {
    test('cada variable de las plantillas está en variables.json y todas se usan', ({ assert }) => {
        const variables = variablesMikrotik()
        const usadas = new Set<string>()
        for (const ruta of Object.values(PLANTILLAS)) {
            for (const v of variablesDe(leerMikrotik(ruta))) {
                assert.property(variables, v)
                usadas.add(v)
            }
        }
        assert.sameMembers([...usadas], Object.keys(variables))
        // el grupo servicio es exactamente lo que llena `servicio.ts`
        const v = JSON.parse(leerMikrotik('variables.json')) as { servicio: Record<string, unknown> }
        assert.sameMembers([...VARIABLES_SERVICIO], Object.keys(v.servicio))
    })

    test('render: sin variables pendientes y secretos escapados', ({ assert }) => {
        const r = renderizar(leerMikrotik(PLANTILLAS.conexion), VALORES)
        assert.notMatch(r, /\{\{/)
        assert.include(r, ':local radiusSecret "secretoRadius\\$de\\?prueba\\"0123\\\\x"')
        assert.include(r, ':local apiPassword "ClaveApi\\$0123456789abcdefghijklmnopq"')
        assert.include(r, ':local adminIps [:toarray "203.0.113.7,198.51.100.0/24"]')
        assert.notMatch(r, /pppoe-server/)
        assert.match(renderizar(leerMikrotik(PLANTILLAS.servicio), VALORES), /pppoe-server/)
    })

    test('sin RADIUS: plantilla por modo; sin radius_secret, use-radius=no y sensitive', ({ assert }) => {
        assert.equal(plantillaConexion('radius', false), PLANTILLAS.conexion)
        assert.equal(plantillaConexion('radius', true), PLANTILLAS.servicio)
        assert.equal(plantillaConexion('api', false), PLANTILLAS.conexion_sin_radius)
        assert.equal(plantillaConexion('api', true), PLANTILLAS.servicio_sin_radius)
        const sinSecreto = Object.fromEntries(Object.entries(VALORES).filter(([k]) => k !== 'radius_secret'))
        for (const ruta of [PLANTILLAS.conexion_sin_radius, PLANTILLAS.servicio_sin_radius]) {
            const plantilla = leerMikrotik(ruta)
            assert.notInclude(variablesDe(plantilla), 'radius_secret')
            const r = renderizar(plantilla, sinSecreto)
            assert.notMatch(r, /\{\{/)
            assert.notMatch(r, /^\s*\/radius add/m)
            assert.match(r, /^\/ppp aaa set use-radius=no/m)
            assert.match(r, /name="argosisp-api"\] policy=[a-z,-]*sensitive/)
        }
    })

    test('render: falta una variable, no cumple su patrón o trae un salto de línea → error', ({ assert }) => {
        const plantilla = leerMikrotik(PLANTILLAS.conexion)
        const { token, ...sinToken } = VALORES
        assert.isString(token)
        assert.throws(() => renderizar(plantilla, sinToken), /token: falta/)
        assert.throws(
            () => renderizar(plantilla, { ...VALORES, wg_ip: '10.255.0.12"; /system reset' }),
            /wg_ip: no cumple/,
        )
        assert.throws(
            () => renderizar(plantilla, { ...VALORES, admin_ips: '1.2.3.4 ,5.6.7.8' }),
            /admin_ips: no cumple/,
        )
        assert.throws(
            () => renderizar(plantilla, { ...VALORES, api_password: 'a'.repeat(31) }),
            /api_password: no cumple/,
        )
        assert.throws(() => escapar('linea\nsiguiente'), /control/)
        assert.throws(() => renderizar('{{desconocida}}', {}), PlantillaInvalida as any)
        assert.match(renderizar(plantilla, { ...VALORES, admin_ips: '' }), /:local adminIps \[:toarray ""\]/)
    })

    test('red del túnel y lista de administración', ({ assert }) => {
        assert.deepEqual(leerRedTunel('10.255.3.9/16'), {
            cidr: '10.255.0.0/16',
            base: 184483840,
            prefijo: 16,
            servidor: '10.255.0.1',
        })
        assert.deepEqual(parsearAdmin(' 203.0.113.5, 198.51.100.0/24,203.0.113.5 '), [
            '203.0.113.5',
            '198.51.100.0/24',
        ])
        assert.deepEqual(parsearAdmin(undefined), [])
        assert.throws(() => parsearAdmin('1.2.3.4,no-es-ip'))
        assert.throws(() => parsearAdmin('1.2.3.4/33'))
    })
})
