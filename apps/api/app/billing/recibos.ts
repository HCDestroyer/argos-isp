import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import type { Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { NoEncontrado } from '#shared/errores'
import { filtrarPorEmpresa } from '#shared/empresa_activa'
import { paginar, type OpcionesPaginacion } from '#shared/paginacion'
import { CERO, aTexto, dec, type Dec } from '#ledger/dinero'
import { CUENTAS } from '#ledger/plan_cuentas'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import RegistrarAsiento, { type LineaAsiento } from '#ledger/actions/registrar_asiento'
import RevertirAsiento from '#ledger/actions/revertir_asiento'

/**
 * Caja sin factura y cargos no facturables (B11 del plan de contabilidad; decisiones del PM del 25 y
 * 26 nov 2026, `contratos/fel-establecimientos.md` lote 3).
 *
 * - **Recibo no fiscal de pago** (`billing.recibos`): lo que se entrega al cobrar en una caja sin
 *   factura o al cubrir un cargo no facturable. No es factura: no lleva DTE, serie ni número de la
 *   SAT. Numeración propia, correlativa y sin huecos **por empresa** (`billing.recibos_secuencias`):
 *   el número lo toma el `UPDATE … RETURNING` de la misma transacción del pago, así que un pago que
 *   falla no gasta número; por empresa (no por caja) porque el recibo es un documento de la empresa,
 *   como sus facturas, y un cajero cobra en varias cajas.
 * - **Factura fuera de la SAT** (`billing.facturas_no_fiscales`): un aviso de cobro (sin DTE, IVA en
 *   `2.1.11`) que queda pagado **solo** con pagos de cajas sin factura no se certifica: su asiento
 *   `recibo_interno` pasa su ingreso y su IVA por certificar a `4.3.01 Ingresos por recibos internos`,
 *   sin IVA débito. Si algo de la factura se cobró en una caja fiscal, o tiene notas de crédito, se
 *   certifica como siempre (regla provisional del pago repartido, a confirmar con el PM). Un cargo no
 *   facturable nace ya fuera de la SAT (su línea va a `4.3.01` sin IVA).
 * - Anular el pago revierte la reclasificación (`facturas_no_fiscales_anulaciones`): la factura vuelve
 *   a ser un aviso que se certifica al cubrirse en una caja fiscal.
 *
 * Empresas sin FEL (o una factura ya certificada): la caja sin factura emite su recibo, pero el
 * ingreso ya facturado no se mueve (su IVA ya está en `2.1.02` y en el libro de ventas del mes).
 */

export const MOTIVOS_RECIBO = ['caja_sin_factura', 'cargo_no_facturable'] as const
export type MotivoRecibo = (typeof MOTIVOS_RECIBO)[number]

/** La factura tiene una marca vigente de «fuera de la SAT» (SQL para `whereRaw`/`EXISTS`). */
export function sqlNoFiscalVigente(aliasFactura: string): string {
    return `EXISTS (SELECT 1 FROM billing.facturas_no_fiscales nf WHERE nf.factura_id = ${aliasFactura}.id
        AND NOT EXISTS (SELECT 1 FROM billing.facturas_no_fiscales_anulaciones nx WHERE nx.no_fiscal_id = nf.id))`
}

export async function facturaNoFiscal(
    cliente: QueryClientContract,
    facturaId: number,
): Promise<{ id: number; motivo: MotivoRecibo } | null> {
    const fila = (await cliente
        .from('billing.facturas_no_fiscales as nf')
        .where('nf.factura_id', facturaId)
        .whereNotExists((q) =>
            q.from('billing.facturas_no_fiscales_anulaciones as x').whereRaw('x.no_fiscal_id = nf.id'),
        )
        .select('nf.id', 'nf.motivo')
        .first()) as { id: number; motivo: MotivoRecibo } | null
    return fila ? { id: Number(fila.id), motivo: fila.motivo } : null
}

/** Siguiente número de recibo de la empresa (correlativo, sin huecos: dentro de la transacción). */
async function siguienteNumero(cliente: QueryClientContract, empresaId: number): Promise<number> {
    const { rows } = (await cliente.rawQuery(
        `INSERT INTO billing.recibos_secuencias (empresa_id, ultimo) VALUES (?, 1)
         ON CONFLICT (empresa_id) DO UPDATE SET ultimo = billing.recibos_secuencias.ultimo + 1
         RETURNING ultimo`,
        [empresaId],
    )) as { rows: Array<{ ultimo: string }> }
    return Number(rows[0]!.ultimo)
}

/** Emite el recibo no fiscal de un pago (uno por pago). */
export async function emitirRecibo(
    t: Transaccion,
    datos: {
        empresa_id: number
        pago_id: number
        caja_id: number | null
        cliente_id: number
        monto: Dec
        motivo: MotivoRecibo
    },
): Promise<{ id: number; numero: number }> {
    const numero = await siguienteNumero(t.trx, datos.empresa_id)
    const [fila] = (await t.trx
        .insertQuery()
        .table('billing.recibos')
        .insert({
            empresa_id: datos.empresa_id,
            numero,
            pago_id: datos.pago_id,
            caja_id: datos.caja_id,
            cliente_id: datos.cliente_id,
            monto: aTexto(datos.monto),
            motivo: datos.motivo,
            emitido_por: usuarioDelActor(t.ctx.actor),
        })
        .returning('id')) as Array<{ id: number }>
    return { id: Number(fila!.id), numero }
}

/** Marca un cargo no facturable (nace fuera de la SAT; su línea ya va a la cuenta interna). */
export async function marcarCargoNoFacturable(t: Transaccion, empresaId: number, facturaId: number) {
    await t.trx.insertQuery().table('billing.facturas_no_fiscales').insert({
        factura_id: facturaId,
        empresa_id: empresaId,
        motivo: 'cargo_no_facturable',
    })
}

/**
 * Las facturas de un pago en caja sin factura que quedaron fuera de la SAT: aviso de cobro pagado, sin
 * DTE ni notas de crédito, de tipo servicio, y todo lo que la cubre viene de cajas sin factura.
 */
async function facturasParaSacarDeLaSat(cliente: QueryClientContract, facturas: number[]): Promise<number[]> {
    if (facturas.length === 0) return []
    const { rows } = (await cliente.rawQuery(
        `SELECT f.id FROM billing.facturas f
          WHERE f.id = ANY (?::bigint[]) AND f.aviso_cobro AND f.estado = 'pagada' AND f.tipo = 'servicio'
            AND NOT ${sqlNoFiscalVigente('f')}
            AND NOT EXISTS (SELECT 1 FROM fiscal.dte d WHERE d.documento_tipo = 'factura' AND d.documento_id = f.id
                              AND d.estado <> 'rechazado')
            AND NOT EXISTS (SELECT 1 FROM billing.notas_credito n WHERE n.factura_id = f.id)
            AND NOT EXISTS (SELECT 1 FROM billing.notas_credito_aplicaciones na WHERE na.factura_id = f.id)
            AND NOT EXISTS (
                SELECT 1 FROM billing.pagos_aplicaciones pa JOIN billing.pagos p ON p.id = pa.pago_id
                  LEFT JOIN ledger.cajas c ON c.id = p.caja_id
                 WHERE pa.factura_id = f.id AND p.estado <> 'anulado' AND coalesce(c.fiscal, true))
          ORDER BY f.id`,
        [facturas],
    )) as { rows: Array<{ id: number }> }
    return rows.map((r) => Number(r.id))
}

/**
 * Después del asiento de un pago en caja sin factura: saca de la SAT las facturas que quedaron
 * cubiertas solo con dinero sin factura (asiento `recibo_interno`). Devuelve las facturas.
 */
export async function sacarDeLaSat(
    t: Transaccion,
    datos: { empresa_id: number; pago_id: number; recibo_id: number; facturas: number[] },
): Promise<number[]> {
    const ids = await facturasParaSacarDeLaSat(t.trx, datos.facturas)
    for (const facturaId of ids) {
        const original = (await t.trx
            .from('ledger.asientos')
            .where({ origen_tipo: 'factura', origen_id: facturaId })
            .whereNull('reversa_de')
            .orderBy('id')
            .select('id', 'fecha')
            .first()) as { id: number } | null
        if (!original) continue
        const movimientos = (await t.trx
            .from('ledger.movimientos as m')
            .join('ledger.cuentas as c', 'c.id', 'm.cuenta_id')
            .where('m.asiento_id', original.id)
            .whereNot('c.codigo', CUENTAS.CXC_CLIENTES)
            .orderBy('m.id')
            .select('m.cuenta_id', 'c.codigo', 'm.debe', 'm.haber')) as Array<{
            cuenta_id: number
            codigo: string
            debe: string
            haber: string
        }>
        let total: Dec = CERO
        let iva: Dec = CERO
        const lineas: LineaAsiento[] = []
        for (const m of movimientos) {
            const debe = dec(m.debe)
            const haber = dec(m.haber)
            total = total.plus(haber).minus(debe)
            if (m.codigo === CUENTAS_GT.IVA_POR_CERTIFICAR) iva = iva.plus(haber).minus(debe)
            if (haber.gt(0)) lineas.push({ cuenta: Number(m.cuenta_id), debe: aTexto(haber) })
            if (debe.gt(0)) lineas.push({ cuenta: Number(m.cuenta_id), haber: aTexto(debe) })
        }
        if (total.lte(0)) continue
        lineas.push({ cuenta: CUENTAS_GT.INGRESOS_INTERNOS, haber: aTexto(total) })
        const [fila] = (await t.trx
            .insertQuery()
            .table('billing.facturas_no_fiscales')
            .insert({
                factura_id: facturaId,
                empresa_id: datos.empresa_id,
                motivo: 'caja_sin_factura',
                recibo_id: datos.recibo_id,
                pago_id: datos.pago_id,
                base: aTexto(total.minus(iva)),
                iva: aTexto(iva),
            })
            .returning('id')) as Array<{ id: number }>
        await new RegistrarAsiento().execute(
            {
                empresa_id: datos.empresa_id,
                descripcion: `Factura ${facturaId} cobrada en caja sin factura (pago ${datos.pago_id}): no se certifica; ingreso a recibos internos`,
                origen_tipo: 'recibo_interno',
                origen_id: Number(fila!.id),
                movimientos: lineas,
            },
            t.ctx,
            { trx: t.trx },
        )
    }
    return ids
}

/**
 * Al anular un pago: las facturas que tocaba y estaban fuera de la SAT por una caja sin factura
 * vuelven a ser avisos (se revierte su reclasificación), lo haya completado este pago u otro.
 */
export async function devolverALaSat(
    t: Transaccion,
    pagoId: number,
    facturas: number[],
    motivo: string,
): Promise<number[]> {
    if (facturas.length === 0) return []
    const marcas = (await t.trx
        .from('billing.facturas_no_fiscales as nf')
        .whereIn('nf.factura_id', facturas)
        .where('nf.motivo', 'caja_sin_factura')
        .whereNotExists((q) =>
            q.from('billing.facturas_no_fiscales_anulaciones as x').whereRaw('x.no_fiscal_id = nf.id'),
        )
        .select('nf.id', 'nf.factura_id', 'nf.empresa_id')) as Array<{
        id: number
        factura_id: number
        empresa_id: number
    }>
    for (const marca of marcas) {
        const asiento = await t.trx
            .from('ledger.asientos')
            .where({ origen_tipo: 'recibo_interno', origen_id: marca.id })
            .whereNull('reversa_de')
            .select('id')
            .first()
        if (asiento) {
            await new RevertirAsiento().execute(
                {
                    asiento_id: Number(asiento.id),
                    motivo: `anulación del pago ${pagoId}: la factura ${marca.factura_id} vuelve a ser un aviso de cobro (${motivo})`,
                    por_anulacion: true,
                },
                t.ctx,
                { trx: t.trx },
            )
        }
        await t.trx
            .insertQuery()
            .table('billing.facturas_no_fiscales_anulaciones')
            .insert({
                no_fiscal_id: marca.id,
                empresa_id: marca.empresa_id,
                motivo,
                anulado_por: usuarioDelActor(t.ctx.actor),
            })
    }
    return marcas.map((m) => Number(m.factura_id))
}

/*
|--------------------------------------------------------------------------
| Lecturas: recibos y el reporte «Cobros en cajas sin factura»
|--------------------------------------------------------------------------
*/

export interface ReciboVista {
    id: number
    empresa_id: number
    numero: number
    pago_id: number
    caja_id: number | null
    caja_nombre: string | null
    cliente_id: number
    cliente_nombre: string | null
    monto: string
    motivo: MotivoRecibo
    /** el pago se anuló: el recibo queda como historia, anulado */
    anulado: boolean
    metodo: string
    facturas: number[]
    /** facturas que este cobro dejó fuera de la SAT */
    facturas_no_fiscales: number[]
    emitido_por: number | null
    emitido_por_nombre: string | null
    created_at: Date
}

function consultaRecibos(cliente: QueryClientContract) {
    return cliente
        .from('billing.recibos as r')
        .join('billing.pagos as p', 'p.id', 'r.pago_id')
        .leftJoin('ledger.cajas as c', 'c.id', 'r.caja_id')
        .select(
            'r.id',
            'r.empresa_id',
            'r.numero',
            'r.pago_id',
            'r.caja_id',
            'c.nombre as caja_nombre',
            'r.cliente_id',
            cliente.raw('(SELECT k.nombre FROM core.clientes k WHERE k.id = r.cliente_id) AS cliente_nombre'),
            'r.monto',
            'r.motivo',
            cliente.raw(`(p.estado = 'anulado') AS anulado`),
            'p.metodo',
            cliente.raw(
                `coalesce((SELECT array_agg(DISTINCT pa.factura_id ORDER BY pa.factura_id) FROM billing.pagos_aplicaciones pa WHERE pa.pago_id = r.pago_id), '{}') AS facturas`,
            ),
            cliente.raw(
                `coalesce((SELECT array_agg(nf.factura_id ORDER BY nf.factura_id) FROM billing.facturas_no_fiscales nf WHERE nf.recibo_id = r.id), '{}') AS facturas_no_fiscales`,
            ),
            'r.emitido_por',
            cliente.raw(
                '(SELECT u.nombre FROM core.usuarios u WHERE u.id = r.emitido_por) AS emitido_por_nombre',
            ),
            'r.created_at',
        )
}

function normalizar(f: ReciboVista): ReciboVista {
    return {
        ...f,
        id: Number(f.id),
        empresa_id: Number(f.empresa_id),
        numero: Number(f.numero),
        pago_id: Number(f.pago_id),
        caja_id: f.caja_id === null ? null : Number(f.caja_id),
        cliente_id: Number(f.cliente_id),
        anulado: Boolean(f.anulado),
        facturas: (f.facturas ?? []).map(Number),
        facturas_no_fiscales: (f.facturas_no_fiscales ?? []).map(Number),
        emitido_por: f.emitido_por === null ? null : Number(f.emitido_por),
    }
}

export async function verRecibo(id: number, cliente: QueryClientContract = db.connection()) {
    const fila = (await consultaRecibos(cliente).where('r.id', id).first()) as ReciboVista | null
    if (!fila) throw new NoEncontrado(`El recibo ${id} no existe`)
    return normalizar(fila)
}

export async function reciboDePago(pagoId: number, cliente: QueryClientContract = db.connection()) {
    const fila = (await consultaRecibos(cliente).where('r.pago_id', pagoId).first()) as ReciboVista | null
    return fila ? normalizar(fila) : null
}

export interface FiltrosRecibos extends OpcionesPaginacion {
    desde?: string
    hasta?: string
    caja_id?: number
    cliente_id?: number
    motivo?: MotivoRecibo
}

/** `GET /recibos`: el reporte «Cobros en cajas sin factura» (con los cargos no facturables). */
export async function listarRecibos(filtros: FiltrosRecibos, empresas: number[] | null) {
    const consulta = consultaRecibos(db.connection())
        .if(filtros.desde, (q) =>
            q.whereRaw(`(r.created_at AT TIME ZONE 'America/Guatemala')::date >= ?`, [filtros.desde!]),
        )
        .if(filtros.hasta, (q) =>
            q.whereRaw(`(r.created_at AT TIME ZONE 'America/Guatemala')::date <= ?`, [filtros.hasta!]),
        )
        .if(filtros.caja_id, (q) => q.where('r.caja_id', filtros.caja_id!))
        .if(filtros.cliente_id, (q) => q.where('r.cliente_id', filtros.cliente_id!))
        .if(filtros.motivo, (q) => q.where('r.motivo', filtros.motivo!))
    filtrarPorEmpresa(consulta, empresas, (q, ids) => q.whereIn('r.empresa_id', ids))
    const pagina = await paginar<ReciboVista>(consulta, filtros, { columna: 'r.id' })
    return { ...pagina, data: pagina.data.map(normalizar) }
}
