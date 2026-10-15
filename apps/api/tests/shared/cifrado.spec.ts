import { test } from '@japa/runner'
import { claveDesdeTexto, cifrar, descifrar } from '#shared/cifrado'

/** Clave de `.env.test` y un valor cifrado con `services/aaa/src/cifrado.ts` (A2). */
const CLAVE = 'Y2xhdmUtZGUtcHJ1ZWJhcy1hYWEtcHBwLTMyYnl0ZXM='
const VECTOR_A2 = 'v1.BUBH1ADaemLO7bWj.LpeYiCSbr1m1P1N4RP254w.Mjo27VnKgY2Gf6etOLvViw'

test.group('Cifrado v1 (AES-256-GCM, AAA_PPP_KEY)', () => {
    test('descifra lo que cifra el servicio aaa', ({ assert }) => {
        assert.equal(descifrar(VECTOR_A2, claveDesdeTexto(CLAVE)), 'clave-ppp-ñ-123')
    })

    test('ida y vuelta con la clave del entorno; IV aleatorio', ({ assert }) => {
        const a = cifrar('secreto')
        const b = cifrar('secreto')
        assert.match(a, /^v1\.[\w-]{16}\.[\w-]{22}\.[\w-]+$/)
        assert.notEqual(a, b)
        assert.equal(descifrar(a), 'secreto')
        assert.equal(descifrar(a, claveDesdeTexto(CLAVE)), 'secreto')
    })

    test('rechaza datos alterados, otra clave o formato desconocido', ({ assert }) => {
        const valor = cifrar('secreto')
        // Altera un byte real de los datos cifrados. Cambiar los últimos caracteres del texto en
        // base64 a veces solo tocaba bits de relleno y el valor descifraba igual (prueba intermitente).
        const [version, iv, tag, datos] = valor.split('.') as [string, string, string, string]
        const bytes = Buffer.from(datos, 'base64url')
        bytes[0] = bytes[0]! ^ 0xff
        const alterado = [version, iv, tag, bytes.toString('base64url')].join('.')
        assert.throws(() => descifrar(alterado), /no se pudo descifrar/)
        assert.throws(() => descifrar(valor, Buffer.alloc(32, 1)), /no se pudo descifrar/)
        assert.throws(() => descifrar('texto-plano'), /formato/)
        assert.throws(() => claveDesdeTexto('corta'), /32 bytes/)
    })
})
