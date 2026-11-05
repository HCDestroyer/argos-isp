import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado } from '#shared/errores'
import { sinCampos } from '#network/consultas/ipv6'
import { sqlHostGatewayEfectivo } from '#network/red_acceso/local_address'
import { paginar, type OpcionesPaginacion, type Pagina } from '#shared/paginacion'
import { filtrarPorEmpresa } from '#shared/empresa_activa'

/**
 * Lecturas de la red de acceso (`contratos/red-acceso.md`): OLT, puertos PON, VLAN y servidores
 * PPPoE. Lo calculado (`local_address`, `perfil`, `comment`, conteos) sale aquí y no se guarda.
 */

export type EstadoRedAcceso = 'administrado' | 'adoptado'

export interface PuertoPonVista {
    id: number
    olt_id: number
    identificador: string
    descripcion: string | null
    vlans: number
    version: number
    created_at: string
    updated_at: string
}

export interface OltVista {
    id: number
    nombre: string
    marca: string | null
    modelo: string | null
    empresa_id: number | null
    descripcion: string | null
    activo: boolean
    puertos: PuertoPonVista[]
    version: number
    created_at: string
    updated_at: string
}

export interface VlanVista {
    id: number
    router_id: number
    empresa_id: number | null
    interfaz_padre: string
    vlan_id: number
    nombre: string
    puerto_pon_id: number | null
    puerto_pon: { id: number; identificador: string; olt_id: number; olt_nombre: string } | null
    mtu: number | null
    estado: EstadoRedAcceso
    ros_id: string | null
    comment: string | null
    descripcion: string | null
    version: number
    created_at: string
    updated_at: string
}

export interface ServidorPppoeVista {
    id: number
    router_id: number
    empresa_id: number | null
    nombre: string
    vlan_id: number | null
    vlan: { id: number; nombre: string; vlan_id: number } | null
    interfaz: string
    service_name: string
    red_ipv4_id: number | null
    ipv6_pool_enlace_id: number | null
    ipv6_pool_delegacion_id: number | null
    perfil_base: string
    perfil: string | null
    local_address: string | null
    /** true = su red no tiene gateway: el local-address es la primera IP utilizable */
    local_address_derivado: boolean
    max_mtu: number
    max_mru: number
    mrru: number | null
    autenticacion: string[]
    keepalive_timeout: number
    una_sesion_por_host: boolean
    max_sesiones: number | null
    estado: EstadoRedAcceso
    ros_id: string | null
    comment: string | null
    activo: boolean
    servicios: number
    descripcion: string | null
    version: number
    created_at: string
    updated_at: string
}

/** Comment que Argos pone en RouterOS a lo administrado (A2 lo escribe y lo busca por él). */
export const commentVlan = (id: number) => `argosisp:vlan:${id}`
export const commentServidor = (id: number) => `argosisp:pppoe:${id}`
/** Perfil PPP propio de un servidor administrado (lleva el `local-address` = gateway de su red). */
export const perfilServidor = (id: number) => `argosisp-pppoe-${id}`

/** Lo compartido (empresa null) y lo de las empresas de la lista; `null` = sin filtro. */
function filtroEmpresa<Q extends { where: (...a: any[]) => Q }>(
    q: Q,
    columna: string,
    empresas: number[] | null,
) {
    return filtrarPorEmpresa(q, empresas, (c, ids) =>
        c.where((w: any) => w.whereNull(columna).orWhereIn(columna, ids)),
    )
}

/*
|--------------------------------------------------------------------------
| OLT y puertos PON
|--------------------------------------------------------------------------
*/

const COLUMNAS_PUERTO = [
    'pp.id',
    'pp.olt_id',
    'pp.identificador',
    'pp.descripcion',
    db.raw('(SELECT count(*)::int FROM network.vlans v WHERE v.puerto_pon_id = pp.id) AS vlans'),
    'pp.version',
    'pp.created_at',
    'pp.updated_at',
]

