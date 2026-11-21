import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, ValidacionFallida } from '#shared/errores'
import { empresaDeLaUnidad } from '#inventario/comodato'

/**
 * `inventario.registrar_contacto_recuperacion` (`POST /inventario/unidades/:id/contactos-recuperacion`,
 * A48): un contacto con el cliente para recuperar el equipo (llamada, WhatsApp, visita…). Cuenta como
 * alternativa al mínimo de técnicos distintos para declararlo no recuperado. Solo inserción; solo para una
 * unidad en comodato o por recuperar (409 `estado_unidad_cambiado`).
 */

export const MEDIOS_CONTACTO = ['llamada', 'whatsapp', 'correo', 'visita', 'oficina', 'otro'] as const

export interface EntradaContactoRecuperacion {
    unidad_id: number
    medio: (typeof MEDIOS_CONTACTO)[number]
    nota: string
}

export default class RegistrarContactoRecuperacion extends DomainAction<
    EntradaContactoRecuperacion,
    { id: number; unidad_id: number; servicio_id: number | null; medio: string; created_at: Date }
> {
    readonly nombre = 'inventario.registrar_contacto_recuperacion'

    protected async handle(input: EntradaContactoRecuperacion, t: Transaccion) {
        const nota = input.nota?.trim() ?? ''
        if (nota.length < 3) {
            throw new ValidacionFallida([
                { field: 'nota', message: 'Describe el contacto', rule: 'required' },
            ])
        }
        t.fijarEntidad('unidad', input.unidad_id)
        const empresaId = await empresaDeLaUnidad(t, input.unidad_id)
        t.fijarEmpresa(empresaId)
        const unidad = (await t.trx
            .from('inventario.unidades')
            .where('id', input.unidad_id)
            .select('estado', 'servicio_id')
            .first()) as { estado: string; servicio_id: number | null }
        if (unidad.estado !== 'en_comodato' && unidad.estado !== 'por_recuperar') {
            throw new Conflicto(
                `La unidad ${input.unidad_id} está ${unidad.estado.replaceAll('_', ' ')}`,
                'estado_unidad_cambiado',
                'El estado de la unidad cambió',
            )
        }
        const [fila] = (await t.trx
            .insertQuery()
            .table('inventario.contactos_recuperacion')
            .insert({
                empresa_id: empresaId,
                unidad_id: input.unidad_id,
                servicio_id: unidad.servicio_id,
                medio: input.medio,
                nota,
                registrado_por: usuarioDelActor(t.ctx.actor),
            })
            .returning(['id', 'created_at'])) as Array<{ id: number; created_at: Date }>
        return {
            id: Number(fila!.id),
            unidad_id: input.unidad_id,
            servicio_id: unidad.servicio_id === null ? null : Number(unidad.servicio_id),
            medio: input.medio,
            created_at: fila!.created_at,
        }
    }
}
