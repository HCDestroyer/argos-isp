import { mountSuspended } from '@nuxt/test-utils/runtime'
import type { Component } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reiniciarFixtures, sesionFixture, simularFalla } from '~~/fixtures'
import { meAdmin } from '~~/fixtures/auth/sesiones'
import { bd } from '~~/fixtures/bd'
import { UApp } from '#components'
import PlantillaAsignarSinPlantillaModal from '~/components/PlantillaAsignarSinPlantillaModal.vue'
import PaginaPlantillas from '~/pages/plantillas/index.vue'
import { esperar } from '../ayudas/esperar'

/**
 * Plantillas de fábrica (decisión del PM, 18 nov): «Asignar a servicios sin plantilla» con su vista
 * previa (total, por estado, desde cuándo se cobra y la muestra), el caso de 0 servicios, la
 * confirmación, el 409 `total_cambiado` que vuelve a pedir la vista previa, el error con «Reintentar»
 * y «Marcar como por defecto» para «Genera 1 · vence 15».
 */

const VISTA_PREVIA = 'GET /api/v1/plantillas-facturacion/:id/servicios-sin-plantilla'
/** «Genera 1 · vence 15» en los fixtures. */
const GENERA_1_VENCE_15 = 3

function enApp(componente: Component, props: Record<string, unknown> = {}) {
    return defineComponent({ render: () => h(UApp, null, { default: () => h(componente, props) }) })
}

function enCuerpo(prueba: string): HTMLElement | null {
    return document.body.querySelector<HTMLElement>(`[data-prueba="${prueba}"]`)
}

function titulosAvisos(): string[] {
    return useToast().toasts.value.map(t => String(t.title))
}

async function abrirModal() {
    const plantilla = bd.plantillas.find(p => p.id === GENERA_1_VENCE_15)!
    return mountSuspended(enApp(PlantillaAsignarSinPlantillaModal, { plantilla, open: true }))
}

function sinPlantilla() {
    return bd.servicios.filter(s => s.plantilla_facturacion_id === null)
}

