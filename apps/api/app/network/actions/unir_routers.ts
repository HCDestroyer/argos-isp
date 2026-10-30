import { DomainAction, simularEnTransaccion, type Transaccion } from '#shared/domain_action'
import { descifrar } from '#shared/cifrado'
import type { ContextoAccion } from '#shared/contexto'
import { ConflictoVersion, NoEncontrado, Problema, ReglaNegocio, ValidacionFallida } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { refrescarAaaAlConfirmar } from '#core/aaa'
import EditarServicio from '#core/actions/editar_servicio'
import EditarRouter from '#network/actions/editar_router'
import { camposVelocidadCambiados } from '#network/actions/editar_plan'
import { verRouter, verRedIpv4, type RouterVista } from '#network/consultas/routers'
import { verBloque } from '#network/consultas/ipv6'
import { verImplementacion } from '#network/consultas/planes'
import { CAMPOS_EXCEPCION_VELOCIDAD } from '#network/velocidad'
import { clavesCompartidas, type MotivoDuplicado } from '#network/routers_duplicados'

/**
 * Unir dos registros del mismo MikroTik (`routers.unir`, `contratos/routers.md` §3): el router
 * `id` queda y absorbe a `absorber_id`.
 *
 * 1. `planes_routers` del absorbido pasan al que queda. Si los dos implementan el mismo plan, gana
 *    la del que queda y la del absorbido se descarta (aviso en la simulación). Cada implementación
 *    que llega emite `plan.velocidad_cambiada` y reescribe `aaa:user:*` de los servicios del plan.
 * 2. Redes IPv4 y bloques IPv6 (con sus pools) pasan al que queda, con su diff.
 * 3. Cada servicio no retirado pasa con `EditarServicio` anidada (`mismo_equipo`): auditoría, diff,
 *    `servicio.config_cambiada` con `campos: ['router']` y `motivo: 'union_routers'`, write-through
 *    de `aaa:user:*` y RouterOS por evento. Las direcciones no cambian (sus redes y pools ya son del
 *    que queda) y el NAS es el mismo: no hay por qué desconectar a nadie.
 * 4. Las sesiones abiertas del absorbido pasan al que queda.
 * 5. El absorbido se desactiva con `EditarRouter` anidada y queda `unido_a_id` = el que queda. El
 *    dispatcher de RouterOS ya no limpia en él (`routersConHistorial`) y su reconciliador lo omite
 *    (inactivo): nadie borra los objetos `argosisp:` que ahora son del que queda. Los routers que ya
 *    estaban unidos al absorbido pasan a apuntar al que queda (un salto). No se elimina:
 *    `routers.eliminar` aún no existe en main (fila en `.claude/integration/a1.md`).
 *
 * Con secretos RADIUS distintos responde 422 `secreto_radius_distinto` (decisión del líder: el CoA
 * de las sesiones movidas sale con el secreto del que queda). `simular` corre todo y lo revierte:
 * devuelve lo que pasaría con sus avisos, y ese bloqueo en `bloqueos` en vez del 422.
 */

export interface EntradaUnirRouters {
    /** el router que queda */
    id: number
    /** `version` del router que queda (la leída) */
    version: number
    /** el router que se absorbe (queda desactivado) */
    absorber_id: number
}

export interface ServicioUnido {
    servicio_id: number
    user_ppp: string | null
    estado: string
    tipo_conexion: string
}

export interface ResultadoUnion {
    router_id: number
    absorbido_id: number
    simulado: boolean
    /** claves que comparten (`api`, `nas_ip`, `serial`); vacío = no parecen el mismo equipo */
    coincidencias: MotivoDuplicado[]
    servicios: ServicioUnido[]
    redes_ipv4: number[]
    ipv6_bloques: number[]
    /** plan_id de las implementaciones que pasaron al que queda */
    planes_movidos: number[]
    /** plan_id de las implementaciones del absorbido descartadas (ganó la del que queda) */
    planes_descartados: number[]
    sesiones_abiertas: number
    avisos: string[]
    /** solo en la simulación: lo que impediría unir (`secreto_radius_distinto`); vacío = se puede */
    bloqueos: Array<'secreto_radius_distinto'>
    /** routers que ya estaban unidos al absorbido y ahora apuntan al que queda */
    reencadenados: number[]
    router: RouterVista
    absorbido: RouterVista
}

