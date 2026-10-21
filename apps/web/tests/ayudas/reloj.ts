import { vi } from 'vitest'
import { HOY_FIXTURES } from '~~/fixtures/facturacion/datos'

/**
 * Fija el reloj en el "hoy" de los fixtures (`HOY_FIXTURES`, mediodía en Guatemala).
 *
 * Los fixtures calculan el estado de las facturas contra `HOY_FIXTURES`, pero las pantallas usan
 * `hoyGuatemala()` (el reloj real): sin fijarlo, una factura que vence después de esa fecha pasa
 * a contar como vencida cuando el calendario la alcanza y la prueba cambia sola. Solo se finge
 * `Date`; los temporizadores siguen reales, así `esperar` (y `vi.waitFor`) funcionan igual.
 */
export function fijarHoyFixtures(): void {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(`${HOY_FIXTURES}T18:00:00.000Z`))
}

/** Devuelve el reloj real; va en el `afterEach` de quien llamó `fijarHoyFixtures()`. */
export function soltarReloj(): void {
    vi.useRealTimers()
}
