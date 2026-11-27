import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import { contextoPrueba, estado, unico, usuarioConRoles } from '#tests/ayudas'
import { afirmarLibroCuadrado } from '#tests/ledger/ayudas_libro'
import { eventosDe, servicioCortado } from '#tests/billing/ayudas_billing'
import { crearEmpresaFila } from '#tests/core/fabricas'
import { soloEmpresaPrincipal } from '#tests/ayudas'
import { CABECERA_FIRMA, PasarelaFalsa, firmar } from '#billing/pasarelas/falsa'
import { resolverFuente } from '#billing/pasarelas/cuentas'
import { PasarelaNoConfigurada } from '#billing/pasarelas/pasarela'
import { ejecutarCron } from '#billing/jobs'
import CrearCobroPasarela from '#billing/actions/crear_cobro_pasarela'
import ConciliarPasarela from '#billing/actions/conciliar_pasarela'
import SembrarCuentaPasarela from '#billing/actions/sembrar_cuenta_pasarela'
import CrearCuentaPasarela from '#billing/actions/crear_cuenta_pasarela'
import ActivarCuentaPasarela from '#billing/actions/activar_cuenta_pasarela'
import ProbarCuentaPasarela from '#billing/actions/probar_cuenta_pasarela'
import { hoyGuatemala } from '#ledger/fechas'

/**
 * D0 · cuentas de pasarela por empresa y proveedor. Las llaves de estas pruebas son inventadas.
 * `billing.pasarela_cuentas` se vacía antes y después de cada prueba: con una cuenta en la base el
 * resto de la suite ya no usaría el entorno como respaldo.
 */

const LLAVE_A = 'sk_test_LLAVE_DE_PRUEBA_A_0001'
const LLAVE_B = 'sk_test_LLAVE_DE_PRUEBA_B_0002'
const WEBHOOK_A = 'whsec_SECRETO_WEBHOOK_PRUEBA_A_0003'

async function limpiarCuentas() {
    await db.rawQuery(`
        UPDATE billing.pasarela_cobros SET pasarela_cuenta_id = NULL WHERE pasarela_cuenta_id IS NOT NULL;
        UPDATE billing.pasarela_eventos SET pasarela_cuenta_id = NULL WHERE pasarela_cuenta_id IS NOT NULL;
        UPDATE billing.pasarela_conciliaciones SET pasarela_cuenta_id = NULL WHERE pasarela_cuenta_id IS NOT NULL;
        DELETE FROM billing.pasarela_cuentas;
    `)
}

/** `fetch` simulado (el adaptador de Recurrente lo toma del global); guarda llave y ruta de cada llamada. */
async function conFetch<T>(
    responder: (ruta: string, llave: string) => { status?: number; cuerpo: unknown },
    fn: (llamadas: Array<{ ruta: string; llave: string }>) => Promise<T>,
): Promise<T> {
    const original = globalThis.fetch
    const llamadas: Array<{ ruta: string; llave: string }> = []
    globalThis.fetch = (async (url: string, init: RequestInit) => {
        const ruta = new URL(String(url)).pathname.replace(/^\/api/, '')
        const llave = (init.headers as Record<string, string>)['X-SECRET-KEY'] ?? ''
        llamadas.push({ ruta, llave })
        const { status = 200, cuerpo } = responder(ruta, llave)
        return new Response(JSON.stringify(cuerpo), { status })
    }) as typeof fetch
    try {
        return await fn(llamadas)
    } finally {
        globalThis.fetch = original
    }
}

const cobroOk = () => ({
    cuerpo: { id: `ch_${unico('c')}`, checkout_url: 'https://app.recurrente.com/checkout-session/x' },
})

async function admin() {
    const { token } = await usuarioConRoles(['admin'])
    return token
}

