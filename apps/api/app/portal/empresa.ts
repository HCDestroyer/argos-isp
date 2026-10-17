import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'

/**
 * Configuración de la empresa: la editan en el panel (`PUT /empresa`, acción `empresa.editar`) y
 * la leen `/corte`, el portal, el código de acceso y los documentos (`{{empresa.*}}`).
 *
 * Multiempresa (A1, `contratos/multiempresa.md`): los datos viven en `core.empresas`. Esta vista
 * conserva los nombres de siempre (`nombre` = `nombre_comercial`, `direccion` =
 * `direccion_fiscal`) y lee la empresa 1 (la principal) salvo que se pase otra.
 *
 * Con `version = 0` (la empresa 1 nunca se guardó) se usan los valores por defecto: `nombre` de
 * `NOTIFY_EMPRESA_NOMBRE` (o "ArgosIsp"), `telefono` de `NOTIFY_EMPRESA_TELEFONO` y lo demás vacío.
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

/** Columna de `core.empresas` de cada campo de la vista. */
export const COLUMNA_EMPRESA: Record<(typeof CAMPOS_EMPRESA)[number], string> = {
    nombre: 'nombre_comercial',
    nit: 'nit',
    direccion: 'direccion_fiscal',
    telefono: 'telefono',
    telefono_alterno: 'telefono_alterno',
    whatsapp: 'whatsapp',
    correo: 'correo',
    horario: 'horario',
    instrucciones_pago: 'instrucciones_pago',
}

/**
 * Datos de la empresa `empresaId` (por defecto la 1, la principal). Una empresa que no existe
 * devuelve los valores por defecto (como la empresa 1 sin guardar).
 */
export async function verEmpresa(
    cliente: QueryClientContract = db.connection(),
    empresaId: number = 1,
): Promise<EmpresaVista> {
    const fila = (await cliente
        .from('core.empresas')
        .where('id', empresaId)
        .select(...CAMPOS_EMPRESA.map((campo) => `${COLUMNA_EMPRESA[campo]} as ${campo}`), 'version')
        .first()) as EmpresaVista | null
    if (!fila || Number(fila.version) === 0) return empresaPorDefecto()
    return { ...fila, version: Number(fila.version) }
}

/** Datos de la empresa sin `version` (documentos y mensajes). */
export async function leerEmpresa(cliente?: QueryClientContract, empresaId?: number): Promise<DatosEmpresa> {
    return sinVersion(await verEmpresa(cliente, empresaId))
}

export function sinVersion(empresa: EmpresaVista): DatosEmpresa {
    const datos = {} as Record<(typeof CAMPOS_EMPRESA)[number], string | null>
    for (const campo of CAMPOS_EMPRESA) datos[campo] = empresa[campo]
    return datos as DatosEmpresa
}
