import { randomInt } from 'node:crypto'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { ReglaNegocio, ValidacionFallida } from '#shared/errores'
import { asignarIpv4, liberarIpv4 } from '#network/ipam_v4'
import { asignarPrefijoEstatico, liberarPrefijos, prefijoVigente, reservarPrefijo } from '#network/ipam_v6'
import type { PlanEfectivo } from '#network/actions/obtener_implementacion_plan'
import type { ModoIpv6, TipoConexion } from '#core/consultas/servicios'

/**
 * Piezas comunes de `crearServicio`, `editarServicio` y `retirarServicio`: llevar las
 * asignaciones IPv4/IPv6 de un servicio al estado que piden su router, su plan y su modo IPv6.
 */

export interface Asignaciones {
    ipv4: string | null
    prefijo_enlace_v6: string | null
    prefijo_delegado_v6: string | null
}

export async function asignacionesVigentes(
    trx: TransactionClientContract,
    servicioId: number,
): Promise<Asignaciones> {
    const ipv4 = (await trx
        .from('network.ipv4_asignaciones')
        .where('servicio_id', servicioId)
        .whereNull('fin')
        .select(trx.raw('host(ip) AS ip'))
        .first()) as { ip: string } | null
    const enlace = await prefijoVigente(trx, servicioId, 'enlace')
    const delegado = await prefijoVigente(trx, servicioId, 'delegacion')
    return {
        ipv4: ipv4?.ip ?? null,
        prefijo_enlace_v6: enlace?.prefijo ?? null,
        prefijo_delegado_v6: delegado?.prefijo ?? null,
    }
}

/**
 * Modo IPv6 por defecto: sin IPv6 si el plan es solo v4 o el servicio no es PPPoE (los modos
 * `radius_*` necesitan RADIUS); si no, prefijos por servicio.
 */
export function modoIpv6PorDefecto(plan: PlanEfectivo, tipo: TipoConexion = 'pppoe'): ModoIpv6 {
    return plan.dual_stack === 'v4' || tipo !== 'pppoe' ? 'ninguno' : 'radius_servicio'
}

/** Los modos IPv6 que entrega RADIUS no aplican a un servicio sin PPPoE. */
export function modoIpv6PorRadius(modo: ModoIpv6): boolean {
    return modo === 'radius_servicio' || modo === 'radius_pool'
}

/**
 * Reglas del tipo de conexión (`contratos/routeros.md`), 422 por campo:
 * - fuera de `pppoe` no hay `user_ppp` ni `pass_ppp`, ni modos IPv6 por RADIUS, y el plan debe
 *   llevar IPv4 (la cola, la address-list y el lease se identifican por la IPv4);
 * - `dhcp_fija` exige `mac` (el lease se amarra a ella);
 * - `amarre_ip_mac` solo sin PPPoE y con `mac`.
 */
export function validarTipoConexion(
    plan: PlanEfectivo,
    datos: {
        tipo: TipoConexion
        modo: ModoIpv6
        mac: string | null | undefined
        amarre: boolean
        user_ppp?: string
        pass_ppp?: string
    },
) {
    const errores: Array<{ field: string; message: string; rule: string }> = []
    if (datos.tipo !== 'pppoe') {
        if (datos.user_ppp !== undefined) {
            errores.push({
                field: 'user_ppp',
                message: 'Solo los servicios pppoe tienen user_ppp',
                rule: 'tipo_conexion',
            })
        }
        if (datos.pass_ppp !== undefined) {
            errores.push({
                field: 'pass_ppp',
                message: 'Solo los servicios pppoe tienen pass_ppp',
                rule: 'tipo_conexion',
            })
        }
        if (modoIpv6PorRadius(datos.modo)) {
            errores.push({
                field: 'ipv6_modo',
                message: 'Sin PPPoE no hay RADIUS: el modo IPv6 debe ser duid, estatico o ninguno',
                rule: 'tipo_conexion',
            })
        }
        if (plan.dual_stack === 'v6') {
            errores.push({
                field: 'tipo_conexion',
                message: 'Un servicio sin PPPoE necesita IPv4 y el plan es solo IPv6',
                rule: 'plan',
            })
        }
    }
    if (datos.tipo === 'dhcp_fija' && !datos.mac) {
        errores.push({ field: 'mac', message: 'dhcp_fija requiere la MAC del equipo', rule: 'required' })
    }
    if (datos.amarre) {
        if (datos.tipo === 'pppoe') {
            errores.push({
                field: 'amarre_ip_mac',
                message: 'El amarre IP-MAC es solo para servicios sin PPPoE',
                rule: 'tipo_conexion',
            })
        } else if (!datos.mac) {
            errores.push({
                field: 'mac',
                message: 'El amarre IP-MAC requiere la MAC del equipo',
                rule: 'required',
            })
        }
    }
    if (errores.length > 0) throw new ValidacionFallida(errores, errores[0]!.message)
}

/** Reglas de combinación de plan, modo IPv6, DUID y prefijo manual (422). */
export function validarModoIpv6(
    plan: PlanEfectivo,
    modo: ModoIpv6,
    datos: { ipv6_duid?: string | null; prefijo_delegado_v6?: string | null },
) {
    if (plan.dual_stack === 'v4' && modo !== 'ninguno') {
        throw new ValidacionFallida(
            [
                {
                    field: 'ipv6_modo',
                    message: 'El plan es solo IPv4: el modo IPv6 debe ser ninguno',
                    rule: 'plan',
                },
            ],
            'El plan es solo IPv4',
        )
    }
    if (modo === 'duid' && !datos.ipv6_duid) {
        throw new ValidacionFallida(
            [{ field: 'ipv6_duid', message: 'El modo duid requiere el DUID del equipo', rule: 'required' }],
            'El modo duid requiere el DUID del equipo',
        )
    }
    if (datos.prefijo_delegado_v6 && modo !== 'estatico') {
        throw new ValidacionFallida(
            [
                {
                    field: 'prefijo_delegado_v6',
                    message: 'Solo se indica a mano en modo estatico',
                    rule: 'modo',
                },
            ],
            'El prefijo delegado solo se indica a mano en modo estatico',
        )
    }
}

