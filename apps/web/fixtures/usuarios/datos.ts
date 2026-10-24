import type { Schema } from '@argosisp/contracts'
import meAdmin from '../auth/me.admin.json'
import meCajero from '../auth/me.cajero.json'
import permisosJson from './permisos.json'
import rolesBaseJson from './roles.base.json'

const creado = '2026-09-01T15:00:00.000Z'

/**
 * Usuarios de los fixtures, como `GET /usuarios`: los de `auth/` (admin con alcance global y cajero
 * en la empresa 1) y un soporte de Fibra del Sur, para asignar empresas.
 */
export const usuarios: Schema<'Usuario'>[] = [
    { id: meAdmin.id, nombre: meAdmin.nombre, email: meAdmin.email, activo: true, roles: [{ role_id: 1, rol: 'admin', alcance_tipo: null, alcance_id: null }], alcance_global: true, empresas: [], version: 1, created_at: creado, updated_at: creado },
    { id: meCajero.id, nombre: meCajero.nombre, email: meCajero.email, activo: true, roles: [{ role_id: 2, rol: 'cajero', alcance_tipo: 'caja', alcance_id: 1 }], alcance_global: false, empresas: [1], version: 1, created_at: creado, updated_at: creado },
    { id: 3, nombre: 'Sofía Soporte', email: 'soporte@fibradelsur.gt', activo: true, roles: [{ role_id: 3, rol: 'soporte', alcance_tipo: null, alcance_id: null }], alcance_global: false, empresas: [2], version: 1, created_at: creado, updated_at: creado },
]

/**
 * Catálogo de `GET /permisos`: el `PERMISOS` de `apps/api/app/core/permisos.ts` con su descripción,
 * en el mismo orden (los ids los pone el seed). Y los roles base de `ROLES_BASE` con sus permisos.
 * Se copiaron de la API (`PERMISOS` y `ROLES_BASE`); `tests/nuxt/usuariosAcl.test.ts` comprueba que el
 * catálogo trae los mismos nombres que el enum del contrato.
 */
export const catalogoPermisos: Schema<'Permiso'>[] = permisosJson

export const roles: Schema<'Rol'>[] = [
    ...rolesBaseJson.map(rol => ({ ...rol, version: 1, created_at: creado, updated_at: creado })),
    {
        id: rolesBaseJson.length + 1,
        nombre: 'cobrador_zona',
        descripcion: 'Cobra en campo y registra promesas en su zona',
        permisos: ['clientes.estado_cuenta', 'clientes.ver', 'pagos.registrar', 'pagos.ver', 'promesas.crear', 'promesas.ver', 'servicios.ver'],
        version: 1,
        created_at: creado,
        updated_at: creado,
    },
]

/** Tokens de API (`GET /tokens`): uno activo recortado a la caja 1 y uno revocado. */
export const tokensApi: Schema<'TokenApi'>[] = [
    { id: 1, usuario_id: meCajero.id, nombre: 'Agente de cobranza', alcances: { permisos: ['clientes.ver', 'pagos.ver', 'promesas.crear', 'promesas.ver'], cajas: [1] }, ultimo_uso: '2026-10-20T14:32:00.000Z', revocado_en: null, created_at: creado },
    { id: 2, usuario_id: meAdmin.id, nombre: 'Script de importación', alcances: {}, ultimo_uso: '2026-09-02T10:00:00.000Z', revocado_en: '2026-09-03T16:00:00.000Z', created_at: creado },
]
