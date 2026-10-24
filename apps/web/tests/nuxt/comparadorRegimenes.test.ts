import { mountSuspended } from '@nuxt/test-utils/runtime'
import Decimal from 'decimal.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import { meAdmin } from '~~/fixtures/auth/sesiones'
import { bd } from '~~/fixtures/bd'
import PaginaComparador from '~/pages/fiscal/comparador.vue'
import { esperar } from '../ayudas/esperar'
import { fijarHoyFixtures, soltarReloj } from '../ayudas/reloj'

/**
 * Comparador de regímenes (A3, fase 8 PR B). Hoy es el 15/10/2026: se leen octubre 2025 a septiembre
 * 2026. ArgosNet: R = Q126,510.71, renta fiscal Q37,700 (m = 29.80 %), opcional Q6,325.54 (todo al 5 %),
 * utilidades Q9,425 (el ISO de Q4,123.50 no es piso), m* = 20.00 %: el opcional paga Q3,099.46 menos.
 * Fibra del Sur: m = 14.23 %, utilidades paga menos.
 */

function dentro(raiz: HTMLElement, selector: string): HTMLElement {
    const elemento = raiz.querySelector<HTMLElement>(selector)
    if (!elemento) {
        throw new Error(`Sin ${selector}`)
    }
    return elemento
}

