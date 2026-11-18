import { test } from '@japa/runner'
import { createHash, randomBytes } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'
import { estado, soloEmpresaPrincipal, usuarioConRoles } from '#tests/ayudas'

/**
 * Contrato Iris 0.8.0, parte de A1 (`.claude/integration/revision-iris-080.md`, puntos 24, 25 y 28):
 * - canje: el receptor de Iris en el host de `base_url` y, con el botón, `base_url` = el origen
 *   aprobado; si no, 422 `webhook_invalido` y el código queda gastado;
 * - el botón (§1.4) enciende el conector al confirmar el canje; el enlace (§1.3) y la reconexión no;
 * - `PUT /integraciones/iris/sincronizacion`: idempotente, 409 `sincronizacion_vieja`.
 */

const BASE = '/api/v1/integraciones/iris'
const IRIS = 'https://iris.isp.example'
const ARGOS = 'https://api.argos.isp.example'
const TIPO = 'urn:argosisp:problema:'

function canje(codigo: string, extra: Record<string, unknown> = {}) {
    return {
        codigo,
        sistema: 'iris',
        base_url: IRIS,
        token: `iris_pat_${'Qa1Ws2Ed'.repeat(5)}`,
        webhook: {
            url: `${IRIS}/api/v1/integraciones/argosisp/webhook/c-1`,
            secreto: 'secreto-del-receptor-de-iris-0123456789',
        },
        contrato: '0.7.1',
        receptor_argos: true,
        ...extra,
    }
}

async function limpiarIris() {
    await db.from('integraciones.iris_enlaces').delete()
    await db.from('integraciones.iris_conector').delete()
}

async function codigoEnlace(client: any, admin: string): Promise<string> {
    const r = await estado(client.post(`${BASE}/enlace`).bearerToken(admin), 201)
    return (r.body().enlace as string).split('#')[1]!
}

/** «Conectar con un botón»: el admin aprueba y Argos devuelve el código con su verifier. */
async function codigoBoton(client: any, admin: string): Promise<{ codigo: string; verifier: string }> {
    const verifier = randomBytes(32).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    const r = await estado(
        client
            .post(`${BASE}/autorizar`)
            .bearerToken(admin)
            .json({
                iris: IRIS,
                state: randomBytes(32).toString('base64url'),
                code_challenge: challenge,
                code_challenge_method: 'S256',
                confirmar_origen: 'iris.isp.example',
            }),
        200,
    )
    const fragmento = new URLSearchParams((r.body().redirigir_a as string).split('#')[1])
    return { codigo: fragmento.get('codigo')!, verifier }
}

async function filaConector() {
    return db.from('integraciones.iris_conector').where('id', 1).first()
}

/** Una columna del conector. */
async function columna(nombre: string): Promise<any> {
    const fila = await filaConector()
    return fila[nombre]
}

async function cuerpoDe(peticion: PromiseLike<any>, status: number): Promise<Record<string, any>> {
    const r = await estado(peticion, status)
    return r.body() as Record<string, any>
}

/** Primera llamada autenticada del `atk_` (confirma el canje). */
async function confirmar(client: any, atk: string) {
    await estado(client.put(`${BASE}/contrato`).bearerToken(atk).json({ contrato: '0.7.1' }), 200)
}

