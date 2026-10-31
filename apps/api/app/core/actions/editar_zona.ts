import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto } from '#shared/errores'
import { actualizarConVersion } from '#shared/version'
import { verZona } from '#core/consultas/clientes'
import { exigirEmpresaActiva } from '#core/empresas'
import type { CampoCatalogoCambiado } from '#shared/eventos'

export interface EntradaEditarZona {
    id: number
    version: number
    nombre: string
    /** `null` la quita; ausente no la cambia */
    empresa_sugerida_id?: number | null
    /** desactivar (`false`) o reactivar (`true`); ausente no la cambia */
    activo?: boolean
}

/**
 * Renombra una zona, cambia su empresa sugerida o la desactiva y reactiva (control optimista por
 * `version`). Si cambia el nombre o `activo` emite `catalogo.cambiado` (`catalogo: 'zona'`,
 * `campos` con `nombre` y/o `activo`; contrato Iris 0.5.0, pedido A15). Desactivar una zona no
 * toca a sus clientes ni routers: solo deja de ofrecerse en el panel (`GET /zonas?activo=true`).
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
        if (input.activo !== undefined) cambios.activo = input.activo
        await actualizarConVersion(t.trx, 'core.zonas', input.id, input.version, cambios)
        const despues = await verZona(input.id, t.trx)
        await t.registrarCambios({ tipo: 'zona', id: input.id }, antes, despues)
        const campos: CampoCatalogoCambiado[] = []
        if (despues.nombre !== antes.nombre) campos.push('nombre')
        if (despues.activo !== antes.activo) campos.push('activo')
        if (campos.length > 0) {
            await t.emit('catalogo.cambiado', {
                catalogo: 'zona',
                id: input.id,
                empresa_id: despues.empresa_sugerida_id === null ? null : Number(despues.empresa_sugerida_id),
                campos,
            })
        }
        return despues
    }
}
