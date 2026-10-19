import type { Schema } from '@argosisp/contracts'
import type { CambiosConfiguracionNotificaciones } from '../composables/useNotificaciones'

type Configuracion = Schema<'ConfiguracionNotificaciones'>

/**
 * Qué hacer con un secreto (contraseña SMTP, token del bot, secreto del webhook), que la API nunca
 * devuelve (`***`): conservarlo (no se manda el campo), reemplazarlo (texto) o borrarlo (`null`).
 */
export type AccionSecreto = 'conservar' | 'reemplazar' | 'borrar'

export interface Secreto {
    accion: AccionSecreto
    valor: string
}

/** Lo que edita el formulario (strings y booleanos; los secretos aparte). */
export interface FormularioNotificaciones {
    hereda: boolean
    correo: {
        activo: boolean
        host: string
        puerto: string
        tls: Configuracion['correo']['tls']
        usuario: string
        remitente: string
        nombre_visible: string
        /** Correos de contabilidad para los avisos fiscales, separados por coma (A6). */
        contabilidad: string
    }
    telegram: {
        clientes_activo: boolean
        alertas_activo: boolean
        bot_nombre: string
        chat_equipo: string
    }
    avisos: Configuracion['avisos']
    secretos: {
        password: Secreto
        token: Secreto
        webhook_secreto: Secreto
    }
}

/** Espejo de `LISTA_CORREOS` del validador de A6: direcciones separadas por coma (o vacío). */
export const LISTA_CORREOS = /^\s*(?:[^\s@,]+@[^\s@,]+\.[^\s@,]+\s*(?:,\s*|$))*$/

/** Error del campo «correo de contabilidad», o `undefined` si es válido. */
export function errorListaCorreos(valor: string): string | undefined {
    if (valor.length > 1000) {
        return 'Máximo 1000 caracteres'
    }
    return LISTA_CORREOS.test(valor) ? undefined : 'Escribe correos válidos separados por coma'
}

export const TLS_CORREO: Record<Configuracion['correo']['tls'], string> = {
    auto: 'Automático (STARTTLS si el servidor lo ofrece)',
    starttls: 'STARTTLS obligatorio',
    tls: 'TLS desde el inicio (465)',
    ninguno: 'Sin cifrar',
}

type TextoAviso = { etiqueta: string, descripcion: string }

/**
 * Textos de todos los tipos de aviso que el panel conoce, incluidos los que la API todavía no
 * publica en `avisos` (p. ej. `lealtad`, que A6 agrega en `a6/lealtad-1`): un tipo sin texto rompe el
 * typecheck de `AVISOS`; uno con texto que la API no manda no se muestra (`avisosDe`).
 */
const TEXTOS_AVISO = {
    factura: { etiqueta: 'Factura emitida', descripcion: 'Aviso de cobro nuevo' },
    vencimiento: { etiqueta: 'Factura vencida', descripcion: 'Al vencer sin pago' },
    recordatorio: { etiqueta: 'Recordatorio', descripcion: 'Antes del vencimiento' },
    corte: { etiqueta: 'Corte', descripcion: 'Servicio suspendido o limitado' },
    pago: { etiqueta: 'Pago registrado', descripcion: 'Recibo del pago' },
    promesa: { etiqueta: 'Promesa de pago', descripcion: 'Creada, cumplida o incumplida' },
    comprobante: { etiqueta: 'Comprobante', descripcion: 'Aprobado o rechazado' },
    lealtad: { etiqueta: 'Puntos de lealtad', descripcion: 'Puntos ganados, por vencer y referido calificado' },
} satisfies Record<string, TextoAviso>

/** Tipos de aviso, con el nombre que ve el operador. */
export const AVISOS: Record<keyof Configuracion['avisos'], TextoAviso> = TEXTOS_AVISO

/** Los avisos que trae la configuración leída, con su texto (sin interruptores de tipos que la API no tiene). */
export function avisosDe(avisos: Record<string, boolean>): { clave: keyof Configuracion['avisos'], aviso: TextoAviso }[] {
    return (Object.keys(AVISOS) as (keyof Configuracion['avisos'])[])
        .filter(clave => Object.hasOwn(avisos, clave))
        .map(clave => ({ clave, aviso: AVISOS[clave] }))
}

