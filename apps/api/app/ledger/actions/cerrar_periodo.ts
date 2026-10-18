import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, ReglaNegocio } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { resolverEmpresaActiva } from '#core/empresas'
import { hoyGuatemala, inicioDeMes } from '#ledger/fechas'
import { asignarPartidas } from '#ledger/diarios'
import { periodoCerrado, periodoDe, resumenDelMes, verCierre, type CierreVista } from '#ledger/cierres'
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
 */

export interface EntradaCerrarPeriodo {
    /** empresa cuyo libro se cierra; por defecto la activa (o la única) */
    empresa_id?: number | null
    anio: number
    mes: number
    /** instante de referencia (pruebas); por defecto ahora */
    ahora?: Date
}

/** Espacio de advisory locks de cierres (primer entero). */
export const LOCK_CIERRES = 3005

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
