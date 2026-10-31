import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import { meAdmin } from '~~/fixtures/auth/sesiones'
import { bd } from '~~/fixtures/bd'
import { leerXmlFel, xmlFelDemo } from '~~/fixtures/compras/borradores'
import { UApp } from '#components'
import PaginaBorrador from '~/pages/compras/borradores/[id].vue'
import PaginaCargar from '~/pages/compras/cargar.vue'
import PaginaConfiguracion from '~/pages/configuracion/inventario.vue'
import PaginaLote from '~/pages/inventario/productos-lote.vue'
import PaginaProductos from '~/pages/inventario/productos.vue'
import { esperar } from '../ayudas/esperar'

/**
 * Inventario fase D (A3, `contratos/inventario.md` D.3–D.5): modalidad del producto, alta por lote
 * (pegar desde Excel, errores por fila), factura de compra desde XML FEL o con IA (confianza por campo,
 * captura manual sin IA, 409 de duplicados) y la configuración (firma e IA con la clave que no vuelve).
 */

function conApp(componente: Parameters<typeof h>[0], props: Record<string, unknown> = {}) {
    return defineComponent({ render: () => h(UApp, null, { default: () => h(componente, props) }) })
}

const clave = () => nuevaClaveIdempotencia()
const archivoXml = (numero?: string, receptor?: string) => new File([xmlFelDemo(numero, receptor)], 'factura.xml', { type: 'text/xml' })

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

describe('alta por lote', () => {
    const tipos = [{ codigo: 'material', nombre: 'Material', seguimiento_defecto: 'cantidad' as const }, { codigo: 'equipo', nombre: 'Equipo', seguimiento_defecto: 'serie' as const }]

    it('pega desde Excel (con encabezado) o CSV; tipo por nombre y modalidad en palabras', () => {
        const excel = 'SKU\tNombre\tTipo\tUnidad\tModalidad\tPrecio\tCantidad\tCosto\nPAT-1\tPatch cord 1 m\tMaterial\tunidad\tcobro\tQ 25.00\t30\t8.50\nONU-X\tONU X\tEquipo\t\t\t\t\t350'
        const filas = filasDesdeTexto(excel, tipos)
        expect(filas.map(f => [f.sku, f.tipo, f.modalidad, f.precio_venta, f.cantidad, f.costo_unitario])).toEqual([['PAT-1', 'material', 'consumible_cobro', '25.00', '30', '8.50'], ['ONU-X', 'equipo', 'del_tipo', '', '', '350']])
        const csv = filasDesdeTexto('CAB-1;"Cable, exterior";material;metro', tipos)
        expect(csv[0]).toMatchObject({ sku: 'CAB-1', nombre: 'Cable, exterior', tipo: 'material', unidad: 'metro' })
        const cuerpo = cuerpoLote({ bodega_id: 1, filas: [...filas.slice(0, 1), { ...filas[1]!, series: 'SN1, AA:BB:CC:DD:EE:01' }] }, tipos)
        expect(cuerpo.productos[0]).toMatchObject({ entrada: { bodega_id: 1, cantidad: '30', costo_unitario: '8.50' }, modalidad: 'consumible_cobro' })
        expect(cuerpo.productos[1]).toMatchObject({ entrada: { bodega_id: 1, unidades: [{ serie: 'SN1', mac: null, costo: '350.00' }, { serie: null, mac: 'AA:BB:CC:DD:EE:01', costo: '350.00' }] } })
        expect(campoFilaLote('productos.3.entrada.cantidad')).toBe('filas.3.cantidad')
        expect(campoFilaLote('productos.0.entrada.unidades.1.serie')).toBe('filas.0.series')
        expect(filaDeDetalle('productos.4: La empresa ya tiene un producto')).toBe(4)
    })

    it('todo o nada: errores por fila y, sin errores, productos con su saldo inicial', async () => {
        const productos = useProductos()
        const sinClave = await productos.crearLote({ productos: [{ sku: 'X-1', nombre: 'Producto X', tipo: 'material' }] }, '')
        expect(sinClave.ok).toBe(false)
        const malo = await productos.crearLote({ productos: [{ sku: 'X-1', nombre: 'Producto X', tipo: 'material' }, { sku: 'x-1', nombre: 'Y', tipo: 'nada' }] }, clave())
        expect(!malo.ok && malo.problema.errors?.map(e => e.field)).toEqual(['productos.1.sku', 'productos.1.nombre', 'productos.1.tipo'])
        expect(bd.productos.some(p => p.sku === 'X-1')).toBe(false)
        const bien = await productos.crearLote({ productos: [
            { sku: 'X-1', nombre: 'Producto X', tipo: 'material', entrada: { bodega_id: 1, cantidad: '10', costo_unitario: '2.50' } },
            { sku: 'X-2', nombre: 'Equipo X', tipo: 'equipo', entrada: { bodega_id: 1, unidades: [{ serie: 'XS-1', costo: '100.00' }] } },
        ] }, clave())
        expect(bien.ok && [bien.data.data.map(p => [p.sku, p.modalidad, p.existencia]), bien.data.movimientos.map(m => m.tipo)]).toEqual([[['X-1', 'consumible_gasto', '10.000'], ['X-2', 'comodato', '1.000']], ['saldo_inicial', 'saldo_inicial']])
    })

    it('la pantalla marca la fila con error y no crea nada', async () => {
        const pagina = await mountSuspended(conApp(PaginaLote))
        await esperar(() => expect(pagina.findAll('[data-prueba="lote-sku"]').length).toBe(3))
        expect(pagina.find('[data-prueba="tabla-lote"]').exists()).toBe(true)
        expect(pagina.find('[data-prueba="lote-pegar"]').exists()).toBe(true)
    })
})

