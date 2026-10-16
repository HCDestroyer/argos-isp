import type { Transaccion } from '#shared/domain_action'
import { Conflicto, ValidacionFallida } from '#shared/errores'
import type { EntradaResolverPromesa, FilaPromesa } from '#billing/cierre_promesa'

/** Motivo obligatorio de rechazar y cancelar (también lo exige el validador de la ruta). */
export function motivoDeCierre(input: EntradaResolverPromesa): string {
    const motivo = input.motivo?.trim() ?? ''
    if (motivo.length < 3) {
        throw new ValidacionFallida([
            { field: 'motivo', message: 'El motivo es obligatorio (mínimo 3 caracteres)', rule: 'required' },
        ])
    }
    return motivo
}

export function exigirEstadoPromesa(promesa: FilaPromesa, permitidos: string[], accion: string): void {
    if (!permitidos.includes(promesa.estado)) {
        throw new Conflicto(
            `La promesa ${promesa.id} está ${promesa.estado}; solo se puede ${accion} si está ${permitidos.join(' o ')}`,
            'promesa_no_pendiente',
            'Estado de la promesa',
        )
    }
}

export function detalleOperador(t: Transaccion, motivo: string) {
    return { motivo, por: t.ctx.actor.id }
}
