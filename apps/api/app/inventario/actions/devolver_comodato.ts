import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Problema } from '#shared/errores'
import { aTexto, dec } from '#ledger/dinero'
import { inicioDeMes } from '#ledger/fechas'
import { CUOTA_VIGENTE, LOCK_ACTIVO, acumuladaDe, sumarMeses } from '#ledger/activos'
import type { LineaAsiento } from '#ledger/actions/registrar_asiento'
import DepreciarActivos from '#ledger/actions/depreciar_activos'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import {
    bloquearProducto,
    bodegaMovible,
    productoMovible,
    registrarMovimientoConAsiento,
    reservarMovimiento,
} from '#inventario/kardex'
import {
    actualizarUnidad,
    productoDeUnidad,
    unidadesDeBodega,
    type Condicion,
    type UnidadVista,
} from '#inventario/unidades'
import {
    emitirComodato,
    empresaDeLaUnidad,
    exigirEnComodatoDe,
    fechaDeComodato,
    servicioDe,
    unidadVista,
} from '#inventario/comodato'

/**
 * `inventario.devolver_comodato` (`POST /servicios/:id/equipos/:unidad_id/devolver`): la unidad en
 * comodato (o por recuperar) vuelve del servicio a una bodega (§5).
 *
 * - Primero deprecia lo pendiente del activo hasta el mes anterior al de la devolución (como
 *   `activos.dar_de_baja`); una cuota del mes de la devolución o posterior: 422
 *   `cuotas_posteriores`.
 * - Baja del activo **sin resultado** (`ledger.activos_bajas` tipo `devolucion_comodato`): asiento
 *   `1.1.14 (valor en libros) + 1.2.02.NN (depreciación acumulada) / 1.2.01.NN (costo)`, origen
 *   `inventario`, `origen_id` = el movimiento `devolucion_comodato` (+1 a su valor en libros).
 * - La unidad queda `disponible` (o `en_reparacion`), `usado` por defecto, en la bodega, con costo =
 *   valor en libros.
 * - Emite `inventario.comodato_devuelto`, `activo.dado_de_baja` e `inventario.movimiento_registrado`.
 */

export interface EntradaDevolverComodato {
    servicio_id: number
    unidad_id: number
    bodega_id: number
    condicion?: Condicion | null
    en_reparacion?: boolean | null
    fecha?: string | null
    motivo?: string | null
}

export default class DevolverComodato extends DomainAction<EntradaDevolverComodato, UnidadVista> {
    readonly nombre = 'inventario.devolver_comodato'

