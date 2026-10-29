import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado, ReglaNegocio } from '#shared/errores'
import { actualizarConVersion } from '#shared/version'
import { prefijoNormalizado } from '#network/ipam_v6'
import { bloqueParaAuditoria, verBloque, type BloqueVista } from '#network/consultas/ipv6'
import { exigirBloqueSinTraslape } from '#network/actions/crear_bloque_ipv6'
import { MAXIMO_LISTA } from '#network/reglas_pools'

export interface EntradaEditarBloqueIpv6 {
    id: number
    version: number
    prefijo?: string
    nombre?: string | null
    proveedor?: string | null
}

/**
 * Edita un bloque IPv6 (`contratos/pools.md` §1) con control optimista por `version` (409).
 * Achicar el prefijo dejando fuera algún pool responde 422 `pools_fuera_del_bloque` con la lista;
 * traslaparse con otro bloque, 409. No cambia ningún prefijo de servicio: solo auditoría y diff.
 */
export default class EditarBloqueIpv6 extends DomainAction<EntradaEditarBloqueIpv6, BloqueVista> {
    readonly nombre = 'ipv6.editar'

    protected async handle(input: EntradaEditarBloqueIpv6, t: Transaccion): Promise<BloqueVista> {
        const { id, version, ...cambios } = input
        t.fijarEntidad('ipv6_bloque', id)
        const fila = await t.trx.from('network.ipv6_bloques').where('id', id).forUpdate().first()
        if (!fila) throw new NoEncontrado(`El bloque IPv6 ${id} no existe`)
        const antes = await verBloque(id, t.trx)

        if (cambios.prefijo !== undefined) {
            const prefijo = await prefijoNormalizado(t.trx, cambios.prefijo)
            cambios.prefijo = prefijo
            if (prefijo !== antes.prefijo) {
                await exigirBloqueSinTraslape(t, prefijo, id)
                const fuera = (await t.trx
                    .from('network.ipv6_pools')
                    .where('bloque_id', id)
                    .whereRaw('NOT (prefijo <<= ?::cidr)', [prefijo])
                    .orderBy('prefijo')
                    .select('id', t.trx.raw('prefijo::text AS prefijo'), 'tipo')) as Array<{
                    id: number
                    prefijo: string
                    tipo: string
                }>
                if (fuera.length > 0) {
                    throw new ReglaNegocio(
                        `${fuera.length} pools quedarían fuera del bloque ${prefijo}: achícalos o bórralos antes`,
                        'pools_fuera_del_bloque',
                        fuera.slice(0, MAXIMO_LISTA).map((p) => ({
                            field: 'prefijo',
                            message: `Pool ${p.prefijo} (${p.tipo}) quedaría fuera del bloque`,
                            rule: 'pool',
                        })),
                    )
                }
            }
        }

        const columnas = Object.fromEntries(Object.entries(cambios).filter(([, v]) => v !== undefined))
        await actualizarConVersion(t.trx, 'network.ipv6_bloques', id, version, columnas)
        const despues = await verBloque(id, t.trx)
        await t.registrarCambios(
            { tipo: 'ipv6_bloque', id },
            bloqueParaAuditoria(antes),
            bloqueParaAuditoria(despues),
        )
        return despues
    }
}
