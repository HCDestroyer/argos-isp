import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import { bd } from '~~/fixtures/bd'
import { agregarServicioIpEstatica, servicioPppoeEdicion } from '~~/fixtures/servicios/edicion'
import ServicioCredenciales from '~/components/ServicioCredenciales.vue'
import ServicioEditar from '~/components/ServicioEditar.vue'
import { esperar } from '../ayudas/esperar'

/**
 * Pedido del PM (5 nov): en «Editar servicio» se cambia la IPv4 fija (selector del alta) o, en PPPoE,
 * se quita (`ipv4: null`, el pool del router), y el usuario y la contraseña PPPoE (`PUT /servicios/:id`,
 * `servicios.editar`, con `version`; A1 en `a1/tipo-por-router`, el corte de sesión de A2 en
 * `a2/credenciales`).
 */

function cuerpo(): HTMLElement {
    return document.body
}

function escribir(nombre: string, valor: string) {
    const campo = cuerpo().querySelector<HTMLInputElement>(`[name="${nombre}"]`)
    expect(campo, nombre).not.toBeNull()
    campo!.value = valor
    campo!.dispatchEvent(new Event('input'))
}

function clic(prueba: string) {
    const boton = cuerpo().querySelector<HTMLElement>(`[data-prueba="${prueba}"]`)
    expect(boton, prueba).not.toBeNull()
    boton!.click()
}

const enviar = () => cuerpo().querySelector<HTMLFormElement>('#form-editar-servicio')!.requestSubmit()
const texto = () => cuerpo().textContent ?? ''

async function abrir(servicio: Servicio) {
    const panel = await mountSuspended(ServicioEditar, { props: { servicio, open: true } })
    await esperar(() => expect(cuerpo().querySelector('[data-prueba="editar-ipv4"]')).not.toBeNull())
    return panel
}

