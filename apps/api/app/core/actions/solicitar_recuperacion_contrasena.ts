import logger from '@adonisjs/core/services/logger'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { configPara, construirCanal } from '#notify/configuracion'
import {
    configRecuperacion,
    enlaceRecuperacion,
    exigirRecuperacionEncendida,
    generarTokenRecuperacion,
} from '#core/auth/recuperacion'

export interface EntradaSolicitarRecuperacion {
    email: string
    /** IP de quien pide (solo se guarda en la fila) */
    ip?: string | null
}

/**
 * Pide el enlace para cambiar la contraseña del panel (`auth.solicitar_recuperacion`, pública; decisión
 * del PM 22). Siempre responde igual (la ruta devuelve 202 sin cuerpo útil): si el correo no es de un
 * usuario activo no hace nada más. Si lo es, anula los enlaces anteriores, guarda el hash del nuevo y
 * manda el correo al confirmar (canal de correo global de notify; sin SMTP queda en el log). Emite
 * `usuario.recuperacion_solicitada` sin token ni correo. 404 `recuperacion_apagada` si el admin la apagó.
 */
export default class SolicitarRecuperacionContrasena extends DomainAction<
    EntradaSolicitarRecuperacion,
    { aceptada: true }
> {
    readonly nombre = 'auth.solicitar_recuperacion'

    protected async handle(input: EntradaSolicitarRecuperacion, t: Transaccion): Promise<{ aceptada: true }> {
        await exigirRecuperacionEncendida(t.trx)
        const usuario = (await t.trx
            .from('core.usuarios')
            .whereRaw('lower(email) = ?', [input.email.trim().toLowerCase()])
            .where('activo', true)
            .select('id', 'nombre', 'email')
            .first()) as { id: number; nombre: string; email: string } | null
        if (!usuario) return { aceptada: true }
        const usuarioId = Number(usuario.id)
        t.fijarEntidad('usuario', usuarioId)
        t.fijarEmpresa(null)

        await t.trx
            .from('core.recuperaciones_contrasena')
            .where('usuario_id', usuarioId)
            .whereNull('usado_en')
            .whereNull('anulado_en')
            .update({ anulado_en: t.trx.knexRawQuery('now()') } as Record<string, unknown>)
        const { token, hash } = generarTokenRecuperacion()
        const { vigenciaMin } = configRecuperacion()
        await t.trx
            .insertQuery()
            .table('core.recuperaciones_contrasena')
            .insert({
                usuario_id: usuarioId,
                token_hash: hash,
                expira_en: t.trx.knexRawQuery(`now() + make_interval(mins => ?)`, [vigenciaMin]),
                ip: input.ip ?? null,
            })
        await t.emit('usuario.recuperacion_solicitada', { usuario_id: usuarioId })

        const enlace = enlaceRecuperacion(token)
        t.alConfirmar(async () => {
            const canal = construirCanal(await configPara(null), 'correo')
            if (!canal) {
                logger.warn({ usuario_id: usuarioId }, 'Recuperación de contraseña sin SMTP configurado')
                return
            }
            await canal.enviar(
                usuario.email,
                'Cambia tu contraseña de ArgosIsp',
                `Hola ${usuario.nombre}:\n\n` +
                    'Alguien (ojalá tú) pidió cambiar la contraseña de tu usuario del panel.\n' +
                    `Abre este enlace dentro de los próximos ${vigenciaMin} minutos; solo sirve una vez:\n\n` +
                    `${enlace}\n\n` +
                    'Si no lo pediste, ignora este correo: tu contraseña no cambia.\n',
            )
        })
        return { aceptada: true }
    }
}
