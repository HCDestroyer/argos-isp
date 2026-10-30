import type { ControlVelocidad, VelocidadPlan } from '#network/velocidad'
import { QOS_MAX_HOJAS } from '#network/qos'

/**
 * Estrategia de control de velocidad por capas (`.claude/integration/contratos/control-velocidad.md`).
 * Funciones puras (sin base de datos ni reloj): las usan la caché AAA, el dispatcher de RouterOS,
 * la vista previa y la validación, para que todos resuelvan igual.
 *
 * Una estrategia tiene cuatro capas: `aplicacion` (cómo se limita a cada cliente), `padre`
 * (agregación), `tipo_cola` (cola de las hojas o del PCQ) y `extras` (ráfaga, prioridad,
 * garantizado y la verificación de FastTrack). Se elige por router para cada tipo de conexión y se
 * puede sobrescribir por plan en ese router (`planes_routers.estrategia_velocidad`).
 */

export const APLICACIONES = [
    'radius_rate_limit',
    'perfil_ppp',
    'cola_simple',
    'pcq_plan',
    'arbol_pcq',
] as const
export type Aplicacion = (typeof APLICACIONES)[number]

export const PADRES = ['ninguno', 'por_plan', 'por_router', 'jerarquico'] as const
export type Padre = (typeof PADRES)[number]

export const TIPOS_COLA = ['default', 'sfq', 'pcq', 'fq_codel', 'cake'] as const
export type TipoCola = (typeof TIPOS_COLA)[number]

export const TIPOS_CONEXION = ['pppoe', 'ip_estatica', 'dhcp_fija'] as const
export type TipoConexionVelocidad = (typeof TIPOS_CONEXION)[number]

export const CAMPOS_EXTRAS = ['rafaga', 'prioridad', 'garantizado', 'excluir_fasttrack', 'qos'] as const
export type CampoExtra = (typeof CAMPOS_EXTRAS)[number]
export type ExtrasVelocidad = Record<CampoExtra, boolean>

export const CAPAS = ['aplicacion', 'padre', 'tipo_cola', 'extras'] as const
export type Capa = (typeof CAPAS)[number]

export interface Estrategia {
    aplicacion: Aplicacion
    padre: Padre
    tipo_cola: TipoCola
    extras: ExtrasVelocidad
}

/** Estrategia del router: una completa por tipo de conexión. */
export type EstrategiasRouter = Record<TipoConexionVelocidad, Estrategia>

export interface EstrategiaParcial {
    aplicacion?: Aplicacion | null
    padre?: Padre | null
    tipo_cola?: TipoCola | null
    extras?: Partial<Record<CampoExtra, boolean | null>> | null
}

/** Excepción de un plan en un router: parcial por tipo de conexión (ausente o null = hereda). */
export type ExcepcionEstrategia = Partial<Record<TipoConexionVelocidad, EstrategiaParcial | null>>

/** Familia de colas: colas simples (y perfiles PPP) o queue tree. */
export type Familia = 'simple' | 'arbol'

export function familia(aplicacion: Aplicacion): Familia {
    return aplicacion === 'arbol_pcq' ? 'arbol' : 'simple'
}

/** Aplicaciones que usan PCQ por plan (el `tipo_cola` es `pcq` obligatorio). */
export function usaPcq(aplicacion: Aplicacion): boolean {
    return aplicacion === 'pcq_plan' || aplicacion === 'arbol_pcq'
}

/**
 * Extras de los atajos y de la migración: todo encendido salvo `qos` (prioridad por clases,
 * `contratos/qos.md`), que se prende a propósito y solo vale en el árbol.
 */
export const EXTRAS_TODOS: ExtrasVelocidad = {
    rafaga: true,
    prioridad: true,
    garantizado: true,
    excluir_fasttrack: true,
    qos: false,
}

/** Valor por defecto de cada extra (la matriz lo publica). */
export const EXTRAS_POR_DEFECTO: ExtrasVelocidad = { ...EXTRAS_TODOS }

/** ¿La estrategia prioriza por clases? Solo en el árbol (`contratos/qos.md` §2). */
export function conQos(e: Pick<Estrategia, 'aplicacion' | 'extras'>): boolean {
    return e.extras.qos && familia(e.aplicacion) === 'arbol'
}

/**
 * Estrategias equivalentes a los modos de hoy (migración, `contratos/control-velocidad.md` §6):
 * - `simple`: PPPoE con `Mikrotik-Rate-Limit` y WISP con cola simple, padre por plan (solo con
 *   reuso > 1, como hoy).
 * - `arbol_pcq`: árbol global → plan → PCQ para todos; sin ráfaga (el PCQ de hoy no la tiene).
 */
