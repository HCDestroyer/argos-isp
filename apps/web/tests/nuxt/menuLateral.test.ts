import { afterEach, describe, expect, it, vi } from 'vitest'
import { meAdmin, meCajero } from '~~/fixtures/auth/sesiones'

/** Menú resumido: grupos plegables, barra compacta recordada y buscador. */
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

    it('accesos directos sueltos y nueve grupos, con cada sección en uno solo', () => {
        expect(GRUPOS_PANEL.map(grupo => grupo.id)).toEqual(['directo', 'operacion', 'cobros', 'contabilidad', 'compras', 'inventario', 'bancos', 'red', 'control', 'configuracion'])
        const ids = SECCIONES_PANEL.map(seccion => seccion.id)
        expect(new Set(ids).size).toBe(ids.length)
        expect(ids).toContain('migracion')
        const directo = GRUPOS_PANEL.find(grupo => grupo.id === 'directo')
        expect(directo?.plano).toBe(true)
        expect(directo?.secciones.map(seccion => seccion.id)).toEqual(['cobro', 'caja'])
        expect(GRUPOS_PANEL.filter(grupo => grupo.plano)).toHaveLength(1)
    })

    it('el cajero entra a su caja; los demás, al tablero', () => {
        expect(rutaInicio(meCajero)).toBe('/caja')
        expect(rutaInicio(meAdmin)).toBe('/')
        expect(rutaInicio({ ...meCajero, roles: ['cajero', 'admin'] })).toBe('/')
        expect(rutaInicio({ ...meCajero, permisos: meCajero.permisos.filter(p => p !== 'cajas.ver') })).toBe('/')
        expect(rutaInicio(null)).toBe('/')
    })

    it('sin permiso para ninguna sección del grupo, el grupo no aparece', () => {
        useUsuarioActual().value = meCajero
        // La caja del cajero es un acceso directo: Contabilidad no tiene nada más para él.
        expect(gruposVisibles()).toEqual(['directo', 'operacion', 'cobros', 'inventario', 'red', 'configuracion'])
        useUsuarioActual().value = { ...meCajero, permisos: [...meCajero.permisos, 'egresos.ver'] }
        expect(gruposVisibles()).toContain('contabilidad')
        useUsuarioActual().value = { ...meCajero, permisos: meCajero.permisos.filter(p => !['cajas.ver', 'pagos.registrar'].includes(p)) }
        expect(gruposVisibles()).not.toContain('directo')
        useUsuarioActual().value = meAdmin
        expect(gruposVisibles()).toHaveLength(10)
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
