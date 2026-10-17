import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto } from '#shared/errores'
import { verZona } from '#core/consultas/clientes'
import { exigirEmpresaActiva } from '#core/empresas'

export interface EntradaCrearZona {
    nombre: string
    /** empresa sugerida para los servicios nuevos de clientes de la zona (multiempresa) */
    empresa_sugerida_id?: number | null
}

/** Zona geográfica o comercial; agrupa clientes y sirve de alcance en el ACL. */
export default class CrearZona extends DomainAction<EntradaCrearZona, Awaited<ReturnType<typeof verZona>>> {
    readonly nombre = 'zonas.crear'

    protected async handle(input: EntradaCrearZona, t: Transaccion) {
        const repetida = await t.trx.from('core.zonas').where('nombre', input.nombre).first()
        if (repetida) throw new Conflicto(`Ya existe la zona ${input.nombre}`, 'zona_duplicada')
        if (input.empresa_sugerida_id) {
            await exigirEmpresaActiva(t.trx, input.empresa_sugerida_id, 'empresa_sugerida_id')
        }
        const [fila] = (await t.trx
            .insertQuery()
            .table('core.zonas')
            .insert({ nombre: input.nombre, empresa_sugerida_id: input.empresa_sugerida_id ?? null })
            .returning('id')) as Array<{ id: number }>
        t.fijarEntidad('zona', fila!.id)
        const zona = await verZona(fila!.id, t.trx)
        await t.registrarCambios({ tipo: 'zona', id: zona.id }, null, zona)
        return zona
    }
}
