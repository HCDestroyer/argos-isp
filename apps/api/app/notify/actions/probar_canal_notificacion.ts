import { nombreRemitente } from '#notify/marca'
import { randomUUID } from 'node:crypto'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ValidacionFallida } from '#shared/errores'
import { ambito, construirCanal, desdeEntorno, desdeFila, type ConfigCanales } from '#notify/configuracion'
import { filaDe } from '#notify/configuracion_panel'

export interface EntradaProbar {
    /** null = global */
    empresa_id: number | null
    canal: 'correo' | 'telegram'
    /** correo destino; en Telegram, por defecto el chat del equipo */
    destino?: string | null
}

export interface ResultadoProbar {
    estado: 'enviado' | 'fallido'
    /** error real del servidor (SMTP o Bot API) si falló */
    error: string | null
    destino: string
    /** qué configuración se probó */
    origen: 'global' | 'empresa' | 'entorno'
    envio_id: number
}

export const EVENTO_PRUEBA = 'notificaciones.prueba'

/**
 * `notificaciones.probar`: "Enviar prueba" del panel. Arma el canal con la configuración
 * **guardada** del ámbito (la de la empresa si tiene la suya, si no la global; sin fila global,
 * el entorno) y envía un mensaje en el momento, sin cola.
 *
 * - No mira los interruptores: se puede probar un canal antes de encenderlo.
 * - Si falla no lanza: devuelve `fallido` con el mensaje del servidor (`535 Authentication
 *   failed`, `401 Unauthorized`, `400 Bad Request: chat not found`…).
 * - Queda en `notify.envios` (origen `prueba:<uuid>`, evento `notificaciones.prueba`, sin cliente).
 */
export default class ProbarCanalNotificacion extends DomainAction<EntradaProbar, ResultadoProbar> {
    readonly nombre = 'notificaciones.probar'

    protected async handle(input: EntradaProbar, t: Transaccion): Promise<ResultadoProbar> {
        t.fijarEmpresa(input.empresa_id ?? null)
        const config = await this.configuracion(t, input.empresa_id)
        const destino =
            (input.destino?.trim() || null) ??
            (input.canal === 'telegram' ? config.telegram.chatEquipo : null)
        if (!destino) {
            throw new ValidacionFallida([
                {
                    field: 'destino',
                    message:
                        input.canal === 'telegram'
                            ? 'Indica un chat o configura el chat del equipo'
                            : 'Indica el correo al que se envía la prueba',
                    rule: 'required',
                },
            ])
        }

        const donde = ambito(config)
        const asunto = 'Prueba de notificaciones de ArgosIsp'
        const cuerpo =
            `Este es un mensaje de prueba enviado desde el panel con ${donde}.\n` +
            'Si lo recibes, el canal está bien configurado.'

        let error: string | null = null
        let proveedorId: string | null = null
        const canal = construirCanal(config, input.canal, { nuevo: true })
        if (faltaSecreto(config, input.canal)) {
            error = `No se pudo descifrar ${config.erroresCifrado.join(', ')}: vuelve a escribirlo en el panel`
        } else if (!canal) {
            error =
                input.canal === 'correo'
                    ? `Falta el servidor SMTP en ${donde}`
                    : `Falta el token del bot en ${donde}`
        } else {
            try {
                const remitenteNombre =
                    input.canal === 'correo'
                        ? await nombreRemitente(t.trx, config, input.empresa_id ?? null)
                        : null
                const resultado = await canal.enviar(destino, asunto, cuerpo, { remitenteNombre })
                proveedorId = resultado.id || null
            } catch (falla) {
                error = (falla instanceof Error ? falla.message : String(falla)).slice(0, 2000)
            } finally {
                const cerrable = canal as { cerrar?: () => Promise<void> }
                await cerrable.cerrar?.()
            }
        }

        const estado = error ? 'fallido' : 'enviado'
        const [fila] = (await t.trx
            .table('notify.envios')
            .insert({
                origen: `prueba:${randomUUID()}`,
                evento: EVENTO_PRUEBA,
                cliente_id: null,
                empresa_id: input.empresa_id,
                canal: input.canal,
                destino,
                asunto,
                cuerpo,
                variables: JSON.stringify({}),
                estado,
                error,
                intentos: 1,
                proveedor_id: proveedorId,
                enviado_en: estado === 'enviado' ? t.trx.knexRawQuery('now()') : null,
                request_id: t.ctx.requestId,
            })
            .returning('id')) as Array<{ id: number }>
        const envioId = Number(fila!.id)
        t.fijarEntidad('envio', envioId)
        return { estado, error, destino, origen: config.origen, envio_id: envioId }
    }

    /** Configuración guardada del ámbito, leída de la base (no de la caché). */
    private async configuracion(t: Transaccion, empresaId: number | null): Promise<ConfigCanales> {
        if (empresaId !== null) {
            const propia = await filaDe(t.trx, empresaId)
            if (propia && !propia.hereda) return desdeFila(propia)
        }
        const global = await filaDe(t.trx, null)
        return global ? desdeFila(global) : desdeEntorno()
    }
}

function faltaSecreto(config: ConfigCanales, canal: 'correo' | 'telegram'): boolean {
    return canal === 'correo'
        ? config.erroresCifrado.includes('smtp_password')
        : config.erroresCifrado.includes('telegram_token')
}
