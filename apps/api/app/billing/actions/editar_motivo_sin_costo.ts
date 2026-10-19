import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, ConflictoVersion, NoEncontrado } from '#shared/errores'
import { verMotivoSinCosto, type MotivoSinCostoVista } from '#billing/cargos_unicos'

/**
 * `motivos_sin_costo.editar` (`PUT /motivos-sin-costo/:id`, con `version`, permiso
 * `facturas.configurar_motivos`): renombra o desactiva (`activo: false`) un motivo. Nunca se borra:
 * las facturas en Q0 siguen apuntando a él. Cada campo queda en `audit.cambios`.
 */

export interface EntradaEditarMotivoSinCosto {
    id: number
    version: number
    nombre?: string
    activo?: boolean
}

interface FilaMotivo {
    id: number
    empresa_id: number
    nombre: string
    activo: boolean
    version: number
}

export default class EditarMotivoSinCosto extends DomainAction<
    EntradaEditarMotivoSinCosto,
    MotivoSinCostoVista
> {
    readonly nombre = 'motivos_sin_costo.editar'

    protected async handle(input: EntradaEditarMotivoSinCosto, t: Transaccion): Promise<MotivoSinCostoVista> {
        t.fijarEntidad('motivo_sin_costo', input.id)
        const previo = (await t.trx
            .from('billing.motivos_sin_costo')
            .where('id', input.id)
            .forUpdate()
            .select('id', 'empresa_id', 'nombre', 'activo', 'version')
            .first()) as FilaMotivo | null
        if (!previo) throw new NoEncontrado(`El motivo sin costo ${input.id} no existe`)
        const empresaId = Number(previo.empresa_id)
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        if (previo.version !== input.version) throw new ConflictoVersion('El motivo sin costo', input.id)

        const despues = {
            nombre: input.nombre?.trim() ?? previo.nombre,
            activo: input.activo ?? previo.activo,
        }
        const repetido = await t.trx
            .from('billing.motivos_sin_costo')
            .where('empresa_id', empresaId)
            .where('nombre', despues.nombre)
            .whereNot('id', previo.id)
            .select('id')
            .first()
        if (repetido) {
            throw new Conflicto(
                `El motivo «${despues.nombre}» ya existe (${repetido.id})`,
                'motivo_sin_costo_duplicado',
                'Motivo duplicado',
            )
        }
        await t.trx
            .from('billing.motivos_sin_costo')
            .where('id', previo.id)
            .update({
                ...despues,
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        await t.registrarCambios(
            { tipo: 'motivo_sin_costo', id: previo.id },
            { nombre: previo.nombre, activo: previo.activo },
            despues,
        )
        return verMotivoSinCosto(previo.id, t.trx)
    }
}
