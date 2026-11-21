import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, ConflictoVersion, NoEncontrado, ValidacionFallida } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { emitirCobroEquipo, verCobroEquipo, type CobroEquipoVista } from '#inventario/cobros_equipo'

/**
 * Decidir un cobro propuesto de la cola de cobros de equipo (contrato Iris 0.12.0 §3.10, A48; permiso
 * `inventario.cobrar_equipo`): el técnico propone **sin monto**; una persona aprueba con el monto (un cargo
 * único al cliente del servicio) o rechaza con motivo. Solo un cobro `propuesto` (409 `cobro_decidido`),
 * con `version` (409 si cambió).
 */

interface Base {
    id: number
    version: number
}

async function cobroPropuesto(t: Transaccion, input: Base): Promise<{ empresa_id: number }> {
    const fila = (await t.trx
        .from('inventario.cobros_equipo')
        .where('id', input.id)
        .forUpdate()
        .select('id', 'empresa_id', 'estado', 'version')
        .first()) as { id: number; empresa_id: number; estado: string; version: number } | null
    if (!fila) throw new NoEncontrado(`El cobro de equipo ${input.id} no existe`)
    exigirAccesoEmpresa(t.ctx, Number(fila.empresa_id))
    t.fijarEmpresa(Number(fila.empresa_id))
    t.fijarEntidad('cobro_equipo', input.id)
    if (Number(fila.version) !== input.version) throw new ConflictoVersion('cobro_equipo', input.id)
    if (fila.estado !== 'propuesto') {
        throw new Conflicto(
            `El cobro de equipo ${input.id} ya está ${fila.estado}`,
            'cobro_decidido',
            'Cobro decidido',
        )
    }
    return { empresa_id: Number(fila.empresa_id) }
}

export interface EntradaAprobarCobroEquipo extends Base {
    monto: string
    concepto_id?: number | null
    motivo?: string | null
}

export class AprobarCobroEquipo extends DomainAction<EntradaAprobarCobroEquipo, CobroEquipoVista> {
    readonly nombre = 'inventario.aprobar_cobro_equipo'

    protected async handle(input: EntradaAprobarCobroEquipo, t: Transaccion): Promise<CobroEquipoVista> {
        await cobroPropuesto(t, input)
        await emitirCobroEquipo(t, input.id, {
            monto: input.monto,
            concepto_id: input.concepto_id ?? null,
            decidido_por: usuarioDelActor(t.ctx.actor),
            motivo: input.motivo?.trim() || null,
        })
        await t.registrarCambios(
            { tipo: 'cobro_equipo', id: input.id },
            { estado: 'propuesto' },
            { estado: 'aprobado', monto: input.monto },
        )
        return verCobroEquipo(input.id, t.trx)
    }
}

export interface EntradaRechazarCobroEquipo extends Base {
    motivo: string
}

export class RechazarCobroEquipo extends DomainAction<EntradaRechazarCobroEquipo, CobroEquipoVista> {
    readonly nombre = 'inventario.rechazar_cobro_equipo'

    protected async handle(input: EntradaRechazarCobroEquipo, t: Transaccion): Promise<CobroEquipoVista> {
        const motivo = input.motivo?.trim() ?? ''
        if (motivo.length < 3) {
            throw new ValidacionFallida([
                { field: 'motivo', message: 'El motivo es obligatorio', rule: 'required' },
            ])
        }
        await cobroPropuesto(t, input)
        await t.trx
            .from('inventario.cobros_equipo')
            .where('id', input.id)
            .update({
                estado: 'rechazado',
                decidido_por: usuarioDelActor(t.ctx.actor),
                decidido_en: t.trx.knexRawQuery('now()'),
                motivo_decision: motivo,
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        await t.registrarCambios(
            { tipo: 'cobro_equipo', id: input.id },
            { estado: 'propuesto' },
            { estado: 'rechazado', motivo_decision: motivo },
        )
        return verCobroEquipo(input.id, t.trx)
    }
}
