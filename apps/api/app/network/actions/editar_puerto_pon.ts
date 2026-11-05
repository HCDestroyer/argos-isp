import { DomainAction, type Transaccion } from '#shared/domain_action'
import { actualizarConVersion } from '#shared/version'
import { puertoParaAuditoria, verOlt, verPuertoPon, type PuertoPonVista } from '#network/red_acceso/consultas'
import { camposCambiados, emitirRedAcceso, exigirUnico, exigirVisible } from '#network/red_acceso/reglas'

export interface EntradaEditarPuertoPon {
    id: number
    version: number
    identificador?: string
    descripcion?: string | null
}

/** Edita un puerto PON (control optimista por `version`). */
export default class EditarPuertoPon extends DomainAction<EntradaEditarPuertoPon, PuertoPonVista> {
    readonly nombre = 'olts.editar'

    protected async handle(input: EntradaEditarPuertoPon, t: Transaccion): Promise<PuertoPonVista> {
        const { id, version, ...cambios } = input
        t.fijarEntidad('puerto_pon', id)
        const antes = await verPuertoPon(id, t.trx)
        const olt = await verOlt(antes.olt_id, t.trx)
        exigirVisible(t.ctx, olt.empresa_id)
        t.fijarEmpresa(olt.empresa_id ?? t.ctx.empresaId ?? null)
        if (cambios.identificador) {
            await exigirUnico(
                t.trx,
                'network.olt_puertos_pon',
                (q) => q.where('olt_id', antes.olt_id).where('identificador', cambios.identificador),
                'puerto_duplicado',
                `La OLT «${olt.nombre}» ya tiene el puerto ${cambios.identificador}`,
                id,
            )
        }
        const columnas = Object.fromEntries(Object.entries(cambios).filter(([, v]) => v !== undefined))
        await actualizarConVersion(t.trx, 'network.olt_puertos_pon', id, version, columnas)
        const despues = await verPuertoPon(id, t.trx)
        await t.registrarCambios(
            { tipo: 'puerto_pon', id },
            puertoParaAuditoria(antes),
            puertoParaAuditoria(despues),
        )
        const campos = camposCambiados(puertoParaAuditoria(antes), puertoParaAuditoria(despues))
        if (campos.length > 0) {
            await emitirRedAcceso(t, {
                router_id: null,
                empresa_id: olt.empresa_id,
                entidad: 'puerto_pon',
                entidad_id: id,
                accion: 'editada',
                estado: null,
                campos,
            })
        }
        return despues
    }
}