export function estrategiasDeControl(control: ControlVelocidad): EstrategiasRouter {
    if (control === 'arbol_pcq') {
        const arbol: Estrategia = {
            aplicacion: 'arbol_pcq',
            padre: 'jerarquico',
            tipo_cola: 'pcq',
            extras: { ...EXTRAS_TODOS, rafaga: false },
        }
        return { pppoe: arbol, ip_estatica: { ...arbol }, dhcp_fija: { ...arbol } }
    }
    const wisp: Estrategia = {
        aplicacion: 'cola_simple',
        padre: 'por_plan',
        tipo_cola: 'default',
        extras: { ...EXTRAS_TODOS },
    }
    return {
        pppoe: {
            aplicacion: 'radius_rate_limit',
            padre: 'por_plan',
            tipo_cola: 'default',
            extras: { ...EXTRAS_TODOS },
        },
        ip_estatica: wisp,
        dhcp_fija: { ...wisp, extras: { ...EXTRAS_TODOS } },
    }
}

/**
 * Estrategias que llegan por la API: un `extras.qos` ausente conserva el valor actual del router
 * (`contratos/qos.md` §2), así un cliente que no conoce `qos` no lo apaga al cambiar otra capa.
 */
export function completarQos(
    propuesta: Record<
        TipoConexionVelocidad,
        { extras: Partial<ExtrasVelocidad> } & Omit<Estrategia, 'extras'>
    >,
    actual: EstrategiasRouter,
): EstrategiasRouter {
    const salida = {} as EstrategiasRouter
    for (const tipo of TIPOS_CONEXION) {
        const p = propuesta[tipo]
        salida[tipo] = {
            ...p,
            extras: {
                ...(p.extras as ExtrasVelocidad),
                qos: typeof p.extras.qos === 'boolean' ? p.extras.qos : actual[tipo].extras.qos,
            },
        }
    }
    return salida
}

/** `control_velocidad` derivado (obsoleto): `arbol_pcq` si PPPoE va por árbol. */
export function controlDerivado(estrategias: EstrategiasRouter): ControlVelocidad {
    return estrategias.pppoe.aplicacion === 'arbol_pcq' ? 'arbol_pcq' : 'simple'
}

const enLista = <T extends string>(lista: readonly T[], v: unknown): v is T =>
    typeof v === 'string' && (lista as readonly string[]).includes(v)

function leerEstrategia(valor: unknown, defecto: Estrategia): Estrategia {
    if (typeof valor !== 'object' || valor === null) return { ...defecto, extras: { ...defecto.extras } }
    const v = valor as Record<string, unknown>
    const extras = (typeof v.extras === 'object' && v.extras !== null ? v.extras : {}) as Record<
        string,
        unknown
    >
    return {
        aplicacion: enLista(APLICACIONES, v.aplicacion) ? v.aplicacion : defecto.aplicacion,
        padre: enLista(PADRES, v.padre) ? v.padre : defecto.padre,
        tipo_cola: enLista(TIPOS_COLA, v.tipo_cola) ? v.tipo_cola : defecto.tipo_cola,
        extras: Object.fromEntries(
            CAMPOS_EXTRAS.map((c) => [c, typeof extras[c] === 'boolean' ? extras[c] : defecto.extras[c]]),
        ) as ExtrasVelocidad,
    }
}

/**
 * `network.routers.estrategia_velocidad` (jsonb) → estrategias completas. Lo que falte o no sea
 * válido toma el valor del modo `control` (la columna es NOT NULL; esto solo protege de datos viejos).
 */
export function leerEstrategias(valor: unknown, control: ControlVelocidad = 'simple'): EstrategiasRouter {
    const base = estrategiasDeControl(control)
    const v = (typeof valor === 'object' && valor !== null ? valor : {}) as Record<string, unknown>
    return {
        pppoe: leerEstrategia(v.pppoe, base.pppoe),
        ip_estatica: leerEstrategia(v.ip_estatica, base.ip_estatica),
        dhcp_fija: leerEstrategia(v.dhcp_fija, base.dhcp_fija),
    }
}

/** `planes_routers.estrategia_velocidad` (jsonb o null) → excepción limpia (null si no hay nada). */
export function leerExcepcion(valor: unknown): ExcepcionEstrategia | null {
    if (typeof valor !== 'object' || valor === null) return null
    const v = valor as Record<string, unknown>
    const salida: ExcepcionEstrategia = {}
    for (const tipo of TIPOS_CONEXION) {
        const p = v[tipo]
        if (typeof p !== 'object' || p === null) continue
        const parcial = p as Record<string, unknown>
        const limpio: EstrategiaParcial = {}
        if (enLista(APLICACIONES, parcial.aplicacion)) limpio.aplicacion = parcial.aplicacion
        if (enLista(PADRES, parcial.padre)) limpio.padre = parcial.padre
        if (enLista(TIPOS_COLA, parcial.tipo_cola)) limpio.tipo_cola = parcial.tipo_cola
        if (typeof parcial.extras === 'object' && parcial.extras !== null) {
            const extras: Partial<Record<CampoExtra, boolean>> = {}
            for (const c of CAMPOS_EXTRAS) {
                const e = (parcial.extras as Record<string, unknown>)[c]
                if (typeof e === 'boolean') extras[c] = e
            }
            if (Object.keys(extras).length > 0) limpio.extras = extras
        }
        if (Object.keys(limpio).length > 0) salida[tipo] = limpio
    }
    return Object.keys(salida).length > 0 ? salida : null
}

