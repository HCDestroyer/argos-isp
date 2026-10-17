import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PASSWORD_INCORRECTA_FIXTURE, reiniciarFixtures, sesionFixture, vencimientosSesionFixture } from '~~/fixtures'
import { bd } from '~~/fixtures/bd'
import ClienteFormulario from '~/components/ClienteFormulario.vue'
import SesionBloqueo from '~/components/SesionBloqueo.vue'

/**
 * Semana 3 (3.ª tanda) · tarea 1: sesión deslizante (`contratos/sesion-panel.md` §4) y ventana de
 * bloqueo (decisión del PM). Con 401 `sesion_expirada` la página sigue montada, se pide solo la
 * contraseña y, al desbloquear, se repiten las peticiones que fallaron.
 */
const HORA = 3_600_000

function vencerSesion(): void {
    vencimientosSesionFixture(new Date(Date.now() - 1_000).toISOString(), new Date(Date.now() + HORA).toISOString())
}

async function hasta(condicion: () => boolean): Promise<void> {
    for (let i = 0; i < 50 && !condicion(); i++) {
        await flushPromises()
        await new Promise(resolve => setTimeout(resolve, 10))
    }
    expect(condicion()).toBe(true)
}

describe('sesión deslizante y ventana de bloqueo', () => {
    beforeEach(async () => {
        reiniciarFixtures()
        sesionFixture(null)
        limpiarSesionLocal()
        await useAuth().login({ email: 'admin@argos.test', password: 'clave' })
    })

    afterEach(() => {
        sesionFixture(null)
        limpiarSesionLocal()
    })

    it('el login guarda expira_en y el tope expira_max_en (72 h)', () => {
        const tope = new Date(useExpiraMaxSesion().value ?? '').getTime()
        expect(tope - Date.now()).toBeGreaterThan(72 * HORA - 10_000)
        expect(tope - Date.now()).toBeLessThanOrEqual(72 * HORA)
        expect(new Date(useExpiraSesion().value ?? '').getTime()).toBeLessThan(tope)
    })

    it('cada petición renueva expira_en sin pasar del tope; /me trae los dos', async () => {
        const tope = new Date(Date.now() + 2 * HORA).toISOString()
        vencimientosSesionFixture(new Date(Date.now() + 60_000).toISOString(), tope)
        await useClientes().listar()
        expect(bd.sesion.expiraEn).toBe(tope)
        const me = await useAuth().cargarMe()
        expect(me?.expira_max_en).toBe(tope)
        expect(useExpiraMaxSesion().value).toBe(tope)
    })

    it('expira con peticiones en vuelo: bloquea, las pone en cola y las repite al desbloquear', async () => {
        const csrfViejo = useCsrf().value
        vencerSesion()
        const lista = useClientes().listar()
        const alta = useClientes().crear({ ...cuerpoCliente(esquemaCliente.parse({ ...entradaDesdeCliente(), nombre: 'Marta En Cola' })) }, nuevaClaveIdempotencia())
        await hasta(() => useSesionBloqueada().value)
        // La sesión local sigue: la ventana muestra quién es.
        expect(useUsuarioActual().value?.email).toBe('admin@argos.test')
        expect(bd.clientes.some(c => c.nombre === 'Marta En Cola')).toBe(false)

        const resultado = await useAuth().desbloquear('clave')
        expect(resultado.ok).toBe(true)
        expect(useSesionBloqueada().value).toBe(false)
        expect(useCsrf().value).not.toBe(csrfViejo)
        const [r1, r2] = await Promise.all([lista, alta])
        expect(r1.ok).toBe(true)
        // El POST se repitió con el csrf nuevo (si no, 403 csrf_invalido).
        expect(r2.ok && r2.data.nombre).toBe('Marta En Cola')
        expect(bd.clientes.filter(c => c.nombre === 'Marta En Cola')).toHaveLength(1)
    })

    it('contraseña mala: error en la ventana, sigue bloqueada; al 6.º intento 429 con los segundos', async () => {
        vencerSesion()
        const lista = useClientes().listar()
        await hasta(() => useSesionBloqueada().value)

        const mala = await useAuth().desbloquear(PASSWORD_INCORRECTA_FIXTURE)
        expect(!mala.ok && mala.motivo === 'credenciales' && mala.problema.status).toBe(401)
        expect(useSesionBloqueada().value).toBe(true)

        for (let i = 0; i < 4; i++) {
            await useAuth().desbloquear(PASSWORD_INCORRECTA_FIXTURE)
        }
        const limite = await useAuth().desbloquear('clave')
        expect(!limite.ok && limite.motivo === 'credenciales' && limite.esperarS).toBe(900)

        bd.loginFallidos = {}
        expect((await useAuth().desbloquear('clave')).ok).toBe(true)
        expect((await lista).ok).toBe(true)
    })

    it('"No soy yo / Salir": login completo, estado vacío y las peticiones devuelven el 401', async () => {
        await navigateTo('/clientes')
        vencerSesion()
        const lista = useClientes().listar()
        await hasta(() => useSesionBloqueada().value)
        await useAuth().salir()
        const resultado = await lista
        expect(!resultado.ok && resultado.problema.status).toBe(401)
        expect(useUsuarioActual().value).toBeNull()
        expect(useCsrf().value).toBeNull()
        expect(useSesionBloqueada().value).toBe(false)
        expect(useRouter().currentRoute.value.path).toBe('/login')
    })

    it('si la API devuelve otro usuario: logout y al login', async () => {
        const actual = useUsuarioActual().value
        if (!actual) {
            throw new Error('sin usuario')
        }
        useUsuarioActual().value = { ...actual, id: 99 }
        vencerSesion()
        const lista = useClientes().listar()
        await hasta(() => useSesionBloqueada().value)
        const resultado = await useAuth().desbloquear('clave')
        expect(!resultado.ok && resultado.motivo).toBe('otro_usuario')
        expect((await lista).ok).toBe(false)
        expect(useUsuarioActual().value).toBeNull()
        expect(useRouter().currentRoute.value.path).toBe('/login')
    })

    it('un 401 sin sesion_expirada (revocada) va al login, sin ventana', async () => {
        sesionFixture(null)
        const resultado = await useClientes().listar()
        expect(!resultado.ok && resultado.problema.status).toBe(401)
        expect(useSesionBloqueada().value).toBe(false)
        expect(useUsuarioActual().value).toBeNull()
    })

    it('formulario a medias: sigue con sus datos bajo la ventana y el alta se repite al desbloquear', async () => {
        const formulario = await mountSuspended(ClienteFormulario)
        const ventana = await mountSuspended(SesionBloqueo)
        await formulario.find('input[name="nombre"]').setValue('Rosa A Medias')
        await formulario.find('input[name="telefono"]').setValue('5555-0000')
        vencerSesion()
        await formulario.find('form').trigger('submit')
        await hasta(() => useSesionBloqueada().value)

        expect(document.body.textContent).toContain('Sesión bloqueada')
        expect(document.body.textContent).toContain('Ana Administradora')
        expect(document.body.textContent).toContain('admin@argos.test')
        expect((formulario.find('input[name="nombre"]').element as HTMLInputElement).value).toBe('Rosa A Medias')
        expect(formulario.emitted('guardado')).toBeUndefined()

        expect((await useAuth().desbloquear('clave')).ok).toBe(true)
        await hasta(() => formulario.emitted('guardado') !== undefined)
        expect(bd.clientes.filter(c => c.nombre === 'Rosa A Medias')).toHaveLength(1)
        ventana.unmount()
        formulario.unmount()
    })

    it('la ventana muestra el error de la contraseña mala', async () => {
        const ventana = await mountSuspended(SesionBloqueo)
        vencerSesion()
        void useClientes().listar()
        await hasta(() => useSesionBloqueada().value)
        await flushPromises()
        const campo = document.body.querySelector<HTMLInputElement>('input[type="password"]')
        expect(campo).not.toBeNull()
        if (campo) {
            campo.value = PASSWORD_INCORRECTA_FIXTURE
            campo.dispatchEvent(new Event('input'))
        }
        document.body.querySelector('form')?.dispatchEvent(new Event('submit'))
        await hasta(() => (document.body.textContent ?? '').includes('Credenciales'))
        expect(useSesionBloqueada().value).toBe(true)
        ventana.unmount()
    })

    it('aviso del tope: solo dentro de los últimos 15 min', () => {
        const ahora = new Date('2026-10-17T12:00:00Z')
        expect(faltaParaTopeSesion(null, ahora)).toBeNull()
        expect(faltaParaTopeSesion('2026-10-17T12:20:00Z', ahora)).toBeNull()
        expect(faltaParaTopeSesion('2026-10-17T12:10:00Z', ahora)).toBe(10 * 60_000)
        expect(faltaParaTopeSesion('2026-10-17T11:59:00Z', ahora)).toBeNull()
    })
})
