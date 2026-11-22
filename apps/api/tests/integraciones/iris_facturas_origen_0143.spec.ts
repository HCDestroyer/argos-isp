import { randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, soloEmpresaPrincipal, usuarioConRoles } from '#tests/ayudas'
import { prepararEmpresas, type Empresas } from '#tests/contabilidad/ayudas_contabilidad'
import { crearClienteFila } from '#tests/core/fabricas'
import { conActor, tokenIris } from '#tests/core/ayudas_iris_0100'
import { claveLimite } from '#core/limite_ventana'
import { redis } from '#shared/redis'
import EmitirCargoUnico from '#billing/actions/emitir_cargo_unico'

/**
 * Contrato Iris 0.14.3 §3: `GET /facturas/origen-iris` para conciliar un «cobro por confirmar». Las
 * dos formas de búsqueda, el `404 factura_no_encontrada` único, `422` por parámetros, cabeceras de
 * Iris, el límite por token, la auditoría y la respuesta sin datos del cliente ni pagos.
 */

const RUTA = '/api/v1/facturas/origen-iris'
const NO_ENCONTRADA = 'urn:argosisp:problema:factura_no_encontrada'
const CLAVES = [
    'cliente_id',
    'dte',
    'emitida_en',
    'empresa_id',
    'estado',
    'factura_id',
    'lineas',
    'moneda',
    'numero',
    'origen_id',
    'origen_tipo',
    'servicio_id',
    'total',
]

async function concepto(empresaId: number, nombre: string) {
    const fila = (await db
        .from('billing.conceptos_cargo')
        .where({ empresa_id: empresaId, nombre })
        .select('id')
        .firstOrFail()) as { id: number }
    return Number(fila.id)
}

async function cargoIris(e: Empresas, empresaId: number, orden: string | null) {
    const clienteId = await crearClienteFila()
    const visita = await concepto(empresaId, 'Visita técnica')
    const cargo = await new EmitirCargoUnico().execute(
        {
            cliente_id: clienteId,
            empresa_id: empresaId,
            lineas: [
                { concepto_id: visita, precio_unitario: '112.00' },
                { concepto_id: visita, precio_unitario: '25.50', cantidad: '2' },
            ],
            ...(orden ? { origen_tipo: 'iris_orden' as const, origen_id: orden } : {}),
        },
        { ...e.ctx, empresaId },
    )
    return { facturaId: Number(cargo.id), clienteId, visita }
}

/** DTE certificado de la factura (lo que deja FEL al certificar). */
async function certificar(empresaId: number, facturaId: number, serie: string, numero: string) {
    await db.table('fiscal.dte').insert({
        empresa_id: empresaId,
        documento_tipo: 'factura',
        documento_id: facturaId,
        tipo_dte: 'FACT',
        estado: 'certificado',
        proveedor: 'infile',
        ambiente: 'pruebas',
        identificador: randomUUID(),
        autorizacion: randomUUID().toUpperCase(),
        serie,
        numero,
        certificado_en: new Date(),
        receptor: JSON.stringify({ nit: 'CF' }),
        total: '163.00',
        iva: '17.46',
    })
}

/** Los ids de token se repiten entre corridas (la base se recrea): el contador de una corrida anterior no cuenta. */
async function limpiarLimites() {
    const claves = await redis().keys(claveLimite('facturas_origen_iris', '*'))
    if (claves.length > 0) await redis().del(...claves)
}

