import { test } from '@japa/runner'
import { spawnSync } from 'node:child_process'
import { validarClaveAaaPpp } from '#shared/clave_aaa_ppp'

/** `AAA_PPP_KEY` es obligatoria para la API: sin ella no arranca (`start/env.ts`, Iris 0.3.1). */

test.group('Iris 0.3.1 · AAA_PPP_KEY obligatoria', () => {
    test('validarClaveAaaPpp: falta o no tiene 32 bytes → error claro; válida → la misma', ({ assert }) => {
        assert.throws(
            () => validarClaveAaaPpp('AAA_PPP_KEY', undefined),
            /Falta la variable de entorno AAA_PPP_KEY/,
        )
        assert.throws(() => validarClaveAaaPpp('AAA_PPP_KEY', ''), /Falta la variable de entorno AAA_PPP_KEY/)
        assert.throws(() => validarClaveAaaPpp('AAA_PPP_KEY', 'corta'), /32 bytes en base64/)
        const clave = Buffer.alloc(32, 7).toString('base64')
        assert.equal(validarClaveAaaPpp('AAA_PPP_KEY', clave), clave)
    })

    test('la API no arranca sin AAA_PPP_KEY y lo dice', ({ assert }) => {
        // `AAA_PPP_KEY=''` en el proceso gana a cualquier .env; NODE_ENV=development no carga .env.test
        const r = spawnSync(process.execPath, ['ace', 'openapi:generate', '--verificar'], {
            cwd: new URL('../../', import.meta.url),
            env: { ...process.env, NODE_ENV: 'development', AAA_PPP_KEY: '' },
            encoding: 'utf8',
            timeout: 60_000,
        })
        assert.notEqual(r.status, 0)
        assert.include(
            `${r.stdout}${r.stderr}`.replace(/\s+/g, ' '),
            'Falta la variable de entorno AAA_PPP_KEY',
        )
    }).timeout(70_000)
})
