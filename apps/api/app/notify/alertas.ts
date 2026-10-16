import { DateTime } from 'luxon'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import env from '#start/env'
import { canalDisponible } from '#notify/canales/registro'
import { crearEnvio, type EnvioCreado } from '#notify/envios'
import { PLANTILLAS_ALERTA } from '#notify/plantillas_base'
import { variablesEmpresa, type Variables } from '#notify/variables'
import { ZONA } from '#notify/formato'

/**
 * Alertas internas al chat del equipo (tarea 7). Piezas compartidas por las acciones
 * `RegistrarAlerta` (eventos) y `VigilarCrons` (crons atrasados); reciben la transacción de la
 * acción y no se llaman fuera de una.
 *
 * Un **incidente** (`notify.incidentes`) es un problema identificado por `clave`. Mientras está
 * abierto, repetir el evento solo suma `eventos`: una alerta por incidente. Al cerrarse (evento
 * de recuperación, cron que vuelve a correr, o ventana sin eventos) se puede avisar que se
 * resolvió. Los envíos van a `notify.envios` sin cliente, por Telegram, con origen
 * `alerta:<incidente>:<fase>` (único: un mismo incidente no avisa dos veces la misma fase).
 */

export type FaseAlerta = 'abierto' | 'cerrado'

export interface Incidente {
    id: number
    clave: string
    tipo: string
    estado: 'abierto' | 'cerrado'
    abierto_en: Date
    ultimo_en: Date
    cerrado_en: Date | null
    eventos: number
    detalle: Record<string, unknown>
}

const COLUMNAS = [
    'id',
    'clave',
    'tipo',
    'estado',
    'abierto_en',
    'ultimo_en',
    'cerrado_en',
    'eventos',
    'detalle',
]

/** Chat del equipo; las pruebas lo reemplazan con `fijarChatEquipo`. */
let chatEquipo: string | null | undefined

export function chatDelEquipo(): string | null {
    if (chatEquipo !== undefined) return chatEquipo
    return env.get('TELEGRAM_CHAT_EQUIPO') || null
}

/** Reemplaza el chat del equipo (`undefined` vuelve al entorno). Para pruebas. */
export function fijarChatEquipo(valor: string | null | undefined) {
    chatEquipo = valor
}

async function bloquearClave(trx: TransactionClientContract, clave: string) {
    await trx.rawQuery('SELECT pg_advisory_xact_lock(hashtext(?))', [`notify:incidente:${clave}`])
}

/**
 * Incidente abierto de `clave`. Con `ventanaMin`, uno cuyo último evento es más viejo que la
 * ventana se cierra en silencio (el problema dejó de repetirse) y se devuelve `null`.
 */
export async function incidenteAbierto(
    trx: TransactionClientContract,
    clave: string,
    opciones: { ahora: DateTime; ventanaMin?: number },
): Promise<Incidente | null> {
    const fila = (await trx
        .from('notify.incidentes')
        .where('clave', clave)
        .where('estado', 'abierto')
        .forUpdate()
        .select(COLUMNAS)
        .first()) as Incidente | null
    if (!fila) return null
    if (opciones.ventanaMin !== undefined) {
        const limite = opciones.ahora.minus({ minutes: opciones.ventanaMin }).toJSDate()
        if (fila.ultimo_en < limite) {
            await trx
                .from('notify.incidentes')
                .where('id', fila.id)
                .update({
                    estado: 'cerrado',
                    cerrado_en: fila.ultimo_en,
                    updated_at: trx.knexRawQuery('now()'),
                })
            return null
        }
    }
    return fila
}

export interface DatosIncidente {
    clave: string
    tipo: string
    detalle?: Record<string, unknown>
    ahora: DateTime
    /** minutos sin eventos tras los que un incidente abierto se da por terminado */
    ventanaMin?: number
    /** el incidente nace cerrado (hechos puntuales, p. ej. un cierre de caja) */
    puntual?: boolean
}

/** Abre el incidente de `clave` o, si ya hay uno abierto, suma el evento. */
export async function abrirIncidente(
    trx: TransactionClientContract,
    datos: DatosIncidente,
): Promise<{ incidente: Incidente; nuevo: boolean }> {
    await bloquearClave(trx, datos.clave)
    const ahora = datos.ahora.toJSDate()
    if (!datos.puntual) {
        const abierto = await incidenteAbierto(trx, datos.clave, datos)
        if (abierto) {
            const [actualizado] = (await trx
                .from('notify.incidentes')
                .where('id', abierto.id)
                .update({
                    eventos: trx.knexRawQuery('eventos + 1'),
                    ultimo_en: ahora,
                    updated_at: trx.knexRawQuery('now()'),
                })
                .returning(COLUMNAS)) as Incidente[]
            return { incidente: actualizado!, nuevo: false }
        }
    }
    const [creado] = (await trx
        .knexQuery()
        .table('notify.incidentes')
        .insert({
            clave: datos.clave,
            tipo: datos.tipo,
            estado: datos.puntual ? 'cerrado' : 'abierto',
            abierto_en: ahora,
            ultimo_en: ahora,
            cerrado_en: datos.puntual ? ahora : null,
            detalle: JSON.stringify(datos.detalle ?? {}),
        })
        .returning(COLUMNAS)) as Incidente[]
    return { incidente: creado!, nuevo: true }
}

