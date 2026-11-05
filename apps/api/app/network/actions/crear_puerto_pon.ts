import { DomainAction, type Transaccion } from '#shared/domain_action'
import { puertoParaAuditoria, verOlt, verPuertoPon, type PuertoPonVista } from '#network/red_acceso/consultas'
import { emitirRedAcceso, exigirUnico, exigirVisible } from '#network/red_acceso/reglas'

export interface EntradaCrearPuertoPon {
    olt_id: number
    identificador: string
    descripcion?: string | null
}

/** Agrega un puerto PON a una OLT; identificador único por OLT (409 `puerto_duplicado`). */
export default class CrearPuertoPon extends DomainAction<EntradaCrearPuertoPon, PuertoPonVista> {
    readonly nombre = 'olts.editar'

    protected async handle(input: EntradaCrearPuertoPon, t: Transaccion): Promise<PuertoPonVista> {
        const olt = await verOlt(input.olt_id, t.trx)
        exigirVisible(t.ctx, olt.empresa_id)
        t.fijarEmpresa(olt.empresa_id ?? t.ctx.empresaId ?? null)
        await exigirUnico(
            t.trx,
            'network.olt_puertos_pon',
            (q) => q.where('olt_id', input.olt_id).where('identificador', input.identificador),
            'puerto_duplicado',
            `La OLT «${olt.nombre}» ya tiene el puerto ${input.identificador}`,
        )
        const [fila] = (await t.trx
            .insertQuery()
            .table('network.olt_puertos_pon')
            .insert({
                olt_id: input.olt_id,
                identificador: input.identificador,
                descripcion: input.descripcion ?? null,
            })
            .returning('id')) as Array<{ id: number }>
        const id = Number(fila!.id)
        t.fijarEntidad('puerto_pon', id)
        const puerto = await verPuertoPon(id, t.trx)
        await t.registrarCambios({ tipo: 'puerto_pon', id }, null, puertoParaAuditoria(puerto))
        await emitirRedAcceso(t, {
            router_id: null,
            empresa_id: olt.empresa_id,
            entidad: 'puerto_pon',
            entidad_id: id,
            accion: 'creada',
            estado: null,
            campos: [],
        })
        return puerto
    }
}
