import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado, ReglaNegocio } from '#shared/errores'
import { routerDispatcher } from '#network/routeros/consultas'
import type { Cambio, FabricaClientes, OpcionesDispatcher } from '#network/routeros/dispatcher'
import AplicarRedServicio from '#network/routeros/actions/aplicar_red_servicio'
import { diagnosticarErrorRouterOS, type MotivoApi } from '#network/diagnostico_routeros'

export interface ResultadoSincronizar {
    servicio_id: number
    router_id: number
    /** lo que se corrigió en el router (y en un router anterior, si quedaba algo del servicio) */
    cambios: Array<Cambio & { router_id: number }>
    /** nada que corregir y el router respondió */
    ya_estaba_bien: boolean
    avisos: string[]
    /** el router no respondió o rechazó un comando (en lenguaje simple); null si todo bien */
    error: { motivo: MotivoApi; detalle: string } | null
}

/** Clave del candado por servicio (distinta de `LOCK_ROUTEROS`, que es por router). */
const LOCK_SINCRONIZAR = 4104

/**
 * `servicios.sincronizar_router` (pedido del PM, 29 oct): aplica ya el estado deseado de un servicio en
 * su MikroTik con `routeros.aplicar_servicio` (anidada: cola, address-list `suspendidos`, lease DHCP,
 * ARP del amarre y, si el router lo necesita, el control de velocidad) y devuelve qué corrigió.
 *
 * - 422 `servicio_pendiente_instalacion`: un pendiente no tiene nada en el router hasta activarse.
 * - 422 `router_sin_api` si el router está inactivo o no tiene usuario y clave de la API REST.
 * - Candado por servicio (`pg_advisory_xact_lock`) además del candado por router de `aplicar_servicio`;
 *   es idempotente: repetirla con todo bien no escribe nada (`ya_estaba_bien`).
 * - Cada comando enviado queda en `audit.red` (lo hace `aplicar_servicio`). Si el router no responde,
 *   no lanza: devuelve `error` con `motivo` y `detalle` (`diagnostico_routeros.ts`) y queda
 *   `routeros.fallido` como en cualquier aplicación.
 */
export default class SincronizarRouterServicio extends DomainAction<
    { servicio_id: number },
    ResultadoSincronizar
> {
    readonly nombre = 'servicios.sincronizar_router'
    readonly #opciones: OpcionesDispatcher

    constructor(opciones: { clientes?: FabricaClientes } = {}) {
        super()
        this.#opciones = opciones
    }

    protected async handle(input: { servicio_id: number }, t: Transaccion): Promise<ResultadoSincronizar> {
        const servicioId = input.servicio_id
        t.fijarEntidad('servicio', servicioId)
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?)', [LOCK_SINCRONIZAR, servicioId])
        const servicio = (await t.trx
            .from('core.servicios')
            .where('id', servicioId)
            .select('id', 'estado', 'router_id', 'empresa_id')
            .first()) as { id: number; estado: string; router_id: number; empresa_id: number } | null
        if (!servicio) throw new NoEncontrado(`El servicio ${servicioId} no existe`)
        t.fijarEmpresa(servicio.empresa_id)
        if (servicio.estado === 'pendiente_instalacion') {
            throw new ReglaNegocio(
                'El servicio está pendiente de instalación: no tiene nada en el router hasta que se active la ' +
                    'instalación (Activar instalación crea su configuración en el router)',
                'servicio_pendiente_instalacion',
            )
        }
        const router = await routerDispatcher(Number(servicio.router_id), t.trx)
        if (!router || !router.activo || !router.con_credenciales) {
            throw new ReglaNegocio(
                !router || !router.activo
                    ? 'El router del servicio está inactivo: Argos no le envía comandos. Actívalo en su ficha'
                    : `Argos no controla el router ${router.nombre} por la API: le falta el usuario y la clave de la ` +
                          'API REST. Cárgalos en la ficha del router o genera su script de conexión',
                'router_sin_api',
            )
        }

        const aplicado = await new AplicarRedServicio(this.#opciones).execute(
            { servicio_id: servicioId },
            t.ctx,
            {
                trx: t.trx,
            },
        )
        const cambios = aplicado.routers.flatMap((r) =>
            r.cambios.map((c) => ({ ...c, router_id: r.router_id })),
        )
        const fallo = aplicado.routers.find((r) => r.error !== null)
        const error = fallo
            ? (({ motivo, detalle }) => ({ motivo, detalle }))(
                  diagnosticarErrorRouterOS({ message: fallo.error! }),
              )
            : null
        return {
            servicio_id: servicioId,
            router_id: Number(servicio.router_id),
            cambios,
            ya_estaba_bien: cambios.length === 0 && error === null,
            avisos: aplicado.routers.flatMap((r) => [...r.avisos, ...r.errores_velocidad]),
            error,
        }
    }
}
