import { test } from '@japa/runner'
import type { ApiClient, ApiRequest } from '@japa/api-client'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, unico } from '#tests/ayudas'
import { crearRouterFila } from '#tests/core/fabricas'
import {
    cuentaBancariaPrueba,
    bancoId,
    escenario,
    estadoServicio,
    generar,
} from '#tests/billing/ayudas_billing'
import { EnviadorFalso, cookieDeSesion, nitAleatorio, usarEnviadorCodigo } from '#tests/portal/ayudas_portal'
import VencerFacturas from '#billing/actions/vencer_facturas'
import EvaluarEstadoServicio from '#billing/actions/evaluar_estado_servicio'
import RechazarComprobante from '#billing/actions/rechazar_comprobante'
import { TAMANO_MAXIMO_COMPROBANTE } from '#billing/comprobantes_archivos'

/**
 * Tarea 5: comprobante de depósito desde `/corte` (por IP) y desde `/cuenta` (por sesión), contra
 * Postgres real. La acción es `RegistrarComprobante` (A3); aquí se prueba la identificación, el
 * multipart, los errores en palabras del cliente, la idempotencia y la lista de la sesión.
 */

const VARIABLES = ['PORTAL_PROXIES_CONFIABLES', 'PORTAL_LIMITE_PETICIONES', 'PORTAL_REDIS_PREFIJO'] as const

const PNG = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('IHDR-boleta-de-prueba'),
])
const PDF = Buffer.from('%PDF-1.7\n%boleta\n')

const hoy = () => DateTime.now().setZone('America/Guatemala').startOf('day')
const dia = (dias: number) => hoy().plus({ days: dias }).toISODate()!

let ipSecuencia = 0
function ipNueva(): string {
    ipSecuencia += 1
    return `198.51.102.${(ipSecuencia % 250) + 1}`
}

let enviador: EnviadorFalso

/** Servicio cortado con su sesión de red en `ip`. */
async function cortado(cliente: Record<string, unknown> = {}) {
    const routerId = await crearRouterFila()
    const datos = await escenario({
        fecha_instalacion: dia(-75),
        plantilla: { hora_corte: '00:00' },
        servicio: { router_id: routerId },
    })
    if (Object.keys(cliente).length > 0) {
        await db.from('core.clientes').where('id', datos.clienteId).update(cliente)
    }
    await generar(datos.servicioId, dia(0))
    await new VencerFacturas().execute({ servicio_id: datos.servicioId, hasta: dia(0) }, contextoPrueba())
    await new EvaluarEstadoServicio().execute({ servicio_id: datos.servicioId }, contextoPrueba())
    const ip = ipNueva()
    await db.table('network.sesiones').insert({
        servicio_id: datos.servicioId,
        router_id: routerId,
        nas_ip: '192.0.2.1',
        acct_session_id: unico('acct'),
        user_ppp: unico('ppp'),
        ipv4: ip,
    })
    return { ...datos, ip }
}

async function entrar(client: ApiClient, nit: string): Promise<string> {
    const ip = ipNueva()
    const pedido = await client
        .post('/api/v1/portal/codigo')
        .header('X-Forwarded-For', ip)
        .json({ identificador: nit })
    const verificado = await client
        .post('/api/v1/portal/verificar')
        .header('X-Forwarded-For', ip)
        .json({ solicitud: pedido.body().solicitud, codigo: enviador.ultimoCodigo() })
    verificado.assertStatus(200)
    return cookieDeSesion(verificado)!
}

type Campos = Record<string, string | number | null | undefined>

/** `POST /portal/comprobantes` en multipart con los campos y el archivo. */
function subir(
    client: ApiClient,
    campos: Campos,
    archivo: { contenido: Buffer; nombre: string } | null = { contenido: PNG, nombre: 'boleta.png' },
): ApiRequest {
    let peticion = client.post('/api/v1/portal/comprobantes')
    for (const [nombre, valor] of Object.entries(campos)) {
        if (valor !== undefined && valor !== null) peticion = peticion.field(nombre, String(valor))
    }
    if (archivo) peticion = peticion.file('archivo', archivo.contenido, { filename: archivo.nombre })
    return peticion
}

