import { afterEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import { meAdmin, meCajero } from '~~/fixtures/auth/sesiones'

/**
 * Accesos rápidos (`GET/PUT /me/accesos-rapidos`, `contratos/accesos-rapidos.md`): los del rol sin
 * lista guardada, solo los que el usuario puede abrir, guardar en orden y volver a los del rol.
 */
describe('accesos rápidos', () => {
    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
        useState('accesos-rapidos').value = null
        reiniciarFixtures()
    })

    it('sin lista guardada vienen los del rol, filtrados por permisos', async () => {
        sesionFixture('fixture-cajero')
        useUsuarioActual().value = meCajero
        const accesos = useAccesosRapidos()
        await accesos.cargar()
        expect(accesos.datos.value?.predeterminados).toBe(true)
        expect(accesos.ids.value).toEqual(['cobro', 'caja', 'clientes', 'comprobantes'])
    })

    it('guarda el orden elegido y vuelve a los del rol con null', async () => {
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
        const accesos = useAccesosRapidos()
        await accesos.cargar()
        expect(accesos.ids.value).toEqual(['clientes', 'servicios', 'cobro', 'facturas', 'routers', 'configuracion'])
        const guardado = await accesos.guardar(['facturas', 'cobro'])
        expect(guardado.ok).toBe(true)
        expect(accesos.ids.value).toEqual(['facturas', 'cobro'])
        expect(accesos.datos.value?.version).toBe(1)
        expect(accesos.porArea.value[0]?.etiqueta).toBe('Facturación')
        await accesos.guardar(null)
        expect(accesos.datos.value?.predeterminados).toBe(true)
    })
})