/** Estrategia efectiva de un tipo de conexión: la del router, capa por capa sobrescrita por la del plan. */
export function estrategiaEfectiva(
    router: EstrategiasRouter,
    excepcion: ExcepcionEstrategia | null | undefined,
    tipo: TipoConexionVelocidad,
): Estrategia {
    const base = router[tipo]
    const parcial = excepcion?.[tipo]
    if (!parcial) return { ...base, extras: { ...base.extras } }
    const extras = { ...base.extras }
    for (const c of CAMPOS_EXTRAS) {
        const v = parcial.extras?.[c]
        if (typeof v === 'boolean') extras[c] = v
    }
    return {
        aplicacion: parcial.aplicacion ?? base.aplicacion,
        padre: parcial.padre ?? base.padre,
        tipo_cola: parcial.tipo_cola ?? base.tipo_cola,
        extras,
    }
}

/** Dos estrategias iguales (para saber si una sesión conserva lo anterior). */
export function mismaEstrategia(a: Estrategia, b: Estrategia): boolean {
    return (
        a.aplicacion === b.aplicacion &&
        a.padre === b.padre &&
        a.tipo_cola === b.tipo_cola &&
        CAMPOS_EXTRAS.every((c) => a.extras[c] === b.extras[c])
    )
}

/** Capas que difieren entre dos estrategias de router (payload de `router.estrategia_cambiada`). */
export function capasCambiadas(
    de: EstrategiasRouter | ExcepcionEstrategia | null,
    a: EstrategiasRouter | ExcepcionEstrategia | null,
): Capa[] {
    const salida = new Set<Capa>()
    for (const tipo of TIPOS_CONEXION) {
        const x = (de?.[tipo] ?? {}) as EstrategiaParcial
        const y = (a?.[tipo] ?? {}) as EstrategiaParcial
        if ((x.aplicacion ?? null) !== (y.aplicacion ?? null)) salida.add('aplicacion')
        if ((x.padre ?? null) !== (y.padre ?? null)) salida.add('padre')
        if ((x.tipo_cola ?? null) !== (y.tipo_cola ?? null)) salida.add('tipo_cola')
        if (CAMPOS_EXTRAS.some((c) => (x.extras?.[c] ?? null) !== (y.extras?.[c] ?? null))) {
            salida.add('extras')
        }
    }
    return CAPAS.filter((c) => salida.has(c))
}

/**
 * Velocidad que se escribe según los extras: sin ráfaga, prioridad 8 o sin `limit-at` cuando el
 * extra está apagado. Las fórmulas siguen siendo las de `#network/velocidad`.
 */
export function velocidadConExtras(velocidad: VelocidadPlan, extras: ExtrasVelocidad): VelocidadPlan {
    return {
        ...velocidad,
        rafaga_bajada_kbps: extras.rafaga ? velocidad.rafaga_bajada_kbps : null,
        rafaga_subida_kbps: extras.rafaga ? velocidad.rafaga_subida_kbps : null,
        prioridad: extras.prioridad ? velocidad.prioridad : 8,
        garantizado_pct: extras.garantizado ? velocidad.garantizado_pct : 0,
    }
}

/** Nombre y comment de la cola padre del router (familia de colas simples). */
export const NOMBRE_PADRE_ROUTER = 'argosisp-router'
export const COMMENT_PADRE_ROUTER = 'argosisp:router'

/** ¿Hay nivel de router (techo del enlace)? */
export function conNivelRouter(e: Pick<Estrategia, 'padre'>): boolean {
    return e.padre === 'por_router' || e.padre === 'jerarquico'
}

/**
 * ¿Hay nivel de plan? En la familia de colas simples, `por_plan` solo con reuso > 1 (con reuso 1 un
 * padre nunca limita: es lo de hoy) y `jerarquico` siempre. En el árbol los nodos del plan existen
 * siempre (llevan la marca); esto dice si agregan (`max-limit` del reuso).
 */
export function conNivelPlan(e: Pick<Estrategia, 'padre' | 'aplicacion'>, reuso: number): boolean {
    if (familia(e.aplicacion) === 'arbol') return e.padre === 'por_plan' || e.padre === 'jerarquico'
    return (e.padre === 'por_plan' && reuso > 1) || e.padre === 'jerarquico'
}

/** `name` de la cola padre del plan (familia de colas simples). */
export function nombrePadrePlan(planId: number): string {
    return `argosisp-plan-${planId}`
}

/**
 * Padre de lo que limita a un cliente en la familia de colas simples (cola WISP, cola `-pcq` del plan
 * o `parent-queue` del perfil PPP): el del plan, el del router o `none`.
 */
export function padreCliente(e: Estrategia, planId: number, reuso: number): string {
    if (conNivelPlan(e, reuso)) return nombrePadrePlan(planId)
    if (conNivelRouter(e)) return NOMBRE_PADRE_ROUTER
    return 'none'
}