test.group('Iris 0.8.0 · canje: host del receptor y origen aprobado', (group) => {
    group.each.setup(async () => {
        process.env.API_PUBLIC_URL = ARGOS
        await limpiarIris()
        return async () => {
            await limpiarIris()
            delete process.env.API_PUBLIC_URL
            await soloEmpresaPrincipal()
        }
    })

    test('receptor en otro host: 422 webhook_invalido (mismo_host) y el código queda gastado', async ({
        client,
        assert,
    }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        const codigo = await codigoEnlace(client, admin)
        const r = await estado(
            client.post(`${BASE}/conexion/canjear`).json(
                canje(codigo, {
                    webhook: {
                        url: 'https://receptor.otro.example/api/v1/integraciones/argosisp/webhook/c-1',
                        secreto: 'secreto-del-receptor-de-iris-0123456789',
                    },
                }),
            ),
            422,
        )
        assert.equal(r.body().type, `${TIPO}webhook_invalido`)
        assert.include(r.body().errors[0], { field: 'webhook.url', rule: 'mismo_host' })
        const enlace = await db.from('integraciones.iris_enlaces').firstOrFail()
        assert.isNotNull(enlace.rechazado_en)
        assert.isNull(enlace.usado_en)
        assert.isNull(await filaConector())

        // gastado: ni con los datos correctos
        const otra = await estado(client.post(`${BASE}/conexion/canjear`).json(canje(codigo)), 410)
        assert.equal(otra.body().type, `${TIPO}enlace_vencido`)
    })

    test('mismo host con otro puerto o con /api/v1 en base_url: el canje pasa', async ({
        client,
        assert,
    }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        const codigo = await codigoEnlace(client, admin)
        await estado(
            client.post(`${BASE}/conexion/canjear`).json(
                canje(codigo, {
                    base_url: `${IRIS}/api/v1`,
                    webhook: {
                        url: 'https://IRIS.isp.example:8443/hooks/argos',
                        secreto: 'secreto-del-receptor-de-iris-0123456789',
                    },
                }),
            ),
            200,
        )
        const fila = await filaConector()
        assert.equal(fila.url_base, IRIS)
    })

    test('error de formato (422 validacion) no gasta el código', async ({ client, assert }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        const codigo = await codigoEnlace(client, admin)
        const r = await estado(
            client.post(`${BASE}/conexion/canjear`).json(
                canje(codigo, {
                    webhook: { url: 'ftp://receptor.otro.example/x', secreto: 'corto' },
                }),
            ),
            422,
        )
        assert.equal(r.body().type, `${TIPO}validacion`)
        const enlace = await db.from('integraciones.iris_enlaces').firstOrFail()
        assert.isNull(enlace.rechazado_en)
        await estado(client.post(`${BASE}/conexion/canjear`).json(canje(codigo)), 200)
    })

    test('botón: base_url distinto del origen aprobado → 422 origen_aprobado y código gastado', async ({
        client,
        assert,
    }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        const { codigo, verifier } = await codigoBoton(client, admin)
        const OTRO = 'https://iris-falso.example'
        const r = await estado(
            client.post(`${BASE}/conexion/canjear`).json(
                canje(codigo, {
                    code_verifier: verifier,
                    base_url: OTRO,
                    webhook: {
                        url: `${OTRO}/api/v1/integraciones/argosisp/webhook/c-1`,
                        secreto: 'secreto-del-receptor-de-iris-0123456789',
                    },
                }),
            ),
            422,
        )
        assert.equal(r.body().type, `${TIPO}webhook_invalido`)
        assert.include(r.body().errors[0], { field: 'base_url', rule: 'origen_aprobado' })
        assert.isNull(await filaConector())
        await estado(
            client.post(`${BASE}/conexion/canjear`).json(canje(codigo, { code_verifier: verifier })),
            410,
        )
    })

    test('el enlace (§1.3) no tiene origen aprobado: otro origen de Iris pasa', async ({ client }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        const codigo = await codigoEnlace(client, admin)
        const OTRO = 'https://iris2.isp.example'
        await estado(
            client.post(`${BASE}/conexion/canjear`).json(
                canje(codigo, {
                    base_url: OTRO,
                    webhook: { url: `${OTRO}/hook`, secreto: 'secreto-del-receptor-de-iris-0123456789' },
                }),
            ),
            200,
        )
    })
})

