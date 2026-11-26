import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, soloEmpresaPrincipal, usuarioConRoles } from '#tests/ayudas'
import { prepararEmpresas, servicioFacturado, type Empresas } from '#tests/contabilidad/ayudas_contabilidad'
import { crearClienteFila, crearEmpresaFila } from '#tests/core/fabricas'
import { carteraVencida } from '#billing/reportes/reportes'
import { hoyGuatemala } from '#ledger/fechas'

/**
 * `GET /contabilidad/inicio` (plan de contabilidad, lote B2): multiempresa, permisos, alcance y
 * «sin datos». Cada prueba usa empresas nuevas para que lo medido sea solo lo que arma la prueba.
 */

const ruta = '/api/v1/contabilidad/inicio'

async function leer(client: any, token: string, empresa: number, extra = '') {
    const r = await estado(
        client
            .get(ruta + extra)
            .bearerToken(token)
            .header('X-Empresa-Id', String(empresa)),
        200,
    )
    return r.body()
}

async function comprobantePendiente(e: Empresas, empresa: number, monto = '100.00') {
    const clienteId = await crearClienteFila()
    await db.table('billing.comprobantes').insert({
        archivo: 'x/y.png',
        archivo_tipo: 'image/png',
        archivo_tamano: 10,
        cliente_id: clienteId,
        metodo: 'deposito',
        cuenta_bancaria_id: e.cuentas.get(empresa)!,
        referencia: `ref-${Math.random().toString(36).slice(2)}`,
        monto,
        fecha_deposito: hoyGuatemala(),
        canal: 'panel',
        empresa_id: empresa,
    })
}

