import db from '@adonisjs/lucid/services/db'
import { CUENTAS } from '#ledger/plan_cuentas'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import { verificarLibro, type Violacion } from '#tests/contabilidad/verificar_libro'

/**
 * A3 · fase 4 (cobros y bancos): verificación del libro en las pruebas de `tests/ledger/` y
 * `tests/billing/` que usan las piezas nuevas.
 *
 * Corre **toda** la suite del auditor (`verificarLibro`) y, para los invariantes del auditor que
 * suponen el mundo anterior a la fase 4 (pagos de pasarela directo al banco, ningún depósito,
 * orígenes de asiento sin los nuevos, `pagado` sin castigos, `2.1.11` sin castigos), aplica su
 * versión ampliada a la fase 4 en lugar de la original. Nada se relaja: cada reemplazo revisa lo
 * mismo que el original **más** los documentos nuevos. La lista exacta va en el reporte al líder y al
 * auditor para que el auditor actualice los suyos (`.claude/integration/a3.md`).
 */
export const SUPERADOS_POR_FASE4: Record<string, string> = {
    '4.saldo_de_caja_o_banco_distinto_de_sus_documentos':
        'los documentos ahora incluyen liquidaciones, depósitos, traslados y partidas del extracto; los pagos con proveedor de cobro no tocan el banco',
    '4.caja_cerrada_no_cuadra': 'el esperado del turno resta los depósitos al banco (§10.3)',
    '5.pago_vigente_mal_contabilizado':
        'un pago con proveedor de cobro debita 1.1.10.NN por el bruto, sin comisión',
    '9.origen_de_asiento_desconocido':
        'orígenes de la fase 4: liquidacion_cobro, deposito, traslado, banco, provision, castigo',
    '5.factura_pagado_inconsistente': 'el castigo de cartera cubre la factura (cartera.castigar)',
    '12.iva_por_certificar_distinto': 'el castigo de un aviso sin DTE saca su IVA de 2.1.11 (§10.1)',
    '12.iva_por_certificar_del_documento': 'ídem, por documento',
    '12.movimiento_en_2.1.11_de_origen_inesperado': 'el castigo de un aviso es un origen esperado de 2.1.11',
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

const CAJAS = CUENTAS.CAJAS
const BANCOS = CUENTAS.BANCOS
const PUENTE = CUENTAS_GT.COBROS_POR_LIQUIDAR
const TRANSITO = CUENTAS_GT.FONDOS_EN_TRANSITO

/** Tabla de la fase 4 presente (las piezas llegan en commits separados). */
async function existe(tabla: string): Promise<boolean> {
    const [f] = await filas(`SELECT to_regclass('${tabla}') IS NOT NULL AS existe`)
    return Boolean(f?.existe)
}

/** Invariantes de la fase 4 (los reemplazos y los nuevos: puentes y conciliación). */
export async function invariantesFase4(empresas: number[]): Promise<Violacion[]> {
    const E = (col: string) => en(col, empresas)
    const violaciones: Violacion[] = []
    const revisar = async (invariante: string, sql: string) => {
        const resultado = await filas(sql)
        if (resultado.length > 0) violaciones.push({ invariante, detalle: resultado })
    }
    const conDepositos = await existe('ledger.depositos')
    const conExtractos = await existe('ledger.extractos_lineas')
    const conCastigos = await existe('ledger.castigos_facturas')

    // R3 · orígenes
    await revisar(
        'F4.origen_de_asiento_desconocido',
        `SELECT a.id, a.origen_tipo FROM ledger.asientos a
          WHERE ${E('a.empresa_id')}
            AND a.origen_tipo NOT IN ('factura', 'mora', 'pago', 'nota_credito', 'egreso', 'cierre_caja', 'ajuste',
                                      'reclasificacion', 'liquidacion_cobro', 'deposito', 'traslado', 'banco',
                                      'provision', 'castigo')`,
    )

    // R2 · pago vigente: caja/banco por monto − comisión; con proveedor de cobro, su 1.1.10.NN por el bruto
    await revisar(
        'F4.pago_vigente_mal_contabilizado',
        `WITH mov AS (
             SELECT a.origen_id AS pago_id,
                    sum(CASE WHEN c.codigo LIKE '${CAJAS}.%' OR c.codigo LIKE '${BANCOS}.%' THEN m.debe - m.haber ELSE 0 END) AS dinero,
                    sum(CASE WHEN c.codigo LIKE '${PUENTE}.%' THEN m.debe - m.haber ELSE 0 END) AS puente,
                    sum(CASE WHEN c.codigo = '${CUENTAS.COMISIONES_PASARELAS}' THEN m.debe - m.haber ELSE 0 END) AS comision,
                    bool_or(EXISTS (SELECT 1 FROM ledger.asientos r WHERE r.reversa_de = a.id)) AS revertido,
                    max(CASE WHEN c.codigo LIKE '${PUENTE}.%' THEN m.cuenta_id END) AS cuenta_puente
               FROM ledger.asientos a
               JOIN ledger.movimientos m ON m.asiento_id = a.id
               JOIN ledger.cuentas c ON c.id = m.cuenta_id
              WHERE a.origen_tipo = 'pago' AND a.reversa_de IS NULL
              GROUP BY 1
         )
         SELECT p.id, p.metodo, p.monto::text, p.comision::text, p.proveedor_cobro_id,
                mov.dinero::text, mov.puente::text, mov.comision::text AS comision_libro, mov.revertido
           FROM billing.pagos p LEFT JOIN mov ON mov.pago_id = p.id
           LEFT JOIN ledger.proveedores_cobro pc ON pc.id = p.proveedor_cobro_id
          WHERE ${E('p.empresa_id')} AND p.estado = 'registrado' AND NOT p.historico
            AND (mov.pago_id IS NULL OR mov.revertido
                 OR (p.proveedor_cobro_id IS NULL AND (mov.dinero <> p.monto - p.comision OR mov.comision <> p.comision OR mov.puente <> 0))
                 OR (p.proveedor_cobro_id IS NOT NULL AND (mov.puente <> p.monto OR mov.dinero <> 0 OR mov.comision <> 0
                                                           OR p.comision <> 0 OR mov.cuenta_puente <> pc.cuenta_id)))`,
    )

    // R5 · puente 1.1.10.NN = pagos sin liquidar − contracargos pendientes (por proveedor; cálculo propio)
    await revisar(
        'F4.cobros_por_liquidar_distinto (1.1.10.NN = Σ pagos sin liquidar − contracargos pendientes)',
        `WITH esperado AS (
             SELECT pc.id, pc.empresa_id, pc.cuenta_id,
                    coalesce(sum(CASE
                        WHEN p.estado = 'registrado' AND NOT EXISTS (SELECT 1 FROM ledger.liquidaciones_pagos l WHERE l.pago_id = p.id AND l.tipo = 'cobro') THEN p.monto
                        WHEN p.estado = 'anulado' AND EXISTS (SELECT 1 FROM ledger.liquidaciones_pagos l WHERE l.pago_id = p.id AND l.tipo = 'cobro')
                             AND NOT EXISTS (SELECT 1 FROM ledger.liquidaciones_pagos l WHERE l.pago_id = p.id AND l.tipo = 'contracargo') THEN -p.monto
                        ELSE 0 END), 0) AS monto
               FROM ledger.proveedores_cobro pc LEFT JOIN billing.pagos p ON p.proveedor_cobro_id = pc.id
              WHERE ${E('pc.empresa_id')}
              GROUP BY 1, 2, 3
         ), libro AS (
             SELECT a.empresa_id, m.cuenta_id, sum(m.debe - m.haber) AS monto
               FROM ledger.movimientos m JOIN ledger.asientos a ON a.id = m.asiento_id
               JOIN ledger.cuentas c ON c.id = m.cuenta_id
              WHERE c.codigo LIKE '${PUENTE}.%' AND ${E('a.empresa_id')}
              GROUP BY 1, 2
         )
         SELECT coalesce(e.empresa_id, l.empresa_id) AS empresa_id, coalesce(e.cuenta_id, l.cuenta_id) AS cuenta_id,
                coalesce(e.monto, 0)::text AS esperado, coalesce(l.monto, 0)::text AS libro
           FROM esperado e FULL JOIN libro l ON l.cuenta_id = e.cuenta_id AND l.empresa_id = e.empresa_id
          WHERE coalesce(e.monto, 0) <> coalesce(l.monto, 0)`,
    )
    await revisar(
        'F4.liquidacion_mal_contabilizada (Banco neto + 5.1.02 comisión / 1.1.10.NN bruto; bruto = Σ pagos − contracargos)',
        `WITH mov AS (
             SELECT a.origen_id AS id,
                    sum(CASE WHEN m.cuenta_id = l.cuenta_id THEN m.debe - m.haber ELSE 0 END) AS banco,
                    sum(CASE WHEN c.codigo = '${CUENTAS.COMISIONES_PASARELAS}' THEN m.debe - m.haber ELSE 0 END) AS comision,
                    sum(CASE WHEN m.cuenta_id = pc.cuenta_id THEN m.haber - m.debe ELSE 0 END) AS puente,
                    count(*) AS lineas
               FROM ledger.asientos a
               JOIN ledger.liquidaciones_cobro l ON l.id = a.origen_id
               JOIN ledger.proveedores_cobro pc ON pc.id = l.proveedor_cobro_id
               JOIN ledger.movimientos m ON m.asiento_id = a.id
               JOIN ledger.cuentas c ON c.id = m.cuenta_id
              WHERE a.origen_tipo = 'liquidacion_cobro' AND a.reversa_de IS NULL AND a.empresa_id = l.empresa_id
              GROUP BY 1
         ), pagos AS (
             SELECT liquidacion_id, sum(CASE WHEN tipo = 'cobro' THEN monto ELSE -monto END) AS bruto
               FROM ledger.liquidaciones_pagos GROUP BY 1
         )
         SELECT l.id, l.bruto::text, l.comision::text, l.neto::text, mov.banco::text, mov.comision::text AS comision_libro,
                mov.puente::text, pagos.bruto::text AS bruto_pagos
           FROM ledger.liquidaciones_cobro l LEFT JOIN mov ON mov.id = l.id LEFT JOIN pagos ON pagos.liquidacion_id = l.id
          WHERE ${E('l.empresa_id')}
            AND (mov.id IS NULL OR mov.banco <> l.neto OR mov.comision <> l.comision OR mov.puente <> l.bruto
                 OR pagos.bruto IS DISTINCT FROM l.bruto)`,
    )

    // R1 · mayor de cada caja y banco = sus documentos
    const depositos = conDepositos
        ? `UNION ALL
             -- depósito de caja: sale de la caja; acreditado (al conciliar), entra al banco
             SELECT d.empresa_id, -d.monto, cj.cuenta_id FROM ledger.depositos d JOIN ledger.cajas cj ON cj.id = d.caja_id
              WHERE ${E('d.empresa_id')}
             UNION ALL
             SELECT d.empresa_id, d.monto, d.cuenta_id FROM ledger.depositos d
              WHERE ${E('d.empresa_id')} AND EXISTS (SELECT 1 FROM ledger.transitos_acreditados x WHERE x.tipo = 'deposito' AND x.documento_id = d.id)
             UNION ALL
             SELECT t.empresa_id, -t.monto, t.cuenta_origen_id FROM ledger.traslados t WHERE ${E('t.empresa_id')}
             UNION ALL
             SELECT t.empresa_id, t.monto, t.cuenta_destino_id FROM ledger.traslados t
              WHERE ${E('t.empresa_id')} AND EXISTS (SELECT 1 FROM ledger.transitos_acreditados x WHERE x.tipo = 'traslado' AND x.documento_id = t.id)`
        : ''
    const extracto = conExtractos
        ? `UNION ALL
             -- partida del extracto sin documento (comisión, interés): el monto de su línea en su cuenta
             SELECT el.empresa_id, el.monto, el.cuenta_id FROM ledger.extractos_lineas el
              WHERE ${E('el.empresa_id')} AND EXISTS (SELECT 1 FROM ledger.asientos a WHERE a.origen_tipo = 'banco' AND a.origen_id = el.id AND a.reversa_de IS NULL)`
        : ''
    await revisar(
        'F4.saldo_de_caja_o_banco_distinto_de_sus_documentos',
        `WITH docs AS (
             SELECT empresa_id, cuenta_id, sum(monto) AS saldo FROM (
                 SELECT p.empresa_id, p.monto - p.comision AS monto,
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

    // R4 · caja cerrada: esperado = fondo + cobros − egresos − depósitos del turno
    await revisar(
        'F4.caja_cerrada_no_cuadra',
        `WITH t AS (
             SELECT t.*, cj.cuenta_id, cj.empresa_id FROM ledger.cajas_turnos t JOIN ledger.cajas cj ON cj.id = t.caja_id
              WHERE t.cerrado_en IS NOT NULL AND ${E('cj.empresa_id')}
         ), libro AS (
             SELECT t.id AS turno_id, coalesce(sum(m.debe - m.haber), 0) AS neto
               FROM t
               JOIN ledger.asientos a ON a.created_at <= t.cerrado_en
                    AND ((a.origen_tipo = 'pago' AND a.origen_id IN (SELECT id FROM billing.pagos WHERE turno_id = t.id))
                      OR (a.origen_tipo = 'egreso' AND a.origen_id IN (SELECT id FROM ledger.egresos WHERE turno_id = t.id))
                      ${conDepositos ? `OR (a.origen_tipo = 'deposito' AND a.origen_id IN (SELECT id FROM ledger.depositos WHERE turno_id = t.id))` : ''})
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

    if (conDepositos) {
        await revisar(
            'F4.fondos_en_transito_distinto (1.1.11 = depósitos y traslados sin acreditar)',
            `WITH esperado AS (
                 SELECT empresa_id, sum(monto) AS monto FROM (
                     SELECT d.empresa_id, d.monto FROM ledger.depositos d
                      WHERE ${E('d.empresa_id')} AND NOT EXISTS (SELECT 1 FROM ledger.transitos_acreditados x WHERE x.tipo = 'deposito' AND x.documento_id = d.id)
                     UNION ALL
                     SELECT t.empresa_id, t.monto FROM ledger.traslados t
                      WHERE ${E('t.empresa_id')} AND NOT EXISTS (SELECT 1 FROM ledger.transitos_acreditados x WHERE x.tipo = 'traslado' AND x.documento_id = t.id)
                 ) x GROUP BY 1
             ), libro AS (
                 SELECT a.empresa_id, sum(m.debe - m.haber) AS monto
                   FROM ledger.movimientos m JOIN ledger.asientos a ON a.id = m.asiento_id
                   JOIN ledger.cuentas c ON c.id = m.cuenta_id
                  WHERE c.codigo = '${TRANSITO}' AND ${E('a.empresa_id')}
                  GROUP BY 1
             )
             SELECT coalesce(e.empresa_id, l.empresa_id) AS empresa_id, coalesce(e.monto, 0)::text AS esperado,
                    coalesce(l.monto, 0)::text AS libro
               FROM esperado e FULL JOIN libro l ON l.empresa_id = e.empresa_id
              WHERE coalesce(e.monto, 0) <> coalesce(l.monto, 0)`,
        )
    }

    if (conExtractos) {
        await revisar(
            'F4.conciliacion_descuadrada (Σ movimientos vigentes del grupo = línea; cada fila = neto del movimiento en la cuenta)',
            `WITH vig AS (
                 SELECT c.* FROM ledger.conciliaciones c
                  WHERE ${E('c.empresa_id')} AND NOT EXISTS (SELECT 1 FROM ledger.conciliaciones_anulaciones x WHERE x.conciliacion_id = c.id)
             )
             SELECT v.grupo, v.linea_id, sum(v.monto)::text AS conciliado, el.monto::text AS linea,
                    bool_and(v.monto = m.debe - m.haber AND m.cuenta_id = el.cuenta_id AND a.empresa_id = el.empresa_id) AS filas_ok
               FROM vig v JOIN ledger.extractos_lineas el ON el.id = v.linea_id
               JOIN ledger.movimientos m ON m.id = v.movimiento_id JOIN ledger.asientos a ON a.id = m.asiento_id
              GROUP BY v.grupo, v.linea_id, el.monto
             HAVING sum(v.monto) <> el.monto
                 OR NOT bool_and(v.monto = m.debe - m.haber AND m.cuenta_id = el.cuenta_id AND a.empresa_id = el.empresa_id)`,
        )
        await revisar(
            'F4.conciliacion_duplicada (un movimiento o una línea en dos conciliaciones vigentes)',
            `WITH vig AS (
                 SELECT c.* FROM ledger.conciliaciones c
                  WHERE ${E('c.empresa_id')} AND NOT EXISTS (SELECT 1 FROM ledger.conciliaciones_anulaciones x WHERE x.conciliacion_id = c.id)
             )
             SELECT 'movimiento' AS que, movimiento_id AS id, count(DISTINCT grupo)::int AS grupos FROM vig GROUP BY movimiento_id HAVING count(DISTINCT grupo) > 1
             UNION ALL
             SELECT 'linea', linea_id, count(DISTINCT grupo)::int FROM vig GROUP BY linea_id HAVING count(DISTINCT grupo) > 1`,
        )
    }

    if (conCastigos) {
        // R6 · pagado = aplicaciones + notas + saldos a favor + castigos
        await revisar(
            'F4.factura_pagado_inconsistente',
            `WITH cub AS (
                 SELECT f.id, f.total, f.pagado,
                        coalesce((SELECT sum(a.monto) FROM billing.pagos_aplicaciones a JOIN billing.pagos p ON p.id = a.pago_id
                                   WHERE a.factura_id = f.id AND p.estado = 'registrado'), 0)
                      + coalesce((SELECT sum(n.monto) FROM billing.notas_credito n WHERE n.factura_id = f.id
                                   AND NOT EXISTS (SELECT 1 FROM billing.notas_credito_anulaciones xa WHERE xa.nota_id = n.id)), 0)
                      + coalesce((SELECT sum(a.monto) FROM billing.saldos_iniciales_aplicaciones a
                                   JOIN billing.saldos_iniciales s ON s.id = a.saldo_inicial_id
                                   WHERE a.factura_id = f.id AND s.anulado_en IS NULL), 0)
                      + coalesce((SELECT sum(cf.monto) FROM ledger.castigos_facturas cf WHERE cf.factura_id = f.id), 0) AS cubierto,
                        EXISTS (SELECT 1 FROM ledger.asientos a WHERE a.origen_tipo IN ('factura', 'mora') AND a.origen_id = f.id
                                 AND a.reversa_de IS NULL) AS tiene_asiento
                   FROM billing.facturas f
                  WHERE ${E('f.empresa_id')} AND f.estado <> 'anulada'
             )
             SELECT id, total::text, pagado::text, cubierto::text FROM cub
              WHERE pagado < 0 OR pagado > total
                 OR (cubierto <> pagado AND NOT (cubierto = 0 AND pagado = total AND NOT tiene_asiento))`,
        )
        // R7 · 2.1.11 = Σ IVA de avisos sin DTE − notas internas − IVA castigado
        await revisar(
            'F4.iva_por_certificar_distinto',
            `WITH esperado AS (
                 SELECT f.empresa_id,
                        sum(f.iva
                            - coalesce((SELECT sum(n.iva) FROM billing.notas_credito n WHERE n.factura_id = f.id
                                         AND NOT EXISTS (SELECT 1 FROM billing.notas_credito_anulaciones xa WHERE xa.nota_id = n.id)), 0)
                            - coalesce((SELECT sum(cf.iva) FROM ledger.castigos_facturas cf WHERE cf.factura_id = f.id), 0)) AS monto
                   FROM billing.facturas f
                  WHERE f.aviso_cobro AND f.estado <> 'anulada' AND ${E('f.empresa_id')}
                    AND NOT EXISTS (SELECT 1 FROM fiscal.dte d
                                     WHERE d.documento_id = f.id
                                       AND d.documento_tipo = CASE WHEN f.tipo = 'mora' THEN 'nota_debito' ELSE 'factura' END
                                       AND d.estado IN ('certificado', 'anulacion_pendiente'))
                  GROUP BY 1
             ), libro AS (
                 SELECT a.empresa_id, sum(m.haber - m.debe) AS monto
                   FROM ledger.movimientos m JOIN ledger.asientos a ON a.id = m.asiento_id
                   JOIN ledger.cuentas c ON c.id = m.cuenta_id
                  WHERE c.codigo = '2.1.11' AND ${E('a.empresa_id')}
                  GROUP BY 1
             )
             SELECT coalesce(e.empresa_id, l.empresa_id) AS empresa_id, coalesce(e.monto, 0)::text AS esperado,
                    coalesce(l.monto, 0)::text AS libro
               FROM esperado e FULL JOIN libro l ON l.empresa_id = e.empresa_id
              WHERE coalesce(e.monto, 0) <> coalesce(l.monto, 0)`,
        )
        await revisar(
            'F4.castigo_mal_contabilizado (CxC haber = Σ facturas; 2.1.11 debe = Σ IVA; 1.1.12 + 5.3.02 = resto)',
            `WITH mov AS (
                 SELECT a.origen_id AS id,
                        sum(CASE WHEN c.codigo = '${CUENTAS.CXC_CLIENTES}' THEN m.haber - m.debe ELSE 0 END) AS cxc,
                        sum(CASE WHEN c.codigo = '2.1.11' THEN m.debe - m.haber ELSE 0 END) AS iva,
                        sum(CASE WHEN c.codigo IN ('1.1.12', '5.3.02') THEN m.debe - m.haber ELSE 0 END) AS perdida
                   FROM ledger.asientos a JOIN ledger.movimientos m ON m.asiento_id = a.id
                   JOIN ledger.cuentas c ON c.id = m.cuenta_id
                  WHERE a.origen_tipo = 'castigo' AND a.reversa_de IS NULL
                  GROUP BY 1
             ), doc AS (
                 SELECT castigo_id, sum(monto) AS monto, sum(iva) AS iva FROM ledger.castigos_facturas GROUP BY 1
             )
             SELECT k.id, doc.monto::text, doc.iva::text, mov.cxc::text, mov.iva::text AS iva_libro, mov.perdida::text
               FROM ledger.castigos k JOIN doc ON doc.castigo_id = k.id LEFT JOIN mov ON mov.id = k.id
              WHERE ${E('k.empresa_id')}
                AND (mov.id IS NULL OR mov.cxc <> doc.monto OR mov.iva <> doc.iva OR mov.perdida <> doc.monto - doc.iva
                     OR k.monto <> doc.monto)`,
        )
    }
    return violaciones
}

/** Auditor completo con los reemplazos de la fase 4 (ver `SUPERADOS_POR_FASE4`). */
export async function verificarLibroFase4(empresas: number[]): Promise<Violacion[]> {
    const todas = await verificarLibro(empresas)
    // los invariantes de documentos y de 2.1.11 solo se reemplazan donde hay castigos: sin ellos rige
    // el original del auditor tal cual
    const [conCastigos] = await filas(
        `SELECT EXISTS (SELECT 1 FROM ledger.castigos WHERE ${en('empresa_id', empresas)}) AS hay`,
    )
    const soloConCastigos = new Set([
        '5.factura_pagado_inconsistente',
        '12.iva_por_certificar_distinto',
        '12.iva_por_certificar_del_documento',
        '12.movimiento_en_2.1.11_de_origen_inesperado',
    ])
    const superados = Object.keys(SUPERADOS_POR_FASE4).filter(
        (clave) => conCastigos?.hay || !soloConCastigos.has(clave),
    )
    const vigentes = todas.filter((v) => !superados.some((clave) => v.invariante.startsWith(clave)))
    return [...vigentes, ...(await invariantesFase4(empresas))]
}

export async function afirmarLibroFase4(
    assert: { deepEqual: (a: unknown, b: unknown, m?: string) => void },
    empresas: number[],
) {
    const violaciones = await verificarLibroFase4(empresas)
    assert.deepEqual(
        violaciones,
        [],
        `Invariantes contables rotos (fase 4, empresas ${empresas.join(', ')}):\n${JSON.stringify(violaciones, null, 2)}`,
    )
}
