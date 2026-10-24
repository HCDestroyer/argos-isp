import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture, simularFalla } from '~~/fixtures'
import { meAdmin } from '~~/fixtures/auth/sesiones'
import { bd } from '~~/fixtures/bd'
import PaginaProveedor from '~/pages/proveedores/[id].vue'
import PaginaCompra from '~/pages/compras/[id].vue'
import PaginaActivos from '~/pages/activos/index.vue'
import PaginaEgresos from '~/pages/egresos/index.vue'
import { esperar } from '../ayudas/esperar'
import { fijarHoyFixtures, soltarReloj } from '../ayudas/reloj'

/**
 * Pantallas de la fase 5 (A3, contrato fiscal §19). Hoy es el 15/10/2026. ArgosNet: Ciclo Sport con las
 * bicicletas al crédito vencidas (Q5,000), la limpieza de Ramírez al crédito con retención de ISR del
 * régimen opcional (Q150) y un abono de Q1,000 (saldo Q2,210), y el egreso 2 de EEGSA (Q1,850.40) sin
 * compra. Activos con su depreciación hasta septiembre; un diferido de la instalación del soporte.
 */

describe('fase 5 · compras, proveedores, activos y diferidos', () => {
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

    it('textos y esquemas: documento, vencidas, totales de referencia y cuerpos', () => {
        expect(documentoCompra({ tipo_documento: 'FACT', serie: 'B', numero: '1201' })).toBe('FACT B-1201')
        expect(diasVencida({ vence_en: '2026-09-19', saldo: '5000.00', estado: 'vigente' }, '2026-10-15')).toBe(26)
        expect(diasVencida({ vence_en: '2026-09-19', saldo: '0.00', estado: 'vigente' }, '2026-10-15')).toBe(0)
        const base = { ...compraVacia('2026-10-15'), proveedor_id: 4, numero: '77', lineas: [{ ...lineaVacia(), descripcion: 'Router', total: '1120.00' }] }
        expect(totalesFormulario(base)).toEqual({ total: '1120.00', iva: '120.00', base: '1000.00' })
        expect(totalesFormulario({ ...base, tipo_documento: 'FPEQ' }).iva).toBe('0.00')
        const esquema = esquemaCompra('2026-10-15', false)
        expect(esquema.safeParse(base).success).toBe(true)
        expect(esquema.safeParse({ ...base, proveedor_id: null }).error?.issues[0]?.message).toBe('Elige el proveedor')
        expect(esquema.safeParse({ ...base, tipo_documento: 'NCRE' }).error?.issues.map(i => i.message)).toContain('Una NCRE corrige una compra: elígela')
        expect(esquema.safeParse({ ...base, lineas: [{ ...base.lineas[0]!, tipo: 'activo_fijo' }] }).error?.issues[0]?.path).toEqual(['lineas', 0, 'clase_activo'])
        expect(esquema.safeParse({ ...base, condicion: 'contado', metodo: 'caja' }).error?.issues[0]?.path).toEqual(['caja_id'])
        // Sin el campo, las retenciones sugeridas; «ninguna» manda [].
        expect('retenciones' in cuerpoCompra(base)).toBe(false)
        expect(cuerpoCompra({ ...base, retenciones_modo: 'ninguna' }).retenciones).toEqual([])
        expect(cuerpoCompra({ ...base, condicion: 'contado', metodo: 'banco' })).toMatchObject({ condicion: 'contado', metodo: 'banco' })
        expect(cuerpoCompraDesdeEgreso(base)).not.toHaveProperty('condicion')
        // Editar el proveedor manda solo lo que cambió, con su versión.
        const proveedor = bd.proveedores.find(p => p.id === 4)!
        expect(cuerpoEditarProveedor({ ...proveedorVacio(proveedor), telefono: '5555-0000' }, proveedor)).toEqual({ version: 1, telefono: '5555-0000' })
        expect(esquemaBajaActivo('2026-10-15', '2026-01-15').safeParse({ tipo: 'venta', motivo: 'Vendido', fecha: '', precio_venta: '', cuenta_bancaria_id: null }).error?.issues.map(i => i.path[0])).toEqual(['precio_venta', 'cuenta_bancaria_id'])
        expect(problemaCompraLegible({ type: 'urn:argosisp:problema:compra_con_pagos', title: 'x', status: 409, detail: 'Tiene pagos.' }).title).toBe('La compra tiene pagos')
        expect(etiquetaAccion('compras.registrar_desde_egreso')).toBe('Compra registrada desde un egreso')
        expect([rutaEntidad('compra', 5), rutaEntidad('activo', 2), rutaEntidad('proveedor', 4)]).toEqual(['/compras/5', '/activos/2', '/proveedores/4'])
        expect(registrableComoCompra({ estado: 'registrado', categoria: 'energia', compra_id: null })).toBe(true)
        expect(registrableComoCompra({ estado: 'registrado', categoria: 'otros', compra_id: 7 })).toBe(false)
    })

    it('fixture: compra con activo, desde egreso, pagos, anulación, constancia, activos, diferidos y antigüedad', async () => {
        // Saldos de los auxiliares y estado de cuenta.
        const proveedores = await useProveedores().listar()
        expect(proveedores.ok && proveedores.data.data.map(p => [p.nombre, p.saldo])).toEqual([
            ['Ciclo Sport, S.A.', '5000.00'],
            ['Electrónica Central', '0.00'],
            ['Empresa Eléctrica de Guatemala, S.A. (EEGSA)', '0.00'],
            ['Servicios de Limpieza Ramírez', '2210.00'],
        ])
        const cuenta = await useProveedores().estadoCuenta(1)
        expect(cuenta.ok && cuenta.data.pendientes).toEqual([{ compra_id: 1, documento: 'FACT A-88123', vence_en: '2026-09-19', saldo: '5000.00', dias_vencida: 26 }])

        // Al crédito con un activo fijo: nace el activo con la tasa máxima de la clase.
        const compra = await useCompras().registrar({ proveedor_id: 2, tipo_documento: 'FACT', serie: 'C', numero: '9001', fecha_documento: '2026-10-12', condicion: 'credito', lineas: [{ descripcion: 'Switch de núcleo', tipo: 'activo_fijo', clase_activo: 'equipo_red', total: '11200.00' }] }, 'f5-1')
        expect(compra.ok && compra.data).toMatchObject({ base_bienes: '10000.00', iva: '1200.00', total: '11200.00', saldo: '11200.00', vence_en: '2026-10-12', retenciones: [] })
        const activos = await useActivos().listar({ compra_id: compra.ok ? compra.data.id : 0 })
        expect(activos.ok && activos.data.data[0]).toMatchObject({ clase: 'equipo_red', costo: '10000.00', tasa_anual: '10.00', cuota_mensual: '83.33', inicio_depreciacion: '2026-11-01' })
        const duplicada = await useCompras().registrar({ proveedor_id: 2, tipo_documento: 'FACT', serie: 'C', numero: '9001', fecha_documento: '2026-10-12', condicion: 'credito', lineas: [{ descripcion: 'X', total: '10.00' }] }, 'f5-2')
        expect(duplicada.ok ? null : codigoProblema(duplicada.problema)).toBe('compra_duplicada')

        // Desde el egreso de EEGSA: el neto debe ser el monto del egreso.
        const distinta = await useCompras().registrarDesdeEgreso(2, { proveedor_id: 5, tipo_documento: 'FACT', numero: 'E-1', fecha_documento: '2026-10-10', lineas: [{ descripcion: 'Energía de octubre', total: '1800.00' }] }, 'f5-3')
        expect(distinta.ok ? null : codigoProblema(distinta.problema)).toBe('compra_distinta_del_egreso')
        const deEgreso = await useCompras().registrarDesdeEgreso(2, { proveedor_id: 5, tipo_documento: 'FACT', numero: 'E-1', fecha_documento: '2026-10-10', lineas: [{ descripcion: 'Energía de octubre', categoria: 'energia', total: '1850.40' }] }, 'f5-4')
        expect(deEgreso.ok && deEgreso.data).toMatchObject({ egreso_id: 2, condicion: 'contado', neto: '1850.40', iva: '198.26' })
        const otraVez = await useCompras().registrarDesdeEgreso(2, { proveedor_id: 5, tipo_documento: 'FACT', numero: 'E-2', fecha_documento: '2026-10-10', lineas: [{ descripcion: 'Energía', total: '1850.40' }] }, 'f5-5')
        expect(otraVez.ok ? null : codigoProblema(otraVez.problema)).toBe('egreso_con_compra')

        // Pago: no pasa de lo pendiente; se aplica a la pedida; anularlo devuelve el saldo.
        const demasiado = await usePagosProveedores().registrar({ proveedor_id: 4, monto: '3000.00', metodo: 'banco' }, 'f5-6')
        expect(demasiado.ok ? null : codigoProblema(demasiado.problema)).toBe('pago_excede_saldo')
        const pago = await usePagosProveedores().registrar({ proveedor_id: 1, monto: '2000.00', metodo: 'banco', compras: [1] }, 'f5-7')
        expect(pago.ok && pago.data.aplicaciones).toEqual([{ compra_id: 1, documento: 'FACT A-88123', monto: '2000.00' }])
        expect(bd.compras.find(c => c.id === 1)?.saldo).toBe('3000.00')
        const conPagos = await useCompras().anular(1, 'Prueba', 'f5-8')
        expect(conPagos.ok ? null : codigoProblema(conPagos.problema)).toBe('compra_con_pagos')
        await usePagosProveedores().anular(pago.ok ? pago.data.id : 0, 'Cheque rechazado', 'f5-9')
        expect(bd.compras.find(c => c.id === 1)?.saldo).toBe('5000.00')

        // Constancia de la retención de la limpieza; repetirla es 409.
        const constancia = await useCompras().registrarConstancia(5, { impuesto_codigo: 'RET_ISR_OPC_C', numero: 'CR-0001' }, 'f5-10')
        expect(constancia.ok && constancia.data).toMatchObject({ direccion: 'emitida', monto: '150.00', compra_id: 5, fecha: '2026-10-15' })
        const repetida = await useCompras().registrarConstancia(5, { impuesto_codigo: 'RET_ISR_OPC_C', numero: 'CR-0002' }, 'f5-11')
        expect(repetida.ok ? null : codigoProblema(repetida.problema)).toBe('constancia_registrada')

        // Activos: la depreciación está al día hasta septiembre; octubre no ha terminado.
        const depreciar = await useActivos().depreciar()
        expect(depreciar.ok && depreciar.data).toMatchObject({ hasta: '2026-09-01', cuotas: 0 })
        const octubre = await useActivos().depreciar('2026-10-31')
        expect(octubre.ok ? null : codigoProblema(octubre.problema)).toBe('mes_terminado')
        const tope = await useActivos().registrar({ clase: 'computacion', descripcion: 'Laptop', costo: '6000.00', tasa_anual: '40.00' }, 'f5-12')
        expect(tope.ok ? null : codigoProblema(tope.problema)).toBe('tasa_sobre_tope')

        // Diferir la línea de la limpieza en 3 meses; amortizar llega hasta septiembre: octubre sigue en curso.
        const diferido = await useDiferimientos().registrar({ origen: 'compra', compra_linea_id: 51, meses: 3 }, 'f5-13')
        expect(diferido.ok && diferido.data).toMatchObject({ total: '3000.00', inicio: '2026-10-01', pendiente: '3000.00', cuenta_diferida_codigo: '1.1.13' })
        const amortizar = await useDiferimientos().amortizar()
        expect(amortizar.ok && amortizar.data).toMatchObject({ hasta: '2026-09-01', cuotas: 0 })
        expect(bd.diferimientos.find(d => d.id === 1)).toMatchObject({ amortizado: '29.76', pendiente: '59.53' })

        // Antigüedad: las bicicletas vencidas (0-30 días) y la limpieza, por vencer.
        const reporte = await useReportes().reporte('cuentas-por-pagar')
        const filas = reporte.ok ? reporte.data.filas : []
        expect(filas.find(f => f.proveedor_id === 1)).toMatchObject({ dias_0_30: '5000.00', vencido: '5000.00' })
        expect(filas.find(f => f.proveedor_id === 4)).toMatchObject({ por_vencer: '2210.00', vencido: '0.00' })
        expect(bd.acciones.map(a => a.accion)).toEqual(expect.arrayContaining(['compras.registrar', 'compras.registrar_desde_egreso', 'compras.pagar', 'compras.anular_pago', 'compras.registrar_constancia', 'libro.registrar_diferimiento']))
    })

    it('ficha del proveedor: saldo, lo pendiente con su antigüedad y el estado de cuenta', async () => {
        const vista = await mountSuspended(PaginaProveedor, { route: '/proveedores/4' })
        await esperar(() => expect(vista.find('[data-prueba="proveedor-saldo"]').text()).toContain('2,210.00'))
        await esperar(() => expect(vista.find('[data-pendiente="5"]').exists()).toBe(true))
        expect(vista.find('[data-pendiente="5"]').text()).toContain('Vence el 04/11/2026')
        expect(vista.find('[data-prueba="tabla-cuenta-proveedor"]').text()).toContain('Pago · Pago 1')
        expect(vista.find('[data-prueba="saldo-final-proveedor"]').text()).toContain('2,210.00')
        expect(vista.find('[data-prueba="abrir-pago-proveedor"]').exists()).toBe(true)
    })

    it('ficha de la compra: retención sin constancia, anular avisa del pago; con error, «Reintentar» y nada más', async () => {
        const vista = await mountSuspended(PaginaCompra, { route: '/compras/5' })
        await esperar(() => expect(vista.find('[data-prueba="totales-compra"]').exists()).toBe(true))
        expect(vista.find('[data-prueba="saldo-compra"]').text()).toContain('2,210.00')
        await esperar(() => expect(vista.find('[data-retencion="RET_ISR_OPC_C"] [data-prueba="constancia-estado"]').text()).toBe('Sin constancia'))
        expect(vista.find('[data-prueba="abrir-constancia"]').exists()).toBe(true)
        expect(vista.find('[data-prueba="anular-compra"]').exists()).toBe(true)

        simularFalla('GET /api/v1/compras/:id', 500)
        const fallida = await mountSuspended(PaginaCompra, { route: '/compras/5' })
        await esperar(() => expect(fallida.text()).toContain('Reintentar'))
        expect(fallida.find('[data-prueba="totales-compra"]').exists()).toBe(false)
        expect(fallida.text()).not.toMatch(/Q\s?\d/)
    })

    it('activos y egresos: valor en libros y «Registrar su compra» solo en los egresos que pueden', async () => {
        const activos = await mountSuspended(PaginaActivos, { route: '/activos' })
        await esperar(() => expect(activos.find('[data-activo="2"]').exists()).toBe(true))
        expect(activos.find('[data-prueba="tabla-activos"]').text()).toContain('10,920.00')
        expect(activos.find('[data-activo="3"]').exists()).toBe(false)

        const egresos = await mountSuspended(PaginaEgresos, { route: '/egresos' })
        await esperar(() => expect(egresos.find('[data-prueba="compra-de-egreso-2"]').exists()).toBe(true))
        expect(egresos.find('[data-prueba="compra-de-egreso-2"]').attributes('href')).toBe('/compras/nueva?egreso=2')
        expect(egresos.find('[data-prueba="compra-de-egreso-3"]').exists()).toBe(false)
    })
})
