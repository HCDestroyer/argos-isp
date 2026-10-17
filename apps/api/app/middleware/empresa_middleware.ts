import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import db from '@adonisjs/lucid/services/db'
import { NoAutenticado, SolicitudInvalida } from '#shared/errores'
import { EmpresaNoPermitida, type EmpresaPeticion } from '#shared/empresa_activa'
import { alcanceEmpresasDeUsuario } from '#core/alcance_empresas'

/** Cabecera con la empresa activa elegida en el selector del panel. */
export const CABECERA_EMPRESA = 'x-empresa-id'

/**
 * Empresa activa de la petición (`contratos/multiempresa.md`). Va después de `auth`, en todas las
 * rutas con sesión.
 *
 * - `X-Empresa-Id: <id>`: el usuario debe tener acceso a esa empresa y estar activa; si no, 403
 *   `empresa_no_permitida`. Un valor que no es un id: 400.
 * - Sin cabecera: la única empresa del usuario; si tiene varias, ninguna (`activa: null`) y las
 *   acciones que la necesitan responden 422 `empresa_requerida`.
 *
 * Deja `ctx.empresa` (`EmpresaPeticion`) y `ctx.contextoAccion()` lleva `empresaId` y
 * `empresasPermitidas`. Un token de API usa el alcance de su usuario.
 */
export default class EmpresaMiddleware {
    async handle(ctx: HttpContext, next: NextFn) {
        const usuario = ctx.auth.user
        if (!usuario) throw new NoAutenticado()
        const alcance = await alcanceEmpresasDeUsuario(usuario.id)

        let activa: number | null = null
        const cabecera = ctx.request.header(CABECERA_EMPRESA)?.trim()
        if (cabecera) {
            if (!/^[1-9]\d{0,17}$/.test(cabecera)) {
                throw new SolicitudInvalida('X-Empresa-Id debe ser el id de una empresa')
            }
            const id = Number(cabecera)
            if (!alcance.empresas.includes(id)) throw new EmpresaNoPermitida(id)
            activa = id
        } else if (alcance.empresas.length === 1) {
            activa = alcance.empresas[0]!
        }

        let accesoTotal = alcance.alcanceGlobal
        if (!accesoTotal) {
            const fila = (await db
                .from('core.empresas')
                .where('activa', true)
                .count('* as total')
                .first()) as {
                total: number | string
            }
            accesoTotal = alcance.empresas.length >= Number(fila.total)
        }

        ctx.empresa = {
            activa,
            empresas: alcance.empresas,
            permitidas: alcance.permitidas,
            alcanceGlobal: alcance.alcanceGlobal,
            accesoTotal,
        } satisfies EmpresaPeticion
        return next()
    }
}

declare module '@adonisjs/core/http' {
    interface HttpContext {
        /** Empresa activa y alcance por empresa (lo carga el middleware `empresa`). */
        empresa?: EmpresaPeticion
    }
}