const enteros = <T>(fila: T, campos: Array<keyof T>): T => {
    for (const campo of campos) {
        const valor = fila[campo]
        if (valor !== null && valor !== undefined) (fila as Record<keyof T, unknown>)[campo] = Number(valor)
    }
    return fila
}

function puertoDeFila(fila: PuertoPonVista): PuertoPonVista {
    return enteros(fila, ['id', 'olt_id', 'vlans'])
}

export async function puertosDeOlt(oltId: number, cliente: QueryClientContract = db.connection()) {
    const filas = (await cliente
        .from('network.olt_puertos_pon as pp')
        .where('pp.olt_id', oltId)
        .orderBy('pp.identificador')
        .select(COLUMNAS_PUERTO)) as PuertoPonVista[]
    return filas.map(puertoDeFila)
}

export async function verPuertoPon(id: number, cliente: QueryClientContract = db.connection()) {
    const fila = (await cliente
        .from('network.olt_puertos_pon as pp')
        .where('pp.id', id)
        .select(COLUMNAS_PUERTO)
        .first()) as PuertoPonVista | null
    if (!fila) throw new NoEncontrado(`El puerto PON ${id} no existe`)
    return puertoDeFila(fila)
}

const COLUMNAS_OLT = [
    'id',
    'nombre',
    'marca',
    'modelo',
    'empresa_id',
    'descripcion',
    'activo',
    'version',
    'created_at',
    'updated_at',
]

export async function verOlt(id: number, cliente: QueryClientContract = db.connection()): Promise<OltVista> {
    const fila = (await cliente.from('network.olts').where('id', id).select(COLUMNAS_OLT).first()) as
        (Omit<OltVista, 'puertos'> & { puertos?: PuertoPonVista[] }) | null
    if (!fila) throw new NoEncontrado(`La OLT ${id} no existe`)
    return { ...enteros(fila, ['id', 'empresa_id']), puertos: await puertosDeOlt(id, cliente) } as OltVista
}

export async function listarOlts(
    filtros: OpcionesPaginacion & { activo?: boolean },
    empresas: number[] | null,
): Promise<Pagina<OltVista>> {
    const consulta = db.from('network.olts').select(COLUMNAS_OLT)
    if (filtros.activo !== undefined) consulta.where('activo', filtros.activo)
    filtroEmpresa(consulta, 'empresa_id', empresas)
    const pagina = await paginar<Omit<OltVista, 'puertos'>>(consulta, filtros)
    const data: OltVista[] = []
    for (const fila of pagina.data) {
        data.push({
            ...enteros(fila, ['id', 'empresa_id']),
            puertos: await puertosDeOlt(Number(fila.id)),
        })
    }
    return { data, nextCursor: pagina.nextCursor }
}

/** Fila de la OLT para `audit.cambios` (sin los puertos, que se auditan aparte). */
export function oltParaAuditoria(olt: OltVista) {
    return sinCampos(olt, ['puertos'])
}

export function puertoParaAuditoria(puerto: PuertoPonVista) {
    return sinCampos(puerto, ['vlans'])
}

/*
|--------------------------------------------------------------------------
| VLAN
|--------------------------------------------------------------------------
*/

function consultaVlans(cliente: QueryClientContract) {
    return cliente
        .from('network.vlans as v')
        .leftJoin('network.olt_puertos_pon as pp', 'pp.id', 'v.puerto_pon_id')
        .leftJoin('network.olts as o', 'o.id', 'pp.olt_id')
        .select(
            'v.id',
            'v.router_id',
            'v.empresa_id',
            'v.interfaz_padre',
            'v.vlan_id',
            'v.nombre',
            'v.puerto_pon_id',
            'pp.identificador as pp_identificador',
            'pp.olt_id as pp_olt_id',
            'o.nombre as pp_olt_nombre',
            'v.mtu',
            'v.estado',
            'v.ros_id',
            'v.descripcion',
            'v.version',
            'v.created_at',
            'v.updated_at',
        )
}

type FilaVlan = Omit<VlanVista, 'puerto_pon' | 'comment'> & {
    pp_identificador: string | null
    pp_olt_id: number | null
    pp_olt_nombre: string | null
}

