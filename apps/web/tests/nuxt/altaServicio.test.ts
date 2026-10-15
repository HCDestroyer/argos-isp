import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures } from '~~/fixtures'

function entradaValida(): EntradaServicio {
    return {
        ...entradaServicioVacia(14),
        router_id: 1,
        plan_id: 2,
        user_ppp: 'claudia.marisol1234',
        pass_ppp: 'Clave2345x',
        plantilla_facturacion_id: 1,
    }
}

describe('utilidades del alta de servicio', () => {
    it('ipEnCidr', () => {
        expect(ipEnCidr('100.64.10.50', '100.64.10.0/24')).toBe(true)
        expect(ipEnCidr('100.64.11.1', '100.64.10.0/24')).toBe(false)
        expect(ipEnCidr('100.64.21.255', '100.64.20.0/23')).toBe(true)
        expect(ipEnCidr('300.1.1.1', '100.64.10.0/24')).toBe(false)
    })

    it('formatearVelocidad', () => {
        expect(formatearVelocidad(10_000)).toBe('10 Mbps')
        expect(formatearVelocidad(1_500)).toBe('1.5 Mbps')
        expect(formatearVelocidad(512)).toBe('512 kbps')
    })

    it('genera credenciales PPP válidas para el backend', () => {
        const usuario = generarUsuarioPpp('María José Pérez López')
        expect(usuario).toMatch(/^maria\.jose\d{4}$/)
        expect(usuario).toMatch(PATRON_USUARIO_PPP)
        expect(generarUsuarioPpp('  ')).toMatch(/^cliente\d{4}$/)
        const clave = generarClavePpp()
        expect(clave).toHaveLength(10)
        expect(clave).not.toMatch(/[0O1lI]/)
    })
})

describe('esquemaServicio (espejo de crearServicioValidator)', () => {
    it('asignación automática no manda ipv4 y los vacíos van como null', () => {
        const cuerpo = cuerpoServicio(esquemaServicio.parse(entradaValida()))
        expect(cuerpo).not.toHaveProperty('ipv4')
        expect(cuerpo).not.toHaveProperty('ipv6_duid')
        expect(cuerpo).toMatchObject({ cliente_id: 14, router_id: 1, plan_id: 2, mac: null, costo_override: null, ipv6_modo: 'radius_servicio' })
    })

    it('IP fija exige red e IPv4 válida', () => {
        const resultado = esquemaServicio.safeParse({ ...entradaValida(), asignacion: 'fija', ipv4: '100.64' })
        const campos = resultado.error?.issues.map(issue => issue.path.join('.'))
        expect(campos).toEqual(expect.arrayContaining(['ipv4', 'red_id']))

        const valida = esquemaServicio.parse({ ...entradaValida(), asignacion: 'fija', red_id: 1, ipv4: '100.64.10.200' })
        expect(cuerpoServicio(valida).ipv4).toBe('100.64.10.200')
    })

    it('DUID y prefijo estático según el modo IPv6', () => {
        expect(esquemaServicio.safeParse({ ...entradaValida(), ipv6_modo: 'duid' }).success).toBe(false)
        expect(esquemaServicio.safeParse({ ...entradaValida(), ipv6_modo: 'estatico', prefijo_delegado_v6: 'abc' }).success).toBe(false)
        const estatico = esquemaServicio.parse({ ...entradaValida(), ipv6_modo: 'estatico', prefijo_delegado_v6: '2803:d100:1000:100::/56' })
        expect(cuerpoServicio(estatico).prefijo_delegado_v6).toBe('2803:d100:1000:100::/56')
    })

    it.each([
        ['user_ppp', 'ab'],
        ['pass_ppp', '123'],
        ['costo_override', '12.345'],
        ['mac', 'zz'],
        ['fecha_instalacion', '2026-13-01'],
    ])('rechaza %s = %s', (campo, valor) => {
        const resultado = esquemaServicio.safeParse({ ...entradaValida(), [campo]: valor })
        expect(resultado.error?.issues.map(issue => issue.path.join('.'))).toContain(campo)
    })
})

describe('useRouters, usePlantillas y useServicios.crear', () => {
    beforeEach(() => {
        reiniciarFixtures()
        useNuxtApp().$tokenSesion.value = 'fixture-admin'
    })

    afterEach(() => {
        useNuxtApp().$tokenSesion.value = null
    })

    it('planes, redes y bloques por router', async () => {
        const planes = await useRouters().planes(2)
        expect(planes.ok && planes.data.map(plan => plan.id)).toEqual([1, 2, 4])
        const redes = await useRouters().redesIpv4(1)
        expect(redes.ok && redes.data.map(red => red.cidr)).toEqual(['100.64.10.0/24', '100.64.11.0/24'])
        const bloques = await useRouters().ipv6Bloques(3)
        expect(bloques.ok && bloques.data).toEqual([])
        const plantillas = await usePlantillas().listar()
        expect(plantillas.ok && plantillas.data).toHaveLength(2)
    })

    it('crea el servicio con IPv4 automática y no lo duplica al reintentar', async () => {
        const clave = nuevaClaveIdempotencia()
        const cuerpo = cuerpoServicio(esquemaServicio.parse(entradaValida()))
        const primero = await useServicios().crear(cuerpo, clave)
        const segundo = await useServicios().crear(cuerpo, clave)
        expect(primero.ok && segundo.ok).toBe(true)
        if (primero.ok && segundo.ok) {
            expect(segundo.data.id).toBe(primero.data.id)
            expect(primero.data.estado).toBe('activo')
            expect(ipEnCidr(primero.data.ipv4 ?? '', '100.64.10.0/24')).toBe(true)
            expect(primero.data.prefijo_delegado_v6).toMatch(/\/56$/)
        }
        const delCliente = await useServicios().listar({ cliente_id: 14 })
        expect(delCliente.ok && delCliente.data.data).toHaveLength(1)
    })

    it('un usuario PPP repetido vuelve como 422 en user_ppp', async () => {
        const cuerpo = cuerpoServicio(esquemaServicio.parse({ ...entradaValida(), user_ppp: 'ana.lucia4' }))
        const resultado = await useServicios().crear(cuerpo, nuevaClaveIdempotencia())
        expect(!resultado.ok && erroresDeFormulario(resultado.problema).map(error => error.name)).toEqual(['user_ppp'])
    })

    it('el cajero no puede crear servicios', async () => {
        useNuxtApp().$tokenSesion.value = 'fixture-cajero'
        const cuerpo = cuerpoServicio(esquemaServicio.parse(entradaValida()))
        const resultado = await useServicios().crear(cuerpo, nuevaClaveIdempotencia())
        expect(!resultado.ok && resultado.problema.status).toBe(403)
    })
})