const conservar = (): Secreto => ({ accion: 'conservar', valor: '' })

/** Formulario a partir de lo que devuelve la API. */
export function formularioNotificaciones(config: Configuracion): FormularioNotificaciones {
    return {
        hereda: config.hereda,
        correo: {
            activo: config.correo.activo,
            host: config.correo.host ?? '',
            puerto: config.correo.puerto === null ? '' : String(config.correo.puerto),
            tls: config.correo.tls,
            usuario: config.correo.usuario ?? '',
            remitente: config.correo.remitente ?? '',
            nombre_visible: config.correo.nombre_visible ?? '',
            contabilidad: config.correo.contabilidad ?? '',
        },
        telegram: {
            clientes_activo: config.telegram.clientes_activo,
            alertas_activo: config.telegram.alertas_activo,
            bot_nombre: config.telegram.bot_nombre ?? '',
            chat_equipo: config.telegram.chat_equipo ?? '',
        },
        avisos: { ...config.avisos },
        secretos: { password: conservar(), token: conservar(), webhook_secreto: conservar() },
    }
}

const textoONull = (valor: string): string | null => valor.trim() || null

/**
 * Cuerpo del `PUT`. Los secretos se mandan solo si cambian: texto para reemplazar, `null` para
 * borrar y nada para conservar (nunca `***`, que la API rechaza). `hereda` solo en una empresa.
 */
export function cuerpoNotificaciones(form: FormularioNotificaciones, version: number, empresa: boolean): CambiosConfiguracionNotificaciones {
    const secreto = (s: Secreto): { valor: string | null } | null => {
        if (s.accion === 'borrar') {
            return { valor: null }
        }
        if (s.accion === 'reemplazar' && s.valor.trim()) {
            return { valor: s.valor.trim() }
        }
        return null
    }
    const puerto = form.correo.puerto.trim()
    const correo: NonNullable<CambiosConfiguracionNotificaciones['correo']> = {
        activo: form.correo.activo,
        host: textoONull(form.correo.host),
        puerto: puerto ? Number(puerto) : null,
        tls: form.correo.tls,
        usuario: textoONull(form.correo.usuario),
        remitente: textoONull(form.correo.remitente),
        nombre_visible: textoONull(form.correo.nombre_visible),
        contabilidad: textoONull(form.correo.contabilidad),
    }
    const password = secreto(form.secretos.password)
    if (password) {
        correo.password = password.valor
    }
    const telegram: NonNullable<CambiosConfiguracionNotificaciones['telegram']> = {
        clientes_activo: form.telegram.clientes_activo,
        alertas_activo: form.telegram.alertas_activo,
        bot_nombre: textoONull(form.telegram.bot_nombre),
        chat_equipo: textoONull(form.telegram.chat_equipo),
    }
    const token = secreto(form.secretos.token)
    if (token) {
        telegram.token = token.valor
    }
    const webhook = secreto(form.secretos.webhook_secreto)
    if (webhook) {
        telegram.webhook_secreto = webhook.valor
    }
    const cuerpo: CambiosConfiguracionNotificaciones = { version, correo, telegram, avisos: { ...form.avisos } }
    if (empresa) {
        cuerpo.hereda = form.hereda
    }
    return cuerpo
}

/** Texto del origen de la configuración que se está viendo. */
export function etiquetaOrigen(config: Pick<Configuracion, 'origen' | 'hereda' | 'empresa_id'>): { etiqueta: string, color: 'success' | 'info' | 'neutral', icono: string } {
    if (config.empresa_id !== null && config.hereda) {
        return { etiqueta: 'Hereda la global', color: 'neutral', icono: 'i-lucide-git-branch' }
    }
    if (config.origen === 'entorno') {
        return { etiqueta: 'Del entorno, sin guardar', color: 'info', icono: 'i-lucide-server' }
    }
    if (config.origen === 'sin_configurar') {
        return { etiqueta: 'Sin configurar', color: 'neutral', icono: 'i-lucide-circle-dashed' }
    }
    return { etiqueta: 'Guardada', color: 'success', icono: 'i-lucide-circle-check' }
}
