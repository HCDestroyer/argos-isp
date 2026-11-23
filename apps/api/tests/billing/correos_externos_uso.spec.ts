import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, soloEmpresaPrincipal, unico, usuarioConRoles } from '#tests/ayudas'
import { crearEmpresaFila } from '#tests/core/fabricas'
import AprobarCorreoExterno from '#billing/actions/aprobar_correo_externo'
import RetirarCorreoExterno from '#billing/actions/retirar_correo_externo'
import ProgramarEnvioReporte from '#billing/actions/programar_envio_reporte'
import type { ContextoAccion } from '#shared/contexto'

/**
 * Columna «Envíos» de los correos externos aprobados (tablero PendEnviosReportes, decisión 6): por
 * correo, cuántos envíos programados lo usan y quién lo aprobó o retiró. Solo cuentan los envíos que la
 * petición puede ver (empresa activa; consolidados con alcance global).
 */

function ctxEmpresa(empresaId: number, actorId: number): ContextoAccion {
    return { ...contextoPrueba(actorId), empresaId, empresasPermitidas: null }
}

async function programar(empresaId: number, actorId: number, correoId: number, usuarioId: number) {
    return new ProgramarEnvioReporte().execute(
        {
            reporte: 'indicadores-financieros',
            nombre: unico('Indicadores'),
            formato: 'pdf',
            frecuencia: 'diaria',
            hora: 7,
            destinatarios: { usuarios: [usuarioId], correos_externos: [correoId] },
        },
        ctxEmpresa(empresaId, actorId),
    )
}

test.group('billing · correos externos con su uso', (group) => {
    group.each.timeout(60_000)
    group.each.teardown(() => soloEmpresaPrincipal())

    test('envíos programados y activos por correo, por empresa de la petición; nombres de quien aprueba y retira', async ({
        assert,
        client,
    }) => {
        const E = await crearEmpresaFila()
        const F = await crearEmpresaFila()
        const admin = await usuarioConRoles(['admin'])
        const conta = await usuarioConRoles(['contabilidad'])
        const usado = await new AprobarCorreoExterno().execute(
            { correo: `${unico('contador')}@externo.test`, nombre: 'Contador' },
            contextoPrueba(admin.usuario.id),
        )
        const libre = await new AprobarCorreoExterno().execute(
            { correo: `${unico('auditoria')}@externo.test`, nombre: 'Auditoría' },
            contextoPrueba(admin.usuario.id),
        )
        const e1 = await programar(E, admin.usuario.id, usado.id, conta.usuario.id)
        await programar(E, admin.usuario.id, usado.id, conta.usuario.id)
        await programar(F, admin.usuario.id, usado.id, conta.usuario.id)
        // uno en pausa: sigue siendo programado, no activo
        await db.from('billing.reportes_envios').where('id', e1.id).update({ activo: false })
        await new RetirarCorreoExterno().execute({ id: libre.id }, contextoPrueba(admin.usuario.id))

        const lista = async (empresa: number | null, token: string) => {
            const req = client.get('/api/v1/reportes/correos-externos').bearerToken(token)
            const r = await estado(empresa === null ? req : req.header('X-Empresa-Id', String(empresa)), 200)
            return r.body().data as Array<Record<string, unknown>>
        }
        const deE = await lista(E, conta.token)
        const fila = deE.find((c) => c.id === usado.id)!
        assert.deepInclude(fila, {
            correo: usado.correo,
            activo: true,
            aprobado_por: admin.usuario.id,
            aprobado_por_nombre: admin.usuario.nombre,
            retirado_por_nombre: null,
            envios_programados: 2,
            envios_activos: 1,
        })
        const retirado = deE.find((c) => c.id === libre.id)!
        assert.deepInclude(retirado, {
            activo: false,
            retirado_por_nombre: admin.usuario.nombre,
            envios_programados: 0,
            envios_activos: 0,
        })

        const deF = await lista(F, conta.token)
        assert.deepInclude(
            deF.find((c) => c.id === usado.id)!,
            { envios_programados: 1, envios_activos: 1 },
        )

        // filtro activo sigue funcionando
        const activos = await estado(
            client
                .get('/api/v1/reportes/correos-externos')
                .qs({ activo: false })
                .header('X-Empresa-Id', String(E))
                .bearerToken(conta.token),
            200,
        )
        assert.isTrue(activos.body().data.every((c: { activo: boolean }) => !c.activo))

        // un usuario de una sola empresa no cuenta los envíos de otra
        const soloE = await usuarioConRoles(['contabilidad'])
        await db.from('core.usuarios').where('id', soloE.usuario.id).update({ alcance_global: false })
        await db.table('core.usuarios_empresas').insert({ usuario_id: soloE.usuario.id, empresa_id: E })
        const propia = await lista(null, soloE.token)
        assert.deepInclude(
            propia.find((c) => c.id === usado.id)!,
            { envios_programados: 2 },
        )
    })
})
