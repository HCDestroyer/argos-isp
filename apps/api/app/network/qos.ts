import { formatoKbps } from '#network/velocidad'
import type { Propiedades, RutaRouterOS } from '#network/routeros/cliente'

/**
 * Prioridad por protocolo (QoS por clases) dentro del árbol (`.claude/integration/contratos/qos.md`).
 * Funciones puras: modelo de clases, validación de un perfil, objetos de RouterOS (clasificación de
 * conexiones, cadenas por plan, hojas del árbol) y costo. Las usan el dispatcher, el reconciliador,
 * la vista previa y las acciones de `qos.*`.
 */

export const PROTOCOLOS_QOS = ['tcp', 'udp', 'icmp'] as const
export type ProtocoloQos = (typeof PROTOCOLOS_QOS)[number]

/** Máximo de clases activas por perfil, contando `resto` (8 niveles de `priority`). */
export const QOS_MAX_CLASES = 8
/** Máximo de reglas de coincidencia por clase. */
export const QOS_MAX_REGLAS = 10
/** Máximo de hojas de QoS en el árbol de un router (§3.4). */
export const QOS_MAX_HOJAS = 1024
/** Máximo de elementos en una lista de puertos. */
export const QOS_MAX_PUERTOS = 15

export interface ReglaQos {
    protocolo: ProtocoloQos | null
    /** `n` o `n-m` separados por coma */
    puertos_destino: string | null
    puertos_origen: string | null
    dscp: number | null
    lista_destino: string | null
}

export interface ClaseQos {
    id: number
    nombre: string
    orden: number
    prioridad: number
    garantizado_pct: number
    tope_pct: number | null
    es_resto: boolean
    reglas: ReglaQos[]
    bytes_minimo: number | null
    reclasifica_de: number[]
    activa: boolean
}

/** Perfil que usa un router: solo las clases activas. */
export interface PerfilQosRouter {
    perfil_id: number
    clases: ClaseQos[]
}

const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null)

/** `reglas` (jsonb) → reglas limpias. */
export function leerReglas(valor: unknown): ReglaQos[] {
    if (!Array.isArray(valor)) return []
    return valor
        .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
        .map((r) => ({
            protocolo: (PROTOCOLOS_QOS as readonly unknown[]).includes(r.protocolo)
                ? (r.protocolo as ProtocoloQos)
                : null,
            puertos_destino: texto(r.puertos_destino),
            puertos_origen: texto(r.puertos_origen),
            dscp: typeof r.dscp === 'number' && Number.isInteger(r.dscp) ? r.dscp : null,
            lista_destino: texto(r.lista_destino),
        }))
}

/** Fila de `network.qos_clases` → clase. */
export function claseDeFila(f: Record<string, unknown>): ClaseQos {
    return {
        id: Number(f.id),
        nombre: String(f.nombre),
        orden: Number(f.orden),
        prioridad: Number(f.prioridad),
        garantizado_pct: Number(f.garantizado_pct),
        tope_pct: f.tope_pct === null || f.tope_pct === undefined ? null : Number(f.tope_pct),
        es_resto: Boolean(f.es_resto),
        reglas: leerReglas(f.reglas),
        bytes_minimo: f.bytes_minimo === null || f.bytes_minimo === undefined ? null : Number(f.bytes_minimo),
        reclasifica_de: Array.isArray(f.reclasifica_de) ? f.reclasifica_de.map(Number) : [],
        activa: Boolean(f.activa),
    }
}

/** ¿Clase de descargas pesadas? (reclasifica por `connection-bytes`) */
export const esDescarga = (c: Pick<ClaseQos, 'bytes_minimo'>) => c.bytes_minimo !== null

/** Clases que clasifican conexiones nuevas, en orden de evaluación (sin resto ni descargas). */
export function clasesPorPosicion(clases: ClaseQos[]): ClaseQos[] {
    return clases
        .filter((c) => c.activa && !c.es_resto && !esDescarga(c))
        .sort((a, b) => a.orden - b.orden || a.id - b.id)
}

export function claseResto(clases: ClaseQos[]): ClaseQos | null {
    return clases.find((c) => c.activa && c.es_resto) ?? null
}

/*
|--------------------------------------------------------------------------
| Validación de un perfil (422) y advertencias
|--------------------------------------------------------------------------
*/

