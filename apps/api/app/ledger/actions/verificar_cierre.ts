import { DomainAction, type Transaccion } from '#shared/domain_action'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { resolverEmpresaActiva } from '#core/empresas'
import { LOCK_CIERRES } from '#ledger/cierres'
import SellarAsientos from '#ledger/actions/sellar_asientos'
import {
    calcularChecks,
    checksVigentes,
    checkPasa,
    periodoDeCheck,
    textoPeriodo,
    type CheckVista,
    type TipoCheck,
} from '#ledger/checks'

/**
 * `cierres.verificar` (`POST /libro/cierres/:tipo/:periodo/verificar`, permiso
 * `libro.cerrar_periodo`; contrato §10.5): corre los checks automáticos del tipo y periodo y guarda
 * cada resultado en `ledger.cierres_checks` (solo inserción). También la llaman `cerrarPeriodo` y
 * el bloqueo duro.
 *
 * - Antes sella los asientos pendientes de la empresa (el check `hash_verificado` mira la cadena).
 * - Una clave solo recibe fila nueva si su resultado cambió (esperado, obtenido o resultado): así
 *   una supervisión (`cierres.revisar_check`) sigue vigente mientras la anomalía sea la misma.
 * - Emite `libro.checks_verificados { empresa_id, tipo, periodo, anomalias[] }`.
 */

export interface EntradaVerificarCierre {
    empresa_id?: number | null
    tipo: TipoCheck
    /** `AAAA-MM` (mensual) o `AAAA` (anual) */
    periodo: string
}

export interface ResultadoVerificacion {
    empresa_id: number
    tipo: TipoCheck
    periodo: string
    /** los checks vigentes después de verificar */
    checks: CheckVista[]
    /** claves que no pasan (anomalía sin supervisar) */
    anomalias: string[]
}

export default class VerificarCierre extends DomainAction<EntradaVerificarCierre, ResultadoVerificacion> {
    readonly nombre = 'cierres.verificar'

    protected async handle(input: EntradaVerificarCierre, t: Transaccion): Promise<ResultadoVerificacion> {
        const periodo = periodoDeCheck(input.tipo, input.periodo)
        const empresaId = input.empresa_id ?? (await resolverEmpresaActiva(t.ctx, t.trx))
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?)', [LOCK_CIERRES, empresaId])

        for (;;) {
            const sellado = await new SellarAsientos().execute(
                { empresa_id: empresaId, limite: 5000, esperar: true },
                t.ctx,
                { trx: t.trx },
            )
            if ((sellado.empresas[0]?.sellados ?? 0) < 5000) break
        }

        const calculados = await calcularChecks(t.trx, empresaId, input.tipo, periodo)
        const previos = await ultimosAutomaticos(t, empresaId, input.tipo, periodo)
        const nuevos = calculados.filter((c) => {
            const p = previos.get(c.clave)
            return !p || p.esperado !== c.esperado || p.obtenido !== c.obtenido || p.resultado !== c.resultado
        })
        if (nuevos.length > 0) {
            await t.trx
                .insertQuery()
                .table('ledger.cierres_checks')
                .multiInsert(
                    nuevos.map((c) => ({
                        empresa_id: empresaId,
                        tipo: input.tipo,
                        periodo,
                        clave: c.clave,
                        automatico: true,
                        valor_esperado: c.esperado,
                        valor_obtenido: c.obtenido,
                        resultado: c.resultado,
                        estado: c.resultado === 'ok' ? 'revisado' : 'anomalia',
                        detalle: c.detalle ? JSON.stringify(c.detalle) : null,
                    })),
                )
        }
        const checks = await checksVigentes(t.trx, empresaId, input.tipo, periodo)
        const anomalias = checks.filter((c) => !checkPasa(c)).map((c) => c.clave)
        t.anotarAuditoria({ anomalias })
        await t.emit('libro.checks_verificados', {
            empresa_id: empresaId,
            tipo: input.tipo,
            periodo: textoPeriodo(input.tipo, periodo),
            anomalias,
        })
        return {
            empresa_id: empresaId,
            tipo: input.tipo,
            periodo: textoPeriodo(input.tipo, periodo),
            checks,
            anomalias,
        }
    }
}

async function ultimosAutomaticos(t: Transaccion, empresaId: number, tipo: TipoCheck, periodo: string) {
    const filas = (await t.trx
        .from('ledger.cierres_checks as k')
        .where('k.empresa_id', empresaId)
        .where('k.tipo', tipo)
        .where('k.periodo', periodo)
        .where('k.automatico', true)
        .whereRaw(
            `k.id = (SELECT max(x.id) FROM ledger.cierres_checks x WHERE x.empresa_id = k.empresa_id AND x.tipo = k.tipo
                      AND x.periodo = k.periodo AND x.clave = k.clave AND x.automatico)`,
        )
        .select(
            'k.clave',
            'k.valor_esperado as esperado',
            'k.valor_obtenido as obtenido',
            'k.resultado',
        )) as Array<{
        clave: string
        esperado: string | null
        obtenido: string | null
        resultado: string
    }>
    return new Map(filas.map((f) => [f.clave, f]))
}
