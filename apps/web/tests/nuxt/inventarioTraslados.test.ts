import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import { meAdmin } from '~~/fixtures/auth/sesiones'
import { bd } from '~~/fixtures/bd'
import { FIRMA_SEMILLA_BASE64, FIRMA_SEMILLA_SHA256 } from '~~/fixtures/inventario/faseDDatos'
import { saldoDe } from '~~/fixtures/inventario/kardex'
import { UApp } from '#components'
import PaginaMiBodega from '~/pages/inventario/mi-bodega.vue'
import PaginaTiposProducto from '~/pages/inventario/tipos-producto.vue'
import PaginaDetalle from '~/pages/inventario/traslados/[id].vue'
import PaginaTraslados from '~/pages/inventario/traslados/index.vue'
import { esperar } from '../ayudas/esperar'

/**
 * Inventario fase D (A3, `contratos/inventario.md` D.1, D.2 y D.6): órdenes de traslado con la bodega
 * de tránsito, recepción con firma (PNG y SHA-256 del navegador), faltantes que vuelven al origen,
 * «Mi bodega» y tipos de producto.
 */

function conApp(componente: Parameters<typeof h>[0], props: Record<string, unknown> = {}) {
    return defineComponent({ render: () => h(UApp, null, { default: () => h(componente, props) }) })
}

const clave = () => nuevaClaveIdempotencia()
const firmaSemilla = () => Uint8Array.from(atob(FIRMA_SEMILLA_BASE64), c => c.charCodeAt(0))

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

describe('firma digital', () => {
    it('valida el PNG como la API (medidas y peso) y calcula su SHA-256 en el navegador', async () => {
        const bytes = firmaSemilla()
        expect(medidasPng(bytes)).toEqual({ ancho: 200, alto: 80 })
        expect(errorFirma(bytes)).toBeNull()
        expect(await sha256Hex(bytes)).toBe(FIRMA_SEMILLA_SHA256)
        const firma = await firmaDesdePng(bytes)
        expect(firma.ok && [firma.firma.sha256, firma.firma.png_base64]).toEqual([FIRMA_SEMILLA_SHA256, FIRMA_SEMILLA_BASE64])
        // Una cabecera de PNG de 20×10 px: fuera de los límites del contrato.
        const chica = bytes.slice()
        new DataView(chica.buffer).setUint32(16, 20)
        new DataView(chica.buffer).setUint32(20, 10)
        expect(errorFirma(chica)).toContain('50×20 a 1000×400')
        expect(errorFirma(new Uint8Array([1, 2, 3]))).toBe('La firma debe ser una imagen PNG')
        expect(medidasLienzo(1600, 200)).toEqual({ ancho: 1000, alto: 200 })
        expect(huellaCorta(FIRMA_SEMILLA_SHA256)).toBe('c5297c684187')
    })
})