describe('esquema y cuerpo de la edición: IPv4 y contraseña', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
    })

    it('la IP nueva se valida como en el alta y solo viaja si cambió', () => {
        const servicio = servicioPppoeEdicion()
        const redes = bd.redesIpv4.filter(r => r.router_id === servicio.router_id)
        const esquema = esquemaEdicionServicioPara(servicio, redes)
        const base = entradaEdicionDesde(servicio)

        expect(cambiosServicio(esquema.parse(base), servicio)).toEqual({ version: servicio.version })

        const sinRed = esquema.safeParse({ ...base, cambiar_ipv4: true, ipv4: '100.64.10.77' })
        expect(sinRed.success ? [] : sinRed.error.issues.map(i => [i.path.join('.'), i.message])).toEqual([['red_id', 'Elige la red de la IP fija']])

        const fuera = esquema.safeParse({ ...base, cambiar_ipv4: true, red_id: 1, ipv4: '100.64.11.7' })
        expect(fuera.success ? [] : fuera.error.issues.map(i => i.message)).toEqual(['Escribe una IP dentro de 100.64.10.0/24 o elige otra red'])

        const mala = esquema.safeParse({ ...base, cambiar_ipv4: true, red_id: 1, ipv4: '100.64.10.300' })
        expect(mala.success ? [] : mala.error.issues.map(i => i.message)).toEqual(['Escribe una IPv4 válida'])

        const nueva = esquema.parse({ ...base, cambiar_ipv4: true, red_id: 1, ipv4: '100.64.10.77' })
        expect(cambiosServicio(nueva, servicio)).toEqual({ version: servicio.version, ipv4: '100.64.10.77' })

        // Sin ver las redes (sin `redes.ver`) la red no se exige: la API busca la red por la IP.
        expect(esquemaEdicionServicioPara(servicio).safeParse({ ...base, cambiar_ipv4: true, ipv4: '100.64.10.77' }).success).toBe(true)
    })

    it('la contraseña vacía deja la que tiene; con 6 a 64 caracteres viaja; nunca el usuario', () => {
        const servicio = servicioPppoeEdicion()
        const esquema = esquemaEdicionServicioPara(servicio)
        const base = entradaEdicionDesde(servicio)
        expect(cambiosServicio(esquema.parse({ ...base, pass_ppp: '' }), servicio)).toEqual({ version: servicio.version })
        const corta = esquema.safeParse({ ...base, pass_ppp: 'abc' })
        expect(corta.success ? [] : corta.error.issues.map(i => [i.path.join('.'), i.message])).toEqual([['pass_ppp', 'De 6 a 64 caracteres']])
        const cambios = cambiosServicio(esquema.parse({ ...base, pass_ppp: 'Nueva2026' }), servicio)
        expect(cambios).toEqual({ version: servicio.version, pass_ppp: 'Nueva2026' })
        expect(cambios).not.toHaveProperty('user_ppp')

        // Un ip_estatica no manda contraseña aunque el campo tuviera algo.
        const estatico = agregarServicioIpEstatica()
        expect(cambiosServicio(esquema.parse({ ...entradaEdicionDesde(estatico), pass_ppp: 'Nueva2026' }), estatico)).toEqual({ version: estatico.version })
    })

    it('los fixtures responden como la API: IP de otra red 422, ocupada 409, user_ppp 422, clave guardada', async () => {
        const servicio = servicioPppoeEdicion()
        const otro = bd.servicios.find(s => s.id !== servicio.id && s.router_id === servicio.router_id && s.ipv4)!
        const servicios = useServicios()

        const fueraDeRed = await servicios.editar(servicio.id, { version: servicio.version, ipv4: '10.9.9.9' })
        expect(!fueraDeRed.ok && fueraDeRed.problema.errors?.map(e => [e.field, e.rule])).toEqual([['ipv4', 'red']])

        const gateway = await servicios.editar(servicio.id, { version: servicio.version, ipv4: '100.64.10.1' })
        expect(!gateway.ok && gateway.problema.errors?.map(e => [e.field, e.rule])).toEqual([['ipv4', 'reservada']])

        const ocupada = await servicios.editar(servicio.id, { version: servicio.version, ipv4: otro.ipv4! })
        expect(!ocupada.ok && [ocupada.problema.status, codigoProblema(ocupada.problema)]).toEqual([409, 'ip_ocupada'])

        const repetido = await servicios.editar(servicio.id, { version: servicio.version, user_ppp: otro.user_ppp! })
        expect(!repetido.ok && [repetido.problema.status, codigoProblema(repetido.problema)]).toEqual([409, 'user_ppp_duplicado'])
        const malUsuario = await servicios.editar(servicio.id, { version: servicio.version, user_ppp: 'a b' })
        expect(!malUsuario.ok && malUsuario.problema.errors?.map(e => e.field)).toEqual(['user_ppp'])

        const guardado = await servicios.editar(servicio.id, { version: servicio.version, ipv4: '100.64.10.77', pass_ppp: 'Nueva2026' })
        expect(guardado.ok && [guardado.data.ipv4, guardado.data.version]).toEqual(['100.64.10.77', servicio.version + 1])
        expect(bd.clavesPpp[servicio.id]).toBe('Nueva2026')
        const accion = bd.acciones.findLast(a => a.accion === 'servicios.editar')
        expect(JSON.stringify(accion)).not.toContain('Nueva2026')

        const usuario = await servicios.editar(servicio.id, { version: servicio.version + 1, user_ppp: 'nuevo.usuario' })
        expect(usuario.ok && usuario.data.user_ppp).toBe('nuevo.usuario')

        const alPool = await servicios.editar(servicio.id, { version: servicio.version + 2, ipv4: null })
        expect(alPool.ok && alPool.data.ipv4).toBeNull()

        const estatico = agregarServicioIpEstatica()
        const conClave = await servicios.editar(estatico.id, { version: estatico.version, pass_ppp: 'Nueva2026', user_ppp: 'x.y.z' })
        expect(!conClave.ok && conClave.problema.errors?.map(e => e.field)).toEqual(['pass_ppp', 'user_ppp'])
        const sinIp = await servicios.editar(estatico.id, { version: estatico.version, ipv4: null })
        expect(!sinIp.ok && sinIp.problema.errors?.map(e => [e.field, e.rule])).toEqual([['ipv4', 'required']])
    })

    it('quitar la IP solo en PPPoE manda `ipv4: null`; nunca `ipv4: ""`', () => {
        const servicio = servicioPppoeEdicion()
        const esquema = esquemaEdicionServicioPara(servicio)
        const base = entradaEdicionDesde(servicio)
        expect(cambiosServicio(esquema.parse({ ...base, quitar_ipv4: true }), servicio)).toEqual({ version: servicio.version, ipv4: null })
        expect(cambiosServicio({ ...esquema.parse(base), cambiar_ipv4: true, ipv4: '' }, servicio)).not.toHaveProperty('ipv4')
        const usuario = cambiosServicio(esquema.parse({ ...base, user_ppp: 'nuevo.usuario' }), servicio)
        expect(usuario).toEqual({ version: servicio.version, user_ppp: 'nuevo.usuario' })
        const malo = esquema.safeParse({ ...base, user_ppp: 'a b' })
        expect(malo.success ? [] : malo.error.issues.map(i => i.path.join('.'))).toEqual(['user_ppp'])

        const estatico = agregarServicioIpEstatica()
        const sinIp = esquemaEdicionServicioPara(estatico).safeParse({ ...entradaEdicionDesde(estatico), quitar_ipv4: true })
        expect(sinIp.success ? [] : sinIp.error.issues.map(i => i.path.join('.'))).toEqual(['ipv4'])
    })
})

