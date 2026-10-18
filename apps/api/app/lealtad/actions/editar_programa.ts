import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ConflictoVersion, ValidacionFallida } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { exigirCuentasLealtad } from '#lealtad/comun'
import { camposAuditables, hashTerminos, verPrograma, type ProgramaVista } from '#lealtad/programas'

/**
 * `lealtad.editar_programa` (`PUT /lealtad/programas/:id`, permiso `lealtad.configurar`, con
 * `version`; 409 si cambió). No activa ni desactiva (acciones propias).
 *
 * - `valor_punto`, `canje_esperado_pct` y `vencimiento_meses` aplican a los lotes nuevos: cada
 *   lote conserva el valor y la fecha de vencimiento que recibió al acumular (§6 y §6.1).
 * - Cambiar `terminos` recalcula `terminos_hash` (lo que se publica en el portal).
 * - Encender el diferimiento exige las cuentas del pasivo (422 `cuentas_lealtad_faltantes`).
 * - `audit.cambios` por campo; `lealtad.programa_cambiado` con los campos que cambiaron.
 */

export interface EntradaEditarPrograma {
    id: number
    version: number
    nombre?: string
    valor_punto?: string
    diferimiento?: boolean
    canje_esperado_pct?: string
    vencimiento_meses?: number | null
    aviso_vencimiento_dias?: number
    minimo_canje?: number
    terminos?: string
    vigente_desde?: string
    vigente_hasta?: string | null
}

export default class EditarPrograma extends DomainAction<EntradaEditarPrograma, ProgramaVista> {
    readonly nombre = 'lealtad.editar_programa'

    protected async handle(input: EntradaEditarPrograma, t: Transaccion): Promise<ProgramaVista> {
        t.fijarEntidad('programa_lealtad', input.id)
        const actual = await verPrograma(input.id, t.trx, true)
        exigirAccesoEmpresa(t.ctx, actual.empresa_id)
        t.fijarEmpresa(actual.empresa_id)
        if (actual.version !== input.version) throw new ConflictoVersion('El programa de lealtad', input.id)

        const terminos = input.terminos === undefined ? actual.terminos : input.terminos.trim()
        const despues = {
            nombre: input.nombre?.trim() || actual.nombre,
            valor_punto: input.valor_punto ?? actual.valor_punto,
            diferimiento: input.diferimiento ?? actual.diferimiento,
            canje_esperado_pct: input.canje_esperado_pct ?? actual.canje_esperado_pct,
            vencimiento_meses:
                input.vencimiento_meses === undefined ? actual.vencimiento_meses : input.vencimiento_meses,
            aviso_vencimiento_dias: input.aviso_vencimiento_dias ?? actual.aviso_vencimiento_dias,
            minimo_canje: input.minimo_canje ?? actual.minimo_canje,
            terminos,
            terminos_hash: hashTerminos(terminos),
            vigente_desde: input.vigente_desde ?? actual.vigente_desde,
            vigente_hasta: input.vigente_hasta === undefined ? actual.vigente_hasta : input.vigente_hasta,
        }
        if (despues.vigente_hasta !== null && despues.vigente_hasta < despues.vigente_desde) {
            throw new ValidacionFallida([
                { field: 'vigente_hasta', message: 'vigente_hasta no puede ser anterior a vigente_desde' },
            ])
        }
        if (despues.diferimiento && !actual.diferimiento) await exigirCuentasLealtad(t.trx)

        await t.trx
            .from('lealtad.programas')
            .where('id', actual.id)
            .update({
                ...despues,
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        const editado = await verPrograma(actual.id, t.trx)
        const campos = await t.registrarCambios(
            { tipo: 'programa_lealtad', id: actual.id },
            camposAuditables(actual),
            camposAuditables(editado),
        )
        if (campos.length > 0) {
            await t.emit('lealtad.programa_cambiado', {
                programa_id: actual.id,
                empresa_id: actual.empresa_id,
                campos,
            })
        }
        return editado
    }
}
