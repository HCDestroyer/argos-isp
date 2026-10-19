import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { exigirEmpresaActiva, resolverEmpresaActiva } from '#core/empresas'
import { verMotivoCortesia, type MotivoCortesiaVista } from '#core/adicionales'

export interface EntradaCrearMotivoCortesia {
    /** sin ella, la empresa activa (o la única activa) */
    empresa_id?: number
    codigo: string
    nombre: string
}

/**
 * Agrega un motivo de cortesía propio de una empresa (`adicionales.crear_motivo`). Los cinco
 * comunes (promoción, cortesía, garantía, compensación por falla, convenio) vienen de la
 * migración. 409 `motivo_duplicado` si el código ya existe en la empresa o entre los comunes.
 */
export default class CrearMotivoCortesia extends DomainAction<
    EntradaCrearMotivoCortesia,
    MotivoCortesiaVista
> {
    readonly nombre = 'adicionales.crear_motivo'

    protected async handle(input: EntradaCrearMotivoCortesia, t: Transaccion): Promise<MotivoCortesiaVista> {
        let empresaId: number
        if (input.empresa_id) {
            await exigirEmpresaActiva(t.trx, input.empresa_id)
            exigirAccesoEmpresa(t.ctx, input.empresa_id)
            empresaId = input.empresa_id
        } else {
            empresaId = await resolverEmpresaActiva(t.ctx, t.trx)
        }
        t.fijarEmpresa(empresaId)
        const repetido = await t.trx
            .from('core.motivos_cortesia')
            .where('codigo', input.codigo)
            .where((q) => q.whereNull('empresa_id').orWhere('empresa_id', empresaId))
            .first()
        if (repetido) throw new Conflicto(`Ya existe el motivo ${input.codigo}`, 'motivo_duplicado')
        const [fila] = (await t.trx
            .insertQuery()
            .table('core.motivos_cortesia')
            .insert({ empresa_id: empresaId, codigo: input.codigo, nombre: input.nombre })
            .returning('id')) as Array<{ id: number }>
        const id = Number(fila!.id)
        t.fijarEntidad('motivo_cortesia', id)
        const motivo = await verMotivoCortesia(id, t.trx)
        await t.registrarCambios({ tipo: 'motivo_cortesia', id }, null, motivo)
        return motivo
    }
}