/** Nombre del tipo de cola de una hoja (`default` no se escribe: lo pone RouterOS). */
export function nombreTipoHoja(tipo: TipoCola): string | null {
    switch (tipo) {
        case 'sfq':
            return 'argosisp-sfq'
        case 'fq_codel':
            return 'argosisp-fq-codel'
        case 'cake':
            return 'argosisp-cake'
        default:
            return null
    }
}

/** `kind` de RouterOS del tipo de hoja. */
export function kindTipoHoja(tipo: TipoCola): string | null {
    switch (tipo) {
        case 'sfq':
            return 'sfq'
        case 'fq_codel':
            return 'fq-codel'
        case 'cake':
            return 'cake'
        default:
            return null
    }
}

/**
 * ¿El PPPoE del plan necesita el perfil `plan-<id>`? Con padre (cuelga por `parent-queue`), con un
 * tipo de cola propio (`queue-type`) o con `perfil_ppp` (el rate-limit vive en el perfil).
 */
export function necesitaPerfil(e: Estrategia, planId: number, reuso: number): boolean {
    if (e.aplicacion !== 'radius_rate_limit' && e.aplicacion !== 'perfil_ppp') return false
    return (
        e.aplicacion === 'perfil_ppp' ||
        e.tipo_cola !== 'default' ||
        padreCliente(e, planId, reuso) !== 'none'
    )
}

/** Bloque `velocidad` del registro `aaa:user:*` (`contratos/control-velocidad.md` §7). */
export interface VelocidadAaa {
    aplicacion: Aplicacion
    /** `Mikrotik-Group` en activo y limitado; null = ninguno */
    grupo: string | null
    /** ¿`aaa` manda `Mikrotik-Rate-Limit` en activo? */
    rate_limit: boolean
    /** ¿y en limitado? */
    rate_limit_limitado: boolean
}

export function velocidadAaa(
    e: Estrategia,
    planId: number,
    reuso: number,
    profilePpp: string | null,
): VelocidadAaa {
    const perfil = necesitaPerfil(e, planId, reuso) ? `plan-${planId}` : profilePpp
    switch (e.aplicacion) {
        case 'perfil_ppp':
            return { aplicacion: e.aplicacion, grupo: perfil, rate_limit: false, rate_limit_limitado: true }
        case 'pcq_plan':
        case 'arbol_pcq':
            return {
                aplicacion: e.aplicacion,
                grupo: profilePpp,
                rate_limit: false,
                rate_limit_limitado: false,
            }
        default:
            return { aplicacion: e.aplicacion, grupo: perfil, rate_limit: true, rate_limit_limitado: true }
    }
}

/** ¿Se le puede cambiar la velocidad a una sesión viva por CoA? (`radius_rate_limit` y `perfil_ppp`) */
export function velocidadPorCoa(e: Pick<Estrategia, 'aplicacion'>): boolean {
    return e.aplicacion === 'radius_rate_limit' || e.aplicacion === 'perfil_ppp'
}

/*
|--------------------------------------------------------------------------
| Matriz de combinaciones
|--------------------------------------------------------------------------
*/

export interface ProblemaEstrategia {
    field: string
    rule: string
    message: string
}

export interface AdvertenciaEstrategia {
    regla: string
    mensaje: string
}

const TIPOS_POR_APLICACION: Record<Aplicacion, readonly TipoConexionVelocidad[]> = {
    radius_rate_limit: ['pppoe'],
    perfil_ppp: ['pppoe'],
    cola_simple: ['ip_estatica', 'dhcp_fija'],
    pcq_plan: TIPOS_CONEXION,
    arbol_pcq: TIPOS_CONEXION,
}

const NOMBRE_TIPO: Record<TipoConexionVelocidad, string> = {
    pppoe: 'PPPoE',
    ip_estatica: 'IP estática',
    dhcp_fija: 'DHCP fija',
}

/** Versión mayor de RouterOS (`7.24.5 (stable)` → 7); null si no se conoce. */
export function versionMayor(version: string | null | undefined): number | null {
    const m = /^(\d+)\./.exec(version ?? '')
    return m ? Number(m[1]) : null
}

