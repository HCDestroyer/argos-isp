import db from '@adonisjs/lucid/services/db'
import { CUENTAS } from '#ledger/plan_cuentas'
import { CERO, dec, type Dec } from '#ledger/dinero'
import { saldoClientePorEmpresa } from '#ledger/consultas'
import { saldoAnticipos } from '#billing/cobros'
import { balanceSaldos, estadoResultados } from '#ledger/estados_financieros'
import { resumenDelMes } from '#ledger/cierres'
import { carteraVencida } from '#billing/reportes/reportes'
import { verificarCadena } from '#ledger/sellos'

/**
 * Auditor contable · `verificarLibro(empresaId?)`.
 *
 * Revisa los invariantes contables de todo el sistema sobre lo que hay en la base (no sobre lo que
 * una prueba cree que hizo). La puede llamar cualquier prueba después de armar su escenario con las
 * acciones de dominio:
 *
 * ```ts
 * await afirmarLibro(assert, empresaId)          // falla con la lista de violaciones
 * const violaciones = await verificarLibro(id)   // o revisarlas a mano
 * ```
 *
 * Alcance:
 *  - Los invariantes estructurales del libro (cuadre por asiento, por empresa y por mes; nada de
 *    mezclar empresas; reversos espejo) corren siempre sobre las empresas pedidas.
 *  - Los invariantes que comparan el libro contra los documentos (CxC = facturas pendientes,
 *    anticipos = excedentes, cajas y bancos = pagos) suponen que los documentos se crearon con las
 *    acciones. Algunas pruebas de otros módulos insertan facturas directo (fixtures sin asiento):
 *    por eso conviene acotar con `empresaId` (una empresa creada por la prueba) o con
 *    `opciones.clientes`. Sin argumentos revisa todas las empresas: es lo correcto en una base
 *    armada solo con acciones (`pnpm demo:datos`, laboratorio).
 *
 * Cada violación lleva el nombre del invariante (el número es el del encargo del auditor) y las
 * filas que no cuadran, para que el mensaje de la prueba diga exactamente qué cifra está mal.
 */

export interface Violacion {
    invariante: string
    detalle: unknown
}

export interface OpcionesVerificacion {
    /** solo estos clientes en los invariantes por cliente (CxC, anticipos, facturas) */
    clientes?: number[]
    /** omite las comparaciones con funciones del producto (más lentas): balance y saldos */
    sinFuncionesProducto?: boolean
}

type Fila = Record<string, unknown>

/** Fragmento SQL `col IN (…)` con ids numéricos validados (null = sin filtro). */
function en(columna: string, ids: number[] | null | undefined): string {
    if (ids === null || ids === undefined) return 'true'
    if (ids.length === 0) return 'false'
    for (const id of ids) {
        if (!Number.isSafeInteger(id)) throw new Error(`id inválido en el filtro: ${id}`)
    }
    return `${columna} IN (${ids.join(',')})`
}

async function filas(sql: string): Promise<Fila[]> {
    const resultado = await db.rawQuery(sql)
    return resultado.rows as Fila[]
}

const CXC = CUENTAS.CXC_CLIENTES
const ANTICIPOS = CUENTAS.ANTICIPOS_CLIENTES
const IVA = CUENTAS.IVA_DEBITO
/** `2.1.11 IVA por certificar` (localización fiscal §10.1): el IVA de los avisos de cobro sin DTE */
const IVA_TRANSICION = '2.1.11'
const APERTURA = CUENTAS.SALDOS_APERTURA
const ESTADOS_PENDIENTES = `('emitida', 'parcial', 'vencida')`

/** Empresas sobre las que se verifica: la pedida (o las pedidas) o todas. */
async function empresasDelAlcance(empresaId?: number | number[] | null): Promise<number[]> {
    if (Array.isArray(empresaId)) return empresaId
    if (empresaId) return [empresaId]
    const ids = await filas(`SELECT id FROM core.empresas ORDER BY id`)
    return ids.map((f) => Number(f.id))
}

/**
 * `empresaId`: una empresa, varias (el consolidado se revisa sobre ellas) o ninguna (todas).
 */