describe('esquemas de la orden', () => {
    it('nueva orden: destino distinto, producto una vez, cantidad o equipos', () => {
        const base = { bodega_origen_id: 1, bodega_destino_id: 2, motivo: '', lineas: [{ producto_id: 1, seguimiento: 'cantidad' as const, cantidad: '20', unidad_ids: [] }] }
        expect(esquemaNuevaOrden.safeParse(base).success).toBe(true)
        expect(esquemaNuevaOrden.safeParse({ ...base, bodega_destino_id: 1 }).success).toBe(false)
        expect(esquemaNuevaOrden.safeParse({ ...base, lineas: [] }).success).toBe(false)
        expect(esquemaNuevaOrden.safeParse({ ...base, lineas: [...base.lineas, ...base.lineas] }).success).toBe(false)
        expect(esquemaNuevaOrden.safeParse({ ...base, lineas: [{ producto_id: 3, seguimiento: 'serie', cantidad: '', unidad_ids: [] }] }).success).toBe(false)
        const cuerpo = cuerpoNuevaOrden(esquemaNuevaOrden.parse({ ...base, lineas: [...base.lineas, { producto_id: 3, seguimiento: 'serie', cantidad: '', unidad_ids: [2] }] }))
        expect(cuerpo).toEqual({ bodega_origen_id: 1, bodega_destino_id: 2, motivo: null, lineas: [{ producto_id: 1, cantidad: '20' }, { producto_id: 3, unidad_ids: [2] }] })
        expect(buscarUnidadPorCodigo([{ serie: 'HWTC1', mac: 'AA:BB:CC:00:00:02' }], 'aabb.cc00.0002')?.serie).toBe('HWTC1')
        expect(buscarUnidadPorCodigo([{ serie: 'HWTC1', mac: null }], 'hwtc1')?.serie).toBe('HWTC1')
    })

    it('recepción: solo viajan las líneas con faltante; la firma digital es obligatoria', async () => {
        const orden = bd.inventarioFaseD.ordenes.find(o => o.id === 3)!
        const estado = recepcionDe(orden, 'firma_digital')
        expect(esquemaRecepcion.safeParse(estado).success).toBe(false)
        const firma = await firmaDesdePng(firmaSemilla())
        estado.firma = firma.ok ? firma.firma : null
        const todo = cuerpoRecepcion(esquemaRecepcion.parse(estado), 1, '2026-10-01T10:00:00.000Z')
        expect(todo.lineas).toBeUndefined()
        expect(todo.firma).toEqual({ png_base64: FIRMA_SEMILLA_BASE64, sha256: FIRMA_SEMILLA_SHA256 })
        estado.lineas[0]!.unidad_ids_faltantes = [6]
        const conFaltante = cuerpoRecepcion(esquemaRecepcion.parse(estado), 1, '2026-10-01T10:00:00.000Z')
        expect(conFaltante.lineas).toEqual([{ linea_id: 3, unidad_ids_faltantes: [6] }])
        expect(campoLineaRecepcion('lineas.0.series_faltantes', [3], [3])).toBe('lineas.0.unidad_ids_faltantes')
    })
})

describe('fixtures de las órdenes (como la API)', () => {
    it('enviar deja lo enviado en tránsito; recibir con faltante devuelve al origen', async () => {
        const ordenes = useOrdenesTraslado()
        const enviada = await ordenes.enviar({ bodega_origen_id: 1, bodega_destino_id: 2, motivo: 'Semana', lineas: [{ producto_id: 1, cantidad: '20' }, { producto_id: 3, unidad_ids: [2] }] }, clave())
        expect(enviada.ok && [enviada.data.numero, enviada.data.estado, enviada.data.costo_total]).toEqual([4, 'en_transito', '400.00'])
        if (!enviada.ok) {
            return
        }
        expect(saldoDe(bd.movimientosInventario, 1, 1).cantidad.toString()).toBe('260')
        expect(bd.unidadesInventario.find(u => u.id === 2)?.bodega_nombre).toBe('En tránsito')
        const [cable, onu] = enviada.data.lineas
        const sinFirma = await ordenes.recibir(enviada.data.id, { version: enviada.data.version }, clave())
        expect(!sinFirma.ok && sinFirma.problema.errors?.[0]).toMatchObject({ field: 'firma', rule: 'requerida' })
        const mala = await ordenes.recibir(enviada.data.id, { firma: { png_base64: FIRMA_SEMILLA_BASE64, sha256: '0'.repeat(64) } }, clave())
        expect(!mala.ok && mala.problema.type).toBe('urn:argosisp:problema:firma_invalida')
        const recibida = await ordenes.recibir(enviada.data.id, {
            metodo_recepcion: 'firma_digital',
            firma: { png_base64: FIRMA_SEMILLA_BASE64, sha256: FIRMA_SEMILLA_SHA256 },
            lineas: [{ linea_id: cable!.id, cantidad_recibida: '15.000' }, { linea_id: onu!.id, unidad_ids_faltantes: [2] }],
        }, clave())
        expect(recibida.ok && [recibida.data.estado, recibida.data.firma_sha256, recibida.data.lineas.map(l => l.faltante)]).toEqual(['recibida_con_diferencias', FIRMA_SEMILLA_SHA256, ['5.000', '1.000']])
        expect(saldoDe(bd.movimientosInventario, 1, 2).cantidad.toString()).toBe('15')
        expect(saldoDe(bd.movimientosInventario, 1, 1).cantidad.toString()).toBe('265')
        expect(bd.unidadesInventario.find(u => u.id === 2)?.bodega_id).toBe(1)
        const otra = await ordenes.recibir(enviada.data.id, { firma: { png_base64: FIRMA_SEMILLA_BASE64, sha256: FIRMA_SEMILLA_SHA256 } }, clave())
        expect(!otra.ok && [otra.problema.status, otra.problema.type]).toEqual([409, 'urn:argosisp:problema:traslado_ya_recibido'])
        const firma = await ordenes.firma(enviada.data.id)
        expect(firma.ok && firma.data.size).toBe(firmaSemilla().length)
        const pdf = await ordenes.pdf(enviada.data.id)
        expect(pdf.ok && pdf.data.type).toBe('application/pdf')
    })

    it('existencia insuficiente, cancelar con motivo y el papel firmado', async () => {
        const ordenes = useOrdenesTraslado()
        const demasiado = await ordenes.enviar({ bodega_origen_id: 1, bodega_destino_id: 2, lineas: [{ producto_id: 1, cantidad: '9999' }] }, clave())
        expect(!demasiado.ok && demasiado.problema.type).toBe('urn:argosisp:problema:existencia_insuficiente')
        const cancelada = await ordenes.cancelar({ id: 3, version: 1 }, 'Se cambió de técnico', clave())
        expect(cancelada.ok && cancelada.data.estado).toBe('cancelada')
        expect(bd.unidadesInventario.find(u => u.id === 6)?.bodega_id).toBe(1)
        const deNuevo = await ordenes.recibir(3, {}, clave())
        expect(!deNuevo.ok && deNuevo.problema.type).toBe('urn:argosisp:problema:traslado_cancelado')

        const enviada = await ordenes.enviar({ bodega_origen_id: 1, bodega_destino_id: 2, lineas: [{ producto_id: 2, cantidad: '5' }] }, clave())
        const id = enviada.ok ? enviada.data.id : 0
        const papel = await ordenes.recibir(id, { metodo_recepcion: 'firma_papel' }, clave())
        expect(papel.ok && [papel.data.metodo_recepcion, papel.data.documento_sha256]).toEqual(['firma_papel', null])
        const archivo = new File([firmaSemilla()], 'orden-firmada.png', { type: 'image/png' })
        const adjunto = await ordenes.adjuntarDocumento(id, archivo, 'Firmada en bodega', clave())
        expect(adjunto.ok && adjunto.data.documento_tipo).toBe('image/png')
        const repetido = await ordenes.adjuntarDocumento(id, archivo, null, clave())
        expect(!repetido.ok && repetido.problema.type).toBe('urn:argosisp:problema:documento_registrado')
    })
})

