import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Prohibido } from '#shared/errores'
import { usuarioDelActor } from '#shared/contexto'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import {
    exigirClaveAjuste,
    validarAjuste,
    verAjustesOperacion,
    type AjustesOperacionVista,
} from '#core/ajustes_operacion'

export interface EntradaEditarAjustesOperacion {
    /** null/ausente = globales (requiere alcance global) */
    empresa_id?: number | null
    /** clave → valor; `null` borra el valor guardado (vuelve al global o al de fábrica) */
    valores: Record<string, unknown>
}

/**
 * Cambia ajustes de operación (`ajustes_operacion.editar`): globales o de una empresa (solo las claves
 * que lo admiten). Valida cada valor contra su definición (422 por campo). Deja el diff por clave en
 * `audit.cambios` (entidad `ajustes_operacion`, id = empresa o 0) y emite `operacion.config_cambiada`
 * con los nombres de las claves que cambiaron. Sin cambios reales no emite.
 */
export default class EditarAjustesOperacion extends DomainAction<
    EntradaEditarAjustesOperacion,
    AjustesOperacionVista
> {
    readonly nombre = 'ajustes_operacion.editar'

    protected async handle(
        input: EntradaEditarAjustesOperacion,
        t: Transaccion,
    ): Promise<AjustesOperacionVista> {
        const empresaId = input.empresa_id ?? null
        if (empresaId === null) {
            if (t.ctx.empresasPermitidas !== null && t.ctx.empresasPermitidas !== undefined) {
                throw new Prohibido('Los ajustes globales requieren alcance global')
            }
        } else {
            exigirAccesoEmpresa(t.ctx, empresaId)
        }
        t.fijarEmpresa(empresaId)
        t.fijarEntidad('ajustes_operacion', empresaId ?? 0)
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(4110, ?::int)', [empresaId ?? 0])

        const antes = await verAjustesOperacion(empresaId, t.trx)
        const guardados = empresaId === null ? antes.global : antes.empresa
        const cambiadas: string[] = []
        const diffAntes: Record<string, unknown> = {}
        const diffDespues: Record<string, unknown> = {}
        for (const [clave, crudo] of Object.entries(input.valores)) {
            const actual = (guardados as Record<string, unknown>)[clave] ?? null
            if (crudo === null) {
                exigirClaveAjuste(clave, empresaId !== null)
                if (actual === null) continue
                const borrar = t.trx.from('core.ajustes_operacion').where('clave', clave)
                if (empresaId === null) borrar.whereNull('empresa_id')
                else borrar.where('empresa_id', empresaId)
                await borrar.delete()
            } else {
                const valor = validarAjuste(clave, crudo, empresaId !== null)
                if (actual === valor) continue
                await t.trx.rawQuery(
                    `INSERT INTO core.ajustes_operacion (empresa_id, clave, valor, actualizado_por)
                     VALUES (?, ?, ?::jsonb, ?)
                     ON CONFLICT (clave, coalesce(empresa_id, 0))
                     DO UPDATE SET valor = EXCLUDED.valor, actualizado_por = EXCLUDED.actualizado_por,
                                   version = core.ajustes_operacion.version + 1, updated_at = now()`,
                    [empresaId, clave, JSON.stringify(valor), usuarioDelActor(t.ctx.actor)] as never,
                )
            }
            cambiadas.push(clave)
            diffAntes[clave] = actual
            diffDespues[clave] = crudo
        }
        if (cambiadas.length > 0) {
            await t.registrarCambios(
                { tipo: 'ajustes_operacion', id: empresaId ?? 0 },
                diffAntes,
                diffDespues,
            )
            await t.emit('operacion.config_cambiada', { empresa_id: empresaId, claves: cambiadas })
        }
        return verAjustesOperacion(empresaId, t.trx)
    }
}