describe('modalidad del producto', () => {
    it('la lista muestra la modalidad y el precio de cobro; el esquema exige la compatible', async () => {
        const pagina = await mountSuspended(conApp(PaginaProductos))
        await esperar(() => expect(pagina.find('[data-producto="CON-RJ45"]').exists()).toBe(true))
        expect(pagina.find('[data-prueba="tabla-productos"]').text()).toContain('Cobro')
        expect(pagina.find('[data-prueba="tabla-productos"]').text()).toContain('Q 5.00')
        expect(pagina.find('[data-prueba="productos-lote"]').exists()).toBe(true)
        const base = { ...entradaProducto(null), sku: 'A', nombre: 'Antena' }
        expect(esquemaProducto.safeParse({ ...base, seguimiento: 'cantidad', modalidad: 'comodato' }).success).toBe(false)
        expect(esquemaProducto.safeParse({ ...base, seguimiento: 'serie', modalidad: 'consumible_cobro' }).success).toBe(true)
    })
})

describe('factura de compra desde archivo', () => {
    it('el XML FEL se lee exacto y propone el proveedor y los productos', async () => {
        const datos = leerXmlFel(xmlFelDemo())
        expect(datos && [datos.emisor.nit, datos.serie, datos.numero, datos.totales.total, datos.lineas.length]).toEqual(['33214561', 'A1B2C3D4', '458721', '123.00', 2])
        const cargado = await useBorradoresCompra().cargar(archivoXml(), clave())
        expect(cargado.ok && [cargado.data.fuente, cargado.data.propuesta?.proveedor?.id, cargado.data.propuesta?.lineas.map(l => l.producto_sku ?? l.crear?.sku)]).toEqual(['xml_fel', 2, ['CON-RJ45', 'PATCH-CORD-CAT6']])
        const otraVez = await useBorradoresCompra().cargar(archivoXml(), clave())
        expect(!otraVez.ok && otraVez.problema.type).toBe('urn:argosisp:problema:archivo_duplicado')
    })

    it('sin IA, el PDF queda para captura manual; con IA, la confianza por campo', async () => {
        const pdf = new File([new TextEncoder().encode('%PDF-1.4\nBT (Factura) Tj ET\n%%EOF')], 'factura.pdf', { type: 'application/pdf' })
        const sinIa = await useBorradoresCompra().cargar(pdf, clave())
        expect(sinIa.ok && [sinIa.data.fuente, sinIa.data.error_extraccion?.startsWith('ia_no_configurada')]).toEqual(['ia', true])
        expect(textoErrorExtraccion('ia_no_configurada: x').titulo).toContain('No hay IA')
        const ia = await useConfiguracionInventario().guardarIa({ proveedor: 'anthropic', modelo: 'claude', api_key: 'secreta', activo: true, version: 0 }, clave())
        expect(ia.ok && [ia.data.clave_configurada, JSON.stringify(ia.data).includes('secreta')]).toEqual([true, false])
        const imagen = new File([Uint8Array.from([0x89, 0x50, 0x4E, 0x47, 1, 2, 3])], 'foto.png', { type: 'image/png' })
        const leida = await useBorradoresCompra().cargar(imagen, clave())
        expect(leida.ok && confianzaCampo(leida.data.confianza, 'numero')).toBe(0.72)
        expect(leida.ok && confianzaLinea(leida.data.confianza, 1, 'descripcion')).toBe(0.5)
        expect(nivelConfianza(0.55)?.color).toBe('error')
        expect(nivelConfianza(0.72)?.color).toBe('warning')
        expect(nivelConfianza(0.95)?.color).toBe('success')
    })

    it('confirmar registra la compra con su entrada al inventario; la misma factura otra vez es 409', async () => {
        const cargado = await useBorradoresCompra().cargar(archivoXml(), clave())
        if (!cargado.ok) {
            throw new Error('no se cargó')
        }
        const datos = datosDesdeBorrador(cargado.data.datos, '2026-10-01')
        const productos = bd.productos.map(p => ({ id: p.id, seguimiento: p.seguimiento }))
        const confirmacion = confirmacionDesdePropuesta(cargado.data.propuesta, datos, productos, [{ codigo: 'material', seguimiento_defecto: 'cantidad', modalidad_defecto: 'consumible_gasto' }])
        expect(confirmacion.proveedor_modo).toBe('existente')
        expect(esquemaConfirmacion.safeParse(confirmacion).success).toBe(false)
        confirmacion.lineas.forEach((l) => {
            l.bodega_id = 1
        })
        expect(esquemaConfirmacion.safeParse(confirmacion).success).toBe(true)
        const antes = bd.compras.length
        const confirmado = await useBorradoresCompra().confirmar(cargado.data.id, cuerpoConfirmacion(confirmacion, cargado.data.version), clave())
        expect(confirmado.ok ? null : confirmado.problema).toBeNull()
        expect(confirmado.ok && [confirmado.data.estado, typeof confirmado.data.compra_id]).toEqual(['confirmado', 'number'])
        expect(bd.compras.length).toBe(antes + 1)
        expect(bd.productos.some(p => p.sku === 'PATCH-CORD-CAT6')).toBe(true)
        // Otro archivo (otros bytes) con la misma factura: 409 compra_duplicada.
        const repetida = await useBorradoresCompra().cargar(archivoXml('458721', '1234567-8'), clave())
        expect(!repetida.ok && repetida.problema.type).toBe('urn:argosisp:problema:compra_duplicada')
    })

    it('pantallas: cargar sin IA muestra la captura manual; el borrador resalta la confianza', async () => {
        const cargar = await mountSuspended(conApp(PaginaCargar))
        await esperar(() => expect(cargar.find('[data-prueba="compra-cargar"]').exists()).toBe(true))
        cargar.unmount()
        await useConfiguracionInventario().guardarIa({ proveedor: 'openai', modelo: 'gpt', activo: true, version: 0 }, clave())
        const leida = await useBorradoresCompra().cargar(new File([Uint8Array.from([0xFF, 0xD8, 0xFF, 0x00])], 'foto.jpg', { type: 'image/jpeg' }), clave())
        const id = leida.ok ? leida.data.id : 0
        const pagina = await mountSuspended(conApp(PaginaBorrador), { route: `/compras/borradores/${id}` })
        await esperar(() => expect(pagina.find('[data-prueba="borrador-compra"]').exists()).toBe(true))
        expect(pagina.text()).toContain('Media (72 %)')
        expect(pagina.text()).toContain('Leído con IA')
        expect(pagina.find('[data-prueba="borrador-cuadre"]').text()).toContain('162.00')
        expect(pagina.find('[data-prueba="borrador-confirmar"]').exists()).toBe(true)
    })
})

describe('configuración del inventario', () => {
    it('firma obligatoria y la IA sin configurar (404) como formulario nuevo', async () => {
        const pagina = await mountSuspended(conApp(PaginaConfiguracion))
        await esperar(() => expect(pagina.find('[data-prueba="config-firma-obligatoria"]').exists()).toBe(true))
        await esperar(() => expect(pagina.find('[data-prueba="config-ia-sin"]').exists()).toBe(true))
        const config = useConfiguracionInventario()
        const viejo = await config.guardar(false, 0, clave())
        expect(!viejo.ok && viejo.problema.status).toBe(409)
        const cambiado = await config.guardar(false, 1, clave())
        expect(cambiado.ok && cambiado.data).toEqual({ empresa_id: 1, traslado_firma_obligatoria: false, version: 2 })
    })
})
