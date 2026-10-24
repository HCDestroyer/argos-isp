import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado, ValidacionFallida, type ErrorCampo } from '#shared/errores'
import type { ContextoAccion } from '#shared/contexto'

/**
 * Catálogo de campos personalizados del cliente (`core.campos_personalizados`, pedido de A4).
 *
 * - Define qué claves de `core.clientes.campos_personalizados` existen, su etiqueta, su tipo
 *   (`texto`, `numero`, `fecha` `YYYY-MM-DD`, `booleano`, `opcion` con su lista), si es requerido y
 *   el orden en la ficha. `clave` y `tipo` no cambian al editar (los valores guardados seguirían
 *   el tipo viejo); un campo se desactiva, nunca se borra.
 * - `validarCamposPersonalizados` lo aplican `clientes.crear` y `clientes.editar`: cada valor de un
 *   campo activo debe ser de su tipo (422 `campos_personalizados.<clave>`); `null` = vacío. Las
 *   claves fuera del catálogo o de campos inactivos se guardan tal cual (las del importador, como
 *   `mikrowisp_id`, y los datos de un campo que se desactivó).
 * - Requeridos: en el alta, y en la edición cuando llega `campos_personalizados` (se reemplaza
 *   completo). No se exigen al actor `sistema` (importador): los datos históricos pueden no traerlos.
 */

export const TIPOS_CAMPO_PERSONALIZADO = ['texto', 'numero', 'fecha', 'booleano', 'opcion'] as const
export type TipoCampoPersonalizado = (typeof TIPOS_CAMPO_PERSONALIZADO)[number]

/** Largo máximo de un valor `texto`. */
export const LARGO_MAXIMO_TEXTO = 500

export interface CampoPersonalizadoVista {
    id: number
    clave: string
    etiqueta: string
    tipo: TipoCampoPersonalizado
    /** valores permitidos (solo `opcion`; vacía en los demás) */
    opciones: string[]
    requerido: boolean
    orden: number
    activo: boolean
    version: number
    created_at: string
    updated_at: string
}

const COLUMNAS = [
    'id',
    'clave',
    'etiqueta',
    'tipo',
    'opciones',
    'requerido',
    'orden',
    'activo',
    'version',
    'created_at',
    'updated_at',
]

function plano(fila: CampoPersonalizadoVista): CampoPersonalizadoVista {
    return { ...fila, id: Number(fila.id), orden: Number(fila.orden) }
}

/** Catálogo en el orden de la ficha (`orden`, luego `etiqueta`). `activo` filtra. */
export async function listarCamposPersonalizados(
    filtros: { activo?: boolean } = {},
    cliente: QueryClientContract = db.connection(),
): Promise<CampoPersonalizadoVista[]> {
    const consulta = cliente.from('core.campos_personalizados').select(COLUMNAS)
    if (filtros.activo !== undefined) consulta.where('activo', filtros.activo)
    const filas = (await consulta.orderBy([
        { column: 'orden', order: 'asc' },
        { column: 'etiqueta', order: 'asc' },
        { column: 'id', order: 'asc' },
    ])) as CampoPersonalizadoVista[]
    return filas.map(plano)
}

export async function verCampoPersonalizado(
    id: number,
    cliente: QueryClientContract = db.connection(),
): Promise<CampoPersonalizadoVista> {
    const fila = (await cliente
        .from('core.campos_personalizados')
        .where('id', id)
        .select(COLUMNAS)
        .first()) as CampoPersonalizadoVista | null
    if (!fila) throw new NoEncontrado(`El campo personalizado ${id} no existe`)
    return plano(fila)
}

/** Opciones de un campo: sin espacios de más, sin vacías ni repetidas (422 si quedan mal). */
export function normalizarOpciones(
    tipo: TipoCampoPersonalizado,
    opciones: string[] | undefined,
    actuales: string[] = [],
): string[] {
    const lista = (opciones ?? actuales).map((o) => o.trim())
    if (tipo !== 'opcion') {
        if (lista.length > 0) {
            throw new ValidacionFallida([
                {
                    field: 'opciones',
                    message: 'Solo un campo de tipo opcion lleva opciones',
                    rule: 'prohibido',
                },
            ])
        }
        return []
    }
    if (lista.length === 0 || lista.some((o) => o === '')) {
        throw new ValidacionFallida([
            {
                field: 'opciones',
                message: 'Un campo de tipo opcion necesita al menos una opción no vacía',
                rule: 'required',
            },
        ])
    }
    if (new Set(lista).size !== lista.length) {
        throw new ValidacionFallida([{ field: 'opciones', message: 'Hay opciones repetidas', rule: 'unico' }])
    }
    return lista
}

function fechaValida(valor: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(valor) && DateTime.fromISO(valor).isValid
}

function errorDeTipo(campo: CampoPersonalizadoVista, valor: unknown): string | null {
    switch (campo.tipo) {
        case 'texto':
            if (typeof valor !== 'string') return `${campo.etiqueta}: debe ser texto`
            if (valor.length > LARGO_MAXIMO_TEXTO) {
                return `${campo.etiqueta}: máximo ${LARGO_MAXIMO_TEXTO} caracteres`
            }
            return null
        case 'numero':
            return typeof valor === 'number' && Number.isFinite(valor)
                ? null
                : `${campo.etiqueta}: debe ser un número`
        case 'fecha':
            return typeof valor === 'string' && fechaValida(valor)
                ? null
                : `${campo.etiqueta}: debe ser una fecha AAAA-MM-DD`
        case 'booleano':
            return typeof valor === 'boolean' ? null : `${campo.etiqueta}: debe ser verdadero o falso`
        case 'opcion':
            return typeof valor === 'string' && campo.opciones.includes(valor)
                ? null
                : `${campo.etiqueta}: debe ser una de ${campo.opciones.join(', ')}`
    }
}

function vacio(valor: unknown): boolean {
    return valor === undefined || valor === null || (typeof valor === 'string' && valor.trim() === '')
}

/**
 * Valida `campos_personalizados` contra el catálogo activo. `exigirRequeridos`: los campos
 * requeridos deben venir con valor. Lanza un 422 con un error por clave.
 */
export async function validarCamposPersonalizados(
    cliente: QueryClientContract,
    valores: Record<string, unknown>,
    opciones: { exigirRequeridos: boolean },
): Promise<void> {
    const catalogo = await listarCamposPersonalizados({ activo: true }, cliente)
    const errores: ErrorCampo[] = []
    for (const campo of catalogo) {
        const valor = valores[campo.clave]
        const field = `campos_personalizados.${campo.clave}`
        if (vacio(valor)) {
            if (opciones.exigirRequeridos && campo.requerido) {
                errores.push({ field, message: `${campo.etiqueta} es obligatorio`, rule: 'required' })
            }
            continue
        }
        const mensaje = errorDeTipo(campo, valor)
        if (mensaje) errores.push({ field, message: mensaje, rule: campo.tipo })
    }
    if (errores.length > 0) {
        throw new ValidacionFallida(errores, 'Hay campos personalizados con valores inválidos o faltantes')
    }
}

/** El importador (actor `sistema`) carga datos históricos: no se le exigen los requeridos. */
export function exigeRequeridos(ctx: ContextoAccion): boolean {
    return ctx.actor.tipo !== 'sistema'
}
