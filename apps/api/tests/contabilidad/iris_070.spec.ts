import { randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import type { ApiClient, ApiRequest } from '@japa/api-client'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, soloEmpresaPrincipal, unico, usuarioConRoles } from '#tests/ayudas'
import { afirmarLibroCuadrado } from '#tests/ledger/ayudas_libro'
import {
    compararFotoLibro,
    contarAsientos,
    fotoLibro,
    huellaTablas,
    marcasAuditoria,
    verificarLibro,
    type Violacion,
} from '#tests/contabilidad/verificar_libro'
import {
    cuentaBancariaPrueba,
    estadoServicio,
    eventosDe,
    servicioCortado,
    unicoBd,
} from '#tests/billing/ayudas_billing'
import { crearEmpresaFila } from '#tests/core/fabricas'
import GenerarTokenIris from '#core/actions/generar_token_iris'
import { usuarioIris } from '#core/integraciones_iris'
import { normalizarReglasPromesa } from '#billing/reglas_promesa'
import { dec } from '#ledger/dinero'

/**
 * Auditor contable · contrato Iris 0.7.0 §7.7 (A23, rama `a3/iris-a23` 0f70fbf): un operador de
 * Iris vinculado a un usuario de Argos aprueba o rechaza comprobantes de Iris **como ese usuario**
 * (`POST /comprobantes/:id/aprobar|rechazar` con el token Iris, `X-Iris-Actor: usuario:<id>`).
 *
 * Lo que se verifica, por HTTP y contra el libro:
 * - aprobar = un solo pago por el monto del comprobante (el cuerpo no puede cambiar monto ni fecha),
 *   su asiento `Bancos / CxC` cuadrado, el auxiliar del cliente en cero y los invariantes 26.* (con
 *   los nuevos de la vía: `verificado_por = registrado_por`, vía solo sobre comprobantes de Iris y
 *   con su acción raíz, pago del mismo usuario que la auditoría);
 * - con reconexión temporal, la promesa cumplida en la misma petición, sin asiento propio;
 * - rechazar no escribe nada en `ledger.*` y cancela la reconexión;
 * - concurrencia (varios operadores, y la misma clave a la vez) y replay: un solo pago y un asiento;
 * - multiempresa: el asiento en la empresa del comprobante; un operador sin esa empresa no deja nada;
 *   una factura de otra empresa en `facturas[]` no cruza dineros entre NIT;
 * - nada de lo anterior edita ni borra filas previas de `ledger.*` ni `audit.*`.
 */

const PNG = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('IHDR-boleta-auditor-070'),
])
const CONVERSACION = 'wa:5025512-0000:auditor-070'

/*
| Ayudas HTTP (las de A3 en `tests/billing/iris_aprobar_070.spec.ts` no se exportan)
*/

async function tokenIris() {
    const generado = await new GenerarTokenIris().execute({ nombre: unico('Iris') }, contextoPrueba())
    const id = (await usuarioIris())!
    await db.from('core.usuarios').where('id', id).update({ activo: true, alcance_global: true })
    await db.from('core.usuarios_empresas').where('usuario_id', id).delete()
    return { token: generado.token, tokenId: Number(generado.datos.id) }
}

/** Usuario de Argos vinculado a un id nuevo de Iris; `empresas` acota su alcance. */
async function operador(roles: string[] = ['cajero'], empresas?: number[]) {
    const local = await usuarioConRoles(roles)
    const idIris = unico('aud').replace(/[^A-Za-z0-9_-]/g, '_')
    await db.table('core.vinculaciones_externas').insert({
        conector: 'iris',
        id_externo: idIris,
        usuario_id: local.usuario.id,
    })
    if (empresas) {
        await db.from('core.usuarios').where('id', local.usuario.id).update({ alcance_global: false })
        for (const empresaId of empresas) {
            await db
                .table('core.usuarios_empresas')
                .insert({ usuario_id: local.usuario.id, empresa_id: empresaId })
        }
    }
    return { ...local, actor: `usuario:${idIris}` }
}

interface OpcionesIris {
    clave?: string
    requestId?: string
    empresaId?: number
    cuerpo?: Record<string, unknown>
}

