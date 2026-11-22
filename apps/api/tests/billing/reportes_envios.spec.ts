import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, soloEmpresaPrincipal, unico, usuarioConRoles } from '#tests/ayudas'
import { crearEmpresaFila } from '#tests/core/fabricas'
import { describirFiltros } from '#billing/reportes/pdf'
import { sustituirTransporteReportes, type MensajeReporte } from '#billing/reportes/correo'
import { ejecutarCron } from '#billing/jobs'
import { proximoEnvio } from '#billing/reportes/envios'
import AprobarCorreoExterno from '#billing/actions/aprobar_correo_externo'
import RetirarCorreoExterno from '#billing/actions/retirar_correo_externo'
import ProgramarEnvioReporte from '#billing/actions/programar_envio_reporte'
import EditarEnvioReporte from '#billing/actions/editar_envio_reporte'
import EjecutarEnvioReporte from '#billing/actions/ejecutar_envio_reporte'
import type { ContextoAccion } from '#shared/contexto'

/**
 * Inicio por rol (decisión 2), catálogo con favoritos y vistas, PDF de todos los reportes (decisión 7)
 * y envíos programados (decisión 6): ACL y empresa del destinatario en cada envío, correos externos
 * aprobados y solo reportes compartibles.
 */

function ctxEmpresa(empresaId: number, actorId: number | null): ContextoAccion {
    return { ...contextoPrueba(actorId), empresaId, empresasPermitidas: null }
}

const enviados: MensajeReporte[] = []

test.group('billing · inicio por rol', (group) => {
    group.each.timeout(60_000)
    group.each.teardown(async () => {
        const cajero = await db.from('core.roles').where('nombre', 'cajero').select('id').first()
        await db.from('billing.inicio_roles').where('role_id', cajero.id).delete()
    })

    test('de fábrica, por rol, por usuario y sin permiso', async ({ assert, client }) => {
        const admin = await usuarioConRoles(['admin'])
        const cajero = await usuarioConRoles(['cajero'])

        const a = await estado(client.get('/api/v1/inicio').bearerToken(admin.token), 200)
        assert.deepInclude(a.body(), {
            inicio: 'panel_financiero',
            origen: 'fabrica',
            rol: 'admin',
            elegido: null,
        })
        const c = await estado(client.get('/api/v1/inicio').bearerToken(cajero.token), 200)
        assert.deepInclude(c.body(), { inicio: 'dia_a_dia', origen: 'fabrica', motivo: null })
        assert.deepEqual(c.body().disponibles, ['dia_a_dia'])

        // el rol cajero abre el panel financiero, pero sin panel_financiero.ver sigue en día a día
        const rol = await db.from('core.roles').where('nombre', 'cajero').select('id').firstOrFail()
        const r = await estado(
            client
                .put(`/api/v1/inicio/roles/${rol.id}`)
                .json({ inicio: 'panel_financiero' })
                .bearerToken(admin.token),
            200,
        )
        assert.deepInclude(r.body(), { rol: 'cajero', inicio: 'panel_financiero', origen: 'rol' })
        const c2 = await estado(client.get('/api/v1/inicio').bearerToken(cajero.token), 200)
        assert.deepInclude(c2.body(), { inicio: 'dia_a_dia', origen: 'rol', motivo: 'sin_permiso' })
        const evento = await db
            .from('audit.outbox')
            .where('evento', 'inicio.cambiado')
            .whereRaw(`(payload->>'role_id')::bigint = ?`, [rol.id])
            .orderBy('id', 'desc')
            .first()
        assert.deepInclude(evento.payload, { alcance: 'rol', de: 'dia_a_dia', a: 'panel_financiero' })

        // el usuario elige el suyo; sin permiso no puede elegir el panel
        await estado(
            client.put('/api/v1/inicio').json({ inicio: 'panel_financiero' }).bearerToken(cajero.token),
            422,
        )
        const propio = await estado(
            client.put('/api/v1/inicio').json({ inicio: 'dia_a_dia' }).bearerToken(admin.token),
            200,
        )
        assert.deepInclude(propio.body(), { inicio: 'dia_a_dia', origen: 'usuario', elegido: 'dia_a_dia' })
        const cambios = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'usuario', entidad_id: admin.usuario.id, campo: 'inicio' })
        assert.lengthOf(cambios, 1)
        // el admin cambia el de otro usuario; el cajero no puede
        await estado(
            client
                .put(`/api/v1/inicio/usuarios/${admin.usuario.id}`)
                .json({ inicio: null })
                .bearerToken(cajero.token),
            403,
        )
        const otro = await estado(
            client
                .put(`/api/v1/inicio/usuarios/${admin.usuario.id}`)
                .json({ inicio: null })
                .bearerToken(admin.token),
            200,
        )
        assert.deepInclude(otro.body(), { inicio: 'panel_financiero', origen: 'fabrica', elegido: null })
    })
})

