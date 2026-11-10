import { randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import type { ApiClient, ApiRequest } from '@japa/api-client'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, soloEmpresaPrincipal, unico, usuarioConRoles } from '#tests/ayudas'
import { afirmarLibroCuadrado } from '#tests/ledger/ayudas_libro'
import { crearEmpresaFila } from '#tests/core/fabricas'
import { cifrar } from '#shared/cifrado'
import GenerarTokenIris from '#core/actions/generar_token_iris'
import { usuarioIris } from '#core/integraciones_iris'
import { normalizarReglasPromesa } from '#billing/reglas_promesa'
import RegistrarComprobante, {
    type EntradaRegistrarComprobante,
} from '#billing/actions/registrar_comprobante'
import {
    cuentaBancariaPrueba,
    estadoServicio,
    eventosDe,
    servicioCortado,
    unicoBd,
} from '#tests/billing/ayudas_billing'

/**
 * Contrato Iris 0.7.0 §7.7 (A23, parte de A3): un operador humano de Iris aprueba o rechaza un
 * comprobante de Iris desde la conversación, como su usuario de Argos vinculado, por las mismas
 * rutas del panel (`POST /comprobantes/:id/aprobar|rechazar`). La resolución del vínculo es de A1
 * (`tests/core/iris_actuacion_070.spec.ts`); aquí, lo de billing contra Postgres real: pago,
 * asiento, reactivación y reconexión temporal en una transacción a nombre del vinculado, los
 * 403/409/400 por estas rutas, idempotencia por actor, concurrencia, auditoría con la vía y el
 * panel igual que antes. El libro cuadra después de cada acción que mueve dinero.
 */

const PNG = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('IHDR-boleta-a23'),
])
const CONVERSACION = 'wa:5025512-3344:a23'

/** Token `atk_` del usuario técnico Iris (alcance global). */
async function tokenIris() {
    const generado = await new GenerarTokenIris().execute({ nombre: unico('Iris') }, contextoPrueba())
    const id = (await usuarioIris())!
    await db.from('core.usuarios').where('id', id).update({ activo: true, alcance_global: true })
    await db.from('core.usuarios_empresas').where('usuario_id', id).delete()
    return { token: generado.token, tokenId: Number(generado.datos.id) }
}

/** Usuario de Argos vinculado a un id de Iris nuevo (`usuario:<id>`). */
async function operador(roles: string[] = ['cajero']) {
    const local = await usuarioConRoles(roles)
    const idIris = unico('op').replace(/[^A-Za-z0-9_-]/g, '_')
    await db.table('core.vinculaciones_externas').insert({
        conector: 'iris',
        id_externo: idIris,
        usuario_id: local.usuario.id,
    })
    return { ...local, actor: `usuario:${idIris}` }
}

/** Cabeceras de Iris; `null` deja fuera la cabecera. */
function conIris(
    peticion: ApiRequest,
    actor: string | null,
    clave: string | null,
    requestId: string = randomUUID(),
) {
    let p = peticion.header('X-Request-Id', requestId)
    if (actor !== null) p = p.header('X-Iris-Actor', actor).header('X-Iris-Conversacion', CONVERSACION)
    if (clave !== null) p = p.header('Idempotency-Key', clave)
    return p
}

function aprobar(
    client: ApiClient,
    token: string,
    id: number,
    actor: string | null,
    opciones: { clave?: string | null; requestId?: string; cuerpo?: Record<string, unknown> } = {},
) {
    return conIris(
        client
            .post(`/api/v1/comprobantes/${id}/aprobar`)
            .bearerToken(token)
            .json(opciones.cuerpo ?? {}),
        actor,
        opciones.clave === undefined ? `iris:aprobar:${id}:${unico('k')}` : opciones.clave,
        opciones.requestId,
    )
}

function rechazar(
    client: ApiClient,
    token: string,
    id: number,
    actor: string | null,
    opciones: { clave?: string | null; requestId?: string; cuerpo?: Record<string, unknown> } = {},
) {
    return conIris(
        client
            .post(`/api/v1/comprobantes/${id}/rechazar`)
            .bearerToken(token)
            .json(opciones.cuerpo ?? { motivo: 'No aparece en el banco', causa: 'no_aparece' }),
        actor,
        opciones.clave === undefined ? `iris:rechazar:${id}:${unico('k')}` : opciones.clave,
        opciones.requestId,
    )
}

