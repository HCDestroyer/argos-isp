import { DomainAction, type Transaccion } from '#shared/domain_action'
import { oltParaAuditoria, verOlt, type OltVista } from '#network/red_acceso/consultas'
import { emitirRedAcceso, exigirEmpresa, exigirUnico } from '#network/red_acceso/reglas'

export interface EntradaCrearOlt {
    nombre: string
    marca?: string | null
    modelo?: string | null
    empresa_id?: number | null
    descripcion?: string | null
}

/**
 * Registra una OLT (`contratos/red-acceso.md` §1). Es un dato para ordenar y filtrar: Argos no
 * habla con la OLT. Nombre único (409 `olt_duplicada`); `empresa_id` null = compartida.
 */
export default class CrearOlt extends DomainAction<EntradaCrearOlt, OltVista> {
    readonly nombre = 'olts.crear'

    protected async handle(input: EntradaCrearOlt, t: Transaccion): Promise<OltVista> {
        exigirEmpresa(t.ctx, input.empresa_id)
        await exigirUnico(
            t.trx,
            'network.olts',
            (q) => q.whereRaw('lower(nombre) = lower(?)', [input.nombre]),
            'olt_duplicada',
            `Ya hay una OLT «${input.nombre}»`,
        )
        const [fila] = (await t.trx
            .insertQuery()
            .table('network.olts')
            .insert({
                nombre: input.nombre,
                marca: input.marca ?? null,
                modelo: input.modelo ?? null,
                empresa_id: input.empresa_id ?? null,
                descripcion: input.descripcion ?? null,
            })
            .returning('id')) as Array<{ id: number }>
        const id = Number(fila!.id)
        t.fijarEntidad('olt', id)
        t.fijarEmpresa(input.empresa_id ?? t.ctx.empresaId ?? null)
        const olt = await verOlt(id, t.trx)
        await t.registrarCambios({ tipo: 'olt', id }, null, oltParaAuditoria(olt))
        await emitirRedAcceso(t, {
            router_id: null,
            empresa_id: olt.empresa_id,
            entidad: 'olt',
            entidad_id: id,
            accion: 'creada',
            estado: null,
            campos: [],
        })
        return olt
    }
}
