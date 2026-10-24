import type { Schema } from '@argosisp/contracts'
import { meAdmin, meCajero } from '../auth/sesiones'
import { PERMISOS_CONTRATO } from 'virtual:permisos-contrato'
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
    // Técnico con su bodega en el vehículo (inventario, `fixtures/inventario/datos.ts`)
    { id: 4, nombre: 'Pedro Técnico', email: 'pedro.tecnico@argos.test', activo: true, roles: [{ role_id: 4, rol: 'tecnico', alcance_tipo: null, alcance_id: null }], alcance_global: false, empresas: [1], version: 1, created_at: creado, updated_at: creado },
]

/**
 * Catálogo de `GET /permisos`, derivado del enum del OpenAPI (`virtual:permisos-contrato`, ver
 * `herramientas/permisosContrato.ts`): nunca se desfasa del backend. La descripción es el resumen del
 * endpoint que lo pide (la API real usa la de `PERMISOS`).
 */
export const catalogoPermisos: Schema<'Permiso'>[] = PERMISOS_CONTRATO.map((permiso, indice) => ({ id: indice + 1, ...permiso }))

const nombresContrato = new Set(PERMISOS_CONTRATO.map(permiso => permiso.nombre))

/**
 * Roles base (`Rol.base`): `admin` con todos los permisos del contrato; los otros cinco con los de
 * `ROLES_BASE` (`roles.base.json`, que el OpenAPI no publica; pedido a A1 en `a4.md`), recortados
 * a los que existen en el contrato.
 */
export const roles: Schema<'Rol'>[] = [
    ...rolesBaseJson.map(rol => ({
        ...rol,
        permisos: rol.nombre === 'admin' ? [...nombresContrato] : rol.permisos.filter(permiso => nombresContrato.has(permiso)),
        base: true,
        version: 1,
        created_at: creado,
        updated_at: creado,
    })),
    {
        id: rolesBaseJson.length + 1,
        nombre: 'cobrador_zona',
        descripcion: 'Cobra en campo y registra promesas en su zona',
        base: false,
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

/**
 * Catálogo de `GET /permisos`, derivado del enum del OpenAPI (`virtual:permisos-contrato`, ver
 * `herramientas/permisosContrato.ts`): nunca se desfasa del backend. La descripción es el resumen del
 * endpoint que lo pide (la API real usa la de `PERMISOS`).
 */
export const catalogoPermisos: Schema<'Permiso'>[] = PERMISOS_CONTRATO.map((permiso, indice) => ({ id: indice + 1, ...permiso }))

const nombresContrato = new Set(PERMISOS_CONTRATO.map(permiso => permiso.nombre))

/**
 * Roles base (`Rol.base`): `admin` con todos los permisos del contrato; los otros cinco con los de
 * `ROLES_BASE` (`roles.base.json`, que el OpenAPI no publica; pedido a A1 en `a4.md`), recortados
 * a los que existen en el contrato.
 */
export const roles: Schema<'Rol'>[] = [
    ...rolesBaseJson.map(rol => ({
        ...rol,
        permisos: rol.nombre === 'admin' ? [...nombresContrato] : rol.permisos.filter(permiso => nombresContrato.has(permiso)),
        base: true,
        version: 1,
        created_at: creado,
        updated_at: creado,
    })),
    {
        id: rolesBaseJson.length + 1,
        nombre: 'cobrador_zona',
        descripcion: 'Cobra en campo y registra promesas en su zona',
        base: false,
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
