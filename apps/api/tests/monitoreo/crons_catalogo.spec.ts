import { test } from '@japa/runner'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { Queue } from 'bullmq'
import app from '@adonisjs/core/services/app'
import { CATALOGO_CRONS, cronDeJob, type Horario } from '#monitoreo/crons/catalogo'
import { programarCronsBilling } from '#billing/jobs'
import { programarCronsCore } from '#core/jobs'
import { programarColaFel } from '#fiscal/jobs'
import { programarCronsRouterOS } from '#network/routeros/jobs'
import { programarCronSesiones } from '#network/sesiones/colgadas'
import { programarCronRecordatorios } from '#notify/recordatorios'
import { programarCronParticiones } from '#notify/particiones'
import { programarCronVigilancia } from '#notify/vigilancia'
import { programarCronAlmacenamiento } from '#monitoreo/cron_almacenamiento'

/**
 * El catálogo de tareas programadas (`app/monitoreo/crons/catalogo.ts`) tiene TODOS los crons:
 *
 * 1. Ningún archivo nuevo agenda un job scheduler (`upsertJobScheduler`) ni da vueltas con
 *    `setInterval`/`setTimeout` en un worker sin estar en la lista de abajo (y en el catálogo).
 * 2. Cada job scheduler que los módulos agendan en BullMQ está en el catálogo con el mismo horario, y
 *    cada cron del catálogo con cola está agendado.
 */

/** Archivos que agendan crons o dan vueltas, y quién los describe en el catálogo. */
const AGENDAN: Record<string, string> = {
    'app/billing/jobs.ts': 'billing-cron (billing:worker)',
    'app/core/jobs.ts': 'core-cron (eventos:relay)',
    'app/fiscal/jobs.ts': 'fel-cron (fiscal:worker)',
    'app/network/routeros/jobs.ts': 'routeros-cron (routeros:worker)',
    'app/network/sesiones/colgadas.ts': 'sesiones-cron (sesiones:worker)',
    'app/notify/recordatorios.ts': 'notify-cron: recordatorios',
    'app/notify/particiones.ts': 'notify-cron: particiones',
    'app/notify/vigilancia.ts': 'notify-cron: vigilancia-crons',
    'app/monitoreo/cron_almacenamiento.ts': 'notify-cron: almacenamiento',
    'commands/iris_worker.ts': 'iris.pendientes e iris.conciliar_avisos',
    'commands/horus_worker.ts': 'horus.pendientes',
    'app/integraciones/equipos/cola.ts': 'equipos.pendientes (equipos:worker)',
}

async function archivosTs(dir: string): Promise<string[]> {
    const salida: string[] = []
    for (const entrada of await readdir(dir, { withFileTypes: true })) {
        const ruta = join(dir, entrada.name)
        if (entrada.isDirectory()) salida.push(...(await archivosTs(ruta)))
        else if (entrada.name.endsWith('.ts')) salida.push(ruta)
    }
    return salida
}

/** Patrón cron → horario de Guatemala (UTC−6, sin horario de verano). */
function horarioDePatron(pattern: string, tz: string | undefined): Horario {
    const [m, h, dia] = pattern.split(' ')
    let minutos = Number(h) * 60 + Number(m)
    if (tz !== 'America/Guatemala') minutos = (minutos - 6 * 60 + 24 * 60) % (24 * 60)
    const hora = `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`
    return dia === '*' ? { tipo: 'diario', hora } : { tipo: 'mensual', dia: Number(dia), hora }
}

test.group('monitoreo · catálogo de crons', (group) => {
    const prefijo = `${process.env.COLAS_PREFIJO ?? 'argosisp'}-catalogo`
    const colas: Queue[] = []

    group.teardown(async () => {
        for (const cola of colas) {
            await cola.obliterate({ force: true })
            await cola.close()
        }
    })

    test('ningún archivo agenda un cron sin estar en el catálogo', async ({ assert }) => {
        const raiz = app.makePath()
        const archivos = [
            ...(await archivosTs(app.makePath('app'))),
            ...(await archivosTs(app.makePath('commands'))),
        ]
        const encontrados: string[] = []
        for (const archivo of archivos) {
            const texto = await readFile(archivo, 'utf8')
            const agenda = /\.upsertJobScheduler\(|\bsetInterval\(/.test(texto)
            const vuelta = /\bwhile \(activo\)/.test(texto) && /setTimeout\(/.test(texto)
            if (agenda || vuelta) encontrados.push(relative(raiz, archivo))
        }
        assert.sameMembers(
            encontrados,
            Object.keys(AGENDAN),
            'Hay un archivo que agenda un cron nuevo: agrégalo a CATALOGO_CRONS y a AGENDAN',
        )
    })

    test('cada job scheduler agendado está en el catálogo con su horario, y al revés', async ({ assert }) => {
        colas.push(
            await programarCronsBilling({ prefijo }),
            await programarCronsCore({ prefijo }),
            await programarColaFel({ prefijo }),
            await programarCronsRouterOS({ prefijo }),
            await programarCronSesiones({ prefijo }),
        )
        const notify = await programarCronRecordatorios({ prefijo })
        await programarCronParticiones(notify)
        await programarCronVigilancia(notify)
        await programarCronAlmacenamiento(notify)
        colas.push(notify)

        const agendados = new Set<string>()
        for (const cola of colas) {
            for (const s of await cola.getJobSchedulers(0, -1, true)) {
                const cron = cronDeJob(cola.name, s.key)
                assert.exists(cron, `${cola.name}/${s.key} no está en CATALOGO_CRONS`)
                agendados.add(`${cola.name}|${s.key}`)
                const esperado = cron!.horario()
                if (s.every) {
                    assert.deepEqual(esperado, { tipo: 'cada', ms: Number(s.every) }, cron!.clave)
                } else {
                    assert.deepEqual(esperado, horarioDePatron(s.pattern!, s.tz), cron!.clave)
                }
            }
        }
        for (const cron of CATALOGO_CRONS) {
            if (!cron.bullmq || !cron.horario()) continue
            assert.isTrue(
                agendados.has(`${cron.bullmq.cola}|${cron.bullmq.job}`),
                `${cron.clave} está en el catálogo pero nadie lo agenda`,
            )
        }
    })

    test('claves únicas, nombre y descripción en español y permisos para ejecutar a mano', ({ assert }) => {
        const claves = CATALOGO_CRONS.map((c) => c.clave)
        assert.lengthOf(new Set(claves), claves.length)
        for (const cron of CATALOGO_CRONS) {
            assert.match(cron.clave, /^[a-z_]+\.[a-z_:]+$/)
            assert.isAbove(cron.nombre.length, 3)
            assert.match(cron.descripcion, /\.$/, `${cron.clave}: la descripción es una frase`)
            if (cron.manual) {
                assert.isNotNull(cron.bullmq, `${cron.clave}: manual sin cola`)
                assert.include(cron.permisos, 'sistema.ejecutar_cron')
            }
        }
    })
})
