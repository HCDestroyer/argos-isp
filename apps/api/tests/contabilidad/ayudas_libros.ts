import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import db from '@adonisjs/lucid/services/db'
import { servicioFacturado, type Empresas } from '#tests/contabilidad/ayudas_contabilidad'
import { configurarModo, empresasFel } from '#tests/fiscal/ayudas_fel'
import { proveedorEn } from '#tests/ledger/ayudas_compras'
import { dec } from '#ledger/dinero'
import { finDeMes, type LibroEmitible } from '#fiscal/libros_legales'
import { directorioLibros } from '#fiscal/libros_emisiones'
import RegistrarAsiento from '#ledger/actions/registrar_asiento'
import RegistrarCompra from '#ledger/actions/registrar_compra'
import CerrarPeriodo from '#ledger/actions/cerrar_periodo'
import BloquearLibro from '#ledger/actions/bloquear_libro'
import HabilitarLibro from '#fiscal/actions/habilitar_libro'
import type { ContextoAccion } from '#shared/contexto'

/**
 * Ayudas del auditor para los libros legales con folio (fase 6 PR D): empresas sin FEL (el libro de
 * ventas toma las facturas por la fecha de su asiento), un mes pasado con factura, compra y asiento
 * manual, cerrado y bajo el bloqueo global.
 */

export const LIBROS: LibroEmitible[] = ['diario', 'mayor', 'compras', 'ventas']

export async function empresasSinFel(): Promise<Empresas> {
    const e = await empresasFel('obligatoria')
    await configurarModo(e, e.B, 'desactivada')
    await configurarModo(e, e.C, 'desactivada')
    return e
}

export function asiento(ctx: ContextoAccion, empresaId: number, fecha: string, monto: string) {
    return new RegistrarAsiento().execute(
        {
            empresa_id: empresaId,
            fecha,
            descripcion: `Venta de contado ${fecha}`,
            origen_tipo: 'ajuste',
            movimientos: [
                { cuenta: '1.1.02.01', debe: monto },
                { cuenta: '4.1.01', haber: monto },
            ],
        },
        ctx,
    )
}

/**
 * Lleva las facturas (y su asiento) a `fecha`, como si el cron las hubiera emitido ese día: la
 * generación usa la fecha de hoy y el bloqueo no puede ser futuro, así que un mes cerrado y
 * bloqueado con facturas solo se arma así. Va antes del cierre (que sella la cadena).
 */
export async function llevarFacturasA(facturas: number[], fecha: string) {
    await db.transaction(async (trx) => {
        await trx.rawQuery('ALTER TABLE ledger.asientos DISABLE TRIGGER USER')
        await trx.rawQuery(
            `UPDATE ledger.asientos SET fecha = ? WHERE origen_tipo = 'factura' AND origen_id = ANY(?::bigint[])`,
            [fecha, facturas],
        )
        await trx.rawQuery('ALTER TABLE ledger.asientos ENABLE TRIGGER USER')
        await trx.rawQuery(
            `UPDATE billing.facturas SET emitida_en = (?::date + time '12:00') AT TIME ZONE 'America/Guatemala'
              WHERE id = ANY(?::bigint[])`,
            [fecha, facturas],
        )
    })
}

/**
 * Lleva las notas de crédito (la nota y su asiento) a `fecha`: la emisión usa la fecha real de hoy,
 * y una prueba con instante fijo (`relojFiscal`) necesita la nota en ese día, no en el del reloj.
 */
export async function llevarNotasA(notas: number[], fecha: string) {
    await db.transaction(async (trx) => {
        await trx.rawQuery('ALTER TABLE ledger.asientos DISABLE TRIGGER USER')
        await trx.rawQuery(
            `UPDATE ledger.asientos SET fecha = ? WHERE origen_tipo = 'nota_credito' AND origen_id = ANY(?::bigint[])`,
            [fecha, notas],
        )
        await trx.rawQuery('ALTER TABLE ledger.asientos ENABLE TRIGGER USER')
        await trx.rawQuery('ALTER TABLE billing.notas_credito DISABLE TRIGGER USER')
        await trx.rawQuery(`UPDATE billing.notas_credito SET fecha = ? WHERE id = ANY(?::bigint[])`, [
            fecha,
            notas,
        ])
        await trx.rawQuery('ALTER TABLE billing.notas_credito ENABLE TRIGGER USER')
    })
}

