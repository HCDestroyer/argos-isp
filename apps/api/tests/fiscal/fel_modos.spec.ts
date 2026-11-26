import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, soloEmpresaPrincipal } from '#tests/ayudas'
import { crearClienteFila, crearEscenarioRouter, crearServicioFila } from '#tests/core/fabricas'
import RegistrarPago from '#billing/actions/registrar_pago'
import CrearPlantilla from '#billing/actions/crear_plantilla'
import EmitirCargoUnico from '#billing/actions/emitir_cargo_unico'
import SolicitarCertificacion from '#fiscal/actions/solicitar_certificacion'
import ReintentarDte from '#fiscal/actions/reintentar_dte'
import { configuracionFel } from '#fiscal/fel/configuracion'
import { controlFelFalso } from '#fiscal/fel/falso'
import MigracionEmitirAPagar from '#database/migrations/1795643505803_alter_certificar_al_emitir_a_pagar_table'
import { errorDe, sacarDeLaColaFel, servicioEn } from '#tests/contabilidad/ayudas_contabilidad'
import { cola, configurarModo, datosNit, dtesDe, empresasFel, servicioFel } from '#tests/fiscal/ayudas_fel'

/**
 * Modos FEL que se cumplen y se ven (`contratos/fel-establecimientos.md` lote 3, R2) con la decisión
 * del PM del 25-nov-2026: **primero se cobra y después se certifica**. La factura dice qué le toca
 * (`fel_modo`, `fel_accion`); con la FEL desactivada no entra nada nuevo a la cola (409
 * `fel_desactivada`); `emitir` ya no se acepta (422 `certificar_al_obsoleto`) y `nunca` no existe con
 * FEL obligatoria por ningún camino.
 */

async function verFactura(client: any, token: string, id: number) {
    const r = await estado(client.get(`/api/v1/facturas/${id}`).bearerToken(token), 200)
    return r.body()
}

