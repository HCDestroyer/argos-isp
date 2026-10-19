import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { exigirEmpresaActiva, resolverEmpresaActiva } from '#core/empresas'
import { verAdicional, type AdicionalVista } from '#core/adicionales'

export interface EntradaCrearAdicional {
    /** sin ella, la empresa activa (o la única activa) */
    empresa_id?: number
    codigo: string
    nombre: string
    descripcion?: string | null
    precio_sugerido?: string | null
}

/** 409 `adicional_duplicado` si el código ya existe en la empresa (también entre los inactivos). */
export async function exigirCodigoLibre(t: Transaccion, empresaId: number, codigo: string, salvo?: number) {
    const consulta = t.trx.from('core.adicionales').where({ empresa_id: empresaId, codigo })
    if (salvo) consulta.whereNot('id', salvo)
    if (await consulta.first()) {
        throw new Conflicto(`Ya existe el adicional ${codigo} en la empresa`, 'adicional_duplicado')
    }
}

/**
 * Agrega un servicio adicional (streaming, IPTV…) al catálogo de una empresa
 * (`adicionales.crear`). `codigo` único por empresa; `precio_sugerido` es solo una sugerencia para
 * asignarlo `cobrado`.
 */
export default class CrearAdicional extends DomainAction<EntradaCrearAdicional, AdicionalVista> {
    readonly nombre = 'adicionales.crear'

    protected async handle(input: EntradaCrearAdicional, t: Transaccion): Promise<AdicionalVista> {
        let empresaId: number
        if (input.empresa_id) {
            await exigirEmpresaActiva(t.trx, input.empresa_id)
            exigirAccesoEmpresa(t.ctx, input.empresa_id)
            empresaId = input.empresa_id
        } else {
            empresaId = await resolverEmpresaActiva(t.ctx, t.trx)
        }
        t.fijarEmpresa(empresaId)
        await exigirCodigoLibre(t, empresaId, input.codigo)
        const [fila] = (await t.trx
            .insertQuery()
            .table('core.adicionales')
            .insert({
                empresa_id: empresaId,
                codigo: input.codigo,
                nombre: input.nombre,
                descripcion: input.descripcion ?? null,
                precio_sugerido: input.precio_sugerido ?? null,
            })
            .returning('id')) as Array<{ id: number }>
        const id = Number(fila!.id)
        t.fijarEntidad('adicional', id)
        const adicional = await verAdicional(id, t.trx)
        await t.registrarCambios({ tipo: 'adicional', id }, null, adicional)
        return adicional
    }
}
