import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import type { ProblemaJson } from '#shared/errores'
import { idsEmpresasActivas } from '#core/empresas'
import { hoyFiscal } from '#fiscal/comun'
import { datosFiscales, resolver } from '#fiscal/parametros'
import { instalacionVigente } from '#fiscal/instalador'
import { tableroFiscal, type TableroEmpresa } from '#fiscal/tablero'
import { compararRegimenes, type ComparadorEmpresa } from '#fiscal/comparador'
import type { Bloque } from '#fiscal/bloques'
import {
    CONSEJOS_POR_PAIS,
    type DefinicionConsejo,
    type EntradaConsejo,
    type FuenteConsejo,
} from '#fiscal/l10n/gt/consejos'

/**
 * Consejos fiscales (`GET /fiscal/consejos`, contrato §9.4; fase 8 PR C). Se evalúan con las cifras
 * del tablero y del comparador (los mismos cálculos de sus endpoints) y los parámetros vigentes; un
 * consejo no calcula cifras propias. Solo lectura: no toca nada contable ni el régimen.
 *
 * Estados: `aplica` (con su texto y las cifras de los bloques), `no_aplica` (la condición no se cumple o
 * no es del régimen), `sin_datos` (un bloque fuente está en error: va el error y ningún texto). `oculto`:
 * la última fila de `fiscal.consejos_ocultos` del usuario o, si no tiene, de la empresa.
 */

export const AVISO_CONSEJOS = 'Referencia; valídelo con su contador'

export interface ConsejoVista {
    clave: string
    titulo: string
    fuente: string
    confirmar_contador: boolean
    aviso: string
    fuentes: FuenteConsejo[]
    estado: 'aplica' | 'no_aplica' | 'sin_datos'
    texto: string | null
    datos: Record<string, string | number | boolean | null> | null
    motivo: string | null
    /** el problema del primer bloque fuente en error (solo con `sin_datos`) */
    error: ProblemaJson | null
    oculto: boolean
    /** quién lo ocultó: `empresa` o `usuario` (null si está visible) */
    oculto_por: 'empresa' | 'usuario' | null
}

export interface ConsejosEmpresa {
    empresa_id: number
    regimen: string | null
    consejos: ConsejoVista[]
}

export interface ConsejosFiscales {
    hoy: string
    aviso: string
    empresas: ConsejosEmpresa[]
}

/** Catálogo del país de la empresa (vacío sin localización). */
export async function catalogoConsejos(
    c: QueryClientContract,
    empresaId: number,
): Promise<readonly DefinicionConsejo[]> {
    const instalacion = await instalacionVigente(c, empresaId)
    return CONSEJOS_POR_PAIS[instalacion?.pais ?? 'GT'] ?? []
}

/** Estado oculto vigente por clave: el del usuario manda sobre el de la empresa. */
export async function ocultosVigentes(c: QueryClientContract, empresaId: number, usuarioId: number | null) {
    const filas = (await c
        .from('fiscal.consejos_ocultos')
        .where('empresa_id', empresaId)
        .where((q) => {
            q.whereNull('usuario_id')
            if (usuarioId !== null) q.orWhere('usuario_id', usuarioId)
        })
        .orderBy('id', 'asc')
        .select('clave', 'usuario_id', 'oculto')) as Array<{
        clave: string
        usuario_id: number | null
        oculto: boolean
    }>
    const empresa = new Map<string, boolean>()
    const usuario = new Map<string, boolean>()
    for (const f of filas) (f.usuario_id === null ? empresa : usuario).set(f.clave, f.oculto)
    return (clave: string): { oculto: boolean; por: 'empresa' | 'usuario' | null } => {
        if (usuario.has(clave)) {
            return { oculto: usuario.get(clave)!, por: usuario.get(clave) ? 'usuario' : null }
        }
        if (empresa.get(clave)) return { oculto: true, por: 'empresa' }
        return { oculto: false, por: null }
    }
}

function bloqueFuente(fuente: FuenteConsejo, t: TableroEmpresa, comp: ComparadorEmpresa): Bloque {
    const [origen, nombre] = fuente.split('.') as ['tablero' | 'comparador', string]
    return origen === 'tablero'
        ? (t.bloques as Record<string, Bloque>)[nombre]!
        : (comp.bloques as Record<string, Bloque>)[nombre]!
}

export async function consejosFiscales(
    empresas: number[] | null,
    usuarioId: number | null,
): Promise<ConsejosFiscales> {
    const c = db.connection()
    const hoy = hoyFiscal()
    const ids = [...(empresas ?? (await idsEmpresasActivas(c)))].sort((a, b) => a - b)
    const salida: ConsejosEmpresa[] = []
    for (const empresaId of ids) {
        const deTablero = await tableroFiscal([empresaId])
        const tablero = deTablero.empresas[0]!
        const deComparador = await compararRegimenes([empresaId], null)
        const comparador = deComparador.empresas[0]!
        const catalogo = await catalogoConsejos(c, empresaId)
        const oculto = await ocultosVigentes(c, empresaId, usuarioId)
        let leer: (clave: string) => unknown = () => null
        try {
            const datos = await datosFiscales(empresaId, c)
            leer = (clave) => resolver(datos.filas, clave, hoy)?.valor ?? null
        } catch {
            // sin localización: los bloques ya traen el error y los consejos quedan sin datos
        }
        const consejos = catalogo.map((def): ConsejoVista => {
            const bloques = def.fuentes.map((f) => [f, bloqueFuente(f, tablero, comparador)] as const)
            const base = {
                clave: def.clave,
                titulo: def.titulo,
                fuente: def.fuente,
                confirmar_contador: def.confirmar_contador,
                aviso: AVISO_CONSEJOS,
                fuentes: [...def.fuentes],
                ...(() => {
                    const o = oculto(def.clave)
                    return { oculto: o.oculto, oculto_por: o.por }
                })(),
            }
            const enError = bloques.find(([, b]) => b.estado === 'error')
            if (enError) {
                return {
                    ...base,
                    estado: 'sin_datos',
                    texto: null,
                    datos: null,
                    motivo: `El bloque ${enError[0]} no se pudo calcular`,
                    error: enError[1].error,
                }
            }
            const noAplica = bloques.find(([, b]) => b.estado === 'no_aplica')
            if (noAplica) {
                return {
                    ...base,
                    estado: 'no_aplica',
                    texto: null,
                    datos: null,
                    motivo: noAplica[1].motivo,
                    error: null,
                }
            }
            const entrada: EntradaConsejo = {
                regimen: tablero.regimen,
                bloques: Object.fromEntries(bloques.map(([f, b]) => [f, b.datos!])),
                parametro: leer,
            }
            const r = def.evaluar(entrada)
            return r.aplica
                ? {
                      ...base,
                      estado: 'aplica',
                      texto: r.texto ?? null,
                      datos: r.datos ?? null,
                      motivo: null,
                      error: null,
                  }
                : {
                      ...base,
                      estado: 'no_aplica',
                      texto: null,
                      datos: null,
                      motivo: r.no_aplica ?? null,
                      error: null,
                  }
        })
        salida.push({ empresa_id: empresaId, regimen: tablero.regimen, consejos })
    }
    return { hoy, aviso: AVISO_CONSEJOS, empresas: salida }
}
