import type { Problem } from '@argosisp/contracts'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import { datosInvalidos } from '~~/fixtures/comun'
import { meAdmin, meCajero } from '~~/fixtures/auth/sesiones'
import { bd } from '~~/fixtures/bd'
import { UApp } from '#components'
import ServicioEquipos from '~/components/ServicioEquipos.vue'
import PaginaBodegas from '~/pages/inventario/bodegas.vue'
import PaginaConteo from '~/pages/inventario/conteos/[id].vue'
import PaginaExistencias from '~/pages/inventario/index.vue'
import PaginaKardex from '~/pages/inventario/kardex.vue'
import PaginaPorRecuperar from '~/pages/inventario/por-recuperar.vue'
import PaginaProductos from '~/pages/inventario/productos.vue'
import PaginaUnidades from '~/pages/inventario/unidades.vue'
import PaginaValorizado from '~/pages/inventario/valorizado.vue'
import { esperar } from '../ayudas/esperar'

/** Inventario interno (A3, `contratos/inventario.md`): utilidades, fixtures fieles a la API y pantallas. */

function conApp(componente: Parameters<typeof h>[0], props: Record<string, unknown> = {}) {
    return defineComponent({ render: () => h(UApp, null, { default: () => h(componente, props) }) })
}

const clave = () => nuevaClaveIdempotencia()

beforeEach(() => {
    reiniciarFixtures()
    sesionFixture('fixture-admin')
    useUsuarioActual().value = meAdmin
    useEmpresaActiva().elegir(1)
})

afterEach(() => {
    sesionFixture(null)
    useUsuarioActual().value = null
})

describe('utilidades', () => {
    it('cantidades, series pegadas y MAC', () => {
        expect(formatearCantidad('280.000', 'metro')).toBe('280 metro')
        expect(formatearCantidad('12.500')).toBe('12.5')
        expect(partirSeries('SN1\nSN2, SN3;\n\n')).toEqual(['SN1', 'SN2', 'SN3'])
        expect(serieOMac('AA-BB-CC-00-00-09')).toEqual({ serie: null, mac: 'AA-BB-CC-00-00-09' })
        expect(serieOMac('HWTC99')).toEqual({ serie: 'HWTC99', mac: null })
        expect(identificacionUnidad({ serie: 'SN1', mac: null })).toBe('SN1')
    })

    it('el producto lleva su precio de venta: hasta 2 decimales, nunca negativo, vacío = sin precio', () => {
        const base = entradaProducto(null)
        expect(esquemaProducto.parse({ ...base, sku: 'X', nombre: 'Router', precio_venta: '450.5' }).precio_venta).toBe('450.5')
        expect(esquemaProducto.parse({ ...base, sku: 'X', nombre: 'Router' }).precio_venta).toBeNull()
        expect(esquemaProducto.safeParse({ ...base, sku: 'X', nombre: 'Router', precio_venta: '-1' }).success).toBe(false)
        expect(esquemaProducto.safeParse({ ...base, sku: 'X', nombre: 'Router', precio_venta: '1.999' }).success).toBe(false)
    })

    it('el esquema de cada operación pide lo suyo', () => {
        const base = { ...operacionVacia('consumo'), producto_id: 1, bodega_id: 1 }
        expect(esquemaOperacion.safeParse({ ...base, cantidad: '0' }).success).toBe(false)
        expect(esquemaOperacion.safeParse({ ...base, cantidad: '2.5' }).success).toBe(true)
        expect(esquemaOperacion.safeParse({ ...base, seguimiento: 'serie', cantidad: '1' }).success).toBe(false)
        expect(esquemaOperacion.safeParse({ ...base, operacion: 'ajuste', cantidad: '-2' }).success).toBe(false)
        expect(esquemaOperacion.safeParse({ ...base, operacion: 'ajuste', cantidad: '-2', motivo: 'Faltante' }).success).toBe(true)
        expect(esquemaOperacion.safeParse({ ...base, operacion: 'traslado', cantidad: '1', bodega_destino_id: 1 }).success).toBe(false)
        expect(esquemaOperacion.safeParse({ ...base, operacion: 'saldo_inicial', cantidad: '5' }).success).toBe(false)
        const cuerpo = cuerpoOperacion(esquemaOperacion.parse({ ...base, operacion: 'traslado', seguimiento: 'serie', unidad_ids: [2], bodega_destino_id: 2 }))
        expect(cuerpo).toEqual({ operacion: 'traslado', cuerpo: { producto_id: 1, bodega_origen_id: 1, bodega_destino_id: 2, unidad_ids: [2], motivo: null } })
    })
})

