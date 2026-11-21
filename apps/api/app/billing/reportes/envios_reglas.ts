import type { Transaccion } from '#shared/domain_action'
import { Prohibido, ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { alcanceDePermiso } from '#core/acl'
import { motivoNoCompartible, type DefinicionReporte } from '#billing/reportes/catalogo'
import type { Frecuencia } from '#billing/reportes/envios'

/** Reglas comunes de `reportes.programar_envio` y `reportes.editar_envio` (`contratos/reportes.md` §5). */

export interface CamposEnvio {
    nombre: string
    filtros?: Record<string, unknown>
    formato: 'pdf' | 'xlsx' | 'csv'
    frecuencia: Frecuencia
    dia?: number | null
    hora: number
    destinatarios: { usuarios?: number[]; correos_externos?: number[] }
}

/** `dia` según la frecuencia: diaria sin día; semanal 1 a 7; mensual 1 a 28. */
export function diaDeEnvio(campos: CamposEnvio): number | null {
    const dia = campos.dia ?? null
    if (campos.frecuencia === 'diaria') {
        if (dia !== null) {
            throw new ValidacionFallida([
                { field: 'dia', message: 'Un envío diario no lleva día', rule: 'no_aplica' },
            ])
        }
        return null
    }
    if (dia === null) {
        throw new ValidacionFallida([
            {
                field: 'dia',
                message: 'Indique el día del envío semanal (1 a 7) o mensual (1 a 28)',
                rule: 'required',
            },
        ])
    }
    if (campos.frecuencia === 'semanal' && dia > 7) {
        throw new ValidacionFallida([
            {
                field: 'dia',
                message: 'El día de un envío semanal va de 1 (lunes) a 7 (domingo)',
                rule: 'range',
            },
        ])
    }
    return dia
}

/**
 * Quien programa debe poder ver el reporte (su permiso y, en los del panel, sin alcance parcial): un
 * envío nunca le da a nadie un reporte que su autor no puede ver. 403 si no.
 */
export async function exigirAutorPuedeVer(t: Transaccion, def: DefinicionReporte): Promise<void> {
    const actor = t.ctx.actor.id
    if (actor === null) return
    const alcance = await alcanceDePermiso(actor, def.permiso)
    if (!alcance) throw new Prohibido(`Se requiere el permiso ${def.permiso} para programar este reporte`)
    if (def.alcanceTotal && alcance.rol !== null) {
        throw new Prohibido(
            `El reporte ${def.codigo} suma toda la empresa: requiere ${def.permiso} sin alcance`,
        )
    }
}

/**
 * Destinatarios: al menos uno; los usuarios existen y están activos; los correos están en la lista
 * aprobada y activos; a un correo externo solo va un reporte compartible sin datos personales con
 * esos filtros (decisión 6 del PM).
 */
export async function validarDestinatarios(
    t: Transaccion,
    def: DefinicionReporte,
    filtros: Record<string, unknown>,
    destinatarios: CamposEnvio['destinatarios'],
): Promise<{ usuarios: number[]; correos: number[] }> {
    const usuarios = destinatarios.usuarios ?? []
    const correos = destinatarios.correos_externos ?? []
    const errores: ErrorCampo[] = []
    if (usuarios.length + correos.length === 0) {
        errores.push({
            field: 'destinatarios',
            message: 'Indique al menos un usuario o un correo de la lista aprobada',
            rule: 'required',
        })
    }
    if (usuarios.length > 0) {
        const activos = new Set(
            (
                (await t.trx
                    .from('core.usuarios')
                    .whereIn('id', usuarios)
                    .where('activo', true)
                    .select('id')) as Array<{
                    id: number
                }>
            ).map((f) => Number(f.id)),
        )
        usuarios.forEach((id, i) => {
            if (!activos.has(id)) {
                errores.push({
                    field: `destinatarios.usuarios.${i}`,
                    message: `El usuario ${id} no existe o está desactivado`,
                    rule: 'usuario',
                })
            }
        })
    }
    if (correos.length > 0) {
        const activos = new Set(
            (
                (await t.trx
                    .from('billing.reportes_correos_externos')
                    .whereIn('id', correos)
                    .where('activo', true)
                    .select('id')) as Array<{ id: number }>
            ).map((f) => Number(f.id)),
        )
        correos.forEach((id, i) => {
            if (!activos.has(id)) {
                errores.push({
                    field: `destinatarios.correos_externos.${i}`,
                    message: `El correo ${id} no está en la lista aprobada por el administrador`,
                    rule: 'correo_no_aprobado',
                })
            }
        })
        const motivo = motivoNoCompartible(def, filtros)
        if (motivo) {
            errores.push({
                field: 'destinatarios.correos_externos',
                message: `A un correo externo solo van reportes contables sin datos personales de clientes: este ${motivo}`,
                rule: 'no_compartible',
            })
        }
    }
    if (errores.length > 0) throw new ValidacionFallida(errores)
    return { usuarios, correos }
}

export async function guardarDestinatarios(
    t: Transaccion,
    envioId: number,
    d: { usuarios: number[]; correos: number[] },
): Promise<void> {
    await t.trx.from('billing.reportes_envios_destinatarios').where('envio_id', envioId).delete()
    const filas = [
        ...d.usuarios.map((usuario_id) => ({ envio_id: envioId, usuario_id, correo_externo_id: null })),
        ...d.correos.map((correo_externo_id) => ({ envio_id: envioId, usuario_id: null, correo_externo_id })),
    ]
    if (filas.length > 0) await t.trx.table('billing.reportes_envios_destinatarios').multiInsert(filas)
}
