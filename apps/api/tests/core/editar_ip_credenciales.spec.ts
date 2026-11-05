import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, unico, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila, crearEscenarioRouter, crearPlanFila } from '#tests/core/fabricas'
import { limpiarClavesAaa } from '#tests/core/ayudas_aaa'

/**
 * Editar o quitar la IPv4 y las credenciales PPPoE (pedido del PM, 5 nov; fila de A4 en `a4.md`):
 * `ipv4: null` deja un PPPoE en el pool, `user_ppp` se cambia con unicidad y cambiar usuario o
 * contraseña emite `servicio.config_cambiada` con `credenciales`, sin valores.
 */

async function leer(peticion: PromiseLike<any>, status: number) {
    const respuesta = await estado(peticion, status)
    return respuesta.body()
}

async function eventos(requestId: string) {
    const filas = await db.from('audit.outbox').where('request_id', requestId).orderBy('id')
    return filas.map((f) => ({ evento: f.evento as string, payload: f.payload }))
}

async function evento(requestId: string, nombre: string) {
    const todos = await eventos(requestId)
    return todos.find((e) => e.evento === nombre)
}

test.group('Servicios · editar IPv4 y credenciales', (group) => {
    let token: string
    let routerId: number
    let planId: number
    let clienteId: number
    group.setup(async () => {
        await limpiarClavesAaa()
        ;({ token } = await usuarioConRoles(['soporte']))
        ;({ routerId } = await crearEscenarioRouter())
        planId = await crearPlanFila()
        clienteId = await crearClienteFila({ nombre: 'Lucía Credenciales' })
    })

    const crear = (client: any) =>
        leer(
            client.post('/api/v1/servicios').bearerToken(token).json({
                plantilla_facturacion_id: null,
                cliente_id: clienteId,
                router_id: routerId,
                plan_id: planId,
            }),
            201,
        )

    const editar = (client: any, id: number, cuerpo: Record<string, unknown>, requestId = unico('req')) =>
        client
            .put(`/api/v1/servicios/${id}`)
            .bearerToken(token)
            .header('X-Request-Id', requestId)
            .json(cuerpo)

    test('ipv4: null en pppoe la libera en IPAM y no vuelve a fijarse', async ({ client, assert }) => {
        const s = await crear(client)
        assert.isString(s.ipv4)
        const requestId = unico('req')
        const r = await leer(editar(client, s.id, { version: s.version, ipv4: null }, requestId), 200)
        assert.isNull(r.ipv4)
        const vigente = await db
            .from('network.ipv4_asignaciones')
            .where('servicio_id', s.id)
            .whereNull('fin')
            .first()
        assert.isNull(vigente)
        const config = await evento(requestId, 'servicio.config_cambiada')
        assert.include(config!.payload.campos, 'ips')
        const asignacion = await evento(requestId, 'asignacion.cambiada')
        assert.deepEqual(asignacion!.payload.ipv4, [])

        // otra edición no le vuelve a dar una IP de las redes del router
        const otra = await leer(editar(client, s.id, { version: r.version, direccion: 'Zona 4' }), 200)
        assert.isNull(otra.ipv4)
        // y se le puede volver a fijar una
        const fija = await leer(editar(client, s.id, { version: otra.version, ipv4: s.ipv4 }), 200)
        assert.equal(fija.ipv4, s.ipv4)
    })

    test('ipv4: null sin PPPoE: 422 en ipv4', async ({ client, assert }) => {
        const esc = await crearEscenarioRouter({ tipo_conexion: 'ip_estatica' })
        const s = await leer(
            client.post('/api/v1/servicios').bearerToken(token).json({
                plantilla_facturacion_id: null,
                cliente_id: clienteId,
                router_id: esc.routerId,
                plan_id: planId,
            }),
            201,
        )
        const r = await leer(editar(client, s.id, { version: s.version, ipv4: null }), 422)
        assert.equal(r.errors[0].field, 'ipv4')
        const u = await leer(editar(client, s.id, { version: s.version, user_ppp: 'nuevo.usuario' }), 422)
        assert.equal(u.errors[0].field, 'user_ppp')
    })

    test('cambiar user_ppp: único (409), lápida en la clave vieja y config_cambiada con credenciales', async ({
        client,
        assert,
    }) => {
        const a = await crear(client)
        const b = await crear(client)
        const repetido = await leer(editar(client, a.id, { version: a.version, user_ppp: b.user_ppp }), 409)
        assert.equal(String(repetido.type).split(':').pop(), 'user_ppp_duplicado')

        const nuevo = unico('lucia').replace('-', '.')
        const requestId = unico('req')
        const r = await leer(editar(client, a.id, { version: a.version, user_ppp: nuevo }, requestId), 200)
        assert.equal(r.user_ppp, nuevo)
        const config = await evento(requestId, 'servicio.config_cambiada')
        assert.deepEqual(config!.payload.campos, ['credenciales'])
        assert.notInclude(JSON.stringify(config!.payload), nuevo)
        const diff = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'servicio', entidad_id: a.id, campo: 'user_ppp' })
            .orderBy('id', 'desc')
            .first()
        assert.deepEqual([diff.antes, diff.despues], [a.user_ppp, nuevo])
    })

    test('cambiar pass_ppp: config_cambiada con credenciales y la contraseña fuera de audit.*', async ({
        client,
        assert,
    }) => {
        const s = await crear(client)
        const clave = 'ClaveNueva-2026'
        const requestId = unico('req')
        const previo = await db.from('audit.cambios').max('id as id').first()
        await leer(editar(client, s.id, { version: s.version, pass_ppp: clave }, requestId), 200)
        const config = await evento(requestId, 'servicio.config_cambiada')
        assert.deepEqual(config!.payload.campos, ['credenciales'])
        // la contraseña nunca llega a audit.cambios (ni como ***): solo `clave_ppp_cambiada`
        const cambios = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'servicio', entidad_id: s.id })
            .where('id', '>', Number(previo?.id ?? 0))
            .select('campo')
        const nombres = cambios.map((c) => c.campo as string)
        assert.include(nombres, 'clave_ppp_cambiada')
        assert.notInclude(nombres, 'pass_ppp')
        const acciones = await db.from('audit.acciones').where('request_id', requestId)
        const outbox = await eventos(requestId)
        assert.notInclude(JSON.stringify(acciones), clave)
        assert.notInclude(JSON.stringify(outbox), clave)
    })
})