/** Errores de una estrategia sola (reglas 1 a 4 y 8 de la matriz). */
function problemasDe(
    e: EstrategiaParcial,
    tipo: TipoConexionVelocidad,
    campo: string,
    version: string | null,
): ProblemaEstrategia[] {
    const errores: ProblemaEstrategia[] = []
    const { aplicacion, tipo_cola: tipoCola } = e
    if (aplicacion !== undefined && aplicacion !== null && !enLista(APLICACIONES, aplicacion)) {
        errores.push({
            field: `${campo}.aplicacion`,
            rule: 'enum',
            message: `aplicacion debe ser una de ${APLICACIONES.join(', ')}`,
        })
        return errores
    }
    if (aplicacion && !TIPOS_POR_APLICACION[aplicacion].includes(tipo)) {
        errores.push({
            field: `${campo}.aplicacion`,
            rule: 'aplicacion_tipo',
            message:
                aplicacion === 'cola_simple'
                    ? `cola_simple no aplica a PPPoE: la sesión ya crea su cola dinámica; usa radius_rate_limit, perfil_ppp, pcq_plan o arbol_pcq`
                    : `${aplicacion} no aplica a ${NOMBRE_TIPO[tipo]}: sin sesión PPP no hay ${aplicacion === 'perfil_ppp' ? 'perfil' : 'atributo RADIUS'}; usa cola_simple, pcq_plan o arbol_pcq`,
        })
    }
    if (tipoCola !== undefined && tipoCola !== null && !enLista(TIPOS_COLA, tipoCola)) {
        errores.push({
            field: `${campo}.tipo_cola`,
            rule: 'enum',
            message: `tipo_cola debe ser uno de ${TIPOS_COLA.join(', ')}`,
        })
    } else if (aplicacion && tipoCola) {
        if (usaPcq(aplicacion) && tipoCola !== 'pcq') {
            errores.push({
                field: `${campo}.tipo_cola`,
                rule: 'tipo_cola',
                message: `${aplicacion} necesita PCQ: el tope de cada cliente es el pcq-rate del plan (con ${tipoCola} no habría tope por cliente)`,
            })
        }
        if (!usaPcq(aplicacion) && tipoCola === 'pcq') {
            errores.push({
                field: `${campo}.tipo_cola`,
                rule: 'tipo_cola',
                message: `PCQ reparte entre varios clientes; en la cola de uno solo (${aplicacion}) usa default, sfq, fq_codel o cake`,
            })
        }
    }
    if (tipoCola === 'fq_codel' || tipoCola === 'cake') {
        const mayor = versionMayor(version)
        if (mayor !== null && mayor < 7) {
            errores.push({
                field: `${campo}.tipo_cola`,
                rule: 'version',
                message: `${tipoCola} necesita RouterOS 7; este router tiene ${version}`,
            })
        }
    }
    // QoS por clases (`contratos/qos.md` §2, reglas 9 y 10).
    if (e.extras?.qos === true) {
        if (aplicacion && aplicacion !== 'arbol_pcq') {
            errores.push({
                field: `${campo}.extras.qos`,
                rule: 'qos_familia',
                message:
                    'qos necesita el árbol (arbol_pcq): en colas simples cada cliente tiene una sola cola y no hay hojas por clase',
            })
        }
        if (e.extras.excluir_fasttrack === false) {
            errores.push({
                field: `${campo}.extras.excluir_fasttrack`,
                rule: 'qos_fasttrack',
                message:
                    'qos exige excluir_fasttrack: con FastTrack las conexiones aceleradas no pasan por mangle y no se clasifican',
            })
        }
    }
    if (e.padre !== undefined && e.padre !== null && !enLista(PADRES, e.padre)) {
        errores.push({
            field: `${campo}.padre`,
            rule: 'enum',
            message: `padre debe ser uno de ${PADRES.join(', ')}`,
        })
    }
    return errores
}

export interface PlanValidacion {
    plan_id: number
    /** reuso efectivo del plan en el router */
    reuso: number
    excepcion: ExcepcionEstrategia | null
}

export interface EntradaValidacion {
    estrategias: EstrategiasRouter
    planes: PlanValidacion[]
    routeros_version: string | null
    capacidad_bajada_kbps: number | null
    capacidad_subida_kbps: number | null
    /** clases activas del perfil de QoS del router (para el costo, regla 11); sin ella no se revisa */
    qos_clases?: number
    /**
     * `network.routers.modo_seguridad` (ausente = `radius`). Sin RADIUS (`api`) PPPoE va con secrets
     * locales (`contratos/pppoe-local.md` §5): solo `perfil_ppp` (con cualquier padre) o `arbol_pcq`.
     */
    modo_seguridad?: 'radius' | 'api'
    /**
     * Con `false`, la regla `pppoe_sin_radius` solo revisa las excepciones de plan (al cambiar la de
     * un plan, la estrategia del router no cambia y se aplica como `perfil_ppp`, `estrategiaLocal`).
     */
    revisar_router_sin_radius?: boolean
    /** prefijo de los `field` de la estrategia del router (por defecto `estrategia_velocidad`) */
    campoRouter?: string
    /** prefijo de los `field` de la excepción de un plan (por defecto `planes.<id>`) */
    campoPlan?: (planId: number) => string
}

export interface ResultadoValidacion {
    errores: ProblemaEstrategia[]
    advertencias: AdvertenciaEstrategia[]
}

const igualesExtras = (a: ExtrasVelocidad, b: ExtrasVelocidad) => CAMPOS_EXTRAS.every((c) => a[c] === b[c])

/**
 * Matriz de combinaciones (`contratos/control-velocidad.md` §3). Revisa la estrategia del router por
 * tipo, cada excepción de plan resuelta, y las reglas entre ellas (una familia por techo del router,
 * un plan consistente). Los errores son 422; las advertencias no bloquean.
 */
