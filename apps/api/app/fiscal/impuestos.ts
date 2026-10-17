import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado } from '#shared/errores'
import { ParametroSinConfirmar } from '#fiscal/errores'
import { datosFiscales, type FilaImpuesto } from '#fiscal/parametros'

/**
 * Impuestos como entidad con vigencia (`fiscal.impuestos` + `fiscal.impuestos_versiones`, solo
 * inserción). Cada versión trae la tasa (con signo: las retenciones son negativas), el cálculo, la
 * cuenta de la cuota, la de transición y las cuadrículas de base y cuota.
 *
 * Se leen igual que los parámetros: la versión más reciente con `vigente_desde <= fecha`, primero
 * la de la empresa, luego la global (`origen = usuario`) y luego la del paquete. Comparten la caché
 * y su invalidación (`fiscal.parametros_cambiados` con la clave `impuesto:<codigo>`).
 */

export type NivelImpuesto = 'empresa' | 'global' | 'paquete'

export interface ImpuestoVigente extends FilaImpuesto {
    nivel: NivelImpuesto
}

function nivelDe(fila: FilaImpuesto): NivelImpuesto {
    if (fila.empresa_id !== null) return 'empresa'
    return fila.origen === 'paquete' ? 'paquete' : 'global'
}

/** Versión vigente de `codigo` en `fecha` entre `filas`, o null. */
export function resolverImpuesto(
    filas: FilaImpuesto[],
    codigo: string,
    fecha: string,
): ImpuestoVigente | null {
    const porNivel = new Map<NivelImpuesto, FilaImpuesto>()
    for (const fila of filas) {
        if (fila.codigo !== codigo || fila.vigente_desde > fecha) continue
        porNivel.set(nivelDe(fila), fila)
    }
    for (const nivel of ['empresa', 'global', 'paquete'] as const) {
        const fila = porNivel.get(nivel)
        if (fila) return { ...fila, nivel }
    }
    return null
}

/**
 * Versión vigente del impuesto para la empresa en `fecha`. 404 si el país no lo tiene; 422
 * `parametro_sin_confirmar` (campo `impuesto:<codigo>`) si no hay versión vigente en esa fecha.
 */
export async function impuesto(
    empresaId: number,
    codigo: string,
    fecha: string,
    cliente?: QueryClientContract,
): Promise<ImpuestoVigente> {
    const datos = await datosFiscales(empresaId, cliente)
    if (!datos.impuestos.some((f) => f.codigo === codigo)) {
        throw new NoEncontrado(`El impuesto ${codigo} no existe para ${datos.pais}`)
    }
    const vigente = resolverImpuesto(datos.impuestos, codigo, fecha)
    if (!vigente) throw new ParametroSinConfirmar(`impuesto:${codigo}`, fecha)
    return vigente
}

/** Todos los impuestos del país con su versión vigente en `fecha` (los sin versión, fuera). */
export async function impuestosVigentes(
    empresaId: number,
    fecha: string,
    cliente?: QueryClientContract,
): Promise<ImpuestoVigente[]> {
    const datos = await datosFiscales(empresaId, cliente)
    const codigos = [...new Set(datos.impuestos.map((f) => f.codigo))].sort()
    return codigos
        .map((codigo) => resolverImpuesto(datos.impuestos, codigo, fecha))
        .filter((v): v is ImpuestoVigente => v !== null)
}

/** Vigente hoy y todas las versiones (empresa y globales) de un impuesto. */
export async function historialImpuesto(empresaId: number, codigo: string, fecha: string) {
    const datos = await datosFiscales(empresaId, undefined)
    const filas = datos.impuestos.filter((f) => f.codigo === codigo)
    if (filas.length === 0) throw new NoEncontrado(`El impuesto ${codigo} no existe para ${datos.pais}`)
    return {
        vigente: resolverImpuesto(datos.impuestos, codigo, fecha),
        versiones: filas.map((f) => ({ ...f, nivel: nivelDe(f) })),
    }
}
