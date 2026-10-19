import db from '@adonisjs/lucid/services/db'
import { CUENTAS } from '#ledger/plan_cuentas'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import { cuadreCompras } from '#fiscal/libros'
import type { Violacion } from '#tests/contabilidad/verificar_libro'
import { verificarLibro } from '#tests/contabilidad/verificar_libro'

/**
 * A3 · fase 5 (compras, proveedores, retenciones, activos y diferidos): verificación del libro en
 * las pruebas de `tests/ledger/` y `tests/billing/` que usan las piezas nuevas.
 *
 * Corre el auditor completo (`verificarLibro`) y, para los cuatro invariantes que suponen el mundo
 * anterior a la fase 5, su versión ampliada (copia del SQL del auditor más los documentos nuevos). Nada se relaja: cada
 * reemplazo revisa lo mismo que el original **más** los documentos nuevos. La lista va en el
 * reporte al líder y al auditor.
 */
export const SUPERADOS_POR_FASE5: Record<string, string> = {
    '9.origen_de_asiento_desconocido':
        'orígenes de la fase 5: compra, pago_proveedor, depreciacion, baja_activo, diferido, alta_activo',
    '4.saldo_de_caja_o_banco_distinto_de_sus_documentos':
        'los pagos a proveedores sacan dinero de caja y bancos; un pago con retenciones recibidas entra neto de ellas',
    '4.caja_cerrada_no_cuadra':
        'el egreso de una compra al contado tiene el asiento de la compra (origen compra); los pagos a proveedores en efectivo y las retenciones recibidas bajan el esperado',
    '5.pago_vigente_mal_contabilizado':
        'un pago con constancias de retención recibidas entra a caja o banco por monto − comisión − retenido',
}

function en(columna: string, ids: number[]): string {
    if (ids.length === 0) return 'false'
    for (const id of ids) if (!Number.isSafeInteger(id)) throw new Error(`id inválido: ${id}`)
    return `${columna} IN (${ids.join(',')})`
}

async function filas(sql: string): Promise<Array<Record<string, unknown>>> {
    const resultado = await db.rawQuery(sql)
    return resultado.rows as Array<Record<string, unknown>>
}

async function existe(tabla: string): Promise<boolean> {
    const [f] = await filas(`SELECT to_regclass('${tabla}') IS NOT NULL AS existe`)
    return Boolean(f?.existe)
}

async function existeColumna(esquema: string, tabla: string, columna: string): Promise<boolean> {
    const [f] = await filas(
        `SELECT EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_schema = '${esquema}' AND table_name = '${tabla}' AND column_name = '${columna}') AS existe`,
    )
    return Boolean(f?.existe)
}

const CAJAS = CUENTAS.CAJAS
const BANCOS = CUENTAS.BANCOS
const PUENTE = CUENTAS_GT.COBROS_POR_LIQUIDAR
const PROVEEDORES = CUENTAS_GT.PROVEEDORES

/** SQL del saldo pendiente de la compra `c` (crédito vigente): neto − NCRE vigentes − pagos vigentes. */
const SALDO_COMPRA = `(CASE WHEN c.condicion <> 'credito' OR c.tipo_documento = 'NCRE'
                            OR EXISTS (SELECT 1 FROM ledger.compras_anulaciones xa WHERE xa.compra_id = c.id) THEN 0
                       ELSE c.total - c.retencion_iva - c.retencion_isr
                            - coalesce((SELECT sum(n.total) FROM ledger.compras n WHERE n.compra_referencia_id = c.id
                                         AND n.tipo_documento = 'NCRE'
                                         AND NOT EXISTS (SELECT 1 FROM ledger.compras_anulaciones xn WHERE xn.compra_id = n.id)), 0)
                            - coalesce((SELECT sum(ap.monto) FROM ledger.pagos_proveedores_aplicaciones ap
                                         WHERE ap.compra_id = c.id
                                           AND NOT EXISTS (SELECT 1 FROM ledger.pagos_proveedores_anulaciones xp WHERE xp.pago_id = ap.pago_id)), 0)
                  END)`

