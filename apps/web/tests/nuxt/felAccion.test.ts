import type { Schema } from '@argosisp/contracts'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import { meAdmin } from '~~/fixtures/auth/sesiones'
import { bd } from '~~/fixtures/bd'
import { accionFelDe } from '~~/fixtures/fel/rutas'
import DteDocumento from '~/components/DteDocumento.vue'
import { esperar } from '../ayudas/esperar'

/**
 * Lote 3 de `contratos/fel-establecimientos.md` con la decisión del PM (primero se cobra y después se
 * certifica): la factura sin DTE dice qué le toca según `fel_accion` y el botón «Certificar
 * (opcional)» solo aparece pagada y sin DTE.
 */
type Accion = NonNullable<Schema<'Factura'>['fel_accion']>

describe('FEL · qué le toca a la factura (fel_accion)', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
    })

    async function montar(accion: Accion, modo: Schema<'Factura'>['fel_modo'] = 'opcional') {
        const vista = await mountSuspended(DteDocumento, {
            props: { tipo: 'factura', documentoId: 999_001, dteId: null, certificable: true, accion, modo },
        })
        await esperar(() => expect(vista.find('[data-prueba="dte-sin"]').exists()).toBe(true))
        return vista
    }

    it.each([
        ['certificar_opcional', 'opcional', 'queda sin certificar hasta que lo pidas', true],
        ['al_cobrar', 'obligatoria', 'Se certifica al cobrarla', false],
        ['automatica', 'obligatoria', 'Pagada, certificando', false],
        ['ninguna', 'desactivada', 'FEL desactivada: esta factura no se certifica.', false],
    ] as const)('%s (%s): texto y botón', async (accion, modo, texto, boton) => {
        const vista = await montar(accion, modo)
        expect(vista.find('[data-prueba="dte-sin"]').text()).toContain(texto)
        expect(vista.find('[data-prueba="dte-certificar"]').exists()).toBe(boton)
        if (boton) {
            expect(vista.find('[data-prueba="dte-certificar"]').text()).toBe('Certificar (opcional)')
        }
        if (accion === 'al_cobrar') {
            expect(vista.find('[data-prueba="dte-sin-certificar"]').text()).toBe('Aviso de cobro (sin certificar)')
        }
    })

    it('los fixtures calculan fel_accion como la API', () => {
        const factura = bd.facturas.find(f => f.estado !== 'pagada' && f.estado !== 'anulada' && !f.fel_estado)!
        const pendiente = accionFelDe({ ...factura, empresa_id: 1 })
        expect(pendiente.fel_modo).toBe('obligatoria')
        expect(pendiente.fel_accion).toBe(factura.estado === 'por_certificar' ? 'automatica' : 'al_cobrar')
        expect(accionFelDe({ ...factura, empresa_id: 2 }).fel_accion).toBe('ninguna')
    })
})
