import { randomBytes } from 'node:crypto'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ConflictoVersion, ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { cifrar } from '#shared/cifrado'
import { actualizarConVersion } from '#shared/version'
import {
    TABLA_CONFIGURACION,
    botIdDelToken,
    invalidarConfiguracion,
    publicarInvalidacion,
    type FilaConfiguracion,
    type TipoAviso,
    type TlsSmtp,
} from '#notify/configuracion'
import { filaDe, vistaDeFila, type VistaConfiguracion } from '#notify/configuracion_panel'

export interface EntradaConfigurar {
    /** null = global */
    empresa_id: number | null
    /** `version` leída; 0 si todavía no hay fila guardada */
    version: number
    /** solo empresas: `true` usa la global */
    hereda?: boolean
    correo?: {
        activo?: boolean
        host?: string | null
        puerto?: number | null
        tls?: TlsSmtp
        usuario?: string | null
        /** omitido: se conserva; `null`: se borra; texto: se reemplaza */
        password?: string | null
        remitente?: string | null
        nombre_visible?: string | null
        /** avisos fiscales a contabilidad: direcciones separadas por coma */
        contabilidad?: string | null
    }
    telegram?: {
        clientes_activo?: boolean
        alertas_activo?: boolean
        /** omitido: se conserva; `null`: se borra; texto: se reemplaza */
        token?: string | null
        bot_nombre?: string | null
        chat_equipo?: string | null
        /** omitido: se conserva (o se genera si hay token y no hay secreto); `null`: se borra */
        webhook_secreto?: string | null
    }
    /** tipo de aviso → encendido; los que no vienen no cambian */
    avisos?: Partial<Record<TipoAviso, boolean>>
}

/** Secreto del webhook generado: 32 caracteres `A-Z a-z 0-9 _ -` (lo que acepta Telegram). */
export function generarSecretoWebhook(): string {
    return randomBytes(24).toString('base64url')
}

function vacioANulo(valor: string | null | undefined): string | null | undefined {
    if (valor === undefined) return undefined
    const limpio = valor?.trim() ?? ''
    return limpio === '' ? null : limpio
}

/**
 * `notificaciones.configurar`: guarda la configuración de canales global (`empresa_id` null) o la
 * de una empresa (`contratos/multiempresa.md`).
 *
 * - Control optimista por `version` (409). Sin fila guardada, se crea con `version: 0`.
 * - Secretos (contraseña SMTP, token del bot, secreto del webhook) cifrados con
 *   `app/shared/cifrado.ts`; en `audit.acciones` y `audit.cambios` quedan como `***` y nunca se
 *   devuelven (la respuesta trae `***`). Solo se pueden reemplazar o borrar.
 * - Con token y sin secreto del webhook, se genera uno.
 * - Emite `notificaciones.config_cambiada` (el worker recarga) y, al confirmar, invalida la caché
 *   de este proceso y avisa a los demás por Redis.
 */
export default class ConfigurarNotificaciones extends DomainAction<EntradaConfigurar, VistaConfiguracion> {
    readonly nombre = 'notificaciones.configurar'

    protected async handle(input: EntradaConfigurar, t: Transaccion): Promise<VistaConfiguracion> {
        const empresaId = input.empresa_id
        // Auditoría: la empresa de la configuración (null = la global, de ninguna empresa)
        t.fijarEmpresa(empresaId)
        const errores: ErrorCampo[] = []
        if (empresaId === null && input.hereda !== undefined && input.hereda !== false) {
            errores.push({ field: 'hereda', message: 'La configuración global no hereda', rule: 'global' })
        }
        if (empresaId !== null) await validarEmpresa(t.trx, empresaId, errores)
        if (errores.length > 0) throw new ValidacionFallida(errores)

        // Serializa la creación de la fila del ámbito (dos guardados simultáneos con version 0).
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(hashtext(?))', [
            `notify:configuracion:${empresaId ?? 'global'}`,
        ])
        const antes = await filaDe(t.trx, empresaId, { bloquear: true })
        const actual = antes?.version ?? 0
        if (actual !== input.version) {
            throw new ConflictoVersion('notify.configuracion_canales', antes?.id ?? 'nueva')
        }

        const cambios = columnasDe(input, antes)
        let despues: FilaConfiguracion
        if (antes) {
            despues = await actualizarConVersion<FilaConfiguracion & Record<string, unknown>>(
                t.trx,
                TABLA_CONFIGURACION,
                Number(antes.id),
                input.version,
                cambios,
            )
        } else {
            const [fila] = (await t.trx
                .table(TABLA_CONFIGURACION)
                .insert({
                    empresa_id: empresaId,
                    hereda: empresaId === null ? false : (input.hereda ?? true),
                    ...cambios,
                })
                .returning('*')) as FilaConfiguracion[]
            despues = fila!
        }

        const id = Number(despues.id)
        t.fijarEntidad('configuracion_notificaciones', id)
        const campos = await t.registrarCambios({ tipo: 'configuracion_notificaciones', id }, antes, despues)
        await t.emit('notificaciones.config_cambiada', {
            configuracion_id: id,
            empresa_id: empresaId,
            campos,
        })
        t.alConfirmar(async () => {
            invalidarConfiguracion()
            await publicarInvalidacion()
        })
        return vistaDeFila(despues)
    }
}

