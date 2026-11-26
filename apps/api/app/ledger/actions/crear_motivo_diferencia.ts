import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { resolverEmpresaActiva } from '#core/empresas'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { LOCK_DIFERENCIAS, verMotivo, type MotivoDiferenciaVista } from '#ledger/diferencias_conciliacion'
import { CAMPOS_MOTIVO, normalizarMotivo, type EntradaMotivo } from '#ledger/motivos_diferencia'

/**
 * `bancos.crear_motivo_diferencia` (`POST /bancos/motivos-diferencia`, permiso
 * `bancos.configurar_diferencias`; plan de contabilidad §5.8): motivo propio de la empresa. Evento
 * `banco.diferencias_config_cambiada`.
 */
export default class CrearMotivoDiferencia extends DomainAction<
    EntradaMotivo & { empresa_id?: number | null; nombre: string },
    MotivoDiferenciaVista
> {
    readonly nombre = 'bancos.crear_motivo_diferencia'

    protected async handle(
        input: EntradaMotivo & { empresa_id?: number | null; nombre: string },
        t: Transaccion,
    ): Promise<MotivoDiferenciaVista> {
        const empresaId = input.empresa_id ?? (await resolverEmpresaActiva(t.ctx, t.trx))
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?::int)', [LOCK_DIFERENCIAS, empresaId])
        const datos = await normalizarMotivo(
            t,
            input,
            {
                nombre: '',
                sentido: 'ambos',
                se_ofrece_en: 'cualquiera',
                cuenta_banco_id: null,
                texto: null,
                limite_tipo: 'sin_limite',
                limite_valor: null,
                cuenta_codigo: null,
                cuenta_contra_tope: true,
                siempre_aprobacion: false,
                activo: true,
                orden: 100,
            },
            empresaId,
            false,
        )
        const [fila] = (await t.trx
            .insertQuery()
            .table('billing.motivos_diferencia')
            .insert({ ...datos, empresa_id: empresaId, updated_by: usuarioDelActor(t.ctx.actor) })
            .returning('id')) as Array<{ id: number }>
        const id = Number(fila!.id)
        t.fijarEntidad('motivo_diferencia', id)
        await t.emit('banco.diferencias_config_cambiada', {
            empresa_id: empresaId,
            motivo_id: id,
            campos: [...CAMPOS_MOTIVO],
        })
        return verMotivo(id, t.trx)
    }
}
