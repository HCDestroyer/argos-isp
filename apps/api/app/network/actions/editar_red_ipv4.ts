import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado } from '#shared/errores'
import { actualizarConVersion } from '#shared/version'
import { redParaAuditoria, verRedIpv4, type RedIpv4Vista } from '#network/consultas/routers'
import { exigirIpsAsignadasDentro, exigirRedSinTraslape, validarRedIpv4 } from '#network/reglas_pools'

export interface EntradaEditarRedIpv4 {
    id: number
    version: number
    nombre?: string | null
    cidr?: string
    tipo?: 'estatico' | 'pool'
    gateway?: string | null
    rango_inicio?: string | null
    rango_fin?: string | null
    dns_primario?: string | null
    dns_secundario?: string | null
}

/**
 * Edita una red IPv4 (`contratos/pools.md` §1) con control optimista por `version` (409).
 *
 * - Agrandar o achicar la red, mover el gateway o cambiar el rango: si alguna IP asignada quedaría
 *   fuera (de la red o del rango), sería la dirección de red, el broadcast o el gateway, responde
 *   422 `ips_asignadas_fuera` con la lista en `errors[]` y no cambia nada.
 * - La red nueva no puede traslaparse con otra (409 `red_traslapada`).
 * - Ninguna IP de servicio cambia, así que no emite eventos de servicio: solo auditoría y diff.
 *   Para cambiar de router está `MigrarRedIpv4`.
 */
export default class EditarRedIpv4 extends DomainAction<EntradaEditarRedIpv4, RedIpv4Vista> {
    readonly nombre = 'redes.editar'

    protected async handle(input: EntradaEditarRedIpv4, t: Transaccion): Promise<RedIpv4Vista> {
        const { id, version, ...cambios } = input
        t.fijarEntidad('red_ipv4', id)
        const bloqueada = await t.trx.from('network.redes_ipv4').where('id', id).forUpdate().first()
        if (!bloqueada) throw new NoEncontrado(`La red IPv4 ${id} no existe`)
        const antes = await verRedIpv4(id, t.trx)
        // serializa con las asignaciones del router (`ipam_v4`)
        await t.trx.rawQuery(`SELECT pg_advisory_xact_lock(hashtext('ipam:v4:router:' || ?::text))`, [
            antes.router_id,
        ])

        const valor = <K extends keyof typeof cambios>(campo: K) =>
            cambios[campo] !== undefined
                ? cambios[campo]
                : (antes as unknown as Record<string, unknown>)[campo]
        const datos = {
            cidr: valor('cidr') as string,
            gateway: valor('gateway') as string | null,
            rango_inicio: valor('rango_inicio') as string | null,
            rango_fin: valor('rango_fin') as string | null,
        }
        const cidr = await validarRedIpv4(t.trx, datos)
        if (cidr !== antes.cidr) await exigirRedSinTraslape(t.trx, cidr, id)
        await exigirIpsAsignadasDentro(t.trx, id, { ...datos, cidr })

        const columnas = Object.fromEntries(Object.entries(cambios).filter(([, v]) => v !== undefined))
        await actualizarConVersion(t.trx, 'network.redes_ipv4', id, version, columnas)
        const despues = await verRedIpv4(id, t.trx)
        await t.registrarCambios({ tipo: 'red_ipv4', id }, redParaAuditoria(antes), redParaAuditoria(despues))
        return despues
    }
}