describe('pantallas', () => {
    it('lista de órdenes con su estado y filtro; el detalle con la firma guardada', async () => {
        const lista = await mountSuspended(conApp(PaginaTraslados))
        await esperar(() => expect(lista.find('[data-orden="3"]').exists()).toBe(true))
        expect(lista.find('[data-prueba="tabla-traslados"]').text()).toContain('En tránsito')
        expect(lista.find('[data-prueba="tabla-traslados"]').text()).toContain('Cancelada')
        expect(lista.find('[data-prueba="nueva-orden-traslado"]').exists()).toBe(true)
        lista.unmount()
        const detalle = await mountSuspended(conApp(PaginaDetalle), { route: '/inventario/traslados/1' })
        await esperar(() => expect(detalle.find('[data-prueba="recepcion-traslado"]').exists()).toBe(true))
        expect(detalle.find('[data-prueba="recepcion-traslado"]').text()).toContain('Firma digital')
        expect(detalle.find('[data-prueba="recepcion-traslado"]').text()).toContain('c5297c684187')
        expect(detalle.find('[data-prueba="traslado-recibir"]').exists()).toBe(false)
        expect(detalle.find('[data-prueba="traslado-imprimir"]').exists()).toBe(true)
        detalle.unmount()
        const enTransito = await mountSuspended(conApp(PaginaDetalle), { route: '/inventario/traslados/3' })
        await esperar(() => expect(enTransito.find('[data-prueba="traslado-recibir"]').exists()).toBe(true))
        expect(enTransito.find('[data-unidad-traslado="HWTC1A2B3C06"]').exists()).toBe(true)
        expect(enTransito.find('[data-prueba="traslado-cancelar"]').exists()).toBe(true)
    })

    it('la orden que no existe muestra el error con Reintentar', async () => {
        const detalle = await mountSuspended(conApp(PaginaDetalle), { route: '/inventario/traslados/999' })
        await esperar(() => expect(detalle.text()).toContain('Reintentar'))
        expect(detalle.find('[data-prueba="detalle-traslado"]').exists()).toBe(false)
    })

    it('Mi bodega: sin bodega propia lo dice; con alcance global se ve la de Pedro', async () => {
        const pagina = await mountSuspended(conApp(PaginaMiBodega))
        await esperar(() => expect(pagina.find('[data-prueba="mi-bodega-sin-bodega"]').exists()).toBe(true))
        pagina.unmount()
        const consulta = await useTecnicosInventario().miBodega({ usuario_id: 4 })
        expect(consulta.ok && [consulta.data.bodega?.nombre, consulta.data.traslados_pendientes?.map(o => o.numero), consulta.data.existencias?.map(e => e.modalidad)]).toEqual(['Vehículo de Pedro', [3], ['comodato']])
        expect(consulta.ok && consulta.data.kardex?.[0]?.fecha).toBe('2026-09-06')
        const tecnicos = await useTecnicosInventario().listar()
        expect(tecnicos.ok && tecnicos.data.data.map(t => [t.id_externo, t.nombre])).toEqual([['4', 'Pedro Técnico']])
    })

    it('si Mi bodega falla, el error con Reintentar y sin existencias inventadas', async () => {
        bd.fallas['GET /api/v1/inventario/mi-bodega'] = 500
        const pagina = await mountSuspended(conApp(PaginaMiBodega))
        await esperar(() => expect(pagina.text()).toContain('Reintentar'))
        expect(pagina.find('[data-prueba="mi-bodega-existencias"]').exists()).toBe(false)
    })

    it('tipos de producto: las semillas globales y crear uno con modalidad compatible', async () => {
        const pagina = await mountSuspended(conApp(PaginaTiposProducto))
        await esperar(() => expect(pagina.find('[data-tipo-producto="equipo"]').exists()).toBe(true))
        expect(pagina.find('[data-tipo-producto="equipo"]').text()).toContain('Global')
        expect(pagina.find('[data-prueba="tabla-tipos-producto"]').text()).toContain('Comodato')
        pagina.unmount()
        expect(esquemaTipoProducto.safeParse({ codigo: 'antena', nombre: 'Antena', seguimiento_defecto: 'cantidad', modalidad_defecto: 'comodato', global: false }).success).toBe(false)
        expect(codigoDesdeNombre('Fibra óptica 24h')).toBe('fibra_optica_24h')
        const tipos = useTiposProducto()
        const creado = await tipos.crear({ codigo: 'antena', nombre: 'Antena', seguimiento_defecto: 'serie', modalidad_defecto: 'consumible_cobro' }, clave())
        expect(creado.ok && creado.data.empresa_id).toBe(1)
        const mal = await tipos.crear({ codigo: 'cable_x', nombre: 'Cable', seguimiento_defecto: 'serie', modalidad_defecto: 'consumible_gasto' }, clave())
        expect(!mal.ok && mal.problema.errors?.[0]?.field).toBe('modalidad_defecto')
        const producto = await useProductos().crear({ sku: 'ANT-1', nombre: 'Antena 1', tipo: 'antena' }, clave())
        expect(producto.ok && [producto.data.tipo_nombre, producto.data.seguimiento, producto.data.modalidad]).toEqual(['Antena', 'serie', 'consumible_cobro'])
    })
})

describe('consumo con modalidad (D.3)', () => {
    it('un consumible de cobro genera el cargo único; un comodato no va por consumos', async () => {
        const servicio = bd.servicios.find(s => s.cliente_id === 1)!
        const consumo = await useInventario().consumir({ producto_id: 2, bodega_id: 1, cantidad: '4', servicio_id: servicio.id }, clave())
        expect(consumo.ok && [consumo.data.tipo, consumo.data.cargos, typeof consumo.data.factura_id]).toEqual(['venta', [{ id: consumo.ok ? consumo.data.factura_id : 0, producto_id: 2, monto: '20.00' }], 'number'])
        const sinServicio = await useInventario().consumir({ producto_id: 2, bodega_id: 1, cantidad: '1' }, clave())
        expect(!sinServicio.ok && sinServicio.problema.type).toBe('urn:argosisp:problema:cobro_sin_cliente')
    })
})
