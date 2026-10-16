import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import { claveAaa, publicarAaa } from '#core/aaa'
import { cifrar } from '#shared/cifrado'
import { redis } from '#shared/redis'
import { unico } from '#tests/ayudas'
import { crearClienteFila, crearPlanFila, crearRouterFila, crearServicioFila } from '#tests/core/fabricas'
import {
    informeMarkdown,
    verificarMigracionRouter,
    type Comprobacion,
    type InformeMigracion,
} from '#network/sesiones/verificacion_migracion'

/**
 * Semana 3, tarea 3 de A2: `aaa:verificar-router`, la lista previa a migrar un router al nuevo
 * RADIUS. Postgres real, Redis real con el prefijo de pruebas y registros escritos por `publicarAaa`
 * de A1 (el mismo camino que en producción).
 */

function comprobacion(informe: InformeMigracion, clave: Comprobacion['clave']): Comprobacion {
    const c = informe.comprobaciones.find((x) => x.clave === clave)
    if (!c) throw new Error(`sin comprobación ${clave}`)
    return c
}

async function routerListo() {
    const routerId = await crearRouterFila({ radius_secret: cifrar('secreto-radius-lab') })
    const planPerfil = await crearPlanFila({ subida_limitada_kbps: 1000, bajada_limitada_kbps: 2000 })
    await db.table('network.planes_routers').insert({
        plan_id: planPerfil,
        router_id: routerId,
        profile_ppp: 'perfil-argos',
        pool_ipv4: 'argos-v4',
    })
    // Reuso 1:4 en `simple`: usa el perfil `plan-<id>` del dispatcher (sin profile_ppp propio).
    const planReuso = await crearPlanFila({ reuso: 4, subida_limitada_kbps: 500, bajada_limitada_kbps: 1000 })
    await db
        .table('network.planes_routers')
        .insert({ plan_id: planReuso, router_id: routerId, pool_ipv4: 'argos-v4' })
    const clienteId = await crearClienteFila()
    const servicios: number[] = []
    for (const [planId, estado] of [
        [planPerfil, 'activo'],
        [planPerfil, 'suspendido'],
        [planReuso, 'limitado'],
    ] as const) {
        servicios.push(
            await crearServicioFila({
                cliente_id: clienteId,
                router_id: routerId,
                plan_id: planId,
                estado,
                pass_ppp: cifrar('clave-ppp'),
            }),
        )
    }
    // Un retirado no cuenta (no se migra: se rechaza igual en ambos RADIUS).
    await crearServicioFila({
        cliente_id: clienteId,
        router_id: routerId,
        plan_id: planPerfil,
        estado: 'retirado',
        pass_ppp: cifrar('x'),
    })
    await publicarAaa(servicios)
    return { routerId, planPerfil, planReuso, clienteId, servicios }
}

