import type { Transaccion } from '#shared/domain_action'
import {
    ConflictoVersion,
    NoEncontrado,
    Problema,
    ReglaNegocio,
    ValidacionFallida,
    type ErrorCampo,
} from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { asignacionesVigentes, type Asignaciones } from '#core/asignaciones_servicio'
import EditarServicio from '#core/actions/editar_servicio'
import { redParaAuditoria, verRedIpv4, type RedIpv4Vista } from '#network/consultas/routers'
import { bloqueParaAuditoria, verBloque, type BloqueVista } from '#network/consultas/ipv6'
import { MAXIMO_LISTA } from '#network/reglas_pools'

/**
 * Migración de pools a otro router (`contratos/pools.md` §3): una red IPv4 o un bloque IPv6 (con
 * todos sus pools), y opcionalmente otras redes y bloques del mismo router en la misma operación.
 *
 * Regla segura: un servicio nunca queda en un router distinto al de sus direcciones.
 * - Sin `mover_servicios`, si algún servicio vigente usa direcciones de lo que se migra, responde
 *   422 `pool_con_servicios` con la lista y no cambia nada.
 * - Con `mover_servicios`, cada servicio pasa al router de destino con `EditarServicio` (anidada:
 *   auditoría, diff, `servicio.config_cambiada` con `router`, `asignacion.cambiada` si cambió alguna
 *   dirección, aaa write-through y RouterOS por evento). Conserva las direcciones de lo que se
 *   migra; las demás (p. ej. su IPv6 si solo se migra la red IPv4) se vuelven a reservar en el
 *   router de destino con las reglas de siempre. Si un servicio no puede pasar (plan no disponible
 *   en el destino, sin pool o sin direcciones libres), responde 422 `servicio_no_migrable` y no
 *   cambia nada.
 * - `simular` corre todo y lo revierte: devuelve lo que pasaría.
 */

export interface EntradaMigrarPools {
    principal: { tipo: 'red_ipv4' | 'ipv6_bloque'; id: number; version: number }
    redes_ipv4: number[]
    bloques_ipv6: number[]
    router_id: number
    mover_servicios: boolean
}

export interface ServicioMigrado {
    servicio_id: number
    user_ppp: string | null
    antes: Asignaciones & { router_id: number }
    despues: Asignaciones & { router_id: number }
}

export interface ResultadoMigracion {
    router_origen_id: number
    router_destino_id: number
    redes_ipv4: RedIpv4Vista[]
    bloques_ipv6: BloqueVista[]
    servicios: ServicioMigrado[]
    simulado: boolean
}

interface FilaPool {
    id: number
    router_id: number
    version: number
}

async function bloquear(t: Transaccion, tabla: string, ids: number[]): Promise<FilaPool[]> {
    if (ids.length === 0) return []
    return (await t.trx
        .from(tabla)
        .whereIn('id', ids)
        .orderBy('id')
        .forUpdate()
        .select('id', 'router_id', 'version')) as FilaPool[]
}

