import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { sustituirCanal, quitarSustitutos } from '#notify/configuracion'
import type { Canal } from '#notify/canales/canal'
import CanjearCodigoIdentificacion from '#core/actions/canjear_codigo_identificacion'
import { contextoPrueba, estado, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila, crearEscenarioRouter, crearPlanFila } from '#tests/core/fabricas'

/**
 * Decisiones del PM 17 (retiro), 19 (código para identificarse), 22 (recuperar la contraseña y botones
 * de Iris y Horus) y los ajustes de operación que las configuran.
 */

async function limpiarAjustes() {
    await db.from('core.ajustes_operacion').delete()
}

async function crearServicio(client: any, token: string) {
    const red = await crearEscenarioRouter()
    const r = await estado(
        client
            .post('/api/v1/servicios')
            .bearerToken(token)
            .json({
                plantilla_facturacion_id: null,
                cliente_id: await crearClienteFila(),
                router_id: red.routerId,
                plan_id: await crearPlanFila(),
            }),
        201,
    )
    return r.body() as Record<string, any>
}

async function ultimoEvento(nombre: string, servicioId: number) {
    const fila = (await db
        .from('audit.outbox')
        .where('evento', nombre)
        .whereRaw(`payload->>'servicio_id' = ?`, [String(servicioId)])
        .orderBy('id', 'desc')
        .select('payload')
        .first()) as { payload: Record<string, any> } | null
    return fila?.payload ?? null
}

test.group('Ajustes de operación', (group) => {
    group.each.setup(limpiarAjustes)
    group.teardown(limpiarAjustes)

    test('valores de fábrica, global y por empresa; 422 fuera de límites; evento y auditoría', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const r = await estado(client.get('/api/v1/ajustes-operacion').bearerToken(token), 200)
        assert.equal(r.body().efectivo['codigo_corte.vigencia_min'], 15)
        assert.equal(r.body().efectivo['caidas.umbral'], 3)
        assert.equal(r.body().efectivo['caidas.ventana_min'], 60)
        assert.isTrue(r.body().efectivo['retiro.orden_iris'])
        assert.equal(r.body().efectivo['ip_historial.retencion_dias'], 730)

        const malo = await estado(
            client
                .put('/api/v1/ajustes-operacion')
                .bearerToken(token)
                .json({ valores: { 'codigo_corte.vigencia_min': 90 } }),
            422,
        )
        assert.equal(malo.body().errors[0].field, 'valores.codigo_corte.vigencia_min')
        await estado(
            client
                .put('/api/v1/ajustes-operacion')
                .bearerToken(token)
                .json({ empresa_id: 1, valores: { 'retiro.orden_iris': false } }),
            422,
        )

        await estado(
            client
                .put('/api/v1/ajustes-operacion')
                .bearerToken(token)
                .json({ valores: { 'codigo_corte.vigencia_min': 20 } }),
            200,
        )
        const empresa = await estado(
            client
                .put('/api/v1/ajustes-operacion')
                .bearerToken(token)
                .json({ empresa_id: 1, valores: { 'codigo_corte.vigencia_min': 30 } }),
            200,
        )
        assert.equal(empresa.body().efectivo['codigo_corte.vigencia_min'], 30)
        assert.equal(empresa.body().global['codigo_corte.vigencia_min'], 20)
        const evento = (await db
            .from('audit.outbox')
            .where('evento', 'operacion.config_cambiada')
            .orderBy('id', 'desc')
            .select('payload')
            .first()) as { payload: Record<string, unknown> }
        assert.deepEqual(evento.payload, { empresa_id: 1, claves: ['codigo_corte.vigencia_min'] })
        const cambio = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'ajustes_operacion', entidad_id: 1 })
            .orderBy('id', 'desc')
            .first()
        assert.exists(cambio)

        // null vuelve al global
        const vuelta = await estado(
            client
                .put('/api/v1/ajustes-operacion')
                .bearerToken(token)
                .json({ empresa_id: 1, valores: { 'codigo_corte.vigencia_min': null } }),
            200,
        )
        assert.equal(vuelta.body().efectivo['codigo_corte.vigencia_min'], 20)

        const soporte = await usuarioConRoles(['soporte'])
        await estado(client.get('/api/v1/ajustes-operacion').bearerToken(soporte.token), 403)
    })
})

