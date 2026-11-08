import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado } from '#shared/errores'
import { actualizarConVersion } from '#shared/version'
import { redParaAuditoria, verRedIpv4, type RedIpv4Vista } from '#network/consultas/routers'
import { exigirIpsAsignadasDentro, exigirRedSinTraslape, validarRedIpv4 } from '#network/reglas_pools'
import { campo as errorCampo, emitirRedAcceso } from '#network/red_acceso/reglas'
import { refrescarAaaAlConfirmar } from '#core/aaa'
import { emitirRedesCambiadas } from '#network/conexion/tunel_corte'

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
        // sin gateway, la primera IP utilizable es el local-address (`contratos/red-acceso.md` §2): no puede
        // ser la IP de un servicio (solo se revisa si el gateway efectivo cambia, para no frenar datos viejos)
        if (datos.gateway === null && (antes.gateway !== null || cidr !== antes.cidr)) {
            await exigirGatewayDerivadoLibre(t, id, cidr)
        }
        if (cidr !== antes.cidr) await exigirRedSinTraslape(t.trx, cidr, id)
        await exigirIpsAsignadasDentro(t.trx, id, { ...datos, cidr })

        const columnas = Object.fromEntries(Object.entries(cambios).filter(([, v]) => v !== undefined))
        await actualizarConVersion(t.trx, 'network.redes_ipv4', id, version, columnas)
        const despues = await verRedIpv4(id, t.trx)
        await t.registrarCambios({ tipo: 'red_ipv4', id }, redParaAuditoria(antes), redParaAuditoria(despues))
        if (despues.gateway_efectivo !== antes.gateway_efectivo) {
            await avisarLocalAddress(t, id, antes.router_id)
        }
        // Solo el CIDR cambia los AllowedIPs del corte por el túnel (§5 ter.10)
        if (despues.cidr !== antes.cidr) await emitirRedesCambiadas(t, [despues.router_id])
        return despues
    }
}

/**
 * Cambió el gateway: cambia el `local-address` de los servidores PPPoE de la red y de los servicios
 * con IP en ella. Un `red_acceso.cambiada` por servidor (A2 rehace su perfil) y `aaa:user:*` del router.
 */
async function avisarLocalAddress(t: Transaccion, redId: number, routerId: number) {
    const servidores = (await t.trx
        .from('network.servidores_pppoe')
        .where('red_ipv4_id', redId)
        .orderBy('id')
        .select('id', 'empresa_id', 'estado')) as Array<{
        id: number
        empresa_id: number | null
        estado: 'administrado' | 'adoptado'
    }>
    for (const s of servidores) {
        await emitirRedAcceso(t, {
            router_id: routerId,
            empresa_id: s.empresa_id === null ? null : Number(s.empresa_id),
            entidad: 'servidor_pppoe',
            entidad_id: Number(s.id),
            accion: 'editada',
            estado: s.estado,
            campos: ['local_address'],
        })
    }
    refrescarAaaAlConfirmar(t, { routerId })
}

async function exigirGatewayDerivadoLibre(t: Transaccion, redId: number, cidr: string) {
    const { rows } = (await t.trx.rawQuery(
        `SELECT a.servicio_id, host(a.ip) AS ip
           FROM network.ipv4_asignaciones a
          WHERE a.red_id = ? AND a.fin IS NULL
            AND a.ip = CASE WHEN masklen(?::cidr) >= 31 THEN set_masklen(network(?::cidr)::inet, 32)
                            ELSE set_masklen(network(?::cidr)::inet, 32) + 1 END
          LIMIT 1`,
        [redId, cidr, cidr, cidr],
    )) as { rows: Array<{ servicio_id: number; ip: string }> }
    const ocupada = rows[0]
    if (!ocupada) return
    throw errorCampo(
        'gateway',
        `Sin gateway, el local-address de la red es ${ocupada.ip}, que tiene el servicio ${ocupada.servicio_id}: ` +
            'indica un gateway o mueve ese servicio a otra IP',
        'gateway_derivado_ocupado',
    )
}
