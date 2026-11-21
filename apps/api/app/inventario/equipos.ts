import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import type { Transaccion } from '#shared/domain_action'
import type { OrigenExterno } from '#inventario/origen_externo'

/**
 * Estado del equipo (contrato Iris 0.12.0 §3.10, A48). Argos es el dueño de las unidades y de su estado;
 * Iris lo ve con estos nombres:
 *
 * | Estado del equipo | Fila de `inventario.unidades` |
 * | --- | --- |
 * | `disponible`, `en_comodato`, `por_recuperar`, `dada_de_baja`, `no_recuperada` | el mismo `estado` |
 * | `revision` | `en_reparacion` sin garantía abierta (en su bodega, cuenta en existencias y en 1.1.14) |
 * | `garantia` | `en_reparacion` con una fila abierta en `inventario.garantias` |
 *
 * Una unidad en `revision`, `garantia`, `dada_de_baja` o `no_recuperada` nunca se instala (el comodato
 * solo toma unidades `disponible`). Cada cambio queda en `inventario.unidades_historial` y emite
 * `inventario.unidad_estado_cambiado` (sin costos, proveedor, RMA ni nota).
 */

export const ESTADOS_EQUIPO = [
    'disponible',
    'en_comodato',
    'por_recuperar',
    'revision',
    'garantia',
    'dada_de_baja',
    'no_recuperada',
    'vendida',
    'anulada',
    'devuelta_proveedor',
    'entregada',
] as const
export type EstadoEquipo = (typeof ESTADOS_EQUIPO)[number]

export function aEstadoEquipo(estado: string, garantiaAbierta: boolean): EstadoEquipo {
    if (estado === 'en_reparacion') return garantiaAbierta ? 'garantia' : 'revision'
    return estado as EstadoEquipo
}

interface FilaEstado {
    id: number
    empresa_id: number
    producto_id: number
    serie: string | null
    mac: string | null
    estado: string
    servicio_id: number | null
    garantia: boolean
}

async function filaEstado(cliente: QueryClientContract, unidadId: number): Promise<FilaEstado | null> {
    const fila = (await cliente
        .from('inventario.unidades as u')
        .where('u.id', unidadId)
        .select(
            'u.id',
            'u.empresa_id',
            'u.producto_id',
            'u.serie',
            'u.mac',
            'u.estado',
            'u.servicio_id',
            cliente.raw(
                'exists (select 1 from inventario.garantias g where g.unidad_id = u.id and g.resultado is null) as garantia',
            ),
        )
        .first()) as FilaEstado | null
    return fila
}

/** Estado del equipo de una unidad, ahora. */
export async function estadoEquipo(
    unidadId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<EstadoEquipo | null> {
    const fila = await filaEstado(cliente, unidadId)
    return fila ? aEstadoEquipo(fila.estado, Boolean(fila.garantia)) : null
}

export interface OpcionesEstado {
    /** código del motivo (`comodato`, `devolucion`, `cambio_equipo`, `garantia`…); nunca texto libre */
    motivo?: string | null
    origenExterno?: OrigenExterno | null
    /** servicio a registrar (por defecto el de la unidad, o el que tenía antes del cambio) */
    servicioId?: number | null
}

/** Motivo y orden del próximo cambio de estado en la transacción (los pone la acción que lo provoca). */
const pendientes = new WeakMap<object, OpcionesEstado>()

export function motivoDelEstado(t: Transaccion, opciones: OpcionesEstado): void {
    // por contexto: las acciones anidadas (otro cliente, un savepoint) comparten el ctx de la que llama
    const clave = t.ctx
    pendientes.set(clave, opciones)
    const limpiar = () => {
        if (pendientes.get(clave) === opciones) pendientes.delete(clave)
    }
    t.trx.after('commit', limpiar)
    t.trx.after('rollback', limpiar)
}

/**
 * Registra el cambio `de → a` del equipo (historial + evento) si cambió. `antes` es el estado del equipo
 * antes del cambio (de `capturarEstado`).
 */
export async function registrarEstadoEquipo(
    t: Transaccion,
    unidadId: number,
    antes: { estado: EstadoEquipo | null; servicio_id: number | null },
    opciones: OpcionesEstado = {},
): Promise<void> {
    const fila = await filaEstado(t.trx, unidadId)
    if (!fila) return
    const a = aEstadoEquipo(fila.estado, Boolean(fila.garantia))
    if (a === antes.estado) return
    const extra = { ...pendientes.get(t.ctx), ...opciones }
    const servicioId =
        extra.servicioId !== undefined
            ? extra.servicioId
            : fila.servicio_id === null
              ? antes.servicio_id
              : Number(fila.servicio_id)
    const origen = extra.origenExterno ?? null
    await t.trx
        .insertQuery()
        .table('inventario.unidades_historial')
        .insert({
            empresa_id: fila.empresa_id,
            unidad_id: fila.id,
            de: antes.estado,
            a,
            motivo: extra.motivo ?? null,
            servicio_id: servicioId,
            origen_externo_tipo: origen?.tipo ?? null,
            origen_externo_id: origen?.id ?? null,
            actor_tipo: t.ctx.actor.tipo,
            actor_id: t.ctx.actor.id,
            request_id: t.ctx.requestId,
        })
    await t.emit('inventario.unidad_estado_cambiado', {
        unidad_id: Number(fila.id),
        empresa_id: Number(fila.empresa_id),
        producto_id: Number(fila.producto_id),
        serie: fila.serie,
        mac: fila.mac,
        de: antes.estado,
        a,
        motivo: extra.motivo ?? null,
        servicio_id: servicioId,
        origen_externo_tipo: origen?.tipo ?? null,
        origen_externo_id: origen?.id ?? null,
    })
}

/** El estado del equipo antes de cambiarlo (para `registrarEstadoEquipo`). */
export async function capturarEstado(
    t: Transaccion,
    unidadId: number,
): Promise<{ estado: EstadoEquipo | null; servicio_id: number | null }> {
    const fila = await filaEstado(t.trx, unidadId)
    return {
        estado: fila ? aEstadoEquipo(fila.estado, Boolean(fila.garantia)) : null,
        servicio_id:
            fila?.servicio_id === null || fila?.servicio_id === undefined ? null : Number(fila.servicio_id),
    }
}

/** Serie (o MAC) enmascarada para el aviso al titular: «…1A2B». */
export function enmascararSerie(serie: string | null, mac: string | null): string {
    const base = (serie ?? mac ?? '').replaceAll(':', '')
    return `…${base.slice(-4)}`
}