export async function verificarLibro(
    empresaId?: number | number[] | null,
    opciones: OpcionesVerificacion = {},
): Promise<Violacion[]> {
    const empresas = await empresasDelAlcance(empresaId)
    const E = (col: string) => en(col, empresas)
    const C = (col: string) => en(col, opciones.clientes)
    const violaciones: Violacion[] = []
    const revisar = async (invariante: string, sql: string) => {
        const encontradas = await filas(sql)
        if (encontradas.length > 0) violaciones.push({ invariante, detalle: encontradas.slice(0, 20) })
    }

    /*
    | 1 · Cuadre
    */
    await revisar(
        '1.asiento_descuadrado',
        `SELECT a.id, a.empresa_id, coalesce(sum(m.debe), 0)::text AS debe, coalesce(sum(m.haber), 0)::text AS haber,
                count(m.id)::int AS movimientos
           FROM ledger.asientos a LEFT JOIN ledger.movimientos m ON m.asiento_id = a.id
          WHERE ${E('a.empresa_id')}
          GROUP BY a.id
         HAVING coalesce(sum(m.debe), 0) <> coalesce(sum(m.haber), 0) OR count(m.id) < 2`,
    )
    await revisar(
        '1.movimiento_invalido (negativo, ambos lados, ninguno o más de 2 decimales)',
        `SELECT m.id, m.asiento_id, m.debe::text, m.haber::text
           FROM ledger.movimientos m JOIN ledger.asientos a ON a.id = m.asiento_id
          WHERE ${E('a.empresa_id')}
            AND (m.debe < 0 OR m.haber < 0 OR (m.debe > 0) = (m.haber > 0)
                 OR m.debe <> round(m.debe, 2) OR m.haber <> round(m.haber, 2))`,
    )
    await revisar(
        '1.asiento_mezcla_empresas (movimiento en subcuenta de otra empresa)',
        `SELECT a.id AS asiento_id, a.empresa_id, c.codigo, c.empresa_id AS empresa_cuenta
           FROM ledger.movimientos m
           JOIN ledger.asientos a ON a.id = m.asiento_id
           JOIN ledger.cuentas c ON c.id = m.cuenta_id
          WHERE ${E('a.empresa_id')} AND c.empresa_id IS NOT NULL AND c.empresa_id <> a.empresa_id`,
    )
    await revisar(
        '1.descuadre_por_empresa_y_periodo',
        `SELECT a.empresa_id, to_char(date_trunc('month', a.fecha), 'YYYY-MM') AS periodo,
                sum(m.debe)::text AS debe, sum(m.haber)::text AS haber
           FROM ledger.asientos a JOIN ledger.movimientos m ON m.asiento_id = a.id
          WHERE ${E('a.empresa_id')}
          GROUP BY 1, 2
         HAVING sum(m.debe) <> sum(m.haber)`,
    )
    await revisar(
        '1.cuenta_no_imputable_con_movimientos',
        `SELECT c.codigo, count(*)::int AS movimientos
           FROM ledger.movimientos m JOIN ledger.cuentas c ON c.id = m.cuenta_id
           JOIN ledger.asientos a ON a.id = m.asiento_id
          WHERE ${E('a.empresa_id')} AND NOT c.imputable
          GROUP BY c.codigo`,
    )

    /*
    | 2 · Reversos: asiento nuevo, espejo exacto del original, mismo libro, fecha no anterior
    */
    await revisar(
        '2.reverso_no_es_espejo',
        `WITH r AS (
             SELECT r.id AS rev, r.reversa_de AS orig FROM ledger.asientos r
              WHERE r.reversa_de IS NOT NULL AND ${E('r.empresa_id')}
         ), lo AS (
             SELECT r.rev, m.cuenta_id, m.cliente_id, sum(m.debe) AS d, sum(m.haber) AS h
               FROM r JOIN ledger.movimientos m ON m.asiento_id = r.orig GROUP BY 1, 2, 3
         ), lr AS (
             SELECT r.rev, m.cuenta_id, m.cliente_id, sum(m.debe) AS d, sum(m.haber) AS h
               FROM r JOIN ledger.movimientos m ON m.asiento_id = r.rev GROUP BY 1, 2, 3
         )
         SELECT coalesce(lo.rev, lr.rev) AS reverso, coalesce(lo.cuenta_id, lr.cuenta_id) AS cuenta_id,
                lo.d::text AS orig_debe, lo.h::text AS orig_haber, lr.d::text AS rev_debe, lr.h::text AS rev_haber
           FROM lo FULL JOIN lr ON lr.rev = lo.rev AND lr.cuenta_id = lo.cuenta_id
                                AND lr.cliente_id IS NOT DISTINCT FROM lo.cliente_id
          WHERE coalesce(lo.d, 0) <> coalesce(lr.h, 0) OR coalesce(lo.h, 0) <> coalesce(lr.d, 0)`,
    )
    await revisar(
        '2.reverso_de_otro_libro_o_anterior',
        `SELECT r.id AS reverso, o.id AS original, r.empresa_id, o.empresa_id AS empresa_original,
                to_char(r.fecha, 'YYYY-MM-DD') AS fecha, to_char(o.fecha, 'YYYY-MM-DD') AS fecha_original
           FROM ledger.asientos r JOIN ledger.asientos o ON o.id = r.reversa_de
          WHERE ${E('r.empresa_id')}
            AND (r.empresa_id <> o.empresa_id OR r.fecha < o.fecha OR o.reversa_de IS NOT NULL
                 OR r.origen_tipo <> o.origen_tipo OR r.origen_id IS DISTINCT FROM o.origen_id)`,
    )

    /*
    | 3 · CxC
    */
    await revisar(
        '3.auxiliar_sin_cliente',
        `SELECT m.id, m.asiento_id, c.codigo
           FROM ledger.movimientos m JOIN ledger.cuentas c ON c.id = m.cuenta_id
           JOIN ledger.asientos a ON a.id = m.asiento_id
          WHERE ${E('a.empresa_id')} AND c.auxiliar_cliente AND m.cliente_id IS NULL`,
    )
    await revisar(
        '3.cxc_distinta_de_facturas_pendientes (por empresa y cliente)',
        `WITH cxc AS (
             SELECT a.empresa_id, m.cliente_id, sum(m.debe - m.haber) AS saldo
               FROM ledger.movimientos m
               JOIN ledger.asientos a ON a.id = m.asiento_id
               JOIN ledger.cuentas c ON c.id = m.cuenta_id
              WHERE c.codigo = '${CXC}' AND ${E('a.empresa_id')} AND ${C('m.cliente_id')}
              GROUP BY 1, 2
         ), fac AS (
             SELECT f.empresa_id, f.cliente_id, sum(f.total - f.pagado) AS pendiente
               FROM billing.facturas f
              WHERE f.estado IN ${ESTADOS_PENDIENTES} AND ${E('f.empresa_id')} AND ${C('f.cliente_id')}
              GROUP BY 1, 2
         )
         SELECT coalesce(cxc.empresa_id, fac.empresa_id) AS empresa_id,
                coalesce(cxc.cliente_id, fac.cliente_id) AS cliente_id,
                coalesce(cxc.saldo, 0)::text AS auxiliar_cxc, coalesce(fac.pendiente, 0)::text AS facturas_pendientes
           FROM cxc FULL JOIN fac ON fac.empresa_id = cxc.empresa_id AND fac.cliente_id = cxc.cliente_id
          WHERE coalesce(cxc.saldo, 0) <> coalesce(fac.pendiente, 0)`,
    )
    await revisar(
        '3.anticipos_distintos_de_excedentes (Σ pago − aplicado + saldos a favor sin aplicar)',
        `WITH ant AS (
             SELECT a.empresa_id, m.cliente_id, sum(m.haber - m.debe) AS saldo
               FROM ledger.movimientos m
               JOIN ledger.asientos a ON a.id = m.asiento_id
               JOIN ledger.cuentas c ON c.id = m.cuenta_id
              WHERE c.codigo = '${ANTICIPOS}' AND ${E('a.empresa_id')} AND ${C('m.cliente_id')}
              GROUP BY 1, 2
         ), apl AS (
             SELECT pago_id, sum(monto) AS monto FROM billing.pagos_aplicaciones GROUP BY 1
         ), pag AS (
             SELECT p.empresa_id, p.cliente_id, sum(p.monto - coalesce(apl.monto, 0)) AS restante
               FROM billing.pagos p LEFT JOIN apl ON apl.pago_id = p.id
              WHERE p.estado = 'registrado' AND ${E('p.empresa_id')} AND ${C('p.cliente_id')}
              GROUP BY 1, 2
         ), apls AS (
             SELECT saldo_inicial_id, sum(monto) AS monto FROM billing.saldos_iniciales_aplicaciones GROUP BY 1
         ), sal AS (
             SELECT s.empresa_id, s.cliente_id, sum(-s.monto - coalesce(apls.monto, 0)) AS restante
               FROM billing.saldos_iniciales s LEFT JOIN apls ON apls.saldo_inicial_id = s.id
              WHERE s.monto < 0 AND s.anulado_en IS NULL AND ${E('s.empresa_id')} AND ${C('s.cliente_id')}
              GROUP BY 1, 2
         ), docs AS (
             SELECT empresa_id, cliente_id, sum(restante) AS restante
               FROM (SELECT * FROM pag UNION ALL SELECT * FROM sal) x GROUP BY 1, 2
         )
         SELECT coalesce(ant.empresa_id, docs.empresa_id) AS empresa_id,
                coalesce(ant.cliente_id, docs.cliente_id) AS cliente_id,
                coalesce(ant.saldo, 0)::text AS auxiliar_anticipos, coalesce(docs.restante, 0)::text AS excedentes
           FROM ant FULL JOIN docs ON docs.empresa_id = ant.empresa_id AND docs.cliente_id = ant.cliente_id
          WHERE coalesce(ant.saldo, 0) <> coalesce(docs.restante, 0)`,
    )
    await revisar(
        '3.saldo_de_auxiliar_negativo (CxC < 0 o anticipos < 0)',
        `SELECT a.empresa_id, m.cliente_id, c.codigo,
                sum(CASE WHEN c.codigo = '${CXC}' THEN m.debe - m.haber ELSE m.haber - m.debe END)::text AS saldo
           FROM ledger.movimientos m
           JOIN ledger.asientos a ON a.id = m.asiento_id
           JOIN ledger.cuentas c ON c.id = m.cuenta_id
          WHERE c.codigo IN ('${CXC}', '${ANTICIPOS}') AND ${E('a.empresa_id')} AND ${C('m.cliente_id')}
          GROUP BY 1, 2, 3
         HAVING sum(CASE WHEN c.codigo = '${CXC}' THEN m.debe - m.haber ELSE m.haber - m.debe END) < 0`,
    )
    await revisar(
        '3.anticipo_sin_aplicar_con_deuda (saldo a favor y facturas pendientes en la misma empresa)',
        `WITH ant AS (
             SELECT a.empresa_id, m.cliente_id, sum(m.haber - m.debe) AS saldo
               FROM ledger.movimientos m
               JOIN ledger.asientos a ON a.id = m.asiento_id
               JOIN ledger.cuentas c ON c.id = m.cuenta_id
              WHERE c.codigo = '${ANTICIPOS}' AND ${E('a.empresa_id')} AND ${C('m.cliente_id')}
              GROUP BY 1, 2 HAVING sum(m.haber - m.debe) > 0
         )
         SELECT ant.empresa_id, ant.cliente_id, ant.saldo::text AS anticipo,
                sum(f.total - f.pagado)::text AS pendiente, array_agg(f.id ORDER BY f.id) AS facturas
           FROM ant JOIN billing.facturas f ON f.empresa_id = ant.empresa_id AND f.cliente_id = ant.cliente_id
          WHERE f.estado IN ${ESTADOS_PENDIENTES} AND f.total > f.pagado
          GROUP BY 1, 2, 3`,
    )

    /*
    | 5 · Pagos y facturas
    */
    await revisar(
        '5.factura_pagado_inconsistente (pagado ≠ Σ aplicaciones vigentes + notas + saldos a favor, o fuera de [0, total])',
        `WITH apl AS (
             SELECT a.factura_id, sum(a.monto) AS monto
               FROM billing.pagos_aplicaciones a JOIN billing.pagos p ON p.id = a.pago_id
              WHERE p.estado = 'registrado' GROUP BY 1
         ), nc AS (
             SELECT factura_id, sum(monto) AS monto FROM billing.notas_credito GROUP BY 1
         ), si AS (
             SELECT a.factura_id, sum(a.monto) AS monto
               FROM billing.saldos_iniciales_aplicaciones a
               JOIN billing.saldos_iniciales s ON s.id = a.saldo_inicial_id
              WHERE s.anulado_en IS NULL GROUP BY 1
         ), con_asiento AS (
             SELECT DISTINCT origen_id FROM ledger.asientos
              WHERE origen_tipo IN ('factura', 'mora') AND reversa_de IS NULL
         ), x AS (
             SELECT f.id, f.estado, f.total, f.pagado,
                    coalesce(apl.monto, 0) + coalesce(nc.monto, 0) + coalesce(si.monto, 0) AS cubierto,
                    f.id IN (SELECT origen_id FROM con_asiento) AS tiene_asiento
               FROM billing.facturas f
               LEFT JOIN apl ON apl.factura_id = f.id
               LEFT JOIN nc ON nc.factura_id = f.id
               LEFT JOIN si ON si.factura_id = f.id
              WHERE ${E('f.empresa_id')} AND ${C('f.cliente_id')} AND f.estado <> 'anulada'
         )
         SELECT id, estado, total::text, pagado::text, cubierto::text, tiene_asiento FROM x
          WHERE pagado < 0 OR pagado > total
             OR (cubierto <> pagado
                 -- saldada en el origen o total 0: pagada sin asiento ni pago (no inventa dinero)
                 AND NOT (cubierto = 0 AND pagado = total AND NOT tiene_asiento))`,
    )
    await revisar(
        '5.factura_estado_inconsistente (estadoSegunPago)',
        `SELECT f.id, f.estado, f.total::text, f.pagado::text, f.vencida_en IS NOT NULL AS vencida
           FROM billing.facturas f
          WHERE ${E('f.empresa_id')} AND ${C('f.cliente_id')} AND f.estado NOT IN ('anulada', 'por_certificar')
            AND f.estado <> CASE
                    WHEN f.pagado = f.total THEN 'pagada'
                    WHEN f.vencida_en IS NOT NULL THEN 'vencida'
                    WHEN f.pagado > 0 THEN 'parcial'
                    ELSE 'emitida' END`,
    )
    await revisar(
        '5.factura_anulada_con_saldo_vivo (aplicaciones vigentes, notas o asiento sin reverso)',
        `SELECT f.id,
                (SELECT coalesce(sum(a.monto), 0) FROM billing.pagos_aplicaciones a JOIN billing.pagos p ON p.id = a.pago_id
                  WHERE a.factura_id = f.id AND p.estado = 'registrado')::text AS aplicado_vigente,
                (SELECT count(*) FROM billing.notas_credito n WHERE n.factura_id = f.id)::int AS notas,
                (SELECT count(*) FROM ledger.asientos a
                  WHERE a.origen_tipo IN ('factura', 'mora') AND a.origen_id = f.id AND a.reversa_de IS NULL
                    AND NOT EXISTS (SELECT 1 FROM ledger.asientos r WHERE r.reversa_de = a.id))::int AS asientos_vivos
           FROM billing.facturas f
          WHERE ${E('f.empresa_id')} AND ${C('f.cliente_id')} AND f.estado = 'anulada'
            AND (EXISTS (SELECT 1 FROM billing.pagos_aplicaciones a JOIN billing.pagos p ON p.id = a.pago_id
                          WHERE a.factura_id = f.id AND p.estado = 'registrado')
                 OR EXISTS (SELECT 1 FROM billing.notas_credito n WHERE n.factura_id = f.id)
                 OR EXISTS (SELECT 1 FROM ledger.asientos a
                             WHERE a.origen_tipo IN ('factura', 'mora') AND a.origen_id = f.id AND a.reversa_de IS NULL
                               AND NOT EXISTS (SELECT 1 FROM ledger.asientos r WHERE r.reversa_de = a.id)))`,
    )
    await revisar(
        '5.pago_aplicado_de_mas (Σ aplicaciones > monto del pago)',
        `SELECT p.id, p.monto::text, sum(a.monto)::text AS aplicado
           FROM billing.pagos p JOIN billing.pagos_aplicaciones a ON a.pago_id = p.id
          WHERE ${E('p.empresa_id')} AND ${C('p.cliente_id')}
          GROUP BY p.id HAVING sum(a.monto) > p.monto`,
    )
    await revisar(
        '5.pago_vigente_mal_contabilizado (débito a caja/bancos ≠ monto − comisión, o asiento revertido)',
        `WITH mov AS (
             SELECT a.origen_id AS pago_id,
                    sum(CASE WHEN c.codigo LIKE '${CUENTAS.CAJAS}.%' OR c.codigo LIKE '${CUENTAS.BANCOS}.%'
                             THEN m.debe - m.haber ELSE 0 END) AS dinero,
                    sum(CASE WHEN c.codigo = '${CUENTAS.COMISIONES_PASARELAS}' THEN m.debe - m.haber ELSE 0 END) AS comision,
                    sum(CASE WHEN c.codigo = '${APERTURA}' THEN m.debe - m.haber ELSE 0 END) AS apertura,
                    bool_or(EXISTS (SELECT 1 FROM ledger.asientos r WHERE r.reversa_de = a.id)) AS revertido
               FROM ledger.asientos a
               JOIN ledger.movimientos m ON m.asiento_id = a.id
               JOIN ledger.cuentas c ON c.id = m.cuenta_id
              WHERE a.origen_tipo = 'pago' AND a.reversa_de IS NULL
              GROUP BY 1
         )
         SELECT p.id, p.metodo, p.historico, p.monto::text, p.comision::text,
                mov.dinero::text, mov.comision::text AS comision_libro, mov.apertura::text, mov.revertido
           FROM billing.pagos p LEFT JOIN mov ON mov.pago_id = p.id
          WHERE ${E('p.empresa_id')} AND ${C('p.cliente_id')} AND p.estado = 'registrado'
            AND (mov.pago_id IS NULL OR mov.revertido
                 OR (p.historico AND (mov.apertura <> p.monto OR mov.dinero <> 0))
                 OR (NOT p.historico AND (mov.dinero <> p.monto - p.comision OR mov.comision <> p.comision)))`,
    )
    await revisar(
        '5.pago_anulado_sin_reverso (anular deja todo como estaba: cada asiento del pago revertido)',
        `SELECT p.id AS pago_id, a.id AS asiento_sin_reverso
           FROM billing.pagos p
           JOIN ledger.asientos a ON a.origen_tipo = 'pago' AND a.origen_id = p.id AND a.reversa_de IS NULL
          WHERE ${E('p.empresa_id')} AND ${C('p.cliente_id')} AND p.estado = 'anulado'
            AND NOT EXISTS (SELECT 1 FROM ledger.asientos r WHERE r.reversa_de = a.id)`,
    )
    await revisar(
        '5.pago_sin_registrar_con_asiento (pendiente_verificacion no mueve dinero)',
        `SELECT p.id, p.estado FROM billing.pagos p
          WHERE ${E('p.empresa_id')} AND p.estado NOT IN ('registrado', 'anulado')
            AND EXISTS (SELECT 1 FROM ledger.asientos a WHERE a.origen_tipo = 'pago' AND a.origen_id = p.id)`,
    )

    /*
    | 6 · Multiempresa: documentos, aplicaciones y asientos de una sola empresa
    */
    await revisar(
        '6.aplicacion_entre_empresas (pago de una empresa aplicado a factura de otra)',
        `SELECT a.pago_id, p.empresa_id AS empresa_pago, a.factura_id, f.empresa_id AS empresa_factura
           FROM billing.pagos_aplicaciones a
           JOIN billing.pagos p ON p.id = a.pago_id
           JOIN billing.facturas f ON f.id = a.factura_id
          WHERE (${E('p.empresa_id')} OR ${E('f.empresa_id')}) AND p.empresa_id <> f.empresa_id
         UNION ALL
         SELECT a.saldo_inicial_id, s.empresa_id, a.factura_id, f.empresa_id
           FROM billing.saldos_iniciales_aplicaciones a
           JOIN billing.saldos_iniciales s ON s.id = a.saldo_inicial_id
           JOIN billing.facturas f ON f.id = a.factura_id
          WHERE (${E('s.empresa_id')} OR ${E('f.empresa_id')}) AND s.empresa_id <> f.empresa_id`,
    )
    await revisar(
        '6.documento_y_asiento_de_empresas_distintas',
        `SELECT a.id AS asiento_id, a.origen_tipo, a.origen_id, a.empresa_id,
                coalesce(p.empresa_id, f.empresa_id, n.empresa_id, e.empresa_id, cj.empresa_id, s.empresa_id) AS empresa_documento
           FROM ledger.asientos a
           LEFT JOIN billing.pagos p ON a.origen_tipo = 'pago' AND p.id = a.origen_id
           LEFT JOIN billing.facturas f ON a.origen_tipo IN ('factura', 'mora') AND f.id = a.origen_id
           LEFT JOIN billing.notas_credito n ON a.origen_tipo = 'nota_credito' AND n.id = a.origen_id
           LEFT JOIN ledger.egresos e ON a.origen_tipo = 'egreso' AND e.id = a.origen_id
           LEFT JOIN ledger.cajas_turnos t ON a.origen_tipo = 'cierre_caja' AND t.id = a.origen_id
           LEFT JOIN ledger.cajas cj ON cj.id = t.caja_id
           LEFT JOIN billing.saldos_iniciales s ON a.origen_tipo = 'ajuste' AND s.id = a.origen_id
          WHERE ${E('a.empresa_id')}
            AND (a.empresa_id <> coalesce(p.empresa_id, f.empresa_id, n.empresa_id, e.empresa_id, cj.empresa_id,
                                          s.empresa_id, a.empresa_id)
                 OR (a.origen_tipo IN ('pago', 'factura', 'mora', 'nota_credito', 'egreso', 'cierre_caja')
                     AND coalesce(p.id, f.id, n.id, e.id, t.id) IS NULL))`,
    )
    await revisar(
        '6.pago_con_caja_turno_o_cuenta_de_otra_empresa',
        `SELECT p.id, p.empresa_id, cj.empresa_id AS empresa_caja, cb.empresa_id AS empresa_cuenta
           FROM billing.pagos p
           LEFT JOIN ledger.cajas cj ON cj.id = p.caja_id
           LEFT JOIN ledger.cajas_turnos t ON t.id = p.turno_id
           LEFT JOIN billing.cuentas_bancarias cb ON cb.id = p.cuenta_bancaria_id
          WHERE ${E('p.empresa_id')}
            AND (cj.empresa_id <> p.empresa_id OR cb.empresa_id <> p.empresa_id OR t.caja_id <> p.caja_id)`,
    )
    await revisar(
        '6.nota_credito_de_otra_empresa_o_cliente',
        `SELECT n.id, n.empresa_id, f.empresa_id AS empresa_factura, n.cliente_id, f.cliente_id AS cliente_factura
           FROM billing.notas_credito n JOIN billing.facturas f ON f.id = n.factura_id
          WHERE ${E('n.empresa_id')} AND (n.empresa_id <> f.empresa_id OR n.cliente_id <> f.cliente_id)`,
    )
    await revisar(
        '6.cobro_repartido_no_cuadra (Σ pagos del cobro ≠ monto, o dos pagos de la misma empresa)',
        `SELECT c.id AS cobro_id, c.monto::text, sum(p.monto)::text AS pagos,
                count(*)::int AS n, count(DISTINCT p.empresa_id)::int AS empresas
           FROM billing.cobros c JOIN billing.pagos p ON p.cobro_id = c.id
          WHERE ${E('p.empresa_id')}
          GROUP BY c.id
         HAVING sum(p.monto) <> c.monto OR count(*) <> count(DISTINCT p.empresa_id)`,
    )

    /*
    | 9 · Facturas, mora y notas de crédito: cada documento con el asiento que le toca
    */
    await revisar(
        '9.asiento_de_factura_no_cuadra_con_la_factura (CxC = total, IVA débito o por certificar = iva, líneas)',
        `WITH mov AS (
             SELECT a.origen_id AS factura_id,
                    sum(CASE WHEN c.codigo = '${CXC}' THEN m.debe - m.haber ELSE 0 END) AS cxc,
                    sum(CASE WHEN c.codigo IN ('${IVA}', '${IVA_TRANSICION}') THEN m.haber - m.debe ELSE 0 END) AS iva,
                    bool_or(c.codigo = '${APERTURA}') AS importada
               FROM ledger.asientos a
               JOIN ledger.movimientos m ON m.asiento_id = a.id
               JOIN ledger.cuentas c ON c.id = m.cuenta_id
              WHERE a.origen_tipo IN ('factura', 'mora') AND a.reversa_de IS NULL
              GROUP BY 1
         ), lin AS (
             SELECT factura_id, sum(total) AS total, sum(iva) AS iva FROM billing.facturas_lineas GROUP BY 1
         )
         SELECT f.id, f.tipo, f.total::text, f.subtotal::text, f.iva::text, mov.cxc::text, mov.iva::text AS iva_libro,
                mov.importada, lin.total::text AS total_lineas, lin.iva::text AS iva_lineas
           FROM billing.facturas f
           JOIN mov ON mov.factura_id = f.id
           LEFT JOIN lin ON lin.factura_id = f.id
          WHERE ${E('f.empresa_id')} AND ${C('f.cliente_id')}
            AND (mov.cxc <> f.total
                 OR f.subtotal + f.iva <> f.total
                 OR (NOT mov.importada AND mov.iva <> f.iva)
                 OR (lin.factura_id IS NOT NULL AND NOT mov.importada AND (lin.total <> f.total OR lin.iva <> f.iva)))`,
    )
    await revisar(
        '9.mora_con_iva (decisión del PM: la mora no lleva IVA salvo mora_con_iva de la empresa)',
        `SELECT f.id, f.iva::text, f.subtotal::text, f.total::text,
                (SELECT coalesce(sum(m.haber), 0) FROM ledger.asientos a JOIN ledger.movimientos m ON m.asiento_id = a.id
                   JOIN ledger.cuentas c ON c.id = m.cuenta_id
                  WHERE a.origen_tipo = 'mora' AND a.origen_id = f.id AND c.codigo = '${IVA}')::text AS iva_libro
           FROM billing.facturas f
          WHERE ${E('f.empresa_id')} AND f.tipo = 'mora'
            AND coalesce((f.reglas_snapshot->>'mora_con_iva')::boolean, false) = false
            AND (f.iva <> 0 OR f.subtotal <> f.total
                 OR EXISTS (SELECT 1 FROM ledger.asientos a JOIN ledger.movimientos m ON m.asiento_id = a.id
                              JOIN ledger.cuentas c ON c.id = m.cuenta_id
                             WHERE a.origen_tipo = 'mora' AND a.origen_id = f.id AND c.codigo = '${IVA}'))`,
    )
    await revisar(
        '9.asiento_de_nota_credito_no_cuadra (CxC haber = monto, IVA debe = iva, subtotal + iva = monto)',
        `WITH mov AS (
             SELECT a.origen_id AS nota_id,
                    sum(CASE WHEN c.codigo = '${CXC}' THEN m.haber - m.debe ELSE 0 END) AS cxc,
                    sum(CASE WHEN c.codigo IN ('${IVA}', '${IVA_TRANSICION}') THEN m.debe - m.haber ELSE 0 END) AS iva,
                    count(*) FILTER (WHERE a.reversa_de IS NULL) AS n
               FROM ledger.asientos a
               JOIN ledger.movimientos m ON m.asiento_id = a.id
               JOIN ledger.cuentas c ON c.id = m.cuenta_id
              WHERE a.origen_tipo = 'nota_credito'
              GROUP BY 1
         )
         SELECT n.id, n.factura_id, n.monto::text, n.subtotal::text, n.iva::text, mov.cxc::text, mov.iva::text AS iva_libro
           FROM billing.notas_credito n LEFT JOIN mov ON mov.nota_id = n.id
          WHERE ${E('n.empresa_id')} AND ${C('n.cliente_id')}
            AND (mov.nota_id IS NULL OR mov.cxc <> n.monto OR mov.iva <> n.iva OR n.subtotal + n.iva <> n.monto
                 OR n.monto <= 0)`,
    )
    await revisar(
        '9.notas_credito_exceden_la_factura (Σ notas > total o Σ IVA de notas > IVA de la factura)',
        `SELECT f.id, f.total::text, f.iva::text, sum(n.monto)::text AS notas, sum(n.iva)::text AS iva_notas
           FROM billing.facturas f JOIN billing.notas_credito n ON n.factura_id = f.id
          WHERE ${E('f.empresa_id')} AND ${C('f.cliente_id')}
          GROUP BY f.id HAVING sum(n.monto) > f.total OR sum(n.iva) > f.iva`,
    )
    await revisar(
        '9.factura_acreditada_completa_con_iva_residual (Σ notas = total pero Σ IVA de notas ≠ IVA de la factura)',
        `SELECT f.id, f.total::text, f.iva::text, sum(n.monto)::text AS notas, sum(n.iva)::text AS iva_notas,
                count(n.id)::int AS cantidad_notas
           FROM billing.facturas f JOIN billing.notas_credito n ON n.factura_id = f.id
          WHERE ${E('f.empresa_id')} AND ${C('f.cliente_id')}
          GROUP BY f.id HAVING sum(n.monto) = f.total AND sum(n.iva) <> f.iva`,
    )
    await revisar(
        '9.origen_de_asiento_desconocido (promesas y demás no mueven dinero)',
        `SELECT a.id, a.origen_tipo FROM ledger.asientos a
          WHERE ${E('a.empresa_id')}
            AND a.origen_tipo NOT IN ('factura', 'mora', 'pago', 'nota_credito', 'egreso', 'cierre_caja', 'ajuste',
                                      'reclasificacion')`,
    )

    /*
    | 4 · Cajas y bancos
    */
    await revisar(
        '4.caja_cerrada_no_cuadra (esperado = fondo + cobros − egresos del turno; diferencia = contado − esperado)',
        `WITH t AS (
             SELECT t.*, cj.cuenta_id, cj.empresa_id FROM ledger.cajas_turnos t JOIN ledger.cajas cj ON cj.id = t.caja_id
              WHERE t.cerrado_en IS NOT NULL AND ${E('cj.empresa_id')}
         ), libro AS (
             -- lo que entró y salió de la cuenta de la caja por los pagos y egresos del turno antes del cierre
             SELECT t.id AS turno_id, coalesce(sum(m.debe - m.haber), 0) AS neto
               FROM t
               JOIN ledger.asientos a ON a.created_at <= t.cerrado_en
                    AND ((a.origen_tipo = 'pago' AND a.origen_id IN (SELECT id FROM billing.pagos WHERE turno_id = t.id))
                      OR (a.origen_tipo = 'egreso' AND a.origen_id IN (SELECT id FROM ledger.egresos WHERE turno_id = t.id)))
               JOIN ledger.movimientos m ON m.asiento_id = a.id AND m.cuenta_id = t.cuenta_id
              GROUP BY t.id
         ), dif AS (
             SELECT a.origen_id AS turno_id, sum(m.debe - m.haber) AS neto
               FROM ledger.asientos a JOIN ledger.movimientos m ON m.asiento_id = a.id
               JOIN t ON t.id = a.origen_id AND m.cuenta_id = t.cuenta_id
              WHERE a.origen_tipo = 'cierre_caja' AND a.reversa_de IS NULL
              GROUP BY 1
         )
         SELECT t.id AS turno_id, t.caja_id, t.fondo_inicial::text, t.esperado::text, t.contado::text,
                t.diferencia::text, coalesce(libro.neto, 0)::text AS libro_turno, coalesce(dif.neto, 0)::text AS asiento_diferencia
           FROM t LEFT JOIN libro ON libro.turno_id = t.id LEFT JOIN dif ON dif.turno_id = t.id
          WHERE t.esperado <> t.fondo_inicial + coalesce(libro.neto, 0)
             OR t.diferencia <> t.contado - t.esperado
             OR coalesce(dif.neto, 0) <> t.diferencia`,
    )
    await revisar(
        '4.caja_con_dos_turnos_abiertos',
        `SELECT caja_id, count(*)::int AS abiertos FROM ledger.cajas_turnos t JOIN ledger.cajas cj ON cj.id = t.caja_id
          WHERE t.cerrado_en IS NULL AND ${E('cj.empresa_id')} GROUP BY caja_id HAVING count(*) > 1`,
    )
    await revisar(
        '4.saldo_de_caja_o_banco_distinto_de_sus_documentos (mayor = pagos − egresos ± diferencias de cierre)',
        `WITH destino_pago AS (
             SELECT p.empresa_id, p.monto - p.comision AS monto,
                    coalesce(cj.cuenta_id, cb.cuenta_id,
                             CASE WHEN p.metodo IN ('pasarela', 'agente', 'debito')
                                  THEN (SELECT id FROM ledger.cuentas WHERE codigo = '${CUENTAS.BANCO_PRINCIPAL}') END) AS cuenta_id
               FROM billing.pagos p
               LEFT JOIN ledger.cajas cj ON cj.id = p.caja_id
               LEFT JOIN billing.cuentas_bancarias cb ON cb.id = p.cuenta_bancaria_id
              WHERE p.estado = 'registrado' AND NOT p.historico AND ${E('p.empresa_id')}
         ), destino_egreso AS (
             SELECT e.empresa_id, -e.monto AS monto, coalesce(cj.cuenta_id, b.cuenta_id, cb.cuenta_id) AS cuenta_id
               FROM ledger.egresos e
               LEFT JOIN ledger.cajas cj ON cj.id = e.caja_id
               LEFT JOIN ledger.bancos b ON b.id = e.banco_id
               LEFT JOIN billing.cuentas_bancarias cb ON cb.id = e.cuenta_bancaria_id
              WHERE ${E('e.empresa_id')} AND NOT EXISTS (SELECT 1 FROM ledger.egresos_anulaciones x WHERE x.egreso_id = e.id)
         ), destino_cierre AS (
             SELECT cj.empresa_id, t.diferencia AS monto, cj.cuenta_id
               FROM ledger.cajas_turnos t JOIN ledger.cajas cj ON cj.id = t.caja_id
              WHERE t.cerrado_en IS NOT NULL AND ${E('cj.empresa_id')}
         ), destino_ajuste AS (
             -- asientos manuales (ajuste) contra caja o bancos y sus reversos: son su propio documento
             SELECT a.empresa_id, m.debe - m.haber AS monto, m.cuenta_id
               FROM ledger.asientos a JOIN ledger.movimientos m ON m.asiento_id = a.id
               JOIN ledger.cuentas c ON c.id = m.cuenta_id
              WHERE a.origen_tipo = 'ajuste' AND ${E('a.empresa_id')}
                AND (c.codigo LIKE '${CUENTAS.CAJAS}.%' OR c.codigo LIKE '${CUENTAS.BANCOS}.%')
         ), docs AS (
             SELECT empresa_id, cuenta_id, sum(monto) AS saldo FROM (
                 SELECT * FROM destino_pago UNION ALL SELECT * FROM destino_egreso UNION ALL SELECT * FROM destino_cierre
                 UNION ALL SELECT * FROM destino_ajuste
             ) x GROUP BY 1, 2
         ), libro AS (
             SELECT a.empresa_id, m.cuenta_id, sum(m.debe - m.haber) AS saldo
               FROM ledger.movimientos m
               JOIN ledger.asientos a ON a.id = m.asiento_id
               JOIN ledger.cuentas c ON c.id = m.cuenta_id
              WHERE (c.codigo LIKE '${CUENTAS.CAJAS}.%' OR c.codigo LIKE '${CUENTAS.BANCOS}.%') AND ${E('a.empresa_id')}
              GROUP BY 1, 2
         )
         SELECT coalesce(libro.empresa_id, docs.empresa_id) AS empresa_id,
                (SELECT codigo FROM ledger.cuentas WHERE id = coalesce(libro.cuenta_id, docs.cuenta_id)) AS cuenta,
                coalesce(libro.saldo, 0)::text AS mayor, coalesce(docs.saldo, 0)::text AS documentos
           FROM libro FULL JOIN docs ON docs.empresa_id = libro.empresa_id AND docs.cuenta_id = libro.cuenta_id
          WHERE coalesce(libro.saldo, 0) <> coalesce(docs.saldo, 0)`,
    )

    /*
    | 7 · Cierres: un mes cerrado no cambia (su foto guardada = lo que hay hoy en el libro)
    */
    await revisar(
        '7.asiento_en_mes_cerrado (creado después del cierre vigente)',
        `SELECT a.id, a.empresa_id, to_char(a.fecha, 'YYYY-MM-DD') AS fecha, c.id AS cierre_id
           FROM ledger.asientos a
           JOIN ledger.cierres_mensuales c ON c.empresa_id = a.empresa_id
                AND date_trunc('month', a.fecha) = c.periodo AND a.created_at > c.cerrado_en
          WHERE ${E('a.empresa_id')}
            AND NOT EXISTS (SELECT 1 FROM ledger.reaperturas_mensuales r WHERE r.cierre_id = c.id)`,
    )
    const vigentes = await filas(
        `SELECT c.id, c.empresa_id, to_char(c.periodo, 'YYYY-MM-DD') AS periodo, c.resumen
           FROM ledger.cierres_mensuales c
          WHERE ${E('c.empresa_id')}
            AND NOT EXISTS (SELECT 1 FROM ledger.reaperturas_mensuales r WHERE r.cierre_id = c.id)`,
    )
    for (const cierre of vigentes) {
        const ahora = await resumenDelMes(db.connection(), String(cierre.periodo), Number(cierre.empresa_id))
        const guardado = normalizarResumen(cierre.resumen)
        const actual = normalizarResumen(ahora)
        if (JSON.stringify(guardado) !== JSON.stringify(actual)) {
            violaciones.push({
                invariante: '7.mes_cerrado_cambio (resumen guardado ≠ libro actual)',
                detalle: { cierre_id: cierre.id, guardado, actual },
            })
        }
    }

    /*
    | 12 · FEL (localización fiscal §8.3 y §10.1)
    */
    await revisar(
        '12.iva_por_certificar_distinto (2.1.11 = Σ IVA de avisos sin DTE certificado − notas internas)',
        `WITH esperado AS (
             SELECT f.empresa_id,
                    sum(f.iva - coalesce((SELECT sum(n.iva) FROM billing.notas_credito n WHERE n.factura_id = f.id), 0)) AS monto
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
              WHERE c.codigo = '${IVA_TRANSICION}' AND ${E('a.empresa_id')}
              GROUP BY 1
         )
         SELECT coalesce(e.empresa_id, l.empresa_id) AS empresa_id, coalesce(e.monto, 0)::text AS esperado,
                coalesce(l.monto, 0)::text AS libro
           FROM esperado e FULL JOIN libro l ON l.empresa_id = e.empresa_id
          WHERE coalesce(e.monto, 0) <> coalesce(l.monto, 0)`,
    )
    await revisar(
        '12.por_certificar_con_asiento_o_evento (no se considera emitida sin certificar)',
        `SELECT f.id, f.empresa_id FROM billing.facturas f
          WHERE f.estado = 'por_certificar' AND ${E('f.empresa_id')}
            AND (EXISTS (SELECT 1 FROM ledger.asientos a WHERE a.origen_tipo = 'factura' AND a.origen_id = f.id)
                 OR EXISTS (SELECT 1 FROM audit.outbox o WHERE o.evento = 'factura.emitida'
                             AND (o.payload->>'factura_id')::bigint = f.id))`,
    )
    await revisar(
        '12.reclasificacion_sin_dte_certificado (2.1.11 / 2.1.02 solo al certificar)',
        `SELECT a.id, a.origen_id AS dte_id, d.estado
           FROM ledger.asientos a LEFT JOIN fiscal.dte d ON d.id = a.origen_id
          WHERE a.origen_tipo = 'reclasificacion' AND a.reversa_de IS NULL AND ${E('a.empresa_id')}
            AND NOT EXISTS (SELECT 1 FROM ledger.asientos r WHERE r.reversa_de = a.id)
            AND (d.id IS NULL OR d.estado NOT IN ('certificado', 'anulacion_pendiente') OR d.empresa_id <> a.empresa_id)`,
    )
    await revisar(
        '12.dte_certificado_sin_autorizacion o duplicado por documento',
        `SELECT d.documento_tipo, d.documento_id, count(*)::int AS vigentes,
                bool_or(d.estado = 'certificado' AND d.autorizacion IS NULL) AS sin_autorizacion
           FROM fiscal.dte d
          WHERE d.estado <> 'rechazado' AND ${E('d.empresa_id')}
          GROUP BY 1, 2
         HAVING count(*) > 1 OR bool_or(d.estado = 'certificado' AND d.autorizacion IS NULL)`,
    )

    /*
    | 11 · Integridad (§10.10): la parte sellada de la cadena de hash de cada empresa verifica
    */
    for (const empresa of empresas) {
        const integridad = await verificarCadena(empresa)
        if (integridad.ruptura) {
            violaciones.push({
                invariante: '11.cadena_de_hash_rota (recalcular la cadena no da el hash guardado)',
                detalle: { empresa_id: empresa, ...integridad.ruptura },
            })
        }
    }

    if (!opciones.sinFuncionesProducto) {
        violaciones.push(...(await verificarConFuncionesProducto(empresas, opciones.clientes)))
    }
    return violaciones
}

