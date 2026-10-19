import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado, ValidacionFallida } from '#shared/errores'
import { PAIS_PLAN } from '#ledger/plan_cuentas'

/**
 * Catálogos del cargo único manual (lectura y validación; las acciones están en `actions/`):
 *
 * - **Conceptos de cargo** (`billing.conceptos_cargo`, por empresa): instalación, equipo, visita
 *   técnica, otro… Cada uno dice a qué cuenta de ingreso va (`cuenta_codigo`), si lleva IVA
 *   (`gravable`) y si es bien o servicio para el DTE (`tipo`: `producto` = bien, `otro` = servicio).
 *   La cuenta no se adivina por el tipo: la elige quien configura el catálogo. Sembrados a `4.1.03
 *   Otros ingresos` (pendiente del contador: cuentas más finas).
 * - **Motivos sin costo** (`billing.motivos_sin_costo`, por empresa): por qué una factura sale en Q0
 *   (promoción, cortesía, garantía, compensación por falla, convenio…).
 *
 * Ambos se siembran con cada empresa (trigger), llevan `version` y se desactivan (`activo`), no se
 * borran: las facturas viejas siguen apuntando a ellos.
 */

export type TipoConceptoCargo = 'producto' | 'otro'

export interface ConceptoCargoVista {
    id: number
    empresa_id: number
    nombre: string
    tipo: TipoConceptoCargo
    cuenta_codigo: string
    cuenta_nombre: string | null
    gravable: boolean
    activo: boolean
    version: number
    created_at: Date
    updated_at: Date
}

export interface MotivoSinCostoVista {
    id: number
    empresa_id: number
    nombre: string
    activo: boolean
    version: number
    created_at: Date
    updated_at: Date
}

function consultaConceptos(cliente: QueryClientContract) {
    return cliente
        .from('billing.conceptos_cargo as k')
        .leftJoin('ledger.cuentas as c', (j) =>
            j.on('c.codigo', 'k.cuenta_codigo').andOnVal('c.pais', PAIS_PLAN),
        )
        .select(
            'k.id',
            'k.empresa_id',
            'k.nombre',
            'k.tipo',
            'k.cuenta_codigo',
            'c.nombre as cuenta_nombre',
            'k.gravable',
            'k.activo',
            'k.version',
            'k.created_at',
            'k.updated_at',
        )
}

export async function listarConceptosCargo(
    filtros: { activo?: boolean } = {},
    empresas: number[] | null = null,
    cliente: QueryClientContract = db.connection(),
): Promise<ConceptoCargoVista[]> {
    return (await consultaConceptos(cliente)
        .if(filtros.activo !== undefined, (q) => q.where('k.activo', filtros.activo!))
        .if(empresas !== null, (q) => q.whereIn('k.empresa_id', empresas!))
        .orderBy([
            { column: 'k.empresa_id', order: 'asc' },
            { column: 'k.nombre', order: 'asc' },
        ])) as ConceptoCargoVista[]
}

export async function verConceptoCargo(
    id: number,
    cliente: QueryClientContract = db.connection(),
): Promise<ConceptoCargoVista> {
    const fila = (await consultaConceptos(cliente).where('k.id', id).first()) as ConceptoCargoVista | null
    if (!fila) throw new NoEncontrado(`El concepto de cargo ${id} no existe`)
    return fila
}

function consultaMotivos(cliente: QueryClientContract) {
    return cliente
        .from('billing.motivos_sin_costo')
        .select('id', 'empresa_id', 'nombre', 'activo', 'version', 'created_at', 'updated_at')
}

export async function listarMotivosSinCosto(
    filtros: { activo?: boolean } = {},
    empresas: number[] | null = null,
    cliente: QueryClientContract = db.connection(),
): Promise<MotivoSinCostoVista[]> {
    return (await consultaMotivos(cliente)
        .if(filtros.activo !== undefined, (q) => q.where('activo', filtros.activo!))
        .if(empresas !== null, (q) => q.whereIn('empresa_id', empresas!))
        .orderBy([
            { column: 'empresa_id', order: 'asc' },
            { column: 'nombre', order: 'asc' },
        ])) as MotivoSinCostoVista[]
}

export async function verMotivoSinCosto(
    id: number,
    cliente: QueryClientContract = db.connection(),
): Promise<MotivoSinCostoVista> {
    const fila = (await consultaMotivos(cliente).where('id', id).first()) as MotivoSinCostoVista | null
    if (!fila) throw new NoEncontrado(`El motivo sin costo ${id} no existe`)
    return fila
}

/**
 * La cuenta de un concepto: existe en el plan del país, es imputable, es de ingreso y es global o de
 * la empresa del concepto. 422 en `cuenta_codigo` si no.
 */
export async function exigirCuentaIngreso(
    cliente: QueryClientContract,
    codigo: string,
    empresaId: number,
): Promise<void> {
    const cuenta = (await cliente
        .from('ledger.cuentas')
        .where('codigo', codigo)
        .where('pais', PAIS_PLAN)
        .select('tipo', 'imputable', 'activa', 'empresa_id')
        .first()) as { tipo: string; imputable: boolean; activa: boolean; empresa_id: number | null } | null
    const problema = !cuenta
        ? `La cuenta ${codigo} no existe en el plan de cuentas`
        : cuenta.tipo !== 'ingreso'
          ? `La cuenta ${codigo} no es de ingreso (es de ${cuenta.tipo})`
          : !cuenta.imputable
            ? `La cuenta ${codigo} es de agrupación: elige una cuenta imputable`
            : !cuenta.activa
              ? `La cuenta ${codigo} está inactiva`
              : cuenta.empresa_id !== null && Number(cuenta.empresa_id) !== empresaId
                ? `La cuenta ${codigo} es de otra empresa`
                : null
    if (problema) throw new ValidacionFallida([{ field: 'cuenta_codigo', message: problema, rule: 'cuenta' }])
}
