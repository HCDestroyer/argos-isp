import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { exigirEmpresaActiva, resolverEmpresaActiva } from '#core/empresas'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto } from '#shared/errores'
import { verMotivoSinCosto, type MotivoSinCostoVista } from '#billing/cargos_unicos'

/**
 * `motivos_sin_costo.crear` (`POST /motivos-sin-costo`, permiso `facturas.configurar_motivos`):
 * agrega un motivo al catálogo de facturas en Q0 de una empresa (la indicada o la activa). 409
 * `motivo_sin_costo_duplicado` si el nombre ya existe en esa empresa. Queda en `audit.cambios`.
 */

export interface EntradaMotivoSinCosto {
    empresa_id?: number | null
    nombre: string
    activo?: boolean
}

export default class CrearMotivoSinCosto extends DomainAction<EntradaMotivoSinCosto, MotivoSinCostoVista> {
    readonly nombre = 'motivos_sin_costo.crear'

    protected async handle(input: EntradaMotivoSinCosto, t: Transaccion): Promise<MotivoSinCostoVista> {
        let empresaId: number
        if (input.empresa_id) {
            await exigirEmpresaActiva(t.trx, input.empresa_id)
            empresaId = input.empresa_id
        } else {
            empresaId = await resolverEmpresaActiva(t.ctx, t.trx)
        }
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        const nombre = input.nombre.trim()
        const repetido = await t.trx
            .from('billing.motivos_sin_costo')
            .where('empresa_id', empresaId)
            .where('nombre', nombre)
            .select('id')
            .first()
        if (repetido) {
            throw new Conflicto(
                `El motivo «${nombre}» ya existe (${repetido.id})`,
                'motivo_sin_costo_duplicado',
                'Motivo duplicado',
            )
        }
        const [fila] = (await t.trx
            .insertQuery()
            .table('billing.motivos_sin_costo')
            .insert({ empresa_id: empresaId, nombre, activo: input.activo ?? true })
            .returning('id')) as Array<{ id: number }>
        const creado = await verMotivoSinCosto(fila!.id, t.trx)
        t.fijarEntidad('motivo_sin_costo', creado.id)
        await t.registrarCambios({ tipo: 'motivo_sin_costo', id: creado.id }, null, {
            empresa_id: creado.empresa_id,
            nombre: creado.nombre,
            activo: creado.activo,
        })
        return creado
    }
}