export interface ProblemaQos {
    field: string
    rule: string
    message: string
}

export interface AdvertenciaQos {
    regla: string
    mensaje: string
}

/** `53`, `5060-5061,10000-20000` → error o null. */
export function errorPuertos(valor: string): string | null {
    const partes = valor.split(',').map((p) => p.trim())
    if (partes.length > QOS_MAX_PUERTOS) return `máximo ${QOS_MAX_PUERTOS} puertos o rangos`
    for (const p of partes) {
        const m = /^(\d{1,5})(?:-(\d{1,5}))?$/.exec(p)
        if (!m) return `«${p}» no es un puerto ni un rango (n o n-m)`
        const a = Number(m[1])
        const b = m[2] === undefined ? a : Number(m[2])
        if (a < 1 || b > 65535 || a > b) return `«${p}» fuera de 1–65535 o rango invertido`
    }
    return null
}

/** Errores de las reglas de una clase (sin mirar al resto del perfil). */
export function problemasReglas(reglas: ReglaQos[], campo = 'reglas'): ProblemaQos[] {
    const errores: ProblemaQos[] = []
    if (reglas.length > QOS_MAX_REGLAS) {
        errores.push({
            field: campo,
            rule: 'qos_reglas',
            message: `máximo ${QOS_MAX_REGLAS} reglas por clase`,
        })
    }
    reglas.forEach((r, i) => {
        const f = `${campo}.${i}`
        if (!r.protocolo && !r.puertos_destino && !r.puertos_origen && r.dscp === null && !r.lista_destino) {
            errores.push({ field: f, rule: 'qos_reglas', message: 'la regla no tiene ningún criterio' })
        }
        for (const k of ['puertos_destino', 'puertos_origen'] as const) {
            const v = r[k]
            if (!v) continue
            if (r.protocolo !== 'tcp' && r.protocolo !== 'udp') {
                errores.push({
                    field: `${f}.${k}`,
                    rule: 'qos_puertos',
                    message: 'los puertos solo aplican a tcp o udp: elige el protocolo',
                })
                continue
            }
            const e = errorPuertos(v)
            if (e) errores.push({ field: `${f}.${k}`, rule: 'qos_puertos', message: e })
        }
        if (r.dscp !== null && (r.dscp < 0 || r.dscp > 63)) {
            errores.push({ field: `${f}.dscp`, rule: 'qos_reglas', message: 'dscp va de 0 a 63' })
        }
    })
    return errores
}

/**
 * Reglas de un perfil (`contratos/qos.md` §1): `clases` es el perfil completo como quedaría (activas e
 * inactivas). `campo(id)` da el prefijo de los `field` de una clase (la que se está editando usa el
 * cuerpo de la petición).
 */
