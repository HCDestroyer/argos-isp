import { afterEach, describe, expect, it, vi } from 'vitest'
import { meAdmin, meCajero } from '~~/fixtures/auth/sesiones'

/** Menú resumido (decisión del PM): grupos plegables, barra compacta recordada y buscador. */
describe('menú lateral agrupado', () => {
    afterEach(() => {
        useUsuarioActual().value = null
        vi.restoreAllMocks()
        window.localStorage.clear()
    })

    function gruposVisibles(): string[] {
        const { puede } = usePermisos()
        return GRUPOS_PANEL.filter(grupo => grupo.secciones.some(seccion => puede(seccion.permiso))).map(grupo => grupo.id)
    }

    it('nueve grupos con cada sección en uno solo (Bancos desde la fase 4, Compras desde las pantallas de la fase 5)', () => {
        expect(GRUPOS_PANEL.map(grupo => grupo.id)).toEqual(['operacion', 'cobros', 'contabilidad', 'compras', 'inventario', 'bancos', 'red', 'control', 'configuracion'])
        const ids = SECCIONES_PANEL.map(seccion => seccion.id)
        expect(new Set(ids).size).toBe(ids.length)
        expect(ids).toContain('migracion')
    })

    it('sin permiso para ninguna sección del grupo, el grupo no aparece', () => {
        useUsuarioActual().value = meCajero
        expect(gruposVisibles()).toEqual(['operacion', 'cobros', 'contabilidad', 'inventario', 'red', 'configuracion'])
        useUsuarioActual().value = { ...meCajero, permisos: meCajero.permisos.filter(p => !['cajas.ver', 'libro.ver', 'egresos.ver'].includes(p)) }
        expect(gruposVisibles()).not.toContain('contabilidad')
        useUsuarioActual().value = meAdmin
        expect(gruposVisibles()).toHaveLength(9)
    })

    it('el grupo de la página actual: por prefijo, gana la ruta más larga', () => {
        expect(grupoDeRuta('/facturas/12')?.id).toBe('cobros')
        expect(grupoDeRuta('/routers')?.id).toBe('red')
        expect(grupoDeRuta('/routers/migracion')?.id).toBe('operacion')
        expect(grupoDeRuta('/configuracion/empresa')?.id).toBe('configuracion')
        expect(grupoDeRuta('/bancos/extractos/3')?.id).toBe('bancos')
        expect(grupoDeRuta('/cartera')?.id).toBe('contabilidad')
        expect(grupoDeRuta('/')).toBeNull()
        expect(grupoDeRuta('/clientes-viejos')).toBeNull()
    })

    it('la barra compacta se recuerda por usuario', () => {
        guardarMenuCompacto(7, true)
        expect(window.localStorage.getItem(claveMenuCompacto(7))).toBe('1')
        expect(leerMenuCompacto(7)).toBe(true)
        expect(leerMenuCompacto(8)).toBe(false)
        expect(leerMenuCompacto(null)).toBe(false)
    })

    it('sin almacenamiento (lanza) arranca expandida y no rompe', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('bloqueado')
        })
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('bloqueado')
        })
        expect(leerMenuCompacto(7)).toBe(false)
        expect(() => guardarMenuCompacto(7, true)).not.toThrow()
    })
})