describe('plantillas · asignar a servicios sin plantilla', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
        useToast().clear()
        // 18 nov en Guatemala: «Genera 1» cobra desde el 1 de diciembre.
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(new Date('2026-11-18T18:00:00.000Z'))
    })

    afterEach(() => {
        vi.useRealTimers()
        sesionFixture(null)
        useUsuarioActual().value = null
        document.body.innerHTML = ''
    })

    it('las fixtures traen las tres plantillas de fábrica y servicios sin plantilla de cada estado', () => {
        expect(bd.plantillas.map(p => p.nombre)).toEqual(expect.arrayContaining(['Genera 1 · vence 15', 'Genera 14 · vence 29', 'Genera 1 · vence 5']))
        expect(bd.plantillas.find(p => p.nombre === 'Genera 14 · vence 29')).toMatchObject({ ciclo: 'dia_fijo', dia: 14, dias_gracia: 15, por_defecto: false })
        expect(new Set(sinPlantilla().map(s => s.estado))).toEqual(new Set(['activo', 'limitado', 'suspendido']))
    })

    it('la vista previa muestra el total, el desglose, desde cuándo se cobra y la muestra', async () => {
        const vista = await abrirModal()
        await esperar(() => expect(enCuerpo('sin-plantilla-total')?.textContent).toContain('5 servicios sin plantilla'))
        const desglose = enCuerpo('sin-plantilla-por-estado')!
        expect(desglose.querySelector('[data-estado="activo"]')?.textContent).toContain('3')
        expect(desglose.querySelector('[data-estado="limitado"]')?.textContent).toContain('1')
        expect(desglose.querySelector('[data-estado="suspendido"]')?.textContent).toContain('1')
        expect(enCuerpo('sin-plantilla-desde')?.textContent).toContain('Se cobra desde el 01/12/2026; no se cobra nada atrasado')
        const filas = enCuerpo('sin-plantilla-muestra')!.querySelectorAll('[data-servicio]')
        expect(filas).toHaveLength(5)
        expect(enCuerpo('sin-plantilla-muestra')?.textContent).toContain('Silvia Patricia Orellana')
        expect(enCuerpo('asignar-sin-plantilla-confirmar')?.textContent).toContain('Asignar a 5 servicios')
        vista.unmount()
    })

    it('con 0 servicios dice «No hay servicios sin plantilla» y no ofrece confirmar', async () => {
        for (const servicio of sinPlantilla()) {
            servicio.plantilla_facturacion_id = 1
        }
        const vista = await abrirModal()
        await esperar(() => expect(enCuerpo('sin-plantilla-vacio')?.textContent).toContain('No hay servicios sin plantilla'))
        expect(enCuerpo('asignar-sin-plantilla-confirmar')).toBeNull()
        expect(enCuerpo('sin-plantilla-muestra')).toBeNull()
        vista.unmount()
    })

    it('al confirmar manda el total esperado, asigna y avisa «N servicios asignados»', async () => {
        const vista = await abrirModal()
        await esperar(() => expect(enCuerpo('asignar-sin-plantilla-confirmar')).not.toBeNull())
        enCuerpo('asignar-sin-plantilla-confirmar')!.click()
        await esperar(() => expect(titulosAvisos()).toContain('5 servicios asignados'))
        expect(sinPlantilla()).toHaveLength(0)
        expect(bd.servicios.filter(s => s.plantilla_facturacion_id === GENERA_1_VENCE_15)).toHaveLength(5)
        expect(bd.acciones.some(e => e.accion === 'plantillas.asignar_sin_plantilla')).toBe(true)
        vista.unmount()
    })

    it('un 409 total_cambiado avisa, vuelve a pedir la vista previa y se confirma con el total nuevo', async () => {
        const vista = await abrirModal()
        await esperar(() => expect(enCuerpo('sin-plantilla-total')?.textContent).toContain('5 servicios'))
        // Otra persona le pone plantilla a uno mientras el diálogo está abierto.
        sinPlantilla()[0]!.plantilla_facturacion_id = 1
        enCuerpo('asignar-sin-plantilla-confirmar')!.click()
        await esperar(() => expect(titulosAvisos()).toContain('Cambió la cantidad de servicios sin plantilla'))
        await esperar(() => expect(enCuerpo('sin-plantilla-total')?.textContent).toContain('4 servicios sin plantilla'))
        expect(sinPlantilla()).toHaveLength(4)

        enCuerpo('asignar-sin-plantilla-confirmar')!.click()
        await esperar(() => expect(titulosAvisos()).toContain('4 servicios asignados'))
        expect(sinPlantilla()).toHaveLength(0)
        vista.unmount()
    })

    it('si la vista previa falla muestra el error con «Reintentar» y sin totales', async () => {
        simularFalla(VISTA_PREVIA, 500)
        const vista = await abrirModal()
        await esperar(() => expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain('Error interno'))
        expect(enCuerpo('sin-plantilla-total')).toBeNull()
        expect(enCuerpo('asignar-sin-plantilla-confirmar')).toBeNull()
        const reintentar = [...document.body.querySelectorAll<HTMLElement>('[role="dialog"] button')].find(b => b.textContent?.includes('Reintentar'))
        expect(reintentar).toBeDefined()

        bd.fallas = {}
        reintentar!.click()
        await esperar(() => expect(enCuerpo('sin-plantilla-total')?.textContent).toContain('5 servicios sin plantilla'))
        vista.unmount()
    })

    it('una plantilla retirada responde 409 plantilla_retirada', async () => {
        const plantilla = bd.plantillas.find(p => p.id === GENERA_1_VENCE_15)!
        plantilla.retirada_en = '2026-11-01T00:00:00.000Z'
        const vista = await usePlantillas().vistaPreviaSinPlantilla(plantilla.id)
        expect(!vista.ok && codigoProblema(vista.problema)).toBe('plantilla_retirada')
        const asignada = await usePlantillas().asignarSinPlantilla(plantilla.id, 5, nuevaClaveIdempotencia())
        expect(!asignada.ok && codigoProblema(asignada.problema)).toBe('plantilla_retirada')
    })

    it('la lista ofrece asignar con la de por defecto y marcar «Genera 1 · vence 15» como por defecto', async () => {
        const pagina = await mountSuspended(enApp(PaginaPlantillas))
        await esperar(() => expect(pagina.find('[data-plantilla="3"]').exists()).toBe(true))
        expect(pagina.find('[data-prueba="asignar-sin-plantilla"]').exists()).toBe(true)
        // Rediseño: la plantilla abierta ofrece asignar al pie de su tarjeta.
        await pagina.find(`[data-plantilla="${GENERA_1_VENCE_15}"] button`).trigger('click')
        await esperar(() => expect(pagina.find(`[data-prueba="asignar-sin-plantilla-${GENERA_1_VENCE_15}"]`).exists()).toBe(true))
        const aviso = pagina.get('[data-prueba="marcar-por-defecto"]')
        expect(aviso.text()).toContain('Genera 1 · vence 15 no es la plantilla por defecto')
        await aviso.findAll('button').find(b => b.text().includes('Marcar como por defecto'))!.trigger('click')
        await esperar(() => expect(titulosAvisos()).toContain('Genera 1 · vence 15 es la plantilla por defecto'))
        expect(bd.plantillas.filter(p => p.por_defecto).map(p => p.nombre)).toEqual(['Genera 1 · vence 15'])
        await esperar(() => expect(pagina.find('[data-prueba="marcar-por-defecto"]').exists()).toBe(false))
        expect(pagina.find('[data-plantilla="3"] [data-prueba="plantilla-defecto"]').exists()).toBe(true)
        pagina.unmount()
    })

    it('sin el permiso no se ve el botón de asignar', async () => {
        useUsuarioActual().value = { ...meAdmin, permisos: meAdmin.permisos.filter(p => p !== 'plantillas.asignar_sin_plantilla') }
        const pagina = await mountSuspended(enApp(PaginaPlantillas))
        await esperar(() => expect(pagina.find('[data-plantilla="3"]').exists()).toBe(true))
        expect(pagina.find('[data-prueba="asignar-sin-plantilla"]').exists()).toBe(false)
        expect(pagina.find(`[data-prueba="asignar-sin-plantilla-${GENERA_1_VENCE_15}"]`).exists()).toBe(false)
        pagina.unmount()
    })
})
