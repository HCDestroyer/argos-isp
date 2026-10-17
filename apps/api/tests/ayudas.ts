import { randomUUID } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'
import Usuario from '#core/models/usuario'
import type { ApiResponse } from '@japa/api-client'
import type { ContextoAccion } from '#shared/contexto'

/**
 * Utilidades de prueba. Los datos llevan sufijos únicos porque ledger y audit no se truncan.
 */

export function unico(prefijo: string): string {
    return `${prefijo}-${randomUUID().slice(0, 8)}`
}

export function contextoPrueba(actorId: number | null = null): ContextoAccion {
    return {
        actor: actorId ? { tipo: 'usuario', id: actorId } : { tipo: 'sistema', id: null },
        canal: 'consola',
        requestId: randomUUID(),
    }
}

/** Crea un usuario con los roles dados y devuelve un token Bearer de sesión. */
export async function usuarioConRoles(roles: string[], password = 'clave-de-prueba') {
    const usuario = await Usuario.create({
        nombre: unico('Usuario'),
        email: `${unico('u')}@prueba.local`,
        password,
        activo: true,
    })
    for (const nombre of roles) {
        const rol = (await db.from('core.roles').where('nombre', nombre).select('id').firstOrFail()) as {
            id: number
        }
        await db.table('core.usuarios_roles').insert({ usuario_id: usuario.id, role_id: rol.id })
    }
    const token = await Usuario.accessTokens.create(usuario)
    return { usuario, password, token: token.value!.release() }
}

/** Espera la respuesta y verifica el status: `await estado(client.get('/x'), 200)`. */
export async function estado(peticion: PromiseLike<ApiResponse>, status: number): Promise<ApiResponse> {
    const respuesta = await peticion
    respuesta.assertStatus(status)
    return respuesta
}

/**
 * Deja la empresa 1 como recién migrada sin datos guardados (`version = 0`: las lecturas usan los
 * valores por defecto del entorno). Reemplaza al antiguo `DELETE FROM core.empresa`.
 */
export async function restablecerEmpresaPrincipal() {
    await db.from('core.empresas').where('id', 1).update({
        nit: null,
        razon_social: null,
        nombre_comercial: 'ArgosIsp',
        direccion_fiscal: null,
        municipio: null,
        departamento: null,
        telefono: null,
        telefono_alterno: null,
        whatsapp: null,
        correo: null,
        sitio_web: null,
        horario: null,
        instrucciones_pago: null,
        color_marca: null,
        regimen_isr: null,
        codigo_establecimiento: null,
        logo: null,
        logo_tipo: null,
        logo_etag: null,
        activa: true,
        version: 0,
    })
}
