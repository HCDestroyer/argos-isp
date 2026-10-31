import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import { cifrar } from '#shared/cifrado'
import { contextoPrueba, unico } from '#tests/ayudas'
import {
    crearClienteFila,
    crearPlanFila,
    crearServicioFila,
    crearRouterFila,
    redUnica,
} from '#tests/core/fabricas'
import ExportarSecretsEmergencia from '#operacion/actions/exportar_secrets_emergencia'
import { cadenaRos } from '#operacion/secrets_emergencia'
import { registrosAaaPorServicio } from '#core/aaa'

/**
 * Secrets PPPoE de emergencia (pendiente de A2 en `a2.md`): el `.rsc` sale de los mismos
 * registros que `aaa` y las contraseñas solo van al archivo.
 */

async function escenario() {
    const routerId = await crearRouterFila({ nombre: unico('Torre emergencia') })
    const otroRouter = await crearRouterFila()
    const cidr = redUnica()
    const base = cidr.replace('.0/24', '')
    const [red] = (await db
        .table('network.redes_ipv4')
        .insert({ router_id: routerId, cidr, gateway: `${base}.1`, tipo: 'estatico' })
        .returning('id')) as Array<{ id: number }>
    const planId = await crearPlanFila({ bajada_kbps: 10_000, subida_kbps: 5000 })
    await db.table('network.planes_routers').insert({
        plan_id: planId,
        router_id: routerId,
        profile_ppp: 'perfil-plan',
        pool_ipv4: 'pool-clientes',
    })
    const clienteId = await crearClienteFila()
    const usuario = (s: string) => unico(`em-${s}`)
    const servicio = async (estado: string, clave: string, datos: Record<string, unknown> = {}) => {
        const user = usuario(estado)
        const id = await crearServicioFila({
            cliente_id: clienteId,
            router_id: routerId,
            plan_id: planId,
            user_ppp: user,
            pass_ppp: cifrar(clave),
            estado,
            ...datos,
        })
        return { id, user }
    }
    const activo = await servicio('activo', 'cl@ve"con$signos\\')
    await db
        .table('network.ipv4_asignaciones')
        .insert({ servicio_id: activo.id, red_id: red!.id, ip: `${base}.10` })
    const conPool = await servicio('activo', 'clave-pool')
    const limitado = await servicio('limitado', 'clave-limitado')
    const suspendido = await servicio('suspendido', 'clave-suspendido')
    const retirado = await servicio('retirado', 'clave-retirado')
    const roto = await servicio('activo', 'x', { pass_ppp: 'no-es-un-cifrado' })
    const deOtro = await crearServicioFila({
        cliente_id: clienteId,
        router_id: otroRouter,
        plan_id: planId,
        user_ppp: usuario('otro'),
        pass_ppp: cifrar('clave-otro-router'),
    })
    return { routerId, planId, base, activo, conPool, limitado, suspendido, retirado, roto, deOtro }
}

