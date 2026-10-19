import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { CUENTAS } from '#ledger/plan_cuentas'
import { CERO, dec, type Dec } from '#ledger/dinero'
import { saldoClientePorEmpresa } from '#ledger/consultas'
import { saldoAnticipos } from '#billing/cobros'
import { balanceSaldos, estadoResultados } from '#ledger/estados_financieros'
import { resumenDelMes } from '#ledger/cierres'
import { carteraVencida } from '#billing/reportes/reportes'
import { verificarCadena } from '#ledger/sellos'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'

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
    /** también los invariantes de `HALLAZGOS_ABIERTOS` (los usa la prueba `.fails` de cada hallazgo) */
    incluirHallazgosAbiertos?: boolean
    /** leer con esta conexión (una transacción de la prueba que aún no se confirma) */
    cliente?: QueryClientContract
}

/**
 * Invariantes cuyo hallazgo está abierto: el producto los rompe en escenarios normales (también en
 * las pruebas de A3), así que por defecto no se revisan y su prueba `.fails` en
 * `hallazgos_fase3.spec.ts` los mantiene a la vista. Cuando A3 arregle el hallazgo, se quita de
 * aquí (y la prueba deja de ser `.fails`): desde ese día los revisa toda prueba que llame
 * `verificarLibro`.
 */
export const HALLAZGOS_ABIERTOS: Record<string, string> = {
    // fase 5 × fase 4: constancia de IVA recibida sobre IVA recuperado de un aviso castigado sin DTE
    '15.retencion_iva_sin_dte': 'H19',
    // fase 5: baja de un activo con fecha anterior a cuotas ya registradas
    '15.cuota_posterior_a_la_baja': 'H20',
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

/** Conexión de lectura de `verificarLibro` (la de una transacción de prueba, o la global). */
let clienteLectura: QueryClientContract | null = null

async function filas(sql: string): Promise<Fila[]> {
    const resultado = await (clienteLectura ?? db).rawQuery(sql)
    return resultado.rows as Fila[]
}

/**
 * Fragmento SQL "la nota `alias` está anulada" (`billing.notas_credito_anulaciones`, desvío (a) de
 * §17 aprobado por el líder: nota cuya NCRE la SAT rechazó en definitivo). `false` mientras la tabla
 * no exista en la base.
 */
async function notaAnuladaSql(): Promise<(alias: string) => string> {
    const [fila] = await filas(
        `SELECT to_regclass('billing.notas_credito_anulaciones') IS NOT NULL AS existe`,
    )
    if (!fila?.existe) return () => 'false'
    return (alias) =>
        `EXISTS (SELECT 1 FROM billing.notas_credito_anulaciones xa WHERE xa.nota_id = ${alias}.id)`
}

const CXC = CUENTAS.CXC_CLIENTES
const ANTICIPOS = CUENTAS.ANTICIPOS_CLIENTES
const IVA = CUENTAS.IVA_DEBITO
/** `2.1.11 IVA por certificar` (localización fiscal §10.1): el IVA de los avisos de cobro sin DTE */
const IVA_TRANSICION = '2.1.11'
const APERTURA = CUENTAS.SALDOS_APERTURA
/** fase 4 (§10.3, §10.9) */
const PUENTE = CUENTAS_GT.COBROS_POR_LIQUIDAR
const TRANSITO = CUENTAS_GT.FONDOS_EN_TRANSITO
const ESTIMACION = CUENTAS_GT.ESTIMACION_INCOBRABLES
const INCOBRABLES = CUENTAS_GT.CUENTAS_INCOBRABLES
const DIFERENCIAS = CUENTAS_GT.DIFERENCIAS_COBRO
const COMISIONES = CUENTAS.COMISIONES_PASARELAS
/**
 * El documento (depósito o traslado) tiene su llegada al banco viva: un asiento de su origen que
 * acredita 1.1.11, sin reverso (una llegada reatribuida, decisión (c), queda revertida y el documento
 * vuelve a tránsito).
 */
const llegadaViva = (tipo: string, id: string) => `EXISTS (
    SELECT 1 FROM ledger.asientos lv JOIN ledger.movimientos lm ON lm.asiento_id = lv.id
      JOIN ledger.cuentas lc ON lc.id = lm.cuenta_id
     WHERE lv.origen_tipo = ${tipo} AND lv.origen_id = ${id} AND lv.reversa_de IS NULL
       AND lc.codigo = '${CUENTAS_GT.FONDOS_EN_TRANSITO}' AND lm.haber > 0
       AND NOT EXISTS (SELECT 1 FROM ledger.asientos lr WHERE lr.reversa_de = lv.id))`
const CAJA_O_BANCO = (col: string) =>
    `(${col} LIKE '${CUENTAS.CAJAS}.%' OR ${col} LIKE '${CUENTAS.BANCOS}.%')`
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
    const anterior = clienteLectura
    clienteLectura = opciones.cliente ?? null
    try {
        return await verificarLibroCon(empresaId, opciones)
    } finally {
        clienteLectura = anterior
    }
}

