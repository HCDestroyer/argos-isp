import db from '@adonisjs/lucid/services/db'
import type { HttpContext } from '@adonisjs/core/http'
import { alcanceDePermiso, type Alcance } from '#core/acl'
import type { Permiso } from '#core/permisos'
import { alcancesDelToken } from '#middleware/autorizar_middleware'
import { NoAutenticado, NoEncontrado, Prohibido, ValidacionFallida } from '#shared/errores'
import { exigirAcceso } from '#billing/empresa'
import { existeCaja } from '#ledger/cajas'

/**
 * Lecturas que admiten dos permisos (pedidos de A4): el **amplio** del recurso (`bancos.ver`,
 * `egresos.ver`) ve todo lo de sus empresas; con solo `cajas.ver` (el cajero) se lee lo de una caja o
 * un turno de su alcance, para que vea el esperado provisional completo en /caja.
 *
 * La ruta declara `permiso: null` y llama `autorizarLecturaDeCaja` en el handler: 403 si no tiene
 * ninguno de los dos; deja en `ctx.alcance` el alcance del permiso con que entró; sin el amplio,
 * `caja_id` o `turno_id` es obligatorio (422) y la caja debe estar en su alcance (403).
 */

export interface LecturaDeCaja {
    /** entró con el permiso amplio (ve todo lo de sus empresas) */
    amplio: boolean
    alcance: Alcance
    /** caja pedida (por `caja_id` o la del `turno_id`), o undefined */
    caja_id: number | undefined
}

export async function autorizarLecturaDeCaja(
    ctx: HttpContext,
    amplio: Permiso,
    query: { caja_id?: number; turno_id?: number },
): Promise<LecturaDeCaja> {
    const usuario = ctx.auth.user
    if (!usuario) throw new NoAutenticado()
    const token = alcancesDelToken(ctx)
    const conAmplio = await alcanceDePermiso(usuario.id, amplio, token)
    const conCajas = conAmplio ? null : await alcanceDePermiso(usuario.id, 'cajas.ver', token)
    const alcance = conAmplio ?? conCajas
    if (!alcance) throw new Prohibido(`Se requiere el permiso ${amplio} o cajas.ver`)
    ctx.alcance = alcance

    let cajaId = query.caja_id
    if (query.turno_id !== undefined) {
        const turno = await db
            .from('ledger.cajas_turnos')
            .where('id', query.turno_id)
            .select('caja_id')
            .first()
        if (!turno) throw new NoEncontrado(`El turno ${query.turno_id} no existe`)
        if (cajaId !== undefined && cajaId !== Number(turno.caja_id)) {
            throw new ValidacionFallida([
                {
                    field: 'turno_id',
                    message: `El turno ${query.turno_id} no es de la caja ${cajaId}`,
                    rule: 'turno_de_la_caja',
                },
            ])
        }
        cajaId = Number(turno.caja_id)
    }
    if (cajaId !== undefined) exigirAcceso(ctx, await existeCaja(cajaId))
    else if (!conAmplio) {
        throw new ValidacionFallida([
            {
                field: 'caja_id',
                message: `Sin ${amplio} indica la caja (caja_id) o el turno (turno_id)`,
                rule: 'required',
            },
        ])
    }
    return { amplio: Boolean(conAmplio), alcance, caja_id: cajaId }
}
