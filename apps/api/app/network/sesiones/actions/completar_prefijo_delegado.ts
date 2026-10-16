import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ErrorRouterOS } from '#network/routeros/errores'
import { RouterSinCredenciales } from '#network/routeros/router'
import { routerDispatcher } from '#network/routeros/consultas'
import { fabricaPorDefecto, type OpcionesDispatcher } from '#network/routeros/dispatcher'

/** Identidad de la sesión, como viaja en `sesion.iniciada`. */
export interface EntradaCompletarPrefijo {
    nas_ip: string
    acct_session_id: string
}

export interface ResultadoCompletarPrefijo {
    sesion_id: number | null
    /**
     * `completado`: se guardó el /56 (o /48) que entregó el router. `no_aplica`: la sesión ya terminó,
     * ya tiene prefijo o su servicio no está en `radius_pool`. `sin_binding`: el router todavía no lo
     * delegó (DHCPv6-PD llega unos segundos después del Start). `error`: el router no respondió.
     */
    estado: 'completado' | 'no_aplica' | 'sin_binding' | 'error'
    prefijo: string | null
    error: string | null
}

/**
 * Modo `radius_pool` de IPv6 (semana 2): `aaa` entrega `Framed-IPv6-Pool` y el pool de delegación,
 * y el router elige el prefijo. RouterOS 7.24.5 manda el /64 (`Framed-IPv6-Prefix`) en el
 * accounting pero no el delegado (`Delegated-IPv6-Prefix`), así que se lee de la API REST del router:
 * `/ipv6/dhcp-server/binding` con `server = <pppoe-<user_ppp>>` (el servidor DHCPv6 dinámico de la
 * sesión PPPoE). Si el NAS sí lo reporta en un Interim-Update o en el Stop, el accounting lo guarda
 * igual (`actualizarSesionAbierta`).
 *
 * Solo lectura en el router (no va a `audit.red`). Audita solo cuando guardó el prefijo; los
 * intentos sin binding los reintenta el job (`routeros-prefijos`) y no dejan fila.
 */
export default class CompletarPrefijoDelegado extends DomainAction<
    EntradaCompletarPrefijo,
    ResultadoCompletarPrefijo
> {
    readonly nombre = 'sesiones.completar_prefijo'
    readonly #opciones: OpcionesDispatcher

    constructor(opciones: OpcionesDispatcher = {}) {
        super()
        this.#opciones = opciones
    }

    protected auditarExito(salida: ResultadoCompletarPrefijo): boolean {
        return salida.estado === 'completado'
    }

    protected async handle(
        input: EntradaCompletarPrefijo,
        t: Transaccion,
    ): Promise<ResultadoCompletarPrefijo> {
        const salida: ResultadoCompletarPrefijo = {
            sesion_id: null,
            estado: 'no_aplica',
            prefijo: null,
            error: null,
        }
        const sesion = (await t.trx
            .from('network.sesiones as ses')
            .join('core.servicios as s', 's.id', 'ses.servicio_id')
            .whereRaw('ses.nas_ip = ?::inet', [input.nas_ip])
            .where('ses.acct_session_id', input.acct_session_id)
            .whereNull('ses.fin')
            .whereNull('ses.prefijo_delegado_v6')
            .where('s.ipv6_modo', 'radius_pool')
            .whereNotNull('ses.router_id')
            .select('ses.id', 'ses.user_ppp', 'ses.router_id')
            .forUpdate()
            .first()) as { id: number; user_ppp: string; router_id: number } | null
        if (!sesion) return salida
        t.fijarEntidad('sesion', Number(sesion.id))
        salida.sesion_id = Number(sesion.id)

        const router = await routerDispatcher(Number(sesion.router_id), t.trx, this.#opciones.red)
        if (!router) return salida
        let prefijo: string | null = null
        try {
            const cliente = (this.#opciones.clientes ?? fabricaPorDefecto)(router.api)
            try {
                const bindings = await cliente.listar('/ipv6/dhcp-server/binding', {
                    server: `<pppoe-${sesion.user_ppp}>`,
                })
                prefijo =
                    bindings
                        .map((b) => b.address)
                        .find(
                            (a): a is string => typeof a === 'string' && a.includes(':') && a.includes('/'),
                        ) ?? null
            } finally {
                cliente.cerrar()
            }
        } catch (error) {
            if (!(error instanceof ErrorRouterOS) && !(error instanceof RouterSinCredenciales)) throw error
            return { ...salida, estado: 'error', error: error.message }
        }
        if (!prefijo) return { ...salida, estado: 'sin_binding' }

        await t.trx.rawQuery(
            `UPDATE network.sesiones SET prefijo_delegado_v6 = network(?::inet)::cidr, updated_at = now() WHERE id = ?`,
            [prefijo, sesion.id],
        )
        await t.registrarCambios(
            { tipo: 'sesion', id: sesion.id },
            { prefijo_delegado_v6: null },
            { prefijo_delegado_v6: prefijo },
        )
        return { ...salida, estado: 'completado', prefijo }
    }
}
