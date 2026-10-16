import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'

/**
 * Configuración de la empresa (`core.empresa`, una fila): la editan en el panel
 * (`PUT /empresa`, acción `empresa.editar`) y la leen `/corte`, el portal, el código de acceso y
 * los documentos (`{{empresa.*}}`).
 *
 * Sin fila (nadie la ha guardado) se usan los valores por defecto: `nombre` de
 * `NOTIFY_EMPRESA_NOMBRE` (o "ArgosIsp"), `telefono` de `NOTIFY_EMPRESA_TELEFONO` y lo demás
 * vacío, con `version = 0`.
 */

export const CAMPOS_EMPRESA = [
    'nombre',
    'nit',
    'direccion',
    'telefono',
    'telefono_alterno',
    'whatsapp',
    'correo',
    'horario',
    'instrucciones_pago',
] as const

export interface DatosEmpresa {
    nombre: string
    nit: string | null
    direccion: string | null
    telefono: string | null
    telefono_alterno: string | null
    whatsapp: string | null
    correo: string | null
    horario: string | null
    instrucciones_pago: string | null
}

export interface EmpresaVista extends DatosEmpresa {
    /** 0 = valores por defecto (nadie la ha guardado) */
    version: number
}

export function empresaPorDefecto(entorno: NodeJS.ProcessEnv = process.env): EmpresaVista {
    return {
        nombre: entorno.NOTIFY_EMPRESA_NOMBRE || 'ArgosIsp',
        nit: null,
        direccion: null,
        telefono: entorno.NOTIFY_EMPRESA_TELEFONO || null,
        telefono_alterno: null,
        whatsapp: null,
        correo: null,
        horario: null,
        instrucciones_pago: null,
        version: 0,
    }
}

export async function verEmpresa(cliente: QueryClientContract = db.connection()): Promise<EmpresaVista> {
    const fila = (await cliente
        .from('core.empresa')
        .where('id', 1)
        .select(...CAMPOS_EMPRESA, 'version')
        .first()) as EmpresaVista | null
    return fila ? { ...fila, version: Number(fila.version) } : empresaPorDefecto()
}

/** Datos de la empresa sin `version` (documentos y mensajes). */
export async function leerEmpresa(cliente?: QueryClientContract): Promise<DatosEmpresa> {
    return sinVersion(await verEmpresa(cliente))
}

export function sinVersion(empresa: EmpresaVista): DatosEmpresa {
    const datos = {} as Record<(typeof CAMPOS_EMPRESA)[number], string | null>
    for (const campo of CAMPOS_EMPRESA) datos[campo] = empresa[campo]
    return datos as DatosEmpresa
}