export function validarPerfil(
    clases: ClaseQos[],
    campo: (claseId: number) => string = (id) => `clases.${id}`,
): { errores: ProblemaQos[]; advertencias: AdvertenciaQos[] } {
    const errores: ProblemaQos[] = []
    const advertencias: AdvertenciaQos[] = []
    const activas = clases.filter((c) => c.activa)
    const restos = activas.filter((c) => c.es_resto)
    if (restos.length !== 1) {
        errores.push({
            field: 'es_resto',
            rule: 'qos_resto',
            message: 'el perfil necesita exactamente una clase «resto» activa (lo que no coincide con nada)',
        })
    }
    if (activas.length > QOS_MAX_CLASES) {
        errores.push({
            field: 'activa',
            rule: 'qos_max_clases',
            message: `máximo ${QOS_MAX_CLASES} clases activas por perfil (hay ${activas.length}); RouterOS tiene 8 prioridades`,
        })
    }
    const suma = activas.reduce((t, c) => t + c.garantizado_pct, 0)
    if (suma > 100) {
        errores.push({
            field: 'garantizado_pct',
            rule: 'qos_garantizado',
            message: `la suma del garantizado de las clases activas sería ${suma} %: no puede pasar de 100 %`,
        })
    }
    const porId = new Map(clases.map((c) => [c.id, c]))
    const origenes = new Map<number, number>()
    for (const c of activas) {
        const f = campo(c.id)
        if (c.es_resto) {
            if (c.reglas.length > 0 || esDescarga(c)) {
                errores.push({
                    field: `${f}.reglas`,
                    rule: 'qos_reglas',
                    message: '«resto» es lo que no coincide con nada: no lleva reglas ni bytes_minimo',
                })
            }
            continue
        }
        errores.push(...problemasReglas(c.reglas, `${f}.reglas`))
        if (!esDescarga(c)) {
            if (c.reglas.length === 0) {
                errores.push({
                    field: `${f}.reglas`,
                    rule: 'qos_reglas',
                    message:
                        'la clase necesita al menos una regla (protocolo, puertos, DSCP o lista de destino)',
                })
            }
            if (c.reclasifica_de.length > 0) {
                errores.push({
                    field: `${f}.reclasifica_de`,
                    rule: 'qos_reclasifica',
                    message: 'reclasifica_de solo aplica a una clase de descargas (con bytes_minimo)',
                })
            }
            continue
        }
        if (c.reclasifica_de.length === 0) {
            errores.push({
                field: `${f}.reclasifica_de`,
                rule: 'qos_reclasifica',
                message: 'una clase de descargas dice de qué clases toma las conexiones (p. ej. web y resto)',
            })
        }
        for (const o of c.reclasifica_de) {
            const origen = porId.get(o)
            let error: string | null = null
            if (o === c.id) error = 'una clase no se reclasifica a sí misma'
            else if (!origen) error = `la clase ${o} no es de este perfil`
            else if (!origen.activa) error = `la clase ${origen.nombre} está inactiva`
            else if (esDescarga(origen)) error = `${origen.nombre} también es de descargas`
            else if (origenes.has(o) && origenes.get(o) !== c.id) {
                error = `${origen.nombre} ya la reclasifica otra clase de descargas: el resultado dependería del orden`
            }
            if (error) {
                errores.push({ field: `${f}.reclasifica_de`, rule: 'qos_reclasifica', message: error })
            }
            origenes.set(o, c.id)
        }
    }
    // Lo que un cliente puede usar a la vez: cada clase tiene su PCQ (MIR × tope).
    const porCliente = activas.reduce((t, c) => t + (c.tope_pct ?? 100), 0)
    if (porCliente > 100) {
        advertencias.push({
            regla: 'tope_por_cliente',
            mensaje:
                `un cliente que usa varias clases a la vez puede pasar la velocidad de su plan (hasta ${porCliente} %): ` +
                'cada clase tiene su propio PCQ; el nodo del plan sigue limitando el total del plan',
        })
    }
    const posiciones = clasesPorPosicion(clases)
    const ordenes = posiciones.map((c) => c.orden)
    if (new Set(ordenes).size !== ordenes.length) {
        advertencias.push({
            regla: 'orden_repetido',
            mensaje: 'hay clases con el mismo orden: se desempata por id (la más vieja primero)',
        })
    }
    return { errores, advertencias }
}

/*
|--------------------------------------------------------------------------
| Objetos de RouterOS
|--------------------------------------------------------------------------
*/

/** Un objeto de QoS (misma forma que `ObjetoVelocidad`). */
export interface ObjetoQos {
    ruta: RutaRouterOS
    clave: Propiedades
    propiedades: Propiedades
}

export const PREFIJO_COMMENT_QOS = 'argosisp:qos:'
export const MANGLES = ['/ip/firewall/mangle', '/ipv6/firewall/mangle'] as const
export type RutaMangle = (typeof MANGLES)[number]

/** `connection-mark` de una clase. */
export const marcaConexion = (claseId: number) => `argosisp-qos-${claseId}`
/** Cadena de clasificación de una posición (1…). */
export const cadenaPosicion = (pos: number) => `argosisp-qos-${pos}`
export const CADENA_RESTO = 'argosisp-qos-resto'
export const CADENA_PESADAS = 'argosisp-qos-pesadas'

/** Propiedades de RouterOS de una regla de coincidencia (en `/ipv6`, `icmp` → `icmpv6`). */
export function propiedadesRegla(r: ReglaQos, ruta: RutaMangle): Propiedades {
    const p: Propiedades = {}
    if (r.protocolo) {
        p.protocol = r.protocolo === 'icmp' && ruta === '/ipv6/firewall/mangle' ? 'icmpv6' : r.protocolo
    }
    if (r.puertos_destino) p['dst-port'] = r.puertos_destino.replace(/\s+/g, '')
    if (r.puertos_origen) p['src-port'] = r.puertos_origen.replace(/\s+/g, '')
    if (r.dscp !== null) p.dscp = String(r.dscp)
    if (r.lista_destino) p['dst-address-list'] = r.lista_destino
    return p
}

