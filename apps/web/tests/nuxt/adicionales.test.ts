import type { Schema } from '@argosisp/contracts'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reiniciarFixtures, sesionFixture, simularFalla } from '~~/fixtures'
import meAdmin from '~~/fixtures/auth/me.admin.json'
import { bd } from '~~/fixtures/bd'
import * as comun from '~~/fixtures/comun'
import { UApp } from '#components'
import AdicionalCredencialModal from '~/components/AdicionalCredencialModal.vue'
import AdicionalServicioModal from '~/components/AdicionalServicioModal.vue'
import PlanFormulario from '~/components/PlanFormulario.vue'
import ServicioAdicionales from '~/components/ServicioAdicionales.vue'
import PaginaAdicionales from '~/pages/adicionales/index.vue'
import PaginaMotivos from '~/pages/adicionales/motivos.vue'
import PaginaPlan from '~/pages/planes/[id].vue'
import PaginaPlanes from '~/pages/planes/index.vue'

type Me = Schema<'Me'>

/** Soporte (`contratos/adicionales.md`): agrega, edita, quita y ve credenciales, pero no regala. */
const SOPORTE: Me = { ...meAdmin, id: 93, nombre: 'Soporte', roles: ['soporte'], permisos: meAdmin.permisos.filter(p => p !== 'servicios.adicional_cortesia') }
/** Sin `servicios.ver_credencial_adicional`: no hay botón "Ver credencial". */
const SIN_CREDENCIAL: Me = { ...meAdmin, id: 94, permisos: meAdmin.permisos.filter(p => p !== 'servicios.ver_credencial_adicional') }

function enApp(componente: Component, props: Record<string, unknown> = {}) {
    return defineComponent({ render: () => h(UApp, null, { default: () => h(componente, props) }) })
}

/** Corre `cuerpo` con el token de los fixtures limitado a `usuario` (la API decide con el token). */
async function comoToken(usuario: Me, cuerpo: () => Promise<void>) {
    const original = comun.usuariosPorToken['fixture-admin']
    comun.usuariosPorToken['fixture-admin'] = usuario
    try {
        await cuerpo()
    }
    finally {
        if (original) {
            comun.usuariosPorToken['fixture-admin'] = original
        }
    }
}

