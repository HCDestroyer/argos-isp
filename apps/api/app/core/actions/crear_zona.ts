import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto } from '#shared/errores'
import { verZona } from '#core/consultas/clientes'

export interface EntradaCrearZona {
    nombre: string
}

/** Zona geográfica o comercial; agrupa clientes y sirve de alcance en el ACL. */
export default class CrearZona extends DomainAction<EntradaCrearZona, Awaited<ReturnType<typeof verZona>>> {
    readonly nombre = 'zonas.crear'

    protected async handle(input: EntradaCrearZona, t: Transaccion) {
        const repetida = await t.trx.from('core.zonas').where('nombre', input.nombre).first()
        if (repetida) throw new Conflicto(`Ya existe la zona ${input.nombre}`, 'zona_duplicada')
        const [fila] = (await t.trx
            .insertQuery()
            .table('core.zonas')
            .insert({ nombre: input.nombre })
            .returning('id')) as Array<{ id: number }>
        t.fijarEntidad('zona', fila!.id)
        const zona = await verZona(fila!.id, t.trx)
        await t.registrarCambios({ tipo: 'zona', id: zona.id }, null, zona)
        return zona
    }
}
