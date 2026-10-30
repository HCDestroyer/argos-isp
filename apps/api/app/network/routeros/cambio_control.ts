import db from '@adonisjs/lucid/services/db'
import { contextoSistema } from '#shared/contexto'
import { NoEncontrado } from '#shared/errores'
import type { ControlVelocidad } from '#network/velocidad'
import {
    controlDerivado,
    estrategiaEfectiva,
    estrategiasDeControl,
    leerExcepcion,
    mismaEstrategia,
    validarEstrategias,
    velocidadPorCoa,
    type AdvertenciaEstrategia,
    type EstrategiasRouter,
    type ExcepcionEstrategia,
    type ProblemaEstrategia,
} from '#network/estrategia_velocidad'
import { planesParaValidar } from '#network/actions/cambiar_estrategia_velocidad'
import { configCorte, estadoCorteRouter } from '#network/routeros/corte_router'
import type { ServicioRed } from '#network/routeros/estado_deseado'
import MigrarControlRouterOS, {
    type ResultadoMigrarControl,
} from '#network/routeros/actions/migrar_control_router'
import {
    estrategiasEnUso,
    planesDeRouter,
    redesV4DeRouter,
    routerDispatcher,
    serviciosVigentesDeRouter,
    type RouterDispatcher,
} from '#network/routeros/consultas'
import { estadoDeseado } from '#network/routeros/estado_deseado'
import { estadoVelocidadRouter, type LecturaVelocidad } from '#network/routeros/velocidad_router'
import { diferencias } from '#network/routeros/normalizar'
import {
    marcarTransicion,
    perfilSuspendido,
    pideFasttrack,
    quitarTransicion,
    type OpcionesDispatcher,
} from '#network/routeros/dispatcher'

/**
 * Cambio de modo de control de velocidad de un router (`simple` ↔ `arbol_pcq`): lo pide
 * `routers.cambiar_control_velocidad` (A1) con `router.control_cambiado`, y lo ejecuta el worker de
 * RouterOS por lotes con `MigrarControlRouterOS`:
 *
 *   preparar (objetos del modo nuevo) → lote 1 … lote n (servicios; pausa entre lotes) → terminar
 *   (borra lo que sobra del modo anterior)
 *
 * Mientras dura, el router queda marcado en transición (`marcarTransicion`): los eventos de sus
 * servicios aplican el modo nuevo pero no borran lo del anterior. La vista previa
 * (`GET /routers/:id/vista-previa-control?a=`) calcula lo mismo sin tocar el router.
 */

export const LOTE_CAMBIO_CONTROL = 50
export const PAUSA_CAMBIO_CONTROL_MS = 2000

export interface OpcionesCambioControl extends OpcionesDispatcher {
    /** Servicios por lote (por defecto 50) */
    lote?: number
    /** Pausa entre lotes (por defecto 2 s): las sesiones PPPoE desconectadas reconectan de a poco */
    pausaMs?: number
    /** Disconnect a las sesiones PPPoE para que entren con el perfil del modo nuevo (por defecto sí) */
    desconectarPppoe?: boolean
}

export interface EntradaCambioControl {
    router_id: number
    /** Modo obsoleto antes y después (`router.control_cambiado`); en un cambio por capas, el derivado */
    de: ControlVelocidad
    a: ControlVelocidad
    evento_id: string | null
    request_id?: string
    /**
     * Cambio por capas (`router.estrategia_cambiada`): firma del destino (`firmaEstrategia`); si la del
     * router ya es otra, un cambio posterior lo superó. Sin firma se compara el modo (`a`).
     */
    firma?: string | null
    /** Excepción de un plan: solo se migran los servicios de ese plan */
    plan_id?: number | null
    /**
     * Disconnect por lotes a las sesiones PPPoE (el cambio de modo de antes lo hacía siempre). En un
     * cambio por capas es opcional: por defecto conservan lo que tenían y reciben CoA de velocidad.
     */
    reconectar?: boolean
}

