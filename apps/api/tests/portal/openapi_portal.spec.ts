import { test } from '@japa/runner'
import { construirOpenApi } from '#shared/openapi/documento'
import { registroRutas } from '#start/routes/index'

/**
 * Cómo declara el OpenAPI las rutas del portal: sesión del portal (cookie `argos_portal`) con su
 * 401, PDF como `application/pdf` y el comprobante como `multipart/form-data` con el archivo.
 */

/** Rutas que solo funcionan con la sesión del portal. Las de "IP o sesión" siguen públicas. */
const SOLO_SESION = [
    'portalSalir',
    'portalCuenta',
    'portalFacturas',
    'portalFactura',
    'portalPagos',
    'portalPromesas',
    'portalEditarContacto',
    'portalTelegram',
    'portalVincularTelegram',
    'portalDesvincularTelegram',
    'portalFacturaPdf',
    'portalFacturaXml',
    'portalNotasCredito',
    'portalNotaCreditoXml',
    'portalNotaCreditoPdf',
    'portalComprobantes',
    // lealtad fase 3 (A3): sorteos de las empresas del cliente
    'portalSorteos',
]

type Operacion = {
    operationId: string
    security?: Array<Record<string, string[]>>
    responses: Record<string, { content?: Record<string, { schema: Record<string, unknown> }> }>
    requestBody?: { content: Record<string, { schema: Record<string, any> }> }
}

async function operaciones(): Promise<Map<string, Operacion>> {
    const doc = JSON.parse(await construirOpenApi())
    const mapa = new Map<string, Operacion>()
    for (const metodos of Object.values(doc.paths) as Array<Record<string, Operacion>>) {
        for (const op of Object.values(metodos)) mapa.set(op.operationId, op)
    }
    return mapa
}

test.group('Portal: OpenAPI', () => {
    test('las rutas de la sesión declaran seguridad portal y 401; las de IP siguen sin seguridad', async ({
        assert,
    }) => {
        const ops = await operaciones()
        for (const id of SOLO_SESION) {
            const op = ops.get(id)!
            assert.deepEqual(op.security, [{ portal: [] }], id)
            assert.property(op.responses, '401', id)
        }
        const portal = registroRutas.filter((r) => r.ruta.startsWith('/portal/'))
        for (const ruta of portal) {
            const esperada = SOLO_SESION.includes(ruta.operacion) ? 'portal' : 'publico'
            assert.equal(ruta.seguridad, esperada, ruta.operacion)
            assert.isTrue(ruta.limitada, ruta.operacion)
        }
        for (const id of ['portalQuienSoy', 'portalSolicitarPromesa', 'portalSubirComprobante']) {
            assert.isUndefined(ops.get(id)!.security, id)
        }
    })

    test('los PDF se declaran application/pdf binario', async ({ assert }) => {
        const ops = await operaciones()
        for (const id of ['portalFacturaPdf', 'documentosAvisoCobroPdf', 'documentosPlantillaVistaPrevia']) {
            assert.deepEqual(
                ops.get(id)!.responses['200']!.content,
                { 'application/pdf': { schema: { type: 'string', format: 'binary' } } },
                id,
            )
        }
    })

    test('el comprobante es multipart/form-data con el archivo obligatorio', async ({ assert }) => {
        const ops = await operaciones()
        const op = ops.get('portalSubirComprobante')!
        const cuerpo = op.requestBody!.content
        assert.deepEqual(Object.keys(cuerpo), ['multipart/form-data'])
        const schema = cuerpo['multipart/form-data']!.schema
        assert.include(schema.properties.archivo, { type: 'string', format: 'binary' })
        assert.includeMembers(schema.required, [
            'archivo',
            'metodo',
            'cuenta_bancaria_id',
            'referencia',
            'monto',
        ])
    })
})
