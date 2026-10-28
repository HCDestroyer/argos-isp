import { randomBytes } from 'node:crypto'
import { BaseCommand, args, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * `node ace usuarios:clave <correo> [--stdin]`: asigna una clave nueva a un usuario del panel desde
 * el servidor (`sudo argosisp admin-clave <correo>`), para recuperar el acceso de un administrador.
 *
 * - Sin `--stdin` genera una clave aleatoria (20 caracteres); con `--stdin` la lee de la entrada
 *   estándar (primera línea, mínimo 8 caracteres, igual que el panel).
 * - Si el usuario existe: `usuarios.editar` con la clave (revoca sus sesiones). Si no: `usuarios.crear`
 *   con el rol `admin` y alcance global.
 * - Actor `sistema`, canal `consola`: queda en `audit.acciones` con la clave enmascarada (`***`) y en
 *   `audit.cambios` solo `clave_cambiada`. Nunca escribe en la base fuera de esas acciones.
 * - Imprime la clave una sola vez (stdout, sola en su línea); los avisos van al logger.
 *
 * Hecho por A6 con permiso del líder (`.claude/integration/a6.md`).
 */
export default class UsuariosClave extends BaseCommand {
    static commandName = 'usuarios:clave'
    static description =
        'Asigna una clave nueva a un usuario (lo crea como admin si no existe) y la muestra una vez'

    static options: CommandOptions = {
        startApp: true,
    }

    @args.string({ description: 'Correo del usuario' })
    declare correo: string

    @flags.boolean({ description: 'Leer la clave de la entrada estándar en lugar de generarla' })
    declare stdin?: boolean

    /** Entrada de la clave con `--stdin` (las pruebas la reemplazan). */
    entrada: NodeJS.ReadableStream = process.stdin

    /** Resultado de la última corrida (para las pruebas): id del usuario, si se creó y la clave. */
    resultado?: { usuarioId: number; creado: boolean; clave: string }

    async run() {
        const { default: db } = await import('@adonisjs/lucid/services/db')
        const { default: CrearUsuario } = await import('#core/actions/crear_usuario')
        const { default: EditarUsuario } = await import('#core/actions/editar_usuario')
        const { contextoSistema } = await import('#shared/contexto')

        const correo = this.correo.trim().toLowerCase()
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) {
            this.logger.error(`Correo inválido: "${this.correo}"`)
            this.exitCode = 1
            return
        }

        const clave = this.stdin ? await this.leerClave() : generarClave()
        if (clave.length < 8 || clave.length > 200) {
            this.logger.error('La clave debe tener entre 8 y 200 caracteres')
            this.exitCode = 1
            return
        }

        const ctx = contextoSistema('consola')
        const existente = (await db
            .from('core.usuarios')
            .whereRaw('lower(email) = ?', [correo])
            .select('id', 'version', 'activo')
            .first()) as { id: number; version: number; activo: boolean } | null

        let usuarioId: number
        let creado = false
        if (existente) {
            await new EditarUsuario().execute(
                { id: existente.id, version: existente.version, password: clave },
                ctx,
            )
            usuarioId = existente.id
            if (!existente.activo) {
                this.logger.warning(
                    `El usuario ${correo} está desactivado: actívalo desde el panel con otro admin`,
                )
            }
            this.logger.success(
                `Clave nueva para ${correo} (usuario ${usuarioId}); sus sesiones abiertas se cerraron`,
            )
        } else {
            const rol = (await db.from('core.roles').where('nombre', 'admin').select('id').first()) as {
                id: number
            } | null
            if (!rol) {
                this.logger.error('No existe el rol admin (¿corrió el seed?)')
                this.exitCode = 1
                return
            }
            const usuario = await new CrearUsuario().execute(
                { nombre: 'Administrador', email: correo, password: clave, roles: [{ role_id: rol.id }] },
                ctx,
            )
            usuarioId = usuario.id
            creado = true
            this.logger.success(`Usuario ${correo} creado con el rol admin (usuario ${usuarioId})`)
        }

        this.resultado = { usuarioId, creado, clave }
        this.logger.info('Clave (se muestra una sola vez):')
        console.log(clave)
    }

    private async leerClave(): Promise<string> {
        const partes: Buffer[] = []
        for await (const parte of this.entrada) {
            partes.push(Buffer.isBuffer(parte) ? parte : Buffer.from(parte))
        }
        return (Buffer.concat(partes).toString('utf8').split(/\r?\n/)[0] ?? '').trim()
    }
}

/** 20 caracteres de letras y números (sin símbolos: se copia sin problemas desde una terminal). */
function generarClave(): string {
    const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
    const bytes = randomBytes(64)
    let clave = ''
    for (const b of bytes) {
        if (b < 256 - (256 % alfabeto.length)) clave += alfabeto[b % alfabeto.length]
        if (clave.length === 20) break
    }
    return clave
}
