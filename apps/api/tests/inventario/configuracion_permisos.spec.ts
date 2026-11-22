import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { contextoPrueba, estado, soloEmpresaPrincipal, usuarioConRoles } from '#tests/ayudas'
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'
import { configuracionInventario } from '#inventario/ordenes_traslado'
import { configuracionIa } from '#inventario/facturas_compra/ia'
import ConfigurarInventario from '#inventario/actions/configurar_inventario'
import ConfigurarIa from '#inventario/actions/configurar_ia'

/**
 * «Error interno» en Configuración → Inventario (Argos 1.21.0). En producción la API no conecta como
 * dueña de las tablas sino con un usuario miembro de `argosisp_app` (`1760900000011_crear_rol_app`).
 * Las tablas de la fase D (`inventario.configuracion`, `inventario.ia_configuracion`, órdenes de
 * traslado, tipos de producto, borradores de compra y códigos de proveedor) nacieron sin `GRANT`: el
 * primer `SELECT` daba `permission denied` y la API respondía 500. Las pruebas corrían como dueño y
 * no lo veían; aquí cada lectura y escritura corre con `SET LOCAL ROLE argosisp_app`, como en
 * producción.
 */

const ESQUEMAS_APP = [
    'core',
    'network',
    'billing',
    'ledger',
    'notify',
    'audit',
    'fiscal',
    'lealtad',
    'integraciones',
    'importacion',
    'inventario',
]

/** Corre `fn` en una transacción con los privilegios de la API en producción y la deshace. */
async function comoApp<T>(fn: (trx: TransactionClientContract) => Promise<T>): Promise<T> {
    const trx = await db.transaction()
    try {
        await trx.rawQuery('SET LOCAL ROLE argosisp_app')
        return await fn(trx)
    } finally {
        await trx.rollback()
    }
}

test.group('inventario: configuración con los privilegios de la API (argosisp_app)', (group) => {
    group.each.setup(async () => {
        const rol = await db.from('pg_roles').where('rolname', 'argosisp_app').first()
        if (!rol) throw new Error('Falta el rol argosisp_app: la migración 1760900000011 debía crearlo')
    })

    test('toda tabla de los esquemas de la API se puede leer con argosisp_app', async ({ assert }) => {
        const filas = (await db.rawQuery(
            `SELECT n.nspname || '.' || c.relname AS tabla
               FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE c.relkind IN ('r', 'p', 'v', 'm') AND NOT c.relispartition
                AND n.nspname = ANY (?)
                AND NOT has_table_privilege('argosisp_app', c.oid, 'SELECT')
              ORDER BY 1`,
            [ESQUEMAS_APP],
        )) as { rows: { tabla: string }[] }
        assert.deepEqual(
            filas.rows.map((f) => f.tabla),
            [],
        )
    })

    test('las tablas de la fase D se escriben con argosisp_app, sin DELETE', async ({ assert }) => {
        const tablas = [
            'inventario.configuracion',
            'inventario.ia_configuracion',
            'inventario.ordenes_traslado',
            'inventario.ordenes_traslado_lineas',
            'inventario.ordenes_traslado_unidades',
            'inventario.tipos_producto',
            'inventario.compras_borradores',
            'inventario.productos_codigos_proveedor',
        ]
        for (const tabla of tablas) {
            const fila = (await db.rawQuery(
                `SELECT has_table_privilege('argosisp_app', ?::regclass, 'INSERT') AS ins,
                        has_table_privilege('argosisp_app', ?::regclass, 'UPDATE') AS upd,
                        has_table_privilege('argosisp_app', ?::regclass, 'DELETE') AS del`,
                [tabla, tabla, tabla],
            )) as { rows: { ins: boolean; upd: boolean; del: boolean }[] }
            assert.deepEqual(fila.rows[0], { ins: true, upd: true, del: false }, tabla)
        }
        // las tablas que agreguen las migraciones después heredan los privilegios del esquema
        const defecto = (await db.rawQuery(
            `SELECT count(*)::int AS total FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace
              WHERE n.nspname = 'inventario' AND d.defaclobjtype = 'r'
                AND array_to_string(d.defaclacl, ',') LIKE '%argosisp_app=arw/%'`,
        )) as { rows: { total: number }[] }
        assert.equal(defecto.rows[0]!.total, 1)
    })

    test('«Recibir órdenes de traslado»: leer y guardar la firma sin configuración previa', async ({
        assert,
    }) => {
        await db.from('inventario.configuracion').where('empresa_id', 1).delete()
        const { usuario } = await usuarioConRoles(['admin'])
        const ctx = { ...contextoPrueba(usuario.id), empresaId: 1, empresasPermitidas: null }
        await comoApp(async (trx) => {
            assert.deepEqual(await configuracionInventario(1, trx), {
                empresa_id: 1,
                traslado_firma_obligatoria: true,
                recuperacion_tecnicos_minimos: 2,
                iris_movimientos_diarios_alerta: 40,
                version: 0,
            })
            const guardada = await new ConfigurarInventario().execute(
                { traslado_firma_obligatoria: false, version: 0 },
                ctx,
                { trx },
            )
            assert.deepEqual(guardada, {
                empresa_id: 1,
                traslado_firma_obligatoria: false,
                recuperacion_tecnicos_minimos: 2,
                iris_movimientos_diarios_alerta: 40,
                version: 1,
            })
            const otra = await new ConfigurarInventario().execute(
                { traslado_firma_obligatoria: true, version: 1 },
                ctx,
                { trx },
            )
            assert.equal(otra.version, 2)
        })
    })

    test('«IA para facturas de compra»: sin IA, global y de la empresa', async ({ assert }) => {
        await db.from('inventario.ia_configuracion').delete()
        const { usuario } = await usuarioConRoles(['admin'])
        const ctx = { ...contextoPrueba(usuario.id), empresaId: 1, empresasPermitidas: null }
        await comoApp(async (trx) => {
            // instalación nueva: ni la de la empresa ni la global (la ruta responde 404, no 500)
            assert.isNull(await configuracionIa(1, trx))
            assert.isNull(await configuracionIa(null, trx))
            const global = await new ConfigurarIa().execute(
                {
                    global: true,
                    alcance_global: true,
                    proveedor: 'anthropic',
                    modelo: 'claude-opus-5-5',
                    api_key: 'sk-prueba',
                    activo: true,
                    version: 0,
                },
                ctx,
                { trx },
            )
            assert.isNull(global.empresa_id)
            assert.isTrue(global.clave_configurada)
            // la empresa sin una propia usa la global
            assert.equal((await configuracionIa(1, trx))!.id, global.id)
            const propia = await new ConfigurarIa().execute(
                {
                    proveedor: 'privada',
                    modelo: 'llava',
                    url_base: 'http://ollama:11434/v1',
                    activo: true,
                    version: 0,
                },
                ctx,
                { trx },
            )
            assert.equal(propia.empresa_id, 1)
            assert.equal((await configuracionIa(1, trx))!.id, propia.id)
        })
    })
})