test.group('Retiro con orden de retiro (decisión 17)', (group) => {
    group.each.setup(limpiarAjustes)
    group.teardown(limpiarAjustes)

    test('de fábrica recupera el equipo; la casilla y el ajuste lo omiten', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['admin'])
        const a = await crearServicio(client, token)
        await estado(
            client.post(`/api/v1/servicios/${a.id}/retirar`).bearerToken(token).json({ motivo: 'baja' }),
            200,
        )
        const ea = await ultimoEvento('servicio.estado_cambiado', a.id)
        assert.equal(ea!.a, 'retirado')
        assert.isTrue(ea!.recuperar_equipo)
        assert.isFalse(ea!.equipo_entregado)

        const b = await crearServicio(client, token)
        await estado(
            client
                .post(`/api/v1/servicios/${b.id}/retirar`)
                .bearerToken(token)
                .json({ motivo: 'baja', equipo_entregado: true }),
            200,
        )
        const eb = await ultimoEvento('servicio.estado_cambiado', b.id)
        assert.isFalse(eb!.recuperar_equipo)
        assert.isTrue(eb!.equipo_entregado)
        const fila = await db.from('core.servicios_retiros').where('servicio_id', b.id).first()
        assert.isFalse(fila.recuperar_equipo)

        await estado(
            client
                .put('/api/v1/ajustes-operacion')
                .bearerToken(token)
                .json({ valores: { 'retiro.orden_iris': false } }),
            200,
        )
        const c = await crearServicio(client, token)
        await estado(
            client.post(`/api/v1/servicios/${c.id}/retirar`).bearerToken(token).json({ motivo: 'baja' }),
            200,
        )
        assert.isFalse((await ultimoEvento('servicio.estado_cambiado', c.id))!.recuperar_equipo)
    })
})

test.group('Código para identificarse en el portal (decisión 19)', (group) => {
    group.each.setup(limpiarAjustes)
    group.teardown(limpiarAjustes)

    test('6 dígitos, 15 min de fábrica (o el de la empresa), un solo uso, nunca en eventos ni auditoría', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const admin = await usuarioConRoles(['admin'])
        const servicio = await crearServicio(client, admin.token)
        const r = await estado(
            client.post(`/api/v1/servicios/${servicio.id}/codigo-identificacion`).bearerToken(token),
            201,
        )
        const { codigo, expira_en: expira, vigencia_min: vigencia } = r.body()
        assert.match(codigo, /^\d{6}$/)
        assert.equal(vigencia, 15)
        const minutos = (new Date(expira).getTime() - Date.now()) / 60_000
        assert.isAbove(minutos, 14)
        assert.isBelow(minutos, 15.5)

        const evento = await ultimoEvento('servicio.codigo_identificacion_emitido', servicio.id)
        assert.notInclude(JSON.stringify(evento), codigo)
        const accion = await db
            .from('audit.acciones')
            .where({ accion: 'servicios.generar_codigo_identificacion', entidad_id: servicio.id })
            .first()
        assert.notInclude(JSON.stringify(accion.entrada), codigo)

        const canje = await new CanjearCodigoIdentificacion().execute({ codigo }, contextoPrueba())
        assert.equal(canje.servicio_id, servicio.id)
        const otra = await new CanjearCodigoIdentificacion().execute({ codigo }, contextoPrueba())
        assert.isNull(otra.servicio_id)

        await db.table('core.ajustes_operacion').insert({
            empresa_id: servicio.empresa_id,
            clave: 'codigo_corte.vigencia_min',
            valor: JSON.stringify(30),
        })
        const r2 = await estado(
            client.post(`/api/v1/servicios/${servicio.id}/codigo-identificacion`).bearerToken(token),
            201,
        )
        assert.equal(r2.body().vigencia_min, 30)
        // el nuevo anula el anterior vigente
        const vigentes = await db
            .from('core.codigos_identificacion')
            .where('servicio_id', servicio.id)
            .whereNull('usado_en')
            .whereNull('anulado_en')
        assert.lengthOf(vigentes, 1)

        const lectura = await usuarioConRoles(['lectura'])
        await estado(
            client.post(`/api/v1/servicios/${servicio.id}/codigo-identificacion`).bearerToken(lectura.token),
            403,
        )
    })
})

