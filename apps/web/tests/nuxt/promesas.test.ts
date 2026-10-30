import type { Schema } from '@argosisp/contracts'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture, simularFalla } from '~~/fixtures'
import { bd } from '~~/fixtures/bd'
import EvaluacionPromesa from '~/components/EvaluacionPromesa.vue'
import PromesaCrearModal from '~/components/PromesaCrearModal.vue'
import { esperar } from '../ayudas/esperar'
import { fijarHoyFixtures, soltarReloj } from '../ayudas/reloj'

function enDias(dias: number): string {
    return finDiaGuatemala(sumarDiasFecha(hoyGuatemala(), dias))
}

function enCuerpo(selector: string): HTMLElement | null {
    return document.body.querySelector<HTMLElement>(selector)
}

function todosEnCuerpo(selector: string): HTMLElement[] {
    return [...document.body.querySelectorAll<HTMLElement>(selector)]
}

/** Servicio 2 (`juan.carlos2`, suspendido): debe septiembre (209) y octubre (210), Q150 cada una. */
const SERVICIO_DOS_FACTURAS = 2
/** Servicio 1: activo y al día, sin nada vencido. */
const SERVICIO_AL_DIA = 1

/** Abono de un cajero al cliente del servicio 2: se aplica a la factura más antigua (septiembre). */
async function abonar(monto: string): Promise<void> {
    sesionFixture('fixture-cajero')
    const pago = await usePagos().registrar({ cliente_id: 2, metodo: 'caja', caja_id: 1, monto }, nuevaClaveIdempotencia())
    sesionFixture('fixture-admin')
    expect(pago.ok).toBe(true)
}

function exigirAbono(pct: number): void {
    const servicio = bd.servicios.find(s => s.id === SERVICIO_DOS_FACTURAS)
    const plantilla = bd.plantillas.find(p => p.id === servicio?.plantilla_facturacion_id)
    if (!plantilla) {
        throw new Error('Fixture: el servicio 2 no tiene plantilla')
    }
    plantilla.reglas_promesa.abono_inicial_pct = pct
}

