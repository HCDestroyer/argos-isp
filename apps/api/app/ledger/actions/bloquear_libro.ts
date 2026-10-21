import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Problema, ValidacionFallida } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { resolverEmpresaActiva } from '#core/empresas'
import { fechaValida, hoyGuatemala } from '#ledger/fechas'
import {
    bloquearBloqueos,
    bloqueoVigente,
    guardarBloqueo,
    motivoObligatorio,
    type BloqueoVista,
    type TipoExcepcion,
} from '#ledger/bloqueos'

/**
 * `libro.bloquear` (`POST /libro/bloqueos`): fija el bloqueo `global`, `ventas`, `compras` o
 * `impuestos` de la empresa hasta `hasta` (contrato §10.4). Solo avanza: para moverlo hacia atrás
 * está `libro.desbloquear` (422 `bloqueo_regresivo`). El duro tiene su propia acción
 * (`libro.bloquear_duro`).
 *
 * - `hasta` no puede ser futuro (422 `bloqueo_futuro`) ni quedar antes del duro (422
 *   `bloqueo_bajo_duro`, también por trigger).
 * - Emite `libro.bloqueo_cambiado { empresa_id, tipo, hasta, anterior }`.
 */

export interface EntradaBloquear {
    empresa_id?: number | null
    tipo: TipoExcepcion
    hasta: string
    motivo: string
}

export default class BloquearLibro extends DomainAction<EntradaBloquear, BloqueoVista> {
    readonly nombre = 'libro.bloquear'

    protected async handle(input: EntradaBloquear, t: Transaccion): Promise<BloqueoVista> {
        const hasta = fechaValida(input.hasta, 'hasta')
        const motivo = motivoObligatorio(input.motivo)
        if (hasta > hoyGuatemala()) {
            throw new ValidacionFallida([
                { field: 'hasta', message: 'El bloqueo no puede ser futuro', rule: 'bloqueo_futuro' },
            ])
        }
        const empresaId = input.empresa_id ?? (await resolverEmpresaActiva(t.ctx, t.trx))
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        await bloquearBloqueos(t.trx, empresaId)

        const anterior = await bloqueoVigente(t.trx, empresaId, input.tipo)
        if (anterior !== null && hasta <= anterior) {
            throw new Problema(
                422,
                'bloqueo_regresivo',
                'Bloqueo regresivo',
                `El bloqueo ${input.tipo} ya está en ${anterior}: libro.bloquear solo avanza` +
                    (input.tipo === 'impuestos'
                        ? ' (el de impuestos no retrocede: lo anterior se corrige con una excepción)'
                        : ' (para moverlo hacia atrás, POST /libro/bloqueos/desbloquear)'),
                [{ field: 'hasta', message: `Debe ser posterior a ${anterior}`, rule: 'bloqueo_regresivo' }],
            )
        }
        const duro = await bloqueoVigente(t.trx, empresaId, 'duro')
        if (duro !== null && hasta < duro) {
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
        return guardarBloqueo(t, { empresaId, tipo: input.tipo, hasta, motivo })
    }
}