describe('fixtures del inventario (como la API)', () => {
    it('consumo al promedio, existencia insuficiente 409 y saldo corrido en el kardex', async () => {
        const inv = useInventario()
        const consumo = await inv.consumir({ producto_id: 1, bodega_id: 1, cantidad: '10' }, clave())
        expect(consumo.ok && [consumo.data.costo_total, consumo.data.saldo_cantidad, consumo.data.saldo_valor]).toEqual(['-25.00', '270.000', '675.00'])
        const demasiado = await inv.consumir({ producto_id: 1, bodega_id: 1, cantidad: '1000' }, clave())
        expect(!demasiado.ok && demasiado.problema).toMatchObject({ status: 409, type: 'urn:argosisp:problema:existencia_insuficiente', title: 'Existencia insuficiente' })
        const serie = await inv.consumir({ producto_id: 3, bodega_id: 1, cantidad: '1' }, clave())
        expect(!serie.ok && serie.problema.errors?.[0]).toMatchObject({ field: 'cantidad', rule: 'requiere_unidades' })
        const bajo = await inv.existencias({ bajo_minimo: true })
        expect(bajo.ok && bajo.data.data.map(e => e.producto_sku)).toEqual(['CON-RJ45'])
    })

    it('saldo inicial, traslado de equipos, ajuste con motivo y baja', async () => {
        const inv = useInventario()
        const repetido = await inv.saldoInicial({ producto_id: 1, bodega_id: 1, cantidad: '5', costo_unitario: '2.50' }, clave())
        expect(!repetido.ok && repetido.problema.type).toBe('urn:argosisp:problema:saldo_inicial_registrado')
        const nuevo = await inv.saldoInicial({ producto_id: 1, bodega_id: 2, cantidad: '50', costo_unitario: '2.40' }, clave())
        expect(nuevo.ok && nuevo.data.costo_total).toBe('120.00')
        const traslado = await inv.trasladar({ producto_id: 3, bodega_origen_id: 1, bodega_destino_id: 2, unidad_ids: [2] }, clave())
        expect(traslado.ok && traslado.data.movimientos?.map(m => [m.bodega_id, m.cantidad])).toEqual([[1, '-1.000'], [2, '1.000']])
        expect(bd.unidadesInventario.find(u => u.id === 2)?.bodega_id).toBe(2)
        const ajuste = await inv.ajustar({ producto_id: 2, bodega_id: 1, cantidad: '-2', motivo: 'Faltante en el conteo' }, clave())
        expect(ajuste.ok && ajuste.data.costo_total).toBe('-2.50')
        const baja = await inv.darDeBaja({ producto_id: 4, bodega_id: 1, unidad_id: 4, causa: 'danado', motivo: 'Se quemó' }, clave())
        expect(baja.ok && baja.data.costo_total).toBe('-425.00')
        expect(bd.unidadesInventario.find(u => u.id === 4)?.estado).toBe('dada_de_baja')
        const duplicada = await inv.saldoInicial({ producto_id: 3, bodega_id: 2, unidad: { serie: 'hwtc1a2b3c02' }, costo_total: '300.00' }, clave())
        expect(!duplicada.ok && duplicada.problema.type).toBe('urn:argosisp:problema:saldo_inicial_con_movimientos')
    })

    it('comodato: asignar, devolver a reparación, marcar reparada y servicio retirado 409', async () => {
        const equipos = useEquiposServicio()
        const servicio = bd.servicios.find(s => s.cliente_id === 1)!
        const asignado = await equipos.asignar(servicio.id, 2, null, clave())
        expect(asignado.ok && [asignado.data.estado, asignado.data.servicio_id]).toEqual(['en_comodato', servicio.id])
        const lista = await equipos.listar(servicio.id)
        expect(lista.ok && lista.data.map(e => e.id).sort()).toEqual([1, 2])
        const devuelto = await equipos.devolver(servicio.id, 2, { bodega_id: 1, condicion: 'usado', en_reparacion: true }, clave())
        expect(devuelto.ok && [devuelto.data.estado, devuelto.data.condicion]).toEqual(['en_reparacion', 'usado'])
        const reparada = await useUnidadesInventario().marcarReparada(2, 'Se cambió la fuente')
        expect(reparada.ok && reparada.data.estado).toBe('disponible')
        const retirado = bd.servicios.find(s => s.estado === 'retirado')!
        const noRecibe = await equipos.asignar(retirado.id, 2, null, clave())
        expect(!noRecibe.ok && noRecibe.problema.type).toBe('urn:argosisp:problema:servicio_retirado')
        const porRecuperar = await useReportesInventario().porRecuperar()
        expect(porRecuperar.ok && porRecuperar.data.data.map(e => e.serie)).toEqual(['HWTC1A2B3C05'])
    })

    it('conteo: captura contra lo esperado y cerrar ajusta el faltante; 409 con otro abierto', async () => {
        const conteos = useConteosInventario()
        const abierto = await conteos.abrir(1, 'Conteo de prueba', clave())
        expect(abierto.ok && abierto.data.estado).toBe('abierto')
        const otro = await conteos.abrir(1, null, clave())
        expect(!otro.ok && otro.problema.type).toBe('urn:argosisp:problema:conteo_abierto')
        const id = abierto.ok ? abierto.data.id : 0
        const linea = await conteos.capturar(id, { producto_id: 2, contado: '38' })
        expect(linea.ok && linea.data.lineas[0]).toMatchObject({ esperado_captura: '40.000', diferencia: '-2.000', valor_diferencia: '-2.50' })
        const cerrado = await conteos.cerrar({ id, version: linea.ok ? linea.data.version : 0 }, clave())
        expect(cerrado.ok && [cerrado.data.estado, cerrado.data.faltante]).toEqual(['cerrado', '2.50'])
        const kardex = await useInventario().kardex({ producto_id: 2, tipo: 'ajuste_conteo' })
        expect(kardex.ok && kardex.data.data[0]?.cantidad).toBe('-2.000')
    })

    it('compra con producto: entra al kardex y crea sus equipos; cargo único con producto: venta', async () => {
        const compra = await useCompras().registrar({
            proveedor_id: 2, tipo_documento: 'FACT', serie: 'R', numero: '77', fecha_documento: '2026-10-12', condicion: 'credito',
            lineas: [{ descripcion: 'ONU', tipo: 'bien', total: '784.00', producto_id: 3, bodega_id: 1, cantidad: 2, unidades: [{ serie: 'NUEVA01', mac: null }, { serie: null, mac: 'aabbcc000099' }] }],
        }, clave())
        expect(compra.ok && compra.data.lineas[0]).toMatchObject({ producto_id: 3, bodega_id: 1, cantidad: 2 })
        const nuevas = bd.unidadesInventario.filter(u => u.compra_id === (compra.ok ? compra.data.id : 0))
        expect(nuevas.map(u => [u.serie, u.mac, u.costo])).toEqual([['NUEVA01', null, '350.00'], [null, 'AA:BB:CC:00:00:99', '350.00']])
        const faltanSeries = await useCompras().registrar({
            proveedor_id: 2, tipo_documento: 'FACT', serie: 'R', numero: '78', fecha_documento: '2026-10-12', condicion: 'credito',
            lineas: [{ descripcion: 'ONU', tipo: 'bien', total: '392.00', producto_id: 3, bodega_id: 1, cantidad: 2, unidades: [{ serie: 'X1' }] }],
        }, clave())
        // 422 de validación (el de `datosInvalidos`), no un tipo propio
        expect(!faltanSeries.ok && [faltanSeries.problema.status, faltanSeries.problema.type]).toEqual([422, (datosInvalidos([]).cuerpo as Problem).type])
        expect(!faltanSeries.ok && faltanSeries.problema.errors).toEqual([expect.objectContaining({ field: 'lineas.0.unidades', rule: 'requiere_unidades' })])
        const sobranSeries = await useCompras().registrar({
            proveedor_id: 2, tipo_documento: 'FACT', serie: 'R', numero: '79', fecha_documento: '2026-10-12', condicion: 'credito',
            lineas: [{ descripcion: 'ONU', tipo: 'bien', total: '392.00', producto_id: 3, bodega_id: 1, cantidad: 1, unidades: [{ serie: 'X1' }, { serie: 'X2' }] }],
        }, clave())
        expect(!sobranSeries.ok && sobranSeries.problema.errors).toEqual([expect.objectContaining({ field: 'lineas.0.cantidad', rule: 'cantidad' })])

        const servicio = bd.servicios.find(s => s.cliente_id === 1)!
        const concepto = bd.conceptosCargo.find(c => c.empresa_id === 1 && c.activo)!
        expect(bd.productos.find(p => p.id === 4)?.precio_venta).toBe('650.00')
        const conPrecio = await useProductos().editar(1, { version: 1, precio_venta: '4.75' })
        expect(conPrecio.ok && conPrecio.data.precio_venta).toBe('4.75')
        const precioMalo = await useProductos().editar(1, { version: 2, precio_venta: '-1' })
        expect(!precioMalo.ok && precioMalo.problema.errors?.[0]?.field).toBe('precio_venta')
        const venta = await useCargoUnico().emitir({ servicio_id: servicio.id, lineas: [{ concepto_id: concepto.id, cantidad: '1', precio_unitario: '600.00', producto_id: 4, bodega_id: 1, unidad_id: 4 }] }, clave())
        expect(venta.ok && venta.data.documento).toBe('factura')
        expect(bd.unidadesInventario.find(u => u.id === 4)?.estado).toBe('vendida')
        expect(bd.movimientosInventario.at(-1)).toMatchObject({ tipo: 'venta', costo_total: '-425.00', origen_tipo: 'factura' })
    })

    it('valorizado a una fecha con el cuadre contra 1.1.14', async () => {
        const antes = await useReportesInventario().valorizado({ fecha: '2026-09-01' })
        expect(antes.ok && antes.data.total).toBe('2637.50')
        const hoy = await useReportesInventario().valorizado({ fecha: '2026-12-31' })
        expect(hoy.ok && hoy.data.cuadre).toEqual([{ empresa_id: 1, valor_kardex: hoy.ok ? hoy.data.total : '', saldo_libro: hoy.ok ? hoy.data.total : '', diferencia: '0.00' }])
    })
})