describe('comparador de regímenes', () => {
    beforeEach(() => {
        fijarHoyFixtures()
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
        useEmpresaActiva().elegir(1)
    })

    afterEach(() => {
        soltarReloj()
        sesionFixture(null)
        useUsuarioActual().value = null
    })

    it('textos y esquema del crecimiento, espejo del validador', () => {
        expect(esquemaCrecimiento.safeParse({ crecimiento: '' }).success).toBe(true)
        expect(esquemaCrecimiento.safeParse({ crecimiento: '1.50' }).success).toBe(true)
        expect(esquemaCrecimiento.safeParse({ crecimiento: '-99.99' }).success).toBe(true)
        expect(esquemaCrecimiento.safeParse({ crecimiento: '1.505' }).error?.issues[0]?.message).toContain('hasta 2 decimales')
        expect(esquemaCrecimiento.safeParse({ crecimiento: '-100' }).error?.issues[0]?.message).toBe('Debe ser mayor que −100 %')
        expect(valorSupuesto('isr_utilidades_tasa', '25.00')).toBe('25.00 %')
        expect(valorSupuesto('iso_tasa', null)).toBe('Sin valor vigente')
        expect(valorSupuesto('isr_opcional_tramos', { tramos: [{ desde: '0.01', hasta: '30000.00', fijo: '0.00', porcentaje: '5.00' }, { desde: '30000.01', hasta: null, fijo: '1500.00', porcentaje: '7.00' }] })).toContain('+ 7.00 % desde')
        expect(ETIQUETAS_BLOQUES_COMPARADOR.iso_piso).toBe('el ISO como piso')
        expect(mesComparador('2025-10')).toBe('oct 2025')
    })

    it('fixture: las fórmulas de la API, el crecimiento pedido y la validación', async () => {
        const resultado = await useComparadorRegimenes().comparar()
        if (!resultado.ok) {
            throw new Error(resultado.problema.title)
        }
        expect(resultado.data.aviso).toContain('no cambia el régimen')
        const argos = resultado.data.empresas[0]!
        expect(argos).toMatchObject({ empresa_id: 1, regimen: 'utilidades', desde: '2025-10-01', hasta: '2026-09-30' })
        expect(argos.bloques.datos.datos).toMatchObject({ meses_con_datos: 12, ventas_sin_iva: '126510.71', renta_fiscal: '37700.00', margen_fiscal: '29.80' })
        expect(argos.bloques.opcional.datos).toMatchObject({ isr_escala: '6325.54', isr_plano_art46: '8855.75' })
        expect(argos.bloques.utilidades.datos).toMatchObject({ tasa: '25.00', isr: '9425.00', perdida: false })
        expect(argos.bloques.iso_piso.datos).toMatchObject({ base: '412350.00', iso_anual: '4123.50' })
        expect(argos.bloques.comparacion.datos).toMatchObject({ anualizado: false, utilidades_con_iso: '9425.00', iso_es_piso: false, diferencia: '3099.46', menor: 'opcional_simplificado', margen_equilibrio: '20.00', margen_equilibrio_art46: '28.00' })
        expect(argos.bloques.proyeccion.datos).toMatchObject({ crecimiento_supuesto: 'tendencia', crecimiento_mensual: '0.44' })
        expect(argos.bloques.proyeccion.datos?.meses).toHaveLength(12)
        expect(argos.supuestos.map(s => s.clave)).toEqual(['isr_opcional_tramos', 'isr_opcional_directo', 'isr_utilidades_tasa', 'iso_tasa', 'iso_base'])
        expect(argos.matices.filter(m => m.confirmar_contador).map(m => m.clave)).toEqual(['art46_plano', 'iso'])

        const conCrecimiento = await useComparadorRegimenes().comparar('2.00')
        expect(conCrecimiento.ok && conCrecimiento.data.empresas[0]?.bloques.proyeccion.datos).toMatchObject({ crecimiento_supuesto: 'usuario', crecimiento_mensual: '2.00' })
        expect(conCrecimiento.ok && conCrecimiento.data.empresas[0]?.crecimiento).toBe('2.00')
        for (const malo of ['-100', 'abc', '1.234']) {
            const invalido = await useComparadorRegimenes().comparar(malo)
            expect(invalido.ok ? null : [invalido.problema.status, invalido.problema.errors?.[0]?.field]).toEqual([422, 'crecimiento'])
        }

        useEmpresaActiva().elegir('todas')
        const todas = await useComparadorRegimenes().comparar()
        const fibra = todas.ok ? todas.data.empresas.find(e => e.empresa_id === 2) : undefined
        expect(todas.ok && todas.data.empresas.map(e => e.empresa_id)).toEqual([1, 2])
        expect(fibra?.bloques.comparacion.datos).toMatchObject({ margen_fiscal: '14.23', menor: 'utilidades', regimen_actual: 'pequeno_contribuyente' })
    })

    it('pantalla: aviso siempre visible, tabla con m y m*, sin aplicar; el crecimiento recalcula la proyección', async () => {
        const pagina = await mountSuspended(PaginaComparador)
        const raiz = pagina.element as HTMLElement
        expect(dentro(raiz, '[data-prueba="comparador-aviso"]').textContent).toContain('no cambia el régimen')
        await esperar(() => expect(raiz.querySelector('[data-empresa="1"]')).not.toBeNull())

        const tabla = dentro(raiz, '[data-prueba="tabla-regimenes"]')
        expect(tabla.querySelector('[data-regimen="opcional_simplificado"]')?.textContent).toContain('Paga menos')
        expect(tabla.querySelector('[data-regimen="utilidades"]')?.textContent).toContain('Actual')
        expect(tabla.textContent).toContain('6,325.54')
        expect(tabla.textContent).toContain('9,425.00')
        expect(dentro(raiz, '[data-prueba="margen-m"]').textContent).toBe('29.80 %')
        expect(dentro(raiz, '[data-prueba="margen-equilibrio"]').textContent).toBe('20.00 %')
        expect(dentro(raiz, '[data-prueba="comparador-menor"]').textContent).toContain('3,099.46')
        expect([...raiz.querySelectorAll('button, a')].some(b => /aplicar/i.test(b.textContent ?? ''))).toBe(false)
        expect(dentro(raiz, '[data-prueba="comparador-sin-aplicar"]').querySelector('a')?.getAttribute('href')).toBe('/configuracion/fiscal')
        expect(dentro(raiz, '[data-supuesto="iso_tasa"]').textContent).toContain('1.00 %')
        expect(dentro(raiz, '[data-matiz="art46_plano"]').textContent).toContain('Confirmar con contador')
        expect(dentro(raiz, '[data-prueba="proyeccion-crecimiento"]').textContent).toContain('la tendencia de los meses leídos')

        const campo = dentro(raiz, 'input[data-prueba="campo-crecimiento"], [data-prueba="campo-crecimiento"] input') as HTMLInputElement
        campo.value = '2.5'
        campo.dispatchEvent(new Event('input'))
        dentro(raiz, '[data-prueba="form-crecimiento"]').dispatchEvent(new Event('submit'))
        await esperar(() => expect(dentro(raiz, '[data-prueba="proyeccion-crecimiento"]').textContent).toContain('2.50 % mensual'))
        expect(dentro(raiz, '[data-prueba="proyeccion-crecimiento"]').textContent).toContain('el que escribiste')

        campo.value = '-100'
        campo.dispatchEvent(new Event('input'))
        dentro(raiz, '[data-prueba="form-crecimiento"]').dispatchEvent(new Event('submit'))
        await esperar(() => expect(dentro(raiz, '[data-prueba="form-crecimiento"]').textContent).toContain('Debe ser mayor que −100 %'))
        // La simulación anterior sigue a la vista.
        expect(dentro(raiz, '[data-prueba="proyeccion-crecimiento"]').textContent).toContain('2.50 % mensual')
    })

    it('un parámetro sin valor: su bloque en error con «Reintentar» y sin cifras; los que dependen, con su motivo', async () => {
        bd.fiscal.valores.push({ id: 9001, pais: 'GT', empresa_id: 1, clave: 'iso_tasa', valor: null, vigente_desde: '2026-01-01', origen: 'usuario', motivo: 'Por confirmar', creado_por: 1, created_at: '2026-10-01T00:00:00.000Z', nivel: 'empresa' })
        const pagina = await mountSuspended(PaginaComparador)
        const raiz = pagina.element as HTMLElement
        await esperar(() => expect(raiz.querySelector('[data-empresa="1"]')).not.toBeNull())

        const iso = dentro(raiz, '[data-bloque="iso_piso"]')
        expect(iso.dataset.estado).toBe('error')
        expect(iso.textContent).toContain('iso_tasa')
        expect(iso.textContent).toContain('Reintentar')
        expect(iso.textContent).not.toMatch(/Q\s?\d/)
        for (const nombre of ['comparacion', 'proyeccion']) {
            const bloque = dentro(raiz, `[data-bloque="${nombre}"]`)
            expect(bloque.querySelector('[data-prueba="bloque-dependiente"]')?.textContent).toContain('depende de el ISO como piso')
            expect(bloque.textContent).not.toMatch(/Q\s?\d/)
            expect(bloque.querySelector('[data-prueba="tabla-regimenes"]')).toBeNull()
        }
        expect(dentro(raiz, '[data-bloque="opcional"]').dataset.estado).toBe('ok')
        expect(dentro(raiz, '[data-supuesto="iso_tasa"]').textContent).toContain('Sin valor vigente')
        expect(dentro(raiz, '[data-supuesto="iso_tasa"]').textContent).toContain('Confirmar con contador')
    })

    it('con menos de 12 meses leídos, el ISO como piso usa los ingresos anualizados (H37) y lo dice', async () => {
        // Al 15/08/2025 solo hay enero a julio de 2025 desde inicio_libros: 7 meses.
        vi.setSystemTime(new Date('2025-08-15T18:00:00.000Z'))
        const resultado = await useComparadorRegimenes().comparar()
        const iso = resultado.ok ? resultado.data.empresas[0]!.bloques.iso_piso.datos : null
        expect(iso).toMatchObject({ ingresos_anualizados: true })
        expect(iso?.ingresos_anuales).toBe(new Decimal(iso?.ingresos_brutos ?? '0').times(12).dividedBy(7).toDecimalPlaces(2).toFixed(2))
        const pagina = await mountSuspended(PaginaComparador)
        const raiz = pagina.element as HTMLElement
        await esperar(() => expect(raiz.querySelector('[data-prueba="iso-anualizado"]')).not.toBeNull())
        expect(dentro(raiz, '[data-bloque="iso_piso"]').textContent).toContain('Ingresos del año (anualizados)')

        // Con los 12 meses no se anualiza.
        vi.setSystemTime(new Date('2026-10-15T18:00:00.000Z'))
        const doce = await useComparadorRegimenes().comparar()
        expect(doce.ok && doce.data.empresas[0]!.bloques.iso_piso.datos).toMatchObject({ ingresos_anualizados: false, ingresos_anuales: '126510.71', ingresos_brutos: '126510.71' })
    })
})
