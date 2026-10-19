import { describe, expect, it } from 'vitest'
import { QUIEN_SOY_ACTIVO, QUIEN_SOY_DESCONOCIDO, QUIEN_SOY_SUSPENDIDO } from '~~/fixtures/corte'
import { apiAdmiteToken, cabecerasReenvio, cadenaReenvio, destinoReenvio, resolverIpCliente } from '~~/server/utils/reenvioApi'

describe('mensajeCorte', () => {
    it('elige título según el estado', () => {
        expect(mensajeCorte(QUIEN_SOY_SUSPENDIDO).titulo).toBe('Tu servicio está suspendido')
        expect(mensajeCorte(QUIEN_SOY_DESCONOCIDO).titulo).toBe('No pudimos identificar tu servicio')
        expect(mensajeCorte({ ...QUIEN_SOY_ACTIVO, estado: 'limitado' }).titulo).toBe('Tu servicio está limitado')
        expect(mensajeCorte({ ...QUIEN_SOY_ACTIVO, estado: 'retirado' }).titulo).toBe('Tu servicio está dado de baja')
    })

    it('activo distingue saldo pendiente sin usar number', () => {
        expect(mensajeCorte(QUIEN_SOY_ACTIVO).descripcion).toContain('saldo pendiente')
        expect(mensajeCorte({ ...QUIEN_SOY_ACTIVO, monto_adeudado: '0.00' }).descripcion).toBe('No tienes saldo pendiente.')
        expect(hayMonto('0.01')).toBe(true)
        expect(hayMonto('0.00')).toBe(false)
        expect(hayMonto(null)).toBe(false)
        expect(hayMonto('x')).toBe(false)
    })
})

describe('reenvío del portal a la API', () => {
    it('agrega la IP del socket al final de X-Forwarded-For', () => {
        expect(cadenaReenvio(undefined, '198.51.100.23')).toBe('198.51.100.23')
        expect(cadenaReenvio('1.2.3.4, 10.0.0.1', '2001:db8::1')).toBe('1.2.3.4, 10.0.0.1, 2001:db8::1')
        expect(cadenaReenvio(' , ', undefined)).toBeUndefined()
    })

    it('solo reenvía /api/v1/portal/** y conserva la query', () => {
        expect(destinoReenvio('/api/v1/portal/quien-soy?x=1', 'http://api:3333'))
            .toBe('http://api:3333/api/v1/portal/quien-soy?x=1')
        expect(destinoReenvio('/api/v1/clientes', 'http://api:3333')).toBeNull()
        expect(destinoReenvio('/api/v1/portalx', 'http://api:3333')).toBeNull()
    })
})

describe('reenvío de un nodo portal remoto', () => {
    const base = {
        token: '',
        proxiesConfiables: '',
        ipSocket: '198.51.100.23',
        protoSocket: 'http',
        xff: '203.0.113.1',
        xfProto: 'https',
        host: 'portal.example',
    }

    it('sin token, igual que siempre: X-Forwarded-For con el socket al final y sin cabeceras del nodo', () => {
        expect(cabecerasReenvio(base)).toEqual({
            'x-canal': 'portal',
            'x-forwarded-host': 'portal.example',
            'x-forwarded-proto': 'http',
            'x-forwarded-for': '203.0.113.1, 198.51.100.23',
        })
    })

    it('sin token, detrás de un proxy local confiable, su X-Forwarded-Proto llega a la API', () => {
        expect(cabecerasReenvio({ ...base, ipSocket: '10.0.0.5', proxiesConfiables: '10.0.0.0/8' })['x-forwarded-proto']).toBe('https')
        expect(cabecerasReenvio({ ...base, ipSocket: '10.0.0.5' })['x-forwarded-proto']).toBe('http')
    })

    it('con token, la IP del cliente sale del socket salvo detrás de un proxy local confiable', () => {
        expect(cabecerasReenvio({ ...base, token: 'argn_t' })).toEqual({
            'x-canal': 'portal',
            'x-forwarded-host': 'portal.example',
            'x-argos-nodo-token': 'argn_t',
            'x-argos-cliente-ip': '198.51.100.23',
            'x-argos-cliente-proto': 'http',
        })
        const trasCaddy = cabecerasReenvio({ ...base, token: 'argn_t', ipSocket: '::ffff:127.0.0.1', proxiesConfiables: '127.0.0.1' })
        expect(trasCaddy['x-argos-cliente-ip']).toBe('203.0.113.1')
        expect(trasCaddy['x-argos-cliente-proto']).toBe('https')
    })

    it('recorre la cadena desde la derecha y para en la primera IP no confiable (IPv6 incluida)', () => {
        expect(resolverIpCliente('10.0.0.2', '6.6.6.6, 2001:DB8::5, 10.0.0.1', '10.0.0.0/8')).toBe('2001:db8::5')
        expect(resolverIpCliente('10.0.0.2', 'basura', '10.0.0.0/8')).toBe('10.0.0.2')
        expect(() => resolverIpCliente('10.0.0.2', '1.1.1.1', '10.0.0.0/99')).toThrow(/inválida/)
    })

    it('el token solo viaja por HTTPS o a una API local', () => {
        expect(apiAdmiteToken('https://api.argosisp.example')).toBe(true)
        expect(apiAdmiteToken('http://127.0.0.1:3333')).toBe(true)
        expect(apiAdmiteToken('http://[::1]:3333')).toBe(true)
        expect(apiAdmiteToken('http://localhost:3333')).toBe(true)
        expect(apiAdmiteToken('http://api:3333')).toBe(false)
        expect(apiAdmiteToken('http://192.0.2.80')).toBe(false)
        expect(apiAdmiteToken('no es url')).toBe(false)
    })
})
