import type { ObjetoRouterOS, Propiedades, RutaRouterOS } from '#network/routeros/cliente'
import { NoEncontrado } from '#shared/errores'
import { ErrorRouterOS } from '#network/routeros/errores'
import { RouterSinCredenciales } from '#network/routeros/router'
import { diferencias } from '#network/routeros/normalizar'
import { configCorte, estadoCorteRouter, normalizarDireccion } from '#network/routeros/corte_router'
import {
    estrategiasEnUso,
    planesDeRouter,
    redesV4DeRouter,
    routerDispatcher,
    serviciosVigentesDeRouter,
} from '#network/routeros/consultas'
import { estadoVelocidadRouter, sobrantesVelocidad } from '#network/routeros/velocidad_router'
import {
    estadoDeseado,
    estadoVacio,
    RUTAS_SERVICIO,
    servicioDeComment,
} from '#network/routeros/estado_deseado'
import {
    fabricaPorDefecto,
    leerCorteRouter,
    leerVelocidadRouter,
    perfilSuspendido,
    pideFasttrack,
    planCorte,
    type CambioCorte,
    type OpcionesDispatcher,
} from '#network/routeros/dispatcher'

/**
 * Lecturas de diagnóstico contra el router (solo `GET`, salvo `/tool/fetch`, que no cambia nada y queda
 * en `audit.red`):
 *
 * - `vistaPreviaReconciliar`: lo que «Reconciliar ahora» crearía, cambiaría, movería y borraría
 *   (servicios, velocidad y corte), sin escribir.
 * - `diagnosticoCorte`: el chequeo `corte` de «Probar conexión» (A1): reglas y listas del corte, perfil
 *   suspendido, walled garden y si el router llega al portal, con qué hacer en lenguaje simple.
 */

export interface CambioVistaPrevia {
    ruta: string
    clave: string
    accion: 'crear' | 'actualizar' | 'borrar' | 'mover'
    /** `servicio`, `velocidad` o `corte` */
    grupo: 'servicio' | 'velocidad' | 'corte'
}

export interface VistaPreviaReconciliar {
    router_id: number
    cambios: CambioVistaPrevia[]
    menus: Array<{ ruta: string; crear: number; actualizar: number; borrar: number; mover: number }>
    avisos: string[]
    /** El router no respondió o no tiene credenciales: no hay vista previa */
    error: string | null
}

function igual(deseado: Propiedades, actual: ObjetoRouterOS | undefined): boolean {
    return actual !== undefined && Object.keys(diferencias(deseado, actual)).length === 0
}