/** Campos de `planes_routers` que cambian las colas (los mismos que `ImplementarPlan`). */
const CAMPOS_COLA = ['rate_limit_override', 'profile_ppp', ...CAMPOS_EXCEPCION_VELOCIDAD] as const

interface FilaRouter {
    id: number
    nombre: string
    host: string
    api_url: string | null
    nas_ip: string | null
    serial: string | null
    activo: boolean
    unido_a_id: number | null
    control_velocidad: string
    /** cifrado v1; solo se compara, nunca sale */
    radius_secret: string | null
    version: number
}

/** ¿Los dos registros tienen el mismo secreto RADIUS? (dos null también cuentan como iguales) */
function mismoSecreto(a: string | null, b: string | null): boolean {
    const claro = (v: string | null) => (v ? descifrar(v) : null)
    return claro(a) === claro(b)
}

async function bloquearRouters(t: Transaccion, ids: number[]): Promise<FilaRouter[]> {
    return (await t.trx
        .from('network.routers')
        .whereIn('id', ids)
        .orderBy('id')
        .forUpdate()
        .select(
            'id',
            'nombre',
            'host',
            'api_url',
            t.trx.raw('host(nas_ip) AS nas_ip'),
            'serial',
            'activo',
            'unido_a_id',
            'control_velocidad',
            'radius_secret',
            'version',
        )) as FilaRouter[]
}

