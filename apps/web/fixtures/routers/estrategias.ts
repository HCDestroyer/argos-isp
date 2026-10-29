import type { Problem, Schema } from '@argosisp/contracts'
import type { RespuestaFixture, RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import type { Estrategia, EstrategiaParcial, EstrategiasPlan, EstrategiasRouter, RouterConEstrategia, SincronizacionPlan, TipoConexionVelocidad, VistaPreviaEstrategia } from '../../app/types/controlVelocidad'
import { APLICACIONES, EXTRAS, PADRES, TIPOS_COLA, TIPOS_CONEXION_VELOCIDAD } from '../../app/types/controlVelocidad'
import { ESTRATEGIA_SIMPLE, MATRIZ } from './estrategiasDatos'
import { bd } from '../bd'
import { ahora, conPermiso, cuerpoObjeto, idDe, noEncontrado, problemaTipado, registrarAccion, versionCambiada } from '../comun'

/**
 * Control de velocidad por capas y sincronizar plan, como `contratos/control-velocidad.md` (A2):
 * la matriz (§3), la vista previa (§4), cambiar la estrategia del router o la excepción de un plan
 * y sincronizar un plan (§5). La validación repite las reglas de la matriz; los objetos de RouterOS
 * de la vista previa son una muestra con los nombres del contrato.
 *
 * Datos: RB-Centro (1) migrado de «simple» con RouterOS 7.24.5; CCR-Mixco (2) de «árbol PCQ» con
 * RouterOS 6.49.10 (sin CAKE ni fq_codel); RB-Bodega (3) sin versión conocida.
 */

type Router = Schema<'Router'> & RouterConEstrategia
type Errores = NonNullable<Problem['errors']>

function familia(estrategia: Estrategia): 'simples' | 'arbol' {
    return estrategia.aplicacion === 'arbol_pcq' ? 'arbol' : 'simples'
}

function mayor(version: string | null | undefined): number | null {
    const valor = Number(/^(\d+)\./.exec(version ?? '')?.[1])
    return Number.isInteger(valor) ? valor : null
}

function esEstrategia(valor: unknown): valor is Estrategia {
    if (typeof valor !== 'object' || valor === null) {
        return false
    }
    const e = valor as Record<string, unknown>
    return (APLICACIONES as readonly unknown[]).includes(e.aplicacion) && (PADRES as readonly unknown[]).includes(e.padre)
        && (TIPOS_COLA as readonly unknown[]).includes(e.tipo_cola) && typeof e.extras === 'object' && e.extras !== null
        && EXTRAS.every(x => typeof (e.extras as Record<string, unknown>)[x] === 'boolean')
}

/** `validarEstrategias()` (§3): errores con `field` = ruta de la capa, y advertencias. */
export function validar(router: Router, estrategias: EstrategiasRouter, prefijo = 'estrategia_velocidad'): { errores: Errores, advertencias: VistaPreviaEstrategia['advertencias'] } {
    const errores: Errores = []
    const advertencias: VistaPreviaEstrategia['advertencias'] = []
    for (const tipo of TIPOS_CONEXION_VELOCIDAD) {
        const e = estrategias[tipo]
        const ruta = `${prefijo}.${tipo}`
        if (!esEstrategia(e)) {
            errores.push({ field: ruta, message: 'Faltan capas o hay un valor desconocido', rule: 'enum' })
            continue
        }
        const fila = MATRIZ.aplicaciones.find(a => a.valor === e.aplicacion)!
        if (!fila.tipos_conexion.includes(tipo)) {
            errores.push({
                field: `${ruta}.aplicacion`,
                rule: 'aplicacion_tipo',
                message: tipo === 'pppoe' ? 'PPPoE ya crea su cola dinámica: usa radius_rate_limit o perfil_ppp' : `${e.aplicacion} no aplica a ${tipo}: sin sesión PPP no hay perfil; usa cola_simple, pcq_plan o arbol_pcq`,
            })
        }
        if (!fila.tipos_cola.includes(e.tipo_cola)) {
            errores.push({ field: `${ruta}.tipo_cola`, rule: 'tipo_cola', message: e.tipo_cola === 'pcq' ? 'Un PCQ reparte entre varios clientes: en la cola de uno solo no sirve' : `${e.aplicacion} necesita PCQ: el tope de cada cliente es el pcq-rate` })
        }
        if (e.tipo_cola === 'fq_codel' || e.tipo_cola === 'cake') {
            const v = mayor(router.routeros_version)
            if (v !== null && v < 7) {
                errores.push({ field: `${ruta}.tipo_cola`, rule: 'version', message: `${e.tipo_cola} necesita RouterOS 7; este router tiene ${router.routeros_version}` })
            }
            else if (v === null) {
                advertencias.push({ regla: 'version_desconocida', mensaje: `${e.tipo_cola} necesita RouterOS 7 y la versión del router no se conoce: se revisa antes de escribir.` })
            }
        }
        if (!e.extras.excluir_fasttrack) {
            advertencias.push({ regla: 'fasttrack', mensaje: `${tipo}: sin verificar FastTrack, las colas no limitan lo acelerado.` })
        }
        if ((e.extras.prioridad || e.extras.garantizado) && e.padre === 'ninguno') {
            advertencias.push({ regla: 'sin_padre_prioridad', mensaje: `${tipo}: prioridad y garantizado sin padre no tienen a quién repartir.` })
        }
    }
    const conTecho = TIPOS_CONEXION_VELOCIDAD.map(t => estrategias[t]).filter(e => esEstrategia(e) && (e.padre === 'por_router' || e.padre === 'jerarquico'))
    if (new Set(conTecho.map(familia)).size > 1) {
        errores.push({ field: `${prefijo}.pppoe.padre`, rule: 'familia_router', message: 'El techo del router se partiría en dos: colas simples y queue tree' })
    }
    if (conTecho.length && !router.capacidad_bajada_kbps) {
        advertencias.push({ regla: 'sin_techo', mensaje: 'El router no tiene capacidad del enlace: el techo queda sin límite (max-limit=0).' })
    }
    if (conTecho.length && conTecho.length < TIPOS_CONEXION_VELOCIDAD.length) {
        advertencias.push({ regla: 'fuera_del_techo', mensaje: 'Algún tipo de conexión no cuelga del techo del router: ese tráfico no cuenta para la capacidad.' })
    }
    return { errores, advertencias }
}

function efectiva(router: Estrategia, plan: EstrategiaParcial | undefined): Estrategia {
    return { aplicacion: plan?.aplicacion ?? router.aplicacion, padre: plan?.padre ?? router.padre, tipo_cola: plan?.tipo_cola ?? router.tipo_cola, extras: { ...router.extras, ...(plan?.extras ?? {}) } }
}

function iguales(a: Estrategia, b: Estrategia): boolean {
    return JSON.stringify(a) === JSON.stringify(b)
}

function serviciosDelRouter(routerId: number) {
    return bd.servicios.filter(s => s.router_id === routerId && s.estado !== 'retirado')
}

function vistaPrevia(router: Router, a: EstrategiasRouter, reconectar: boolean, planId: number | null = null): VistaPreviaEstrategia {
    const de = router.estrategia_velocidad ?? ESTRATEGIA_SIMPLE
    const { errores, advertencias } = validar(router, a)
    const crear: VistaPreviaEstrategia['crear'] = []
    const borrar: VistaPreviaEstrategia['borrar'] = []
    const actualizar: VistaPreviaEstrategia['actualizar'] = []
    const servicios = serviciosDelRouter(router.id).filter(s => planId === null || s.plan_id === planId)
    for (const tipo of TIPOS_CONEXION_VELOCIDAD) {
        if (iguales(de[tipo], a[tipo])) {
            continue
        }
        const planes = [...new Set(servicios.filter(s => (s.tipo_conexion ?? 'pppoe') === tipo).map(s => s.plan_id))]
        if (a[tipo].padre !== de[tipo].padre && (a[tipo].padre === 'por_router' || a[tipo].padre === 'jerarquico') && !crear.some(o => o.clave === 'argosisp:router')) {
            crear.push({ ruta: a[tipo].aplicacion === 'arbol_pcq' ? '/queue/tree' : '/queue/simple', clave: 'argosisp:router', nombre: 'argosisp-router' })
        }
        if (a[tipo].tipo_cola !== de[tipo].tipo_cola && a[tipo].tipo_cola !== 'default' && a[tipo].tipo_cola !== 'pcq') {
            crear.push({ ruta: '/queue/type', clave: `argosisp:${a[tipo].tipo_cola}`, nombre: `argosisp-${a[tipo].tipo_cola.replace('_', '-')}` })
        }
        for (const plan of planes) {
            if (a[tipo].aplicacion === 'pcq_plan' && de[tipo].aplicacion !== 'pcq_plan') {
                crear.push({ ruta: '/queue/simple', clave: `argosisp:plan-${plan}-pcq`, nombre: `argosisp-plan-${plan}-pcq` })
            }
            if (de[tipo].aplicacion === 'pcq_plan' && a[tipo].aplicacion !== 'pcq_plan') {
                borrar.push({ ruta: '/queue/simple', clave: `argosisp:plan-${plan}-pcq`, nombre: `argosisp-plan-${plan}-pcq` })
            }
            if (tipo === 'pppoe' && (a[tipo].aplicacion === 'perfil_ppp' || a[tipo].tipo_cola !== 'default' || a[tipo].padre !== de[tipo].padre)) {
                actualizar.push({ ruta: '/ppp/profile', clave: `argosisp:plan-${plan}`, nombre: `plan-${plan}` })
            }
        }
        if (tipo !== 'pppoe' && de[tipo].aplicacion === 'cola_simple' && a[tipo].aplicacion !== 'cola_simple') {
            servicios.filter(s => s.tipo_conexion === tipo).forEach(s => borrar.push({ ruta: '/queue/simple', clave: `argosisp:servicio-${s.id}`, nombre: `argosisp-servicio-${s.id}` }))
        }
    }
    const menus = [...new Set([...crear, ...actualizar, ...borrar].map(o => o.ruta))].map(ruta => ({
        ruta,
        crear: crear.filter(o => o.ruta === ruta).length,
        actualizar: actualizar.filter(o => o.ruta === ruta).length,
        borrar: borrar.filter(o => o.ruta === ruta).length,
    }))
    const sesiones = bd.sesiones.filter(s => s.fin === null && servicios.some(v => v.id === s.servicio_id))
    const cambiaPppoe = !iguales(de.pppoe, a.pppoe)
    const enVivo = ['radius_rate_limit', 'perfil_ppp'].includes(a.pppoe.aplicacion)
    return {
        router_id: router.id,
        valida: errores.length === 0,
        errores: errores.map(e => ({ field: e.field, rule: e.rule ?? '', message: e.message })),
        advertencias,
        de,
        a,
        crear,
        actualizar,
        borrar,
        menus,
        servicios: servicios.length,
        lotes: Math.max(1, Math.ceil(servicios.length / 50)),
        sesiones_coa: cambiaPppoe && enVivo ? sesiones.length : 0,
        sesiones_conservan: cambiaPppoe && !reconectar ? sesiones.length : 0,
        sesiones_a_desconectar: cambiaPppoe && reconectar ? sesiones.length : 0,
        orden: ['preparar', 'lotes', 'terminar'],
    }
}

function estrategiasDelCuerpo(cuerpo: Record<string, unknown>, router: Router): EstrategiasRouter {
    return (typeof cuerpo.estrategia_velocidad === 'object' && cuerpo.estrategia_velocidad !== null ? cuerpo.estrategia_velocidad : router.estrategia_velocidad ?? ESTRATEGIA_SIMPLE) as EstrategiasRouter
}

const invalida = (errores: Errores): RespuestaFixture => problemaTipado(422, 'validacion', 'Combinación no válida', 'Algunas capas no combinan: revisa las marcadas', errores)

function sincronizar(solicitud: SolicitudFixture, planId: number): RespuestaFixture {
    const plan = bd.planes.find(p => p.id === planId)
    if (!plan) {
        return noEncontrado('el plan')
    }
    const routerId = Number(solicitud.query.get('router_id')) || null
    const routers = bd.routers.filter(r => (routerId === null || r.id === routerId) && (bd.planesPorRouter[r.id] ?? []).includes(planId))
    if (routerId !== null && !routers.length) {
        return noEncontrado('el plan en ese router')
    }
    const resumen: SincronizacionPlan = { plan_id: planId, aaa_reescritos: 0, routers: [] }
    for (const router of routers) {
        const servicios = serviciosDelRouter(router.id).filter(s => s.plan_id === planId)
        const sesiones = bd.sesiones.filter(s => s.fin === null && servicios.some(v => v.id === s.servicio_id))
        resumen.aaa_reescritos += servicios.length
        // RB-Bodega está inactivo: el router no responde y el error no hace fallar a los demás.
        const caido = !router.activo
        resumen.routers.push({
            router_id: router.id,
            nombre: router.nombre,
            servicios: servicios.length,
            sesiones_actualizadas: caido ? 0 : sesiones.length,
            sesiones_sin_coa: caido ? sesiones.length : 0,
            colas_cambiadas: caido ? 0 : ((router as Router).estrategia_velocidad?.pppoe.aplicacion === 'arbol_pcq' ? 2 : servicios.filter(s => s.tipo_conexion && s.tipo_conexion !== 'pppoe').length + 1),
            errores: caido ? [`${router.nombre} no respondió: el router está inactivo o fuera de línea`] : [],
        })
    }
    registrarAccion(solicitud, 'planes.sincronizar', { tipo: 'plan', id: planId }, { router_id: routerId })
    return { status: 200, cuerpo: resumen }
}

export const rutasEstrategias: RutasFixture = {
    'GET /api/v1/red/control-velocidad/matriz': conPermiso('routers.ver', () => ({ status: 200, cuerpo: MATRIZ })),

    'POST /api/v1/routers/:id/vista-previa-estrategia': conPermiso('routers.cambiar_control_velocidad', (solicitud) => {
        const router = bd.routers.find(r => r.id === idDe(solicitud)) as Router | undefined
        if (!router) {
            return noEncontrado('el router')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        // Con `planes`: la estrategia efectiva de ese plan (router + su excepción), solo con sus servicios.
        const planes = typeof cuerpo.planes === 'object' && cuerpo.planes !== null ? Object.entries(cuerpo.planes as Record<string, EstrategiasPlan | null>) : []
        const [planTexto, parcial] = planes[0] ?? [null, null]
        const base = estrategiasDelCuerpo(cuerpo, router)
        const a = planTexto === null ? base : Object.fromEntries(TIPOS_CONEXION_VELOCIDAD.map(t => [t, efectiva(base[t], parcial?.[t])])) as EstrategiasRouter
        const previa = vistaPrevia(router, a, cuerpo.reconectar === true, planTexto === null ? null : Number(planTexto))
        return previa.valida ? { status: 200, cuerpo: previa } : invalida(previa.errores)
    }),

    'POST /api/v1/routers/:id/cambiar-estrategia-velocidad': conPermiso('routers.cambiar_control_velocidad', (solicitud) => {
        const router = bd.routers.find(r => r.id === idDe(solicitud)) as Router | undefined
        if (!router) {
            return noEncontrado('el router')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        if (cuerpo.version !== router.version) {
            return versionCambiada()
        }
        const a = estrategiasDelCuerpo(cuerpo, router)
        const { errores } = validar(router, a)
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

    'POST /api/v1/planes/:id/routers/:router_id/estrategia-velocidad': conPermiso('routers.cambiar_control_velocidad', (solicitud) => {
        const planId = idDe(solicitud)
        const routerId = idDe(solicitud, 'router_id')
        const router = bd.routers.find(r => r.id === routerId) as Router | undefined
        const implementacion = bd.implementacionesPlan.find(i => i.plan_id === planId && i.router_id === routerId)
        if (!router || planId === null || !(bd.planesPorRouter[router.id] ?? []).includes(planId)) {
            return noEncontrado('el plan en ese router')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        if (implementacion && cuerpo.version !== implementacion.version) {
            return versionCambiada()
        }
        const parcial = (cuerpo.estrategia_velocidad ?? null) as EstrategiasPlan | null
        const base = router.estrategia_velocidad ?? ESTRATEGIA_SIMPLE
        const combinada = Object.fromEntries(TIPOS_CONEXION_VELOCIDAD.map(t => [t, efectiva(base[t], parcial?.[t])])) as Record<TipoConexionVelocidad, Estrategia>
        const { errores } = validar(router, combinada, `estrategia_velocidad`)
        if (errores.length) {
            return invalida(errores)
        }
        const clave = `${planId}:${router.id}`
        bd.estrategiasPlanes = Object.fromEntries([...Object.entries(bd.estrategiasPlanes).filter(([k]) => k !== clave), ...(parcial ? [[clave, parcial] as const] : [])])
        if (implementacion) {
            Object.assign(implementacion, { estrategia_velocidad: parcial, version: implementacion.version + 1, updated_at: ahora() })
        }
        registrarAccion(solicitud, 'routers.cambiar_control_velocidad', { tipo: 'plan', id: planId }, cuerpo)
        return { status: 200, cuerpo: implementacion ? { ...implementacion, estrategia_velocidad: parcial } : { plan_id: planId, router_id: router.id, estrategia_velocidad: parcial } }
    }),

    'POST /api/v1/planes/:id/sincronizar': conPermiso('planes.sincronizar', (solicitud) => {
        const id = idDe(solicitud)
        return id === null ? noEncontrado('el plan') : sincronizar(solicitud, id)
    }),
}

export { ESTRATEGIA_ARBOL, ESTRATEGIA_SIMPLE, MATRIZ } from './estrategiasDatos'