function conIris(peticion: ApiRequest, actor: string, opciones: OpcionesIris) {
    let p = peticion
        .header('X-Request-Id', opciones.requestId ?? randomUUID())
        .header('X-Iris-Actor', actor)
        .header('X-Iris-Conversacion', CONVERSACION)
        .header('Idempotency-Key', opciones.clave ?? unico('aud:k'))
    if (opciones.empresaId) p = p.header('X-Empresa-Id', String(opciones.empresaId))
    return p
}

const aprobar = (client: ApiClient, token: string, id: number, actor: string, o: OpcionesIris = {}) =>
    conIris(
        client
            .post(`/api/v1/comprobantes/${id}/aprobar`)
            .bearerToken(token)
            .json(o.cuerpo ?? {}),
        actor,
        o,
    )

const rechazar = (client: ApiClient, token: string, id: number, actor: string, o: OpcionesIris = {}) =>
    conIris(
        client
            .post(`/api/v1/comprobantes/${id}/rechazar`)
            .bearerToken(token)
            .json(o.cuerpo ?? { motivo: 'No aparece en el banco', causa: 'no_aparece' }),
        actor,
        o,
    )

interface Boleta {
    clienteId: number
    servicioId: number
    plantillaId: number
    comprobanteId: number
    reconexionId: number | null
    empresaId: number
}

