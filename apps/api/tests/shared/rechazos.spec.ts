import { test } from '@japa/runner'
import { contextoActual, reporteError } from '#tests/rechazos'

/**
 * tests/rechazos.ts: el reporte de un error sin manejar dice en qué prueba ocurrió y trae la pila
 * completa con su causa.
 */
test.group('pruebas · rastreo de rechazos sin manejar', () => {
    test('el contexto nombra la prueba en curso, su grupo y su archivo', ({ assert }) => {
        const contexto = contextoActual()
        assert.match(contexto, /^durante: /)
        assert.include(contexto, 'rechazos.spec.ts')
        assert.include(contexto, 'pruebas · rastreo de rechazos sin manejar')
        assert.include(contexto, 'el contexto nombra la prueba en curso')
    })

    test('el reporte trae la pila completa y la causa', ({ assert }) => {
        function profunda(n: number): Error {
            return n === 0 ? new TypeError('raíz') : profunda(n - 1)
        }
        const error = new Error('envoltorio', { cause: profunda(12) })
        const texto = reporteError('unhandledRejection', error)
        assert.include(texto, '[unhandledRejection]')
        assert.include(texto, 'durante: ')
        assert.include(texto, 'Error: envoltorio')
        assert.include(texto, 'TypeError: raíz')
        // la pila no se recorta a dos líneas: aparecen los marcos de la recursión
        assert.isAtLeast(texto.split('\n').filter((l) => l.includes('profunda')).length, 5)
    })
})
