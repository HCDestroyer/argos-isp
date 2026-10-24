import type { Schema } from '@argosisp/contracts'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import meAdmin from '~~/fixtures/auth/me.admin.json'
import meCajero from '~~/fixtures/auth/me.cajero.json'
import { bd } from '~~/fixtures/bd'
import { UApp } from '#components'
import PaginaSinPermiso from '~/pages/sin-permiso.vue'
import { esperar } from '../ayudas/esperar'

/**
 * Revisión de ACL del panel en ejecución (semana 3, tarea 3; checklist en
 * `docs/seguridad/acl-panel.md`). La API responde con el token de admin de los fixtures; lo que
 * se prueba es lo que el panel muestra según los permisos de `GET /me`.
 */

type Me = Schema<'Me'>

/** Rol `lectura` de `ROLES_BASE`: todos los `*.ver` más `clientes.estado_cuenta`. */
const LECTURA: Me = { ...meAdmin, id: 90, nombre: 'Solo lectura', roles: ['lectura'], permisos: [...meAdmin.permisos.filter(p => p.endsWith('.ver')), 'clientes.estado_cuenta'] }
const SIN_PERMISOS: Me = { ...meAdmin, id: 91, nombre: 'Sin permisos', roles: [], permisos: [] }

/** Botones que cambian algo: ninguno debe verse con `lectura`. */
const ACCION = /^(Nuevo|Nueva|Editar|Anular|Suspender|Reactivar|Limitar|Quitar límite|Retirar|Desconectar|Aprobar|Rechazar|Registrar|Abrir turno|Cerrar turno|Cobrar|Agregar|Asignar|Cambiar a|Guardar|Crear|Generar|Cerrar|Reabrir|Promesa de pago|Mostrar|Logo|Desactivar|Enviar prueba|Reemplazar|Escribir|Borrar|Cambiar empresa|Depositar|Trasladar|Importar|Conciliar|Aplicar reglas|Provisionar|Castigar|Deshacer|Activar|Ajustar|Ejecutar|Entregar|Marcar|Publicar|Abrir participación|Cancelar sorteo|Archivar|Cambiar imagen)/

/** Botones y enlaces de la página montada y de lo que teletransporta a `body` (modales, menús). */
function botones(raiz?: Element): string[] {
    return [...(raiz?.querySelectorAll('button, a') ?? []), ...document.body.querySelectorAll('button, a')]
        .map(elemento => (elemento.textContent ?? '').trim())
        .filter(Boolean)
}

/** Monta la página dentro de `UApp` (tooltips, toasts) en la ruta dada. */
async function montar(ruta: string) {
    const ruteada = useRouter().resolve(ruta)
    const registrado = ruteada.matched.at(-1)?.components?.default
    expect(registrado, ruta).toBeDefined()
    // Las páginas se registran con carga diferida: `() => import('…')`.
    const componente = typeof registrado === 'function' && !('setup' in registrado) && !('render' in registrado)
        ? ((await (registrado as () => Promise<{ default: Component }>)()).default)
        : registrado
    const conApp = defineComponent({ render: () => h(UApp, null, { default: () => h(componente as Component) }) })
    return mountSuspended(conApp, { route: ruta })
}