test.group('Iris 0.8.0 · el botón enciende al confirmar', (group) => {
    group.each.setup(async () => {
        process.env.API_PUBLIC_URL = ARGOS
        await limpiarIris()
        return async () => {
            await limpiarIris()
            delete process.env.API_PUBLIC_URL
            await soloEmpresaPrincipal()
        }
    })

    test('botón: apagado al canjear, encendido en la primera llamada del atk_ (auditado)', async ({
        client,
        assert,
    }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        const { codigo, verifier } = await codigoBoton(client, admin)
        const c = await estado(
            client.post(`${BASE}/conexion/canjear`).json(canje(codigo, { code_verifier: verifier })),
            200,
        )
        let fila = await filaConector()
        assert.isFalse(fila.activo)
        assert.isTrue(fila.encender_al_confirmar)

        await confirmar(client, c.body().token)
        fila = await filaConector()
        assert.isTrue(fila.activo)
        assert.isFalse(fila.encender_al_confirmar)
        assert.isNotNull(fila.canje_confirmado_en)
        const vista = await estado(client.get(BASE).bearerToken(admin), 200)
        assert.isTrue(vista.body().activo)
        assert.equal(vista.body().estado_canje, 'confirmado')

        const accion = await db
            .from('audit.acciones')
            .where('accion', 'iris.confirmar_canje')
            .orderBy('id', 'desc')
            .firstOrFail()
        assert.equal(accion.resultado, 'ok')
        const cambio = await db
            .from('audit.cambios')
            .where('entidad_tipo', 'conector_iris')
            .where('campo', 'activo')
            .orderBy('id', 'desc')
            .firstOrFail()
        assert.equal(cambio.request_id, accion.request_id)
        assert.deepEqual([cambio.antes, cambio.despues], [false, true])
    })

    test('enlace (§1.3): confirmar no lo enciende', async ({ client, assert }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        const codigo = await codigoEnlace(client, admin)
        const c = await estado(client.post(`${BASE}/conexion/canjear`).json(canje(codigo)), 200)
        assert.isFalse(await columna('encender_al_confirmar'))
        await confirmar(client, c.body().token)
        const fila = await filaConector()
        assert.isFalse(fila.activo)
        assert.isNotNull(fila.canje_confirmado_en)
    })

    test('reconexión con el botón: activo no cambia', async ({ client, assert }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        const c1 = await estado(
            client.post(`${BASE}/conexion/canjear`).json(canje(await codigoEnlace(client, admin))),
            200,
        )
        await confirmar(client, c1.body().token)
        assert.isFalse(await columna('activo'))

        const { codigo, verifier } = await codigoBoton(client, admin)
        const c2 = await estado(
            client.post(`${BASE}/conexion/canjear`).json(canje(codigo, { code_verifier: verifier })),
            200,
        )
        let fila = await filaConector()
        assert.isNotNull(fila.pendiente_token_argos_id)
        assert.isFalse(fila.encender_al_confirmar)
        await confirmar(client, c2.body().token)
        fila = await filaConector()
        assert.isNull(fila.pendiente_token_argos_id)
        assert.isFalse(fila.activo)
    })

    test('el admin apaga antes de la confirmación: confirmar ya no lo enciende', async ({
        client,
        assert,
    }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        const { codigo, verifier } = await codigoBoton(client, admin)
        const c = await estado(
            client.post(`${BASE}/conexion/canjear`).json(canje(codigo, { code_verifier: verifier })),
            200,
        )
        const version = Number(await columna('version'))
        await estado(client.put(BASE).bearerToken(admin).json({ version, activo: false }), 200)
        await confirmar(client, c.body().token)
        assert.isFalse(await columna('activo'))
    })
})

/** UUID v7 con el instante `ms` (los primeros 48 bits). */
function uuidV7(ms: number, sufijo = randomBytes(8).toString('hex')): string {
    const t = ms.toString(16).padStart(12, '0')
    return `${t.slice(0, 8)}-${t.slice(8, 12)}-7${sufijo.slice(0, 3)}-8${sufijo.slice(3, 6)}-${sufijo.slice(6, 16).padEnd(12, '0')}`
}

function avance(id: string, actualizada: string, extra: Record<string, unknown> = {}) {
    return {
        sincronizacion_id: id,
        estado: 'en_curso',
        iniciada_en: '2026-11-18T15:00:00.000Z',
        actualizada_en: actualizada,
        etapas: [
            {
                recurso: 'empresas',
                estado: 'completa',
                procesados: 2,
                total: 2,
                error: null,
                terminada_en: '2026-11-18T15:00:05.000Z',
            },
            {
                recurso: 'clientes',
                estado: 'en_curso',
                procesados: 1200,
                total: null,
                error: null,
                terminada_en: null,
            },
        ],
        ...extra,
    }
}

