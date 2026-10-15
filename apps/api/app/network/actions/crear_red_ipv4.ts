import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, NoEncontrado, ValidacionFallida } from '#shared/errores'
import { verRedIpv4, type RedIpv4Vista } from '#network/consultas/routers'

export interface EntradaCrearRedIpv4 {
    router_id: number
    cidr: string
    gateway?: string | null
    tipo: 'estatico' | 'pool'
}

/**
 * Agrega una red IPv4 a un router. `estatico`: el sistema asigna IPs fijas a cada servicio
 * (Framed-IP-Address). `pool`: rango del pool del router; también admite asignaciones, pero la
 * asignación automática prefiere las redes `estatico`. Dos redes no pueden traslaparse.
 */
export default class CrearRedIpv4 extends DomainAction<EntradaCrearRedIpv4, RedIpv4Vista> {
    readonly nombre = 'redes.crear'

    protected async handle(input: EntradaCrearRedIpv4, t: Transaccion): Promise<RedIpv4Vista> {
        const router = await t.trx.from('network.routers').where('id', input.router_id).select('id').first()
        if (!router) throw new NoEncontrado(`El router ${input.router_id} no existe`)

        const { rows } = (await t.trx.rawQuery(
            `SELECT network(?::inet)::text AS red, ?::inet <<= network(?::inet) AS gateway_dentro`,
            [input.cidr, input.gateway ?? input.cidr.split('/')[0]!, input.cidr],
        )) as { rows: Array<{ red: string; gateway_dentro: boolean }> }
        const cidr = rows[0]!.red
        if (cidr !== input.cidr) {
            throw new ValidacionFallida([
                { field: 'cidr', message: `La red debe escribirse como ${cidr}`, rule: 'cidr' },
            ])
        }
        if (input.gateway && !rows[0]!.gateway_dentro) {
            throw new ValidacionFallida([
                { field: 'gateway', message: 'El gateway no pertenece a la red', rule: 'gateway' },
            ])
        }

        const traslape = (await t.trx
            .from('network.redes_ipv4')
            .whereRaw('cidr && ?::cidr', [cidr])
            .select(t.trx.raw('cidr::text AS cidr'))
            .first()) as { cidr: string } | null
        if (traslape) throw new Conflicto(`La red se traslapa con ${traslape.cidr}`, 'red_traslapada')

        const [fila] = (await t.trx
            .insertQuery()
            .table('network.redes_ipv4')
            .insert({ router_id: input.router_id, cidr, gateway: input.gateway ?? null, tipo: input.tipo })
            .returning('id')) as Array<{ id: number }>
        t.fijarEntidad('red_ipv4', fila!.id)
        const red = await verRedIpv4(fila!.id, t.trx)
        await t.registrarCambios({ tipo: 'red_ipv4', id: red.id }, null, red)
        return red
    }
}
