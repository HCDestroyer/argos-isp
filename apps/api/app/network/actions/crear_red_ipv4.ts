import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado } from '#shared/errores'
import { redParaAuditoria, verRedIpv4, type RedIpv4Vista } from '#network/consultas/routers'
import { exigirRedSinTraslape, validarRedIpv4 } from '#network/reglas_pools'

export interface EntradaCrearRedIpv4 {
    router_id: number
    cidr: string
    tipo: 'estatico' | 'pool'
    nombre?: string | null
    gateway?: string | null
    rango_inicio?: string | null
    rango_fin?: string | null
    dns_primario?: string | null
    dns_secundario?: string | null
}

/**
 * Agrega una red IPv4 a un router. `estatico`: el sistema asigna IPs fijas a cada servicio
 * (Framed-IP-Address). `pool`: rango del pool del router; también admite asignaciones, pero la
 * asignación automática prefiere las redes `estatico`. Dos redes no pueden traslaparse (409).
 * Con `rango_inicio`/`rango_fin` solo se entregan IPs de ese rango; el resto queda reservado
 * (`contratos/pools.md` §1).
 */
export default class CrearRedIpv4 extends DomainAction<EntradaCrearRedIpv4, RedIpv4Vista> {
    readonly nombre = 'redes.crear'

    protected async handle(input: EntradaCrearRedIpv4, t: Transaccion): Promise<RedIpv4Vista> {
        const router = await t.trx.from('network.routers').where('id', input.router_id).select('id').first()
        if (!router) throw new NoEncontrado(`El router ${input.router_id} no existe`)

        const cidr = await validarRedIpv4(t.trx, {
            cidr: input.cidr,
            gateway: input.gateway ?? null,
            rango_inicio: input.rango_inicio ?? null,
            rango_fin: input.rango_fin ?? null,
        })
        await exigirRedSinTraslape(t.trx, cidr)

        const [fila] = (await t.trx
            .insertQuery()
            .table('network.redes_ipv4')
            .insert({
                router_id: input.router_id,
                cidr,
                tipo: input.tipo,
                nombre: input.nombre ?? null,
                gateway: input.gateway ?? null,
                rango_inicio: input.rango_inicio ?? null,
                rango_fin: input.rango_fin ?? null,
                dns_primario: input.dns_primario ?? null,
                dns_secundario: input.dns_secundario ?? null,
            })
            .returning('id')) as Array<{ id: number }>
        t.fijarEntidad('red_ipv4', fila!.id)
        const red = await verRedIpv4(fila!.id, t.trx)
        await t.registrarCambios({ tipo: 'red_ipv4', id: red.id }, null, redParaAuditoria(red))
        return red
    }
}