function vlanDeFila(f: FilaVlan): VlanVista {
    const { pp_identificador: identificador, pp_olt_id: oltId, pp_olt_nombre: oltNombre, ...resto } = f
    const vlan = enteros(resto, ['id', 'router_id', 'empresa_id', 'vlan_id', 'puerto_pon_id', 'mtu'])
    return {
        ...vlan,
        puerto_pon:
            vlan.puerto_pon_id !== null
                ? {
                      id: vlan.puerto_pon_id,
                      identificador: identificador!,
                      olt_id: Number(oltId),
                      olt_nombre: oltNombre!,
                  }
                : null,
        comment: vlan.estado === 'administrado' ? commentVlan(vlan.id) : null,
    }
}

export async function verVlan(
    id: number,
    cliente: QueryClientContract = db.connection(),
): Promise<VlanVista> {
    const fila = (await consultaVlans(cliente).where('v.id', id).first()) as FilaVlan | null
    if (!fila) throw new NoEncontrado(`La VLAN ${id} no existe`)
    return vlanDeFila(fila)
}

export async function listarVlans(
    routerId: number,
    filtros: { olt_id?: number; puerto_pon_id?: number },
    empresas: number[] | null,
    cliente: QueryClientContract = db.connection(),
): Promise<VlanVista[]> {
    const consulta = consultaVlans(cliente).where('v.router_id', routerId)
    if (filtros.puerto_pon_id) consulta.where('v.puerto_pon_id', filtros.puerto_pon_id)
    if (filtros.olt_id) consulta.where('pp.olt_id', filtros.olt_id)
    filtroEmpresa(consulta, 'v.empresa_id', empresas)
    const filas = (await consulta.orderBy('v.interfaz_padre').orderBy('v.vlan_id')) as FilaVlan[]
    return filas.map(vlanDeFila)
}

export function vlanParaAuditoria(vlan: VlanVista) {
    return sinCampos(vlan, ['puerto_pon', 'comment'])
}

/*
|--------------------------------------------------------------------------
| Servidores PPPoE
|--------------------------------------------------------------------------
*/

function consultaServidores(cliente: QueryClientContract) {
    return cliente
        .from('network.servidores_pppoe as s')
        .leftJoin('network.vlans as v', 'v.id', 's.vlan_id')
        .leftJoin('network.redes_ipv4 as r', 'r.id', 's.red_ipv4_id')
        .select(
            's.id',
            's.router_id',
            's.empresa_id',
            's.nombre',
            's.vlan_id',
            'v.nombre as v_nombre',
            'v.vlan_id as v_vlan_id',
            's.interfaz',
            's.service_name',
            's.red_ipv4_id',
            's.ipv6_pool_enlace_id',
            's.ipv6_pool_delegacion_id',
            's.perfil_base',
            's.perfil_router',
            cliente.raw(
                `CASE WHEN r.id IS NULL THEN NULL ELSE ${sqlHostGatewayEfectivo('r')} END AS local_address`,
            ),
            cliente.raw('(r.id IS NOT NULL AND r.gateway IS NULL) AS local_address_derivado'),
            's.max_mtu',
            's.max_mru',
            's.mrru',
            's.autenticacion',
            's.keepalive_timeout',
            's.una_sesion_por_host',
            's.max_sesiones',
            's.estado',
            's.ros_id',
            's.activo',
            cliente.raw(
                `(SELECT count(*)::int FROM core.servicios x WHERE x.servidor_pppoe_id = s.id AND x.estado <> 'retirado') AS servicios`,
            ),
            's.descripcion',
            's.version',
            's.created_at',
            's.updated_at',
        )
}

type FilaServidor = Omit<ServidorPppoeVista, 'vlan' | 'perfil' | 'comment'> & {
    v_nombre: string | null
    v_vlan_id: number | null
    perfil_router: string | null
}

