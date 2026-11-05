import { test } from '@japa/runner'
import type { ApiClient, ApiRequest } from '@japa/api-client'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, unico, usuarioConRoles } from '#tests/ayudas'
import { afirmarLibroCuadrado } from '#tests/ledger/ayudas_libro'
import {
    bancoId,
    cuentaBancariaPrueba,
    escenario,
    estadoServicio,
    eventosDe,
    generar,
    reglasPromesaSinTopeFacturacion,
    servicioCortado,
    unicoBd,
} from '#tests/billing/ayudas_billing'
import { crearPlanFila, crearServicioFila } from '#tests/core/fabricas'
import GenerarTokenIris from '#core/actions/generar_token_iris'
import { usuarioIris } from '#core/integraciones_iris'
import { normalizarReglasPromesa } from '#billing/reglas_promesa'
import AprobarComprobante from '#billing/actions/aprobar_comprobante'
import IncumplirPromesas from '#billing/actions/incumplir_promesas'
import CancelarReconexionTemporal from '#billing/actions/cancelar_reconexion_temporal'
import CancelarPromesa from '#billing/actions/cancelar_promesa'
import RegistrarReconexionTemporal from '#billing/actions/registrar_reconexion_temporal'
import { simularPromesa } from '#billing/simulador_promesas'

/**
 * Contrato Iris 0.6.0 §7.1–§7.4 (pedidos A16, A17 y A18) contra Postgres real:
 * - `POST /comprobantes` multipart con el token de Iris (canal `iris`, cabeceras, Idempotency-Key,
 *   campos de lectura, empresa de la cuenta, errores), y el payload de `comprobante.*`;
 * - `POST /comprobantes/:id/reconexion-temporal`: cada `422 reconexion_no_permitida` y sus cuatro
 *   finales (cumplida, cancelada por rechazo con la hora de corte, cancelada por vencida sin
 *   revisar sin castigar el historial, incumplida), siempre por `evaluarEstadoServicio`;
 * - `POST /promesas` y `/promesas/simular` con `X-Iris-Actor` (canal `ia` / `operador`), y el
 *   payload común de `promesa.*` con `promesa.cancelada`.
 * El libro cuadra después de cada acción que mueve dinero.
 */

const PNG = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('IHDR-boleta-de-iris'),
])
/** Token `atk_` del usuario técnico Iris (alcance global), con los permisos de §1.1 del 0.6.0. */
async function tokenIris(): Promise<{ id: number; token: string }> {
    const { token } = await new GenerarTokenIris().execute({ nombre: unico('Iris') }, contextoPrueba())
    const id = (await usuarioIris())!
    await db.from('core.usuarios').where('id', id).update({ activo: true, alcance_global: true })
    await db.from('core.usuarios_empresas').where('usuario_id', id).delete()
    return { id, token }
}

type Campos = Record<string, string | number | null | undefined>

function cabeceras(
    peticion: ApiRequest,
    clave: string | null,
    actor: string | null = 'asistente_ia',
    conversacion: string | null = 'wa:5025512-3344:c1',
) {
    let p = peticion
    if (actor !== null) p = p.header('X-Iris-Actor', actor)
    if (conversacion !== null) p = p.header('X-Iris-Conversacion', conversacion)
    if (clave !== null) p = p.header('Idempotency-Key', clave)
    return p
}

function subir(
    client: ApiClient,
    token: string,
    campos: Campos,
    opciones: { clave?: string | null; actor?: string | null; conversacion?: string | null } = {},
): ApiRequest {
    let p = client.post('/api/v1/comprobantes').bearerToken(token)
    for (const [nombre, valor] of Object.entries(campos)) {
        if (valor !== undefined && valor !== null) p = p.field(nombre, String(valor))
    }
    p = p.file('archivo', PNG, { filename: 'boleta.png' })
    return cabeceras(
        p,
        opciones.clave === undefined ? unico('iris:boleta') : opciones.clave,
        opciones.actor === undefined ? 'asistente_ia' : opciones.actor,
        opciones.conversacion === undefined ? 'wa:5025512-3344:c1' : opciones.conversacion,
    )
}

async function camposBoleta(
    clienteId: number,
    servicioId: number | null,
    cuentaId: number,
    extra: Campos = {},
) {
    return {
        cliente_id: clienteId,
        servicio_id: servicioId,
        metodo: 'deposito',
        cuenta_bancaria_id: cuentaId,
        referencia: await unicoBd('boleta-iris'),
        monto: '300.00',
        fecha_deposito: '2026-10-08',
        canal_contacto: 'whatsapp',
        leido_por: 'ia',
        confianza: '0.92',
        ...extra,
    }
}

/** Activa la reconexión temporal en la plantilla del servicio (más el resto de reglas). */
async function habilitarReconexion(plantillaId: number, reconexion: Record<string, unknown> = {}) {
    await db
        .from('billing.plantillas_facturacion')
        .where('id', plantillaId)
        .update({
            reglas_promesa: JSON.stringify(
                normalizarReglasPromesa({
                    no_exceder_siguiente_facturacion: false,
                    reconexion_temporal: { permitida: true, ...reconexion },
                }),
            ),
        })
}

function reconectar(
    client: ApiClient,
    token: string,
    comprobanteId: number,
    cuerpo: Record<string, unknown> = {},
) {
    return cabeceras(
        client
            .post(`/api/v1/comprobantes/${comprobanteId}/reconexion-temporal`)
            .bearerToken(token)
            .json({ motivo: 'fuera_de_horario', ...cuerpo }),
        `iris:reconexion:${comprobanteId}:${unico('k')}`,
    )
}

