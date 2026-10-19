import Decimal from 'decimal.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { reiniciarFixtures, sesionFixture, simularFalla } from '~~/fixtures'
import ReciboPago from '~/components/ReciboPago.vue'
import { esperar } from '../ayudas/esperar'

describe('cobro rápido · composables y reglas', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-cajero')
    })

    afterEach(() => {
        vi.useRealTimers()
        sesionFixture(null)
    })

    async function cuenta(clienteId: number) {
        const resultado = await useClientes().estadoCuenta(clienteId)
        if (!resultado.ok) {
            throw new Error(resultado.problema.title)
        }
        return resultado.data
    }

    async function servicioDe(clienteId: number) {
        const resultado = await useServicios().listar({ cliente_id: clienteId })
        if (!resultado.ok) {
            throw new Error(resultado.problema.title)
        }
        return resultado.data.data
    }

    it('resumen del pendiente: vencido, pendiente y monto sugerido con decimal.js', async () => {
        const resumen = resumenPendiente((await cuenta(2)).facturas_pendientes, '2026-10-15')
        expect(resumen.vencido.toFixed(2)).toBe('300.00')
        expect(resumen.pendiente.toFixed(2)).toBe('300.00')
        expect(resumen.vencidas).toBe(2)
        expect(montoSugerido(resumen)).toBe('300.00')

        const alDia = resumenPendiente([], '2026-10-15')
        expect(montoSugerido(alDia)).toBe('')
    })

    it('una factura que venció ayer cuenta como vencida aunque la API aún diga emitida', () => {
        const base = {
            id: 1, empresa_id: 1, empresa_nombre: 'ArgosNet', cliente_id: 1, servicio_id: 1, periodo: '2026-10-01', clave_unica: '1-2026-10-01',
            emitida_en: '2026-10-01T14:00:00Z', vence_en: '2026-10-14', estado: 'emitida' as const,
            subtotal: '133.93', iva: '16.07', total: '150.00', pagado: '0.10',
            fel_uuid: null, fel_serie: null, fel_numero: null, fel_estado: null, version: 1,
            created_at: '2026-10-01T14:00:00Z', updated_at: '2026-10-01T14:00:00Z',
        }
        const resumen = resumenPendiente([base], '2026-10-15')
        expect(resumen.vencido.toFixed(2)).toBe('149.90')
        expect(montoSugerido(resumen)).toBe('149.90')
        expect(resumenPendiente([base], '2026-10-14').vencido.isZero()).toBe(true)
    })

    it('hoy en Guatemala, no en UTC', () => {
        // 02:00 UTC del 16 = 20:00 del 15 en Guatemala.
        expect(hoyGuatemala(new Date('2026-10-16T02:00:00Z'))).toBe('2026-10-15')
    })

    it('esquema espejo de POST /pagos: monto, caja y referencia', () => {
        const base = { monto: '150.00', metodo: 'caja' as const, caja_id: 1, cuenta_bancaria_id: null, banco_origen_id: null, referencia: '', nota: '' }
        expect(esquemaCobro.safeParse(base).success).toBe(true)
        expect(esquemaCobro.safeParse({ ...base, monto: '12,50' }).success).toBe(false)
        expect(esquemaCobro.safeParse({ ...base, monto: '0.00' }).success).toBe(false)
        expect(esquemaCobro.safeParse({ ...base, monto: '10.555' }).success).toBe(false)
        // Sin caja elegida, la API usa la caja principal.
        expect(esquemaCobro.safeParse({ ...base, caja_id: null }).success).toBe(true)
        expect(esquemaCobro.safeParse({ ...base, metodo: 'deposito', caja_id: null }).success).toBe(false)
        expect(esquemaCobro.safeParse({ ...base, metodo: 'deposito', caja_id: null, referencia: 'BI-1234' }).success).toBe(false)
        expect(esquemaCobro.safeParse({ ...base, metodo: 'deposito', caja_id: null, cuenta_bancaria_id: 1, referencia: 'BI-1234' }).success).toBe(true)
        expect(METODOS_COBRO.map(m => m.metodo)).not.toContain('pasarela')
    })

    it('useCajas: el cajero ve su caja con turno abierto', async () => {
        const resultado = await useCajas().listar()
        expect(resultado.ok).toBe(true)
        if (resultado.ok) {
            const abiertas = resultado.data.filter(c => c.turno_abierto_id !== null)
            expect(abiertas.find(c => c.cajero_id === 2)?.nombre).toBe('Caja Central')
        }
    })

    it('usePagos.registrar aplica a la más antigua, deja el saldo en cero y es idempotente', async () => {
        const clave = nuevaClaveIdempotencia()
        const datos = { cliente_id: 2, metodo: 'caja' as const, monto: '300.00', caja_id: 1, referencia: null, nota: null }
        const pago = await usePagos().registrar(datos, clave)
        expect(pago.ok).toBe(true)
        if (!pago.ok) {
            return
        }
        expect(pago.data.estado).toBe('registrado')
        expect(pago.data.aplicaciones.map(a => a.monto)).toEqual(['150.00', '150.00'])
        const aplicado = pago.data.aplicaciones.reduce((t, a) => t.plus(a.monto), new Decimal(0))
        expect(aplicado.toFixed(2)).toBe(pago.data.monto)

        const despues = await cuenta(2)
        expect(despues.saldo).toBe('0.00')
        expect(despues.facturas_pendientes).toHaveLength(0)

        const repetido = await usePagos().registrar(datos, clave)
        expect(repetido.ok && repetido.data.id).toBe(pago.data.id)
        expect((await cuenta(2)).movimientos.filter(m => m.tipo === 'pago' && m.referencia_id === pago.data.id)).toHaveLength(1)
    })

    it('usePagos.registrar: caja sin caja_id va a la principal, caja inexistente 422, 401 y 501 visibles', async () => {
        const sinCaja = await usePagos().registrar({ cliente_id: 2, metodo: 'caja', monto: '10.00' }, nuevaClaveIdempotencia())
        expect(sinCaja.ok && sinCaja.data.caja_id).toBe(1)

        const inexistente = await usePagos().registrar({ cliente_id: 2, metodo: 'caja', monto: '10.00', caja_id: 99 }, nuevaClaveIdempotencia())
        expect(!inexistente.ok && inexistente.problema.status).toBe(422)
        expect(!inexistente.ok && inexistente.problema.errors?.[0]?.field).toBe('caja_id')

        sesionFixture('fixture-desconocido')
        const sinSesion = await usePagos().registrar({ cliente_id: 2, metodo: 'deposito', monto: '10.00' }, nuevaClaveIdempotencia())
        expect(!sinSesion.ok && sinSesion.problema.status).toBe(401)

        sesionFixture('fixture-cajero')
        simularFalla('POST /api/v1/pagos', 501)
        const noImplementado = await usePagos().registrar({ cliente_id: 2, metodo: 'deposito', monto: '10.00', referencia: 'X-1' }, nuevaClaveIdempotencia())
        expect(!noImplementado.ok && noImplementado.problema.title).toBe('No implementado')
    })

    it('Pago.servicios[] muestra la reactivación de inmediato, sin sondeo', async () => {
        const antes = await servicioDe(2)
        expect(antes[0]?.estado).toBe('suspendido')

        const pago = await usePagos().registrar({ cliente_id: 2, metodo: 'caja', monto: '300.00' }, nuevaClaveIdempotencia())
        expect(pago.ok).toBe(true)
        if (!pago.ok) {
            return
        }
        expect(pago.data.servicios).toEqual([{ servicio_id: 2, de: 'suspendido', estado: 'activo', cambiado: true, motivo: 'sin facturas vencidas' }])

        const seguimiento = useSeguimientoReactivacion()
        seguimiento.iniciar(2, antes, pago.data.servicios)
        expect(seguimiento.siguiendo.value).toBe(false)
        expect(seguimiento.reactivados.value.map(s => s.id)).toEqual([2])
        expect(seguimiento.pendientes.value).toHaveLength(0)
    })

    it('un pago parcial deja el servicio cortado y dice por qué', async () => {
        const antes = await servicioDe(2)
        const pago = await usePagos().registrar({ cliente_id: 2, metodo: 'caja', monto: '100.00' }, nuevaClaveIdempotencia())
        expect(pago.ok).toBe(true)
        if (!pago.ok) {
            return
        }
        const seguimiento = useSeguimientoReactivacion()
        seguimiento.iniciar(2, antes, pago.data.servicios)
        expect(seguimiento.siguiendo.value).toBe(false)
        expect(seguimiento.reactivados.value).toHaveLength(0)
        expect(seguimiento.motivos.value.get(2)).toMatch(/vencida/)
    })

    it('sondeo de respaldo: sin Pago.servicios[] relee hasta ver el servicio activo', async () => {
        const antes = await servicioDe(2)
        expect(antes[0]?.estado).toBe('suspendido')

        const seguimiento = useSeguimientoReactivacion({ intervaloMs: 20, limiteMs: 2000 })
        const pago = await usePagos().registrar({ cliente_id: 2, metodo: 'caja', monto: '300.00', caja_id: 1 }, nuevaClaveIdempotencia())
        expect(pago.ok).toBe(true)
        seguimiento.iniciar(2, antes)
        expect(seguimiento.siguiendo.value).toBe(true)
        expect(seguimiento.pendientes.value).toHaveLength(1)

        await esperar(() => expect(seguimiento.reactivados.value.map(s => s.id)).toEqual([2]), { timeout: 2000 })
        expect(seguimiento.siguiendo.value).toBe(false)
        expect(seguimiento.agotado.value).toBe(false)
    })

    it('useSeguimientoReactivacion se rinde a los 30 s si sigue suspendido', async () => {
        vi.useFakeTimers()
        const antes = await servicioDe(2)
        const seguimiento = useSeguimientoReactivacion()
        seguimiento.iniciar(2, antes)

        // Sin pago: nunca se reactiva. 10 lecturas (3 s … 30 s) y se detiene.
        for (let segundo = 3; segundo <= 30; segundo += 3) {
            await vi.advanceTimersByTimeAsync(3000)
        }
        await esperar(() => expect(seguimiento.siguiendo.value).toBe(false))
        expect(seguimiento.agotado.value).toBe(true)
        expect(seguimiento.reactivados.value).toHaveLength(0)
    })

    it('un pago no reactiva un servicio suspendido a mano', async () => {
        const [servicio] = await servicioDe(22)
        if (!servicio) {
            throw new Error('sin servicio')
        }
        expect(servicio.estado).toBe('suspendido')
        expect(servicio.suspension_manual).toBe(true)

        const cuenta = await useClientes().estadoCuenta(22)
        const pendiente = cuenta.ok ? resumenPendiente(cuenta.data.facturas_pendientes, hoyGuatemala()).pendiente : new Decimal(0)
        expect(pendiente.gt(0)).toBe(true)
        const pago = await usePagos().registrar({ cliente_id: 22, metodo: 'deposito', monto: pendiente.toFixed(2), cuenta_bancaria_id: 1, referencia: 'B-1' }, nuevaClaveIdempotencia())
        expect(pago.ok).toBe(true)
        if (pago.ok) {
            const evaluado = pago.data.servicios?.find(s => s.servicio_id === servicio.id)
            expect(evaluado?.cambiado).toBe(false)
            expect(evaluado?.estado).toBe('suspendido')
        }
        const despues = await useServicios().ver(servicio.id)
        expect(despues.ok && despues.data.estado).toBe('suspendido')

        const seguimiento = useSeguimientoReactivacion()
        seguimiento.iniciar(22, [servicio], pago.ok ? pago.data.servicios : undefined)
        expect(seguimiento.pendientes.value).toHaveLength(0)
        expect(seguimiento.suspendidosManual.value.map(s => s.id)).toEqual([servicio.id])
    })

    it('el recibo dice qué servicio se reactivó y que la suspensión manual sigue', async () => {
        const [reactivable] = await servicioDe(2)
        const [manual] = await servicioDe(22)
        const cliente = await useClientes().ver(2)
        const pago = await usePagos().registrar({ cliente_id: 2, metodo: 'caja', monto: '300.00' }, nuevaClaveIdempotencia())
        if (!reactivable || !manual || !cliente.ok || !pago.ok) {
            throw new Error('datos de prueba')
        }
        const wrapper = await mountSuspended(ReciboPago, {
            props: { pago: pago.data, cliente: cliente.data, caja: 'Caja principal', reactivados: [reactivable], suspendidosManual: [manual] },
        })
        const texto = wrapper.text()
        expect(texto).toContain(`Servicio ${reactivable.user_ppp} reactivado`)
        expect(texto).toContain('suspendido manualmente: este pago no lo')
        expect(texto).toContain('Caja principal')
    })

    it('useSeguimientoReactivacion no sigue nada si ningún servicio estaba cortado', async () => {
        const seguimiento = useSeguimientoReactivacion()
        seguimiento.iniciar(1, await servicioDe(1))
        expect(seguimiento.siguiendo.value).toBe(false)
    })
})
