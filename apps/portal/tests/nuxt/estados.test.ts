import { describe, expect, it } from 'vitest'

/** Estados (skill horus-identity, `estados.md`): icono Lucide + texto + color semántico. */

const FAMILIAS = {
    servicio: ESTADOS_SERVICIO,
    factura: ESTADOS_FACTURA,
    pago: ESTADOS_PAGO,
    promesa: ESTADOS_PROMESA,
    comprobante: ESTADOS_COMPROBANTE,
    pagoEnLinea: ESTADOS_PAGO_EN_LINEA,
}

describe('estados: icono + texto + color', () => {
    for (const [familia, estados] of Object.entries(FAMILIAS)) {
        it(`${familia}: cada estado lleva icono Lucide, texto y un color semántico (nunca primary)`, () => {
            for (const presentacion of Object.values(estados)) {
                expect(presentacion.icono).toMatch(/^i-lucide-[a-z0-9-]+$/)
                expect(presentacion.etiqueta.trim()).not.toBe('')
                expect(['success', 'info', 'warning', 'error', 'neutral']).toContain(presentacion.color)
            }
        })

        it(`${familia}: dos estados con el mismo color se distinguen por el icono`, () => {
            const vistos = new Map<string, string>()
            for (const { color, icono } of Object.values(estados)) {
                const clave = `${color}|${icono}`
                expect(vistos.has(clave), clave).toBe(false)
                vistos.set(clave, icono)
            }
        })
    }
})
