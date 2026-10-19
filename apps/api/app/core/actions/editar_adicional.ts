import { DomainAction, type Transaccion } from '#shared/domain_action'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { actualizarConVersion } from '#shared/version'
import { verAdicional, type AdicionalVista } from '#core/adicionales'
import { exigirCodigoLibre } from '#core/actions/crear_adicional'

export interface EntradaEditarAdicional {
    id: number
    version: number
    codigo?: string
    nombre?: string
    descripcion?: string | null
    precio_sugerido?: string | null
}

/**
 * Edita un adicional del catálogo (`adicionales.editar`, control optimista por `version`). No
 * cambia su empresa ni su estado (desactivar es su propia acción). Las asignaciones vigentes no
 * cambian: el `precio` de un `cobrado` es el de su asignación, no el sugerido.
 */
export default class EditarAdicional extends DomainAction<EntradaEditarAdicional, AdicionalVista> {
    readonly nombre = 'adicionales.editar'

    protected async handle(input: EntradaEditarAdicional, t: Transaccion): Promise<AdicionalVista> {
        const { id, version, ...datos } = input
        t.fijarEntidad('adicional', id)
        const antes = await verAdicional(id, t.trx)
        t.fijarEmpresa(antes.empresa_id)
        exigirAccesoEmpresa(t.ctx, antes.empresa_id)
        if (datos.codigo !== undefined && datos.codigo !== antes.codigo) {
            await exigirCodigoLibre(t, antes.empresa_id, datos.codigo, id)
        }
        const cambios = Object.fromEntries(Object.entries(datos).filter(([, valor]) => valor !== undefined))
        await actualizarConVersion(t.trx, 'core.adicionales', id, version, cambios)
        const despues = await verAdicional(id, t.trx)
        await t.registrarCambios({ tipo: 'adicional', id }, antes, despues)
        return despues
    }
}
