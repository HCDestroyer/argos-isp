import { test } from '@japa/runner'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { olvidarChangelog, seccionDeVersion, VERSION_DESARROLLO } from '#monitoreo/version'
import { estado, usuarioConRoles } from '#tests/ayudas'

/** CHANGELOG con el formato de release-please (`release-please-config.json`). */
const CHANGELOG = `# Cambios

## [1.3.0](https://github.com/HCDestroyer/argos-isp/compare/v1.2.1...v1.3.0) (2026-11-02)


### Funcionalidades

* **billing:** promesas de pago parciales ([abc1234](https://github.com/x))

## [1.2.1](https://github.com/HCDestroyer/argos-isp/compare/v1.2.0...v1.2.1) (2026-10-30)


### Correcciones

* **aaa:** reintento al caer Redis ([def5678](https://github.com/x))

## [1.2.0](https://github.com/HCDestroyer/argos-isp/compare/v1.1.0...v1.2.0) (2026-10-28)
`

const VARIABLES = ['ARGOSISP_VERSION', 'ARGOSISP_COMMIT', 'ARGOSISP_COMPILADA', 'ARGOSISP_CHANGELOG'] as const

test.group('monitoreo · seccionDeVersion', () => {
    test('devuelve solo la sección de la versión pedida', ({ assert }) => {
        const seccion = seccionDeVersion(CHANGELOG, '1.2.1')
        assert.equal(
            seccion,
            '### Correcciones\n\n* **aaa:** reintento al caer Redis ([def5678](https://github.com/x))',
        )
    })

    test('la primera sección termina en la siguiente versión', ({ assert }) => {
        const seccion = seccionDeVersion(CHANGELOG, '1.3.0')!
        assert.include(seccion, 'promesas de pago parciales')
        assert.notInclude(seccion, 'Correcciones')
    })

    test('no confunde 1.2.0 con 1.2.0x ni con 11.2.0; sección vacía o ausente = null', ({ assert }) => {
        assert.isNull(seccionDeVersion(CHANGELOG, '1.2.0'))
        assert.isNull(seccionDeVersion(CHANGELOG, '2.0.0'))
        assert.isNull(seccionDeVersion('## 11.2.0\n\nalgo\n', '1.2.0'))
        assert.equal(seccionDeVersion('## v1.2.0\n\nalgo\n', '1.2.0'), 'algo')
    })
})

test.group('monitoreo · GET /api/v1/version', (group) => {
    let previas: Partial<Record<(typeof VARIABLES)[number], string>> = {}
    let carpeta = ''

    group.each.setup(async () => {
        previas = Object.fromEntries(VARIABLES.map((v) => [v, process.env[v]]))
        carpeta = await mkdtemp(join(tmpdir(), 'argosisp-version-'))
        await writeFile(join(carpeta, 'CHANGELOG.md'), CHANGELOG)
        process.env.ARGOSISP_CHANGELOG = join(carpeta, 'CHANGELOG.md')
        olvidarChangelog()
        return async () => {
            for (const v of VARIABLES) {
                if (previas[v] === undefined) delete process.env[v]
                else process.env[v] = previas[v]
            }
            olvidarChangelog()
            await rm(carpeta, { recursive: true, force: true })
        }
    })

    test('sin sesión responde 401', async ({ client }) => {
        await estado(client.get('/api/v1/version'), 401)
    })

    test('imagen publicada: versión, commit, notas y la sección del CHANGELOG', async ({
        client,
        assert,
    }) => {
        process.env.ARGOSISP_VERSION = '1.2.1'
        process.env.ARGOSISP_COMMIT = '0123456789abcdef'
        process.env.ARGOSISP_COMPILADA = '2026-10-30T12:00:00Z'
        const { token } = await usuarioConRoles(['lectura'])
        const respuesta = await estado(client.get('/api/v1/version').bearerToken(token), 200)
        assert.deepEqual(respuesta.body(), {
            version: '1.2.1',
            commit: '0123456789abcdef',
            compilada: '2026-10-30T12:00:00Z',
            notas_url: 'https://github.com/HCDestroyer/argos-isp/releases/tag/v1.2.1',
            cambios:
                '### Correcciones\n\n* **aaa:** reintento al caer Redis ([def5678](https://github.com/x))',
        })
    })

    test('fuera de una imagen: desarrollo, sin notas ni cambios', async ({ client, assert }) => {
        delete process.env.ARGOSISP_VERSION
        delete process.env.ARGOSISP_COMMIT
        delete process.env.ARGOSISP_COMPILADA
        const { token } = await usuarioConRoles(['lectura'])
        const respuesta = await estado(client.get('/api/v1/version').bearerToken(token), 200)
        assert.deepEqual(respuesta.body(), {
            version: VERSION_DESARROLLO,
            commit: null,
            compilada: null,
            notas_url: null,
            cambios: null,
        })
    })
})
