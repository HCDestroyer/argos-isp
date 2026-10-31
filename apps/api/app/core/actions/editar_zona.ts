import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto } from '#shared/errores'
import { actualizarConVersion } from '#shared/version'
import { verZona } from '#core/consultas/clientes'
import { exigirEmpresaActiva } from '#core/empresas'

export interface EntradaEditarZona {
    id: number
    version: number
    nombre: string
    /** `null` la quita; ausente no la cambia */
    empresa_sugerida_id?: number | null
}

/**
 * Renombra una zona o cambia su empresa sugerida (control optimista por `version`). Si cambia el
 * nombre emite `catalogo.cambiado` (`catalogo: 'zona'`, `campos: ['nombre']`; pedido A15 de Iris).
 */
export default class EditarZona extends DomainAction<EntradaEditarZona, Awaited<ReturnType<typeof verZona>>> {
    readonly nombre = 'zonas.editar'

    protected async handle(input: EntradaEditarZona, t: Transaccion) {
        t.fijarEntidad('zona', input.id)
        const antes = await verZona(input.id, t.trx)
        const repetida = await t.trx
            .from('core.zonas')
            .where('nombre', input.nombre)
            .whereNot('id', input.id)
            .first()
        if (repetida) throw new Conflicto(`Ya existe la zona ${input.nombre}`, 'zona_duplicada')
        const cambios: Record<string, unknown> = { nombre: input.nombre }
        if (input.empresa_sugerida_id !== undefined) {
            if (input.empresa_sugerida_id && input.empresa_sugerida_id !== antes.empresa_sugerida_id) {
                await exigirEmpresaActiva(t.trx, input.empresa_sugerida_id, 'empresa_sugerida_id')
            }
            cambios.empresa_sugerida_id = input.empresa_sugerida_id
        }
        await actualizarConVersion(t.trx, 'core.zonas', input.id, input.version, cambios)
        const despues = await verZona(input.id, t.trx)
        await t.registrarCambios({ tipo: 'zona', id: input.id }, antes, despues)
        if (despues.nombre !== antes.nombre) {
            await t.emit('catalogo.cambiado', {
                catalogo: 'zona',
                id: input.id,
                empresa_id: despues.empresa_sugerida_id === null ? null : Number(despues.empresa_sugerida_id),
                campos: ['nombre'],
            })
        }
        return despues
    }
}