describe('servicios adicionales y tipo de plan (A1)', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
    })

    describe('esquemas', () => {
        it('cobrado pide precio > 0, cortesía pide motivo; el código va en mayúsculas', () => {
            const base = entradaAsignacion(null)
            expect(esquemaAsignacion.safeParse({ ...base, adicional_id: 1, precio: '' }).success).toBe(false)
            expect(esquemaAsignacion.safeParse({ ...base, adicional_id: 1, precio: '0' }).error?.issues[0]?.message).toBe('El precio debe ser mayor que cero')
            expect(esquemaAsignacion.safeParse({ ...base, adicional_id: 1, modalidad: 'cortesia' }).error?.issues[0]?.message).toBe('Elige el motivo de la cortesía')
            const cobrado = esquemaAsignacion.parse({ ...base, adicional_id: 2, precio: '35', motivo_id: 4 })
            expect(cuerpoAsignacion(cobrado, '')).toEqual({ adicional_id: 2, modalidad: 'cobrado', identificador: null, credencial: null, precio: '35.00', motivo_id: null, motivo_detalle: null })
            expect(esquemaAdicional.parse({ codigo: ' iptv-hd ', nombre: 'IPTV HD', descripcion: '', precio_sugerido: '' }).codigo).toBe('IPTV-HD')
            expect(esquemaAdicional.safeParse({ codigo: 'con espacio', nombre: 'X1', descripcion: '', precio_sugerido: '' }).success).toBe(false)
            expect(esquemaAdicionalesPlan.safeParse({ adicionales: [{ adicional_id: 1, cantidad: 1 }, { adicional_id: 1, cantidad: 2 }] }).error?.issues[0]?.message).toBe('Ya está en la lista: sube la cantidad')
        })

        it('editar manda solo lo que cambió: el identificador de una cortesía no pide el permiso de cortesía', () => {
            const cortesia = bd.adicionalesServicio.find(a => a.id === 3)
            expect(cortesia?.modalidad).toBe('cortesia')
            if (!cortesia) {
                return
            }
            const datos = esquemaAsignacion.parse({ ...entradaAsignacion(cortesia), identificador: 'iptv-0099' })
            expect(cambiosAsignacion(cortesia, datos, { accion: 'conservar', valor: '' })).toEqual({ version: cortesia.version, identificador: 'iptv-0099' })
            const aCobrado = esquemaAsignacion.parse({ ...entradaAsignacion(cortesia), modalidad: 'cobrado', precio: '30' })
            expect(cambiosAsignacion(cortesia, aCobrado, { accion: 'borrar', valor: '' })).toEqual({ version: cortesia.version, modalidad: 'cobrado', precio: '30.00', credencial: null })
        })

        it('tipo de plan: etiqueta propia y uno desconocido por su nombre', () => {
            expect(tipoPlanVisual('dedicado')?.etiqueta).toBe('Dedicado')
            expect(tipoPlanVisual('residencial')?.etiqueta).toBe('Residencial')
            expect(tipoPlanVisual(undefined)).toBeNull()
            expect(tipoPlanVisual('mayorista')?.etiqueta).toBe('Mayorista')
        })
    })

    describe('composables contra los fixtures (mismos errores que la API)', () => {
        it('catálogo: crear, 409 por código repetido, editar con version y desactivar', async () => {
            const api = useAdicionales()
            const creado = await api.crear({ codigo: 'NUBE', nombre: 'Almacenamiento en la nube', precio_sugerido: '25.00' }, nuevaClaveIdempotencia())
            expect(creado.ok && creado.data).toMatchObject({ codigo: 'NUBE', empresa_id: 1, activo: true, version: 1 })
            const repetido = await api.crear({ codigo: 'STREAM', nombre: 'Otra' }, nuevaClaveIdempotencia())
            expect(!repetido.ok && repetido.problema.type).toBe('urn:argosisp:problema:adicional_duplicado')
            if (!creado.ok) {
                return
            }
            const viejo = await api.editar(creado.data.id, { version: 9, nombre: 'Nube' })
            expect(!viejo.ok && viejo.problema.status).toBe(409)
            const editado = await api.editar(creado.data.id, { version: 1, nombre: 'Nube familiar' })
            expect(editado.ok && editado.data).toMatchObject({ nombre: 'Nube familiar', version: 2 })
            const desactivado = await api.desactivar(creado.data.id, 2)
            expect(desactivado.ok && desactivado.data.activo).toBe(false)
            // Con alcance global y sin `X-Empresa-Id`, los de todas las empresas (como la API).
            const activos = await api.activos()
            expect(activos.ok && activos.data.map(a => [a.codigo, a.empresa_id])).toEqual([['IPTV', 2], ['IPTV', 1], ['STREAM', 1]])
        })

        it('motivos: comunes más los de la empresa; uno común solo se desactiva con alcance global', async () => {
            const api = useAdicionales()
            const motivos = await api.motivos({ activo: true })
            expect(motivos.ok && motivos.data.map(m => m.codigo)).toEqual(['COMPENSACION_FALLA', 'CONVENIO', 'CORTESIA', 'EMPLEADO', 'GARANTIA', 'PROMOCION'])
            const repetido = await api.crearMotivo({ codigo: 'garantia', nombre: 'Garantía otra vez' }, nuevaClaveIdempotencia())
            expect(!repetido.ok && repetido.problema.type).toBe('urn:argosisp:problema:motivo_duplicado')
            await comoToken({ ...meAdmin, alcance_global: false }, async () => {
                const comun = await api.desactivarMotivo(1, 1)
                expect(!comun.ok && comun.problema.status).toBe(403)
                const propio = await api.desactivarMotivo(6, 1)
                expect(propio.ok && propio.data.activo).toBe(false)
            })
        })

        it('asignaciones: cortesía sin permiso 403, cobrado sin precio 422, de otra empresa 422 y la credencial auditada', async () => {
            const api = useAdicionalesServicio()
            await comoToken(SOPORTE, async () => {
                const sinPermiso = await api.agregar(1, { adicional_id: 2, modalidad: 'cortesia', motivo_id: 1 }, nuevaClaveIdempotencia())
                expect(!sinPermiso.ok && sinPermiso.problema.status).toBe(403)
            })
            const sinPrecio = await api.agregar(1, { adicional_id: 2, modalidad: 'cobrado' }, nuevaClaveIdempotencia())
            expect(!sinPrecio.ok && sinPrecio.problema.errors?.[0]?.field).toBe('precio')
            const ajeno = await api.agregar(1, { adicional_id: 4, modalidad: 'cobrado', precio: '10.00' }, nuevaClaveIdempotencia())
            expect(!ajeno.ok && ajeno.problema.type).toBe('urn:argosisp:problema:adicional_de_otra_empresa')
            const inactivo = await api.agregar(1, { adicional_id: 3, modalidad: 'incluido' }, nuevaClaveIdempotencia())
            expect(!inactivo.ok && inactivo.problema.type).toBe('urn:argosisp:problema:adicional_inactivo')

            const nuevo = await api.agregar(1, { adicional_id: 2, modalidad: 'cortesia', motivo_id: 6, identificador: 'iptv-0003', credencial: '1234' }, nuevaClaveIdempotencia())
            expect(nuevo.ok && nuevo.data).toMatchObject({ modalidad: 'cortesia', motivo_nombre: 'Empleado de la empresa', tiene_credencial: true })
            expect(JSON.stringify(nuevo.ok && nuevo.data)).not.toContain('1234')
            if (!nuevo.ok) {
                return
            }
            const credencial = await api.credencial(1, nuevo.data.id)
            expect(credencial.ok && credencial.data.credencial).toBe('1234')
            expect(bd.acciones.at(-1)).toMatchObject({ accion: 'servicios.ver_credencial_adicional' })
            const sinCredencial = await api.credencial(1, 3)
            expect(!sinCredencial.ok && sinCredencial.problema.type).toBe('urn:argosisp:problema:sin_credencial')

            const quitado = await api.quitar(1, nuevo.data.id, nuevo.data.version, null, nuevaClaveIdempotencia())
            expect(quitado.ok && quitado.data).toMatchObject({ estado: 'baja', motivo_baja: null })
            const otraVez = await api.quitar(1, nuevo.data.id, nuevo.data.version + 1, null, nuevaClaveIdempotencia())
            expect(!otraVez.ok && otraVez.problema.type).toBe('urn:argosisp:problema:adicional_dado_de_baja')
        })

        it('plan: la lista sube la version, repetidos 422; el alta trae los incluidos y el cambio de plan los reconcilia', async () => {
            const plan = bd.planes.find(p => p.id === 2)
            const repetidos = await usePlanes().definirAdicionales(2, plan?.version ?? 0, [{ adicional_id: 1, cantidad: 1 }, { adicional_id: 1, cantidad: 2 }])
            expect(!repetidos.ok && repetidos.problema.errors?.[0]?.field).toBe('adicionales.1.adicional_id')
            const lista = await usePlanes().definirAdicionales(2, plan?.version ?? 0, [{ adicional_id: 1, cantidad: 1 }])
            expect(lista.ok && lista.data).toEqual([{ plan_id: 2, adicional_id: 1, empresa_id: 1, adicional_codigo: 'STREAM', adicional_nombre: 'Cuenta de streaming', adicional_activo: true, cantidad: 1 }])
            expect(bd.planes.find(p => p.id === 2)?.version).toBe((plan?.version ?? 0) + 1)

            const cf = bd.clientes.find(c => c.tipo_documento_fiscal === 'cf' && c.zona_id === 1)
            const creado = await useServicios().crear({ cliente_id: cf?.id ?? 0, router_id: 1, plan_id: 3, ipv6_modo: 'ninguno', plantilla_facturacion_id: 1 }, nuevaClaveIdempotencia())
            expect(creado.ok && creado.data.plan_tipo).toBe('empresarial')
            expect(creado.ok && creado.data.warnings?.map(w => w.codigo)).toEqual(['servicio_cliente_cf'])
            if (!creado.ok) {
                return
            }
            const incluidos = await useAdicionalesServicio().listar(creado.data.id, 'activo')
            expect(incluidos.ok && incluidos.data.data.map(a => [a.adicional_codigo, a.modalidad, a.plan_id])).toEqual([['IPTV', 'incluido', 3], ['IPTV', 'incluido', 3], ['STREAM', 'incluido', 3]])

            const cambiado = await useServicios().editar(creado.data.id, { version: creado.data.version, plan_id: 2 })
            expect(cambiado.ok && cambiado.data.warnings).toEqual([])
            const despues = await useAdicionalesServicio().listar(creado.data.id)
            expect(despues.ok && despues.data.data.map(a => [a.adicional_codigo, a.estado, a.motivo_baja])).toEqual([['IPTV', 'baja', 'cambio_plan'], ['IPTV', 'baja', 'cambio_plan'], ['STREAM', 'activo', null]])
        })

        it('planes: filtro ?tipo= y advertencias de un dedicado asimétrico y compartido', async () => {
            const empresariales = await usePlanes().listar({ tipo: 'empresarial' })
            expect(empresariales.ok && empresariales.data.data.map(p => p.nombre)).toEqual(['Pyme 50 Mbps'])
            const dedicado = await usePlanes().crear(cuerpoPlan(esquemaPlan.parse({ ...entradaPlanVacia(), nombre: 'Dedicado 20', precio: '900', tipo: 'dedicado', reuso: 2, garantia_automatica: true })))
            expect(dedicado.ok && dedicado.data.warnings?.map(w => w.codigo)).toEqual(['plan_dedicado_asimetrico', 'plan_dedicado_compartido'])
            const servicios = await useServicios().listar({ tipo: 'empresarial' })
            expect(servicios.ok && servicios.data.data.length).toBeGreaterThan(0)
            expect(servicios.ok && servicios.data.data.every(s => s.plan_tipo === 'empresarial')).toBe(true)
        })
    })

    describe('pantallas', () => {
        it('ficha del servicio: modalidades, precio, motivo, "Ver credencial" solo con credencial y bajas a pedido', async () => {
            const servicio = bd.servicios.find(s => s.id === 1)
            const vista = await mountSuspended(enApp(ServicioAdicionales, { servicio }))
            await vi.waitFor(() => expect(vista.findAll('[data-modalidad]').length).toBe(3))
            expect(vista.findAll('[data-modalidad]').map(b => b.text())).toEqual(['Cortesía', 'Cobrado', 'Incluido'])
            expect(vista.text()).toContain('Q 35.00 al mes')
            expect(vista.text()).toContain('Compensación por falla · Tres días sin servicio en septiembre')
            expect(vista.find('[data-prueba="ver-credencial-1"]').exists()).toBe(true)
            expect(vista.find('[data-prueba="ver-credencial-2"]').exists()).toBe(true)
            expect(vista.find('[data-prueba="ver-credencial-3"]').exists()).toBe(false)
            await vista.find('[role="switch"]').trigger('click')
            await vi.waitFor(() => expect(vista.text()).toContain('El cliente ya no lo usa'))
            vista.unmount()

            useUsuarioActual().value = SIN_CREDENCIAL
            const sinPermiso = await mountSuspended(enApp(ServicioAdicionales, { servicio }))
            await vi.waitFor(() => expect(sinPermiso.findAll('[data-modalidad]').length).toBe(3))
            expect(sinPermiso.find('[data-prueba^="ver-credencial"]').exists()).toBe(false)
            sinPermiso.unmount()
        })

        it('si la lista falla: el error con Reintentar y ninguna fila', async () => {
            simularFalla('GET /api/v1/servicios/:id/adicionales', 500)
            const vista = await mountSuspended(enApp(ServicioAdicionales, { servicio: bd.servicios.find(s => s.id === 1) }))
            await vi.waitFor(() => expect(vista.text()).toContain('Reintentar'))
            expect(vista.find('[data-modalidad]').exists()).toBe(false)
            vista.unmount()
        })

        it('sin servicios.adicional_cortesia el modal no ofrece Cortesía', async () => {
            useUsuarioActual().value = SOPORTE
            const servicio = bd.servicios.find(s => s.id === 1)
            const vista = await mountSuspended(enApp(AdicionalServicioModal, { servicio, asignacion: null, open: true }))
            await vi.waitFor(() => expect(document.body.querySelector('[data-prueba="asignacion-modalidad"]')).not.toBeNull())
            ;(document.body.querySelector('[data-prueba="asignacion-modalidad"]') as HTMLElement).click()
            await vi.waitFor(() => expect(document.body.querySelectorAll('[role="option"]').length).toBeGreaterThan(0))
            const opciones = [...document.body.querySelectorAll('[role="option"]')].map(o => o.textContent?.trim())
            expect(opciones).toEqual(['Incluido', 'Cobrado'])
            vista.unmount()
        })

        it('la credencial se ve al abrir y el modal se oculta solo', async () => {
            const asignacion = bd.adicionalesServicio.find(a => a.id === 1)
            if (!asignacion) {
                throw new Error('Falta la asignación 1 en los fixtures')
            }
            const abierto = ref(true)
            const vista = await mountSuspended(defineComponent({
                render: () => h(UApp, null, { default: () => h(AdicionalCredencialModal, { 'servicioId': 1, asignacion, 'segundos': 1, 'open': abierto.value, 'onUpdate:open': (valor: boolean) => { abierto.value = valor } }) }),
            }))
            await vi.waitFor(() => expect(document.body.querySelector('[data-prueba="credencial-valor"]')?.textContent).toBe('Str3am-0001'))
            expect(document.body.textContent).toContain('Se oculta sola en 1 s')
            await vi.waitFor(() => expect(abierto.value).toBe(false), { timeout: 3000 })
            vista.unmount()
        })

        it('ficha del plan: tipo, adicionales incluidos con cantidad y el aviso de que aplica a altas y cambios', async () => {
            const vista = await mountSuspended(enApp(PaginaPlan), { route: '/planes/3' })
            await vi.waitFor(() => expect(vista.find('[data-prueba="plan-adicionales"]').text()).toContain('Usuario de IPTV'))
            expect(vista.find('[data-prueba="tipo-plan"]').text()).toBe('Empresarial')
            expect(vista.find('[data-prueba="plan-adicionales"]').text()).toContain('próxima alta o cambio de plan')
            expect(vista.find('[data-prueba="plan-adicionales"]').text()).toContain('2')
            expect(vista.find('[data-prueba="editar-adicionales-plan"]').exists()).toBe(true)
            vista.unmount()

            useUsuarioActual().value = { ...meAdmin, permisos: meAdmin.permisos.filter(p => p !== 'planes.editar') }
            const lectura = await mountSuspended(enApp(PaginaPlan), { route: '/planes/3' })
            await vi.waitFor(() => expect(lectura.find('[data-prueba="plan-adicionales"]').text()).toContain('Usuario de IPTV'))
            expect(lectura.find('[data-prueba="editar-adicionales-plan"]').exists()).toBe(false)
            lectura.unmount()
        })

        it('lista de planes con su tipo y catálogo y motivos con sus estados', async () => {
            const planes = await mountSuspended(enApp(PaginaPlanes), { route: '/planes' })
            await vi.waitFor(() => expect(planes.findAll('[data-tipo-plan]').length).toBe(4))
            expect(planes.find('[data-tipo-plan="empresarial"]').text()).toBe('Empresarial')
            planes.unmount()

            const catalogo = await mountSuspended(enApp(PaginaAdicionales), { route: '/adicionales' })
            await vi.waitFor(() => expect(catalogo.text()).toContain('Cuenta de streaming'))
            expect(catalogo.text()).not.toContain('Antivirus familiar')
            expect(catalogo.find('[data-prueba="desactivar-adicional-1"]').exists()).toBe(true)
            catalogo.unmount()

            const motivos = await mountSuspended(enApp(PaginaMotivos), { route: '/adicionales/motivos' })
            await vi.waitFor(() => expect(motivos.text()).toContain('Empleado de la empresa'))
            expect(motivos.text()).toContain('Común')
            motivos.unmount()
        })

        it('guardar un plan dedicado asimétrico avisa con las advertencias, sin error', async () => {
            const plan = bd.planes.find(p => p.id === 1)
            const vista = await mountSuspended(enApp(PlanFormulario, { plan: { ...plan, tipo: 'dedicado' }, open: true }))
            await vi.waitFor(() => expect(document.body.querySelector('#form-plan')).not.toBeNull())
            ;(document.body.querySelector('#form-plan') as HTMLFormElement).requestSubmit()
            await vi.waitFor(() => expect(useToast().toasts.value.map(t => t.title)).toContain('Plan guardado con advertencias'))
            const aviso = useToast().toasts.value.find(t => t.title === 'Plan guardado con advertencias')
            expect(aviso?.color).toBe('warning')
            expect(aviso?.description).toContain('Plan dedicado asimétrico')
            expect(bd.planes.find(p => p.id === 1)?.tipo).toBe('dedicado')
            vista.unmount()
        })
    })
})
