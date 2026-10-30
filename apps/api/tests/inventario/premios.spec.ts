import { test } from '@japa/runner'
import { unicoBd } from '#tests/billing/ayudas_billing'
import db from '@adonisjs/lucid/services/db'
import { soloEmpresaPrincipal, unico } from '#tests/ayudas'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import { hoyGuatemala } from '#ledger/fechas'
import { errorDe, servicioEn } from '#tests/contabilidad/ayudas_contabilidad'
import { prepararEmpresasGt, type EmpresasGt } from '#tests/ledger/ayudas_bancos'
import { partidas } from '#tests/ledger/ayudas_compras'
import { programaConReglas } from '#tests/lealtad/ayudas_lealtad'
import {
    afirmarCuadre,
    bodegaEn,
    comprarInventario,
    productoEn,
    saldoInventario,
} from '#tests/inventario/ayudas_inventario'
import CargarSaldoInicial from '#inventario/actions/cargar_saldo_inicial'
import CrearSorteo from '#lealtad/actions/crear_sorteo'
import EditarSorteo from '#lealtad/actions/editar_sorteo'
import PublicarBasesSorteo from '#lealtad/actions/publicar_bases_sorteo'
import AbrirSorteo from '#lealtad/actions/abrir_sorteo'
import CerrarCorteSorteo from '#lealtad/actions/cerrar_corte_sorteo'
import MarcarRequisitoSorteo from '#lealtad/actions/marcar_requisito_sorteo'
import EjecutarSorteo from '#lealtad/actions/ejecutar_sorteo'
import EntregarPremioSorteo from '#lealtad/actions/entregar_premio_sorteo'
import AnularEntregaSorteo from '#lealtad/actions/anular_entrega_sorteo'
import { REQUISITOS_PARA_EJECUTAR } from '#lealtad/sorteos'

/**
 * Inventario interno, fase C: la salida «premio» del kardex (decisión del líder). Un bien del
 * inventario entregado como premio de un sorteo sale a su costo con `5.1.03 / 1.1.14`; anular la
 * entrega lo reingresa.
 */

const AYER = new Date(Date.now() - 24 * 3600 * 1000)
const MANANA = new Date(Date.now() + 24 * 3600 * 1000)

/** Sorteo ejecutado con dos premios en bienes (Q500 con ISR 10 % y Q20 sin ISR). */
async function sorteoConBienes(e: EmpresasGt) {
    await programaConReglas(e.B, e.ctx, { diferimiento: true })
    const creado = await new CrearSorteo().execute(
        {
            empresa_id: e.B,
            nombre: unico('Sorteo de inventario'),
            criterios: { boletos_por_servicio: 1, admite_canje: false },
            inscripcion_desde: hoyGuatemala(),
            corte_en: AYER,
            fecha_sorteo: MANANA,
            lugar: 'Oficinas centrales',
            suplentes: 0,
            premios: [
                { nombre: 'Router', valor: '500.00', tipo: 'bien', retiene_isr: true },
                { nombre: 'Cable', valor: '20.00', tipo: 'bien', retiene_isr: false },
            ],
        },
        e.ctx,
    )
    await new EditarSorteo().execute(
        {
            id: creado.id,
            version: creado.version,
            bases: {
                mecanica: 'Sorteo electrónico con argos-sorteo-v1 ante notario',
                regla_participacion: '1 boleto por cada servicio al día al corte',
                plazo_reclamo_dias: 30,
                no_reclamados: 'Pasan al suplente en orden',
                publicacion_resultados: 'Portal del ISP el mismo día',
                resolucion_gobernacion: 'GD-2026-078',
                fuente_valor_publico: 'Números del primer premio de la Lotería Santa Lucía',
            },
        },
        e.ctx,
    )
    await new PublicarBasesSorteo().execute({ id: creado.id }, e.ctx)
    await new MarcarRequisitoSorteo().execute(
        { sorteo_id: creado.id, clave: 'bases_diaco', estado: 'cumplido', evidencia: 'Prensa' },
        e.ctx,
    )
    await new AbrirSorteo().execute({ id: creado.id }, e.ctx)
    for (let i = 0; i < 3; i++) await servicioEn(e.B, { instalacion: '2026-10-01' })
    await new CerrarCorteSorteo().execute({ id: creado.id }, e.ctx)
    for (const clave of REQUISITOS_PARA_EJECUTAR) {
        await new MarcarRequisitoSorteo().execute(
            { sorteo_id: creado.id, clave, estado: 'cumplido', evidencia: `Ref. ${clave}` },
            e.ctx,
        )
    }
    const sorteo = await new EjecutarSorteo().execute(
        { id: creado.id, valor_publico: '31337', valor_publico_evidencia: 'acta del notario' },
        e.ctx,
    )
    return {
        sorteo,
        router: sorteo.ganadores.find((g) => g.premio_posicion === 1)!,
        cable: sorteo.ganadores.find((g) => g.premio_posicion === 2)!,
    }
}

