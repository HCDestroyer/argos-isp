import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { unicoBd } from '#tests/billing/ayudas_billing'
import { contextoPrueba, estado, soloEmpresaPrincipal, unico, usuarioConRoles } from '#tests/ayudas'
import { cifrar } from '#shared/cifrado'
import { dec } from '#ledger/dinero'
import { errorDe, servicioEn } from '#tests/contabilidad/ayudas_contabilidad'
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'
import { haceMeses, proveedorEn } from '#tests/ledger/ayudas_compras'
import { afirmarCuadre, bodegaEn, productoEn } from '#tests/inventario/ayudas_inventario'
import { ConsumidorInventario } from '#inventario/consumidor'
import RegistrarCompra from '#ledger/actions/registrar_compra'
import AsignarComodato from '#inventario/actions/asignar_comodato'
import SolicitarOrdenRetiro from '#inventario/actions/solicitar_orden_retiro'
import GenerarTokenIris from '#core/actions/generar_token_iris'
import { usuarioIris } from '#core/integraciones_iris'
import type { ContextoAccion } from '#shared/contexto'

/**
 * «Crear orden de retiro (Iris)» en Inventario › Por recuperar (decisión 17 del PM): la unidad por
 * recuperar vuelve a emitir `inventario.equipo_por_recuperar`, el webhook con que Argos pide la orden
 * de retiro a Iris (`contratos/iris.md` §2.3). Solo con el conector de Iris activo y la empresa en su
 * alcance; la unidad y el libro no cambian.
 */

async function conectorIris(activo = true) {
    await db.from('integraciones.iris_conector').delete()
    await db.table('integraciones.iris_conector').insert({
        id: 1,
        activo,
        url_base: 'http://iris.prueba',
        token_cifrado: cifrar(`iris_pat_${'Zx9Yw8Vu'.repeat(5)}`),
        webhook_salida_url: 'http://iris.prueba/api/v1/integraciones/argosisp/webhook/c-1',
        webhook_salida_secreto_cifrado: cifrar('secreto-del-receptor-de-iris-0123456789'),
        contrato: '0.14.3',
    })
}

/** Usuario técnico «Iris» con alcance global o solo `empresas`. */
async function usuarioTecnicoIris(empresas: number[] | null) {
    let id = await usuarioIris()
    if (id === null) {
        await new GenerarTokenIris().execute({}, contextoPrueba())
        id = (await usuarioIris())!
    }
    await db
        .from('core.usuarios')
        .where('id', id)
        .update({ activo: true, alcance_global: empresas === null })
    await db.from('core.usuarios_empresas').where('usuario_id', id).delete()
    for (const empresaId of empresas ?? []) {
        await db.table('core.usuarios_empresas').insert({ usuario_id: id, empresa_id: empresaId })
    }
}

/** Servicio retirado con dos ONU que quedaron por recuperar (como lo deja el retiro). */
async function equiposPorRecuperar(empresaId: number, ctx: ContextoAccion) {
    const onu = await productoEn(empresaId, ctx, { tipo: 'equipo', seguimiento: 'serie' })
    const bodega = await bodegaEn(empresaId, ctx)
    const proveedor = await proveedorEn(empresaId, ctx)
    const series = [await unicoBd('S'), await unicoBd('S')]
    const compra = await new RegistrarCompra().execute(
        {
            proveedor_id: proveedor.id,
            tipo_documento: 'FACT',
            numero: await unicoBd('F'),
            fecha_documento: haceMeses(0),
            condicion: 'credito',
            lineas: [
                {
                    descripcion: 'ONU GPON',
                    tipo: 'bien',
                    total: dec('336').times(series.length).toFixed(2),
                    cantidad: series.length,
                    producto_id: onu.id,
                    bodega_id: bodega.id,
                    unidades: series.map((serie) => ({ serie })),
                },
            ],
        },
        ctx,
    )
    const [a, b] = (await db
        .from('inventario.unidades')
        .where('compra_id', compra.id)
        .orderBy('id')
        .select('id')) as Array<{ id: number }>
    const { servicioId } = await servicioEn(empresaId)
    await new AsignarComodato().execute({ servicio_id: servicioId, unidad_id: a!.id }, ctx)
    await new AsignarComodato().execute({ servicio_id: servicioId, unidad_id: b!.id }, ctx)
    await db.from('core.servicios').where('id', servicioId).update({ estado: 'retirado' })
    await new ConsumidorInventario().procesar({
        id: unico('ev'),
        evento: 'servicio.estado_cambiado',
        payload: {
            servicio_id: servicioId,
            empresa_id: empresaId,
            de: 'suspendido',
            a: 'retirado',
            motivo: 'baja',
        },
    })
    return { servicioId, a: a!.id, b: b!.id }
}

async function eventosRetiro(unidadId: number) {
    return db
        .from('audit.outbox')
        .where('evento', 'inventario.equipo_por_recuperar')
        .whereRaw(`payload->>'unidad_id' = ?`, [String(unidadId)])
        .orderBy('id', 'asc')
}

