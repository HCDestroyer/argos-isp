import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { CanalNotificacion } from '#shared/eventos'
import { renderizar } from '#notify/plantillas'
import { canalDisponible } from '#notify/canales/registro'
import type { Destinatario, Variables } from '#notify/variables'

/**
 * Piezas compartidas por las acciones de notify para elegir canal y registrar envíos en
 * `notify.envios`. No se llaman fuera de una acción (reciben la transacción de la acción).
 */

export interface Plantilla {
    id: number
    evento: string
    canal: CanalNotificacion
    asunto: string | null
    cuerpo: string
}

export interface EnvioCreado {
    id: number
    canal: CanalNotificacion
    estado: 'encolado' | 'enviado' | 'fallido'
    nuevo: boolean
}

/** Plantillas activas de un evento, por canal. */
export async function plantillasActivas(
    trx: TransactionClientContract,
    evento: string,
): Promise<Map<CanalNotificacion, Plantilla>> {
    const filas = (await trx
        .from('notify.plantillas')
        .where('evento', evento)
        .where('activa', true)
        .select('id', 'evento', 'canal', 'asunto', 'cuerpo')) as Plantilla[]
    return new Map(filas.map((p) => [p.canal, p]))
}

export function destinoDe(canal: CanalNotificacion, destinatario: Destinatario): string | null {
    if (canal === 'correo') return destinatario.email
    if (canal === 'telegram') return destinatario.telegramChatId
    return null
}

/**
 * Canal del cliente con fallback a correo: el preferido si el adaptador está configurado, el
 * cliente tiene destino en ese canal y hay plantilla activa; si no, correo con las mismas
 * condiciones. `null` si ninguno sirve.
 */
export function elegirCanal(
    destinatario: Destinatario,
    plantillas: Map<CanalNotificacion, Plantilla>,
): { canal: CanalNotificacion; destino: string; plantilla: Plantilla } | null {
    const candidatos = [...new Set<CanalNotificacion>([destinatario.canalPreferido, 'correo'])]
    for (const canal of candidatos) {
        const plantilla = plantillas.get(canal)
        const destino = destinoDe(canal, destinatario)
        if (plantilla && destino && canalDisponible(canal)) return { canal, destino, plantilla }
    }
    return null
}

/** Serializa en la transacción el trabajo sobre un mismo origen (dos entregas simultáneas del evento). */
export async function bloquearOrigen(trx: TransactionClientContract, origen: string) {
    await trx.rawQuery('SELECT pg_advisory_xact_lock(hashtext(?))', [`notify:${origen}`])
}

/** Envíos ya registrados para un origen y cliente (o sin cliente, para alertas internas). */
export async function enviosExistentes(
    trx: TransactionClientContract,
    origen: string,
    clienteId: number | null,
): Promise<EnvioCreado[]> {
    const consulta = trx.from('notify.envios').where('origen', origen).select('id', 'canal', 'estado')
    if (clienteId === null) consulta.whereNull('cliente_id')
    else consulta.where('cliente_id', clienteId)
    const filas = (await consulta.orderBy('id')) as Array<Omit<EnvioCreado, 'nuevo'>>
    return filas.map((f) => ({ ...f, nuevo: false }))
}

export interface DatosEnvio {
    origen: string
    evento: string
    clienteId: number | null
    canal: CanalNotificacion
    destino: string
    variables: Variables
    plantilla: Pick<Plantilla, 'asunto' | 'cuerpo'>
    requestId: string
    fallbackDe?: number
    /** fallido de entrada (sin destino); por defecto `encolado` */
    error?: string
}

/** Renderiza la plantilla y registra el envío. Idempotente por `(origen, cliente_id, canal)`. */
export async function crearEnvio(trx: TransactionClientContract, datos: DatosEnvio): Promise<EnvioCreado> {
    const asunto = datos.plantilla.asunto ? renderizar(datos.plantilla.asunto, datos.variables).trim() : null
    const cuerpo = renderizar(datos.plantilla.cuerpo, datos.variables).trim()
    const estado = datos.error ? 'fallido' : 'encolado'

    const insertadas = (await trx
        .knexQuery()
        .table('notify.envios')
        .insert({
            origen: datos.origen,
            evento: datos.evento,
            cliente_id: datos.clienteId,
            canal: datos.canal,
            destino: datos.destino,
            asunto,
            cuerpo,
            variables: JSON.stringify(datos.variables),
            estado,
            error: datos.error ?? null,
            fallback_de: datos.fallbackDe ?? null,
            request_id: datos.requestId,
        })
        .onConflict(['origen', 'cliente_id', 'canal'])
        .ignore()
        .returning(['id', 'canal', 'estado'])) as Array<Omit<EnvioCreado, 'nuevo'>>

    const fila = insertadas[0]
    if (fila) return { ...fila, nuevo: true }

    const consulta = trx
        .from('notify.envios')
        .where('origen', datos.origen)
        .where('canal', datos.canal)
        .select('id', 'canal', 'estado')
    if (datos.clienteId === null) consulta.whereNull('cliente_id')
    else consulta.where('cliente_id', datos.clienteId)
    const existente = (await consulta.firstOrFail()) as Omit<EnvioCreado, 'nuevo'>
    return { ...existente, nuevo: false }
}
