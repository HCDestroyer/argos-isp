import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import meAdmin from '~~/fixtures/auth/me.admin.json'
import PaginaServicio from '~/pages/servicios/[id].vue'
import PaginaServicios from '~/pages/servicios/index.vue'

const MAC = '4C:5E:0C:AA:BB:CC'

function entrada(extra: Partial<EntradaServicio> = {}): EntradaServicio {
    return { ...entradaServicioVacia(1), router_id: 1, plan_id: 1, user_ppp: 'ana.lopez1', ...extra }
}

function campos(resultado: ReturnType<typeof esquemaServicio.safeParse>): string[] {
    return resultado.success ? [] : resultado.error.issues.map(i => i.path.join('.'))
}

async function crearWisp(tipo: 'ip_estatica' | 'dhcp_fija', extra: Partial<DatosServicio> = {}): Promise<Servicio> {
    const resultado = await useServicios().crear({ cliente_id: 4, router_id: 1, plan_id: 1, tipo_conexion: tipo, ipv6_modo: 'ninguno', plantilla_facturacion_id: 1, ...extra }, nuevaClaveIdempotencia())
    if (!resultado.ok) {
        throw new Error(resultado.problema.title)
    }
    return resultado.data
}

describe('semana 2 · servicios WISP', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
    })

    it('esquema del alta: credenciales solo en PPPoE, MAC en DHCP fija y amarre, sin IPv6 por RADIUS', () => {
        expect(campos(esquemaServicio.safeParse(entrada()))).toEqual([])
        expect(campos(esquemaServicio.safeParse(entrada({ user_ppp: 'x' })))).toEqual(['user_ppp'])
        // WISP: el usuario vacío no importa, pero la MAC sí en DHCP fija y el modo RADIUS no vale.
        expect(campos(esquemaServicio.safeParse(entrada({ tipo_conexion: 'ip_estatica', user_ppp: '', pass_ppp: '', ipv6_modo: 'ninguno' })))).toEqual([])
        expect(campos(esquemaServicio.safeParse(entrada({ tipo_conexion: 'dhcp_fija', user_ppp: '', ipv6_modo: 'ninguno' })))).toEqual(['mac'])
        expect(campos(esquemaServicio.safeParse(entrada({ tipo_conexion: 'dhcp_fija', mac: '4C-5E', ipv6_modo: 'ninguno' })))).toEqual(['mac'])
        expect(campos(esquemaServicio.safeParse(entrada({ tipo_conexion: 'ip_estatica', ipv6_modo: 'radius_servicio' })))).toEqual(['ipv6_modo'])
        expect(campos(esquemaServicio.safeParse(entrada({ tipo_conexion: 'ip_estatica', ipv6_modo: 'ninguno', amarre_ip_mac: true })))).toEqual(['mac'])
        expect(campos(esquemaServicio.safeParse(entrada({ amarre_ip_mac: true, mac: MAC })))).toEqual(['amarre_ip_mac'])
    })

    it('el cuerpo del alta WISP no lleva credenciales y sí el tipo y el amarre', () => {
        const wisp = cuerpoServicio(esquemaServicio.parse(entrada({ tipo_conexion: 'dhcp_fija', mac: MAC, amarre_ip_mac: true, ipv6_modo: 'ninguno' })))
        expect(wisp).toMatchObject({ tipo_conexion: 'dhcp_fija', mac: MAC, amarre_ip_mac: true })
        expect(wisp).not.toHaveProperty('user_ppp')
        expect(wisp).not.toHaveProperty('pass_ppp')
        const pppoe = cuerpoServicio(esquemaServicio.parse(entrada()))
        expect(pppoe).toMatchObject({ tipo_conexion: 'pppoe', user_ppp: 'ana.lopez1' })
        expect(pppoe).not.toHaveProperty('amarre_ip_mac')
    })

    it('alta WISP: sin usuario PPP, nombrado por su IPv4, sin credenciales ni desconectar', async () => {
        const servicio = await crearWisp('dhcp_fija', { mac: MAC, amarre_ip_mac: true })
        expect(servicio).toMatchObject({ tipo_conexion: 'dhcp_fija', user_ppp: null, amarre_ip_mac: true, mac: MAC })
        expect(servicio.ipv4).toBeTruthy()
        expect(etiquetaServicio(servicio)).toBe(servicio.ipv4)
        const credenciales = await useServicios().credenciales(servicio.id)
        expect(!credenciales.ok && credenciales.problema.status).toBe(422)
        const desconectar = ACCIONES_SERVICIO.find(a => a.accion === 'desconectar')
        expect(desconectar && accionDisponible(desconectar, servicio)).toBe(false)
        const sinMac = await useServicios().crear({ cliente_id: 4, router_id: 1, plan_id: 1, tipo_conexion: 'dhcp_fija', ipv6_modo: 'ninguno', plantilla_facturacion_id: 1 }, nuevaClaveIdempotencia())
        expect(!sinMac.ok && sinMac.problema.errors?.map(e => e.field)).toEqual(['mac'])
    })

    it('edición: solo viaja lo que cambió; pasar a PPPoE genera usuario, salir lo borra', async () => {
        const servicio = await crearWisp('ip_estatica')
        const entradaEdicion = { ...entradaEdicionDesde(servicio), direccion: 'Km 14 carretera a El Salvador' }
        expect(cambiosServicio(esquemaEdicionServicio.parse(entradaEdicion), servicio)).toEqual({ version: 1, direccion: 'Km 14 carretera a El Salvador' })

        const aPppoe = await useServicios().editar(servicio.id, cambiosServicio(esquemaEdicionServicio.parse({ ...entradaEdicionDesde(servicio), tipo_conexion: 'pppoe' }), servicio))
        expect(aPppoe.ok && aPppoe.data.user_ppp).toBeTruthy()
        if (!aPppoe.ok) {
            return
        }
        const deVuelta = await useServicios().editar(servicio.id, { version: aPppoe.data.version, tipo_conexion: 'dhcp_fija', ipv6_modo: 'ninguno' })
        expect(!deVuelta.ok && deVuelta.problema.errors?.map(e => e.field)).toEqual(['mac'])
        const conMac = await useServicios().editar(servicio.id, { version: aPppoe.data.version, tipo_conexion: 'dhcp_fija', ipv6_modo: 'ninguno', mac: MAC })
        expect(conMac.ok && conMac.data).toMatchObject({ tipo_conexion: 'dhcp_fija', user_ppp: null })
        const viejo = await useServicios().editar(servicio.id, { version: 1, direccion: 'x' })
        expect(!viejo.ok && viejo.problema.status).toBe(409)
    })

    it('la ficha de un servicio WISP muestra el tipo y oculta credenciales y sesión', async () => {
        const servicio = await crearWisp('ip_estatica')
        const vista = await mountSuspended(PaginaServicio, { route: `/servicios/${servicio.id}` })
        await vi.waitFor(() => expect(vista.find('[data-prueba="tipo-conexion"]').exists()).toBe(true))
        expect(vista.find('[data-prueba="tipo-conexion"]').text()).toBe('IP estática')
        expect(vista.text()).not.toContain('Credenciales PPPoE')
        expect(vista.text()).not.toContain('Sesión activa')
        expect(vista.text()).toContain(servicio.ipv4 ?? '')
        expect(vista.text()).not.toContain('Desconectar')
        expect(vista.find('[data-prueba="editar-servicio"]').exists()).toBe(true)

        const pppoe = await mountSuspended(PaginaServicio, { route: '/servicios/1' })
        await vi.waitFor(() => expect(pppoe.text()).toContain('Credenciales PPPoE'))
        expect(pppoe.find('[data-prueba="tipo-conexion"]').text()).toBe('PPPoE')
    })

    it('/servicios filtra por tipo de conexión', async () => {
        const servicio = await crearWisp('ip_estatica')
        const filtrados = await useServicios().listar({ tipo_conexion: 'ip_estatica' })
        expect(filtrados.ok && filtrados.data.data.map(s => s.id)).toEqual([servicio.id])
        const vista = await mountSuspended(PaginaServicios, { route: '/servicios?tipo=ip_estatica' })
        await vi.waitFor(() => expect(vista.text()).toContain(servicio.ipv4 ?? ''))
        expect(vista.text()).toContain('IP estática')
    })
})
