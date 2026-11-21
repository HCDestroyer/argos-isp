import { afterEach, describe, expect, it, vi } from 'vitest'
import { meAdmin, meCajero } from '~~/fixtures/auth/sesiones'

/** Accesos rápidos: de fábrica según permisos, hasta 12, recordados por usuario y sin romper sin almacenamiento. */
describe('accesos rápidos', () => {
    afterEach(() => {
        useUsuarioActual().value = null
        useState<string[] | null>('accesos-rapidos').value = null
        vi.restoreAllMocks()
        window.localStorage.clear()
    })

    it('de fábrica: los del rol (como la API) y solo lo que el usuario puede abrir', () => {
        expect(accesosPredeterminados(['cajero'])).toEqual(['cobro', 'caja', 'clientes', 'comprobantes'])
        expect(accesosPredeterminados(['soporte', 'cajero'])).toEqual(['cobro', 'caja', 'clientes', 'comprobantes', 'servicios', 'promesas', 'routers'])
        expect(accesosPredeterminados([])).toEqual(['clientes', 'servicios', 'facturas'])
        useUsuarioActual().value = meCajero
        const { ids } = useAccesosRapidos()
        expect(ids.value).toEqual(['cobro', 'caja', 'clientes', 'comprobantes'])
        useUsuarioActual().value = meAdmin
        expect(ids.value).toEqual(['clientes', 'servicios', 'cobro', 'facturas', 'routers', 'configuracion'])
    })

    it('guarda el orden elegido por usuario, sin repetidos y con tope de 12', () => {
        useUsuarioActual().value = meAdmin
        const accesos = useAccesosRapidos()
        const muchos = SECCIONES_PANEL.slice(0, 20).map(seccion => seccion.id)
        accesos.guardar(['facturas', 'cobro', 'facturas', ...muchos])
        expect(accesos.ids.value).toHaveLength(MAX_ACCESOS_RAPIDOS)
        expect(accesos.ids.value.slice(0, 2)).toEqual(['facturas', 'cobro'])
        expect(leerAccesosRapidos(meAdmin.id)?.slice(0, 2)).toEqual(['facturas', 'cobro'])
        expect(accesos.porArea.value[0]?.etiqueta).toBe('Facturación')
        expect(accesos.disponibles.value.some(seccion => seccion.id === 'cobro')).toBe(false)
    })

    it('sin almacenamiento (lanza) usa los de fábrica y no rompe', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('bloqueado')
        })
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('bloqueado')
        })
        expect(leerAccesosRapidos(7)).toBeNull()
        expect(() => guardarAccesosRapidos(7, ['cobro'])).not.toThrow()
    })
})