test.group('network · aaa:verificar-router (migración al nuevo RADIUS)', () => {
    test('router listo: todas las comprobaciones en OK e informe LISTO', async ({ assert }) => {
        const { routerId } = await routerListo()
        const informe = await verificarMigracionRouter(routerId)
        assert.deepEqual(
            informe.comprobaciones.map((c) => [c.clave, c.resultado]),
            [
                ['router', 'ok'],
                ['secreto', 'ok'],
                ['redis', 'ok'],
                ['credenciales', 'ok'],
                ['planes', 'ok'],
                ['user_ppp', 'ok'],
            ],
        )
        assert.isTrue(informe.listo)
        assert.equal(informe.servicios.total, 3)
        assert.deepEqual(informe.servicios.porEstado, { activo: 1, suspendido: 1, limitado: 1 })
        const md = informeMarkdown(informe)
        assert.include(md, '**Resultado: LISTO.**')
        assert.include(md, '| Registros `aaa:user:*` en Redis | OK |')
        assert.include(md, 'usa el perfil `plan-')
        assert.include(md, 'con perfil `perfil-argos`')
        assert.notInclude(md, 'secreto-radius-lab', 'el informe nunca muestra el secreto')
    })

    test('detecta Redis sin clave, desactualizado, lápida y distinto de Postgres', async ({ assert }) => {
        const { routerId, servicios, clienteId, planPerfil } = await routerListo()
        const [s1, s2, s3] = servicios as [number, number, number]
        const usuarios = (await db
            .from('core.servicios')
            .whereIn('id', servicios)
            .orderBy('id')
            .select('user_ppp')) as { user_ppp: string }[]
        // s1: sin clave
        await redis().del(claveAaa(usuarios[0]!.user_ppp))
        // s2: Postgres avanzó de versión y Redis quedó atrás
        await db.from('core.servicios').where('id', s2).increment('version', 1)
        // s3: estado distinto en Redis (A1 aún no publicó)
        await db.from('core.servicios').where('id', s3).update({ estado: 'activo' })
        // s4: lápida en su clave
        const s4 = await crearServicioFila({
            cliente_id: clienteId,
            router_id: routerId,
            plan_id: planPerfil,
            pass_ppp: cifrar('k'),
        })
        const u4 = (await db.from('core.servicios').where('id', s4).first()) as { user_ppp: string }
        await redis().set(claveAaa(u4.user_ppp), JSON.stringify({ eliminado: true, user_ppp: u4.user_ppp }))

        const informe = await verificarMigracionRouter(routerId)
        const r = comprobacion(informe, 'redis')
        assert.equal(r.resultado, 'falla')
        assert.isFalse(informe.listo)
        assert.include(r.resumen, '1 sin clave, 1 lápidas, 0 inválidos, 1 desactualizados, 1 distintos')
        assert.isTrue(r.detalles.some((d) => d.startsWith('sin clave') && d.includes(`servicio ${s1}`)))
        assert.isTrue(r.detalles.some((d) => d.startsWith('desactualizado') && d.includes(`servicio ${s2}`)))
        assert.isTrue(
            r.detalles.some((d) => d.includes(`servicio ${s3}`) && d.includes('estado limitado ≠ activo')),
        )
        assert.isTrue(r.detalles.some((d) => d.startsWith('lápida') && d.includes(`servicio ${s4}`)))
        assert.include(informeMarkdown(informe), '**Resultado: NO LISTO.**')
    })

    test('secreto ausente, plan sin perfil, credencial ilegible y user_ppp duplicados o inválidos', async ({
        assert,
    }) => {
        const routerId = await crearRouterFila({ modo_seguridad: 'api', activo: false })
        const planSinFila = await crearPlanFila()
        const clienteId = await crearClienteFila()
        const base = unico('Dup')
        const s1 = await crearServicioFila({
            cliente_id: clienteId,
            router_id: routerId,
            plan_id: planSinFila,
            user_ppp: base.toLowerCase(),
            pass_ppp: 'no-es-v1',
        })
        // Mismo nombre con otras mayúsculas y un espacio, en otro router: choca igual.
        const otro = await crearServicioFila({
            cliente_id: clienteId,
            plan_id: planSinFila,
            user_ppp: ` ${base.toUpperCase()}`,
            pass_ppp: cifrar('k'),
        })
        await crearServicioFila({
            cliente_id: clienteId,
            router_id: routerId,
            plan_id: planSinFila,
            user_ppp: `${unico('con')} espacio`,
            pass_ppp: cifrar('k'),
        })

        const informe = await verificarMigracionRouter(routerId)
        assert.isFalse(informe.listo)
        assert.equal(comprobacion(informe, 'router').resultado, 'falla')
        assert.include(comprobacion(informe, 'router').resumen, 'inactivo')
        assert.include(comprobacion(informe, 'router').resumen, 'modo_seguridad = api')
        assert.equal(comprobacion(informe, 'secreto').resultado, 'falla')
        const credenciales = comprobacion(informe, 'credenciales')
        assert.equal(credenciales.resultado, 'falla')
        assert.isTrue(credenciales.detalles.some((d) => d.includes(`servicio ${s1}`)))
        const planes = comprobacion(informe, 'planes')
        assert.equal(planes.resultado, 'falla')
        assert.isTrue(planes.detalles.some((d) => d.includes('sin fila en planes_routers')))
        assert.isTrue(
            planes.detalles.some((d) => d.startsWith('aviso') && d.includes('sin velocidad limitada')),
        )
        const usuarios = comprobacion(informe, 'user_ppp')
        assert.equal(usuarios.resultado, 'falla')
        assert.isTrue(
            usuarios.detalles.some(
                (d) =>
                    d.startsWith('duplicado') &&
                    d.includes(`servicio ${s1}`) &&
                    d.includes(`servicio ${otro}`),
            ),
        )
        assert.isTrue(usuarios.detalles.some((d) => d.startsWith('inválido para FreeRADIUS')))
    })

    test('router inexistente: falla y no sigue', async ({ assert }) => {
        const informe = await verificarMigracionRouter(987654321)
        assert.isFalse(informe.listo)
        assert.deepEqual(
            informe.comprobaciones.map((c) => [c.clave, c.resultado]),
            [['router', 'falla']],
        )
        assert.include(informeMarkdown(informe), 'no existe el router 987654321')
    })

    test('comando: escribe el Markdown y sale con 0 si está listo, 1 si no', async ({ assert }) => {
        const { routerId } = await routerListo()
        const dir = await mkdtemp(join(tmpdir(), 'a2-verificar-'))
        const escribir = process.stdout.write
        try {
            // El comando imprime el informe; en la prueba basta el archivo.
            process.stdout.write = (() => true) as typeof process.stdout.write
            const ace = await app.container.make('ace')
            const listo = await ace.exec('aaa:verificar-router', [
                String(routerId),
                '--salida',
                join(dir, 'listo.md'),
            ])
            const noListo = await ace.exec('aaa:verificar-router', ['987654321'])
            process.stdout.write = escribir
            assert.equal(listo.exitCode, 0)
            assert.include(await readFile(join(dir, 'listo.md'), 'utf8'), '**Resultado: LISTO.**')
            assert.equal(noListo.exitCode, 1)
        } finally {
            process.stdout.write = escribir
            await rm(dir, { recursive: true, force: true })
        }
    })
})
