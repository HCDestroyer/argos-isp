import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, soloEmpresaPrincipal, unico, usuarioConRoles } from '#tests/ayudas'
import { afirmarLibroCuadrado } from '#tests/ledger/ayudas_libro'
import { cuentaBancariaPrueba, unicoBd } from '#tests/billing/ayudas_billing'
import { crearClienteFila, crearEmpresaFila, crearPlanFila, crearServicioFila } from '#tests/core/fabricas'
import RegistrarAsiento from '#ledger/actions/registrar_asiento'
import ConfigurarPanelFinanciero from '#billing/actions/configurar_panel_financiero'
import { panelFinanciero, alertasPanel } from '#billing/panel/panel'
import { bajasPorMes, ingresoRecurrente } from '#billing/panel/indicadores'
import { reporteBajas } from '#billing/panel/reportes_panel'
import { instalarPaquete, paqueteDePais } from '#fiscal/instalador'
import { datosFiscales, resolver } from '#fiscal/parametros'
import type { ContextoAccion } from '#shared/contexto'

/**
 * Panel financiero (decisiones del PM 3, 4 y 12): ingreso mensual recurrente con IVA, bajas y su
 * tasa, ingreso promedio, efectivo del libro y alertas. Cada prueba usa una empresa propia: las
 * cifras no dependen de lo que dejaron otras suites.
 */

const AHORA = new Date('2026-11-21T18:00:00Z')
const DIA = 86_400_000

function ctxEmpresa(empresaId: number, actorId: number | null = null): ContextoAccion {
    return { ...contextoPrueba(actorId), empresaId, empresasPermitidas: null }
}

async function servicio(empresaId: number, datos: Record<string, unknown>) {
    const clienteId = await crearClienteFila()
    return crearServicioFila({
        cliente_id: clienteId,
        empresa_id: empresaId,
        fecha_instalacion: '2026-01-05',
        ...datos,
    })
}

/** Evento de cambio de estado con fecha (el historial que leen las bajas). */
async function cambioEstado(servicioId: number, empresaId: number, de: string, a: string, en: Date) {
    await db.table('audit.outbox').insert({
        evento: 'servicio.estado_cambiado',
        payload: JSON.stringify({ servicio_id: servicioId, empresa_id: empresaId, de, a, motivo: 'prueba' }),
        created_at: en,
        publicado_en: en,
    })
}