/** Servicio cortado (Q300 vencidos) con una boleta subida por el asistente de Iris. */
async function boletaDeIris(
    client: ApiClient,
    token: string,
    opciones: { reconexion?: boolean; empresaId?: number; monto?: string } = {},
): Promise<Boleta> {
    const empresaId = opciones.empresaId ?? 1
    const datos = await servicioCortado({ servicio: { empresa_id: empresaId } })
    if (opciones.reconexion) {
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
    const cuenta = await cuentaBancariaPrueba('Banrural', empresaId)
    const campos: Record<string, string | number> = {
        cliente_id: datos.clienteId,
        servicio_id: datos.servicioId,
        metodo: 'deposito',
        cuenta_bancaria_id: cuenta.id,
        referencia: await unicoBd('boleta-aud-070'),
        monto: opciones.monto ?? '300.00',
        fecha_deposito: '2026-10-08',
        canal_contacto: 'whatsapp',
        leido_por: 'ia',
    }
    let p = client.post('/api/v1/comprobantes').bearerToken(token)
    for (const [nombre, valor] of Object.entries(campos)) p = p.field(nombre, String(valor))
    p = p.file('archivo', PNG, { filename: 'boleta.png' })
    const r = await estado(conIris(p, 'asistente_ia', { empresaId }), 201)
    const comprobanteId = r.body().id as number
    let reconexionId: number | null = null
    if (opciones.reconexion) {
        const rec = await estado(
            conIris(
                client
                    .post(`/api/v1/comprobantes/${comprobanteId}/reconexion-temporal`)
                    .bearerToken(token)
                    .json({ motivo: 'fuera_de_horario' }),
                'asistente_ia',
                { empresaId },
            ),
            201,
        )
        reconexionId = rec.body().promesa_id as number
    }
    return { ...datos, comprobanteId, reconexionId, empresaId }
}

/*
| Ayudas contables
*/

async function auxiliar(clienteId: number, empresaId = 1): Promise<string> {
    const { rows } = (await db.rawQuery(
        `SELECT coalesce(sum(m.debe - m.haber), 0)::numeric(14,2)::text AS saldo
           FROM ledger.movimientos m JOIN ledger.cuentas c ON c.id = m.cuenta_id
           JOIN ledger.asientos a ON a.id = m.asiento_id
          WHERE c.codigo = '1.1.03' AND m.cliente_id = ? AND a.empresa_id = ?`,
        [clienteId, empresaId],
    )) as { rows: Array<{ saldo: string }> }
    return rows[0]!.saldo
}

async function pagosDe(clienteId: number) {
    return db
        .from('billing.pagos')
        .where('cliente_id', clienteId)
        .orderBy('id')
        .select('id', 'monto', 'estado', 'empresa_id', 'registrado_por')
}

async function asientosDePago(clienteId: number) {
    const todos = await asientosDelCliente(clienteId)
    return todos.filter((a) => a.origen_tipo === 'pago')
}

/** Asientos del cliente (cualquier origen) con su cuadre y su empresa. */
async function asientosDelCliente(clienteId: number) {
    const { rows } = (await db.rawQuery(
        `SELECT a.id, a.empresa_id, a.origen_tipo, a.origen_id, to_char(a.fecha, 'YYYY-MM-DD') AS fecha,
                sum(m.debe)::text AS debe, sum(m.haber)::text AS haber,
                array_agg(c.codigo || ':' || m.debe || ':' || m.haber ORDER BY m.id) AS lineas
           FROM ledger.asientos a JOIN ledger.movimientos m ON m.asiento_id = a.id
           JOIN ledger.cuentas c ON c.id = m.cuenta_id
          WHERE a.id IN (SELECT asiento_id FROM ledger.movimientos WHERE cliente_id = ?)
          GROUP BY a.id ORDER BY a.id`,
        [clienteId],
    )) as {
        rows: Array<{
            id: number
            empresa_id: number
            origen_tipo: string
            origen_id: number
            fecha: string
            debe: string
            haber: string
            lineas: string[]
        }>
    }
    return rows
}

async function huellaLedger() {
    const todas = await huellaTablas()
    return Object.fromEntries(Object.entries(todas).filter(([t]) => t.startsWith('ledger.')))
}

/**
 * Violaciones que dejó **esta prueba** (como en `iris_060`): otras suites dejan en la empresa 1 datos
 * armados a mano que rompen invariantes sin filtro por cliente.
 */
let previas = new Set<string>()
const huellaViolacion = (v: Violacion) => JSON.stringify([v.invariante, v.detalle])

async function fijarPrevias(empresas: number[] = [1]) {
    const antes = await verificarLibro(empresas, { clientes: [], sinFuncionesProducto: true })
    previas = new Set(antes.map(huellaViolacion))
}

async function invariantes(clientes: number[], empresas: number[] = [1]) {
    const ahora = await verificarLibro(empresas, { clientes, sinFuncionesProducto: true })
    return ahora.filter((v) => !previas.has(huellaViolacion(v)))
}

test.group('Auditor · Iris 0.7.0 · aprobar y rechazar como el usuario vinculado', (group) => {
    let foto: Awaited<ReturnType<typeof fotoLibro>>
    let desde = { acciones: 0, outbox: 0 }
    group.each.setup(async () => {
        await db.from('integraciones.iris_enlaces').delete()
        await db.from('integraciones.iris_conector').delete()
        await fijarPrevias()
        const marcas = await marcasAuditoria()
        desde = { acciones: Math.max(0, marcas.acciones - 2000), outbox: Math.max(0, marcas.outbox - 2000) }
        foto = await fotoLibro([1], desde.acciones, desde.outbox)
    })
    group.each.teardown(async () => {
        // inmutabilidad: lo que existía antes de la prueba sigue idéntico (solo se agregan filas)
        const despues = await fotoLibro([1], desde.acciones, desde.outbox)
        const violaciones = compararFotoLibro(foto, despues)
        if (violaciones.length > 0) throw new Error(JSON.stringify(violaciones))
    })
    group.teardown(soloEmpresaPrincipal)

    test('aprobar: un pago por el monto del comprobante (ni monto ni fecha del cuerpo), asiento Bancos/CxC cuadrado y 26.* en verde', async ({
        client,
        assert,
    }) => {
        const iris = await tokenIris()
        const op = await operador()
        const datos = await boletaDeIris(client, iris.token)
        assert.equal(await auxiliar(datos.clienteId), '300.00')
        const requestId = randomUUID()
        const r = await estado(
            aprobar(client, iris.token, datos.comprobanteId, op.actor, {
                requestId,
                // Iris no puede cambiar el monto ni la fecha: el validador los descarta
                cuerpo: { monto: '1.00', fecha: '2020-01-01', nota: 'Verificado en banca' },
            }),
            200,
        )
        const pagos = await pagosDe(datos.clienteId)
        assert.lengthOf(pagos, 1)
        assert.equal(pagos[0].id, r.body().pago_id)
        assert.isTrue(dec(pagos[0].monto).eq('300.00'))
        assert.equal(Number(pagos[0].empresa_id), 1)
        assert.equal(Number(pagos[0].registrado_por), op.usuario.id)
        assert.equal(Number(r.body().verificado_por), op.usuario.id)

        const asientos = await asientosDelCliente(datos.clienteId)
        const delPago = asientos.filter((a) => a.origen_tipo === 'pago')
        assert.lengthOf(delPago, 1)
        assert.equal(delPago[0]!.origen_id, pagos[0].id)
        assert.equal(delPago[0]!.debe, delPago[0]!.haber)
        assert.isTrue(dec(delPago[0]!.debe).eq('300.00'))
        assert.notEqual(delPago[0]!.fecha, '2020-01-01')
        assert.isTrue(delPago[0]!.lineas.some((l) => l.startsWith('1.1.03:0.00:300.00')))
        assert.equal(await auxiliar(datos.clienteId), '0.00')
        assert.equal(await estadoServicio(datos.servicioId), 'activo')

        // auditoría: toda fila del request a nombre del vinculado, con la vía
        const filas = await db.from('audit.acciones').where('request_id', requestId).orderBy('id')
        assert.includeMembers(
            filas.map((f) => f.accion),
            ['comprobantes.aprobar', 'pagos.registrar'],
        )
        for (const f of filas) {
            assert.equal(Number(f.actor_id), op.usuario.id, f.accion)
            assert.equal(Number(f.via_token_id), iris.tokenId, f.accion)
        }
        // el evento de pago y el del comprobante en la misma petición
        const [evento] = await eventosDe('comprobante.aprobado', 'comprobante_id', datos.comprobanteId)
        const [pagoEv] = await eventosDe('pago.registrado', 'pago_id', pagos[0].id)
        assert.equal(evento.request_id, pagoEv.request_id)
        assert.equal(pagoEv.payload.monto, '300.00')

        assert.deepEqual(await invariantes([datos.clienteId]), [])
        await afirmarLibroCuadrado(assert)
    })

    test('con reconexión temporal: promesa cumplida en la misma petición, sin asiento propio, y el libro cuadra', async ({
        client,
        assert,
    }) => {
        const iris = await tokenIris()
        const op = await operador()
        const datos = await boletaDeIris(client, iris.token, { reconexion: true })
        assert.equal(await estadoServicio(datos.servicioId), 'activo')
        const asientosAntes = await asientosDelCliente(datos.clienteId)
        const r = await estado(aprobar(client, iris.token, datos.comprobanteId, op.actor), 200)

        const promesa = await db.from('billing.promesas').where('id', datos.reconexionId!).firstOrFail()
        assert.equal(promesa.estado, 'cumplida')
        const [cumplida] = await eventosDe('promesa.cumplida', 'promesa_id', datos.reconexionId!)
        const [pagoEv] = await eventosDe('pago.registrado', 'pago_id', r.body().pago_id)
        assert.equal(cumplida.request_id, pagoEv.request_id)

        // el único asiento nuevo es el del pago; la promesa no mueve el libro
        const despues = await asientosDelCliente(datos.clienteId)
        const nuevos = despues.filter((a) => !asientosAntes.some((x) => x.id === a.id))
        assert.deepEqual(
            nuevos.map((a) => [a.origen_tipo, a.origen_id]),
            [['pago', r.body().pago_id]],
        )
        assert.lengthOf(
            await db
                .from('ledger.asientos')
                .where('origen_tipo', 'promesa')
                .where('origen_id', datos.reconexionId!),
            0,
        )
        assert.equal(await auxiliar(datos.clienteId), '0.00')
        assert.equal(await estadoServicio(datos.servicioId), 'activo')
        assert.deepEqual(await invariantes([datos.clienteId]), [])
        await afirmarLibroCuadrado(assert)
    })

    test('rechazar: nada en ledger, reconexión cancelada, verificado_por el vinculado', async ({
        client,
        assert,
    }) => {
        const iris = await tokenIris()
        const op = await operador(['contabilidad'])
        const datos = await boletaDeIris(client, iris.token, { reconexion: true })
        const antes = await huellaLedger()
        const r = await estado(rechazar(client, iris.token, datos.comprobanteId, op.actor), 200)
        assert.equal(r.body().estado, 'rechazado')
        assert.isNull(r.body().pago_id)
        assert.equal(Number(r.body().verificado_por), op.usuario.id)
        assert.deepEqual(await huellaLedger(), antes, 'rechazar no escribe en ledger')
        assert.lengthOf(await pagosDe(datos.clienteId), 0)
        assert.equal(await auxiliar(datos.clienteId), '300.00')
        const promesa = await db.from('billing.promesas').where('id', datos.reconexionId!).firstOrFail()
        assert.equal(promesa.estado, 'cancelada')
        assert.equal(await estadoServicio(datos.servicioId), 'suspendido')
        assert.deepEqual(await invariantes([datos.clienteId]), [])
        await afirmarLibroCuadrado(assert)
    })

    test('concurrencia: tres operadores y la misma clave a la vez dejan un solo pago y un solo asiento', async ({
        client,
        assert,
    }) => {
        const iris = await tokenIris()
        const ops = await Promise.all([operador(), operador(), operador(['contabilidad'])])
        const datos = await boletaDeIris(client, iris.token)
        const r = await Promise.all([
            aprobar(client, iris.token, datos.comprobanteId, ops[0].actor),
            aprobar(client, iris.token, datos.comprobanteId, ops[1].actor),
            rechazar(client, iris.token, datos.comprobanteId, ops[2].actor),
            aprobar(client, iris.token, datos.comprobanteId, ops[0].actor),
        ])
        assert.lengthOf(
            r.filter((x) => x.status() === 200),
            1,
            JSON.stringify(r.map((x) => [x.status(), x.body().type])),
        )
        const fila = await db.from('billing.comprobantes').where('id', datos.comprobanteId).firstOrFail()
        const pagos = await pagosDe(datos.clienteId)
        assert.lengthOf(pagos, fila.estado === 'aprobado' ? 1 : 0)
        assert.lengthOf(await asientosDePago(datos.clienteId), pagos.length)

        // la misma Idempotency-Key, el mismo operador, a la vez
        const otra = await boletaDeIris(client, iris.token)
        const clave = `iris:aprobar:${otra.comprobanteId}:${unico('k')}`
        const dobles = await Promise.all([
            aprobar(client, iris.token, otra.comprobanteId, ops[0].actor, { clave }),
            aprobar(client, iris.token, otra.comprobanteId, ops[0].actor, { clave }),
        ])
        assert.isTrue(
            dobles.some((x) => x.status() === 200),
            JSON.stringify(dobles.map((x) => [x.status(), x.body()])),
        )
        assert.lengthOf(await pagosDe(otra.clienteId), 1)
        assert.lengthOf(await asientosDePago(otra.clienteId), 1)
        assert.deepEqual(await invariantes([datos.clienteId, otra.clienteId]), [])
        await afirmarLibroCuadrado(assert)
    })

    test('replay idempotente: misma respuesta, sin pago, asiento, auditoría ni evento nuevos', async ({
        client,
        assert,
    }) => {
        const iris = await tokenIris()
        const op = await operador()
        const datos = await boletaDeIris(client, iris.token)
        const clave = `iris:aprobar:${datos.comprobanteId}`
        const primera = await estado(
            aprobar(client, iris.token, datos.comprobanteId, op.actor, { clave }),
            200,
        )
        const asientos = await contarAsientos([1])
        const marcas = await marcasAuditoria()
        const ledger = await huellaLedger()

        const replay = await estado(
            aprobar(client, iris.token, datos.comprobanteId, op.actor, { clave }),
            200,
        )
        assert.equal(replay.header('idempotent-replayed'), 'true')
        assert.equal(replay.body().pago_id, primera.body().pago_id)
        assert.equal(replay.body().monto, '300.00')
        assert.equal(await contarAsientos([1]), asientos)
        assert.deepEqual(await huellaLedger(), ledger)
        assert.deepEqual(await marcasAuditoria(), marcas, 'el replay no audita ni emite')
        assert.lengthOf(await pagosDe(datos.clienteId), 1)
        assert.deepEqual(await invariantes([datos.clienteId]), [])
        await afirmarLibroCuadrado(assert)
    })

    test('verificado_por y registrado_por = el vinculado; el invariante 26 lo detecta si no', async ({
        client,
        assert,
    }) => {
        const iris = await tokenIris()
        const op = await operador()
        const datos = await boletaDeIris(client, iris.token)
        const r = await estado(aprobar(client, iris.token, datos.comprobanteId, op.actor), 200)
        const pagoId = r.body().pago_id as number
        const k = await db.from('billing.comprobantes').where('id', datos.comprobanteId).firstOrFail()
        const p = await db.from('billing.pagos').where('id', pagoId).firstOrFail()
        assert.equal(Number(k.verificado_por), op.usuario.id)
        assert.equal(Number(p.registrado_por), op.usuario.id)
        assert.notEqual(op.usuario.id, (await usuarioIris())!, 'nunca el usuario técnico Iris')
        assert.deepEqual(await invariantes([datos.clienteId]), [])

        // control del invariante: un pago a nombre de otro (en una transacción que se revierte)
        const otro = await usuarioConRoles(['cajero'])
        const trx = await db.transaction()
        try {
            await trx.from('billing.pagos').where('id', pagoId).update({ registrado_por: otro.usuario.id })
            const v = await verificarLibro(1, {
                clientes: [datos.clienteId],
                sinFuncionesProducto: true,
                cliente: trx,
            })
            const nombres = v.map((x) => x.invariante.split(' ')[0])
            assert.include(nombres, '26.comprobante_aprobado_por_otro_que_su_pago')
            assert.include(nombres, '26.via_pago_de_otro_usuario')
        } finally {
            await trx.rollback()
        }
    })
})

test.group('Auditor · Iris 0.7.0 · multiempresa', (group) => {
    let B: number
    group.each.setup(async () => {
        await db.from('integraciones.iris_enlaces').delete()
        await db.from('integraciones.iris_conector').delete()
        B = await crearEmpresaFila()
        await fijarPrevias([1, B])
    })
    group.teardown(soloEmpresaPrincipal)

    test('el asiento va a la empresa del comprobante; un operador sin esa empresa no deja nada', async ({
        client,
        assert,
    }) => {
        const iris = await tokenIris()
        const deB = await operador(['cajero'], [B])
        const deA = await operador(['cajero'], [1])
        const datos = await boletaDeIris(client, iris.token, { empresaId: B })
        const k = await db.from('billing.comprobantes').where('id', datos.comprobanteId).firstOrFail()
        assert.equal(Number(k.empresa_id), B)

        // operador de la empresa 1: 403 actor_sin_empresa, sin asiento en ninguna empresa
        const antes = await contarAsientos([1, B])
        const r403 = await estado(aprobar(client, iris.token, datos.comprobanteId, deA.actor), 403)
        assert.equal(r403.body().type, 'urn:argosisp:problema:actor_sin_empresa')
        assert.equal(await contarAsientos([1, B]), antes)
        assert.lengthOf(await pagosDe(datos.clienteId), 0)

        // factura de otra empresa en facturas[]: no se cruzan dineros entre NIT
        const enA = await boletaDeIris(client, iris.token)
        const facturaA = await db
            .from('billing.facturas')
            .where('servicio_id', enA.servicioId)
            .select('id')
            .firstOrFail()
        const antesCruce = await contarAsientos([1, B])
        const global = await operador(['cajero'])
        const cruce = await client
            .post(`/api/v1/comprobantes/${datos.comprobanteId}/aprobar`)
            .bearerToken(iris.token)
            .header('X-Iris-Actor', global.actor)
            .header('X-Iris-Conversacion', CONVERSACION)
            .header('Idempotency-Key', unico('aud:cruce'))
            .json({ facturas: [facturaA.id] })
        assert.equal(cruce.status(), 422, JSON.stringify(cruce.body()))
        assert.equal(cruce.body().type, 'urn:argosisp:problema:cuenta_de_otra_empresa')
        assert.equal(await contarAsientos([1, B]), antesCruce)
        assert.lengthOf(await pagosDe(datos.clienteId), 0)

        // operador de B: el pago y su asiento en B, nada en la empresa 1
        await estado(aprobar(client, iris.token, datos.comprobanteId, deB.actor, { empresaId: B }), 200)
        const pagos = await pagosDe(datos.clienteId)
        assert.lengthOf(pagos, 1)
        assert.equal(Number(pagos[0].empresa_id), B)
        assert.equal(Number(pagos[0].registrado_por), deB.usuario.id)
        const asientos = await asientosDelCliente(datos.clienteId)
        assert.isTrue(asientos.every((a) => Number(a.empresa_id) === B))
        const delPago = asientos.filter((a) => a.origen_tipo === 'pago')
        assert.lengthOf(delPago, 1)
        assert.equal(delPago[0]!.debe, delPago[0]!.haber)
        assert.equal(await auxiliar(datos.clienteId, B), '0.00')
        assert.equal(await auxiliar(datos.clienteId, 1), '0.00')
        const fila = await db
            .from('audit.acciones')
            .where('accion', 'comprobantes.aprobar')
            .where('entidad_id', datos.comprobanteId)
            .where('resultado', 'ok')
            .firstOrFail()
        assert.equal(Number(fila.empresa_id), B)
        assert.equal(Number(fila.via_token_id), iris.tokenId)

        assert.deepEqual(await invariantes([datos.clienteId, enA.clienteId], [1, B]), [])
        await afirmarLibroCuadrado(assert)
    })
})
