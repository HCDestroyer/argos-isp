import { test } from '@japa/runner'
import { configCorte, estadoCorteRouter } from '#network/routeros/corte_router'
import { valoresServicio } from '#network/conexion/servicio'
import { normalizarValor } from '#network/routeros/normalizar'
import { RATE_LIMIT_SUSPENDIDO_DEFECTO } from '#network/routeros/velocidad_suspendido'

/**
 * Bug v1.19.0 del PM: la página de corte tardaba casi 2 minutos. La velocidad del suspendido (cola dinámica
 * de RADIUS, perfil `suspendido` y cola estática del WISP) limita también el tráfico al portal: con
 * `256k/256k`, los ~1,2 MB sin comprimir de la primera carga de `/corte` tardaban ~40 s solo en bajar.
 * Lo que corta es el firewall; la velocidad por defecto pasa a `2M/2M`.
 */
const ENTORNO_SERVICIO: NodeJS.ProcessEnv = {
    ROUTERS_SERVICIO_WAN_INTERFAZ: 'ether1',
    ROUTERS_SERVICIO_POOL_V4_RANGOS: '10.10.0.10-10.10.0.250',
    ROUTERS_SERVICIO_CLIENTES_V4: '10.10.0.0/16',
    ROUTERS_SERVICIO_POOL_V6_ENLACE_PREFIJO: '2001:db8:100::/48',
    ROUTERS_SERVICIO_POOL_V6_PD_PREFIJO: '2001:db8:200::/40',
    ROUTERS_SERVICIO_PORTAL_V4: '192.0.2.20',
    ROUTERS_SERVICIO_PORTAL_V6: '2001:db8:ffff::20',
    ROUTERS_SERVICIO_PORTAL_FQDN: 'portal.argosisp.example',
}

test.group('Velocidad del suspendido por defecto', () => {
    test('2M/2M por defecto: deja cargar /corte (1,2 MB) en segundos', ({ assert }) => {
        assert.equal(RATE_LIMIT_SUSPENDIDO_DEFECTO, '2M/2M')
        const [subida, bajada] = normalizarValor(RATE_LIMIT_SUSPENDIDO_DEFECTO).split('/').map(Number)
        assert.isAtLeast(subida!, 1_000_000)
        // 1,2 MB de /corte sin comprimir (build de 1.19.0) en menos de 10 s
        assert.isBelow((1.2e6 * 8) / bajada!, 10)
    })

    test('perfil `suspendido` del router: el valor por defecto, o el del entorno si se fija', ({
        assert,
    }) => {
        const perfil = (entorno: NodeJS.ProcessEnv) =>
            estadoCorteRouter(configCorte(entorno), { fasttrack: true, redes_v4: [] }, []).nombrados.find(
                (n) => n.ruta === '/ppp/profile',
            )!.propiedades['rate-limit']
        assert.equal(configCorte({}).susp_rate_limit, '2M/2M')
        assert.equal(perfil({}), '2M/2M')
        // Vacía cuenta como no definida (los compose pasan `${AAA_SUSPENDIDO_RATE_LIMIT:-…}`)
        assert.equal(perfil({ ROUTEROS_SUSPENDIDO_RATE_LIMIT: ' ' }), '2M/2M')
        assert.equal(perfil({ ROUTEROS_SUSPENDIDO_RATE_LIMIT: '4M/4M' }), '4M/4M')
        assert.equal(
            perfil({ ROUTERS_SERVICIO_SUSP_RATE_LIMIT: '1M/1M', ROUTEROS_SUSPENDIDO_RATE_LIMIT: '4M/4M' }),
            '1M/1M',
        )
    })

    test('script del router (`susp_rate_limit`): el mismo valor por defecto', ({ assert }) => {
        const valores = valoresServicio({ interfaz_clientes: 'ether2' }, ['10.10.0.1'], ENTORNO_SERVICIO)
        assert.equal(valores.susp_rate_limit, '2M/2M')
        const fijado = valoresServicio({ interfaz_clientes: 'ether2' }, ['10.10.0.1'], {
            ...ENTORNO_SERVICIO,
            ROUTEROS_SUSPENDIDO_RATE_LIMIT: '512k/512k',
        })
        assert.equal(fijado.susp_rate_limit, '512k/512k')
    })
})