/** Cierra el incidente abierto de `clave`; `null` si no había ninguno. */
export async function cerrarIncidente(
    trx: TransactionClientContract,
    clave: string,
    ahora: DateTime,
): Promise<Incidente | null> {
    await bloquearClave(trx, clave)
    const abierto = await incidenteAbierto(trx, clave, { ahora })
    if (!abierto) return null
    const [cerrado] = (await trx
        .from('notify.incidentes')
        .where('id', abierto.id)
        .update({ estado: 'cerrado', cerrado_en: ahora.toJSDate(), updated_at: trx.knexRawQuery('now()') })
        .returning(COLUMNAS)) as Incidente[]
    return cerrado!
}

/** Incidentes abiertos de un tipo (para revisar si ya se resolvieron). */
export async function incidentesAbiertos(trx: TransactionClientContract, tipo: string): Promise<Incidente[]> {
    return (await trx
        .from('notify.incidentes')
        .where('tipo', tipo)
        .where('estado', 'abierto')
        .orderBy('id')
        .select(COLUMNAS)) as Incidente[]
}

/**
 * Registra el envío de la alerta al chat del equipo. Plantilla: la de `notify.plantillas`
 * (`evento`, canal telegram); si no existe, el texto de `PLANTILLAS_ALERTA`; si existe pero está
 * desactivada, la alerta se silencia (devuelve `null`, el incidente igual queda registrado).
 * Sin chat del equipo o sin bot, el envío queda `fallido` con el motivo: visible en el panel.
 */
export async function crearAlerta(
    trx: TransactionClientContract,
    datos: {
        incidente: Incidente
        fase: FaseAlerta
        evento: string
        alerta: Variables
        requestId: string
    },
): Promise<EnvioCreado | null> {
    const enBase = (await trx
        .from('notify.plantillas')
        .where('evento', datos.evento)
        .where('canal', 'telegram')
        .select('asunto', 'cuerpo', 'activa')
        .first()) as { asunto: string | null; cuerpo: string; activa: boolean } | null
    if (enBase && !enBase.activa) return null
    const plantilla = enBase ?? PLANTILLAS_ALERTA.find((p) => p.evento === datos.evento)
    if (!plantilla) throw new Error(`Alerta sin plantilla: ${datos.evento}`)

    const chat = chatDelEquipo()
    const error = !chat
        ? 'TELEGRAM_CHAT_EQUIPO no configurado'
        : !canalDisponible('telegram')
          ? 'TELEGRAM_BOT_TOKEN no configurado'
          : undefined

    return crearEnvio(trx, {
        origen: `alerta:${datos.incidente.id}:${datos.fase}`,
        evento: datos.evento,
        clienteId: null,
        canal: 'telegram',
        destino: chat ?? '-',
        variables: { evento: datos.evento, empresa: await variablesEmpresa(trx), alerta: datos.alerta },
        plantilla,
        requestId: datos.requestId,
        error,
    })
}

/** Instante en Guatemala para mostrar: `16/10/2026 08:05`. */
export function instanteLocal(valor: DateTime | Date | string | null | undefined): string {
    if (!valor) return 'nunca'
    const dt =
        valor instanceof Date
            ? DateTime.fromJSDate(valor)
            : typeof valor === 'string'
              ? DateTime.fromISO(valor)
              : valor
    if (!dt.isValid) return String(valor)
    return dt.setZone(ZONA).toFormat('dd/MM/yyyy HH:mm')
}

/** Duración legible entre dos instantes: `45 min`, `2 h 5 min`, `3 d 4 h`. */
export function duracion(desde: Date, hasta: Date): string {
    const minutos = Math.max(0, Math.round((hasta.getTime() - desde.getTime()) / 60_000))
    if (minutos < 60) return `${minutos} min`
    const horas = Math.floor(minutos / 60)
    if (horas < 24) return minutos % 60 ? `${horas} h ${minutos % 60} min` : `${horas} h`
    const dias = Math.floor(horas / 24)
    return horas % 24 ? `${dias} d ${horas % 24} h` : `${dias} d`
}
