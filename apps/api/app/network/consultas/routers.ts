import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado } from '#shared/errores'
import { paginar, type OpcionesPaginacion, type Pagina } from '#shared/paginacion'
import { filtrarPorAlcance, type Alcance } from '#core/acl'
import { filtrarPorEmpresa } from '#shared/empresa_activa'
import type { ControlVelocidad } from '#network/velocidad'
import { estrategiasDeFila, type EstrategiasRouter } from '#network/estrategia_velocidad'
import { sqlContactoRouter } from '#network/contacto_router'
import { sqlOcupacionRedV4, type Ocupacion } from '#network/ocupacion'
import { sinCampos } from '#network/consultas/ipv6'

/**
 * Lecturas de routers y redes IPv4. Las credenciales nunca salen: solo `tiene_api_password` y
 * `tiene_radius_secret`.
 */

export interface RouterVista {
    id: number
    nombre: string
    host: string
    api_usuario: string | null
    tiene_api_password: boolean
    tiene_radius_secret: boolean
    /** IP del NAS para RADIUS y CoA; null solo en un router sin RADIUS (`modo_seguridad = 'api'`) */
    nas_ip: string | null
    /** `radius`: PPPoE por RADIUS. `api`: router sin RADIUS, solo `ip_estatica`/`dhcp_fija` por la API REST */
    modo_seguridad: 'radius' | 'api'
    /** cola simple por servicio o árbol con PCQ por plan (`contratos/velocidad.md`) */
    control_velocidad: ControlVelocidad
    /** estrategia de control de velocidad por tipo de conexión (`contratos/control-velocidad.md`) */
    estrategia_velocidad: EstrategiasRouter
    /** versión de RouterOS leída del router (`/system/resource`); null = no se sabe */
    routeros_version: string | null
    /** techo del padre global; null = sin techo */
    capacidad_bajada_kbps: number | null
    capacidad_subida_kbps: number | null
    /** `https://host:puerto` de la API REST; null = `https://<host>` */
    api_url: string | null
    /** verificar el certificado TLS del router */
    api_tls_verificar: boolean
    /** hay una CA propia cargada (el PEM nunca sale por la API) */
    tiene_api_ca: boolean
    /** `server` del lease DHCP de `dhcp_fija`; null = `ROUTEROS_DHCP_SERVIDOR` (o `all`) */
    dhcp_servidor: string | null
    /** interfaz del ARP estático del amarre IP-MAC; null = `ROUTEROS_INTERFAZ_CLIENTES` */
    interfaz_clientes: string | null
    /** @deprecated derivado de `control_velocidad` (`arbol_pcq` → `pcq`) */
    modo_velocidad: 'simple' | 'pcq'
    /** empresa por defecto de los servicios nuevos (multiempresa) */
    empresa_sugerida_id: number | null
    /** perfil de QoS por clases (`contratos/qos.md`); null = el predeterminado */
    qos_perfil_id: number | null
    /** zona del router (opcional; no cambia el alcance del ACL) */
    zona_id: number | null
    /** ubicación `"lat,lng"` (`network.routers.coordenadas`); null = sin ubicar */
    coordenadas: string | null
    activo: boolean
    /** serial-number (RouterBOARD) o software-id (CHR) leído por el sondeo; null = no se conoce */
    serial: string | null
    /** router que lo absorbió con `routers.unir` (queda inactivo); null = no está unido */
    unido_a_id: number | null
    /** null = ninguna fuente periódica lo mide (`app/network/contacto_router.ts`) */
    en_linea: boolean | null
    /** última vez que respondió o mandó accounting; null = nunca */
    ultimo_contacto: string | null
    version: number
    created_at: string
    updated_at: string
}

export interface RedIpv4Vista {
    id: number
    router_id: number
    nombre: string | null
    cidr: string
    gateway: string | null
    tipo: 'estatico' | 'pool'
    rango_inicio: string | null
    rango_fin: string | null
    dns_primario: string | null
    dns_secundario: string | null
    ocupacion: Ocupacion
    version: number
    created_at: string
    updated_at: string
}

function columnasRouter() {
    const contacto = sqlContactoRouter()
    return [
        ...COLUMNAS_ROUTER,
        db.raw(`${contacto.enLinea} AS en_linea`),
        db.raw(`${contacto.ultimoContacto} AS ultimo_contacto`),
    ]
}

