import { test } from '@japa/runner'
import vine from '@vinejs/vine'
import { generarOpenApi } from '#shared/openapi/generador'
import { definirRuta, type Ruta } from '#shared/rutas'

/**
 * `DefinicionRuta` (semana 2, pedidos de A5): cuerpo `multipart/form-data`, respuestas binarias
 * y seguridad `portal` (cookie) con su 401.
 */

const INFO = { titulo: 'prueba', version: '0', descripcion: 'prueba' }
const objeto = { type: 'object', properties: { ok: { type: 'boolean' } } }

function generar(rutas: Ruta[]) {
    return generarOpenApi(rutas, INFO) as any
}

test.group('OpenAPI · generador', () => {
    test('multipart: campos del validador más archivos binarios obligatorios u opcionales', ({ assert }) => {
        const doc = generar([
            definirRuta({
                metodo: 'post',
                ruta: '/comprobantes',
                operacion: 'subir',
                resumen: 'Subir',
                etiqueta: 'x',
                seguridad: 'portal',
                permiso: null,
                cuerpo: vine.compile(
                    vine.object({ referencia: vine.string(), nota: vine.string().optional() }),
                ),
                multipart: {
                    archivos: { archivo: 'Foto o PDF', extra: 'Opcional' },
                    archivosOpcionales: ['extra'],
                },
                respuesta: { status: 201, descripcion: 'ok', esquema: objeto },
                handler: async () => ({}),
            }),
        ])
        const cuerpo = doc.paths['/api/v1/comprobantes'].post.requestBody
        assert.deepEqual(Object.keys(cuerpo.content), ['multipart/form-data'])
        const schema = cuerpo.content['multipart/form-data'].schema
        assert.equal(schema.type, 'object')
        assert.deepEqual(schema.properties.archivo, {
            type: 'string',
            format: 'binary',
            description: 'Foto o PDF',
        })
        assert.equal(schema.properties.referencia.type, 'string')
        assert.sameMembers(schema.required, ['referencia', 'archivo'])
    })

    test('respuesta binaria: application/pdf con format binary y sin schema JSON', ({ assert }) => {
        const doc = generar([
            definirRuta({
                metodo: 'get',
                ruta: '/facturas/:id/pdf',
                operacion: 'pdf',
                resumen: 'PDF',
                etiqueta: 'x',
                permiso: null,
                respuesta: { status: 200, descripcion: 'PDF', contenido: 'application/pdf' },
                handler: async () => ({}),
            }),
        ])
        const r = doc.paths['/api/v1/facturas/{id}/pdf'].get.responses['200']
        assert.deepEqual(r.content, { 'application/pdf': { schema: { type: 'string', format: 'binary' } } })
    })

    test('seguridad portal: esquema apiKey en cookie argos_portal y 401', ({ assert }) => {
        const doc = generar([
            definirRuta({
                metodo: 'get',
                ruta: '/portal/estado',
                operacion: 'estado',
                resumen: 'Estado',
                etiqueta: 'portal',
                seguridad: 'portal',
                permiso: null,
                respuesta: { status: 200, descripcion: 'ok', esquema: objeto },
                handler: async () => ({}),
            }),
        ])
        assert.deepEqual(doc.components.securitySchemes.portal, {
            type: 'apiKey',
            in: 'cookie',
            name: 'argos_portal',
            description: 'Sesión del portal del cliente (cookie httpOnly que deja el acceso por código)',
        })
        const op = doc.paths['/api/v1/portal/estado'].get
        assert.deepEqual(op.security, [{ portal: [] }])
        assert.property(op.responses, '401')
        assert.notProperty(op.responses, '403')
    })

    test('errores de registro: respuesta binaria con schema, multipart sin validador, JSON sin schema', ({
        assert,
    }) => {
        const base = {
            metodo: 'post',
            ruta: '/x',
            operacion: 'x',
            resumen: 'x',
            etiqueta: 'x',
            permiso: null,
        } as const
        assert.throws(
            () =>
                generar([
                    definirRuta({
                        ...base,
                        respuesta: {
                            status: 200,
                            descripcion: 'x',
                            contenido: 'application/pdf',
                            esquema: objeto,
                        },
                    }),
                ]),
            /binaria no lleva schema/,
        )
        assert.throws(
            () =>
                generar([
                    definirRuta({
                        ...base,
                        multipart: { archivos: { a: 'a' } },
                        respuesta: { status: 200, descripcion: 'x', esquema: objeto },
                    }),
                ]),
            /multipart necesita/,
        )
        assert.throws(
            () => generar([definirRuta({ ...base, respuesta: { status: 200, descripcion: 'x' } })]),
            /falta el schema/,
        )
    })
})
