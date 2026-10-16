import type { QueryClientContract } from '@adonisjs/lucid/types/database'

/**
 * Datos de la empresa para documentos y mensajes del portal (`{{empresa.*}}`).
 * Hoy salen del entorno (`NOTIFY_EMPRESA_*`); la tarea 9 los pasa a la configuración de empresa
 * editable desde el panel.
 */
export interface DatosEmpresa {
    nombre: string
    nit: string | null
    direccion: string | null
    telefono: string | null
    whatsapp: string | null
    correo: string | null
    horario: string | null
    instrucciones_pago: string | null
}

export async function leerEmpresa(_cliente?: QueryClientContract): Promise<DatosEmpresa> {
    return {
        nombre: process.env.NOTIFY_EMPRESA_NOMBRE || 'ArgosIsp',
        nit: null,
        direccion: null,
        telefono: process.env.NOTIFY_EMPRESA_TELEFONO || null,
        whatsapp: null,
        correo: null,
        horario: null,
        instrucciones_pago: null,
    }
}
