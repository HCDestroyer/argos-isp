import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, Problema } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { resolverEmpresaActiva } from '#core/empresas'
import { fechaValida } from '#ledger/fechas'
import {
    bloquearBloqueos,
    bloqueoVigente,
    guardarBloqueo,
    motivoObligatorio,
    type BloqueoVista,
} from '#ledger/bloqueos'

/**
 * `libro.desbloquear` (`POST /libro/bloqueos/desbloquear`): mueve hacia atrás el bloqueo
 * `global`, `ventas` o `compras` (por defecto `global`) hasta `hasta`, o lo quita (`hasta` null),
 * con motivo (contrato §10.4).
 *
 * - `impuestos` no retrocede (422 `bloqueo_regresivo`: se usa una excepción); `duro`, nunca (409
 *   `bloqueo_duro`).
 * - 409 `sin_bloqueo` si el tipo no tiene bloqueo; 422 `bloqueo_regresivo` si `hasta` no es anterior
 *   al vigente (eso es bloquear); 422 `bloqueo_bajo_duro` si quedaría antes del duro.
 * - Emite `libro.bloqueo_cambiado`.
 */

export interface EntradaDesbloquear {
    empresa_id?: number | null
    tipo?: 'global' | 'ventas' | 'compras' | 'impuestos' | 'duro'
    hasta?: string | null
    motivo: string
}

export default class DesbloquearLibro extends DomainAction<EntradaDesbloquear, BloqueoVista> {
    readonly nombre = 'libro.desbloquear'

    protected async handle(input: EntradaDesbloquear, t: Transaccion): Promise<BloqueoVista> {
        const tipo = input.tipo ?? 'global'
        const motivo = motivoObligatorio(input.motivo)
        const hasta = input.hasta ? fechaValida(input.hasta, 'hasta') : null
        if (tipo === 'duro') {
            throw new Problema(409, 'bloqueo_duro', 'Bloqueo duro', 'El bloqueo duro nunca retrocede', [
                { field: 'tipo', message: 'El bloqueo duro nunca retrocede', rule: 'bloqueo_duro' },
            ])
        }
        if (tipo === 'impuestos') {
            throw new Problema(
                422,
                'bloqueo_regresivo',
                'Bloqueo regresivo',
                'El bloqueo de impuestos no retrocede: para registrar en un periodo declarado, crea una excepción (libro.excepcion_bloqueo)',
                [
                    {
                        field: 'tipo',
                        message: 'El bloqueo de impuestos no retrocede',
                        rule: 'bloqueo_regresivo',
                    },
                ],
            )
        }
        const empresaId = input.empresa_id ?? (await resolverEmpresaActiva(t.ctx, t.trx))
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        await bloquearBloqueos(t.trx, empresaId)

        const anterior = await bloqueoVigente(t.trx, empresaId, tipo)
        if (anterior === null) {
            throw new Conflicto(`No hay bloqueo ${tipo} que mover`, 'sin_bloqueo', 'Sin bloqueo')
        }
        if (hasta !== null && hasta >= anterior) {
            throw new Problema(
                422,
                'bloqueo_regresivo',
                'Bloqueo regresivo',
                `El bloqueo ${tipo} está en ${anterior}: desbloquear lo mueve hacia atrás (para avanzar, libro.bloquear)`,
                [{ field: 'hasta', message: `Debe ser anterior a ${anterior}`, rule: 'bloqueo_regresivo' }],
            )
        }
        const duro = await bloqueoVigente(t.trx, empresaId, 'duro')
        if (duro !== null && (hasta === null || hasta < duro)) {
            throw new Problema(
                422,
                'bloqueo_bajo_duro',
                'Bloqueo antes del duro',
                `El bloqueo duro está en ${duro}: ningún otro bloqueo queda antes`,
                [
                    {
                        field: 'hasta',
                        message: `Debe ser igual o posterior a ${duro}`,
                        rule: 'bloqueo_bajo_duro',
                    },
                ],
            )
        }
        return guardarBloqueo(t, { empresaId, tipo, hasta, motivo })
    }
}