test.group('Iris 0.14.3 · lectura de una factura de origen Iris', (group) => {
    group.each.setup(() => limpiarLimites())
    group.each.teardown(async () => {
        delete process.env.FACTURAS_ORIGEN_IRIS_LIMITE
        await soloEmpresaPrincipal()
    })

    test('por número interno y por serie + número del DTE; sin pagos, NIT ni nombre; auditada', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresas()
        const orden = randomUUID()
        const { facturaId, clienteId, visita } = await cargoIris(e, e.B, orden)
        const token = await tokenIris([e.B])
        const actor = `usuario:sup-${randomUUID().slice(0, 8)}`

        const r = await conActor(
            client.get(RUTA).qs({ empresa_id: e.B, origen_id: orden, numero: facturaId }).bearerToken(token),
            actor,
            { 'X-Iris-Conversacion': 'conv-1' },
        )
        r.assertStatus(200)
        const cuerpo = r.body()
        assert.deepEqual(Object.keys(cuerpo).toSorted(), CLAVES)
        assert.containSubset(cuerpo, {
            factura_id: facturaId,
            numero: String(facturaId),
            empresa_id: e.B,
            servicio_id: null,
            cliente_id: clienteId,
            origen_tipo: 'iris_orden',
            origen_id: orden,
            estado: 'emitida',
            total: '163.00',
            moneda: 'GTQ',
            dte: null,
        })
        assert.deepEqual(cuerpo.lineas, [
            { concepto_id: visita, precio_unitario: '112.00', cantidad: '1' },
            { concepto_id: visita, precio_unitario: '25.50', cantidad: '2' },
        ])
        assert.match(cuerpo.emitida_en, /^\d{4}-\d{2}-\d{2}T.*Z$/)
        const texto = JSON.stringify(cuerpo)
        for (const prohibido of ['nit', 'nombre', 'direccion', 'pagos', 'pagado', 'saldo']) {
            assert.notInclude(texto, `"${prohibido}`)
        }

        // la misma factura por su DTE
        await certificar(e.B, facturaId, 'A1B2C3D4', '1234567890')
        const dte = await conActor(
            client
                .get(RUTA)
                .qs({ empresa_id: e.B, origen_id: orden, serie: 'A1B2C3D4', numero_dte: '1234567890' })
                .bearerToken(token),
            actor,
        )
        dte.assertStatus(200)
        assert.equal(dte.body().factura_id, facturaId)
        assert.deepEqual(dte.body().dte, { serie: 'A1B2C3D4', numero: '1234567890' })

        const filas = await db
            .from('audit.acciones')
            .where({ accion: 'facturas.leer_origen_iris', iris_actor: actor })
            .orderBy('id')
        assert.lengthOf(filas, 2)
        const [primera] = filas
        assert.containSubset(primera, {
            actor_tipo: 'token',
            canal: 'api',
            resultado: 'ok',
            entidad_tipo: 'factura',
            entidad_id: facturaId,
            empresa_id: e.B,
            iris_conversacion: null,
        })
        assert.deepEqual(primera.entrada, { empresa_id: e.B, origen_id: orden, numero: facturaId })
        assert.deepEqual(filas[1].entrada, {
            empresa_id: e.B,
            origen_id: orden,
            serie: 'A1B2C3D4',
            numero_dte: '1234567890',
        })
    })

    test('404 factura_no_encontrada único: no existe, sin origen Iris, otra orden, otra empresa o fuera del token', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresas()
        const orden = randomUUID()
        const { facturaId } = await cargoIris(e, e.B, orden)
        const { facturaId: sinOrden } = await cargoIris(e, e.B, null)
        const { facturaId: deC } = await cargoIris(e, e.C, orden)
        const token = await tokenIris([e.B])
        const actor = `usuario:sup-${randomUUID().slice(0, 8)}`
        const leer = (qs: Record<string, unknown>) =>
            conActor(client.get(RUTA).qs(qs).bearerToken(token), actor)

        const casos: Array<Record<string, unknown>> = [
            // no existe
            { empresa_id: e.B, origen_id: orden, numero: 999_999_999 },
            // no es iris_orden
            { empresa_id: e.B, origen_id: orden, numero: sinOrden },
            // otro origen_id
            { empresa_id: e.B, origen_id: randomUUID(), numero: facturaId },
            // empresa del parámetro distinta de la de la factura
            { empresa_id: e.C, origen_id: orden, numero: facturaId },
            // factura de una empresa fuera del token (C), pedida con su empresa
            { empresa_id: e.C, origen_id: orden, numero: deC },
            // DTE que no existe
            { empresa_id: e.B, origen_id: orden, serie: 'X', numero_dte: '1' },
        ]
        const cuerpos = []
        for (const qs of casos) {
            const r = await leer(qs)
            r.assertStatus(404)
            assert.equal(r.body().type, NO_ENCONTRADA)
            cuerpos.push(JSON.stringify({ ...r.body(), instance: undefined, request_id: undefined }))
        }
        assert.lengthOf(new Set(cuerpos), 1, 'el 404 es el mismo en todos los casos')

        // cada lectura fallida también queda auditada, sin entidad
        const errores = await db
            .from('audit.acciones')
            .where({ accion: 'facturas.leer_origen_iris', iris_actor: actor, resultado: 'error' })
        assert.lengthOf(errores, casos.length)
        assert.isTrue(errores.every((f) => f.entidad_id === null && f.canal === 'api'))

        // con alcance en C, la factura de C sí se lee
        const tokenC = await tokenIris([e.C])
        await estado(
            conActor(
                client.get(RUTA).qs({ empresa_id: e.C, origen_id: orden, numero: deC }).bearerToken(tokenC),
            ),
            200,
        )
    })

    test('422 validacion por parámetros que faltan o se mezclan', async ({ client, assert }) => {
        const token = await tokenIris()
        const orden = randomUUID()
        const casos: Array<[Record<string, unknown>, string]> = [
            [{ origen_id: orden, numero: 1 }, 'empresa_id'],
            [{ empresa_id: 1, numero: 1 }, 'origen_id'],
            [{ empresa_id: 1, origen_id: orden }, 'numero'],
            [{ empresa_id: 1, origen_id: orden, serie: 'A' }, 'numero_dte'],
            [{ empresa_id: 1, origen_id: orden, numero_dte: '1' }, 'serie'],
            [{ empresa_id: 1, origen_id: orden, numero: 1, serie: 'A', numero_dte: '1' }, 'serie'],
            [{ empresa_id: 1, origen_id: orden, numero: 1, numero_dte: '1' }, 'numero_dte'],
        ]
        for (const [qs, campo] of casos) {
            const r = await conActor(client.get(RUTA).qs(qs).bearerToken(token))
            r.assertStatus(422)
            assert.equal(r.body().type, 'urn:argosisp:problema:validacion')
            assert.include(
                r.body().errors.map((x: { field: string }) => x.field),
                campo,
                JSON.stringify(qs),
            )
        }
    })

    test('cabeceras: 400 sin X-Iris-Actor o mal formada; 403 actor_no_permitido con asistente_ia o sistema', async ({
        client,
        assert,
    }) => {
        const token = await tokenIris()
        const qs = { empresa_id: 1, origen_id: randomUUID(), numero: 1 }
        const sin = await client.get(RUTA).qs(qs).bearerToken(token)
        sin.assertStatus(400)
        assert.equal(sin.body().type, 'urn:argosisp:problema:cabecera_iris_requerida')
        const mala = await conActor(client.get(RUTA).qs(qs).bearerToken(token), 'usuario:con espacio')
        mala.assertStatus(400)
        assert.equal(mala.body().type, 'urn:argosisp:problema:cabecera_iris_requerida')
        for (const actor of ['asistente_ia', 'sistema']) {
            const r = await conActor(client.get(RUTA).qs(qs).bearerToken(token), actor)
            r.assertStatus(403)
            assert.equal(r.body().type, 'urn:argosisp:problema:actor_no_permitido')
        }
    })

    test('429 demasiadas_peticiones con Retry-After al pasar el límite por token', async ({
        client,
        assert,
    }) => {
        process.env.FACTURAS_ORIGEN_IRIS_LIMITE = '2'
        const token = await tokenIris()
        const leer = () =>
            conActor(
                client
                    .get(RUTA)
                    .qs({ empresa_id: 1, origen_id: randomUUID(), numero: 999_999_999 })
                    .bearerToken(token),
            )
        await estado(leer(), 404)
        await estado(leer(), 404)
        const tercera = await leer()
        tercera.assertStatus(429)
        assert.equal(tercera.body().type, 'urn:argosisp:problema:demasiadas_peticiones')
        assert.isAbove(Number(tercera.header('retry-after')), 0)
        // el límite es por token: otro token sigue leyendo
        const otro = await tokenIris()
        await estado(
            conActor(
                client
                    .get(RUTA)
                    .qs({ empresa_id: 1, origen_id: randomUUID(), numero: 999_999_999 })
                    .bearerToken(otro),
            ),
            404,
        )
    })

    test('sin el permiso: 403 (otros roles y otros tokens no lo tienen)', async ({ client, assert }) => {
        for (const rol of ['cajero', 'soporte', 'contabilidad', 'lectura']) {
            const { token } = await usuarioConRoles([rol])
            const r = await client
                .get(RUTA)
                .qs({ empresa_id: 1, origen_id: randomUUID(), numero: 1 })
                .bearerToken(token)
            r.assertStatus(403)
            assert.notEqual(r.body().type, 'urn:argosisp:problema:actor_no_permitido', rol)
        }
        const rolIris = await db
            .from('core.roles_permisos as rp')
            .join('core.roles as r', 'r.id', 'rp.role_id')
            .join('core.permisos as p', 'p.id', 'rp.permiso_id')
            .where({ 'r.nombre': 'integracion_iris', 'p.nombre': 'facturas.leer_origen_iris' })
            .first()
        assert.exists(rolIris)
    })
})