export interface ResultadoCambioControl {
    router_id: number
    de: ControlVelocidad
    a: ControlVelocidad
    /** El evento ya se había ejecutado (entrega repetida): no se repite */
    repetido: boolean
    pasos: ResultadoMigrarControl[]
    lotes: number
    desconexiones: number
    /** Sesiones PPPoE con CoA de velocidad y sesiones que conservan lo anterior hasta reconectar */
    coa: number
    conservan: number
    error: string | null
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** ¿Ya terminó el cambio de este evento? (fila final de `audit.red`) */
async function yaEjecutado(routerId: number, eventoId: string | null): Promise<boolean> {
    if (!eventoId) return false
    const fila = await db
        .from('audit.red')
        .where('router_id', routerId)
        .where('tipo', 'routeros')
        .whereRaw(`comando->>'operacion' = 'cambiar_control'`)
        .whereRaw(`comando->>'fase' = 'terminar'`)
        .whereRaw(`comando->>'evento_id' = ?`, [eventoId])
        .first()
    return Boolean(fila)
}

export async function ejecutarCambioControl(
    entrada: EntradaCambioControl,
    opciones: OpcionesCambioControl = {},
): Promise<ResultadoCambioControl> {
    const resultado: ResultadoCambioControl = {
        router_id: entrada.router_id,
        de: entrada.de,
        a: entrada.a,
        repetido: false,
        pasos: [],
        lotes: 0,
        desconexiones: 0,
        coa: 0,
        conservan: 0,
        error: null,
    }
    if (await yaEjecutado(entrada.router_id, entrada.evento_id)) {
        resultado.repetido = true
        return resultado
    }
    const ctx = contextoSistema(
        'worker',
        entrada.request_id ?? `control-${entrada.router_id}-${entrada.evento_id}`,
    )
    const accion = () => new MigrarControlRouterOS(opciones)
    const base = {
        router_id: entrada.router_id,
        de: entrada.de,
        a: entrada.a,
        evento_id: entrada.evento_id,
        firma: entrada.firma ?? null,
        plan_id: entrada.plan_id ?? null,
    }
    // El cambio de modo de antes desconectaba siempre; el de capas, solo si se pide.
    const reconectar = entrada.reconectar ?? opciones.desconectarPppoe ?? entrada.firma === undefined
    const lote = Math.max(1, opciones.lote ?? LOTE_CAMBIO_CONTROL)
    const pausa = opciones.pausaMs ?? PAUSA_CAMBIO_CONTROL_MS

    await marcarTransicion(entrada.router_id)
    try {
        const preparar = await accion().execute({ ...base, fase: 'preparar' }, ctx)
        resultado.pasos.push(preparar)
        if (preparar.superado || preparar.error) {
            resultado.error = preparar.error
            return resultado
        }
        const vigentes = await serviciosVigentesDeRouter(entrada.router_id)
        const ids = vigentes
            .filter(
                (s) =>
                    entrada.plan_id === null ||
                    entrada.plan_id === undefined ||
                    s.plan_id === entrada.plan_id,
            )
            .map((s) => s.servicio_id)
        const lotes = Math.ceil(ids.length / lote)
        for (let i = 0; i < lotes; i++) {
            if (i > 0 && pausa > 0) await dormir(pausa)
            const paso = await accion().execute(
                {
                    ...base,
                    fase: 'lote',
                    servicio_ids: ids.slice(i * lote, (i + 1) * lote),
                    desconectar_pppoe: reconectar,
                    lote: i + 1,
                    lotes,
                },
                ctx,
            )
            resultado.pasos.push(paso)
            resultado.lotes++
            resultado.desconexiones += paso.desconexiones
            resultado.coa += paso.coa
            resultado.conservan += paso.conservan
            if (paso.superado || paso.error) {
                resultado.error = paso.error
                return resultado
            }
        }
        // Una pausa más: los Disconnect del último lote reconectan antes de borrar lo del modo anterior.
        if (lotes > 0 && pausa > 0) await dormir(pausa)
        const terminar = await accion().execute({ ...base, fase: 'terminar' }, ctx)
        resultado.pasos.push(terminar)
        resultado.error = terminar.error
        return resultado
    } finally {
        await quitarTransicion(entrada.router_id)
    }
}

/*
|--------------------------------------------------------------------------
| Vista previa (sin tocar el router)
|--------------------------------------------------------------------------
*/

export interface ObjetoVistaPrevia {
    ruta: string
    /** `comment` (o `name` en `/queue/type`, `list address` en una address-list del corte) */
    clave: string
    nombre: string | null
}

export interface MenuVistaPrevia {
    ruta: string
    crear: number
    actualizar: number
    borrar: number
}

export interface VistaPreviaControl {
    router_id: number
    de: ControlVelocidad
    a: ControlVelocidad
    servicios: number
    lotes: number
    /** Sesiones PPPoE abiertas que reciben Disconnect para entrar con el perfil del modo nuevo */
    sesiones_a_desconectar: number
    menus: MenuVistaPrevia[]
    crear: ObjetoVistaPrevia[]
    actualizar: ObjetoVistaPrevia[]
    borrar: ObjetoVistaPrevia[]
}

export interface PropuestaEstrategia {
    /** Estrategia nueva del router (omitida = la de hoy) */
    estrategias?: EstrategiasRouter
    /** Excepciones nuevas por plan (`plan_id` → parcial o null); las demás quedan como están */
    planes?: Record<number, ExcepcionEstrategia | null>
    /** Disconnect por lotes a las sesiones PPPoE (por defecto no: conservan lo anterior) */
    reconectar?: boolean
}

export interface VistaPreviaEstrategia {
    router_id: number
    valida: boolean
    errores: ProblemaEstrategia[]
    advertencias: AdvertenciaEstrategia[]
    de: EstrategiasRouter
    a: EstrategiasRouter
    /** Excepciones por plan que cambian: antes y después */
    planes: Array<{ plan_id: number; de: ExcepcionEstrategia | null; a: ExcepcionEstrategia | null }>
    crear: ObjetoVistaPrevia[]
    actualizar: ObjetoVistaPrevia[]
    borrar: ObjetoVistaPrevia[]
    menus: MenuVistaPrevia[]
    servicios: number
    lotes: number
    /** Sesiones PPPoE vivas que reciben el rate-limit nuevo por CoA (sin desconectar) */
    sesiones_coa: number
    /** Sesiones PPPoE que siguen con lo anterior hasta reconectar por su cuenta */
    sesiones_conservan: number
    /** Sesiones PPPoE que reciben Disconnect (solo con `reconectar`) */
    sesiones_a_desconectar: number
    orden: Array<'preparar' | 'lotes' | 'terminar'>
}

interface ObjetoPlano {
    ruta: string
    clave: string
    nombre: string | null
    propiedades: Record<string, string>
}

/** Excepciones de estrategia de los planes del router (`plan_id` → parcial). */
async function excepcionesDeRouter(routerId: number): Promise<Map<number, ExcepcionEstrategia | null>> {
    const filas = (await db
        .from('network.planes_routers')
        .where('router_id', routerId)
        .select('plan_id', 'estrategia_velocidad')) as Array<{
        plan_id: number
        estrategia_velocidad: unknown
    }>
    return new Map(filas.map((f) => [Number(f.plan_id), leerExcepcion(f.estrategia_velocidad)]))
}

/** Objetos deseados del router (velocidad, servicios y corte) con esos servicios y esa estrategia. */
function objetosDeseados(
    router: RouterDispatcher,
    estrategias: EstrategiasRouter,
    servicios: ServicioRed[],
    redes: string[],
) {
    const salida = new Map<string, ObjetoPlano>()
    const velocidad = { ...router.velocidad, estrategias, control: controlDerivado(estrategias) }
    const red = { ...router.red, control_velocidad: velocidad.control }
    const sinLectura: LecturaVelocidad = new Map()
    for (const o of estadoVelocidadRouter(velocidad, planesDeRouter(velocidad, servicios), sinLectura)
        .presentes) {
        const clave = o.clave.comment ?? o.clave.name ?? ''
        salida.set(`${o.ruta}|${clave}`, {
            ruta: o.ruta,
            clave,
            nombre: o.propiedades.name ?? o.clave.name ?? null,
            propiedades: o.propiedades,
        })
    }
    for (const s of servicios) {
        for (const o of estadoDeseado(s, red, perfilSuspendido()).presentes) {
            salida.set(`${o.ruta}|${o.comment}`, {
                ruta: o.ruta,
                clave: o.comment,
                nombre: o.propiedades.name ?? o.propiedades.list ?? null,
                propiedades: o.propiedades,
            })
        }
    }
    // Corte y FastTrack: lo único que cambia con la estrategia es la excepción de FastTrack.
    const corte = estadoCorteRouter(
        configCorte(),
        { fasttrack: pideFasttrack(estrategiasEnUso(velocidad, servicios)), redes_v4: redes },
        [],
    )
    for (const r of corte.reglas) {
        salida.set(`${r.ruta}|${r.comment}`, {
            ruta: r.ruta,
            clave: r.comment,
            nombre: null,
            propiedades: r.propiedades,
        })
    }
    return salida
}

function compararObjetos(antes: Map<string, ObjetoPlano>, despues: Map<string, ObjetoPlano>) {
    const plano = ({ ruta, clave, nombre }: ObjetoPlano): ObjetoVistaPrevia => ({ ruta, clave, nombre })
    const crear = [...despues].filter(([k]) => !antes.has(k)).map(([, o]) => plano(o))
    const borrar = [...antes].filter(([k]) => !despues.has(k)).map(([, o]) => plano(o))
    const actualizar = [...despues]
        .filter(([k, o]) => {
            const previo = antes.get(k)
            return (
                previo !== undefined && Object.keys(diferencias(o.propiedades, previo.propiedades)).length > 0
            )
        })
        .map(([, o]) => plano(o))
    return { crear, actualizar, borrar, menus: contarMenus(crear, actualizar, borrar) }
}

function contarMenus(
    crear: ObjetoVistaPrevia[],
    actualizar: ObjetoVistaPrevia[],
    borrar: ObjetoVistaPrevia[],
) {
    const menus = new Map<string, MenuVistaPrevia>()
    const contar = (lista: ObjetoVistaPrevia[], campo: 'crear' | 'actualizar' | 'borrar') => {
        for (const o of lista) {
            const m = menus.get(o.ruta) ?? { ruta: o.ruta, crear: 0, actualizar: 0, borrar: 0 }
            m[campo]++
            menus.set(o.ruta, m)
        }
    }
    contar(crear, 'crear')
    contar(actualizar, 'actualizar')
    contar(borrar, 'borrar')
    return [...menus.values()].sort((x, y) => x.ruta.localeCompare(y.ruta, 'en'))
}

/**
 * Lo que un cambio de estrategia crea, corrige y borra en el router, calculado con Postgres (sin leer
 * el router), con la matriz de combinaciones, las advertencias y qué pasa con las sesiones PPPoE vivas
 * (`contratos/control-velocidad.md` §4). La pantalla la muestra antes de confirmar.
 */
export async function vistaPreviaEstrategia(
    routerId: number,
    propuesta: PropuestaEstrategia,
): Promise<VistaPreviaEstrategia> {
    const router = await routerDispatcher(routerId)
    if (!router) throw new NoEncontrado(`El router ${routerId} no existe`)
    const de = router.velocidad.estrategias
    const a = propuesta.estrategias ?? de
    const excepciones = await excepcionesDeRouter(routerId)
    const nuevas = new Map(excepciones)
    const planesCambian: VistaPreviaEstrategia['planes'] = []
    for (const [clave, valor] of Object.entries(propuesta.planes ?? {})) {
        const id = Number(clave)
        const limpia = leerExcepcion(valor)
        planesCambian.push({ plan_id: id, de: excepciones.get(id) ?? null, a: limpia })
        nuevas.set(id, limpia)
    }
    const enRouter = await planesParaValidar(routerId, db.connection())
    const validacion = validarEstrategias({
        estrategias: a,
        planes: enRouter.map((p) => ({
            ...p,
            excepcion: nuevas.has(p.plan_id) ? (nuevas.get(p.plan_id) ?? null) : p.excepcion,
        })),
        routeros_version: router.velocidad.routeros_version,
        capacidad_bajada_kbps: router.velocidad.capacidad_bajada_kbps,
        capacidad_subida_kbps: router.velocidad.capacidad_subida_kbps,
    })
    const todos = await serviciosVigentesDeRouter(routerId)
    const redes = await redesV4DeRouter(routerId)
    const reconectar = propuesta.reconectar ?? false
    const despues = todos.map((s): ServicioRed => {
        const excepcion = nuevas.get(s.plan_id) ?? null
        const estrategia = estrategiaEfectiva(a, excepcion, s.tipo_conexion)
        return {
            ...s,
            estrategia,
            estrategia_pppoe: estrategiaEfectiva(a, excepcion, 'pppoe'),
            estrategia_sesion: s.estrategia_sesion && reconectar ? estrategia : s.estrategia_sesion,
        }
    })
    const salida: VistaPreviaEstrategia = {
        router_id: routerId,
        valida: validacion.errores.length === 0,
        errores: validacion.errores,
        advertencias: validacion.advertencias,
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
    if (!salida.valida) return salida
    Object.assign(
        salida,
        compararObjetos(
            objetosDeseados(router, de, todos, redes),
            objetosDeseados(router, a, despues, redes),
        ),
    )
    const cambian = despues.filter((s, i) => !mismaEstrategia(s.estrategia, todos[i]!.estrategia))
    salida.servicios = cambian.length
    salida.lotes = Math.ceil(cambian.length / LOTE_CAMBIO_CONTROL)
    for (const [i, s] of despues.entries()) {
        const antes = todos[i]!
        if (s.tipo_conexion !== 'pppoe' || !antes.sesion || mismaEstrategia(s.estrategia, antes.estrategia)) {
            continue
        }
        const conQueEntro = antes.estrategia_sesion ?? antes.estrategia
        if (reconectar) {
            if (!mismaEstrategia(conQueEntro, s.estrategia)) salida.sesiones_a_desconectar++
            continue
        }
        if (!mismaEstrategia(conQueEntro, s.estrategia)) salida.sesiones_conservan++
        if (
            (s.estado === 'activo' || s.estado === 'limitado') &&
            velocidadPorCoa(conQueEntro) &&
            velocidadPorCoa(s.estrategia)
        ) {
            salida.sesiones_coa++
        }
    }
    return salida
}

/**
 * Vista previa del cambio de modo obsoleto (`GET /routers/:id/vista-previa-control?a=`): la de
 * estrategia con el atajo `simple` o `arbol_pcq`, con Disconnect por lotes como hacía el modo.
 */
export async function vistaPreviaControl(routerId: number, a: ControlVelocidad): Promise<VistaPreviaControl> {
    const router = await routerDispatcher(routerId)
    if (!router) throw new NoEncontrado(`El router ${routerId} no existe`)
    const de = router.velocidad.control
    if (de === a) {
        const vigentes = await serviciosVigentesDeRouter(routerId)
        return {
            router_id: routerId,
            de,
            a,
            servicios: vigentes.length,
            lotes: 0,
            sesiones_a_desconectar: 0,
            menus: [],
            crear: [],
            actualizar: [],
            borrar: [],
        }
    }
    const vista = await vistaPreviaEstrategia(routerId, {
        estrategias: estrategiasDeControl(a),
        reconectar: true,
    })
    const todos = await serviciosVigentesDeRouter(routerId)
    return {
        router_id: routerId,
        de,
        a,
        servicios: todos.length,
        lotes: Math.ceil(todos.length / LOTE_CAMBIO_CONTROL),
        sesiones_a_desconectar: todos.filter((s) => s.tipo_conexion === 'pppoe' && s.sesion).length,
        menus: vista.menus,
        crear: vista.crear,
        actualizar: vista.actualizar,
        borrar: vista.borrar,
    }
}
