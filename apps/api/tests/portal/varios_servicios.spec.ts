import { test } from '@japa/runner'
import { estado, unico } from '#tests/ayudas'
import {
    EnviadorFalso,
    crearServicio,
    crearSesion,
    sesionDirecta,
    usarEnviadorCodigo,
} from '#tests/portal/ayudas_portal'

/**
 * Piloto (semana 3, tarea 2): un cliente con varios servicios. Desde la IP, cada servicio se ve
 * solo con su estado y su deuda (la página de corte reactiva un servicio, no al cliente); con la
 * sesión, la cuenta trae cada servicio con su saldo y el total.
 */

/** Cuerpo de una respuesta 200. */
async function leer(peticion: Parameters<typeof estado>[0]) {
    const respuesta = await estado(peticion, 200)
    return respuesta.body()
}

const VARIABLES = [
    'PORTAL_PROXIES_CONFIABLES',
    'PORTAL_REDIS_PREFIJO',
    'PORTAL_LIMITE_PETICIONES',
    'PORTAL_CABECERA_IP',
] as const

test.group('Portal: cliente con varios servicios', (group) => {
    let enviador: EnviadorFalso

    group.each.setup(() => {
        const previo = Object.fromEntries(VARIABLES.map((v) => [v, process.env[v]]))
        process.env.PORTAL_PROXIES_CONFIABLES = '127.0.0.1/32, ::1'
        process.env.PORTAL_REDIS_PREFIJO = unico('prueba-varios')
        delete process.env.PORTAL_LIMITE_PETICIONES
        delete process.env.PORTAL_CABECERA_IP
        enviador = new EnviadorFalso()
        usarEnviadorCodigo(enviador)
        return () => {
            usarEnviadorCodigo(undefined)
            for (const variable of VARIABLES) {
                if (previo[variable] === undefined) delete process.env[variable]
                else process.env[variable] = previo[variable]
            }
        }
    })

    /** Servicio A suspendido con deuda (IPv4) y servicio B activo al día (IPv6) del mismo cliente. */
    async function dosServicios() {
        const a = await crearServicio({ estado: 'suspendido', nombre: 'Rosa Elena Batz' })
        const b = await crearServicio({ estado: 'activo', clienteId: a.clienteId, sinFacturas: true })
        await crearSesion(a, { ipv4: '198.51.107.10' })
        await crearSesion(b, { ipv4: '198.51.107.20', delegado: '2001:db8:5a7::/56' })
        return { a, b }
    }

    test('quien-soy y estado: cada IP ve su servicio y solo su deuda', async ({ client, assert }) => {
        await dosServicios()

        const a = await leer(
            client.get('/api/v1/portal/quien-soy').header('X-Forwarded-For', '198.51.107.10'),
        )
        assert.equal(a.estado, 'suspendido')
        assert.equal(a.monto_adeudado, '399.75')
        assert.deepEqual(a.facturas_vencidas, { cantidad: 2, total: '299.75' })

        for (const ip of ['198.51.107.20', '2001:db8:5a7:7::abc']) {
            const b = await leer(client.get('/api/v1/portal/quien-soy').header('X-Forwarded-For', ip))
            assert.equal(b.nombre_parcial, 'Rosa E.')
            assert.equal(b.estado, 'activo', ip)
            // La deuda del otro servicio no se suma: este servicio está al día.
            assert.equal(b.monto_adeudado, '0.00', ip)
            assert.deepEqual(b.facturas_vencidas, { cantidad: 0, total: '0.00' })

            const vivo = await leer(client.get('/api/v1/portal/estado').header('X-Forwarded-For', ip))
            assert.deepEqual(vivo, { identificado: true, estado: 'activo', monto_adeudado: '0.00' })
        }
    })

    test('el código pedido desde cualquiera de las dos IPs va al mismo cliente', async ({
        client,
        assert,
    }) => {
        await dosServicios()
        for (const ip of ['198.51.107.10', '2001:db8:5a7::1']) {
            const respuesta = await estado(
                client.post('/api/v1/portal/codigo').header('X-Forwarded-For', ip).json({ por_ip: true }),
                202,
            )
            const { destino } = respuesta.body()
            assert.equal(destino, 'm***a@e***.com')
        }
        assert.lengthOf(enviador.mensajes, 2)
        assert.equal(enviador.mensajes[0]!.destino, enviador.mensajes[1]!.destino)
    })

    test('con la sesión: cada servicio con su saldo y el total es la suma', async ({ client, assert }) => {
        const { a, b } = await dosServicios()
        const { cookie } = await sesionDirecta(a.clienteId)
        const cuenta = await leer(client.get('/api/v1/portal/cuenta').header('Cookie', cookie))
        assert.deepEqual(
            cuenta.servicios.map((s: { id: number; estado: string; monto_adeudado: string }) => [
                s.id,
                s.estado,
                s.monto_adeudado,
            ]),
            [
                [a.servicioId, 'suspendido', '399.75'],
                [b.servicioId, 'activo', '0.00'],
            ],
        )
        assert.equal(cuenta.monto_adeudado, '399.75')
    })
})
