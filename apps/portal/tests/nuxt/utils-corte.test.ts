import { describe, expect, it } from 'vitest'
import { QUIEN_SOY_ACTIVO, QUIEN_SOY_DESCONOCIDO, QUIEN_SOY_SUSPENDIDO } from '~~/fixtures/corte'
import { cadenaReenvio, destinoReenvio } from '~~/server/utils/reenvioApi'

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
