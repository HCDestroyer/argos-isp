import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, soloEmpresaPrincipal, unico, usuarioConRoles } from '#tests/ayudas'
import { servicioEn } from '#tests/contabilidad/ayudas_contabilidad'
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'
import { afirmarCuadre, bodegaEn, productoEn } from '#tests/inventario/ayudas_inventario'
import { crearServicioFila } from '#tests/core/fabricas'
import CargarSaldoInicial from '#inventario/actions/cargar_saldo_inicial'
import type { ContextoAccion } from '#shared/contexto'

/**
 * `POST /servicios/:id/equipos` con `{ serie }` en lugar de `{ unidad_id }` (contrato Iris §3: la
 * orden de instalación trae la serie leída en campo; `Idempotency-Key = iris:comodato:<orden>:<serie>`).
 * La serie se busca sin distinguir mayúsculas en la empresa del servicio, también sobre un servicio
 * `pendiente_instalacion`.
 */

async function onuConSerie(empresaId: number, ctx: ContextoAccion, serie: string) {
    const producto = await productoEn(empresaId, ctx, { tipo: 'equipo', seguimiento: 'serie' })
    const bodega = await bodegaEn(empresaId, ctx)
    await new CargarSaldoInicial().execute(
        { producto_id: producto.id, bodega_id: bodega.id, unidad: { serie }, costo_total: '200.00' },
        ctx,
    )
    const unidad = await db
        .from('inventario.unidades')
        .where('empresa_id', empresaId)
        .whereRaw('serie = upper(?)', [serie])
        .select('id')
        .firstOrFail()
    return Number(unidad.id)
}

test.group('Inventario · comodato por serie', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('asignar con { serie } (sin distinguir mayúsculas) a un servicio pendiente; el reintento con la misma clave no duplica', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const cabecera = { 'X-Empresa-Id': String(e.B) }
        const serie = unico('zteg').toUpperCase()
        const unidadId = await onuConSerie(e.B, e.ctx, serie)
        const { clienteId } = await servicioEn(e.B)
        const servicioId = await crearServicioFila({
            cliente_id: clienteId,
            empresa_id: e.B,
            estado: 'pendiente_instalacion',
            instalado_en: null,
        })
        const tecnico = await usuarioConRoles(['tecnico'])
        const clave = `iris:comodato:${unico('orden')}:${serie}`
        const asignar = () =>
            client
                .post(`/api/v1/servicios/${servicioId}/equipos`)
                .bearerToken(tecnico.token)
                .headers(cabecera)
                .header('Idempotency-Key', clave)
                .json({ serie: `  ${serie.toLowerCase()} ` })

        const primera = await estado(asignar(), 201)
        assert.include(primera.body(), { id: unidadId, estado: 'en_comodato', servicio_id: servicioId })
        const segunda = await estado(asignar(), 201)
        assert.deepEqual(segunda.body(), primera.body())
        const eventos = await db
            .from('audit.outbox')
            .where('evento', 'inventario.comodato_asignado')
            .whereRaw(`payload->>'unidad_id' = ?`, [String(unidadId)])
        assert.lengthOf(eventos, 1)
        await afirmarCuadre(assert, e.B)
    })

    test('unidad_id o serie, exactamente uno (422); serie inexistente o de otra empresa (404)', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const serieB = unico('ZTEG').toUpperCase()
        const serieC = unico('ZTEG').toUpperCase()
        const unidadB = await onuConSerie(e.B, e.ctx, serieB)
        await onuConSerie(e.C, e.ctx, serieC)
        const { servicioId } = await servicioEn(e.B)
        const pedir = (cuerpo: Record<string, unknown>) =>
            client
                .post(`/api/v1/servicios/${servicioId}/equipos`)
                .bearerToken(e.token)
                .header('X-Empresa-Id', String(e.B))
                .header('Idempotency-Key', unico('c'))
                .json(cuerpo)

        const ambos = await estado(pedir({ unidad_id: unidadB, serie: serieB }), 422)
        assert.equal(ambos.body().errors[0].rule, 'unidad_o_serie')
        const ninguno = await estado(pedir({}), 422)
        assert.equal(ninguno.body().errors[0].field, 'unidad_id')
        await estado(pedir({ serie: 'NO-EXISTE-123' }), 404)
        // la serie de la empresa C no se presta a un servicio de B
        await estado(pedir({ serie: serieC }), 404)

        const unidad = await db.from('inventario.unidades').where('id', unidadB).firstOrFail()
        assert.equal(unidad.estado, 'disponible')
        await afirmarCuadre(assert, e.B)
    })
})
