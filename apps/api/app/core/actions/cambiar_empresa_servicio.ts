import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado, ReglaNegocio } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { verificarVersion } from '#shared/version'
import type { EstadoServicio } from '#shared/eventos'
import { verServicio, type ServicioVista } from '#core/consultas/servicios'
import { exigirEmpresaActiva } from '#core/empresas'
import { saldoPendienteServicio } from '#billing/facturas'

export interface EntradaCambiarEmpresaServicio {
    id: number
    empresa_id: number
    version: number
    motivo: string
}

/**
 * Pasa un servicio a otra empresa (NIT) (`servicios.cambiar_empresa`). Es la única vía: la
 * empresa del servicio no se edita con `PUT /servicios/:id` (contrato de multiempresa).
 *
 * - Exige que el servicio no tenga saldo pendiente (422 `servicio_con_saldo`): las facturas ya
 *   emitidas quedan con el NIT que las emitió y las siguientes salen con el nuevo.
 * - El actor necesita acceso a las dos empresas (403 `empresa_no_permitida`); la nueva debe estar
 *   activa (422 en `empresa_id`). Retirado: 422 `servicio_retirado`. Control por `version` (409).
 * - Misma empresa: no hace nada. Si cambia, diff en `audit.cambios` y `servicio.config_cambiada`
 *   con `campos: ['empresa']` y `empresa_anterior_id` (no afecta la red).
 */
export default class CambiarEmpresaServicio extends DomainAction<
    EntradaCambiarEmpresaServicio,
    ServicioVista
> {
    readonly nombre = 'servicios.cambiar_empresa'

    protected async handle(input: EntradaCambiarEmpresaServicio, t: Transaccion): Promise<ServicioVista> {
        t.fijarEntidad('servicio', input.id)
        const fila = (await t.trx
            .from('core.servicios')
            .where('id', input.id)
            .forUpdate()
            .select('estado', 'empresa_id', 'version')
            .first()) as { estado: EstadoServicio; empresa_id: number; version: number } | null
        if (!fila) throw new NoEncontrado(`El servicio ${input.id} no existe`)
        const anterior = Number(fila.empresa_id)
        t.fijarEmpresa(anterior)
        exigirAccesoEmpresa(t.ctx, anterior)
        verificarVersion('servicio', input.id, Number(fila.version), input.version)
        if (fila.estado === 'retirado') {
            throw new ReglaNegocio('El servicio está retirado: no cambia de empresa', 'servicio_retirado')
        }
        if (anterior === input.empresa_id) return verServicio(input.id, t.trx)

        await exigirEmpresaActiva(t.trx, input.empresa_id)
        exigirAccesoEmpresa(t.ctx, input.empresa_id)
        const saldo = await saldoPendienteServicio(input.id, t.trx)
        if (saldo.greaterThan(0)) {
            throw new ReglaNegocio(
                `El servicio tiene Q ${saldo.toFixed(2)} pendientes: cóbralos o anúlalos antes de cambiar de empresa`,
                'servicio_con_saldo',
            )
        }

        const antes = await verServicio(input.id, t.trx)
        await t.trx
            .from('core.servicios')
            .where('id', input.id)
            .update({
                empresa_id: input.empresa_id,
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        const despues = await verServicio(input.id, t.trx)
        t.fijarEmpresa(input.empresa_id)
        await t.registrarCambios({ tipo: 'servicio', id: input.id }, antes, despues)
        await t.emit('servicio.config_cambiada', {
            servicio_id: input.id,
            empresa_id: input.empresa_id,
            campos: ['empresa'],
            empresa_anterior_id: anterior,
        })
        return despues
    }
}
