import { mountSuspended } from '@nuxt/test-utils/runtime'
import type { Schema } from '@argosisp/contracts'
import { describe, expect, it } from 'vitest'
import GraficaColumnas from '~/components/GraficaColumnas.vue'

type Mes = Schema<'ResumenDashboard'>['series'][number]

function mes(periodo: string, facturado: string, cobrado: string, facturas: number, pagos: number): Mes {
    return { periodo, facturado, cobrado, facturas, pagos }
}

describe('gráficas con la paleta y el hallazgo de la identidad', () => {
    it('la paleta categórica es la de la skill, cinco ranuras en orden fijo y por tema', () => {
        expect(CATEGORICAL.light).toEqual(['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'])
        expect(CATEGORICAL.dark).toEqual(['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181'])
        expect(MAX_SERIES_CATEGORICAS).toBe(5)
    })

    it('hallazgo de montos: cobranza del último mes frente a los anteriores', () => {
        const series = [mes('2026-09', '1000.00', '900.00', 10, 9), mes('2026-10', '1000.00', '625.50', 10, 6)]
        expect(hallazgoMontos({ series })).toBe('En octubre 2026 se ha cobrado el 62 % de lo facturado; en el mes anterior, el 90 %.')
    })

    it('hallazgo de montos sin facturación en el mes: lo dice, sin un 0 % inventado', () => {
        const series = [mes('2026-10', '0.00', '50.00', 0, 1)]
        expect(hallazgoMontos({ series })).toBe('Sin facturación en octubre 2026; cobrado Q 50.00.')
    })

    it('hallazgo de conteos: de la primera factura del periodo al último mes', () => {
        const series = [mes('2026-08', '0.00', '0.00', 0, 0), mes('2026-09', '1.00', '1.00', 400, 380), mes('2026-10', '1.00', '1.00', 520, 1)]
        expect(hallazgoConteos({ series })).toBe('Las facturas emitidas pasaron de 400 en septiembre 2026 a 520 en octubre 2026, con 1 pago registrado en el último mes.')
        expect(hallazgoConteos({ series: [mes('2026-10', '0.00', '0.00', 0, 0)] })).toBe('Sin facturas emitidas en los últimos 12 meses.')
    })

    it('la gráfica muestra el hallazgo y lo enlaza como descripción', async () => {
        const vista = await mountSuspended(GraficaColumnas, {
            props: {
                titulo: 'Facturado y cobrado',
                categorias: ['sep', 'oct'],
                series: [{ id: 'f', nombre: 'Facturado', valores: ['10.00', '20.00'] }],
                hallazgo: 'En octubre se cobró el 62 %.',
            },
        })
        const hallazgo = vista.get('[data-prueba="hallazgo"]')
        expect(hallazgo.text()).toBe('En octubre se cobró el 62 %.')
        expect(hallazgo.attributes('id')).toBeTruthy()
    })
})
