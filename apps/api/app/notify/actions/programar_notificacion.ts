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
import {
    avisoDePagoYaProgramado,
    bloquearAvisoDePago,
    EVENTO_PAGO_TERCERO,
    EVENTOS_AVISO_PAGO,
    pagoCubiertoPorComprobante,
    tercerosDelPago,
} from '#notify/avisos_pago'
import { cargarDestinatario, construirVariables, resolverCliente } from '#notify/variables'
import { configPara, empresaDelEvento } from '#notify/configuracion'

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
    /** destinatario principal del evento (en `pago.registrado`, el pagador) */
    clienteId: number | null
    envios: EnvioCreado[]
    /** ids en `encolado` que hay que poner en la cola (nuevos o pendientes de una entrega anterior) */
    encolar: number[]
}

/** Un aviso a un cliente: la plantilla (`evento`) y el payload con el que se arman las variables. */
interface Aviso {
    clienteId: number
    evento: string
    payload: Record<string, unknown>
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
 * - Configuración (`configuracion.ts`): la de la empresa del evento si tiene la suya, si no la
 *   global. Un canal o un tipo de aviso apagado no se envía: queda un envío `omitido` con el
 *   motivo (sin `notificacion.enviada`).
 * - `pago.registrado` (`avisos_pago.ts`): el pagador recibe un solo aviso por pago. Si el pago
 *   salió de aprobar un comprobante, el aviso es el de `comprobante.aprobado` y aquí se omite.
 *   Cada dueño de factura distinto del pagador (`clientes[]`) recibe `pago.registrado.tercero`.
 */
export default class ProgramarNotificacion extends DomainAction<EntradaProgramar, ResultadoProgramar> {
    readonly nombre = 'notificaciones.programar'

    protected async handle(input: EntradaProgramar, t: Transaccion): Promise<ResultadoProgramar> {
        const clienteId = await resolverCliente(t.trx, input.payload)
        if (!clienteId) return { clienteId: null, envios: [], encolar: [] }

        const avisos: Aviso[] = [{ clienteId, evento: input.evento, payload: input.payload }]
        if (input.evento === 'pago.registrado') {
            for (const tercero of tercerosDelPago(input.payload, clienteId)) {
                avisos.push({
                    clienteId: tercero,
                    evento: EVENTO_PAGO_TERCERO,
                    payload: { ...input.payload, cliente_id: tercero, pagador_id: clienteId },
                })
            }
        }

        const ahora = input.ahora ? DateTime.fromISO(input.ahora, { zone: 'utc' }) : DateTime.utc()
        await bloquearOrigen(t.trx, input.origen)

        let principal: number | null = null
        const envios: EnvioCreado[] = []
        for (const aviso of avisos) {
            const programados = await this.programar(t, input.origen, aviso, ahora)
            if (programados === null) continue
            if (principal === null && aviso.clienteId === clienteId) {
                principal = clienteId
                t.fijarEntidad('cliente', clienteId)
            }
            envios.push(...programados)
        }
        return {
            clienteId: principal,
            envios,
            encolar: envios.filter((e) => e.estado === 'encolado').map((e) => e.id),
        }
    }

    /** Envíos de un aviso, o `null` si el aviso no corresponde (sin plantilla, cliente o ya cubierto). */
    private async programar(
        t: Transaccion,
        origen: string,
        aviso: Aviso,
        ahora: DateTime,
    ): Promise<EnvioCreado[] | null> {
        const plantillas = await plantillasActivas(t.trx, aviso.evento)
        if (plantillas.size === 0) return null

        const existentes = await enviosExistentes(t.trx, origen, aviso.clienteId)
        if (existentes.length > 0) return existentes

        // Un solo aviso de pago por pago y cliente (pago.registrado o comprobante.aprobado)
        if (EVENTOS_AVISO_PAGO.has(aviso.evento)) {
            const pagoId = await bloquearAvisoDePago(t.trx, aviso.payload)
            if (pagoId !== null) {
                if (aviso.evento === 'pago.registrado' && (await pagoCubiertoPorComprobante(t.trx, pagoId))) {
                    return null
                }
                if (await avisoDePagoYaProgramado(t.trx, pagoId, aviso.clienteId, origen)) return null
            }
        }

        const destinatario = await cargarDestinatario(t.trx, aviso.clienteId)
        if (!destinatario) return null

        const empresaId = await empresaDelEvento(t.trx, aviso.payload)
        const config = await configPara(empresaId)
        const variables = await construirVariables(t.trx, aviso.evento, aviso.payload, destinatario, ahora)
        const elegidos = elegirCanales(destinatario, plantillas, config, aviso.evento)

        if (elegidos.length === 0) {
            const canal = destinatario.canalPreferido
            const plantilla =
                plantillas.get(canal) ?? plantillas.get('correo') ?? [...plantillas.values()][0]!
            const envio = await crearEnvio(t.trx, {
                origen,
                evento: aviso.evento,
                clienteId: aviso.clienteId,
                canal: plantilla.canal,
                destino: '-',
                variables,
                plantilla,
                requestId: t.ctx.requestId,
                error: 'El cliente no tiene destino en su canal preferido ni correo',
                empresaId,
            })
            if (envio.nuevo) {
                await t.emit('notificacion.enviada', {
                    cliente_id: aviso.clienteId,
                    canal: plantilla.canal,
                    evento_origen: aviso.evento,
                    estado: 'fallido',
                })
            }
            return [envio]
        }

        const envios: EnvioCreado[] = []
        for (const eleccion of elegidos) {
            envios.push(
                await crearEnvio(t.trx, {
                    origen,
                    evento: aviso.evento,
                    clienteId: aviso.clienteId,
                    canal: eleccion.canal,
                    destino: eleccion.destino,
                    variables,
                    plantilla: eleccion.plantilla,
                    requestId: t.ctx.requestId,
                    omitido: eleccion.omitido,
                    empresaId,
                }),
            )
        }
        return envios
    }
}
