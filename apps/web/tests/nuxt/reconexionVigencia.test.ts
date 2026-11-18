import type { Schema } from '@argosisp/contracts'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import { meAdmin } from '~~/fixtures/auth/sesiones'
import { bd } from '~~/fixtures/bd'
import PlantillaFormulario from '~/components/PlantillaFormulario.vue'
import PromesaOrigen from '~/components/PromesaOrigen.vue'
import PaginaPromesas from '~/pages/promesas/index.vue'
import { esperar } from '../ayudas/esperar'

/**
 * Reconexión temporal (A3, 17 nov 2026): `reglas_promesa.reconexion_temporal.vigencia` en la
 * plantilla («Por horas» o «Hasta la medianoche», que no usa `horas_max`) y `motivo_reconexion` de
 * la promesa («Fuera de horario» o «Sin personal de caja»).
 */

const AYUDA_MEDIANOCHE = 'Dura hasta la siguiente medianoche (hora de Guatemala); si falta menos de una hora, hasta la del día siguiente'

function enCuerpo(selector: string): HTMLElement | null {
    return document.body.querySelector<HTMLElement>(selector)
}

function opcionVigencia(valor: 'horas' | 'medianoche'): HTMLElement | null {
    return enCuerpo(`[data-prueba="plantilla-reconexion-vigencia"] [role="radio"][value="${valor}"]`)
}

describe('vigencia de la reconexión temporal · esquema y cuerpo', () => {
    it('por defecto `horas`, como `REGLAS_PROMESA_POR_DEFECTO`, y así en las plantillas de los fixtures', () => {
        expect(entradaPlantillaVacia().reglas_promesa.reconexion_temporal.vigencia).toBe('horas')
        reiniciarFixtures()
        expect(bd.plantillas.map(p => p.reglas_promesa.reconexion_temporal?.vigencia)).toEqual(bd.plantillas.map(() => 'horas'))
    })

    it('las etiquetas son las del manual', () => {
        expect(VIGENCIAS_RECONEXION.map(v => ETIQUETAS_VIGENCIA_RECONEXION[v].etiqueta)).toEqual(['Por horas', 'Hasta la medianoche'])
        expect(ETIQUETAS_VIGENCIA_RECONEXION.medianoche.descripcion).toContain(AYUDA_MEDIANOCHE)
    })

    it('viaja en el cuerpo y el esquema espejo solo admite horas o medianoche', () => {
        const entrada = { ...entradaPlantillaVacia(), nombre: 'Hasta medianoche' }
        entrada.reglas_promesa.reconexion_temporal = { permitida: true, max_por_periodo: 2, horas_max: 24, vigencia: 'medianoche' }
        const cuerpo = cuerpoPlantilla(esquemaPlantilla.parse(entrada))
        expect(cuerpo.reglas_promesa?.reconexion_temporal).toEqual({ permitida: true, max_por_periodo: 2, horas_max: 24, vigencia: 'medianoche' })
        const invalida = esquemaPlantilla.safeParse({ ...entrada, reglas_promesa: { ...entrada.reglas_promesa, reconexion_temporal: { ...entrada.reglas_promesa.reconexion_temporal, vigencia: 'semana' } } })
        expect(!invalida.success && invalida.error.issues.map(i => i.path.join('.'))).toContain('reglas_promesa.reconexion_temporal.vigencia')
    })

    it('el resumen dice «hasta la medianoche» en vez de las horas', () => {
        reiniciarFixtures()
        const reglas = bd.plantillas[0]!.reglas_promesa
        expect(resumenReconexionTemporal({ ...reglas, reconexion_temporal: { permitida: true, max_por_periodo: 1, horas_max: 24, vigencia: 'medianoche' } }))
            .toBe('Reconexión temporal: hasta 1 por periodo · hasta la medianoche')
        expect(resumenReconexionTemporal({ ...reglas, reconexion_temporal: { permitida: true, max_por_periodo: 1, horas_max: 12, vigencia: 'horas' } }))
            .toBe('Reconexión temporal: hasta 1 por periodo · 12 h')
    })
})