function camposDeposito(cuentaId: number, extra: Campos = {}): Campos {
    return {
        metodo: 'deposito',
        cuenta_bancaria_id: cuentaId,
        referencia: unico('boleta'),
        monto: '150.00',
        fecha_deposito: dia(0),
        ...extra,
    }
}

test.group('Portal: subir comprobante de depósito', (group) => {
    group.each.setup(() => {
        const previo = Object.fromEntries(VARIABLES.map((v) => [v, process.env[v]]))
        process.env.PORTAL_PROXIES_CONFIABLES = '127.0.0.1/32, ::1'
        process.env.PORTAL_REDIS_PREFIJO = unico('prueba-comprobantes')
        delete process.env.PORTAL_LIMITE_PETICIONES
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

    test('por IP: archivo válido queda pendiente, sin datos internos y auditado con canal portal', async ({
        client,
        assert,
    }) => {
        const s = await cortado({ nombre: 'Juana Inés Coyoy' })
        const cuenta = await cuentaBancariaPrueba()
        const campos = camposDeposito(cuenta.id, { referencia: unico('ref'), monto: '318.50' })

        const respuesta = await estado(subir(client, campos).header('X-Forwarded-For', s.ip), 201)
        const cuerpo = respuesta.body()
        assert.containSubset(cuerpo, {
            servicio_id: s.servicioId,
            metodo: 'deposito',
            cuenta_destino: `Banrural · ${cuenta.alias}`,
            banco_origen: null,
            referencia: campos.referencia,
            monto: '318.50',
            fecha_deposito: dia(0),
            archivo_tipo: 'image/png',
            archivo_nombre: 'boleta.png',
            estado: 'pendiente',
            motivo_rechazo: null,
            verificado_en: null,
        })
        assert.sameMembers(Object.keys(cuerpo), [
            'id',
            'servicio_id',
            'metodo',
            'cuenta_destino',
            'banco_origen',
            'referencia',
            'monto',
            'fecha_deposito',
            'archivo_tipo',
            'archivo_nombre',
            'estado',
            'motivo_rechazo',
            'created_at',
            'verificado_en',
        ])
        assert.notInclude(JSON.stringify(cuerpo), 'Juana')

        const fila = await db.from('billing.comprobantes').where('id', cuerpo.id).firstOrFail()
        assert.equal(Number(fila.cliente_id), s.clienteId)
        assert.equal(fila.canal, 'portal')
        assert.isNull(fila.registrado_por)
        // no cambia el estado del servicio: eso pasa al aprobarlo en el panel
        assert.equal(await estadoServicio(s.servicioId), 'suspendido')

        const auditoria = await db
            .from('audit.acciones')
            .where('accion', 'comprobantes.registrar')
            .where('entidad_tipo', 'comprobante')
            .where('entidad_id', cuerpo.id)
            .firstOrFail()
        assert.equal(auditoria.canal, 'portal')
        assert.equal(auditoria.actor_tipo, 'sistema')
        // el archivo se audita solo con nombre y tamaño
        assert.deepEqual(auditoria.entrada.archivo, { nombre: 'boleta.png', bytes: PNG.length })
    })

    test('archivo inválido, demasiado grande o ausente: 422 en el campo archivo con texto claro', async ({
        client,
        assert,
    }) => {
        const s = await cortado()
        const cuenta = await cuentaBancariaPrueba()

        const ejecutable = await estado(
            subir(client, camposDeposito(cuenta.id), {
                contenido: Buffer.from('MZ\x90\x00 ejecutable'),
                nombre: 'boleta.jpg',
            }).header('X-Forwarded-For', s.ip),
            422,
        )
        assert.deepEqual(ejecutable.body().errors, [
            {
                field: 'archivo',
                rule: 'tipo',
                message: 'Sube una foto (JPG, PNG o WebP) o un PDF del comprobante.',
            },
        ])

        const grande = await estado(
            subir(client, camposDeposito(cuenta.id), {
                contenido: Buffer.concat([PDF, Buffer.alloc(TAMANO_MAXIMO_COMPROBANTE)]),
                nombre: 'boleta.pdf',
            }).header('X-Forwarded-For', s.ip),
            422,
        )
        assert.equal(grande.body().errors[0].field, 'archivo')
        assert.equal(grande.body().errors[0].rule, 'tamano')
        assert.match(grande.body().errors[0].message, /máximo es 5 MB/)

        const sinArchivo = await estado(
            subir(client, camposDeposito(cuenta.id, { fecha_deposito: dia(2) }), null).header(
                'X-Forwarded-For',
                s.ip,
            ),
            422,
        )
        assert.sameDeepMembers(sinArchivo.body().errors, [
            { field: 'archivo', rule: 'required', message: 'Adjunta la foto o el PDF del comprobante.' },
            {
                field: 'fecha_deposito',
                rule: 'fecha_futura',
                message: 'La fecha del depósito no puede ser posterior a hoy.',
            },
        ])

        const filas = await db.from('billing.comprobantes').where('cliente_id', s.clienteId).count('* as n')
        assert.equal(Number(filas[0].n), 0)
    })

    test('transferencia sin banco de origen: 422; con banco del catálogo público: 201', async ({
        client,
        assert,
    }) => {
        const s = await cortado()
        const cuenta = await cuentaBancariaPrueba()

        const bancos = await estado(client.get('/api/v1/portal/bancos').header('X-Forwarded-For', s.ip), 200)
        const bi = (bancos.body() as { id: number; nombre: string }[]).find(
            (b) => b.nombre === 'Banco Industrial',
        )
        assert.exists(bi)
        assert.sameMembers(Object.keys(bi!), ['id', 'nombre'])

        const sinBanco = await estado(
            subir(client, camposDeposito(cuenta.id, { metodo: 'transferencia' })).header(
                'X-Forwarded-For',
                s.ip,
            ),
            422,
        )
        assert.deepEqual(sinBanco.body().errors, [
            {
                field: 'banco_origen_id',
                rule: 'required',
                message: 'Elige el banco desde el que transferiste.',
            },
        ])

        const conBanco = await estado(
            subir(
                client,
                camposDeposito(cuenta.id, {
                    metodo: 'transferencia',
                    banco_origen_id: await bancoId('Banco Industrial'),
                }),
            ).header('X-Forwarded-For', s.ip),
            201,
        )
        assert.equal(conBanco.body().banco_origen, 'Banco Industrial')
        assert.equal(conBanco.body().metodo, 'transferencia')
    })

    test('referencia duplicada: 409 sin ids internos; idempotencia no crea dos', async ({
        client,
        assert,
    }) => {
        const s = await cortado()
        const otro = await cortado()
        const cuenta = await cuentaBancariaPrueba()
        const campos = camposDeposito(cuenta.id)

        const clave = unico('clave')
        const primero = await estado(
            subir(client, campos).header('X-Forwarded-For', s.ip).header('Idempotency-Key', clave),
            201,
        )
        const repetido = await estado(
            subir(client, campos).header('X-Forwarded-For', s.ip).header('Idempotency-Key', clave),
            201,
        )
        assert.equal(repetido.header('idempotent-replayed'), 'true')
        assert.equal(repetido.body().id, primero.body().id)

        // otro cliente con la misma referencia en la misma cuenta, ya sin la clave
        const duplicado = await estado(subir(client, campos).header('X-Forwarded-For', otro.ip), 409)
        assert.match(duplicado.body().type, /referencia_duplicada$/)
        assert.notMatch(duplicado.body().detail, /\d{2,}/u)
        assert.notInclude(duplicado.body().detail, String(primero.body().id))

        const filas = await db
            .from('billing.comprobantes')
            .where('referencia', String(campos.referencia))
            .count('* as n')
        assert.equal(Number(filas[0].n), 1)
    })

    test('IP sin servicio: 422 no_identificado; servicio de otro cliente con sesión: 404; sin sesión: 401', async ({
        client,
        assert,
    }) => {
        const cuenta = await cuentaBancariaPrueba()
        const nada = await estado(
            subir(client, camposDeposito(cuenta.id)).header('X-Forwarded-For', '203.0.113.250'),
            422,
        )
        assert.match(nada.body().type, /no_identificado$/)

        const nit = nitAleatorio()
        const mio = await cortado({ nit_cui: nit, email: 'cliente@example.com' })
        const ajeno = await cortado()
        const cookie = await entrar(client, nit)

        await estado(
            subir(client, camposDeposito(cuenta.id, { servicio_id: ajeno.servicioId }))
                .header('X-Forwarded-For', mio.ip)
                .header('Cookie', cookie),
            404,
        )
        await estado(
            subir(client, camposDeposito(cuenta.id, { servicio_id: mio.servicioId })).header(
                'X-Forwarded-For',
                mio.ip,
            ),
            401,
        )
        const filas = await db
            .from('billing.comprobantes')
            .whereIn('cliente_id', [mio.clienteId, ajeno.clienteId])
            .count('* as n')
        assert.equal(Number(filas[0].n), 0)

        const propio = await estado(
            subir(client, camposDeposito(cuenta.id, { servicio_id: mio.servicioId }), {
                contenido: PDF,
                nombre: 'boleta.pdf',
            })
                .header('X-Forwarded-For', ipNueva())
                .header('Cookie', cookie),
            201,
        )
        assert.equal(propio.body().servicio_id, mio.servicioId)
        assert.equal(propio.body().archivo_tipo, 'application/pdf')
        // con la sesión, el actor es el cliente (`registrado_por` sigue null: no es un usuario del panel)
        const auditoria = await db
            .from('audit.acciones')
            .where('accion', 'comprobantes.registrar')
            .where('entidad_id', propio.body().id)
            .firstOrFail()
        assert.include(auditoria, { actor_tipo: 'cliente', canal: 'portal' })
        assert.equal(Number(auditoria.actor_id), mio.clienteId)
        const fila = await db.from('billing.comprobantes').where('id', propio.body().id).firstOrFail()
        assert.isNull(fila.registrado_por)
    })

    test('lista de la sesión: solo los del cliente, con el motivo del rechazo', async ({
        client,
        assert,
    }) => {
        const nit = nitAleatorio()
        const mio = await cortado({ nit_cui: nit, email: 'cliente@example.com' })
        const ajeno = await cortado()
        const cuenta = await cuentaBancariaPrueba()

        const aceptado = await estado(
            subir(client, camposDeposito(cuenta.id)).header('X-Forwarded-For', mio.ip),
            201,
        )
        const rechazado = await estado(
            subir(client, camposDeposito(cuenta.id)).header('X-Forwarded-For', mio.ip),
            201,
        )
        await estado(subir(client, camposDeposito(cuenta.id)).header('X-Forwarded-For', ajeno.ip), 201)
        await new RechazarComprobante().execute(
            { comprobante_id: rechazado.body().id, motivo: 'La foto no se lee; súbela de nuevo' },
            contextoPrueba(),
        )

        await estado(client.get('/api/v1/portal/comprobantes'), 401)

        const cookie = await entrar(client, nit)
        const lista = await estado(client.get('/api/v1/portal/comprobantes').header('Cookie', cookie), 200)
        const datos = lista.body().data as { id: number; estado: string; motivo_rechazo: string | null }[]
        assert.deepEqual(
            datos.map((c) => [c.id, c.estado, c.motivo_rechazo]),
            [
                [rechazado.body().id, 'rechazado', 'La foto no se lee; súbela de nuevo'],
                [aceptado.body().id, 'pendiente', null],
            ],
        )
        assert.isNull(lista.body().nextCursor)
    })

    test('cuentas de depósito públicas traen el id que pide el comprobante', async ({ client, assert }) => {
        const cuenta = await cuentaBancariaPrueba()
        const empresa = await estado(client.get('/api/v1/portal/empresa'), 200)
        const publica = (empresa.body().cuentas_deposito as { id: number; numero: string }[]).find(
            (c) => c.numero === cuenta.numero,
        )
        assert.equal(publica?.id, cuenta.id)
    })
})