/**
 * Clasificación de conexiones del router (§3.1), IPv4 e IPv6: entrada en `prerouting`, una cadena por
 * posición con las reglas de su clase y el salto a la siguiente, `resto`, y la reclasificación de
 * descargas. Ninguna depende del orden dentro de su cadena (no hace falta `move`).
 */
export function objetosClasificacion(perfil: PerfilQosRouter): ObjetoQos[] {
    const salida: ObjetoQos[] = []
    const posiciones = clasesPorPosicion(perfil.clases)
    const resto = claseResto(perfil.clases)
    if (!resto) return salida
    const descargas = perfil.clases.filter((c) => c.activa && esDescarga(c)).sort((a, b) => a.id - b.id)
    const siguiente = (pos: number) => (pos < posiciones.length ? cadenaPosicion(pos + 1) : CADENA_RESTO)
    for (const ruta of MANGLES) {
        const agregar = (comment: string, propiedades: Propiedades) =>
            salida.push({ ruta, clave: { comment }, propiedades: { ...propiedades, disabled: 'no' } })
        posiciones.forEach((c, i) => {
            const pos = i + 1
            c.reglas.forEach((r, n) =>
                agregar(`${PREFIJO_COMMENT_QOS}clase:${c.id}:${n}`, {
                    chain: cadenaPosicion(pos),
                    ...propiedadesRegla(r, ruta),
                    action: 'mark-connection',
                    'new-connection-mark': marcaConexion(c.id),
                    passthrough: 'yes',
                }),
            )
            agregar(`${PREFIJO_COMMENT_QOS}salto:${pos}`, {
                chain: cadenaPosicion(pos),
                'connection-mark': 'no-mark',
                action: 'jump',
                'jump-target': siguiente(pos),
            })
        })
        agregar(`${PREFIJO_COMMENT_QOS}clase:${resto.id}`, {
            chain: CADENA_RESTO,
            action: 'mark-connection',
            'new-connection-mark': marcaConexion(resto.id),
            passthrough: 'yes',
        })
        for (const d of descargas) {
            for (const origen of [...d.reclasifica_de].sort((a, b) => a - b)) {
                const reglas: Array<ReglaQos | null> = d.reglas.length > 0 ? d.reglas : [null]
                reglas.forEach((r, n) =>
                    agregar(`${PREFIJO_COMMENT_QOS}pesada:${d.id}:${origen}:${n}`, {
                        chain: CADENA_PESADAS,
                        'connection-mark': marcaConexion(origen),
                        'connection-bytes': `${d.bytes_minimo}-0`,
                        ...(r ? propiedadesRegla(r, ruta) : {}),
                        action: 'mark-connection',
                        'new-connection-mark': marcaConexion(d.id),
                        passthrough: 'yes',
                    }),
                )
            }
        }
        // Entradas al final: las cadenas ya existen cuando se crea el salto.
        agregar(`${PREFIJO_COMMENT_QOS}entrada`, {
            chain: 'prerouting',
            'connection-state': 'new',
            'connection-mark': 'no-mark',
            action: 'jump',
            'jump-target': posiciones.length > 0 ? cadenaPosicion(1) : CADENA_RESTO,
        })
        if (descargas.length > 0) {
            agregar(`${PREFIJO_COMMENT_QOS}pesadas`, {
                chain: 'prerouting',
                action: 'jump',
                'jump-target': CADENA_PESADAS,
            })
        }
    }
    return salida
}

/** Clases activas que tienen hoja en el árbol (todas, también resto y descargas). */
export function clasesConHoja(perfil: PerfilQosRouter): ClaseQos[] {
    return perfil.clases.filter((c) => c.activa).sort((a, b) => a.id - b.id)
}

/** `name` de la hoja (y su `packet-mark`): `<nodo>-q<clase>`. */
export const nombreHoja = (nodo: string, claseId: number) => `${nodo}-q${claseId}`
/** Cadena de mangle del plan: `argosisp-qos-plan-<id>[-limitado]-<sentido>`. */
export const cadenaPlan = (nodo: string) => nodo.replace(/^argosisp-plan-/, 'argosisp-qos-plan-')

