import { BaseSeeder } from '@adonisjs/lucid/seeders'
import app from '@adonisjs/core/services/app'
import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import Usuario from '#core/models/usuario'
import { NOMBRES_PERMISOS, PERMISOS, ROLES_BASE } from '#core/permisos'

/** Valores por defecto SOLO para desarrollo, pruebas y laboratorio (ver .env.example). */
const ADMIN_DEV = { email: 'admin@argosisp.local', password: 'admin12345', nombre: 'Administrador' }

/**
 * Permisos, roles base y usuario admin de laboratorio. Idempotente: se puede correr varias veces;
 * sincroniza los permisos de los roles base con `app/core/permisos.ts`.
 */
export default class AclSeeder extends BaseSeeder {
    async run() {
        await db.transaction(async (trx) => {
            await trx
                .knexQuery()
                .table('core.permisos')
                .insert(NOMBRES_PERMISOS.map((nombre) => ({ nombre, descripcion: PERMISOS[nombre] })))
                .onConflict('nombre')
                .merge(['descripcion'])

            const permisos = (await trx.from('core.permisos').select('id', 'nombre')) as Array<{
                id: number
                nombre: string
            }>
            const idPermiso = new Map(permisos.map((p) => [p.nombre, p.id]))

            for (const [nombre, rol] of Object.entries(ROLES_BASE)) {
                await trx
                    .knexQuery()
                    .table('core.roles')
                    .insert({ nombre, descripcion: rol.descripcion })
                    .onConflict('nombre')
                    .merge(['descripcion'])
                const { id: roleId } = (await trx
                    .from('core.roles')
                    .where('nombre', nombre)
                    .select('id')
                    .firstOrFail()) as {
                    id: number
                }

                const deseados = rol.permisos.map((p) => idPermiso.get(p)!)
                await trx
                    .from('core.roles_permisos')
                    .where('role_id', roleId)
                    .whereNotIn('permiso_id', deseados)
                    .delete()
                await trx
                    .knexQuery()
                    .table('core.roles_permisos')
                    .insert(deseados.map((permisoId) => ({ role_id: roleId, permiso_id: permisoId })))
                    .onConflict(['role_id', 'permiso_id'])
                    .ignore()
            }
        })

        await this.crearAdmin()
    }

    private async crearAdmin() {
        const email = env.get('SEED_ADMIN_EMAIL') ?? (app.inProduction ? undefined : ADMIN_DEV.email)
        const password = env.get('SEED_ADMIN_PASSWORD') ?? (app.inProduction ? undefined : ADMIN_DEV.password)
        if (!email || !password) {
            logger.warn('SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD no definidos: no se crea el usuario admin')
            return
        }

        const correo = email.toLowerCase()
        let admin = await Usuario.findBy('email', correo)
        if (!admin) {
            admin = await Usuario.create({
                nombre: env.get('SEED_ADMIN_NOMBRE') ?? ADMIN_DEV.nombre,
                email: correo,
                password,
                activo: true,
            })
        }

        const rolAdmin = (await db
            .from('core.roles')
            .where('nombre', 'admin')
            .select('id')
            .firstOrFail()) as { id: number }
        await db
            .knexQuery()
            .table('core.usuarios_roles')
            .insert({ usuario_id: admin.id, role_id: rolAdmin.id })
            .onConflict()
            .ignore()
    }
}