async function ruleDe(peticion: PromiseLike<{ status(): number; body(): any }>) {
    const { rule } = await reglaDe(peticion)
    return rule
}

async function reglaDe(peticion: PromiseLike<{ status(): number; body(): any }>) {
    const r = await peticion
    return { status: r.status(), type: r.body().type as string, rule: r.body().errors?.[0]?.rule as string }
}

/** Servicio cortado con reconexión habilitada, boleta de Iris por todo lo vencido y su reconexión. */
async function cortadoConReconexion(
    client: ApiClient,
    token: string,
    plantilla: Record<string, unknown> = {},
) {
    const datos = await servicioCortado({ plantilla })
    await habilitarReconexion(datos.plantillaId)
    const cuenta = await cuentaBancariaPrueba()
    const boleta = await estado(
        subir(client, token, await camposBoleta(datos.clienteId, datos.servicioId, cuenta.id)),
        201,
    )
    const r = await estado(reconectar(client, token, boleta.body().id), 201)
    return {
        ...datos,
        cuenta,
        comprobanteId: boleta.body().id as number,
        promesaId: r.body().promesa_id as number,
    }
}

test.group('Iris 0.6.0 · comprobantes (§7.2)', () => {
    test('registrar por Iris: canal iris, lectura de Iris, cola filtrada, auditoría con las cabeceras y payload', async ({
        client,
        assert,
    }) => {
        const { token } = await tokenIris()
        const { clienteId, servicioId } = await servicioCortado()
        const cuenta = await cuentaBancariaPrueba()
        const campos = await camposBoleta(clienteId, servicioId, cuenta.id)
        const clave = unico('iris:boleta')
        const r = await estado(subir(client, token, campos, { clave }), 201)
        assert.containSubset(r.body(), {
            estado: 'pendiente',
            empresa_id: 1,
            canal: 'iris',
            leido_por: 'ia',
            confianza: '0.920',
            canal_contacto: 'whatsapp',
            iris_actor: 'asistente_ia',
            iris_conversacion: 'wa:5025512-3344:c1',
            causa_rechazo: null,
            pago_id: null,
        })
        // misma clave, mismo cuerpo: la respuesta original, sin otro comprobante
        const repetida = await estado(subir(client, token, campos, { clave }), 201)
        assert.equal(repetida.body().id, r.body().id)
        assert.equal(repetida.header('idempotent-replayed'), 'true')

        const cola = await estado(
            client.get(`/api/v1/comprobantes?canal=iris&cliente_id=${clienteId}`).bearerToken(token),
            200,
        )
        assert.deepEqual(
            cola.body().data.map((c: any) => c.id),
            [r.body().id],
        )
        const vacia = await estado(
            client.get(`/api/v1/comprobantes?canal=portal&cliente_id=${clienteId}`).bearerToken(token),
            200,
        )
        assert.lengthOf(vacia.body().data, 0)

        const auditada = await db
            .from('audit.acciones')
            .where('accion', 'comprobantes.registrar')
            .where('entidad_id', r.body().id)
            .select('canal', 'iris_actor', 'iris_conversacion')
        assert.lengthOf(auditada, 1)
        assert.equal(auditada[0].canal, 'ia')
        assert.equal(auditada[0].iris_actor, 'asistente_ia')
        assert.equal(auditada[0].iris_conversacion, 'wa:5025512-3344:c1')

        const [evento] = await eventosDe('comprobante.recibido', 'comprobante_id', r.body().id)
        assert.deepEqual(evento.payload, {
            comprobante_id: r.body().id,
            empresa_id: 1,
            cliente_id: clienteId,
            servicio_id: servicioId,
            canal: 'iris',
            monto: '300.00',
            pago_id: null,
            motivo: null,
            causa: null,
            servicio_estado: 'suspendido',
            origen: 'iris',
        })
        // un comprobante no es un pago: ni dinero ni estado
        assert.equal(await estadoServicio(servicioId), 'suspendido')
        await afirmarLibroCuadrado(assert)
    })

    test('400 sin cabeceras de Iris o sin Idempotency-Key; 422 sin canal_contacto ni leido_por', async ({
        client,
        assert,
    }) => {
        const { token } = await tokenIris()
        const { clienteId, servicioId } = await servicioCortado()
        const cuenta = await cuentaBancariaPrueba()
        const campos = await camposBoleta(clienteId, servicioId, cuenta.id)

        const sinActor = await subir(client, token, campos, { actor: null })
        sinActor.assertStatus(400)
        assert.equal(sinActor.body().type, 'urn:argosisp:problema:cabecera_iris_requerida')
        const malActor = await subir(client, token, campos, { actor: 'robot' })
        malActor.assertStatus(400)
        assert.equal(malActor.body().type, 'urn:argosisp:problema:cabecera_iris_requerida')
        const malaConversacion = await subir(client, token, campos, { conversacion: 'con espacios' })
        malaConversacion.assertStatus(400)
        const sinClave = await subir(client, token, campos, { clave: null })
        sinClave.assertStatus(400)
        assert.equal(sinClave.body().type, 'urn:argosisp:problema:idempotency_key_requerida')

        const sinLectura = await subir(client, token, { ...campos, leido_por: null, canal_contacto: null })
        sinLectura.assertStatus(422)
        assert.sameMembers(
            sinLectura.body().errors.map((e: any) => e.field),
            ['leido_por', 'canal_contacto'],
        )
        const malaConfianza = await subir(client, token, { ...campos, confianza: '1.5' })
        malaConfianza.assertStatus(422)
        assert.equal(
            await db
                .from('billing.comprobantes')
                .where('cliente_id', clienteId)
                .count('* as n')
                .first()
                .then((f: any) => Number(f.n)),
            0,
        )
    })

    test('empresa de la cuenta: 422 empresa_no_coincide; 409 referencia_duplicada; otro usuario → canal panel sin campos de Iris', async ({
        client,
        assert,
    }) => {
        const { token } = await tokenIris()
        const { clienteId, servicioId } = await servicioCortado()
        const cuenta = await cuentaBancariaPrueba()
        const campos = await camposBoleta(clienteId, servicioId, cuenta.id)

        const otraEmpresa = await subir(client, token, { ...campos, empresa_id: 999 })
        otraEmpresa.assertStatus(422)
        assert.equal(otraEmpresa.body().type, 'urn:argosisp:problema:empresa_no_coincide')

        await estado(subir(client, token, { ...campos, empresa_id: 1 }), 201)
        const duplicada = await subir(client, token, campos)
        duplicada.assertStatus(409)
        assert.equal(duplicada.body().type, 'urn:argosisp:problema:referencia_duplicada')

        const { token: cajero } = await usuarioConRoles(['cajero'])
        const conLectura = await client
            .post('/api/v1/comprobantes')
            .bearerToken(cajero)
            .header('Idempotency-Key', unico('panel'))
            .field('cliente_id', String(clienteId))
            .field('metodo', 'deposito')
            .field('cuenta_bancaria_id', String(cuenta.id))
            .field('referencia', await unicoBd('boleta-panel'))
            .field('monto', '50.00')
            .field('fecha_deposito', '2026-10-08')
            .field('leido_por', 'ia')
            .file('archivo', PNG, { filename: 'b.png' })
        conLectura.assertStatus(422)
        assert.equal(conLectura.body().errors[0].rule, 'no_aplica')
        const panel = await client
            .post('/api/v1/comprobantes')
            .bearerToken(cajero)
            .header('Idempotency-Key', unico('panel'))
            .field('cliente_id', String(clienteId))
            .field('metodo', 'transferencia')
            .field('banco_origen_id', String(await bancoId('Banrural')))
            .field('cuenta_bancaria_id', String(cuenta.id))
            .field('referencia', await unicoBd('boleta-panel'))
            .field('monto', '50.00')
            .field('fecha_deposito', '2026-10-08')
            .file('archivo', PNG, { filename: 'b.png' })
        panel.assertStatus(201)
        assert.containSubset(panel.body(), { canal: 'panel', leido_por: null, iris_conversacion: null })
    })

    test('rechazo con causa falta_dato: payload con causa y servicio_estado; la referencia queda libre', async ({
        client,
        assert,
    }) => {
        const { token } = await tokenIris()
        const { token: admin } = await usuarioConRoles(['admin'])
        const { clienteId, servicioId } = await servicioCortado()
        const cuenta = await cuentaBancariaPrueba()
        const campos = await camposBoleta(clienteId, servicioId, cuenta.id)
        const r = await estado(subir(client, token, campos), 201)
        const rechazo = await estado(
            client
                .post(`/api/v1/comprobantes/${r.body().id}/rechazar`)
                .bearerToken(admin)
                .json({ motivo: 'No se ve el número de boleta', causa: 'falta_dato' }),
            200,
        )
        assert.equal(rechazo.body().causa_rechazo, 'falta_dato')
        const [evento] = await eventosDe('comprobante.rechazado', 'comprobante_id', r.body().id)
        assert.containSubset(evento.payload, {
            canal: 'iris',
            pago_id: null,
            motivo: 'No se ve el número de boleta',
            causa: 'falta_dato',
            servicio_estado: 'suspendido',
            origen: 'iris',
        })
        // otra vez, completo y con otra clave
        await estado(subir(client, token, campos), 201)
    })
})

