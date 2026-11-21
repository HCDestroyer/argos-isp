import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { ConflictoVersion, NoEncontrado } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import type { MapeoExtracto } from '#importacion/extractos/formatos'
import { verMapeoGuardado, type MapeoGuardado } from '#importacion/extractos/mapeos'

export interface EntradaGuardarMapeo {
    cuenta_bancaria_id: number
    /** banco reconocido (`banrural`…) o `personalizado` */
    formato?: string | null
    mapeo: MapeoExtracto
    /** versión leída; sin ella, gana la última escritura */
    version?: number | null
}

/**
 * `bancos.guardar_mapeo_extracto`: guarda el mapeo de columnas confirmado para una cuenta bancaria
 * (`importacion.extractos_mapeos`, uno por cuenta). La próxima vista previa de esa cuenta lo usa si
 * su fila de títulos aparece en el archivo. Con `version` distinta a la guardada: 409. El diff queda
 * en `audit.cambios` (entidad `cuenta_bancaria`).
 */
export default class GuardarMapeoExtracto extends DomainAction<EntradaGuardarMapeo, MapeoGuardado> {
    readonly nombre = 'bancos.guardar_mapeo_extracto'

    protected async handle(input: EntradaGuardarMapeo, t: Transaccion): Promise<MapeoGuardado> {
        const cuenta = (await t.trx
            .from('billing.cuentas_bancarias')
            .where('id', input.cuenta_bancaria_id)
            .select('id', 'empresa_id')
            .first()) as { id: number; empresa_id: number } | null
        if (!cuenta) throw new NoEncontrado(`La cuenta bancaria ${input.cuenta_bancaria_id} no existe`)
        const empresaId = Number(cuenta.empresa_id)
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        t.fijarEntidad('cuenta_bancaria', Number(cuenta.id))

        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(hashtext(?), ?::int)', [
            'importacion.extractos_mapeos',
            Number(cuenta.id),
        ])
        const antes = await verMapeoGuardado(t.trx, input.cuenta_bancaria_id)
        if (
            antes &&
            input.version !== undefined &&
            input.version !== null &&
            input.version !== antes.version
        ) {
            throw new ConflictoVersion('mapeo_extracto', input.cuenta_bancaria_id)
        }
        const formato = input.formato?.trim() || 'personalizado'
        const usuario = usuarioDelActor(t.ctx.actor)
        if (antes) {
            await t.trx
                .from('importacion.extractos_mapeos')
                .where('id', antes.id)
                .update({
                    formato,
                    mapeo: JSON.stringify(input.mapeo),
                    version: antes.version + 1,
                    actualizado_por: usuario,
                    empresa_id: empresaId,
                    updated_at: t.trx.knexRawQuery('now()'),
                })
        } else {
            await t.trx
                .insertQuery()
                .table('importacion.extractos_mapeos')
                .insert({
                    cuenta_bancaria_id: input.cuenta_bancaria_id,
                    empresa_id: empresaId,
                    formato,
                    mapeo: JSON.stringify(input.mapeo),
                    actualizado_por: usuario,
                })
        }
        await t.registrarCambios(
            { tipo: 'cuenta_bancaria', id: Number(cuenta.id) },
            antes ? { mapeo_extracto: antes.mapeo, formato_extracto: antes.formato } : null,
            { mapeo_extracto: input.mapeo, formato_extracto: formato },
        )
        return (await verMapeoGuardado(t.trx, input.cuenta_bancaria_id))!
    }
}
