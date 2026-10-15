import { DateTime } from 'luxon'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import {
    bloquearOrigen,
    crearEnvio,
    elegirCanales,
    enviosExistentes,
    plantillasActivas,
    type EnvioCreado,
} from '#notify/envios'
import { cargarDestinatario, construirVariables, resolverCliente } from '#notify/variables'

export interface EntradaProgramar {
    /** `outbox:<id>` para eventos; otro prefijo para recordatorios */
    origen: string
    /** evento de la plantilla (`factura.emitida`, `recordatorio.1`…) */
    evento: string
    payload: Record<string, unknown>
    /** instante ISO con el que se calculan días al vencimiento (por defecto, ahora) */
    ahora?: string
}

export interface ResultadoProgramar {
    clienteId: number | null
    envios: EnvioCreado[]
    /** ids en `encolado` que hay que poner en la cola (nuevos o pendientes de una entrega anterior) */
    encolar: number[]
}

/**
 * Decide a quién, por qué canal y con qué texto se notifica un evento, y lo registra en
 * `notify.envios` como `encolado`. No envía: el worker lo hace con `EnviarNotificacion`.
 *
 * - Idempotente por `origen` + cliente: si el evento llega dos veces no se crea otro envío; se
 *   devuelven los que sigan `encolado` para volver a encolarlos (la cola deduplica por id).
 * - Canales: todos los que el cliente tiene disponibles (correo y Telegram), el preferido primero
 *   (`elegirCanales`). Un envío por canal.
 * - Sin plantilla activa para el evento: no hace nada (el evento no se notifica).
 * - Hay plantilla pero el cliente no tiene destino en ningún canal: registra un envío `fallido`
 *   ("sin destino") para que se vea en el panel y emite `notificacion.enviada` con estado fallido.
 */
export default class ProgramarNotificacion extends DomainAction<EntradaProgramar, ResultadoProgramar> {
    readonly nombre = 'notificaciones.programar'

    protected async handle(input: EntradaProgramar, t: Transaccion): Promise<ResultadoProgramar> {
        const vacio = (clienteId: number | null): ResultadoProgramar => ({
            clienteId,
            envios: [],
            encolar: [],
        })

        const plantillas = await plantillasActivas(t.trx, input.evento)
        if (plantillas.size === 0) return vacio(null)

        const clienteId = await resolverCliente(t.trx, input.payload)
        if (!clienteId) return vacio(null)
        t.fijarEntidad('cliente', clienteId)

        await bloquearOrigen(t.trx, input.origen)
        const existentes = await enviosExistentes(t.trx, input.origen, clienteId)
        if (existentes.length > 0) {
            return {
                clienteId,
                envios: existentes,
                encolar: existentes.filter((e) => e.estado === 'encolado').map((e) => e.id),
            }
        }

        const destinatario = await cargarDestinatario(t.trx, clienteId)
        if (!destinatario) return vacio(clienteId)

        const ahora = input.ahora ? DateTime.fromISO(input.ahora, { zone: 'utc' }) : DateTime.utc()
        const variables = await construirVariables(t.trx, input.evento, input.payload, destinatario, ahora)
        const elegidos = elegirCanales(destinatario, plantillas)

        if (elegidos.length === 0) {
            const canal = destinatario.canalPreferido
            const plantilla =
                plantillas.get(canal) ?? plantillas.get('correo') ?? [...plantillas.values()][0]!
            const envio = await crearEnvio(t.trx, {
                origen: input.origen,
                evento: input.evento,
                clienteId,
                canal: plantilla.canal,
                destino: '-',
                variables,
                plantilla,
                requestId: t.ctx.requestId,
                error: 'El cliente no tiene destino en su canal preferido ni correo',
            })
            if (envio.nuevo) {
                await t.emit('notificacion.enviada', {
                    cliente_id: clienteId,
                    canal: plantilla.canal,
                    evento_origen: input.evento,
                    estado: 'fallido',
                })
            }
            return { clienteId, envios: [envio], encolar: [] }
        }

        const envios: EnvioCreado[] = []
        for (const eleccion of elegidos) {
            envios.push(
                await crearEnvio(t.trx, {
                    origen: input.origen,
                    evento: input.evento,
                    clienteId,
                    canal: eleccion.canal,
                    destino: eleccion.destino,
                    variables,
                    plantilla: eleccion.plantilla,
                    requestId: t.ctx.requestId,
                }),
            )
        }
        return {
            clienteId,
            envios,
            encolar: envios.filter((e) => e.estado === 'encolado').map((e) => e.id),
        }
    }
}