test.group('Iris 0.6.0 · reactivación por un comprobante de Iris', () => {
    test('caja aprueba la boleta de Iris: servicio.estado_cambiado y pago.registrado con origen iris; el panel sin marca', async ({
        client,
        assert,
    }) => {
        const { token } = await tokenIris()
        const { token: admin } = await usuarioConRoles(['admin'])
        const cuenta = await cuentaBancariaPrueba()
        const deIris = await servicioCortado()
        const boleta = await estado(
            subir(client, token, await camposBoleta(deIris.clienteId, deIris.servicioId, cuenta.id)),
            201,
        )
        const r = await estado(
            client.post(`/api/v1/comprobantes/${boleta.body().id}/aprobar`).bearerToken(admin).json({}),
            200,
        )
        const cambios = await eventosDe('servicio.estado_cambiado', 'servicio_id', deIris.servicioId)
        assert.containSubset(cambios.at(-1)!.payload, { a: 'activo', origen: 'iris' })
        const [pago] = await eventosDe('pago.registrado', 'pago_id', r.body().pago_id)
        assert.equal(pago.payload.origen, 'iris')

        // el mismo flujo desde el panel no lleva la marca
        const delPanel = await servicioCortado()
        const panel = await client
            .post('/api/v1/comprobantes')
            .bearerToken(admin)
            .header('Idempotency-Key', unico('panel'))
            .field('cliente_id', String(delPanel.clienteId))
            .field('servicio_id', String(delPanel.servicioId))
            .field('metodo', 'deposito')
            .field('cuenta_bancaria_id', String(cuenta.id))
            .field('referencia', await unicoBd('boleta-panel'))
            .field('monto', '300.00')
            .field('fecha_deposito', '2026-10-08')
            .file('archivo', PNG, { filename: 'b.png' })
        panel.assertStatus(201)
        await estado(
            client.post(`/api/v1/comprobantes/${panel.body().id}/aprobar`).bearerToken(admin).json({}),
            200,
        )
        const delPanelCambios = await eventosDe(
            'servicio.estado_cambiado',
            'servicio_id',
            delPanel.servicioId,
        )
        assert.equal(delPanelCambios.at(-1)!.payload.a, 'activo')
        assert.notProperty(delPanelCambios.at(-1)!.payload, 'origen')
        await afirmarLibroCuadrado(assert)
    })
})

