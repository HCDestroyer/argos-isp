import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { CanalNotificacion } from '#shared/eventos'
import { renderizar } from '#notify/plantillas'
import { avisoApagado, disponibilidad, type ConfigCanales } from '#notify/configuracion'
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

export type EstadoEnvio = 'encolado' | 'enviado' | 'fallido' | 'omitido'

export interface EnvioCreado {
    id: number
    canal: CanalNotificacion
    estado: EstadoEnvio
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

export interface EleccionCanal {
    canal: CanalNotificacion
    destino: string
    plantilla: Plantilla
    /** motivo si el canal o el tipo de aviso están apagados: el envío se registra `omitido` */
    omitido: string | null
}

/**
 * Canales por los que se avisa al cliente: todos los que sirven, para que el aviso le llegue por
 * cualquier medio (decisión del PM, 2026-10-15). Un canal sirve si el cliente tiene destino en
 * ese canal, hay plantilla activa y la configuración (`config`) lo tiene configurado. El
 * preferido va primero. Lista vacía si ninguno sirve.
 *
 * Si el tipo de aviso (`config.avisos`) o el canal están **apagados**, el canal igual se devuelve
 * con `omitido` = motivo: no se envía, pero queda registrado.
 */
export function elegirCanales(
    destinatario: Destinatario,
    plantillas: Map<CanalNotificacion, Plantilla>,
    config: ConfigCanales,
    evento: string,
): EleccionCanal[] {
    const candidatos = [
        ...new Set<CanalNotificacion>([destinatario.canalPreferido, 'correo', 'telegram', 'whatsapp']),
    ]
    const avisoOmitido = avisoApagado(config, evento)
    const elegidos: EleccionCanal[] = []
    for (const canal of candidatos) {
        const plantilla = plantillas.get(canal)
        const destino = destinoDe(canal, destinatario)
        if (!plantilla || !destino) continue
        if (avisoOmitido) {
            elegidos.push({ canal, destino, plantilla, omitido: avisoOmitido })
            continue
        }
        const uso = disponibilidad(config, canal, 'clientes')
        if (uso.canal) elegidos.push({ canal, destino, plantilla, omitido: null })
        else if (uso.apagado) elegidos.push({ canal, destino, plantilla, omitido: uso.motivo })
    }
    return elegidos
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
    /** `omitido` de entrada, con su motivo (canal o tipo de aviso apagado) */
    omitido?: string | null
    /** empresa cuya configuración se aplicó (null = global) */
    empresaId?: number | null
}

/** Renderiza la plantilla y registra el envío. Idempotente por `(origen, cliente_id, canal)`. */
export async function crearEnvio(trx: TransactionClientContract, datos: DatosEnvio): Promise<EnvioCreado> {
    const asunto = datos.plantilla.asunto ? renderizar(datos.plantilla.asunto, datos.variables).trim() : null
    const cuerpo = renderizar(datos.plantilla.cuerpo, datos.variables).trim()
    const estado: EstadoEnvio = datos.omitido ? 'omitido' : datos.error ? 'fallido' : 'encolado'

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
            error: datos.omitido ? null : (datos.error ?? null),
            motivo: datos.omitido ?? null,
            empresa_id: datos.empresaId ?? null,
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
