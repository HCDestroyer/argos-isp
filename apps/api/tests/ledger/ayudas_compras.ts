import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import { randomInt } from 'node:crypto'
import { unico } from '#tests/ayudas'
import { siguienteDeSecuencia } from '#tests/billing/ayudas_billing'
import type { ContextoAccion } from '#shared/contexto'
import { verificadorNit } from '#core/nit_cui'
import { hoyGuatemala } from '#ledger/fechas'
import CrearProveedor, { type EntradaCrearProveedor } from '#ledger/actions/crear_proveedor'
import EditarParametro from '#fiscal/actions/editar_parametro'

/**
 * Ayudas de las pruebas de la fase 5 (compras, proveedores, retenciones, activos y diferidos).
 */

/** NIT válido al azar (cuerpo de 7 dígitos + verificador módulo 11); puede repetirse: ver `nitUnico`. */
export function nitPrueba(): string {
    const cuerpo = String(randomInt(1_000_000, 9_999_999))
    return `${cuerpo}${verificadorNit(cuerpo)}`
}

/**
 * NIT válido que no se repite en la base (UNIQUE `empresa_id, nit` de los proveedores activos): el
 * cuerpo sale de la secuencia de `tabla` (`siguienteDeSecuencia`; `core.empresas` para el NIT de una
 * empresa, único entre las activas).
 */
export async function nitUnico(tabla = 'ledger.proveedores'): Promise<string> {
    const n = await siguienteDeSecuencia(tabla)
    const cuerpo = String(1_000_000 + (n % 8_999_999))
    return `${cuerpo}${verificadorNit(cuerpo)}`
}

export async function proveedorEn(
    empresaId: number,
    ctx: ContextoAccion,
    extra: Partial<EntradaCrearProveedor> = {},
) {
    return new CrearProveedor().execute(
        { empresa_id: empresaId, nit: await nitUnico(), nombre: unico('Proveedor'), ...extra },
        ctx,
    )
}

/** Día `dia` del mes que está `meses` antes del actual (Guatemala), YYYY-MM-DD. */
export function haceMeses(meses: number, dia = 1): string {
    return DateTime.fromISO(hoyGuatemala(), { zone: 'utc' })
        .startOf('month')
        .minus({ months: meses })
        .set({ day: dia })
        .toISODate()!
}

/** Primer día del mes actual. */
export function mesActual(): string {
    return `${hoyGuatemala().slice(0, 7)}-01`
}

/** Movimientos de los asientos de un origen: [codigo, debe, haber, cuadricula]. */
export async function partidas(origenTipo: string, origenId: number, soloOriginal = true) {
    const filas = await db
        .from('ledger.movimientos as m')
        .join('ledger.asientos as a', 'a.id', 'm.asiento_id')
        .join('ledger.cuentas as c', 'c.id', 'm.cuenta_id')
        .where('a.origen_tipo', origenTipo)
        .where('a.origen_id', origenId)
        .if(soloOriginal, (q) => q.whereNull('a.reversa_de'))
        .orderBy('m.id', 'asc')
        .select('c.codigo', 'm.debe', 'm.haber', 'm.cuadricula')
    return filas.map(
        (f) =>
            [
                f.codigo as string,
                f.debe as string,
                f.haber as string,
                (f.cuadricula as string | null) ?? null,
            ] as const,
    )
}

/** Hace a la empresa agente de retención de IVA desde el 1 de enero. */
export async function hacerAgenteRetencion(empresaId: number, ctx: ContextoAccion) {
    await new EditarParametro().execute(
        {
            clave: 'agente_retencion_iva',
            valor: true,
            vigente_desde: `${hoyGuatemala().slice(0, 4)}-01-01`,
            motivo: 'prueba: agente de retención',
            empresa_id: empresaId,
        },
        ctx,
    )
}