async function validarEmpresa(trx: TransactionClientContract, empresaId: number, errores: ErrorCampo[]) {
    const existe = await trx.from('core.empresas').where('id', empresaId).select('id').first()
    if (!existe) {
        errores.push({ field: 'empresa_id', message: `La empresa ${empresaId} no existe`, rule: 'exists' })
    }
}

/** `a@x.gt ,b@y.gt,` → `a@x.gt, b@y.gt`; vacío → null. */
function normalizarCorreos(valor: string | null): string | null {
    const lista = (valor ?? '')
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean)
    return lista.length > 0 ? [...new Set(lista)].join(', ') : null
}

/** Columnas a escribir según la entrada (solo lo que vino). */
function columnasDe(input: EntradaConfigurar, antes: FilaConfiguracion | null): Record<string, unknown> {
    const columnas: Record<string, unknown> = {}
    if (input.empresa_id !== null && input.hereda !== undefined && antes) columnas.hereda = input.hereda

    const correo = input.correo
    if (correo) {
        if (correo.activo !== undefined) columnas.correo_activo = correo.activo
        if (correo.host !== undefined) columnas.smtp_host = vacioANulo(correo.host)
        if (correo.puerto !== undefined) columnas.smtp_puerto = correo.puerto
        if (correo.tls !== undefined) columnas.smtp_tls = correo.tls
        if (correo.usuario !== undefined) columnas.smtp_usuario = vacioANulo(correo.usuario)
        if (correo.password !== undefined) {
            columnas.smtp_password_cifrada = correo.password ? cifrar(correo.password) : null
        }
        if (correo.remitente !== undefined) columnas.correo_remitente = vacioANulo(correo.remitente)
        if (correo.nombre_visible !== undefined) columnas.correo_nombre = vacioANulo(correo.nombre_visible)
        if (correo.contabilidad !== undefined) {
            columnas.correo_contabilidad = normalizarCorreos(correo.contabilidad)
        }
    }

    const telegram = input.telegram
    let token = antes?.telegram_token_cifrado ?? null
    let secreto = antes?.telegram_webhook_secreto_cifrado ?? null
    if (telegram) {
        if (telegram.clientes_activo !== undefined) {
            columnas.telegram_clientes_activo = telegram.clientes_activo
        }
        if (telegram.alertas_activo !== undefined) columnas.telegram_alertas_activo = telegram.alertas_activo
        if (telegram.token !== undefined) {
            const limpio = vacioANulo(telegram.token)
            token = limpio ? cifrar(limpio) : null
            columnas.telegram_token_cifrado = token
            columnas.telegram_bot_id = limpio ? botIdDelToken(limpio) : null
        }
        if (telegram.bot_nombre !== undefined) {
            columnas.telegram_bot_nombre = vacioANulo(telegram.bot_nombre)?.replace(/^@/, '') ?? null
        }
        if (telegram.chat_equipo !== undefined) {
            columnas.telegram_chat_equipo = vacioANulo(telegram.chat_equipo)
        }
        if (telegram.webhook_secreto !== undefined) {
            const limpio = vacioANulo(telegram.webhook_secreto)
            secreto = limpio ? cifrar(limpio) : null
            columnas.telegram_webhook_secreto_cifrado = secreto
        }
    }
    // Un bot sin secreto rechazaría todo en el webhook: se genera uno.
    if (token && !secreto) columnas.telegram_webhook_secreto_cifrado = cifrar(generarSecretoWebhook())

    if (input.avisos && Object.keys(input.avisos).length > 0) {
        columnas.avisos = JSON.stringify({ ...(antes?.avisos ?? {}), ...input.avisos })
    }
    return columnas
}
