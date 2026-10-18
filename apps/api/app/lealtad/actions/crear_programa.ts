import { DomainAction, type Transaccion } from '#shared/domain_action'
import { hoyGuatemala } from '#ledger/fechas'
import { empresaLealtad, exigirCuentasLealtad } from '#lealtad/comun'
import { camposAuditables, hashTerminos, verPrograma, type ProgramaVista } from '#lealtad/programas'

/**
 * `lealtad.crear_programa` (`POST /lealtad/programas`, permiso `lealtad.configurar`): programa de
 * la empresa (`empresa_id` o la activa), **inactivo** hasta `lealtad.activar_programa`.
 *
 * Por defecto (decisiones del PM, contrato §6 y §6.1): `diferimiento = false` (los puntos son un
 * indicador, sin asientos), `canje_esperado_pct = 100`, `vencimiento_meses = 12` (`null` = no
 * vencen), aviso 30 días antes. Con diferimiento exige las cuentas `2.1.10`, `4.1.05` y `4.1.06`
 * (422 `cuentas_lealtad_faltantes`). `audit.cambios` y `lealtad.programa_cambiado`.
 */

export interface EntradaCrearPrograma {
    empresa_id?: number | null
    nombre: string
    valor_punto: string
    diferimiento?: boolean
    canje_esperado_pct?: string
    vencimiento_meses?: number | null
    aviso_vencimiento_dias?: number
    minimo_canje?: number
    terminos?: string
    vigente_desde?: string
    vigente_hasta?: string | null
}

export default class CrearPrograma extends DomainAction<EntradaCrearPrograma, ProgramaVista> {
    readonly nombre = 'lealtad.crear_programa'

    protected async handle(input: EntradaCrearPrograma, t: Transaccion): Promise<ProgramaVista> {
        const empresaId = await empresaLealtad(t, input.empresa_id)
        const diferimiento = input.diferimiento ?? false
        if (diferimiento) await exigirCuentasLealtad(t.trx)
        const terminos = input.terminos?.trim() ?? ''
        const [fila] = (await t.trx
            .insertQuery()
            .table('lealtad.programas')
            .insert({
                empresa_id: empresaId,
                nombre: input.nombre.trim(),
                activo: false,
                valor_punto: input.valor_punto,
                diferimiento,
                canje_esperado_pct: input.canje_esperado_pct ?? '100',
                vencimiento_meses: input.vencimiento_meses === undefined ? 12 : input.vencimiento_meses,
                aviso_vencimiento_dias: input.aviso_vencimiento_dias ?? 30,
                minimo_canje: input.minimo_canje ?? 0,
                terminos,
                terminos_hash: hashTerminos(terminos),
                vigente_desde: input.vigente_desde ?? hoyGuatemala(),
                vigente_hasta: input.vigente_hasta ?? null,
            })
            .returning('id')) as Array<{ id: number }>
        const programa = await verPrograma(Number(fila!.id), t.trx)
        t.fijarEntidad('programa_lealtad', programa.id)
        const campos = await t.registrarCambios(
            { tipo: 'programa_lealtad', id: programa.id },
            null,
            camposAuditables(programa),
        )
        await t.emit('lealtad.programa_cambiado', { programa_id: programa.id, empresa_id: empresaId, campos })
        return programa
    }
}
