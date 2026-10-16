import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, unico, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila, crearEscenarioRouter, crearPlanFila } from '#tests/core/fabricas'

/** Todo lo que `audit.*` guardó para esas peticiones, como texto. */
async function auditoriaDe(requestIds: string[]): Promise<string> {
    const [acciones, cambios, outbox] = await Promise.all([
        db.from('audit.acciones').whereIn('request_id', requestIds),
        db.from('audit.cambios').whereIn('request_id', requestIds),
        db.from('audit.outbox').whereIn('request_id', requestIds),
    ])
    exigir(acciones.length > 0, 'sin filas de audit.acciones')
    return JSON.stringify({ acciones, cambios, outbox })
}

function exigir(condicion: boolean, mensaje: string): asserts condicion {
    if (!condicion) throw new Error(mensaje)
}

async function cambiosDe(requestId: string) {
    return db.from('audit.cambios').where('request_id', requestId).orderBy('id')
}

async function camposDe(requestId: string): Promise<string[]> {
    const filas = await cambiosDe(requestId)
    return filas.map((c) => c.campo as string)
}

/** `core.servicios.pass_ppp` tal como está guardada (cifrada v1). */
async function cifradaDe(id: number): Promise<string> {
    const fila = await db.from('core.servicios').where('id', id).select('pass_ppp').firstOrFail()
    return fila.pass_ppp as string
}

