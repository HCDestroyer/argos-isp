import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { MASCARA } from '#shared/enmascarar'
import {
    TABLA_CONFIGURACION,
    TIPOS_AVISO,
    avisosCompletos,
    desdeEntorno,
    type ConfigCanales,
    type FilaConfiguracion,
    type TipoAviso,
    type TlsSmtp,
} from '#notify/configuracion'
import { RUTA_WEBHOOK } from '#notify/telegram/webhook'

/**
 * Vista de la configuración de canales para el panel (schema `ConfiguracionNotificaciones`).
 * Los secretos nunca salen: `'***'` si hay uno guardado, `null` si no.
 */

export interface VistaConfiguracion {
    /** null = todavía no hay fila guardada */
    id: number | null
    /** null = global */
    empresa_id: number | null
    /** solo empresas: usa la global (por defecto). La global siempre es `false`. */
    hereda: boolean
    /**
     * - `guardada`: fila de `notify.configuracion_canales`.
     * - `entorno`: global sin guardar; rigen las variables de entorno (valor inicial).
     * - `sin_configurar`: empresa sin fila (hereda la global).
     */
    origen: 'guardada' | 'entorno' | 'sin_configurar'
    sembrada_desde_entorno: boolean
    correo: {
        activo: boolean
        host: string | null
        puerto: number | null
        tls: TlsSmtp
        usuario: string | null
        password: string | null
        remitente: string | null
        nombre_visible: string | null
        /** avisos fiscales a contabilidad: direcciones separadas por coma */
        contabilidad: string | null
    }
    telegram: {
        clientes_activo: boolean
        alertas_activo: boolean
        token: string | null
        bot_id: string | null
        bot_nombre: string | null
        chat_equipo: string | null
        webhook_secreto: string | null
        /** ruta del webhook de este bot (relativa al host público de la API) */
        webhook_ruta: string | null
    }
    avisos: Record<TipoAviso, boolean>
    /** 0 = sin guardar (el primer guardado manda `version: 0`) */
    version: number
    created_at: Date | null
    updated_at: Date | null
}

function oculto(valor: string | null | undefined): string | null {
    return valor ? MASCARA : null
}

function rutaWebhook(botId: string | null): string | null {
    return botId ? `${RUTA_WEBHOOK}/${botId}` : null
}

export function vistaDeFila(fila: FilaConfiguracion): VistaConfiguracion {
    return {
        id: Number(fila.id),
        empresa_id: fila.empresa_id === null ? null : Number(fila.empresa_id),
        hereda: fila.hereda,
        origen: 'guardada',
        sembrada_desde_entorno: fila.sembrada_desde_entorno,
        correo: {
            activo: fila.correo_activo,
            host: fila.smtp_host,
            puerto: fila.smtp_puerto,
            tls: fila.smtp_tls,
            usuario: fila.smtp_usuario,
            password: oculto(fila.smtp_password_cifrada),
            remitente: fila.correo_remitente,
            nombre_visible: fila.correo_nombre,
            contabilidad: fila.correo_contabilidad ?? null,
        },
        telegram: {
            clientes_activo: fila.telegram_clientes_activo,
            alertas_activo: fila.telegram_alertas_activo,
            token: oculto(fila.telegram_token_cifrado),
            bot_id: fila.telegram_bot_id,
            bot_nombre: fila.telegram_bot_nombre,
            chat_equipo: fila.telegram_chat_equipo,
            webhook_secreto: oculto(fila.telegram_webhook_secreto_cifrado),
            webhook_ruta: rutaWebhook(fila.telegram_bot_id),
        },
        avisos: avisosCompletos(fila.avisos),
        version: fila.version,
        created_at: fila.created_at,
        updated_at: fila.updated_at,
    }
}

/** Global sin guardar: lo que rige es el entorno (sin secretos, claro). */
export function vistaDeEntorno(config: ConfigCanales = desdeEntorno()): VistaConfiguracion {
    return {
        id: null,
        empresa_id: null,
        hereda: false,
        origen: 'entorno',
        sembrada_desde_entorno: false,
        correo: {
            activo: config.correo.activo,
            host: config.correo.host,
            puerto: config.correo.host ? config.correo.puerto : null,
            tls: config.correo.tls,
            usuario: config.correo.usuario,
            password: oculto(config.correo.password),
            remitente: config.correo.remitente,
            nombre_visible: config.correo.nombre,
            contabilidad: config.correo.contabilidad,
        },
        telegram: {
            clientes_activo: config.telegram.clientesActivo,
            alertas_activo: config.telegram.alertasActivo,
            token: oculto(config.telegram.token),
            bot_id: config.telegram.botId,
            bot_nombre: config.telegram.botNombre,
            chat_equipo: config.telegram.chatEquipo,
            webhook_secreto: oculto(config.telegram.webhookSecreto),
            webhook_ruta: rutaWebhook(config.telegram.botId),
        },
        avisos: config.avisos,
        version: 0,
        created_at: null,
        updated_at: null,
    }
}

/** Empresa sin fila: hereda la global, todo vacío y encendido. */
export function vistaEmpresaSinFila(empresaId: number): VistaConfiguracion {
    return {
        id: null,
        empresa_id: empresaId,
        hereda: true,
        origen: 'sin_configurar',
        sembrada_desde_entorno: false,
        correo: {
            activo: true,
            host: null,
            puerto: null,
            tls: 'auto',
            usuario: null,
            password: null,
            remitente: null,
            nombre_visible: null,
            contabilidad: null,
        },
        telegram: {
            clientes_activo: true,
            alertas_activo: true,
            token: null,
            bot_id: null,
            bot_nombre: null,
            chat_equipo: null,
            webhook_secreto: null,
            webhook_ruta: null,
        },
        avisos: Object.fromEntries(TIPOS_AVISO.map((t) => [t, true])) as Record<TipoAviso, boolean>,
        version: 0,
        created_at: null,
        updated_at: null,
    }
}

export async function filaDe(
    cliente: QueryClientContract,
    empresaId: number | null,
    opciones: { bloquear?: boolean } = {},
): Promise<FilaConfiguracion | null> {
    const consulta = cliente.from(TABLA_CONFIGURACION).select('*')
    if (empresaId === null) consulta.whereNull('empresa_id')
    else consulta.where('empresa_id', empresaId)
    if (opciones.bloquear) consulta.forUpdate()
    return ((await consulta.first()) as FilaConfiguracion | null) ?? null
}

/** `GET /notificaciones/configuracion` */
export async function verConfiguracionGlobal(): Promise<VistaConfiguracion> {
    const fila = await filaDe(db.connection(), null)
    return fila ? vistaDeFila(fila) : vistaDeEntorno()
}

/** `GET /notificaciones/configuracion/empresas/:empresaId` */
export async function verConfiguracionEmpresa(empresaId: number): Promise<VistaConfiguracion> {
    const fila = await filaDe(db.connection(), empresaId)
    return fila ? vistaDeFila(fila) : vistaEmpresaSinFila(empresaId)
}

/** `GET /notificaciones/configuracion/empresas`: las empresas con fila guardada. */
export async function listarConfiguracionesEmpresas(): Promise<VistaConfiguracion[]> {
    const filas = (await db
        .from(TABLA_CONFIGURACION)
        .whereNotNull('empresa_id')
        .select('*')
        .orderBy('empresa_id')) as FilaConfiguracion[]
    return filas.map(vistaDeFila)
}