test.group('billing · catálogo, favoritos, vistas y PDF', (group) => {
    group.each.timeout(60_000)
    test('catálogo por permisos, favoritos primero y vistas con filtros validados', async ({
        assert,
        client,
    }) => {
        const { token, usuario } = await usuarioConRoles(['contabilidad'])
        const inicial = await estado(client.get('/api/v1/reportes/catalogo').bearerToken(token), 200)
        const codigos = inicial.body().map((r: { codigo: string }) => r.codigo)
        assert.includeMembers(codigos, ['indicadores-financieros', 'bajas', 'cartera-vencida', 'iva'])
        assert.isTrue(inicial.body().every((r: { formatos: string[] }) => r.formatos.includes('pdf')))

        await estado(client.put('/api/v1/reportes/favoritos/iva').bearerToken(token), 200)
        await estado(client.put('/api/v1/reportes/favoritos/iva').bearerToken(token), 200)
        const conFavorito = await estado(client.get('/api/v1/reportes/catalogo').bearerToken(token), 200)
        assert.deepInclude(conFavorito.body()[0], { codigo: 'iva', favorito: true })
        const eventos = await db
            .from('audit.outbox')
            .where('evento', 'reportes.preferencias_cambiadas')
            .whereRaw(`(payload->>'usuario_id')::bigint = ?`, [usuario.id])
        assert.lengthOf(eventos, 1, 'marcar dos veces no repite el evento')
        await estado(client.put('/api/v1/reportes/favoritos/no-existe').bearerToken(token), 422)

        const mala = await estado(
            client
                .post('/api/v1/reportes/vistas')
                .json({ reporte: 'ingresos', nombre: 'Del año', filtros: { desde: 'ayer' } })
                .bearerToken(token),
            422,
        )
        assert.equal(mala.body().errors[0].field, 'filtros.desde')
        const vista = await estado(
            client
                .post('/api/v1/reportes/vistas')
                .json({
                    reporte: 'ingresos',
                    nombre: 'Del año',
                    filtros: { desde: '2026-01-01', formato: 'pdf', agrupar: 'mes' },
                })
                .bearerToken(token),
            201,
        )
        assert.deepEqual(vista.body().filtros, { desde: '2026-01-01', agrupar: 'mes' })
        await estado(
            client
                .post('/api/v1/reportes/vistas')
                .json({ reporte: 'ingresos', nombre: 'del año ', filtros: {} })
                .bearerToken(token),
            409,
        )
        const catalogo = await estado(client.get('/api/v1/reportes/catalogo').bearerToken(token), 200)
        const ingresos = catalogo.body().find((r: { codigo: string }) => r.codigo === 'ingresos')
        assert.lengthOf(ingresos.vistas, 1)
        const otro = await usuarioConRoles(['contabilidad'])
        await estado(client.delete(`/api/v1/reportes/vistas/${vista.body().id}`).bearerToken(otro.token), 404)
        await estado(client.delete(`/api/v1/reportes/vistas/${vista.body().id}`).bearerToken(token), 200)

        // el cajero no ve reportes
        const cajero = await usuarioConRoles(['cajero'])
        await estado(client.get('/api/v1/reportes/catalogo').bearerToken(cajero.token), 403)
    })

    test('todos los reportes se exportan a PDF con un solo generador (y siguen en Excel)', async ({
        assert,
        client,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        for (const ruta of [
            '/api/v1/reportes/iva',
            '/api/v1/reportes/cartera-vencida',
            '/api/v1/reportes/altas-bajas',
            '/api/v1/reportes/cuentas-por-pagar',
            '/api/v1/reportes/bajas',
            '/api/v1/reportes/indicadores-financieros',
        ]) {
            const r = await estado(
                client.get(ruta).qs({ formato: 'pdf' }).header('X-Empresa-Id', '1').bearerToken(token),
                200,
            )
            assert.include(r.header('content-type'), 'application/pdf', ruta)
            assert.include(r.header('content-disposition'), '.pdf"', ruta)
            const cuerpo = Buffer.isBuffer(r.body()) ? r.body() : Buffer.from(r.text(), 'binary')
            assert.equal(cuerpo.subarray(0, 4).toString(), '%PDF', ruta)
        }
        const xlsx = await estado(
            client
                .get('/api/v1/reportes/bajas')
                .qs({ formato: 'xlsx' })
                .header('X-Empresa-Id', '1')
                .bearerToken(token),
            200,
        )
        assert.include(xlsx.header('content-type'), 'spreadsheetml')
        assert.equal(
            describirFiltros({
                desde: '2026-10-01',
                hasta: '2026-10-31',
                zona_id: 3,
                formato: 'pdf',
                cliente_id: undefined,
            }),
            'Desde: 01/10/2026 · Hasta: 31/10/2026 · Zona: 3',
        )
        assert.equal(describirFiltros({}), 'Sin filtros')
    })
})

test.group('billing · envíos programados de reportes', (group) => {
    group.each.timeout(60_000)
    group.each.setup(() => {
        enviados.length = 0
        sustituirTransporteReportes({
            async enviar(m) {
                enviados.push(m)
                return `<${unico('id')}@prueba>`
            },
        })
        return () => sustituirTransporteReportes(null)
    })
    group.each.teardown(() => soloEmpresaPrincipal())

    test('correos externos: solo admin los aprueba; solo reportes compartibles sin datos personales', async ({
        assert,
        client,
    }) => {
        const E = await crearEmpresaFila()
        const admin = await usuarioConRoles(['admin'])
        const conta = await usuarioConRoles(['contabilidad'])
        const correo = `${unico('contador')}@externo.test`
        await estado(
            client
                .post('/api/v1/reportes/correos-externos')
                .json({ correo, nombre: 'Contador' })
                .bearerToken(conta.token),
            403,
        )
        const aprobado = await estado(
            client
                .post('/api/v1/reportes/correos-externos')
                .json({ correo: correo.toUpperCase(), nombre: 'Contador' })
                .bearerToken(admin.token),
            201,
        )
        assert.equal(aprobado.body().correo, correo)
        const evento = await db
            .from('audit.outbox')
            .where('evento', 'reportes.correo_externo_cambiado')
            .whereRaw(`(payload->>'correo_externo_id')::bigint = ?`, [aprobado.body().id])
            .first()
        assert.notInclude(JSON.stringify(evento.payload), correo, 'el evento nunca lleva la dirección')

        // la cartera agrupada por cliente (la de fábrica) lleva nombres: no va a un correo externo
        const rechazo = await estado(
            client
                .post('/api/v1/reportes/envios')
                .header('X-Empresa-Id', String(E))
                .json({
                    reporte: 'cartera-vencida',
                    nombre: 'Cartera semanal',
                    formato: 'pdf',
                    frecuencia: 'semanal',
                    dia: 1,
                    hora: 7,
                    destinatarios: { correos_externos: [aprobado.body().id] },
                })
                .bearerToken(conta.token),
            422,
        )
        assert.equal(rechazo.body().errors[0].rule, 'no_compartible')
        // agrupada por zona sí
        const envio = await estado(
            client
                .post('/api/v1/reportes/envios')
                .header('X-Empresa-Id', String(E))
                .json({
                    reporte: 'cartera-vencida',
                    nombre: 'Cartera por zona',
                    filtros: { agrupar: 'zona' },
                    formato: 'xlsx',
                    frecuencia: 'mensual',
                    dia: 1,
                    hora: 7,
                    destinatarios: { correos_externos: [aprobado.body().id], usuarios: [conta.usuario.id] },
                })
                .bearerToken(conta.token),
            201,
        )
        assert.equal(envio.body().empresa_id, E)
        assert.lengthOf(envio.body().destinatarios, 2)
        // un correo que no está en la lista: 422
        await estado(
            client
                .post('/api/v1/reportes/envios')
                .header('X-Empresa-Id', String(E))
                .json({
                    reporte: 'iva',
                    nombre: 'IVA',
                    formato: 'pdf',
                    frecuencia: 'diaria',
                    hora: 7,
                    destinatarios: { correos_externos: [999999999] },
                })
                .bearerToken(conta.token),
            422,
        )
        // consolidado sin alcance global: 403
        await db.from('core.usuarios').where('id', conta.usuario.id).update({ alcance_global: false })
        await db.table('core.usuarios_empresas').insert({ usuario_id: conta.usuario.id, empresa_id: E })
        await estado(
            client
                .post('/api/v1/reportes/envios')
                .json({
                    reporte: 'iva',
                    nombre: 'IVA',
                    consolidado: true,
                    formato: 'pdf',
                    frecuencia: 'diaria',
                    hora: 7,
                    destinatarios: { usuarios: [conta.usuario.id] },
                })
                .bearerToken(conta.token),
            403,
        )
    })

    test('cada envío revisa ACL y empresa del destinatario; una corrida por hora; editar, pausar y retirar', async ({
        assert,
    }) => {
        const E = await crearEmpresaFila()
        const otraEmpresa = await crearEmpresaFila()
        const admin = await usuarioConRoles(['admin'])
        const conta = await usuarioConRoles(['contabilidad'])
        const cajero = await usuarioConRoles(['cajero'])
        const ajeno = await usuarioConRoles(['contabilidad'])
        await db.from('core.usuarios').where('id', ajeno.usuario.id).update({ alcance_global: false })
        await db
            .table('core.usuarios_empresas')
            .insert({ usuario_id: ajeno.usuario.id, empresa_id: otraEmpresa })
        const externo = await new AprobarCorreoExterno().execute(
            { correo: `${unico('socio')}@externo.test`, nombre: 'Socio' },
            contextoPrueba(admin.usuario.id),
        )

        const creado = new Date('2026-11-21T12:00:00Z') // 06:00 en Guatemala
        const envio = await new ProgramarEnvioReporte().execute(
            {
                reporte: 'indicadores-financieros',
                nombre: 'Indicadores del día',
                formato: 'pdf',
                frecuencia: 'diaria',
                hora: 7,
                destinatarios: {
                    usuarios: [admin.usuario.id, conta.usuario.id, cajero.usuario.id, ajeno.usuario.id],
                    correos_externos: [externo.id],
                },
                ahora: creado,
            },
            ctxEmpresa(E, admin.usuario.id),
        )
        assert.equal(envio.proximo_en, '2026-11-21T13:00:00.000Z')
        const creadoEvento = await db
            .from('audit.outbox')
            .where('evento', 'reportes.envio_cambiado')
            .whereRaw(`(payload->>'envio_id')::bigint = ?`, [envio.id])
            .first()
        assert.equal(creadoEvento.payload.accion, 'creado')

        // antes de la hora no hace nada
        const temprano = await new EjecutarEnvioReporte().execute(
            { envio_id: envio.id, ahora: new Date('2026-11-21T12:30:00Z') },
            contextoPrueba(),
        )
        assert.isNull(temprano.corrida_id)

        const ahora = new Date('2026-11-21T13:02:00Z')
        const r = await new EjecutarEnvioReporte().execute({ envio_id: envio.id, ahora }, contextoPrueba())
        assert.deepInclude(r, { enviados: 3, omitidos: 2, fallidos: 0 })
        const corrida = await db.from('billing.reportes_envios_corridas').where('id', r.corrida_id!).first()
        const motivo = (usuarioId: number) =>
            (corrida.resultados as Array<{ usuario_id: number | null; motivo: string | null }>).find(
                (x) => x.usuario_id === usuarioId,
            )?.motivo
        assert.equal(motivo(cajero.usuario.id), 'sin_permiso')
        assert.equal(motivo(ajeno.usuario.id), 'sin_acceso_empresa')
        assert.isNull(motivo(admin.usuario.id))
        assert.lengthOf(enviados, 3)
        assert.isTrue(enviados.every((m) => m.adjunto.contenido.subarray(0, 4).toString() === '%PDF'))
        assert.includeMembers(
            enviados.map((m) => m.para),
            [admin.usuario.email, conta.usuario.email, externo.correo],
        )
        const ejecutado = await db
            .from('audit.outbox')
            .where('evento', 'reportes.envio_ejecutado')
            .whereRaw(`(payload->>'corrida_id')::bigint = ?`, [r.corrida_id!])
            .first()
        assert.deepInclude(ejecutado.payload, { enviados: 3, omitidos: 2, fallidos: 0, empresa_id: E })
        const despues = await db.from('billing.reportes_envios').where('id', envio.id).first()
        assert.equal(new Date(despues.proximo_en).toISOString(), '2026-11-22T13:00:00.000Z')

        // repetir con el mismo «ahora» no repite el correo
        const otra = await new EjecutarEnvioReporte().execute({ envio_id: envio.id, ahora }, contextoPrueba())
        assert.isNull(otra.corrida_id)
        assert.lengthOf(enviados, 3)

        // el admin retira el correo externo: el siguiente envío lo omite
        await new RetirarCorreoExterno().execute({ id: externo.id }, contextoPrueba(admin.usuario.id))
        const dia2 = await new EjecutarEnvioReporte().execute(
            { envio_id: envio.id, ahora: new Date('2026-11-22T13:01:00Z') },
            contextoPrueba(),
        )
        assert.deepInclude(dia2, { enviados: 2, omitidos: 3 })

        // pausar: el cron no lo toca; reanudar recalcula desde ahora (no manda lo perdido)
        const actual = await db.from('billing.reportes_envios').where('id', envio.id).first()
        const pausado = await new EditarEnvioReporte().execute(
            {
                id: envio.id,
                version: Number(actual.version),
                nombre: 'Indicadores del día',
                formato: 'pdf',
                frecuencia: 'diaria',
                hora: 7,
                activo: false,
                destinatarios: {
                    usuarios: [admin.usuario.id, conta.usuario.id, cajero.usuario.id, ajeno.usuario.id],
                },
            },
            ctxEmpresa(E, admin.usuario.id),
        )
        assert.isFalse(pausado.activo)
        const sinCorrida = await new EjecutarEnvioReporte().execute(
            { envio_id: envio.id, ahora: new Date('2026-11-25T13:01:00Z') },
            contextoPrueba(),
        )
        assert.isNull(sinCorrida.corrida_id)
        const conflicto = new EditarEnvioReporte().execute(
            {
                id: envio.id,
                version: 1,
                nombre: 'x',
                formato: 'pdf',
                frecuencia: 'diaria',
                hora: 7,
                destinatarios: { usuarios: [admin.usuario.id] },
            },
            ctxEmpresa(E, admin.usuario.id),
        )
        await assert.rejects(() => conflicto)
        const cambios = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'envio_reporte', entidad_id: envio.id })
        assert.isAbove(cambios.length, 0)
    })

    test('el cron procesa todo lo pendiente con lock', async ({ assert }) => {
        const E = await crearEmpresaFila()
        const admin = await usuarioConRoles(['admin'])
        const envio = await new ProgramarEnvioReporte().execute(
            {
                reporte: 'iva',
                nombre: 'IVA mensual',
                formato: 'csv',
                frecuencia: 'mensual',
                dia: 1,
                hora: 6,
                destinatarios: { usuarios: [admin.usuario.id] },
                ahora: new Date('2026-10-15T12:00:00Z'),
            },
            ctxEmpresa(E, admin.usuario.id),
        )
        assert.equal(envio.proximo_en, '2026-11-01T12:00:00.000Z')
        const salida = (await ejecutarCron('reportes', new Date('2026-11-21T12:00:00Z'))) as {
            omitido: boolean
            resultado?: { envios: number }
        }
        assert.isFalse(salida.omitido)
        assert.isAtLeast(salida.resultado!.envios, 1)
        assert.isTrue(
            enviados.some((m) => m.para === admin.usuario.email && m.adjunto.nombre.endsWith('.csv')),
        )
        assert.equal(
            proximoEnvio('semanal', 7, 8, new Date('2026-11-21T12:00:00Z')).toISOString(),
            '2026-11-22T14:00:00.000Z',
        )
    })
})