test.group('billing · panel financiero', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('ingreso mensual recurrente (MRR) con IVA: activos y limitados, precio especial, cargos y plan temporal', async ({
        assert,
        client,
    }) => {
        const E = await crearEmpresaFila()
        const plan = await crearPlanFila({ precio: '150.00' })
        const superior = await crearPlanFila({ precio: '250.00' })
        await servicio(E, { plan_id: plan, estado: 'activo' })
        const limitado = await servicio(E, { plan_id: plan, estado: 'limitado', costo_override: '100.00' })
        await db
            .table('billing.conceptos_recurrentes')
            .insert({ servicio_id: limitado, nombre: 'Router', monto: '20.00' })
        await servicio(E, { plan_id: plan, estado: 'suspendido' })
        await servicio(E, { plan_id: plan, estado: 'retirado' })
        // plan temporal de lealtad: factura el superior con descuento hasta el original
        const conPuntos = await servicio(E, { plan_id: superior, estado: 'activo' })
        await db.table('core.servicios_planes_temporales').insert({
            empresa_id: E,
            servicio_id: conPuntos,
            plan_id: superior,
            plan_original_id: plan,
            inicio: new Date(AHORA.getTime() - 5 * DIA),
            fin: new Date(AHORA.getTime() + 5 * DIA),
            origen: 'lealtad',
            estado: 'activo',
        })

        const mapaIngresos = await ingresoRecurrente([E])
        const ingresos = mapaIngresos.get(E)!
        assert.equal(ingresos.servicios, 3)
        assert.equal(ingresos.planes, '500.00')
        assert.equal(ingresos.descuentos, '100.00')
        assert.equal(ingresos.cargos_recurrentes, '20.00')
        assert.equal(ingresos.mrr, '420.00')
        assert.equal(ingresos.arpu, '140.00')

        const { token } = await usuarioConRoles(['admin'])
        const r = await estado(
            client.get('/api/v1/panel-financiero').header('X-Empresa-Id', String(E)).bearerToken(token),
            200,
        )
        const seccion = r.body().empresas[0]
        assert.equal(seccion.empresa_id, E)
        assert.equal(seccion.ingresos.estado, 'ok')
        assert.equal(seccion.ingresos.datos.mrr, '420.00')
        assert.equal(seccion.efectivo.estado, 'ok')
        assert.isNull(r.body().total)

        // sin libro.ver la sección de efectivo no aparece (nunca ceros en su lugar)
        const rol = await db
            .table('core.roles')
            .insert({ nombre: unico('solo_panel'), descripcion: 'prueba' })
            .returning('id')
        await db.rawQuery(
            `INSERT INTO core.roles_permisos (role_id, permiso_id)
             SELECT ?, id FROM core.permisos WHERE nombre IN ('panel_financiero.ver', 'reportes.ver')`,
            [rol[0].id],
        )
        const usuario = await usuarioConRoles([])
        await db.table('core.usuarios_roles').insert({ usuario_id: usuario.usuario.id, role_id: rol[0].id })
        const sinLibro = await estado(
            client
                .get('/api/v1/panel-financiero')
                .header('X-Empresa-Id', String(E))
                .bearerToken(usuario.token),
            200,
        )
        assert.notProperty(sinLibro.body().empresas[0], 'efectivo')
        assert.equal(sinLibro.body().empresas[0].ingresos.datos.mrr, '420.00')
        const alertas = await estado(
            client
                .get('/api/v1/panel-financiero/alertas')
                .header('X-Empresa-Id', String(E))
                .bearerToken(usuario.token),
            200,
        )
        assert.deepEqual(alertas.body().revisados, [])

        // con el permiso recortado por zona, 403
        const zona = await db
            .table('core.zonas')
            .insert({ nombre: unico('Zona') })
            .returning('id')
        const parcial = await usuarioConRoles([])
        await db.table('core.usuarios_roles').insert({
            usuario_id: parcial.usuario.id,
            role_id: rol[0].id,
            alcance_tipo: 'zona',
            alcance_id: zona[0].id,
        })
        await estado(
            client
                .get('/api/v1/panel-financiero')
                .header('X-Empresa-Id', String(E))
                .bearerToken(parcial.token),
            403,
        )
        // sin el permiso, 403; el consolidado sin alcance global, 403
        const { token: cajero } = await usuarioConRoles(['cajero'])
        await estado(client.get('/api/v1/panel-financiero').bearerToken(cajero), 403)
    })

    test('bajas (churn): retiros y suspensiones largas, reactivados fuera, días configurables y tasa', async ({
        assert,
    }) => {
        const E = await crearEmpresaFila()
        const plan = await crearPlanFila({ precio: '100.00' })
        const hace = (dias: number) => new Date(AHORA.getTime() - dias * DIA)

        // suspendido hace 70 días: baja hace 10 días (noviembre)
        const s1 = await servicio(E, { plan_id: plan, estado: 'suspendido' })
        await cambioEstado(s1, E, 'limitado', 'suspendido', hace(70))
        // suspendido hace 25 días: todavía no es baja (cuenta como vigente)
        const s2 = await servicio(E, { plan_id: plan, estado: 'suspendido' })
        await cambioEstado(s2, E, 'limitado', 'suspendido', hace(25))
        // retirado hace 5 días estando activo: baja por retiro
        const s3 = await servicio(E, { plan_id: plan, estado: 'retirado' })
        await cambioEstado(s3, E, 'activo', 'retirado', hace(5))
        // suspendido hace 100 días y retirado hace 20: la baja fue a los 60 días (octubre)
        const s4 = await servicio(E, { plan_id: plan, estado: 'retirado' })
        await cambioEstado(s4, E, 'limitado', 'suspendido', hace(100))
        await cambioEstado(s4, E, 'suspendido', 'retirado', hace(20))
        // suspendido hace 90 días y reactivado: deja de contar
        const s5 = await servicio(E, { plan_id: plan, estado: 'activo' })
        await cambioEstado(s5, E, 'limitado', 'suspendido', hace(90))
        await cambioEstado(s5, E, 'suspendido', 'activo', hace(3))
        // alta de noviembre
        await servicio(E, { plan_id: plan, estado: 'activo', fecha_instalacion: '2026-11-05' })

        const porEmpresa = await bajasPorMes([E], ['2026-10', '2026-11'], AHORA)
        const [octubre, noviembre] = porEmpresa.get(E)!
        assert.deepInclude(noviembre, {
            mes: '2026-11',
            dias_baja: 60,
            bajas: 2,
            retiros: 1,
            suspendidos: 1,
            altas: 1,
            vigentes: 3,
            base: 4,
            tasa: '50.00',
        })
        assert.equal(octubre!.bajas, 1)
        assert.equal(octubre!.retiros, 1)

        const panel = await panelFinanciero({
            empresas: [E],
            consolidado: false,
            secciones: new Set(['bajas']),
            ahora: AHORA,
        })
        assert.equal(panel.empresas[0]!.bajas!.estado, 'ok')
        assert.equal((panel.empresas[0]!.bajas!.datos as { bajas: number }).bajas, 2)
        assert.notProperty(panel.empresas[0]!, 'ingresos')

        // 20 días configurados: el suspendido hace 25 días ya es baja (noviembre) y el de hace 70 pasa a
        // octubre (su baja fue a los 20 días); el retirado en suspensión pasa a septiembre
        const ctx = ctxEmpresa(E)
        const ajustes = await new ConfigurarPanelFinanciero().execute({ dias_baja: 20, version: 1 }, ctx)
        assert.deepEqual(ajustes, { empresa_id: E, dias_baja: 20, fabrica: false, version: 1 })
        const evento = await db
            .from('audit.outbox')
            .where('evento', 'panel_financiero.ajustes_cambiados')
            .whereRaw(`(payload->>'empresa_id')::bigint = ?`, [E])
            .first()
        assert.deepEqual(evento.payload.campos, ['dias_baja'])
        const auditoria = await db
            .from('audit.acciones')
            .where({ accion: 'panel_financiero.configurar', request_id: ctx.requestId })
            .first()
        assert.equal(auditoria.resultado, 'ok')
        await assert.rejects(() =>
            new ConfigurarPanelFinanciero().execute({ dias_baja: 30, version: 7 }, ctxEmpresa(E)),
        )
        const recalculadas = await bajasPorMes([E], ['2026-11'], AHORA)
        const otra = recalculadas.get(E)![0]!
        assert.deepInclude(otra, { bajas: 2, retiros: 1, suspendidos: 1, dias_baja: 20 })

        // reporte exportable: una fila por mes con la tasa (término técnico en la columna)
        const reporte = await reporteBajas(
            { desde: '2026-10-01', hasta: '2026-11-21' },
            { empresas: [E], consolidado: false },
            AHORA,
        )
        assert.deepEqual(
            reporte.filas.map((f) => [f.periodo, f.bajas]),
            [
                ['2026-10', 1],
                ['2026-11', 2],
            ],
        )
        assert.equal(reporte.columnas.find((c) => c.clave === 'tasa')!.titulo, 'Tasa de bajas (churn) %')
    })

    test('efectivo disponible desde el libro y alertas de cierre e integridad', async ({
        assert,
        client,
    }) => {
        const E = await crearEmpresaFila()
        const ctx = ctxEmpresa(E)
        const asiento = (fecha: string, cuenta: string, monto: string) =>
            new RegistrarAsiento().execute(
                {
                    empresa_id: E,
                    fecha,
                    descripcion: 'Prueba del panel',
                    origen_tipo: 'ajuste',
                    movimientos: [
                        { cuenta, debe: monto },
                        { cuenta: '5.2.99', haber: monto },
                    ],
                },
                ctx,
            )
        // subcuentas propias de la empresa: una caja y una cuenta bancaria
        const padre = await db.from('ledger.cuentas').where('codigo', '1.1.01').select('id').firstOrFail()
        const codigoCaja = `1.1.01.${await unicoBd('p', 'ledger.cuentas')}`
        await db.table('ledger.cuentas').insert({
            codigo: codigoCaja,
            nombre: unico('Caja'),
            tipo: 'activo',
            padre_id: padre.id,
            empresa_id: E,
        })
        const banco = await cuentaBancariaPrueba('Banrural', E)
        await asiento('2026-10-15', codigoCaja, '500.00')
        await asiento('2026-11-02', banco.cuenta_codigo, '1000.00')
        await afirmarLibroCuadrado(assert)

        const panel = await panelFinanciero({
            empresas: [E],
            consolidado: false,
            secciones: new Set(['efectivo']),
            ahora: AHORA,
        })
        assert.deepInclude(panel.empresas[0]!.efectivo!.datos!, {
            cajas: '500.00',
            bancos: '1000.00',
            total: '1500.00',
        })

        await db.table('audit.outbox').insert({
            evento: 'libro.integridad_rota',
            payload: JSON.stringify({ empresa_id: E, sello: 3, asiento_id: 9, esperado: 'a', obtenido: 'b' }),
        })
        const alertas = await alertasPanel({
            empresas: [E],
            permisos: new Set(['libro.ver', 'fiscal.ver']),
            ahora: AHORA,
        })
        const e = alertas.empresas[0]!
        const tipos = e.alertas.map((a) => a.tipo)
        assert.includeMembers(tipos, ['integridad_libro', 'cierres_pendientes'])
        assert.deepEqual(e.alertas.find((a) => a.tipo === 'cierres_pendientes')!.datos.meses, ['2026-10'])
        // sin localización fiscal: las revisiones fiscales van como error, nunca como «sin alertas»
        assert.includeMembers(
            e.errores.map((x) => x.tipo),
            ['vencimientos_fiscales', 'limite_pequeno_contribuyente'],
        )

        const { token } = await usuarioConRoles(['admin'])
        const r = await estado(
            client
                .get('/api/v1/panel-financiero/alertas')
                .header('X-Empresa-Id', String(E))
                .bearerToken(token),
            200,
        )
        assert.includeMembers(r.body().revisados, ['integridad_libro', 'limite_pequeno_contribuyente'])
    })

    test('límite del pequeño contribuyente: 80 % y 95 % de fábrica (gt-2026.5)', async ({ assert }) => {
        const E = await crearEmpresaFila({ pais: 'GT' })
        await db.transaction((trx) =>
            instalarPaquete(trx, paqueteDePais('GT'), E, { instaladaPor: null, hoy: '2026-11-21' }),
        )
        const datos = await datosFiscales(E, undefined)
        assert.deepEqual(resolver(datos.filas, 'pc_alertas', '2026-11-21')?.valor, [
            '80.00',
            '95.00',
            '100.00',
        ])
        // lo que ya pasó no cambia: antes del 21 nov seguía 80 y 100
        assert.deepEqual(resolver(datos.filas, 'pc_alertas', '2026-11-20')?.valor, ['80.00', '100.00'])
    })

    test('consolidado: solo con alcance global y con total por sección', async ({ assert, client }) => {
        const A = await crearEmpresaFila()
        const B = await crearEmpresaFila()
        const plan = await crearPlanFila({ precio: '200.00' })
        await servicio(A, { plan_id: plan, estado: 'activo' })
        await servicio(B, { plan_id: plan, estado: 'activo' })
        await servicio(B, { plan_id: plan, estado: 'limitado' })
        const { token } = await usuarioConRoles(['admin'])
        const r = await estado(
            client.get('/api/v1/panel-financiero').qs({ empresas: 'todas' }).bearerToken(token),
            200,
        )
        const ids = r.body().empresas.map((e: { empresa_id: number }) => e.empresa_id)
        assert.includeMembers(ids, [A, B])
        assert.equal(r.body().total.ingresos.estado, 'ok')
        const suma = r
            .body()
            .empresas.reduce(
                (n: number, e: { ingresos: { datos: { servicios: number } } }) =>
                    n + e.ingresos.datos.servicios,
                0,
            )
        assert.equal(r.body().total.ingresos.datos.servicios, suma)

        const acotado = await usuarioConRoles(['contabilidad'])
        await db.from('core.usuarios').where('id', acotado.usuario.id).update({ alcance_global: false })
        await db.table('core.usuarios_empresas').insert({ usuario_id: acotado.usuario.id, empresa_id: A })
        await estado(
            client.get('/api/v1/panel-financiero').qs({ empresas: 'todas' }).bearerToken(acotado.token),
            403,
        )
        const propia = await estado(client.get('/api/v1/panel-financiero').bearerToken(acotado.token), 200)
        assert.deepEqual(
            propia.body().empresas.map((e: { empresa_id: number }) => e.empresa_id),
            [A],
        )
        assert.equal(propia.body().empresas[0].ingresos.datos.mrr, '200.00')
    })
})
