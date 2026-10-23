import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import meAdmin from '~~/fixtures/auth/me.admin.json'
import { bd } from '~~/fixtures/bd'
import PaginaTablero from '~/pages/fiscal/tablero.vue'
import { esperar } from '../ayudas/esperar'
import { fijarHoyFixtures, soltarReloj } from '../ayudas/reloj'

/**
 * Consejos fiscales (A3, fase 8 PR C). Hoy es el 15/10/2026. ArgosNet: aplican «el otro régimen pagaría
 * menos» (comparador: Q3,099.46) y «libros atrasados» (tablero); el del pequeño contribuyente no aplica
 * por régimen. Fibra del Sur: libros atrasados y FEL desactivada.
 */

function dentro(raiz: ParentNode, selector: string): HTMLElement {
    const elemento = raiz.querySelector<HTMLElement>(selector)
    if (!elemento) {
        throw new Error(`Sin ${selector}`)
    }
    return elemento
}

async function listar() {
    const resultado = await useConsejosFiscales().listar()
    if (!resultado.ok) {
        throw new Error(resultado.problema.title)
    }
    return resultado.data
}

function sinIsoTasa() {
    bd.fiscal.valores.push({ id: 9001, pais: 'GT', empresa_id: 1, clave: 'iso_tasa', valor: null, vigente_desde: '2026-01-01', origen: 'usuario', motivo: 'Por confirmar', creado_por: 1, created_at: '2026-10-01T00:00:00.000Z', nivel: 'empresa' })
}

