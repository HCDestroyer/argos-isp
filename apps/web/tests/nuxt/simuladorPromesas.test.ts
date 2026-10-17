import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import meAdmin from '~~/fixtures/auth/me.admin.json'
import PromesaSimularModal from '~/components/PromesaSimularModal.vue'

function enDias(dias: number): string {
    return sumarDiasFecha(hoyGuatemala(), dias)
}

function enCuerpo(selector: string): HTMLElement | null {
    return document.body.querySelector<HTMLElement>(selector)
}

describe('semana 2 · simulador de promesas', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
        document.body.innerHTML = ''
    })

    it('estado de cada regla, decisión y origen del límite', () => {
        expect(estadoRegla({ ok: true, aplica: true })).toBe('cumple')
        expect(estadoRegla({ ok: false, aplica: true })).toBe('falla')
        expect(estadoRegla({ ok: true, aplica: false })).toBe('no_aplica')
        expect(decisionSimulacion('pendiente_aprobacion')).toBe('pendiente')
        expect(decisionSimulacion('rechazada')).toBe('rechazada')
        expect(origenRegla({ origen: 'general' })).toBeNull()
        expect(origenRegla({ origen: 'portal' })).toBe('Límite del canal Portal del cliente')
        expect(creableDesdeSimulacion({ resultado_creacion: 'rechazada', canal: 'operador' })).toBe(false)
        expect(creableDesdeSimulacion({ resultado_creacion: 'pendiente_aprobacion', canal: 'supervisor' })).toBe(true)
        expect(creableDesdeSimulacion({ resultado_creacion: 'error', canal: 'operador' })).toBe(false)
        expect(creableDesdeSimulacion({ resultado_creacion: 'aprobada', canal: 'portal' })).toBe(false)
        expect(abonoFaltante({ abono_requerido: '50.00', abono_pagado: '20.10' }).toFixed(2)).toBe('29.90')
        expect(abonoFaltante({ abono_requerido: '0.00', abono_pagado: '20.00' }).toFixed(2)).toBe('0.00')
    })

    it('el cuerpo omite lo vacío (la API pone la deuda y mañana) y manda el fin del día', () => {
        expect(cuerpoSimulacion({ servicio_id: 2, monto: '', vence: '', canal: 'portal' })).toEqual({ servicio_id: 2, canal: 'portal' })
        expect(cuerpoSimulacion({ servicio_id: 2, monto: '150', vence: '2026-10-20', canal: 'operador' }))
            .toEqual({ servicio_id: 2, canal: 'operador', monto: '150.00', vence_en: '2026-10-21T05:59:59.999Z' })
        expect(esquemaSimulacion.safeParse({ servicio_id: 0, monto: '', vence: '', canal: 'operador' }).success).toBe(false)
        expect(esquemaSimulacion.safeParse({ servicio_id: 2, monto: '1,5', vence: '', canal: 'operador' }).success).toBe(false)
    })

    it('simular evalúa todas las reglas sin crear nada', async () => {
        const antes = await usePromesas().listar({ servicio_id: 2 })
        const largo = await usePromesas().simular({ servicio_id: 2, canal: 'operador', vence_en: finDiaGuatemala(enDias(10)) })
        expect(largo.ok).toBe(true)
        if (!largo.ok) {
            return
        }
        expect(largo.data.resultado).toBe('rechazada')
        expect(largo.data.regla).toBe('plazo_max_dias')
        // No se detiene en la que falla: siguen las demás.
        expect(largo.data.reglas.map(r => r.regla)).toContain('max_por_periodo')
        expect(largo.data.reglas.find(r => r.regla === 'plazo_max_dias')?.ok).toBe(false)
        const despues = await usePromesas().listar({ servicio_id: 2 })
        expect(despues.ok && antes.ok && despues.data.data.length).toBe(antes.ok ? antes.data.data.length : -1)

        const excedido = await usePromesas().simular({ servicio_id: 2, canal: 'operador', monto: '99999.00' })
        expect(excedido.ok && excedido.data.resultado_creacion).toBe('error')
        expect(excedido.ok && excedido.data.validaciones.find(v => !v.ok)?.regla).toBe('monto_maximo')
    })

    it('el modal muestra regla por regla y crea con los datos simulados', async () => {
        const servicio = await useServicios().ver(2)
        expect(servicio.ok).toBe(true)
        if (!servicio.ok) {
            return
        }
        const creadas: Promesa[] = []
        const wrapper = await mountSuspended(PromesaSimularModal, {
            props: { servicio: servicio.data, open: true, onCreada: (p: Promesa) => creadas.push(p) },
        })
        const formulario = enCuerpo('#form-simular-promesa')
        expect(formulario).not.toBeNull()
        formulario?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
        await vi.waitFor(() => expect(enCuerpo('[data-prueba="simulacion"]')).not.toBeNull())
        const texto = enCuerpo('[data-prueba="simulacion-reglas"]')?.textContent ?? ''
        expect(texto).toContain('Plazo máximo')
        expect(texto).toContain('Máximo por periodo')
        expect(enCuerpo('[data-prueba="regla-plazo_max_dias"]')?.dataset.estado).toBe('cumple')
        expect(enCuerpo('[data-prueba="simulacion-decision"]')?.textContent).toBeTruthy()

        enCuerpo('[data-prueba="crear-simulada"]')?.click()
        await vi.waitFor(() => expect(enCuerpo('[data-prueba="simulador-creada"]')).not.toBeNull())
        expect(creadas).toHaveLength(1)
        expect(creadas[0]?.servicio_id).toBe(2)
        wrapper.unmount()
    })
})
