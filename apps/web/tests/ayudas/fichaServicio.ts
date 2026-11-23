import type { VueWrapper } from '@vue/test-utils'
import { expect } from 'vitest'
import { esperar } from './esperar'

/**
 * Ficha del servicio (rediseño, tablero OperServicioFicha): las acciones van en una fila, la
 * principal a la vista y el resto en «Más». Abre «Más» y devuelve los textos de sus opciones.
 */
export async function opcionesMasServicio(vista: Pick<VueWrapper, 'get'>): Promise<string[]> {
    await vista.get('[data-prueba="mas-acciones-servicio"]').trigger('click')
    return esperar(() => {
        const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].map(e => e.textContent?.trim() ?? '')
        expect(items.length).toBeGreaterThan(0)
        return items
    })
}

/** Pulsa una opción de «Más» por su texto (ya abierto con `opcionesMasServicio`). */
export function elegirOpcionMas(texto: string): void {
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(e => e.textContent?.trim() === texto)
    expect(item, texto).toBeDefined()
    item!.click()
}

/** Las acciones a la vista en la franja más las de «Más». */
export async function accionesServicio(vista: Pick<VueWrapper, 'get' | 'find' | 'findAll'>): Promise<string[]> {
    const visibles = vista.findAll('[data-prueba="acciones-servicio"] button').map(b => b.text().trim()).filter(Boolean)
    if (!vista.find('[data-prueba="mas-acciones-servicio"]').exists()) {
        return visibles
    }
    return [...visibles, ...await opcionesMasServicio(vista)]
}