/** Resumen del cierre comparable (sin la fecha de cálculo, con montos como texto con 2 decimales). */
export function normalizarResumen(resumen: unknown) {
    const r = (typeof resumen === 'string' ? JSON.parse(resumen) : resumen) as {
        empresa_id: number
        desde: string
        hasta: string
        asientos: number
        debe: string
        haber: string
        cuentas: Array<{ codigo: string; debe: string; haber: string }>
    }
    return {
        empresa_id: Number(r.empresa_id),
        desde: r.desde,
        hasta: r.hasta,
        asientos: Number(r.asientos),
        debe: dec(r.debe).toFixed(2),
        haber: dec(r.haber).toFixed(2),
        cuentas: r.cuentas.map((c) => [c.codigo, dec(c.debe).toFixed(2), dec(c.haber).toFixed(2)]),
    }
}

/**
 * Invariantes que comparan funciones del producto con la base: `saldoCliente` por empresa,
 * `saldoAnticipos`, Σ auxiliares = cuenta de control en el balance, y el consolidado del balance
 * y del estado de resultados = suma de las empresas.
 */
async function verificarConFuncionesProducto(
    empresas: number[],
    clientes: number[] | undefined,
): Promise<Violacion[]> {
    const violaciones: Violacion[] = []
    const E = (col: string) => en(col, empresas)

    // 3 · saldo del cliente (función del producto) = suma de su auxiliar, y Σ auxiliares = control
    const conMovimientos = clientes
        ? []
        : await filas(
              `SELECT DISTINCT m.cliente_id FROM ledger.movimientos m JOIN ledger.asientos a ON a.id = m.asiento_id
                WHERE m.cliente_id IS NOT NULL AND ${E('a.empresa_id')}`,
          )
    const lista = clientes ?? conMovimientos.map((f) => Number(f.cliente_id))
    const sumaAuxiliares = new Map<number, Dec>()
    for (const clienteId of lista) {
        const porEmpresa = await saldoClientePorEmpresa(clienteId)
        for (const empresaId of empresas) {
            const saldo = porEmpresa.get(empresaId) ?? CERO
            sumaAuxiliares.set(empresaId, (sumaAuxiliares.get(empresaId) ?? CERO).plus(saldo))
            const [auxiliar] = await filas(
                `SELECT coalesce(sum(m.debe - m.haber) FILTER (WHERE c.codigo = '${CXC}'), 0)::text AS cxc,
                        coalesce(sum(m.haber - m.debe) FILTER (WHERE c.codigo = '${ANTICIPOS}'), 0)::text AS anticipos
                   FROM ledger.movimientos m JOIN ledger.asientos a ON a.id = m.asiento_id
                   JOIN ledger.cuentas c ON c.id = m.cuenta_id
                  WHERE c.codigo IN ('${CXC}', '${ANTICIPOS}') AND m.cliente_id = ${clienteId} AND a.empresa_id = ${empresaId}`,
            )
            if (!dec(String(auxiliar!.cxc)).equals(saldo)) {
                violaciones.push({
                    invariante: '3.saldoCliente_distinto_del_auxiliar',
                    detalle: {
                        clienteId,
                        empresaId,
                        saldoCliente: saldo.toFixed(2),
                        auxiliar: auxiliar!.cxc,
                    },
                })
            }
            const anticipo = await saldoAnticipos(db.connection(), clienteId, empresaId)
            if (!dec(String(auxiliar!.anticipos)).equals(anticipo)) {
                violaciones.push({
                    invariante: '3.saldoAnticipos_distinto_del_auxiliar',
                    detalle: {
                        clienteId,
                        empresaId,
                        saldoAnticipos: anticipo.toFixed(2),
                        auxiliar: auxiliar!.anticipos,
                    },
                })
            }
        }
    }

    // 3 · antigüedad de CxC (reporte cartera-vencida al día de hoy): Σ tramos = total = auxiliar CxC
    for (const empresaId of empresas) {
        const reporte = await carteraVencida({ agrupar: 'cliente' }, undefined, {
            empresas: [empresaId],
            consolidado: false,
        })
        let tramos = CERO
        let total = CERO
        let vencido = CERO
        let porVencer = CERO
        for (const fila of reporte.filas as Array<Record<string, string>>) {
            if (clientes && !clientes.includes(Number(fila.grupo_id))) continue
            for (const k of ['por_vencer', 'dias_0_30', 'dias_31_60', 'dias_61_90', 'dias_mas_90']) {
                tramos = tramos.plus(dec(fila[k]))
            }
            total = total.plus(dec(fila.total))
            vencido = vencido.plus(dec(fila.vencido))
            porVencer = porVencer.plus(dec(fila.por_vencer))
        }
        const [cxc] = await filas(
            `SELECT coalesce(sum(m.debe - m.haber), 0)::text AS saldo
               FROM ledger.movimientos m JOIN ledger.asientos a ON a.id = m.asiento_id
               JOIN ledger.cuentas c ON c.id = m.cuenta_id
              WHERE c.codigo = '${CXC}' AND a.empresa_id = ${empresaId} AND ${en('m.cliente_id', clientes)}`,
        )
        if (
            !tramos.equals(total) ||
            !porVencer.plus(vencido).equals(total) ||
            !total.equals(dec(String(cxc!.saldo)))
        ) {
            violaciones.push({
                invariante: '3.antiguedad_de_cxc_distinta_del_saldo (reporte cartera-vencida)',
                detalle: {
                    empresaId,
                    tramos: tramos.toFixed(2),
                    total: total.toFixed(2),
                    por_vencer_mas_vencido: porVencer.plus(vencido).toFixed(2),
                    auxiliar_cxc: cxc!.saldo,
                },
            })
        }
    }

    // 6 · consolidado = Σ empresas; cada empresa cuadra (debe = haber, activo = pasivo + resultado)
    const balance = await balanceSaldos({}, empresas)
    const sumaPorCuenta = new Map<string, Dec>()
    for (const seccion of balance.empresas) {
        if (!seccion.totales.cuadra) {
            violaciones.push({
                invariante: '1.balance_de_empresa_no_cuadra',
                detalle: { empresa_id: seccion.empresa_id, totales: seccion.totales },
            })
        }
        for (const cuenta of seccion.cuentas) {
            const clave = `${cuenta.codigo}|debe`
            sumaPorCuenta.set(clave, (sumaPorCuenta.get(clave) ?? CERO).plus(dec(cuenta.debe)))
            const claveH = `${cuenta.codigo}|haber`
            sumaPorCuenta.set(claveH, (sumaPorCuenta.get(claveH) ?? CERO).plus(dec(cuenta.haber)))
        }
        // Σ auxiliares (saldoCliente por empresa) = saldo de la cuenta de control en el balance
        if (!clientes && seccion.empresa_id !== null) {
            const control = seccion.cuentas.find((c) => c.codigo === CXC)
            const auxiliares = sumaAuxiliares.get(seccion.empresa_id) ?? CERO
            if (!dec(control?.saldo ?? '0').equals(auxiliares)) {
                violaciones.push({
                    invariante: '3.suma_auxiliares_distinta_de_cuenta_control',
                    detalle: {
                        empresa_id: seccion.empresa_id,
                        control: control?.saldo ?? '0.00',
                        auxiliares: auxiliares.toFixed(2),
                    },
                })
            }
        }
    }
    for (const cuenta of balance.total.cuentas) {
        const debe = sumaPorCuenta.get(`${cuenta.codigo}|debe`) ?? CERO
        const haber = sumaPorCuenta.get(`${cuenta.codigo}|haber`) ?? CERO
        if (!debe.equals(dec(cuenta.debe)) || !haber.equals(dec(cuenta.haber))) {
            violaciones.push({
                invariante: '6.consolidado_distinto_de_la_suma_de_empresas (balance)',
                detalle: {
                    cuenta: cuenta.codigo,
                    consolidado: [cuenta.debe, cuenta.haber],
                    suma: [debe, haber],
                },
            })
        }
    }
    if (!balance.total.totales.cuadra) {
        violaciones.push({ invariante: '6.consolidado_no_cuadra', detalle: balance.total.totales })
    }
    const resultados = await estadoResultados({ desde: '2000-01-01' }, empresas)
    const suma = resultados.empresas.reduce((s, e) => s.plus(dec(e.totales.resultado)), CERO)
    if (!suma.equals(dec(resultados.total.totales.resultado))) {
        violaciones.push({
            invariante: '6.consolidado_distinto_de_la_suma_de_empresas (estado de resultados)',
            detalle: { consolidado: resultados.total.totales.resultado, suma: suma.toFixed(2) },
        })
    }
    return violaciones
}

