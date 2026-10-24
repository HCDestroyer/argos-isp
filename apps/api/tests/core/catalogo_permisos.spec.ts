import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { construirOpenApi } from '#shared/openapi/documento'
import { estado, usuarioConRoles } from '#tests/ayudas'
import { NOMBRES_PERMISOS, PERMISOS, ROLES_BASE } from '#core/permisos'

/**
 * Catálogo de permisos y roles base en el OpenAPI y por la API (pedido de A4): el panel deriva sus
 * fixtures de aquí, sin copiar `permisos.ts` a mano.
 */

async function esquemas(): Promise<Record<string, any>> {
    return JSON.parse(await construirOpenApi()).components.schemas
}

test.group('Catálogo de permisos', () => {
    test('NombrePermiso: enum con todos los permisos y su descripción alineada', async ({ assert }) => {
        const { NombrePermiso, Permiso, RolBase, AlcancesToken } = await esquemas()
        assert.deepEqual(NombrePermiso.enum, NOMBRES_PERMISOS)
        assert.deepEqual(
            NombrePermiso['x-enum-descriptions'],
            NOMBRES_PERMISOS.map((p) => PERMISOS[p]),
        )
        assert.equal(Permiso.properties.nombre.$ref, '#/components/schemas/NombrePermiso')
        assert.equal(AlcancesToken.properties.permisos.items.$ref, '#/components/schemas/NombrePermiso')
        // los roles base viajan en el esquema
        const base = RolBase['x-roles-base'] as Array<{ nombre: string; permisos: string[] }>
        assert.sameMembers(
            base.map((r) => r.nombre),
            Object.keys(ROLES_BASE),
        )
        for (const rol of base) {
            assert.sameMembers(rol.permisos, [...ROLES_BASE[rol.nombre]!.permisos])
        }
    })

    test('GET /permisos trae el catálogo completo con descripciones (sin los retirados)', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        await db.rawQuery(
            `INSERT INTO core.permisos (nombre, descripcion) VALUES ('retirado.prueba', 'Ya no existe') ON CONFLICT (nombre) DO NOTHING`,
        )
        const respuesta = await estado(client.get('/api/v1/permisos').bearerToken(token), 200)
        const lista = respuesta.body() as Array<{ nombre: string; descripcion: string }>
        assert.sameMembers(
            lista.map((p) => p.nombre),
            NOMBRES_PERMISOS,
        )
        for (const permiso of lista) {
            assert.equal(permiso.descripcion, PERMISOS[permiso.nombre as keyof typeof PERMISOS])
        }
        await db.from('core.permisos').where('nombre', 'retirado.prueba').delete()
    })

    test('GET /roles/base: los seis roles con sus permisos; con roles.ver', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['admin'])
        const respuesta = await estado(client.get('/api/v1/roles/base').bearerToken(token), 200)
        const roles = respuesta.body() as Array<{ nombre: string; descripcion: string; permisos: string[] }>
        assert.sameMembers(
            roles.map((r) => r.nombre),
            Object.keys(ROLES_BASE),
        )
        const cajero = roles.find((r) => r.nombre === 'cajero')!
        assert.sameMembers(cajero.permisos, [...ROLES_BASE.cajero!.permisos])
        assert.notInclude(cajero.permisos, 'servicios.suspender')

        const sinPermiso = await usuarioConRoles(['cajero'])
        await estado(client.get('/api/v1/roles/base').bearerToken(sinPermiso.token), 403)
    })
})