async function problema(peticion: PromiseLike<any>, status: number, codigo: string) {
    const r = await estado(peticion, status)
    if (r.body().type !== `urn:argosisp:problema:${codigo}`) {
        throw new Error(`se esperaba ${codigo} y llegó ${JSON.stringify(r.body())}`)
    }
    return r
}

/** Servicio cortado (Q300 vencidos) con una boleta subida por Iris (`canal = iris`). */
async function boletaDeIris(client: ApiClient, token: string, reconexion = false) {
    const datos = await servicioCortado()
    if (reconexion) {
        await db
            .from('billing.plantillas_facturacion')
            .where('id', datos.plantillaId)
            .update({
                reglas_promesa: JSON.stringify(
                    normalizarReglasPromesa({
                        no_exceder_siguiente_facturacion: false,
                        reconexion_temporal: { permitida: true },
                    }),
                ),
            })
    }
    const cuenta = await cuentaBancariaPrueba()
    const campos: Record<string, string | number> = {
        cliente_id: datos.clienteId,
        servicio_id: datos.servicioId,
        metodo: 'deposito',
        cuenta_bancaria_id: cuenta.id,
        referencia: await unicoBd('boleta-a23'),
        monto: '300.00',
        fecha_deposito: '2026-10-08',
        canal_contacto: 'whatsapp',
        leido_por: 'ia',
    }
    let p = client.post('/api/v1/comprobantes').bearerToken(token)
    for (const [nombre, valor] of Object.entries(campos)) p = p.field(nombre, String(valor))
    p = p.file('archivo', PNG, { filename: 'boleta.png' })
    const r = await estado(conIris(p, 'asistente_ia', unico('iris:boleta')), 201)
    const comprobanteId = r.body().id as number
    let reconexionId: number | null = null
    if (reconexion) {
        const rec = await estado(
            conIris(
                client
                    .post(`/api/v1/comprobantes/${comprobanteId}/reconexion-temporal`)
                    .bearerToken(token)
                    .json({ motivo: 'fuera_de_horario' }),
                'asistente_ia',
                unico('iris:reconexion'),
            ),
            201,
        )
        reconexionId = rec.body().promesa_id as number
    }
    return { ...datos, cuenta, comprobanteId, reconexionId }
}

/** Comprobante subido por el portal (`canal = portal`), de un servicio cortado. */
async function boletaDelPortal() {
    const datos = await servicioCortado()
    const cuenta = await cuentaBancariaPrueba()
    const comprobante = await new RegistrarComprobante().execute(
        {
            cliente_id: datos.clienteId,
            servicio_id: datos.servicioId,
            metodo: 'deposito',
            cuenta_bancaria_id: cuenta.id,
            referencia: await unicoBd('boleta-portal'),
            monto: '300.00',
            fecha_deposito: '2026-10-08',
            canal: 'portal',
            archivo: { contenido: PNG, nombre: 'boleta.png' },
        } as EntradaRegistrarComprobante,
        { actor: { tipo: 'sistema', id: null }, canal: 'portal', requestId: randomUUID() },
    )
    return { ...datos, comprobanteId: comprobante.id }
}

/**
 * Instante de la transacción que escribió la fila: `now()` es el inicio de la transacción y no
 * cambia en sus savepoints (las acciones anidadas), así que el mismo valor con microsegundos en
 * filas de tablas distintas = la misma transacción. (`xmin` no sirve: cada savepoint tiene el suyo.)
 */
async function tx(tabla: string, columna: string, id: number): Promise<string> {
    const r = await db.rawQuery(`SELECT ${columna}::text AS x FROM ${tabla} WHERE id = ?`, [id])
    return r.rows[0].x as string
}