export function validarEstrategias(entrada: EntradaValidacion): ResultadoValidacion {
    const errores: ProblemaEstrategia[] = []
    const advertencias: AdvertenciaEstrategia[] = []
    const campoRouter = entrada.campoRouter ?? 'estrategia_velocidad'
    const campoPlan = entrada.campoPlan ?? ((id: number) => `planes.${id}`)
    const version = entrada.routeros_version
    const avisar = (regla: string, mensaje: string) => {
        if (!advertencias.some((a) => a.regla === regla && a.mensaje === mensaje)) {
            advertencias.push({ regla, mensaje })
        }
    }

    for (const tipo of TIPOS_CONEXION) {
        errores.push(...problemasDe(entrada.estrategias[tipo], tipo, `${campoRouter}.${tipo}`, version))
    }
    // Regla 12: sin RADIUS no hay `Mikrotik-Rate-Limit` ni direcciones de la sesión al conectar.
    const sinRadius = (e: Pick<Estrategia, 'aplicacion'>, campo: string) => {
        if (entrada.modo_seguridad !== 'api') return
        if (e.aplicacion !== 'radius_rate_limit' && e.aplicacion !== 'pcq_plan') return
        errores.push({
            field: `${campo}.aplicacion`,
            rule: 'pppoe_sin_radius',
            message:
                e.aplicacion === 'radius_rate_limit'
                    ? 'el router no usa RADIUS: PPPoE se limita con el perfil del plan (perfil_ppp) o con el árbol (arbol_pcq), no con Mikrotik-Rate-Limit'
                    : 'el router no usa RADIUS: pcq_plan necesita las direcciones de la sesión al conectar (accounting); usa perfil_ppp o arbol_pcq',
        })
    }
    if (entrada.revisar_router_sin_radius !== false) {
        sinRadius(entrada.estrategias.pppoe, `${campoRouter}.pppoe`)
    }
    for (const plan of entrada.planes) {
        if (!plan.excepcion) continue
        for (const tipo of TIPOS_CONEXION) {
            const parcial = plan.excepcion[tipo]
            if (!parcial) continue
            // La parcial se revisa resuelta (una aplicación del plan con el tipo de cola del router).
            const efectiva = estrategiaEfectiva(entrada.estrategias, plan.excepcion, tipo)
            errores.push(...problemasDe(efectiva, tipo, `${campoPlan(plan.plan_id)}.${tipo}`, version))
            if (tipo === 'pppoe' && parcial.aplicacion) {
                sinRadius(efectiva, `${campoPlan(plan.plan_id)}.pppoe`)
            }
        }
    }
    if (errores.length > 0) return { errores: dedupe(errores), advertencias }

    // Grupos a revisar: los planes sin excepción usan la del router (`plan_id` null).
    const grupos: Array<{
        plan_id: number | null
        reuso: number
        campo: string
        excepcion: ExcepcionEstrategia | null
    }> = [
        { plan_id: null, reuso: 1, campo: campoRouter, excepcion: null },
        ...entrada.planes
            .filter((p) => p.excepcion)
            .map((p) => ({
                plan_id: p.plan_id,
                reuso: p.reuso,
                campo: campoPlan(p.plan_id),
                excepcion: p.excepcion,
            })),
    ]

    // Regla 5: el techo del router en una sola familia.
    const conTecho = new Map<Familia, string[]>()
    for (const g of grupos) {
        for (const tipo of TIPOS_CONEXION) {
            const e = estrategiaEfectiva(entrada.estrategias, g.excepcion, tipo)
            if (!conNivelRouter(e)) continue
            const lista = conTecho.get(familia(e.aplicacion)) ?? []
            lista.push(g.plan_id === null ? NOMBRE_TIPO[tipo] : `${NOMBRE_TIPO[tipo]} del plan ${g.plan_id}`)
            conTecho.set(familia(e.aplicacion), lista)
        }
    }
    if (conTecho.size > 1) {
        errores.push({
            field: campoRouter,
            rule: 'familia_router',
            message:
                `el techo del router se partiría en dos: colas simples (${conTecho.get('simple')!.join(', ')}) ` +
                `y queue tree (${conTecho.get('arbol')!.join(', ')}); usa la misma familia para por_router y jerarquico`,
        })
    }

    // Reglas 6 y 7: un plan comparte su cola entre tipos de conexión.
    for (const g of grupos) {
        const porFamilia = new Map<Familia, Array<{ tipo: TipoConexionVelocidad; e: Estrategia }>>()
        for (const tipo of TIPOS_CONEXION) {
            const e = estrategiaEfectiva(entrada.estrategias, g.excepcion, tipo)
            const lista = porFamilia.get(familia(e.aplicacion)) ?? []
            lista.push({ tipo, e })
            porFamilia.set(familia(e.aplicacion), lista)
        }
        const quien = g.plan_id === null ? 'los planes del router' : `el plan ${g.plan_id}`
        for (const [fam, lista] of porFamilia) {
            // Comparten objetos del plan: en el árbol todos (nodos, tipos PCQ); en colas simples, los
            // que cuelgan de un padre (la cola del plan o del router) y los `pcq_plan` (su cola PCQ).
            const comparten =
                fam === 'arbol'
                    ? [lista]
                    : [
                          lista.filter((x) => x.e.padre !== 'ninguno'),
                          lista.filter((x) => x.e.aplicacion === 'pcq_plan'),
                      ]
            const distinto = comparten
                .map(([primero, ...resto]) =>
                    primero
                        ? resto.find(
                              (x) =>
                                  x.e.padre !== primero.e.padre ||
                                  !igualesExtras(x.e.extras, primero.e.extras),
                          )
                        : undefined,
                )
                .find((x) => x !== undefined)
            const primero = comparten.find((c) => c.some((x) => x === distinto))?.[0]
            if (distinto && primero) {
                errores.push({
                    field: `${g.campo}.${distinto.tipo}.padre`,
                    rule: 'plan_consistente',
                    message:
                        `${NOMBRE_TIPO[primero!.tipo]} y ${NOMBRE_TIPO[distinto.tipo]} de ${quien} comparten la ` +
                        `${fam === 'arbol' ? 'rama del árbol' : 'cola'} del plan: usa el mismo padre y los mismos extras`,
                })
            }
        }
        const agregan = [...porFamilia].filter(([, lista]) =>
            lista.some((x) => x.e.padre === 'por_plan' || x.e.padre === 'jerarquico'),
        )
        if (agregan.length > 1) {
            errores.push({
                field: g.campo,
                rule: 'familia_plan',
                message: `el reuso de ${quien} se partiría entre colas simples y queue tree: usa una sola familia o padre ninguno/por_router en una de ellas`,
            })
        }
    }
    // Regla 11: costo de QoS del router (hojas = planes con qos × 2 estados × 2 sentidos × clases).
    if (entrada.qos_clases && entrada.qos_clases > 0) {
        const planesQos = entrada.planes.filter((p) =>
            TIPOS_CONEXION.some((t) => conQos(estrategiaEfectiva(entrada.estrategias, p.excepcion, t))),
        ).length
        const hojas = 4 * planesQos * entrada.qos_clases
        if (hojas > QOS_MAX_HOJAS) {
            errores.push({
                field: campoRouter,
                rule: 'qos_costo',
                message:
                    `el router pasaría de ${QOS_MAX_HOJAS} hojas de QoS (${planesQos} planes con qos × 2 estados × 2 ` +
                    `sentidos × ${entrada.qos_clases} clases = ${hojas}): apaga qos en los planes dedicados o usa menos clases`,
            })
        }
    }
    if (errores.length > 0) return { errores: dedupe(errores), advertencias }

    // Advertencias.
    const sinCapacidad = entrada.capacidad_bajada_kbps === null || entrada.capacidad_subida_kbps === null
    const todas: Array<{ e: Estrategia; donde: string; reuso: number | null }> = []
    for (const g of grupos) {
        for (const tipo of TIPOS_CONEXION) {
            todas.push({
                e: estrategiaEfectiva(entrada.estrategias, g.excepcion, tipo),
                donde: g.plan_id === null ? NOMBRE_TIPO[tipo] : `${NOMBRE_TIPO[tipo]} del plan ${g.plan_id}`,
                reuso: g.plan_id === null ? null : g.reuso,
            })
        }
    }
    const hayTecho = todas.some((x) => conNivelRouter(x.e))
    for (const { e, donde, reuso } of todas) {
        if (conNivelRouter(e) && sinCapacidad) {
            avisar(
                'sin_techo',
                'el router no tiene capacidad del enlace: el padre del router no limita (max-limit 0)',
            )
        }
        if (hayTecho && !conNivelRouter(e)) {
            avisar(
                'fuera_del_techo',
                `${donde} no cuelga del padre del router: ese tráfico no cuenta para el techo`,
            )
        }
        if (e.padre === 'ninguno' && (e.extras.prioridad || e.extras.garantizado)) {
            avisar(
                'sin_padre_prioridad',
                `${donde}: prioridad y garantizado solo reparten bajo un padre; con padre ninguno no tienen efecto`,
            )
        }
        if (conQos(e) && e.padre === 'ninguno') {
            avisar(
                'qos_sin_cuello',
                `${donde}: qos con padre ninguno: sin nodo del plan ni global que se llene, las clases nunca compiten`,
            )
        }
        if (!e.extras.excluir_fasttrack) {
            avisar(
                'fasttrack',
                `${donde}: sin verificar FastTrack; con FastTrack las colas no limitan el tráfico acelerado`,
            )
        }
        if ((e.tipo_cola === 'fq_codel' || e.tipo_cola === 'cake') && versionMayor(version) === null) {
            avisar(
                'version_desconocida',
                `${e.tipo_cola} necesita RouterOS 7 y no se conoce la versión del router: se verifica antes de escribir`,
            )
        }
        if (reuso === 1 && e.padre === 'por_plan' && familia(e.aplicacion) === 'simple') {
            avisar('reuso_dedicado', `${donde}: el plan es dedicado (reuso 1), no se crea cola padre`)
        }
    }
    for (const p of entrada.planes) {
        if (p.excepcion || p.reuso !== 1) continue
        if (
            TIPOS_CONEXION.some(
                (t) =>
                    entrada.estrategias[t].padre === 'por_plan' &&
                    familia(entrada.estrategias[t].aplicacion) === 'simple',
            )
        ) {
            avisar('reuso_dedicado', `plan ${p.plan_id}: dedicado (reuso 1), no se crea cola padre`)
        }
    }
    return { errores, advertencias }
}

