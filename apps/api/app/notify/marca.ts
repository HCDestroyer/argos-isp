import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import type { ConfigCanales } from '#notify/configuracion'

/**
 * Marca de la empresa en los envíos (`contratos/multiempresa.md`, "Notificaciones"): el remitente
 * del correo es único en la fase 1 (la configuración global) y lleva en el **nombre visible** el
 * nombre comercial de la empresa del aviso.
 *
 * - Una empresa con su propia configuración de correo y su propio nombre visible: manda ese
 *   nombre (ya viene en la configuración; aquí no se cambia).
 * - Si no, el nombre comercial de la empresa del aviso, si la empresa se guardó alguna vez
 *   (`version > 0`). La empresa 1 sin guardar conserva el nombre de la configuración (como antes
 *   de multiempresa).
 * - Sin empresa (alertas internas, mensajes sin servicio): el de la configuración.
 *
 * Devuelve `null` cuando manda el nombre de la configuración.
 */
export async function nombreRemitente(
    cliente: QueryClientContract,
    config: ConfigCanales,
    empresaId: number | null | undefined,
): Promise<string | null> {
    if (!empresaId) return null
    if (config.origen === 'empresa' && config.correo.nombre) return null
    const fila = (await cliente
        .from('core.empresas')
        .where('id', empresaId)
        .select('nombre_comercial', 'version')
        .first()) as { nombre_comercial: string | null; version: number } | null
    if (!fila || Number(fila.version) === 0) return null
    return fila.nombre_comercial?.trim() || null
}
