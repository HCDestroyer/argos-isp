import { DomainAction, type Transaccion } from '#shared/domain_action'
import { cifrar } from '#shared/cifrado'
import {
    TABLA_CONFIGURACION,
    botIdDelToken,
    desdeEntorno,
    invalidarConfiguracion,
    publicarInvalidacion,
    type FilaConfiguracion,
} from '#notify/configuracion'
import { filaDe } from '#notify/configuracion_panel'
import { generarSecretoWebhook } from '#notify/actions/configurar_notificaciones'

/** Sin datos: el entorno va en el constructor para que nunca entre en `audit.acciones.entrada`. */
export type EntradaSembrar = Record<string, never>

export interface ResultadoSembrar {
    sembrada: boolean
    /** por qué no se sembró: ya hay configuración global o el entorno no trae nada */
    motivo: 'ya_configurada' | 'entorno_vacio' | null
    configuracion_id: number | null
    /** variables que se usaron (nombres, nunca valores) */
    variables: string[]
}

const VARIABLES = [
    'SMTP_HOST',
    'SMTP_PORT',
    'SMTP_SECURE',
    'SMTP_USER',
    'SMTP_PASSWORD',
    'MAIL_FROM',
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_BOT_NOMBRE',
    'TELEGRAM_CHAT_EQUIPO',
    'TELEGRAM_WEBHOOK_SECRET',
]

/**
 * `notificaciones.sembrar_configuracion` (solo sistema, al arrancar la API y el worker): si no hay
 * configuración global guardada y el entorno trae `SMTP_*` o `TELEGRAM_*`, la crea con esos
 * valores **una sola vez**. Desde ahí mandan los valores del panel: el entorno ya no se lee.
 *
 * Solo se audita cuando siembra (arrancar sin nada que sembrar no es una acción de nadie). La
 * entrada auditada no lleva el entorno: los secretos quedan cifrados en la fila y como `***` en
 * `audit.cambios`.
 */
export default class SembrarConfiguracionCanales extends DomainAction<EntradaSembrar, ResultadoSembrar> {
    readonly nombre = 'notificaciones.sembrar_configuracion'

    /** `entorno`: variables a leer (por defecto `process.env`; las pruebas pasan las suyas). */
    constructor(private readonly entorno: NodeJS.ProcessEnv = process.env) {
        super()
    }

    protected auditarExito(salida: ResultadoSembrar): boolean {
        return salida.sembrada
    }

    protected async handle(_input: EntradaSembrar, t: Transaccion): Promise<ResultadoSembrar> {
        t.fijarEmpresa(null) // la configuración global
        const entorno = this.entorno
        const variables = VARIABLES.filter((nombre) => Boolean(entorno[nombre]))
        if (!entorno.SMTP_HOST && !entorno.TELEGRAM_BOT_TOKEN) {
            return { sembrada: false, motivo: 'entorno_vacio', configuracion_id: null, variables: [] }
        }

        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(hashtext(?))', ['notify:configuracion:global'])
        const existente = await filaDe(t.trx, null)
        if (existente) {
            return {
                sembrada: false,
                motivo: 'ya_configurada',
                configuracion_id: Number(existente.id),
                variables: [],
            }
        }

        const config = desdeEntorno(entorno)
        const token = config.telegram.token
        const [fila] = (await t.trx
            .table(TABLA_CONFIGURACION)
            .insert({
                empresa_id: null,
                hereda: false,
                smtp_host: config.correo.host,
                smtp_puerto: config.correo.host ? config.correo.puerto : null,
                smtp_tls: config.correo.tls,
                smtp_usuario: config.correo.usuario,
                smtp_password_cifrada: config.correo.password ? cifrar(config.correo.password) : null,
                correo_remitente: config.correo.remitente,
                correo_nombre: config.correo.nombre,
                telegram_token_cifrado: token ? cifrar(token) : null,
                telegram_bot_id: token ? botIdDelToken(token) : null,
                telegram_bot_nombre: config.telegram.botNombre,
                telegram_chat_equipo: config.telegram.chatEquipo,
                telegram_webhook_secreto_cifrado: token
                    ? cifrar(config.telegram.webhookSecreto ?? generarSecretoWebhook())
                    : null,
                sembrada_desde_entorno: true,
            })
            .returning('*')) as FilaConfiguracion[]

        const id = Number(fila!.id)
        t.fijarEntidad('configuracion_notificaciones', id)
        const campos = await t.registrarCambios({ tipo: 'configuracion_notificaciones', id }, null, fila)
        await t.emit('notificaciones.config_cambiada', { configuracion_id: id, empresa_id: null, campos })
        t.alConfirmar(async () => {
            invalidarConfiguracion()
            await publicarInvalidacion()
        })
        return { sembrada: true, motivo: null, configuracion_id: id, variables }
    }
}