function dedupe(errores: ProblemaEstrategia[]): ProblemaEstrategia[] {
    const vistos = new Set<string>()
    return errores.filter((e) => {
        const k = `${e.field}|${e.rule}|${e.message}`
        if (vistos.has(k)) return false
        vistos.add(k)
        return true
    })
}

/**
 * Matriz publicada (`GET /red/control-velocidad/matriz`, forma acordada con A4): la pantalla no copia
 * reglas. `reglas[].rule` es el mismo `rule` de los 422.
 */
export function matrizControlVelocidad() {
    return {
        aplicaciones: APLICACIONES.map((valor) => ({
            valor,
            familia: familia(valor),
            tipos_conexion: [...TIPOS_POR_APLICACION[valor]],
            tipos_cola: usaPcq(valor) ? (['pcq'] as TipoCola[]) : TIPOS_COLA.filter((t) => t !== 'pcq'),
            coa_en_vivo: velocidadPorCoa({ aplicacion: valor }),
        })),
        tipos_cola: TIPOS_COLA.map((valor) => ({
            valor,
            routeros_minimo: valor === 'fq_codel' || valor === 'cake' ? '7' : null,
        })),
        padres: PADRES.map((valor) => ({ valor })),
        extras: CAMPOS_EXTRAS.map((valor) => ({ valor, por_defecto: EXTRAS_POR_DEFECTO[valor] })),
        reglas: [
            {
                rule: 'aplicacion_tipo',
                mensaje:
                    'radius_rate_limit y perfil_ppp solo en PPPoE; cola_simple solo en IP estática y DHCP fija',
            },
            { rule: 'tipo_cola', mensaje: 'pcq_plan y arbol_pcq exigen pcq; las demás no aceptan pcq' },
            { rule: 'version', mensaje: 'fq_codel y cake solo con RouterOS 7' },
            {
                rule: 'familia_router',
                mensaje:
                    'por_router y jerarquico en una sola familia (colas simples o queue tree) en todo el router',
            },
            {
                rule: 'plan_consistente',
                mensaje:
                    'en un plan, los tipos que comparten la cola del plan usan el mismo padre y los mismos extras',
            },
            { rule: 'familia_plan', mensaje: 'un plan con por_plan o jerarquico no mezcla familias' },
            { rule: 'qos_familia', mensaje: 'qos (prioridad por clases) solo con arbol_pcq' },
            { rule: 'qos_fasttrack', mensaje: 'qos exige excluir_fasttrack' },
            {
                rule: 'qos_costo',
                mensaje: `como máximo ${QOS_MAX_HOJAS} hojas de QoS por router (planes con qos × 4 × clases)`,
            },
            {
                rule: 'pppoe_sin_radius',
                mensaje:
                    'en un router sin RADIUS (modo_seguridad api), PPPoE solo con perfil_ppp (cualquier padre) o arbol_pcq',
            },
        ],
        advertencias: [
            'sin_techo',
            'reuso_dedicado',
            'sin_padre_prioridad',
            'fasttrack',
            'version_desconocida',
            'fuera_del_techo',
            'qos_sin_cuello',
        ],
        atajos: {
            simple: estrategiasDeControl('simple'),
            arbol_pcq: estrategiasDeControl('arbol_pcq'),
        },
    }
}

