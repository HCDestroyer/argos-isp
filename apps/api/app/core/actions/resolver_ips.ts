import { DomainAction, type Transaccion } from '#shared/domain_action'
import { permite, type Alcance } from '#core/acl'
import { resolverIps, type ResolucionIpDetalle } from '#network/consultas/ip'

export interface EntradaResolverIps {
    /** IPv4 o IPv6, de 1 a 500 (lo valida la ruta) */
    ips: string[]
}

export interface IpResuelta {
    ip: string
    servicio_id: number
    cliente_id: number
    prefijo: string
    cliente: { nombre: string; codigo: string; tipo: string }
    servicio: { user_ppp: string | null; plan: string; estado: string; router_id: number }
    empresa: { id: number; nombre: string; nit: string | null }
    /** ISO 8601: inicio de la sesión o asignación vigente que contiene la IP */
    desde: string
}

export interface IpNoEncontrada {
    ip: string
    error: 'no_encontrada'
}

export interface SalidaResolverIps {
    /** uno por IP pedida, en el mismo orden */
    resultados: Array<IpResuelta | IpNoEncontrada>
}

/**
 * Resuelve un lote de IPs a servicio, cliente y empresa (`POST /integraciones/horus/resolver`,
 * contrato Horus §2.1). Misma regla que `GET /ip/:ip` (prefijo más largo; sesión activa sobre
 * asignación), en una sola consulta.
 *
 * - Alcance: una IP de un servicio fuera del alcance del actor (router o zona del token o del rol,
 *   empresas del usuario) responde `no_encontrada`, igual que una IP de nadie: no revela que existe.
 * - Auditoría (contrato §0): es una lectura de datos personales hecha por el token, así que deja
 *   **una fila por llamada** en `audit.acciones` (`ip.resolver`) con las IPs pedidas y, en
 *   `entrada.auditoria`, cuántas resolvió y qué servicios y clientes devolvió.
 */
export default class ResolverIps extends DomainAction<EntradaResolverIps, SalidaResolverIps> {
    readonly nombre = 'ip.resolver'

    /** `alcance`: el de la petición (`ctx.alcance` del permiso `ip.resolver`); sin él, sin restricción. */
    constructor(private readonly alcance?: Alcance) {
        super()
    }

    protected async handle(input: EntradaResolverIps, t: Transaccion): Promise<SalidaResolverIps> {
        const filas = await resolverIps(input.ips, t.trx)
        const empresas = t.ctx.empresasPermitidas ?? null
        const visible = (fila: ResolucionIpDetalle) =>
            permite(this.alcance, { router: [fila.router_id], zona: [fila.zona_id] }) &&
            (empresas === null || empresas.includes(fila.empresa_id))

        const resultados = input.ips.map((ip, i): IpResuelta | IpNoEncontrada => {
            const fila = filas[i]
            if (!fila || !visible(fila)) return { ip, error: 'no_encontrada' }
            return {
                ip,
                servicio_id: fila.servicio_id,
                cliente_id: fila.cliente_id,
                prefijo: fila.prefijo,
                cliente: {
                    nombre: fila.cliente_nombre,
                    codigo: fila.cliente_codigo,
                    tipo: fila.cliente_tipo,
                },
                servicio: {
                    user_ppp: fila.user_ppp,
                    plan: fila.plan,
                    estado: fila.estado,
                    router_id: fila.router_id,
                },
                empresa: { id: fila.empresa_id, nombre: fila.empresa_nombre, nit: fila.empresa_nit },
                desde: new Date(fila.desde).toISOString(),
            }
        })

        const encontradas = resultados.filter((r): r is IpResuelta => !('error' in r))
        t.anotarAuditoria({
            cantidad: input.ips.length,
            encontradas: encontradas.length,
            servicios: [...new Set(encontradas.map((r) => r.servicio_id))],
            clientes: [...new Set(encontradas.map((r) => r.cliente_id))],
        })
        return { resultados }
    }
}