export async function vistaPreviaReconciliar(
    routerId: number,
    opciones: OpcionesDispatcher = {},
): Promise<VistaPreviaReconciliar> {
    const router = await routerDispatcher(routerId, undefined, opciones.red)
    if (!router) throw new NoEncontrado(`El router ${routerId} no existe`)
    const salida: VistaPreviaReconciliar = {
        router_id: routerId,
        cambios: [],
        menus: [],
        avisos: [],
        error: null,
    }
    const todos = await serviciosVigentesDeRouter(routerId)
    const planes = planesDeRouter(router.velocidad, todos)
    try {
        const cliente = (opciones.clientes ?? fabricaPorDefecto)(router.api)
        try {
            // Corte
            const lecturaCorte = await leerCorteRouter(cliente)
            const corte = estadoCorteRouter(
                configCorte(),
                {
                    fasttrack: pideFasttrack(estrategiasEnUso(router.velocidad, todos)),
                    redes_v4: await redesV4DeRouter(routerId),
                },
                lecturaCorte.get('/ppp/profile') ?? [],
            )
            salida.avisos.push(...corte.avisos)
            for (const c of planCorte(corte, lecturaCorte)) {
                salida.cambios.push({ ruta: c.ruta, clave: c.clave, accion: c.accion, grupo: 'corte' })
            }

            // Velocidad
            const lectura = await leerVelocidadRouter(cliente)
            const velocidad = estadoVelocidadRouter(router.velocidad, planes, lectura)
            salida.avisos.push(...velocidad.avisos, ...velocidad.errores.map((e) => e.detalle))
            for (const o of velocidad.presentes) {
                const existentes = (lectura.get(o.ruta as never) ?? []).filter((x: ObjetoRouterOS) =>
                    Object.entries(o.clave).every(([k, v]) => x[k] === v),
                )
                const clave = o.clave.comment ?? o.clave.name ?? ''
                if (existentes.length === 0) {
                    salida.cambios.push({ ruta: o.ruta, clave, accion: 'crear', grupo: 'velocidad' })
                } else if (existentes.length > 1 || !igual(o.propiedades, existentes[0])) {
                    salida.cambios.push({ ruta: o.ruta, clave, accion: 'actualizar', grupo: 'velocidad' })
                }
            }
            for (const { ruta, objeto } of sobrantesVelocidad(velocidad, lectura)) {
                salida.cambios.push({
                    ruta,
                    clave: objeto.comment ?? objeto.name ?? objeto['.id'],
                    accion: 'borrar',
                    grupo: 'velocidad',
                })
            }

            // Servicios
            const porMenu = new Map<RutaRouterOS, ObjetoRouterOS[]>()
            for (const ruta of RUTAS_SERVICIO) porMenu.set(ruta, await cliente.listar(ruta))
            const vigentes = new Set(todos.map((s) => s.servicio_id))
            const estados = todos.map((s) => estadoDeseado(s, router.red, perfilSuspendido()))
            const enRouter = new Set<number>()
            for (const lista of porMenu.values()) {
                for (const o of lista) {
                    const id = servicioDeComment(o.comment)
                    if (id !== null && !vigentes.has(id)) enRouter.add(id)
                }
            }
            for (const estado of [...estados, ...[...enRouter].map((id) => estadoVacio(id))]) {
                for (const o of estado.presentes) {
                    const actual = (porMenu.get(o.ruta) ?? []).filter((x) => x.comment === o.comment)
                    if (actual.length === 0) {
                        salida.cambios.push({
                            ruta: o.ruta,
                            clave: o.comment,
                            accion: 'crear',
                            grupo: 'servicio',
                        })
                    } else if (actual.length > 1 || !igual(o.propiedades, actual[0])) {
                        salida.cambios.push({
                            ruta: o.ruta,
                            clave: o.comment,
                            accion: 'actualizar',
                            grupo: 'servicio',
                        })
                    }
                }
                for (const a of estado.ausentes) {
                    if ((porMenu.get(a.ruta) ?? []).some((x) => x.comment === a.comment)) {
                        salida.cambios.push({
                            ruta: a.ruta,
                            clave: a.comment,
                            accion: 'borrar',
                            grupo: 'servicio',
                        })
                    }
                }
            }
        } finally {
            cliente.cerrar()
        }
    } catch (error) {
        if (!(error instanceof ErrorRouterOS) && !(error instanceof RouterSinCredenciales)) throw error
        salida.error = error.message
    }
    const menus = new Map<string, VistaPreviaReconciliar['menus'][number]>()
    for (const c of salida.cambios) {
        const m = menus.get(c.ruta) ?? { ruta: c.ruta, crear: 0, actualizar: 0, borrar: 0, mover: 0 }
        m[c.accion]++
        menus.set(c.ruta, m)
    }
    salida.menus = [...menus.values()].sort((x, y) => x.ruta.localeCompare(y.ruta, 'en'))
    return salida
}

/*
|--------------------------------------------------------------------------
| Chequeo `corte` de «Probar conexión»
|--------------------------------------------------------------------------
*/

export interface ProblemaCorte {
    codigo:
        | 'sin_api'
        | 'router_no_responde'
        | 'faltan_reglas'
        | 'reglas_desordenadas'
        | 'falta_lista_suspendidos'
        | 'falta_perfil_suspendido'
        | 'walled_garden'
        | 'portal_sin_configurar'
        | 'portal_inalcanzable'
    /** En lenguaje simple, con qué hacer */
    mensaje: string
    /** «Reconciliar ahora» lo arregla (crea o corrige lo que falta) */
    reconciliar: boolean
}

export interface DiagnosticoCorte {
    router_id: number
    ok: boolean
    problemas: ProblemaCorte[]
    /** Lo que «Reconciliar ahora» crearía, corregiría o movería del corte */
    faltan: Array<Pick<CambioCorte, 'ruta' | 'clave' | 'accion'>>
    portal: { url: string | null; alcanzable: boolean | null; detalle: string | null }
}

const FALTAN_REGLAS =
    'Faltan las reglas de corte: genera el script de conexión con «incluir configuración de servicio» o usa «Reconciliar ahora»'

