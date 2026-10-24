import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import { meAdmin } from '~~/fixtures/auth/sesiones'
import { bd } from '~~/fixtures/bd'
import { UApp } from '#components'
import PaginaRoles from '~/pages/usuarios/roles.vue'
import PaginaTokens from '~/pages/usuarios/tokens.vue'
import PaginaUsuarios from '~/pages/usuarios/index.vue'
import { esperar } from '../ayudas/esperar'

/**
 * Usuarios, roles, permisos y tokens de API (tarea 9): esquemas espejo, composables contra los
 * fixtures (409, 422 de reglas de A1, el token una sola vez) y las tres pantallas.
 */

function conApp(componente: Parameters<typeof h>[0]) {
    return defineComponent({ render: () => h(UApp, null, { default: () => h(componente) }) })
}

describe('ACL · fixtures fieles al contrato', () => {
    it('el catálogo de permisos trae exactamente los nombres del enum del OpenAPI', () => {
        const spec = JSON.parse(readFileSync(resolve(process.cwd(), '../../packages/contracts/openapi.json'), 'utf8')) as {
            paths: Record<string, { post: { requestBody: { content: { 'application/json': { schema: { properties: { permisos: { items: { enum: string[] } } } } } } } } }>
        }
        const enumContrato = spec.paths['/api/v1/roles']!.post.requestBody.content['application/json'].schema.properties.permisos.items.enum
        expect(bd.roles.find(r => r.nombre === 'admin')?.permisos).toEqual([...enumContrato].sort())
    })
})

describe('ACL · esquemas', () => {
    it('usuario: contraseña obligatoria al crear y opcional al editar; alcance con su id', () => {
        const alta = esquemaUsuario(false).safeParse({ ...entradaUsuarioVacia(), nombre: 'Ana', email: 'ana@argos.test' })
        expect(alta.success).toBe(false)
        const edicion = esquemaUsuario(true).safeParse({ ...entradaUsuarioVacia(), nombre: 'Ana', email: 'ana@argos.test' })
        expect(edicion.success).toBe(true)
        const sinId = esquemaUsuario(true).safeParse({ ...entradaUsuarioVacia(), nombre: 'Ana', email: 'ana@argos.test', roles: [{ role_id: 2, alcance_tipo: 'caja', alcance_id: null }] })
        expect(!sinId.success && sinId.error.issues.map(i => i.path.join('.'))).toContain('roles.0.alcance_id')
    })

    it('cambios de usuario: sin contraseña nueva no la manda; «todo» viaja como alcance null', () => {
        const datos = esquemaUsuario(true).parse({ nombre: 'Ana', email: 'ANA@argos.test', password: '', activo: true, roles: [{ role_id: 2, alcance_tipo: SIN_ALCANCE, alcance_id: null }] })
        expect(cambiosUsuario(datos, 3)).toEqual({ version: 3, nombre: 'Ana', email: 'ana@argos.test', activo: true, roles: [{ role_id: 2, alcance_tipo: null, alcance_id: null }] })
    })

    it('rol: nombre en minúsculas con _; token: recortar exige permisos', () => {
        expect(esquemaRol.safeParse({ nombre: 'Cobrador Zona', descripcion: '', permisos: [] }).success).toBe(false)
        expect(esquemaRol.safeParse({ nombre: 'cobrador_zona', descripcion: '', permisos: [] }).success).toBe(true)
        expect(esquemaToken.safeParse({ ...entradaTokenVacia(), usuario_id: 2, nombre: 'Agente', recortar: true }).success).toBe(false)
        const token = esquemaToken.parse({ ...entradaTokenVacia(), usuario_id: 2, nombre: 'Agente', recortar: true, permisos: ['pagos.ver', 'clientes.ver'], cajas: [1] })
        expect(cuerpoToken(token)).toEqual({ usuario_id: 2, nombre: 'Agente', alcances: { permisos: ['clientes.ver', 'pagos.ver'], cajas: [1] } })
    })

    it('agrupa el catálogo por módulo y filtra por texto', () => {
        const grupos = agruparPermisos([{ nombre: 'pagos.ver', descripcion: 'Ver pagos' }, { nombre: 'pagos.anular', descripcion: null }, { nombre: 'tokens.crear', descripcion: null }], 'pago')
        expect(grupos.map(g => [g.etiqueta, g.permisos.length])).toEqual([['Pagos', 2]])
    })
})

