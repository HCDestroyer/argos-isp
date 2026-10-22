import { DateTime } from 'luxon'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { ambito, configPara, disponibilidad, type ConfigCanales } from '#notify/configuracion'
import { crearEnvio, type EnvioCreado } from '#notify/envios'
import { PLANTILLAS_ALERTA } from '#notify/plantillas_base'
import { variablesEmpresa, type Variables } from '#notify/variables'
import { ZONA } from '#notify/formato'
import { EMPRESA_PRINCIPAL } from '#core/empresas'

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

/** Chat del equipo de la configuración global (panel; sin configuración, `TELEGRAM_CHAT_EQUIPO`). */
export function chatDelEquipo(config: ConfigCanales): string | null {
    if (chatEquipo !== undefined) return chatEquipo
    return config.telegram.chatEquipo
}

/** Reemplaza el chat del equipo (`undefined` vuelve a la configuración). Para pruebas. */
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
    /**
     * Con `puntual`: un hecho que se avisa una sola vez por `clave` aunque llegue en otro evento
     * (p. ej. la misma cadena rota informada dos veces). Si ya hubo un incidente con esa clave,
     * solo suma el evento y devuelve `nuevo: false`.
     */
    unico?: boolean
}

/** Abre el incidente de `clave` o, si ya hay uno abierto, suma el evento. */
export async function abrirIncidente(
    trx: TransactionClientContract,
    datos: DatosIncidente,
): Promise<{ incidente: Incidente; nuevo: boolean }> {
    await bloquearClave(trx, datos.clave)
    const ahora = datos.ahora.toJSDate()
    if (datos.puntual && datos.unico) {
        const previo = (await trx
            .from('notify.incidentes')
            .where('clave', datos.clave)
            .orderBy('id', 'desc')
            .select('id')
            .first()) as { id: number } | null
        if (previo) {
            const [actualizado] = (await trx
                .from('notify.incidentes')
                .where('id', previo.id)
                .update({
                    eventos: trx.knexRawQuery('eventos + 1'),
                    ultimo_en: ahora,
                    updated_at: trx.knexRawQuery('now()'),
                })
                .returning(COLUMNAS)) as Incidente[]
            return { incidente: actualizado!, nuevo: false }
        }
    }
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

/** Canales de una alerta: `telegram` (chat del equipo) y `correo` (contabilidad). */
export type CanalAlerta = 'telegram' | 'correo'

export interface DatosAlerta {
    incidente: Incidente
    fase: FaseAlerta
    evento: string
    alerta: Variables
    requestId: string
    /**
     * Empresa del incidente (alertas de Horus sobre un servicio, avisos fiscales): usa su
     * configuración de canales y su chat del equipo (o la global si hereda). Sin ella, la global.
     */
    empresaId?: number | null
    /** Por defecto solo `telegram` (alertas al equipo); los fiscales agregan `correo` (contabilidad). */
    canales?: CanalAlerta[]
}

/**
 * Registra el envío de la alerta al chat del equipo. Plantilla: la de `notify.plantillas`
 * (`evento`, canal telegram); si no existe, el texto de `PLANTILLAS_ALERTA`; si existe pero está
 * desactivada, la alerta se silencia (devuelve `null`, el incidente igual queda registrado).
 * Sin chat del equipo o sin bot, el envío queda `fallido` con el motivo: visible en el panel.
 */
export async function crearAlerta(
    trx: TransactionClientContract,
    datos: Omit<DatosAlerta, 'canales'>,
): Promise<EnvioCreado | null> {
    const [envio] = await crearAlertas(trx, { ...datos, canales: ['telegram'] })
    return envio ?? null
}

/**
 * Alerta por uno o varios canales con la configuración de canales de `empresaId` (la de la
 * empresa si tiene la suya con `hereda = false`; si no, la global): Telegram al chat del equipo de
 * esa configuración y correo a su `correo.contabilidad` (sin él, a los usuarios con rol
 * `contabilidad` de la empresa: `correosRolContabilidad`). Un envío por canal con el mismo origen
 * `alerta:<incidente>:<fase>` (único por canal). Por canal: plantilla desactivada → sin envío;
 * canal apagado → `omitido`; sin destino o sin canal configurado → `fallido` con el motivo.
 * `notify.envios.empresa_id` guarda la empresa: el envío sale con su configuración y su marca.
 */
export async function crearAlertas(
    trx: TransactionClientContract,
    datos: DatosAlerta,
): Promise<EnvioCreado[]> {
    const empresaId = datos.empresaId ?? null
    const canales = datos.canales ?? ['telegram']
    // Las alertas al equipo usan el interruptor de alertas de la configuración que aplica.
    const config = await configPara(empresaId)
    const variables: Variables = {
        evento: datos.evento,
        empresa: await variablesEmpresa(trx, empresaId ?? undefined),
        alerta: datos.alerta,
    }
    const envios: EnvioCreado[] = []
    for (const canal of canales) {
        const enBase = (await trx
            .from('notify.plantillas')
            .where('evento', datos.evento)
            .where('canal', canal)
            .select('asunto', 'cuerpo', 'activa')
            .first()) as { asunto: string | null; cuerpo: string; activa: boolean } | null
        if (enBase && !enBase.activa) continue
        const plantilla =
            enBase ?? PLANTILLAS_ALERTA.find((p) => p.evento === datos.evento && p.canal === canal)
        if (!plantilla) throw new Error(`Alerta sin plantilla: ${datos.evento} (${canal})`)

        const destino =
            canal === 'telegram'
                ? chatDelEquipo(config)
                : config.correo.contabilidad?.trim() || (await correosRolContabilidad(trx, empresaId))
        const uso = disponibilidad(config, canal, 'alertas')
        const omitido = uso.apagado ? uso.motivo : null
        const sinDestino =
            canal === 'telegram'
                ? 'Chat del equipo de Telegram no configurado'
                : `Correo de contabilidad no configurado en ${ambito(config)} y sin usuarios activos con rol contabilidad en la empresa`
        const error = omitido ? undefined : !destino ? sinDestino : (uso.motivo ?? undefined)

        envios.push(
            await crearEnvio(trx, {
                origen: `alerta:${datos.incidente.id}:${datos.fase}`,
                evento: datos.evento,
                clienteId: null,
                canal,
                destino: destino ?? '-',
                variables,
                plantilla,
                requestId: datos.requestId,
                error,
                omitido,
                empresaId,
            }),
        )
    }
    return envios
}

/**
 * Respaldo del correo a contabilidad (decisión del líder, fase 7): sin `correo.contabilidad` en la
 * configuración que aplica, los usuarios activos con rol `contabilidad` y acceso a la empresa
 * (`alcance_global` o fila en `core.usuarios_empresas`). Sin empresa, la principal. Direcciones
 * únicas (sin distinguir mayúsculas), en orden, separadas por coma; `null` si no hay ninguno.
 */
export async function correosRolContabilidad(
    trx: TransactionClientContract,
    empresaId: number | null,
): Promise<string | null> {
    const empresa = empresaId ?? EMPRESA_PRINCIPAL
    const filas = (await trx
        .from('core.usuarios as u')
        .join('core.usuarios_roles as ur', 'ur.usuario_id', 'u.id')
        .join('core.roles as r', 'r.id', 'ur.role_id')
        .where('r.nombre', 'contabilidad')
        .where('u.activo', true)
        .where((q) =>
            q
                .where('u.alcance_global', true)
                .orWhereExists((e) =>
                    e
                        .from('core.usuarios_empresas as ue')
                        .whereRaw('ue.usuario_id = u.id')
                        .where('ue.empresa_id', empresa),
                ),
        )
        .orderBy('u.id', 'asc')
        .select('u.email')) as Array<{ email: string | null }>
    const vistos = new Set<string>()
    const correos: string[] = []
    for (const { email } of filas) {
        const correo = email?.trim()
        if (!correo || vistos.has(correo.toLowerCase())) continue
        vistos.add(correo.toLowerCase())
        correos.push(correo)
    }
    return correos.length > 0 ? correos.join(', ') : null
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
