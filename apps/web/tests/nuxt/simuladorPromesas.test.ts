import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import { meAdmin } from '~~/fixtures/auth/sesiones'
import { bd } from '~~/fixtures/bd'
import PromesaSimularModal from '~/components/PromesaSimularModal.vue'
import { esperar } from '../ayudas/esperar'
import { fijarHoyFixtures, soltarReloj } from '../ayudas/reloj'

function enDias(dias: number): string {
    return sumarDiasFecha(hoyGuatemala(), dias)
}

function enCuerpo(selector: string): HTMLElement | null {
    return document.body.querySelector<HTMLElement>(selector)
}

describe('semana 2 · simulador de promesas', () => {
    beforeEach(() => {
        // Promesas a pocos días: sin fecha fija, a fin de mes caen en la siguiente facturación.
        fijarHoyFixtures()
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
    })

    afterEach(() => {
        soltarReloj()
        sesionFixture(null)
        useUsuarioActual().value = null
        // Sin vaciar el body: tests/setup.ts desmonta todo después (vaciarlo antes rompía el desmontaje).
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

    it('el cuerpo nunca lleva monto, omite lo vacío (la API pone mañana) y manda el fin del día', () => {
        expect(cuerpoSimulacion({ servicio_id: 2, vence: '', canal: 'portal' })).toEqual({ servicio_id: 2, canal: 'portal' })
        expect(cuerpoSimulacion({ servicio_id: 2, vence: '2026-10-20', canal: 'operador' }))
            .toEqual({ servicio_id: 2, canal: 'operador', vence_en: '2026-10-21T05:59:59.999Z' })
        expect(esquemaSimulacion.safeParse({ servicio_id: 0, vence: '', canal: 'operador' }).success).toBe(false)
        expect(esquemaSimulacion.safeParse({ servicio_id: 2, vence: '20/10', canal: 'operador' }).success).toBe(false)
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

        // Cubre todo lo vencido: monto y facturas los responde la API; ya no hay validaciones de monto.
        expect(largo.data.monto).toBe('300.00')
        expect(largo.data.facturas?.map(f => f.factura_id)).toEqual([209, 210])
        expect(largo.data.limites).toMatchObject({ monto_promesa: '300.00', abono_requerido: '0.00', abono_pagado: '0.00' })
        expect(largo.data.validaciones.map(v => v.campo)).toEqual(['vence_en', 'servicio_id'])

        // Con una promesa abierta, crear daría 409: `resultado_creacion = error`.
        const servicioConPromesa = bd.promesas.find(p => p.id === 3)?.servicio_id ?? 0
        const abierta = await usePromesas().simular({ servicio_id: servicioConPromesa, canal: 'operador' })
        expect(abierta.ok && abierta.data.resultado_creacion).toBe('error')
        expect(abierta.ok && abierta.data.validaciones.find(v => !v.ok)).toMatchObject({ regla: 'promesa_abierta', detalle: 'Ya tiene la promesa 3 activa' })
        expect(abierta.ok && motivoNoCreable(abierta.data)).toBe('Ya tiene la promesa 3 activa: ciérrala antes de crear otra.')
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
        await esperar(() => expect(enCuerpo('[data-prueba="simulacion"]')).not.toBeNull())
        const texto = enCuerpo('[data-prueba="simulacion-reglas"]')?.textContent ?? ''
        expect(texto).toContain('Plazo máximo')
        expect(texto).toContain('Máximo por periodo')
        expect(enCuerpo('[data-prueba="regla-plazo_max_dias"]')?.dataset.estado).toBe('cumple')
        expect(enCuerpo('[data-prueba="simulacion-decision"]')?.textContent).toBeTruthy()
        // Sin campo de monto: la simulación muestra las facturas que cubriría y el total.
        expect(enCuerpo('#form-simular-promesa input[inputmode="decimal"]')).toBeNull()
        expect(enCuerpo('[data-prueba="cobertura-total"]')?.textContent).toBe('Q 300.00')
        expect(document.body.querySelectorAll('[data-prueba="factura-cubierta"]')).toHaveLength(2)

        enCuerpo('[data-prueba="crear-simulada"]')?.click()
        await esperar(() => expect(enCuerpo('[data-prueba="simulador-creada"]')).not.toBeNull())
        expect(creadas).toHaveLength(1)
        expect(creadas[0]).toMatchObject({ servicio_id: 2, monto: '300.00', regla_cumplimiento: 'facturas' })
        // La regla de cumplimiento, tal como la devuelve la API.
        expect(enCuerpo('[data-prueba="regla-cumplimiento"]')?.textContent).toContain('Cumplimiento: por facturas')
        expect(document.body.querySelectorAll('[data-prueba="facturas-promesa"] li')).toHaveLength(2)
        wrapper.unmount()
    })

    it('sin nada vencido: la simulación lo dice y no ofrece crear', async () => {
        const servicio = await useServicios().ver(1)
        expect(servicio.ok).toBe(true)
        if (!servicio.ok) {
            return
        }
        const wrapper = await mountSuspended(PromesaSimularModal, { props: { servicio: servicio.data, open: true } })
        enCuerpo('#form-simular-promesa')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
        await esperar(() => expect(enCuerpo('[data-prueba="simulacion"]')).not.toBeNull())
        expect(enCuerpo('[data-prueba="simulacion-regla"]')?.textContent).toContain('Tiene deuda')
        expect(enCuerpo('[data-prueba="cobertura-sin-vencido"]')).not.toBeNull()
        expect(enCuerpo('[data-prueba="crear-simulada"]')).toBeNull()
        expect(enCuerpo('[data-prueba="simulacion-no-creable"]')?.textContent).toContain('El servicio no tiene facturas vencidas')
        wrapper.unmount()
    })
})