/**
 * Estrategias de una fila de `network.routers`. Si `control_velocidad` no coincide con la derivada
 * (lo escribió código anterior a las capas, p. ej. el alta con `control_velocidad`), manda el
 * campo viejo con su estrategia equivalente.
 */
export function estrategiasDeFila(valor: unknown, control: ControlVelocidad): EstrategiasRouter {
    const leidas = leerEstrategias(valor, control)
    return controlDerivado(leidas) === control ? leidas : estrategiasDeControl(control)
}

/**
 * Copia de la estrategia con la que entró una sesión PPPoE (`network.sesiones.estrategia_velocidad`,
 * la escribe `insertarSesion`): la del router (`router`, con `control`) y la del plan (`plan`). La
 * sesión conserva lo que tenía hasta reconectar (`contratos/control-velocidad.md` §4).
 */
export interface CopiaEstrategia {
    router: unknown
    control: unknown
    plan: unknown
}

/** Estrategia PPPoE de una sesión según su copia; null si la sesión no la tiene (anterior a las capas). */
export function estrategiaDeCopia(copia: unknown): Estrategia | null {
    if (typeof copia !== 'object' || copia === null) return null
    const c = copia as Partial<CopiaEstrategia>
    const control: ControlVelocidad = c.control === 'arbol_pcq' ? 'arbol_pcq' : 'simple'
    return estrategiaEfectiva(estrategiasDeFila(c.router, control), leerExcepcion(c.plan), 'pppoe')
}
