import type { Schema } from '@argosisp/contracts'
import meAdmin from '../auth/me.admin.json'
import meCajero from '../auth/me.cajero.json'

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
