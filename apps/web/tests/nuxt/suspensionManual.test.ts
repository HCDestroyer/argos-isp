import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import { UApp } from '#components'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import ServicioAccionModal from '~/components/ServicioAccionModal.vue'
import SuspensionManualBadge from '~/components/SuspensionManualBadge.vue'

describe('suspensión manual', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
    })

    afterEach(() => {
        sesionFixture(null)
    })

    function accion(nombre: AccionServicio): PresentacionAccionServicio {
        const encontrada = ACCIONES_SERVICIO.find(a => a.accion === nombre)
        if (!encontrada) {
            throw new Error(nombre)
        }
        return encontrada
    }

    async function servicioDe(clienteId: number): Promise<Servicio> {
        const resultado = await useServicios().listar({ cliente_id: clienteId })
        const [servicio] = resultado.ok ? resultado.data.data : []
        if (!servicio) {
            throw new Error(`sin servicio del cliente ${clienteId}`)
        }
        return servicio
    }

    it('con la marca puesta no se ofrecen Limitar ni Quitar límite; Reactivar sí', () => {
        const manual = { estado: 'suspendido' as const, suspension_manual: true }
        const disponibles = ACCIONES_SERVICIO.filter(a => accionDisponible(a, manual)).map(a => a.accion)
        expect(disponibles).toContain('reactivar')
        expect(disponibles).not.toContain('limitar')
        expect(disponibles).not.toContain('quitar_limite')
        // Si la API dejara la marca en otro estado, igual se esconden.
        expect(accionDisponible(accion('limitar'), { estado: 'activo', suspension_manual: true })).toBe(false)
        expect(accionDisponible(accion('quitar_limite'), { estado: 'limitado', suspension_manual: true })).toBe(false)
        expect(accionDisponible(accion('limitar'), { estado: 'activo', suspension_manual: false })).toBe(true)
    })

    it('suspender pone la marca con el motivo; limitar responde 422 suspension_manual; reactivar la quita', async () => {
        const api = useServicios()
        const suspendido = await api.ejecutar(5, 'suspender', 'Pidió suspender por viaje', nuevaClaveIdempotencia())
        expect(suspendido.ok).toBe(true)
        if (!suspendido.ok) {
            return
        }
        expect(suspendido.data.suspension_manual).toBe(true)
        expect(suspendido.data.suspension_manual_motivo).toBe('Pidió suspender por viaje')

        const limitar = await api.ejecutar(5, 'limitar', 'Intento', nuevaClaveIdempotencia())
        expect(!limitar.ok && limitar.problema.status).toBe(422)
        expect(!limitar.ok && limitar.problema.type).toBe('urn:argosisp:problema:suspension_manual')

        const reactivado = await api.ejecutar(5, 'reactivar', 'Regresó', nuevaClaveIdempotencia())
        expect(reactivado.ok && reactivado.data.suspension_manual).toBe(false)
        expect(reactivado.ok && reactivado.data.suspension_manual_motivo).toBeNull()
    })

    it('el servicio del cliente 22 viene suspendido a mano con su motivo', async () => {
        const servicio = await servicioDe(22)
        expect(servicio.estado).toBe('suspendido')
        expect(servicio.suspension_manual).toBe(true)
        expect(servicio.suspension_manual_motivo).toContain('viaja')
    })

    /** `UTooltip` necesita el `TooltipProvider` de `UApp`, como en la app real. */
    function conApp(servicio: Pick<Servicio, 'suspension_manual' | 'suspension_manual_motivo'>) {
        return defineComponent({
            render: () => h(UApp, null, { default: () => h(SuspensionManualBadge, { servicio, conMotivo: true }) }),
        })
    }

    it('badge con el motivo, y nada si no hay marca', async () => {
        const con = await mountSuspended(conApp({ suspension_manual: true, suspension_manual_motivo: 'Viaje' }))
        expect(con.text()).toContain('Suspendido manualmente')
        expect(con.text()).toContain('Viaje')

        const sin = await mountSuspended(conApp({ suspension_manual: false, suspension_manual_motivo: null }))
        expect(sin.text()).not.toContain('Suspendido manualmente')
    })

    it('el modal de suspender avisa que el corte y los pagos no lo reactivarán', async () => {
        const servicio = await servicioDe(1)
        const wrapper = await mountSuspended(ServicioAccionModal, {
            props: { servicio, accion: accion('suspender'), open: true },
        })
        const texto = document.body.textContent ?? ''
        expect(texto).toContain('Es una suspensión manual')
        expect(texto).toContain('los pagos no lo reactivarán')
        wrapper.unmount()
    })
})