describe('«Editar servicio»: IPv4 y credenciales', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
    })

    it('PPPoE: cambia la IP con el selector del alta y la contraseña generada', async () => {
        const servicio = servicioPppoeEdicion()
        const panel = await abrir(servicio)
        expect(cuerpo().querySelector('[data-prueba="editar-ipv4-actual"]')!.textContent).toContain(servicio.ipv4!)
        const usuario = cuerpo().querySelector<HTMLInputElement>('[name="user_ppp"]')!
        expect(usuario.value).toBe(servicio.user_ppp)
        expect(usuario.disabled).toBe(false)

        clic('editar-cambiar-ipv4')
        await esperar(() => expect(cuerpo().querySelector('[name="ipv4"]')).not.toBeNull())
        escribir('ipv4', '100.64.11.9')
        enviar()
        await esperar(() => expect(texto()).toContain('Escribe una IP dentro de 100.64.10.0/24 o elige otra red'))
        expect(panel.emitted('guardado')).toBeUndefined()

        escribir('ipv4', '100.64.10.77')
        clic('editar-generar-pass')
        await esperar(() => expect(cuerpo().querySelector('[data-prueba="aviso-clave"]')).not.toBeNull())
        const clave = cuerpo().querySelector<HTMLInputElement>('[name="pass_ppp"]')!.value
        expect(clave).toMatch(/^[A-Za-z0-9]{10}$/)
        expect(texto()).toContain('Al guardar, el cliente se desconecta y vuelve a conectarse con el usuario y la contraseña nuevos.')

        enviar()
        await esperar(() => expect(panel.emitted('guardado')).toBeDefined())
        const actual = bd.servicios.find(s => s.id === servicio.id)!
        expect([actual.ipv4, actual.user_ppp, actual.version]).toEqual(['100.64.10.77', servicio.user_ppp, servicio.version + 1])
        expect(bd.clavesPpp[servicio.id]).toBe(clave)
        panel.unmount()
    })

    it('IP ocupada (409 ip_ocupada): el error va en el campo, sin «Recargar»', async () => {
        const servicio = servicioPppoeEdicion()
        const otro = bd.servicios.find(s => s.id !== servicio.id && s.router_id === servicio.router_id && s.ipv4?.startsWith('100.64.10.'))!
        const panel = await abrir(servicio)
        clic('editar-cambiar-ipv4')
        await esperar(() => expect(cuerpo().querySelector('[name="ipv4"]')).not.toBeNull())
        escribir('ipv4', otro.ipv4!)
        enviar()
        await esperar(() => expect(texto()).toContain(`La IP ${otro.ipv4} ya está asignada al servicio ${otro.id}`))
        expect(cuerpo().querySelector('[data-prueba="editar-servicio-error"]')).toBeNull()
        expect(panel.emitted('guardado')).toBeUndefined()
        panel.unmount()
    })

    it('ip_estatica: cambia la IP (obligatoria, no se quita) y no ofrece credenciales', async () => {
        const servicio = agregarServicioIpEstatica()
        const panel = await abrir(servicio)
        expect(cuerpo().querySelector('[data-prueba="editar-credenciales"]')).toBeNull()
        clic('editar-cambiar-ipv4')
        await esperar(() => expect(texto()).toContain('la IPv4 es obligatoria; se cambia, no se quita'))
        escribir('ipv4', '100.64.10.201')
        enviar()
        await esperar(() => expect(panel.emitted('guardado')).toBeDefined())
        expect(bd.servicios.find(s => s.id === servicio.id)!.ipv4).toBe('100.64.10.201')
        panel.unmount()
    })

    it('PPPoE: «Quitar IP fija (usar el pool)» deja el servicio sin IPv4 fija', async () => {
        const servicio = servicioPppoeEdicion()
        const panel = await abrir(servicio)
        clic('editar-quitar-ipv4')
        await esperar(() => expect(cuerpo().querySelector('[data-prueba="aviso-quitar-ipv4"]')).not.toBeNull())
        expect(texto()).toContain(`Al guardar se libera ${servicio.ipv4}`)
        enviar()
        await esperar(() => expect(panel.emitted('guardado')).toBeDefined())
        expect(bd.servicios.find(s => s.id === servicio.id)!.ipv4).toBeNull()
        panel.unmount()
    })

    it('ip_estatica: no ofrece quitar la IP', async () => {
        const servicio = agregarServicioIpEstatica()
        const panel = await abrir(servicio)
        expect(cuerpo().querySelector('[data-prueba="editar-quitar-ipv4"]')).toBeNull()
        expect(cuerpo().querySelector('[data-prueba="editar-cambiar-ipv4"]')).not.toBeNull()
        panel.unmount()
    })

    it('cambia el usuario PPPoE; el repetido (409 user_ppp_duplicado) se marca en el campo', async () => {
        const servicio = servicioPppoeEdicion()
        const otro = bd.servicios.find(s => s.id !== servicio.id && s.user_ppp)!
        const panel = await abrir(servicio)
        await esperar(() => expect(cuerpo().querySelector('[name="user_ppp"]')).not.toBeNull())
        escribir('user_ppp', otro.user_ppp!)
        await esperar(() => expect(cuerpo().querySelector('[data-prueba="aviso-clave"]')).not.toBeNull())
        enviar()
        await esperar(() => expect(texto()).toContain(`El user_ppp ${otro.user_ppp} ya existe`))
        expect(cuerpo().querySelector('[data-prueba="editar-servicio-error"]')).toBeNull()
        escribir('user_ppp', 'maria.nueva')
        enviar()
        await esperar(() => expect(panel.emitted('guardado')).toBeDefined())
        expect(bd.servicios.find(s => s.id === servicio.id)!.user_ppp).toBe('maria.nueva')
        panel.unmount()
    })

    it('tipo de conexión: solo lectura; si difiere del router se ofrece pasar al del router', async () => {
        const servicio = agregarServicioIpEstatica()
        const panel = await abrir(servicio)
        await esperar(() => expect(cuerpo().querySelector('[data-prueba="editar-pasar-tipo-router"]')).not.toBeNull())
        expect(cuerpo().querySelector('[data-prueba="editar-tipo-actual"]')!.textContent).toBe('IP estática')
        expect(cuerpo().querySelectorAll('[data-prueba="editar-tipo-conexion"] [role="radio"]')).toHaveLength(0)
        const casilla = cuerpo().querySelector<HTMLElement>('[data-prueba="editar-pasar-tipo-router"]')!
        const marcar = casilla.matches('[role="checkbox"]') ? casilla : casilla.querySelector<HTMLElement>('[role="checkbox"]')!
        marcar.click()
        await esperar(() => expect(cuerpo().querySelector('[data-prueba="editar-tipo-actual"]')!.textContent).toBe('PPPoE'))
        enviar()
        await esperar(() => expect(panel.emitted('guardado')).toBeDefined())
        expect(bd.servicios.find(s => s.id === servicio.id)).toMatchObject({ tipo_conexion: 'pppoe' })
        panel.unmount()

        const pppoe = await abrir(servicioPppoeEdicion())
        await flushPromises()
        expect(cuerpo().querySelector('[data-prueba="editar-pasar-tipo-router"]')).toBeNull()
        pppoe.unmount()
    })

    it('«Mantener la actual» descarta la IP escrita', async () => {
        const servicio = servicioPppoeEdicion()
        const panel = await abrir(servicio)
        clic('editar-cambiar-ipv4')
        await esperar(() => expect(cuerpo().querySelector('[name="ipv4"]')).not.toBeNull())
        escribir('ipv4', '100.64.10.78')
        clic('editar-mantener-ipv4')
        await esperar(() => expect(cuerpo().querySelector('[name="ipv4"]')).toBeNull())
        enviar()
        await esperar(() => expect(cuerpo().querySelector('#form-editar-servicio')).toBeNull())
        expect(bd.servicios.find(s => s.id === servicio.id)!.version).toBe(servicio.version)
        panel.unmount()
    })

    it('409 de versión: «Recargar» lee el servicio otra vez', async () => {
        const servicio = servicioPppoeEdicion()
        const panel = await abrir(servicio)
        const indice = bd.servicios.findIndex(s => s.id === servicio.id)
        bd.servicios[indice] = { ...bd.servicios[indice]!, version: servicio.version + 1 }
        escribir('pass_ppp', 'Nueva2026')
        enviar()
        await esperar(() => expect(cuerpo().querySelector('[data-prueba="editar-servicio-error"]')).not.toBeNull())
        const recargar = [...cuerpo().querySelectorAll<HTMLElement>('[data-prueba="editar-servicio-error"] button')].find(b => b.textContent?.includes('Recargar'))
        expect(recargar).toBeDefined()
        recargar!.click()
        await esperar(() => expect(panel.emitted('guardado')?.[0]?.[0]).toMatchObject({ version: servicio.version + 1 }))
        panel.unmount()
    })

    it('las credenciales olvidan la contraseña leída cuando cambia la versión', async () => {
        const servicio = servicioPppoeEdicion()
        const vista = await mountSuspended(ServicioCredenciales, { props: { servicio } })
        await vista.findAll('button').find(b => b.text().includes('Mostrar'))!.trigger('click')
        await esperar(() => expect(vista.text()).not.toContain('••••••••••••'))
        await vista.setProps({ servicio: { ...servicio, version: servicio.version + 1 } })
        await flushPromises()
        expect(vista.text()).toContain('••••••••••••')
        vista.unmount()
    })
})
