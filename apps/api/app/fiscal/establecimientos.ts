import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado, ValidacionFallida } from '#shared/errores'

/**
 * Establecimientos de la SAT por empresa (`fiscal.establecimientos`; contrato §3.2): varios por
 * empresa, exactamente uno `por_defecto` activo.
 *
 * Qué establecimiento lleva cada DTE (decisión del PM P1, 25-nov-2026;
 * `contratos/fel-establecimientos.md` §5 y lote 4): `establecimientoPara`.
 *  1. NCRE y NDEB: el del DTE de su documento de origen.
 *  2. Factura: el de la **caja** del pago que la cubrió (cada caja tiene su establecimiento,
 *     `ledger.cajas.establecimiento_id`, que se asigna desde el establecimiento: `cajas[]`).
 *  3. Lo que no pasa por caja (cron mensual, Iris, API, pasarela) o una caja sin establecimiento:
 *     el por defecto activo de la empresa.
 *  4. Ninguno: null. **Desvío**: el plan pide 422 `establecimiento_requerido`, pero las empresas de
 *     las pruebas del auditor (`tests/contabilidad`, que no se editan) no tienen establecimiento y
 *     certifican con el código de la empresa (o 1). Queda el aviso `faltantes: establecimiento` de
 *     `GET /fel/configuracion` y la decisión, para el líder.
 */

export interface EstablecimientoVista {
    id: number
    empresa_id: number
    codigo: number
    nombre: string
    direccion: string | null
    municipio: string | null
    departamento: string | null
    /** 5 dígitos; null = el DTE sale con 01001 (aviso en el panel) */
    codigo_postal: string | null
    /** cajas cuyos cobros certifican con este establecimiento */
    cajas: number[]
    activo: boolean
    por_defecto: boolean
    version: number
    created_at: string
    updated_at: string
}

export const CAMPOS_ESTABLECIMIENTO = [
    'codigo',
    'nombre',
    'direccion',
    'municipio',
    'departamento',
    'codigo_postal',
    'cajas',
    'activo',
    'por_defecto',
] as const

const CAJAS = db.raw(
    `array(select c.id from ledger.cajas c where c.establecimiento_id = fiscal.establecimientos.id order by c.id) as cajas`,
)

function aVista(fila: Record<string, unknown>): EstablecimientoVista {
    return {
        ...(fila as unknown as EstablecimientoVista),
        id: Number(fila.id),
        empresa_id: Number(fila.empresa_id),
        codigo: Number(fila.codigo),
        codigo_postal: (fila.codigo_postal as string | null) ?? null,
        cajas: ((fila.cajas as Array<number | string> | null) ?? []).map(Number).sort((a, b) => a - b),
        version: Number(fila.version),
        created_at: new Date(fila.created_at as string).toISOString(),
        updated_at: new Date(fila.updated_at as string).toISOString(),
    }
}

/** Establecimientos de las empresas pedidas (null = todas), el por defecto primero. */
export async function listarEstablecimientos(
    empresas: number[] | null,
    cliente: QueryClientContract = db.connection(),
): Promise<EstablecimientoVista[]> {
    const filas = (await cliente
        .from('fiscal.establecimientos')
        .if(empresas !== null, (q) => q.whereIn('empresa_id', empresas!))
        .orderBy([
            { column: 'empresa_id', order: 'asc' },
            { column: 'por_defecto', order: 'desc' },
            { column: 'codigo', order: 'asc' },
        ])
        .select('*', CAJAS)) as Array<Record<string, unknown>>
    return filas.map(aVista)
}

export async function verEstablecimiento(
    id: number,
    cliente: QueryClientContract = db.connection(),
): Promise<EstablecimientoVista> {
    const fila = (await cliente
        .from('fiscal.establecimientos')
        .where('id', id)
        .select('*', CAJAS)
        .first()) as Record<string, unknown> | null
    if (!fila) throw new NoEncontrado(`El establecimiento ${id} no existe`)
    return aVista(fila)
}

/** Lo que va a `audit.cambios` (sin columnas de control). */
export function camposAuditables(e: EstablecimientoVista) {
    return Object.fromEntries(CAMPOS_ESTABLECIMIENTO.map((c) => [c, e[c]]))
}

/**
 * Establecimiento de un DTE nuevo (ver arriba). `referencia` es la del DTE de origen de una NCRE o
 * NDEB. null si la empresa no tiene ninguno activo.
 */
