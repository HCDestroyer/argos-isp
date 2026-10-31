import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { Conflicto, ConflictoVersion, NoEncontrado, ValidacionFallida } from '#shared/errores'
import { dec } from '#ledger/dinero'
import { bloquearProducto, productoMovible } from '#inventario/kardex'
import { moverDeOrden } from '#inventario/actions/crear_traslado'
import { payloadTraslado, verOrdenTraslado, type OrdenTrasladoDetalle } from '#inventario/ordenes_traslado'

/**
 * `inventario.cancelar_traslado` (`POST /inventario/traslados/:id/cancelar`, fase D,
 * `contratos/inventario.md` D.1): solo una orden `en_transito`, con motivo. Todo vuelve de la bodega
 * «en tránsito» al origen al costo de cada línea (sin asiento). La ruta exige poder operar el origen
 * (tope por técnico) o alcance global. Emite `inventario.traslado_cancelado`.
 */

export interface EntradaCancelarTraslado {
    id: number
    motivo: string
    version?: number | null
}

export default class CancelarTraslado extends DomainAction<EntradaCancelarTraslado, OrdenTrasladoDetalle> {
    readonly nombre = 'inventario.cancelar_traslado'

    protected async handle(input: EntradaCancelarTraslado, t: Transaccion): Promise<OrdenTrasladoDetalle> {
        t.fijarEntidad('orden_traslado', input.id)
        const orden = (await t.trx
            .from('inventario.ordenes_traslado')
            .where('id', input.id)
            .forUpdate()
            .select(
                'id',
                'empresa_id',
                'numero',
                'estado',
                'bodega_origen_id',
                'bodega_transito_id',
                'version',
            )
            .first()) as {
            id: number
            empresa_id: number
            numero: number
            estado: string
            bodega_origen_id: number
            bodega_transito_id: number
            version: number
        } | null
        if (!orden) throw new NoEncontrado(`La orden de traslado ${input.id} no existe`)
        const empresaId = Number(orden.empresa_id)
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        if (
            input.version !== undefined &&
            input.version !== null &&
            Number(orden.version) !== input.version
        ) {
            throw new ConflictoVersion('orden_traslado', input.id)
        }
        const motivo = input.motivo?.trim() ?? ''
        if (motivo === '') {
            throw new ValidacionFallida([{ field: 'motivo', message: 'Indica el motivo', rule: 'required' }])
        }
        if (orden.estado !== 'en_transito') {
            throw new Conflicto(
                `La orden de traslado ${orden.numero} está ${orden.estado.replaceAll('_', ' ')}`,
                'orden_no_en_transito',
                'Orden no en tránsito',
            )
        }
        const lineas = (await t.trx
            .from('inventario.ordenes_traslado_lineas')
            .where('orden_id', orden.id)
            .orderBy('id')
            .select('id', 'producto_id', 'cantidad', 'costo_total')) as Array<{
            id: number
            producto_id: number
            cantidad: string
            costo_total: string
        }>
        for (const id of [...new Set(lineas.map((l) => Number(l.producto_id)))].sort((a, b) => a - b)) {
            await bloquearProducto(t, id)
        }
        for (const linea of lineas) {
            const producto = await productoMovible(t, Number(linea.producto_id), { empresaId })
            const unidades = (await t.trx
                .from('inventario.ordenes_traslado_unidades')
                .where('linea_id', linea.id)
                .orderBy('id')
                .select('unidad_id', 'costo')) as Array<{ unidad_id: number; costo: string }>
            await moverDeOrden(t, {
                empresaId,
                ordenId: orden.id,
                producto,
                desde: Number(orden.bodega_transito_id),
                hacia: Number(orden.bodega_origen_id),
                ...(unidades.length > 0
                    ? { unidades: unidades.map((u) => ({ id: Number(u.unidad_id), costo: dec(u.costo) })) }
                    : { cantidad: dec(linea.cantidad), costo: dec(linea.costo_total) }),
                motivo: `Cancelación de la orden de traslado ${orden.numero}: ${motivo}`,
            })
        }
        await t.trx
            .from('inventario.ordenes_traslado')
            .where('id', orden.id)
            .update({
                estado: 'cancelada',
                cancelado_por: usuarioDelActor(t.ctx.actor),
                cancelado_en: t.trx.knexRawQuery('now()'),
                motivo_cancelacion: motivo,
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            })
        await t.registrarCambios(
            { tipo: 'orden_traslado', id: orden.id },
            { estado: 'en_transito', motivo_cancelacion: null },
            { estado: 'cancelada', motivo_cancelacion: motivo },
        )
        await t.emit('inventario.traslado_cancelado', {
            ...(await payloadTraslado(t.trx, orden.id)),
            cancelado_en: new Date().toISOString(),
            motivo,
        })
        return verOrdenTraslado(orden.id, t.trx)
    }
}