test.group('Inventario · fase C · salida premio', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('premio de sorteo desde el inventario: 5.1.03 / 1.1.14 al costo de la unidad o al promedio; anular la entrega lo reingresa', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const bodega = await bodegaEn(e.B, e.ctx)
        const equipo = await productoEn(e.B, e.ctx, {
            nombre: 'Router',
            tipo: 'equipo',
            seguimiento: 'serie',
        })
        const material = await productoEn(e.B, e.ctx)
        const inicial = await new CargarSaldoInicial().execute(
            {
                producto_id: equipo.id,
                bodega_id: bodega.id,
                unidad: { serie: await unicoBd('PR') },
                costo_total: '275.00',
            },
            e.ctx,
        )
        await comprarInventario(e.B, e.ctx, {
            producto_id: material.id,
            bodega_id: bodega.id,
            cantidad: 3,
            total: '11.20',
        })
        const { sorteo, router, cable } = await sorteoConBienes(e)

        // sin producto: 422
        const sinProducto = await errorDe(
            new EntregarPremioSorteo().execute(
                { sorteo_id: sorteo.id, ganador_id: router.id, contrapartida: 'inventario' },
                e.ctx,
            ),
        )
        assert.equal(sinProducto.status, 422)

        await new EntregarPremioSorteo().execute(
            {
                sorteo_id: sorteo.id,
                ganador_id: router.id,
                contrapartida: 'inventario',
                producto_id: equipo.id,
                bodega_id: bodega.id,
                unidad_id: inicial.unidad_id!,
            },
            e.ctx,
        )
        const ganadorRouter = await db.from('lealtad.sorteos_ganadores').where('id', router.id).first()
        assert.equal(ganadorRouter.estado, 'entregado')
        assert.equal(ganadorRouter.contrapartida, 'inventario')
        const salida = await db
            .from('inventario.movimientos')
            .where('id', ganadorRouter.movimiento_inventario_id)
            .first()
        assert.equal(salida.tipo, 'premio')
        assert.equal(salida.costo_total, '-275.00')
        assert.equal(salida.origen_tipo, 'sorteo_ganador')
        assert.equal(Number(salida.origen_id), router.id)
        // el costo, no el valor declarado del premio
        assert.deepEqual(await partidas('inventario', Number(salida.id)), [
            [CUENTAS_GT.PREMIOS_PROMOCIONES, '275.00', '0.00', null],
            [CUENTAS_GT.INVENTARIOS, '0.00', '275.00', null],
        ])
        // el ISR del premio (10 % de 500) lo asume la empresa en el asiento del sorteo
        assert.deepEqual(await partidas('sorteo', router.id), [
            [CUENTAS_GT.PREMIOS_PROMOCIONES, '50.00', '0.00', null],
            [CUENTAS_GT.RETENCIONES_ISR_POR_PAGAR, '0.00', '50.00', null],
        ])
        const unidad = await db.from('inventario.unidades').where('id', inicial.unidad_id!).first()
        assert.equal(unidad.estado, 'entregada')
        assert.isNull(unidad.bodega_id)
        assert.deepEqual(await saldoInventario(equipo.id, bodega.id), ['0.000', '0.00'])

        // por cantidad, al promedio (10.00 / 3 = 3.33)
        await new EntregarPremioSorteo().execute(
            {
                sorteo_id: sorteo.id,
                ganador_id: cable.id,
                contrapartida: 'inventario',
                producto_id: material.id,
                bodega_id: bodega.id,
                cantidad: '1',
            },
            e.ctx,
        )
        const ganadorCable = await db.from('lealtad.sorteos_ganadores').where('id', cable.id).first()
        const salidaCable = await db
            .from('inventario.movimientos')
            .where('id', ganadorCable.movimiento_inventario_id)
            .first()
        assert.equal(salidaCable.costo_total, '-3.33')
        assert.isNull(ganadorCable.asiento_id)
        assert.deepEqual(await saldoInventario(material.id, bodega.id), ['2.000', '6.67'])
        await afirmarCuadre(assert, e.B)

        // anular la entrega del router: vuelve a la bodega a su costo, la unidad disponible
        await new AnularEntregaSorteo().execute(
            { sorteo_id: sorteo.id, ganador_id: router.id, motivo: 'el ganador lo devolvió' },
            e.ctx,
        )
        const reverso = await db
            .from('inventario.movimientos')
            .where({ reverso_de: Number(salida.id), tipo: 'reverso_premio' })
            .firstOrFail()
        assert.equal(reverso.costo_total, '275.00')
        assert.deepEqual(await partidas('inventario', Number(reverso.id)), [
            [CUENTAS_GT.INVENTARIOS, '275.00', '0.00', null],
            [CUENTAS_GT.PREMIOS_PROMOCIONES, '0.00', '275.00', null],
        ])
        const vuelve = await db.from('inventario.unidades').where('id', inicial.unidad_id!).first()
        assert.equal(vuelve.estado, 'disponible')
        assert.equal(Number(vuelve.bodega_id), bodega.id)
        const anulado = await db.from('lealtad.sorteos_ganadores').where('id', router.id).first()
        assert.isNull(anulado.movimiento_inventario_id)
        assert.deepEqual(await saldoInventario(equipo.id, bodega.id), ['1.000', '275.00'])
        await afirmarCuadre(assert, e.B)

        // y se vuelve a entregar desde el inventario
        await new EntregarPremioSorteo().execute(
            {
                sorteo_id: sorteo.id,
                ganador_id: router.id,
                contrapartida: 'inventario',
                producto_id: equipo.id,
                bodega_id: bodega.id,
                unidad_id: inicial.unidad_id!,
            },
            e.ctx,
        )
        assert.deepEqual(await saldoInventario(equipo.id, bodega.id), ['0.000', '0.00'])
        await afirmarCuadre(assert, e.B)
    })

    test('la línea de una compra que entró al inventario no se entrega como compra (422 linea_de_inventario); sin existencia 409', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const bodega = await bodegaEn(e.B, e.ctx)
        const material = await productoEn(e.B, e.ctx)
        const comprada = await comprarInventario(e.B, e.ctx, {
            producto_id: material.id,
            bodega_id: bodega.id,
            cantidad: 1,
            total: '11.20',
        })
        const linea = await db.from('ledger.compras_lineas').where('compra_id', comprada.id).firstOrFail()
        const { sorteo, cable } = await sorteoConBienes(e)
        const desdeCompra = await errorDe(
            new EntregarPremioSorteo().execute(
                {
                    sorteo_id: sorteo.id,
                    ganador_id: cable.id,
                    contrapartida: 'compra',
                    compra_linea_id: Number(linea.id),
                },
                e.ctx,
            ),
        )
        assert.equal(desdeCompra.codigo, 'linea_de_inventario')
        const sinExistencia = await errorDe(
            new EntregarPremioSorteo().execute(
                {
                    sorteo_id: sorteo.id,
                    ganador_id: cable.id,
                    contrapartida: 'inventario',
                    producto_id: material.id,
                    bodega_id: bodega.id,
                    cantidad: '2',
                },
                e.ctx,
            ),
        )
        assert.equal(sinExistencia.codigo, 'existencia_insuficiente')
        const ganador = await db.from('lealtad.sorteos_ganadores').where('id', cable.id).first()
        assert.notEqual(ganador.estado, 'entregado')
        await afirmarCuadre(assert, e.B)
    })
})