test.group('Iris 0.6.0 · reconexión temporal (§7.3)', () => {
    test('H79: comprobante sin servicio queda ligado al servicio reconectado (diff) y aprobarlo cumple la reconexión', async ({
        client,
        assert,
    }) => {
        const { token } = await tokenIris()
        const { token: admin } = await usuarioConRoles(['admin'])
        const datos = await servicioCortado()
        await habilitarReconexion(datos.plantillaId)
        const cuenta = await cuentaBancariaPrueba()
        const boleta = await estado(
            subir(client, token, await camposBoleta(datos.clienteId, null, cuenta.id)),
            201,
        )
        assert.isNull(boleta.body().servicio_id)
        const r = await estado(
            reconectar(client, token, boleta.body().id, { servicio_id: datos.servicioId }),
            201,
        )
        const fila = await db.from('billing.comprobantes').where('id', boleta.body().id).firstOrFail()
        assert.equal(Number(fila.servicio_id), datos.servicioId)
        const diff = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'comprobante', entidad_id: boleta.body().id, campo: 'servicio_id' })
        assert.lengthOf(diff, 1)
        await estado(
            client.post(`/api/v1/comprobantes/${boleta.body().id}/aprobar`).bearerToken(admin).json({}),
            200,
        )
        const promesa = await db.from('billing.promesas').where('id', r.body().promesa_id).firstOrFail()
        assert.equal(promesa.estado, 'cumplida')
        assert.equal(await estadoServicio(datos.servicioId), 'activo')
        await afirmarLibroCuadrado(assert)
    })

    test('201: promesa reconexion_temporal ligada al comprobante; el servicio se reactiva por evaluarEstadoServicio', async ({
        client,
        assert,
    }) => {
        const { token } = await tokenIris()
        const datos = await servicioCortado()
        await habilitarReconexion(datos.plantillaId)
        const cuenta = await cuentaBancariaPrueba()
        const boleta = await estado(
            subir(client, token, await camposBoleta(datos.clienteId, datos.servicioId, cuenta.id)),
            201,
        )
        const antes = Date.now()
        const r = await estado(reconectar(client, token, boleta.body().id), 201)
        assert.equal(r.body().reconexion_id, r.body().promesa_id)
        assert.deepEqual(r.body().servicio, { id: datos.servicioId, estado: 'activo' })
        const horas = (new Date(r.body().hasta).getTime() - antes) / 3_600_000
        assert.isAbove(horas, 23.9)
        assert.isBelow(horas, 24.1)
        assert.equal(await estadoServicio(datos.servicioId), 'activo')

        const promesa = await estado(
            client
                .get(`/api/v1/promesas?servicio_id=${datos.servicioId}&tipo=reconexion_temporal`)
                .bearerToken(token),
            200,
        )
        assert.containSubset(promesa.body().data[0], {
            id: r.body().promesa_id,
            tipo: 'reconexion_temporal',
            comprobante_id: boleta.body().id,
            sistema_origen: 'iris',
            canal: 'ia',
            estado: 'activa',
            monto: '300.00',
        })
        const [creada] = await eventosDe('promesa.creada', 'promesa_id', r.body().promesa_id)
        assert.deepEqual(creada.payload, {
            promesa_id: r.body().promesa_id,
            empresa_id: 1,
            cliente_id: datos.clienteId,
            servicio_id: datos.servicioId,
            tipo: 'reconexion_temporal',
            canal: 'ia',
            comprobante_id: boleta.body().id,
            vence: r.body().hasta,
            monto: '300.00',
            origen: 'iris',
        })
        const [cambio] = await db
            .from('audit.outbox')
            .where('evento', 'servicio.estado_cambiado')
            .whereRaw(`(payload->>'servicio_id')::bigint = ?`, [datos.servicioId])
            .orderBy('id', 'desc')
            .limit(1)
        assert.equal(cambio.payload.a, 'activo')
        assert.match(cambio.payload.motivo, /promesa de pago \d+ activa/)
        assert.equal(cambio.payload.origen, 'iris')
        await afirmarLibroCuadrado(assert)
    })

    test('422 reconexion_no_permitida: cada regla con su rule', async ({ client, assert }) => {
        const { token } = await tokenIris()
        const cuenta = await cuentaBancariaPrueba()

        // no_habilitada (apagada por defecto)
        const apagada = await servicioCortado()
        const b1 = await estado(
            subir(client, token, await camposBoleta(apagada.clienteId, apagada.servicioId, cuenta.id)),
            201,
        )
        assert.deepEqual(await reglaDe(reconectar(client, token, b1.body().id)), {
            status: 422,
            type: 'urn:argosisp:problema:reconexion_no_permitida',
            rule: 'no_habilitada',
        })

        // comprobante_no_cubre
        const poco = await servicioCortado()
        await habilitarReconexion(poco.plantillaId)
        const b2 = await estado(
            subir(
                client,
                token,
                await camposBoleta(poco.clienteId, poco.servicioId, cuenta.id, { monto: '299.99' }),
            ),
            201,
        )
        assert.equal(await ruleDe(reconectar(client, token, b2.body().id)), 'comprobante_no_cubre')

        // servicio_no_cortado: al día
        const alDia = await escenario()
        await habilitarReconexion(alDia.plantillaId)
        const b3 = await estado(
            subir(client, token, await camposBoleta(alDia.clienteId, alDia.servicioId, cuenta.id)),
            201,
        )
        assert.equal(await ruleDe(reconectar(client, token, b3.body().id)), 'servicio_no_cortado')

        // suspension_manual
        const manual = await servicioCortado()
        await habilitarReconexion(manual.plantillaId)
        await db
            .from('core.servicios')
            .where('id', manual.servicioId)
            .update({ suspension_manual: true, suspension_manual_motivo: 'Lo pidió el cliente' })
        const b4 = await estado(
            subir(client, token, await camposBoleta(manual.clienteId, manual.servicioId, cuenta.id)),
            201,
        )
        assert.equal(await ruleDe(reconectar(client, token, b4.body().id)), 'suspension_manual')

        // servicio_de_otro_cliente: comprobante sin servicio, se pide el de otro cliente
        const ajeno = await servicioCortado()
        await habilitarReconexion(ajeno.plantillaId)
        const b5 = await estado(
            subir(client, token, await camposBoleta(manual.clienteId, null, cuenta.id)),
            201,
        )
        assert.equal(
            await ruleDe(reconectar(client, token, b5.body().id, { servicio_id: ajeno.servicioId })),
            'servicio_de_otro_cliente',
        )
        // sin servicio en el comprobante ni en el cuerpo → 422 por campo
        const sinServicio = await reconectar(client, token, b5.body().id)
        sinServicio.assertStatus(422)
        assert.equal(sinServicio.body().errors[0].field, 'servicio_id')

        // promesa_abierta y luego comprobante_no_pendiente
        const abierta = await cortadoConReconexion(client, token)
        const otra = await estado(
            subir(client, token, await camposBoleta(abierta.clienteId, abierta.servicioId, cuenta.id)),
            201,
        )
        assert.equal(await ruleDe(reconectar(client, token, otra.body().id)), 'promesa_abierta')
        const { token: admin } = await usuarioConRoles(['admin'])
        await estado(
            client
                .post(`/api/v1/comprobantes/${otra.body().id}/rechazar`)
                .bearerToken(admin)
                .json({ motivo: 'duplicada', causa: 'duplicado' }),
            200,
        )
        assert.equal(await ruleDe(reconectar(client, token, otra.body().id)), 'comprobante_no_pendiente')

        // cupo_agotado: una por periodo aunque la primera se cancelara
        await estado(
            client
                .post(`/api/v1/comprobantes/${abierta.comprobanteId}/rechazar`)
                .bearerToken(admin)
                .json({ motivo: 'No aparece en el banco', causa: 'no_aparece' }),
            200,
        )
        const tercera = await estado(
            subir(client, token, await camposBoleta(abierta.clienteId, abierta.servicioId, cuenta.id)),
            201,
        )
        const cupo = await reglaDe(reconectar(client, token, tercera.body().id))
        assert.equal(cupo.rule, 'cupo_agotado')

        // ninguna de las rechazadas dejó promesa
        const promesas = await db
            .from('billing.promesas')
            .whereIn('comprobante_id', [b1.body().id, b2.body().id, b3.body().id, b4.body().id, b5.body().id])
        assert.lengthOf(promesas, 0)
    })

    test('cupo aparte: una reconexión del periodo no gasta el cupo de promesas normales', async ({
        client,
        assert,
    }) => {
        const { token } = await tokenIris()
        const { token: admin } = await usuarioConRoles(['admin'])
        const datos = await cortadoConReconexion(client, token)
        await estado(
            client
                .post(`/api/v1/comprobantes/${datos.comprobanteId}/rechazar`)
                .bearerToken(admin)
                .json({ motivo: 'No aparece', causa: 'no_aparece' }),
            200,
        )
        const simulada = await simularPromesa({ servicio_id: datos.servicioId, canal: 'ia' })
        assert.equal(simulada.limites.en_periodo, 0)
    })

    test('final cumplida: caja aprueba y el pago salda lo vencido; pago.registrado y comprobante.aprobado con origen iris', async ({
        client,
        assert,
    }) => {
        const { token } = await tokenIris()
        const { token: admin } = await usuarioConRoles(['admin'])
        const datos = await cortadoConReconexion(client, token)
        const r = await estado(
            client.post(`/api/v1/comprobantes/${datos.comprobanteId}/aprobar`).bearerToken(admin).json({}),
            200,
        )
        const pagoId = r.body().pago_id as number
        const promesa = await db.from('billing.promesas').where('id', datos.promesaId).firstOrFail()
        assert.equal(promesa.estado, 'cumplida')
        const [cumplida] = await eventosDe('promesa.cumplida', 'promesa_id', datos.promesaId)
        assert.include(cumplida.payload, {
            tipo: 'reconexion_temporal',
            comprobante_id: datos.comprobanteId,
            origen: 'iris',
        })
        const [aprobado] = await eventosDe('comprobante.aprobado', 'comprobante_id', datos.comprobanteId)
        assert.containSubset(aprobado.payload, {
            pago_id: pagoId,
            canal: 'iris',
            servicio_estado: 'activo',
            causa: null,
            motivo: null,
            origen: 'iris',
        })
        const [pago] = await eventosDe('pago.registrado', 'pago_id', pagoId)
        assert.equal(pago.payload.origen, 'iris')
        assert.equal(await estadoServicio(datos.servicioId), 'activo')
        await afirmarLibroCuadrado(assert)
    })

    test('final cancelada por comprobante_rechazado: se re-evalúa y vuelve a cortarse (hora de corte 00:00)', async ({
        client,
        assert,
    }) => {
        const { token } = await tokenIris()
        const { token: admin } = await usuarioConRoles(['admin'])
        const datos = await cortadoConReconexion(client, token)
        await estado(
            client
                .post(`/api/v1/comprobantes/${datos.comprobanteId}/rechazar`)
                .bearerToken(admin)
                .json({ motivo: 'El monto no coincide con el banco', causa: 'monto_distinto' }),
            200,
        )
        const promesa = await db.from('billing.promesas').where('id', datos.promesaId).firstOrFail()
        assert.equal(promesa.estado, 'cancelada')
        const [cancelada] = await eventosDe('promesa.cancelada', 'promesa_id', datos.promesaId)
        assert.deepEqual(cancelada.payload, {
            promesa_id: datos.promesaId,
            empresa_id: 1,
            cliente_id: datos.clienteId,
            servicio_id: datos.servicioId,
            tipo: 'reconexion_temporal',
            canal: 'ia',
            comprobante_id: datos.comprobanteId,
            vence: new Date(promesa.vence_en).toISOString(),
            monto: '300.00',
            origen: 'iris',
            estado: 'cancelada',
            motivo: 'comprobante_rechazado',
            detalle: null,
        })
        const cortes = await eventosDe('servicio.estado_cambiado', 'servicio_id', datos.servicioId)
        assert.containSubset(cortes.at(-1)!.payload, { a: 'suspendido', origen: 'iris' })
        assert.equal(await estadoServicio(datos.servicioId), 'suspendido')
        const [rechazado] = await eventosDe('comprobante.rechazado', 'comprobante_id', datos.comprobanteId)
        assert.include(rechazado.payload, { causa: 'monto_distinto', servicio_estado: 'suspendido' })
        await afirmarLibroCuadrado(assert)
    })

    test('cancelada por rechazo antes de la hora de corte: el servicio espera a esa hora', async ({
        assert,
    }) => {
        const datos = await servicioCortado()
        await habilitarReconexion(datos.plantillaId)
        await db
            .from('billing.plantillas_facturacion')
            .where('id', datos.plantillaId)
            .update({ hora_corte: '08:00' })
        const cuenta = await cuentaBancariaPrueba()
        const [comprobante] = (await db
            .table('billing.comprobantes')
            .insert({
                empresa_id: 1,
                cliente_id: datos.clienteId,
                servicio_id: datos.servicioId,
                metodo: 'deposito',
                cuenta_bancaria_id: cuenta.id,
                referencia: await unicoBd('boleta-hora'),
                monto: '300.00',
                fecha_deposito: '2026-10-08',
                archivo: `2026/10/${unico('x')}.png`,
                archivo_tipo: 'image/png',
                archivo_tamano: 10,
                canal: 'panel',
                estado: 'pendiente',
            })
            .returning('id')) as Array<{ id: number }>
        // 2026-10-13 06:00 Guatemala: antes de las 08:00
        const temprano = new Date('2026-10-13T06:00:00-06:00')
        const r = await new RegistrarReconexionTemporal().execute(
            {
                comprobante_id: comprobante!.id,
                motivo: 'fuera_de_horario',
                canal: 'operador',
                ahora: temprano,
            },
            contextoPrueba(),
        )
        assert.equal(r.servicio.estado, 'activo')
        await new CancelarReconexionTemporal().execute(
            { promesa_id: r.promesa_id, ahora: new Date('2026-10-13T07:00:00-06:00') },
            contextoPrueba(),
        )
        assert.equal(await estadoServicio(datos.servicioId), 'activo')
        // a la hora de corte el corte sí baja
        const { default: EvaluarEstadoServicio } = await import('#billing/actions/evaluar_estado_servicio')
        await new EvaluarEstadoServicio().execute(
            { servicio_id: datos.servicioId, ahora: new Date('2026-10-13T08:01:00-06:00') },
            contextoPrueba(),
        )
        assert.equal(await estadoServicio(datos.servicioId), 'suspendido')
    })

    test('final vencida_sin_revisar: cancelada al llegar hasta, re-evalúa y no castiga el historial', async ({
        client,
        assert,
    }) => {
        const { token } = await tokenIris()
        const datos = await cortadoConReconexion(client, token)
        const promesa = await db.from('billing.promesas').where('id', datos.promesaId).firstOrFail()
        const despues = new Date(new Date(promesa.vence_en).getTime() + 60_000)
        const r = await new IncumplirPromesas().execute(
            { servicio_id: datos.servicioId, ahora: despues },
            contextoPrueba(),
        )
        assert.equal(r.canceladas, 1)
        assert.equal(r.incumplidas, 0)
        const fila = await db.from('billing.promesas').where('id', datos.promesaId).firstOrFail()
        assert.equal(fila.estado, 'cancelada')
        const [cancelada] = await eventosDe('promesa.cancelada', 'promesa_id', datos.promesaId)
        assert.include(cancelada.payload, { motivo: 'vencida_sin_revisar', tipo: 'reconexion_temporal' })
        assert.lengthOf(await eventosDe('promesa.incumplida', 'promesa_id', datos.promesaId), 0)
        assert.equal(await estadoServicio(datos.servicioId), 'suspendido')
        // el comprobante sigue pendiente para caja
        const comprobante = await db
            .from('billing.comprobantes')
            .where('id', datos.comprobanteId)
            .firstOrFail()
        assert.equal(comprobante.estado, 'pendiente')
        // historial limpio: no cuenta como incumplida (sin bloqueo tras incumplida)
        const simulada = await simularPromesa({ servicio_id: datos.servicioId, canal: 'ia', ahora: despues })
        assert.equal(simulada.historial.resueltas, 0)
        const bloqueo = simulada.reglas.find((x) => x.regla === 'bloqueo_tras_incumplida_dias')!
        assert.isTrue(bloqueo.ok)
    })

    test('final incumplida: caja aprueba pero el pago no salda lo vencido; sigue activa hasta y entonces se incumple', async ({
        client,
        assert,
    }) => {
        const { token } = await tokenIris()
        const datos = await cortadoConReconexion(client, token)
        // otra factura del mismo cliente (otro servicio, aún no vencida): caja aplica ahí el depósito
        const planCaro = await crearPlanFila({ precio: '300.00' })
        const otroServicio = await crearServicioFila({
            cliente_id: datos.clienteId,
            plan_id: planCaro,
            plantilla_facturacion_id: datos.plantillaId,
            fecha_instalacion: '2026-10-01',
        })
        await generar(otroServicio, '2026-10-01')
        const [otra] = (await db
            .from('billing.facturas')
            .where('servicio_id', otroServicio)
            .whereIn('estado', ['emitida', 'vencida'])
            .orderBy('id')
            .select('id', 'total')) as Array<{ id: number; total: string }>
        assert.isAtLeast(Number(otra!.total), 300)
        const { usuario } = await usuarioConRoles(['admin'])
        await new AprobarComprobante().execute(
            { comprobante_id: datos.comprobanteId, facturas: [otra!.id] },
            { ...contextoPrueba(usuario.id), canal: 'panel' },
        )
        let fila = await db.from('billing.promesas').where('id', datos.promesaId).firstOrFail()
        assert.equal(fila.estado, 'activa')
        assert.equal(await estadoServicio(datos.servicioId), 'activo')
        const despues = new Date(new Date(fila.vence_en).getTime() + 60_000)
        await new IncumplirPromesas().execute(
            { servicio_id: datos.servicioId, ahora: despues },
            contextoPrueba(),
        )
        fila = await db.from('billing.promesas').where('id', datos.promesaId).firstOrFail()
        assert.equal(fila.estado, 'incumplida')
        const [incumplida] = await eventosDe('promesa.incumplida', 'promesa_id', datos.promesaId)
        assert.include(incumplida.payload, { tipo: 'reconexion_temporal' })
        await afirmarLibroCuadrado(assert)
    })

    test('excepción por servicio: reglas_promesa.reconexion_temporal del servicio manda sobre la plantilla', async ({
        client,
        assert,
    }) => {
        const { token } = await tokenIris()
        const datos = await servicioCortado()
        await db.table('core.servicios_excepciones').insert({
            servicio_id: datos.servicioId,
            campo: 'reglas_promesa',
            valor: JSON.stringify({ reconexion_temporal: { permitida: true, horas_max: 6 } }),
        })
        const cuenta = await cuentaBancariaPrueba()
        const boleta = await estado(
            subir(client, token, await camposBoleta(datos.clienteId, datos.servicioId, cuenta.id)),
            201,
        )
        const antes = Date.now()
        const r = await estado(reconectar(client, token, boleta.body().id), 201)
        const horas = (new Date(r.body().hasta).getTime() - antes) / 3_600_000
        assert.isBelow(horas, 6.1)
    })
})

