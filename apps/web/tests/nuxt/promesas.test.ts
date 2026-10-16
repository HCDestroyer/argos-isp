import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, simularFalla } from '~~/fixtures'
import EvaluacionPromesa from '~/components/EvaluacionPromesa.vue'

function enDias(dias: number): string {
    return finDiaGuatemala(sumarDiasFecha(hoyGuatemala(), dias))
}

describe('tarea 13 · promesas', () => {
    beforeEach(() => {
        reiniciarFixtures()
        useNuxtApp().$tokenSesion.value = 'fixture-admin'
    })

    afterEach(() => {
        useNuxtApp().$tokenSesion.value = null
    })

    it('crear: aprobada por plazo y el servicio suspendido se reactiva con promesa activa', async () => {
        const resultado = await usePromesas().crear({ servicio_id: 2, monto: '300.00', vence_en: enDias(3), canal: 'operador' }, nuevaClaveIdempotencia())
        expect(resultado.ok).toBe(true)
        if (!resultado.ok) {
            return
        }
        expect(resultado.data.estado).toBe('activa')
        const evaluacion = leerEvaluacion(resultado.data)
        expect(evaluacion.decision).toBe('aprobada')
        expect(evaluacion.regla).toBe('plazo_max_dias')

        const servicio = await useServicios().ver(2)
        expect(servicio.ok && servicio.data.estado).toBe('activo')
        expect(servicio.ok && servicio.data.promesa_activa).toBe(true)

        // Segunda en el mismo periodo: la rechaza "máximo por periodo" y responde 201 igual.
        const otra = await usePromesas().crear({ servicio_id: 2, monto: '300.00', vence_en: enDias(2), canal: 'operador' }, nuevaClaveIdempotencia())
        expect(otra.ok && otra.data.estado).toBe('rechazada')
        expect(otra.ok && leerEvaluacion(otra.data).regla).toBe('max_por_periodo')
    })

    it('un plazo mayor al de la plantilla se rechaza por plazo_max_dias', async () => {
        const resultado = await usePromesas().crear({ servicio_id: 2, monto: '300.00', vence_en: enDias(10) }, nuevaClaveIdempotencia())
        expect(resultado.ok && resultado.data.estado).toBe('rechazada')
        if (resultado.ok) {
            const evaluacion = leerEvaluacion(resultado.data)
            expect(evaluacion.regla).toBe('plazo_max_dias')
            expect(evaluacion.verificaciones.find(v => v.regla === 'plazo_max_dias')?.cumple).toBe(false)
        }
    })

    it('empresas: la del operador queda pendiente y promesas.aprobar la activa', async () => {
        const servicios = await useServicios().listar({ cliente_id: 3 })
        const servicio = servicios.ok ? servicios.data.data[0] : undefined
        expect(servicio).toBeDefined()
        const creada = await usePromesas().crear({ servicio_id: servicio?.id ?? 0, monto: '500.00', vence_en: enDias(2) }, nuevaClaveIdempotencia())
        expect(creada.ok && creada.data.estado).toBe('pendiente_aprobacion')
        if (!creada.ok) {
            return
        }
        expect(leerEvaluacion(creada.data).decision).toBe('pendiente')

        useNuxtApp().$tokenSesion.value = 'fixture-cajero'
        const sinPermiso = await usePromesas().aprobar(creada.data.id, null, nuevaClaveIdempotencia())
        expect(!sinPermiso.ok && sinPermiso.problema.status).toBe(403)

        useNuxtApp().$tokenSesion.value = 'fixture-admin'
        const aprobada = await usePromesas().aprobar(creada.data.id, 'Buen historial', nuevaClaveIdempotencia())
        expect(aprobada.ok && aprobada.data.estado).toBe('activa')
        expect(aprobada.ok && aprobada.data.aprobada_por).toBe(1)

        const pendientes = await usePromesas().listar({ estado: 'pendiente_aprobacion' })
        expect(pendientes.ok && pendientes.data.data.some(p => p.id === creada.data.id)).toBe(false)
    })

    it('leerEvaluacion: decisión por estado si falta, sin inventar la regla', () => {
        const base = { estado: 'rechazada' as const, resultado_evaluacion: null }
        expect(leerEvaluacion(base)).toMatchObject({ decision: 'rechazada', regla: null, motivo: null, verificaciones: [] })
        const otra = leerEvaluacion({ estado: 'activa', resultado_evaluacion: { resultado: 'ok', regla_aplicada: 'deuda_maxima', extra: 5 } })
        expect(otra.decision).toBe('aprobada')
        expect(otra.regla).toBe('deuda_maxima')
        expect(otra.otros).toEqual([{ clave: 'extra', etiqueta: 'extra', valor: '5', mono: true }])
        expect(etiquetaRegla('canales.operador.requiere_aprobacion')).toBe('Requiere aprobación (Operador)')
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
        expect(vista.get('[data-prueba="regla"]').text()).toContain('Requiere aprobación (Operador)')
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
    it('leerEvaluacion: deuda, historial y fechas de la API en español', () => {
        const evaluacion = leerEvaluacion({
            estado: 'rechazada',
            resultado_evaluacion: {
                resultado: 'rechazada',
                regla: 'plazo_max_dias',
                deuda: { vencida: '970.00', pendiente: '970.00', facturas_vencidas: 2, pagado_pendientes: '0.00' },
                historial: { ventana: 6, cumplidas: 0, resueltas: 0, cumplimiento_pct: null },
                siguiente_facturacion: '2026-11-01',
            },
        })
        expect(evaluacion.otros).toEqual([
            { clave: 'deuda', etiqueta: 'Deuda del servicio', valor: 'Vencida Q 970.00 · pendiente Q 970.00 · 2 facturas vencidas', mono: false },
            { clave: 'historial', etiqueta: 'Historial de promesas', valor: 'Sin promesas anteriores (últimas 6)', mono: false },
            { clave: 'siguiente_facturacion', etiqueta: 'Siguiente facturación', valor: '01/11/2026', mono: false },
        ])
        expect(etiquetaRegla('sin_deuda')).toBe('Tiene deuda')
        expect(etiquetaRegla('canal_permitido')).toBe('Canal permitido')
    })

    it('rechazar solo una pendiente y cancelar una activa (409 en otro estado, motivo obligatorio)', async () => {
        const sinMotivo = await usePromesas().rechazar(4, 'no', nuevaClaveIdempotencia())
        expect(!sinMotivo.ok && sinMotivo.problema.errors?.[0]?.field).toBe('motivo')

        const rechazada = await usePromesas().rechazar(4, 'El cliente ya incumplió en septiembre', nuevaClaveIdempotencia())
        expect(rechazada.ok && rechazada.data.estado).toBe('rechazada')
        expect(rechazada.ok && leerEvaluacion(rechazada.data).otros.find(o => o.clave === 'cierre')?.valor).toContain('Rechazada')

        const activa = await usePromesas().rechazar(3, 'No aplica', nuevaClaveIdempotencia())
        expect(!activa.ok && activa.problema.type).toBe('urn:argosisp:problema:promesa_no_pendiente')

        const cancelada = await usePromesas().cancelar(3, 'Pagará por transferencia la otra semana', nuevaClaveIdempotencia())
        expect(cancelada.ok && cancelada.data.estado).toBe('cancelada')
    })
})