async function verificarLibroCon(
    empresaId: number | number[] | null | undefined,
    opciones: OpcionesVerificacion,
): Promise<Violacion[]> {
    const empresas = await empresasDelAlcance(empresaId)
    const anulada = await notaAnuladaSql()
    const E = (col: string) => en(col, empresas)
    const C = (col: string) => en(col, opciones.clientes)
    const violaciones: Violacion[] = []
    const revisar = async (invariante: string, sql: string) => {
        const abierto = Object.keys(HALLAZGOS_ABIERTOS).some((id) => invariante.startsWith(id))
        if (abierto && !opciones.incluirHallazgosAbiertos) return
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
        '3.anticipos_distintos_de_excedentes (Σ pago − aplicado − recuperado de castigos + saldos a favor sin aplicar)',
        `WITH ant AS (
             SELECT a.empresa_id, m.cliente_id, sum(m.haber - m.debe) AS saldo
               FROM ledger.movimientos m
               JOIN ledger.asientos a ON a.id = m.asiento_id
               JOIN ledger.cuentas c ON c.id = m.cuenta_id
              WHERE c.codigo = '${ANTICIPOS}' AND ${E('a.empresa_id')} AND ${C('m.cliente_id')}
              GROUP BY 1, 2
         ), apl AS (
             SELECT pago_id, sum(monto) AS monto FROM billing.pagos_aplicaciones GROUP BY 1
         ), rec AS (
             -- decisión (g) y H17: con castigos por recuperar, lo que sobra del pago es recuperación (base a
             -- 4.2.03 e IVA a 2.1.11); se lee del documento (recuperaciones_castigo) y su asiento lo revisa
             -- 13.recuperacion_mal_contabilizada
             SELECT pago_id, sum(monto) AS monto FROM ledger.recuperaciones_castigo GROUP BY 1
         ), pag AS (
             SELECT p.empresa_id, p.cliente_id, sum(p.monto - coalesce(apl.monto, 0) - coalesce(rec.monto, 0)) AS restante
               FROM billing.pagos p LEFT JOIN apl ON apl.pago_id = p.id LEFT JOIN rec ON rec.pago_id = p.id
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
            -- decisión del líder (H6): mientras su DTE vigente está en anulacion_pendiente, la factura no
            -- recibe pagos ni aplicaciones; solo esa deuda queda fuera (la demás sigue contando)
            AND NOT EXISTS (SELECT 1 FROM fiscal.dte d
                             WHERE d.documento_id = f.id AND d.estado = 'anulacion_pendiente'
                               AND d.documento_tipo = CASE WHEN f.tipo = 'mora' THEN 'nota_debito' ELSE 'factura' END)
          GROUP BY 1, 2, 3`,
    )

    /*
    | 5 · Pagos y facturas
    */
    await revisar(
        '5.factura_pagado_inconsistente (pagado ≠ Σ aplicaciones vigentes + notas + saldos a favor, o fuera de [0, total]; el castigo no es pago, decisión (g))',
        `WITH apl AS (
             SELECT a.factura_id, sum(a.monto) AS monto
               FROM billing.pagos_aplicaciones a JOIN billing.pagos p ON p.id = a.pago_id
              WHERE p.estado = 'registrado' GROUP BY 1
         ), nc AS (
             SELECT n.factura_id, sum(n.monto) AS monto FROM billing.notas_credito n WHERE NOT ${anulada('n')} GROUP BY 1
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
        '5.factura_estado_inconsistente (estadoSegunPago; H16: acreditada = aviso sin DTE vivo cubierto entero por notas internas, sin cobro)',
        `WITH x AS (
             SELECT f.*,
                    coalesce((SELECT sum(a.monto) FROM billing.pagos_aplicaciones a JOIN billing.pagos p ON p.id = a.pago_id
                               WHERE a.factura_id = f.id AND p.estado = 'registrado'), 0)
                  + coalesce((SELECT sum(a.monto) FROM billing.saldos_iniciales_aplicaciones a
                               JOIN billing.saldos_iniciales s ON s.id = a.saldo_inicial_id
                              WHERE a.factura_id = f.id AND s.anulado_en IS NULL), 0) AS cobrado,
                    coalesce((SELECT sum(n.monto) FROM billing.notas_credito n
                               WHERE n.factura_id = f.id AND NOT ${anulada('n')}
                                 AND NOT EXISTS (SELECT 1 FROM fiscal.dte o
                                                  WHERE o.documento_tipo = 'nota_credito' AND o.documento_id = n.id)), 0) AS internas,
                    EXISTS (SELECT 1 FROM fiscal.dte d
                             WHERE d.documento_id = f.id
                               AND d.documento_tipo = CASE WHEN f.tipo = 'mora' THEN 'nota_debito' ELSE 'factura' END
                               AND d.estado IN ('pendiente', 'error_temporal', 'contingencia', 'certificado', 'anulacion_pendiente')) AS dte_vivo
               FROM billing.facturas f
              WHERE ${E('f.empresa_id')} AND ${C('f.cliente_id')} AND f.estado NOT IN ('anulada', 'por_certificar', 'castigada')
         )
         SELECT id, estado, total::text, pagado::text, vencida_en IS NOT NULL AS vencida, aviso_cobro, dte_vivo,
                cobrado::text, internas::text
           FROM x
          WHERE estado <> CASE
                    WHEN pagado = total AND aviso_cobro AND NOT dte_vivo AND cobrado = 0 AND internas = total AND total > 0
                        THEN 'acreditada'
                    WHEN pagado = total THEN 'pagada'
                    WHEN vencida_en IS NOT NULL THEN 'vencida'
                    WHEN pagado > 0 THEN 'parcial'
                    ELSE 'emitida' END`,
    )
    await revisar(
        '5.factura_acreditada_con_dte_o_cobro (H16: no es venta; nunca DTE, pago ni saldo a favor)',
        `SELECT f.id, f.estado, f.total::text,
                (SELECT count(*) FROM fiscal.dte d WHERE d.documento_id = f.id
                   AND d.documento_tipo = CASE WHEN f.tipo = 'mora' THEN 'nota_debito' ELSE 'factura' END
                   AND d.estado <> 'rechazado')::int AS dtes,
                (SELECT count(*) FROM billing.pagos_aplicaciones a JOIN billing.pagos p ON p.id = a.pago_id
                  WHERE a.factura_id = f.id AND p.estado = 'registrado')::int AS aplicaciones
           FROM billing.facturas f
          WHERE ${E('f.empresa_id')} AND ${C('f.cliente_id')} AND f.estado = 'acreditada'
            AND (NOT f.aviso_cobro
                 OR EXISTS (SELECT 1 FROM fiscal.dte d WHERE d.documento_id = f.id
                             AND d.documento_tipo = CASE WHEN f.tipo = 'mora' THEN 'nota_debito' ELSE 'factura' END
                             AND d.estado <> 'rechazado')
                 OR EXISTS (SELECT 1 FROM billing.pagos_aplicaciones a JOIN billing.pagos p ON p.id = a.pago_id
                             WHERE a.factura_id = f.id AND p.estado = 'registrado')
                 OR EXISTS (SELECT 1 FROM billing.saldos_iniciales_aplicaciones a
                              JOIN billing.saldos_iniciales s ON s.id = a.saldo_inicial_id
                             WHERE a.factura_id = f.id AND s.anulado_en IS NULL))`,
    )
    await revisar(
        '5.por_certificar_con_dinero_o_sin_dte (no está emitida: sin pagos, notas ni vencimiento, y con su DTE)',
        `SELECT f.id, f.pagado::text, f.vencida_en IS NOT NULL AS vencida,
                (SELECT count(*) FROM fiscal.dte d WHERE d.documento_tipo = 'factura' AND d.documento_id = f.id)::int AS dtes
           FROM billing.facturas f
          WHERE ${E('f.empresa_id')} AND ${C('f.cliente_id')} AND f.estado = 'por_certificar'
            AND (f.pagado <> 0 OR f.vencida_en IS NOT NULL OR f.aviso_cobro
                 OR EXISTS (SELECT 1 FROM billing.pagos_aplicaciones a WHERE a.factura_id = f.id)
                 OR EXISTS (SELECT 1 FROM billing.notas_credito n WHERE n.factura_id = f.id AND NOT ${anulada('n')})
                 OR NOT EXISTS (SELECT 1 FROM fiscal.dte d WHERE d.documento_tipo = 'factura' AND d.documento_id = f.id))`,
    )
    await revisar(
        '5.factura_anulada_con_saldo_vivo (aplicaciones vigentes, notas o asiento sin reverso)',
        `SELECT f.id,
                (SELECT coalesce(sum(a.monto), 0) FROM billing.pagos_aplicaciones a JOIN billing.pagos p ON p.id = a.pago_id
                  WHERE a.factura_id = f.id AND p.estado = 'registrado')::text AS aplicado_vigente,
                (SELECT count(*) FROM billing.notas_credito n WHERE n.factura_id = f.id AND NOT ${anulada('n')})::int AS notas,
                (SELECT count(*) FROM ledger.asientos a
                  WHERE a.origen_tipo IN ('factura', 'mora') AND a.origen_id = f.id AND a.reversa_de IS NULL
                    AND NOT EXISTS (SELECT 1 FROM ledger.asientos r WHERE r.reversa_de = a.id))::int AS asientos_vivos
           FROM billing.facturas f
          WHERE ${E('f.empresa_id')} AND ${C('f.cliente_id')} AND f.estado = 'anulada'
            AND (EXISTS (SELECT 1 FROM billing.pagos_aplicaciones a JOIN billing.pagos p ON p.id = a.pago_id
                          WHERE a.factura_id = f.id AND p.estado = 'registrado')
                 OR EXISTS (SELECT 1 FROM billing.notas_credito n WHERE n.factura_id = f.id AND NOT ${anulada('n')})
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
        '5.pago_vigente_mal_contabilizado (caja/banco = monto − comisión − retenido; 1.1.05 / 1.1.06 = sus constancias por impuesto; con proveedor de cobro, su 1.1.10.NN por el bruto y nada más)',
        `WITH mov AS (
             SELECT a.origen_id AS pago_id,
                    sum(CASE WHEN ${CAJA_O_BANCO('c.codigo')} THEN m.debe - m.haber ELSE 0 END) AS dinero,
                    -- fase 5 (§3.5, desvío d): la parte cubierta con constancias de retención del cliente
                    sum(CASE WHEN c.codigo = '${CUENTAS_GT.IVA_RETENIDO_CLIENTES}' THEN m.debe - m.haber ELSE 0 END) AS ret_iva,
                    sum(CASE WHEN c.codigo = '${CUENTAS_GT.ISR_RETENIDO_CLIENTES}' THEN m.debe - m.haber ELSE 0 END) AS ret_isr,
                    sum(CASE WHEN c.codigo LIKE '${PUENTE}.%' THEN m.debe - m.haber ELSE 0 END) AS puente,
                    sum(CASE WHEN c.codigo = '${COMISIONES}' THEN m.debe - m.haber ELSE 0 END) AS comision,
                    sum(CASE WHEN c.codigo = '${APERTURA}' THEN m.debe - m.haber ELSE 0 END) AS apertura,
                    bool_or(EXISTS (SELECT 1 FROM ledger.asientos r WHERE r.reversa_de = a.id)) AS revertido,
                    count(DISTINCT CASE WHEN c.codigo LIKE '${PUENTE}.%' THEN m.cuenta_id END) AS puentes,
                    max(CASE WHEN c.codigo LIKE '${PUENTE}.%' THEN m.cuenta_id END) AS cuenta_puente
               FROM ledger.asientos a
               JOIN ledger.movimientos m ON m.asiento_id = a.id
               JOIN ledger.cuentas c ON c.id = m.cuenta_id
              WHERE a.origen_tipo = 'pago' AND a.reversa_de IS NULL
              GROUP BY 1
         )
         , k AS (
             SELECT pago_id, sum(monto) FILTER (WHERE impuesto = 'iva') AS iva, sum(monto) FILTER (WHERE impuesto = 'isr') AS isr
               FROM ledger.constancias_retencion WHERE direccion = 'recibida' GROUP BY 1
         )
         SELECT p.id, p.metodo, p.historico, p.monto::text, p.comision::text, p.retenido::text, p.proveedor_cobro_id,
                mov.dinero::text, mov.puente::text, mov.comision::text AS comision_libro, mov.apertura::text, mov.revertido,
                mov.ret_iva::text, mov.ret_isr::text, k.iva::text AS constancias_iva, k.isr::text AS constancias_isr
           FROM billing.pagos p LEFT JOIN mov ON mov.pago_id = p.id
           LEFT JOIN ledger.proveedores_cobro pc ON pc.id = p.proveedor_cobro_id
           LEFT JOIN k ON k.pago_id = p.id
          WHERE ${E('p.empresa_id')} AND ${C('p.cliente_id')} AND p.estado = 'registrado'
            AND (mov.pago_id IS NULL OR mov.revertido
                 OR p.retenido <> coalesce(k.iva, 0) + coalesce(k.isr, 0)
                 OR mov.ret_iva <> coalesce(k.iva, 0) OR mov.ret_isr <> coalesce(k.isr, 0)
                 OR (p.historico AND (mov.apertura <> p.monto OR mov.dinero <> 0 OR mov.puente <> 0 OR p.retenido <> 0))
                 OR (NOT p.historico AND p.proveedor_cobro_id IS NULL
                     AND (mov.dinero <> p.monto - p.comision - p.retenido OR mov.comision <> p.comision OR mov.puente <> 0))
                 -- fase 4 (§10.3): el bruto a la cuenta puente del proveedor del pago; sin comisión ni banco
                 OR (NOT p.historico AND p.proveedor_cobro_id IS NOT NULL
                     AND (mov.puente <> p.monto OR mov.dinero <> 0 OR mov.comision <> 0 OR p.comision <> 0 OR p.retenido <> 0
                          OR mov.puentes <> 1 OR mov.cuenta_puente <> pc.cuenta_id OR pc.empresa_id <> p.empresa_id
                          OR pc.metodo <> p.metodo
                          OR (p.created_at AT TIME ZONE 'America/Guatemala')::date < pc.desde)))`,
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
        '9.asiento_de_factura_no_cuadra_con_la_factura (CxC = total; IVA = iva en 2.1.11 si es aviso de cobro, si no en 2.1.02; líneas)',
        `WITH mov AS (
             SELECT a.origen_id AS factura_id,
                    sum(CASE WHEN c.codigo = '${CXC}' THEN m.debe - m.haber ELSE 0 END) AS cxc,
                    sum(CASE WHEN c.codigo = '${IVA}' THEN m.haber - m.debe ELSE 0 END) AS iva,
                    sum(CASE WHEN c.codigo = '${IVA_TRANSICION}' THEN m.haber - m.debe ELSE 0 END) AS iva_transicion,
                    bool_or(c.codigo = '${APERTURA}') AS importada
               FROM ledger.asientos a
               JOIN ledger.movimientos m ON m.asiento_id = a.id
               JOIN ledger.cuentas c ON c.id = m.cuenta_id
              WHERE a.origen_tipo IN ('factura', 'mora') AND a.reversa_de IS NULL
              GROUP BY 1
         ), lin AS (
             SELECT factura_id, sum(total) AS total, sum(iva) AS iva FROM billing.facturas_lineas GROUP BY 1
         )
         SELECT f.id, f.tipo, f.aviso_cobro, f.total::text, f.subtotal::text, f.iva::text, mov.cxc::text,
                mov.iva::text AS iva_debito_libro, mov.iva_transicion::text AS iva_por_certificar_libro,
                mov.importada, lin.total::text AS total_lineas, lin.iva::text AS iva_lineas
           FROM billing.facturas f
           JOIN mov ON mov.factura_id = f.id
           LEFT JOIN lin ON lin.factura_id = f.id
          WHERE ${E('f.empresa_id')} AND ${C('f.cliente_id')}
            AND (mov.cxc <> f.total
                 OR f.subtotal + f.iva <> f.total
                 -- estricto (auditor, fase 3): todo el IVA en UNA cuenta, la que corresponde al documento
                 OR (NOT mov.importada AND f.aviso_cobro AND (mov.iva_transicion <> f.iva OR mov.iva <> 0))
                 OR (NOT mov.importada AND NOT f.aviso_cobro AND (mov.iva <> f.iva OR mov.iva_transicion <> 0))
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
        '9.mora_con_iva_mal_calculada (con mora_con_iva: IVA incluido al 12 % y desglosado)',
        `SELECT f.id, f.total::text, f.subtotal::text, f.iva::text, f.aviso_cobro
           FROM billing.facturas f
          WHERE ${E('f.empresa_id')} AND f.tipo = 'mora'
            AND coalesce((f.reglas_snapshot->>'mora_con_iva')::boolean, false)
            AND (f.iva <> round(f.total * 12 / 112, 2) OR f.subtotal + f.iva <> f.total)`,
    )
    await revisar(
        '9.asiento_de_nota_credito_no_cuadra (CxC haber = monto, IVA debe = iva, subtotal + iva = monto)',
        `WITH mov AS (
             SELECT a.origen_id AS nota_id, min(a.id) AS asiento_id,
                    sum(CASE WHEN c.codigo = '${CXC}' THEN m.haber - m.debe ELSE 0 END) AS cxc,
                    sum(CASE WHEN c.codigo = '${IVA}' THEN m.debe - m.haber ELSE 0 END) AS iva,
                    sum(CASE WHEN c.codigo = '${IVA_TRANSICION}' THEN m.debe - m.haber ELSE 0 END) AS iva_transicion,
                    count(*) FILTER (WHERE a.reversa_de IS NULL) AS n
               FROM ledger.asientos a
               JOIN ledger.movimientos m ON m.asiento_id = a.id
               JOIN ledger.cuentas c ON c.id = m.cuenta_id
              WHERE a.origen_tipo = 'nota_credito'
              GROUP BY 1
         ), x AS (
             -- estricto (auditor, fase 3; §10.1): la nota de un aviso cuyo IVA aún no se reclasificó (sin DTE
             -- certificado al emitirla) debita 2.1.11; cualquier otra, 2.1.02. Nunca las dos.
             SELECT n.*, mov.nota_id AS con_asiento, mov.cxc, mov.iva AS iva_debito_libro,
                    mov.iva_transicion AS iva_por_certificar_libro,
                    f.aviso_cobro AND NOT EXISTS (
                        SELECT 1 FROM ledger.asientos r JOIN fiscal.dte d ON d.id = r.origen_id
                         WHERE r.origen_tipo = 'reclasificacion' AND r.reversa_de IS NULL AND r.id < mov.asiento_id
                           AND d.documento_id = f.id
                           AND d.documento_tipo = CASE WHEN f.tipo = 'mora' THEN 'nota_debito' ELSE 'factura' END
                    ) AS en_transicion
               FROM billing.notas_credito n
               JOIN billing.facturas f ON f.id = n.factura_id
               LEFT JOIN mov ON mov.nota_id = n.id
              WHERE ${E('n.empresa_id')} AND ${C('n.cliente_id')} AND NOT ${anulada('n')}
         )
         SELECT id, factura_id, monto::text, subtotal::text, iva::text, cxc::text, en_transicion,
                iva_debito_libro::text, iva_por_certificar_libro::text
           FROM x
          WHERE con_asiento IS NULL OR cxc <> monto OR subtotal + iva <> monto OR monto <= 0
             OR (en_transicion AND (iva_por_certificar_libro <> iva OR iva_debito_libro <> 0))
             OR (NOT en_transicion AND (iva_debito_libro <> iva OR iva_por_certificar_libro <> 0))`,
    )
    await revisar(
        '9.notas_credito_exceden_la_factura (Σ notas > total o Σ IVA de notas > IVA de la factura)',
        `SELECT f.id, f.total::text, f.iva::text, sum(n.monto)::text AS notas, sum(n.iva)::text AS iva_notas
           FROM billing.facturas f JOIN billing.notas_credito n ON n.factura_id = f.id AND NOT ${anulada('n')}
          WHERE ${E('f.empresa_id')} AND ${C('f.cliente_id')}
          GROUP BY f.id HAVING sum(n.monto) > f.total OR sum(n.iva) > f.iva`,
    )
    await revisar(
        '9.factura_acreditada_completa_con_iva_residual (Σ notas = total pero Σ IVA de notas ≠ IVA de la factura)',
        `SELECT f.id, f.total::text, f.iva::text, sum(n.monto)::text AS notas, sum(n.iva)::text AS iva_notas,
                count(n.id)::int AS cantidad_notas
           FROM billing.facturas f JOIN billing.notas_credito n ON n.factura_id = f.id AND NOT ${anulada('n')}
          WHERE ${E('f.empresa_id')} AND ${C('f.cliente_id')}
          GROUP BY f.id HAVING sum(n.monto) = f.total AND sum(n.iva) <> f.iva`,
    )
    await revisar(
        '9.origen_de_asiento_desconocido (promesas y demás no mueven dinero)',
        `SELECT a.id, a.origen_tipo FROM ledger.asientos a
          WHERE ${E('a.empresa_id')}
            AND a.origen_tipo NOT IN ('factura', 'mora', 'pago', 'nota_credito', 'egreso', 'cierre_caja', 'ajuste',
                                      'reclasificacion', 'liquidacion_cobro', 'deposito', 'traslado', 'banco',
                                      'provision', 'castigo', 'compra', 'pago_proveedor', 'depreciacion',
                                      'baja_activo', 'diferido', 'alta_activo')`,
    )

    /*
    | 4 · Cajas y bancos
    */
    await revisar(
        '4.caja_cerrada_no_cuadra (esperado = fondo + cobros (sin lo retenido) − egresos y compras al contado − pagos a proveedores − depósitos del turno; diferencia = contado − esperado)',
        `WITH t AS (
             SELECT t.*, cj.cuenta_id, cj.empresa_id FROM ledger.cajas_turnos t JOIN ledger.cajas cj ON cj.id = t.caja_id
              WHERE t.cerrado_en IS NOT NULL AND ${E('cj.empresa_id')}
         ), libro AS (
             -- lo que entró y salió de la cuenta de la caja por los pagos y egresos del turno antes del cierre
             SELECT t.id AS turno_id, coalesce(sum(m.debe - m.haber), 0) AS neto
               FROM t
               JOIN ledger.asientos a ON a.created_at <= t.cerrado_en
                    AND ((a.origen_tipo = 'pago' AND a.origen_id IN (SELECT id FROM billing.pagos WHERE turno_id = t.id))
                      OR (a.origen_tipo = 'egreso' AND a.origen_id IN (SELECT id FROM ledger.egresos WHERE turno_id = t.id))
                      -- fase 4 (§10.3): el depósito al banco baja el efectivo esperado del turno
                      OR (a.origen_tipo = 'deposito' AND a.origen_id IN (SELECT id FROM ledger.depositos WHERE turno_id = t.id))
                      -- fase 5 (§3.4): la compra al contado sale de la caja con el asiento de la compra (su
                      -- egreso no tiene asiento propio) y el pago a un proveedor en efectivo, con el suyo
                      OR (a.origen_tipo = 'compra'
                          AND a.origen_id IN (SELECT compra_id FROM ledger.egresos WHERE turno_id = t.id AND compra_id IS NOT NULL))
                      OR (a.origen_tipo = 'pago_proveedor'
                          AND a.origen_id IN (SELECT id FROM ledger.pagos_proveedores WHERE turno_id = t.id)))
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
        '4.saldo_de_caja_o_banco_distinto_de_sus_documentos (mayor = pagos (sin lo retenido) − egresos ± diferencias de cierre + liquidaciones ± depósitos, traslados y partidas del extracto − pagos a proveedores + ventas de activos)',
        `WITH docs AS (
             SELECT empresa_id, cuenta_id, sum(monto) AS saldo FROM (
                 SELECT p.empresa_id, p.monto - p.comision - p.retenido AS monto,
                        coalesce(cj.cuenta_id, cb.cuenta_id,
                                 CASE WHEN p.metodo IN ('pasarela', 'agente', 'debito')
                                      THEN (SELECT id FROM ledger.cuentas WHERE codigo = '${CUENTAS.BANCO_PRINCIPAL}') END) AS cuenta_id
                   FROM billing.pagos p
                   LEFT JOIN ledger.cajas cj ON cj.id = p.caja_id
                   LEFT JOIN billing.cuentas_bancarias cb ON cb.id = p.cuenta_bancaria_id
                  WHERE p.estado = 'registrado' AND NOT p.historico AND p.proveedor_cobro_id IS NULL AND ${E('p.empresa_id')}
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
                 -- asientos manuales (ajuste) contra caja o bancos y sus reversos: son su propio documento
                 SELECT a.empresa_id, m.debe - m.haber, m.cuenta_id
                   FROM ledger.asientos a JOIN ledger.movimientos m ON m.asiento_id = a.id
                   JOIN ledger.cuentas c ON c.id = m.cuenta_id
                  WHERE a.origen_tipo = 'ajuste' AND ${E('a.empresa_id')} AND ${CAJA_O_BANCO('c.codigo')}
                 UNION ALL
                 -- fase 4: la liquidación del proveedor entra al banco por el neto
                 SELECT l.empresa_id, l.neto, l.cuenta_id FROM ledger.liquidaciones_cobro l WHERE ${E('l.empresa_id')}
                 UNION ALL
                 -- depósito: sale de la caja al depositar; entra al banco del documento cuando llega (al conciliar)
                 SELECT d.empresa_id, -d.monto, cj.cuenta_id FROM ledger.depositos d JOIN ledger.cajas cj ON cj.id = d.caja_id
                  WHERE ${E('d.empresa_id')}
                 UNION ALL
                 SELECT d.empresa_id, d.monto, d.cuenta_id FROM ledger.depositos d
                  WHERE ${E('d.empresa_id')}
                    AND ${llegadaViva("'deposito'", 'd.id')}
                 UNION ALL
                 SELECT t.empresa_id, -t.monto, t.cuenta_origen_id FROM ledger.traslados t WHERE ${E('t.empresa_id')}
                 UNION ALL
                 SELECT t.empresa_id, t.monto, t.cuenta_destino_id FROM ledger.traslados t
                  WHERE ${E('t.empresa_id')}
                    AND ${llegadaViva("'traslado'", 't.id')}
                 UNION ALL
                 -- partida del extracto sin documento (comisión, interés): el monto de su línea en su cuenta
                 SELECT el.empresa_id, el.monto, el.cuenta_id FROM ledger.extractos_lineas el
                  WHERE ${E('el.empresa_id')}
                    AND EXISTS (SELECT 1 FROM ledger.asientos a WHERE a.origen_tipo = 'banco' AND a.origen_id = el.id
                                 AND a.reversa_de IS NULL
                                 AND NOT EXISTS (SELECT 1 FROM ledger.asientos r WHERE r.reversa_de = a.id))
                 UNION ALL
                 -- fase 5: pago a un proveedor (vigente) desde su caja, banco o cuenta bancaria; el egreso de
                 -- una compra al contado ya está arriba (su dinero sale con el asiento de la compra)
                 SELECT pp.empresa_id, -pp.monto, pp.cuenta_id FROM ledger.pagos_proveedores pp
                  WHERE ${E('pp.empresa_id')}
                    AND NOT EXISTS (SELECT 1 FROM ledger.pagos_proveedores_anulaciones x WHERE x.pago_id = pp.id)
                 UNION ALL
                 -- venta de un activo: su precio (sin IVA) a la cuenta bancaria de la baja
                 SELECT ac.empresa_id, b.precio_venta, b.cuenta_cobro_id
                   FROM ledger.activos_bajas b JOIN ledger.activos ac ON ac.id = b.activo_id
                  WHERE ${E('ac.empresa_id')} AND b.tipo = 'venta'
             ) x (empresa_id, monto, cuenta_id) GROUP BY 1, 2
         ), libro AS (
             SELECT a.empresa_id, m.cuenta_id, sum(m.debe - m.haber) AS saldo
               FROM ledger.movimientos m
               JOIN ledger.asientos a ON a.id = m.asiento_id
               JOIN ledger.cuentas c ON c.id = m.cuenta_id
              WHERE ${CAJA_O_BANCO('c.codigo')} AND ${E('a.empresa_id')}
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
        const ahora = await resumenDelMes(
            clienteLectura ?? db.connection(),
            String(cierre.periodo),
            Number(cierre.empresa_id),
        )
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
        '12.iva_por_certificar_distinto (2.1.11 = Σ IVA de avisos sin DTE certificado − notas internas − IVA castigado + IVA recuperado por pagos vigentes)',
        `WITH esperado AS (
             SELECT empresa_id, sum(monto) AS monto FROM (
             -- H17: el IVA de lo recuperado de un castigo vuelve a 2.1.11 (anular el pago lo saca)
             SELECT rc.empresa_id, sum(rc.iva) AS monto
               FROM ledger.recuperaciones_castigo rc JOIN billing.pagos p ON p.id = rc.pago_id
              WHERE p.estado = 'registrado' AND ${E('rc.empresa_id')}
              GROUP BY 1
             UNION ALL
             SELECT f.empresa_id,
                    sum(f.iva - coalesce((SELECT sum(n.iva) FROM billing.notas_credito n WHERE n.factura_id = f.id AND NOT ${anulada('n')}), 0)
                        -- fase 4 (§10.1, §10.9): lo castigado de un aviso sin DTE sale de 2.1.11
                        - coalesce((SELECT sum(cf.iva) FROM ledger.castigos_facturas cf WHERE cf.factura_id = f.id), 0)) AS monto
               FROM billing.facturas f
              WHERE f.aviso_cobro AND f.estado <> 'anulada' AND ${E('f.empresa_id')}
                AND NOT EXISTS (SELECT 1 FROM fiscal.dte d
                                 WHERE d.documento_id = f.id
                                   AND d.documento_tipo = CASE WHEN f.tipo = 'mora' THEN 'nota_debito' ELSE 'factura' END
                                   AND d.estado IN ('certificado', 'anulacion_pendiente'))
              GROUP BY 1
             ) e GROUP BY 1
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
    | 12 · FEL, estrictos por documento (auditor de la fase 3). El check de arriba compara 2.1.11 por
    | empresa; estos lo bajan a cada documento para que dos errores de signo contrario no se cancelen.
    */
    const DOC_DTE = `CASE WHEN f.tipo = 'mora' THEN 'nota_debito' ELSE 'factura' END`
    await revisar(
        '12.iva_por_certificar_del_documento (por aviso: 2.1.11 propio = iva − notas internas − IVA castigado sin DTE certificado; 0 si certificado o anulado)',
        `WITH x AS (
             SELECT f.id, f.estado, f.iva,
                    coalesce((SELECT sum(n.iva) FROM billing.notas_credito n WHERE n.factura_id = f.id AND NOT ${anulada('n')}), 0) AS iva_notas,
                    coalesce((SELECT sum(cf.iva) FROM ledger.castigos_facturas cf WHERE cf.factura_id = f.id), 0) AS iva_castigado,
                    EXISTS (SELECT 1 FROM fiscal.dte d WHERE d.documento_id = f.id AND d.documento_tipo = ${DOC_DTE}
                              AND d.estado IN ('certificado', 'anulacion_pendiente')) AS certificado,
                    (SELECT coalesce(sum(m.haber - m.debe), 0)
                       FROM ledger.movimientos m JOIN ledger.asientos a ON a.id = m.asiento_id
                       JOIN ledger.cuentas c ON c.id = m.cuenta_id
                      WHERE c.codigo = '${IVA_TRANSICION}'
                        AND ((a.origen_tipo IN ('factura', 'mora') AND a.origen_id = f.id)
                          OR (a.origen_tipo = 'nota_credito'
                              AND a.origen_id IN (SELECT n.id FROM billing.notas_credito n WHERE n.factura_id = f.id))
                          OR (a.origen_tipo = 'reclasificacion'
                              AND a.origen_id IN (SELECT d.id FROM fiscal.dte d
                                                   WHERE d.documento_id = f.id AND d.documento_tipo = ${DOC_DTE})))) AS libro
               FROM billing.facturas f
              WHERE f.aviso_cobro AND ${E('f.empresa_id')} AND ${C('f.cliente_id')}
         )
         -- el asiento del castigo es de varias facturas: a cada una le toca su castigos_facturas.iva (su
         -- total lo revisa 13.castigo_mal_contabilizado)
         SELECT id, estado, certificado, iva::text, iva_notas::text, iva_castigado::text,
                (libro - iva_castigado)::text AS iva_por_certificar_libro
           FROM x
          WHERE libro - iva_castigado <> CASE WHEN estado = 'anulada' OR certificado THEN 0 ELSE iva - iva_notas - iva_castigado END`,
    )
    await revisar(
        '12.movimiento_en_2.1.11_de_origen_inesperado (solo avisos, sus notas, su reclasificación, su castigo y el IVA recuperado de un castigo)',
        `SELECT a.id, a.origen_tipo, a.origen_id, m.debe::text, m.haber::text
           FROM ledger.movimientos m JOIN ledger.asientos a ON a.id = m.asiento_id
           JOIN ledger.cuentas c ON c.id = m.cuenta_id
           LEFT JOIN billing.facturas f ON a.origen_tipo IN ('factura', 'mora') AND f.id = a.origen_id
           LEFT JOIN billing.notas_credito n ON a.origen_tipo = 'nota_credito' AND n.id = a.origen_id
           LEFT JOIN billing.facturas fn ON fn.id = n.factura_id
          WHERE c.codigo = '${IVA_TRANSICION}' AND ${E('a.empresa_id')}
            AND NOT (a.origen_tipo = 'reclasificacion'
                     -- fase 4: el castigo de un aviso sin DTE debita 2.1.11 por su IVA
                     OR (a.origen_tipo = 'castigo' AND m.debe > 0
                         AND EXISTS (SELECT 1 FROM ledger.castigos_facturas cf JOIN billing.facturas fc ON fc.id = cf.factura_id
                                      WHERE cf.castigo_id = a.origen_id AND cf.iva > 0 AND fc.aviso_cobro))
                     -- H17: el pago que recupera un castigo con IVA lo devuelve a 2.1.11 (Haber; su reverso, Debe).
                     -- El monto exacto lo revisa 13.recuperacion_mal_contabilizada
                     OR (a.origen_tipo = 'pago' AND (m.haber > 0) = (a.reversa_de IS NULL)
                         AND EXISTS (SELECT 1 FROM ledger.recuperaciones_castigo rc
                                      WHERE rc.pago_id = a.origen_id AND rc.iva > 0))
                     OR (a.origen_tipo IN ('factura', 'mora') AND f.aviso_cobro)
                     OR (a.origen_tipo = 'nota_credito' AND fn.aviso_cobro))`,
    )
    await revisar(
        '12.reclasificacion_mal_formada (2 movimientos: Debe 2.1.11 = Haber 2.1.02, de un DTE de aviso de la misma empresa)',
        `WITH r AS (
             SELECT a.id, a.empresa_id, a.origen_id,
                    count(*) AS n,
                    sum(CASE WHEN c.codigo = '${IVA_TRANSICION}' THEN m.debe ELSE 0 END) AS debe_transicion,
                    sum(CASE WHEN c.codigo = '${IVA}' THEN m.haber ELSE 0 END) AS haber_debito,
                    sum(m.debe) AS debe
               FROM ledger.asientos a JOIN ledger.movimientos m ON m.asiento_id = a.id
               JOIN ledger.cuentas c ON c.id = m.cuenta_id
              WHERE a.origen_tipo = 'reclasificacion' AND a.reversa_de IS NULL AND ${E('a.empresa_id')}
              GROUP BY a.id
         )
         SELECT r.id, r.origen_id AS dte_id, r.n::int, r.debe_transicion::text, r.haber_debito::text,
                d.documento_tipo, f.aviso_cobro
           FROM r LEFT JOIN fiscal.dte d ON d.id = r.origen_id
           LEFT JOIN billing.facturas f ON f.id = d.documento_id AND d.documento_tipo IN ('factura', 'nota_debito')
          WHERE r.n <> 2 OR r.debe_transicion <> r.debe OR r.haber_debito <> r.debe OR r.debe <= 0
             OR f.id IS NULL OR NOT f.aviso_cobro OR f.empresa_id <> r.empresa_id
             OR (SELECT count(*) FROM ledger.asientos o
                  WHERE o.origen_tipo = 'reclasificacion' AND o.origen_id = r.origen_id AND o.reversa_de IS NULL) > 1`,
    )
    await revisar(
        '12.reclasificacion_distinta_del_iva_del_dte (H5: libro de ventas = 2.1.02; el DTE certifica d.iva)',
        `SELECT a.id, d.id AS dte_id, d.iva::text AS iva_dte,
                (SELECT sum(m.debe) FROM ledger.movimientos m WHERE m.asiento_id = a.id)::text AS reclasificado
           FROM ledger.asientos a JOIN fiscal.dte d ON d.id = a.origen_id
          WHERE a.origen_tipo = 'reclasificacion' AND a.reversa_de IS NULL AND ${E('a.empresa_id')}
            AND (SELECT sum(m.debe) FROM ledger.movimientos m WHERE m.asiento_id = a.id) <> d.iva`,
    )
    await revisar(
        '12.aviso_certificado_sin_reclasificacion (DTE certificado de un aviso con IVA pendiente sin su 2.1.11 / 2.1.02)',
        `SELECT d.id AS dte_id, f.id AS factura_id, f.iva::text
           FROM fiscal.dte d JOIN billing.facturas f ON f.id = d.documento_id
          WHERE d.documento_tipo IN ('factura', 'nota_debito') AND d.estado IN ('certificado', 'anulacion_pendiente')
            AND f.aviso_cobro AND ${E('f.empresa_id')}
            AND f.iva - coalesce((SELECT sum(n.iva) FROM billing.notas_credito n WHERE n.factura_id = f.id AND NOT ${anulada('n')}), 0) > 0
            AND NOT EXISTS (SELECT 1 FROM ledger.asientos a
                             WHERE a.origen_tipo = 'reclasificacion' AND a.origen_id = d.id AND a.reversa_de IS NULL
                               AND NOT EXISTS (SELECT 1 FROM ledger.asientos r WHERE r.reversa_de = a.id))`,
    )
    await revisar(
        '12.dte_anulado_con_documento_vivo (el DTE solo se anula junto con su factura o mora)',
        `SELECT d.id AS dte_id, d.documento_tipo, d.documento_id, f.estado
           FROM fiscal.dte d JOIN billing.facturas f ON f.id = d.documento_id
          WHERE d.documento_tipo IN ('factura', 'nota_debito') AND d.estado = 'anulado'
            AND f.estado <> 'anulada' AND ${E('d.empresa_id')}`,
    )
    await revisar(
        '12.dte_distinto_del_documento (empresa y tipo del DTE = los de su documento; total e IVA de la NCRE = los de su nota, referida a un DTE certificado)',
        `SELECT d.id AS dte_id, d.documento_tipo, d.documento_id, d.total::text, d.iva::text,
                coalesce(f.total, n.monto)::text AS total_documento, coalesce(f.iva, n.iva)::text AS iva_documento
           FROM fiscal.dte d
           LEFT JOIN billing.facturas f ON d.documento_tipo IN ('factura', 'nota_debito') AND f.id = d.documento_id
           LEFT JOIN billing.notas_credito n ON d.documento_tipo = 'nota_credito' AND n.id = d.documento_id
          WHERE ${E('d.empresa_id')}
            AND (coalesce(f.id, n.id) IS NULL
                 OR d.empresa_id <> coalesce(f.empresa_id, n.empresa_id)
                 -- el DTE de una factura o mora se certifica por el neto: lo revisa 12.dte_distinto_del_neto
                 OR (d.documento_tipo = 'nota_credito' AND (d.total <> n.monto OR d.iva <> n.iva))
                 OR (d.documento_tipo = 'factura' AND f.tipo <> 'servicio')
                 OR (d.documento_tipo = 'nota_debito' AND (f.tipo <> 'mora' OR d.tipo_dte <> 'NDEB'))
                 OR (d.documento_tipo = 'nota_credito' AND (d.tipo_dte <> 'NCRE' OR NOT EXISTS (
                        SELECT 1 FROM fiscal.dte o WHERE o.documento_tipo IN ('factura', 'nota_debito') AND o.documento_id = n.factura_id
                           AND o.autorizacion IS NOT NULL AND o.autorizacion = d.referencia->>'autorizacion'))))`,
    )

    await revisar(
        '12.dte_distinto_del_neto (decisión del líder, H5 y H11: DTE de factura o mora = bruto − notas emitidas antes del DTE y sin NCRE propia, total e IVA exactos)',
        `WITH x AS (
             SELECT d.id AS dte_id, d.estado, f.id AS factura_id, d.total, d.iva, f.total AS bruto, f.iva AS iva_bruto,
                    coalesce((SELECT sum(n.monto) FROM billing.notas_credito n
                               WHERE n.factura_id = f.id AND n.created_at < d.created_at
                                 AND NOT EXISTS (SELECT 1 FROM billing.notas_credito_anulaciones xa
                                                  WHERE xa.nota_id = n.id AND xa.anulado_en < d.created_at)
                                 AND NOT EXISTS (SELECT 1 FROM fiscal.dte o
                                                  WHERE o.documento_tipo = 'nota_credito' AND o.documento_id = n.id)), 0) AS notas,
                    coalesce((SELECT sum(n.iva) FROM billing.notas_credito n
                               WHERE n.factura_id = f.id AND n.created_at < d.created_at
                                 AND NOT EXISTS (SELECT 1 FROM billing.notas_credito_anulaciones xa
                                                  WHERE xa.nota_id = n.id AND xa.anulado_en < d.created_at)
                                 AND NOT EXISTS (SELECT 1 FROM fiscal.dte o
                                                  WHERE o.documento_tipo = 'nota_credito' AND o.documento_id = n.id)), 0) AS iva_notas
               FROM fiscal.dte d JOIN billing.facturas f ON f.id = d.documento_id
              WHERE d.documento_tipo IN ('factura', 'nota_debito') AND ${E('d.empresa_id')}
         )
         SELECT dte_id, estado, factura_id, total::text, iva::text, (bruto - notas)::text AS total_neto,
                (iva_bruto - iva_notas)::text AS iva_neto
           FROM x
          WHERE total <> bruto - notas OR iva <> iva_bruto - iva_notas`,
    )
    await revisar(
        '12.nota_interna_sobre_documento_certificado (después del DTE, la nota de un documento certificado es NCRE)',
        `SELECT n.id AS nota_id, n.factura_id, d.id AS dte_id, d.estado
           FROM billing.notas_credito n
           JOIN billing.facturas f ON f.id = n.factura_id
           JOIN fiscal.dte d ON d.documento_id = f.id
                AND d.documento_tipo = CASE WHEN f.tipo = 'mora' THEN 'nota_debito' ELSE 'factura' END
          WHERE ${E('n.empresa_id')} AND ${C('n.cliente_id')}
            AND d.estado IN ('certificado', 'anulacion_pendiente', 'anulado')
            AND n.created_at > d.created_at
            AND NOT EXISTS (SELECT 1 FROM fiscal.dte o WHERE o.documento_tipo = 'nota_credito' AND o.documento_id = n.id)`,
    )

    if ((await notaAnuladaSql())('n') !== 'false') {
        await revisar(
            '9.nota_anulada_mal (reverso espejo exacto de su asiento, NCRE rechazada en definitivo, una sola anulación)',
            `WITH x AS (
                 SELECT n.id AS nota_id, n.empresa_id, n.cliente_id,
                        (SELECT count(*) FROM billing.notas_credito_anulaciones a WHERE a.nota_id = n.id) AS anulaciones,
                        (SELECT min(a.asiento_id) FROM billing.notas_credito_anulaciones a WHERE a.nota_id = n.id) AS reverso_id,
                        (SELECT min(o.id) FROM ledger.asientos o
                          WHERE o.origen_tipo = 'nota_credito' AND o.origen_id = n.id AND o.reversa_de IS NULL) AS original_id,
                        (SELECT count(*) FROM ledger.asientos o
                          WHERE o.origen_tipo = 'nota_credito' AND o.origen_id = n.id AND o.reversa_de IS NULL) AS originales
                   FROM billing.notas_credito n
                  WHERE ${E('n.empresa_id')} AND ${anulada('n')}
             ), lado AS (
                 -- original + reverso, por cuenta y cliente: todo en cero si el reverso es su espejo exacto
                 SELECT x.nota_id, m.cuenta_id, m.cliente_id, sum(m.debe - m.haber) AS dif
                   FROM x JOIN ledger.movimientos m ON m.asiento_id IN (x.original_id, x.reverso_id)
                  GROUP BY 1, 2, 3
             )
             SELECT x.nota_id, x.anulaciones::int, x.originales::int, x.original_id, x.reverso_id,
                    r.reversa_de, r.origen_tipo AS origen_reverso, r.origen_id AS origen_id_reverso,
                    r.empresa_id AS empresa_reverso, x.empresa_id,
                    (SELECT count(*) FROM lado WHERE lado.nota_id = x.nota_id AND lado.dif <> 0)::int AS cuentas_distintas,
                    (SELECT string_agg(d.estado || CASE WHEN d.definitivo THEN '/def' ELSE '' END, ',')
                       FROM fiscal.dte d WHERE d.documento_tipo = 'nota_credito' AND d.documento_id = x.nota_id) AS dte,
                    c.modo AS fel_modo
               FROM x
               LEFT JOIN ledger.asientos r ON r.id = x.reverso_id
               LEFT JOIN fiscal.fel_configuracion c ON c.empresa_id = x.empresa_id
              WHERE x.anulaciones <> 1 OR x.originales <> 1 OR r.id IS NULL
                 OR r.reversa_de IS DISTINCT FROM x.original_id
                 OR r.origen_tipo <> 'nota_credito' OR r.origen_id IS DISTINCT FROM x.nota_id
                 OR r.empresa_id <> x.empresa_id
                 OR (SELECT count(*) FROM ledger.asientos o WHERE o.reversa_de = x.original_id) <> 1
                 OR EXISTS (SELECT 1 FROM lado WHERE lado.nota_id = x.nota_id AND lado.dif <> 0)
                 -- el reverso mueve a los mismos clientes que el original y a ninguno más
                 OR EXISTS (SELECT 1 FROM ledger.movimientos m WHERE m.asiento_id = x.reverso_id
                              AND m.cliente_id IS DISTINCT FROM x.cliente_id AND m.cliente_id IS NOT NULL)
                 -- su NCRE: rechazada en definitivo, nunca certificada (ni en curso)
                 OR EXISTS (SELECT 1 FROM fiscal.dte d WHERE d.documento_tipo = 'nota_credito' AND d.documento_id = x.nota_id
                              AND NOT (d.estado = 'rechazado' AND d.definitivo))
                 -- sin DTE: en obligatoria solo la nota interna de la diferencia de un pago anulado (H13), anulada con
                 -- ese pago y sin un DTE de la factura emitido antes de anularla; fuera de obligatoria, una nota interna
                 OR (NOT EXISTS (SELECT 1 FROM fiscal.dte d WHERE d.documento_tipo = 'nota_credito' AND d.documento_id = x.nota_id)
                     AND coalesce(c.modo, 'desactivada') = 'obligatoria'
                     AND NOT EXISTS (
                         SELECT 1 FROM billing.notas_credito_anulaciones xa
                           JOIN billing.diferencias_cobro dc ON dc.nota_credito_id = xa.nota_id AND dc.pago_id = xa.pago_id
                           JOIN billing.pagos pa ON pa.id = xa.pago_id AND pa.estado = 'anulado'
                           JOIN billing.notas_credito nn ON nn.id = xa.nota_id
                           JOIN billing.facturas ff ON ff.id = nn.factura_id
                          WHERE xa.nota_id = x.nota_id
                            AND NOT EXISTS (SELECT 1 FROM fiscal.dte fd WHERE fd.documento_id = ff.id
                                             AND fd.documento_tipo = CASE WHEN ff.tipo = 'mora' THEN 'nota_debito' ELSE 'factura' END
                                             AND fd.estado <> 'rechazado' AND fd.created_at <= xa.anulado_en)))
                 -- la anulación por pago es solo la de su diferencia, y de un pago anulado
                 OR EXISTS (SELECT 1 FROM billing.notas_credito_anulaciones xa WHERE xa.nota_id = x.nota_id AND xa.pago_id IS NOT NULL
                              AND NOT EXISTS (SELECT 1 FROM billing.diferencias_cobro dc JOIN billing.pagos pa ON pa.id = dc.pago_id
                                               WHERE dc.nota_credito_id = xa.nota_id AND dc.pago_id = xa.pago_id AND pa.estado = 'anulado'))`,
        )
    }

    await revisar(
        '12.aplicacion_durante_anulacion_pendiente (H6: entre el inicio de la anulación del DTE y la respuesta del certificador la factura no recibe pagos ni aplicaciones)',
        `WITH ventana AS (
             SELECT d.id AS dte_id, d.documento_id AS factura_id, ini.created_at AS desde,
                    (SELECT min(i.enviado_en) FROM fiscal.dte_intentos i
                      WHERE i.dte_id = d.id AND i.operacion = 'anular' AND i.resultado IN ('anulado', 'rechazado')
                        AND i.enviado_en >= ini.created_at) AS hasta
               FROM fiscal.dte d
               JOIN audit.cambios ini ON ini.entidad_tipo = 'dte' AND ini.entidad_id = d.id AND ini.campo = 'estado'
                    AND ini.despues = '"anulacion_pendiente"'::jsonb
              WHERE d.documento_tipo IN ('factura', 'nota_debito') AND ${E('d.empresa_id')}
         )
         SELECT v.dte_id, v.factura_id, a.id AS aplicacion_id, a.pago_id, a.monto::text,
                to_char(v.desde, 'YYYY-MM-DD HH24:MI:SS.US') AS desde, to_char(a.created_at, 'YYYY-MM-DD HH24:MI:SS.US') AS aplicada
           FROM ventana v JOIN billing.pagos_aplicaciones a ON a.factura_id = v.factura_id
          -- la respuesta del certificador cierra la ventana: lo que se aplica en esa misma transacción (al
          -- rechazarse la anulación) ya no está en la pendiente
          WHERE a.created_at >= v.desde AND (v.hasta IS NULL OR a.created_at < v.hasta)`,
    )
    await revisar(
        '12.anulacion_rechazada_con_anticipo_sin_aplicar (el DTE volvió de anulacion_pendiente a certificado y el anticipo del cliente no se aplicó a esa deuda)',
        `WITH ant AS (
             SELECT a.empresa_id, m.cliente_id, sum(m.haber - m.debe) AS saldo
               FROM ledger.movimientos m JOIN ledger.asientos a ON a.id = m.asiento_id
               JOIN ledger.cuentas c ON c.id = m.cuenta_id
              WHERE c.codigo = '${ANTICIPOS}' AND ${E('a.empresa_id')}
              GROUP BY 1, 2 HAVING sum(m.haber - m.debe) > 0
         )
         SELECT d.id AS dte_id, f.id AS factura_id, f.cliente_id, (f.total - f.pagado)::text AS pendiente,
                ant.saldo::text AS anticipo
           FROM fiscal.dte d
           JOIN billing.facturas f ON f.id = d.documento_id
                AND d.documento_tipo = CASE WHEN f.tipo = 'mora' THEN 'nota_debito' ELSE 'factura' END
           JOIN ant ON ant.empresa_id = f.empresa_id AND ant.cliente_id = f.cliente_id
          WHERE d.estado = 'certificado' AND ${E('d.empresa_id')}
            AND f.estado IN ${ESTADOS_PENDIENTES} AND f.total > f.pagado
            AND EXISTS (SELECT 1 FROM fiscal.dte_intentos i
                         WHERE i.dte_id = d.id AND i.operacion = 'anular' AND i.resultado = 'rechazado')`,
    )

    /*
    | 13 · Fase 4: cobros por liquidar, depósitos y traslados, extractos y conciliación, cartera
    |      (localización fiscal §10.3 y §10.9)
    */
    await revisar(
        '13.cobros_por_liquidar_distinto (por proveedor: 1.1.10.NN = Σ pagos vigentes sin liquidar − contracargos pendientes)',
        `WITH esperado AS (
             SELECT pc.id, pc.empresa_id, pc.cuenta_id,
                    coalesce(sum(CASE
                        WHEN p.estado = 'registrado'
                             AND NOT EXISTS (SELECT 1 FROM ledger.liquidaciones_pagos l WHERE l.pago_id = p.id AND l.tipo = 'cobro')
                             THEN p.monto
                        WHEN p.estado = 'anulado'
                             AND EXISTS (SELECT 1 FROM ledger.liquidaciones_pagos l WHERE l.pago_id = p.id AND l.tipo = 'cobro')
                             AND NOT EXISTS (SELECT 1 FROM ledger.liquidaciones_pagos l WHERE l.pago_id = p.id AND l.tipo = 'contracargo')
                             THEN -p.monto
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
         SELECT coalesce(e.empresa_id, l.empresa_id) AS empresa_id,
                (SELECT codigo FROM ledger.cuentas WHERE id = coalesce(e.cuenta_id, l.cuenta_id)) AS cuenta,
                coalesce(e.monto, 0)::text AS esperado, coalesce(l.monto, 0)::text AS libro
           FROM esperado e FULL JOIN libro l ON l.cuenta_id = e.cuenta_id AND l.empresa_id = e.empresa_id
          WHERE coalesce(e.monto, 0) <> coalesce(l.monto, 0)`,
    )
    await revisar(
        '13.liquidacion_de_pago_inconsistente (cada cobro por el monto del pago, del mismo proveedor y empresa; contracargo solo de un pago liquidado y anulado)',
        `SELECT lp.id, lp.liquidacion_id, lp.pago_id, lp.tipo, lp.monto::text, p.monto::text AS monto_pago, p.estado,
                p.proveedor_cobro_id, l.proveedor_cobro_id AS proveedor_liquidacion
           FROM ledger.liquidaciones_pagos lp
           JOIN ledger.liquidaciones_cobro l ON l.id = lp.liquidacion_id
           JOIN billing.pagos p ON p.id = lp.pago_id
          WHERE ${E('l.empresa_id')}
            AND (lp.monto <> p.monto OR p.proveedor_cobro_id IS DISTINCT FROM l.proveedor_cobro_id
                 OR p.empresa_id <> l.empresa_id
                 OR (lp.tipo = 'contracargo' AND (p.estado <> 'anulado' OR NOT EXISTS (
                        SELECT 1 FROM ledger.liquidaciones_pagos c WHERE c.pago_id = p.id AND c.tipo = 'cobro'
                           AND c.liquidacion_id <> lp.liquidacion_id))))`,
    )
    await revisar(
        '13.liquidacion_mal_contabilizada (Banco neto + 5.1.02 comisión / 1.1.10.NN bruto y nada más; bruto = Σ cobros − Σ contracargos; fecha de la liquidación)',
        `WITH mov AS (
             SELECT a.origen_id AS id, min(a.fecha) AS fecha, count(DISTINCT a.id) AS asientos,
                    sum(CASE WHEN m.cuenta_id = l.cuenta_id THEN m.debe - m.haber ELSE 0 END) AS banco,
                    sum(CASE WHEN c.codigo = '${COMISIONES}' THEN m.debe - m.haber ELSE 0 END) AS comision,
                    sum(CASE WHEN m.cuenta_id = pc.cuenta_id THEN m.haber - m.debe ELSE 0 END) AS puente,
                    count(*) FILTER (WHERE m.cuenta_id NOT IN (l.cuenta_id, pc.cuenta_id) AND c.codigo <> '${COMISIONES}') AS ajenos
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
                mov.puente::text, mov.ajenos::int, pagos.bruto::text AS bruto_pagos
           FROM ledger.liquidaciones_cobro l
           JOIN ledger.proveedores_cobro pc ON pc.id = l.proveedor_cobro_id
           LEFT JOIN mov ON mov.id = l.id LEFT JOIN pagos ON pagos.liquidacion_id = l.id
          WHERE ${E('l.empresa_id')}
            AND (mov.id IS NULL OR mov.asientos <> 1 OR mov.banco <> l.neto OR mov.comision <> l.comision
                 OR mov.puente <> l.bruto OR mov.ajenos <> 0 OR mov.fecha <> l.fecha
                 OR pagos.bruto IS DISTINCT FROM l.bruto OR l.neto <> l.bruto - l.comision
                 OR pc.empresa_id <> l.empresa_id)`,
    )
    await revisar(
        '13.fondos_en_transito_distinto (1.1.11 = Σ depósitos y traslados sin acreditar)',
        `WITH esperado AS (
             SELECT empresa_id, sum(monto) AS monto FROM (
                 SELECT d.empresa_id, d.monto FROM ledger.depositos d
                  WHERE ${E('d.empresa_id')}
                    AND NOT ${llegadaViva("'deposito'", 'd.id')}
                 UNION ALL
                 SELECT t.empresa_id, t.monto FROM ledger.traslados t
                  WHERE ${E('t.empresa_id')}
                    AND NOT ${llegadaViva("'traslado'", 't.id')}
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
    await revisar(
        '13.transito_mal_contabilizado (depósito 1.1.11 / Caja del turno; traslado 1.1.11 / Banco origen; llegada Banco destino / 1.1.11 en la cuenta de su línea, con su fecha o la del documento si es posterior)',
        `WITH doc AS (
             SELECT 'deposito' AS tipo, d.id, d.empresa_id, d.monto, cj.cuenta_id AS sale, d.cuenta_id AS llega, d.fecha,
                    tu.id IS NOT NULL AS turno_ok
               FROM ledger.depositos d JOIN ledger.cajas cj ON cj.id = d.caja_id
               LEFT JOIN ledger.cajas_turnos tu ON tu.id = d.turno_id AND tu.caja_id = d.caja_id
              WHERE ${E('d.empresa_id')}
             UNION ALL
             SELECT 'traslado', t.id, t.empresa_id, t.monto, t.cuenta_origen_id, t.cuenta_destino_id, t.fecha, true
               FROM ledger.traslados t WHERE ${E('t.empresa_id')}
         ), mov AS (
             -- por documento: lo que su(s) asiento(s) movieron en cada cuenta
             SELECT a.origen_tipo AS tipo, a.origen_id AS id, m.cuenta_id, c.codigo, sum(m.debe - m.haber) AS neto,
                    count(DISTINCT a.id) AS asientos
               FROM ledger.asientos a JOIN ledger.movimientos m ON m.asiento_id = a.id
               JOIN ledger.cuentas c ON c.id = m.cuenta_id
              WHERE a.origen_tipo IN ('deposito', 'traslado') AND ${E('a.empresa_id')}
              GROUP BY 1, 2, 3, 4
         ), x AS (
             SELECT doc.*, x.cuenta_id AS acreditada_en, x.linea_id, to_char(x.fecha, 'YYYY-MM-DD') AS fecha_llegada,
                    el.cuenta_id AS cuenta_linea, to_char(el.fecha, 'YYYY-MM-DD') AS fecha_linea, el.monto AS monto_linea,
                    -- asientos vivos del documento: ni reversos ni revertidos (una llegada reatribuida no cuenta)
                    (SELECT count(DISTINCT a.id) FROM ledger.asientos a
                      WHERE a.origen_tipo = doc.tipo AND a.origen_id = doc.id AND a.reversa_de IS NULL
                        AND NOT EXISTS (SELECT 1 FROM ledger.asientos r WHERE r.reversa_de = a.id)) AS asientos,
                    ${llegadaViva('doc.tipo', 'doc.id')} AS llegada_viva,
                    coalesce((SELECT sum(neto) FROM mov WHERE mov.tipo = doc.tipo AND mov.id = doc.id AND mov.codigo = '${TRANSITO}'), 0) AS transito,
                    coalesce((SELECT sum(neto) FROM mov WHERE mov.tipo = doc.tipo AND mov.id = doc.id AND mov.cuenta_id = doc.sale), 0) AS salida,
                    coalesce((SELECT sum(neto) FROM mov WHERE mov.tipo = doc.tipo AND mov.id = doc.id AND mov.cuenta_id = doc.llega), 0) AS llegada,
                    coalesce((SELECT sum(abs(neto)) FROM mov WHERE mov.tipo = doc.tipo AND mov.id = doc.id
                               AND mov.codigo <> '${TRANSITO}' AND mov.cuenta_id NOT IN (doc.sale, doc.llega)), 0) AS ajeno,
                    (SELECT to_char(max(a.fecha), 'YYYY-MM-DD') FROM ledger.asientos a JOIN ledger.movimientos m ON m.asiento_id = a.id
                      WHERE a.origen_tipo = doc.tipo AND a.origen_id = doc.id AND a.reversa_de IS NULL
                        AND NOT EXISTS (SELECT 1 FROM ledger.asientos r WHERE r.reversa_de = a.id)
                        AND m.cuenta_id = doc.llega) AS fecha_asiento_llegada
               FROM doc
               LEFT JOIN ledger.transitos_acreditados x ON x.tipo = doc.tipo AND x.documento_id = doc.id
               LEFT JOIN ledger.extractos_lineas el ON el.id = x.linea_id
         )
         SELECT tipo, id, monto::text, asientos::int, transito::text, salida::text, llegada::text, ajeno::text,
                acreditada_en, cuenta_linea, fecha_llegada, fecha_linea
           FROM x
          WHERE ajeno <> 0 OR salida <> -monto OR NOT turno_ok
             OR (NOT llegada_viva AND (asientos <> 1 OR transito <> monto OR llegada <> 0))
             OR (llegada_viva AND acreditada_en IS NULL)
             OR (llegada_viva AND (asientos <> 2 OR transito <> 0 OR llegada <> monto
                 OR acreditada_en <> llega OR linea_id IS NULL OR cuenta_linea <> llega
                 -- la llegada lleva la fecha de la línea (o la del documento, si es posterior)
                 OR fecha_llegada <> greatest(to_char(fecha, 'YYYY-MM-DD'), fecha_linea)
                 OR fecha_asiento_llegada <> fecha_llegada))`,
    )
    await revisar(
        '13.extracto_descuadrado (Σ líneas = saldo final − saldo inicial; líneas de la cuenta y empresa del extracto)',
        `SELECT e.id, e.saldo_inicial::text, e.saldo_final::text, coalesce(sum(l.monto), 0)::text AS lineas,
                bool_and(l.cuenta_id = e.cuenta_id AND l.empresa_id = e.empresa_id) AS misma_cuenta
           FROM ledger.extractos e LEFT JOIN ledger.extractos_lineas l ON l.extracto_id = e.id
          WHERE ${E('e.empresa_id')}
          GROUP BY e.id
         HAVING coalesce(sum(l.monto), 0) <> e.saldo_final - e.saldo_inicial
             OR NOT coalesce(bool_and(l.cuenta_id = e.cuenta_id AND l.empresa_id = e.empresa_id), true)`,
    )
    await revisar(
        '13.partida_de_extracto_mal_contabilizada (registrar desde el extracto: un asiento nuevo con el monto de la línea en su cuenta, su fecha y una contrapartida)',
        `WITH a AS (
             SELECT a.id, a.origen_id AS linea_id, a.fecha,
                    sum(CASE WHEN m.cuenta_id = el.cuenta_id THEN m.debe - m.haber ELSE 0 END) AS banco,
                    count(*) AS movimientos
               FROM ledger.asientos a JOIN ledger.extractos_lineas el ON el.id = a.origen_id
               JOIN ledger.movimientos m ON m.asiento_id = a.id
              WHERE a.origen_tipo = 'banco' AND a.reversa_de IS NULL AND ${E('a.empresa_id')}
              GROUP BY a.id, a.origen_id, a.fecha
         )
         SELECT a.id, a.linea_id, a.banco::text, el.monto::text, a.movimientos::int,
                to_char(a.fecha, 'YYYY-MM-DD') AS fecha, to_char(el.fecha, 'YYYY-MM-DD') AS fecha_linea
           FROM a JOIN ledger.extractos_lineas el ON el.id = a.linea_id
          WHERE a.banco <> el.monto OR a.movimientos <> 2 OR a.fecha <> el.fecha
             OR (SELECT count(*) FROM ledger.asientos o WHERE o.origen_tipo = 'banco' AND o.origen_id = a.linea_id
                  AND o.reversa_de IS NULL) <> 1`,
    )
    await revisar(
        '13.conciliacion_descuadrada (un grupo = una línea; Σ movimientos vigentes = línea; cada fila = neto del movimiento en la cuenta de la línea)',
        `WITH vig AS (
             SELECT c.* FROM ledger.conciliaciones c
              WHERE ${E('c.empresa_id')}
                AND NOT EXISTS (SELECT 1 FROM ledger.conciliaciones_anulaciones x WHERE x.conciliacion_id = c.id)
         )
         SELECT v.grupo, min(v.linea_id) AS linea_id, count(DISTINCT v.linea_id)::int AS lineas,
                sum(v.monto)::text AS conciliado, max(el.monto)::text AS linea
           FROM vig v JOIN ledger.extractos_lineas el ON el.id = v.linea_id
           JOIN ledger.movimientos m ON m.id = v.movimiento_id JOIN ledger.asientos a ON a.id = m.asiento_id
          GROUP BY v.grupo
         HAVING count(DISTINCT v.linea_id) <> 1 OR sum(v.monto) <> max(el.monto)
             OR NOT bool_and(v.monto = m.debe - m.haber AND m.cuenta_id = el.cuenta_id AND v.cuenta_id = el.cuenta_id
                             AND a.empresa_id = el.empresa_id AND v.empresa_id = el.empresa_id)`,
    )
    await revisar(
        '13.conciliacion_duplicada (un movimiento o una línea en dos conciliaciones vigentes; un grupo anulado a medias)',
        `WITH vig AS (
             SELECT c.* FROM ledger.conciliaciones c
              WHERE ${E('c.empresa_id')}
                AND NOT EXISTS (SELECT 1 FROM ledger.conciliaciones_anulaciones x WHERE x.conciliacion_id = c.id)
         )
         SELECT 'movimiento' AS que, movimiento_id::text AS id, count(DISTINCT grupo)::int AS grupos FROM vig
          GROUP BY movimiento_id HAVING count(DISTINCT grupo) > 1
         UNION ALL
         SELECT 'linea', linea_id::text, count(DISTINCT grupo)::int FROM vig GROUP BY linea_id HAVING count(DISTINCT grupo) > 1
         UNION ALL
         SELECT 'grupo_a_medias', c.grupo::text, count(*)::int FROM ledger.conciliaciones c
          WHERE ${E('c.empresa_id')}
          GROUP BY c.grupo
         HAVING count(*) FILTER (WHERE EXISTS (SELECT 1 FROM ledger.conciliaciones_anulaciones x WHERE x.conciliacion_id = c.id))
                NOT IN (0, count(*))`,
    )
    await revisar(
        '13.castigo_mal_contabilizado (2.1.11 debe = Σ IVA castigado; 1.1.12 = estimación; 5.3.02 = gasto; CxC haber = Σ facturas; IVA de cada factura según su aviso)',
        `WITH mov AS (
             SELECT a.origen_id AS id, count(DISTINCT a.id) AS asientos,
                    sum(CASE WHEN c.codigo = '${CXC}' THEN m.haber - m.debe ELSE 0 END) AS cxc,
                    sum(CASE WHEN c.codigo = '${IVA_TRANSICION}' THEN m.debe - m.haber ELSE 0 END) AS iva,
                    sum(CASE WHEN c.codigo = '${ESTIMACION}' THEN m.debe - m.haber ELSE 0 END) AS estimacion,
                    sum(CASE WHEN c.codigo = '${INCOBRABLES}' THEN m.debe - m.haber ELSE 0 END) AS gasto,
                    count(*) FILTER (WHERE c.codigo NOT IN ('${CXC}', '${IVA_TRANSICION}', '${ESTIMACION}', '${INCOBRABLES}')) AS ajenos,
                    bool_and(c.codigo <> '${CXC}' OR m.cliente_id IS NOT NULL) AS con_cliente
               FROM ledger.asientos a JOIN ledger.movimientos m ON m.asiento_id = a.id
               JOIN ledger.cuentas c ON c.id = m.cuenta_id
              WHERE a.origen_tipo = 'castigo' AND a.reversa_de IS NULL AND ${E('a.empresa_id')}
              GROUP BY 1
         ), doc AS (
             SELECT castigo_id, sum(monto) AS monto, sum(iva) AS iva FROM ledger.castigos_facturas GROUP BY 1
         )
         SELECT k.id, k.monto::text, k.iva::text, k.estimacion::text, k.gasto::text, doc.monto::text AS facturas,
                doc.iva::text AS iva_facturas, mov.cxc::text, mov.iva::text AS iva_libro, mov.estimacion::text AS estimacion_libro,
                mov.gasto::text AS gasto_libro, mov.ajenos::int
           FROM ledger.castigos k JOIN doc ON doc.castigo_id = k.id LEFT JOIN mov ON mov.id = k.id
          WHERE ${E('k.empresa_id')}
            AND (mov.id IS NULL OR mov.asientos <> 1 OR mov.cxc <> doc.monto OR mov.iva <> doc.iva OR mov.iva <> k.iva
                 OR mov.estimacion <> k.estimacion OR mov.gasto <> k.gasto OR mov.ajenos <> 0 OR NOT mov.con_cliente
                 OR k.monto <> doc.monto OR k.iva <> doc.iva
                 OR (SELECT count(DISTINCT m.cliente_id) FROM ledger.asientos a JOIN ledger.movimientos m ON m.asiento_id = a.id
                      WHERE a.origen_tipo = 'castigo' AND a.origen_id = k.id AND m.cliente_id IS NOT NULL) <> 1
                 OR EXISTS (SELECT 1 FROM ledger.asientos a JOIN ledger.movimientos m ON m.asiento_id = a.id
                             WHERE a.origen_tipo = 'castigo' AND a.origen_id = k.id AND m.cliente_id <> k.cliente_id))`,
    )
    await revisar(
        '13.castigo_de_factura_mal_calculado (saldo pendiente; IVA = proporcional al aviso sin DTE, 0 con DTE o sin aviso; factura cubierta y sin DTE posterior)',
        `WITH x AS (
             SELECT cf.*, f.total, f.pagado, f.iva AS iva_factura, f.aviso_cobro, f.estado, k.created_at AS castigado_en,
                    coalesce((SELECT sum(n.monto) FROM billing.notas_credito n WHERE n.factura_id = f.id AND NOT ${anulada('n')}), 0) AS notas,
                    coalesce((SELECT sum(n.iva) FROM billing.notas_credito n WHERE n.factura_id = f.id AND NOT ${anulada('n')}), 0) AS iva_notas,
                    EXISTS (SELECT 1 FROM fiscal.dte d WHERE d.documento_id = f.id
                              AND d.documento_tipo = CASE WHEN f.tipo = 'mora' THEN 'nota_debito' ELSE 'factura' END
                              AND d.estado <> 'rechazado' AND d.created_at <= k.created_at) AS con_dte,
                    EXISTS (SELECT 1 FROM fiscal.dte d WHERE d.documento_id = f.id
                              AND d.documento_tipo = CASE WHEN f.tipo = 'mora' THEN 'nota_debito' ELSE 'factura' END
                              AND d.estado <> 'rechazado' AND d.created_at > k.created_at) AS dte_posterior
               FROM ledger.castigos_facturas cf JOIN ledger.castigos k ON k.id = cf.castigo_id
               JOIN billing.facturas f ON f.id = cf.factura_id
              WHERE ${E('k.empresa_id')}
         ), y AS (
             SELECT x.*, CASE WHEN NOT aviso_cobro OR con_dte THEN 0
                              WHEN monto = total - notas THEN iva_factura - iva_notas
                              ELSE least(iva_factura - iva_notas, round(monto * (iva_factura - iva_notas) / (total - notas), 2)) END AS iva_esperado
               FROM x
         )
         SELECT factura_id, castigo_id, monto::text, iva::text, iva_esperado::text, total::text, pagado::text, estado,
                dte_posterior
           FROM y
          -- hoy (desvío g de A3) la castigada queda pagada con pagado = total; con la decisión (g), estado castigada
          -- y pagado = solo lo cobrado (pagado + castigado = total)
          WHERE iva <> iva_esperado OR dte_posterior
             OR NOT ((estado = 'pagada' AND pagado = total) OR (estado = 'castigada' AND pagado + monto = total))`,
    )
    await revisar(
        '13.estimacion_incobrables (1.1.12 = Σ provisiones − Σ estimación usada en castigos, nunca deudora; cada provisión = falta hasta el tope)',
        `WITH libro AS (
             SELECT a.empresa_id, sum(m.haber - m.debe) AS saldo
               FROM ledger.movimientos m JOIN ledger.asientos a ON a.id = m.asiento_id
               JOIN ledger.cuentas c ON c.id = m.cuenta_id
              WHERE c.codigo = '${ESTIMACION}' AND ${E('a.empresa_id')}
              GROUP BY 1
         ), doc AS (
             SELECT empresa_id, sum(monto) AS saldo FROM (
                 SELECT empresa_id, monto FROM ledger.provisiones_cartera WHERE ${E('empresa_id')}
                 UNION ALL
                 SELECT empresa_id, -estimacion FROM ledger.castigos WHERE ${E('empresa_id')}
             ) x GROUP BY 1
         )
         SELECT coalesce(l.empresa_id, d.empresa_id) AS empresa_id, coalesce(l.saldo, 0)::text AS libro,
                coalesce(d.saldo, 0)::text AS documentos
           FROM libro l FULL JOIN doc d ON d.empresa_id = l.empresa_id
          WHERE coalesce(l.saldo, 0) <> coalesce(d.saldo, 0) OR coalesce(l.saldo, 0) < 0`,
    )
    await revisar(
        '13.provision_mal_contabilizada (5.3.02 / 1.1.12 por el monto, fecha del corte; monto = máx(0, tope − saldo anterior); tope = base × %)',
        `WITH mov AS (
             SELECT a.origen_id AS id, min(a.fecha) AS fecha, count(DISTINCT a.id) AS asientos,
                    sum(CASE WHEN c.codigo = '${INCOBRABLES}' THEN m.debe - m.haber ELSE 0 END) AS gasto,
                    sum(CASE WHEN c.codigo = '${ESTIMACION}' THEN m.haber - m.debe ELSE 0 END) AS estimacion,
                    count(*) FILTER (WHERE c.codigo NOT IN ('${INCOBRABLES}', '${ESTIMACION}')) AS ajenos
               FROM ledger.asientos a JOIN ledger.movimientos m ON m.asiento_id = a.id
               JOIN ledger.cuentas c ON c.id = m.cuenta_id
              WHERE a.origen_tipo = 'provision' AND a.reversa_de IS NULL AND ${E('a.empresa_id')}
              GROUP BY 1
         )
         SELECT p.id, p.base::text, p.porcentaje, p.tope::text, p.saldo_anterior::text, p.monto::text,
                mov.gasto::text, mov.estimacion::text, mov.ajenos::int
           FROM ledger.provisiones_cartera p LEFT JOIN mov ON mov.id = p.id
          WHERE ${E('p.empresa_id')}
            AND (p.tope <> round(p.base * p.porcentaje::numeric / 100, 2)
                 OR p.monto <> greatest(0, p.tope - p.saldo_anterior)
                 OR (p.monto = 0 AND mov.id IS NOT NULL)
                 OR (p.monto > 0 AND (mov.id IS NULL OR mov.asientos <> 1 OR mov.gasto <> p.monto
                                      OR mov.estimacion <> p.monto OR mov.ajenos <> 0 OR mov.fecha <> p.fecha)))`,
    )
    await revisar(
        '13.provision_sobre_el_tope (H12: la reserva en 1.1.12 al corte no supera el tope de su provisión)',
        `SELECT p.id, to_char(p.fecha, 'YYYY-MM-DD') AS fecha, p.tope::text,
                (SELECT coalesce(sum(m.haber - m.debe), 0) FROM ledger.movimientos m JOIN ledger.asientos a ON a.id = m.asiento_id
                   JOIN ledger.cuentas c ON c.id = m.cuenta_id
                  WHERE c.codigo = '${ESTIMACION}' AND a.empresa_id = p.empresa_id AND a.fecha <= p.fecha)::text AS reserva_al_corte
           FROM ledger.provisiones_cartera p
          WHERE ${E('p.empresa_id')} AND p.monto > 0
            AND (SELECT coalesce(sum(m.haber - m.debe), 0) FROM ledger.movimientos m JOIN ledger.asientos a ON a.id = m.asiento_id
                   JOIN ledger.cuentas c ON c.id = m.cuenta_id
                  WHERE c.codigo = '${ESTIMACION}' AND a.empresa_id = p.empresa_id AND a.fecha <= p.fecha) > p.tope`,
    )
    await revisar(
        '13.diferencia_de_cobro_mal_cerrada (una nota por el monto de la diferencia, de la factura del pago; base a 5.3.05 si es interna, a ventas si es NCRE)',
        `WITH x AS (
             SELECT d.*, n.monto AS monto_nota, n.factura_id AS factura_nota, n.subtotal,
                    EXISTS (SELECT 1 FROM fiscal.dte o WHERE o.documento_tipo = 'nota_credito' AND o.documento_id = n.id) AS ncre,
                    (SELECT coalesce(sum(m.debe - m.haber), 0) FROM ledger.asientos a JOIN ledger.movimientos m ON m.asiento_id = a.id
                       JOIN ledger.cuentas c ON c.id = m.cuenta_id
                      WHERE a.origen_tipo = 'nota_credito' AND a.origen_id = n.id AND a.reversa_de IS NULL
                        AND c.codigo = '${DIFERENCIAS}') AS a_diferencias,
                    EXISTS (SELECT 1 FROM billing.pagos_aplicaciones ap WHERE ap.pago_id = d.pago_id AND ap.factura_id = d.factura_id) AS aplicado
               FROM billing.diferencias_cobro d JOIN billing.notas_credito n ON n.id = d.nota_credito_id
              WHERE ${E('d.empresa_id')}
         )
         SELECT id, pago_id, factura_id, nota_credito_id, monto::text, monto_nota::text, ncre, a_diferencias::text, aplicado
           FROM x
          WHERE monto_nota <> monto OR factura_nota <> factura_id OR NOT aplicado
             OR (NOT ncre AND a_diferencias <> subtotal) OR (ncre AND a_diferencias <> 0)`,
    )
    await revisar(
        '13.diferencia_de_cobro_con_pago_anulado (H13 / H18: anular el pago anula la nota sin documento fiscal o, con DTE, devuelve la diferencia con un cargo; nunca las dos, nunca ninguna, nunca con el pago vivo)',
        `SELECT d.id, d.pago_id, d.factura_id, d.nota_credito_id, d.monto::text, p.estado AS estado_pago,
                ${anulada('n')} AS nota_anulada,
                (SELECT count(*) FROM billing.diferencias_cobro_cargos c WHERE c.diferencia_id = d.id)::int AS cargos
           FROM billing.diferencias_cobro d JOIN billing.pagos p ON p.id = d.pago_id
           JOIN billing.notas_credito n ON n.id = d.nota_credito_id
          WHERE ${E('d.empresa_id')}
            AND CASE WHEN p.estado = 'anulado'
                     THEN ${anulada('n')} = EXISTS (SELECT 1 FROM billing.diferencias_cobro_cargos c WHERE c.diferencia_id = d.id)
                     ELSE EXISTS (SELECT 1 FROM billing.diferencias_cobro_cargos c WHERE c.diferencia_id = d.id) END`,
    )
    await revisar(
        '13.cargo_de_diferencia_mal_formado (H18: factura cargo sin IVA ni aviso por el monto de la diferencia, de la factura, cliente y empresa de la nota, ligada al pago anulado; asiento CxC / 5.3.05 por el total y nada más; nunca a la cola FEL)',
        `WITH mov AS (
             SELECT a.origen_id AS factura_id, count(DISTINCT a.id) AS asientos,
                    sum(CASE WHEN c.codigo = '${CXC}' THEN m.debe - m.haber ELSE 0 END) AS cxc,
                    sum(CASE WHEN c.codigo = '${DIFERENCIAS}' THEN m.haber - m.debe ELSE 0 END) AS diferencias,
                    count(*) FILTER (WHERE c.codigo NOT IN ('${CXC}', '${DIFERENCIAS}')) AS ajenos,
                    bool_and(c.codigo <> '${CXC}' OR m.cliente_id IS NOT NULL) AS con_cliente,
                    max(m.cliente_id) AS cliente_id
               FROM ledger.asientos a JOIN ledger.movimientos m ON m.asiento_id = a.id
               JOIN ledger.cuentas c ON c.id = m.cuenta_id
              WHERE a.origen_tipo = 'factura' AND a.reversa_de IS NULL
              GROUP BY 1
         )
         SELECT f.id, f.tipo, f.total::text, f.iva::text, f.aviso_cobro, f.factura_origen_id, c.diferencia_id,
                d.monto::text AS diferencia, mov.cxc::text, mov.diferencias::text, mov.ajenos::int
           FROM billing.facturas f
           LEFT JOIN billing.diferencias_cobro_cargos c ON c.factura_id = f.id
           LEFT JOIN billing.diferencias_cobro d ON d.id = c.diferencia_id
           LEFT JOIN billing.facturas o ON o.id = d.factura_id
           LEFT JOIN billing.pagos p ON p.id = c.pago_id
           LEFT JOIN mov ON mov.factura_id = f.id
          WHERE ${E('f.empresa_id')} AND ${C('f.cliente_id')}
            AND (f.tipo = 'cargo' OR c.id IS NOT NULL)
            AND (f.tipo <> 'cargo' OR c.id IS NULL OR f.iva <> 0 OR f.subtotal <> f.total OR f.aviso_cobro
                 OR f.total <> d.monto OR f.factura_origen_id IS DISTINCT FROM d.factura_id
                 OR f.cliente_id <> o.cliente_id OR f.empresa_id <> o.empresa_id OR c.empresa_id <> f.empresa_id
                 OR c.pago_id <> d.pago_id OR p.estado <> 'anulado'
                 OR EXISTS (SELECT 1 FROM fiscal.dte e WHERE e.documento_id = f.id AND e.documento_tipo IN ('factura', 'nota_debito'))
                 OR mov.factura_id IS NULL OR mov.asientos <> 1 OR mov.cxc <> f.total
                 OR mov.diferencias <> f.total OR mov.ajenos <> 0 OR NOT mov.con_cliente OR mov.cliente_id <> f.cliente_id)`,
    )

    /*
    | 13 · Decisiones del líder sobre la fase 4 (en HALLAZGOS_ABIERTOS hasta que A3 las suba)
    */
    await revisar(
        '5.factura_pagado_sin_castigo (decisión (g): pagado = solo dinero y notas; el castigo se lee de castigos_facturas y nunca suma a pagado)',
        `WITH x AS (
             SELECT f.id, f.estado, f.total, f.pagado,
                    coalesce((SELECT sum(a.monto) FROM billing.pagos_aplicaciones a JOIN billing.pagos p ON p.id = a.pago_id
                               WHERE a.factura_id = f.id AND p.estado = 'registrado'), 0)
                  + coalesce((SELECT sum(n.monto) FROM billing.notas_credito n WHERE n.factura_id = f.id AND NOT ${anulada('n')}), 0)
                  + coalesce((SELECT sum(a.monto) FROM billing.saldos_iniciales_aplicaciones a
                               JOIN billing.saldos_iniciales s ON s.id = a.saldo_inicial_id
                              WHERE a.factura_id = f.id AND s.anulado_en IS NULL), 0) AS cobrado,
                    EXISTS (SELECT 1 FROM ledger.castigos_facturas cf WHERE cf.factura_id = f.id) AS castigada
               FROM billing.facturas f
              WHERE ${E('f.empresa_id')} AND ${C('f.cliente_id')} AND f.estado <> 'anulada'
         )
         SELECT id, estado, total::text, pagado::text, cobrado::text FROM x WHERE castigada AND pagado <> cobrado`,
    )
    await revisar(
        '5.factura_castigada_inconsistente (decisión (g): estado castigada ⇔ castigo; pagado + castigado = total; fuera de cartera y del corte)',
        `SELECT f.id, f.estado, f.total::text, f.pagado::text,
                (SELECT sum(cf.monto) FROM ledger.castigos_facturas cf WHERE cf.factura_id = f.id)::text AS castigado
           FROM billing.facturas f
          WHERE ${E('f.empresa_id')} AND ${C('f.cliente_id')}
            AND ((f.estado = 'castigada') <> EXISTS (SELECT 1 FROM ledger.castigos_facturas cf WHERE cf.factura_id = f.id)
                 OR (f.estado = 'castigada'
                     AND f.pagado + (SELECT sum(cf.monto) FROM ledger.castigos_facturas cf WHERE cf.factura_id = f.id) <> f.total))`,
    )
    // la cuenta de recuperación la agrega A3 al paquete GT; se busca por su nombre
    const [recuperacion] = await filas(
        `SELECT string_agg(codigo, ',') AS codigos FROM ledger.cuentas
          WHERE pais = 'GT' AND nombre ILIKE 'Recuperaci%n de cuentas incobrables%' AND imputable`,
    )
    const cuentasRecuperacion = String(recuperacion?.codigos ?? '')
        .split(',')
        .filter((c) => /^[0-9.]+$/.test(c))
    if (cuentasRecuperacion.length > 0 || opciones.incluirHallazgosAbiertos) {
        const lista =
            cuentasRecuperacion.length > 0 ? cuentasRecuperacion.map((c) => `'${c}'`).join(', ') : "''"
        await revisar(
            '13.recuperacion_de_castigada (decisión (g): lo cobrado después de un castigo es recuperación, nunca aplicación a la factura ni anticipo eterno; recuperado ≤ castigado)',
            `WITH castigado AS (
                 SELECT k.empresa_id, k.cliente_id, sum(k.monto) AS monto, min(k.created_at) AS desde
                   FROM ledger.castigos k WHERE ${E('k.empresa_id')} GROUP BY 1, 2
             ), recuperado AS (
                 -- H17: base (4.2.03, con el cliente) + IVA (2.1.11, sin cliente) de los pagos vigentes; el
                 -- documento y el libro se cruzan en 13.recuperacion_mal_contabilizada
                 SELECT a.empresa_id, p.cliente_id, sum(m.haber - m.debe) AS monto
                   FROM ledger.movimientos m JOIN ledger.asientos a ON a.id = m.asiento_id
                   JOIN ledger.cuentas c ON c.id = m.cuenta_id
                   JOIN billing.pagos p ON a.origen_tipo = 'pago' AND p.id = a.origen_id
                  WHERE (c.codigo IN (${lista}) OR (c.codigo = '${IVA_TRANSICION}'))
                    AND ${E('a.empresa_id')}
                  GROUP BY 1, 2
             ), anticipo AS (
                 SELECT a.empresa_id, m.cliente_id, sum(m.haber - m.debe) AS saldo
                   FROM ledger.movimientos m JOIN ledger.asientos a ON a.id = m.asiento_id
                   JOIN ledger.cuentas c ON c.id = m.cuenta_id
                  WHERE c.codigo = '${ANTICIPOS}' AND ${E('a.empresa_id')}
                  GROUP BY 1, 2
             )
             SELECT k.empresa_id, k.cliente_id, k.monto::text AS castigado, coalesce(r.monto, 0)::text AS recuperado,
                    coalesce(an.saldo, 0)::text AS anticipo,
                    (SELECT count(*) FROM billing.pagos_aplicaciones ap JOIN ledger.castigos_facturas cf ON cf.factura_id = ap.factura_id
                       JOIN ledger.castigos kk ON kk.id = cf.castigo_id
                      WHERE kk.cliente_id = k.cliente_id AND kk.empresa_id = k.empresa_id AND ap.created_at > kk.created_at)::int AS aplicaciones_posteriores
               FROM castigado k
               LEFT JOIN recuperado r ON r.empresa_id = k.empresa_id AND r.cliente_id = k.cliente_id
               LEFT JOIN anticipo an ON an.empresa_id = k.empresa_id AND an.cliente_id = k.cliente_id
              WHERE coalesce(r.monto, 0) > k.monto OR coalesce(r.monto, 0) < 0
                 -- con algo por recuperar, el dinero del cliente no se queda como anticipo
                 OR (coalesce(r.monto, 0) < k.monto AND coalesce(an.saldo, 0) > 0
                     AND NOT EXISTS (SELECT 1 FROM billing.facturas f WHERE f.empresa_id = k.empresa_id
                                      AND f.cliente_id = k.cliente_id AND f.estado IN ${ESTADOS_PENDIENTES}))
                 OR EXISTS (SELECT 1 FROM billing.pagos_aplicaciones ap JOIN ledger.castigos_facturas cf ON cf.factura_id = ap.factura_id
                              JOIN ledger.castigos kk ON kk.id = cf.castigo_id
                             WHERE kk.cliente_id = k.cliente_id AND kk.empresa_id = k.empresa_id AND ap.created_at > kk.created_at)`,
        )
    }
    const RECUPERACION = CUENTAS_GT.RECUPERACION_INCOBRABLES
    await revisar(
        '13.recuperacion_mal_contabilizada (H17: el asiento del pago lleva Haber 4.2.03 = Σ base, con su cliente, y Haber 2.1.11 = Σ IVA de sus recuperaciones; 4.2.03 solo en pagos; castigo, pago, cliente y empresa coinciden)',
        `WITH doc AS (
             SELECT pago_id, sum(base) AS base, sum(iva) AS iva FROM ledger.recuperaciones_castigo GROUP BY 1
         ), libro AS (
             SELECT a.origen_id AS pago_id,
                    sum(CASE WHEN c.codigo = '${RECUPERACION}' THEN m.haber - m.debe ELSE 0 END) AS base,
                    sum(CASE WHEN c.codigo = '${IVA_TRANSICION}' THEN m.haber - m.debe ELSE 0 END) AS iva,
                    bool_and(c.codigo <> '${RECUPERACION}' OR m.cliente_id IS NOT NULL) AS con_cliente,
                    max(CASE WHEN c.codigo = '${RECUPERACION}' THEN m.cliente_id END) AS cliente_id,
                    min(CASE WHEN c.codigo = '${RECUPERACION}' THEN m.cliente_id END) AS cliente_min
               FROM ledger.asientos a JOIN ledger.movimientos m ON m.asiento_id = a.id
               JOIN ledger.cuentas c ON c.id = m.cuenta_id
              WHERE a.origen_tipo = 'pago' AND a.reversa_de IS NULL AND ${E('a.empresa_id')}
                AND c.codigo IN ('${RECUPERACION}', '${IVA_TRANSICION}')
              GROUP BY 1
         )
         SELECT 'pago' AS que, coalesce(doc.pago_id, libro.pago_id) AS id, doc.base::text, doc.iva::text,
                libro.base::text AS base_libro, libro.iva::text AS iva_libro
           FROM doc FULL JOIN libro ON libro.pago_id = doc.pago_id
           LEFT JOIN billing.pagos p ON p.id = coalesce(doc.pago_id, libro.pago_id)
          WHERE ${E('p.empresa_id')}
            AND (coalesce(doc.base, 0) <> coalesce(libro.base, 0) OR coalesce(doc.iva, 0) <> coalesce(libro.iva, 0)
                 OR NOT coalesce(libro.con_cliente, true)
                 OR libro.cliente_id <> p.cliente_id OR libro.cliente_min <> p.cliente_id)
         UNION ALL
         SELECT 'fila', rc.id, rc.base::text, rc.iva::text, NULL, NULL
           FROM ledger.recuperaciones_castigo rc JOIN ledger.castigos k ON k.id = rc.castigo_id
           JOIN billing.pagos p ON p.id = rc.pago_id
          WHERE ${E('rc.empresa_id')}
            AND (rc.empresa_id <> k.empresa_id OR rc.empresa_id <> p.empresa_id OR k.cliente_id <> p.cliente_id
                 OR rc.base + rc.iva <> rc.monto OR rc.monto <= 0)
         UNION ALL
         SELECT 'asiento_ajeno', a.id, (m.haber - m.debe)::text, NULL, a.origen_tipo, NULL
           FROM ledger.movimientos m JOIN ledger.asientos a ON a.id = m.asiento_id
           JOIN ledger.cuentas c ON c.id = m.cuenta_id
          WHERE c.codigo = '${RECUPERACION}' AND a.origen_tipo <> 'pago' AND ${E('a.empresa_id')}`,
    )
    await revisar(
        '13.recuperacion_mal_repartida (H17: el castigo más antiguo primero; IVA de cada parte = redondeo(Σ recuperado vigente × IVA / monto del castigo) − IVA ya recuperado; Σ vigente ≤ castigado; recuperado todo, Σ IVA = IVA del castigo al centavo)',
        `WITH r AS (
             SELECT rc.*, k.monto AS k_monto, k.iva AS k_iva, k.empresa_id AS k_empresa, k.cliente_id AS k_cliente,
                    -- lo vigente del mismo castigo al insertar la fila (pagos anteriores no anulados todavía)
                    coalesce((SELECT sum(o.monto) FROM ledger.recuperaciones_castigo o JOIN billing.pagos op ON op.id = o.pago_id
                               WHERE o.castigo_id = rc.castigo_id AND o.id < rc.id
                                 AND (op.anulado_en IS NULL OR op.anulado_en > rc.created_at)), 0) AS previo,
                    coalesce((SELECT sum(o.iva) FROM ledger.recuperaciones_castigo o JOIN billing.pagos op ON op.id = o.pago_id
                               WHERE o.castigo_id = rc.castigo_id AND o.id < rc.id
                                 AND (op.anulado_en IS NULL OR op.anulado_en > rc.created_at)), 0) AS iva_previo
               FROM ledger.recuperaciones_castigo rc JOIN ledger.castigos k ON k.id = rc.castigo_id
              WHERE ${E('rc.empresa_id')}
         ), fila AS (
             SELECT r.*, least(r.monto, greatest(0, round((r.previo + r.monto) * r.k_iva / r.k_monto, 2) - r.iva_previo)) AS iva_esperado
               FROM r
         ), vig AS (
             SELECT k.id, k.monto, k.iva, coalesce(sum(rc.monto), 0) AS monto_rec, coalesce(sum(rc.iva), 0) AS iva_rec
               FROM ledger.castigos k
               LEFT JOIN ledger.recuperaciones_castigo rc ON rc.castigo_id = k.id
                    AND EXISTS (SELECT 1 FROM billing.pagos p WHERE p.id = rc.pago_id AND p.estado = 'registrado')
              WHERE ${E('k.empresa_id')}
              GROUP BY k.id
         )
         SELECT 'fila' AS que, id, castigo_id, monto::text, iva::text, iva_esperado::text AS esperado, previo::text
           FROM fila
          WHERE iva <> iva_esperado OR previo + monto > k_monto
             -- el más antiguo primero: al insertar, ningún castigo anterior del cliente tenía saldo por recuperar
             OR EXISTS (SELECT 1 FROM ledger.castigos k2
                         WHERE k2.empresa_id = fila.k_empresa AND k2.cliente_id = fila.k_cliente AND k2.id < fila.castigo_id
                           AND k2.created_at <= fila.created_at
                           AND k2.monto > coalesce((SELECT sum(o.monto) FROM ledger.recuperaciones_castigo o
                                                      JOIN billing.pagos op ON op.id = o.pago_id
                                                     WHERE o.castigo_id = k2.id AND o.created_at <= fila.created_at
                                                       AND (op.anulado_en IS NULL OR op.anulado_en > fila.created_at)), 0))
         UNION ALL
         SELECT 'castigo', id, id, monto_rec::text, iva_rec::text, iva::text, monto::text
           FROM vig
          WHERE monto_rec > monto OR iva_rec > iva OR (monto_rec - iva_rec) > (monto - iva)
             OR (monto_rec = monto AND iva_rec <> iva)`,
    )
    await revisar(
        '13.llegada_reatribuida (decisión (c): a lo sumo una llegada viva por documento y por línea; la reatribuida tiene su reverso espejo)',
        `WITH llegadas AS (
             SELECT a.id, a.origen_tipo AS tipo, a.origen_id AS documento_id,
                    NOT EXISTS (SELECT 1 FROM ledger.asientos r WHERE r.reversa_de = a.id) AS viva,
                    (SELECT count(*) FROM ledger.asientos r WHERE r.reversa_de = a.id) AS reversos
               FROM ledger.asientos a JOIN ledger.movimientos m ON m.asiento_id = a.id
               JOIN ledger.cuentas c ON c.id = m.cuenta_id
              WHERE a.origen_tipo IN ('deposito', 'traslado') AND a.reversa_de IS NULL AND ${E('a.empresa_id')}
                AND c.codigo = '${TRANSITO}' AND m.haber > 0
         )
         SELECT 'documento' AS que, tipo || ' ' || documento_id AS id, count(*) FILTER (WHERE viva)::int AS vivas,
                max(reversos)::int AS reversos
           FROM llegadas GROUP BY tipo, documento_id
         HAVING count(*) FILTER (WHERE viva) > 1 OR max(reversos) > 1
         UNION ALL
         SELECT 'linea', x.linea_id::text, count(*)::int, 0
           FROM ledger.transitos_acreditados x
          WHERE ${E('x.empresa_id')} AND ${llegadaViva('x.tipo', 'x.documento_id')}
          GROUP BY x.linea_id HAVING count(*) > 1`,
    )
    await revisar(
        '13.diferencia_sin_documento_rebaja_iva (decisión (f): sin NCRE, la nota de la diferencia no toca 2.1.02; todo a 5.3.05 o, en un aviso, el IVA a 2.1.11)',
        `SELECT d.id, d.nota_credito_id, d.factura_id,
                (SELECT coalesce(sum(m.debe - m.haber), 0) FROM ledger.asientos a JOIN ledger.movimientos m ON m.asiento_id = a.id
                   JOIN ledger.cuentas c ON c.id = m.cuenta_id
                  WHERE a.origen_tipo = 'nota_credito' AND a.origen_id = d.nota_credito_id AND c.codigo = '${IVA}')::text AS iva_debito
           FROM billing.diferencias_cobro d
          WHERE ${E('d.empresa_id')}
            AND NOT EXISTS (SELECT 1 FROM fiscal.dte o WHERE o.documento_tipo = 'nota_credito' AND o.documento_id = d.nota_credito_id)
            AND (SELECT coalesce(sum(m.debe - m.haber), 0) FROM ledger.asientos a JOIN ledger.movimientos m ON m.asiento_id = a.id
                   JOIN ledger.cuentas c ON c.id = m.cuenta_id
                  WHERE a.origen_tipo = 'nota_credito' AND a.origen_id = d.nota_credito_id AND c.codigo = '${IVA}') <> 0`,
    )

    /*
    | 15 · Compras, proveedores, retenciones, activos y diferidos (fase 5; contrato §3.4, §3.5, §10.10
    | y §19). Los de A3 (antes en `tests/ledger/verificar_compras.ts`, revisados por el auditor) más los del
    | auditor: el cálculo exacto de cada cuota, el alta y la baja de activos, el documento de la
    | compra y el libro de compras con SQL propio (sin la función del producto).
    */
    const PROVEEDORES = CUENTAS_GT.PROVEEDORES
    const IVA_CREDITO = CUENTAS_GT.IVA_CREDITO
    const RET_IVA_POR_PAGAR = CUENTAS_GT.RETENCIONES_IVA_POR_PAGAR
    const RET_ISR_POR_PAGAR = CUENTAS_GT.RETENCIONES_ISR_POR_PAGAR
    const compraAnulada = (c: string) =>
        `EXISTS (SELECT 1 FROM ledger.compras_anulaciones xa WHERE xa.compra_id = ${c}.id)`
    const pagoProveedorVivo = (pago: string) =>
        `NOT EXISTS (SELECT 1 FROM ledger.pagos_proveedores_anulaciones xp WHERE xp.pago_id = ${pago})`
    const signoCompra = (c: string) => `(CASE WHEN ${c}.tipo_documento = 'NCRE' THEN -1 ELSE 1 END)`
    /** saldo pendiente de la compra `c` al crédito: neto − NCRE vigentes − pagos vigentes (0 si no es pagable) */
    const SALDO_COMPRA = `(CASE WHEN c.condicion <> 'credito' OR c.tipo_documento = 'NCRE' OR ${compraAnulada('c')} THEN 0
                       ELSE c.total - c.retencion_iva - c.retencion_isr
                            - coalesce((SELECT sum(n.total) FROM ledger.compras n WHERE n.compra_referencia_id = c.id
                                         AND n.tipo_documento = 'NCRE' AND NOT ${compraAnulada('n')}), 0)
                            - coalesce((SELECT sum(ap.monto) FROM ledger.pagos_proveedores_aplicaciones ap
                                         WHERE ap.compra_id = c.id AND ${pagoProveedorVivo('ap.pago_id')}), 0)
                  END)`
    await revisar(
        '15.auxiliar_sin_proveedor (2.1.03 sin proveedor_id o con un proveedor de otra empresa)',
        `SELECT m.id, m.asiento_id, c.codigo, m.proveedor_id
           FROM ledger.movimientos m JOIN ledger.cuentas c ON c.id = m.cuenta_id
           JOIN ledger.asientos a ON a.id = m.asiento_id
           LEFT JOIN ledger.proveedores p ON p.id = m.proveedor_id
          WHERE ${E('a.empresa_id')}
            AND ((c.auxiliar_proveedor AND m.proveedor_id IS NULL)
                 OR (m.proveedor_id IS NOT NULL AND (p.empresa_id <> a.empresa_id OR NOT c.auxiliar_proveedor)))`,
    )
    await revisar(
        '15.cxp_distinta_de_compras_pendientes (2.1.03 por empresa y proveedor = Σ saldo de sus compras al crédito)',
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
        '15.compra_con_saldo_fuera_de_rango (0 ≤ saldo ≤ neto; Σ aplicaciones = monto del pago; solo a compras al crédito vigentes)',
        `SELECT 'compra' AS que, c.id, (${SALDO_COMPRA})::text AS saldo, (c.total - c.retencion_iva - c.retencion_isr)::text AS neto
           FROM ledger.compras c WHERE ${E('c.empresa_id')}
            AND ((${SALDO_COMPRA}) < 0 OR (${SALDO_COMPRA}) > c.total - c.retencion_iva - c.retencion_isr)
         UNION ALL
         SELECT 'pago', pp.id, coalesce(sum(ap.monto), 0)::text, pp.monto::text FROM ledger.pagos_proveedores pp
           LEFT JOIN ledger.pagos_proveedores_aplicaciones ap ON ap.pago_id = pp.id
          WHERE ${E('pp.empresa_id')} GROUP BY pp.id, pp.monto HAVING coalesce(sum(ap.monto), 0) <> pp.monto
         UNION ALL
         SELECT 'aplicacion', ap.id, ap.monto::text, c.condicion || ' ' || c.tipo_documento
           FROM ledger.pagos_proveedores_aplicaciones ap JOIN ledger.compras c ON c.id = ap.compra_id
           JOIN ledger.pagos_proveedores pp ON pp.id = ap.pago_id
          WHERE ${E('c.empresa_id')}
            AND (c.condicion <> 'credito' OR c.tipo_documento = 'NCRE' OR c.proveedor_id <> pp.proveedor_id
                 OR c.empresa_id <> pp.empresa_id OR (${compraAnulada('c')} AND ${pagoProveedorVivo('pp.id')}))`,
    )
    await revisar(
        '15.compra_mal_contabilizada (un asiento con la fecha de la compra: IVA crédito con su etiqueta, retenciones y contrapartida por el neto; al contado su egreso por el neto; desde un egreso, el egreso vigente por el neto y su cuenta)',
        `WITH mov AS (
             SELECT a.origen_id AS compra_id, count(DISTINCT a.id) AS asientos, min(a.fecha) AS fecha,
                    sum(CASE WHEN c.codigo = '${IVA_CREDITO}' THEN m.debe - m.haber ELSE 0 END) AS iva,
                    sum(CASE WHEN c.codigo = '${RET_IVA_POR_PAGAR}' THEN m.haber - m.debe ELSE 0 END) AS ret_iva,
                    sum(CASE WHEN c.codigo = '${RET_ISR_POR_PAGAR}' THEN m.haber - m.debe ELSE 0 END) AS ret_isr,
                    sum(CASE WHEN c.codigo = '${PROVEEDORES}' THEN m.haber - m.debe ELSE 0 END) AS cxp,
                    bool_and(c.codigo <> '${PROVEEDORES}' OR m.proveedor_id = co.proveedor_id) AS proveedor_ok,
                    sum(CASE WHEN ${CAJA_O_BANCO('c.codigo')} THEN m.haber - m.debe ELSE 0 END) AS dinero,
                    sum(CASE WHEN m.cuadricula LIKE '_C_IVA' THEN (CASE WHEN m.cuadricula LIKE '+%' THEN 1 ELSE -1 END) * (m.debe + m.haber) ELSE 0 END) AS etiqueta_iva
               FROM ledger.asientos a JOIN ledger.compras co ON co.id = a.origen_id
               JOIN ledger.movimientos m ON m.asiento_id = a.id
               JOIN ledger.cuentas c ON c.id = m.cuenta_id
              WHERE a.origen_tipo = 'compra' AND a.reversa_de IS NULL AND ${E('a.empresa_id')}
              GROUP BY 1
         )
         SELECT co.id, co.tipo_documento, co.condicion, co.iva::text, co.credito_fiscal, mov.iva::text AS iva_libro,
                mov.ret_iva::text, mov.ret_isr::text, mov.cxp::text, mov.dinero::text, mov.etiqueta_iva::text, mov.asientos,
                to_char(mov.fecha, 'YYYY-MM-DD') AS fecha_asiento, to_char(co.fecha, 'YYYY-MM-DD') AS fecha
           FROM ledger.compras co LEFT JOIN mov ON mov.compra_id = co.id
           LEFT JOIN ledger.egresos eg ON eg.compra_id = co.id
           LEFT JOIN ledger.egresos ee ON ee.id = co.egreso_id
          WHERE ${E('co.empresa_id')}
            AND (mov.compra_id IS NULL OR mov.asientos <> 1 OR NOT mov.proveedor_ok OR mov.fecha <> co.fecha
                 OR mov.iva <> (CASE WHEN co.credito_fiscal THEN co.iva ELSE 0 END) * ${signoCompra('co')}
                 OR mov.etiqueta_iva <> (CASE WHEN co.credito_fiscal THEN co.iva ELSE 0 END) * ${signoCompra('co')}
                 OR mov.ret_iva <> co.retencion_iva OR mov.ret_isr <> co.retencion_isr
                 OR mov.cxp <> (CASE WHEN co.condicion = 'credito' THEN (co.total - co.retencion_iva - co.retencion_isr)
                                     * ${signoCompra('co')} ELSE 0 END)
                 OR mov.dinero <> (CASE WHEN co.condicion = 'contado' AND co.egreso_id IS NULL
                                        THEN co.total - co.retencion_iva - co.retencion_isr ELSE 0 END)
                 OR (co.condicion = 'contado' AND co.egreso_id IS NULL
                     AND (eg.id IS NULL OR eg.monto <> co.total - co.retencion_iva - co.retencion_isr
                          OR eg.empresa_id <> co.empresa_id))
                 OR (co.condicion = 'credito' AND (eg.id IS NOT NULL OR co.egreso_id IS NOT NULL))
                 -- desde un egreso (§3.4 punto 3): el egreso pagó el neto, sigue vigente mientras la compra lo esté
                 -- y la reclasificación abona su cuenta por el neto
                 OR (co.egreso_id IS NOT NULL
                     AND (co.condicion <> 'contado' OR eg.id IS NOT NULL
                          OR ee.monto <> co.total - co.retencion_iva - co.retencion_isr
                          OR (NOT ${compraAnulada('co')}
                              AND EXISTS (SELECT 1 FROM ledger.egresos_anulaciones x WHERE x.egreso_id = ee.id))
                          OR (SELECT coalesce(sum(m.haber), 0) FROM ledger.asientos a
                                JOIN ledger.movimientos m ON m.asiento_id = a.id
                                JOIN ledger.egresos_categorias ec ON ec.id = ee.categoria_id AND ec.cuenta_id = m.cuenta_id
                               WHERE a.origen_tipo = 'compra' AND a.origen_id = co.id AND a.reversa_de IS NULL)
                             <> co.total - co.retencion_iva - co.retencion_isr)))`,
    )
    await revisar(
        '15.compra_distinta_de_su_documento (total = Σ líneas; IVA = Σ IVA de líneas; retención por impuesto = Σ de compras_retenciones; constancia emitida = su retención)',
        `WITH lin AS (
             SELECT compra_id, sum(base + iva) AS total, sum(iva) AS iva, sum(base) FILTER (WHERE exento) AS exento
               FROM ledger.compras_lineas GROUP BY 1
         ), ret AS (
             SELECT compra_id, coalesce(sum(monto) FILTER (WHERE impuesto = 'iva'), 0) AS iva,
                    coalesce(sum(monto) FILTER (WHERE impuesto = 'isr'), 0) AS isr
               FROM ledger.compras_retenciones GROUP BY 1
         )
         SELECT 'compra' AS que, co.id, co.total::text, lin.total::text AS lineas, co.iva::text, lin.iva::text AS iva_lineas,
                co.retencion_iva::text, coalesce(ret.iva, 0)::text AS ret_iva, co.retencion_isr::text, coalesce(ret.isr, 0)::text AS ret_isr
           FROM ledger.compras co LEFT JOIN lin ON lin.compra_id = co.id LEFT JOIN ret ON ret.compra_id = co.id
          WHERE ${E('co.empresa_id')}
            AND (lin.compra_id IS NULL OR lin.total <> co.total OR lin.iva <> co.iva OR coalesce(lin.exento, 0) <> co.exento
                 OR co.retencion_iva <> coalesce(ret.iva, 0) OR co.retencion_isr <> coalesce(ret.isr, 0))
         UNION ALL
         SELECT 'constancia', k.id, k.monto::text, r.monto::text, k.impuesto, r.impuesto, k.impuesto_codigo, r.impuesto_codigo, NULL, NULL
           FROM ledger.constancias_retencion k
           LEFT JOIN ledger.compras_retenciones r ON r.compra_id = k.compra_id AND r.impuesto_codigo = k.impuesto_codigo
          WHERE ${E('k.empresa_id')} AND k.direccion = 'emitida'
            AND (r.id IS NULL OR r.monto <> k.monto OR r.impuesto <> k.impuesto)`,
    )
    await revisar(
        '15.compra_anulada_mal (reverso espejo del asiento de la compra y, al contado, su egreso anulado con ese reverso)',
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
        '15.reverso_de_compra_sin_sus_etiquetas (desvío c: el reverso de una compra copia cada etiqueta de impuesto con el signo contrario, para que el libro reste la anulación)',
        `WITH et AS (
             SELECT a.id AS asiento_id, coalesce(a.reversa_de, a.id) AS original, a.reversa_de IS NOT NULL AS es_reverso,
                    substr(m.cuadricula, 2) AS etiqueta,
                    sum(CASE WHEN left(m.cuadricula, 1) = '+' THEN 1 ELSE -1 END * (m.debe + m.haber)) AS valor
               FROM ledger.asientos a JOIN ledger.movimientos m ON m.asiento_id = a.id
              WHERE a.origen_tipo = 'compra' AND m.cuadricula IS NOT NULL AND ${E('a.empresa_id')}
              GROUP BY 1, 2, 3, 4
         ), r AS (
             SELECT r.id, r.reversa_de FROM ledger.asientos r
              WHERE r.origen_tipo = 'compra' AND r.reversa_de IS NOT NULL AND ${E('r.empresa_id')}
         )
         , pares AS (
             SELECT r.id, r.reversa_de, e.etiqueta FROM r JOIN et e ON e.asiento_id IN (r.id, r.reversa_de)
              GROUP BY 1, 2, 3
         )
         SELECT p.id AS reverso, p.reversa_de AS original, p.etiqueta,
                o.valor::text AS original_valor, x.valor::text AS reverso_valor
           FROM pares p
           LEFT JOIN et o ON o.asiento_id = p.reversa_de AND o.etiqueta = p.etiqueta
           LEFT JOIN et x ON x.asiento_id = p.id AND x.etiqueta = p.etiqueta
          WHERE coalesce(x.valor, 0) <> -coalesce(o.valor, 0)`,
    )
    await revisar(
        '15.egreso_de_compra_con_asiento_propio (el pago al contado no genera otro asiento)',
        `SELECT e.id, e.compra_id FROM ledger.egresos e
          WHERE ${E('e.empresa_id')} AND e.compra_id IS NOT NULL
            AND EXISTS (SELECT 1 FROM ledger.asientos a WHERE a.origen_tipo = 'egreso' AND a.origen_id = e.id)`,
    )
    await revisar(
        '15.retenciones_por_pagar_distintas (2.1.04 = Σ retención de IVA, 2.1.05 = Σ retención de ISR de las compras vigentes)',
        `WITH docs AS (
             SELECT c.empresa_id, sum(c.retencion_iva) AS iva, sum(c.retencion_isr) AS isr
               FROM ledger.compras c WHERE ${E('c.empresa_id')} AND NOT ${compraAnulada('c')}
              GROUP BY 1
         ), libro AS (
             SELECT a.empresa_id,
                    sum(CASE WHEN c.codigo = '${RET_IVA_POR_PAGAR}' THEN m.haber - m.debe ELSE 0 END) AS iva,
                    sum(CASE WHEN c.codigo = '${RET_ISR_POR_PAGAR}' THEN m.haber - m.debe ELSE 0 END) AS isr
               FROM ledger.movimientos m JOIN ledger.asientos a ON a.id = m.asiento_id
               JOIN ledger.cuentas c ON c.id = m.cuenta_id
              WHERE ${E('a.empresa_id')} AND c.codigo IN ('${RET_IVA_POR_PAGAR}', '${RET_ISR_POR_PAGAR}')
              GROUP BY 1
         )
         SELECT coalesce(d.empresa_id, l.empresa_id) AS empresa_id, coalesce(d.iva, 0)::text AS docs_iva,
                coalesce(l.iva, 0)::text AS libro_iva, coalesce(d.isr, 0)::text AS docs_isr, coalesce(l.isr, 0)::text AS libro_isr
           FROM docs d FULL JOIN libro l ON l.empresa_id = d.empresa_id
          WHERE coalesce(d.iva, 0) <> coalesce(l.iva, 0) OR coalesce(d.isr, 0) <> coalesce(l.isr, 0)`,
    )
    await revisar(
        '15.pago_proveedor_mal_contabilizado (2.1.03 debe = monto con su proveedor; la cuenta de su caja, banco o cuenta bancaria haber = monto; fecha del pago; anulado = reverso)',
        `WITH mov AS (
             SELECT a.origen_id AS pago_id, min(a.fecha) AS fecha,
                    sum(CASE WHEN c.codigo = '${PROVEEDORES}' AND m.proveedor_id = pp.proveedor_id THEN m.debe - m.haber ELSE 0 END) AS cxp,
                    sum(CASE WHEN m.cuenta_id = pp.cuenta_id THEN m.haber - m.debe ELSE 0 END) AS dinero,
                    count(*) AS lineas,
                    bool_or(EXISTS (SELECT 1 FROM ledger.asientos r WHERE r.reversa_de = a.id)) AS revertido
               FROM ledger.asientos a JOIN ledger.pagos_proveedores pp ON pp.id = a.origen_id
               JOIN ledger.movimientos m ON m.asiento_id = a.id JOIN ledger.cuentas c ON c.id = m.cuenta_id
              WHERE a.origen_tipo = 'pago_proveedor' AND a.reversa_de IS NULL
              GROUP BY 1
         )
         SELECT pp.id, pp.metodo, pp.monto::text, mov.cxp::text, mov.dinero::text, mov.lineas, mov.revertido,
                NOT ${pagoProveedorVivo('pp.id')} AS anulado
           FROM ledger.pagos_proveedores pp LEFT JOIN mov ON mov.pago_id = pp.id
           LEFT JOIN ledger.cajas cj ON cj.id = pp.caja_id
           LEFT JOIN ledger.cajas_turnos t ON t.id = pp.turno_id
           LEFT JOIN ledger.bancos b ON b.id = pp.banco_id
           LEFT JOIN billing.cuentas_bancarias cb ON cb.id = pp.cuenta_bancaria_id
          WHERE ${E('pp.empresa_id')}
            AND (mov.pago_id IS NULL OR mov.cxp <> pp.monto OR mov.dinero <> pp.monto OR mov.lineas <> 2
                 OR mov.fecha <> pp.fecha
                 OR mov.revertido = ${pagoProveedorVivo('pp.id')}
                 OR pp.cuenta_id IS DISTINCT FROM coalesce(cj.cuenta_id, b.cuenta_id, cb.cuenta_id)
                 OR coalesce(cj.empresa_id, cb.empresa_id, pp.empresa_id) <> pp.empresa_id
                 OR (pp.turno_id IS NOT NULL AND t.caja_id IS DISTINCT FROM pp.caja_id))`,
    )
    await revisar(
        '15.retenciones_recibidas_distintas (1.1.05 y 1.1.06 = Σ constancias recibidas de pagos vigentes, por impuesto)',
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
              WHERE ${E('a.empresa_id')}
                AND c.codigo IN ('${CUENTAS_GT.IVA_RETENIDO_CLIENTES}', '${CUENTAS_GT.ISR_RETENIDO_CLIENTES}')
              GROUP BY 1
         )
         SELECT coalesce(d.empresa_id, l.empresa_id) AS empresa_id, coalesce(d.iva, 0)::text AS docs_iva,
                coalesce(l.iva, 0)::text AS libro_iva, coalesce(d.isr, 0)::text AS docs_isr, coalesce(l.isr, 0)::text AS libro_isr
           FROM docs d FULL JOIN libro l ON l.empresa_id = d.empresa_id
          WHERE coalesce(d.iva, 0) <> coalesce(l.iva, 0) OR coalesce(d.isr, 0) <> coalesce(l.isr, 0)`,
    )
    await revisar(
        '15.libro_compras_distinto_de_1.1.04 (desvío c: por empresa y mes, Σ IVA con crédito de las compras por periodo_iva − anulaciones en el mes de su reverso = movimiento de 1.1.04; 1.1.04 solo lo mueven compras)',
        `WITH docs AS (
             SELECT empresa_id, mes, sum(monto) AS monto FROM (
                 SELECT c.empresa_id, to_char(c.periodo_iva, 'YYYY-MM') AS mes, c.iva * ${signoCompra('c')} AS monto
                   FROM ledger.compras c WHERE c.credito_fiscal AND ${E('c.empresa_id')}
                 UNION ALL
                 SELECT c.empresa_id, to_char(a.fecha, 'YYYY-MM'), -c.iva * ${signoCompra('c')}
                   FROM ledger.compras c JOIN ledger.compras_anulaciones x ON x.compra_id = c.id
                   JOIN ledger.asientos a ON a.id = x.asiento_id
                  WHERE c.credito_fiscal AND ${E('c.empresa_id')}
             ) d GROUP BY 1, 2
         ), libro AS (
             SELECT a.empresa_id, to_char(a.fecha, 'YYYY-MM') AS mes, sum(m.debe - m.haber) AS monto
               FROM ledger.movimientos m JOIN ledger.asientos a ON a.id = m.asiento_id
               JOIN ledger.cuentas c ON c.id = m.cuenta_id
              WHERE c.codigo = '${IVA_CREDITO}' AND a.origen_tipo = 'compra' AND ${E('a.empresa_id')}
              GROUP BY 1, 2
         )
         SELECT coalesce(d.empresa_id, l.empresa_id) AS empresa_id, coalesce(d.mes, l.mes) AS mes,
                coalesce(d.monto, 0)::text AS libro_compras, coalesce(l.monto, 0)::text AS cuenta, NULL AS origen
           FROM docs d FULL JOIN libro l ON l.empresa_id = d.empresa_id AND l.mes = d.mes
          WHERE coalesce(d.monto, 0) <> coalesce(l.monto, 0)
         UNION ALL
         SELECT a.empresa_id, to_char(a.fecha, 'YYYY-MM'), NULL, (m.debe - m.haber)::text, a.origen_tipo
           FROM ledger.movimientos m JOIN ledger.asientos a ON a.id = m.asiento_id
           JOIN ledger.cuentas c ON c.id = m.cuenta_id
          WHERE c.codigo = '${IVA_CREDITO}' AND a.origen_tipo <> 'compra' AND ${E('a.empresa_id')}`,
    )
    await revisar(
        '15.activo_depreciado_de_mas (inicial + Σ cuotas ≤ costo − residual; una cuota por activo y mes)',
        `SELECT ac.id, ac.costo::text, ac.valor_residual::text, coalesce(sum(q.monto), 0)::text AS depreciado
           FROM ledger.activos ac LEFT JOIN ledger.activos_cuotas q ON q.activo_id = ac.id
          WHERE ${E('ac.empresa_id')}
          GROUP BY ac.id, ac.costo, ac.valor_residual, ac.depreciacion_inicial
         HAVING ac.depreciacion_inicial + coalesce(sum(q.monto), 0) > ac.costo - ac.valor_residual
             OR count(q.id) <> count(DISTINCT q.mes)`,
    )
    await revisar(
        '15.cuota_de_depreciacion_mal_calculada (lineal: cuota = redondeo((costo − residual) × tasa / 1200), la última completa lo depreciable; meses seguidos desde el inicio y terminados)',
        `WITH q AS (
             SELECT q.*, ac.costo, ac.valor_residual, ac.depreciacion_inicial, ac.inicio_depreciacion, ac.empresa_id,
                    round((ac.costo - ac.valor_residual) * ac.tasa_anual::numeric / 1200, 2) AS cuota,
                    row_number() OVER (PARTITION BY q.activo_id ORDER BY q.mes) AS n,
                    ac.depreciacion_inicial + coalesce(sum(q.monto) OVER (PARTITION BY q.activo_id ORDER BY q.mes
                        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS previo
               FROM ledger.activos_cuotas q JOIN ledger.activos ac ON ac.id = q.activo_id
              WHERE ${E('ac.empresa_id')}
         ), x AS (
             SELECT q.*, costo - valor_residual - previo AS restante FROM q
         )
         SELECT x.id, x.activo_id, to_char(x.mes, 'YYYY-MM') AS mes, x.n::int, x.monto::text, x.cuota::text, x.restante::text
           FROM x
          WHERE x.monto <> CASE WHEN x.cuota > 0 AND x.cuota < x.restante THEN x.cuota ELSE x.restante END
             OR x.mes <> (x.inicio_depreciacion + make_interval(months => (x.n - 1)::int))::date
             OR x.mes >= date_trunc('month', x.created_at AT TIME ZONE 'America/Guatemala')::date`,
    )
    await revisar(
        '15.cuota_posterior_a_la_baja (H20: el mes de la baja y los siguientes no se deprecian; la baja cancela solo la depreciación hasta el mes anterior)',
        `SELECT q.id, q.activo_id, to_char(q.mes, 'YYYY-MM') AS mes, q.monto::text, to_char(b.fecha, 'YYYY-MM-DD') AS baja
           FROM ledger.activos_cuotas q JOIN ledger.activos_bajas b ON b.activo_id = q.activo_id AND b.tipo <> 'anulacion'
           JOIN ledger.activos ac ON ac.id = q.activo_id
          WHERE ${E('ac.empresa_id')} AND q.mes >= date_trunc('month', b.fecha)::date`,
    )
    await revisar(
        '15.depreciacion_acumulada_distinta (1.2.02.NN = inicial + Σ cuotas de los activos vivos de su clase)',
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
        '15.costo_de_activos_distinto (1.2.01.NN = Σ costo de los activos vivos de su clase)',
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
        '15.cuota_de_depreciacion_mal_contabilizada (asiento depreciacion del activo: gasto debe = cuota, 1.2.02 haber = cuota y nada más; fecha al cierre de su mes o después)',
        `SELECT q.id, q.monto::text, a.empresa_id, ac.empresa_id AS empresa_activo, a.origen_tipo, a.origen_id,
                to_char(a.fecha, 'YYYY-MM-DD') AS fecha, count(m.id)::int AS lineas,
                sum(CASE WHEN m.cuenta_id = ac.cuenta_gasto_id THEN m.debe - m.haber ELSE 0 END)::text AS gasto,
                sum(CASE WHEN m.cuenta_id = ac.cuenta_depreciacion_id THEN m.haber - m.debe ELSE 0 END)::text AS acumulada
           FROM ledger.activos_cuotas q JOIN ledger.activos ac ON ac.id = q.activo_id
           JOIN ledger.asientos a ON a.id = q.asiento_id
           JOIN ledger.movimientos m ON m.asiento_id = a.id
          WHERE ${E('ac.empresa_id')}
          GROUP BY q.id, q.monto, q.mes, a.empresa_id, ac.empresa_id, a.origen_tipo, a.origen_id, a.fecha, a.reversa_de, ac.id
         HAVING a.empresa_id <> ac.empresa_id OR a.origen_tipo <> 'depreciacion' OR a.origen_id <> ac.id
             OR a.reversa_de IS NOT NULL OR count(m.id) <> 2
             OR a.fecha < (q.mes + interval '1 month' - interval '1 day')::date
             OR sum(CASE WHEN m.cuenta_id = ac.cuenta_gasto_id THEN m.debe - m.haber ELSE 0 END) <> q.monto
             OR sum(CASE WHEN m.cuenta_id = ac.cuenta_depreciacion_id THEN m.haber - m.debe ELSE 0 END) <> q.monto
         UNION ALL
         SELECT NULL, NULL, a.empresa_id, NULL, a.origen_tipo, a.id, to_char(a.fecha, 'YYYY-MM-DD'), NULL, NULL, NULL
           FROM ledger.asientos a
          WHERE a.origen_tipo = 'depreciacion' AND a.reversa_de IS NULL AND ${E('a.empresa_id')}
            AND NOT EXISTS (SELECT 1 FROM ledger.activos_cuotas q WHERE q.asiento_id = a.id)`,
    )
    await revisar(
        '15.alta_de_activo_mal_contabilizada (desde la compra: su línea activo_fijo, costo = base con crédito o base + IVA sin él, sin asiento propio; a mano: alta_activo 1.2.01 = costo / 1.2.02 = inicial + contrapartida)',
        `WITH alta AS (
             SELECT a.origen_id AS activo_id, count(DISTINCT a.id) AS asientos,
                    sum(CASE WHEN m.cuenta_id = ac.cuenta_activo_id THEN m.debe - m.haber ELSE 0 END) AS costo,
                    sum(CASE WHEN m.cuenta_id = ac.cuenta_depreciacion_id THEN m.haber - m.debe ELSE 0 END) AS inicial,
                    sum(CASE WHEN c.codigo IN ('${CUENTAS.SALDOS_APERTURA}', '${CUENTAS_GT.CAPITAL_SOCIAL}', '${CUENTAS_GT.UTILIDADES_ACUMULADAS}')
                             THEN m.haber - m.debe ELSE 0 END) AS contrapartida,
                    count(*) FILTER (WHERE m.cuenta_id NOT IN (ac.cuenta_activo_id, ac.cuenta_depreciacion_id)
                                       AND c.codigo NOT IN ('${CUENTAS.SALDOS_APERTURA}', '${CUENTAS_GT.CAPITAL_SOCIAL}', '${CUENTAS_GT.UTILIDADES_ACUMULADAS}')) AS ajenos
               FROM ledger.asientos a JOIN ledger.activos ac ON ac.id = a.origen_id
               JOIN ledger.movimientos m ON m.asiento_id = a.id JOIN ledger.cuentas c ON c.id = m.cuenta_id
              WHERE a.origen_tipo = 'alta_activo' AND a.reversa_de IS NULL
              GROUP BY 1
         )
         SELECT ac.id, ac.compra_id, ac.compra_linea_id, ac.costo::text, ac.depreciacion_inicial::text,
                l.base::text AS base_linea, l.iva::text AS iva_linea, co.credito_fiscal, alta.asientos, alta.costo::text AS costo_libro
           FROM ledger.activos ac
           LEFT JOIN ledger.compras_lineas l ON l.id = ac.compra_linea_id
           LEFT JOIN ledger.compras co ON co.id = l.compra_id
           LEFT JOIN alta ON alta.activo_id = ac.id
          WHERE ${E('ac.empresa_id')}
            AND CASE WHEN ac.compra_linea_id IS NOT NULL OR ac.compra_id IS NOT NULL
                     THEN l.id IS NULL OR co.id IS DISTINCT FROM ac.compra_id OR l.tipo <> 'activo_fijo'
                          OR co.empresa_id <> ac.empresa_id OR l.cuenta_id <> ac.cuenta_activo_id
                          OR ac.costo <> CASE WHEN co.credito_fiscal THEN l.base ELSE l.base + l.iva END
                          OR ac.depreciacion_inicial <> 0 OR alta.activo_id IS NOT NULL
                     ELSE alta.activo_id IS NULL OR alta.asientos <> 1 OR alta.costo <> ac.costo
                          OR alta.inicial <> ac.depreciacion_inicial OR alta.contrapartida <> ac.costo - ac.depreciacion_inicial
                          OR alta.ajenos <> 0 END`,
    )
    await revisar(
        '15.baja_de_activo_mal_contabilizada (venta o retiro: 1.2.02 = inicial + Σ cuotas, cobro = precio, 1.2.01 = costo y la diferencia a 4.2.02 o 5.3.06, nada más; anulación: sin asiento, su compra anulada y sin cuotas)',
        `WITH mov AS (
             SELECT b.id AS baja_id, count(DISTINCT a.id) AS asientos, min(a.fecha) AS fecha,
                    sum(CASE WHEN m.cuenta_id = ac.cuenta_depreciacion_id THEN m.debe - m.haber ELSE 0 END) AS acumulada,
                    sum(CASE WHEN m.cuenta_id = ac.cuenta_activo_id THEN m.haber - m.debe ELSE 0 END) AS costo,
                    sum(CASE WHEN m.cuenta_id = b.cuenta_cobro_id THEN m.debe - m.haber ELSE 0 END) AS cobro,
                    sum(CASE WHEN c.codigo = '${CUENTAS_GT.GANANCIA_VENTA_ACTIVOS}' THEN m.haber - m.debe ELSE 0 END) AS ganancia,
                    sum(CASE WHEN c.codigo = '${CUENTAS_GT.PERDIDA_BAJA_ACTIVOS}' THEN m.debe - m.haber ELSE 0 END) AS perdida,
                    count(*) FILTER (WHERE m.cuenta_id NOT IN (ac.cuenta_depreciacion_id, ac.cuenta_activo_id)
                                       AND m.cuenta_id IS DISTINCT FROM b.cuenta_cobro_id
                                       AND c.codigo NOT IN ('${CUENTAS_GT.GANANCIA_VENTA_ACTIVOS}', '${CUENTAS_GT.PERDIDA_BAJA_ACTIVOS}')) AS ajenos
               FROM ledger.activos_bajas b JOIN ledger.activos ac ON ac.id = b.activo_id
               JOIN ledger.asientos a ON a.origen_tipo = 'baja_activo' AND a.origen_id = ac.id AND a.reversa_de IS NULL
               JOIN ledger.movimientos m ON m.asiento_id = a.id JOIN ledger.cuentas c ON c.id = m.cuenta_id
              GROUP BY b.id
         ), x AS (
             SELECT b.*, ac.costo AS costo_activo, ac.compra_id,
                    ac.depreciacion_inicial + coalesce((SELECT sum(q.monto) FROM ledger.activos_cuotas q WHERE q.activo_id = ac.id), 0) AS acumulada_real,
                    mov.asientos, mov.fecha AS fecha_asiento, mov.acumulada AS acumulada_libro, mov.costo AS costo_libro,
                    mov.cobro, mov.ganancia, mov.perdida, mov.ajenos
               FROM ledger.activos_bajas b JOIN ledger.activos ac ON ac.id = b.activo_id
               LEFT JOIN mov ON mov.baja_id = b.id
              WHERE ${E('ac.empresa_id')}
         )
         SELECT id, activo_id, tipo, costo::text, depreciacion_acumulada::text, acumulada_real::text, valor_libros::text,
                precio_venta::text, acumulada_libro::text, costo_libro::text, cobro::text, ganancia::text, perdida::text, ajenos::int
           FROM x
          WHERE costo <> costo_activo OR depreciacion_acumulada <> acumulada_real OR valor_libros <> costo - depreciacion_acumulada
             OR CASE WHEN tipo = 'anulacion'
                     THEN asiento_id IS NOT NULL OR asientos IS NOT NULL OR acumulada_real <> 0 OR precio_venta <> 0
                          OR NOT EXISTS (SELECT 1 FROM ledger.compras_anulaciones xa WHERE xa.compra_id = x.compra_id)
                     ELSE asientos IS DISTINCT FROM 1 OR fecha_asiento <> fecha OR acumulada_libro <> acumulada_real
                          OR costo_libro <> costo OR cobro <> precio_venta
                          OR ganancia <> greatest(precio_venta - valor_libros, 0) OR perdida <> greatest(valor_libros - precio_venta, 0)
                          OR ajenos <> 0 OR (tipo = 'retiro' AND precio_venta <> 0) END`,
    )
    await revisar(
        '15.diferido_amortizado_de_mas (Σ cuotas ≤ total; una cuota por diferimiento y mes)',
        `SELECT d.id, d.total::text, coalesce(sum(q.monto), 0)::text AS amortizado
           FROM ledger.diferimientos d LEFT JOIN ledger.diferimientos_cuotas q ON q.diferimiento_id = d.id
          WHERE ${E('d.empresa_id')}
          GROUP BY d.id, d.total
         HAVING coalesce(sum(q.monto), 0) > d.total OR count(q.id) <> count(DISTINCT q.mes)`,
    )
    await revisar(
        '15.cuota_diferida_mal_calculada (cuota = redondeo(total / meses), la última completa el total; meses seguidos desde el inicio; asiento diferido: gasto / 1.1.13 o 2.1.12 / ingreso por la cuota)',
        `WITH q AS (
             SELECT q.*, d.total, d.meses, d.inicio, d.origen, d.empresa_id, d.cuenta_diferida_id, d.cuenta_destino_id,
                    row_number() OVER (PARTITION BY q.diferimiento_id ORDER BY q.mes) AS n,
                    coalesce(sum(q.monto) OVER (PARTITION BY q.diferimiento_id ORDER BY q.mes
                        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS previo
               FROM ledger.diferimientos_cuotas q JOIN ledger.diferimientos d ON d.id = q.diferimiento_id
              WHERE ${E('d.empresa_id')}
         ), mov AS (
             SELECT a.id, a.origen_tipo, a.origen_id, a.empresa_id, a.fecha, count(*) AS lineas,
                    array_agg(m.cuenta_id ORDER BY m.debe DESC) AS cuentas, max(m.debe) AS debe, max(m.haber) AS haber
               FROM ledger.asientos a JOIN ledger.movimientos m ON m.asiento_id = a.id
              WHERE a.origen_tipo = 'diferido' GROUP BY a.id
         )
         SELECT q.id, q.diferimiento_id, to_char(q.mes, 'YYYY-MM') AS mes, q.n::int, q.monto::text, q.total::text, q.meses, q.previo::text
           FROM q LEFT JOIN mov ON mov.id = q.asiento_id
          WHERE q.monto <> CASE WHEN q.n >= q.meses THEN q.total - q.previo
                                ELSE least(round(q.total / q.meses, 2), q.total - q.previo) END
             OR q.n > q.meses
             OR q.mes <> (q.inicio + make_interval(months => (q.n - 1)::int))::date
             OR q.mes >= date_trunc('month', q.created_at AT TIME ZONE 'America/Guatemala')::date
             OR mov.id IS NULL OR mov.origen_id <> q.diferimiento_id OR mov.empresa_id <> q.empresa_id OR mov.lineas <> 2
             OR mov.debe <> q.monto OR mov.haber <> q.monto
             OR mov.fecha < (q.mes + interval '1 month' - interval '1 day')::date
             OR mov.cuentas <> CASE WHEN q.origen = 'compra' THEN ARRAY[q.cuenta_destino_id, q.cuenta_diferida_id]
                                    ELSE ARRAY[q.cuenta_diferida_id, q.cuenta_destino_id] END`,
    )
    await revisar(
        '15.saldo_diferido_distinto (1.1.13 y 2.1.12 = Σ pendiente de amortizar de los diferimientos vigentes)',
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
    await revisar(
        '15.retencion_iva_sin_dte (H19: constancia de IVA recibida en un pago cuyo IVA recuperado de un castigo vuelve a 2.1.11 sin documento fiscal)',
        `SELECT p.id AS pago_id, k.numero, k.monto::text AS constancia, rc.iva::text AS iva_recuperado_sin_dte
           FROM billing.pagos p JOIN ledger.constancias_retencion k ON k.pago_id = p.id AND k.direccion = 'recibida' AND k.impuesto = 'iva'
           JOIN (SELECT pago_id, sum(iva) AS iva FROM ledger.recuperaciones_castigo GROUP BY 1) rc ON rc.pago_id = p.id
          WHERE ${E('p.empresa_id')} AND p.estado = 'registrado' AND rc.iva > 0`,
    )

    /*
    | 11 · Integridad (§10.10): la parte sellada de la cadena de hash de cada empresa verifica
    */
    for (const empresa of empresas) {
        const integridad = await verificarCadena(empresa, {}, clienteLectura ?? db.connection())
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
                       a.created_at, string_agg(concat_ws(':', m.id, m.cuenta_id, m.cliente_id, m.debe, m.haber, m.impuesto_codigo, m.cuadricula), ',' ORDER BY m.id))) AS h
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
