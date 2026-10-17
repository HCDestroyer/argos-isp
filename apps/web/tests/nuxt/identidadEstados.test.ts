import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import EstadoFacturaBadge from '~/components/EstadoFacturaBadge.vue'
import EstadoSesionBadge from '~/components/EstadoSesionBadge.vue'

/** Identidad "vidrio y luz": todo estado lleva icono Lucide, texto y un color semántico que no es `primary`. */
const MAPAS = {
    servicio: ESTADOS_SERVICIO,
    factura: ESTADOS_FACTURA,
    pago: ESTADOS_PAGO,
    promesa: ESTADOS_PROMESA,
    comprobante: ESTADOS_COMPROBANTE,
    sesion: ESTADOS_SESION,
    router: ESTADOS_ROUTER,
    promesaActiva: { activa: PROMESA_ACTIVA },
} as const

describe('mapeo de estados', () => {
    for (const [familia, mapa] of Object.entries(MAPAS)) {
        it(`${familia}: icono Lucide, texto y color de estado`, () => {
            for (const presentacion of Object.values(mapa)) {
                expect(presentacion.icono).toMatch(/^i-lucide-[a-z0-9-]+$/)
                expect(presentacion.etiqueta.trim()).not.toBe('')
                expect(['success', 'info', 'warning', 'error', 'neutral']).toContain(presentacion.color)
            }
        })
    }

    it('los colores fijos del servicio y la urgencia de la factura', () => {
        expect([ESTADOS_SERVICIO.activo.color, ESTADOS_SERVICIO.limitado.color, ESTADOS_SERVICIO.suspendido.color, ESTADOS_SERVICIO.retirado.color])
            .toEqual(['success', 'warning', 'error', 'neutral'])
        expect(ESTADOS_FACTURA.vencida.color).toBe('error')
        expect(ESTADOS_FACTURA.pagada.color).toBe('success')
        expect(ESTADOS_ROUTER.caido.color).toBe('error')
        expect(ESTADOS_SESION.desconectada.color).toBe('neutral')
    })

    it('el arqueo lleva icono además de color', () => {
        expect(iconoDiferencia('0.00')).toBe('i-lucide-circle-check')
        expect(iconoDiferencia('-5.00')).toBe('i-lucide-circle-minus')
        expect(iconoDiferencia('5.00')).toBe('i-lucide-circle-plus')
    })
})

describe('badges de estado', () => {
    it('la factura vencida muestra su icono y su texto', async () => {
        const vista = await mountSuspended(EstadoFacturaBadge, { props: { estado: 'vencida' } })
        expect(vista.text()).toContain('Vencida')
        expect(vista.html()).toContain('alarm-clock')
    })

    it('la sesión en línea lleva el punto en vivo y la hora de la lectura; cada latido relanza el anillo', async () => {
        const vista = await mountSuspended(EstadoSesionBadge, {
            props: { estado: 'en_linea', latido: 1, leidoEn: '2026-10-17T15:42:00Z' },
        })
        expect(vista.text()).toContain('En línea')
        expect(vista.text()).toContain('En vivo · 09:42')
        const punto = vista.find('.live-dot')
        expect(punto.classes()).toContain('ring-a')
        await vista.setProps({ latido: 2 })
        expect(vista.find('.live-dot').classes()).toContain('ring-b')
    })

    it('la sesión desconectada no tiene punto en vivo', async () => {
        const vista = await mountSuspended(EstadoSesionBadge, { props: { estado: 'desconectada' } })
        expect(vista.text()).toContain('Desconectada')
        expect(vista.find('.live-dot').exists()).toBe(false)
    })
})