const COLUMNAS_ROUTER = [
    'id',
    'nombre',
    'host',
    'api_usuario',
    db.raw('(api_password IS NOT NULL) AS tiene_api_password'),
    db.raw('(radius_secret IS NOT NULL) AS tiene_radius_secret'),
    db.raw('host(nas_ip) AS nas_ip'),
    'modo_seguridad',
    'control_velocidad',
    'estrategia_velocidad',
    'routeros_version',
    'capacidad_bajada_kbps',
    'capacidad_subida_kbps',
    'api_url',
    'api_tls_verificar',
    db.raw('(api_ca IS NOT NULL) AS tiene_api_ca'),
    'dhcp_servidor',
    'interfaz_clientes',
    db.raw(`CASE control_velocidad WHEN 'arbol_pcq' THEN 'pcq' ELSE 'simple' END AS modo_velocidad`),
    'empresa_sugerida_id',
    'zona_id',
    'qos_perfil_id',
    'coordenadas',
    'activo',
    'serial',
    'unido_a_id',
    'version',
    'created_at',
    'updated_at',
]

/**
 * Multiempresa: un router es infraestructura compartida. Con `empresas` (filtro de
 * `empresasDeLaLista`) salen los routers sin empresa sugerida, los sugeridos para esas empresas y
 * los que tienen servicios de ellas. null = todos.
 */
export async function listarRouters(
    filtros: OpcionesPaginacion & { activo?: boolean },
    alcance?: Alcance,
    empresas: number[] | null = null,
): Promise<Pagina<RouterVista>> {
    const consulta = db.from('network.routers').select(columnasRouter())
    if (filtros.activo !== undefined) consulta.where('activo', filtros.activo)
    filtrarPorAlcance(consulta, alcance, { router: (q, ids) => q.whereIn('id', ids) })
    filtrarPorEmpresa(consulta, empresas, (q, ids) =>
        q.where((w) =>
            w
                .whereNull('network.routers.empresa_sugerida_id')
                .orWhereIn('network.routers.empresa_sugerida_id', ids)
                .orWhereExists((s) =>
                    s
                        .from('core.servicios as s_em')
                        .whereRaw('s_em.router_id = network.routers.id')
                        .whereIn('s_em.empresa_id', ids),
                ),
        ),
    )
    const pagina = await paginar<RouterVista>(consulta, filtros)
    return { ...pagina, data: pagina.data.map(conEstrategia) }
}

/** La estrategia de la vista con la misma regla que el dispatcher (`estrategiasDeFila`). */
function conEstrategia(fila: RouterVista): RouterVista {
    return {
        ...fila,
        estrategia_velocidad: estrategiasDeFila(fila.estrategia_velocidad, fila.control_velocidad),
    }
}

export async function verRouter(
    id: number,
    cliente: QueryClientContract = db.connection(),
): Promise<RouterVista> {
    const fila = (await cliente
        .from('network.routers')
        .where('id', id)
        .select(columnasRouter())
        .first()) as RouterVista | null
    if (!fila) throw new NoEncontrado(`El router ${id} no existe`)
    return conEstrategia(fila)
}

const COLUMNAS_RED = [
    'r.id',
    'r.router_id',
    'r.nombre',
    db.raw('r.cidr::text AS cidr'),
    db.raw('host(r.gateway) AS gateway'),
    'r.tipo',
    db.raw('host(r.rango_inicio) AS rango_inicio'),
    db.raw('host(r.rango_fin) AS rango_fin'),
    db.raw('host(r.dns_primario) AS dns_primario'),
    db.raw('host(r.dns_secundario) AS dns_secundario'),
    db.raw(`${sqlOcupacionRedV4('r')} AS ocupacion`),
    'r.version',
    'r.created_at',
    'r.updated_at',
]

export async function listarRedesIpv4(routerId: number): Promise<RedIpv4Vista[]> {
    await verRouter(routerId)
    return (await db
        .from('network.redes_ipv4 as r')
        .where('r.router_id', routerId)
        .orderBy('r.cidr')
        .select(COLUMNAS_RED)) as RedIpv4Vista[]
}

export async function verRedIpv4(id: number, cliente: QueryClientContract = db.connection()) {
    const fila = (await cliente
        .from('network.redes_ipv4 as r')
        .where('r.id', id)
        .select(COLUMNAS_RED)
        .first()) as RedIpv4Vista | null
    if (!fila) throw new NoEncontrado(`La red IPv4 ${id} no existe`)
    return fila
}

/** Campos de una red para `audit.cambios` (sin la ocupación, que es calculada). */
export function redParaAuditoria(red: RedIpv4Vista) {
    return sinCampos(red, ['ocupacion'])
}