describe('pantallas', () => {
    it('existencias con bajo mínimo y su total; el kardex con saldo corrido', async () => {
        const pagina = await mountSuspended(conApp(PaginaExistencias), { route: '/inventario' })
        await esperar(() => expect(pagina.find('[data-existencia="1/1"]').exists()).toBe(true))
        expect(pagina.find('[data-existencia="2/1"]').text()).toContain('Bajo mínimo')
        expect(pagina.find('[data-prueba="tabla-existencias"]').text()).toContain('280 metro')
        expect(pagina.find('[data-prueba="existencias-total"]').exists()).toBe(true)
        pagina.unmount()
        const kardex = await mountSuspended(conApp(PaginaKardex), { route: '/inventario/kardex?producto=1' })
        await esperar(() => expect(kardex.findAll('[data-movimiento]').length).toBe(2))
        expect(kardex.find('[data-prueba="tabla-kardex"]').text()).toContain('Consumo')
    })

    it('productos, bodegas con el tope del técnico y equipos por serie', async () => {
        const productos = await mountSuspended(conApp(PaginaProductos))
        await esperar(() => expect(productos.find('[data-producto="ONU-HG8145"]').exists()).toBe(true))
        expect(productos.find('[data-producto="GRAPA-10"]').exists()).toBe(false)
        productos.unmount()
        const bodegas = await mountSuspended(conApp(PaginaBodegas))
        await esperar(() => expect(bodegas.find('[data-bodega="Vehículo de Pedro"]').exists()).toBe(true))
        expect(bodegas.find('[data-prueba="bodega-tope"]').text()).toContain('Solo la mueve Pedro Técnico')
        bodegas.unmount()
        const unidades = await mountSuspended(conApp(PaginaUnidades), { route: '/inventario/unidades?q=AABBCC000005' })
        await esperar(() => expect(unidades.findAll('[data-unidad]').length).toBe(1))
        expect(unidades.find('[data-prueba="tabla-unidades"]').text()).toContain('Por recuperar')
    })

    it('conteo cerrado con su faltante; por recuperar y valorizado; equipos del servicio', async () => {
        const conteo = await mountSuspended(conApp(PaginaConteo), { route: '/inventario/conteos/1' })
        await esperar(() => expect(conteo.find('[data-linea="CON-RJ45"]').exists()).toBe(true))
        expect(conteo.find('[data-prueba="conteo-estado"]').text()).toBe('Cerrado')
        conteo.unmount()
        const recuperar = await mountSuspended(conApp(PaginaPorRecuperar))
        await esperar(() => expect(recuperar.find('[data-prueba="tabla-por-recuperar"]').text()).toContain('HWTC1A2B3C05'))
        recuperar.unmount()
        const valorizado = await mountSuspended(conApp(PaginaValorizado), { route: '/inventario/valorizado?fecha=2026-09-01' })
        await esperar(() => expect(valorizado.find('[data-prueba="valorizado-total"]').text()).toContain('2,637.50'))
        expect(valorizado.find('[data-prueba="valorizado-cuadre"]').text()).toContain('cuadra')
        valorizado.unmount()
        const servicio = bd.servicios.find(s => s.cliente_id === 1)!
        const equipos = await mountSuspended(conApp(ServicioEquipos, { servicio }))
        await esperar(() => expect(equipos.find('[data-equipo="HWTC1A2B3C01"]').exists()).toBe(true))
        expect(equipos.find('[data-prueba="asignar-equipo"]').exists()).toBe(true)
    })

    it('si la API falla, existencias muestra el error con Reintentar; el cajero solo ve', async () => {
        bd.fallas['GET /api/v1/inventario/existencias'] = 500
        const pagina = await mountSuspended(conApp(PaginaExistencias), { route: '/inventario' })
        await esperar(() => expect(pagina.text()).toContain('Reintentar'))
        expect(pagina.find('[data-prueba="tabla-existencias"]').exists()).toBe(false)
        pagina.unmount()
        delete bd.fallas['GET /api/v1/inventario/existencias']
        useUsuarioActual().value = meCajero
        sesionFixture('fixture-cajero')
        const soloVer = await mountSuspended(conApp(PaginaExistencias), { route: '/inventario' })
        await esperar(() => expect(soloVer.find('[data-existencia="1/1"]').exists()).toBe(true))
        expect(soloVer.find('[data-prueba="inventario-registrar"]').exists()).toBe(false)
    })
})