export interface EntradaHojas {
    /** nombre del nodo del plan (`argosisp-plan-<id>[-limitado]-<sentido>`) */
    nodo: string
    /** comment del nodo del plan (`argosisp:plan:<id>[:limitado]:<sentido>`) */
    comment: string
    /** lista del plan y el campo con que se busca (`dst-address-list` bajada, `src-address-list` subida) */
    lista: string
    campoLista: 'dst-address-list' | 'src-address-list'
    /** capacidad del nodo del plan en ese sentido (MIR × clientes / reuso, con 1 cliente si no hay) */
    capacidad_kbps: number
    /** clientes del plan en ese estado (0 = no garantiza nada) */
    clientes: number
    /** extra `garantizado` */
    garantizado: boolean
    /** propiedades del PCQ del plan para armar el de una clase con tope */
    pcq: { propiedades: Propiedades; mir_kbps: number }
}

const pct = (kbps: number, p: number) => Math.floor((kbps * p) / 100)

/**
 * Lo de QoS de un nodo del plan (§3.2 y §3.3): tipos PCQ de las clases con tope, hojas y mangle (la
 * cadena del plan y el salto en `forward`). El nodo del plan lo arma el árbol, sin `packet-mark`.
 */
export function objetosQosPlan(
    perfil: PerfilQosRouter,
    e: EntradaHojas,
): { tipos: ObjetoQos[]; hojas: ObjetoQos[]; mangles: ObjetoQos[] } {
    const tipos: ObjetoQos[] = []
    const hojas: ObjetoQos[] = []
    const mangles: ObjetoQos[] = []
    const resto = claseResto(perfil.clases)
    if (!resto) return { tipos, hojas, mangles }
    const cadena = cadenaPlan(e.nodo)
    for (const c of clasesConHoja(perfil)) {
        const nombre = nombreHoja(e.nodo, c.id)
        let queue = e.nodo
        if (c.tope_pct !== null) {
            queue = nombre
            const props = { ...e.pcq.propiedades }
            delete props['pcq-burst-rate']
            delete props['pcq-burst-threshold']
            delete props['pcq-burst-time']
            props['pcq-rate'] = formatoKbps(Math.max(pct(e.pcq.mir_kbps, c.tope_pct), 1))
            tipos.push({ ruta: '/queue/type', clave: { name: nombre }, propiedades: props })
        }
        const comment = `${e.comment}:qos:${c.id}`
        hojas.push({
            ruta: '/queue/tree',
            clave: { comment },
            propiedades: {
                name: nombre,
                parent: e.nodo,
                'packet-mark': nombre,
                queue,
                priority: String(c.prioridad),
                'limit-at':
                    e.garantizado && e.clientes > 0
                        ? formatoKbps(pct(e.capacidad_kbps, c.garantizado_pct))
                        : '0',
                'max-limit':
                    c.tope_pct !== null ? formatoKbps(Math.max(pct(e.capacidad_kbps, c.tope_pct), 1)) : '0',
                disabled: 'no',
            },
        })
        for (const ruta of MANGLES) {
            mangles.push({
                ruta,
                clave: { comment },
                propiedades:
                    c.id === resto.id
                        ? {
                              chain: cadena,
                              action: 'mark-packet',
                              'new-packet-mark': nombre,
                              passthrough: 'yes',
                              disabled: 'no',
                          }
                        : {
                              chain: cadena,
                              'connection-mark': marcaConexion(c.id),
                              action: 'mark-packet',
                              'new-packet-mark': nombre,
                              passthrough: 'no',
                              disabled: 'no',
                          },
            })
        }
    }
    // El salto en `forward` al final: la cadena y las hojas ya existen.
    for (const ruta of MANGLES) {
        mangles.push({
            ruta,
            clave: { comment: `${e.comment}:qos` },
            propiedades: {
                chain: 'forward',
                action: 'jump',
                [e.campoLista]: e.lista,
                'jump-target': cadena,
                disabled: 'no',
            },
        })
    }
    return { tipos, hojas, mangles }
}