test.group('Iris 0.7.0 · aprobar y rechazar desde la conversación (A23)', (group) => {
    group.each.setup(async () => {
        await db.from('integraciones.iris_enlaces').delete()
        await db.from('integraciones.iris_conector').delete()
    })
    group.teardown(async () => {
        await soloEmpresaPrincipal()
    })

    test('aprobar con vínculo: pago, asiento y reactivación en una transacción a nombre del vinculado; auditoría con la vía', async ({
        client,
        assert,
    }) => {
        const iris = await tokenIris()
        const op = await operador()
        const datos = await boletaDeIris(client, iris.token)
        const requestId = randomUUID()
        const r = await estado(
            aprobar(client, iris.token, datos.comprobanteId, op.actor, {
                clave: `iris:aprobar:${datos.comprobanteId}`,
                requestId,
                cuerpo: { nota: 'Verificado en la banca en línea' },
            }),
            200,
        )
        const cuerpo = r.body()
        assert.containSubset(cuerpo, {
            id: datos.comprobanteId,
            estado: 'aprobado',
            canal: 'iris',
            monto: '300.00',
            verificado_por: op.usuario.id,
            verificado_por_nombre: op.usuario.nombre,
            iris_actor: 'asistente_ia',
            iris_conversacion: CONVERSACION,
        })
        const pagoId = cuerpo.pago_id as number
        assert.isNumber(pagoId)

        const pago = await db.from('billing.pagos').where('id', pagoId).firstOrFail()
        assert.equal(Number(pago.registrado_por), op.usuario.id)
        assert.equal(pago.monto, '300.00')
        assert.equal(await estadoServicio(datos.servicioId), 'activo')

        // misma transacción: comprobante, pago, asiento y servicio con el mismo now()
        const asiento = await db
            .from('ledger.asientos')
            .where('origen_tipo', 'pago')
            .where('origen_id', pagoId)
            .firstOrFail()
        const inicio = await tx('billing.comprobantes', 'verificado_en', datos.comprobanteId)
        assert.equal(await tx('billing.pagos', 'created_at', pagoId), inicio)
        assert.equal(await tx('ledger.asientos', 'created_at', asiento.id), inicio)
        assert.equal(await tx('core.servicios', 'updated_at', datos.servicioId), inicio)

        // auditoría: el actor es el vinculado (canal api) con el token Iris como vía, también en las anidadas
        const filas = await db.from('audit.acciones').where('request_id', requestId).orderBy('id')
        const aprobada = filas.find((f) => f.accion === 'comprobantes.aprobar')
        assert.exists(aprobada)
        assert.containSubset(
            filas.map((f) => f.accion),
            ['comprobantes.aprobar', 'pagos.registrar'],
        )
        for (const f of filas) {
            assert.equal(f.actor_tipo, 'usuario', f.accion)
            assert.equal(Number(f.actor_id), op.usuario.id, f.accion)
            assert.equal(f.canal, 'api', f.accion)
            assert.equal(Number(f.via_token_id), iris.tokenId, f.accion)
            assert.equal(f.iris_actor, op.actor, f.accion)
            assert.equal(f.iris_conversacion, CONVERSACION, f.accion)
        }

        // webhook de siempre: misma forma que cuando aprueba caja
        const [evento] = await eventosDe('comprobante.aprobado', 'comprobante_id', datos.comprobanteId)
        assert.deepEqual(Object.keys(evento.payload).sort(), [
            'canal',
            'causa',
            'cliente_id',
            'comprobante_id',
            'empresa_id',
            'monto',
            'motivo',
            'origen',
            'pago_id',
            'servicio_estado',
            'servicio_id',
        ])
        assert.include(evento.payload, {
            pago_id: pagoId,
            canal: 'iris',
            servicio_estado: 'activo',
            motivo: null,
            causa: null,
        })
        await afirmarLibroCuadrado(assert)
    })

    test('aprobar con reconexión temporal: CumplirPromesa en la misma transacción que el pago', async ({
        client,
        assert,
    }) => {
        const iris = await tokenIris()
        const op = await operador()
        const datos = await boletaDeIris(client, iris.token, true)
        const r = await estado(aprobar(client, iris.token, datos.comprobanteId, op.actor), 200)
        const pagoId = r.body().pago_id as number
        const promesa = await db.from('billing.promesas').where('id', datos.reconexionId!).firstOrFail()
        assert.equal(promesa.estado, 'cumplida')
        assert.equal(
            await tx('billing.promesas', 'updated_at', datos.reconexionId!),
            await tx('billing.pagos', 'created_at', pagoId),
        )
        const [cumplida] = await eventosDe('promesa.cumplida', 'promesa_id', datos.reconexionId!)
        assert.exists(cumplida)
        await afirmarLibroCuadrado(assert)
    })

    test('rechazar con vínculo: sin pago, verificado_por el vinculado, reconexión cancelada y webhook de siempre', async ({
        client,
        assert,
    }) => {
        const iris = await tokenIris()
        const op = await operador(['contabilidad'])
        const datos = await boletaDeIris(client, iris.token, true)
        const requestId = randomUUID()
        const r = await estado(
            rechazar(client, iris.token, datos.comprobanteId, op.actor, {
                clave: `iris:rechazar:${datos.comprobanteId}`,
                requestId,
                cuerpo: { motivo: 'El monto no coincide con el depósito', causa: 'monto_distinto' },
            }),
            200,
        )
        assert.containSubset(r.body(), {
            estado: 'rechazado',
            pago_id: null,
            motivo_rechazo: 'El monto no coincide con el depósito',
            causa_rechazo: 'monto_distinto',
            verificado_por: op.usuario.id,
            verificado_por_nombre: op.usuario.nombre,
        })
        const promesa = await db.from('billing.promesas').where('id', datos.reconexionId!).firstOrFail()
        assert.equal(promesa.estado, 'cancelada')
        assert.equal(
            await tx('billing.promesas', 'updated_at', datos.reconexionId!),
            await tx('billing.comprobantes', 'verificado_en', datos.comprobanteId),
        )
        const fila = await db
            .from('audit.acciones')
            .where('request_id', requestId)
            .where('accion', 'comprobantes.rechazar')
            .firstOrFail()
        assert.equal(Number(fila.actor_id), op.usuario.id)
        assert.equal(Number(fila.via_token_id), iris.tokenId)
        assert.equal(fila.canal, 'api')

        const [evento] = await eventosDe('comprobante.rechazado', 'comprobante_id', datos.comprobanteId)
        assert.include(evento.payload, { pago_id: null, causa: 'monto_distinto', canal: 'iris' })
        assert.lengthOf(await db.from('billing.pagos').where('cliente_id', datos.clienteId), 0)
        await afirmarLibroCuadrado(assert)
    })

    test('los cinco 403 en aprobar y rechazar, sin tocar el comprobante', async ({ client, assert }) => {
        const iris = await tokenIris()
        const datos = await boletaDeIris(client, iris.token)
        const id = datos.comprobanteId
        for (const llamar of [aprobar, rechazar]) {
            await problema(llamar(client, iris.token, id, 'asistente_ia'), 403, 'actor_ia_no_permitido')
            await problema(llamar(client, iris.token, id, 'usuario:nadie_a23'), 403, 'actor_sin_vinculo')
        }
        const inactivo = await operador()
        await db.from('core.usuarios').where('id', inactivo.usuario.id).update({ activo: false })
        await problema(aprobar(client, iris.token, id, inactivo.actor), 403, 'actor_inactivo')
        await problema(rechazar(client, iris.token, id, inactivo.actor), 403, 'actor_inactivo')

        const lectura = await operador(['lectura'])
        await problema(aprobar(client, iris.token, id, lectura.actor), 403, 'actor_sin_permiso')
        await problema(rechazar(client, iris.token, id, lectura.actor), 403, 'actor_sin_permiso')

        // la empresa del comprobante (1) no es del vinculado (solo opera B)
        const b = await crearEmpresaFila()
        const deB = await operador()
        await db.from('core.usuarios').where('id', deB.usuario.id).update({ alcance_global: false })
        await db.table('core.usuarios_empresas').insert({ usuario_id: deB.usuario.id, empresa_id: b })
        await problema(aprobar(client, iris.token, id, deB.actor), 403, 'actor_sin_empresa')
        await problema(rechazar(client, iris.token, id, deB.actor), 403, 'actor_sin_empresa')
        await soloEmpresaPrincipal()

        const fila = await db.from('billing.comprobantes').where('id', id).firstOrFail()
        assert.equal(fila.estado, 'pendiente')
        assert.isNull(fila.pago_id)
        assert.equal(await estadoServicio(datos.servicioId), 'suspendido')
    })

    test('409 iris_apagado, comprobante_no_es_de_iris y comprobante_revisado', async ({ client, assert }) => {
        const iris = await tokenIris()
        const op = await operador()
        const datos = await boletaDeIris(client, iris.token)

        await db.table('integraciones.iris_conector').insert({
            id: 1,
            activo: false,
            url_base: 'https://iris.isp.example',
            token_cifrado: cifrar('iris_pat_prueba'),
            webhook_salida_url: 'https://iris.isp.example/api/v1/integraciones/argosisp/webhook/c-1',
            webhook_salida_secreto_cifrado: cifrar('secreto-prueba'),
            token_argos_id: iris.tokenId,
            conectado_por_enlace_en: new Date(),
        })
        await problema(aprobar(client, iris.token, datos.comprobanteId, op.actor), 409, 'iris_apagado')
        await problema(rechazar(client, iris.token, datos.comprobanteId, op.actor), 409, 'iris_apagado')
        await db.from('integraciones.iris_conector').where('id', 1).update({ activo: true })

        // un comprobante del portal no se resuelve desde Iris (antes de mirar su estado)
        const portal = await boletaDelPortal()
        await problema(
            aprobar(client, iris.token, portal.comprobanteId, op.actor),
            409,
            'comprobante_no_es_de_iris',
        )
        await problema(
            rechazar(client, iris.token, portal.comprobanteId, op.actor),
            409,
            'comprobante_no_es_de_iris',
        )
        const delPortal = await db
            .from('billing.comprobantes')
            .where('id', portal.comprobanteId)
            .firstOrFail()
        assert.equal(delPortal.estado, 'pendiente')
        // aunque ya esté revisado: sigue siendo comprobante_no_es_de_iris
        const caja = await usuarioConRoles(['cajero'])
        await estado(
            client
                .post(`/api/v1/comprobantes/${portal.comprobanteId}/aprobar`)
                .bearerToken(caja.token)
                .json({}),
            200,
        )
        await problema(
            rechazar(client, iris.token, portal.comprobanteId, op.actor),
            409,
            'comprobante_no_es_de_iris',
        )

        await estado(aprobar(client, iris.token, datos.comprobanteId, op.actor), 200)
        await problema(
            aprobar(client, iris.token, datos.comprobanteId, op.actor),
            409,
            'comprobante_revisado',
        )
        await problema(
            rechazar(client, iris.token, datos.comprobanteId, op.actor),
            409,
            'comprobante_revisado',
        )
        assert.lengthOf(await db.from('billing.pagos').where('cliente_id', datos.clienteId), 1)
        await afirmarLibroCuadrado(assert)
    })

    test('400 sin cabeceras de Iris o sin Idempotency-Key', async ({ client, assert }) => {
        const iris = await tokenIris()
        const op = await operador()
        const datos = await boletaDeIris(client, iris.token)
        for (const llamar of [aprobar, rechazar]) {
            await problema(
                llamar(client, iris.token, datos.comprobanteId, null),
                400,
                'cabecera_iris_requerida',
            )
            await problema(
                llamar(client, iris.token, datos.comprobanteId, op.actor, { clave: null }),
                400,
                'idempotency_key_requerida',
            )
        }
        const sinConversacion = await client
            .post(`/api/v1/comprobantes/${datos.comprobanteId}/aprobar`)
            .bearerToken(iris.token)
            .header('X-Iris-Actor', op.actor)
            .header('Idempotency-Key', unico('k'))
            .json({})
        sinConversacion.assertStatus(400)
        assert.equal(sinConversacion.body().type, 'urn:argosisp:problema:cabecera_iris_requerida')
        const fila = await db.from('billing.comprobantes').where('id', datos.comprobanteId).firstOrFail()
        assert.equal(fila.estado, 'pendiente')
    })

    test('idempotencia: replay al mismo actor; la misma clave con otro actor es 422 y no se ejecuta', async ({
        client,
        assert,
    }) => {
        const iris = await tokenIris()
        const ana = await operador()
        const luis = await operador()
        const datos = await boletaDeIris(client, iris.token)
        const clave = `iris:aprobar:${datos.comprobanteId}`
        const primera = await estado(
            aprobar(client, iris.token, datos.comprobanteId, ana.actor, { clave }),
            200,
        )
        const replay = await estado(
            aprobar(client, iris.token, datos.comprobanteId, ana.actor, { clave }),
            200,
        )
        assert.equal(replay.header('idempotent-replayed'), 'true')
        assert.equal(replay.body().pago_id, primera.body().pago_id)
        assert.equal(replay.body().verificado_por, ana.usuario.id)

        await problema(
            aprobar(client, iris.token, datos.comprobanteId, luis.actor, { clave }),
            422,
            'idempotency_key_reutilizada',
        )
        assert.lengthOf(await db.from('billing.pagos').where('cliente_id', datos.clienteId), 1)
        const aprobaciones = await db
            .from('audit.acciones')
            .where('accion', 'comprobantes.aprobar')
            .where('entidad_id', datos.comprobanteId)
            .where('resultado', 'ok')
        assert.lengthOf(aprobaciones, 1)
        assert.equal(Number(aprobaciones[0].actor_id), ana.usuario.id)
        await afirmarLibroCuadrado(assert)
    })

    test('concurrencia: dos operadores sobre el mismo comprobante; uno gana y el otro recibe 409', async ({
        client,
        assert,
    }) => {
        const iris = await tokenIris()
        const ana = await operador()
        const luis = await operador(['contabilidad'])
        const datos = await boletaDeIris(client, iris.token)
        const [a, b] = await Promise.all([
            aprobar(client, iris.token, datos.comprobanteId, ana.actor),
            rechazar(client, iris.token, datos.comprobanteId, luis.actor),
        ])
        const statuses = [a.status(), b.status()].sort()
        assert.deepEqual(statuses, [200, 409])
        const perdedora = a.status() === 409 ? a : b
        assert.equal(perdedora.body().type, 'urn:argosisp:problema:comprobante_revisado')
        const ganador = a.status() === 200 ? ana : luis
        const fila = await db.from('billing.comprobantes').where('id', datos.comprobanteId).firstOrFail()
        assert.equal(Number(fila.verificado_por), ganador.usuario.id)
        const pagos = await db.from('billing.pagos').where('cliente_id', datos.clienteId)
        assert.lengthOf(pagos, fila.estado === 'aprobado' ? 1 : 0)

        // dos aprobaciones a la vez: un solo pago
        const otra = await boletaDeIris(client, iris.token)
        const dos = await Promise.all([
            aprobar(client, iris.token, otra.comprobanteId, ana.actor),
            aprobar(client, iris.token, otra.comprobanteId, ana.actor),
        ])
        assert.deepEqual(dos.map((x) => x.status()).sort(), [200, 409])
        assert.lengthOf(await db.from('billing.pagos').where('cliente_id', otra.clienteId), 1)
        await afirmarLibroCuadrado(assert)
    })

    test('desde el panel todo sigue igual: sin cabeceras ni clave, actúa como sí mismo y resuelve cualquier canal', async ({
        client,
        assert,
    }) => {
        const iris = await tokenIris()
        const caja = await usuarioConRoles(['cajero'])
        const deIris = await boletaDeIris(client, iris.token)
        const requestId = randomUUID()
        const r = await estado(
            client
                .post(`/api/v1/comprobantes/${deIris.comprobanteId}/aprobar`)
                .bearerToken(caja.token)
                .header('X-Request-Id', requestId)
                .json({}),
            200,
        )
        assert.equal(r.body().verificado_por, caja.usuario.id)
        const pago = await db.from('billing.pagos').where('id', r.body().pago_id).firstOrFail()
        assert.equal(Number(pago.registrado_por), caja.usuario.id)
        const fila = await db
            .from('audit.acciones')
            .where('request_id', requestId)
            .where('accion', 'comprobantes.aprobar')
            .firstOrFail()
        assert.equal(Number(fila.actor_id), caja.usuario.id)
        assert.isNull(fila.via_token_id)
        assert.isNull(fila.iris_actor)

        const portal = await boletaDelPortal()
        const contador = await usuarioConRoles(['contabilidad'])
        const rechazo = await estado(
            client
                .post(`/api/v1/comprobantes/${portal.comprobanteId}/rechazar`)
                .bearerToken(contador.token)
                .json({ motivo: 'No aparece' }),
            200,
        )
        assert.equal(rechazo.body().estado, 'rechazado')
        assert.equal(rechazo.body().causa_rechazo, 'otro')
        await afirmarLibroCuadrado(assert)
    })
})