/** Falla la prueba con la lista de violaciones (vacía = el libro está bien). */
export async function afirmarLibro(
    assert: { deepEqual: (a: unknown, b: unknown, m?: string) => void },
    empresaId?: number | number[] | null,
    opciones: OpcionesVerificacion = {},
) {
    const violaciones = await verificarLibro(empresaId, opciones)
    assert.deepEqual(
        violaciones,
        [],
        `Invariantes contables rotos (empresa ${empresaId ?? 'todas'}):\n${JSON.stringify(violaciones, null, 2)}`,
    )
}

/*
|--------------------------------------------------------------------------
| Fotos: inmutabilidad y "dejar todo como estaba"
|--------------------------------------------------------------------------
*/

/**
 * Huella de cada asiento (cabecera y movimientos) y de cada fila de auditoría de las empresas dadas.
 * `compararFotoLibro(antes, despues)` exige que todo lo de antes siga idéntico después: nada se
 * editó ni se borró en `ledger` ni en `audit` (solo se agregan filas).
 */
export interface FotoLibro {
    asientos: Map<number, string>
    auditoria: Map<number, string>
    outbox: Map<number, string>
}

export async function fotoLibro(empresas: number[], desdeAuditoria = 0, desdeOutbox = 0): Promise<FotoLibro> {
    const asientos = await filas(
        `SELECT a.id, md5(concat_ws('|', a.empresa_id, a.fecha, a.descripcion, a.origen_tipo, a.origen_id, a.reversa_de,
                       a.created_at, string_agg(concat_ws(':', m.id, m.cuenta_id, m.cliente_id, m.debe, m.haber), ',' ORDER BY m.id))) AS h
           FROM ledger.asientos a JOIN ledger.movimientos m ON m.asiento_id = a.id
          WHERE ${en('a.empresa_id', empresas)}
          GROUP BY a.id`,
    )
    const auditoria = await filas(
        `SELECT id, md5(concat_ws('|', actor_tipo, actor_id, canal, accion, entidad_tipo, entidad_id, entrada::text,
                       resultado::text, error::text, request_id, created_at, empresa_id)) AS h
           FROM audit.acciones WHERE id > ${Number(desdeAuditoria)}`,
    )
    const outbox = await filas(
        `SELECT id, md5(concat_ws('|', evento, payload::text, created_at)) AS h FROM audit.outbox WHERE id > ${Number(desdeOutbox)}`,
    )
    const mapa = (lista: Fila[]) => new Map(lista.map((f) => [Number(f.id), String(f.h)]))
    return { asientos: mapa(asientos), auditoria: mapa(auditoria), outbox: mapa(outbox) }
}