export async function establecimientoPara(
    cliente: QueryClientContract,
    datos: {
        empresa_id: number
        documento_tipo: 'factura' | 'nota_credito' | 'nota_debito'
        documento_id: number
        referencia?: { autorizacion: string } | null
    },
): Promise<number | null> {
    if (datos.referencia?.autorizacion) {
        const origen = (await cliente
            .from('fiscal.dte')
            .where({ empresa_id: datos.empresa_id, autorizacion: datos.referencia.autorizacion })
            .select('establecimiento_id')
            .first()) as { establecimiento_id: number | null } | null
        if (origen?.establecimiento_id) return Number(origen.establecimiento_id)
    }
    if (datos.documento_tipo !== 'nota_credito') {
        // la caja del último pago vigente que se aplicó a la factura (o a la factura de la mora)
        const deCaja = (await cliente
            .from('billing.pagos_aplicaciones as a')
            .join('billing.pagos as p', 'p.id', 'a.pago_id')
            .join('ledger.cajas as c', 'c.id', 'p.caja_id')
            .join('fiscal.establecimientos as e', 'e.id', 'c.establecimiento_id')
            .where('a.factura_id', datos.documento_id)
            .whereNot('p.estado', 'anulado')
            .where('e.empresa_id', datos.empresa_id)
            .where('e.activo', true)
            .orderBy('a.id', 'desc')
            .select('e.id')
            .first()) as { id: number } | null
        if (deCaja) return Number(deCaja.id)
    }
    const porDefecto = (await cliente
        .from('fiscal.establecimientos')
        .where({ empresa_id: datos.empresa_id, activo: true })
        .orderBy([
            { column: 'por_defecto', order: 'desc' },
            { column: 'id', order: 'asc' },
        ])
        .select('id')
        .first()) as { id: number } | null
    return porDefecto ? Number(porDefecto.id) : null
}

/**
 * Asigna las cajas a un establecimiento (reemplaza su conjunto). 422 en `cajas.N` si la caja no
 * existe o es de otra empresa. Una caja que estaba en otro establecimiento se mueve; cada caja que
 * cambia deja su diff (`establecimiento_id`) en `audit.cambios`.
 */
export async function asignarCajas(
    t: {
        trx: QueryClientContract
        registrarCambios: (e: { tipo: string; id: number }, a: object, d: object) => Promise<string[]>
    },
    establecimiento: { id: number; empresa_id: number },
    cajas: number[],
): Promise<void> {
    const unicas = [...new Set(cajas)]
    const filas = (await t.trx
        .from('ledger.cajas')
        .whereIn('id', unicas.length ? unicas : [0])
        .select('id', 'empresa_id', 'establecimiento_id')) as Array<{
        id: number
        empresa_id: number
        establecimiento_id: number | null
    }>
    const errores = unicas.flatMap((id, i) => {
        const caja = filas.find((f) => Number(f.id) === id)
        if (!caja) return [{ field: `cajas.${i}`, message: `La caja ${id} no existe`, rule: 'exists' }]
        if (Number(caja.empresa_id) !== establecimiento.empresa_id) {
            return [{ field: `cajas.${i}`, message: `La caja ${id} es de otra empresa`, rule: 'empresa' }]
        }
        return []
    })
    if (errores.length) throw new ValidacionFallida(errores)
    const antes = (await t.trx
        .from('ledger.cajas')
        .where('establecimiento_id', establecimiento.id)
        .select('id')) as Array<{ id: number }>
    for (const { id } of antes) {
        if (unicas.includes(Number(id))) continue
        await t.trx.from('ledger.cajas').where('id', id).update({ establecimiento_id: null })
        await t.registrarCambios(
            { tipo: 'caja', id: Number(id) },
            { establecimiento_id: establecimiento.id },
            { establecimiento_id: null },
        )
    }
    for (const caja of filas) {
        const previo = caja.establecimiento_id === null ? null : Number(caja.establecimiento_id)
        if (previo === establecimiento.id) continue
        await t.trx
            .from('ledger.cajas')
            .where('id', caja.id)
            .update({ establecimiento_id: establecimiento.id })
        await t.registrarCambios(
            { tipo: 'caja', id: Number(caja.id) },
            { establecimiento_id: previo },
            { establecimiento_id: establecimiento.id },
        )
    }
}