describe('tarea 13 · promesas', () => {
    beforeEach(() => {
        // Las promesas vencen a pocos días: sin fecha fija, a fin de mes caen en la siguiente facturación.
        fijarHoyFixtures()
        reiniciarFixtures()
        sesionFixture('fixture-admin')
    })

    afterEach(() => {
        soltarReloj()
        sesionFixture(null)
    })

    it('crear: sin monto, cubre todo lo vencido; aprobada por plazo y el servicio se reactiva con promesa activa', async () => {
        const resultado = await usePromesas().crear({ servicio_id: 2, vence_en: enDias(3), canal: 'operador' }, nuevaClaveIdempotencia())
        expect(resultado.ok).toBe(true)
        if (!resultado.ok) {
            return
        }
        expect(resultado.data.estado).toBe('activa')
        // El monto lo calcula Argos: el total vencido, con sus facturas y la regla `facturas`.
        expect(resultado.data).toMatchObject({ monto: '300.00', regla_cumplimiento: 'facturas' })
        expect(resultado.data.facturas?.map(f => [f.factura_id, f.monto, f.saldo])).toEqual([[209, '150.00', '150.00'], [210, '150.00', '150.00']])
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
        const otra = await usePromesas().crear({ servicio_id: 2, vence_en: enDias(2), canal: 'operador' }, nuevaClaveIdempotencia())
        expect(!otra.ok && otra.problema).toMatchObject({ status: 409, type: 'urn:argosisp:problema:promesa_abierta' })
    })

    it('un plazo mayor al de la plantilla se rechaza por plazo_max_dias', async () => {
        const resultado = await usePromesas().crear({ servicio_id: 2, vence_en: enDias(10) }, nuevaClaveIdempotencia())
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
            && bd.facturas.some(f => f.servicio_id === s.id && f.estado === 'emitida')
            && !bd.promesas.some(p => p.servicio_id === s.id && (p.estado === 'activa' || p.estado === 'pendiente_aprobacion')))
        expect(servicio).toBeDefined()
        // La promesa cubre lo vencido: el cron de vencimiento ya marcó su aviso pendiente como vencido.
        const aviso = bd.facturas.find(f => f.servicio_id === servicio?.id && f.estado === 'emitida')
        if (aviso) {
            Object.assign(aviso, { estado: 'vencida', vencida_en: '2026-10-15T06:05:00.000Z' })
        }
        const creada = await usePromesas().crear({ servicio_id: servicio?.id ?? 0, vence_en: enDias(2) }, nuevaClaveIdempotencia())
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
        const resultado = await usePromesas().crear({ servicio_id: 2, vence_en: enDias(3) }, nuevaClaveIdempotencia())
        expect(!resultado.ok && resultado.problema.status).toBe(501)
        const servicio = await useServicios().ver(2)
        expect(servicio.ok && servicio.data.estado).toBe('suspendido')
    })

    it('esquema espejo: sin monto, día de hoy en adelante', () => {
        const esquema = esquemaPromesa('2026-10-15')
        expect(esquema.safeParse({ vence: '2026-10-15', canal: 'operador' }).success).toBe(true)
        expect(esquema.safeParse({ vence: '2026-10-14', canal: 'operador' }).success).toBe(false)
        // Un monto escrito no forma parte de los datos: se descarta.
        const conMonto = esquema.safeParse({ monto: '1.00', vence: '2026-10-16', canal: 'operador' })
        expect(conMonto.success && 'monto' in conMonto.data).toBe(false)
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
        const cerrada = evaluacion && datosEvaluacion({ ...evaluacion, cierre: { estado: 'incumplida', en: '2026-10-20T06:00:00.000Z', pagado: '150.00', deuda_vencida: '150.00', saldo_cubierto: '150.00' } })
        expect(cerrada?.find(d => d.clave === 'cierre')?.valor).toBe('Incumplida · 20/10/2026, 00:00 · pagó Q 150.00 · deuda vencida Q 150.00 · saldo de las facturas cubiertas Q 150.00')
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

    describe('cubre todo lo vencido (decisión del PM, 29 oct)', () => {
        it('varias facturas vencidas: la cobertura las lista de la más antigua a la más nueva y la promesa sigue su saldo', async () => {
            const simulada = await usePromesas().cobertura(SERVICIO_DOS_FACTURAS, 'operador')
            expect(simulada.ok).toBe(true)
            if (!simulada.ok) {
                return
            }
            const cobertura = coberturaDeSimulacion(simulada.data)
            expect(cobertura).toMatchObject({ monto: '300.00', abonoRequerido: '0.00', abonoPagado: '0.00', abonoFalta: '0.00', sinVencido: false })
            expect(cobertura.facturas?.map(f => [f.factura_id, f.periodo, f.monto])).toEqual([[209, '2026-09-01', '150.00'], [210, '2026-10-01', '150.00']])
            expect(cobertura.facturas?.map(etiquetaFacturaCubierta)).toEqual(['Servicio de septiembre 2026', 'Servicio de octubre 2026'])
            // Plazo de 5 días y antes de la siguiente facturación (1 nov).
            expect(cobertura.fechaMaxima).toBe('2026-10-20')
            expect(motivoNoCreable(simulada.data)).toBeNull()
            // `sin_deuda` mide lo vencido.
            expect(simulada.data.reglas.find(r => r.regla === 'sin_deuda')).toMatchObject({ ok: true, valor: '300.00', detalle: 'La promesa cubre Q300.00 vencidos en 2 facturas' })

            const creada = await usePromesas().crear({ servicio_id: SERVICIO_DOS_FACTURAS, vence_en: enDias(3) }, nuevaClaveIdempotencia())
            expect(creada.ok && resumenCumplimiento(creada.data)).toBe('Por facturas · cubre 2 facturas vencidas · 2 con saldo')

            // Pagar septiembre no la cumple (un pago parcial no basta): la lista trae el saldo de hoy.
            await abonar('150.00')
            const lista = await usePromesas().listar({ servicio_id: SERVICIO_DOS_FACTURAS })
            const promesa = lista.ok ? lista.data.data[0] : undefined
            expect(promesa?.estado).toBe('activa')
            expect(promesa?.facturas?.map(f => [f.factura_id, f.monto, f.saldo])).toEqual([[209, '150.00', '0.00'], [210, '150.00', '150.00']])
            expect(promesa && resumenCumplimiento(promesa)).toBe('Por facturas · cubre 2 facturas vencidas · 1 con saldo')
            // Las promesas de antes del cambio conservan la regla `monto` y no listan facturas.
            const legado = bd.promesas.find(p => p.id === 3)
            expect(legado && resumenCumplimiento(legado)).toBe('Por monto')
        })

        it('abono parcial: muestra requerido y pagado, bloquea hasta completar y la promesa cubre lo que queda', async () => {
            exigirAbono(50)
            await abonar('50.00')
            const parcial = await usePromesas().cobertura(SERVICIO_DOS_FACTURAS, 'operador')
            expect(parcial.ok).toBe(true)
            if (!parcial.ok) {
                return
            }
            // Base = lo vencido antes de los abonos: 250 vencidos hoy + 50 abonados = 300; el 50 % = 150.
            expect(coberturaDeSimulacion(parcial.data)).toMatchObject({ monto: '250.00', abonoRequerido: '150.00', abonoPagado: '50.00', abonoFalta: '100.00' })
            expect(motivoNoCreable(parcial.data)).toBe('Falta abonar Q 100.00 antes de prometer (requerido Q 150.00, pagado Q 50.00): registra el abono primero.')
            const regla = parcial.data.reglas.find(r => r.regla === 'abono_inicial_pct')
            expect(regla).toMatchObject({ ok: false, valor: '50.00', limite: '150.00' })

            // Crear igual la rechaza por el abono (la API la guarda rechazada).
            const rechazada = await usePromesas().crear({ servicio_id: SERVICIO_DOS_FACTURAS, vence_en: enDias(3) }, nuevaClaveIdempotencia())
            expect(rechazada.ok && rechazada.data.estado).toBe('rechazada')
            expect(rechazada.ok && leerEvaluacion(rechazada.data).evaluacion?.regla).toBe('abono_inicial_pct')

            // Con 100 más, septiembre queda saldada: abono cumplido y la promesa cubre solo octubre.
            await abonar('100.00')
            const completo = await usePromesas().cobertura(SERVICIO_DOS_FACTURAS, 'operador')
            expect(completo.ok && coberturaDeSimulacion(completo.data)).toMatchObject({ monto: '150.00', abonoRequerido: '150.00', abonoPagado: '150.00', abonoFalta: '0.00' })
            expect(completo.ok && motivoNoCreable(completo.data)).toBeNull()
            const creada = await usePromesas().crear({ servicio_id: SERVICIO_DOS_FACTURAS, vence_en: enDias(3) }, nuevaClaveIdempotencia())
            expect(creada.ok && creada.data.estado).toBe('activa')
            expect(creada.ok && creada.data.monto).toBe('150.00')
            expect(creada.ok && creada.data.facturas?.map(f => f.factura_id)).toEqual([210])
        })

        it('sin nada vencido: no hay qué prometer y crear la rechaza por sin_deuda con monto 0', async () => {
            const simulada = await usePromesas().cobertura(SERVICIO_AL_DIA, 'operador')
            expect(simulada.ok).toBe(true)
            if (!simulada.ok) {
                return
            }
            expect(coberturaDeSimulacion(simulada.data)).toMatchObject({ monto: '0.00', facturas: [], sinVencido: true })
            expect(motivoNoCreable(simulada.data)).toBe('El servicio no tiene facturas vencidas: no hace falta promesa')

            const creada = await usePromesas().crear({ servicio_id: SERVICIO_AL_DIA, vence_en: enDias(2) }, nuevaClaveIdempotencia())
            expect(creada.ok && creada.data).toMatchObject({ estado: 'rechazada', monto: '0.00', facturas: [], regla_cumplimiento: 'facturas' })
            expect(creada.ok && leerEvaluacion(creada.data).evaluacion?.regla).toBe('sin_deuda')
        })

        it('el modal muestra facturas, total, abono y fecha límite, sin campo de monto', async () => {
            const servicio = bd.servicios.find(s => s.id === SERVICIO_DOS_FACTURAS)
            if (!servicio) {
                throw new Error('Fixture: falta el servicio 2')
            }
            const wrapper = await mountSuspended(PromesaCrearModal, { props: { servicio, open: true } })
            await esperar(() => expect(enCuerpo('[data-prueba="cobertura-total"]')?.textContent).toBe('Q 300.00'))
            expect(todosEnCuerpo('[data-prueba="factura-cubierta"]').map(f => f.dataset.factura)).toEqual(['209', '210'])
            expect(enCuerpo('[data-prueba="cobertura"]')?.textContent).toContain('2 facturas vencidas')
            expect(enCuerpo('[data-prueba="abono-requerido"]')?.textContent).toContain('No se exige')
            expect(enCuerpo('[data-prueba="abono-pagado"]')?.textContent).toContain('Q 0.00')
            expect(enCuerpo('[data-prueba="fecha-maxima"]')?.textContent).toContain('20/10/2026')
            expect(enCuerpo('#form-promesa input[inputmode="decimal"]')).toBeNull()
            expect(enCuerpo('[data-prueba="crear-promesa"]')?.hasAttribute('disabled')).toBe(false)
            expect(enCuerpo('[data-prueba="motivo-no-creable"]')).toBeNull()
            wrapper.unmount()
        })

        it('el modal: sin nada vencido el botón queda deshabilitado con su motivo', async () => {
            const servicio = bd.servicios.find(s => s.id === SERVICIO_AL_DIA)
            if (!servicio) {
                throw new Error('Fixture: falta el servicio 1')
            }
            const wrapper = await mountSuspended(PromesaCrearModal, { props: { servicio, open: true } })
            await esperar(() => expect(enCuerpo('[data-prueba="motivo-no-creable"]')?.textContent).toContain('no tiene facturas vencidas'))
            expect(enCuerpo('[data-prueba="cobertura-sin-vencido"]')).not.toBeNull()
            expect(enCuerpo('[data-prueba="cobertura-total"]')).toBeNull()
            expect(enCuerpo('[data-prueba="crear-promesa"]')?.hasAttribute('disabled')).toBe(true)
            wrapper.unmount()
        })

        it('el modal: si la cobertura no se pudo leer, error con Reintentar y ningún total', async () => {
            simularFalla('POST /api/v1/promesas/simular', 500)
            const servicio = bd.servicios.find(s => s.id === SERVICIO_DOS_FACTURAS)
            if (!servicio) {
                throw new Error('Fixture: falta el servicio 2')
            }
            const wrapper = await mountSuspended(PromesaCrearModal, { props: { servicio, open: true } })
            await esperar(() => expect(document.body.textContent).toContain('Reintentar'))
            expect(enCuerpo('[data-prueba="cobertura"]')).toBeNull()
            expect(enCuerpo('[data-prueba="crear-promesa"]')?.hasAttribute('disabled')).toBe(true)
            wrapper.unmount()
        })
    })
})