test.group('Iris 0.6.0 · promesas (§7.4)', () => {
    function prometer(
        client: ApiClient,
        token: string,
        cuerpo: Record<string, unknown>,
        actor: string | null = 'asistente_ia',
        clave: string | null = unico('iris:promesa'),
    ) {
        return cabeceras(client.post('/api/v1/promesas').bearerToken(token).json(cuerpo), clave, actor)
    }

    const manana = () => new Date(Date.now() + 86_400_000).toISOString()

    test('canal desde X-Iris-Actor: asistente_ia → ia, usuario:<id> → operador; 201 con estado; 409 promesa_abierta', async ({
        client,
        assert,
    }) => {
        const { token } = await tokenIris()
        const datos = await servicioCortado({
            plantilla: { reglas_promesa: reglasPromesaSinTopeFacturacion() },
        })
        const r = await estado(
            prometer(client, token, {
                servicio_id: datos.servicioId,
                vence_en: manana(),
                canal: 'supervisor',
            }),
            201,
        )
        assert.containSubset(r.body(), {
            estado: 'activa',
            canal: 'ia',
            tipo: 'promesa',
            sistema_origen: 'iris',
        })
        assert.equal(r.body().servicio.estado, 'activo')
        const [creada] = await eventosDe('promesa.creada', 'promesa_id', r.body().id)
        assert.include(creada.payload, {
            tipo: 'promesa',
            canal: 'ia',
            comprobante_id: null,
            origen: 'iris',
            cliente_id: datos.clienteId,
        })
        const auditada = await db
            .from('audit.acciones')
            .where('accion', 'promesas.crear')
            .where('entidad_id', r.body().id)
            .first()
        assert.equal(auditada.canal, 'ia')
        assert.equal(auditada.iris_conversacion, 'wa:5025512-3344:c1')

        const abierta = await prometer(client, token, { servicio_id: datos.servicioId, vence_en: manana() })
        abierta.assertStatus(409)
        assert.equal(abierta.body().type, 'urn:argosisp:problema:promesa_abierta')

        const otro = await servicioCortado({
            plantilla: { reglas_promesa: reglasPromesaSinTopeFacturacion() },
        })
        const op = await estado(
            prometer(client, token, { servicio_id: otro.servicioId, vence_en: manana() }, 'usuario:ana_01'),
            201,
        )
        assert.equal(op.body().canal, 'operador')
        const auditOp = await db
            .from('audit.acciones')
            .where('accion', 'promesas.crear')
            .where('entidad_id', op.body().id)
            .first()
        assert.equal(auditOp.canal, 'api')
        assert.equal(auditOp.iris_actor, 'usuario:ana_01')
    })

    test('rechazada por política: 201 con estado rechazada y la regla; 400 sin cabeceras o sin clave; 422 empresa_no_coincide', async ({
        client,
        assert,
    }) => {
        const { token } = await tokenIris()
        const datos = await servicioCortado({
            plantilla: {
                reglas_promesa: reglasPromesaSinTopeFacturacion({
                    canales: { ia: { plazo_max_dias: 1 } } as any,
                }),
            },
        })
        const lejos = new Date(Date.now() + 5 * 86_400_000).toISOString()
        const r = await estado(
            prometer(client, token, { servicio_id: datos.servicioId, vence_en: lejos }),
            201,
        )
        assert.equal(r.body().estado, 'rechazada')
        assert.equal(r.body().resultado_evaluacion.regla, 'plazo_max_dias')
        assert.equal(await estadoServicio(datos.servicioId), 'suspendido')

        const sinCabeceras = await prometer(
            client,
            token,
            { servicio_id: datos.servicioId, vence_en: manana() },
            null,
        )
        sinCabeceras.assertStatus(400)
        assert.equal(sinCabeceras.body().type, 'urn:argosisp:problema:cabecera_iris_requerida')
        const sinClave = await prometer(
            client,
            token,
            { servicio_id: datos.servicioId, vence_en: manana() },
            'asistente_ia',
            null,
        )
        sinClave.assertStatus(400)
        assert.equal(sinClave.body().type, 'urn:argosisp:problema:idempotency_key_requerida')
        const empresa = await prometer(client, token, {
            servicio_id: datos.servicioId,
            vence_en: manana(),
            empresa_id: 999,
        })
        empresa.assertStatus(422)
        assert.equal(empresa.body().type, 'urn:argosisp:problema:empresa_no_coincide')
    })

    test('simulador con el canal de Iris: limites con plazo_max_dias, fecha_maxima, max_por_periodo, en_periodo, deuda_vencida y monto_promesa', async ({
        client,
        assert,
    }) => {
        const { token } = await tokenIris()
        const datos = await servicioCortado({
            plantilla: { reglas_promesa: reglasPromesaSinTopeFacturacion() },
        })
        const r = await estado(
            cabeceras(
                client
                    .post('/api/v1/promesas/simular')
                    .bearerToken(token)
                    .json({ servicio_id: datos.servicioId }),
                null,
            ),
            200,
        )
        assert.equal(r.body().canal, 'ia')
        assert.containSubset(r.body().limites, {
            plazo_max_dias: 3,
            max_por_periodo: 1,
            en_periodo: 0,
            deuda_vencida: '300.00',
            monto_promesa: '300.00',
        })
        assert.match(r.body().limites.fecha_maxima, /^\d{4}-\d{2}-\d{2}$/)
        assert.notEqual(r.body().resultado_creacion, 'error')
        const sin = await client
            .post('/api/v1/promesas/simular')
            .bearerToken(token)
            .json({ servicio_id: datos.servicioId })
        sin.assertStatus(400)
        // no audita ni crea nada
        assert.lengthOf(await db.from('billing.promesas').where('servicio_id', datos.servicioId), 0)
    })

    test('promesa.cancelada también cuando un supervisor cancela (motivo cancelada_por_supervisor y su texto)', async ({
        assert,
    }) => {
        const datos = await servicioCortado({
            plantilla: { reglas_promesa: reglasPromesaSinTopeFacturacion() },
        })
        const { default: CrearPromesaPago } = await import('#billing/actions/crear_promesa_pago')
        const p = await new CrearPromesaPago().execute(
            { servicio_id: datos.servicioId, vence_en: new Date(Date.now() + 86_400_000), canal: 'operador' },
            contextoPrueba(),
        )
        assert.equal(p.estado, 'activa')
        const { usuario } = await usuarioConRoles(['admin'])
        await new CancelarPromesa().execute(
            { promesa_id: p.id, motivo: 'El cliente pidió anularla' },
            contextoPrueba(usuario.id),
        )
        const [cancelada] = await eventosDe('promesa.cancelada', 'promesa_id', p.id)
        assert.include(cancelada.payload, {
            tipo: 'promesa',
            canal: 'operador',
            origen: null,
            estado: 'cancelada',
            motivo: 'cancelada_por_supervisor',
            detalle: 'El cliente pidió anularla',
        })
        assert.equal(await estadoServicio(datos.servicioId), 'suspendido')
    })
})

