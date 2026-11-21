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
        return GRUPOS_PANEL.filter(grupo => seccionesDeGrupo(grupo).some(seccion => puede(seccion.permiso))).map(grupo => grupo.id)
    }

    it('día a día primero, grupos en orden de uso con su etiqueta corta y cada sección en uno solo', () => {
        expect(GRUPOS_PANEL.map(grupo => grupo.id)).toEqual(['dia', 'facturacion', 'red', 'inventario', 'lealtad', 'finanzas', 'control', 'configuracion'])
        expect([...new Set(GRUPOS_PANEL.map(grupo => grupo.bloque))]).toEqual(['Día a día', 'Gestión', 'Administración', 'Sistema'])
        const ids = SECCIONES_PANEL.map(seccion => seccion.id)
        expect(new Set(ids).size).toBe(ids.length)
        expect(ids).toContain('migracion')
        const dia = GRUPOS_PANEL.find(grupo => grupo.id === 'dia')
        expect(dia?.secciones.map(seccion => seccion.id)).toEqual(['cobro', 'caja', 'clientes', 'servicios', 'promesas', 'comprobantes'])
        expect(GRUPOS_PANEL.map(grupo => grupo.corta)).toEqual(['Día a día', 'Facturas', 'Red', 'Inventario', 'Lealtad', 'Finanzas', 'Reportes', 'Ajustes'])
        // Decisión 1 del PM: Finanzas agrupa panel, libro, cierres, cartera, impuestos, compras y bancos.
        const finanzas = GRUPOS_PANEL.find(grupo => grupo.id === 'finanzas')
        expect(finanzas?.secciones.map(seccion => seccion.id)).toEqual(['panel-financiero', 'libro', 'cierres-libro', 'bloqueos-libro', 'cartera'])
        expect(finanzas?.subgrupos?.map(subgrupo => subgrupo.id)).toEqual(['impuestos', 'compras', 'bancos'])
    })

    it('ningún grupo ni subgrupo pasa de 7 secciones sueltas: los largos van en subgrupos', () => {
        for (const grupo of GRUPOS_PANEL) {
            expect(grupo.secciones.length, grupo.id).toBeLessThanOrEqual(7)
            for (const subgrupo of grupo.subgrupos ?? []) {
                expect(subgrupo.secciones.length, subgrupo.id).toBeLessThanOrEqual(7)
            }
        }
        const configuracion = GRUPOS_PANEL.find(grupo => grupo.id === 'configuracion')
        expect(configuracion?.subgrupos?.map(subgrupo => subgrupo.etiqueta)).toEqual(['Empresa y fiscal', 'Facturación y cobro', 'Red y portal', 'Usuarios y acceso', 'Sistema y apariencia', 'Notificaciones e integraciones'])
        expect(GRUPOS_PANEL.find(grupo => grupo.id === 'inventario')?.subgrupos?.map(subgrupo => subgrupo.id)).toEqual(['inventario-movimientos', 'inventario-catalogos'])
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
        // De Finanzas el cajero solo ve la facturación electrónica (`fel.ver`; su caja va en «Día a día»).
        expect(gruposVisibles()).toEqual(['dia', 'facturacion', 'red', 'inventario', 'lealtad', 'finanzas', 'configuracion'])
        const { puede } = usePermisos()
        const finanzas = GRUPOS_PANEL.find(grupo => grupo.id === 'finanzas')
        expect(seccionesDeGrupo(finanzas!).filter(seccion => puede(seccion.permiso)).map(seccion => seccion.id)).toEqual(['dte'])
        useUsuarioActual().value = { ...meCajero, permisos: meCajero.permisos.filter(p => p !== 'fel.ver') }
        expect(gruposVisibles()).not.toContain('finanzas')
        useUsuarioActual().value = { ...meCajero, permisos: [...meCajero.permisos, 'egresos.ver'] }
        expect(gruposVisibles()).toContain('finanzas')
        useUsuarioActual().value = { ...meCajero, permisos: meCajero.permisos.filter(p => !['cajas.ver', 'pagos.registrar', 'clientes.ver', 'servicios.ver', 'promesas.ver', 'comprobantes.ver'].includes(p)) }
        expect(gruposVisibles()).not.toContain('dia')
        useUsuarioActual().value = meAdmin
        expect(gruposVisibles()).toHaveLength(8)
    })

    it('el grupo de la página actual: por prefijo, gana la ruta más larga', () => {
        expect(grupoDeRuta('/facturas/12')?.id).toBe('facturacion')
        expect(grupoDeRuta('/routers')?.id).toBe('red')
        expect(grupoDeRuta('/routers/migracion')?.id).toBe('red')
        expect(grupoDeRuta('/configuracion/empresa')?.id).toBe('configuracion')
        expect(grupoDeRuta('/configuracion')?.id).toBe('configuracion')
        expect(grupoDeRuta('/bancos/extractos/3')?.id).toBe('finanzas')
        expect(ubicacionDeRuta('/bancos/extractos/3')?.subgrupo?.id).toBe('bancos')
        expect(ubicacionDeRuta('/configuracion/empresa')?.subgrupo?.id).toBe('config-empresa')
        expect(ubicacionDeRuta('/configuracion')?.subgrupo).toBeNull()
        expect(grupoDeRuta('/cartera')?.id).toBe('finanzas')
        expect(ubicacionDeRuta('/libro/cierres')?.seccion.id).toBe('cierres-libro')
        expect(ubicacionDeRuta('/declaraciones/3')?.subgrupo?.id).toBe('impuestos')
        expect(grupoDeRuta('/')).toBeNull()
        expect(grupoDeRuta('/clientes-viejos')).toBeNull()
    })

    it('el menú compacto (rail) es el de fábrica y la elección se recuerda por usuario', () => {
        expect(leerMenuCompacto(8)).toBe(true)
        expect(leerMenuCompacto(null)).toBe(true)
        guardarMenuCompacto(7, false)
        expect(window.localStorage.getItem(claveMenuCompacto(7))).toBe('0')
        expect(leerMenuCompacto(7)).toBe(false)
        guardarMenuCompacto(7, true)
        expect(leerMenuCompacto(7)).toBe(true)
    })

    it('sin almacenamiento (lanza) arranca compacto y no rompe', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('bloqueado')
        })
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('bloqueado')
        })
        expect(leerMenuCompacto(7)).toBe(true)
        expect(() => guardarMenuCompacto(7, true)).not.toThrow()
    })
})
