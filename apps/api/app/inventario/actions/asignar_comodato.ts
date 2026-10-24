import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto } from '#shared/errores'
import { aTexto, dec } from '#ledger/dinero'
import { cuentasDeClase, inicioDepreciacion, tasaDeClase } from '#ledger/activos'
import type { ClaseActivo } from '#ledger/compras'
import {
    bloquearProducto,
    productoMovible,
    registrarMovimientoConAsiento,
    reservarMovimiento,
} from '#inventario/kardex'
import { actualizarUnidad, productoDeUnidad, unidadesDeBodega, type UnidadVista } from '#inventario/unidades'
import {
    emitirComodato,
    empresaDeLaUnidad,
    fechaDeComodato,
    servicioDe,
    unidadVista,
} from '#inventario/comodato'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'

/**
 * `inventario.asignar_comodato` (`POST /servicios/:id/equipos`): presta una unidad `disponible` a un
 * servicio vigente de su misma empresa (§5).
 *
 * - Sale de su bodega a su costo (`asignacion_comodato`, con `servicio_id`) y pasa a activo fijo de
 *   la clase del producto (por defecto `equipo_red`): asiento `1.2.01.NN / 1.1.14` por el costo
 *   (origen `inventario`) y alta en `ledger.activos` con `unidad_id`, fecha de alta = la del
 *   movimiento y depreciación según `depreciacion_inicio` (por defecto desde el mes siguiente).
 * - La unidad queda `en_comodato` con su servicio y su activo.
 * - 409 `servicio_retirado`, `unidad_en_comodato`, `unidad_no_disponible`; servicio de otra empresa:
 *   404. `fecha` (opcional, no futura ni anterior al último movimiento de la unidad) respeta los
 *   bloqueos del libro.
 * - Emite `inventario.comodato_asignado` e `inventario.movimiento_registrado`.
 */

export interface EntradaAsignarComodato {
    servicio_id: number
    unidad_id: number
    fecha?: string | null
}

export default class AsignarComodato extends DomainAction<EntradaAsignarComodato, UnidadVista> {
    readonly nombre = 'inventario.asignar_comodato'

    protected async handle(input: EntradaAsignarComodato, t: Transaccion): Promise<UnidadVista> {
        t.fijarEntidad('unidad', input.unidad_id)
        const empresaId = await empresaDeLaUnidad(t, input.unidad_id)
        t.fijarEmpresa(empresaId)
        const servicio = await servicioDe(t, input.servicio_id, empresaId)
        if (servicio.estado === 'retirado') {
            throw new Conflicto(
                `El servicio ${servicio.id} está retirado: no recibe equipos en comodato`,
                'servicio_retirado',
                'Servicio retirado',
            )
        }
        // locks en el orden de todo el inventario: producto primero, después la fila de la unidad
        const previa = await productoDeUnidad(t, input.unidad_id)
        const producto = await productoMovible(t, previa)
        await bloquearProducto(t, producto.id)
        // con el lock del producto la unidad ya no cambia: se vuelve a leer
        const [unidad] = await unidadesDeBodega(t, [input.unidad_id], {
            empresaId,
            estados: ['disponible'],
            campo: 'unidad_id',
        })
        // un equipo que volvió totalmente depreciado vale Q0: su activo nace en Q0, sin depreciación ni
        // asiento (decisión del líder, fase B)
        const costo = dec(unidad!.costo)
        const fecha = await fechaDeComodato(t, unidad!.id, input.fecha)
        const clase = (producto.clase_activo ?? 'equipo_red') as ClaseActivo
        const cuentas = await cuentasDeClase(t.trx, clase)
        const nombre = unidad!.serie ?? unidad!.mac
        const [activo] = (await t.trx
            .insertQuery()
            .table('ledger.activos')
            .insert({
                empresa_id: empresaId,
                clase,
                descripcion: `${producto.nombre} ${nombre} (comodato, servicio ${servicio.id})`,
                serie: unidad!.serie ?? unidad!.mac,
                ubicacion: `servicio ${servicio.id}`,
                fecha_alta: fecha,
                inicio_depreciacion: await inicioDepreciacion(t.trx, empresaId, fecha),
                costo: aTexto(costo),
                valor_residual: '0.00',
                tasa_anual: await tasaDeClase(t.trx, empresaId, clase, fecha),
                cuenta_activo_id: cuentas.activo,
                cuenta_depreciacion_id: cuentas.depreciacion,
                cuenta_gasto_id: cuentas.gasto,
                unidad_id: unidad!.id,
                registrado_por: usuarioDelActor(t.ctx.actor),
            })
            .returning('id')) as Array<{ id: number }>
        const activoId = Number(activo!.id)
        const id = await reservarMovimiento(t)
        await registrarMovimientoConAsiento(
            t,
            {
                empresaId,
                tipo: 'asignacion_comodato',
                fecha,
                producto,
                bodegaId: unidad!.bodega_id!,
                cantidad: dec('-1'),
                costoTotal: costo.neg(),
                unidadId: unidad!.id,
                servicioId: servicio.id,
                motivo: `comodato al servicio ${servicio.id} (activo ${activoId})`,
            },
            {
                descripcion: `Comodato de ${producto.sku} ${nombre} al servicio ${servicio.id} · activo ${activoId}`,
                movimientos: costo.gt(0)
                    ? [
                          { cuenta: cuentas.activo, debe: aTexto(costo) },
                          { cuenta: CUENTAS_GT.INVENTARIOS, haber: aTexto(costo) },
                      ]
                    : undefined,
            },
            id,
        )
        await actualizarUnidad(t, unidad!.id, {
            estado: 'en_comodato',
            bodega_id: null,
            servicio_id: servicio.id,
            activo_id: activoId,
        })
        await t.registrarCambios(
            { tipo: 'unidad', id: unidad!.id },
            { estado: unidad!.estado, bodega_id: unidad!.bodega_id, servicio_id: null, activo_id: null },
            { estado: 'en_comodato', bodega_id: null, servicio_id: servicio.id, activo_id: activoId },
        )
        await emitirComodato(t, 'inventario.comodato_asignado', unidad!, servicio)
        return unidadVista(unidad!.id, t)
    }
}