describe('ACL · composables y pantallas', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
    })

    it('usuarios: crear con rol y alcance, correo repetido 409, no desactivarse a sí mismo', async () => {
        const creado = await useUsuarios().crear({ nombre: 'Carlos Cobrador', email: 'carlos@argos.test', password: 'secreta123', activo: true, roles: [{ role_id: 2, alcance_tipo: 'caja', alcance_id: 1 }] })
        expect(creado.ok && creado.data.roles).toEqual([{ role_id: 2, rol: 'cajero', alcance_tipo: 'caja', alcance_id: 1 }])
        const repetido = await useUsuarios().crear({ nombre: 'Otro', email: 'carlos@argos.test', password: 'secreta123' })
        expect(!repetido.ok && repetido.problema.type).toBe('urn:argosisp:problema:email_duplicado')
        const yo = bd.usuarios.find(u => u.id === meAdmin.id)!
        const auto = await useUsuarios().editar(yo.id, { version: yo.version, activo: false })
        expect(!auto.ok && auto.problema.type).toBe('urn:argosisp:problema:autodesactivacion')
        const otro = creado.ok ? creado.data : null
        const desactivado = await useUsuarios().editar(otro!.id, { version: otro!.version, activo: false })
        expect(desactivado.ok && desactivado.data.activo).toBe(false)
    })

    it('roles: un rol base no cambia permisos (409 rol_base); uno propio sí, con version', async () => {
        const cajero = bd.roles.find(r => r.nombre === 'cajero')!
        const base = await useRoles().editar(cajero.id, { version: cajero.version, permisos: ['pagos.ver'] })
        expect(!base.ok && base.problema.type).toBe('urn:argosisp:problema:rol_base')
        const descripcion = await useRoles().editar(cajero.id, { version: cajero.version, descripcion: 'Caja de la oficina central' })
        expect(descripcion.ok && descripcion.data.version).toBe(2)
        const nuevo = await useRoles().crear({ nombre: 'auditor', descripcion: null, permisos: ['bitacora.ver', 'libro.ver'] })
        expect(nuevo.ok && nuevo.data.permisos).toEqual(['bitacora.ver', 'libro.ver'])
        const duplicado = await useRoles().crear({ nombre: 'auditor', permisos: [] })
        expect(!duplicado.ok && duplicado.problema.status).toBe(409)
    })

    it('tokens: el valor llega solo al crear; revocar es idempotente', async () => {
        const creado = await useTokensApi().crear({ usuario_id: 2, nombre: 'Agente de IA', alcances: { permisos: ['clientes.ver'] } })
        expect(creado.ok && creado.data.token).toMatch(/^atk_/)
        const lista = await useTokensApi().listar()
        expect(JSON.stringify(lista.ok && lista.data)).not.toContain(creado.ok ? creado.data.token : 'x')
        const id = creado.ok ? creado.data.datos.id : 0
        const revocado = await useTokensApi().revocar(id)
        const otraVez = await useTokensApi().revocar(id)
        expect(revocado.ok && otraVez.ok && revocado.data.revocado_en === otraVez.data.revocado_en).toBe(true)
    })

    it('las tres pantallas muestran sus datos y sus acciones con permiso', async () => {
        const usuarios = await mountSuspended(conApp(PaginaUsuarios))
        await esperar(() => expect(usuarios.find('[data-usuario="3"]').exists()).toBe(true))
        expect(usuarios.find('[data-prueba="nuevo-usuario"]').exists()).toBe(true)
        expect(usuarios.find('[data-prueba="activo-usuario-3"]').exists()).toBe(true)
        // A uno mismo no se le ofrece desactivarse.
        expect(usuarios.find(`[data-prueba="activo-usuario-${meAdmin.id}"]`).exists()).toBe(false)
        expect(usuarios.find('[data-prueba="usuarios-navegacion"]').exists()).toBe(true)

        const roles = await mountSuspended(conApp(PaginaRoles))
        await esperar(() => expect(roles.find('[data-rol="cobrador_zona"]').exists()).toBe(true))
        expect(roles.find('[data-rol="cajero"]').text()).toContain('Base')
        expect(roles.find('[data-prueba="catalogo-permisos"]').text()).toContain('servicios.suspender')

        const tokens = await mountSuspended(conApp(PaginaTokens))
        await esperar(() => expect(tokens.find('[data-token="1"]').exists()).toBe(true))
        expect(tokens.find('[data-prueba="estado-token-2"]').text()).toContain('Revocado')
        expect(tokens.find('[data-prueba="revocar-token-1"]').exists()).toBe(true)
        expect(tokens.find('[data-prueba="revocar-token-2"]').exists()).toBe(false)
    })
})