describe('consejos fiscales', () => {
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

    it('fixture: estados con las cifras del tablero y del comparador, sin datos y ocultos', async () => {
        const { aviso, empresas } = await listar()
        expect(aviso).toBe('Referencia; valídelo con su contador')
        const argos = empresas[0]!
        const estados = Object.fromEntries(argos.consejos.map(c => [c.clave, c.estado]))
        expect(estados).toEqual({
            pago_antes_requerimiento: 'aplica',
            retenciones_sin_enterar: 'no_aplica',
            iso_por_vencer: 'no_aplica',
            forma_pago_trimestral: 'no_aplica',
            regimen_simulado: 'aplica',
            limite_pequeno: 'no_aplica',
            libros_atrasados: 'aplica',
            fel_desactivada: 'no_aplica',
            compras_sin_nit: 'no_aplica',
            incobrables_sin_usar: 'no_aplica',
            depreciacion_bajo_maximo: 'aplica',
            credito_por_vencer: 'no_aplica',
        })
        expect(argos.consejos.find(c => c.clave === 'depreciacion_bajo_maximo')?.texto).toContain('gasto deducible anual sería Q1439.64 mayor')
        expect(argos.consejos.find(c => c.clave === 'credito_por_vencer')).toMatchObject({ fuentes: [], motivo: expect.stringContaining('sin_caso') })
        const simulado = argos.consejos.find(c => c.clave === 'regimen_simulado')!
        expect(simulado.texto).toContain('pagaría Q3099.46 menos')
        expect(simulado).toMatchObject({ fuentes: ['comparador.comparacion'], confirmar_contador: true, oculto: false, oculto_por: null, datos: { menor: 'opcional_simplificado', margen_equilibrio: '20.00' } })
        expect(argos.consejos.find(c => c.clave === 'limite_pequeno')?.motivo).toBe('regimen_utilidades')

        // Con lo vencido calculado: pago antes del requerimiento (mora del tablero) y retenciones por enterar.
        await useDeclaraciones().calcular({ impuesto: 'retenciones_isr', periodo: '2026-09', sustitutiva: false }, 'consejos-ret')
        const conMora = (await listar()).empresas[0]!.consejos
        // H36: el IVA de agosto presentado sin pagar ya contaba (Q5.66); se suma la de septiembre (Q0.45).
        expect(conMora.find(c => c.clave === 'pago_antes_requerimiento')).toMatchObject({ estado: 'aplica', datos: { vencidas: 2, mora_estimada: '6.11' } })
        expect(conMora.find(c => c.clave === 'retenciones_sin_enterar')?.texto).toContain('Q300.00 de retenciones por enterar')

        // Un bloque fuente en error: sin_datos con su problema y sin texto.
        sinIsoTasa()
        const sinDatos = (await listar()).empresas[0]!.consejos.find(c => c.clave === 'regimen_simulado')!
        expect(sinDatos).toMatchObject({ estado: 'sin_datos', texto: null, datos: null, error: { status: 422, type: 'urn:argosisp:problema:bloque_dependiente' } })

        // Ocultar para la empresa y mostrar solo para mí: el del usuario manda.
        const oculto = await useConsejosFiscales().ocultar('libros_atrasados', { empresa_id: 1, alcance: 'empresa', motivo: 'Lo lleva el contador' }, 'consejo-1')
        expect(oculto.ok && oculto.data).toMatchObject({ clave: 'libros_atrasados', oculto: true, alcance: 'empresa', usuario_id: null })
        expect((await listar()).empresas[0]!.consejos.find(c => c.clave === 'libros_atrasados')).toMatchObject({ oculto: true, oculto_por: 'empresa' })
        await useConsejosFiscales().mostrar('libros_atrasados', { empresa_id: 1, alcance: 'usuario' }, 'consejo-2')
        expect((await listar()).empresas[0]!.consejos.find(c => c.clave === 'libros_atrasados')).toMatchObject({ oculto: false, oculto_por: null })
        expect(bd.acciones.filter(a => a.accion === 'fiscal.ocultar_consejo')).toHaveLength(2)
        const inexistente = await useConsejosFiscales().ocultar('no_existe', {}, 'consejo-3')
        expect(inexistente.ok ? null : inexistente.problema.status).toBe(404)
        expect(etiquetaAccion('fiscal.ocultar_consejo')).toBe('Consejo fiscal ocultado o mostrado')
        expect(rutaEntidad('consejo_fiscal', 1)).toBe('/fiscal/tablero')
    })

    it('tablero: solo los que aplican; ocultar para la empresa, verlos y mostrar', async () => {
        const pagina = await mountSuspended(PaginaTablero)
        const raiz = pagina.element as HTMLElement
        await esperar(() => expect(raiz.querySelector('[data-consejos="1"]')).not.toBeNull())
        const seccion = dentro(raiz, '[data-consejos="1"]')
        expect([...seccion.querySelectorAll<HTMLElement>('[data-consejo]')].map(e => e.dataset.consejo)).toEqual(['pago_antes_requerimiento', 'regimen_simulado', 'libros_atrasados', 'depreciacion_bajo_maximo'])
        const simulado = dentro(seccion, '[data-consejo="regimen_simulado"]')
        expect(simulado.textContent).toContain('Confirmar con contador')
        expect(simulado.textContent).toContain('Fuente: inv. E.1 (comparador de regímenes)')
        expect(simulado.textContent).toContain('Referencia; valídelo con su contador')

        dentro(seccion, '[data-consejo="libros_atrasados"] [data-prueba="ocultar-empresa"]').click()
        await esperar(() => expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Ocultar para la empresa'))
        const motivo = dentro(document, '[role="dialog"] textarea') as HTMLTextAreaElement
        motivo.value = 'Lo lleva el contador'
        motivo.dispatchEvent(new Event('input'))
        dentro(document, '#form-ocultar-consejo').dispatchEvent(new Event('submit'))
        await esperar(() => expect(raiz.querySelector('[data-consejos="1"] [data-consejo="libros_atrasados"]')).toBeNull())
        expect(bd.consejosOcultos.at(-1)).toMatchObject({ clave: 'libros_atrasados', oculto: true, usuario_id: null, motivo: 'Lo lleva el contador' })
        expect(dentro(raiz, '[data-consejos="1"] [data-prueba="ver-ocultos"]').textContent).toContain('Ver ocultos (1)')

        dentro(raiz, '[data-consejos="1"] [data-prueba="ver-ocultos"] button').click()
        await esperar(() => expect(raiz.querySelector('[data-consejos="1"] [data-consejo="libros_atrasados"] [data-prueba="consejo-oculto"]')?.textContent).toContain('Oculto para la empresa'))
        dentro(raiz, '[data-consejos="1"] [data-consejo="libros_atrasados"] [data-prueba="mostrar-consejo"]').click()
        await esperar(() => expect(raiz.querySelector('[data-consejos="1"] [data-consejo="libros_atrasados"] [data-prueba="consejo-oculto"]')).toBeNull())
        expect(bd.consejosOcultos.at(-1)).toMatchObject({ clave: 'libros_atrasados', oculto: false, alcance: 'empresa' })
    })

    it('sin datos: solo con el interruptor, con el error de su bloque y sin texto; lectura no oculta', async () => {
        sinIsoTasa()
        useUsuarioActual().value = { ...meAdmin, permisos: meAdmin.permisos.filter(p => p !== 'fiscal.configurar') }
        const pagina = await mountSuspended(PaginaTablero)
        const raiz = pagina.element as HTMLElement
        await esperar(() => expect(raiz.querySelector('[data-consejos="1"]')).not.toBeNull())
        expect(raiz.querySelector('[data-consejos="1"] [data-consejo="regimen_simulado"]')).toBeNull()
        expect(dentro(raiz, '[data-consejos="1"] [data-prueba="ver-sin-datos"]').textContent).toContain('Ver sin datos (1)')
        expect(raiz.querySelector('[data-prueba="ocultar-empresa"], [data-prueba="ocultar-usuario"]')).toBeNull()

        dentro(raiz, '[data-consejos="1"] [data-prueba="ver-sin-datos"] button').click()
        await esperar(() => expect(raiz.querySelector('[data-consejos="1"] [data-consejo="regimen_simulado"]')).not.toBeNull())
        const consejo = dentro(raiz, '[data-consejos="1"] [data-consejo="regimen_simulado"]')
        expect(consejo.dataset.estado).toBe('sin_datos')
        expect(consejo.querySelector('[data-prueba="consejo-texto"]')).toBeNull()
        expect(consejo.textContent).toContain('Reintentar')
        expect(consejo.textContent).not.toMatch(/Q\s?\d/)
    })
})
