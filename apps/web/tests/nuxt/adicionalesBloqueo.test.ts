import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import { meAdmin } from '~~/fixtures/auth/sesiones'
import { bd } from '~~/fixtures/bd'
import { UApp } from '#components'
import AdicionalServicioModal from '~/components/AdicionalServicioModal.vue'
import ServicioAdicionales from '~/components/ServicioAdicionales.vue'

/**
 * Adicionales con el servicio suspendido (A1, `contratos/adicionales.md`): `bloqueo` y
 * `bloqueado_en` los pone y los quita el estado del servicio, con su historial; un `cobrado` lleva
 * `primer_periodo` («Cobrar proporcional este mes» o «Sin costo este mes») y `cobrado_desde`.
 */
function enApp(componente: Component, props: Record<string, unknown> = {}) {
    return defineComponent({ render: () => h(UApp, null, { default: () => h(componente, props) }) })
}

describe('adicionales · bloqueo y primer periodo', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
    })

    it('los fixtures traen los cuatro campos nuevos en cada asignación', () => {
        for (const fila of bd.adicionalesServicio) {
            expect(Object.keys(fila)).toEqual(expect.arrayContaining(['bloqueo', 'bloqueado_en', 'primer_periodo', 'cobrado_desde']))
            expect(fila.primer_periodo === null).toBe(fila.modalidad !== 'cobrado')
            expect(fila.bloqueado_en === null).toBe(fila.bloqueo === 'vigente')
        }
        const suspendidos = new Set(bd.servicios.filter(s => s.estado === 'suspendido').map(s => s.id))
        expect(bd.adicionalesServicio.filter(a => a.estado === 'activo' && suspendidos.has(a.servicio_id)).every(a => a.bloqueo === 'bloqueado')).toBe(true)
    })

    it('textos: resumen del cobro y cuerpos con primer_periodo solo en cobrado', () => {
        expect(resumenCobroAdicional({ modalidad: 'cobrado', primer_periodo: 'sin_costo', cobrado_desde: '2026-08-15T16:00:00.000Z' })).toBe('Desde 15/08/2026 · sin costo este mes')
        expect(resumenCobroAdicional({ modalidad: 'incluido', primer_periodo: null, cobrado_desde: null })).toBeNull()
        const base = { adicional_id: 2, identificador: '', precio: '35', motivo_id: null, motivo_detalle: '', primer_periodo: 'sin_costo' as const }
        expect(cuerpoAsignacion({ ...base, modalidad: 'cobrado' }, '').primer_periodo).toBe('sin_costo')
        expect(cuerpoAsignacion({ ...base, modalidad: 'incluido' }, '').primer_periodo).toBeNull()

        const cortesia = bd.adicionalesServicio.find(a => a.id === 3)
        const cobrado = bd.adicionalesServicio.find(a => a.id === 2)
        if (!cortesia || !cobrado) {
            throw new Error('faltan asignaciones')
        }
        const credencial = { accion: 'conservar' as const, valor: '' }
        // Pasar a cobrado manda el primer periodo elegido aunque sea el de por defecto.
        expect(cambiosAsignacion(cortesia, { ...base, modalidad: 'cobrado', primer_periodo: 'prorrateado' }, credencial).primer_periodo).toBe('prorrateado')
        // Seguir cobrado: solo si cambió.
        expect(cambiosAsignacion(cobrado, { ...entradaAsignacion(cobrado), adicional_id: 2 }, credencial)).not.toHaveProperty('primer_periodo')
        expect(cambiosAsignacion(cobrado, { ...entradaAsignacion(cobrado), adicional_id: 2, primer_periodo: 'sin_costo' }, credencial).primer_periodo).toBe('sin_costo')
    })

    it('agregar: cobrado con sin_costo guarda cobrado_desde; en un servicio suspendido nace bloqueado; con incluido es 422', async () => {
        const nuevo = await useAdicionalesServicio().agregar(1, { adicional_id: 2, modalidad: 'cobrado', precio: '35.00', primer_periodo: 'sin_costo' }, nuevaClaveIdempotencia())
        expect(nuevo.ok && [nuevo.data.primer_periodo, nuevo.data.bloqueo, typeof nuevo.data.cobrado_desde]).toEqual(['sin_costo', 'vigente', 'string'])

        const enSuspendido = await useAdicionalesServicio().agregar(2, { adicional_id: 1, modalidad: 'incluido' }, nuevaClaveIdempotencia())
        if (!enSuspendido.ok) {
            throw new Error(enSuspendido.problema.title)
        }
        expect([enSuspendido.data.bloqueo, enSuspendido.data.primer_periodo, enSuspendido.data.cobrado_desde]).toEqual(['bloqueado', null, null])
        const historial = await useAdicionalesServicio().bloqueos(2, enSuspendido.data.id)
        expect(historial.ok && historial.data.data.map(b => [b.accion, b.estado_servicio])).toEqual([['bloqueado', 'suspendido']])

        const malo = await useAdicionalesServicio().agregar(1, { adicional_id: 1, modalidad: 'incluido', primer_periodo: 'sin_costo' }, nuevaClaveIdempotencia())
        expect(!malo.ok && malo.problema.errors?.[0]?.field).toBe('primer_periodo')
    })

    it('editar: pasar a cobrado fija cobrado_desde y prorrateado; dejar de serlo los borra', async () => {
        const cortesia = bd.adicionalesServicio.find(a => a.id === 3)
        if (!cortesia) {
            throw new Error('falta la cortesía')
        }
        const cobrado = await useAdicionalesServicio().editar(1, 3, { version: cortesia.version, modalidad: 'cobrado', precio: '35.00' })
        if (!cobrado.ok) {
            throw new Error(cobrado.problema.title)
        }
        expect([cobrado.data.primer_periodo, typeof cobrado.data.cobrado_desde]).toEqual(['prorrateado', 'string'])
        const incluido = await useAdicionalesServicio().editar(1, 3, { version: cobrado.data.version, modalidad: 'incluido' })
        expect(incluido.ok && [incluido.data.primer_periodo, incluido.data.cobrado_desde]).toEqual([null, null])
    })

    it('suspender bloquea los adicionales del servicio y reactivar los desbloquea, con historial y sin tocar la version', async () => {
        const antes = bd.adicionalesServicio.filter(a => a.servicio_id === 1 && a.estado === 'activo').map(a => [a.id, a.version])
        const suspendido = await useServicios().ejecutar(1, 'suspender', 'Solicitud del cliente', nuevaClaveIdempotencia())
        expect(suspendido.ok).toBe(true)
        const bloqueados = await useAdicionalesServicio().listar(1, 'activo')
        expect(bloqueados.ok && bloqueados.data.data.every(a => a.bloqueo === 'bloqueado' && a.bloqueado_en !== null)).toBe(true)
        expect(bloqueados.ok && bloqueados.data.data.map(a => [a.id, a.version]).sort((x, y) => (x[0] ?? 0) - (y[0] ?? 0))).toEqual(antes.sort((x, y) => (x[0] ?? 0) - (y[0] ?? 0)))

        const reactivado = await useServicios().ejecutar(1, 'reactivar', 'Volvió de viaje', nuevaClaveIdempotencia())
        expect(reactivado.ok).toBe(true)
        const vigentes = await useAdicionalesServicio().listar(1, 'activo')
        expect(vigentes.ok && vigentes.data.data.every(a => a.bloqueo === 'vigente' && a.bloqueado_en === null)).toBe(true)
        const historial = await useAdicionalesServicio().bloqueos(1, 2)
        expect(historial.ok && historial.data.data.map(b => [b.accion, b.estado_servicio, b.motivo])).toEqual([
            ['desbloqueado', 'activo', 'Volvió de viaje'],
            ['bloqueado', 'suspendido', 'Solicitud del cliente'],
            ['desbloqueado', 'activo', 'Pago registrado'],
            ['bloqueado', 'suspendido', 'Corte por 1 factura vencida'],
        ])
    })

    it('ficha: «Bloqueado» con su fecha y el historial; el cobrado muestra cómo entró', async () => {
        const servicio = bd.servicios.find(s => s.id === 2)
        const vista = await mountSuspended(enApp(ServicioAdicionales, { servicio }))
        await vi.waitFor(() => expect(vista.find('[data-prueba="adicional-bloqueado"]').exists()).toBe(true))
        expect(vista.find('[data-prueba="adicional-bloqueado"]').text()).toBe('Bloqueado')
        expect(vista.find('[data-prueba="adicional-bloqueado-desde"]').text()).toMatch(/^Desde el \d{2}\/\d{2}\/\d{4}, \d{2}:\d{2} · servicio suspendido$/)
        expect(vista.find('[data-prueba="adicional-cobro"]').text()).toBe('Desde 15/08/2026 · sin costo este mes')
        expect(vista.find('[data-prueba^="editar-adicional-"]').exists()).toBe(true)

        const iptv = bd.adicionalesServicio.find(a => a.servicio_id === 2 && a.identificador === 'iptv-0101')
        await vista.find(`[data-prueba="bloqueos-adicional-${iptv?.id}"]`).trigger('click')
        await vi.waitFor(() => expect(document.body.querySelector('[data-prueba="historial-bloqueos"] [data-bloqueo="bloqueado"]')).not.toBeNull())
        expect(document.body.querySelector('[data-prueba="historial-bloqueos"]')?.textContent).toContain('Corte por facturas vencidas')
        vista.unmount()
    })

    it('el modal ofrece el primer periodo solo con Cobrado', async () => {
        const servicio = bd.servicios.find(s => s.id === 1)
        const vista = await mountSuspended(enApp(AdicionalServicioModal, { servicio, asignacion: null, open: true }))
        await vi.waitFor(() => expect(document.body.querySelector('[data-prueba="asignacion-primer-periodo"]')).not.toBeNull())
        const texto = document.body.querySelector('[data-prueba="asignacion-primer-periodo"]')?.textContent ?? ''
        expect(texto).toContain('Cobrar proporcional este mes')
        expect(texto).toContain('Sin costo este mes')
        vista.unmount()

        const cortesia = bd.adicionalesServicio.find(a => a.id === 3)
        const edicion = await mountSuspended(enApp(AdicionalServicioModal, { servicio, asignacion: cortesia, open: true }))
        await vi.waitFor(() => expect(document.body.querySelector('[data-prueba="asignacion-modalidad"]')).not.toBeNull())
        expect(document.body.querySelector('[data-prueba="asignacion-primer-periodo"]')).toBeNull()
        edicion.unmount()
    })
})
