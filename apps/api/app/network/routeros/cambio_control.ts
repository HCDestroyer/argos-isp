import db from '@adonisjs/lucid/services/db'
import { contextoSistema } from '#shared/contexto'
import { NoEncontrado } from '#shared/errores'
import type { ControlVelocidad } from '#network/velocidad'
import MigrarControlRouterOS, {
    type ResultadoMigrarControl,
} from '#network/routeros/actions/migrar_control_router'
import { planesDeRouter, routerDispatcher, serviciosVigentesDeRouter } from '#network/routeros/consultas'
import { estadoDeseado } from '#network/routeros/estado_deseado'
import { estadoVelocidadRouter, type LecturaVelocidad } from '#network/routeros/velocidad_router'
import { diferencias } from '#network/routeros/normalizar'
import {
    marcarTransicion,
    perfilSuspendido,
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
    de: ControlVelocidad
    a: ControlVelocidad
    evento_id: string | null
    request_id?: string
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
    const base = { router_id: entrada.router_id, de: entrada.de, a: entrada.a, evento_id: entrada.evento_id }
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
        const ids = vigentes.map((s) => s.servicio_id)
        const lotes = Math.ceil(ids.length / lote)
        for (let i = 0; i < lotes; i++) {
            if (i > 0 && pausa > 0) await dormir(pausa)
            const paso = await accion().execute(
                {
                    ...base,
                    fase: 'lote',
                    servicio_ids: ids.slice(i * lote, (i + 1) * lote),
                    desconectar_pppoe: opciones.desconectarPppoe ?? true,
                    lote: i + 1,
                    lotes,
                },
                ctx,
            )
            resultado.pasos.push(paso)
            resultado.lotes++
            resultado.desconexiones += paso.desconexiones
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
    /** `comment` (o `name` en `/queue/type`) que identifica el objeto */
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

interface ObjetoPlano {
    ruta: string
    clave: string
    nombre: string | null
    propiedades: Record<string, string>
}

/**
 * Lo que el cambio de modo crea, corrige y borra en el router, calculado con los datos de Postgres
 * (estado deseado de los dos modos, sin leer el router): objetos de velocidad por router y por plan
 * más los de cada servicio. Lo muestra A4 antes de confirmar `routers.cambiar_control_velocidad`.
 */
export async function vistaPreviaControl(routerId: number, a: ControlVelocidad): Promise<VistaPreviaControl> {
    const router = await routerDispatcher(routerId)
    if (!router) throw new NoEncontrado(`El router ${routerId} no existe`)
    const de = router.velocidad.control
    const todos = await serviciosVigentesDeRouter(routerId)
    const sinLectura: LecturaVelocidad = new Map()

    const objetos = (modo: ControlVelocidad): Map<string, ObjetoPlano> => {
        const salida = new Map<string, ObjetoPlano>()
        const velocidad = { ...router.velocidad, control: modo }
        const red = { ...router.red, control_velocidad: modo }
        for (const o of estadoVelocidadRouter(velocidad, planesDeRouter(velocidad, todos), sinLectura)
            .presentes) {
            const clave = o.clave.comment ?? o.clave.name ?? ''
            salida.set(`${o.ruta}|${clave}`, {
                ruta: o.ruta,
                clave,
                nombre: o.propiedades.name ?? o.clave.name ?? null,
                propiedades: o.propiedades,
            })
        }
        for (const s of todos) {
            for (const o of estadoDeseado(s, red, perfilSuspendido()).presentes) {
                salida.set(`${o.ruta}|${o.comment}`, {
                    ruta: o.ruta,
                    clave: o.comment,
                    nombre: o.propiedades.name ?? o.propiedades.list ?? null,
                    propiedades: o.propiedades,
                })
            }
        }
        return salida
    }

    const antes = de === a ? new Map<string, ObjetoPlano>() : objetos(de)
    const despues = de === a ? new Map<string, ObjetoPlano>() : objetos(a)
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

    return {
        router_id: routerId,
        de,
        a,
        servicios: todos.length,
        lotes: de === a ? 0 : Math.ceil(todos.length / LOTE_CAMBIO_CONTROL),
        sesiones_a_desconectar:
            de === a ? 0 : todos.filter((s) => s.tipo_conexion === 'pppoe' && s.sesion).length,
        menus: [...menus.values()].sort((x, y) => x.ruta.localeCompare(y.ruta, 'en')),
        crear,
        actualizar,
        borrar,
    }
}