test.group('Iris 0.6.0 · lecturas de §7 con el token de Iris', () => {
    test('GET /cuentas-bancarias, GET /bancos y GET /comprobantes/:id exigen las cabeceras de Iris', async ({
        client,
        assert,
    }) => {
        const { token } = await tokenIris()
        const { clienteId, servicioId } = await servicioCortado()
        const cuenta = await cuentaBancariaPrueba()
        const boleta = await estado(
            subir(client, token, await camposBoleta(clienteId, servicioId, cuenta.id)),
            201,
        )
        for (const ruta of [
            '/api/v1/cuentas-bancarias?activa=true',
            '/api/v1/bancos',
            `/api/v1/comprobantes/${boleta.body().id}`,
        ]) {
            const sin = await client.get(ruta).bearerToken(token)
            sin.assertStatus(400)
            assert.equal(sin.body().type, 'urn:argosisp:problema:cabecera_iris_requerida')
            await estado(cabeceras(client.get(ruta).bearerToken(token), null), 200)
        }
        const vista = await estado(
            cabeceras(client.get(`/api/v1/comprobantes/${boleta.body().id}`).bearerToken(token), null),
            200,
        )
        assert.equal(vista.body().iris_conversacion, 'wa:5025512-3344:c1')
        // otro usuario no las necesita
        const { token: admin } = await usuarioConRoles(['admin'])
        await estado(client.get('/api/v1/bancos').bearerToken(admin), 200)
    })
})