test.group('inventario: configuración con «Todas las empresas»', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('sin X-Empresa-Id la firma pide elegir empresa (422 empresa_requerida) y la IA usa la global', async ({
        client,
        assert,
    }) => {
        await db.from('inventario.ia_configuracion').delete()
        const e = await prepararEmpresasGt()
        const firma = await estado(client.get('/api/v1/inventario/configuracion').bearerToken(e.token), 422)
        assert.equal(firma.body().type, 'urn:argosisp:problema:empresa_requerida')
        const guardarFirma = await estado(
            client
                .post('/api/v1/inventario/configuracion')
                .bearerToken(e.token)
                .json({ traslado_firma_obligatoria: false, version: 0 }),
            422,
        )
        assert.equal(guardarFirma.body().type, 'urn:argosisp:problema:empresa_requerida')

        // la IA: sin configuración, 404; la global se lee y se guarda con global: true
        await estado(client.get('/api/v1/inventario/ia/configuracion').bearerToken(e.token), 404)
        await estado(client.get('/api/v1/inventario/ia/configuracion?global=true').bearerToken(e.token), 404)
        const sinEmpresa = await estado(
            client
                .post('/api/v1/inventario/ia/configuracion')
                .bearerToken(e.token)
                .json({ proveedor: 'anthropic', modelo: 'claude-opus-5-5', activo: true, version: 0 }),
            422,
        )
        assert.equal(sinEmpresa.body().type, 'urn:argosisp:problema:empresa_requerida')
        const global = await estado(
            client.post('/api/v1/inventario/ia/configuracion').bearerToken(e.token).json({
                global: true,
                proveedor: 'anthropic',
                modelo: 'claude-opus-5-5',
                activo: true,
                version: 0,
            }),
            200,
        )
        assert.isNull(global.body().empresa_id)
        const leida = await estado(
            client.get('/api/v1/inventario/ia/configuracion?global=true').bearerToken(e.token),
            200,
        )
        assert.equal(leida.body().id, global.body().id)
        // con una empresa elegida: la suya o, sin ella, la global
        const deB = await estado(
            client
                .get('/api/v1/inventario/ia/configuracion')
                .bearerToken(e.token)
                .headers({ 'X-Empresa-Id': String(e.B) }),
            200,
        )
        assert.equal(deB.body().id, global.body().id)
        await db.from('inventario.ia_configuracion').delete()
    })
})