/**
 * Asigna o libera IPv4 y prefijos IPv6 según el plan y el modo. Conserva lo vigente cuando sigue
 * siendo válido (mismo router, mismo tamaño), así editar datos no mueve IPs.
 */
export async function reconciliarAsignaciones(
    trx: TransactionClientContract,
    entrada: {
        servicioId: number
        routerId: number
        plan: PlanEfectivo
        modo: ModoIpv6
        /** sin PPPoE la IPv4 es obligatoria y sale de las redes del router (nunca de un pool) */
        tipoConexion?: TipoConexion
        ipv4?: string | null
        /** red de la que tomar la IPv4 (debe ser del router) */
        redIpv4Id?: number | null
        prefijoEstatico?: string | null
    },
): Promise<Asignaciones> {
    const { servicioId, routerId, plan, modo } = entrada

    const sinPppoe = (entrada.tipoConexion ?? 'pppoe') !== 'pppoe'
    if (plan.dual_stack === 'v6') {
        await liberarIpv4(trx, servicioId)
    } else if (sinPppoe) {
        const tieneRedes = await trx.from('network.redes_ipv4').where('router_id', routerId).first()
        if (!tieneRedes && !entrada.ipv4 && !entrada.redIpv4Id) {
            throw new ReglaNegocio(
                'Un servicio sin PPPoE necesita una IPv4 de las redes del router y el router no tiene redes',
                'sin_ipv4',
            )
        }
        await asignarIpv4(trx, {
            servicioId,
            routerId,
            ip: entrada.ipv4,
            redId: entrada.redIpv4Id,
        })
    } else if (entrada.ipv4 || entrada.redIpv4Id) {
        await asignarIpv4(trx, { servicioId, routerId, ip: entrada.ipv4, redId: entrada.redIpv4Id })
    } else {
        const tieneRedes = await trx.from('network.redes_ipv4').where('router_id', routerId).first()
        if (tieneRedes) {
            await asignarIpv4(trx, { servicioId, routerId })
        } else if (plan.pool_ipv4) {
            // sin redes registradas: el router asigna desde su pool (Framed-Pool)
            await liberarIpv4(trx, servicioId)
        } else {
            throw new ReglaNegocio(
                'El router no tiene redes IPv4 ni el plan define pool_ipv4 en ese router',
                'sin_ipv4',
            )
        }
    }

    switch (modo) {
        case 'radius_servicio':
            await reservarPrefijo(trx, { servicioId, routerId, tipo: 'enlace', tamano: 64 })
            await reservarPrefijo(trx, {
                servicioId,
                routerId,
                tipo: 'delegacion',
                tamano: plan.tamano_prefijo_delegado,
            })
            break
        case 'duid':
            await liberarPrefijos(trx, servicioId, 'enlace')
            await reservarPrefijo(trx, {
                servicioId,
                routerId,
                tipo: 'delegacion',
                tamano: plan.tamano_prefijo_delegado,
            })
            break
        case 'estatico': {
            await liberarPrefijos(trx, servicioId, 'enlace')
            if (entrada.prefijoEstatico) {
                await asignarPrefijoEstatico(trx, { servicioId, prefijo: entrada.prefijoEstatico })
            } else if (!(await prefijoVigente(trx, servicioId, 'delegacion'))) {
                throw new ValidacionFallida(
                    [
                        {
                            field: 'prefijo_delegado_v6',
                            message: 'El modo estatico requiere el prefijo delegado',
                            rule: 'required',
                        },
                    ],
                    'El modo estatico requiere el prefijo delegado',
                )
            }
            break
        }
        case 'radius_pool':
        case 'ninguno':
            await liberarPrefijos(trx, servicioId)
            break
    }
    return asignacionesVigentes(trx, servicioId)
}

/** Libera todo (retiro). */
export async function liberarAsignaciones(trx: TransactionClientContract, servicioId: number) {
    await liberarIpv4(trx, servicioId)
    await liberarPrefijos(trx, servicioId)
}

const ALFABETO = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** Contraseña PPPoE aleatoria de 12 caracteres sin ambiguos (0/O, 1/l/I). */
export function generarPassPpp(): string {
    return Array.from({ length: 12 }, () => ALFABETO[randomInt(ALFABETO.length)]).join('')
}

/** user_ppp legible y único: `<nombre>.<cliente_id>` y sufijo `-2`, `-3`… si ya existe. */
export async function generarUserPpp(
    trx: TransactionClientContract,
    clienteId: number,
    nombreCliente: string,
): Promise<string> {
    const base =
        nombreCliente
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .find((parte) => parte.length > 0)
            ?.slice(0, 16) ?? 'cliente'
    const raiz = `${base}.${clienteId}`
    const existentes = new Set(
        (
            (await trx.from('core.servicios').whereLike('user_ppp', `${raiz}%`).select('user_ppp')) as Array<{
                user_ppp: string
            }>
        ).map((f) => f.user_ppp),
    )
    if (!existentes.has(raiz)) return raiz
    for (let n = 2; ; n++) {
        if (!existentes.has(`${raiz}-${n}`)) return `${raiz}-${n}`
    }
}
