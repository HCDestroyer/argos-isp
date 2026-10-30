import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract, TransactionClientContract } from '@adonisjs/lucid/types/database'
import { Problema, type ErrorCampo } from '#shared/errores'
import { urlDeRouter } from '#network/routeros/router'

/**
 * Routers duplicados (pedido del PM, 29 oct; `contratos/routers.md`): el mismo MikroTik registrado
 * dos veces hace que el reconciliador de cada registro borre como huérfanos los objetos del otro,
 * que las sesiones se atribuyan a uno solo y que el panel no sepa cuál es el real.
 *
 * Dos routers son «el mismo equipo» si coinciden en alguna de estas claves:
 * - `api`: el extremo de la API REST (`host:puerto` de `api_url`, o de `https://<host>`);
 * - `nas_ip`: la dirección del NAS (además es UNIQUE en la base); un router sin RADIUS (`modo_seguridad
 *   = 'api'`) puede no tenerla, y entonces no choca por esta clave;
 * - `serial`: el número de serie o `software-id` que el sondeo leyó del equipo (si se conoce).
 */

export type MotivoDuplicado = 'api' | 'nas_ip' | 'serial'

interface FilaRouter {
    id: number
    nombre: string
    host: string
    api_url: string | null
    nas_ip: string | null
    serial: string | null
    activo: boolean
}

/** `host:puerto` normalizado de la API REST (minúsculas; puerto por defecto 443 o 80). */
export function extremoApi(router: { host: string; api_url: string | null }): string {
    const url = urlDeRouter(router).trim()
    try {
        const u = new URL(url)
        const puerto = u.port || (u.protocol === 'http:' ? '80' : '443')
        return `${u.hostname.toLowerCase()}:${puerto}`
    } catch {
        return url.toLowerCase()
    }
}

function serialNormalizado(serial: string | null | undefined): string | null {
    const s = serial?.trim().toLowerCase()
    return s ? s : null
}

function clavesDe(router: Pick<FilaRouter, 'host' | 'api_url' | 'nas_ip' | 'serial'>) {
    const claves: Array<{ motivo: MotivoDuplicado; valor: string }> = [
        { motivo: 'api', valor: extremoApi(router) },
    ]
    if (router.nas_ip) claves.push({ motivo: 'nas_ip', valor: router.nas_ip })
    const serial = serialNormalizado(router.serial)
    if (serial) claves.push({ motivo: 'serial', valor: serial })
    return claves
}

const COLUMNAS = [
    'id',
    'nombre',
    'host',
    'api_url',
    db.raw('host(nas_ip) AS nas_ip'),
    'serial',
    'activo',
] as const

function mensaje(motivo: MotivoDuplicado, otro: FilaRouter, valor: string): string {
    const quien = `«${otro.nombre}» (router ${otro.id}${otro.activo ? '' : ', desactivado'})`
    switch (motivo) {
        case 'api':
            return `Ya está registrado como ${quien}: misma dirección de la API (${valor})`
        case 'nas_ip':
            return `Ya está registrado como ${quien}: misma nas_ip (${valor})`
        case 'serial':
            return `Ya está registrado como ${quien}: mismo número de serie del equipo (${otro.serial})`
    }
}

/**
 * 409 `router_duplicado` si el router (nuevo o editado) coincide con otro router activo en alguna
 * de las claves pedidas en `revisar`. La `nas_ip` se compara también contra los desactivados (es
 * UNIQUE en la base). `errors[]` lleva una entrada por choque, con el nombre y el id del otro.
 * Serializa las altas y ediciones con un lock de transacción para que dos altas simultáneas del
 * mismo equipo no pasen las dos.
 */
export async function exigirRouterUnico(
    trx: TransactionClientContract,
    router: {
        id?: number
        host: string
        api_url: string | null
        nas_ip: string | null
        serial: string | null
    },
    revisar: Record<MotivoDuplicado, boolean>,
): Promise<void> {
    if (!revisar.api && !revisar.nas_ip && !revisar.serial) return
    await trx.rawQuery(`SELECT pg_advisory_xact_lock(hashtext('network:routers:unicidad'))`)
    const consulta = trx.from('network.routers').select(...COLUMNAS)
    if (router.id !== undefined) consulta.whereNot('id', router.id)
    const otros = (await consulta.orderBy('id')) as FilaRouter[]

    const errores: ErrorCampo[] = []
    let primero: FilaRouter | null = null
    const propias = clavesDe(router)
    for (const otro of otros) {
        const ajenas = clavesDe(otro)
        for (const clave of propias) {
            if (!revisar[clave.motivo]) continue
            // fuera de la nas_ip (UNIQUE), un router desactivado no choca: ya no se usa
            if (clave.motivo !== 'nas_ip' && !otro.activo) continue
            if (!ajenas.some((a) => a.motivo === clave.motivo && a.valor === clave.valor)) continue
            primero ??= otro
            errores.push({
                field: clave.motivo === 'api' ? (router.api_url ? 'api_url' : 'host') : clave.motivo,
                rule: 'router_duplicado',
                message: mensaje(clave.motivo, otro, clave.valor),
            })
        }
    }
    if (primero) {
        throw new Problema(
            409,
            'router_duplicado',
            'Router duplicado',
            `Ese MikroTik ya está registrado como «${primero.nombre}». Para usar dos formas de control ` +
                'de velocidad en el mismo router, configúralas por plan en su ficha.',
            errores,
        )
    }
}

export interface ServicioDeDuplicado {
    id: number
    cliente_id: number
    user_ppp: string | null
    estado: string
    tipo_conexion: string
}

