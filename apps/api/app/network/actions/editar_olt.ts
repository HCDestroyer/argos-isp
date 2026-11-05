import { DomainAction, type Transaccion } from '#shared/domain_action'
import { actualizarConVersion } from '#shared/version'
import { oltParaAuditoria, verOlt, type OltVista } from '#network/red_acceso/consultas'
import {
    camposCambiados,
    emitirRedAcceso,
    exigirEmpresa,
    exigirUnico,
    exigirVisible,
} from '#network/red_acceso/reglas'

export interface EntradaEditarOlt {
    id: number
    version: number
    nombre?: string
    marca?: string | null
    modelo?: string | null
    empresa_id?: number | null
    descripcion?: string | null
    activo?: boolean
}

/** Edita una OLT con control optimista por `version` (409). */
export default class EditarOlt extends DomainAction<EntradaEditarOlt, OltVista> {
    readonly nombre = 'olts.editar'

    protected async handle(input: EntradaEditarOlt, t: Transaccion): Promise<OltVista> {
        const { id, version, ...cambios } = input
        t.fijarEntidad('olt', id)
        const antes = await verOlt(id, t.trx)
        exigirVisible(t.ctx, antes.empresa_id)
        t.fijarEmpresa(antes.empresa_id ?? t.ctx.empresaId ?? null)
        if (cambios.empresa_id !== undefined) exigirEmpresa(t.ctx, cambios.empresa_id)
        if (cambios.nombre) {
            await exigirUnico(
                t.trx,
                'network.olts',
                (q) => q.whereRaw('lower(nombre) = lower(?)', [cambios.nombre]),
                'olt_duplicada',
                `Ya hay una OLT «${cambios.nombre}»`,
                id,
            )
        }
        const columnas = Object.fromEntries(Object.entries(cambios).filter(([, v]) => v !== undefined))
        await actualizarConVersion(t.trx, 'network.olts', id, version, columnas)
        const despues = await verOlt(id, t.trx)
        await t.registrarCambios({ tipo: 'olt', id }, oltParaAuditoria(antes), oltParaAuditoria(despues))
        const campos = camposCambiados(oltParaAuditoria(antes), oltParaAuditoria(despues))
        if (campos.length > 0) {
            await emitirRedAcceso(t, {
                router_id: null,
                empresa_id: despues.empresa_id,
                entidad: 'olt',
                entidad_id: id,
                accion: 'editada',
                estado: null,
                campos,
            })
        }
        return despues
    }
}
