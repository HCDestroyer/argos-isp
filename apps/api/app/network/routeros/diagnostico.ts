import { request as httpRequest } from 'node:http'
import env from '#start/env'
import {
    RUTAS_ORDENADAS,
    type ClienteRouterOS,
    type ObjetoRouterOS,
    type Propiedades,
    type RutaRouterOS,
} from '#network/routeros/cliente'
import { NoEncontrado } from '#shared/errores'
import { ErrorRouterOS } from '#network/routeros/errores'
import { RouterSinCredenciales } from '#network/routeros/router'
import { diferencias } from '#network/routeros/normalizar'
import {
    clientesUsanDnsRouter,
    configCorteResuelta,
    ENTRADA_SUSPENDIDOS,
    estadoCorteRouter,
    normalizarDireccion,
    REGLA_NAT_HTTP,
    revisarDnsRouter,
    urlNat,
    type ConfigCorte,
    type EstadoCorte,
} from '#network/routeros/corte_router'
import {
    estrategiasEnUso,
    planesDeRouter,
    redesV4DeRouter,
    routerDispatcher,
    serviciosVigentesDeRouter,
} from '#network/routeros/consultas'
import {
    estadoVelocidadRouter,
    gatewaysDeRedes,
    localAddressCorte,
    objetoAlDia,
    sobrantesVelocidad,
} from '#network/routeros/velocidad_router'
import { detectarConflictos, type Conflicto } from '#network/routeros/red_acceso'
import { derivaAcceso, leerAcceso } from '#network/routeros/aplicar_red_acceso'
import { redAccesoDeRouter } from '#network/routeros/consultas_red_acceso'
import { familia } from '#network/estrategia_velocidad'
import {
    estadoDeseado,
    estadoVacio,
    RUTAS_SERVICIO,
    servicioDeComment,
    type ServicioRed,
} from '#network/routeros/estado_deseado'
import {
    fabricaPorDefecto,
    leerCorteRouter,
    leerVelocidadRouter,
    perfilSuspendido,
    pideFasttrack,
    planCorte,
    type CambioCorte,
    type LecturaCorte,
    type OpcionesDispatcher,
    type SondaPortal,
} from '#network/routeros/dispatcher'