export interface RouterDeDuplicado {
    id: number
    nombre: string
    host: string
    api_url: string | null
    nas_ip: string | null
    serial: string | null
    control_velocidad: string
    /** servicios no retirados del router */
    servicios_total: number
    /** sesiones PPPoE abiertas atribuidas al router */
    sesiones_abiertas: number
    /** los primeros `MAXIMO_SERVICIOS` servicios no retirados (por id) */
    servicios: ServicioDeDuplicado[]
    version: number
}

export interface GrupoDuplicados {
    /** por qué parecen el mismo equipo (al menos una clave compartida entre dos de ellos) */
    motivos: MotivoDuplicado[]
    /** los valores compartidos: `api` → `host:puerto`, `serial`, `nas_ip` */
    claves: Array<{ motivo: MotivoDuplicado; valor: string }>
    routers: RouterDeDuplicado[]
}

export const MAXIMO_SERVICIOS = 50

/**
 * Grupos de routers activos que parecen el mismo equipo (`GET /routers/duplicados`). Un grupo es la
 * clausura de las claves compartidas: si A y B comparten la API y B y C el serial, A, B y C son un
 * grupo. Con `routerId`, solo el grupo de ese router (la ficha muestra el aviso). Con `routers`
 * (alcance del ACL), solo los grupos con algún router visible, y solo los routers visibles.
 */
export async function gruposDuplicados(
    opciones: { routerId?: number; routers?: number[] | null } = {},
    cliente: QueryClientContract = db.connection(),
): Promise<GrupoDuplicados[]> {
    const filas = (await cliente
        .from('network.routers')
        .where('activo', true)
        .select(...COLUMNAS)
        .orderBy('id')) as FilaRouter[]

    const padre = new Map<number, number>(filas.map((f) => [f.id, f.id]))
    const raiz = (id: number): number => {
        let r = id
        while (padre.get(r) !== r) r = padre.get(r)!
        padre.set(id, r)
        return r
    }
    const porClave = new Map<string, { motivo: MotivoDuplicado; valor: string; ids: number[] }>()
    for (const fila of filas) {
        for (const clave of clavesDe(fila)) {
            const k = `${clave.motivo}|${clave.valor}`
            const grupo = porClave.get(k) ?? { ...clave, ids: [] }
            grupo.ids.push(fila.id)
            porClave.set(k, grupo)
        }
    }
    for (const { ids } of porClave.values()) {
        for (const id of ids.slice(1)) {
            const a = raiz(ids[0]!)
            const b = raiz(id)
            if (a !== b) padre.set(Math.max(a, b), Math.min(a, b))
        }
    }
    const grupos = new Map<number, number[]>()
    for (const fila of filas) {
        const r = raiz(fila.id)
        grupos.set(r, [...(grupos.get(r) ?? []), fila.id])
    }

    const visibles = opciones.routers ? new Set(opciones.routers) : null
    const resultado: GrupoDuplicados[] = []
    for (const ids of grupos.values()) {
        if (ids.length < 2) continue
        if (opciones.routerId !== undefined && !ids.includes(opciones.routerId)) continue
        const mostrados = visibles ? ids.filter((id) => visibles.has(id)) : ids
        if (mostrados.length === 0) continue
        const claves = [...porClave.values()]
            .filter((c) => c.ids.length > 1 && c.ids.some((id) => ids.includes(id)))
            .map(({ motivo, valor }) => ({ motivo, valor }))
        resultado.push({
            motivos: [...new Set(claves.map((c) => c.motivo))].sort(),
            claves,
            routers: await Promise.all(mostrados.map((id) => routerDeDuplicado(id, cliente))),
        })
    }
    return resultado
}

async function routerDeDuplicado(id: number, cliente: QueryClientContract): Promise<RouterDeDuplicado> {
    const r = (await cliente
        .from('network.routers')
        .where('id', id)
        .select(...COLUMNAS, 'control_velocidad', 'version')
        .firstOrFail()) as FilaRouter & { control_velocidad: string; version: number }
    const servicios = (await cliente
        .from('core.servicios')
        .where('router_id', id)
        .whereNot('estado', 'retirado')
        .orderBy('id')
        .limit(MAXIMO_SERVICIOS)
        .select('id', 'cliente_id', 'user_ppp', 'estado', 'tipo_conexion')) as ServicioDeDuplicado[]
    const [conteo] = (await cliente
        .from('core.servicios')
        .where('router_id', id)
        .whereNot('estado', 'retirado')
        .count('* as total')) as Array<{ total: string | number }>
    const [sesiones] = (await cliente
        .from('network.sesiones')
        .where('router_id', id)
        .whereNull('fin')
        .count('* as total')) as Array<{ total: string | number }>
    return {
        id: Number(r.id),
        nombre: r.nombre,
        host: r.host,
        api_url: r.api_url,
        nas_ip: r.nas_ip,
        serial: r.serial,
        control_velocidad: r.control_velocidad,
        servicios_total: Number(conteo?.total ?? 0),
        sesiones_abiertas: Number(sesiones?.total ?? 0),
        servicios: servicios.map((s) => ({ ...s, id: Number(s.id), cliente_id: Number(s.cliente_id) })),
        version: r.version,
    }
}

/** Claves que comparten dos routers (para la simulación de `routers.unir`). */
export function clavesCompartidas(
    a: Pick<FilaRouter, 'host' | 'api_url' | 'nas_ip' | 'serial'>,
    b: Pick<FilaRouter, 'host' | 'api_url' | 'nas_ip' | 'serial'>,
): MotivoDuplicado[] {
    const ajenas = clavesDe(b)
    return clavesDe(a)
        .filter((c) => ajenas.some((o) => o.motivo === c.motivo && o.valor === c.valor))
        .map((c) => c.motivo)
}