export async function diagnosticoCorte(
    routerId: number,
    opciones: OpcionesDispatcher = {},
): Promise<DiagnosticoCorte> {
    const router = await routerDispatcher(routerId, undefined, opciones.red)
    if (!router) throw new NoEncontrado(`El router ${routerId} no existe`)
    const config = configCorte()
    const salida: DiagnosticoCorte = {
        router_id: routerId,
        ok: false,
        problemas: [],
        faltan: [],
        portal: { url: config.portal_url, alcanzable: null, detalle: null },
    }
    if (!router.con_credenciales) {
        salida.problemas.push({
            codigo: 'sin_api',
            mensaje:
                'El router no tiene usuario y contraseña de la API: no se puede revisar ni crear el corte',
            reconciliar: false,
        })
        return salida
    }
    const todos = await serviciosVigentesDeRouter(routerId)
    try {
        const cliente = (opciones.clientes ?? fabricaPorDefecto)(router.api)
        try {
            const lectura = await leerCorteRouter(cliente)
            const corte = estadoCorteRouter(
                config,
                {
                    fasttrack: pideFasttrack(estrategiasEnUso(router.velocidad, todos)),
                    redes_v4: await redesV4DeRouter(routerId),
                },
                lectura.get('/ppp/profile') ?? [],
            )
            const plan = planCorte(corte, lectura).filter((c) => c.accion !== 'borrar')
            salida.faltan = plan.map(({ ruta, clave, accion }) => ({ ruta, clave, accion }))
            const reglas = plan.filter(
                (c) => c.ruta.endsWith('/firewall/filter') || c.ruta.endsWith('/firewall/nat'),
            )
            if (reglas.some((c) => c.accion !== 'mover')) {
                salida.problemas.push({ codigo: 'faltan_reglas', mensaje: FALTAN_REGLAS, reconciliar: true })
            } else if (reglas.length > 0) {
                salida.problemas.push({
                    codigo: 'reglas_desordenadas',
                    mensaje:
                        'Las reglas de corte están detrás de FastTrack o de «accept established»: el suspendido navega igual. Usa «Reconciliar ahora» para subirlas',
                    reconciliar: true,
                })
            }
            const lista4 = lectura.get('/ip/firewall/address-list') ?? []
            if (!lista4.some((o) => o.list === config.address_list)) {
                salida.problemas.push({
                    codigo: 'falta_lista_suspendidos',
                    mensaje: `No existe la address-list «${config.address_list}» (la usan los saltos de corte). Usa «Reconciliar ahora»`,
                    reconciliar: true,
                })
            }
            const perfil = (lectura.get('/ppp/profile') ?? []).find((p) => p.name === config.perfil)
            if (!perfil || perfil['address-list'] !== config.address_list) {
                salida.problemas.push({
                    codigo: 'falta_perfil_suspendido',
                    mensaje: `Falta el perfil PPP «${config.perfil}» con address-list ${config.address_list}: un PPPoE suspendido no quedaría en corte. Usa «Reconciliar ahora»`,
                    reconciliar: true,
                })
            }
            if (!config.portal_v4 && !config.portal_fqdn) {
                salida.problemas.push({
                    codigo: 'portal_sin_configurar',
                    mensaje:
                        'Argos no sabe la dirección del portal: define PORTAL_URL_PUBLICA o ROUTERS_SERVICIO_PORTAL_V4 en el servidor',
                    reconciliar: false,
                })
            } else {
                const enLista = (direccion: string | null, list: string) =>
                    direccion === null ||
                    lista4.some(
                        (o) =>
                            o.list === list &&
                            normalizarDireccion(o.address ?? '') === normalizarDireccion(direccion),
                    )
                const faltanWalled = [
                    ...[config.portal_v4, config.portal_fqdn].filter((d) => !enLista(d, 'argos-portal')),
                    ...config.walled_garden.filter((d) => !enLista(d, 'argos-walled')),
                ]
                if (faltanWalled.length > 0) {
                    salida.problemas.push({
                        codigo: 'walled_garden',
                        mensaje: `El walled garden no incluye ${faltanWalled.join(', ')}: el suspendido no llegaría al portal ni a la pasarela. Usa «Reconciliar ahora»`,
                        reconciliar: true,
                    })
                }
            }
            // ¿El router llega al portal? `/tool/fetch` a la URL con `output=none` (y `/ping` si falla).
            if (config.portal_url) {
                try {
                    await cliente.ejecutar(
                        '/tool/fetch',
                        { url: config.portal_url, output: 'none', 'check-certificate': 'no' },
                        { motivo: 'diagnóstico de corte: ¿llega al portal?' },
                    )
                    salida.portal.alcanzable = true
                } catch (error) {
                    if (!(error instanceof ErrorRouterOS)) throw error
                    salida.portal.alcanzable = false
                    salida.portal.detalle = error.message
                    salida.problemas.push({
                        codigo: 'portal_inalcanzable',
                        mensaje:
                            `El router no llega al portal en ${config.portal_url}: revisa que el servidor sea alcanzable desde la red del router; ` +
                            'si Argos corre en WSL, activa el modo de red mirrored',
                        reconciliar: false,
                    })
                }
            }
        } finally {
            cliente.cerrar()
        }
    } catch (error) {
        if (!(error instanceof ErrorRouterOS) && !(error instanceof RouterSinCredenciales)) throw error
        salida.problemas.push({
            codigo: 'router_no_responde',
            mensaje: `El router no respondió a la API: ${error.message}`,
            reconciliar: false,
        })
    }
    salida.ok = salida.problemas.length === 0
    return salida
}