describe('vigencia de la reconexión temporal · formulario', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
    })

    it('«Hasta la medianoche» oculta las horas, explica la vigencia y se guarda; «Por horas» las vuelve a mostrar', async () => {
        const guardada = bd.plantillas[0]!
        guardada.reglas_promesa.reconexion_temporal = { permitida: true, max_por_periodo: 1, horas_max: 24, vigencia: 'horas' }
        const wrapper = await mountSuspended(PlantillaFormulario, { props: { plantilla: structuredClone(guardada), open: true } })
        await esperar(() => expect(opcionVigencia('medianoche')).not.toBeNull())
        expect(document.body.textContent).toContain('Vigencia')
        expect(document.body.textContent).toContain('Por horas')
        expect(document.body.textContent).toContain('Hasta la medianoche')
        expect(enCuerpo('[data-prueba="plantilla-reconexion-horas"]')).not.toBeNull()
        expect(opcionVigencia('horas')?.getAttribute('aria-checked')).toBe('true')

        opcionVigencia('medianoche')?.click()
        await esperar(() => expect(enCuerpo('[data-prueba="plantilla-reconexion-horas"]')).toBeNull())
        expect(opcionVigencia('medianoche')?.getAttribute('aria-checked')).toBe('true')
        expect(enCuerpo('[data-prueba="plantilla-reconexion-temporal"]')?.textContent).toContain(AYUDA_MEDIANOCHE)

        opcionVigencia('horas')?.click()
        await esperar(() => expect(enCuerpo('[data-prueba="plantilla-reconexion-horas"]')).not.toBeNull())
        expect(enCuerpo('[data-prueba="plantilla-reconexion-temporal"]')?.textContent).not.toContain(AYUDA_MEDIANOCHE)

        opcionVigencia('medianoche')?.click()
        await esperar(() => expect(enCuerpo('[data-prueba="plantilla-reconexion-horas"]')).toBeNull())
        enCuerpo('[data-prueba="plantilla-guardar"]')?.click()
        await esperar(() => expect(wrapper.emitted('guardado')).toHaveLength(1))
        const emitida = wrapper.emitted('guardado')?.[0]?.[0] as Schema<'PlantillaFacturacion'>
        expect(emitida.reglas_promesa.reconexion_temporal?.vigencia).toBe('medianoche')
        expect(bd.plantillas[0]!.reglas_promesa.reconexion_temporal).toMatchObject({ permitida: true, vigencia: 'medianoche', horas_max: 24 })
        wrapper.unmount()
    })
})

describe('motivo de la reconexión temporal', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
    })

    it('etiquetas del manual; null en las promesas normales', () => {
        expect(etiquetaMotivoReconexion({ motivo_reconexion: 'fuera_de_horario' })).toBe('Fuera de horario')
        expect(etiquetaMotivoReconexion({ motivo_reconexion: 'sin_personal' })).toBe('Sin personal de caja')
        expect(etiquetaMotivoReconexion({ motivo_reconexion: null })).toBeNull()
    })

    it('los fixtures lo traen siempre, como la API: null fuera de las reconexiones', () => {
        expect(bd.promesas.every(p => p.motivo_reconexion !== undefined)).toBe(true)
        expect(bd.promesas.filter(p => p.tipo !== 'reconexion_temporal').every(p => p.motivo_reconexion === null)).toBe(true)
        expect(bd.promesas.filter(p => p.tipo === 'reconexion_temporal').map(p => p.motivo_reconexion).sort()).toEqual(['fuera_de_horario', 'sin_personal'])
    })

    it('el origen de la promesa lo muestra solo en la reconexión', async () => {
        const reconexion = bd.promesas.find(p => p.motivo_reconexion === 'sin_personal')!
        const conMotivo = await mountSuspended(PromesaOrigen, { props: { promesa: reconexion } })
        expect(conMotivo.find('[data-prueba="promesa-motivo-reconexion"]').text()).toBe('Sin personal de caja')
        conMotivo.unmount()
        const normal = bd.promesas.find(p => p.tipo === 'promesa')!
        const sinMotivo = await mountSuspended(PromesaOrigen, { props: { promesa: normal } })
        expect(sinMotivo.find('[data-prueba="promesa-motivo-reconexion"]').exists()).toBe(false)
        sinMotivo.unmount()
    })

    it('la lista de promesas muestra «Fuera de horario» y «Sin personal de caja»', async () => {
        const wrapper = await mountSuspended(PaginaPromesas, { route: '/promesas?tipo=reconexion_temporal' })
        await esperar(() => expect(wrapper.findAll('[data-prueba="promesa-motivo-reconexion"]').length).toBe(2))
        expect(wrapper.findAll('[data-prueba="promesa-motivo-reconexion"]').map(e => e.text()).sort()).toEqual(['Fuera de horario', 'Sin personal de caja'])
        wrapper.unmount()
    })

    it('la bitácora traduce el motivo de la acción de reconexión', () => {
        const accion = bd.acciones.find(a => a.accion === 'comprobantes.reconexion_temporal')!
        expect(motivoAccion(accion)).toBe('Fuera de horario')
        expect(motivoAccion({ ...accion, entrada: { motivo: 'sin_personal' } })).toBe('Sin personal de caja')
        expect(motivoAccion({ ...accion, accion: 'servicios.suspender', entrada: { motivo: 'fuera_de_horario' } })).toBe('fuera_de_horario')
    })
})