test.group('FEL · modos y «primero se cobra»', (group) => {
    group.each.teardown(async () => {
        await sacarDeLaColaFel()
        await soloEmpresaPrincipal()
    })

    test('desactivada: 409 al certificar y al reintentar; la cola no crea nada; fel_accion ninguna', async ({
        client,
        assert,
    }) => {
        const e = await empresasFel('opcional')
        const s = await servicioFel(e, 'nunca', '150.00', await crearClienteFila(datosNit()))
        const f = s.facturas[0]!
        // un DTE rechazado de cuando estaba activa
        controlFelFalso.siguiente.push('rechazado')
        await new SolicitarCertificacion().execute({ factura_id: f.id }, e.ctx)
        await cola(e)
        const [rechazado] = await dtesDe('factura', f.id)
        assert.equal(rechazado!.estado, 'rechazado')

        await configurarModo(e, e.B, 'desactivada')
        const r = await estado(
            client
                .post(`/api/v1/facturas/${f.id}/certificar`)
                .bearerToken(e.token)
                .header('X-Empresa-Id', String(e.B)),
            409,
        )
        assert.isTrue(String(r.body().type).endsWith('fel_desactivada'))
        const reintento = await errorDe(new ReintentarDte().execute({ dte_id: rechazado!.id }, e.ctx))
        assert.equal(reintento.status, 409)
        assert.equal(reintento.codigo, 'fel_desactivada')
        assert.lengthOf(await dtesDe('factura', f.id), 1)

        const lote = await estado(
            client
                .post('/api/v1/fel/lotes')
                .bearerToken(e.token)
                .header('X-Empresa-Id', String(e.B))
                .json({ facturas: [f.id] }),
            200,
        )
        assert.equal(lote.body().errores[0].tipo, 'fel_desactivada')
        const corrida = await cola(e)
        assert.equal(corrida.solicitados, 0)

        const vista = await verFactura(client, e.token, f.id)
        assert.include(vista, { fel_modo: 'desactivada', fel_accion: 'ninguna' })
    })

    test('aviso sin DTE; pago parcial sin DTE; pago completo con DTE (opcional y obligatoria)', async ({
        client,
        assert,
    }) => {
        const e = await empresasFel('opcional')
        await configurarModo(e, e.C, 'obligatoria')
        for (const empresaId of [e.B, e.C]) {
            const s = await servicioFel(e, 'pagar', '150.00', await crearClienteFila(datosNit()), empresaId)
            const f = s.facturas[0]!
            await cola(e)
            assert.lengthOf(await dtesDe('factura', f.id), 0, 'el aviso nace sin DTE')
            assert.include(await verFactura(client, e.token, f.id), {
                fel_accion: 'al_cobrar',
                aviso_cobro: true,
            })

            await new RegistrarPago().execute(
                { cliente_id: s.clienteId, metodo: 'caja', monto: '100.00', empresa_id: empresaId },
                e.ctx,
            )
            await cola(e)
            assert.lengthOf(await dtesDe('factura', f.id), 0, 'pago parcial: sin DTE')
            assert.include(await verFactura(client, e.token, f.id), { fel_accion: 'al_cobrar' })

            await new RegistrarPago().execute(
                { cliente_id: s.clienteId, metodo: 'caja', monto: '50.00', empresa_id: empresaId },
                e.ctx,
            )
            await cola(e)
            const [dte] = await dtesDe('factura', f.id)
            assert.equal(dte!.estado, 'certificado', `cubierta: DTE (empresa ${empresaId})`)
            assert.include(await verFactura(client, e.token, f.id), { fel_accion: 'ninguna' })
        }
    })

    test('opcional + nunca: al cobrar, luego «Certificar (opcional)»; sin credenciales 422 (no 409)', async ({
        client,
        assert,
    }) => {
        const e = await empresasFel('opcional')
        const s = await servicioFel(e, 'nunca', '150.00', await crearClienteFila(datosNit()))
        const f = s.facturas[0]!
        assert.include(await verFactura(client, e.token, f.id), {
            fel_modo: 'opcional',
            fel_accion: 'al_cobrar',
        })
        await new RegistrarPago().execute(
            { cliente_id: s.clienteId, metodo: 'caja', monto: '150.00', empresa_id: e.B },
            e.ctx,
        )
        assert.include(await verFactura(client, e.token, f.id), { fel_accion: 'certificar_opcional' })
        const pedido = await new SolicitarCertificacion().execute({ factura_id: f.id }, e.ctx)
        assert.isTrue(pedido.creado)
        assert.include(await verFactura(client, e.token, f.id), { fel_accion: 'automatica' })

        // sin credenciales del ambiente: falta configurar (422), no «desactivada» (409)
        await db.from('fiscal.fel_credenciales').where('empresa_id', e.C).delete()
        await configurarModo(e, e.C, 'opcional')
        const otra = await servicioFel(e, 'nunca', '150.00', await crearClienteFila(datosNit()), e.C)
        const sinCred = await errorDe(
            new SolicitarCertificacion().execute({ factura_id: otra.facturas[0]!.id }, e.ctx),
        )
        assert.equal(sinCred.status, 422)
        assert.equal(sinCred.codigo, 'fel_no_configurada')
    })

    test('emitir ya no se acepta: 422 certificar_al_obsoleto en plantilla y excepción; el cargo único nace aviso', async ({
        client,
        assert,
    }) => {
        const e = await empresasFel('obligatoria')
        const crear = await errorDe(
            new CrearPlantilla().execute(
                { nombre: `Emitir ${Date.now()}`, ciclo: 'aniversario', certificar_al: 'emitir' },
                e.ctx,
            ),
        )
        assert.equal(crear.codigo, 'certificar_al_obsoleto')
        const plantilla = await new CrearPlantilla().execute(
            { nombre: `Pagar ${Date.now()}`, ciclo: 'aniversario' },
            e.ctx,
        )
        assert.equal(plantilla.certificar_al, 'pagar')
        const editar = await estado(
            client
                .put(`/api/v1/plantillas-facturacion/${plantilla.id}`)
                .bearerToken(e.token)
                .json({ version: plantilla.version, certificar_al: 'emitir' }),
            422,
        )
        assert.equal(editar.body().errors[0].rule, 'certificar_al_obsoleto')

        // cargo único sin servicio: aviso de cobro, sin DTE antes de pagar
        const clienteId = await crearClienteFila(datosNit())
        const visita = (await db
            .from('billing.conceptos_cargo')
            .where({ empresa_id: e.B, nombre: 'Visita técnica' })
            .select('id')
            .firstOrFail()) as { id: number }
        const cargo = await new EmitirCargoUnico().execute(
            {
                empresa_id: e.B,
                cliente_id: clienteId,
                lineas: [{ concepto_id: Number(visita.id), precio_unitario: '112.00' }],
            },
            e.ctx,
        )
        const facturaId = Number(
            (cargo as { factura_id?: number; id?: number }).factura_id ?? (cargo as { id: number }).id,
        )
        await cola(e)
        assert.lengthOf(await dtesDe('factura', facturaId), 0)
        assert.include(await verFactura(client, e.token, facturaId), {
            aviso_cobro: true,
            fel_accion: 'al_cobrar',
        })
    })

    test('obligatoria: nunca no entra por la plantilla, la excepción ni la asignación; en opcional sí', async ({
        client,
        assert,
    }) => {
        const e = await empresasFel('obligatoria')
        const conServicio = await servicioEn(e.B, { plantilla: { certificar_al: 'pagar' } })
        const plantilla = (await db
            .from('billing.plantillas_facturacion')
            .where('id', conServicio.plantillaId)
            .firstOrFail()) as { id: number; version: number }
        const r = await estado(
            client
                .put(`/api/v1/plantillas-facturacion/${plantilla.id}`)
                .bearerToken(e.token)
                .json({ version: plantilla.version, certificar_al: 'nunca' }),
            422,
        )
        assert.equal(r.body().errors[0].rule, 'certificar_al_incompatible')
        assert.include(r.body().detail, String(conServicio.servicioId))

        // la misma plantilla con servicios de una empresa opcional sí admite nunca
        const enOpcional = await servicioEn(e.C, { plantilla: { certificar_al: 'pagar' } })
        await configurarModo(e, e.C, 'opcional')
        const p2 = (await db
            .from('billing.plantillas_facturacion')
            .where('id', enOpcional.plantillaId)
            .firstOrFail()) as { id: number; version: number }
        await estado(
            client
                .put(`/api/v1/plantillas-facturacion/${p2.id}`)
                .bearerToken(e.token)
                .json({ version: p2.version, certificar_al: 'nunca' }),
            200,
        )

        // excepción nunca en un servicio de la empresa obligatoria
        // un servicio con router completo (redes y pools), editable por PUT /servicios/:id
        const { routerId } = await crearEscenarioRouter()
        const editable = await crearServicioFila({
            cliente_id: conServicio.clienteId,
            router_id: routerId,
            plan_id: conServicio.planId,
            plantilla_facturacion_id: conServicio.plantillaId,
            empresa_id: e.B,
        })
        const servicio = await estado(client.get(`/api/v1/servicios/${editable}`).bearerToken(e.token), 200)
        const excepcion = await estado(
            client
                .put(`/api/v1/servicios/${editable}`)
                .bearerToken(e.token)
                .json({ version: servicio.body().version, excepciones: { certificar_al: 'nunca' } }),
            422,
        )
        assert.equal(
            excepcion.body().errors?.[0]?.rule,
            'certificar_al_incompatible',
            JSON.stringify(excepcion.body()),
        )

        // asignar la plantilla «nunca» a un servicio de la obligatoria
        const asignar = await estado(
            client
                .put(`/api/v1/servicios/${editable}`)
                .bearerToken(e.token)
                .json({ version: servicio.body().version, plantilla_facturacion_id: p2.id }),
            422,
        )
        assert.equal(asignar.body().errors[0].rule, 'certificar_al_incompatible')
        const actual = await configuracionFel(e.B)
        assert.equal(actual.modo, 'obligatoria')
    })

    test('migración: plantillas y excepciones con emitir pasan a pagar con su diff en audit.cambios', async ({
        assert,
    }) => {
        const { plantillaId, servicioId } = await servicioEn(1, { plantilla: { certificar_al: 'emitir' } })
        await db.table('core.servicios_excepciones').insert({
            servicio_id: servicioId,
            campo: 'certificar_al',
            valor: JSON.stringify('emitir'),
        })
        await new MigracionEmitirAPagar(db.connection(), 'emitir_a_pagar', false).execUp()
        const plantilla = await db
            .from('billing.plantillas_facturacion')
            .where('id', plantillaId)
            .firstOrFail()
        assert.equal(plantilla.certificar_al, 'pagar')
        const excepcion = await db
            .from('core.servicios_excepciones')
            .where({ servicio_id: servicioId, campo: 'certificar_al' })
            .firstOrFail()
        assert.equal(excepcion.valor, 'pagar')
        const cambios = await db
            .from('audit.cambios')
            .where('request_id', 'migracion:certificar_al_emitir_a_pagar')
            .whereIn('entidad_id', [plantillaId, servicioId])
            .select('entidad_tipo', 'campo', 'antes', 'despues')
        assert.sameDeepMembers(cambios, [
            {
                entidad_tipo: 'plantilla_facturacion',
                campo: 'certificar_al',
                antes: 'emitir',
                despues: 'pagar',
            },
            {
                entidad_tipo: 'servicio',
                campo: 'excepciones.certificar_al',
                antes: 'emitir',
                despues: 'pagar',
            },
        ])
    })
})
