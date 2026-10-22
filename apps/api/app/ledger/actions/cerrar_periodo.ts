import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, Problema, ReglaNegocio, type ErrorCampo } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { resolverEmpresaActiva } from '#core/empresas'
import { hoyGuatemala, inicioDeMes } from '#ledger/fechas'
import { asignarPartidas } from '#ledger/diarios'
import {
    LOCK_CIERRES,
    periodoCerrado,
    periodoDe,
    resumenDelMes,
    verCierre,
    type CierreVista,
} from '#ledger/cierres'
import { exigirChecks } from '#ledger/checks'
import VerificarCierre from '#ledger/actions/verificar_cierre'
import { verificarCadena } from '#ledger/sellos'
import SellarAsientos from '#ledger/actions/sellar_asientos'

/**
 * `libro.cerrar_periodo` = `cerrarPeriodo(año, mes)` (`POST /libro/periodos/cerrar`).
 *
 * Después del cierre ningún asiento puede tener fecha dentro del mes, ni siquiera un reverso: los
 * reversos (`RevertirAsiento`) van con la fecha de hoy, que cae en el periodo abierto. Se aplica
 * en la acción (`registrarAsiento` consulta `ledger.periodo_cerrado`) y en la base de datos
 * (triggers de asientos y movimientos).
 *
 * - Solo meses ya terminados (Guatemala): 422 `periodo_en_curso` para el mes actual o futuro.
 * - 409 `periodo_cerrado` si ya está cerrado (también lo impide un trigger).
 * - Por empresa (multiempresa): cierra el libro de `empresa_id` (por defecto la activa); los demás
 *   libros siguen abiertos.
 * - Guarda el resumen del mes (asientos, debe, haber y movimiento por cuenta).
 * - Asigna la partida del Libro Diario a los asientos del mes que aún no la tienen
 *   (`ledger.asientos_partidas`, correlativo por empresa y año en orden `(fecha, numero)`). Un mes
 *   reabierto conserva sus partidas: nunca se renumera.
 * - Cadena de hash (§10.10): sella antes los asientos pendientes de la empresa (`SellarAsientos`
 *   anidada, esperando el lock de la cadena), recalcula la cadena completa y, si no verifica,
 *   responde 409 `integridad_rota` con el sello roto. El cierre guarda el último sello y su hash.
 * - Lista de verificación (§10.5, fase 6): corre `cierres.verificar` del mes y exige cada check
 *   en `ok` o supervisado (422 `checks_pendientes`, un `errors[]` por clave con esperado y
 *   obtenido). Como la acción falla, esa verificación no queda guardada: para ver y supervisar las
 *   anomalías, `POST /libro/cierres/mensual/:periodo/verificar` antes de cerrar.
 */

export interface EntradaCerrarPeriodo {
    /** empresa cuyo libro se cierra; por defecto la activa (o la única) */
    empresa_id?: number | null
    anio: number
    mes: number
    /** instante de referencia (pruebas); por defecto ahora */
    ahora?: Date
}

export { LOCK_CIERRES } from '#ledger/cierres'

export default class CerrarPeriodo extends DomainAction<EntradaCerrarPeriodo, CierreVista> {
    readonly nombre = 'libro.cerrar_periodo'

    protected async handle(input: EntradaCerrarPeriodo, t: Transaccion): Promise<CierreVista> {
        const periodo = periodoDe(input.anio, input.mes)
        if (periodo >= inicioDeMes(hoyGuatemala(input.ahora))) {
            throw new ReglaNegocio(
                `El periodo ${periodo.slice(0, 7)} no ha terminado: solo se cierran meses pasados`,
                'periodo_en_curso',
            )
        }
        const empresaId = input.empresa_id ?? (await resolverEmpresaActiva(t.ctx, t.trx))
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?)', [LOCK_CIERRES, empresaId])
        if (await periodoCerrado(t.trx, periodo, empresaId)) {
            throw new Conflicto(
                `El periodo ${periodo.slice(0, 7)} ya está cerrado`,
                'periodo_cerrado',
                'Periodo cerrado',
            )
        }

