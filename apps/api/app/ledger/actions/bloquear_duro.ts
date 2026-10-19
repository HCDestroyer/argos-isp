import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Problema, type ErrorCampo } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { resolverEmpresaActiva } from '#core/empresas'
import { fechaValida, hoyGuatemala } from '#ledger/fechas'
import {
    bloquearBloqueos,
    bloqueoVigente,
    guardarBloqueo,
    motivoObligatorio,
    type BloqueoVista,
} from '#ledger/bloqueos'

/**
 * `libro.bloquear_duro` (`POST /libro/bloqueos/duro`, solo `admin`): bloqueo irreversible del libro
 * hasta `hasta` (contrato §9.2 y §10.4). Nada se registra con fecha ≤ `hasta`, ni con excepción,
 * y ningún mes hasta ahí se reabre (409 `bloqueo_duro`).
 *
 * - Confirmación escrita (decisión del líder): `confirmacion` debe ser exactamente
 *   `BLOQUEO DURO hasta AAAA-MM-DD` con la misma fecha (422 `confirmacion_invalida`).
 * - Solo avanza: 422 `bloqueo_regresivo` si `hasta` no es posterior al duro vigente (también por
 *   trigger).
 * - Requisitos (422 `bloqueo_duro_requisitos`, un `errors[]` por problema, `rule` = la clave):
 *     - `meses_abiertos`: todos los meses con asientos hasta el de `hasta`, y ese mismo, cerrados;
 *     - `dte_pendientes`: ningún DTE `pendiente`, `enviando`, `error_temporal` o `contingencia`
 *       emitido hasta `hasta`;
 *     - `extractos_sin_conciliar`: ninguna línea de extracto con fecha ≤ `hasta` sin conciliación
 *       vigente.
 *   Los checks de cierre (cobros por liquidar, cadena de hash, check anual) se suman con la lista
 *   de verificación (PR B de la fase 6: 422 `checks_pendientes`).
 * - Emite `libro.bloqueo_cambiado`.
 */

export interface EntradaBloquearDuro {
    empresa_id?: number | null
    hasta: string
    motivo: string
    confirmacion: string
}

export function textoConfirmacionDuro(hasta: string): string {
    return `BLOQUEO DURO hasta ${hasta}`
}

export default class BloquearDuro extends DomainAction<EntradaBloquearDuro, BloqueoVista> {
    readonly nombre = 'libro.bloquear_duro'

    protected async handle(input: EntradaBloquearDuro, t: Transaccion): Promise<BloqueoVista> {
        const hasta = fechaValida(input.hasta, 'hasta')
        const motivo = motivoObligatorio(input.motivo)
        const esperada = textoConfirmacionDuro(hasta)
        if ((input.confirmacion ?? '').trim() !== esperada) {
            throw new Problema(
                422,
                'confirmacion_invalida',
                'Confirmación inválida',
                `Para fijar el bloqueo duro escribe exactamente «${esperada}»`,
                [{ field: 'confirmacion', message: `Debe ser «${esperada}»`, rule: 'confirmacion_invalida' }],
            )
        }
        if (hasta >= hoyGuatemala()) {
            throw new Problema(
                422,
                'bloqueo_futuro',
                'Bloqueo futuro',
                'El bloqueo duro solo cubre días pasados',
                [{ field: 'hasta', message: 'Debe ser anterior a hoy', rule: 'bloqueo_futuro' }],
            )
        }
        const empresaId = input.empresa_id ?? (await resolverEmpresaActiva(t.ctx, t.trx))
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        await bloquearBloqueos(t.trx, empresaId)

        const anterior = await bloqueoVigente(t.trx, empresaId, 'duro')
        if (anterior !== null && hasta <= anterior) {
            throw new Problema(
                422,
                'bloqueo_regresivo',
                'Bloqueo regresivo',
                `El bloqueo duro ya está en ${anterior}: solo avanza`,
                [{ field: 'hasta', message: `Debe ser posterior a ${anterior}`, rule: 'bloqueo_regresivo' }],
            )
        }

        const errores = await requisitosDuro(t, empresaId, hasta)
        if (errores.length > 0) {
            throw new Problema(
                422,
                'bloqueo_duro_requisitos',
                'Requisitos del bloqueo duro',
                `No se puede fijar el bloqueo duro hasta ${hasta}: ${errores.map((e) => e.message).join('; ')}`,
                errores,
            )
        }
        return guardarBloqueo(t, { empresaId, tipo: 'duro', hasta, motivo, confirmacion: esperada })
    }
}

async function requisitosDuro(t: Transaccion, empresaId: number, hasta: string): Promise<ErrorCampo[]> {
    const errores: ErrorCampo[] = []
    const { rows: meses } = (await t.trx.rawQuery(
        `WITH limites AS (
             SELECT least(coalesce(min(date_trunc('month', a.fecha)), date_trunc('month', ?::date)),
                          date_trunc('month', ?::date))::date AS desde
               FROM ledger.asientos a WHERE a.empresa_id = ? AND a.fecha <= ?::date
         )
         SELECT to_char(m, 'YYYY-MM') AS mes
           FROM limites, generate_series(limites.desde, date_trunc('month', ?::date)::date, interval '1 month') AS m
          WHERE NOT ledger.periodo_cerrado(m::date, ?)
            AND (EXISTS (SELECT 1 FROM ledger.asientos a WHERE a.empresa_id = ?
                          AND a.fecha >= m::date AND a.fecha < (m + interval '1 month')::date)
                 OR m = date_trunc('month', ?::date))
          ORDER BY 1`,
        [hasta, hasta, empresaId, hasta, hasta, empresaId, empresaId, hasta],
    )) as { rows: Array<{ mes: string }> }
    if (meses.length > 0) {
        errores.push({
            field: 'hasta',
            message: `Meses sin cerrar: ${meses.map((m) => m.mes).join(', ')}`,
            rule: 'meses_abiertos',
        })
    }

    const { rows: dte } = (await t.trx.rawQuery(
        `SELECT count(*)::int AS n FROM fiscal.dte d
          WHERE d.empresa_id = ? AND d.estado IN ('pendiente', 'enviando', 'error_temporal', 'contingencia')
            AND (d.fecha_emision AT TIME ZONE 'America/Guatemala')::date <= ?::date`,
        [empresaId, hasta],
    )) as { rows: Array<{ n: number }> }
    if ((dte[0]?.n ?? 0) > 0) {
        errores.push({
            field: 'hasta',
            message: `${dte[0]!.n} DTE sin certificar emitidos hasta ${hasta}`,
            rule: 'dte_pendientes',
        })
    }

    const { rows: lineas } = (await t.trx.rawQuery(
        `SELECT count(*)::int AS n FROM ledger.extractos_lineas l
          WHERE l.empresa_id = ? AND l.fecha <= ?::date
            AND NOT EXISTS (
                SELECT 1 FROM ledger.conciliaciones k
                 WHERE k.linea_id = l.id
                   AND NOT EXISTS (SELECT 1 FROM ledger.conciliaciones_anulaciones x WHERE x.conciliacion_id = k.id))`,
        [empresaId, hasta],
    )) as { rows: Array<{ n: number }> }
    if ((lineas[0]?.n ?? 0) > 0) {
        errores.push({
            field: 'hasta',
            message: `${lineas[0]!.n} líneas de extracto sin conciliar hasta ${hasta}`,
            rule: 'extractos_sin_conciliar',
        })
    }
    return errores
}
