import type { QueryClientContract } from '@adonisjs/lucid/types/database'

/**
 * Nombre de la empresa para los mensajes del portal (código de acceso).
 * Hoy sale de `NOTIFY_EMPRESA_NOMBRE`; la tarea 9 lo pasa a la configuración de empresa.
 */
export async function nombreEmpresa(_cliente: QueryClientContract): Promise<string> {
    return process.env.NOTIFY_EMPRESA_NOMBRE || 'ArgosIsp'
}
