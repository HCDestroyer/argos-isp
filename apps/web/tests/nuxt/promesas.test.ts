import type { Schema } from '@argosisp/contracts'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture, simularFalla } from '~~/fixtures'
import { bd } from '~~/fixtures/bd'
import EvaluacionPromesa from '~/components/EvaluacionPromesa.vue'

function enDias(dias: number): string {
    return finDiaGuatemala(sumarDiasFecha(hoyGuatemala(), dias))
}

describe('tarea 13 · promesas', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
    })

    afterEach(() => {
        sesionFixture(null)
    })

    it('crear: aprobada por plazo y el servicio suspendido se reactiva con promesa activa', async () => {
        // Más que la deuda pendiente: 422 en `monto` (antes de evaluar reglas).
        const deMas = await usePromesas().crear({ servicio_id: 2, monto: '99999.00', vence_en: enDias(2) }, nuevaClaveIdempotencia())
        expect(!deMas.ok && deMas.problema.errors?.[0]).toMatchObject({ field: 'monto', rule: 'monto_maximo' })

        const resultado = await usePromesas().crear({ servicio_id: 2, monto: '300.00', vence_en: enDias(3), canal: 'operador' }, nuevaClaveIdempotencia())
        expect(resultado.ok).toBe(true)
        if (!resultado.ok) {
            return
        }
        expect(resultado.data.estado).toBe('activa')
        const { decision, evaluacion } = leerEvaluacion(resultado.data)
        expect(decision).toBe('aprobada')
        // `Schema<'EvaluacionPromesa'>`: aprobada sin regla que decida, con las reglas revisadas.
        expect(evaluacion).toMatchObject({ resultado: 'aprobada', regla: null, canal: 'operador', motivo: 'Cumple todas las reglas de promesa de la plantilla' })
        expect(evaluacion?.reglas.map(r => r.regla)).toEqual(['habilitadas', 'canal_permitido', 'sin_deuda', 'plazo_max_dias', 'no_exceder_siguiente_facturacion', 'max_por_periodo'])
        expect(evaluacion?.reglas.find(r => r.regla === 'plazo_max_dias')).toMatchObject({ ok: true, valor: 3, limite: 5, origen: 'general' })

        const servicio = await useServicios().ver(2)
        expect(servicio.ok && servicio.data.estado).toBe('activo')
        expect(servicio.ok && servicio.data.promesa_activa).toBe(true)

        // Segunda con la primera abierta: 409 `promesa_abierta`, como `CrearPromesaPago`.
        const otra = await usePromesas().crear({ servicio_id: 2, monto: '300.00', vence_en: enDias(2), canal: 'operador' }, nuevaClaveIdempotencia())
        expect(!otra.ok && otra.problema).toMatchObject({ status: 409, type: 'urn:argosisp:problema:promesa_abierta' })
    })

    it('un plazo mayor al de la plantilla se rechaza por plazo_max_dias', async () => {
        const resultado = await usePromesas().crear({ servicio_id: 2, monto: '300.00', vence_en: enDias(10) }, nuevaClaveIdempotencia())
        expect(resultado.ok && resultado.data.estado).toBe('rechazada')
        if (resultado.ok) {
            const { evaluacion } = leerEvaluacion(resultado.data)
            expect(evaluacion?.regla).toBe('plazo_max_dias')
            // Las reglas revisadas terminan en la que decidió.
            expect(evaluacion?.reglas.at(-1)).toMatchObject({ regla: 'plazo_max_dias', ok: false, valor: 10, limite: 5 })
        }
    })

    it('empresas: la del operador queda pendiente y promesas.aprobar la activa', async () => {
        // Un servicio de empresa (plantilla 2: el operador necesita aprobación) con deuda y sin promesa abierta.
        const servicio = bd.servicios.find(s => s.plantilla_facturacion_id === 2
            && bd.facturas.some(f => f.servicio_id === s.id && (f.estado === 'vencida' || f.estado === 'emitida'))
            && !bd.promesas.some(p => p.servicio_id === s.id && (p.estado === 'activa' || p.estado === 'pendiente_aprobacion')))
        expect(servicio).toBeDefined()
        const creada = await usePromesas().crear({ servicio_id: servicio?.id ?? 0, monto: '100.00', vence_en: enDias(2) }, nuevaClaveIdempotencia())
        expect(creada.ok && creada.data.estado).toBe('pendiente_aprobacion')
        if (!creada.ok) {
            return
        }
        expect(leerEvaluacion(creada.data)).toMatchObject({ decision: 'pendiente', evaluacion: { regla: 'requiere_aprobacion' } })

        sesionFixture('fixture-cajero')
        const sinPermiso = await usePromesas().aprobar(creada.data.id, null, nuevaClaveIdempotencia())
        expect(!sinPermiso.ok && sinPermiso.problema.status).toBe(403)

        sesionFixture('fixture-admin')
        const aprobada = await usePromesas().aprobar(creada.data.id, 'Buen historial', nuevaClaveIdempotencia())
        expect(aprobada.ok && aprobada.data.estado).toBe('activa')
        expect(aprobada.ok && aprobada.data.aprobada_por).toBe(1)
        expect(aprobada.ok && leerEvaluacion(aprobada.data).evaluacion?.aprobacion).toMatchObject({ por: 1, nota: 'Buen historial' })

        const pendientes = await usePromesas().listar({ estado: 'pendiente_aprobacion' })
        expect(pendientes.ok && pendientes.data.data.some(p => p.id === creada.data.id)).toBe(false)
    })

    it('leerEvaluacion: sin la forma estable, solo la decisión del estado (nada inventado)', () => {
        expect(leerEvaluacion({ estado: 'rechazada', resultado_evaluacion: null })).toEqual({ decision: 'rechazada', evaluacion: null })
        // La forma vieja que proponía el panel ya no se interpreta.
        const vieja = leerEvaluacion({ estado: 'activa', resultado_evaluacion: { decision: 'aprobada', regla: 'plazo_max_dias', verificaciones: [] } as unknown as Schema<'EvaluacionPromesa'> })
        expect(vieja).toEqual({ decision: 'aprobada', evaluacion: null })
        expect(esEvaluacionPromesa({ resultado: 'aprobada', regla: null, motivo: 'x', canal: 'portal', evaluada_en: '2026-10-15T00:00:00Z', reglas: [{ regla: 'habilitadas', ok: 'si' }], deuda: {}, historial: {} })).toBe(false)
        expect(etiquetaRegla('requiere_aprobacion')).toBe('Requiere aprobación')
        expect(etiquetaRegla('regla_nueva')).toBe('regla_nueva')
        expect(etiquetaOrigenRegla('operador')).toBe('límite del canal operador')
        expect(etiquetaOrigenRegla('general')).toBeNull()
        expect([textoValorRegla('970.00'), textoValorRegla(true), textoValorRegla(3), textoValorRegla(null)]).toEqual(['Q 970.00', 'sí', '3', null])
    })

    it('el componente muestra decisión, regla y motivo', async () => {
        const lista = await usePromesas().listar({ estado: 'pendiente_aprobacion' })
        const promesa = lista.ok ? lista.data.data[0] : undefined
        expect(promesa).toBeDefined()
        if (!promesa) {
            return
        }
        const vista = await mountSuspended(EvaluacionPromesa, { props: { promesa } })
        expect(vista.get('[data-prueba="decision"]').text()).toBe('Pendiente de aprobación')
        expect(vista.get('[data-prueba="regla"]').text()).toContain('Requiere aprobación')
        expect(vista.get('[data-prueba="motivo-evaluacion"]').text()).toBe('Las promesas del canal operador requieren aprobación de un supervisor')
        const plazo = vista.get('[data-regla="plazo_max_dias"]').text()
        expect(plazo).toContain('medido 4 · límite 5')
        expect(vista.get('[data-regla="requiere_aprobacion"]').text()).toContain('límite del canal operador')
        expect(vista.text()).toContain('Deuda del servicio')

        const sinDetalle = await mountSuspended(EvaluacionPromesa, { props: { promesa: { ...promesa, resultado_evaluacion: null } } })
        expect(sinDetalle.text()).toContain('La API no devolvió el detalle de la evaluación.')
        expect(sinDetalle.find('[data-prueba="regla"]').exists()).toBe(false)
    })

    it('con 501 (como hoy la API) crear devuelve el Problem y el servicio no cambia', async () => {
        simularFalla('POST /api/v1/promesas', 501)
        const resultado = await usePromesas().crear({ servicio_id: 2, monto: '300.00', vence_en: enDias(3) }, nuevaClaveIdempotencia())
        expect(!resultado.ok && resultado.problema.status).toBe(501)
        const servicio = await useServicios().ver(2)
        expect(servicio.ok && servicio.data.estado).toBe('suspendido')
    })

    it('esquema espejo: monto > 0 y día de hoy en adelante', () => {
        const esquema = esquemaPromesa('2026-10-15')
        expect(esquema.safeParse({ monto: '150.00', vence: '2026-10-15', canal: 'operador' }).success).toBe(true)
        expect(esquema.safeParse({ monto: '0', vence: '2026-10-16', canal: 'operador' }).success).toBe(false)
        expect(esquema.safeParse({ monto: '150.00', vence: '2026-10-14', canal: 'operador' }).success).toBe(false)
    })
    it('datosEvaluacion: deuda, historial y fechas de la API en español', () => {
        const { evaluacion } = leerEvaluacion({
            estado: 'rechazada',
            resultado_evaluacion: {
                resultado: 'rechazada',
                regla: 'plazo_max_dias',
                motivo: 'Vence en 10 días; el máximo es 5 días',
                canal: 'portal',
                evaluada_en: '2026-10-15T16:00:00.000Z',
                reglas: [{ regla: 'plazo_max_dias', ok: false, valor: 10, limite: 5, origen: 'general', detalle: 'Vence en 10 días; el máximo es 5 días' }],
                deuda: { vencida: '970.00', pendiente: '970.00', facturas_vencidas: 2, pagado_pendientes: '0.00' },
                historial: { ventana: 6, cumplidas: 0, resueltas: 0, cumplimiento_pct: null },
                siguiente_facturacion: '2026-11-01',
            },
        })
        expect(evaluacion).not.toBeNull()
        expect(evaluacion && datosEvaluacion(evaluacion)).toEqual([
            { clave: 'deuda', etiqueta: 'Deuda del servicio', valor: 'Vencida Q 970.00 · pendiente Q 970.00 · 2 facturas vencidas' },
            { clave: 'historial', etiqueta: 'Historial de promesas', valor: 'Sin promesas anteriores (últimas 6)' },
            { clave: 'evaluada_en', etiqueta: 'Evaluada', valor: '15/10/2026, 10:00 · Portal del cliente' },
            { clave: 'siguiente_facturacion', etiqueta: 'Siguiente facturación', valor: '01/11/2026' },
        ])
        expect(etiquetaRegla('sin_deuda')).toBe('Tiene deuda')
        expect(etiquetaRegla('canal_permitido')).toBe('Canal permitido')
    })

    it('rechazar solo una pendiente y cancelar una activa (409 en otro estado, motivo obligatorio)', async () => {
        const sinMotivo = await usePromesas().rechazar(4, 'no', nuevaClaveIdempotencia())
        expect(!sinMotivo.ok && sinMotivo.problema.errors?.[0]?.field).toBe('motivo')

        const rechazada = await usePromesas().rechazar(4, 'El cliente ya incumplió en septiembre', nuevaClaveIdempotencia())
        expect(rechazada.ok && rechazada.data.estado).toBe('rechazada')
        const cierre = rechazada.ok ? leerEvaluacion(rechazada.data).evaluacion?.cierre : undefined
        expect(cierre).toMatchObject({ estado: 'rechazada', motivo: 'El cliente ya incumplió en septiembre', por: 1 })

        const activa = await usePromesas().rechazar(3, 'No aplica', nuevaClaveIdempotencia())
        expect(!activa.ok && activa.problema.type).toBe('urn:argosisp:problema:promesa_no_pendiente')

        const cancelada = await usePromesas().cancelar(3, 'Pagará por transferencia la otra semana', nuevaClaveIdempotencia())
        expect(cancelada.ok && cancelada.data.estado).toBe('cancelada')
    })
})