export async function unirRouters(
    t: Transaccion,
    entrada: EntradaUnirRouters,
    simulando = false,
): Promise<ResultadoUnion> {
    t.fijarEntidad('router', entrada.id)
    if (entrada.absorber_id === entrada.id) {
        throw new ValidacionFallida([
            { field: 'absorber_id', message: 'Un router no se une consigo mismo', rule: 'distinto' },
        ])
    }
    const filas = await bloquearRouters(t, [entrada.id, entrada.absorber_id])
    const queda = filas.find((f) => Number(f.id) === entrada.id)
    const absorbido = filas.find((f) => Number(f.id) === entrada.absorber_id)
    if (!queda) throw new NoEncontrado(`El router ${entrada.id} no existe`)
    if (!absorbido) {
        throw new ValidacionFallida([
            { field: 'absorber_id', message: `El router ${entrada.absorber_id} no existe`, rule: 'exists' },
        ])
    }
    if (queda.unido_a_id !== null) {
        throw new ReglaNegocio(
            `El router «${queda.nombre}» ya está unido al router ${queda.unido_a_id}: une a ese`,
            'router_unido',
        )
    }
    if (!queda.activo) {
        throw new ReglaNegocio(
            `El router «${queda.nombre}» está desactivado: el que queda debe estar activo`,
            'router_inactivo',
        )
    }
    if (absorbido.unido_a_id !== null) {
        throw new ReglaNegocio(
            `El router «${absorbido.nombre}» ya está unido al router ${absorbido.unido_a_id}`,
            'router_unido',
        )
    }
    if (Number(queda.version) !== entrada.version) throw new ConflictoVersion('network.routers', entrada.id)

    const avisos: string[] = []
    const bloqueos: Array<'secreto_radius_distinto'> = []
    // Decisión del líder (29 oct, nota de A2): el CoA de las sesiones del absorbido sale con la nas_ip y
    // el secreto del que queda; con secretos distintos el equipo daría NAK. Primero el mismo secreto.
    if (!mismoSecreto(queda.radius_secret, absorbido.radius_secret)) {
        const texto =
            `«${queda.nombre}» y «${absorbido.nombre}» tienen secretos RADIUS distintos. Primero deja el mismo ` +
            `secreto en el MikroTik (/radius) y en Argos (el de «${queda.nombre}», que es el que queda), y ` +
            'después únelos'
        if (!simulando) throw new ReglaNegocio(texto, 'secreto_radius_distinto')
        bloqueos.push('secreto_radius_distinto')
        avisos.push(texto)
    }
    const coincidencias = clavesCompartidas(queda, absorbido)
    if (coincidencias.length === 0) {
        avisos.push(
            `«${queda.nombre}» y «${absorbido.nombre}» no parecen el mismo equipo (no comparten la dirección de ` +
                'la API, la nas_ip ni el número de serie): únelos solo si es el mismo MikroTik',
        )
    }
    if (queda.control_velocidad !== absorbido.control_velocidad) {
        avisos.push(
            `«${absorbido.nombre}» usaba el control de velocidad ${absorbido.control_velocidad} y «${queda.nombre}» ` +
                `usa ${queda.control_velocidad}: sus servicios quedan con ${queda.control_velocidad}. Para usar dos ` +
                `formas de control en el mismo router, configúralas por plan en la ficha de «${queda.nombre}»`,
        )
    }

    // serializa con las asignaciones de ambos routers y de los pools que se mudan (`ipam_v4`, `ipam_v6`)
    for (const router of [queda.id, absorbido.id].map(Number).sort((a, b) => a - b)) {
        await t.trx.rawQuery(`SELECT pg_advisory_xact_lock(hashtext('ipam:v4:router:' || ?::text))`, [router])
    }
    const pools = (await t.trx
        .from('network.ipv6_pools as p')
        .join('network.ipv6_bloques as b', 'b.id', 'p.bloque_id')
        .where('b.router_id', absorbido.id)
        .orderBy('p.id')
        .select('p.id')) as Array<{ id: number }>
    for (const pool of pools) {
        await t.trx.rawQuery(`SELECT pg_advisory_xact_lock(hashtext('ipam:v6:pool:' || ?::text))`, [pool.id])
    }

    // 1. implementaciones de planes
    const implementaciones = (await t.trx
        .from('network.planes_routers as pr')
        .join('network.planes as p', 'p.id', 'pr.plan_id')
        .where('pr.router_id', absorbido.id)
        .orderBy('pr.plan_id')
        .select('pr.plan_id', 'p.nombre')) as Array<{ plan_id: number; nombre: string }>
    const planesMovidos: number[] = []
    const planesDescartados: number[] = []
    for (const { plan_id: planIdCrudo, nombre } of implementaciones) {
        const planId = Number(planIdCrudo)
        const antes = (await verImplementacion(planId, absorbido.id, t.trx))!
        const propia = await verImplementacion(planId, queda.id, t.trx)
        if (propia) {
            await t.trx.from('network.planes_routers').where('id', antes.id).delete()
            await t.registrarCambios({ tipo: 'plan_router', id: antes.id }, antes, null)
            planesDescartados.push(planId)
            avisos.push(
                `El plan «${nombre}» tiene implementación en los dos routers: queda la de «${queda.nombre}» ` +
                    `y se descarta la de «${absorbido.nombre}»`,
            )
            continue
        }
        await t.trx
            .from('network.planes_routers')
            .where('id', antes.id)
            .update({
                router_id: queda.id,
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        const despues = (await verImplementacion(planId, queda.id, t.trx))!
        await t.registrarCambios({ tipo: 'plan_router', id: antes.id }, antes, despues)
        planesMovidos.push(planId)
        // los servicios del plan que ya estaban en el que queda toman esta implementación
        const campos = camposVelocidadCambiados(
            null,
            despues as unknown as Record<string, unknown>,
            CAMPOS_COLA,
        )
        if (campos.length > 0) {
            await t.emit('plan.velocidad_cambiada', { plan_id: planId, router_id: Number(queda.id), campos })
        }
        refrescarAaaAlConfirmar(t, { planId, routerId: Number(queda.id) })
    }

    // 2. redes IPv4 y bloques IPv6 (sus pools van con el bloque)
    const redes = (await t.trx
        .from('network.redes_ipv4')
        .where('router_id', absorbido.id)
        .orderBy('id')
        .select('id')) as Array<{ id: number }>
    for (const { id } of redes) {
        const antes = await verRedIpv4(Number(id), t.trx)
        await moverARouter(t, 'network.redes_ipv4', Number(id), Number(queda.id))
        await t.registrarCambios(
            { tipo: 'red_ipv4', id: Number(id) },
            antes,
            await verRedIpv4(Number(id), t.trx),
        )
    }
    const bloques = (await t.trx
        .from('network.ipv6_bloques')
        .where('router_id', absorbido.id)
        .orderBy('id')
        .select('id')) as Array<{ id: number }>
    for (const { id } of bloques) {
        const antes = await verBloque(Number(id), t.trx)
        await moverARouter(t, 'network.ipv6_bloques', Number(id), Number(queda.id))
        await t.registrarCambios(
            { tipo: 'ipv6_bloque', id: Number(id) },
            antes,
            await verBloque(Number(id), t.trx),
        )
    }

    // 3. servicios (no retirados)
    const servicios = (await t.trx
        .from('core.servicios')
        .where('router_id', absorbido.id)
        .whereNot('estado', 'retirado')
        .orderBy('id')
        .select('id', 'version', 'empresa_id', 'user_ppp', 'estado', 'tipo_conexion')) as Array<{
        id: number
        version: number
        empresa_id: number
        user_ppp: string | null
        estado: string
        tipo_conexion: string
    }>
    const unidos: ServicioUnido[] = []
    for (const servicio of servicios) {
        exigirAccesoEmpresa(t.ctx, Number(servicio.empresa_id))
        try {
            await new EditarServicio().execute(
                {
                    id: Number(servicio.id),
                    version: servicio.version,
                    router_id: Number(queda.id),
                    mismo_equipo: true,
                },
                t.ctx,
                { trx: t.trx },
            )
        } catch (error) {
            if (!(error instanceof Problema)) throw error
            throw new ReglaNegocio(
                `El servicio ${servicio.id}${servicio.user_ppp ? ` (${servicio.user_ppp})` : ''} no puede pasar ` +
                    `al router «${queda.nombre}»: ${error.detalle ?? error.titulo}`,
                'servicio_no_unible',
            )
        }
        unidos.push({
            servicio_id: Number(servicio.id),
            user_ppp: servicio.user_ppp,
            estado: servicio.estado,
            tipo_conexion: servicio.tipo_conexion,
        })
    }
    const [retirados] = (await t.trx
        .from('core.servicios')
        .where('router_id', absorbido.id)
        .where('estado', 'retirado')
        .count('* as total')) as Array<{ total: string | number }>
    if (Number(retirados?.total ?? 0) > 0) {
        avisos.push(
            `${retirados!.total} servicios retirados quedan en el historial de «${absorbido.nombre}» (no se mueven)`,
        )
    }

    // 4. sesiones abiertas (telemetría: sin versión; diff por sesión)
    const sesiones = (await t.trx
        .from('network.sesiones')
        .where('router_id', absorbido.id)
        .whereNull('fin')
        .orderBy('id')
        .select('id')) as Array<{ id: number }>
    for (const { id } of sesiones) {
        await t.trx
            .from('network.sesiones')
            .where('id', id)
            .update({ router_id: queda.id, updated_at: t.trx.knexRawQuery('now()') } as Record<
                string,
                unknown
            >)
        await t.registrarCambios(
            { tipo: 'sesion', id: Number(id) },
            { router_id: Number(absorbido.id) },
            { router_id: Number(queda.id) },
        )
    }
    const accounting = await t.trx
        .from('network.routers_contacto')
        .where('router_id', absorbido.id)
        .where('fuente', 'accounting')
        .first()
    if (sesiones.length > 0 || accounting) {
        avisos.push(
            `El MikroTik manda RADIUS con la nas_ip de «${absorbido.nombre}» (${absorbido.nas_ip}): al unir, ` +
                `ese registro queda desactivado y deja de ser cliente de RADIUS. Si el equipo usa esa nas_ip, une ` +
                `al revés (que quede «${absorbido.nombre}») o cambia en el equipo el NAS a ${queda.nas_ip ?? '(el que queda no usa RADIUS)'}`,
        )
    }

    const bodegas = (await t.trx
        .from('inventario.bodegas')
        .where('router_id', absorbido.id)
        .orderBy('id')
        .select('nombre')) as Array<{ nombre: string }>
    for (const bodega of bodegas) {
        avisos.push(
            `La bodega «${bodega.nombre}» sigue asociada a «${absorbido.nombre}»: cámbiala en inventario`,
        )
    }

    // 5. el absorbido queda desactivado y unido al que queda
    const antesAbsorbido = await verRouter(Number(absorbido.id), t.trx)
    if (absorbido.activo) {
        await new EditarRouter().execute(
            { id: Number(absorbido.id), version: absorbido.version, activo: false },
            t.ctx,
            { trx: t.trx },
        )
    }
    await t.trx
        .from('network.routers')
        .where('id', absorbido.id)
        .update({ unido_a_id: queda.id, unido_en: t.trx.knexRawQuery('now()') } as Record<string, unknown>)
    const despuesAbsorbido = await verRouter(Number(absorbido.id), t.trx)
    await t.registrarCambios(
        { tipo: 'router', id: Number(absorbido.id) },
        { unido_a_id: antesAbsorbido.unido_a_id },
        { unido_a_id: despuesAbsorbido.unido_a_id },
    )
    // uniones encadenadas: los que ya apuntaban al absorbido apuntan al que queda (un solo salto)
    const encadenados = (await t.trx
        .from('network.routers')
        .where('unido_a_id', absorbido.id)
        .orderBy('id')
        .select('id')) as Array<{ id: number }>
    for (const { id } of encadenados) {
        await t.trx.from('network.routers').where('id', id).update({ unido_a_id: queda.id })
        await t.registrarCambios(
            { tipo: 'router', id: Number(id) },
            { unido_a_id: Number(absorbido.id) },
            { unido_a_id: Number(queda.id) },
        )
    }
    avisos.push(
        `«${absorbido.nombre}» queda desactivado y unido a «${queda.nombre}» (no se elimina: conserva su historial)`,
    )

    return {
        router_id: Number(queda.id),
        absorbido_id: Number(absorbido.id),
        simulado: false,
        coincidencias,
        servicios: unidos,
        redes_ipv4: redes.map((r) => Number(r.id)),
        ipv6_bloques: bloques.map((b) => Number(b.id)),
        planes_movidos: planesMovidos,
        planes_descartados: planesDescartados,
        sesiones_abiertas: sesiones.length,
        avisos,
        bloqueos,
        reencadenados: encadenados.map((r) => Number(r.id)),
        router: await verRouter(Number(queda.id), t.trx),
        absorbido: despuesAbsorbido,
    }
}

async function moverARouter(t: Transaccion, tabla: string, id: number, routerId: number) {
    await t.trx
        .from(tabla)
        .where('id', id)
        .update({
            router_id: routerId,
            version: t.trx.knexRawQuery('version + 1'),
            updated_at: t.trx.knexRawQuery('now()'),
        } as Record<string, unknown>)
}

/** `POST /routers/:id/unir`: solo admin (`routers.unir`). */
export default class UnirRouters extends DomainAction<EntradaUnirRouters, ResultadoUnion> {
    readonly nombre = 'routers.unir'

    protected handle(input: EntradaUnirRouters, t: Transaccion): Promise<ResultadoUnion> {
        return unirRouters(t, input)
    }

    /** Lo mismo sin guardar nada: qué se movería y con qué avisos. */
    static async simular(input: EntradaUnirRouters, ctx: ContextoAccion): Promise<ResultadoUnion> {
        const resultado = await simularEnTransaccion(ctx, (t) => unirRouters(t, input, true))
        return { ...resultado, simulado: true }
    }
}
