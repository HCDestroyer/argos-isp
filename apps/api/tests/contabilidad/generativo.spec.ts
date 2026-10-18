import { test } from '@japa/runner'
import { soloEmpresaPrincipal } from '#tests/ayudas'
import { EscenarioGenerativo } from '#tests/contabilidad/escenario_generativo'

/**
 * Auditor contable · escenarios generativos. Cada semilla arma dos empresas nuevas y corre 50
 * pasos aleatorios (reproducibles) mezclando facturación, cobros, anulaciones, notas de crédito,
 * promesas, cobro repartido, egresos, cierres de caja, históricos y cierre/reapertura de mes.
 * Después de cada paso: `verificarLibro` de las dos empresas + inmutabilidad de lo anterior.
 *
 * Si falla: el mensaje trae la semilla, el paso, la cifra que no cuadra y la secuencia de pasos
 * hasta ahí (para reproducir, correr la misma semilla).
 */

/** `AUDITOR_SEMILLA=123` corre solo esa semilla (para reproducir un hallazgo). */
const SEMILLAS = process.env.AUDITOR_SEMILLA ? [Number(process.env.AUDITOR_SEMILLA)] : [20261017, 777, 4242]
const PASOS = 50

test.group('Auditor contable · escenarios generativos', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    for (const semilla of SEMILLAS) {
        test(`semilla ${semilla}: ${PASOS} pasos sin romper ningún invariante`, async ({ assert }) => {
            const escenario = new EscenarioGenerativo(semilla)
            await escenario.preparar()
            const resultado = await escenario.correr(PASOS)
            if (process.env.AUDITOR_TRAZA) {
                for (const p of resultado.pasos) {
                    console.log(
                        `[${semilla}] ${p.n}. ${p.accion}: ${p.detalle}${p.rechazo ? ` → ${p.rechazo}` : ''}`,
                    )
                }
            }
            const rechazos = resultado.pasos.filter((p) => p.rechazo).length
            // el escenario debe ejercitar de verdad el libro, no rechazarlo todo
            assert.isBelow(rechazos, PASOS / 2, `demasiados rechazos: ${rechazos} de ${PASOS}`)
            const mensaje = resultado.hallazgos
                .map(
                    (h) =>
                        `── semilla ${semilla}, paso ${h.paso}: ${h.violacion.invariante}\n` +
                        `${JSON.stringify(h.violacion.detalle, null, 2)}\n` +
                        `secuencia hasta el paso ${h.paso}:\n  ${h.secuencia.join('\n  ')}`,
                )
                .join('\n\n')
            assert.deepEqual(
                resultado.hallazgos.map((h) => h.violacion.invariante),
                [],
                `Invariantes contables rotos:\n${mensaje}`,
            )
        }).timeout(240_000)
    }
})