/** Lleva el asiento de los pagos a `fecha` (el pago se registra con la fecha real de hoy). */
export async function llevarPagosA(pagos: number[], fecha: string) {
    await db.transaction(async (trx) => {
        await trx.rawQuery('ALTER TABLE ledger.asientos DISABLE TRIGGER USER')
        await trx.rawQuery(
            `UPDATE ledger.asientos SET fecha = ? WHERE origen_tipo = 'pago' AND origen_id = ANY(?::bigint[])`,
            [fecha, pagos],
        )
        await trx.rawQuery('ALTER TABLE ledger.asientos ENABLE TRIGGER USER')
    })
}

/** Un mes pasado con una factura (sin FEL), una compra y un asiento manual, cerrado y bajo el global. */
export async function mesConMovimiento(
    e: Empresas,
    empresaId: number,
    desde: string,
    opciones: { clienteId?: number; cerrar?: boolean } = {},
) {
    const s = await servicioFacturado(empresaId, desde, {
        instalacion: desde,
        precio: '112.00',
        plantilla: { certificar_al: 'nunca' },
        clienteId: opciones.clienteId,
    })
    await llevarFacturasA(
        s.facturas.map((f) => f.id),
        desde.slice(0, 8) + '05',
    )
    const proveedor = await proveedorEn(empresaId, e.ctx)
    await new RegistrarCompra().execute(
        {
            empresa_id: empresaId,
            proveedor_id: proveedor.id,
            tipo_documento: 'FACT',
            serie: 'A',
            numero: String(proveedor.id),
            fecha_documento: desde.slice(0, 8) + '10',
            condicion: 'credito',
            lineas: [
                { descripcion: 'Tránsito IP', tipo: 'servicio', categoria: 'transito', total: '560.00' },
            ],
        },
        e.ctx,
    )
    await asiento(e.ctx, empresaId, desde.slice(0, 8) + '15', '75.25')
    // el primer día del mes y uno del mes anterior: el saldo inicial del Mayor corta antes de `desde`
    await asiento(e.ctx, empresaId, desde, '20.00')
    await asiento(e.ctx, empresaId, finDeMes(mesAnterior(desde)), '33.00')
    if (opciones.cerrar !== false) await cerrarYBloquear(e, empresaId, desde)
    return s
}

function mesAnterior(desde: string): string {
    const [anio, mes] = desde.split('-').map(Number) as [number, number]
    return mes === 1 ? `${anio - 1}-12-01` : `${anio}-${String(mes - 1).padStart(2, '0')}-01`
}

export async function cerrarYBloquear(e: Empresas, empresaId: number, desde: string) {
    const [anio, mes] = desde.split('-').map(Number) as [number, number]
    await new CerrarPeriodo().execute({ empresa_id: empresaId, anio, mes }, e.ctx)
    await new BloquearLibro().execute(
        { empresa_id: empresaId, tipo: 'global', hasta: finDeMes(desde), motivo: 'Mes declarado' },
        e.ctx,
    )
}

export async function habilitar(e: Empresas, empresaId: number, libro: string, desde: number, hasta: number) {
    return new HabilitarLibro().execute(
        {
            empresa_id: empresaId,
            libro: libro as LibroEmitible,
            autorizacion: 'SAT-7121 auditor',
            folio_desde: desde,
            folio_hasta: hasta,
            fecha: '2024-01-02',
        },
        e.ctx,
    )
}

/** Neto de la cuenta (debe − haber) en la empresa entre dos fechas. */
export async function neto(empresaId: number, codigo: string, desde: string, hasta: string) {
    const { rows } = await db.rawQuery(
        `SELECT coalesce(sum(m.debe - m.haber), 0)::text AS neto
           FROM ledger.movimientos m JOIN ledger.asientos a ON a.id = m.asiento_id
           JOIN ledger.cuentas c ON c.id = m.cuenta_id
          WHERE a.empresa_id = ? AND c.codigo = ? AND a.fecha BETWEEN ? AND ?`,
        [empresaId, codigo, desde, hasta],
    )
    return dec(rows[0].neto as string)
}

/** SHA-256 del archivo en disco de la emisión y el guardado. */
export async function huellaEnDisco(emisionId: number) {
    const fila = await db.from('fiscal.libros_emisiones').where('id', emisionId).firstOrFail()
    const contenido = await readFile(join(directorioLibros(), fila.archivo))
    return {
        calculado: createHash('sha256').update(contenido).digest('hex'),
        guardado: fila.sha256 as string,
    }
}
