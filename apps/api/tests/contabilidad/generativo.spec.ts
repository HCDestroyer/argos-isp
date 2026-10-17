import { test } from '@japa/runner'
import { soloEmpresaPrincipal } from '#tests/ayudas'
import { EscenarioGenerativo } from '#tests/contabilidad/escenario_generativo'

/**
 * Auditor contable · escenarios generativos. Cada semilla arma dos empresas nuevas y corre 50
 * pasos aleatorios (reproducibles) mezclando facturación, cobros, anulaciones, notas de crédito,
 * promesas, cobro repartido, egresos, cierres de caja, históricos y cierre/reapertura de mes. Con
 * FEL (fase 3) se suman la cola de certificación con errores y caídas del certificador falso,
 * certificación a mano, rechazos y reintentos, contingencia, anulación de DTE, NCRE por línea, NDEB
 * de mora, sustitución y pagos anulados antes y después de certificar.
 * Después de cada paso: `verificarLibro` de las dos empresas + inmutabilidad de lo anterior.
 *
 * Si falla: el mensaje trae la semilla, el paso, la cifra que no cuadra y la secuencia de pasos
 * hasta ahí (para reproducir, correr la misma semilla).
 */

/** `AUDITOR_SEMILLA=123` corre solo esa semilla (para reproducir un hallazgo). */
const SEMILLAS = process.env.AUDITOR_SEMILLA ? [Number(process.env.AUDITOR_SEMILLA)] : [20261017, 777, 4242]
/** Con FEL (fase 3): las tres de siempre y tres nuevas. */
const SEMILLAS_FEL = process.env.AUDITOR_SEMILLA
    ? [Number(process.env.AUDITOR_SEMILLA)]
    : [20261017, 777, 4242, 31337, 90210, 271828]
const PASOS = 50
/** Con FEL hacen falta más pasos para llegar a certificar, anular y acreditar lo certificado. */
const PASOS_FEL = 120
/** `AUDITOR_HALLAZGOS=1` también revisa los invariantes de hallazgos abiertos (`HALLAZGOS_ABIERTOS`). */
const INCLUIR_HALLAZGOS = process.env.AUDITOR_HALLAZGOS === '1'

test.group('Auditor contable · escenarios generativos', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    for (const [semilla, fel] of [
        ...SEMILLAS.map((x) => [x, false] as const),
        ...SEMILLAS_FEL.map((x) => [x, true] as const),
    ]) {
        test(`semilla ${semilla}${fel ? ' con FEL' : ''}: ${fel ? PASOS_FEL : PASOS} pasos sin romper ningún invariante`, async ({
            assert,
        }) => {
            const pasos = fel ? PASOS_FEL : PASOS
            const escenario = new EscenarioGenerativo(semilla, {
                fel,
                incluirHallazgosAbiertos: INCLUIR_HALLAZGOS,
            })
            await escenario.preparar()
            const resultado = await escenario.correr(pasos)
            if (process.env.AUDITOR_TRAZA) {
                for (const p of resultado.pasos) {
                    console.log(
                        `[${semilla}${fel ? ' fel' : ''}] ${p.n}. ${p.accion}: ${p.detalle}${p.rechazo ? ` → ${p.rechazo}` : ''}`,
                    )
                }
            }
            const rechazos = resultado.pasos.filter((p) => p.rechazo).length
            // el escenario debe ejercitar de verdad el libro, no rechazarlo todo
            assert.isBelow(rechazos, pasos / 2, `demasiados rechazos: ${rechazos} de ${pasos}`)
            const mensaje = resultado.hallazgos
                .map(
                    (h) =>
                        `── semilla ${semilla}${fel ? ' (FEL)' : ''}, paso ${h.paso}: ${h.violacion.invariante}\n` +
                        `${JSON.stringify(h.violacion.detalle, null, 2)}\n` +
                        `secuencia hasta el paso ${h.paso}:\n  ${h.secuencia.join('\n  ')}`,
                )
                .join('\n\n')
            assert.deepEqual(
                resultado.hallazgos.map((h) => h.violacion.invariante),
                [],
                `Invariantes contables rotos:\n${mensaje}`,
            )
        }).timeout(600_000)
    }
})
