import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { ValidacionFallida, type ErrorCampo } from '#shared/errores'
import type { TipoAlcance } from '#core/acl'
import {
    CODIGO_SOLO_EMPRESAS,
    esAlcanceDeRed,
    rechazarAlcanceDeRed,
    usuarioSoloEmpresas,
} from '#core/alcance_usuario_tecnico'

/**
 * Pieza común de `crearUsuario` y `editarUsuario`: valida y reemplaza las asignaciones de rol
 * (con alcance opcional por router, zona o caja) de un usuario.
 */

export interface AsignacionRolEntrada {
    role_id: number
    alcance_tipo?: TipoAlcance | null
    alcance_id?: number | null
}

const TABLA_ALCANCE: Record<TipoAlcance, string> = {
    router: 'network.routers',
    zona: 'core.zonas',
    caja: 'ledger.cajas',
}

/** Forma canónica para auditar: `rol` o `rol@router:3`, ordenadas. */
export function describirAsignaciones(
    asignaciones: Array<{ rol: string; alcance_tipo: string | null; alcance_id: number | null }>,
): string[] {
    return asignaciones
        .map((a) => (a.alcance_tipo ? `${a.rol}@${a.alcance_tipo}:${a.alcance_id}` : a.rol))
        .sort()
}

export async function reemplazarAsignaciones(
    trx: TransactionClientContract,
    usuarioId: number,
    asignaciones: AsignacionRolEntrada[],
): Promise<void> {
    // El usuario técnico de Iris solo admite alcance por empresas (contrato Iris 0.3.1 §1).
    const tecnico = await usuarioSoloEmpresas(trx, usuarioId)
    if (tecnico) {
        const deRed = asignaciones.flatMap((a, indice) =>
            esAlcanceDeRed(a.alcance_tipo)
                ? [
                      {
                          field: `roles.${indice}.alcance_tipo`,
                          rule: CODIGO_SOLO_EMPRESAS,
                          message: `${tecnico} no admite roles con alcance por ${a.alcance_tipo}: acótalo por empresas`,
                      },
                  ]
                : [],
        )
        if (deRed.length > 0) rechazarAlcanceDeRed(tecnico, deRed)
    }

    const errores: ErrorCampo[] = []
    const roleIds = [...new Set(asignaciones.map((a) => a.role_id))]
    const existentes = new Set(
        ((await trx.from('core.roles').whereIn('id', roleIds).select('id')) as Array<{ id: number }>).map(
            (r) => r.id,
        ),
    )

    const filas = []
    const vistas = new Set<string>()
    for (const [indice, a] of asignaciones.entries()) {
        const tipo = a.alcance_tipo ?? null
        const alcanceId = a.alcance_id ?? null
        if (!existentes.has(a.role_id)) {
            errores.push({ field: `roles.${indice}.role_id`, message: 'El rol no existe', rule: 'exists' })
        }
        if ((tipo === null) !== (alcanceId === null)) {
            errores.push({
                field: `roles.${indice}.alcance_id`,
                message: 'alcance_tipo y alcance_id van juntos',
                rule: 'alcance',
            })
            continue
        }
        if (tipo !== null && alcanceId !== null) {
            const existe = await trx.from(TABLA_ALCANCE[tipo]).where('id', alcanceId).select('id').first()
            if (!existe) {
                errores.push({
                    field: `roles.${indice}.alcance_id`,
                    message: `No existe ${tipo} ${alcanceId}`,
                    rule: 'exists',
                })
            }
        }
        const clave = `${a.role_id}|${tipo}|${alcanceId}`
        if (vistas.has(clave)) continue
        vistas.add(clave)
        filas.push({ usuario_id: usuarioId, role_id: a.role_id, alcance_tipo: tipo, alcance_id: alcanceId })
    }
    if (errores.length > 0) throw new ValidacionFallida(errores)

    await trx.from('core.usuarios_roles').where('usuario_id', usuarioId).delete()
    if (filas.length > 0) await trx.insertQuery().table('core.usuarios_roles').multiInsert(filas)
}

export async function asignacionesActuales(trx: TransactionClientContract, usuarioId: number) {
    const filas = (await trx
        .from('core.usuarios_roles as ur')
        .join('core.roles as r', 'r.id', 'ur.role_id')
        .where('ur.usuario_id', usuarioId)
        .select('r.nombre as rol', 'ur.alcance_tipo', 'ur.alcance_id')) as Array<{
        rol: string
        alcance_tipo: string | null
        alcance_id: number | null
    }>
    return describirAsignaciones(filas)
}
