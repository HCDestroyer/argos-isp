import type { Problem, Schema } from '@argosisp/contracts'
import type { RespuestaFixture, RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import type { DiagnosticoCorte, Estrategia, EstrategiaParcial, EstrategiasPlan, EstrategiasRouter, SincronizacionPlan, TipoConexionVelocidad, VistaPreviaEstrategia, VistaPreviaReconciliar } from '../../app/types/controlVelocidad'
import { APLICACIONES, EXTRAS, PADRES, TIPOS_COLA, TIPOS_CONEXION_VELOCIDAD } from '../../app/types/controlVelocidad'
import { MATRIZ, QOS_MAX_HOJAS } from './estrategiasDatos'
import { clasesActivasDeRouter } from '../qos/costo'
import { bd } from '../bd'
import { ahora, conIdempotencia, conPermiso, cuerpoObjeto, idDe, noEncontrado, problemaTipado, registrarAccion, versionCambiada } from '../comun'

/**
 * Control de velocidad por capas, sincronizar plan, «Reconciliar ahora» y el chequeo del corte, como
 * `contratos/control-velocidad.md` (A2). La validación es la de `validarEstrategias()`
 * (`apps/api/app/network/estrategia_velocidad.ts`) con sus mismos `field`, `rule` y mensajes; los
 * objetos de RouterOS de las vistas previas son una muestra con los nombres de la API.
 *
 * Datos: RB-Centro (1) con RouterOS 7 y sin las reglas de corte (las arregla «Reconciliar ahora»);
 * CCR-Mixco (2) con RouterOS 6 y el portal inalcanzable; RB-Bodega (3) sin usuario de la API.
 */

type Router = Schema<'Router'>
type Errores = VistaPreviaEstrategia['errores']
type Advertencias = VistaPreviaEstrategia['advertencias']

const NOMBRE_TIPO: Record<TipoConexionVelocidad, string> = { pppoe: 'PPPoE', ip_estatica: 'IP estática', dhcp_fija: 'DHCP fija' }
const TIPOS_POR_APLICACION = Object.fromEntries(MATRIZ.aplicaciones.map(a => [a.valor, a.tipos_conexion]))

const familia = (e: Pick<Estrategia, 'aplicacion'>): 'simple' | 'arbol' => (e.aplicacion === 'arbol_pcq' ? 'arbol' : 'simple')
const usaPcq = (e: Pick<Estrategia, 'aplicacion'>): boolean => e.aplicacion === 'pcq_plan' || e.aplicacion === 'arbol_pcq'
const conNivelRouter = (e: Pick<Estrategia, 'padre'>): boolean => e.padre === 'por_router' || e.padre === 'jerarquico'
/** `conQos()` de A2: prioridad por clases solo en el árbol. */
export const conQos = (e: Pick<Estrategia, 'aplicacion' | 'extras'>): boolean => e.extras.qos && familia(e) === 'arbol'
const porCoa = (e: Pick<Estrategia, 'aplicacion'>): boolean => e.aplicacion === 'radius_rate_limit' || e.aplicacion === 'perfil_ppp'

function versionMayor(version: string | null): number | null {
    const m = /^(\d+)\./.exec(version ?? '')
    return m ? Number(m[1]) : null
}

function enLista<T extends string>(lista: readonly T[], valor: unknown): valor is T {
    return typeof valor === 'string' && (lista as readonly string[]).includes(valor)
}

/** `estrategiaEfectiva()`: la del router, capa por capa sobrescrita por la excepción del plan. */
export function efectiva(router: EstrategiasRouter, excepcion: EstrategiasPlan | null | undefined, tipo: TipoConexionVelocidad): Estrategia {
    const base = router[tipo]
    const parcial = excepcion?.[tipo]
    const extras = { ...base.extras }
    for (const extra of EXTRAS) {
        const valor = parcial?.extras?.[extra]
        if (typeof valor === 'boolean') {
            extras[extra] = valor
        }
    }
    return { aplicacion: parcial?.aplicacion ?? base.aplicacion, padre: parcial?.padre ?? base.padre, tipo_cola: parcial?.tipo_cola ?? base.tipo_cola, extras }
}

function misma(a: Estrategia, b: Estrategia): boolean {
    return a.aplicacion === b.aplicacion && a.padre === b.padre && a.tipo_cola === b.tipo_cola && EXTRAS.every(x => a.extras[x] === b.extras[x])
}

/** `leerExcepcion()`: solo capas conocidas; null si no queda nada. */
function leerExcepcion(valor: unknown): EstrategiasPlan | null {
    if (typeof valor !== 'object' || valor === null) {
        return null
    }
    const salida: EstrategiasPlan = {}
    for (const tipo of TIPOS_CONEXION_VELOCIDAD) {
        const p = (valor as Record<string, unknown>)[tipo]
        if (typeof p !== 'object' || p === null) {
            continue
        }
        const parcial = p as Record<string, unknown>
        const limpio: EstrategiaParcial = {}
        if (enLista(APLICACIONES, parcial.aplicacion)) {
            limpio.aplicacion = parcial.aplicacion
        }
        if (enLista(PADRES, parcial.padre)) {
            limpio.padre = parcial.padre
        }
        if (enLista(TIPOS_COLA, parcial.tipo_cola)) {
            limpio.tipo_cola = parcial.tipo_cola
        }
        if (typeof parcial.extras === 'object' && parcial.extras !== null) {
            const extras = Object.fromEntries(EXTRAS.map(x => [x, (parcial.extras as Record<string, unknown>)[x]]).filter(([, v]) => typeof v === 'boolean'))
            if (Object.keys(extras).length) {
                limpio.extras = extras
            }
        }
        if (Object.keys(limpio).length) {
            salida[tipo] = limpio
        }
    }
    return Object.keys(salida).length ? salida : null
}

/** Errores de una estrategia sola (reglas 1 a 4 de la matriz). */
function problemasDe(e: Estrategia, tipo: TipoConexionVelocidad, campo: string, version: string | null): Errores {
    const errores: Errores = []
    if (!(TIPOS_POR_APLICACION[e.aplicacion] ?? []).includes(tipo)) {
        errores.push({
            field: `${campo}.aplicacion`,
            rule: 'aplicacion_tipo',
            message: e.aplicacion === 'cola_simple'
                ? 'cola_simple no aplica a PPPoE: la sesión ya crea su cola dinámica; usa radius_rate_limit, perfil_ppp, pcq_plan o arbol_pcq'
                : `${e.aplicacion} no aplica a ${NOMBRE_TIPO[tipo]}: sin sesión PPP no hay ${e.aplicacion === 'perfil_ppp' ? 'perfil' : 'atributo RADIUS'}; usa cola_simple, pcq_plan o arbol_pcq`,
        })
    }
    if (usaPcq(e) && e.tipo_cola !== 'pcq') {
        errores.push({ field: `${campo}.tipo_cola`, rule: 'tipo_cola', message: `${e.aplicacion} necesita PCQ: el tope de cada cliente es el pcq-rate del plan (con ${e.tipo_cola} no habría tope por cliente)` })
    }
    if (!usaPcq(e) && e.tipo_cola === 'pcq') {
        errores.push({ field: `${campo}.tipo_cola`, rule: 'tipo_cola', message: `PCQ reparte entre varios clientes; en la cola de uno solo (${e.aplicacion}) usa default, sfq, fq_codel o cake` })
    }
    const mayor = versionMayor(version)
    if ((e.tipo_cola === 'fq_codel' || e.tipo_cola === 'cake') && mayor !== null && mayor < 7) {
        errores.push({ field: `${campo}.tipo_cola`, rule: 'version', message: `${e.tipo_cola} necesita RouterOS 7; este router tiene ${version}` })
    }
    // QoS por clases (`contratos/qos.md` §2, reglas 9 y 10).
    if (e.extras.qos) {
        if (e.aplicacion !== 'arbol_pcq') {
            errores.push({ field: `${campo}.extras.qos`, rule: 'qos_familia', message: 'qos necesita el árbol (arbol_pcq): en colas simples cada cliente tiene una sola cola y no hay hojas por clase' })
        }
        if (!e.extras.excluir_fasttrack) {
            errores.push({ field: `${campo}.extras.excluir_fasttrack`, rule: 'qos_fasttrack', message: 'qos exige excluir_fasttrack: con FastTrack las conexiones aceleradas no pasan por mangle y no se clasifican' })
        }
    }
    return errores
}

interface PlanValidacion {
    plan_id: number
    reuso: number
    excepcion: EstrategiasPlan | null
}

/** `validarEstrategias()` de A2: errores (422) y advertencias. */
export function validar(router: Router, estrategias: EstrategiasRouter, planes: PlanValidacion[], campoPlan: (id: number) => string = id => `planes.${id}`): { errores: Errores, advertencias: Advertencias } {
    const campoRouter = 'estrategia_velocidad'
    const version = router.routeros_version
    const errores: Errores = []
    const advertencias: Advertencias = []
    const avisar = (regla: string, mensaje: string) => {
        if (!advertencias.some(a => a.regla === regla && a.mensaje === mensaje)) {
            advertencias.push({ regla, mensaje })
        }
    }
    for (const tipo of TIPOS_CONEXION_VELOCIDAD) {
        errores.push(...problemasDe(estrategias[tipo], tipo, `${campoRouter}.${tipo}`, version))
    }
    for (const plan of planes) {
        for (const tipo of TIPOS_CONEXION_VELOCIDAD) {
            if (plan.excepcion?.[tipo]) {
                errores.push(...problemasDe(efectiva(estrategias, plan.excepcion, tipo), tipo, `${campoPlan(plan.plan_id)}.${tipo}`, version))
            }
        }
    }
    if (errores.length) {
        return { errores: sinRepetir(errores), advertencias }
    }
    const grupos = [
        { plan_id: null as number | null, reuso: 1, campo: campoRouter, excepcion: null as EstrategiasPlan | null },
        ...planes.filter(p => p.excepcion).map(p => ({ plan_id: p.plan_id as number | null, reuso: p.reuso, campo: campoPlan(p.plan_id), excepcion: p.excepcion })),
    ]
    const conTecho = new Map<'simple' | 'arbol', string[]>()
    for (const g of grupos) {
        for (const tipo of TIPOS_CONEXION_VELOCIDAD) {
            const e = efectiva(estrategias, g.excepcion, tipo)
            if (conNivelRouter(e)) {
                conTecho.set(familia(e), [...(conTecho.get(familia(e)) ?? []), g.plan_id === null ? NOMBRE_TIPO[tipo] : `${NOMBRE_TIPO[tipo]} del plan ${g.plan_id}`])
            }
        }
    }
    if (conTecho.size > 1) {
        errores.push({
            field: campoRouter,
            rule: 'familia_router',
            message: `el techo del router se partiría en dos: colas simples (${conTecho.get('simple')?.join(', ')}) y queue tree (${conTecho.get('arbol')?.join(', ')}); usa la misma familia para por_router y jerarquico`,
        })
    }
    for (const g of grupos) {
        const lista = TIPOS_CONEXION_VELOCIDAD.map(tipo => ({ tipo, e: efectiva(estrategias, g.excepcion, tipo) }))
        const quien = g.plan_id === null ? 'los planes del router' : `el plan ${g.plan_id}`
        for (const fam of ['simple', 'arbol'] as const) {
            const deFamilia = lista.filter(x => familia(x.e) === fam)
            const comparten = fam === 'arbol' ? [deFamilia] : [deFamilia.filter(x => x.e.padre !== 'ninguno'), deFamilia.filter(x => x.e.aplicacion === 'pcq_plan')]
            for (const [primero, ...resto] of comparten) {
                const distinto = primero ? resto.find(x => x.e.padre !== primero.e.padre || EXTRAS.some(c => x.e.extras[c] !== primero.e.extras[c])) : undefined
                if (primero && distinto) {
                    errores.push({
                        field: `${g.campo}.${distinto.tipo}.padre`,
                        rule: 'plan_consistente',
                        message: `${NOMBRE_TIPO[primero.tipo]} y ${NOMBRE_TIPO[distinto.tipo]} de ${quien} comparten la ${fam === 'arbol' ? 'rama del árbol' : 'cola'} del plan: usa el mismo padre y los mismos extras`,
                    })
                    break
                }
            }
        }
        const agregan = new Set(lista.filter(x => x.e.padre === 'por_plan' || x.e.padre === 'jerarquico').map(x => familia(x.e)))
        if (agregan.size > 1) {
            errores.push({ field: g.campo, rule: 'familia_plan', message: `el reuso de ${quien} se partiría entre colas simples y queue tree: usa una sola familia o padre ninguno/por_router en una de ellas` })
        }
    }
    // Regla 11: costo de QoS del router (planes con qos × 2 estados × 2 sentidos × clases).
    const clasesQos = clasesActivasDeRouter(router).length
    if (clasesQos > 0) {
        const planesQos = planes.filter(p => TIPOS_CONEXION_VELOCIDAD.some(t => conQos(efectiva(estrategias, p.excepcion, t)))).length
        const hojas = 4 * planesQos * clasesQos
        if (hojas > QOS_MAX_HOJAS) {
            errores.push({
                field: campoRouter,
                rule: 'qos_costo',
                message: `el router pasaría de ${QOS_MAX_HOJAS} hojas de QoS (${planesQos} planes con qos × 2 estados × 2 sentidos × ${clasesQos} clases = ${hojas}): apaga qos en los planes dedicados o usa menos clases`,
            })
        }
    }
    if (errores.length) {
        return { errores: sinRepetir(errores), advertencias }
    }
    const sinCapacidad = router.capacidad_bajada_kbps === null || router.capacidad_subida_kbps === null
    const todas = grupos.flatMap(g => TIPOS_CONEXION_VELOCIDAD.map(tipo => ({
        e: efectiva(estrategias, g.excepcion, tipo),
        donde: g.plan_id === null ? NOMBRE_TIPO[tipo] : `${NOMBRE_TIPO[tipo]} del plan ${g.plan_id}`,
        reuso: g.plan_id === null ? null : g.reuso,
    })))
    const hayTecho = todas.some(x => conNivelRouter(x.e))
    for (const { e, donde, reuso } of todas) {
        if (conNivelRouter(e) && sinCapacidad) {
            avisar('sin_techo', 'el router no tiene capacidad del enlace: el padre del router no limita (max-limit 0)')
        }
        if (hayTecho && !conNivelRouter(e)) {
            avisar('fuera_del_techo', `${donde} no cuelga del padre del router: ese tráfico no cuenta para el techo`)
        }
        if (e.padre === 'ninguno' && (e.extras.prioridad || e.extras.garantizado)) {
            avisar('sin_padre_prioridad', `${donde}: prioridad y garantizado solo reparten bajo un padre; con padre ninguno no tienen efecto`)
        }
        if (conQos(e) && e.padre === 'ninguno') {
            avisar('qos_sin_cuello', `${donde}: qos con padre ninguno: sin nodo del plan ni global que se llene, las clases nunca compiten`)
        }
        if (!e.extras.excluir_fasttrack) {
            avisar('fasttrack', `${donde}: sin verificar FastTrack; con FastTrack las colas no limitan el tráfico acelerado`)
        }
        if ((e.tipo_cola === 'fq_codel' || e.tipo_cola === 'cake') && versionMayor(version) === null) {
            avisar('version_desconocida', `${e.tipo_cola} necesita RouterOS 7 y no se conoce la versión del router: se verifica antes de escribir`)
        }
        if (reuso === 1 && e.padre === 'por_plan' && familia(e) === 'simple') {
            avisar('reuso_dedicado', `${donde}: el plan es dedicado (reuso 1), no se crea cola padre`)
        }
    }
    return { errores, advertencias }
}

function sinRepetir(errores: Errores): Errores {
    return errores.filter((e, i) => errores.findIndex(o => o.field === e.field && o.rule === e.rule && o.message === e.message) === i)
}

/** Planes del router con su reuso y su excepción (`planesParaValidar`). */
export function planesDelRouter(routerId: number): PlanValidacion[] {
    return (bd.planesPorRouter[routerId] ?? []).map((planId) => {
        const implementacion = bd.implementacionesPlan.find(i => i.plan_id === planId && i.router_id === routerId)
        const plan = bd.planes.find(p => p.id === planId)
        return { plan_id: planId, reuso: implementacion?.reuso ?? plan?.reuso ?? 1, excepcion: leerExcepcion(implementacion?.estrategia_velocidad) }
    })
}

function serviciosDelRouter(routerId: number) {
    return bd.servicios.filter(s => s.router_id === routerId && s.estado !== 'retirado' && s.estado !== 'pendiente_instalacion')
}

/** Objetos de RouterOS que cambian (muestra con los nombres de la API) y los totales por menú. */
function objetos(de: EstrategiasRouter, a: EstrategiasRouter, cambian: { id: number, plan_id: number, tipo: TipoConexionVelocidad, antes: Estrategia, despues: Estrategia }[], planesQos: number[] = []) {
    const crear: VistaPreviaEstrategia['crear'] = []
    const actualizar: VistaPreviaEstrategia['actualizar'] = []
    const borrar: VistaPreviaEstrategia['borrar'] = []
    const agregar = (lista: VistaPreviaEstrategia['crear'], ruta: string, clave: string, nombre: string | null) => {
        if (!lista.some(o => o.ruta === ruta && o.clave === clave)) {
            lista.push({ ruta, clave, nombre })
        }
    }
    for (const s of cambian) {
        const { antes, despues } = s
        if (conNivelRouter(despues) && !conNivelRouter(antes)) {
            agregar(crear, familia(despues) === 'arbol' ? '/queue/tree' : '/queue/simple', 'argosisp:router', 'argosisp-router')
        }
        if (despues.tipo_cola !== antes.tipo_cola && !['default', 'pcq'].includes(despues.tipo_cola)) {
            agregar(crear, '/queue/type', `argosisp-${despues.tipo_cola.replace('_', '-')}`, `argosisp-${despues.tipo_cola.replace('_', '-')}`)
        }
        if (despues.aplicacion === 'pcq_plan' && antes.aplicacion !== 'pcq_plan') {
            agregar(crear, '/queue/simple', `argosisp:plan:${s.plan_id}:pcq`, `argosisp-plan-${s.plan_id}-pcq`)
        }
        if (antes.aplicacion === 'pcq_plan' && despues.aplicacion !== 'pcq_plan') {
            agregar(borrar, '/queue/simple', `argosisp:plan:${s.plan_id}:pcq`, `argosisp-plan-${s.plan_id}-pcq`)
        }
        if (s.tipo === 'pppoe' && (despues.aplicacion === 'perfil_ppp' || despues.tipo_cola !== 'default' || despues.padre !== antes.padre)) {
            agregar(actualizar, '/ppp/profile', `plan-${s.plan_id}`, `plan-${s.plan_id}`)
        }
        if (s.tipo !== 'pppoe' && antes.aplicacion === 'cola_simple' && despues.aplicacion !== 'cola_simple') {
            agregar(borrar, '/queue/simple', `argosisp:servicio:${s.id}`, `argosisp-servicio-${s.id}`)
        }
        if (s.tipo !== 'pppoe' && despues.aplicacion === 'cola_simple' && antes.aplicacion !== 'cola_simple') {
            agregar(crear, '/queue/simple', `argosisp:servicio:${s.id}`, `argosisp-servicio-${s.id}`)
        }
    }
    // QoS por clases (§3): una muestra de lo que se crea o se borra al prender o apagar `qos` en el
    // router (la clasificación es una por router, aunque todavía no tenga servicios) y en cada plan.
    const algunoConQos = (e: EstrategiasRouter) => TIPOS_CONEXION_VELOCIDAD.some(t => conQos(e[t]))
    const listaQos = algunoConQos(a) && !algunoConQos(de) ? crear : !algunoConQos(a) && algunoConQos(de) ? borrar : null
    if (listaQos) {
        for (const ruta of ['/ip/firewall/mangle', '/ipv6/firewall/mangle']) {
            agregar(listaQos, ruta, 'argosisp:qos:entrada', null)
            agregar(listaQos, ruta, 'argosisp:qos:salto:1', null)
        }
        for (const planId of planesQos) {
            for (const sentido of ['bajada', 'subida']) {
                agregar(listaQos, '/ip/firewall/mangle', `argosisp:plan:${planId}:${sentido}:qos`, null)
                agregar(listaQos, '/queue/tree', `argosisp:plan:${planId}:${sentido}:qos:1`, `argosisp-plan-${planId}-${sentido}-q1`)
            }
        }
    }
    const fasttrack = (e: EstrategiasRouter) => TIPOS_CONEXION_VELOCIDAD.some(t => e[t].extras.excluir_fasttrack)
    if (fasttrack(a) && !fasttrack(de)) {
        agregar(crear, '/ip/firewall/filter', 'argosisp:top sin fasttrack: clientes con colas (subida)', null)
        agregar(crear, '/ip/firewall/filter', 'argosisp:top sin fasttrack: clientes con colas (bajada)', null)
    }
    const rutas = [...new Set([...crear, ...actualizar, ...borrar].map(o => o.ruta))].sort((x, y) => x.localeCompare(y, 'en'))
    const menus = rutas.map(ruta => ({ ruta, crear: crear.filter(o => o.ruta === ruta).length, actualizar: actualizar.filter(o => o.ruta === ruta).length, borrar: borrar.filter(o => o.ruta === ruta).length }))
    return { crear, actualizar, borrar, menus }
}

/** `vistaPreviaEstrategia()` de A2: valida, compara objetos y cuenta servicios, lotes y sesiones. */
export function vistaPrevia(router: Router, propuesta: { estrategias?: EstrategiasRouter, planes?: { plan_id: number, estrategia_velocidad: unknown }[], reconectar?: boolean }): VistaPreviaEstrategia {
    const de = router.estrategia_velocidad
    const a = propuesta.estrategias ?? de
    const enRouter = planesDelRouter(router.id)
    const nuevas = new Map(enRouter.map(p => [p.plan_id, p.excepcion]))
    const planesCambian: VistaPreviaEstrategia['planes'] = []
    for (const plan of propuesta.planes ?? []) {
        const limpia = leerExcepcion(plan.estrategia_velocidad)
        planesCambian.push({ plan_id: plan.plan_id, de: nuevas.get(plan.plan_id) ?? null, a: limpia })
        nuevas.set(plan.plan_id, limpia)
    }
    const { errores, advertencias } = validar(router, a, enRouter.map(p => ({ ...p, excepcion: nuevas.has(p.plan_id) ? (nuevas.get(p.plan_id) ?? null) : p.excepcion })))
    const salida: VistaPreviaEstrategia = {
        router_id: router.id,
        valida: errores.length === 0,
        errores,
        advertencias,
        de,
        a,
        planes: planesCambian,
        crear: [],
        actualizar: [],
        borrar: [],
        menus: [],
        servicios: 0,
        lotes: 0,
        sesiones_coa: 0,
        sesiones_conservan: 0,
        sesiones_a_desconectar: 0,
        orden: ['preparar', 'lotes', 'terminar'],
    }
    if (!salida.valida) {
        return salida
    }
    const reconectar = propuesta.reconectar ?? false
    const cambian = serviciosDelRouter(router.id).map((s) => {
        const tipo: TipoConexionVelocidad = s.tipo_conexion ?? 'pppoe'
        const antesExc = enRouter.find(p => p.plan_id === s.plan_id)?.excepcion ?? null
        return { id: s.id, plan_id: s.plan_id, tipo, estado: s.estado, antes: efectiva(de, antesExc, tipo), despues: efectiva(a, nuevas.get(s.plan_id) ?? null, tipo) }
    }).filter(s => !misma(s.antes, s.despues))
    Object.assign(salida, objetos(de, a, cambian, enRouter.map(p => p.plan_id)))
    salida.servicios = cambian.length
    salida.lotes = Math.ceil(cambian.length / 50)
    for (const s of cambian.filter(c => c.tipo === 'pppoe' && bd.sesiones.some(x => x.servicio_id === c.id && x.fin === null))) {
        if (reconectar) {
            salida.sesiones_a_desconectar++
            continue
        }
        salida.sesiones_conservan++
        if ((s.estado === 'activo' || s.estado === 'limitado') && porCoa(s.antes) && porCoa(s.despues)) {
            salida.sesiones_coa++
        }
    }
    return salida
}

/** 422 como `ValidacionFallida` con el detalle del primer error (`velocidad.ts` de A2). */
function invalida(errores: Errores): RespuestaFixture {
    const errors: NonNullable<Problem['errors']> = errores.map(e => ({ field: e.field, rule: e.rule, message: e.message }))
    return problemaTipado(422, 'validacion', 'Datos inválidos', `La combinación de control de velocidad no es válida: ${errores[0]?.message ?? ''}`, errors)
}

/** Las del cuerpo; un `extras.qos` ausente conserva el del router (`completarQos`, `contratos/qos.md` §2). */
function estrategiasDelCuerpo(cuerpo: Record<string, unknown>, actual: EstrategiasRouter): EstrategiasRouter | undefined {
    const valor = cuerpo.estrategia_velocidad
    if (typeof valor !== 'object' || valor === null) {
        return undefined
    }
    const propuesta = valor as EstrategiasRouter
    return Object.fromEntries(TIPOS_CONEXION_VELOCIDAD.map(t => [t, {
        ...propuesta[t],
        extras: { ...propuesta[t].extras, qos: typeof propuesta[t].extras.qos === 'boolean' ? propuesta[t].extras.qos : actual[t].extras.qos },
    }])) as EstrategiasRouter
}

function planesDelCuerpo(cuerpo: Record<string, unknown>): { plan_id: number, estrategia_velocidad: unknown }[] {
    return Array.isArray(cuerpo.planes)
        ? cuerpo.planes.filter((p): p is { plan_id: number, estrategia_velocidad: unknown } => typeof p === 'object' && p !== null && typeof (p as Record<string, unknown>).plan_id === 'number')
        : []
}

function sincronizar(solicitud: SolicitudFixture, planId: number): RespuestaFixture {
    const plan = bd.planes.find(p => p.id === planId)
    if (!plan) {
        return noEncontrado('el plan')
    }
    const routerId = Number(solicitud.query.get('router_id')) || null
    const routers = bd.routers.filter(r => (routerId === null || r.id === routerId) && (bd.planesPorRouter[r.id] ?? []).includes(planId))
    const resumen: SincronizacionPlan = { plan_id: planId, aaa_reescritos: 0, routers: [] }
    for (const router of routers) {
        const servicios = serviciosDelRouter(router.id).filter(s => s.plan_id === planId)
        const pppoe = servicios.filter(s => (s.tipo_conexion ?? 'pppoe') === 'pppoe')
        const sesiones = bd.sesiones.filter(s => s.fin === null && pppoe.some(v => v.id === s.servicio_id))
        const excepcion = leerExcepcion(bd.implementacionesPlan.find(i => i.plan_id === planId && i.router_id === router.id)?.estrategia_velocidad)
        const enVivo = porCoa(efectiva(router.estrategia_velocidad, excepcion, 'pppoe'))
        const conCoa = enVivo ? sesiones.filter(x => pppoe.some(v => v.id === x.servicio_id && (v.estado === 'activo' || v.estado === 'limitado'))) : []
        // Sin usuario de la API (RB-Bodega) no se reconcilia: solo RADIUS.
        const conApi = router.activo && router.tiene_api_password
        const caido = conApi && bd.routersSinRespuesta.includes(router.id)
        resumen.aaa_reescritos += pppoe.length
        resumen.routers.push({
            router_id: router.id,
            nombre: router.nombre,
            servicios: servicios.length,
            sesiones_actualizadas: conCoa.length,
            sesiones_sin_coa: sesiones.length - conCoa.length,
            colas_cambiadas: conApi && !caido ? servicios.filter(s => s.tipo_conexion && s.tipo_conexion !== 'pppoe').length : 0,
            reconciliado: conApi,
            errores: caido ? [`${router.nombre} no respondió a la API REST (timeout de 10 s): las colas del plan no se revisaron`] : [],
        })
    }
    registrarAccion(solicitud, 'planes.sincronizar', { tipo: 'plan', id: planId }, { router_id: routerId })
    return { status: 200, cuerpo: resumen }
}

/* «Reconciliar ahora» y el chequeo del corte. */

const SIN_API = 'El router no tiene usuario y clave de la API REST: complétalos en «Conexión» o genera el script de conexión'
const NO_RESPONDE = 'El router no respondió a la API REST (timeout de 10 s): revisa el túnel o la dirección de la API'
const PORTAL = 'https://portal.argos.test'

/** Lo que «Reconciliar ahora» encontraría en el router, mientras no se haya reconciliado. */
function pendientesReconciliar(router: Router): VistaPreviaReconciliar['cambios'] {
    if (bd.routersReconciliados.includes(router.id)) {
        return []
    }
    if (router.id === 1) {
        return [
            { ruta: '/ip/firewall/filter', clave: 'argosisp:top corte: suspendidos a argos-corte', accion: 'crear', grupo: 'corte' },
            { ruta: '/ip/firewall/filter', clave: 'argosisp:top corte: Filter-Id de RADIUS/CoA', accion: 'crear', grupo: 'corte' },
            { ruta: '/ip/firewall/nat', clave: 'argosisp:top corte NAT: suspendidos a argos-corte-nat', accion: 'mover', grupo: 'corte' },
            { ruta: '/queue/simple', clave: 'argosisp:plan:2', accion: 'actualizar', grupo: 'velocidad' },
        ]
    }
    return []
}

function vistaReconciliar(router: Router): VistaPreviaReconciliar {
    if (!router.tiene_api_password || !router.api_usuario) {
        return { router_id: router.id, cambios: [], menus: [], avisos: [], error: SIN_API }
    }
    if (bd.routersSinRespuesta.includes(router.id)) {
        return { router_id: router.id, cambios: [], menus: [], avisos: [], error: NO_RESPONDE }
    }
    const cambios = pendientesReconciliar(router)
    const rutas = [...new Set(cambios.map(c => c.ruta))].sort((x, y) => x.localeCompare(y, 'en'))
    const cuenta = (ruta: string, accion: VistaPreviaReconciliar['cambios'][number]['accion']) => cambios.filter(c => c.ruta === ruta && c.accion === accion).length
    return {
        router_id: router.id,
        cambios,
        menus: rutas.map(ruta => ({ ruta, crear: cuenta(ruta, 'crear'), actualizar: cuenta(ruta, 'actualizar'), borrar: cuenta(ruta, 'borrar'), mover: cuenta(ruta, 'mover') })),
        avisos: router.id === 2 ? ['ROUTERS_SERVICIO_WALLED_GARDEN no está configurado: el walled garden no se administra'] : [],
        error: null,
    }
}

/** Límites del corte (§10.3): el panel los muestra siempre. */
const LIMITES = [
    'HTTPS (443) no se redirige: el router corta con un reset TCP y el navegador muestra «no se puede conectar». La página aparece al abrir un sitio http:// o con la detección de portal cautivo del teléfono o la computadora.',
    'IPv6 no se redirige: al suspendido solo se le deja DNS, el portal y el walled garden. Si su equipo prefiere IPv6, la página aparece cuando el navegador cae a IPv4.',
]

/**
 * `diagnosticoCorte()` de A2 (§10.2) con datos de muestra: RB-Centro sin las reglas de corte hasta
 * «Reconciliar ahora» (y con sus suspendidos PPPoE fuera de la lista); CCR-Mixco con el portal
 * inalcanzable; RB-Bodega sin API. También lo devuelve «Probar conexión» en el chequeo `corte`.
 */
export function diagnosticoCorte(router: Router): DiagnosticoCorte {
    const destino = 'http://203.0.113.10:80/corte'
    const portal: DiagnosticoCorte['portal'] = { url: PORTAL, fqdn: 'portal.argos.test', ipv4: '203.0.113.10', origen: 'dns', destino_nat: destino, alcanzable: null, http_status: null, detalle: null }
    const vacio = { router_id: router.id, chequeos: [], faltan: [], portal, suspendidos: { total: 0, fuera_de_lista: 0, ejemplos: [] }, limites: LIMITES }
    if (!router.tiene_api_password || !router.api_usuario) {
        return { ...vacio, ok: false, problemas: [{ codigo: 'sin_api', mensaje: SIN_API, reconciliar: false, comandos: [] }] }
    }
    if (bd.routersSinRespuesta.includes(router.id)) {
        return { ...vacio, ok: false, problemas: [{ codigo: 'router_no_responde', mensaje: NO_RESPONDE, reconciliar: false, comandos: [] }] }
    }
    const reconciliado = bd.routersReconciliados.includes(router.id)
    const suspendidos = bd.servicios.filter(s => s.router_id === router.id && s.estado === 'suspendido' && s.ipv4)
    const fuera = reconciliado ? [] : suspendidos.filter(s => (s.tipo_conexion ?? 'pppoe') === 'pppoe')
    const faltan: DiagnosticoCorte['faltan'] = pendientesReconciliar(router).filter(c => c.grupo === 'corte').map(c => ({ ruta: c.ruta, clave: c.clave, accion: c.accion }))
    const alcanzable = router.id !== 2
    const chequeos: DiagnosticoCorte['chequeos'] = [
        { clave: 'lista_suspendidos', ok: true, codigo: null, detalle: suspendidos.length ? 'La address-list suspendidos existe.' : 'No hay suspendidos con IP en este router: la lista no hace falta todavía.', comandos: [], reconciliar: false },
        faltan.length
            ? {
                    clave: 'reglas',
                    ok: false,
                    codigo: 'faltan_reglas',
                    detalle: 'Faltan reglas de corte en filter y NAT: sin ellas un suspendido navega normal.',
                    comandos: [
                        '/ip firewall filter add chain=forward src-address-list=suspendidos action=jump jump-target=argos-corte comment="argosisp:top corte: suspendidos a argos-corte"',
                        `/ip firewall nat add chain=dstnat src-address-list=suspendidos protocol=tcp dst-port=80 action=dst-nat to-addresses=203.0.113.10 to-ports=80 comment="argosisp: corte-nat HTTP a /corte"`,
                    ],
                    reconciliar: true,
                }
            : { clave: 'reglas', ok: true, codigo: null, detalle: 'Las reglas de corte están, activas y en orden.', comandos: [], reconciliar: false },
        alcanzable
            ? { clave: 'portal_http', ok: true, codigo: null, detalle: `El router llega a ${destino} (HTTP 200).`, comandos: [], reconciliar: false }
            : { clave: 'portal_http', ok: false, codigo: 'portal_inalcanzable', detalle: `El router no llega al portal en ${destino}: revisa que el servidor sea alcanzable desde la red del router; si Argos corre en WSL, activa el modo de red mirrored.`, comandos: [`/tool fetch url="${destino}" output=none`], reconciliar: false },
        fuera.length
            ? { clave: 'sesiones_suspendidas', ok: false, codigo: 'suspendidos_fuera_de_lista', detalle: `${fuera.length} de ${suspendidos.length} suspendidos no están en la lista suspendidos: navegan sin corte. Sus sesiones PPPoE deben reconectar con el perfil suspendido.`, comandos: fuera.slice(0, 12).map(s => `/ppp active remove [find address=${s.ipv4}]`), reconciliar: false }
            : { clave: 'sesiones_suspendidas', ok: true, codigo: null, detalle: suspendidos.length ? 'Todos los suspendidos están en la lista.' : 'No hay suspendidos con IP en este router.', comandos: [], reconciliar: false },
        { clave: 'fasttrack', ok: true, codigo: null, detalle: 'Los saltos de corte van antes de FastTrack.', comandos: [], reconciliar: false },
        { clave: 'perfil_suspendido', ok: true, codigo: null, detalle: 'El perfil suspendido pone sus sesiones en la lista suspendidos.', comandos: [], reconciliar: false },
        { clave: 'walled_garden', ok: true, codigo: null, detalle: 'argos-portal y argos-walled tienen el portal y la pasarela.', comandos: [], reconciliar: false },
    ]
    const problemas: DiagnosticoCorte['problemas'] = chequeos
        .filter((c): c is Chequeo & { codigo: NonNullable<Chequeo['codigo']> } => c.ok === false && c.codigo !== null)
        .map(c => ({ codigo: c.codigo, mensaje: c.detalle, reconciliar: c.reconciliar, comandos: c.comandos }))
    return {
        router_id: router.id,
        ok: problemas.length === 0,
        chequeos,
        problemas,
        faltan,
        portal: { ...portal, alcanzable, http_status: alcanzable ? 200 : null, detalle: alcanzable ? null : 'failure: connection timeout (203.0.113.10)' },
        suspendidos: { total: suspendidos.length, fuera_de_lista: fuera.length, ejemplos: fuera.slice(0, 5).map(s => ({ servicio_id: s.id, tipo_conexion: s.tipo_conexion ?? 'pppoe', ipv4: s.ipv4 ?? '' })) },
        limites: LIMITES,
    }
}

type Chequeo = DiagnosticoCorte['chequeos'][number]

function routerDe(solicitud: SolicitudFixture): Router | undefined {
    return bd.routers.find(r => r.id === idDe(solicitud))
}

export const rutasEstrategias: RutasFixture = {
    'GET /api/v1/red/control-velocidad/matriz': conPermiso('routers.ver', () => ({ status: 200, cuerpo: MATRIZ })),

    'POST /api/v1/routers/:id/vista-previa-estrategia': conPermiso('routers.cambiar_control_velocidad', (solicitud) => {
        const router = routerDe(solicitud)
        if (!router) {
            return noEncontrado('el router')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        const previa = vistaPrevia(router, { estrategias: estrategiasDelCuerpo(cuerpo, router.estrategia_velocidad), planes: planesDelCuerpo(cuerpo), reconectar: cuerpo.reconectar === true })
        return previa.valida ? { status: 200, cuerpo: previa } : invalida(previa.errores)
    }),

    'POST /api/v1/routers/:id/cambiar-estrategia-velocidad': conPermiso('routers.cambiar_control_velocidad', (solicitud) => {
        const router = routerDe(solicitud)
        if (!router) {
            return noEncontrado('el router')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        if (cuerpo.version !== router.version) {
            return versionCambiada()
        }
        const a = estrategiasDelCuerpo(cuerpo, router.estrategia_velocidad) ?? router.estrategia_velocidad
        const { errores } = validar(router, a, planesDelRouter(router.id))
        if (errores.length) {
            return invalida(errores)
        }
        Object.assign(router, {
            estrategia_velocidad: structuredClone(a),
            control_velocidad: a.pppoe.aplicacion === 'arbol_pcq' ? 'arbol_pcq' : 'simple',
            modo_velocidad: a.pppoe.aplicacion === 'arbol_pcq' ? 'pcq' : 'simple',
            version: router.version + 1,
            updated_at: ahora(),
        })
        registrarAccion(solicitud, 'routers.cambiar_control_velocidad', { tipo: 'router', id: router.id }, cuerpo)
        return { status: 200, cuerpo: router }
    }),

    /** Como `CambiarEstrategiaPlanRouter`: crea la implementación si no existe; con ella exige `version`. */
    'POST /api/v1/planes/:id/routers/:routerId/estrategia-velocidad': conPermiso('routers.cambiar_control_velocidad', (solicitud) => {
        const planId = idDe(solicitud)
        const routerId = idDe(solicitud, 'routerId')
        const router = bd.routers.find(r => r.id === routerId)
        if (!bd.planes.some(p => p.id === planId) || planId === null) {
            return noEncontrado('el plan')
        }
        if (!router) {
            return noEncontrado('el router')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        const excepcion = leerExcepcion(cuerpo.estrategia_velocidad)
        const planes = planesDelRouter(router.id).filter(p => p.plan_id !== planId)
        const plan = bd.planes.find(p => p.id === planId)
        planes.push({ plan_id: planId, reuso: plan?.reuso ?? 1, excepcion })
        const { errores } = validar(router, router.estrategia_velocidad, planes, () => 'estrategia_velocidad')
        if (errores.length) {
            return invalida(errores)
        }
        let implementacion = bd.implementacionesPlan.find(i => i.plan_id === planId && i.router_id === router.id)
        if (implementacion && cuerpo.version === undefined) {
            return problemaTipado(422, 'validacion', 'Datos inválidos', 'Los datos enviados no son válidos', [{ field: 'version', message: 'La implementación ya existe: envía la version que leíste', rule: 'required' }])
        }
        if (implementacion && cuerpo.version !== implementacion.version) {
            return versionCambiada()
        }
        if (!implementacion) {
            implementacion = {
                id: Math.max(0, ...bd.implementacionesPlan.map(i => i.id)) + 1,
                plan_id: planId,
                router_id: router.id,
                profile_ppp: null,
                pool_ipv4: null,
                pool_ipv6_enlace: null,
                pool_ipv6_delegacion: null,
                local_address: null,
                no_crear_reglas: false,
                rate_limit_override: null,
                reuso: null,
                garantizado_pct: null,
                rafaga_bajada_kbps: null,
                rafaga_subida_kbps: null,
                rafaga_umbral_pct: null,
                rafaga_segundos: null,
                prioridad: null,
                estrategia_velocidad: null,
                version: 1,
                created_at: ahora(),
                updated_at: ahora(),
            }
            bd.implementacionesPlan.push(implementacion)
        }
        if (JSON.stringify(implementacion.estrategia_velocidad) !== JSON.stringify(excepcion)) {
            Object.assign(implementacion, { estrategia_velocidad: excepcion, version: implementacion.version + 1, updated_at: ahora() })
            registrarAccion(solicitud, 'routers.cambiar_control_velocidad', { tipo: 'plan_router', id: implementacion.id }, cuerpo)
        }
        return { status: 200, cuerpo: implementacion }
    }),

    'POST /api/v1/planes/:id/sincronizar': conPermiso('planes.sincronizar', conIdempotencia((solicitud) => {
        const id = idDe(solicitud)
        return id === null ? noEncontrado('el plan') : sincronizar(solicitud, id)
    })),

    'GET /api/v1/routers/:id/vista-previa-reconciliar': conPermiso('routers.reconciliar', (solicitud) => {
        const router = routerDe(solicitud)
        return router ? { status: 200, cuerpo: vistaReconciliar(router) } : noEncontrado('el router')
    }),

    'GET /api/v1/routers/:id/diagnostico-corte': conPermiso('routers.ver', (solicitud) => {
        const router = routerDe(solicitud)
        return router ? { status: 200, cuerpo: diagnosticoCorte(router) } : noEncontrado('el router')
    }),
}

export { MATRIZ } from './estrategiasDatos'
