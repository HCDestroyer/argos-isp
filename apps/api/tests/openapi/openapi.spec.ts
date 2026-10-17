import { readFile } from 'node:fs/promises'
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import { construirOpenApi } from '#shared/openapi/documento'
import { registroRutas } from '#start/routes/index'
import { esPermiso } from '#core/permisos'

test.group('OpenAPI', () => {
    test('es determinista: dos generaciones dan el mismo resultado', async ({ assert }) => {
        assert.equal(await construirOpenApi(), await construirOpenApi())
    })

    test('packages/contracts/openapi.json está regenerado', async ({ assert }) => {
        const comprometido = await readFile(app.makePath('../../packages/contracts/openapi.json'), 'utf8')
        assert.equal(comprometido, await construirOpenApi(), 'Corre `pnpm contracts:build` y commitea')
    })

    test('conserva Me y Problem de la semilla, y los operationId del login', async ({ assert }) => {
        const doc = JSON.parse(await construirOpenApi())
        // la semilla se conserva; `csrf` (solo con la cookie del panel), `expira_en` y `expira_max_en`
        // (solo en GET /me) y los de multiempresa (`alcance_global`, `empresas`, `empresa_activa_id`)
        // son opcionales
        const {
            csrf,
            expira_en: expiraEn,
            expira_max_en: expiraMaxEn,
            alcance_global: alcanceGlobal,
            empresas,
            empresa_activa_id: empresaActivaId,
            ...propiedades
        } = doc.components.schemas.Me.properties
        assert.deepEqual(
            { ...doc.components.schemas.Me, properties: propiedades },
            {
                type: 'object',
                required: ['id', 'nombre', 'email', 'permisos', 'roles'],
                properties: {
                    id: { type: 'integer' },
                    nombre: { type: 'string' },
                    email: { type: 'string', format: 'email' },
                    roles: { type: 'array', items: { type: 'string' } },
                    permisos: { type: 'array', items: { type: 'string' } },
                },
            },
        )
        assert.equal(csrf.type, 'string')
        assert.deepEqual(expiraEn.type, ['string', 'null'])
        assert.deepEqual(expiraMaxEn.type, ['string', 'null'])
        assert.equal(alcanceGlobal.type, 'boolean')
        assert.equal(empresas.type, 'array')
        assert.deepEqual(empresaActivaId.type, ['integer', 'null'])
        assert.deepEqual(doc.components.schemas.Problem.required, ['type', 'title', 'status'])
        assert.equal(doc.paths['/api/v1/auth/login'].post.operationId, 'authLogin')
        assert.equal(doc.paths['/api/v1/me'].get.operationId, 'me')
    })

    test('cada ruta con sesión declara un permiso del catálogo; acciones explícitas, sin PATCH', ({
        assert,
    }) => {
        for (const ruta of registroRutas) {
            if ((ruta.seguridad ?? 'sesion') === 'sesion' && ruta.permiso !== null) {
                assert.isTrue(esPermiso(ruta.permiso), `${ruta.operacion}: ${ruta.permiso}`)
            }
            assert.notEqual(ruta.metodo as string, 'patch')
        }
    })

    test('incluye los recursos de la semana 1', async ({ assert }) => {
        const doc = JSON.parse(await construirOpenApi())
        assert.includeMembers(Object.keys(doc.paths), [
            '/api/v1/clientes',
            '/api/v1/clientes/{id}/estado-cuenta',
            '/api/v1/servicios/{id}/suspender',
            '/api/v1/servicios/{id}/quitar-limite',
            '/api/v1/routers/{id}/redes-ipv4',
            '/api/v1/ipv6-bloques/{id}/pools',
            '/api/v1/planes/{id}/routers/{routerId}',
            '/api/v1/plantillas-facturacion',
            '/api/v1/facturas/generar',
            '/api/v1/facturas/{id}/anular',
            '/api/v1/pagos/{id}/anular',
            '/api/v1/cajas/{id}/cerrar',
            '/api/v1/promesas/{id}/aprobar',
            '/api/v1/sesiones',
            '/api/v1/bitacora/acciones',
            '/api/v1/libro/mayor',
            '/api/v1/tokens',
            '/api/v1/ip/{ip}',
            '/api/v1/internal/aaa/servicio',
            '/api/v1/portal/quien-soy',
        ])
    })
})