test.group('operacion · secrets PPPoE de emergencia', () => {
    test('arma el .rsc con perfiles por plan, suspendidos al perfil de corte y sin retirados', async ({
        assert,
    }) => {
        const e = await escenario()
        const ctx = contextoPrueba()
        const { rsc, resumen } = await new ExportarSecretsEmergencia().execute({ router_id: e.routerId }, ctx)

        assert.equal(resumen.servicios, 4)
        assert.deepEqual(resumen.por_estado, { activo: 2, limitado: 1, suspendido: 1 })
        assert.deepEqual(resumen.perfiles, [
            `argosisp-emergencia-plan-${e.planId}`,
            `argosisp-emergencia-plan-${e.planId}-limitado`,
        ])
        assert.deepEqual(
            resumen.omitidos.map((o) => o.user_ppp),
            [e.roto.user],
        )
        assert.notInclude(JSON.stringify(resumen), 'clave')

        const lineas = rsc.split('\n')
        const secret = (user: string) => lineas.find((l) => l.startsWith(`add name="${user}"`))
        // Contraseña escapada para RouterOS (\ " $), IPv4 fija y perfil del plan
        assert.equal(
            secret(e.activo.user),
            `add name="${e.activo.user}" password=${cadenaRos('cl@ve"con$signos\\')} service=pppoe profile="argosisp-emergencia-plan-${e.planId}" remote-address=${e.base}.10 comment="argosisp-emergencia"`,
        )
        assert.include(secret(e.activo.user)!, 'password="cl@ve\\"con\\$signos\\\\"')
        assert.include(secret(e.conPool.user)!, 'password="clave-pool"')
        assert.notInclude(secret(e.conPool.user)!, 'remote-address')
        assert.include(secret(e.limitado.user)!, `profile="argosisp-emergencia-plan-${e.planId}-limitado"`)
        assert.include(secret(e.suspendido.user)!, 'profile="suspendido"')
        assert.isUndefined(secret(e.retirado.user))
        assert.isUndefined(secret(e.roto.user))
        assert.notInclude(rsc, 'clave-otro-router')

        // Perfil del plan: copia del perfil del router con el rate-limit de aaa y el pool
        const perfil = lineas.find((l) => l.startsWith(`add name="argosisp-emergencia-plan-${e.planId}" `))!
        assert.include(perfil, 'copy-from="perfil-plan"')
        const [registro] = await registrosAaaPorServicio([e.activo.id])
        assert.include(perfil, `rate-limit=${cadenaRos(registro!.plan.rate_limit)}`)
        const perfilLimitado = lineas.find((l) =>
            l.startsWith(`add name="argosisp-emergencia-plan-${e.planId}-limitado" `),
        )!
        assert.include(perfilLimitado, `rate-limit=${cadenaRos(registro!.plan.rate_limit_limitado)}`)
        assert.include(perfil, 'remote-address="pool-clientes"')
        // Limpia lo anterior antes de agregar, secrets antes que perfiles
        const borrarSecrets = lineas.indexOf('/ppp secret remove [find comment="argosisp-emergencia"]')
        const borrarPerfiles = lineas.indexOf('/ppp profile remove [find comment="argosisp-emergencia"]')
        assert.isAbove(borrarSecrets, 0)
        assert.isAbove(borrarPerfiles, borrarSecrets)
        assert.isBelow(borrarPerfiles, lineas.indexOf('/ppp profile'))

        // Auditada (saca contraseñas), sin el .rsc en la auditoría
        const auditoria = (await db
            .from('audit.acciones')
            .where('request_id', ctx.requestId)
            .select('accion', 'entidad_tipo', 'entidad_id', 'entrada')
            .first()) as Record<string, unknown>
        assert.equal(auditoria.accion, 'routers.exportar_secrets_emergencia')
        assert.equal(auditoria.entidad_tipo, 'router')
        assert.equal(Number(auditoria.entidad_id), e.routerId)
        assert.notInclude(JSON.stringify(auditoria), 'clave')
    })

    test('sin suspendidos y router inexistente', async ({ assert }) => {
        const e = await escenario()
        const { resumen, rsc } = await new ExportarSecretsEmergencia().execute(
            { router_id: e.routerId, incluir_suspendidos: false, perfil_suspendido: 'corte' },
            contextoPrueba(),
        )
        assert.notProperty(resumen.por_estado, 'suspendido')
        assert.notInclude(rsc, e.suspendido.user + '" password')
        await assert.rejects(
            () => new ExportarSecretsEmergencia().execute({ router_id: 987_654_321 }, contextoPrueba()),
            /No existe el router 987654321/,
        )
    })

    test('encabezado con el NAS; un router sin RADIUS (nas_ip null) no imprime «null»', async ({
        assert,
    }) => {
        const nasIp = '198.51.100.77'
        const conRadius = await crearRouterFila({ nombre: unico('Con RADIUS'), nas_ip: nasIp })
        const sinRadius = await crearRouterFila({
            nombre: unico('Sin RADIUS'),
            modo_seguridad: 'api',
            nas_ip: null,
        })
        const exportar = (router_id: number) =>
            new ExportarSecretsEmergencia().execute({ router_id }, contextoPrueba())

        const { rsc: conNas } = await exportar(conRadius)
        assert.include(conNas.split('\n')[0]!, `(NAS ${nasIp})`)

        const { rsc, resumen } = await exportar(sinRadius)
        const encabezado = rsc.split('\n')[0]!
        assert.notInclude(rsc, 'null')
        assert.include(encabezado, `router ${sinRadius} `)
        assert.include(encabezado, '(sin RADIUS: sin NAS)')
        assert.equal(resumen.servicios, 0)
    })

    test('comando: escribe el archivo 0600, no lo pisa y no imprime contraseñas', async ({ assert }) => {
        const e = await escenario()
        const dir = await mkdtemp(join(tmpdir(), 'a6-emergencia-'))
        const archivo = join(dir, 'emergencia.rsc')
        const stdout = process.stdout.write
        const stderr = process.stderr.write
        const impreso: string[] = []
        const capturar = ((texto: string | Uint8Array) => {
            impreso.push(String(texto))
            return true
        }) as typeof process.stdout.write
        try {
            process.stdout.write = capturar
            process.stderr.write = capturar
            const ace = await app.container.make('ace')
            const primero = await ace.exec('emergencia:secrets-ppp', [
                String(e.routerId),
                '--salida',
                archivo,
            ])
            const otraVez = await ace.exec('emergencia:secrets-ppp', [
                String(e.routerId),
                '--salida',
                archivo,
            ])
            process.stdout.write = stdout
            process.stderr.write = stderr
            assert.equal(primero.exitCode, 0)
            assert.equal(otraVez.exitCode, 1) // ya existe
            const permisos = await stat(archivo)
            assert.equal(permisos.mode & 0o777, 0o600)
            assert.include(await readFile(archivo, 'utf8'), 'password="clave-pool"')
            const salida = impreso.join('')
            assert.include(salida, '4 secrets')
            assert.notInclude(salida, 'clave-pool')
            assert.notInclude(salida, 'cl@ve')
        } finally {
            process.stdout.write = stdout
            process.stderr.write = stderr
            await rm(dir, { recursive: true, force: true })
        }
    })
})