/**
 * Lecturas de diagnóstico contra el router (solo `GET`, salvo `/tool/fetch`, que no cambia nada y queda
 * en `audit.red`):
 *
 * - `vistaPreviaReconciliar`: lo que «Reconciliar ahora» crearía, cambiaría, movería y borraría
 *   (servicios, velocidad y corte), sin escribir.
 * - `diagnosticoCorte`: el chequeo `corte` de «Probar conexión» (`routers.probar_conexion`) y de
 *   `GET /routers/:id/diagnostico-corte`: si un suspendido de verdad ve la página de corte. Cada paso con
 *   su texto simple y los comandos de RouterOS para arreglarlo a mano.
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
    /** Deriva de la red de acceso administrada (`derivaAcceso`): VLAN, perfil del servidor y servidor */
    red_acceso: Array<{ ruta: string; clave: string; accion: 'crear' | 'actualizar' | 'borrar' }>
    /** Conflictos de control de velocidad en el router (`detectarConflictos`); solo informa */
    conflictos: Conflicto[]
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
        red_acceso: [],
        conflictos: [],
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
                await configCorteResuelta(process.env, opciones.resolver),
                {
                    fasttrack: pideFasttrack(estrategiasEnUso(router.velocidad, todos)),
                    redes_v4: await redesV4DeRouter(routerId),
                    local_address: localAddressCorte(router.velocidad.redes_ipv4).gateway,
                    gateways_v4: gatewaysDeRedes(router.velocidad.redes_ipv4),
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
                } else if (existentes.length > 1 || !objetoAlDia(o, existentes[0]!)) {
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

            // Conflictos de formas de limitar (antes de aplicar; contratos/red-acceso.md §6)
            const enUso = estrategiasEnUso(router.velocidad, todos)
            const ppp = router.velocidad.estrategias.pppoe
            salida.conflictos = detectarConflictos({
                pppoe_por_radius:
                    router.red.modo_seguridad !== 'api' &&
                    (ppp.aplicacion === 'radius_rate_limit' || ppp.aplicacion === 'perfil_ppp'),
                usa_arbol: enUso.some((e) => familia(e.aplicacion) === 'arbol'),
                usa_simples: enUso.some(
                    (e) =>
                        familia(e.aplicacion) === 'simple' &&
                        (e.aplicacion === 'cola_simple' ||
                            e.aplicacion === 'pcq_plan' ||
                            e.padre !== 'ninguno'),
                ),
                colas_simples: lectura.get('/queue/simple') ?? [],
                arbol: lectura.get('/queue/tree') ?? [],
                perfiles: lectura.get('/ppp/profile') ?? [],
            })

            // Red de acceso administrada: deriva por objeto (crear / actualizar / borrar)
            const acceso = await redAccesoDeRouter(routerId)
            const lecturaAcceso = await leerAcceso(cliente)
            const deriva = derivaAcceso(acceso.vlans, acceso.servidores, lecturaAcceso)
            salida.avisos.push(...deriva.avisos)
            for (const d of deriva.deriva) {
                salida.red_acceso.push({ ruta: d.ruta, clave: d.comment, accion: d.accion })
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
|
| Responde una pregunta: ¿un cliente suspendido de este router ve la página de corte? Cada paso dice
| en lenguaje simple qué falla y trae los comandos de RouterOS para arreglarlo a mano (como los errores
| TLS de `diagnostico_routeros.ts`), y `reconciliar: true` cuando «Reconciliar ahora» lo arregla solo.
*/

export type ClaveChequeoCorte =
    | 'lista_suspendidos'
    | 'reglas'
    | 'portal_http'
    | 'sesiones_suspendidas'
    | 'fasttrack'
    | 'perfil_suspendido'
    | 'walled_garden'
    | 'dns_router'
    | 'portal_host'
    | 'portal_en_router'

export type CodigoProblemaCorte =
    | 'sin_api'
    | 'router_no_responde'
    | 'faltan_reglas'
    | 'reglas_desactivadas'
    | 'reglas_distintas'
    | 'reglas_desordenadas'
    | 'falta_lista_suspendidos'
    | 'falta_perfil_suspendido'
    | 'walled_garden'
    | 'portal_sin_configurar'
    | 'portal_sin_ipv4'
    | 'portal_inalcanzable'
    | 'portal_sin_corte'
    | 'suspendidos_fuera_de_lista'
    | 'fasttrack'
    | 'dns_router_sin_servidores'
    | 'dns_router_documentacion'
    | 'dns_router_sin_remotas'
    | 'portal_no_acepta_host'
    | 'portal_en_router'

export interface ChequeoCorte {
    clave: ClaveChequeoCorte
    /** null: no se pudo comprobar */
    ok: boolean | null
    /** null si salió bien */
    codigo: CodigoProblemaCorte | null
    /** Qué se vio y qué hacer, en lenguaje simple */
    detalle: string
    /** Comandos de RouterOS (terminal) para arreglarlo a mano; vacío si no hace falta */
    comandos: string[]
    /** «Reconciliar ahora» lo arregla */
    reconciliar: boolean
}

export interface ProblemaCorte {
    codigo: CodigoProblemaCorte
    /** En lenguaje simple, con qué hacer */
    mensaje: string
    /** «Reconciliar ahora» lo arregla (crea o corrige lo que falta) */
    reconciliar: boolean
    comandos: string[]
}

export interface SuspendidoFueraDeLista {
    servicio_id: number
    tipo_conexion: ServicioRed['tipo_conexion']
    ipv4: string
}

export interface DiagnosticoCorte {
    router_id: number
    ok: boolean
    chequeos: ChequeoCorte[]
    /** Los chequeos que fallaron (y `sin_api` / `router_no_responde`), para mostrar en una lista */
    problemas: ProblemaCorte[]
    /** Lo que «Reconciliar ahora» crearía, corregiría o movería del corte */
    faltan: Array<Pick<CambioCorte, 'ruta' | 'clave' | 'accion'>>
    portal: {
        /** `PORTAL_URL_PUBLICA` (la que ve el cliente) */
        url: string | null
        fqdn: string | null
        /** IPv4 del portal que Argos usa para el NAT (variable, URL o DNS); null si no la sabe */
        ipv4: string | null
        origen: ConfigCorte['portal_v4_origen']
        /** Lo que se probó con `/tool/fetch`: el destino real del dst-nat del router (o el deseado) */
        destino_nat: string | null
        /** null: no se probó (sin destino) */
        alcanzable: boolean | null
        http_status: number | null
        detalle: string | null
    }
    suspendidos: {
        /** Suspendidos del router con IPv4 (PPPoE con sesión abierta, o WISP con IP) */
        total: number
        fuera_de_lista: number
        /** Hasta 20 */
        ejemplos: SuspendidoFueraDeLista[]
    }
    /** Lo que el corte no hace por diseño (el panel lo muestra siempre) */
    limites: string[]
}

/** Lo que el corte no puede hacer (`contratos/control-velocidad.md` §10.4). */
export const LIMITES_CORTE = [
    'HTTPS (puerto 443) no se redirige: el router corta la conexión con un reset TCP y el navegador muestra ' +
        '«no se puede conectar», no la página de corte. El cliente la ve al abrir un sitio http:// o cuando su ' +
        'teléfono o computadora prueba la conexión (aviso de «iniciar sesión en la red»).',
    'IPv6 se redirige igual que IPv4 solo si Argos conoce la IPv6 del portal (ROUTERS_SERVICIO_PORTAL_V6) y el ' +
        'suspendido entró con el perfil de corte (PPPoE que reconectó al suspender, o WISP); si no, el HTTP por ' +
        'IPv6 recibe un reset y el equipo cae a IPv4 para llegar a la página.',
    'El DNS del suspendido responde con cualquier resolver (el del router, el del perfil PPP o uno fijo como ' +
        '8.8.8.8). DNS cifrado (DoT 853, DoH) recibe un reset y el equipo vuelve al DNS normal, salvo Android con ' +
        '«DNS privado» en modo estricto (un nombre fijo): ahí el teléfono dice «sin internet» hasta que el cliente ' +
        'lo pone en «Automático».',
    'El portal debe responder /corte con cualquier encabezado Host (llega el del sitio que el cliente quiso ' +
        'abrir) y ver la IP real del cliente, sin NAT de origen, para saber quién es.',
]

const FILTRO_V4 = '/ip/firewall/filter'
const NAT_V4 = '/ip/firewall/nat'
const MAXIMO_COMANDOS = 12

/** `/ip/firewall/nat` → `/ip firewall nat` (la ruta de la terminal). */
function rutaCli(ruta: string): string {
    return `/${ruta.split('/').filter(Boolean).join(' ')}`
}

function valorCli(valor: string): string {
    return /^[\w.:/,+-]+$/.test(valor) ? valor : `"${valor.replace(/(["\\$])/g, '\\$1')}"`
}

function buscar(comment: string): string {
    return `[find comment=${valorCli(comment)}]`
}

function comandoAgregar(ruta: string, propiedades: Propiedades, comment: string): string {
    const pares = Object.entries(propiedades)
        .filter(([k, v]) => k !== 'disabled' && k !== 'comment' && v !== '')
        .map(([k, v]) => `${k}=${valorCli(v)}`)
    return `${rutaCli(ruta)} add ${[...pares, `comment=${valorCli(comment)}`].join(' ')}`
}

/** Sube reglas al inicio de su tabla en este orden (se mueven de la última a la primera). */
function comandosArriba(ruta: string, comments: string[]): string[] {
    return [...comments]
        .reverse()
        .map((c) => `${rutaCli(ruta)} move ${buscar(c)} destination=([find where dynamic=no]->0)`)
}

function recortar(comandos: string[]): string[] {
    if (comandos.length <= MAXIMO_COMANDOS) return comandos
    return [
        ...comandos.slice(0, MAXIMO_COMANDOS),
        `# … y ${comandos.length - MAXIMO_COMANDOS} más: usa «Reconciliar ahora»`,
    ]
}

function bien(clave: ClaveChequeoCorte, detalle: string): ChequeoCorte {
    return { clave, ok: true, codigo: null, detalle, comandos: [], reconciliar: false }
}

function mal(
    clave: ClaveChequeoCorte,
    codigo: CodigoProblemaCorte,
    detalle: string,
    comandos: string[],
    reconciliar: boolean,
): ChequeoCorte {
    return { clave, ok: false, codigo, detalle, comandos: recortar(comandos), reconciliar }
}

const lista = (xs: string[], n = 4) =>
    xs.length > n ? `${xs.slice(0, n).join(', ')} y ${xs.length - n} más` : xs.join(', ')

/** 1 · La address-list `suspendidos` existe, o no hace falta todavía porque no hay nadie suspendido. */
function chequeoLista(config: ConfigCorte, lista4: ObjetoRouterOS[], suspendidos: number): ChequeoCorte {
    const entradas = lista4.filter((o) => o.list === config.address_list)
    if (entradas.length > 0) {
        return bien(
            'lista_suspendidos',
            `Existe la address-list «${config.address_list}» (${entradas.length} ${entradas.length === 1 ? 'entrada' : 'entradas'})`,
        )
    }
    if (suspendidos === 0) {
        return bien(
            'lista_suspendidos',
            `Todavía no existe la address-list «${config.address_list}», pero no hace falta: no hay nadie suspendido ` +
                'en este router. RouterOS la crea con el primer suspendido («Reconciliar ahora» la deja creada)',
        )
    }
    return mal(
        'lista_suspendidos',
        'falta_lista_suspendidos',
        `No existe la address-list «${config.address_list}» y hay ${suspendidos} ${suspendidos === 1 ? 'suspendido' : 'suspendidos'}: ` +
            'las reglas de corte no los encuentran. Usa «Reconciliar ahora»',
        [
            `/ip firewall address-list add list=${valorCli(config.address_list)} address=${ENTRADA_SUSPENDIDOS} ` +
                `comment="argosisp: corte lista suspendidos"`,
        ],
        true,
    )
}

/** 2 · Las reglas de corte (filter y NAT, IPv4 e IPv6) están, activas, iguales y en orden. */
function chequeoReglas(
    config: ConfigCorte,
    corte: EstadoCorte,
    plan: CambioCorte[],
    lectura: LecturaCorte,
): ChequeoCorte {
    const deReglas = plan.filter((c) => (RUTAS_ORDENADAS as readonly string[]).includes(c.ruta))
    const actual = (ruta: string, comment: string) =>
        (lectura.get(ruta as RutaRouterOS) ?? []).find((o) => o.comment === comment && o.dynamic !== 'true')
    const faltan = deReglas.filter((c) => c.accion === 'crear')
    const actualizar = deReglas.filter((c) => c.accion === 'actualizar')
    const desactivadas = actualizar.filter((c) => actual(c.ruta, c.clave)?.disabled === 'true')
    const distintas = actualizar.filter((c) => !desactivadas.includes(c))
    const mover = deReglas.filter((c) => c.accion === 'mover')
    // Sin IPv4 del portal el reconciliador no puede escribir el dst-nat: si tampoco está en el router, falta.
    const natHttp = actual(NAT_V4, REGLA_NAT_HTTP)
    const faltaNat = !config.portal_v4 && !natHttp

    const comandos: string[] = []
    if (faltan.length > 0 || faltaNat) {
        for (const c of faltan) comandos.push(comandoAgregar(c.ruta, c.propiedades ?? {}, c.clave))
        if (faltaNat) {
            comandos.push(
                `${rutaCli(NAT_V4)} add chain=argos-corte-nat protocol=tcp dst-port=80 action=dst-nat ` +
                    `to-addresses=<IPv4 del portal> to-ports=${config.portal_puerto} comment=${valorCli(REGLA_NAT_HTTP)}`,
            )
        }
        const nombres = [...faltan.map((c) => c.clave), ...(faltaNat ? [REGLA_NAT_HTTP] : [])]
        return mal(
            'reglas',
            'faltan_reglas',
            `Faltan ${nombres.length} ${nombres.length === 1 ? 'regla' : 'reglas'} de corte (${lista(nombres)}): genera el script de conexión ` +
                'con «incluir configuración de servicio» o usa «Reconciliar ahora»' +
                (faltaNat ? '. El NAT de HTTP a /corte necesita la IPv4 del portal (mira «portal»)' : '') +
                '. Las reglas nuevas quedan al final: «Reconciliar ahora» las pone en su lugar',
            comandos,
            faltan.length > 0,
        )
    }
    if (desactivadas.length > 0) {
        return mal(
            'reglas',
            'reglas_desactivadas',
            `Hay reglas de corte desactivadas (${lista(desactivadas.map((c) => c.clave))}): el suspendido navega igual. ` +
                'Actívalas o usa «Reconciliar ahora»',
            desactivadas.map((c) => `${rutaCli(c.ruta)} enable ${buscar(c.clave)}`),
            true,
        )
    }
    if (distintas.length > 0) {
        return mal(
            'reglas',
            'reglas_distintas',
            `Hay reglas de corte distintas de lo que espera Argos (${lista(distintas.map((c) => c.clave))}), ` +
                'p. ej. el NAT apunta a otra IP del portal. Usa «Reconciliar ahora»',
            distintas.map((c) => {
                const pares = Object.entries(c.propiedades ?? {})
                    .filter(([k]) => k !== 'comment')
                    .map(([k, v]) => `${k}=${valorCli(v)}`)
                return `${rutaCli(c.ruta)} set ${buscar(c.clave)} ${pares.join(' ')}`
            }),
            true,
        )
    }
    if (mover.length > 0) {
        const rutas = [...new Set(mover.map((c) => c.ruta))]
        return mal(
            'reglas',
            'reglas_desordenadas',
            'Las reglas de corte están detrás de FastTrack o de «accept established»: el suspendido navega igual. ' +
                'Usa «Reconciliar ahora» para subirlas',
            rutas.flatMap((ruta) =>
                comandosArriba(
                    ruta,
                    corte.reglas.filter((r) => r.ruta === ruta && r.arriba).map((r) => r.comment),
                ),
            ),
            true,
        )
    }
    const total = corte.reglas.length + (config.portal_v4 ? 0 : natHttp ? 1 : 0)
    return bien('reglas', `Las ${total} reglas de corte (filter y NAT) están, activas y en orden`)
}

/** 3 · El destino del dst-nat responde HTTP en `/corte`, probado desde el router con `/tool/fetch`. */
async function chequeoPortal(
    cliente: ClienteRouterOS,
    config: ConfigCorte,
    lectura: LecturaCorte,
    portal: DiagnosticoCorte['portal'],
    requestId: string | null,
): Promise<ChequeoCorte> {
    const nat = (lectura.get(NAT_V4) ?? []).find(
        (o) => o.comment === REGLA_NAT_HTTP && o.dynamic !== 'true' && o.disabled !== 'true',
    )
    const enRouter = nat?.['to-addresses'] ? nat['to-addresses'].split('-')[0]! : null
    const ip = enRouter ?? config.portal_v4
    const puerto = enRouter ? Number(nat?.['to-ports'] || 80) : config.portal_puerto
    if (!ip) {
        if (config.portal_v4_error) {
            return mal(
                'portal_http',
                'portal_sin_ipv4',
                config.portal_v4_error,
                [
                    `${rutaCli(NAT_V4)} add chain=argos-corte-nat protocol=tcp dst-port=80 action=dst-nat ` +
                        `to-addresses=<IPv4 del portal> to-ports=${config.portal_puerto} comment=${valorCli(REGLA_NAT_HTTP)}`,
                ],
                false,
            )
        }
        return mal(
            'portal_http',
            'portal_sin_configurar',
            'Argos no sabe la dirección del portal: define PORTAL_URL_PUBLICA (o ROUTERS_SERVICIO_PORTAL_V4 con la ' +
                'IPv4 del portal) en el servidor y usa «Reconciliar ahora»',
            [],
            false,
        )
    }
    const url = urlNat(ip, puerto)
    portal.destino_nat = url
    const notas: string[] = []
    if (enRouter && config.portal_v4 && enRouter !== config.portal_v4) {
        notas.push(
            `El router manda a ${enRouter}, pero Argos espera ${config.portal_v4}: «Reconciliar ahora» lo corrige`,
        )
    }
    if (!enRouter && config.portal_v4_origen === 'dns') {
        notas.push(
            `IP resuelta de ${config.portal_fqdn} desde el servidor de Argos; si el router debe usar otra (p. ej. la ` +
                'pública), fíjala con ROUTERS_SERVICIO_PORTAL_V4',
        )
    }
    const comandosPrueba = [`/tool fetch url="${url}" output=none`, `/ping ${ip} count=3`]
    try {
        await cliente.ejecutar(
            '/tool/fetch',
            { url, output: 'none' },
            { motivo: 'diagnóstico de corte: ¿el portal responde /corte?', request_id: requestId },
        )
        portal.alcanzable = true
        portal.http_status = 200
        return bien('portal_http', [`El router llega a ${url} y responde`, ...notas].join('. '))
    } catch (error) {
        if (!(error instanceof ErrorRouterOS)) throw error
        // RouterOS 7: «failure: Status 404, File not found» (sigue las redirecciones; versiones viejas: «<404 …>»)
        const status = /(?:Status |<)(\d{3})\b/.exec(error.message)?.[1]
        portal.http_status = status ? Number(status) : null
        portal.detalle = error.message
        if (status?.startsWith('3')) {
            portal.alcanzable = true
            return bien(
                'portal_http',
                [
                    `El router llega a ${url}; responde con una redirección (HTTP ${status}), que el navegador sigue`,
                    ...notas,
                ].join('. '),
            )
        }
        if (status) {
            portal.alcanzable = true
            return mal(
                'portal_http',
                'portal_sin_corte',
                [
                    `El portal en ${ip}:${puerto} responde, pero no sirve /corte (HTTP ${status}). Revisa que el portal ` +
                        'atienda /corte en ese puerto por HTTP con cualquier encabezado Host',
                    ...notas,
                ].join('. '),
                comandosPrueba,
                false,
            )
        }
        portal.alcanzable = false
        return mal(
            'portal_http',
            'portal_inalcanzable',
            [
                `El router no llega a ${url} (destino del NAT de corte): revisa que el portal sea alcanzable desde la ` +
                    'red del router en esa IP y puerto (firewall, ruta, túnel; si el portal redirige, también el destino de la ' +
                    'redirección); si Argos corre en WSL, activa el modo ' +
                    'de red mirrored',
                ...notas,
            ].join('. '),
            comandosPrueba,
            false,
        )
    }
}

/** 4 · Cada suspendido con IPv4 tiene su IP en la address-list (si no, navega sin corte). */
function chequeoSesiones(
    config: ConfigCorte,
    lista4: ObjetoRouterOS[],
    suspendidos: SuspendidoFueraDeLista[],
    salida: DiagnosticoCorte['suspendidos'],
): ChequeoCorte {
    const enLista = new Set(
        lista4
            .filter((o) => o.list === config.address_list && o.disabled !== 'true')
            .map((o) => normalizarDireccion(o.address ?? '')),
    )
    const fuera = suspendidos.filter((s) => !enLista.has(normalizarDireccion(s.ipv4)))
    salida.total = suspendidos.length
    salida.fuera_de_lista = fuera.length
    salida.ejemplos = fuera.slice(0, 20)
    if (suspendidos.length === 0) {
        return bien(
            'sesiones_suspendidas',
            'No hay suspendidos con sesión o IP en este router: nada que revisar',
        )
    }
    if (fuera.length === 0) {
        return bien(
            'sesiones_suspendidas',
            `Los ${suspendidos.length} suspendidos con IP están en la address-list «${config.address_list}»`,
        )
    }
    const pppoe = fuera.filter((s) => s.tipo_conexion === 'pppoe')
    const wisp = fuera.filter((s) => s.tipo_conexion !== 'pppoe')
    const comandos = [
        // PPPoE: al reconectar, `aaa` lo autoriza con el perfil de suspendido (y su address-list).
        ...pppoe.map((s) => `/ppp active remove [find address=${s.ipv4}]`),
        // WISP: la misma entrada que escribe `routeros.aplicar_servicio` (se quita sola al reactivar).
        ...wisp.map(
            (s) =>
                `/ip firewall address-list add list=${valorCli(config.address_list)} address=${s.ipv4} ` +
                `comment="argosisp:servicio:${s.servicio_id}"`,
        ),
    ]
    return mal(
        'sesiones_suspendidas',
        'suspendidos_fuera_de_lista',
        `${fuera.length} de ${suspendidos.length} suspendidos no están en la address-list «${config.address_list}» y navegan ` +
            `sin corte (${lista(fuera.map((s) => s.ipv4))}).` +
            (pppoe.length > 0
                ? ' A los PPPoE desconéctalos para que entren con el perfil de suspendido (el CoA no llegó o el NAS lo rechazó).'
                : '') +
            (wisp.length > 0
                ? ' A los de IP fija los repone «Reconciliar ahora» o «Sincronizar con el router».'
                : ''),
        comandos,
        wisp.length > 0,
    )
}

/** 5 · Los saltos de corte (y la excepción de los clientes con colas) van antes de FastTrack. */
function chequeoFasttrack(corte: EstadoCorte, lectura: LecturaCorte, pide: boolean): ChequeoCorte {
    const tabla = (lectura.get(FILTRO_V4) ?? []).filter((o) => o.dynamic !== 'true')
    const fast = tabla.findIndex((o) => o.action === 'fasttrack-connection' && o.disabled !== 'true')
    if (fast === -1) {
        return bien('fasttrack', 'No hay FastTrack activo en el router: no hace falta exceptuar a nadie')
    }
    const necesarias = corte.reglas
        .filter((r) => r.ruta === FILTRO_V4 && r.arriba && r.propiedades.chain === 'forward')
        .map((r) => r.comment)
    const posicion = (c: string) => tabla.findIndex((o) => o.comment === c && o.disabled !== 'true')
    const malas = necesarias.filter((c) => {
        const i = posicion(c)
        return i === -1 || i > fast
    })
    if (malas.length === 0) {
        return bien(
            'fasttrack',
            pide
                ? 'Los saltos de corte y la excepción de FastTrack de los clientes con colas están antes de FastTrack'
                : 'Los saltos de corte están antes de FastTrack',
        )
    }
    return mal(
        'fasttrack',
        'fasttrack',
        `FastTrack está antes de ${lista(malas)}: las conexiones ya abiertas se saltan el corte` +
            (pide ? ' y las colas de los clientes' : '') +
            '. Usa «Reconciliar ahora» o sube las reglas',
        comandosArriba(
            FILTRO_V4,
            necesarias.filter((c) => posicion(c) !== -1),
        ),
        true,
    )
}

function chequeoPerfil(config: ConfigCorte, lectura: LecturaCorte): ChequeoCorte {
    const perfil = (lectura.get('/ppp/profile') ?? []).find((p) => p.name === config.perfil)
    if (perfil && perfil['address-list'] === config.address_list) {
        return bien(
            'perfil_suspendido',
            `El perfil PPP «${config.perfil}» pone a sus sesiones en «${config.address_list}»`,
        )
    }
    return mal(
        'perfil_suspendido',
        'falta_perfil_suspendido',
        `Falta el perfil PPP «${config.perfil}» con address-list ${config.address_list}: un PPPoE suspendido no quedaría ` +
            'en corte. Usa «Reconciliar ahora»',
        [
            perfil
                ? `/ppp profile set [find name=${valorCli(config.perfil)}] address-list=${valorCli(config.address_list)} interface-list=${valorCli(config.address_list)}`
                : `/ppp profile add name=${valorCli(config.perfil)} rate-limit=${config.susp_rate_limit} ` +
                  `address-list=${valorCli(config.address_list)} interface-list=${valorCli(config.address_list)} ` +
                  'comment="argosisp: servicio suspendido"',
        ],
        true,
    )
}

function chequeoWalled(config: ConfigCorte, lista4: ObjetoRouterOS[]): ChequeoCorte {
    const enLista = (direccion: string, list: string) =>
        lista4.some(
            (o) => o.list === list && normalizarDireccion(o.address ?? '') === normalizarDireccion(direccion),
        )
    const faltan = [
        ...[config.portal_v4, config.portal_fqdn]
            .filter((d): d is string => d !== null)
            .filter((d) => !enLista(d, 'argos-portal'))
            .map((d) => ['argos-portal', d] as const),
        ...config.walled_garden
            .filter((d) => !enLista(d, 'argos-walled'))
            .map((d) => ['argos-walled', d] as const),
    ]
    if (faltan.length === 0) {
        return bien(
            'walled_garden',
            'El suspendido puede llegar al portal y a la pasarela de pago (walled garden)',
        )
    }
    return mal(
        'walled_garden',
        'walled_garden',
        `El walled garden no incluye ${lista(faltan.map(([, d]) => d))}: el suspendido no llegaría al portal ni a la ` +
            'pasarela. Usa «Reconciliar ahora»',
        faltan.map(([list, d]) => {
            const comment =
                list === 'argos-walled'
                    ? 'argosisp: walled garden'
                    : d === config.portal_v4
                      ? 'argosisp: portal IP'
                      : 'argosisp: portal FQDN'
            return `/ip firewall address-list add list=${list} address=${valorCli(d)} comment="${comment}"`
        }),
        true,
    )
}

/** 8 · `/ip dns` del router: con servidores reales y, si los clientes lo usan, con consultas remotas. */
function chequeoDns(dns: Record<string, string> | null, usaDnsRouter: boolean): ChequeoCorte {
    if (!dns) return { ...bien('dns_router', 'No se pudo leer /ip dns del router'), ok: null }
    const problemas = revisarDnsRouter(dns, usaDnsRouter)
    if (problemas.length === 0) {
        return bien('dns_router', `El router resuelve con ${dns.servers || dns['dynamic-servers']}`)
    }
    return mal(
        'dns_router',
        problemas[0]!.codigo,
        problemas.map((p) => p.mensaje).join('. '),
        problemas.flatMap((p) => p.comandos),
        false,
    )
}

/**
 * 10 · El destino del NAT no es una dirección del propio router. Si lo es (Argos detrás de este mismo
 * MikroTik, publicado con un port-forward en la IP pública del router), el dst-nat del corte manda el
 * HTTP del suspendido al router: va a `input`, no a `forward`, y `argos-corte-in` lo rechaza (o lo
 * atiende el `www` del router). El port-forward del operador no se aplica: el NAT ya se hizo.
 */
function chequeoPortalEnRouter(
    portal: DiagnosticoCorte['portal'],
    direcciones: ObjetoRouterOS[],
): ChequeoCorte {
    if (!portal.destino_nat) return { ...bien('portal_en_router', 'Sin destino del NAT'), ok: null }
    const ip = new URL(portal.destino_nat).hostname
    const propia = direcciones.find((d) => (d.address ?? '').split('/')[0] === ip && d.disabled !== 'true')
    if (!propia) return bien('portal_en_router', `${ip} no es una dirección del router`)
    return mal(
        'portal_en_router',
        'portal_en_router',
        `El NAT de corte manda a ${ip}, que es una dirección del propio router (${propia.interface ?? 'interfaz'}): el ` +
            'HTTP del suspendido termina en el router y no en el portal, y el teléfono dice «sin internet». Usa la IP ' +
            'interna del servidor de Argos: ROUTERS_SERVICIO_PORTAL_V4=<IP LAN del servidor> y «Reconciliar ahora»',
        ['/ip address print where address~"' + ip + '/"'],
        false,
    )
}

/** Host de una sonda de portal cautivo real (Android): el que llega al portal por el dst-nat. */
export const HOST_SONDA = 'connectivitycheck.gstatic.com'

/** Timeout de la sonda HTTP desde Argos (`ROUTEROS_SONDA_PORTAL_MS`; 0 = no se prueba). */
function esperaSondaMs(): number {
    const v = env.get('ROUTEROS_SONDA_PORTAL_MS') ?? 3000
    return v >= 0 ? v : 3000
}

/** GET sin seguir redirecciones, con el `Host` dado, desde el servidor de Argos. */
export const sondaPortalHttp: SondaPortal = (url, host) =>
    new Promise((resolver, rechazar) => {
        const req = httpRequest(
            url,
            { method: 'GET', headers: { Host: host }, timeout: esperaSondaMs() },
            (res) => {
                res.resume()
                const location = res.headers.location
                resolver({
                    status: res.statusCode ?? 0,
                    location: typeof location === 'string' ? location : null,
                })
            },
        )
        req.on('timeout', () => req.destroy(new Error('sin respuesta')))
        req.on('error', rechazar)
        req.end()
    })

/**
 * 9 · Lo que hay en el destino del NAT acepta CUALQUIER Host: un `GET /generate_204` con el Host de la
 * sonda de Android debe dar 302 a `/corte`. Un proxy delante (Nginx Proxy Manager…) que solo atiende sus
 * dominios responde 404 o su página por defecto y el teléfono dice «sin internet». Se prueba desde
 * Argos; si Argos no llega a esa IP, no se puede comprobar (lo prueba el router en `portal_http`).
 */
async function chequeoHost(
    portal: DiagnosticoCorte['portal'],
    sonda: SondaPortal | undefined,
): Promise<ChequeoCorte> {
    if (!portal.destino_nat) return { ...bien('portal_host', 'Sin destino del NAT: no se prueba'), ok: null }
    if (!sonda && esperaSondaMs() === 0) {
        return { ...bien('portal_host', 'Prueba del Host apagada (ROUTEROS_SONDA_PORTAL_MS=0)'), ok: null }
    }
    const base = new URL(portal.destino_nat)
    const url = `${base.origin}/generate_204`
    const curl = `curl -sI -H 'Host: ${HOST_SONDA}' ${url}`
    let r: { status: number; location: string | null }
    try {
        r = await (sonda ?? sondaPortalHttp)(url, HOST_SONDA)
    } catch (error) {
        return {
            ...bien(
                'portal_host',
                `Argos no llega a ${base.origin} para probar el Host (${(error as Error).message}); pruébalo desde la ` +
                    `red de clientes: ${curl} debe dar 302 a /corte`,
            ),
            ok: null,
        }
    }
    if (
        r.status >= 300 &&
        r.status < 400 &&
        r.location &&
        /\/corte(?:[?#]|$)/.test(new URL(r.location, url).pathname)
    ) {
        return bien(
            'portal_host',
            `${base.origin} con Host ${HOST_SONDA} responde ${r.status} a ${r.location}`,
        )
    }
    return mal(
        'portal_host',
        'portal_no_acepta_host',
        `${base.origin} (destino del NAT de corte) responde HTTP ${r.status}${r.location ? ` a ${r.location}` : ''} ` +
            `a una sonda con Host ${HOST_SONDA}; debía ser 302 a /corte. Suele ser un proxy delante del portal ` +
            '(Nginx Proxy Manager, otro sitio en el mismo puerto) que solo atiende sus dominios: el teléfono ve «sin ' +
            'internet». Arreglo recomendado: apunta el NAT al puerto dedicado del Caddy de Argos (PORTAL_CORTE_PUERTO, ' +
            '8088; ROUTERS_SERVICIO_PORTAL_PUERTO=8088 y ábrelo desde la red de los routers) y «Reconciliar ahora». ' +
            'Alternativa en Nginx Proxy Manager: Settings → Default Site → Redirect to http://<dominio del portal>/corte ' +
            '(nunca a la misma IP: volvería al proxy)',
        [curl],
        false,
    )
}

/** Suspendidos del router con su IPv4: la de la sesión abierta (PPPoE) o la asignada (WISP). */
function suspendidosConIp(servicios: ServicioRed[]): SuspendidoFueraDeLista[] {
    return servicios
        .filter((s) => s.estado === 'suspendido')
        .map((s) => ({
            servicio_id: s.servicio_id,
            tipo_conexion: s.tipo_conexion,
            ipv4: (s.tipo_conexion === 'pppoe' ? (s.sesion?.ipv4 ?? null) : s.ipv4) ?? '',
        }))
        .filter((s) => s.ipv4 !== '')
}

export async function diagnosticoCorte(
    routerId: number,
    opciones: OpcionesDispatcher = {},
    requestId: string | null = null,
): Promise<DiagnosticoCorte> {
    const router = await routerDispatcher(routerId, undefined, opciones.red)
    if (!router) throw new NoEncontrado(`El router ${routerId} no existe`)
    const config = await configCorteResuelta(process.env, opciones.resolver)
    const salida: DiagnosticoCorte = {
        router_id: routerId,
        ok: false,
        chequeos: [],
        problemas: [],
        faltan: [],
        portal: {
            url: config.portal_url,
            fqdn: config.portal_fqdn,
            ipv4: config.portal_v4,
            origen: config.portal_v4_origen,
            destino_nat: config.nat_url,
            alcanzable: null,
            http_status: null,
            detalle: config.portal_v4_error,
        },
        suspendidos: { total: 0, fuera_de_lista: 0, ejemplos: [] },
        limites: LIMITES_CORTE,
    }
    if (!router.con_credenciales) {
        salida.problemas.push({
            codigo: 'sin_api',
            mensaje:
                'El router no tiene usuario y contraseña de la API: no se puede revisar ni crear el corte',
            reconciliar: false,
            comandos: [],
        })
        return salida
    }
    const todos = await serviciosVigentesDeRouter(routerId)
    try {
        const cliente = (opciones.clientes ?? fabricaPorDefecto)(router.api)
        try {
            const lectura = await leerCorteRouter(cliente)
            const fasttrack = pideFasttrack(estrategiasEnUso(router.velocidad, todos))
            const corte = estadoCorteRouter(
                config,
                {
                    fasttrack,
                    redes_v4: await redesV4DeRouter(routerId),
                    local_address: localAddressCorte(router.velocidad.redes_ipv4).gateway,
                    gateways_v4: gatewaysDeRedes(router.velocidad.redes_ipv4),
                },
                lectura.get('/ppp/profile') ?? [],
            )
            const plan = planCorte(corte, lectura).filter((c) => c.accion !== 'borrar')
            salida.faltan = plan.map(({ ruta, clave, accion }) => ({ ruta, clave, accion }))
            const lista4 = lectura.get('/ip/firewall/address-list') ?? []
            const suspendidos = suspendidosConIp(todos)
            salida.chequeos.push(
                chequeoLista(config, lista4, suspendidos.length),
                chequeoReglas(config, corte, plan, lectura),
                await chequeoPortal(cliente, config, lectura, salida.portal, requestId),
                chequeoSesiones(config, lista4, suspendidos, salida.suspendidos),
                chequeoFasttrack(corte, lectura, fasttrack),
                chequeoPerfil(config, lectura),
                chequeoWalled(config, lista4),
                chequeoDns(
                    await cliente.leerDns().catch((error: unknown) => {
                        if (error instanceof ErrorRouterOS) return null
                        throw error
                    }),
                    clientesUsanDnsRouter(
                        lectura.get('/ppp/profile') ?? [],
                        gatewaysDeRedes(router.velocidad.redes_ipv4),
                    ),
                ),
                await chequeoHost(salida.portal, opciones.sondaPortal),
                chequeoPortalEnRouter(
                    salida.portal,
                    await cliente.listar('/ip/address').catch((error: unknown) => {
                        if (error instanceof ErrorRouterOS) return []
                        throw error
                    }),
                ),
            )
        } finally {
            cliente.cerrar()
        }
    } catch (error) {
        if (!(error instanceof ErrorRouterOS) && !(error instanceof RouterSinCredenciales)) throw error
        salida.problemas.push({
            codigo: 'router_no_responde',
            mensaje: `El router no respondió a la API: ${error.message}`,
            reconciliar: false,
            comandos: [],
        })
    }
    for (const c of salida.chequeos) {
        if (c.ok === false && c.codigo) {
            salida.problemas.push({
                codigo: c.codigo,
                mensaje: c.detalle,
                reconciliar: c.reconciliar,
                comandos: c.comandos,
            })
        }
    }
    salida.ok = salida.problemas.length === 0 && salida.chequeos.length > 0
    return salida
}

/** Una línea para el chequeo `corte` de «Probar conexión». */
export function resumenCorte(d: DiagnosticoCorte): string {
    if (d.ok) {
        const n = d.suspendidos.total
        return (
            `Corte listo: reglas, lista «suspendidos» y portal (${d.portal.destino_nat ?? 'sin destino'}) responden` +
            (n > 0 ? `; los ${n} suspendidos están en la lista` : '')
        )
    }
    return d.problemas.map((p) => p.mensaje).join(' · ')
}
