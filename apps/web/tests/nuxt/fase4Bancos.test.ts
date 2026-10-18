import Decimal from 'decimal.js'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reiniciarFixtures, sesionFixture, simularFalla } from '~~/fixtures'
import meAdmin from '~~/fixtures/auth/me.admin.json'
import meCajero from '~~/fixtures/auth/me.cajero.json'
import { bd } from '~~/fixtures/bd'
import { esperadoDelTurno } from '~~/fixtures/cajas/rutas'
import PaginaCaja from '~/pages/caja/index.vue'
import PaginaCartera from '~/pages/cartera/index.vue'
import PaginaConciliacion from '~/pages/bancos/conciliacion.vue'
import PaginaExtracto from '~/pages/bancos/extractos/[id].vue'
import PaginaPago from '~/pages/pagos/[id].vue'
import PaginaPorLiquidar from '~/pages/cobros/por-liquidar.vue'
import PaginaProveedores from '~/pages/configuracion/proveedores-cobro.vue'
import PaginaTransito from '~/pages/bancos/transito.vue'

/**
 * Fase 4 · cobros y bancos (A3, contrato de localización fiscal §10.3, §10.9 y §18): espejos de
 * los validadores, composables contra los fixtures (mismos errores que la API real) y pantallas
 * (errores visibles con "Reintentar", nada calculado sobre datos que no se leyeron).
 */