test.group('Iris 0.8.0 · PUT /integraciones/iris/sincronizacion', (group) => {
    group.each.setup(async () => {
        process.env.API_PUBLIC_URL = ARGOS
        await limpiarIris()
        return async () => {
            await limpiarIris()
            delete process.env.API_PUBLIC_URL
            await soloEmpresaPrincipal()
        }
    })

    async function conectar(client: any) {
        const { token: admin } = await usuarioConRoles(['admin'])
        const c = await estado(
            client.post(`${BASE}/conexion/canjear`).json(canje(await codigoEnlace(client, admin))),
            200,
        )
        return { admin, atk: c.body().token as string }
    }

    const put = (client: any, token: string, cuerpo: Record<string, unknown>) =>
        client.put(`${BASE}/sincronizacion`).bearerToken(token).json(cuerpo)

    test('solo el atk_ de Iris; guarda y sale en GET /integraciones/iris, con el conector apagado', async ({
        client,
        assert,
    }) => {
        const { admin, atk } = await conectar(client)
        const inicial = await cuerpoDe(client.get(BASE).bearerToken(admin), 200)
        assert.isNull(inicial.sincronizacion)

        const id = uuidV7(Date.now())
        await estado(put(client, admin, avance(id, '2026-11-18T15:01:00.000Z')), 403)

        const r = await estado(put(client, atk, avance(id.toUpperCase(), '2026-11-18T15:01:00Z')), 200)
        assert.deepEqual(r.body(), {
            sincronizacion_id: id,
            estado: 'en_curso',
            actualizada_en: '2026-11-18T15:01:00.000Z',
        })
        const vista = await cuerpoDe(client.get(BASE).bearerToken(admin), 200)
        assert.isFalse(vista.activo)
        assert.equal(vista.sincronizacion.sincronizacion_id, id)
        assert.equal(vista.sincronizacion.iniciada_en, '2026-11-18T15:00:00.000Z')
        assert.lengthOf(vista.sincronizacion.etapas, 2)
        assert.deepEqual(vista.sincronizacion.etapas[1], {
            recurso: 'clientes',
            estado: 'en_curso',
            procesados: 1200,
            total: null,
            error: null,
            terminada_en: null,
        })
        assert.isString(vista.sincronizacion.recibida_en)

        const accion = await db
            .from('audit.acciones')
            .where('accion', 'iris.informar_sincronizacion')
            .orderBy('id', 'desc')
            .firstOrFail()
        assert.equal(accion.resultado, 'ok')
    })

    test('idempotente: mismo id y actualizada_en responde lo guardado sin escribir', async ({
        client,
        assert,
    }) => {
        const { atk } = await conectar(client)
        const id = uuidV7(Date.now())
        await estado(put(client, atk, avance(id, '2026-11-18T15:01:00.000Z')), 200)
        const version = Number(await columna('version'))
        const r = await estado(
            put(client, atk, avance(id, '2026-11-18T15:01:00.000Z', { estado: 'completa' })),
            200,
        )
        assert.equal(r.body().estado, 'en_curso')
        assert.equal(Number(await columna('version')), version)
    })

    test('409 sincronizacion_vieja: actualizada_en menor o sincronizacion_id más vieja', async ({
        client,
        assert,
    }) => {
        const { atk } = await conectar(client)
        const ahora = Date.now()
        const id = uuidV7(ahora)
        await estado(put(client, atk, avance(id, '2026-11-18T15:05:00.000Z')), 200)

        const vieja = await estado(put(client, atk, avance(id, '2026-11-18T15:04:59.000Z')), 409)
        assert.equal(vieja.body().type, `${TIPO}sincronizacion_vieja`)

        // avance posterior de la misma sincronización
        const r = await estado(
            put(client, atk, avance(id, '2026-11-18T15:06:00.000Z', { estado: 'con_errores' })),
            200,
        )
        assert.equal(r.body().estado, 'con_errores')

        // una sincronización anterior (UUID v7 de antes)
        const anterior = await estado(
            put(client, atk, avance(uuidV7(ahora - 60_000), '2026-11-18T16:00:00.000Z')),
            409,
        )
        assert.equal(anterior.body().type, `${TIPO}sincronizacion_vieja`)

        // una nueva la reemplaza aunque su actualizada_en sea menor
        const nueva = uuidV7(ahora + 60_000)
        await estado(put(client, atk, avance(nueva, '2026-11-18T15:00:30.000Z')), 200)
        const fila = await filaConector()
        assert.equal(fila.sincronizacion.sincronizacion_id, nueva)
        assert.equal(fila.sincronizacion.estado, 'en_curso')
    })

    test('422: id que no es UUID v7, estado o recurso desconocido, error de más de 300', async ({
        client,
        assert,
    }) => {
        const { atk } = await conectar(client)
        const id = uuidV7(Date.now())
        const casos: Array<[Record<string, unknown>, string]> = [
            [avance('3f1c2b8e-0d6a-4c1e-9f7a-2b3c4d5e6f70', '2026-11-18T15:01:00Z'), 'sincronizacion_id'],
            [avance(id, '2026-11-18T15:01:00Z', { estado: 'completo' }), 'estado'],
            [
                avance(id, '2026-11-18T15:01:00Z', {
                    etapas: [
                        {
                            recurso: 'facturas',
                            estado: 'pendiente',
                            procesados: 0,
                            total: null,
                            error: null,
                            terminada_en: null,
                        },
                    ],
                }),
                'etapas.0.recurso',
            ],
            [
                avance(id, '2026-11-18T15:01:00Z', {
                    etapas: [
                        {
                            recurso: 'clientes',
                            estado: 'con_errores',
                            procesados: 0,
                            total: null,
                            error: 'x'.repeat(301),
                            terminada_en: null,
                        },
                    ],
                }),
                'etapas.0.error',
            ],
        ]
        for (const [cuerpo, campo] of casos) {
            const r = await estado(put(client, atk, cuerpo), 422)
            assert.include(
                r.body().errors.map((e: { field: string }) => e.field),
                campo,
                campo,
            )
        }
        assert.isNull(await columna('sincronizacion'))
    })
})