test.group('contabilidad · inicio', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('exige contabilidad.ver_inicio: el cajero recibe 403 y contabilidad 200', async ({ client }) => {
        const e = await prepararEmpresas()
        const { token: cajero } = await usuarioConRoles(['cajero'])
        await estado(client.get(ruta).bearerToken(cajero).header('X-Empresa-Id', String(e.B)), 403)
        const { token } = await usuarioConRoles(['contabilidad'])
        await leer(client, token, e.B)
    })

    test('empresa sin datos: lo dice (sin_datos), no inventa ceros, y no hay tareas', async ({
        client,
        assert,
    }) => {
        const vacia = await crearEmpresaFila()
        const { token } = await usuarioConRoles(['admin'])
        const cuerpo = await leer(client, token, vacia)
        assert.deepEqual(
            cuerpo.empresas.map((x: { id: number }) => x.id),
            [vacia],
        )
        assert.equal(cuerpo.pendientes, 0)
        assert.deepEqual(cuerpo.tareas, [])
        assert.deepEqual(cuerpo.tareas_con_error, [])
        assert.equal(cuerpo.pasos.length, 7)
        for (const clave of ['te_deben', 'debes_proveedores', 'dinero_disponible', 'impuestos_mes']) {
            assert.equal(cuerpo.indicadores[clave].estado, 'sin_datos', clave)
            assert.isNull(cuerpo.indicadores[clave].valor, clave)
        }
        const porClave = Object.fromEntries(cuerpo.pasos.map((p: { clave: string }) => [p.clave, p]))
        assert.equal(porClave.facturar.estado, 'sin_datos')
        assert.equal(porClave.cobrar_y_cerrar_cajas.estado, 'sin_datos')
        assert.equal(porClave.conciliar_bancos.estado, 'sin_datos')
        assert.equal(porClave.declarar_impuestos.estado, 'sin_datos')
        assert.equal(porClave.cerrar_el_mes.estado, 'pendiente')
        assert.equal(cuerpo.paso_actual, porClave.revisar_el_mes.estado === 'pendiente' ? 5 : 7)
    })

    test('Te deben es el mismo número que la cartera por antigüedad, y no mezcla empresas', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresas()
        await servicioFacturado(e.B, '2026-10-01', { precio: '150.00' })
        await servicioFacturado(e.C, '2026-10-01', { precio: '300.00' })
        const { token } = await usuarioConRoles(['admin'])
        const b = await leer(client, token, e.B)
        const c = await leer(client, token, e.C)

        for (const [empresa, cuerpo] of [
            [e.B, b],
            [e.C, c],
        ] as const) {
            const cartera = await carteraVencida({}, undefined, { empresas: [empresa], consolidado: false })
            assert.equal(cuerpo.indicadores.te_deben.valor, cartera.totales.total)
            assert.equal(cuerpo.indicadores.te_deben.cantidad, cartera.totales.facturas)
            assert.notEqual(cuerpo.indicadores.te_deben.estado, 'sin_datos')
        }
        assert.notEqual(b.indicadores.te_deben.valor, c.indicadores.te_deben.valor)
        // el mes de la factura (octubre) no es el del reloj: facturar sigue pendiente o listo, nunca error
        assert.notEqual(b.pasos[0].estado, 'error')
    })

    test('tareas: solo las del rol, con su conteo y por empresa', async ({ client, assert }) => {
        const e = await prepararEmpresas()
        await comprobantePendiente(e, e.B)
        await comprobantePendiente(e, e.B, '55.00')
        await comprobantePendiente(e, e.C)
        const { token: admin } = await usuarioConRoles(['admin'])
        const b = await leer(client, admin, e.B)
        const tarea = b.tareas.find((t: { clave: string }) => t.clave === 'comprobantes_por_revisar')
        assert.equal(tarea.cantidad, 2)
        assert.equal(tarea.monto, '155.00')
        assert.equal(tarea.urgencia, 'alta')
        assert.equal(tarea.permiso, 'comprobantes.aprobar')
        assert.isAtLeast(b.pendientes, 2)
        const c = await leer(client, admin, e.C)
        assert.equal(
            c.tareas.find((t: { clave: string }) => t.clave === 'comprobantes_por_revisar').cantidad,
            1,
        )

        // la caja abierta en esta empresa es de hoy: no es un turno de días anteriores
        assert.isUndefined(b.tareas.find((t: { clave: string }) => t.clave === 'turnos_abiertos_anteriores'))
    })

    test('sin el permiso de un dato, el indicador dice sin_permiso y la tarea no aparece', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresas()
        await comprobantePendiente(e, e.B)
        const { usuario, token } = await usuarioConRoles([])
        const [rol] = (await db
            .table('core.roles')
            .insert({ nombre: `solo-inicio-${usuario.id}`, descripcion: 'prueba' })
            .returning('id')) as Array<{ id: number }>
        const permisos = (await db
            .from('core.permisos')
            .whereIn('nombre', ['contabilidad.ver_inicio', 'libro.ver'])
            .select('id')) as Array<{ id: number }>
        assert.lengthOf(permisos, 2)
        await db
            .table('core.roles_permisos')
            .insert(permisos.map((p) => ({ role_id: rol!.id, permiso_id: p.id })))
        await db.table('core.usuarios_roles').insert({ usuario_id: usuario.id, role_id: rol!.id })
        const cuerpo = await leer(client, token, e.B)
        assert.equal(cuerpo.indicadores.te_deben.estado, 'sin_permiso')
        assert.equal(cuerpo.indicadores.te_deben.permiso, 'reportes.ver')
        assert.isNull(cuerpo.indicadores.te_deben.valor)
        assert.equal(cuerpo.indicadores.impuestos_mes.estado, 'sin_permiso')
        assert.notEqual(cuerpo.indicadores.dinero_disponible.estado, 'sin_permiso')
        assert.deepEqual(cuerpo.tareas, [])
    })

    test('consolidado: empresas=todas suma las empresas; un periodo futuro es el actual', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresas()
        await comprobantePendiente(e, e.B)
        await comprobantePendiente(e, e.C)
        const { token } = await usuarioConRoles(['admin'])
        const r = await estado(client.get(`${ruta}?empresas=todas&periodo=2099-01`).bearerToken(token), 200)
        const cuerpo = r.body()
        assert.isTrue(cuerpo.consolidado)
        assert.equal(cuerpo.periodo, hoyGuatemala().slice(0, 7))
        assert.includeMembers(
            cuerpo.empresas.map((x: { id: number }) => x.id),
            [e.B, e.C],
        )
        assert.isAtLeast(
            cuerpo.tareas.find((t: { clave: string }) => t.clave === 'comprobantes_por_revisar').cantidad,
            2,
        )
    })
})
