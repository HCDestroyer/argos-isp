import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import { meAdmin, meCajero } from '~~/fixtures/auth/sesiones'
import ServicioActivarInstalacionModal from '~/components/ServicioActivarInstalacionModal.vue'
import PaginaServicio from '~/pages/servicios/[id].vue'
import PaginaServicios from '~/pages/servicios/index.vue'
import { esperar } from '../ayudas/esperar'

/** Servicio pendiente de instalación (`contratos/instalacion.md`): estado, activación y ficha. */
describe('servicio pendiente de instalación', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
    })

    afterEach(() => {
        sesionFixture(null)
    })

    async function crearPendiente(): Promise<Servicio> {
        const datos = { ...entradaServicioVacia(4), router_id: 1, plan_id: 1, user_ppp: 'ana.pendiente4', estado_inicial: 'pendiente_instalacion' as const }
        const salida = esquemaServicio.parse(datos)
        const cuerpo = cuerpoServicio(salida)
        expect(cuerpo.estado_inicial).toBe('pendiente_instalacion')
        const resultado = await useServicios().crear(cuerpo, nuevaClaveIdempotencia())
        if (!resultado.ok) {
            throw new Error(resultado.problema.title)
        }
        return resultado.data
    }

    it('presentación: icono, texto y color propios; filtro por estado', () => {
        expect(ESTADOS_SERVICIO.pendiente_instalacion).toEqual({ etiqueta: 'Pendiente de instalación', color: 'info', icono: 'i-lucide-hard-hat' })
        expect(ESTADOS_FILTRO.map(e => e.estado)).toContain('pendiente_instalacion')
        expect(esEstadoServicio('pendiente_instalacion')).toBe(true)
        expect(tituloAccion({ id: 1, actor_tipo: 'usuario', actor_id: 1, actor_nombre: null, canal: 'panel', accion: 'servicios.activar_instalacion', entidad_tipo: 'servicio', entidad_id: 1, entrada: {}, resultado: 'ok', error: null, request_id: null, empresa_id: 1, empresa_nombre: null, created_at: '2026-10-28T12:00:00.000Z' })).toBe('Instalación activada')
    })

    it('el alta manda estado_inicial solo si nace pendiente', () => {
        const activo = cuerpoServicio(esquemaServicio.parse({ ...entradaServicioVacia(4), router_id: 1, plan_id: 1, user_ppp: 'ana.x4' }))
        expect('estado_inicial' in activo).toBe(false)
        expect(esquemaServicio.safeParse({ ...entradaServicioVacia(4), router_id: 1, plan_id: 1, user_ppp: 'ana.x4', estado_inicial: 'suspendido' }).success).toBe(false)
    })

    it('sobre un pendiente solo se ofrece Retirar; las demás acciones dan 422 servicio_pendiente_instalacion', async () => {
        const servicio = await crearPendiente()
        expect(servicio).toMatchObject({ estado: 'pendiente_instalacion', instalado_en: null, planta: null })
        const disponibles = ACCIONES_SERVICIO.filter(a => accionDisponible(a, servicio)).map(a => a.accion)
        expect(disponibles).toEqual(['retirar'])

        const suspender = await useServicios().ejecutar(servicio.id, 'suspender', 'Prueba de estado', nuevaClaveIdempotencia())
        expect(!suspender.ok && suspender.problema.status).toBe(422)
        expect(!suspender.ok && suspender.problema.type).toBe('urn:argosisp:problema:servicio_pendiente_instalacion')
    })

    it('activar: Idempotency-Key, version, planta normalizada; 409 y 422 servicio_no_pendiente', async () => {
        const servicio = await crearPendiente()
        const api = useServicios()

        const viejo = await api.activarInstalacion(servicio.id, { version: servicio.version + 5 }, nuevaClaveIdempotencia())
        expect(!viejo.ok && viejo.problema.status).toBe(409)
        expect(!viejo.ok && rechazoActivacion(viejo.problema)?.recargar).toBe(true)

        const fuera = await api.activarInstalacion(servicio.id, { version: servicio.version, planta: { potencia_dbm: '-70' } }, nuevaClaveIdempotencia())
        expect(!fuera.ok && fuera.problema.errors?.map(e => e.field)).toEqual(['planta.potencia_dbm'])

        const clave = nuevaClaveIdempotencia()
        const activado = await api.activarInstalacion(servicio.id, { version: servicio.version, planta: { caja: 'NAP-12', potencia_dbm: '-19.4' } }, clave)
        expect(activado.ok && activado.data.estado).toBe('activo')
        expect(activado.ok && activado.data.instalado_en).toBeTruthy()
        expect(activado.ok && activado.data.planta).toEqual({ caja: 'NAP-12', potencia_dbm: '-19.40' })

        // Misma clave: misma respuesta. Clave nueva sobre un activo: 422 servicio_no_pendiente.
        const repetido = await api.activarInstalacion(servicio.id, { version: servicio.version }, clave)
        expect(repetido.ok && repetido.data.version).toBe(activado.ok && activado.data.version)
        const otraVez = await api.activarInstalacion(servicio.id, { version: servicio.version + 1 }, nuevaClaveIdempotencia())
        expect(!otraVez.ok && otraVez.problema.status).toBe(422)
        expect(!otraVez.ok && rechazoActivacion(otraVez.problema)?.titulo).toBe('El servicio ya no está pendiente de instalación')
    })

    it('el cuerpo omite la fecha sin tocar y la planta vacía; el esquema rechaza fechas futuras', () => {
        const ahora = new Date('2026-10-28T18:00:00.000Z')
        const entrada = entradaActivarInstalacion(ahora)
        expect(entrada.instalado_en).toBe('2026-10-28T12:00')
        expect(cuerpoActivarInstalacion(entrada, 3, entrada.instalado_en)).toEqual({ version: 3 })

        const editada = { ...entrada, instalado_en: '2026-10-28T09:30', planta: { ...entrada.planta, olt: ' OLT-1 ', pon: '0/1/4' } }
        expect(cuerpoActivarInstalacion(editada, 3, entrada.instalado_en)).toEqual({
            version: 3,
            instalado_en: '2026-10-28T15:30:00.000Z',
            planta: { olt: 'OLT-1', pon: '0/1/4' },
        })

        const esquema = esquemaActivarInstalacion(ahora.getTime(), Date.parse('2026-10-01T00:00:00.000Z'))
        expect(esquema.safeParse(editada).success).toBe(true)
        expect(esquema.safeParse({ ...entrada, instalado_en: '2026-10-29T12:00' }).success).toBe(false)
        expect(esquema.safeParse({ ...entrada, instalado_en: '2026-09-15T12:00' }).success).toBe(false)
        expect(esquema.safeParse({ ...entrada, planta: { ...entrada.planta, potencia_dbm: '-19.405' } }).success).toBe(false)
    })

    it('la ficha de un pendiente: insignia, aviso, Activar instalación y sin Suspender ni Promesa', async () => {
        const servicio = await crearPendiente()
        const vista = await mountSuspended(PaginaServicio, { route: `/servicios/${servicio.id}` })
        await esperar(() => expect(vista.find('[data-prueba="aviso-pendiente-instalacion"]').exists()).toBe(true))
        expect(vista.text()).toContain('Pendiente de instalación')
        expect(vista.find('[data-prueba="abrir-activar-instalacion"]').exists()).toBe(true)
        expect(vista.find('[data-prueba="instalado-en-servicio"]').text()).toContain('Pendiente')
        const botones = vista.findAll('[role="group"] button').map(b => b.text())
        expect(botones).toContain('Retirar')
        for (const prohibido of ['Suspender', 'Limitar', 'Reactivar', 'Desconectar sesión', 'Promesa de pago', 'Simular promesa']) {
            expect(botones).not.toContain(prohibido)
        }
    })

    it('el modal activa con la planta y la ficha muestra instalado_en y la referencia de planta', async () => {
        const servicio = await crearPendiente()
        const vista = await mountSuspended(PaginaServicio, { route: `/servicios/${servicio.id}` })
        await esperar(() => expect(vista.find('[data-prueba="abrir-activar-instalacion"]').exists()).toBe(true))
        await vista.find('[data-prueba="abrir-activar-instalacion"]').trigger('click')
        await esperar(() => expect(document.body.querySelector('[data-prueba="form-activar-instalacion"]')).not.toBeNull())

        const boton = document.body.querySelector<HTMLElement>('[data-prueba="abrir-planta"]')
        boton?.click()
        await esperar(() => expect(document.body.querySelector('[data-prueba="planta-caja"]')).not.toBeNull())
        for (const [campo, valor] of [['caja', 'NAP-07'], ['puerto', '5'], ['potencia_dbm', '-21.3']] as const) {
            const input = document.body.querySelector<HTMLInputElement>(`[data-prueba="planta-${campo}"] input, input[data-prueba="planta-${campo}"]`)
            expect(input).not.toBeNull()
            if (input) {
                input.value = valor
                input.dispatchEvent(new Event('input'))
            }
        }
        document.body.querySelector<HTMLElement>('[data-prueba="confirmar-activar-instalacion"]')?.click()

        await esperar(() => expect(vista.find('[data-prueba="planta-servicio"]').exists()).toBe(true))
        expect(vista.find('[data-prueba="aviso-pendiente-instalacion"]').exists()).toBe(false)
        expect(vista.find('[data-prueba="abrir-activar-instalacion"]').exists()).toBe(false)
        expect(vista.find('[data-prueba="planta-servicio"]').text()).toContain('NAP-07')
        expect(vista.find('[data-prueba="planta-servicio"]').text()).toContain('-21.30 dBm')
        expect(vista.find('[data-prueba="instalado-en-servicio"]').text()).not.toContain('Pendiente')
        const leido = await useServicios().ver(servicio.id)
        expect(leido.ok && leido.data.estado).toBe('activo')
    })

    it('el modal muestra el 409 con «Recargar servicio» y al recargar toma la versión nueva', async () => {
        const servicio = await crearPendiente()
        // Otra persona lo edita: la versión del modal queda vieja.
        const editado = await useServicios().editar(servicio.id, { version: servicio.version, direccion: 'Lote 4' })
        expect(editado.ok).toBe(true)
        const recargados: Servicio[] = []
        const modal = await mountSuspended(ServicioActivarInstalacionModal, {
            props: { servicio, open: true, onRecargado: (s: Servicio) => recargados.push(s) },
        })
        await esperar(() => expect(document.body.querySelector('[data-prueba="confirmar-activar-instalacion"]')).not.toBeNull())
        document.body.querySelector<HTMLElement>('[data-prueba="confirmar-activar-instalacion"]')?.click()
        await esperar(() => expect(document.body.querySelector('[data-prueba="rechazo-activacion"]')).not.toBeNull())
        expect(document.body.textContent).toContain('El servicio cambió mientras lo veías')
        const recargar = [...document.body.querySelectorAll<HTMLElement>('[data-prueba="rechazo-activacion"] button')].find(b => b.textContent?.includes('Recargar servicio'))
        recargar?.click()
        await esperar(() => expect(recargados.length).toBe(1))
        expect(recargados[0]?.version).toBe(servicio.version + 1)
        modal.unmount()
    })

    it('cajero (sin servicios.activar_instalacion) ve el estado pero no el botón', async () => {
        const servicio = await crearPendiente()
        sesionFixture('fixture-cajero')
        useUsuarioActual().value = meCajero
        try {
            const vista = await mountSuspended(PaginaServicio, { route: `/servicios/${servicio.id}` })
            await esperar(() => expect(vista.find('[data-prueba="aviso-pendiente-instalacion"]').exists()).toBe(true))
            expect(vista.find('[data-prueba="abrir-activar-instalacion"]').exists()).toBe(false)
            const sinPermiso = await useServicios().activarInstalacion(servicio.id, { version: servicio.version }, nuevaClaveIdempotencia())
            expect(!sinPermiso.ok && sinPermiso.problema.status).toBe(403)
        }
        finally {
            useUsuarioActual().value = meAdmin
        }
    })

    it('/servicios filtra por pendiente de instalación y muestra la insignia', async () => {
        const servicio = await crearPendiente()
        const filtrados = await useServicios().listar({ estado: 'pendiente_instalacion' })
        expect(filtrados.ok && filtrados.data.data.map(s => s.id)).toEqual([servicio.id])
        const vista = await mountSuspended(PaginaServicios, { route: '/servicios?estado=pendiente_instalacion' })
        await esperar(() => expect(vista.text()).toContain('ana.pendiente4'))
        expect(vista.text()).toContain('Pendiente de instalación')
        expect(vista.text()).toContain('Por instalar')
    })
})