test.group('Inventario · orden de retiro a mano (decisión 17)', (group) => {
    group.each.timeout(90_000)
    group.each.teardown(async () => {
        await db.from('integraciones.iris_conector').delete()
        await soloEmpresaPrincipal()
    })

    test('vuelve a pedir la orden a Iris con el mismo payload; la unidad y el libro no cambian', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const { servicioId, a } = await equiposPorRecuperar(e.B, e.ctx)
        const antes = await eventosRetiro(a)
        assert.lengthOf(antes, 1, 'el retiro ya la pidió una vez')
        const unidadAntes = await db.from('inventario.unidades').where('id', a).first()

        // sin conector: 422 iris_no_conectado, y queda auditado el error
        await db.from('integraciones.iris_conector').delete()
        const sinIris = await errorDe(
            new SolicitarOrdenRetiro().execute({ servicio_id: servicioId, unidad_id: a }, e.ctx),
        )
        assert.deepInclude(sinIris, { status: 422, codigo: 'iris_no_conectado' })

        // conector activo pero la empresa fuera del alcance del usuario técnico: tampoco saldría
        await conectorIris()
        await usuarioTecnicoIris([e.C])
        const fuera = await errorDe(
            new SolicitarOrdenRetiro().execute({ servicio_id: servicioId, unidad_id: a }, e.ctx),
        )
        assert.equal(fuera.codigo, 'iris_no_conectado')
        assert.lengthOf(await eventosRetiro(a), 1)

        await usuarioTecnicoIris([e.B])
        const ctx = { ...e.ctx, requestId: unico('req') }
        const r = await new SolicitarOrdenRetiro().execute({ servicio_id: servicioId, unidad_id: a }, ctx)
        assert.deepInclude(r, {
            unidad_id: a,
            servicio_id: servicioId,
            empresa_id: e.B,
            evento: 'inventario.equipo_por_recuperar',
        })
        const despues = await eventosRetiro(a)
        assert.lengthOf(despues, 2)
        assert.deepEqual(despues[1].payload, antes[0].payload, 'mismo payload que el del retiro')
        const unidad = await db.from('inventario.unidades').where('id', a).first()
        assert.equal(unidad.estado, 'por_recuperar')
        assert.equal(unidad.version, unidadAntes.version)
        const auditoria = await db
            .from('audit.acciones')
            .where({ accion: 'inventario.solicitar_orden_retiro', request_id: ctx.requestId })
            .first()
        assert.equal(auditoria.resultado, 'ok')
        assert.equal(Number(auditoria.empresa_id), e.B)
        await afirmarCuadre(assert, e.B)
    })

    test('ruta: permiso propio, 409 si la unidad no está por recuperar en ese servicio, 202 con Iris', async ({
        assert,
        client,
    }) => {
        const e = await prepararEmpresasGt()
        const { servicioId, a, b } = await equiposPorRecuperar(e.B, e.ctx)
        await conectorIris()
        await usuarioTecnicoIris(null)
        const ruta = (servicio: number, unidad: number) =>
            `/api/v1/servicios/${servicio}/equipos/${unidad}/orden-retiro`

        const lectura = await usuarioConRoles(['lectura'])
        await estado(
            client.post(ruta(servicioId, a)).header('X-Empresa-Id', String(e.B)).bearerToken(lectura.token),
            403,
        )

        const tecnico = await usuarioConRoles(['tecnico'])
        // otro servicio: 409 (la unidad no está por recuperar en él)
        const { servicioId: otro } = await servicioEn(e.B)
        const conflicto = await estado(
            client.post(ruta(otro, a)).header('X-Empresa-Id', String(e.B)).bearerToken(tecnico.token),
            409,
        )
        assert.include(conflicto.body().type, 'unidad_no_por_recuperar')

        // recibida de vuelta (en comodato otra vez): 409
        await db.from('inventario.unidades').where('id', b).update({ estado: 'en_comodato' })
        await estado(
            client.post(ruta(servicioId, b)).header('X-Empresa-Id', String(e.B)).bearerToken(tecnico.token),
            409,
        )

        const ok = await estado(
            client
                .post(ruta(servicioId, a))
                .header('X-Empresa-Id', String(e.B))
                .header('Idempotency-Key', unico('idem'))
                .bearerToken(tecnico.token),
            202,
        )
        assert.equal(ok.body().unidad_id, a)
        assert.lengthOf(await eventosRetiro(a), 2)

        // conector apagado: 422
        await db.from('integraciones.iris_conector').update({ activo: false })
        const apagado = await estado(
            client.post(ruta(servicioId, a)).header('X-Empresa-Id', String(e.B)).bearerToken(tecnico.token),
            422,
        )
        assert.include(apagado.body().type, 'iris_no_conectado')
    })
})