    protected async handle(input: EntradaDevolverComodato, t: Transaccion): Promise<UnidadVista> {
        t.fijarEntidad('unidad', input.unidad_id)
        const empresaId = await empresaDeLaUnidad(t, input.unidad_id)
        t.fijarEmpresa(empresaId)
        const servicio = await servicioDe(t, input.servicio_id, empresaId)
        const bodega = await bodegaMovible(t, input.bodega_id, empresaId, { entrada: true })
        // locks en el orden de todo el inventario: producto primero, después la fila de la unidad
        const previa = await productoDeUnidad(t, input.unidad_id)
        const producto = await productoMovible(t, previa)
        await bloquearProducto(t, producto.id)
        const [unidad] = await unidadesDeBodega(t, [input.unidad_id], {
            empresaId,
            estados: ['en_comodato', 'por_recuperar'],
            campo: 'unidad_id',
        })
        exigirEnComodatoDe(unidad!, servicio.id)
        const fecha = await fechaDeComodato(t, unidad!.id, input.fecha)
        const activoId = unidad!.activo_id!
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?)', [LOCK_ACTIVO, activoId])
        await new DepreciarActivos().execute(
            { activo_id: activoId, hasta: sumarMeses(inicioDeMes(fecha), -1) },
            t.ctx,
            { trx: t.trx },
        )
        const posterior = await t.trx
            .from('ledger.activos_cuotas as q')
            .where('q.activo_id', activoId)
            .where('q.mes', '>=', inicioDeMes(fecha))
            .whereRaw(CUOTA_VIGENTE)
            .select(t.trx.raw(`to_char(q.mes, 'YYYY-MM') as mes`))
            .first()
        if (posterior) {
            throw new Problema(
                422,
                'cuotas_posteriores',
                'Cuotas posteriores a la devolución',
                `El activo ${activoId} ya tiene la cuota de ${posterior.mes}: la devolución no puede ser anterior`,
                [{ field: 'fecha', message: `Cuota de ${posterior.mes}`, rule: 'cuotas_posteriores' }],
            )
        }
        const activo = (await t.trx
            .from('ledger.activos')
            .where('id', activoId)
            .select('costo', 'cuenta_activo_id', 'cuenta_depreciacion_id')
            .first()) as { costo: string; cuenta_activo_id: number; cuenta_depreciacion_id: number }
        const costo = dec(activo.costo)
        const acumulada = await acumuladaDe(t.trx, activoId)
        const libros = costo.minus(acumulada)
        const movimientos: LineaAsiento[] = []
        if (libros.gt(0)) movimientos.push({ cuenta: CUENTAS_GT.INVENTARIOS, debe: aTexto(libros) })
        if (acumulada.gt(0)) {
            movimientos.push({ cuenta: Number(activo.cuenta_depreciacion_id), debe: aTexto(acumulada) })
        }
        movimientos.push({ cuenta: Number(activo.cuenta_activo_id), haber: aTexto(costo) })
        const nombre = unidad!.serie ?? unidad!.mac
        const motivo = input.motivo?.trim() || `devolución del comodato del servicio ${servicio.id}`
        const id = await reservarMovimiento(t)
        await registrarMovimientoConAsiento(
            t,
            {
                empresaId,
                tipo: 'devolucion_comodato',
                fecha,
                producto,
                bodegaId: bodega.id,
                cantidad: dec('1'),
                costoTotal: libros,
                unidadId: unidad!.id,
                servicioId: servicio.id,
                motivo,
            },
            {
                descripcion: `Devolución de ${producto.sku} ${nombre} del servicio ${servicio.id} · baja del activo ${activoId} sin resultado`,
                // un activo de costo Q0 no mueve el libro
                movimientos: costo.gt(0) ? movimientos : undefined,
            },
            id,
        )
        const asiento = (await t.trx
            .from('inventario.movimientos')
            .where('id', id)
            .select('asiento_id')
            .first()) as {
            asiento_id: number | null
        }
        await t.trx
            .insertQuery()
            .table('ledger.activos_bajas')
            .insert({
                activo_id: activoId,
                fecha,
                tipo: 'devolucion_comodato',
                motivo,
                precio_venta: '0.00',
                costo: aTexto(costo),
                depreciacion_acumulada: aTexto(acumulada),
                valor_libros: aTexto(libros),
                asiento_id: asiento.asiento_id === null ? null : Number(asiento.asiento_id),
                registrado_por: usuarioDelActor(t.ctx.actor),
            })
        await t.emit('activo.dado_de_baja', {
            activo_id: activoId,
            empresa_id: empresaId,
            motivo,
            valor_libros: aTexto(libros),
        })
        const condicion: Condicion = input.condicion ?? 'usado'
        const estado = input.en_reparacion ? 'en_reparacion' : 'disponible'
        await actualizarUnidad(t, unidad!.id, {
            estado,
            condicion,
            bodega_id: bodega.id,
            costo: aTexto(libros),
            servicio_id: null,
            activo_id: null,
        })
        await t.registrarCambios(
            { tipo: 'unidad', id: unidad!.id },
            {
                estado: unidad!.estado,
                condicion: unidad!.condicion,
                bodega_id: null,
                costo: unidad!.costo,
                servicio_id: servicio.id,
                activo_id: activoId,
            },
            {
                estado,
                condicion,
                bodega_id: bodega.id,
                costo: aTexto(libros),
                servicio_id: null,
                activo_id: null,
            },
        )
        await emitirComodato(t, 'inventario.comodato_devuelto', unidad!, servicio, {
            condicion,
            bodega_id: bodega.id,
        })
        return unidadVista(unidad!.id, t)
    }
}
