import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ConflictoVersion, ValidacionFallida } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { camposAuditables, verRegla, type PeriodoTope, type ReglaVista } from '#lealtad/reglas'
import { validarCondiciones } from '#lealtad/validators'
import { validarRecompensa, validarTope } from '#lealtad/actions/crear_regla'

/**
 * `lealtad.editar_regla` (`PUT /lealtad/reglas/:id`, permiso `lealtad.configurar`, con `version`).
 * El `tipo` y el programa no cambian. Una regla no se borra: `activa: false` la desactiva (lo ya
 * otorgado queda, y sus reversos siguen funcionando). Cambiar `puntos` o `condiciones` aplica a los
 * otorgamientos nuevos. `audit.cambios` por campo y `lealtad.programa_cambiado` (`reglas`).
 */

export interface EntradaEditarRegla {
    id: number
    version: number
    condiciones?: Record<string, unknown>
    recompensa?: string
    puntos?: number
    tope_por_cliente?: number | null
    periodo_tope?: PeriodoTope | null
    activa?: boolean
    vigente_desde?: string
    vigente_hasta?: string | null
}

export default class EditarRegla extends DomainAction<EntradaEditarRegla, ReglaVista> {
    readonly nombre = 'lealtad.editar_regla'

    protected async handle(input: EntradaEditarRegla, t: Transaccion): Promise<ReglaVista> {
        t.fijarEntidad('regla_lealtad', input.id)
        const actual = await verRegla(input.id, t.trx, true)
        exigirAccesoEmpresa(t.ctx, actual.empresa_id)
        t.fijarEmpresa(actual.empresa_id)
        if (actual.version !== input.version) throw new ConflictoVersion('La regla de lealtad', input.id)
        validarRecompensa(input.recompensa)

        const condiciones =
            input.condiciones === undefined
                ? actual.condiciones
                : await validarCondiciones(actual.tipo, { ...actual.condiciones, ...input.condiciones })
        const tope = input.tope_por_cliente === undefined ? actual.tope_por_cliente : input.tope_por_cliente
        const periodo = input.periodo_tope === undefined ? actual.periodo_tope : input.periodo_tope
        validarTope(tope, periodo)
        const vigenteDesde = input.vigente_desde ?? actual.vigente_desde
        const vigenteHasta = input.vigente_hasta === undefined ? actual.vigente_hasta : input.vigente_hasta
        if (vigenteHasta !== null && vigenteHasta < vigenteDesde) {
            throw new ValidacionFallida([
                { field: 'vigente_hasta', message: 'vigente_hasta no puede ser anterior a vigente_desde' },
            ])
        }

        await t.trx
            .from('lealtad.reglas')
            .where('id', actual.id)
            .update({
                condiciones: JSON.stringify(condiciones),
                puntos: input.puntos ?? actual.puntos,
                tope_por_cliente: tope,
                periodo_tope: periodo,
                activa: input.activa ?? actual.activa,
                vigente_desde: vigenteDesde,
                vigente_hasta: vigenteHasta,
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            })
        const editada = await verRegla(actual.id, t.trx)
        const campos = await t.registrarCambios(
            { tipo: 'regla_lealtad', id: actual.id },
            camposAuditables(actual),
            camposAuditables(editada),
        )
        if (campos.length > 0) {
            await t.emit('lealtad.programa_cambiado', {
                programa_id: actual.programa_id,
                empresa_id: actual.empresa_id,
                campos: ['reglas'],
            })
        }
        return editada
    }
}
