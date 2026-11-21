import { test } from '@japa/runner'
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { contextoPrueba, estado, usuarioConRoles } from '#tests/ayudas'
import { fijarEspacioVolumen } from '#monitoreo/salud'
import { fijarRaizDatos, recorrer, tamanoBaseDatos, type Categoria } from '#monitoreo/almacenamiento'
import RecalcularAlmacenamiento from '#monitoreo/actions/recalcular_almacenamiento'
import { registroSistema } from '#monitoreo/registro'

/** Almacenamiento (`GET /api/v1/sistema/almacenamiento`, contrato `salud.md` §6). */

async function archivo(ruta: string, bytes: number, diasAtras = 0) {
    await mkdir(join(ruta, '..'), { recursive: true })
    await writeFile(ruta, Buffer.alloc(bytes, 1))
    if (diasAtras > 0) {
        const t = new Date(Date.now() - diasAtras * 86_400_000)
        await utimes(ruta, t, t)
    }
}

function cat(categorias: Categoria[], id: string): Categoria {
    const c = categorias.find((x) => x.id === id)
    if (!c) throw new Error(`falta ${id}`)
    return c
}

test.group('monitoreo · almacenamiento', (group) => {
    let datos = ''
    let respaldos = ''
    let previoBackup: string | undefined

    group.each.setup(async () => {
        datos = await mkdtemp(join(tmpdir(), 'argos-datos-'))
        respaldos = await mkdtemp(join(tmpdir(), 'argos-respaldos-'))
        previoBackup = process.env.BACKUP_DIR
        process.env.BACKUP_DIR = respaldos
        fijarRaizDatos(datos)
        // comprobantes: 2 nuevos + 1 de hace 60 días
        await archivo(join(datos, '2026', '11', 'a.jpg'), 1000)
        await archivo(join(datos, '2026', '11', 'b.pdf'), 3000)
        await archivo(join(datos, '2026', '09', 'viejo.jpg'), 500, 60)
        await archivo(join(datos, 'logos', 'empresas', '1', 'l.png'), 200)
        await archivo(join(datos, 'logos', 'apariencia', 'f.webp'), 800)
        await archivo(join(datos, 'inventario', 'compras', 'factura.pdf'), 4000, 45)
        await archivo(join(respaldos, 'argosisp-20261120T000000Z.dump'), 7000)
        return async () => {
            fijarRaizDatos()
            fijarEspacioVolumen()
            if (previoBackup === undefined) delete process.env.BACKUP_DIR
            else process.env.BACKUP_DIR = previoBackup
            await rm(datos, { recursive: true, force: true })
            await rm(respaldos, { recursive: true, force: true })
        }
    })

    test('desglose por categoría con crecimiento de 30 días y el archivo más grande', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const r = await estado(
            client.post('/api/v1/sistema/almacenamiento/recalcular').bearerToken(token),
            200,
        )
        const m = r.body()
        assert.equal(m.origen, 'manual')
        assert.isFalse(m.parcial)

        const comprobantes = cat(m.categorias, 'comprobantes')
        // las subcarpetas con dueño no se cuentan dos veces
        assert.include(comprobantes, {
            bytes: 4500,
            archivos: 3,
            crecimiento_30d_bytes: 4000,
            crecimiento_30d_archivos: 2,
        })
        assert.deepEqual(comprobantes.mayor, { nombre: join('2026', '11', 'b.pdf'), bytes: 3000 })
        assert.include(cat(m.categorias, 'logos'), { bytes: 1000, archivos: 2 })
        assert.include(cat(m.categorias, 'inventario'), { bytes: 4000, crecimiento_30d_bytes: 0 })
        assert.include(cat(m.categorias, 'anuncios'), { estado: 'completo', bytes: 0 })
        assert.include(cat(m.categorias, 'respaldos'), { bytes: 7000, archivos: 1 })

        assert.isAbove(m.base_datos.tamano_bytes, 0)
        assert.isAtMost(m.base_datos.tablas_mayores.length, 10)
        const schemas = m.base_datos.por_schema.map((s: { schema: string }) => s.schema)
        for (const s of ['core', 'audit', 'billing', 'ledger']) assert.include(schemas, s)
        assert.isNumber(m.redis.usada_bytes)

        // GET devuelve la última medición y los volúmenes del momento
        const g = await estado(client.get('/api/v1/sistema/almacenamiento').bearerToken(token), 200)
        assert.equal(g.body().medicion.id, m.id)
        assert.deepEqual(
            g.body().volumenes.map((v: { id: string }) => v.id),
            ['datos', 'base'],
        )
        assert.isNumber(g.body().volumenes[0].total_bytes)

        const auditada = await db
            .from('audit.acciones')
            .where('accion', 'sistema.recalcular_almacenamiento')
            .where('entidad_id', m.id)
            .first()
        assert.equal(auditada.resultado, 'ok')
    })

    test('presupuesto agotado: categorías parciales, nunca un error', async ({ assert }) => {
        const acc = await recorrer(datos, Date.now() - 1)
        assert.isFalse(acc.completo)
        const m = await new RecalcularAlmacenamiento().execute({ presupuesto_ms: 0 }, contextoPrueba())
        assert.isTrue(m.parcial)
        assert.include(cat(m.categorias, 'comprobantes').aviso ?? '', 'tiempo')
    })

    test('disco ≥ 80 % deja un aviso en el registro del sistema; ≥ 95 % un error', async ({ assert }) => {
        fijarEspacioVolumen(async () => ({ total: 1000, libre: 150 }))
        const aviso = await new RecalcularAlmacenamiento().execute({ origen: 'cron' }, contextoPrueba())
        assert.equal(aviso.volumen_datos.estado, 'degradado')
        fijarEspacioVolumen(async () => ({ total: 1000, libre: 20 }))
        const lleno = await new RecalcularAlmacenamiento().execute({ origen: 'cron' }, contextoPrueba())
        assert.equal(lleno.volumen_datos.estado, 'caido')
        fijarEspacioVolumen(async () => ({ total: 1000, libre: 900 }))
        const bien = await new RecalcularAlmacenamiento().execute({ origen: 'cron' }, contextoPrueba())

        const pagina = await registroSistema({ origen: 'almacenamiento', limit: 100 })
        const ids = pagina.data.map((e) => e.entidad?.id)
        assert.notInclude(ids, String(bien.id))
        const deAviso = pagina.data.find((e) => e.entidad?.id === String(aviso.id))!
        const deLleno = pagina.data.find((e) => e.entidad?.id === String(lleno.id))!
        assert.include(deAviso, { nivel: 'advertencia', origen: 'almacenamiento' })
        assert.include(deAviso.detalle ?? '', '85')
        assert.include(deLleno, { nivel: 'error' })
    })

    test('un solo cálculo a la vez: 409 calculo_en_curso', async ({ assert }) => {
        const trx = await db.transaction()
        try {
            await trx.rawQuery(`SELECT pg_advisory_xact_lock(hashtext('monitoreo:almacenamiento'))`)
            await assert.rejects(
                () => new RecalcularAlmacenamiento().execute({}, contextoPrueba()),
                /calculando/,
            )
        } finally {
            await trx.rollback()
        }
    })

    test('tamaños de la base y escritura con los privilegios de la API (argosisp_app)', async ({
        assert,
    }) => {
        const trx: TransactionClientContract = await db.transaction()
        try {
            await trx.rawQuery('SET LOCAL ROLE argosisp_app')
            const base = await tamanoBaseDatos(trx)
            assert.isNull(base.aviso)
            assert.isAbove(base.tamano_bytes ?? 0, 0)
            assert.isNotEmpty(base.tablas_mayores)
            const m = await new RecalcularAlmacenamiento().execute({}, contextoPrueba(), { trx })
            assert.isAbove(m.id, 0)
        } finally {
            await trx.rollback()
        }
    })

    test('permisos: 403 sin sistema.ver_almacenamiento ni sistema.recalcular_almacenamiento', async ({
        client,
    }) => {
        const { token } = await usuarioConRoles(['contabilidad'])
        await estado(client.get('/api/v1/sistema/almacenamiento').bearerToken(token), 403)
        await estado(client.post('/api/v1/sistema/almacenamiento/recalcular').bearerToken(token), 403)
    })
})