test.group('Recuperar la contraseña (decisión 22)', (group) => {
    const enviados: Array<{ destino: string; cuerpo: string }> = []
    const falso: Canal = {
        nombre: 'correo',
        async enviar(destino, _asunto, cuerpo) {
            enviados.push({ destino, cuerpo })
            return { id: `falso-${enviados.length}` }
        },
        async estado() {
            return { estado: 'entregado' } as never
        },
    }
    // el límite por IP comparte Redis entre corridas (127.0.0.1): se apaga aquí y se prueba el de correo
    const limiteIp = process.env.RECUPERAR_CONTRASENA_LIMITE_IP
    group.setup(() => {
        process.env.RECUPERAR_CONTRASENA_LIMITE_IP = '0'
    })
    group.each.setup(async () => {
        await limpiarAjustes()
        enviados.length = 0
        sustituirCanal('correo', falso)
    })
    group.teardown(async () => {
        quitarSustitutos()
        await limpiarAjustes()
        if (limiteIp === undefined) delete process.env.RECUPERAR_CONTRASENA_LIMITE_IP
        else process.env.RECUPERAR_CONTRASENA_LIMITE_IP = limiteIp
    })

    test('misma respuesta exista o no el correo; enlace de un solo uso; cierra las sesiones', async ({
        client,
        assert,
    }) => {
        const { usuario, token } = await usuarioConRoles(['soporte'])
        const existe = await estado(
            client.post('/api/v1/auth/recuperar-contrasena').json({ email: usuario.email }),
            202,
        )
        const noExiste = await estado(
            client.post('/api/v1/auth/recuperar-contrasena').json({ email: 'nadie@prueba.local' }),
            202,
        )
        assert.deepEqual(existe.body(), noExiste.body())
        assert.lengthOf(enviados, 1)
        assert.equal(enviados[0]!.destino, usuario.email)
        const token1 = /#token=([A-Za-z0-9_-]+)/.exec(enviados[0]!.cuerpo)![1]!
        const fila = await db.from('core.recuperaciones_contrasena').where('usuario_id', usuario.id).first()
        assert.notEqual(fila.token_hash, token1)
        assert.notInclude(
            JSON.stringify(
                await db
                    .from('audit.outbox')
                    .where('evento', 'usuario.recuperacion_solicitada')
                    .orderBy('id', 'desc')
                    .first(),
            ),
            token1,
        )

        // un pedido nuevo anula el anterior
        await estado(client.post('/api/v1/auth/recuperar-contrasena').json({ email: usuario.email }), 202)
        const token2 = /#token=([A-Za-z0-9_-]+)/.exec(enviados[1]!.cuerpo)![1]!
        const viejo = await estado(
            client
                .post('/api/v1/auth/restablecer-contrasena')
                .json({ token: token1, password: 'nueva-clave-1' }),
            422,
        )
        assert.equal(viejo.body().type, 'urn:argosisp:problema:enlace_invalido')

        const ok = await estado(
            client
                .post('/api/v1/auth/restablecer-contrasena')
                .json({ token: token2, password: 'nueva-clave-1' }),
            200,
        )
        assert.equal(ok.body().usuario_id, usuario.id)
        assert.isAtLeast(ok.body().sesiones_cerradas, 1)
        await estado(client.get('/api/v1/me').bearerToken(token), 401)
        await estado(
            client.post('/api/v1/auth/login').json({ email: usuario.email, password: 'nueva-clave-1' }),
            200,
        )
        await estado(
            client
                .post('/api/v1/auth/restablecer-contrasena')
                .json({ token: token2, password: 'otra-clave-22' }),
            422,
        )
        const accion = await db
            .from('audit.acciones')
            .where({ accion: 'auth.restablecer_contrasena', actor_id: usuario.id })
            .first()
        assert.notInclude(JSON.stringify(accion.entrada), token2)
        assert.notInclude(JSON.stringify(accion.entrada), 'nueva-clave-1')
    })

    test('el admin la apaga; /auth/opciones dice qué botones mostrar', async ({ client, assert }) => {
        const opciones = await estado(client.get('/api/v1/auth/opciones'), 200)
        assert.containsSubset(opciones.body(), { recuperar_contrasena: true })
        assert.isBoolean(opciones.body().iris)
        assert.isBoolean(opciones.body().horus)

        const { token } = await usuarioConRoles(['admin'])
        await estado(
            client
                .put('/api/v1/ajustes-operacion')
                .bearerToken(token)
                .json({ valores: { 'auth.recuperar_contrasena': false } }),
            200,
        )
        const apagada = await estado(
            client.post('/api/v1/auth/recuperar-contrasena').json({ email: 'x@prueba.local' }),
            404,
        )
        assert.equal(apagada.body().type, 'urn:argosisp:problema:recuperacion_apagada')
        const despues = await estado(client.get('/api/v1/auth/opciones'), 200)
        assert.isFalse(despues.body().recuperar_contrasena)
    })

    test('límite por correo: 429 al pasarse del tope en la ventana', async ({ client }) => {
        const anterior = process.env.RECUPERAR_CONTRASENA_LIMITE_USUARIO
        process.env.RECUPERAR_CONTRASENA_LIMITE_USUARIO = '2'
        try {
            const email = `limite-${Date.now()}@prueba.local`
            await estado(client.post('/api/v1/auth/recuperar-contrasena').json({ email }), 202)
            await estado(client.post('/api/v1/auth/recuperar-contrasena').json({ email }), 202)
            await estado(client.post('/api/v1/auth/recuperar-contrasena').json({ email }), 429)
        } finally {
            if (anterior === undefined) delete process.env.RECUPERAR_CONTRASENA_LIMITE_USUARIO
            else process.env.RECUPERAR_CONTRASENA_LIMITE_USUARIO = anterior
        }
    })
})