async function crearCuentaApi(client: any, token: string, cuerpo: Record<string, unknown>, status = 201) {
    const r = await client.post('/api/v1/pasarelas/cuentas').bearerToken(token).json(cuerpo)
    if (r.status() !== status) console.log('CREAR', r.status(), JSON.stringify(r.body()))
    return estado(Promise.resolve(r), status)
}

test.group('billing · cuentas de pasarela (D0)', (group) => {
    group.each.setup(async () => {
        await limpiarCuentas()
        return async () => {
            await limpiarCuentas()
            await soloEmpresaPrincipal()
        }
    })

    test('sin cuentas en la base el pago en línea usa el entorno, como antes', async ({ assert }) => {
        const datos = await servicioCortado()
        const cobro = await new CrearCobroPasarela().execute(
            { cliente_id: datos.clienteId },
            contextoPrueba(),
        )
        assert.equal(cobro.proveedor, 'falsa')
        assert.isNull(cobro.pasarela_cuenta_id)
        const fuente = await resolverFuente(db.connection(), 1, 'pago_en_linea')
        assert.isNull(fuente.cuenta)
        await afirmarLibroCuadrado(assert)
    })

    test('crear: cifrada, nunca en respuestas, auditoría ni eventos; permisos; duplicada 409; débito 422', async ({
        client,
        assert,
    }) => {
        const token = await admin()
        const creada = await crearCuentaApi(client, token, {
            proveedor: 'recurrente',
            alias: 'Recurrente principal',
            modo: 'pruebas',
            credenciales: { secret_key: LLAVE_A },
            webhook_secreto: WEBHOOK_A,
        })
        const cuenta = creada.body()
        assert.include(cuenta, { empresa_id: 1, proveedor: 'recurrente', activa: false, prueba_ok: false })
        assert.deepEqual(cuenta.credenciales_configuradas, ['secret_key'])
        assert.isTrue(cuenta.tiene_webhook_secreto)
        assert.deepEqual(cuenta.usos, ['pago_en_linea'])
        assert.match(
            cuenta.webhook_ruta,
            new RegExp(`^/api/v1/pasarela/webhook/recurrente/${cuenta.clave_publica}$`),
        )

        // cifradas en la fila; ni la llave ni el secreto aparecen en respuesta, auditoría ni outbox
        const fila = await db.from('billing.pasarela_cuentas').where('id', cuenta.id).firstOrFail()
        assert.match(fila.credenciales_cifradas, /^v1\./)
        assert.match(fila.webhook_secreto_cifrado, /^v1\./)
        const lista = await estado(client.get('/api/v1/pasarelas/cuentas').bearerToken(token), 200)
        const todo = JSON.stringify([
            creada.body(),
            lista.body(),
            await db
                .from('audit.acciones')
                .where('entidad_id', cuenta.id)
                .where('entidad_tipo', 'cuenta_pasarela'),
            await db
                .from('audit.cambios')
                .where('entidad_tipo', 'cuenta_pasarela')
                .where('entidad_id', cuenta.id),
            await db.from('audit.outbox').where('evento', 'pasarela.config_cambiada'),
        ])
        for (const secreto of [LLAVE_A, WEBHOOK_A]) assert.notInclude(todo, secreto)
        const cambios = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'cuenta_pasarela', entidad_id: cuenta.id, campo: 'credenciales_cifradas' })
            .firstOrFail()
        assert.equal(cambios.despues, '***')

        // evento: solo nombres de campos
        const eventos = await eventosDe('pasarela.config_cambiada', 'pasarela_cuenta_id', cuenta.id)
        assert.lengthOf(eventos, 1)
        const payload = eventos[0]!.payload
        assert.include(payload, { empresa_id: 1, proveedor: 'recurrente' })
        assert.include(payload.campos, 'credenciales_cifradas')

        // duplicada y débito
        await crearCuentaApi(
            client,
            token,
            { proveedor: 'recurrente', alias: 'Otra', credenciales: { secret_key: LLAVE_B } },
            409,
        )
        const sinDebito = await crearCuentaApi(
            client,
            token,
            { proveedor: 'falsa', alias: 'Falsa', usos: ['debito'] },
            422,
        )
        assert.equal(sinDebito.body().errors[0].rule, 'debito_no_soportado')
        // credencial desconocida y faltante
        await crearCuentaApi(
            client,
            token,
            { proveedor: 'falsa', alias: 'x2', credenciales: { otra: 'a' } },
            422,
        )
        const falta = await crearCuentaApi(
            client,
            token,
            { proveedor: 'recurrente', alias: 'Sin llave' },
            422,
        )
        assert.equal(falta.body().errors[0].rule, 'required')
    })

    test('permisos: cajero no ve; contabilidad solo ve; admin configura y prueba', async ({ client }) => {
        const tokenAdmin = await admin()
        const creada = await crearCuentaApi(client, tokenAdmin, { proveedor: 'falsa', alias: 'Lab' })
        const id = creada.body().id
        const { token: cajero } = await usuarioConRoles(['cajero'])
        const { token: contabilidad } = await usuarioConRoles(['contabilidad'])
        await estado(client.get('/api/v1/pasarelas/cuentas').bearerToken(cajero), 403)
        await estado(client.get('/api/v1/pasarelas/cuentas').bearerToken(contabilidad), 200)
        await estado(client.get('/api/v1/pasarelas/proveedores').bearerToken(contabilidad), 200)
        await estado(
            client
                .post('/api/v1/pasarelas/cuentas')
                .bearerToken(contabilidad)
                .json({ proveedor: 'falsa', alias: 'xx' }),
            403,
        )
        await estado(client.post(`/api/v1/pasarelas/cuentas/${id}/probar`).bearerToken(contabilidad), 403)
        await estado(client.post(`/api/v1/pasarelas/cuentas/${id}/activar`).bearerToken(contabilidad), 403)
        await estado(client.post(`/api/v1/pasarelas/cuentas/${id}/probar`).bearerToken(tokenAdmin), 200)
    })

    test('probar con llave mala deja prueba_ok = false y no activa; con llave buena prueba y luego activa', async ({
        client,
        assert,
    }) => {
        const token = await admin()
        const respuesta = await crearCuentaApi(client, token, {
            proveedor: 'recurrente',
            alias: 'Recurrente',
            credenciales: { secret_key: LLAVE_A },
            webhook_secreto: WEBHOOK_A,
        })
        const body = respuesta.body()
        // llave mala: 401 del proveedor; su mensaje repite la llave y no debe quedar guardado
        const mala = await conFetch(
            () => ({ status: 401, cuerpo: { message: `llave ${LLAVE_A} inválida` } }),
            async () =>
                estado(client.post(`/api/v1/pasarelas/cuentas/${body.id}/probar`).bearerToken(token), 200),
        )
        assert.isFalse(mala.body().ok)
        assert.isFalse(mala.body().cuenta.prueba_ok)
        assert.notInclude(JSON.stringify(mala.body()), LLAVE_A)
        const noActiva = await estado(
            client.post(`/api/v1/pasarelas/cuentas/${body.id}/activar`).bearerToken(token),
            422,
        )
        assert.match(noActiva.body().type, /cuenta_sin_prueba/)

        // ambiente que no coincide con el modo: no sirve
        const ambiente = await conFetch(
            () => ({ cuerpo: { environment: 'live' } }),
            async () =>
                estado(client.post(`/api/v1/pasarelas/cuentas/${body.id}/probar`).bearerToken(token), 200),
        )
        assert.isFalse(ambiente.body().ok)

        const buena = await conFetch(
            (ruta, llave) => {
                assert.equal(ruta, '/test')
                assert.equal(llave, LLAVE_A)
                return { cuerpo: { environment: 'sandbox', account_id: 'x' } }
            },
            async () =>
                estado(client.post(`/api/v1/pasarelas/cuentas/${body.id}/probar`).bearerToken(token), 200),
        )
        assert.isTrue(buena.body().ok)
        assert.isFalse(buena.body().cuenta.activa)
        const activa = await estado(
            client.post(`/api/v1/pasarelas/cuentas/${body.id}/activar`).bearerToken(token),
            200,
        )
        assert.isTrue(activa.body().activa)
        assert.deepEqual(activa.body().predeterminada_para, ['pago_en_linea'])

        // editar la llave exige volver a probar
        const editada = await client
            .put(`/api/v1/pasarelas/cuentas/${body.id}`)
            .bearerToken(token)
            .json({ version: activa.body().version, credenciales: { secret_key: LLAVE_B } })
        if (editada.status() !== 200) console.log('EDITAR', editada.status(), JSON.stringify(editada.body()))
        editada.assertStatus(200)
        assert.isFalse(editada.body().prueba_ok)
        assert.notInclude(JSON.stringify(editada.body()), LLAVE_B)
    })

    test('editar con version vieja da 409', async ({ client }) => {
        const token = await admin()
        const respuesta = await crearCuentaApi(client, token, { proveedor: 'falsa', alias: 'Lab' })
        const body = respuesta.body()
        await estado(
            client
                .put(`/api/v1/pasarelas/cuentas/${body.id}`)
                .bearerToken(token)
                .json({ version: body.version, alias: 'Lab 2' }),
            200,
        )
        await estado(
            client
                .put(`/api/v1/pasarelas/cuentas/${body.id}`)
                .bearerToken(token)
                .json({ version: body.version, alias: 'Lab 3' }),
            409,
        )
    })

    test('sembrar desde el entorno: una vez, cifrada, y desde ahí manda la cuenta (no el entorno)', async ({
        assert,
    }) => {
        const previos = {
            p: env.get('PASARELA_PROVEEDOR'),
            k: env.get('RECURRENTE_SECRET_KEY'),
            w: env.get('RECURRENTE_WEBHOOK_SECRETO'),
        }
        env.set('PASARELA_PROVEEDOR', 'recurrente')
        env.set('RECURRENTE_SECRET_KEY', LLAVE_A)
        env.set('RECURRENTE_WEBHOOK_SECRETO', WEBHOOK_A)
        try {
            const primera = await new SembrarCuentaPasarela().execute({}, contextoPrueba())
            assert.isTrue(primera.sembrada)
            assert.notInclude(JSON.stringify(primera), LLAVE_A)
            const segunda = await new SembrarCuentaPasarela().execute({}, contextoPrueba())
            assert.deepInclude(segunda, {
                sembrada: false,
                motivo: 'ya_existe',
                cuenta_id: primera.cuenta_id,
            })

            const fila = await db
                .from('billing.pasarela_cuentas')
                .where('id', primera.cuenta_id!)
                .firstOrFail()
            assert.include(fila, {
                empresa_id: 1,
                proveedor: 'recurrente',
                activa: true,
                prueba_ok: true,
                sembrada_desde_entorno: true,
                predeterminada_pago_en_linea: true,
                modo: 'pruebas',
            })
            assert.match(fila.credenciales_cifradas, /^v1\./)
            const auditoria = JSON.stringify([
                await db
                    .from('audit.acciones')
                    .where('entidad_tipo', 'cuenta_pasarela')
                    .where('entidad_id', fila.id),
                await db
                    .from('audit.cambios')
                    .where('entidad_tipo', 'cuenta_pasarela')
                    .where('entidad_id', fila.id),
                await db.from('audit.outbox').where('evento', 'pasarela.config_cambiada'),
            ])
            assert.notInclude(auditoria, LLAVE_A)
            assert.notInclude(auditoria, WEBHOOK_A)

            // el cobro usa la llave de la cuenta sembrada
            const datos = await servicioCortado()
            const cobro = await conFetch(cobroOk, async (llamadas) => {
                const c = await new CrearCobroPasarela().execute(
                    { cliente_id: datos.clienteId },
                    contextoPrueba(),
                )
                assert.equal(llamadas[0]!.llave, LLAVE_A)
                return c
            })
            assert.equal(cobro.pasarela_cuenta_id, Number(fila.id))

            // otra empresa sin cuenta: no usa la llave de la principal (regla 14)
            const otra = await crearEmpresaFila()
            try {
                await resolverFuente(db.connection(), otra, 'pago_en_linea')
                assert.fail('debía faltar la cuenta')
            } catch (error) {
                assert.instanceOf(error, PasarelaNoConfigurada)
            }
        } finally {
            env.set('PASARELA_PROVEEDOR', previos.p ?? '')
            env.set('RECURRENTE_SECRET_KEY', previos.k ?? '')
            env.set('RECURRENTE_WEBHOOK_SECRETO', previos.w ?? '')
        }
    })

    test('dos empresas con cuentas distintas: cada cobro usa la llave de su empresa; webhook cruzado da 401', async ({
        client,
        assert,
    }) => {
        const token = await admin()
        const datos = await servicioCortado()
        const empresaB = await crearEmpresaFila()
        const a = await crearCuentaApi(client, token, {
            empresa_id: 1,
            proveedor: 'recurrente',
            alias: 'Cuenta A',
            credenciales: { secret_key: LLAVE_A },
            webhook_secreto: WEBHOOK_A,
        })
        const b = await crearCuentaApi(client, token, {
            empresa_id: empresaB,
            proveedor: 'recurrente',
            alias: 'Cuenta B',
            credenciales: { secret_key: LLAVE_B },
            webhook_secreto: 'whsec_SECRETO_WEBHOOK_PRUEBA_B_0004',
        })
        await conFetch(
            () => ({ cuerpo: { environment: 'sandbox' } }),
            async () => {
                for (const id of [a.body().id, b.body().id]) {
                    await new ProbarCuentaPasarela().execute({ id }, contextoPrueba())
                    await new ActivarCuentaPasarela().execute({ id }, contextoPrueba())
                }
            },
        )
        const fa = await resolverFuente(db.connection(), 1, 'pago_en_linea')
        const fb = await resolverFuente(db.connection(), empresaB, 'pago_en_linea')
        assert.equal(fa.cuenta!.id, a.body().id)
        assert.equal(fb.cuenta!.id, b.body().id)

        // cobro de la empresa 1: sale con la llave A
        await conFetch(cobroOk, async (llamadas) => {
            await new CrearCobroPasarela().execute({ cliente_id: datos.clienteId }, contextoPrueba())
            assert.deepEqual(
                llamadas.map((l) => l.llave),
                [LLAVE_A],
            )
        })

        // webhook firmado con el secreto de B sobre la URL de A: 401; con el de A: pasa la firma
        const cuerpo = JSON.stringify({
            event_type: 'payment_intent.succeeded',
            id: 'x',
            checkout: { id: 'ch_no_existe' },
        })
        const marca = Math.floor(Date.now() / 1000)
        const { firmarSvix } = await import('#billing/pasarelas/recurrente')
        const idMsg = unico('msg')
        // el cuerpo reserializado por el cliente puede diferir del crudo: se firma el mismo texto
        const cruda = (clave: string, secreto: string) =>
            client
                .post(`/api/v1/pasarela/webhook/recurrente/${clave}`)
                .header('Content-Type', 'application/json')
                .header('svix-id', idMsg)
                .header('svix-timestamp', String(marca))
                .header(
                    'svix-signature',
                    firmarSvix(secreto, idMsg, marca, JSON.stringify(JSON.parse(cuerpo))),
                )
                .json(JSON.parse(cuerpo))
        const cruzado = await cruda(a.body().clave_publica, 'whsec_SECRETO_WEBHOOK_PRUEBA_B_0004')
        cruzado.assertStatus(401)
        const propio = await cruda(a.body().clave_publica, WEBHOOK_A)
        propio.assertStatus(200)
        assert.equal(propio.body().ignorado, 'cobro_desconocido')
        // clave pública que no existe: 401 igual
        const inexistente = await cruda('0'.repeat(32), WEBHOOK_A)
        inexistente.assertStatus(401)
    })

    test('dos pasarelas en una empresa: se usa la predeterminada del uso; desactivar pasa a la otra', async ({
        client,
        assert,
    }) => {
        const token = await admin()
        const rec = await crearCuentaApi(client, token, {
            proveedor: 'recurrente',
            alias: 'Rec',
            credenciales: { secret_key: LLAVE_A },
            webhook_secreto: WEBHOOK_A,
        })
        const fal = await crearCuentaApi(client, token, { proveedor: 'falsa', alias: 'Falsa' })
        await conFetch(
            () => ({ cuerpo: { environment: 'sandbox' } }),
            async () => {
                for (const id of [rec.body().id, fal.body().id]) {
                    await new ProbarCuentaPasarela().execute({ id }, contextoPrueba())
                    await new ActivarCuentaPasarela().execute({ id }, contextoPrueba())
                }
            },
        )
        // la primera activada quedó como predeterminada
        let fuente = await resolverFuente(db.connection(), 1, 'pago_en_linea')
        assert.equal(fuente.cuenta!.id, rec.body().id)

        const detalle = await estado(
            client.get(`/api/v1/pasarelas/cuentas/${fal.body().id}`).bearerToken(token),
            200,
        )
        await estado(
            client
                .put(`/api/v1/pasarelas/cuentas/${fal.body().id}`)
                .bearerToken(token)
                .json({ version: detalle.body().version, predeterminada_para: ['pago_en_linea'] }),
            200,
        )
        fuente = await resolverFuente(db.connection(), 1, 'pago_en_linea')
        assert.equal(fuente.proveedor, 'falsa')
        const filas = await db.from('billing.pasarela_cuentas').where('predeterminada_pago_en_linea', true)
        assert.lengthOf(filas, 1)

        const datos = await servicioCortado()
        const cobro = await new CrearCobroPasarela().execute(
            { cliente_id: datos.clienteId },
            contextoPrueba(),
        )
        assert.equal(cobro.proveedor, 'falsa')
        assert.equal(cobro.pasarela_cuenta_id, fal.body().id)

        // desactivar la predeterminada: pasa a la otra activa
        await estado(
            client.post(`/api/v1/pasarelas/cuentas/${fal.body().id}/desactivar`).bearerToken(token),
            200,
        )
        fuente = await resolverFuente(db.connection(), 1, 'pago_en_linea')
        assert.equal(fuente.proveedor, 'recurrente')
        // desactivar la última: la empresa queda sin pago en línea y no vuelve al entorno
        await estado(
            client.post(`/api/v1/pasarelas/cuentas/${rec.body().id}/desactivar`).bearerToken(token),
            200,
        )
        try {
            await resolverFuente(db.connection(), 1, 'pago_en_linea')
            assert.fail('debía faltar la cuenta')
        } catch (error) {
            assert.instanceOf(error, PasarelaNoConfigurada)
        }
    })

    test('cuenta falsa: cobro, pago por su webhook y conciliación de todas las cuentas activas', async ({
        client,
        assert,
    }) => {
        const token = await admin()
        const datos = await servicioCortado()
        const empresaB = await crearEmpresaFila()
        const a = await crearCuentaApi(client, token, { empresa_id: 1, proveedor: 'falsa', alias: 'Lab A' })
        const b = await crearCuentaApi(client, token, {
            empresa_id: empresaB,
            proveedor: 'falsa',
            alias: 'Lab B',
        })
        for (const id of [a.body().id, b.body().id]) {
            await estado(client.post(`/api/v1/pasarelas/cuentas/${id}/probar`).bearerToken(token), 200)
            await estado(client.post(`/api/v1/pasarelas/cuentas/${id}/activar`).bearerToken(token), 200)
        }
        // secreto propio de la cuenta A: el webhook del laboratorio firma con él
        const det = await estado(
            client.get(`/api/v1/pasarelas/cuentas/${a.body().id}`).bearerToken(token),
            200,
        )
        await estado(
            client
                .put(`/api/v1/pasarelas/cuentas/${a.body().id}`)
                .bearerToken(token)
                .json({ version: det.body().version, webhook_secreto: 'secreto-propio-de-la-cuenta-a' }),
            200,
        )
        const cobro = await estado(
            client.post('/api/v1/pasarela/cobros').bearerToken(token).json({ cliente_id: datos.clienteId }),
            201,
        )
        assert.equal(cobro.body().pasarela_cuenta_id, a.body().id)
        const pagado = await estado(
            client.post(`/api/v1/pasarela/falsa/${cobro.body().id_proveedor}/pagar`).json({}),
            200,
        )
        assert.isNumber(pagado.body().pago_id)
        await afirmarLibroCuadrado(assert)

        // el cron recorre las dos cuentas activas
        const cron = (await ejecutarCron('conciliar')) as {
            resultado: { corridas: Array<{ pasarela_cuenta_id: number }> }
        }
        const salida = cron.resultado
        assert.sameMembers(
            salida.corridas.map((c) => c.pasarela_cuenta_id),
            [a.body().id, b.body().id],
        )
        const guardadas = await db
            .from('billing.pasarela_conciliaciones')
            .whereIn('pasarela_cuenta_id', [a.body().id, b.body().id])
        assert.lengthOf(guardadas, 2)
        const deHoy = await new ConciliarPasarela().execute(
            { fecha: hoyGuatemala(), cuenta_id: a.body().id },
            contextoPrueba(),
        )
        assert.equal(deHoy.pasarela_cuenta_id, a.body().id)
        assert.include(deHoy.cobros_conciliados, cobro.body().id)
        // un webhook con el secreto del laboratorio (no el de la cuenta) no sirve en la URL de la cuenta
        const lab = new PasarelaFalsa()
        const otro = await lab.simularPago(cobro.body().id_proveedor, { estado: 'fallido' })
        const cuerpoJson = JSON.parse(otro.cuerpo)
        const rechazado = await client
            .post(`/api/v1/pasarela/webhook/falsa/${a.body().clave_publica}`)
            .header('Content-Type', 'application/json')
            .header(CABECERA_FIRMA, firmar(otro.cuerpo, Math.floor(Date.now() / 1000)))
            .json(cuerpoJson)
        rechazado.assertStatus(401)
        // por HTTP, con varias activas hay que indicar la cuenta
        const sinCuenta = await estado(
            client.post('/api/v1/pasarela/conciliar').bearerToken(token).json({ fecha: hoyGuatemala() }),
            422,
        )
        assert.match(sinCuenta.body().type, /cuenta_requerida/)
        await estado(
            client
                .post('/api/v1/pasarela/conciliar')
                .bearerToken(token)
                .json({ fecha: hoyGuatemala(), cuenta_id: b.body().id }),
            200,
        )
    })

    test('la acción crear por el sistema respeta la empresa activa y la ruta anterior del webhook sigue para la sembrada', async ({
        assert,
    }) => {
        const cuenta = await new CrearCuentaPasarela().execute(
            { proveedor: 'falsa', alias: 'Lab' },
            { ...contextoPrueba(), empresaId: 1 },
        )
        assert.equal(cuenta.empresa_id, 1)
        const fila = await db.from('billing.pasarela_cuentas').where('id', cuenta.id).firstOrFail()
        assert.match(fila.clave_publica, /^[a-f0-9]{32}$/)
    })
})