/*
|--------------------------------------------------------------------------
| Costo (§3.4)
|--------------------------------------------------------------------------
*/

export interface CostoQos {
    /** planes con `qos` en el router */
    planes_qos: number
    clases: number
    /** hojas de `/queue/tree` (4 por plan y clase) */
    hojas: number
    /** reglas de mangle por familia (IPv4; IPv6 igual) */
    reglas_mangle: number
    /** tipos PCQ extra (clases con tope) */
    tipos_cola: number
    limite_hojas: number
}

export function costoQos(perfil: PerfilQosRouter | null, planesQos: number): CostoQos {
    const activas = perfil ? perfil.clases.filter((c) => c.activa) : []
    const m = activas.length
    let clasificacion = 0
    if (perfil && planesQos > 0 && m > 0) {
        clasificacion = objetosClasificacion(perfil).filter((o) => o.ruta === '/ip/firewall/mangle').length
    }
    return {
        planes_qos: planesQos,
        clases: m,
        hojas: 4 * planesQos * m,
        reglas_mangle: clasificacion + 4 * planesQos * (m + 1),
        tipos_cola: 4 * planesQos * activas.filter((c) => c.tope_pct !== null).length,
        limite_hojas: QOS_MAX_HOJAS,
    }
}

/*
|--------------------------------------------------------------------------
| Semillas (perfil «Predeterminado», migración y `copiar_de`)
|--------------------------------------------------------------------------
*/

export interface SemillaClase {
    clave: string
    nombre: string
    orden: number
    prioridad: number
    garantizado_pct: number
    tope_pct: number | null
    es_resto: boolean
    reglas: ReglaQos[]
    bytes_minimo: number | null
    /** claves de las clases origen */
    reclasifica_de: string[]
}

const regla = (r: Partial<ReglaQos>): ReglaQos => ({
    protocolo: null,
    puertos_destino: null,
    puertos_origen: null,
    dscp: null,
    lista_destino: null,
    ...r,
})

export const SEMILLAS_QOS: SemillaClase[] = [
    {
        clave: 'interactivo',
        nombre: 'Interactivo',
        orden: 1,
        prioridad: 1,
        garantizado_pct: 10,
        tope_pct: 30,
        es_resto: false,
        reglas: [
            regla({ protocolo: 'udp', puertos_destino: '53,123' }),
            regla({ protocolo: 'tcp', puertos_destino: '53' }),
            regla({ protocolo: 'udp', puertos_destino: '5060-5061,10000-20000' }),
            regla({ protocolo: 'udp', puertos_destino: '3074,3478-3480,27000-27050' }),
            regla({ protocolo: 'icmp' }),
            regla({ dscp: 46 }),
        ],
        bytes_minimo: null,
        reclasifica_de: [],
    },
    {
        clave: 'streaming',
        nombre: 'Streaming',
        orden: 2,
        prioridad: 4,
        garantizado_pct: 20,
        tope_pct: null,
        es_resto: false,
        reglas: [
            regla({ protocolo: 'tcp', puertos_destino: '443', lista_destino: 'argosisp-qos-streaming' }),
            regla({ protocolo: 'udp', puertos_destino: '443', lista_destino: 'argosisp-qos-streaming' }),
        ],
        bytes_minimo: null,
        reclasifica_de: [],
    },
    {
        clave: 'web',
        nombre: 'Web',
        orden: 3,
        prioridad: 3,
        garantizado_pct: 30,
        tope_pct: null,
        es_resto: false,
        reglas: [
            regla({ protocolo: 'tcp', puertos_destino: '80,443' }),
            regla({ protocolo: 'udp', puertos_destino: '443' }),
        ],
        bytes_minimo: null,
        reclasifica_de: [],
    },
    {
        clave: 'descargas',
        nombre: 'Descargas',
        orden: 90,
        prioridad: 7,
        garantizado_pct: 0,
        tope_pct: null,
        es_resto: false,
        reglas: [],
        bytes_minimo: 10_000_000,
        reclasifica_de: ['web', 'resto'],
    },
    {
        clave: 'resto',
        nombre: 'Resto',
        orden: 99,
        prioridad: 6,
        garantizado_pct: 10,
        tope_pct: null,
        es_resto: true,
        reglas: [],
        bytes_minimo: null,
        reclasifica_de: [],
    },
]
