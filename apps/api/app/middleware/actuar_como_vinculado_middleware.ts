import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import {
    esPermisoActuacionVinculada,
    resolverActuacionIris,
    type PermisoActuacionVinculada,
} from '#core/actuacion_vinculada'
import { CABECERA_EMPRESA } from '#middleware/empresa_middleware'
import { esTokenIris, exigirCabecerasIris } from '#integraciones/iris/atencion'
import { NoAutenticado } from '#shared/errores'

/**
 * `middleware.actuarComoVinculado({ permiso })` (Iris 0.7.0, A23; `#core/actuacion_vinculada`).
 * Solo se monta en las rutas con `actuarComoVinculado` en `definirRuta`, después de `autorizar`
 * (el token Iris también necesita el permiso) y **antes** de `idempotencia`: una vinculación
 * revocada o un usuario desactivado no reciben un replay.
 *
 * Con el token del usuario técnico Iris: exige `X-Iris-Actor` y `X-Iris-Conversacion` (400
 * `cabecera_iris_requerida`), resuelve el usuario vinculado (403 con su code) y deja en el ctx su
 * alcance, sus empresas (∩ las del token) y la actuación que lee `contextoAccion()`. Con otro actor
 * (panel, otro token) no hace nada.
 */
export default class ActuarComoVinculadoMiddleware {
    async handle(ctx: HttpContext, next: NextFn, opciones: { permiso: PermisoActuacionVinculada }) {
        if (!esPermisoActuacionVinculada(opciones.permiso)) {
            throw new Error(`actuarComoVinculado no admite ${String(opciones.permiso)}`)
        }
        if (!esTokenIris(ctx)) return next()
        const usuario = ctx.auth.user
        const token = ctx.auth.use('tokens').token
        if (!usuario || !token || !ctx.empresa) throw new NoAutenticado()

        const origen = exigirCabecerasIris(ctx)!
        const actuacion = await resolverActuacionIris({
            actorIris: origen.actor,
            permiso: opciones.permiso,
            tokenApiId: Number(token.id),
            empresaToken: ctx.empresa,
            empresaExplicita: Boolean(ctx.request.header(CABECERA_EMPRESA)?.trim()),
        })
        ctx.alcance = actuacion.alcance
        ctx.empresa = actuacion.empresa
        ctx.actuacionVinculada = {
            usuarioId: actuacion.usuarioId,
            via: {
                conector: 'iris',
                tokenApiId: Number(token.id),
                usuarioTecnicoId: Number(usuario.id),
                permiso: opciones.permiso,
            },
        }
        return next()
    }
}
