import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { cifrar, descifrar } from '#shared/cifrado'
import {
    camposProveedor,
    proveedorFel,
    registrarProveedorFel,
    type AmbienteFel,
    type CredencialesFel,
} from '#fiscal/fel/proveedor'
import { ProveedorFelFalso } from '#fiscal/fel/falso'
import { ProveedorFelInfile } from '#fiscal/fel/infile'

/**
 * Configuración FEL por empresa (`fiscal.fel_configuracion`) y credenciales cifradas
 * (`fiscal.fel_credenciales`). Contrato §3.6 y §8.3.
 *
 * - Sin fila, la empresa está en `desactivada` (como las existentes al migrar): nada cambia.
 * - Las credenciales se guardan cifradas con la clave de la instalación (`#shared/cifrado`, la
 *   misma de notify); se descifran solo para enviar y nunca salen por la API ni a la auditoría.
 */

registrarProveedorFel(new ProveedorFelInfile(), {
    obligatorios: ['usuario_firma', 'llave_firma', 'usuario_api', 'llave_api'],
    visibles: ['usuario_firma', 'usuario_api', 'correo_copia'],
})
registrarProveedorFel(new ProveedorFelFalso(), {
    obligatorios: ['usuario', 'llave'],
    visibles: ['usuario'],
})

export type ModoFel = 'obligatoria' | 'opcional' | 'desactivada'
export type CertificarAl = 'emitir' | 'pagar' | 'nunca'

export interface ConfiguracionFel {
    empresa_id: number
    proveedor: string | null
    ambiente: AmbienteFel
    modo: ModoFel
    contingencia_activa: boolean
    contingencia_motivo: string | null
    contingencia_desde: Date | null
    version: number
    updated_at: Date | null
}

export async function configuracionFel(
    empresaId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<ConfiguracionFel> {
    const fila = (await cliente
        .from('fiscal.fel_configuracion')
        .where('empresa_id', empresaId)
        .first()) as ConfiguracionFel | null
    if (!fila) {
        return {
            empresa_id: empresaId,
            proveedor: null,
            ambiente: 'pruebas',
            modo: 'desactivada',
            contingencia_activa: false,
            contingencia_motivo: null,
            contingencia_desde: null,
            version: 0,
            updated_at: null,
        }
    }
    return { ...fila, empresa_id: Number(fila.empresa_id), version: Number(fila.version) }
}

/**
 * Cómo nace una factura según el modo de la empresa y su `certificar_al` (contrato §8.3):
 *
 * - `sin_fel`: FEL desactivada, o `opcional` con `emitir`/`nunca` (se certifica a mano). Como hoy:
 *   IVA a `2.1.02`.
 * - `aviso`: `certificar_al = pagar` con FEL obligatoria u opcional. Nace emitida como aviso de
 *   cobro con el IVA en `2.1.11` y se certifica cuando queda cubierta.
 * - `por_certificar`: obligatoria con `emitir` (o `nunca`, que no se admite en obligatoria): sin
 *   asiento ni evento hasta certificarse.
 * - `contingencia`: obligatoria con `emitir` y contingencia activa: se emite como hoy y el DTE
 *   queda en contingencia.
 */
export type ModoEmision = 'sin_fel' | 'aviso' | 'por_certificar' | 'contingencia'

export function modoEmision(config: ConfiguracionFel, certificarAl: CertificarAl): ModoEmision {
    if (config.modo === 'desactivada') return 'sin_fel'
    if (certificarAl === 'pagar') return 'aviso'
    if (config.modo === 'opcional') return 'sin_fel'
    return config.contingencia_activa ? 'contingencia' : 'por_certificar'
}

export function cifrarCredenciales(datos: CredencialesFel): string {
    return cifrar(JSON.stringify(datos))
}

export interface FilaCredenciales {
    id: number
    empresa_id: number
    proveedor: string
    ambiente: AmbienteFel
    campos_visibles: Record<string, string>
    probada_en: Date | null
    resultado_prueba: { ok: boolean; detalle: string } | null
    version: number
    updated_at: Date
}

/** Credenciales descifradas para enviar; null si no hay. */
export async function credencialesFel(
    empresaId: number,
    proveedor: string,
    ambiente: AmbienteFel,
    cliente: QueryClientContract = db.connection(),
): Promise<CredencialesFel | null> {
    const fila = (await cliente
        .from('fiscal.fel_credenciales')
        .where({ empresa_id: empresaId, proveedor, ambiente })
        .select('datos')
        .first()) as { datos: string } | null
    if (!fila) return null
    return JSON.parse(descifrar(fila.datos)) as CredencialesFel
}

/** Vista sin secretos (lo que devuelve la API). */
export async function vistaCredenciales(
    empresaId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<FilaCredenciales[]> {
    const filas = (await cliente
        .from('fiscal.fel_credenciales')
        .where('empresa_id', empresaId)
        .orderBy(['proveedor', 'ambiente'])
        .select(
            'id',
            'empresa_id',
            'proveedor',
            'ambiente',
            'campos_visibles',
            'probada_en',
            'resultado_prueba',
            'version',
            'updated_at',
        )) as FilaCredenciales[]
    return filas.map((f) => ({ ...f, id: Number(f.id), empresa_id: Number(f.empresa_id) }))
}

/** Lo que de unas credenciales se puede mostrar (usuario, prefijo de la llave nunca). */
export function camposVisibles(proveedor: string, datos: CredencialesFel): Record<string, string> {
    const campos = camposProveedor(proveedor)
    const salida: Record<string, string> = {}
    for (const campo of campos?.visibles ?? []) {
        if (datos[campo]) salida[campo] = datos[campo]
    }
    return salida
}

export { proveedorFel, camposProveedor }
