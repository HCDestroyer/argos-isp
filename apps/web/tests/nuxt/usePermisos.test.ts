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

    it('una sección sin permiso propio (soloRol) solo la ve ese rol', () => {
        const { puedeSeccion } = usePermisos()
        const importar = obtenerSeccion('importar')
        expect(importar).toMatchObject({ ruta: '/configuracion/importar', permiso: SIN_PERMISO, soloRol: 'admin' })
        useUsuarioActual().value = meAdmin
        expect(puedeSeccion(importar)).toBe(true)
        useUsuarioActual().value = { ...meAdmin, roles: ['contabilidad'] }
        expect(puedeSeccion(importar)).toBe(false)
        expect(puedeSeccion(obtenerSeccion('fel'))).toBe(true)
    })

    it('el menú solo muestra las secciones permitidas', () => {
        useUsuarioActual().value = meCajero
        const { puede } = usePermisos()
        const visibles = SECCIONES_PANEL.filter(seccion => puede(seccion.permiso)).map(seccion => seccion.id)
        // Igual que ROLES_BASE.cajero de apps/api/app/core/permisos.ts (documentos.ver para elegir con qué
        // plantilla imprimir: ve las plantillas en solo lectura), en el orden del menú del rediseño. Decisión 1
        // del PM: Facturación electrónica (`dte`) va en Finanzas › Impuestos, después de Lealtad.
        // «Revisión y garantía» (tablero NuevoInventario) se lee con `inventario.ver`; sus acciones piden cada una la suya.
        // De Ajustes, en el orden del catálogo único: FEL, Plantillas de documentos, Conceptos y adicionales
        // (documentos.ver), Cuentas bancarias y Bancos de origen (cuentas_bancarias.ver), que el cajero puede leer.
        expect(visibles).toEqual(['cobro', 'caja', 'clientes', 'servicios', 'promesas', 'comprobantes', 'facturas', 'pagos', 'notas-credito', 'bonificaciones', 'pasarela', 'planes', 'adicionales', 'existencias', 'traslados', 'mi-bodega', 'unidades', 'por-recuperar', 'revision-garantia', 'conteos', 'productos', 'tipos-producto', 'bodegas', 'kardex', 'tecnicos-iris', 'valorizado', 'lealtad', 'premios-lealtad', 'canjes-lealtad', 'dte', 'cajas-efectivo', 'configuracion', 'fel', 'aviso-cobro', 'plantillas-conceptos', 'cuentas-bancarias', 'bancos-origen'])
    })
})