export async function migrarPools(t: Transaccion, entrada: EntradaMigrarPools): Promise<ResultadoMigracion> {
    const { principal } = entrada
    const redesIds = [
        ...new Set(
            principal.tipo === 'red_ipv4' ? [principal.id, ...entrada.redes_ipv4] : entrada.redes_ipv4,
        ),
    ]
    const bloquesIds = [
        ...new Set(
            principal.tipo === 'ipv6_bloque' ? [principal.id, ...entrada.bloques_ipv6] : entrada.bloques_ipv6,
        ),
    ]
    t.fijarEntidad(principal.tipo, principal.id)

    const redes = await bloquear(t, 'network.redes_ipv4', redesIds)
    const bloques = await bloquear(t, 'network.ipv6_bloques', bloquesIds)
    const filaPrincipal = (principal.tipo === 'red_ipv4' ? redes : bloques).find((f) => f.id === principal.id)
    if (!filaPrincipal) {
        throw new NoEncontrado(
            principal.tipo === 'red_ipv4'
                ? `La red IPv4 ${principal.id} no existe`
                : `El bloque IPv6 ${principal.id} no existe`,
        )
    }
    const origen = Number(filaPrincipal.router_id)

    const errores: ErrorCampo[] = []
    for (const id of redesIds) {
        const fila = redes.find((r) => r.id === id)
        if (!fila) {
            errores.push({ field: 'redes_ipv4', message: `La red IPv4 ${id} no existe`, rule: 'exists' })
        } else if (Number(fila.router_id) !== origen) {
            errores.push({
                field: 'redes_ipv4',
                message: `La red IPv4 ${id} es de otro router: solo se migran juntas las del mismo router`,
                rule: 'router',
            })
        }
    }
    for (const id of bloquesIds) {
        const fila = bloques.find((b) => b.id === id)
        if (!fila) {
            errores.push({ field: 'bloques_ipv6', message: `El bloque IPv6 ${id} no existe`, rule: 'exists' })
        } else if (Number(fila.router_id) !== origen) {
            errores.push({
                field: 'bloques_ipv6',
                message: `El bloque IPv6 ${id} es de otro router: solo se migran juntos los del mismo router`,
                rule: 'router',
            })
        }
    }
    if (errores.length > 0) throw new ValidacionFallida(errores, errores[0]!.message)
    if (Number(filaPrincipal.version) !== principal.version) {
        throw new ConflictoVersion(
            principal.tipo === 'red_ipv4' ? 'network.redes_ipv4' : 'network.ipv6_bloques',
            principal.id,
        )
    }

    const destino = (await t.trx
        .from('network.routers')
        .where('id', entrada.router_id)
        .select('id', 'nombre', 'activo')
        .first()) as { id: number; nombre: string; activo: boolean } | null
    if (!destino) {
        throw new ValidacionFallida([
            { field: 'router_id', message: 'El router de destino no existe', rule: 'exists' },
        ])
    }
    if (destino.id === origen) {
        throw new ValidacionFallida([
            { field: 'router_id', message: 'El pool ya es de ese router', rule: 'distinto' },
        ])
    }
    if (!destino.activo) {
        throw new ReglaNegocio(`El router ${destino.nombre} está desactivado`, 'router_inactivo')
    }

    // serializa con las asignaciones de ambos routers y de los pools que se mudan (`ipam_v4`, `ipam_v6`)
    for (const router of [origen, destino.id].sort((a, b) => a - b)) {
        await t.trx.rawQuery(`SELECT pg_advisory_xact_lock(hashtext('ipam:v4:router:' || ?::text))`, [router])
    }
    const pools = bloquesIds.length
        ? ((await t.trx
              .from('network.ipv6_pools')
              .whereIn('bloque_id', bloquesIds)
              .orderBy('id')
              .select('id')) as Array<{ id: number }>)
        : []
    for (const pool of pools) {
        await t.trx.rawQuery(`SELECT pg_advisory_xact_lock(hashtext('ipam:v6:pool:' || ?::text))`, [pool.id])
    }

    const servicios = await serviciosAfectados(t, redesIds, bloquesIds)
    if (servicios.length > 0 && !entrada.mover_servicios) {
        throw new ReglaNegocio(
            `${servicios.length} servicios usan direcciones de lo que se migra: ` +
                `pásalos también al router ${destino.nombre} (mover_servicios) o cámbialos antes`,
            'pool_con_servicios',
            servicios.slice(0, MAXIMO_LISTA).map((s) => ({
                field: 'mover_servicios',
                message: `Servicio ${s.id}${s.user_ppp ? ` (${s.user_ppp})` : ''}: ${s.direcciones.join(', ')}`,
                rule: 'servicio',
            })),
        )
    }

    for (const fila of redes) {
        const antes = await verRedIpv4(fila.id, t.trx)
        await t.trx
            .from('network.redes_ipv4')
            .where('id', fila.id)
            .update({
                router_id: destino.id,
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        const despues = await verRedIpv4(fila.id, t.trx)
        await t.registrarCambios(
            { tipo: 'red_ipv4', id: fila.id },
            redParaAuditoria(antes),
            redParaAuditoria(despues),
        )
    }
    for (const fila of bloques) {
        const antes = await verBloque(fila.id, t.trx)
        await t.trx
            .from('network.ipv6_bloques')
            .where('id', fila.id)
            .update({
                router_id: destino.id,
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        const despues = await verBloque(fila.id, t.trx)
        await t.registrarCambios(
            { tipo: 'ipv6_bloque', id: fila.id },
            bloqueParaAuditoria(antes),
            bloqueParaAuditoria(despues),
        )
    }

    const migrados: ServicioMigrado[] = []
    for (const servicio of servicios) {
        exigirAccesoEmpresa(t.ctx, servicio.empresa_id)
        const antes = await asignacionesVigentes(t.trx, servicio.id)
        if (servicio.router_id !== destino.id) {
            // conserva la IPv4 si es de una red que se muda; si no, el destino asigna la suya
            const ipv4 = servicio.red_ipv4_id !== null && redesIds.includes(servicio.red_ipv4_id)
            try {
                await new EditarServicio().execute(
                    {
                        id: servicio.id,
                        version: servicio.version,
                        router_id: destino.id,
                        ...(ipv4 && antes.ipv4 ? { ipv4: antes.ipv4 } : {}),
                    },
                    t.ctx,
                    { trx: t.trx },
                )
            } catch (error) {
                if (!(error instanceof Problema)) throw error
                throw new ReglaNegocio(
                    `El servicio ${servicio.id}${servicio.user_ppp ? ` (${servicio.user_ppp})` : ''} no puede ` +
                        `pasar al router ${destino.nombre}: ${error.detalle ?? error.titulo}`,
                    'servicio_no_migrable',
                    error.errores,
                )
            }
        }
        migrados.push({
            servicio_id: servicio.id,
            user_ppp: servicio.user_ppp,
            antes: { ...antes, router_id: servicio.router_id },
            despues: { ...(await asignacionesVigentes(t.trx, servicio.id)), router_id: destino.id },
        })
    }

    return {
        router_origen_id: origen,
        router_destino_id: destino.id,
        redes_ipv4: await Promise.all(redesIds.map((id) => verRedIpv4(id, t.trx))),
        bloques_ipv6: await Promise.all(bloquesIds.map((id) => verBloque(id, t.trx))),
        servicios: migrados,
        simulado: false,
    }
}

interface ServicioAfectado {
    id: number
    version: number
    router_id: number
    empresa_id: number
    user_ppp: string | null
    red_ipv4_id: number | null
    direcciones: string[]
}

/** Servicios con alguna dirección vigente de las redes o de los bloques (sus pools o estáticos). */
async function serviciosAfectados(
    t: Transaccion,
    redes: number[],
    bloques: number[],
): Promise<ServicioAfectado[]> {
    const { rows } = (await t.trx.rawQuery(
        `WITH dir AS (
            SELECT a.servicio_id, host(a.ip) AS direccion, a.red_id
              FROM network.ipv4_asignaciones a
             WHERE a.fin IS NULL AND a.red_id = ANY(?::bigint[])
            UNION ALL
            SELECT a.servicio_id, a.prefijo::text, NULL
              FROM network.ipv6_asignaciones a
             WHERE a.fin IS NULL
               AND EXISTS (SELECT 1 FROM network.ipv6_bloques b
                            WHERE b.id = ANY(?::bigint[]) AND b.prefijo >>= a.prefijo)
         )
         SELECT s.id, s.version, s.router_id, s.empresa_id, s.user_ppp,
                (SELECT v.red_id FROM network.ipv4_asignaciones v
                  WHERE v.servicio_id = s.id AND v.fin IS NULL LIMIT 1) AS red_ipv4_id,
                array_agg(dir.direccion ORDER BY dir.direccion) AS direcciones
           FROM dir JOIN core.servicios s ON s.id = dir.servicio_id
          WHERE s.estado <> 'retirado'
          GROUP BY s.id
          ORDER BY s.id`,
        [redes, bloques],
    )) as { rows: ServicioAfectado[] }
    return rows.map((r) => ({
        ...r,
        id: Number(r.id),
        router_id: Number(r.router_id),
        empresa_id: Number(r.empresa_id),
        red_ipv4_id: r.red_ipv4_id === null ? null : Number(r.red_ipv4_id),
    }))
}
