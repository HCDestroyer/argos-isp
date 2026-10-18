import type { QueryClientContract, TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { RegimenIsr } from '#core/empresas'
import type { DatosFiscalesEmpresa, InstaladorLocalizacion } from '#core/localizacion'
import ActualizarLocalizacion from '#fiscal/actions/actualizar_localizacion'
import { hoyFiscal } from '#fiscal/comun'
import { paisesConPaquete } from '#fiscal/instalador'
import { REGIMEN_DESDE_ISR } from '#fiscal/l10n/gt/index'
import { filasValores, resolver } from '#fiscal/parametros'

/**
 * Instalador de `fiscal` en el punto de extensión del núcleo (`#core/localizacion`, A1). Lo
 * registra el preload `start/fiscal.ts`; el núcleo lo llama en la transacción de `empresas.crear`
 * y `empresas.cambiar_pais`, así una empresa nueva nace con su localización instalada.
 */

/** Régimen del paquete → `core.empresas.regimen_isr` (el inverso de `REGIMEN_DESDE_ISR`). */
const ISR_DESDE_REGIMEN = Object.fromEntries(
    Object.entries(REGIMEN_DESDE_ISR).map(([isr, regimen]) => [regimen, isr]),
) as Record<string, RegimenIsr>

/**
 * Tablas de documentos fiscales propios de `fiscal` y de las compras (fases 3 a 6). Se revisan solo
 * si ya existen: hoy (fase 2) ninguna, y la configuración (parámetros, establecimientos, frases) no
 * es un documento.
 */
const TABLAS_DOCUMENTOS = ['fiscal.dte', 'ledger.compras', 'fiscal.declaraciones', 'fiscal.libros_emisiones']

export async function tieneDocumentosFiscales(empresaId: number, trx: QueryClientContract): Promise<boolean> {
    for (const tabla of TABLAS_DOCUMENTOS) {
        const existe = (await trx.rawQuery('SELECT to_regclass(?) IS NOT NULL AS existe', [tabla])) as {
            rows: Array<{ existe: boolean }>
        }
        if (!existe.rows[0]?.existe) continue
        const fila = await trx.from(tabla).where('empresa_id', empresaId).select(trx.raw('1')).first()
        if (fila) return true
    }
    return false
}

/**
 * Régimen (como `regimen_isr`) y establecimiento por defecto vigentes hoy, de los parámetros y
 * establecimientos de `fiscal`. Las empresas sin localización instalada no vienen: el núcleo
 * muestra lo guardado en `core.empresas`.
 */
export async function datosFiscalesEmpresas(
    empresaIds: number[],
    cliente: QueryClientContract,
): Promise<Map<number, DatosFiscalesEmpresa>> {
    const salida = new Map<number, DatosFiscalesEmpresa>()
    if (empresaIds.length === 0) return salida
    const instaladas = (await cliente
        .from('fiscal.instalaciones as i')
        .join('fiscal.localizaciones as l', 'l.codigo', 'i.localizacion_codigo')
        .whereIn('i.empresa_id', empresaIds)
        .distinctOn('i.empresa_id')
        .orderBy([
            { column: 'i.empresa_id', order: 'asc' },
            { column: 'i.id', order: 'desc' },
        ])
        .select('i.empresa_id', 'l.pais')) as Array<{ empresa_id: number; pais: string }>
    const establecimientos = (await cliente
        .from('fiscal.establecimientos')
        .whereIn('empresa_id', empresaIds)
        .where({ por_defecto: true, activo: true })
        .select('empresa_id', 'codigo')) as Array<{ empresa_id: number; codigo: number }>
    const codigoDe = new Map(establecimientos.map((e) => [Number(e.empresa_id), Number(e.codigo)]))
    const hoy = hoyFiscal()
    for (const instalada of instaladas) {
        const empresaId = Number(instalada.empresa_id)
        const filas = await filasValores(instalada.pais.trim(), empresaId, cliente, 'regimen')
        const regimen = resolver(filas, 'regimen', hoy)?.valor as string | undefined
        salida.set(empresaId, {
            regimen_isr: regimen ? (ISR_DESDE_REGIMEN[regimen] ?? null) : null,
            codigo_establecimiento: codigoDe.get(empresaId) ?? null,
        })
    }
    return salida
}

export const instaladorFiscal: InstaladorLocalizacion = {
    paises: () => paisesConPaquete(),
    async instalar({ trx, ctx, empresaId, pais }) {
        await new ActualizarLocalizacion().execute({ empresa_id: empresaId, pais, desde_nucleo: true }, ctx, {
            trx,
        })
    },
    tieneDocumentos: (empresaId: number, trx: TransactionClientContract) =>
        tieneDocumentosFiscales(empresaId, trx),
    datosFiscales: (empresaIds, cliente) => datosFiscalesEmpresas(empresaIds, cliente),
}
