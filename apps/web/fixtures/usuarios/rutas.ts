import type { Schema } from '@argosisp/contracts'
import type { RutasFixture } from '~/utils/fetchFixtures'
import { conPermiso, paginar } from '../comun'
import meAdmin from '../auth/me.admin.json'
import meCajero from '../auth/me.cajero.json'

const creado = '2026-09-01T15:00:00.000Z'

/** Usuarios de los fixtures: los mismos de `auth/` (admin y cajero), como `GET /usuarios`. */
export const usuarios: Schema<'Usuario'>[] = [
    { id: meAdmin.id, nombre: meAdmin.nombre, email: meAdmin.email, activo: true, roles: [{ role_id: 1, rol: 'admin', alcance_tipo: null, alcance_id: null }], version: 1, created_at: creado, updated_at: creado },
    { id: meCajero.id, nombre: meCajero.nombre, email: meCajero.email, activo: true, roles: [{ role_id: 2, rol: 'cajero', alcance_tipo: 'caja', alcance_id: 1 }], version: 1, created_at: creado, updated_at: creado },
]

export const rutasUsuarios: RutasFixture = {
    'GET /api/v1/usuarios': conPermiso('usuarios.ver', solicitud => ({ status: 200, cuerpo: paginar(usuarios, solicitud) })),
}