describe('semana 3 · ACL por pantalla (en ejecución)', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
        // Sin vaciar el body: tests/setup.ts desmonta todo después (vaciarlo antes rompía el desmontaje).
    })

    it('cada ruta con permiso manda a /sin-permiso a quien no lo tiene, con el permiso exacto', async () => {
        useUsuarioActual().value = SIN_PERMISOS
        const router = useRouter()
        const conPermiso = router.getRoutes().filter(ruta => typeof ruta.meta.permiso === 'string')
        expect(conPermiso.length).toBeGreaterThan(25)
        for (const ruta of conPermiso) {
            const destino = ruta.path.replace(/:\w+\(?[^/]*\)?/g, '1')
            await router.push(destino)
            expect(router.currentRoute.value.path, destino).toBe('/sin-permiso')
            expect(router.currentRoute.value.query.permiso, destino).toBe(ruta.meta.permiso)
        }
    })

    it('la página de 403 es amable y no muestra datos: solo el aviso, el permiso y "Volver al inicio"', async () => {
        const wrapper = await mountSuspended(PaginaSinPermiso, { route: '/sin-permiso?permiso=routers.ver&ruta=/routers' })
        const texto = wrapper.text()
        expect(texto).toContain('No tienes acceso a esta sección')
        expect(texto).toContain('Permiso requerido: routers.ver')
        expect(texto).toContain('Volver al inicio')
        expect(wrapper.findAll('table')).toHaveLength(0)
        expect(texto).not.toMatch(/Q \d/)
    })

    it('el menú muestra cada sección solo con su permiso (cajero sin Routers, Bitácora ni Libro)', () => {
        useUsuarioActual().value = meCajero
        const { puede } = usePermisos()
        const visibles = SECCIONES_PANEL.filter(seccion => puede(seccion.permiso)).map(seccion => seccion.id)
        expect(visibles).toContain('cobro')
        expect(visibles).not.toContain('routers')
        expect(visibles).not.toContain('bitacora')
        expect(visibles).not.toContain('libro')
        expect(visibles).not.toContain('usuarios')
    })

    it('enlaces entre secciones: sin el permiso de la página destino no hay enlace', () => {
        useUsuarioActual().value = { ...meCajero, permisos: meCajero.permisos.filter(p => p !== 'clientes.ver') }
        const { enlace, puedeAbrir, destinoPermitido } = usePermisos()
        expect(enlace('/clientes/1?tab=cuenta')).toBeUndefined()
        expect(puedeAbrir('/facturas/3')).toBe(true)
        expect(enlace('/facturas/3')).toBe('/facturas/3')
        expect(destinoPermitido('/clientes/1')).toBe('/')
        expect(puedeAbrir('/routers')).toBe(false)
        expect(puedeAbrir('/')).toBe(true)
    })

    const PANTALLAS: { ruta: string, espera: string }[] = [
        { ruta: '/clientes', espera: 'Clientes' },
        { ruta: '/clientes/1', espera: 'Datos' },
        { ruta: '/servicios', espera: 'Servicios' },
        { ruta: '/routers', espera: 'Routers' },
        { ruta: '/planes', espera: 'Planes' },
        { ruta: '/plantillas', espera: 'Plantillas' },
        { ruta: '/facturas', espera: 'Facturas' },
        { ruta: '/pagos', espera: 'Pagos' },
        { ruta: '/pagos/1', espera: 'Pago' },
        { ruta: '/comprobantes', espera: 'Comprobantes' },
        { ruta: '/caja', espera: 'Caja' },
        { ruta: '/promesas', espera: 'Promesas' },
        { ruta: '/egresos', espera: 'Egresos' },
        { ruta: '/libro', espera: 'Libro' },
        { ruta: '/libro/bloqueos', espera: 'Cierre de agosto' },
        { ruta: '/usuarios', espera: 'Usuarios' },
        // Tarea 9: roles y permisos, tokens de API.
        { ruta: '/usuarios/roles', espera: 'cobrador_zona' },
        { ruta: '/usuarios/tokens', espera: 'Agente de cobranza' },
        // Pendientes de la prioridad 2.
        { ruta: '/notificaciones', espera: 'Factura emitida' },
        { ruta: '/cobros/pasarela', espera: 'El monto no coincide' },
        { ruta: '/lealtad/premios', espera: 'Un mes gratis de internet' },
        { ruta: '/lealtad/canjes', espera: 'Sin canjes' },
        { ruta: '/planes/1', espera: 'profile argos-hogar' },
        { ruta: '/routers/1', espera: '100.64.10.0/24' },
        { ruta: '/configuracion/cuentas-bancarias', espera: 'Cuentas bancarias' },
        { ruta: '/configuracion/empresa', espera: 'Contacto y pagos' },
        { ruta: '/configuracion/empresas', espera: 'Empresas' },
        { ruta: '/configuracion/notificaciones', espera: 'Correo (SMTP)' },
        // Fase 4 (cobros y bancos).
        { ruta: '/configuracion/proveedores-cobro', espera: 'Pasarela en línea' },
        { ruta: '/cobros/por-liquidar', espera: 'Saldo del puente' },
        { ruta: '/cobros/liquidaciones/1', espera: 'LIQ-2026-10-10' },
        { ruta: '/bancos/transito', espera: 'B-4471' },
        { ruta: '/bancos/extractos', espera: 'Banco Industrial' },
        { ruta: '/bancos/extractos/1', espera: 'COMISION MANEJO DE CUENTA' },
        { ruta: '/bancos/reglas', espera: 'Comisiones del banco' },
        { ruta: '/bancos/conciliacion', espera: 'Saldo del extracto' },
        { ruta: '/cartera', espera: 'Estimación de incobrables' },
        { ruta: '/pagos/7001', espera: 'Pasarela en línea' },
        // Lealtad, fase 1.
        { ruta: '/lealtad', espera: 'Puntos Argos' },
        { ruta: '/lealtad/referidos', espera: 'Rosa Elena Cifuentes' },
        // Sorteos (A3, lealtad §15.3): borrador, corte cerrado y ejecutado.
        { ruta: '/lealtad/sorteos', espera: 'Día del cliente' },
        { ruta: '/lealtad/sorteos/1', espera: 'Gran sorteo de Navidad 2026' },
        { ruta: '/lealtad/sorteos/4', espera: 'Timbre fiscal' },
        { ruta: '/lealtad/sorteos/5', espera: 'Verificación pública' },
        { ruta: '/clientes/2?tab=puntos', espera: 'Compensación por falla' },
        { ruta: '/reportes/lealtad', espera: 'Cuadra con el libro' },
        // Anuncios del portal (A5).
        { ruta: '/anuncios', espera: 'Duplica tu velocidad en noviembre' },
        { ruta: '/anuncios/2', espera: 'Tus puntos valen más este mes' },
        // Servicios adicionales y tipo de plan (A1).
        { ruta: '/adicionales', espera: 'Cuenta de streaming' },
        { ruta: '/adicionales/motivos', espera: 'Compensación por falla' },
        { ruta: '/planes/3', espera: 'Usuario de IPTV' },
        { ruta: '/servicios/1', espera: 'iptv-0002' },
        // Bonificaciones (A3, decisión del PM).
        { ruta: '/bonificaciones', espera: 'Cortesía comercial' },
        { ruta: '/bonificaciones/3', espera: 'Promoción de instalación' },
        { ruta: '/reportes/bonificaciones', espera: 'Programa de lealtad' },
    ]

    for (const { ruta, espera } of PANTALLAS) {
        it(`${ruta}: con el rol lectura no hay botones de acción`, async () => {
            useUsuarioActual().value = LECTURA
            const wrapper = await montar(ruta)
            await esperar(() => expect(wrapper.text()).toContain(espera))
            await new Promise(listo => setTimeout(listo, 50))
            const acciones = botones(wrapper.element).filter(texto => ACCION.test(texto))
            expect(acciones, ruta).toEqual([])
            wrapper.unmount()
        })
    }

    // Control: con admin las mismas pantallas sí muestran sus acciones (la prueba de arriba no pasa en vacío).
    // /routers no tiene acciones en la lista (Velocidad abre el panel, cuyas acciones van aparte).
    for (const ruta of ['/lealtad/sorteos', '/lealtad/sorteos/1', '/lealtad/sorteos/4', '/lealtad/sorteos/5', '/lealtad', '/lealtad/referidos', '/clientes/2?tab=puntos', '/configuracion/proveedores-cobro', '/cobros/por-liquidar', '/bancos/transito', '/bancos/extractos', '/bancos/extractos/1', '/bancos/reglas', '/cartera', '/clientes', '/planes', '/caja', '/egresos', '/configuracion/cuentas-bancarias', '/configuracion/empresas', '/configuracion/notificaciones', '/usuarios', '/usuarios/roles', '/usuarios/tokens', '/plantillas', '/cobros/pasarela', '/lealtad/premios', '/routers/1', '/configuracion/nodos-portal', `/pagos/${bd.pagos.find(pago => pago.estado !== 'anulado')?.id}`, '/adicionales', '/adicionales/motivos', '/planes/3', '/servicios/1', '/anuncios', '/anuncios/2']) {
        it(`${ruta}: con admin sí hay botones de acción`, async () => {
            const wrapper = await montar(ruta)
            await esperar(() => expect(botones(wrapper.element).filter(texto => ACCION.test(texto)).length, ruta).toBeGreaterThan(0))
            wrapper.unmount()
        })
    }

    it('ficha de servicio y factura: con lectura no hay acciones; con admin sí', async () => {
        const suspendido = bd.servicios.find(servicio => servicio.estado === 'suspendido')
        const pendiente = bd.facturas.find(factura => factura.estado === 'emitida' || factura.estado === 'vencida')
        expect(suspendido && pendiente).toBeTruthy()
        for (const ruta of [`/servicios/${suspendido?.id}`, `/facturas/${pendiente?.id}`]) {
            useUsuarioActual().value = LECTURA
            const lectura = await montar(ruta)
            await esperar(() => expect(lectura.text()).toMatch(/Historial|Líneas|Aviso/))
            await new Promise(listo => setTimeout(listo, 50))
            expect(botones(lectura.element).filter(texto => ACCION.test(texto)), ruta).toEqual([])
            lectura.unmount()
            document.body.innerHTML = ''

            useUsuarioActual().value = meAdmin
            const admin = await montar(ruta)
            await esperar(() => expect(botones(admin.element).filter(texto => ACCION.test(texto)).length, ruta).toBeGreaterThan(0))
            admin.unmount()
            document.body.innerHTML = ''
        }
    })

    it('ficha de servicio con cajero: promesa sí (promesas.crear); suspender, editar y credenciales no', async () => {
        useUsuarioActual().value = meCajero
        const activo = bd.servicios.find(servicio => servicio.estado === 'activo')
        const wrapper = await montar(`/servicios/${activo?.id}`)
        await esperar(() => expect(botones(wrapper.element)).toContain('Promesa de pago'))
        const textos = botones(wrapper.element)
        for (const accion of ['Suspender', 'Limitar', 'Retirar', 'Desconectar', 'Editar', 'Mostrar']) {
            expect(textos.some(texto => texto.startsWith(accion)), accion).toBe(false)
        }
        wrapper.unmount()
    })

    it('cerrar sesión revoca el token en la API (POST /auth/logout), no solo borra la cookie', async () => {
        await useAuth().logout()
        expect(bd.sesionesCerradas).toEqual(['fixture-admin'])
        expect(bd.sesion.token).toBeNull()
        expect(useUsuarioActual().value).toBeNull()
    })
})
