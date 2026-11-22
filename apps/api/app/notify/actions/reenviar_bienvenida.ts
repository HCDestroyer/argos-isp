import { randomUUID } from 'node:crypto'
import { DateTime } from 'luxon'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, NoEncontrado } from '#shared/errores'
import { LimiteExcedido } from '#core/limite_ventana'
import { ZONA } from '#notify/formato'
import {
    ESPERA_REENVIO_S,
    REENVIOS_POR_DIA,
    registrarBienvenida,
    type CanalBienvenida,
} from '#notify/bienvenida'

export interface EntradaReenviarBienvenida {
    servicio_id: number
    origen_tipo?: 'iris_orden' | null
    origen_id?: string | null
    /** sin él, todos los canales que Argos tenga configurados */
    canales?: CanalBienvenida[] | null
}

export interface SalidaReenviarBienvenida {
    estado: 'en_cola'
    bienvenida_id: number
}

/**
 * `servicios.reenviar_bienvenida` (`POST /servicios/:id/bienvenida/reenviar`, contrato Iris 0.9.0
 * §12.5, A37): vuelve a mandar la bienvenida de un servicio activo por sus canales, con las mismas
 * reglas que la primera (configuración de canales, permisos de contacto y límites de Iris en WhatsApp).
 *
 * - Solo servicios `activo` (409 `servicio_no_activo`).
 * - Límites por servicio, contados en `notify.bienvenidas` bajo el bloqueo del servicio: 429
 *   `bienvenida_reciente` antes de 10 min de la última bienvenida (la de la activación o un reenvío) y
 *   429 `demasiados_reenvios` después de 3 reenvíos en el día de Guatemala; los dos con `Retry-After`.
 * - Registra la bienvenida (`reenvio: true`, con `origen_tipo`/`origen_id` si vienen) y emite
 *   `servicio.bienvenida_solicitada`: el worker de notify la programa y la encola (durable por el
 *   outbox). El estado de cada canal llega a Iris con `servicio.bienvenida_cambiada`.
 * - La `Idempotency-Key` la exige la ruta (`iris:bienvenida:<orden_id>:<n>`).
 */
export default class ReenviarBienvenida extends DomainAction<
    EntradaReenviarBienvenida,
    SalidaReenviarBienvenida
> {
    readonly nombre = 'servicios.reenviar_bienvenida'

    protected async handle(
        input: EntradaReenviarBienvenida,
        t: Transaccion,
    ): Promise<SalidaReenviarBienvenida> {
        t.fijarEntidad('servicio', input.servicio_id)
        const servicio = (await t.trx
            .from('core.servicios')
            .where('id', input.servicio_id)
            .forUpdate()
            .select('estado', 'empresa_id', 'cliente_id')
            .first()) as { estado: string; empresa_id: number | null; cliente_id: number } | null
        if (!servicio) throw new NoEncontrado(`El servicio ${input.servicio_id} no existe`)
        const empresaId = servicio.empresa_id === null ? null : Number(servicio.empresa_id)
        t.fijarEmpresa(empresaId)
        if (servicio.estado !== 'activo') {
            throw new Conflicto(
                `El servicio ${input.servicio_id} no está activo (está ${servicio.estado}): no hay bienvenida que reenviar`,
                'servicio_no_activo',
                'El servicio no está activo',
            )
        }

        const ahora = DateTime.utc()
        const ultima = (await t.trx
            .from('notify.bienvenidas')
            .where('servicio_id', input.servicio_id)
            .orderBy('created_at', 'desc')
            .select('created_at')
            .first()) as { created_at: Date } | null
        if (ultima) {
            const faltan = Math.ceil(
                ESPERA_REENVIO_S - ahora.diff(DateTime.fromJSDate(new Date(ultima.created_at))).as('seconds'),
            )
            if (faltan > 0) {
                throw new LimiteExcedido(
                    'bienvenida_reciente',
                    'Bienvenida reciente',
                    'La bienvenida se envió hace menos de 10 minutos; espera antes de reenviarla',
                    faltan,
                )
            }
        }
        const inicioDia = ahora.setZone(ZONA).startOf('day')
        const conteo = (await t.trx
            .from('notify.bienvenidas')
            .where('servicio_id', input.servicio_id)
            .where('reenvio', true)
            .where('created_at', '>=', inicioDia.toUTC().toJSDate())
            .count('* as n')
            .first()) as { n: string | number }
        if (Number(conteo.n) >= REENVIOS_POR_DIA) {
            throw new LimiteExcedido(
                'demasiados_reenvios',
                'Demasiados reenvíos',
                `La bienvenida de este servicio ya se reenvió ${REENVIOS_POR_DIA} veces hoy; vuelve a intentarlo mañana`,
                Math.max(1, Math.ceil(inicioDia.plus({ days: 1 }).diff(ahora).as('seconds'))),
            )
        }

        const origenTipo = input.origen_tipo === 'iris_orden' && input.origen_id ? 'iris_orden' : null
        const origenId = origenTipo ? (input.origen_id ?? null) : null
        const canales = input.canales && input.canales.length > 0 ? [...new Set(input.canales)] : null
        const origenEnvios = `bienvenida:${input.servicio_id}:${randomUUID()}`
        const clienteId = Number(servicio.cliente_id)
        const bienvenidaId = await registrarBienvenida(t.trx, {
            origen: origenEnvios,
            servicioId: input.servicio_id,
            empresaId,
            clienteId,
            origenTipo,
            origenId,
            reenvio: true,
            canales,
            requestId: t.ctx.requestId,
        })
        await t.emit('servicio.bienvenida_solicitada', {
            bienvenida_id: bienvenidaId,
            servicio_id: input.servicio_id,
            empresa_id: empresaId,
            cliente_id: clienteId,
            origen_tipo: origenTipo,
            origen_id: origenId,
            origen_envios: origenEnvios,
            canales,
        })
        return { estado: 'en_cola', bienvenida_id: bienvenidaId }
    }
}
