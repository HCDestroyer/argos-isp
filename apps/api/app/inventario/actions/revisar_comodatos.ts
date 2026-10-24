import { DomainAction, type Transaccion } from '#shared/domain_action'
import { emitirComodato, servicioDe } from '#inventario/comodato'
import { actualizarUnidad, type UnidadFila } from '#inventario/unidades'

/**
 * `inventario.revisar_comodatos` (interna; la llama el consumidor de `servicio.estado_cambiado`):
 *
 * - Servicio `retirado`: cada unidad `en_comodato` del servicio pasa a `por_recuperar`, sin asiento
 *   (el activo sigue vigente), y se emite `inventario.equipo_por_recuperar` por unidad.
 * - Servicio en otro estado: sus unidades `por_recuperar` vuelven a `en_comodato`.
 *
 * Idempotente por servicio: decide con el estado actual del servicio (no con el del evento), así un
 * evento repetido o atrasado no cambia nada. Solo deja auditoría si cambió alguna unidad.
 */

export interface EntradaRevisarComodatos {
    servicio_id: number
}

export interface ResultadoRevisarComodatos {
    servicio_id: number
    estado_servicio: string
    por_recuperar: number[]
    recuperadas: number[]
}

export default class RevisarComodatos extends DomainAction<
    EntradaRevisarComodatos,
    ResultadoRevisarComodatos
> {
    readonly nombre = 'inventario.revisar_comodatos'

    protected auditarExito(salida: ResultadoRevisarComodatos): boolean {
        return salida.por_recuperar.length > 0 || salida.recuperadas.length > 0
    }

    protected async handle(
        input: EntradaRevisarComodatos,
        t: Transaccion,
    ): Promise<ResultadoRevisarComodatos> {
        t.fijarEntidad('servicio', input.servicio_id)
        const servicio = await servicioDe(t, input.servicio_id)
        t.fijarEmpresa(servicio.empresa_id)
        const retirado = servicio.estado === 'retirado'
        const unidades = (await t.trx
            .from('inventario.unidades')
            .where('servicio_id', servicio.id)
            .where('estado', retirado ? 'en_comodato' : 'por_recuperar')
            .orderBy('id')
            .forUpdate()
            .select('*')) as UnidadFila[]
        const ids: number[] = []
        for (const fila of unidades) {
            const unidad = {
                ...fila,
                id: Number(fila.id),
                empresa_id: Number(fila.empresa_id),
                producto_id: Number(fila.producto_id),
            }
            const estado = retirado ? 'por_recuperar' : 'en_comodato'
            await actualizarUnidad(t, unidad.id, { estado })
            await t.registrarCambios({ tipo: 'unidad', id: unidad.id }, { estado: unidad.estado }, { estado })
            if (retirado) await emitirComodato(t, 'inventario.equipo_por_recuperar', unidad, servicio)
            ids.push(unidad.id)
        }
        return {
            servicio_id: servicio.id,
            estado_servicio: servicio.estado,
            por_recuperar: retirado ? ids : [],
            recuperadas: retirado ? [] : ids,
        }
    }
}
