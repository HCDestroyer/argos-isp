import { vi } from 'vitest'

/**
 * `vi.waitFor` con un plazo explícito y holgado. El de Vitest es de 1 s, y una pantalla espera
 * cadenas de peticiones a los fixtures (cada una con su demora de red simulada): con la máquina
 * cargada la cadena pasa de 1 s y la prueba falla sin que nada esté mal (`horus.test.ts`, la insignia
 * y «configuración: apagada por defecto…»). 10 s caben de sobra dentro del `testTimeout` (30 s) y una
 * espera que se cumple antes no tarda más: `waitFor` vuelve en cuanto la condición pasa. No es un
 * reintento: la condición se revisa hasta que se cumple o vence el plazo, y si vence la prueba falla.
 */
export const PLAZO_ESPERA_MS = 10_000

export function esperar<T>(condicion: () => T | Promise<T>, opciones: { timeout?: number, interval?: number } = {}): Promise<T> {
    return vi.waitFor(condicion, { timeout: PLAZO_ESPERA_MS, interval: 50, ...opciones })
}