/** Filas de antes que cambiaron o desaparecieron (debe quedar vacío). */
export function compararFotoLibro(antes: FotoLibro, despues: FotoLibro): Violacion[] {
    const violaciones: Violacion[] = []
    for (const [nombre, a, d] of [
        ['ledger.asientos/movimientos', antes.asientos, despues.asientos],
        ['audit.acciones', antes.auditoria, despues.auditoria],
        ['audit.outbox', antes.outbox, despues.outbox],
    ] as const) {
        const cambiadas: number[] = []
        for (const [id, huella] of a) {
            if (d.get(id) !== huella) cambiadas.push(id)
        }
        if (cambiadas.length > 0) {
            violaciones.push({
                invariante: `2.fila_editada_o_borrada (${nombre})`,
                detalle: cambiadas.slice(0, 20),
            })
        }
    }
    return violaciones
}

/**
 * Foto del estado contable visible de unas empresas: saldo de cada (cuenta, cliente) en su libro y
 * `pagado`/`estado` de cada factura. Dos fotos iguales = "todo quedó como estaba".
 */
export async function fotoEstado(empresas: number[]) {
    const saldos = await filas(
        `SELECT a.empresa_id, c.codigo, m.cliente_id, sum(m.debe - m.haber)::text AS saldo
           FROM ledger.movimientos m JOIN ledger.asientos a ON a.id = m.asiento_id
           JOIN ledger.cuentas c ON c.id = m.cuenta_id
          WHERE ${en('a.empresa_id', empresas)}
          GROUP BY 1, 2, 3 HAVING sum(m.debe - m.haber) <> 0
          ORDER BY 1, 2, 3`,
    )
    const facturas = await filas(
        `SELECT id, estado, pagado::text FROM billing.facturas WHERE ${en('empresa_id', empresas)} ORDER BY id`,
    )
    return { saldos, facturas }
}

/** Último id de audit.acciones y audit.outbox (para acotar las fotos a lo de una prueba). */
export async function marcasAuditoria() {
    const [fila] = await filas(
        `SELECT (SELECT coalesce(max(id), 0) FROM audit.acciones) AS acciones,
                (SELECT coalesce(max(id), 0) FROM audit.outbox) AS outbox`,
    )
    return { acciones: Number(fila!.acciones), outbox: Number(fila!.outbox) }
}

/** Cantidad de asientos de unas empresas (para afirmar que un rechazo no escribió nada). */
export async function contarAsientos(empresas: number[]): Promise<number> {
    const [fila] = await filas(
        `SELECT count(*)::int AS n FROM ledger.asientos WHERE ${en('empresa_id', empresas)}`,
    )
    return Number(fila!.n)
}