describe('fase 4 · cobros y bancos', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
    })

    describe('esquemas y sumas', () => {
        it('liquidación: bruto = Σ pagos − contracargos y neto = bruto − comisión', () => {
            expect(brutoEsperado([{ tipo: 'cobro', monto: '175.00' }, { tipo: 'cobro', monto: '93.33' }, { tipo: 'contracargo', monto: '50.00' }]).toFixed(2)).toBe('218.33')
            expect(netoDe('218.33', '6.55')?.toFixed(2)).toBe('211.78')
            expect(netoDe('218,33', '6.55')).toBeNull()
            const esquema = esquemaLiquidacion('2026-10-15')
            const base = { referencia: 'LIQ-1', fecha: '', bruto: '10.00', comision: '1.00', pagos: [1], contracargos: [], cuenta_id: null, archivo: '', nota: '' }
            expect(esquema.safeParse(base).success).toBe(true)
            const comisionMayor = esquema.safeParse({ ...base, comision: '11.00' })
            expect(!comisionMayor.success && comisionMayor.error.issues[0]?.message).toBe('La comisión no puede ser mayor que el bruto')
            expect(esquema.safeParse({ ...base, pagos: [] }).success).toBe(false)
            expect(esquema.safeParse({ ...base, fecha: '2026-10-16' }).success).toBe(false)
            const cuerpo = cuerpoLiquidacion(1, esquema.parse({ ...base, bruto: '10', archivo: 'liq.csv' }), 'a'.repeat(64))
            expect(cuerpo).toEqual({ proveedor_cobro_id: 1, referencia: 'LIQ-1', bruto: '10.00', comision: '1.00', neto: '9.00', pagos: [1], archivo: 'liq.csv', sha256: 'a'.repeat(64) })
        })

        it('antigüedad: más de cobros_liquidar_dias es anomalía', () => {
            expect(antiguedad(12, 7)).toEqual({ etiqueta: '12 días', color: 'error' })
            expect(antiguedad(0, 7)).toEqual({ etiqueta: 'Hoy', color: 'neutral' })
            expect(antiguedad(6, 7).color).toBe('warning')
        })

        it('proveedor: fecha de corte hoy o futura; edición sin desde', () => {
            const esquema = esquemaProveedorCobro('2026-10-15')
            const base = { ...entradaProveedorVacia(), nombre: 'Recurrente', pasarela: 'recurrente', cuenta_id: 16 }
            expect(esquema.safeParse(base).success).toBe(true)
            expect(esquema.safeParse({ ...base, desde: '2026-10-14' }).success).toBe(false)
            expect(esquema.safeParse({ ...base, cuenta_id: null }).success).toBe(false)
            expect(cuerpoProveedor(esquema.parse({ ...base, metodo: 'agente' }))).toEqual({ metodo: 'agente', nombre: 'Recurrente', cuenta_id: 16 })
            const proveedor = bd.proveedoresCobro[0]
            expect(proveedor).toBeDefined()
            if (proveedor) {
                const cambios = cuerpoEdicionProveedor(proveedor, esquema.parse({ ...entradaDeProveedor(proveedor), desde: '', activo: false }))
                expect(cambios).toEqual({ version: 1, activo: false })
            }
        })

        it('depósito: no supera el efectivo del turno; traslado entre cuentas distintas', () => {
            const deposito = esquemaDeposito('2026-10-15', new Decimal('300.00'))
            expect(deposito.safeParse({ monto: '300.00', boleta: 'B-1', fecha: '', cuenta_id: 16 }).success).toBe(true)
            const excede = deposito.safeParse({ monto: '300.01', boleta: 'B-1', fecha: '', cuenta_id: 16 })
            expect(!excede.success && excede.error.issues[0]?.message).toContain('No puede superar el efectivo del turno')
            expect(cuerpoDeposito(deposito.parse({ monto: '25', boleta: 'B-1', fecha: '', cuenta_id: 16 }))).toEqual({ monto: '25.00', boleta: 'B-1', cuenta_id: 16 })
            const traslado = esquemaTraslado('2026-10-15')
            const misma = traslado.safeParse({ monto: '10.00', referencia: 'T', fecha: '', origen: 6, destino: 6 })
            expect(!misma.success && misma.error.issues[0]?.path).toEqual(['destino'])
            expect(cuerpoTraslado(traslado.parse({ monto: '10', referencia: 'T', fecha: '', origen: 6, destino: 16 }))).toEqual({ monto: '10.00', referencia: 'T', origen: { cuenta_id: 6 }, destino: { cuenta_id: 16 } })
        })

        it('extracto: lee el CSV neutral (fechas locales, signos, comillas) y revisa que cuadre', () => {
            const csv = '﻿fecha;descripcion;referencia;monto;saldo\n18/10/2026;"CREDITO; TRANSF";TRF-1;268.33;1268.33\n2026-10-18;COMISION;;-15.00;1253.33\n'
            const leido = leerExtractoCsv(csv)
            expect(leido.errores).toEqual([])
            expect(leido.lineas).toEqual([
                { fecha: '2026-10-18', descripcion: 'CREDITO; TRANSF', referencia: 'TRF-1', monto: '268.33', saldo: '1268.33' },
                { fecha: '2026-10-18', descripcion: 'COMISION', referencia: null, monto: '-15.00', saldo: '1253.33' },
            ])
            expect([leido.desde, leido.hasta, leido.saldoInicial, leido.saldoFinal]).toEqual(['2026-10-18', '2026-10-18', '1000.00', '1253.33'])
            expect(extractoCuadra(leido.lineas, '1000.00', '1253.33')).toBe(true)
            expect(extractoCuadra(leido.lineas, '1000.00', '1300.00')).toBe(false)
            const malo = leerExtractoCsv('fecha,monto\n2026-13-45,abc\n')
            expect(malo.errores[0]?.mensaje).toBe('Faltan las columnas descripcion en el encabezado')
            const filas = leerExtractoCsv('fecha,descripcion,monto\nayer,X,1.00\n2026-10-01,,1,5\n')
            expect(filas.errores.map(e => e.fila)).toEqual([1, 2])
        })

        it('regla: regex válida y contrapartida con su acción; castigo y provisión con la frase', () => {
            const regla = esquemaRegla()
            expect(regla.safeParse({ ...entradaReglaVacia(), nombre: 'Comisiones', patron: 'comision' }).success).toBe(true)
            expect(regla.safeParse({ ...entradaReglaVacia(), nombre: 'Mala', tipo_condicion: 'regex', patron: '([' }).success).toBe(false)
            expect(regla.safeParse({ ...entradaReglaVacia(), nombre: 'Sin cuenta', patron: 'x', contrapartida: '' }).success).toBe(false)
            expect(cuerpoRegla(regla.parse({ ...entradaReglaVacia(), nombre: 'Cliente', patron: 'x', accion: 'cliente', monto_min: '0.01' }))).toMatchObject({ accion: 'cliente', contrapartida: null, monto_min: '0.01', monto_max: null })
            expect(condicionRegla({ tipo_condicion: 'contiene', patron: 'comision', monto_min: null, monto_max: '0.00' })).toBe('Contiene "comision" · hasta Q 0.00')

            const castigo = { facturas: [1], motivo: 'Cerró', evidencia: 'Tres llamadas', confirmacion: 'castigar ' }
            expect(esquemaCastigo.safeParse(castigo).success).toBe(true)
            expect(esquemaCastigo.safeParse({ ...castigo, confirmacion: 'si' }).success).toBe(false)
            expect(esquemaCastigo.safeParse({ ...castigo, evidencia: '' }).success).toBe(false)
            const provision = esquemaProvision('2026-10-15')
            expect(provision.safeParse({ anio: 2026, fecha: '', confirmacion: 'provisionar 2026' }).success).toBe(true)
            expect(provision.safeParse({ anio: 2026, fecha: '', confirmacion: 'PROVISIONAR 2025' }).success).toBe(false)
            expect(provision.safeParse({ anio: 2025, fecha: '2026-01-01', confirmacion: 'PROVISIONAR 2025' }).success).toBe(false)
        })

        it('cuentas del libro sin repetir subcuenta; un estado de factura desconocido se muestra tal cual', () => {
            const cuentas = cuentasBanco(bd.cuentasBancarias, [{ id: 2, empresa_id: 1, nombre: 'Banco Industrial · Monetaria', banco_id: 2, banco: 'Banco Industrial', numero_enmascarado: '******3456', cuenta_id: 16, cuenta_codigo: '1.1.02.02', cuenta_nombre: 'x' }])
            expect(cuentas.map(c => c.codigo)).toEqual(['1.1.02.01', '1.1.02.02'])
            expect(estadoFacturaVisual('castigada')).toMatchObject({ etiqueta: 'Castigada', color: 'neutral' })
            expect(estadoFacturaVisual('pagada').etiqueta).toBe('Pagada')
        })
    })

    describe('cobros por liquidar y liquidaciones', () => {
        it('por proveedor: puente, pendiente, contracargo y la anomalía de más de 7 días', async () => {
            const resultado = await useLiquidaciones().porLiquidar()
            expect(resultado.ok).toBe(true)
            const pasarela = resultado.ok ? resultado.data.find(r => r.codigo === 'falsa') : undefined
            expect(pasarela).toMatchObject({ saldo_libro: '218.33', pendiente: '218.33', cuadra: true, dias_limite: 7 })
            expect(pasarela?.pagos.map(p => [p.pago_id, p.tipo])).toEqual([[7002, 'cobro'], [7004, 'contracargo'], [7001, 'cobro']])
            expect(pasarela?.anomalias.map(p => p.pago_id)).toEqual([7002])
        })

        it('registrar: descuadrada (422), duplicada y pago ya liquidado (409); al liquidar sale de por liquidar', async () => {
            const api = useLiquidaciones()
            const descuadrada = await api.registrar({ proveedor_cobro_id: 1, referencia: 'LIQ-X', bruto: '100.00', comision: '1.00', pagos: [7001] }, nuevaClaveIdempotencia())
            expect(!descuadrada.ok && descuadrada.problema).toMatchObject({ type: 'urn:argosisp:problema:liquidacion_descuadrada', status: 422, detail: 'El bruto (Q100.00) no es la suma de los pagos menos los contracargos (Q175.00)' })
            const yaLiquidado = await api.registrar({ proveedor_cobro_id: 1, referencia: 'LIQ-Y', bruto: '268.33', comision: '1.00', pagos: [7003] }, nuevaClaveIdempotencia())
            expect(!yaLiquidado.ok && yaLiquidado.problema.errors?.[0]).toMatchObject({ field: 'pagos.0', rule: 'pago_ya_liquidado' })
            const duplicada = await api.registrar({ proveedor_cobro_id: 1, referencia: 'LIQ-2026-10-10', bruto: '175.00', comision: '1.00', pagos: [7001] }, nuevaClaveIdempotencia())
            expect(!duplicada.ok && duplicada.problema.type).toBe('urn:argosisp:problema:liquidacion_duplicada')

            const clave = nuevaClaveIdempotencia()
            const datos = { proveedor_cobro_id: 1, referencia: 'LIQ-2026-10-15', bruto: '218.33', comision: '6.55', neto: '211.78', pagos: [7001, 7002], contracargos: [7004] }
            const hecha = await api.registrar(datos, clave)
            expect(hecha.ok && hecha.data).toMatchObject({ neto: '211.78', cuenta_codigo: '1.1.02.02', pagos: [{ pago_id: 7001, tipo: 'cobro' }, { pago_id: 7002, tipo: 'cobro' }, { pago_id: 7004, tipo: 'contracargo' }] })
            // Misma clave: la misma respuesta, sin otra liquidación.
            const repetida = await api.registrar(datos, clave)
            expect(repetida.ok && hecha.ok && repetida.data.id).toBe(hecha.ok ? hecha.data.id : 0)
            const despues = await api.porLiquidar()
            expect(despues.ok && despues.data.find(r => r.codigo === 'falsa')).toMatchObject({ pendiente: '0.00', pagos: [] })
            const pago = await usePagos().ver(7001)
            expect(pago.ok && pago.data.liquidacion_id).toBe(hecha.ok ? hecha.data.id : 0)
        })

        it('la pantalla marca la anomalía y el contracargo, y abre la liquidación con lo pendiente', async () => {
            const vista = await mountSuspended(PaginaPorLiquidar, { route: '/cobros/por-liquidar' })
            await vi.waitFor(() => expect(vista.find('[data-proveedor="1"]').exists()).toBe(true))
            const tarjeta = vista.find('[data-proveedor="1"]')
            expect(tarjeta.find('[data-prueba="saldo-puente"]').text()).toContain('Q 218.33')
            expect(tarjeta.find('[data-prueba="anomalias"]').text()).toBe('1 con más de 7 días')
            expect(tarjeta.findAll('[data-anomalia="si"]')).toHaveLength(1)
            expect(tarjeta.text()).toContain('Contracargo #7004')
            expect(tarjeta.text()).toContain('− Q 50.00')
            await vi.waitFor(() => expect(vista.find('[data-prueba="tabla-liquidaciones"]').text()).toContain('LIQ-2026-10-10'))
            expect(vista.findAll('[data-prueba="abrir-liquidacion"]')).toHaveLength(2)
        })

        it('con error 501: el aviso con Reintentar y ningún saldo', async () => {
            simularFalla('GET /api/v1/cobros/por-liquidar', 501)
            const vista = await mountSuspended(PaginaPorLiquidar, { route: '/cobros/por-liquidar' })
            await vi.waitFor(() => expect(vista.find('[data-prueba="por-liquidar-error"]').exists()).toBe(true))
            expect(vista.text()).toContain('Reintentar')
            expect(vista.find('[data-prueba="saldo-puente"]').exists()).toBe(false)
            expect(vista.text()).not.toContain('Cuadra')
        })

        it('proveedores: crear (fecha de corte no pasada), duplicado y edición sin desde', async () => {
            const api = useProveedoresCobro()
            const pasada = await api.crear({ metodo: 'debito', nombre: 'Débito BI', cuenta_id: 16, desde: '2020-01-01' }, nuevaClaveIdempotencia())
            expect(!pasada.ok && pasada.problema.errors?.[0]?.field).toBe('desde')
            const creado = await api.crear({ metodo: 'debito', nombre: 'Débito BI', cuenta_id: 16 }, nuevaClaveIdempotencia())
            expect(creado.ok && creado.data).toMatchObject({ codigo: 'debito', cuenta_codigo: '1.1.10.03', cuenta_liquidacion_codigo: '1.1.02.02', activo: true })
            const otra = await api.crear({ metodo: 'debito', nombre: 'Otro débito', cuenta_id: 6 }, nuevaClaveIdempotencia())
            expect(!otra.ok && otra.problema.type).toBe('urn:argosisp:problema:proveedor_cobro_duplicado')
            const desde = await api.editar(1, { version: 1, desde: '2026-12-01' }, nuevaClaveIdempotencia())
            expect(!desde.ok && desde.problema.errors?.[0]).toMatchObject({ field: 'desde', rule: 'campo_solo_lectura' })
            const vista = await mountSuspended(PaginaProveedores, { route: '/configuracion/proveedores-cobro' })
            await vi.waitFor(() => expect(vista.find('[data-prueba="tabla-proveedores"]').text()).toContain('Débito BI'))
            expect(vista.find('[data-prueba="nuevo-proveedor"]').exists()).toBe(true)
        })
    })

    describe('depósitos, traslados y fondos en tránsito', () => {
        it('depositar: no más que el efectivo, boleta única; baja el esperado del cierre', async () => {
            const turno = bd.turnos.find(t => t.id === 42)
            expect(turno).toBeDefined()
            if (!turno) {
                return
            }
            const antes = esperadoDelTurno(turno)
            const excede = await useCajas().depositar(2, { monto: antes.plus(1).toFixed(2), boleta: 'B-1', cuenta_id: 16 }, nuevaClaveIdempotencia())
            expect(!excede.ok && excede.problema).toMatchObject({ type: 'urn:argosisp:problema:deposito_excede_efectivo', errors: [{ field: 'monto' }] })
            const hecho = await useCajas().depositar(2, { monto: '100.00', boleta: 'B-77', cuenta_id: 16 }, nuevaClaveIdempotencia())
            expect(hecho.ok && hecho.data).toMatchObject({ estado: 'en_transito', turno_id: 42, cuenta_codigo: '1.1.02.02' })
            expect(esperadoDelTurno(turno).toFixed(2)).toBe(antes.minus(100).toFixed(2))
            const repetida = await useCajas().depositar(2, { monto: '1.00', boleta: 'B-77', cuenta_id: 16 }, nuevaClaveIdempotencia())
            expect(!repetida.ok && repetida.problema.type).toBe('urn:argosisp:problema:deposito_duplicado')
            const cerrada = await useCajas().depositar(3, { monto: '1.00', boleta: 'B-78', cuenta_id: 16 }, nuevaClaveIdempotencia())
            expect(!cerrada.ok && cerrada.problema.type).toBe('urn:argosisp:problema:sin_turno_abierto')
        })

        it('la caja resta los depósitos del esperado provisional y el cajero deposita sin ver la lista', async () => {
            await useCajas().depositar(2, { monto: '100.00', boleta: 'B-80', cuenta_id: 16 }, nuevaClaveIdempotencia())
            const vista = await mountSuspended(PaginaCaja, { route: '/caja?caja=2' })
            await vi.waitFor(() => expect(vista.find('[data-prueba="turno-depositos"]').exists()).toBe(true))
            expect(vista.find('[data-prueba="turno-depositos"]').text()).toContain('− Q 100.00')
            expect(vista.find('[data-prueba="depositos-turno"]').text()).toContain('boleta B-80')
            const turno = bd.turnos.find(t => t.id === 42)
            expect(vista.find('[data-prueba="turno-esperado"]').text()).toContain(turno ? formatearQuetzales(esperadoDelTurno(turno)) : 'x')
            vista.unmount()

            useUsuarioActual().value = meCajero
            sesionFixture('fixture-cajero')
            const cajero = await mountSuspended(PaginaCaja, { route: '/caja?caja=1' })
            await vi.waitFor(() => expect(cajero.find('[data-prueba="abrir-deposito"]').exists()).toBe(true))
            expect(cajero.find('[data-prueba="turno-depositos"]').exists()).toBe(false)
        })

        it('traslado y fondos en tránsito: lo pendiente por empresa', async () => {
            const traslado = await useFondosEnTransito().trasladar({ monto: '500.00', referencia: 'TR-9', origen: { cuenta_id: 6 }, destino: { cuenta_bancaria_id: 2 } }, nuevaClaveIdempotencia())
            expect(traslado.ok && traslado.data).toMatchObject({ cuenta_origen_codigo: '1.1.02.01', cuenta_destino_codigo: '1.1.02.02', estado: 'en_transito' })
            const misma = await useFondosEnTransito().trasladar({ monto: '5.00', referencia: 'TR-10', origen: { cuenta_id: 16 }, destino: { cuenta_id: 16 } }, nuevaClaveIdempotencia())
            expect(misma.ok).toBe(false)
            const resumen = await useFondosEnTransito().resumen()
            expect(resumen.ok && resumen.data).toEqual([{ empresa_id: 1, saldo_libro: '3400.00', pendiente: '3400.00', diferencia: '0.00', cuadra: true, depositos: 1, traslados: 2 }])
            const vista = await mountSuspended(PaginaTransito, { route: '/bancos/transito' })
            await vi.waitFor(() => expect(vista.find('[data-prueba="tabla-traslados"]').text()).toContain('TR-9'))
            expect(vista.find('[data-prueba="tabla-depositos"]').text()).toContain('B-4471')
            expect(vista.find('[data-prueba="resumen-transito"]').text()).toContain('Q 3,400.00')
        })
    })

    describe('extractos y conciliación', () => {
        const base = { cuenta_id: 16, desde: '2026-10-15', hasta: '2026-10-15', saldo_inicial: '4795.48', saldo_final: '4895.48', lineas: [{ fecha: '2026-10-15', descripcion: 'ABONO', referencia: 'X-1', monto: '100.00' }] }

        it('importar: descuadrado y no encadena (422) legibles, el motivo lo fuerza, y repetido es 409 por línea', async () => {
            const api = useExtractos()
            const descuadrado = await api.importar({ ...base, saldo_final: '5000.00' }, nuevaClaveIdempotencia())
            expect(!descuadrado.ok && descuadrado.problema).toMatchObject({ type: 'urn:argosisp:problema:extracto_descuadrado', title: 'Extracto descuadrado', detail: 'Σ líneas (Q100.00) ≠ saldo final − saldo inicial (Q204.52)' })
            const noEncadena = await api.importar({ ...base, saldo_inicial: '100.00', saldo_final: '200.00' }, nuevaClaveIdempotencia())
            expect(!noEncadena.ok && noEncadena.problema.type).toBe('urn:argosisp:problema:extracto_no_encadena')
            const forzado = await api.importar({ ...base, saldo_inicial: '100.00', saldo_final: '200.00', motivo_no_encadena: 'El banco corrigió el saldo' }, nuevaClaveIdempotencia())
            expect(forzado.ok && forzado.data).toMatchObject({ lineas: 1, conciliadas: 0, motivo_no_encadena: 'El banco corrigió el saldo' })
            const repetido = await api.importar({ ...base, saldo_inicial: '200.00', saldo_final: '300.00' }, nuevaClaveIdempotencia())
            expect(!repetido.ok && repetido.problema).toMatchObject({ type: 'urn:argosisp:problema:extracto_duplicado', status: 409, errors: [{ field: 'lineas.0', rule: 'extracto_duplicado' }] })
        })

        it('aplicar reglas: comisión contra 5.3.07 y transferencia de cliente; el resto queda sin regla', async () => {
            const resultado = await useExtractos().aplicarReglas(1, nuevaClaveIdempotencia())
            expect(resultado.ok && resultado.data).toMatchObject({ extracto_id: 1, sin_pago: [], sin_regla: [3, 4, 6] })
            expect(resultado.ok && resultado.data.conciliadas.map(c => [c.linea_id, c.accion])).toEqual([[2, 'cliente'], [5, 'contrapartida']])
        })

        it('conciliar: descuadrada (422), con el depósito en tránsito (lo acredita), deshacer con motivo y registrar un abono', async () => {
            const api = useConciliaciones()
            const descuadrada = await api.conciliar({ linea_id: 3, movimientos: [9102] }, nuevaClaveIdempotencia())
            expect(!descuadrada.ok && descuadrada.problema.type).toBe('urn:argosisp:problema:conciliacion_descuadrada')
            const yaConciliada = await api.conciliar({ linea_id: 1, movimientos: [9102] }, nuevaClaveIdempotencia())
            expect(!yaConciliada.ok && yaConciliada.problema.type).toBe('urn:argosisp:problema:linea_conciliada')
            const deposito = await api.conciliar({ linea_id: 4, depositos: [1] }, nuevaClaveIdempotencia())
            expect(deposito.ok && deposito.data.movimientos[0]).toMatchObject({ origen_tipo: 'deposito', origen_id: 1, monto: '900.00' })
            expect(bd.depositos[0]?.estado).toBe('acreditado')
            if (!deposito.ok) {
                return
            }
            const anulada = await api.anular(deposito.data.id, 'Fecha equivocada', nuevaClaveIdempotencia())
            expect(anulada.ok && anulada.data).toMatchObject({ anulada: true, motivo_anulacion: 'Fecha equivocada' })
            const otraVez = await api.anular(deposito.data.id, 'Otra vez', nuevaClaveIdempotencia())
            expect(!otraVez.ok && otraVez.problema.type).toBe('urn:argosisp:problema:conciliacion_anulada')
            const sinCuenta = await useExtractos().registrarLinea(6, {}, nuevaClaveIdempotencia())
            expect(!sinCuenta.ok && sinCuenta.problema.errors?.[0]).toMatchObject({ field: 'cuenta', rule: 'required' })
            const registrada = await useExtractos().registrarLinea(6, { cuenta: '4.1.03', descripcion: 'Intereses de octubre' }, nuevaClaveIdempotencia())
            expect(registrada.ok && registrada.data.movimientos[0]).toMatchObject({ origen_tipo: 'banco', descripcion: 'Intereses de octubre', monto: '2.10' })
        })

        it('la pantalla del extracto: avance, aplicar reglas con su resultado y acciones por línea', async () => {
            const vista = await mountSuspended(PaginaExtracto, { route: '/bancos/extractos/1' })
            await vi.waitFor(() => expect(vista.find('[data-prueba="avance-conciliacion"]').text()).toBe('1 de 6'))
            expect(vista.findAll('[data-conciliar]')).toHaveLength(5)
            expect(vista.findAll('[data-deshacer]')).toHaveLength(1)
            await vista.find('[data-prueba="aplicar-reglas"]').trigger('click')
            await vi.waitFor(() => expect(vista.find('[data-prueba="resultado-reglas"]').exists()).toBe(true))
            expect(vista.find('[data-prueba="resultado-reglas"]').text()).toContain('Reglas aplicadas: 2 líneas conciliadas')
            expect(vista.find('[data-prueba="resultado-reglas"]').text()).toContain('3 sin regla que aplique')
            await vi.waitFor(() => expect(vista.find('[data-prueba="avance-conciliacion"]').text()).toBe('3 de 6'))
        })

        it('el reporte: libro y extracto con sus partidas en tránsito, y cuadra', async () => {
            const reporte = await useConciliaciones().reporte(16, '2026-10-15')
            const fila = reporte.ok ? reporte.data[0] : undefined
            expect(fila).toMatchObject({ saldo_libro: '3908.38', saldo_extracto: '4795.48', diferencia_apertura: '0.00', total_libro_en_transito: '-1400.40', total_extracto_en_transito: '-513.30', diferencia: '0.00', cuadra: true })
            const vista = await mountSuspended(PaginaConciliacion, { route: '/bancos/conciliacion?cuenta=16&fecha=2026-10-15' })
            await vi.waitFor(() => expect(vista.find('[data-cuenta="16"]').exists()).toBe(true))
            expect(vista.find('[data-prueba="saldo-extracto"]').text()).toContain('Q 4,795.48')
            expect(vista.find('[data-prueba="cuadra-conciliacion"]').text()).toBe('Cuadra')
        })
    })

    describe('cartera y pagos', () => {
        it('castigo: sin evidencia (422), luego la factura queda como diga la API', async () => {
            const factura = bd.facturas.find(f => f.estado === 'vencida' && new Decimal(f.total).gt(f.pagado))
            expect(factura).toBeDefined()
            if (!factura) {
                return
            }
            const sinEvidencia = await useCartera().castigar({ facturas: [factura.id], motivo: 'Cerró', evidencia: 'x' }, nuevaClaveIdempotencia())
            expect(!sinEvidencia.ok && sinEvidencia.problema).toMatchObject({ type: 'urn:argosisp:problema:castigo_sin_evidencia', errors: [{ field: 'evidencia' }] })
            const castigo = await useCartera().castigar({ facturas: [factura.id], motivo: 'Cliente cerró operaciones', evidencia: 'Tres llamadas y carta certificada' }, nuevaClaveIdempotencia())
            expect(castigo.ok && castigo.data).toMatchObject({ cliente_id: factura.cliente_id, estimacion: expect.any(String), facturas: [{ factura_id: factura.id }] })
            const leida = await useFacturas().ver(factura.id)
            expect(leida.ok && leida.data.estado).toBe('pagada')

            const vista = await mountSuspended(PaginaCartera, { route: '/cartera' })
            await vi.waitFor(() => expect(vista.find('[data-prueba="tabla-castigos"]').text()).toContain('Cliente cerró operaciones'))
            await vi.waitFor(() => expect(vista.find('[data-prueba="tabla-castigos"]').text()).toContain('Pagada'))
            expect(vista.find('[data-prueba="tabla-provisiones"]').text()).toContain('2025')
        })

        it('provisión: lo que falta hasta el tope del 3 %', async () => {
            const provision = await useCartera().provisionar({ anio: 2026, fecha: '2026-10-15' }, nuevaClaveIdempotencia())
            expect(provision.ok && provision.data).toMatchObject({ anio: 2026, porcentaje: '3.000000', saldo_anterior: '553.50' })
            if (provision.ok) {
                const tope = new Decimal(provision.data.tope)
                expect(provision.data.monto).toBe(Decimal.max(tope.minus('553.50'), 0).toFixed(2))
            }
        })

        it('ficha del pago: proveedor de cobro y liquidación; cerrar una diferencia pequeña', async () => {
            const liquidado = await mountSuspended(PaginaPago, { route: '/pagos/7003' })
            await vi.waitFor(() => expect(liquidado.find('[data-prueba="pago-proveedor"]').text()).toContain('Pasarela en línea · 1.1.10.01'))
            expect(liquidado.find('[data-prueba="pago-liquidacion"]').text()).toContain('Liquidación #1')
            liquidado.unmount()

            const factura = bd.facturas.find(f => f.estado === 'emitida' && (f.empresa_id ?? 1) === 1 && new Decimal(f.pagado).isZero())
            expect(factura).toBeDefined()
            if (!factura) {
                return
            }
            const pago = await usePagos().registrar({ cliente_id: factura.cliente_id, metodo: 'caja', caja_id: 2, monto: new Decimal(factura.total).minus('0.33').toFixed(2), facturas: [factura.id] }, nuevaClaveIdempotencia())
            expect(pago.ok).toBe(true)
            if (!pago.ok) {
                return
            }
            const vista = await mountSuspended(PaginaPago, { route: `/pagos/${pago.data.id}` })
            await vi.waitFor(() => expect(vista.find('[data-prueba="pago-saldo-facturas"]').text()).toContain('Q 0.33'))
            expect(vista.find('[data-prueba="abrir-cerrar-diferencia"]').exists()).toBe(true)
            vista.unmount()

            const cerrada = await usePagos().cerrarDiferencia(pago.data.id, 'Redondeo', nuevaClaveIdempotencia())
            expect(cerrada.ok && cerrada.data).toMatchObject({ monto: '0.33', tope: '1.00', notas: [{ factura_id: factura.id, monto: '0.33', ncre: false }] })
            const otraVez = await usePagos().cerrarDiferencia(pago.data.id, null, nuevaClaveIdempotencia())
            expect(!otraVez.ok && otraVez.problema.type).toBe('urn:argosisp:problema:sin_diferencia')
            const leida = await useFacturas().ver(factura.id)
            expect(leida.ok && leida.data.estado).toBe('pagada')
        })

        it('cerrar diferencia sobre el tope: 422 legible', async () => {
            const factura = bd.facturas.find(f => f.estado === 'emitida' && (f.empresa_id ?? 1) === 1 && new Decimal(f.pagado).isZero())
            if (!factura) {
                throw new Error('sin factura emitida')
            }
            const pago = await usePagos().registrar({ cliente_id: factura.cliente_id, metodo: 'caja', caja_id: 2, monto: new Decimal(factura.total).minus('5.00').toFixed(2), facturas: [factura.id] }, nuevaClaveIdempotencia())
            const resultado = pago.ok ? await usePagos().cerrarDiferencia(pago.data.id, null, nuevaClaveIdempotencia()) : null
            expect(resultado && !resultado.ok && resultado.problema).toMatchObject({ type: 'urn:argosisp:problema:diferencia_sobre_tope', detail: expect.stringContaining('Q5.00 pendientes') })
        })
    })
})
