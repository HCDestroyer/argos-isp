import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto } from '#shared/errores'
import { actualizarConVersion } from '#shared/version'
import { verZona } from '#core/consultas/clientes'

export interface EntradaEditarZona {
    id: number
    version: number
    nombre: string
}

/** Renombra una zona (control optimista por `version`). */
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
        await actualizarConVersion(t.trx, 'core.zonas', input.id, input.version, { nombre: input.nombre })
        const despues = await verZona(input.id, t.trx)
        await t.registrarCambios({ tipo: 'zona', id: input.id }, antes, despues)
        return despues
    }
}
