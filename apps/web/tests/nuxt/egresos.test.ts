import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reiniciarFixtures, simularFalla } from '~~/fixtures'
import meAdmin from '~~/fixtures/auth/me.admin.json'
import meCajero from '~~/fixtures/auth/me.cajero.json'
import LibroCierres from '~/components/LibroCierres.vue'
import PaginaEgresos from '~/pages/egresos/index.vue'

describe('semana 2 · egresos y cierre de periodo', () => {
    beforeEach(() => {
        reiniciarFixtures()
        useNuxtApp().$tokenSesion.value = 'fixture-admin'
        useUsuarioActual().value = meAdmin
    })

    afterEach(() => {
        useNuxtApp().$tokenSesion.value = null
        useUsuarioActual().value = null
    })

    it('el esquema pide caja o cuenta según el método y rechaza fechas futuras', () => {
        const esquema = esquemaEgreso('2026-10-16')
        const base = { ...entradaEgresoVacia(), monto: '150.00' }
        const sinCaja = esquema.safeParse(base)
        expect(!sinCaja.success && sinCaja.error.issues.map(i => i.path.join('.'))).toEqual(['caja_id'])
        const sinCuenta = esquema.safeParse({ ...base, metodo: 'cuenta_bancaria' })
        expect(!sinCuenta.success && sinCuenta.error.issues.map(i => i.path.join('.'))).toEqual(['cuenta_bancaria_id'])
        const futura = esquema.safeParse({ ...base, metodo: 'banco', fecha: '2026-10-17' })
        expect(!futura.success && futura.error.issues[0]?.message).toBe('La fecha del egreso no puede ser futura')
        const montoMalo = esquema.safeParse({ ...base, metodo: 'banco', monto: '1,500' })
        expect(montoMalo.success).toBe(false)
        expect(esquema.safeParse({ ...base, metodo: 'banco' }).success).toBe(true)
    })

    it('el cuerpo lleva solo el origen del método y ningún texto vacío', () => {
        const banco = cuerpoEgreso({ ...entradaEgresoVacia(), categoria: 'energia', monto: '1850.4', metodo: 'banco', caja_id: 1, cuenta_bancaria_id: 2 })
        expect(banco).toEqual({ categoria: 'energia', monto: '1850.40', metodo: 'banco' })
        const caja = cuerpoEgreso({ ...entradaEgresoVacia(), monto: '20', metodo: 'caja', caja_id: 1, cuenta_bancaria_id: 2, proveedor: 'Ferretería', fecha: '2026-10-15' })
        expect(caja).toEqual({ categoria: 'otros', monto: '20.00', metodo: 'caja', caja_id: 1, proveedor: 'Ferretería', fecha: '2026-10-15' })
    })

    it('registra, rechaza un origen que no aplica y una fecha en un mes cerrado, y anula una sola vez', async () => {
        const api = useEgresos()
        const creado = await api.registrar({ categoria: 'nomina', monto: '3200.00', metodo: 'cuenta_bancaria', cuenta_bancaria_id: 2 }, nuevaClaveIdempotencia())
        expect(creado.ok && creado.data).toMatchObject({ estado: 'registrado', cuenta_bancaria_nombre: 'Banco Industrial · Monetaria', categoria_nombre: 'Nómina' })

        const noAplica = await api.registrar({ categoria: 'otros', monto: '10.00', metodo: 'banco', caja_id: 1 }, nuevaClaveIdempotencia())
        expect(!noAplica.ok && noAplica.problema.errors?.[0]).toMatchObject({ field: 'caja_id', rule: 'no_aplica' })

        const cerrado = await api.registrar({ categoria: 'otros', monto: '10.00', metodo: 'banco', fecha: '2026-09-20' }, nuevaClaveIdempotencia())
        expect(!cerrado.ok && cerrado.problema.type).toBe('urn:argosisp:problema:periodo_cerrado')

        if (!creado.ok) {
            return
        }
        const anulado = await api.anular(creado.data.id, 'Se pagó dos veces', nuevaClaveIdempotencia())
        expect(anulado.ok && anulado.data.estado).toBe('anulado')
        const otraVez = await api.anular(creado.data.id, 'Se pagó dos veces', nuevaClaveIdempotencia())
        expect(!otraVez.ok && otraVez.problema.status).toBe(409)
    })

    it('meses que se pueden cerrar: los pasados sin cierre vigente', () => {
        const cierres = [{ periodo: '2026-09', estado: 'cerrado' as const }, { periodo: '2026-08', estado: 'reabierto' as const }]
        const meses = mesesCerrables('2026-10-16', cierres)
        expect(meses[0]).toBe('2026-08')
        expect(meses).not.toContain('2026-10')
        expect(meses).not.toContain('2026-09')
        expect(meses).toHaveLength(11)
        expect(anioMes('2026-08')).toEqual({ anio: 2026, mes: 8 })
        expect(resumenCierre({ resumen: { asientos: 3, debe: '10.00', haber: '10.00' } })).toEqual({ asientos: 3, debe: '10.00', haber: '10.00' })
        expect(resumenCierre({ resumen: null })).toEqual({ asientos: null, debe: null, haber: null })
    })

    it('cierra un mes pasado, no el en curso, y reabre con motivo', async () => {
        const libro = useLibro()
        const enCurso = await libro.cerrarPeriodo('2026-10', nuevaClaveIdempotencia())
        expect(!enCurso.ok && enCurso.problema.type).toBe('urn:argosisp:problema:periodo_en_curso')
        const yaCerrado = await libro.cerrarPeriodo('2026-09', nuevaClaveIdempotencia())
        expect(!yaCerrado.ok && yaCerrado.problema.status).toBe(409)
        const agosto = await libro.cerrarPeriodo('2026-08', nuevaClaveIdempotencia())
        expect(agosto.ok && agosto.data.estado).toBe('cerrado')
        const reabierto = await libro.reabrirPeriodo('2026-08', 'Falta la factura de energía', nuevaClaveIdempotencia())
        expect(reabierto.ok && reabierto.data).toMatchObject({ estado: 'reabierto', motivo_reapertura: 'Falta la factura de energía' })
        const abierto = await libro.reabrirPeriodo('2026-08', 'Otra vez', nuevaClaveIdempotencia())
        expect(!abierto.ok && abierto.problema.type).toBe('urn:argosisp:problema:periodo_abierto')
    })

    it('la lista suma solo los egresos vigentes y ofrece anular solo esos', async () => {
        const vista = await mountSuspended(PaginaEgresos, { route: '/egresos' })
        await vi.waitFor(() => expect(vista.find('[data-prueba="total-egresos"]').exists()).toBe(true))
        expect(vista.find('[data-prueba="total-egresos"]').text()).toBe('Q 14,350.40')
        expect(vista.findAll('[data-prueba="anular-egreso"]')).toHaveLength(2)
        expect(vista.find('[data-prueba="abrir-registrar-egreso"]').exists()).toBe(true)
        expect(vista.text()).toContain('Anulado: Se registró dos veces')
    })

    it('con error la lista muestra el aviso y ningún total', async () => {
        simularFalla('GET /api/v1/egresos', 500)
        const vista = await mountSuspended(PaginaEgresos, { route: '/egresos' })
        await vi.waitFor(() => expect(vista.find('[data-prueba="egresos-error"]').exists()).toBe(true))
        expect(vista.find('[data-prueba="total-egresos"]').exists()).toBe(false)
    })

    it('cierres: reabrir solo en meses cerrados; sin permisos no hay botones', async () => {
        const vista = await mountSuspended(LibroCierres)
        await vi.waitFor(() => expect(vista.find('[data-prueba="tabla-cierres"]').text()).toContain('septiembre 2026'))
        expect(vista.find('[data-prueba="reabrir-2026-09"]').exists()).toBe(true)
        expect(vista.find('[data-prueba="reabrir-2026-08"]').exists()).toBe(false)
        expect(vista.text()).toContain('Faltó la factura de energía de agosto')
        expect(vista.find('[data-prueba="abrir-cerrar-periodo"]').exists()).toBe(true)

        useUsuarioActual().value = { ...meCajero, permisos: [...meCajero.permisos, 'libro.ver'] }
        const sinPermiso = await mountSuspended(LibroCierres)
        await vi.waitFor(() => expect(sinPermiso.find('[data-prueba="tabla-cierres"]').text()).toContain('septiembre 2026'))
        expect(sinPermiso.find('[data-prueba="abrir-cerrar-periodo"]').exists()).toBe(false)
        expect(sinPermiso.find('[data-prueba="reabrir-2026-09"]').exists()).toBe(false)
    })
})