        // FEL (condición del líder a la NCRE inmediata, contrato §17): ninguna NCRE del mes o anterior
        // sin certificar; una rechazada en definitivo se anula antes (facturas.anular_nota_credito)
        const { rows: ncre } = (await t.trx.rawQuery(
            `SELECT d.id AS dte_id, d.documento_id AS nota_id, n.factura_id, d.estado
               FROM fiscal.dte d JOIN billing.notas_credito n ON n.id = d.documento_id
              WHERE d.documento_tipo = 'nota_credito' AND d.empresa_id = ?
                AND n.fecha < (?::date + interval '1 month')
                AND NOT EXISTS (SELECT 1 FROM billing.notas_credito_anulaciones x WHERE x.nota_id = n.id)
                AND NOT EXISTS (SELECT 1 FROM fiscal.dte o WHERE o.documento_tipo = 'nota_credito'
                                  AND o.documento_id = n.id AND o.estado = 'certificado')
                AND d.id = (SELECT max(o.id) FROM fiscal.dte o
                             WHERE o.documento_tipo = 'nota_credito' AND o.documento_id = n.id)
              ORDER BY d.id`,
            [empresaId, periodo],
        )) as { rows: Array<{ dte_id: number; nota_id: number; factura_id: number; estado: string }> }
        if (ncre.length > 0) {
            // errors[]: una entrada por nota, field nota_id, message = estado del DTE, rule = dte_id
            // (además nota_id, factura_id, dte_id y estado como números y texto)
            const errores = ncre.map(
                (
                    x,
                ): ErrorCampo & { nota_id: number; factura_id: number; dte_id: number; estado: string } => ({
                    field: 'nota_id',
                    message: x.estado,
                    rule: String(x.dte_id),
                    nota_id: Number(x.nota_id),
                    factura_id: Number(x.factura_id),
                    dte_id: Number(x.dte_id),
                    estado: x.estado,
                }),
            )
            throw new Problema(
                409,
                'ncre_sin_certificar',
                'NCRE sin certificar',
                `Hay ${ncre.length} notas de crédito con su NCRE sin certificar (${ncre
                    .slice(0, 20)
                    .map((x) => `nota ${x.nota_id}: ${x.estado}`)
                    .join(', ')}): certifícalas o anula las rechazadas antes de cerrar el mes`,
                errores,
            )
        }

        // todos los asientos del mes sellados y la cadena verificada (§10.10)
        for (;;) {
            const sellado = await new SellarAsientos().execute(
                { empresa_id: empresaId, limite: 5000, esperar: true },
                t.ctx,
                { trx: t.trx },
            )
            if ((sellado.empresas[0]?.sellados ?? 0) < 5000) break
        }
        const integridad = await verificarCadena(empresaId, {}, t.trx)
        if (integridad.ruptura || integridad.sin_sellar > 0) {
            const r = integridad.ruptura
            throw new Conflicto(
                r
                    ? `La cadena de hash del libro está rota en el sello ${r.sello} (${r.motivo}): no se puede cerrar el mes`
                    : `Hay ${integridad.sin_sellar} asientos sin sellar: no se puede cerrar el mes`,
                'integridad_rota',
                'Integridad del libro',
            )
        }

        // lista de verificación de cierre (§10.5)
        await new VerificarCierre().execute(
            { empresa_id: empresaId, tipo: 'mensual', periodo: periodo.slice(0, 7) },
            t.ctx,
            { trx: t.trx },
        )
        await exigirChecks(t.trx, empresaId, 'mensual', periodo)

        const resumen = await resumenDelMes(t.trx, periodo, empresaId)
        const [fila] = (await t.trx
            .insertQuery()
            .table('ledger.cierres_mensuales')
            .insert({
                empresa_id: empresaId,
                periodo,
                cerrado_por: usuarioDelActor(t.ctx.actor),
                resumen: JSON.stringify(resumen),
                ultimo_sello: integridad.ultimo_sello,
                ultimo_hash: integridad.ultimo_hash,
            })
            .returning('id')) as Array<{ id: number }>
        t.fijarEntidad('cierre_mensual', fila!.id)
        await asignarPartidas(t.trx, empresaId, periodo, fila!.id)
        return verCierre(fila!.id, t.trx)
    }
}
