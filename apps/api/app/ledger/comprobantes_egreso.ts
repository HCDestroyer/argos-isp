import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado, ValidacionFallida } from '#shared/errores'
import {
    TAMANO_MAXIMO_COMPROBANTE,
    detectarTipoComprobante,
    nuevaRutaComprobante,
    type TipoComprobante,
} from '#billing/comprobantes_archivos'

/**
 * Comprobante (foto o PDF) de un egreso: obligatorio en todo gasto de caja chica (B9, §5.7). El
 * archivo vive en el almacenamiento compartido de los comprobantes (`COMPROBANTES_DIR/egresos/…`,
 * regla 14), nunca en la base ni en el disco de una sola instancia; `ledger.egresos_comprobantes`
 * guarda la ruta, el tipo y el tamaño (una fila por egreso, solo inserción).
 */

export interface ArchivoSubido {
    contenido: Uint8Array
    nombre?: string | null
}

/** El archivo que se guarda en la auditoría: nombre y tamaño, nunca el contenido. */
export class ArchivoAuditable {
    constructor(
        readonly contenido: Uint8Array,
        readonly nombre: string | null,
    ) {}

    toJSON() {
        return { nombre: this.nombre, bytes: this.contenido.length }
    }
}

export function auditable(archivo: ArchivoSubido | null | undefined): ArchivoAuditable | null {
    if (!archivo) return null
    return new ArchivoAuditable(archivo.contenido, archivo.nombre?.trim() || null)
}

/** 422 en `archivo` (required, tamano o tipo); devuelve el tipo y la ruta nueva. */
export function validarArchivoComprobante(archivo: ArchivoSubido | null | undefined): {
    tipo: TipoComprobante
    ruta: string
} {
    const contenido = archivo?.contenido
    if (!contenido || contenido.length === 0) {
        throw new ValidacionFallida([
            {
                field: 'archivo',
                message: 'El comprobante es obligatorio: foto del ticket, factura o recibo firmado',
                rule: 'required',
            },
        ])
    }
    if (contenido.length > TAMANO_MAXIMO_COMPROBANTE) {
        throw new ValidacionFallida([{ field: 'archivo', message: 'El máximo es 5 MB', rule: 'tamano' }])
    }
    const tipo = detectarTipoComprobante(contenido)
    if (!tipo) {
        throw new ValidacionFallida([
            { field: 'archivo', message: 'Solo fotos JPG, PNG o WebP, o un PDF', rule: 'tipo' },
        ])
    }
    return { tipo, ruta: `egresos/${nuevaRutaComprobante(tipo)}` }
}

export interface ComprobanteEgresoVista {
    egreso_id: number
    empresa_id: number
    tipo: TipoComprobante
    tamano: number
    nombre: string | null
    subido_por: number | null
    created_at: Date
}

export async function comprobanteDeEgreso(
    egresoId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<(ComprobanteEgresoVista & { archivo: string }) | null> {
    const fila = (await cliente
        .from('ledger.egresos_comprobantes')
        .where('egreso_id', egresoId)
        .select('egreso_id', 'empresa_id', 'archivo', 'tipo', 'tamano', 'nombre', 'subido_por', 'created_at')
        .first()) as (ComprobanteEgresoVista & { archivo: string }) | null
    if (!fila) return null
    return {
        ...fila,
        egreso_id: Number(fila.egreso_id),
        empresa_id: Number(fila.empresa_id),
        tamano: Number(fila.tamano),
        subido_por: fila.subido_por === null ? null : Number(fila.subido_por),
    }
}

export async function exigirComprobanteDeEgreso(egresoId: number) {
    const fila = await comprobanteDeEgreso(egresoId)
    if (!fila) throw new NoEncontrado(`El egreso ${egresoId} no tiene comprobante`)
    return fila
}
