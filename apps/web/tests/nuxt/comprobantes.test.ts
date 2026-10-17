import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reiniciarFixtures, simularFalla } from '~~/fixtures'
import meAdmin from '~~/fixtures/auth/me.admin.json'
import PaginaComprobante from '~/pages/comprobantes/[id].vue'
import PaginaComprobantes from '~/pages/comprobantes/index.vue'

describe('semana 2 · cola de comprobantes', () => {
    beforeEach(() => {
        reiniciarFixtures()
        useNuxtApp().$tokenSesion.value = 'fixture-admin'
        useUsuarioActual().value = meAdmin
    })

    afterEach(() => {
        useNuxtApp().$tokenSesion.value = null
        useUsuarioActual().value = null
    })

    it('lista por estado y cliente, por id descendente', async () => {
        const api = useComprobantes()
        const pendientes = await api.listar({ estado: 'pendiente' })
        expect(pendientes.ok && pendientes.data.data.map(c => c.id)).toEqual([4, 3, 2])

        const rechazados = await api.listar({ estado: 'rechazado' })
        expect(rechazados.ok && rechazados.data.data.map(c => c.motivo_rechazo)).toEqual(['La boleta no aparece en el estado de cuenta de Banrural'])

        const delCliente = await api.listar({ cliente_id: 5 })
        expect(delCliente.ok && delCliente.data.data.map(c => c.metodo)).toEqual(['transferencia'])
    })

    it('el archivo llega como Blob con su tipo (foto o PDF)', async () => {
        const foto = await useComprobantes().archivo(2)
        expect(foto.ok && foto.data.type).toBe('image/png')
        const pdf = await useComprobantes().archivo(3)
        expect(pdf.ok && pdf.data.type).toBe('application/pdf')
        const ausente = await useComprobantes().archivo(999)
        expect(!ausente.ok && ausente.problema.status).toBe(404)
    })

    it('aprobar registra el pago con los datos del comprobante y reactiva el servicio', async () => {
        const antes = await useComprobantes().ver(2)
        expect(antes.ok && antes.data.servicio_id).toBe(2)
        const servicio = await useServicios().ver(2)
        expect(servicio.ok && servicio.data.estado).toBe('suspendido')

        const aprobado = await useComprobantes().aprobar(2, { nota: 'Verificado en banca en línea' }, nuevaClaveIdempotencia())
        expect(aprobado.ok).toBe(true)
        if (!aprobado.ok) {
            return
        }
        expect(aprobado.data.estado).toBe('aprobado')
        expect(aprobado.data.pago?.metodo).toBe('deposito')
        expect(aprobado.data.pago?.referencia).toBe('40022931')
        expect(aprobado.data.pago?.cuenta_bancaria_id).toBe(1)
        expect(aprobado.data.pago?.nota).toBe('Comprobante 2 · Verificado en banca en línea')
        // Sin `facturas`, primero las del servicio del comprobante.
        expect(aprobado.data.pago?.aplicaciones.map(a => a.factura_id)).toEqual([209, 210])
        expect(aprobado.data.pago?.servicios?.find(s => s.servicio_id === 2)).toMatchObject({ de: 'suspendido', estado: 'activo', cambiado: true })
        expect(aprobado.data.pago_id).toBe(aprobado.data.pago?.id)

        const otraVez = await useComprobantes().aprobar(2, {}, nuevaClaveIdempotencia())
        expect(!otraVez.ok && esComprobanteRevisado(otraVez.problema)).toBe(true)
    })

    it('aprobar con facturas elegidas las paga en ese orden', async () => {
        const aprobado = await useComprobantes().aprobar(3, { facturas: [610] }, nuevaClaveIdempotencia())
        expect(aprobado.ok && aprobado.data.pago?.aplicaciones[0]?.factura_id).toBe(610)
        expect(aprobado.ok && aprobado.data.pago?.banco_origen_nombre).toBe('Banco Industrial')
    })

    it('rechazar exige motivo y deja la referencia libre', async () => {
        const sinMotivo = await useComprobantes().rechazar(4, ' ', nuevaClaveIdempotencia())
        expect(!sinMotivo.ok && sinMotivo.problema.errors?.[0]?.field).toBe('motivo')

        const rechazado = await useComprobantes().rechazar(4, 'El monto no coincide con el banco', nuevaClaveIdempotencia())
        expect(rechazado.ok && rechazado.data).toMatchObject({ estado: 'rechazado', motivo_rechazo: 'El monto no coincide con el banco', pago_id: null })

        const pagos = await usePagos().listar({ metodo: 'ach' })
        expect(pagos.ok && pagos.data.data).toHaveLength(0)
    })

    it('los permisos comprobantes.* se piden en cada acción', async () => {
        useNuxtApp().$tokenSesion.value = 'fixture-cajero'
        const lista = await useComprobantes().listar()
        expect(lista.ok).toBe(true)
    })

    it('el contador del menú cuenta los pendientes y desaparece con error', async () => {
        const api = useComprobantes()
        await api.actualizarContador()
        expect(textoContador(api.contador.value)).toBe('3')
        await api.rechazar(4, 'Duplicado', nuevaClaveIdempotencia())
        await vi.waitFor(() => expect(textoContador(api.contador.value)).toBe('2'))
        simularFalla('GET /api/v1/comprobantes', 500)
        await api.actualizarContador()
        expect(api.contador.value).toBeNull()
        expect(textoContador(150)).toBe('99+')
        expect(textoContador(0)).toBeUndefined()
    })

    it('facturas por defecto: las del servicio del comprobante, la más antigua primero', async () => {
        const cuenta = await useClientes().estadoCuenta(2)
        expect(cuenta.ok).toBe(true)
        if (!cuenta.ok) {
            return
        }
        expect(facturasPorDefectoComprobante({ servicio_id: 2 }, cuenta.data.facturas_pendientes)).toEqual([209, 210])
        expect(facturasPorDefectoComprobante({ servicio_id: null }, cuenta.data.facturas_pendientes)).toEqual([])
        expect(esquemaAprobarComprobante.safeParse({ nota: 'x'.repeat(401) }).success).toBe(false)
    })

    it('la cola muestra pestañas y filas; con error muestra "Reintentar" y no la tabla', async () => {
        const vista = await mountSuspended(PaginaComprobantes, { route: '/comprobantes' })
        await vi.waitFor(() => expect(vista.text()).toContain('Comprobante #4'))
        expect(vista.text()).toContain('Pendientes')
        expect(vista.text()).toContain('Rechazados')
        expect(vista.text()).not.toContain('Comprobante #1')

        simularFalla('GET /api/v1/comprobantes', 501)
        const conError = await mountSuspended(PaginaComprobantes, { route: '/comprobantes?estado=rechazado' })
        await vi.waitFor(() => expect(conError.text()).toContain('Reintentar'))
        expect(conError.find('table').exists()).toBe(false)
    })

    it('el detalle muestra la foto junto a los datos y los botones de revisión', async () => {
        const vista = await mountSuspended(PaginaComprobante, { route: '/comprobantes/2' })
        await vi.waitFor(() => expect(vista.find('[data-prueba="comprobante-imagen"]').exists()).toBe(true))
        expect(vista.text()).toContain('40022931')
        expect(vista.text()).toContain('Banrural · Recaudación')
        expect(vista.text()).toContain('Aprobar')
        expect(vista.text()).toContain('Rechazar')

        const pdf = await mountSuspended(PaginaComprobante, { route: '/comprobantes/3' })
        await vi.waitFor(() => expect(pdf.find('[data-prueba="comprobante-pdf"]').exists()).toBe(true))
        expect(pdf.text()).toContain('Banco Industrial')

        const revisado = await mountSuspended(PaginaComprobante, { route: '/comprobantes/1' })
        await vi.waitFor(() => expect(revisado.find('[data-prueba="comprobante-rechazado"]').exists()).toBe(true))
        expect(revisado.text()).not.toContain('Aprobar')
    })
})