/** Invariantes de la fase 5 (los reemplazos y los nuevos). */
export async function invariantesFase5(empresas: number[]): Promise<Violacion[]> {
    const E = (col: string) => en(col, empresas)
    const violaciones: Violacion[] = []
    const revisar = async (invariante: string, sql: string) => {
        const resultado = await filas(sql)
        if (resultado.length > 0) violaciones.push({ invariante, detalle: resultado })
    }
    const conCompras = await existe('ledger.compras')
    const conActivos = await existe('ledger.activos')
    const conDiferidos = await existe('ledger.diferimientos')
    const conRetenido = await existeColumna('billing', 'pagos', 'retenido')
    const conDepositos = await existe('ledger.depositos')
    const conExtractos = await existe('ledger.extractos_lineas')
    const retenido = conRetenido ? 'p.retenido' : '0'

    // R3 · orígenes
    await revisar(
        'F5.origen_de_asiento_desconocido',
        `SELECT a.id, a.origen_tipo FROM ledger.asientos a
          WHERE ${E('a.empresa_id')}
            AND a.origen_tipo NOT IN ('factura', 'mora', 'pago', 'nota_credito', 'egreso', 'cierre_caja', 'ajuste',
                                      'reclasificacion', 'liquidacion_cobro', 'deposito', 'traslado', 'banco',
                                      'provision', 'castigo', 'compra', 'pago_proveedor', 'depreciacion',
                                      'baja_activo', 'diferido', 'alta_activo')`,
    )

    // R2 · pago vigente: dinero = monto − comisión − retenido; constancias = retenido (1.1.05 + 1.1.06)
    await revisar(
        'F5.pago_vigente_mal_contabilizado',
        `WITH mov AS (
             SELECT a.origen_id AS pago_id,
                    sum(CASE WHEN c.codigo LIKE '${CAJAS}.%' OR c.codigo LIKE '${BANCOS}.%' THEN m.debe - m.haber ELSE 0 END) AS dinero,
                    sum(CASE WHEN c.codigo LIKE '${PUENTE}.%' THEN m.debe - m.haber ELSE 0 END) AS puente,
                    sum(CASE WHEN c.codigo = '${CUENTAS.COMISIONES_PASARELAS}' THEN m.debe - m.haber ELSE 0 END) AS comision,
                    sum(CASE WHEN c.codigo IN ('${CUENTAS_GT.IVA_RETENIDO_CLIENTES}', '${CUENTAS_GT.ISR_RETENIDO_CLIENTES}') THEN m.debe - m.haber ELSE 0 END) AS retenido,
                    sum(CASE WHEN c.codigo = '${CUENTAS.SALDOS_APERTURA}' THEN m.debe - m.haber ELSE 0 END) AS apertura,
                    bool_or(EXISTS (SELECT 1 FROM ledger.asientos r WHERE r.reversa_de = a.id)) AS revertido,
                    count(DISTINCT CASE WHEN c.codigo LIKE '${PUENTE}.%' THEN m.cuenta_id END) AS puentes,
                    max(CASE WHEN c.codigo LIKE '${PUENTE}.%' THEN m.cuenta_id END) AS cuenta_puente
               FROM ledger.asientos a
               JOIN ledger.movimientos m ON m.asiento_id = a.id
               JOIN ledger.cuentas c ON c.id = m.cuenta_id
              WHERE a.origen_tipo = 'pago' AND a.reversa_de IS NULL
              GROUP BY 1
         )
         SELECT p.id, p.metodo, p.historico, p.monto::text, p.comision::text, ${retenido}::text AS retenido, p.proveedor_cobro_id,
                mov.dinero::text, mov.puente::text, mov.comision::text AS comision_libro, mov.retenido::text AS retenido_libro,
                mov.apertura::text, mov.revertido
           FROM billing.pagos p LEFT JOIN mov ON mov.pago_id = p.id
           LEFT JOIN ledger.proveedores_cobro pc ON pc.id = p.proveedor_cobro_id
          WHERE ${E('p.empresa_id')} AND p.estado = 'registrado'
            AND (mov.pago_id IS NULL OR mov.revertido OR mov.retenido <> ${retenido}
                 OR (p.historico AND (mov.apertura <> p.monto OR mov.dinero <> 0 OR mov.puente <> 0 OR ${retenido} <> 0))
                 OR (NOT p.historico AND p.proveedor_cobro_id IS NULL
                     AND (mov.dinero <> p.monto - p.comision - ${retenido} OR mov.comision <> p.comision OR mov.puente <> 0))
                 OR (NOT p.historico AND p.proveedor_cobro_id IS NOT NULL
                     AND (mov.puente <> p.monto OR mov.dinero <> 0 OR mov.comision <> 0 OR p.comision <> 0 OR ${retenido} <> 0
                          OR mov.puentes <> 1 OR mov.cuenta_puente <> pc.cuenta_id OR pc.empresa_id <> p.empresa_id
                          OR pc.metodo <> p.metodo
                          OR (p.created_at AT TIME ZONE 'America/Guatemala')::date < pc.desde)))`,
    )

    // R1 · mayor de cada caja y banco = sus documentos (+ pagos a proveedores, − retenciones recibidas)
    const llegadaViva = (tipo: string, id: string) => `EXISTS (
        SELECT 1 FROM ledger.asientos lv JOIN ledger.movimientos lm ON lm.asiento_id = lv.id
          JOIN ledger.cuentas lc ON lc.id = lm.cuenta_id
         WHERE lv.origen_tipo = ${tipo} AND lv.origen_id = ${id} AND lv.reversa_de IS NULL
           AND lc.codigo = '${CUENTAS_GT.FONDOS_EN_TRANSITO}' AND lm.haber > 0
           AND NOT EXISTS (SELECT 1 FROM ledger.asientos lr WHERE lr.reversa_de = lv.id))`
    const depositos = conDepositos
        ? `UNION ALL
             SELECT d.empresa_id, -d.monto, cj.cuenta_id FROM ledger.depositos d JOIN ledger.cajas cj ON cj.id = d.caja_id
              WHERE ${E('d.empresa_id')}
             UNION ALL
             SELECT d.empresa_id, d.monto, d.cuenta_id FROM ledger.depositos d
              WHERE ${E('d.empresa_id')} AND ${llegadaViva("'deposito'", 'd.id')}
             UNION ALL
             SELECT t.empresa_id, -t.monto, t.cuenta_origen_id FROM ledger.traslados t WHERE ${E('t.empresa_id')}
             UNION ALL
             SELECT t.empresa_id, t.monto, t.cuenta_destino_id FROM ledger.traslados t
              WHERE ${E('t.empresa_id')} AND ${llegadaViva("'traslado'", 't.id')}`
        : ''
    const extracto = conExtractos
        ? `UNION ALL
             SELECT el.empresa_id, el.monto, el.cuenta_id FROM ledger.extractos_lineas el
              WHERE ${E('el.empresa_id')} AND EXISTS (SELECT 1 FROM ledger.asientos a WHERE a.origen_tipo = 'banco' AND a.origen_id = el.id AND a.reversa_de IS NULL
                                 AND NOT EXISTS (SELECT 1 FROM ledger.asientos r WHERE r.reversa_de = a.id))`
        : ''
    const pagosProveedores = conCompras
        ? `UNION ALL
             SELECT pp.empresa_id, -pp.monto, pp.cuenta_id FROM ledger.pagos_proveedores pp
              WHERE ${E('pp.empresa_id')} AND NOT EXISTS (SELECT 1 FROM ledger.pagos_proveedores_anulaciones x WHERE x.pago_id = pp.id)`
        : ''
    const ventasActivos = conActivos
        ? `UNION ALL
             SELECT ac.empresa_id, b.precio_venta, b.cuenta_cobro_id FROM ledger.activos_bajas b
               JOIN ledger.activos ac ON ac.id = b.activo_id
              WHERE ${E('ac.empresa_id')} AND b.tipo = 'venta'`
        : ''
    await revisar(
        'F5.saldo_de_caja_o_banco_distinto_de_sus_documentos',
        `WITH docs AS (
             SELECT empresa_id, cuenta_id, sum(monto) AS saldo FROM (
                 SELECT p.empresa_id, p.monto - p.comision - ${retenido} AS monto,
                        coalesce(cj.cuenta_id, cb.cuenta_id,
                                 CASE WHEN p.metodo IN ('pasarela', 'agente', 'debito') AND p.proveedor_cobro_id IS NULL
                                      THEN (SELECT id FROM ledger.cuentas WHERE codigo = '${CUENTAS.BANCO_PRINCIPAL}') END) AS cuenta_id
                   FROM billing.pagos p
                   LEFT JOIN ledger.cajas cj ON cj.id = p.caja_id
                   LEFT JOIN billing.cuentas_bancarias cb ON cb.id = p.cuenta_bancaria_id
                  WHERE p.estado = 'registrado' AND NOT p.historico AND ${E('p.empresa_id')}
                    AND (p.proveedor_cobro_id IS NULL)
                 UNION ALL
                 SELECT e.empresa_id, -e.monto, coalesce(cj.cuenta_id, b.cuenta_id, cb.cuenta_id)
                   FROM ledger.egresos e
                   LEFT JOIN ledger.cajas cj ON cj.id = e.caja_id
                   LEFT JOIN ledger.bancos b ON b.id = e.banco_id
                   LEFT JOIN billing.cuentas_bancarias cb ON cb.id = e.cuenta_bancaria_id
                  WHERE ${E('e.empresa_id')} AND NOT EXISTS (SELECT 1 FROM ledger.egresos_anulaciones x WHERE x.egreso_id = e.id)
                 UNION ALL
                 SELECT cj.empresa_id, t.diferencia, cj.cuenta_id
                   FROM ledger.cajas_turnos t JOIN ledger.cajas cj ON cj.id = t.caja_id
                  WHERE t.cerrado_en IS NOT NULL AND ${E('cj.empresa_id')}
                 UNION ALL
                 SELECT a.empresa_id, m.debe - m.haber, m.cuenta_id
                   FROM ledger.asientos a JOIN ledger.movimientos m ON m.asiento_id = a.id
                   JOIN ledger.cuentas c ON c.id = m.cuenta_id
                  WHERE a.origen_tipo = 'ajuste' AND ${E('a.empresa_id')}
                    AND (c.codigo LIKE '${CAJAS}.%' OR c.codigo LIKE '${BANCOS}.%')
                 UNION ALL
                 SELECT l.empresa_id, l.neto, l.cuenta_id FROM ledger.liquidaciones_cobro l WHERE ${E('l.empresa_id')}
                 ${depositos}
                 ${extracto}
                 ${pagosProveedores}
                 ${ventasActivos}
             ) x (empresa_id, monto, cuenta_id) GROUP BY 1, 2
         ), libro AS (
             SELECT a.empresa_id, m.cuenta_id, sum(m.debe - m.haber) AS saldo
               FROM ledger.movimientos m JOIN ledger.asientos a ON a.id = m.asiento_id
               JOIN ledger.cuentas c ON c.id = m.cuenta_id
              WHERE (c.codigo LIKE '${CAJAS}.%' OR c.codigo LIKE '${BANCOS}.%') AND ${E('a.empresa_id')}
              GROUP BY 1, 2
         )
         SELECT coalesce(libro.empresa_id, docs.empresa_id) AS empresa_id,
                (SELECT codigo FROM ledger.cuentas WHERE id = coalesce(libro.cuenta_id, docs.cuenta_id)) AS cuenta,
                coalesce(libro.saldo, 0)::text AS mayor, coalesce(docs.saldo, 0)::text AS documentos
           FROM libro FULL JOIN docs ON docs.empresa_id = libro.empresa_id AND docs.cuenta_id = libro.cuenta_id
          WHERE coalesce(libro.saldo, 0) <> coalesce(docs.saldo, 0)`,
    )

    // R4 · caja cerrada: esperado = fondo + cobros (efectivo) − egresos − depósitos − pagos a proveedores del turno
    const compraEnTurno = conCompras
        ? `OR (a.origen_tipo = 'compra' AND a.origen_id IN (SELECT compra_id FROM ledger.egresos WHERE turno_id = t.id AND compra_id IS NOT NULL))
           OR (a.origen_tipo = 'pago_proveedor' AND a.origen_id IN (SELECT id FROM ledger.pagos_proveedores WHERE turno_id = t.id))`
        : ''
    await revisar(
        'F5.caja_cerrada_no_cuadra',
        `WITH t AS (
             SELECT t.*, cj.cuenta_id, cj.empresa_id FROM ledger.cajas_turnos t JOIN ledger.cajas cj ON cj.id = t.caja_id
              WHERE t.cerrado_en IS NOT NULL AND ${E('cj.empresa_id')}
         ), libro AS (
             SELECT t.id AS turno_id, coalesce(sum(m.debe - m.haber), 0) AS neto
               FROM t
               JOIN ledger.asientos a ON a.created_at <= t.cerrado_en
                    AND ((a.origen_tipo = 'pago' AND a.origen_id IN (SELECT id FROM billing.pagos WHERE turno_id = t.id))
                      OR (a.origen_tipo = 'egreso' AND a.origen_id IN (SELECT id FROM ledger.egresos WHERE turno_id = t.id))
                      ${conDepositos ? `OR (a.origen_tipo = 'deposito' AND a.origen_id IN (SELECT id FROM ledger.depositos WHERE turno_id = t.id))` : ''}
                      ${compraEnTurno})
               JOIN ledger.movimientos m ON m.asiento_id = a.id AND m.cuenta_id = t.cuenta_id
              GROUP BY t.id
         ), dif AS (
             SELECT a.origen_id AS turno_id, sum(m.debe - m.haber) AS neto
               FROM ledger.asientos a JOIN ledger.movimientos m ON m.asiento_id = a.id
               JOIN t ON t.id = a.origen_id AND m.cuenta_id = t.cuenta_id
              WHERE a.origen_tipo = 'cierre_caja' AND a.reversa_de IS NULL
              GROUP BY 1
         )
         SELECT t.id AS turno_id, t.esperado::text, t.contado::text, t.diferencia::text,
                coalesce(libro.neto, 0)::text AS libro_turno, coalesce(dif.neto, 0)::text AS asiento_diferencia
           FROM t LEFT JOIN libro ON libro.turno_id = t.id LEFT JOIN dif ON dif.turno_id = t.id
          WHERE t.esperado <> t.fondo_inicial + coalesce(libro.neto, 0)
             OR t.diferencia <> t.contado - t.esperado
             OR coalesce(dif.neto, 0) <> t.diferencia`,
    )

    if (conCompras) {
        await revisar(
            'F5.auxiliar_sin_proveedor (2.1.03 sin proveedor_id o de otra empresa)',
            `SELECT m.id, m.asiento_id, c.codigo, m.proveedor_id
               FROM ledger.movimientos m JOIN ledger.cuentas c ON c.id = m.cuenta_id
               JOIN ledger.asientos a ON a.id = m.asiento_id
               LEFT JOIN ledger.proveedores p ON p.id = m.proveedor_id
              WHERE ${E('a.empresa_id')}
                AND ((c.auxiliar_proveedor AND m.proveedor_id IS NULL)
                     OR (m.proveedor_id IS NOT NULL AND p.empresa_id <> a.empresa_id))`,
        )
        await revisar(
            'F5.cxp_distinta_de_compras_pendientes (2.1.03 por proveedor = Σ saldo de sus compras al crédito)',
            `WITH libro AS (
                 SELECT a.empresa_id, m.proveedor_id, sum(m.haber - m.debe) AS saldo
                   FROM ledger.movimientos m JOIN ledger.asientos a ON a.id = m.asiento_id
                   JOIN ledger.cuentas c ON c.id = m.cuenta_id
                  WHERE c.codigo = '${PROVEEDORES}' AND ${E('a.empresa_id')}
                  GROUP BY 1, 2
             ), docs AS (
                 SELECT c.empresa_id, c.proveedor_id, sum(${SALDO_COMPRA}) AS saldo
                   FROM ledger.compras c WHERE ${E('c.empresa_id')}
                  GROUP BY 1, 2
             )
             SELECT coalesce(l.empresa_id, d.empresa_id) AS empresa_id, coalesce(l.proveedor_id, d.proveedor_id) AS proveedor_id,
                    coalesce(l.saldo, 0)::text AS libro, coalesce(d.saldo, 0)::text AS compras
               FROM libro l FULL JOIN docs d ON d.empresa_id = l.empresa_id AND d.proveedor_id = l.proveedor_id
              WHERE coalesce(l.saldo, 0) <> coalesce(d.saldo, 0)`,
        )
        await revisar(
            'F5.compra_con_saldo_fuera_de_rango (0 ≤ saldo ≤ neto; aplicaciones ≤ monto del pago)',
            `SELECT c.id, (${SALDO_COMPRA})::text AS saldo, (c.total - c.retencion_iva - c.retencion_isr)::text AS neto
               FROM ledger.compras c WHERE ${E('c.empresa_id')}
                AND ((${SALDO_COMPRA}) < 0 OR (${SALDO_COMPRA}) > c.total - c.retencion_iva - c.retencion_isr)
             UNION ALL
             SELECT pp.id, sum(ap.monto)::text, pp.monto::text FROM ledger.pagos_proveedores pp
               JOIN ledger.pagos_proveedores_aplicaciones ap ON ap.pago_id = pp.id
              WHERE ${E('pp.empresa_id')} GROUP BY pp.id, pp.monto HAVING sum(ap.monto) <> pp.monto`,
        )
        await revisar(
            'F5.compra_mal_contabilizada (asiento de la compra = documento: base, 1.1.04, retenciones y contrapartida por el neto)',
            `WITH mov AS (
                 SELECT a.origen_id AS compra_id, count(DISTINCT a.id) AS asientos,
                        sum(CASE WHEN c.codigo = '${CUENTAS_GT.IVA_CREDITO}' THEN m.debe - m.haber ELSE 0 END) AS iva,
                        sum(CASE WHEN c.codigo = '${CUENTAS_GT.RETENCIONES_IVA_POR_PAGAR}' THEN m.haber - m.debe ELSE 0 END) AS ret_iva,
                        sum(CASE WHEN c.codigo = '${CUENTAS_GT.RETENCIONES_ISR_POR_PAGAR}' THEN m.haber - m.debe ELSE 0 END) AS ret_isr,
                        sum(CASE WHEN c.codigo = '${PROVEEDORES}' THEN m.haber - m.debe ELSE 0 END) AS cxp,
                        bool_and(c.codigo <> '${PROVEEDORES}' OR m.proveedor_id = co.proveedor_id) AS proveedor_ok,
                        sum(CASE WHEN c.codigo LIKE '${CAJAS}.%' OR c.codigo LIKE '${BANCOS}.%' THEN m.haber - m.debe ELSE 0 END) AS dinero,
                        sum(CASE WHEN m.cuadricula LIKE '_C_IVA' THEN (CASE WHEN m.cuadricula LIKE '+%' THEN 1 ELSE -1 END) * (m.debe + m.haber) ELSE 0 END) AS etiqueta_iva
                   FROM ledger.asientos a JOIN ledger.compras co ON co.id = a.origen_id
                   JOIN ledger.movimientos m ON m.asiento_id = a.id
                   JOIN ledger.cuentas c ON c.id = m.cuenta_id
                  WHERE a.origen_tipo = 'compra' AND a.reversa_de IS NULL AND ${E('a.empresa_id')}
                  GROUP BY 1
             )
             SELECT co.id, co.tipo_documento, co.condicion, co.iva::text, co.credito_fiscal, mov.iva::text AS iva_libro,
                    mov.ret_iva::text, mov.ret_isr::text, mov.cxp::text, mov.dinero::text, mov.etiqueta_iva::text, mov.asientos
               FROM ledger.compras co LEFT JOIN mov ON mov.compra_id = co.id
               LEFT JOIN ledger.egresos eg ON eg.compra_id = co.id
              WHERE ${E('co.empresa_id')}
                AND (mov.compra_id IS NULL OR mov.asientos <> 1 OR NOT mov.proveedor_ok
                     OR mov.iva <> (CASE WHEN co.credito_fiscal THEN co.iva ELSE 0 END) * (CASE WHEN co.tipo_documento = 'NCRE' THEN -1 ELSE 1 END)
                     OR mov.etiqueta_iva <> (CASE WHEN co.credito_fiscal THEN co.iva ELSE 0 END) * (CASE WHEN co.tipo_documento = 'NCRE' THEN -1 ELSE 1 END)
                     OR mov.ret_iva <> co.retencion_iva OR mov.ret_isr <> co.retencion_isr
                     OR mov.cxp <> (CASE WHEN co.condicion = 'credito' THEN (co.total - co.retencion_iva - co.retencion_isr)
                                         * (CASE WHEN co.tipo_documento = 'NCRE' THEN -1 ELSE 1 END) ELSE 0 END)
                     OR mov.dinero <> (CASE WHEN co.condicion = 'contado' AND co.egreso_id IS NULL
                                            THEN co.total - co.retencion_iva - co.retencion_isr ELSE 0 END)
                     OR (co.condicion = 'contado' AND co.egreso_id IS NULL
                         AND (eg.id IS NULL OR eg.monto <> co.total - co.retencion_iva - co.retencion_isr))
                     OR (co.condicion = 'credito' AND eg.id IS NOT NULL))`,
        )
        await revisar(
            'F5.compra_anulada_mal (reverso del asiento de la compra y, al contado, su egreso anulado con ese reverso)',
            `SELECT co.id, x.asiento_id, a.reversa_de, eg.id AS egreso_id, ea.asiento_id AS reverso_egreso
               FROM ledger.compras co JOIN ledger.compras_anulaciones x ON x.compra_id = co.id
               LEFT JOIN ledger.asientos a ON a.id = x.asiento_id
               LEFT JOIN ledger.egresos eg ON eg.compra_id = co.id
               LEFT JOIN ledger.egresos_anulaciones ea ON ea.egreso_id = eg.id
              WHERE ${E('co.empresa_id')}
                AND (a.id IS NULL OR a.origen_tipo <> 'compra' OR a.origen_id <> co.id
                     OR a.reversa_de IS DISTINCT FROM (SELECT o.id FROM ledger.asientos o WHERE o.origen_tipo = 'compra'
                                                         AND o.origen_id = co.id AND o.reversa_de IS NULL)
                     OR (eg.id IS NOT NULL AND ea.asiento_id IS DISTINCT FROM x.asiento_id))`,
        )
        await revisar(
            'F5.egreso_de_compra_con_asiento_propio (el pago al contado no genera otro asiento)',
            `SELECT e.id, e.compra_id FROM ledger.egresos e
              WHERE ${E('e.empresa_id')} AND e.compra_id IS NOT NULL
                AND EXISTS (SELECT 1 FROM ledger.asientos a WHERE a.origen_tipo = 'egreso' AND a.origen_id = e.id)`,
        )
        await revisar(
            'F5.retenciones_por_pagar_distintas (2.1.04 = Σ retención de IVA, 2.1.05 = Σ retención de ISR de compras vigentes)',
            `WITH docs AS (
                 SELECT c.empresa_id, sum(c.retencion_iva) AS iva, sum(c.retencion_isr) AS isr
                   FROM ledger.compras c
                  WHERE ${E('c.empresa_id')} AND NOT EXISTS (SELECT 1 FROM ledger.compras_anulaciones x WHERE x.compra_id = c.id)
                  GROUP BY 1
             ), libro AS (
                 SELECT a.empresa_id,
                        sum(CASE WHEN c.codigo = '${CUENTAS_GT.RETENCIONES_IVA_POR_PAGAR}' THEN m.haber - m.debe ELSE 0 END) AS iva,
                        sum(CASE WHEN c.codigo = '${CUENTAS_GT.RETENCIONES_ISR_POR_PAGAR}' THEN m.haber - m.debe ELSE 0 END) AS isr
                   FROM ledger.movimientos m JOIN ledger.asientos a ON a.id = m.asiento_id
                   JOIN ledger.cuentas c ON c.id = m.cuenta_id
                  WHERE ${E('a.empresa_id')} AND c.codigo IN ('${CUENTAS_GT.RETENCIONES_IVA_POR_PAGAR}', '${CUENTAS_GT.RETENCIONES_ISR_POR_PAGAR}')
                  GROUP BY 1
             )
             SELECT coalesce(d.empresa_id, l.empresa_id) AS empresa_id, coalesce(d.iva, 0)::text AS docs_iva,
                    coalesce(l.iva, 0)::text AS libro_iva, coalesce(d.isr, 0)::text AS docs_isr, coalesce(l.isr, 0)::text AS libro_isr
               FROM docs d FULL JOIN libro l ON l.empresa_id = d.empresa_id
              WHERE coalesce(d.iva, 0) <> coalesce(l.iva, 0) OR coalesce(d.isr, 0) <> coalesce(l.isr, 0)`,
        )
        await revisar(
            'F5.pago_proveedor_mal_contabilizado (2.1.03 debe = monto con su proveedor; caja o banco haber = monto; anulado = reverso)',
            `WITH mov AS (
                 SELECT a.origen_id AS pago_id,
                        sum(CASE WHEN c.codigo = '${PROVEEDORES}' AND m.proveedor_id = pp.proveedor_id THEN m.debe - m.haber ELSE 0 END) AS cxp,
                        sum(CASE WHEN m.cuenta_id = pp.cuenta_id THEN m.haber - m.debe ELSE 0 END) AS dinero,
                        count(*) AS lineas,
                        bool_or(EXISTS (SELECT 1 FROM ledger.asientos r WHERE r.reversa_de = a.id)) AS revertido
                   FROM ledger.asientos a JOIN ledger.pagos_proveedores pp ON pp.id = a.origen_id
                   JOIN ledger.movimientos m ON m.asiento_id = a.id JOIN ledger.cuentas c ON c.id = m.cuenta_id
                  WHERE a.origen_tipo = 'pago_proveedor' AND a.reversa_de IS NULL
                  GROUP BY 1
             )
             SELECT pp.id, pp.monto::text, mov.cxp::text, mov.dinero::text, mov.lineas, mov.revertido,
                    EXISTS (SELECT 1 FROM ledger.pagos_proveedores_anulaciones x WHERE x.pago_id = pp.id) AS anulado
               FROM ledger.pagos_proveedores pp LEFT JOIN mov ON mov.pago_id = pp.id
              WHERE ${E('pp.empresa_id')}
                AND (mov.pago_id IS NULL OR mov.cxp <> pp.monto OR mov.dinero <> pp.monto OR mov.lineas <> 2
                     OR mov.revertido <> EXISTS (SELECT 1 FROM ledger.pagos_proveedores_anulaciones x WHERE x.pago_id = pp.id))`,
        )
        if (conRetenido) {
            await revisar(
                'F5.retenciones_recibidas_distintas (1.1.05 + 1.1.06 = Σ constancias recibidas de pagos vigentes; retenido = Σ constancias)',
                `WITH docs AS (
                     SELECT k.empresa_id,
                            sum(CASE WHEN k.impuesto = 'iva' THEN k.monto ELSE 0 END) AS iva,
                            sum(CASE WHEN k.impuesto = 'isr' THEN k.monto ELSE 0 END) AS isr
                       FROM ledger.constancias_retencion k JOIN billing.pagos p ON p.id = k.pago_id
                      WHERE k.direccion = 'recibida' AND p.estado = 'registrado' AND ${E('k.empresa_id')}
                      GROUP BY 1
                 ), libro AS (
                     SELECT a.empresa_id,
                            sum(CASE WHEN c.codigo = '${CUENTAS_GT.IVA_RETENIDO_CLIENTES}' THEN m.debe - m.haber ELSE 0 END) AS iva,
                            sum(CASE WHEN c.codigo = '${CUENTAS_GT.ISR_RETENIDO_CLIENTES}' THEN m.debe - m.haber ELSE 0 END) AS isr
                       FROM ledger.movimientos m JOIN ledger.asientos a ON a.id = m.asiento_id
                       JOIN ledger.cuentas c ON c.id = m.cuenta_id
                      WHERE ${E('a.empresa_id')} AND c.codigo IN ('${CUENTAS_GT.IVA_RETENIDO_CLIENTES}', '${CUENTAS_GT.ISR_RETENIDO_CLIENTES}')
                      GROUP BY 1
                 )
                 SELECT coalesce(d.empresa_id, l.empresa_id) AS empresa_id, coalesce(d.iva, 0)::text AS docs_iva,
                        coalesce(l.iva, 0)::text AS libro_iva, coalesce(d.isr, 0)::text AS docs_isr,
                        coalesce(l.isr, 0)::text AS libro_isr, NULL AS pago_id
                   FROM docs d FULL JOIN libro l ON l.empresa_id = d.empresa_id
                  WHERE coalesce(d.iva, 0) <> coalesce(l.iva, 0) OR coalesce(d.isr, 0) <> coalesce(l.isr, 0)
                 UNION ALL
                 SELECT p.empresa_id, p.retenido::text, coalesce(sum(k.monto), 0)::text, NULL, NULL, p.id
                   FROM billing.pagos p LEFT JOIN ledger.constancias_retencion k ON k.pago_id = p.id AND k.direccion = 'recibida'
                  WHERE ${E('p.empresa_id')}
                  GROUP BY p.id, p.empresa_id, p.retenido
                 HAVING p.retenido <> coalesce(sum(k.monto), 0)`,
            )
        }
        // libro de compras = 1.1.04 de los asientos de compras, por empresa y mes
        for (const empresaId of empresas) {
            const meses = await filas(
                `SELECT to_char(min(m), 'YYYY-MM-DD') AS desde, to_char(max(m), 'YYYY-MM-DD') AS hasta FROM (
                     SELECT periodo_iva AS m FROM ledger.compras WHERE empresa_id = ${Number(empresaId)}
                     UNION ALL SELECT a.fecha FROM ledger.asientos a WHERE a.empresa_id = ${Number(empresaId)} AND a.origen_tipo = 'compra'
                 ) x`,
            )
            const rango = meses[0]
            if (!rango?.desde) continue
            const cuadre = await cuadreCompras(empresaId, {
                desde: String(rango.desde),
                hasta: String(rango.hasta),
            })
            const descuadres = cuadre.filter((c) => !c.cuadra)
            if (descuadres.length > 0) {
                violaciones.push({ invariante: 'F5.libro_compras_distinto_de_1.1.04', detalle: descuadres })
            }
        }
    }

    if (conActivos) {
        await revisar(
            'F5.activo_depreciado_de_mas (inicial + Σ cuotas ≤ costo − residual; una cuota por activo y mes)',
            `SELECT ac.id, ac.costo::text, ac.valor_residual::text, coalesce(sum(q.monto), 0)::text AS depreciado
               FROM ledger.activos ac LEFT JOIN ledger.activos_cuotas q ON q.activo_id = ac.id
              WHERE ${E('ac.empresa_id')}
              GROUP BY ac.id, ac.costo, ac.valor_residual, ac.depreciacion_inicial
             HAVING ac.depreciacion_inicial + coalesce(sum(q.monto), 0) > ac.costo - ac.valor_residual
                 OR count(q.id) <> count(DISTINCT q.mes)`,
        )
        await revisar(
            'F5.depreciacion_acumulada_distinta (1.2.02.NN = Σ cuotas de los activos vivos de su clase)',
            `WITH docs AS (
                 SELECT ac.empresa_id, ac.cuenta_depreciacion_id AS cuenta_id,
                        sum(ac.depreciacion_inicial + coalesce((SELECT sum(q.monto) FROM ledger.activos_cuotas q
                                                                 WHERE q.activo_id = ac.id), 0)) AS monto
                   FROM ledger.activos ac
                  WHERE ${E('ac.empresa_id')} AND NOT EXISTS (SELECT 1 FROM ledger.activos_bajas b WHERE b.activo_id = ac.id)
                  GROUP BY 1, 2
             ), libro AS (
                 SELECT a.empresa_id, m.cuenta_id, sum(m.haber - m.debe) AS monto
                   FROM ledger.movimientos m JOIN ledger.asientos a ON a.id = m.asiento_id
                   JOIN ledger.cuentas c ON c.id = m.cuenta_id
                  WHERE c.codigo LIKE '${CUENTAS_GT.DEPRECIACION_ACUMULADA}.%' AND ${E('a.empresa_id')}
                  GROUP BY 1, 2
             )
             SELECT coalesce(d.empresa_id, l.empresa_id) AS empresa_id,
                    (SELECT codigo FROM ledger.cuentas WHERE id = coalesce(d.cuenta_id, l.cuenta_id)) AS cuenta,
                    coalesce(d.monto, 0)::text AS cuotas, coalesce(l.monto, 0)::text AS libro
               FROM docs d FULL JOIN libro l ON l.empresa_id = d.empresa_id AND l.cuenta_id = d.cuenta_id
              WHERE coalesce(d.monto, 0) <> coalesce(l.monto, 0)`,
        )
        await revisar(
            'F5.costo_de_activos_distinto (1.2.01.NN = Σ costo de los activos vivos)',
            `WITH docs AS (
                 SELECT ac.empresa_id, ac.cuenta_activo_id AS cuenta_id, sum(ac.costo) AS monto
                   FROM ledger.activos ac
                  WHERE ${E('ac.empresa_id')} AND NOT EXISTS (SELECT 1 FROM ledger.activos_bajas b WHERE b.activo_id = ac.id)
                  GROUP BY 1, 2
             ), libro AS (
                 SELECT a.empresa_id, m.cuenta_id, sum(m.debe - m.haber) AS monto
                   FROM ledger.movimientos m JOIN ledger.asientos a ON a.id = m.asiento_id
                   JOIN ledger.cuentas c ON c.id = m.cuenta_id
                  WHERE c.codigo LIKE '${CUENTAS_GT.PROPIEDAD_PLANTA_EQUIPO}.%' AND ${E('a.empresa_id')}
                  GROUP BY 1, 2
             )
             SELECT coalesce(d.empresa_id, l.empresa_id) AS empresa_id,
                    (SELECT codigo FROM ledger.cuentas WHERE id = coalesce(d.cuenta_id, l.cuenta_id)) AS cuenta,
                    coalesce(d.monto, 0)::text AS activos, coalesce(l.monto, 0)::text AS libro
               FROM docs d FULL JOIN libro l ON l.empresa_id = d.empresa_id AND l.cuenta_id = d.cuenta_id
              WHERE coalesce(d.monto, 0) <> coalesce(l.monto, 0)`,
        )
        await revisar(
            'F5.cuota_de_depreciacion_mal_contabilizada (gasto debe = cuota, 1.2.02 haber = cuota, empresa del activo)',
            `SELECT q.id, q.monto::text, a.empresa_id, ac.empresa_id AS empresa_activo,
                    sum(CASE WHEN m.cuenta_id = ac.cuenta_gasto_id THEN m.debe - m.haber ELSE 0 END)::text AS gasto,
                    sum(CASE WHEN m.cuenta_id = ac.cuenta_depreciacion_id THEN m.haber - m.debe ELSE 0 END)::text AS acumulada
               FROM ledger.activos_cuotas q JOIN ledger.activos ac ON ac.id = q.activo_id
               JOIN ledger.asientos a ON a.id = q.asiento_id
               JOIN ledger.movimientos m ON m.asiento_id = a.id
              WHERE ${E('ac.empresa_id')}
              GROUP BY q.id, q.monto, a.empresa_id, ac.empresa_id, a.origen_tipo
             HAVING a.empresa_id <> ac.empresa_id OR a.origen_tipo <> 'depreciacion'
                 OR sum(CASE WHEN m.cuenta_id = ac.cuenta_gasto_id THEN m.debe - m.haber ELSE 0 END) <> q.monto
                 OR sum(CASE WHEN m.cuenta_id = ac.cuenta_depreciacion_id THEN m.haber - m.debe ELSE 0 END) <> q.monto`,
        )
    }

    if (conDiferidos) {
        await revisar(
            'F5.diferido_amortizado_de_mas (Σ cuotas ≤ total; una cuota por diferimiento y mes)',
            `SELECT d.id, d.total::text, coalesce(sum(q.monto), 0)::text AS amortizado
               FROM ledger.diferimientos d LEFT JOIN ledger.diferimientos_cuotas q ON q.diferimiento_id = d.id
              WHERE ${E('d.empresa_id')}
              GROUP BY d.id, d.total
             HAVING coalesce(sum(q.monto), 0) > d.total OR count(q.id) <> count(DISTINCT q.mes)`,
        )
        await revisar(
            'F5.saldo_diferido_distinto (1.1.13 y 2.1.12 = Σ pendiente de amortizar de los diferimientos vigentes)',
            `WITH docs AS (
                 SELECT d.empresa_id, d.cuenta_diferida_id AS cuenta_id,
                        sum(d.total - coalesce((SELECT sum(q.monto) FROM ledger.diferimientos_cuotas q WHERE q.diferimiento_id = d.id), 0)) AS monto
                   FROM ledger.diferimientos d
                  WHERE ${E('d.empresa_id')} AND NOT EXISTS (SELECT 1 FROM ledger.diferimientos_cancelaciones x WHERE x.diferimiento_id = d.id)
                  GROUP BY 1, 2
             ), libro AS (
                 SELECT a.empresa_id, m.cuenta_id,
                        sum(CASE WHEN c.codigo = '${CUENTAS_GT.GASTOS_PAGADOS_ANTICIPADO}' THEN m.debe - m.haber ELSE m.haber - m.debe END) AS monto
                   FROM ledger.movimientos m JOIN ledger.asientos a ON a.id = m.asiento_id
                   JOIN ledger.cuentas c ON c.id = m.cuenta_id
                  WHERE c.codigo IN ('${CUENTAS_GT.GASTOS_PAGADOS_ANTICIPADO}', '${CUENTAS_GT.INGRESOS_COBRADOS_ANTICIPADO}') AND ${E('a.empresa_id')}
                  GROUP BY 1, 2
             )
             SELECT coalesce(d.empresa_id, l.empresa_id) AS empresa_id,
                    (SELECT codigo FROM ledger.cuentas WHERE id = coalesce(d.cuenta_id, l.cuenta_id)) AS cuenta,
                    coalesce(d.monto, 0)::text AS pendiente, coalesce(l.monto, 0)::text AS libro
               FROM docs d FULL JOIN libro l ON l.empresa_id = d.empresa_id AND l.cuenta_id = d.cuenta_id
              WHERE coalesce(d.monto, 0) <> coalesce(l.monto, 0)`,
        )
    }
    return violaciones
}

/** Auditor completo con los reemplazos de la fase 5. */
export async function verificarLibroFase5(empresas: number[]): Promise<Violacion[]> {
    const todas = await verificarLibro(empresas)
    const superados = Object.keys(SUPERADOS_POR_FASE5)
    const vigentes = todas.filter((v) => !superados.some((clave) => v.invariante.startsWith(clave)))
    return [...vigentes, ...(await invariantesFase5(empresas))]
}

export async function afirmarLibroFase5(
    assert: { deepEqual: (a: unknown, b: unknown, m?: string) => void },
    empresas: number[],
) {
    const violaciones = await verificarLibroFase5(empresas)
    assert.deepEqual(
        violaciones,
        [],
        `Invariantes contables rotos (fase 5, empresas ${empresas.join(', ')}):\n${JSON.stringify(violaciones, null, 2)}`,
    )
}
