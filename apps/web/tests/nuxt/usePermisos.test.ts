import { afterEach, describe, expect, it } from 'vitest'
import { meAdmin, meCajero } from '~~/fixtures/auth/sesiones'

describe('usePermisos', () => {
    afterEach(() => {
        useUsuarioActual().value = null
    })

    it('sin sesión no puede nada', () => {
        const { puede, puedeAlguno } = usePermisos()
        expect(puede('clientes.ver')).toBe(false)
        expect(puedeAlguno(['clientes.ver', 'routers.ver'])).toBe(false)
    })

    it('cajero cobra pero no ve routers', () => {
        useUsuarioActual().value = meCajero
        const { puede, puedeAlguno, puedeTodos } = usePermisos()
        expect(puede('pagos.registrar')).toBe(true)
        expect(puede('routers.ver')).toBe(false)
        expect(puede('servicios.suspender')).toBe(false)
        expect(puedeAlguno(['routers.ver', 'cajas.ver'])).toBe(true)
        expect(puedeTodos(['cajas.abrir', 'cajas.cerrar'])).toBe(true)
        expect(puedeTodos(['cajas.abrir', 'usuarios.ver'])).toBe(false)
    })

    it('reacciona al cambiar de usuario', () => {
        const { puede } = usePermisos()
        useUsuarioActual().value = meCajero
        expect(puede('servicios.suspender')).toBe(false)
        useUsuarioActual().value = meAdmin
        expect(puede('servicios.suspender')).toBe(true)
    })

    it('el menú solo muestra las secciones permitidas', () => {
        useUsuarioActual().value = meCajero
        const { puede } = usePermisos()
        const visibles = SECCIONES_PANEL.filter(seccion => puede(seccion.permiso)).map(seccion => seccion.id)
        // Igual que ROLES_BASE.cajero de apps/api/app/core/permisos.ts (incluye facturas.ver para bonificaciones, planes.ver, fel.ver, lealtad.ver, adicionales.ver e inventario.ver).
        // En el orden del menú (rediseño): día a día, facturación, red, inventario, lealtad y configuración.
        expect(visibles).toEqual(['cobro', 'caja', 'clientes', 'servicios', 'promesas', 'comprobantes', 'facturas', 'pagos', 'notas-credito', 'bonificaciones', 'dte', 'pasarela', 'planes', 'adicionales', 'existencias', 'traslados', 'mi-bodega', 'unidades', 'por-recuperar', 'conteos', 'productos', 'tipos-producto', 'bodegas', 'kardex', 'valorizado', 'lealtad', 'premios-lealtad', 'canjes-lealtad', 'configuracion-indice', 'fel', 'cuentas-bancarias'])
    })
})