function servidorDeFila(f: FilaServidor): ServidorPppoeVista {
    const { v_nombre: vNombre, v_vlan_id: vVlanId, perfil_router: perfilRouter, ...resto } = f
    const s = enteros(resto, [
        'id',
        'router_id',
        'empresa_id',
        'vlan_id',
        'red_ipv4_id',
        'ipv6_pool_enlace_id',
        'ipv6_pool_delegacion_id',
        'max_mtu',
        'max_mru',
        'mrru',
        'keepalive_timeout',
        'max_sesiones',
        'servicios',
    ])
    const administrado = s.estado === 'administrado'
    return {
        ...s,
        autenticacion: leerArreglo(s.autenticacion),
        vlan: s.vlan_id !== null ? { id: s.vlan_id, nombre: vNombre!, vlan_id: Number(vVlanId) } : null,
        perfil: administrado ? perfilServidor(s.id) : perfilRouter,
        comment: administrado ? commentServidor(s.id) : null,
    }
}

/** `text[]` llega como arreglo con pg, o como literal `{a,b}` en algunos drivers. */
function leerArreglo(valor: unknown): string[] {
    if (Array.isArray(valor)) return valor.map(String)
    if (typeof valor === 'string') {
        return valor
            .replace(/^\{|\}$/g, '')
            .split(',')
            .filter(Boolean)
    }
    return []
}

export async function verServidorPppoe(
    id: number,
    cliente: QueryClientContract = db.connection(),
): Promise<ServidorPppoeVista> {
    const fila = (await consultaServidores(cliente).where('s.id', id).first()) as FilaServidor | null
    if (!fila) throw new NoEncontrado(`El servidor PPPoE ${id} no existe`)
    return servidorDeFila(fila)
}

export async function listarServidoresPppoe(
    routerId: number,
    empresas: number[] | null,
    cliente: QueryClientContract = db.connection(),
): Promise<ServidorPppoeVista[]> {
    const consulta = consultaServidores(cliente).where('s.router_id', routerId)
    filtroEmpresa(consulta, 's.empresa_id', empresas)
    const filas = (await consulta.orderBy('s.interfaz')) as FilaServidor[]
    return filas.map(servidorDeFila)
}

export function servidorParaAuditoria(s: ServidorPppoeVista) {
    return sinCampos(s, ['vlan', 'perfil', 'comment', 'servicios', 'local_address', 'local_address_derivado'])
}

/*
|--------------------------------------------------------------------------
| Árbol del router (pestaña «Red de acceso»)
|--------------------------------------------------------------------------
*/

export interface RedAccesoRouter {
    router_id: number
    vlans: VlanVista[]
    servidores_pppoe: ServidorPppoeVista[]
    olts: Array<{ id: number; nombre: string; puertos: Array<{ id: number; identificador: string }> }>
    servicios_sin_servidor: number
}

export async function redAccesoRouter(routerId: number, empresas: number[] | null): Promise<RedAccesoRouter> {
    const vlans = await listarVlans(routerId, {}, empresas)
    const servidores = await listarServidoresPppoe(routerId, empresas)
    const olts = new Map<number, RedAccesoRouter['olts'][number]>()
    for (const vlan of vlans) {
        if (!vlan.puerto_pon) continue
        const olt = olts.get(vlan.puerto_pon.olt_id) ?? {
            id: vlan.puerto_pon.olt_id,
            nombre: vlan.puerto_pon.olt_nombre,
            puertos: [],
        }
        if (!olt.puertos.some((p) => p.id === vlan.puerto_pon!.id)) {
            olt.puertos.push({ id: vlan.puerto_pon.id, identificador: vlan.puerto_pon.identificador })
        }
        olts.set(olt.id, olt)
    }
    const [sin] = (await db
        .from('core.servicios')
        .where('router_id', routerId)
        .where('tipo_conexion', 'pppoe')
        .whereNot('estado', 'retirado')
        .whereNull('servidor_pppoe_id')
        .count('* as total')) as Array<{ total: string | number }>
    return {
        router_id: routerId,
        vlans,
        servidores_pppoe: servidores,
        olts: [...olts.values()],
        servicios_sin_servidor: Number(sin?.total ?? 0),
    }
}