test.group('Auditoría · nombres de campo y pass_ppp en servicios', () => {
    test('editar IPs deja ipv4, prefijo_enlace_v6 y prefijo_delegado_v6 (sin ipv_4)', async ({
        client,
        assert,
    }) => {
        const { token, usuario } = await usuarioConRoles(['admin'])
        const uno = await crearEscenarioRouter()
        const dos = await crearEscenarioRouter()
        const planId = await crearPlanFila({ bajada_limitada_kbps: 1024, subida_limitada_kbps: 512 })
        const clienteId = await crearClienteFila()

        const alta = unico('req')
        const creado = await estado(
            client.post('/api/v1/servicios').bearerToken(token).header('X-Request-Id', alta).json({
                plantilla_facturacion_id: null,
                cliente_id: clienteId,
                router_id: uno.routerId,
                plan_id: planId,
            }),
            201,
        )
        const servicio = creado.body()
        const camposAlta = await camposDe(alta)
        assert.includeMembers(camposAlta, ['ipv4', 'prefijo_enlace_v6', 'prefijo_delegado_v6', 'ipv6_modo'])

        // cambio de IPv4 en el mismo router
        const ip = unico('req')
        await estado(
            client
                .put(`/api/v1/servicios/${servicio.id}`)
                .bearerToken(token)
                .header('X-Request-Id', ip)
                .json({ version: 1, ipv4: `${uno.base}.50` }),
            200,
        )
        const cambiosIp = await cambiosDe(ip)
        assert.deepEqual(
            cambiosIp.map((c) => ({ campo: c.campo, antes: c.antes, despues: c.despues })),
            [{ campo: 'ipv4', antes: `${uno.base}.2`, despues: `${uno.base}.50` }],
        )

        // mover de router cambia IPv4 y los dos prefijos
        const mover = unico('req')
        await estado(
            client
                .put(`/api/v1/servicios/${servicio.id}`)
                .bearerToken(token)
                .header('X-Request-Id', mover)
                .json({ version: 2, router_id: dos.routerId }),
            200,
        )
        const movidos = await cambiosDe(mover)
        const porCampo = Object.fromEntries(movidos.map((c) => [c.campo, c]))
        assert.includeMembers(Object.keys(porCampo), [
            'ipv4',
            'prefijo_enlace_v6',
            'prefijo_delegado_v6',
            'router_id',
        ])
        assert.equal(porCampo.prefijo_enlace_v6.antes, `${uno.raiz}00::/64`)
        assert.equal(porCampo.prefijo_enlace_v6.despues, `${dos.raiz}00::/64`)

        const todos = await db.from('audit.cambios').whereIn('request_id', [alta, ip, mover]).select('campo')
        assert.isFalse(
            todos.some((c) => /_[0-9]/.test(c.campo as string)),
            'ningún campo con dígitos separados',
        )

        // la bitácora expone los mismos nombres y el nombre del actor
        const pagina = await estado(
            client.get('/api/v1/bitacora/cambios').bearerToken(token).qs({ request_id: mover }),
            200,
        )
        const filas = pagina.body().data as Array<{ campo: string; actor_nombre: string | null }>
        assert.includeMembers(
            filas.map((f) => f.campo),
            ['ipv4', 'prefijo_enlace_v6'],
        )
        assert.isTrue(filas.every((f) => f.actor_nombre === usuario.nombre))
    })

    test('pass_ppp: alta, cambio de contraseña y ver_credenciales nunca dejan el valor en audit.*', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const { routerId } = await crearEscenarioRouter()
        const planId = await crearPlanFila()
        const clienteId = await crearClienteFila()
        const claveAlta = unico('ClaveAlta')
        const claveNueva = unico('ClaveNueva')

        // alta con contraseña explícita
        const alta = unico('req')
        const creado = await estado(
            client.post('/api/v1/servicios').bearerToken(token).header('X-Request-Id', alta).json({
                plantilla_facturacion_id: null,
                cliente_id: clienteId,
                router_id: routerId,
                plan_id: planId,
                pass_ppp: claveAlta,
            }),
            201,
        )
        const id = creado.body().id as number
        const cifradaAlta = await cifradaDe(id)

        // alta sin contraseña: la API la genera
        const altaGenerada = unico('req')
        const generado = await estado(
            client.post('/api/v1/servicios').bearerToken(token).header('X-Request-Id', altaGenerada).json({
                plantilla_facturacion_id: null,
                cliente_id: clienteId,
                router_id: routerId,
                plan_id: planId,
            }),
            201,
        )
        const idGenerado = generado.body().id as number
        const cifradaGenerada = await cifradaDe(idGenerado)

        // las dos altas dejan pass_ppp = *** en audit.cambios
        for (const [requestId, servicioId] of [
            [alta, id],
            [altaGenerada, idGenerado],
        ] as const) {
            const fila = await db
                .from('audit.cambios')
                .where({
                    request_id: requestId,
                    entidad_tipo: 'servicio',
                    entidad_id: servicioId,
                    campo: 'pass_ppp',
                })
                .firstOrFail()
            assert.isNull(fila.antes)
            assert.equal(fila.despues, '***')
        }
        // y la bitácora del servicio la muestra
        const bitacora = await estado(
            client
                .get('/api/v1/bitacora/cambios')
                .bearerToken(token)
                .qs({ entidad_tipo: 'servicio', entidad_id: idGenerado }),
            200,
        )
        const clave = (bitacora.body().data as Array<{ campo: string; despues: unknown }>).find(
            (c) => c.campo === 'pass_ppp',
        )
        assert.equal(clave?.despues, '***')

        // cambio de contraseña
        const edicion = unico('req')
        await estado(
            client
                .put(`/api/v1/servicios/${id}`)
                .bearerToken(token)
                .header('X-Request-Id', edicion)
                .json({ version: 1, pass_ppp: claveNueva }),
            200,
        )
        const cifradaNueva = await cifradaDe(id)
        assert.notEqual(cifradaNueva, cifradaAlta)
        const camposEdicion = await camposDe(edicion)
        assert.include(camposEdicion, 'clave_ppp_cambiada')
        assert.notInclude(camposEdicion, 'pass_ppp')

        // ver credenciales devuelve la clave en claro, pero no la audita
        const ver = unico('req')
        const credenciales = await estado(
            client.get(`/api/v1/servicios/${id}/credenciales`).bearerToken(token).header('X-Request-Id', ver),
            200,
        )
        assert.equal(credenciales.body().pass_ppp, claveNueva)
        const accionVer = await db.from('audit.acciones').where('request_id', ver).firstOrFail()
        assert.equal(accionVer.accion, 'servicios.ver_credenciales')

        const texto = await auditoriaDe([alta, altaGenerada, edicion, ver])
        for (const secreto of [claveAlta, claveNueva, cifradaAlta, cifradaNueva, cifradaGenerada]) {
            assert.notInclude(texto, secreto)
        }
        assert.notMatch(texto, /v1\.[A-Za-z0-9_-]{8,}/)
    })
})
