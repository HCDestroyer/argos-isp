import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado } from '#shared/errores'
import { empresasDelCliente, hashesPorDefecto } from '#portal/acceso/contrasenas'

export interface EntradaRestaurarContrasenaPortal {
    cliente_id: number
}

/** Espejo del schema `ClienteContrasenaPortal`. Nunca lleva la contraseña ni su hash. */
export interface ContrasenaPortalCliente {
    cliente_id: number
    /** tiene contraseña propia (si no, entra con la por defecto de su empresa) */
    propia: boolean
    actualizada_en: string | null
    /** alguna de sus empresas tiene contraseña por defecto configurada (si no, solo entra con código) */
    defecto_configurada: boolean
    /** sesiones del portal que cerró la restauración (0 en la lectura) */
    sesiones_cerradas: number
}

export async function verContrasenaPortalCliente(
    cliente: QueryClientContract,
    clienteId: number,
): Promise<ContrasenaPortalCliente> {
    const fila = (await cliente
        .from('core.portal_credenciales')
        .where('cliente_id', clienteId)
        .select('actualizada_en')
        .first()) as { actualizada_en: Date } | null
    const defectos = await hashesPorDefecto(cliente, await empresasDelCliente(cliente, clienteId, null))
    return {
        cliente_id: clienteId,
        propia: fila !== null,
        actualizada_en: fila ? fila.actualizada_en.toISOString() : null,
        defecto_configurada: defectos.length > 0,
        sesiones_cerradas: 0,
    }
}

/**
 * Restaura la contraseña del portal de un cliente a la por defecto de su empresa
 * (`POST /clientes/:id/restaurar-contrasena-portal`, permiso `clientes.restaurar_contrasena_portal`).
 *
 * - Borra su contraseña propia: vuelve a entrar con la por defecto y el portal le pide cambiarla.
 * - Cierra (revoca) sus sesiones del portal abiertas: quien la tuviera con la contraseña vieja sale.
 * - Idempotente: un cliente que ya usaba la por defecto queda igual (y sus sesiones, cerradas).
 * - Diff en `audit.cambios` (`cliente`, campo `portal_contrasena`, siempre `***`).
 */
export default class RestaurarContrasenaPortal extends DomainAction<
    EntradaRestaurarContrasenaPortal,
    ContrasenaPortalCliente
> {
    readonly nombre = 'clientes.restaurar_contrasena_portal'

    protected async handle(input: EntradaRestaurarContrasenaPortal, t: Transaccion) {
        const existe = await t.trx
            .from('core.clientes')
            .where('id', input.cliente_id)
            .forUpdate()
            .select('id')
            .first()
        if (!existe) throw new NoEncontrado(`El cliente ${input.cliente_id} no existe`)
        t.fijarEntidad('cliente', input.cliente_id)

        const borradas = await t.trx
            .from('core.portal_credenciales')
            .where('cliente_id', input.cliente_id)
            .delete()
        const cerradas = (await t.trx
            .from('core.portal_sesiones')
            .where('cliente_id', input.cliente_id)
            .whereNull('revocada_en')
            .where('expira_en', '>', t.trx.knexRawQuery('now()'))
            .update({ revocada_en: t.trx.knexRawQuery('now()') })) as unknown as number
        if (Number(borradas) > 0) {
            await t.registrarCambios(
                { tipo: 'cliente', id: input.cliente_id },
                { portal_contrasena: 'propia' },
                { portal_contrasena: null },
            )
        }
        t.anotarAuditoria({ tenia_propia: Number(borradas) > 0, sesiones_cerradas: Number(cerradas) })
        const vista = await verContrasenaPortalCliente(t.trx, input.cliente_id)
        return { ...vista, sesiones_cerradas: Number(cerradas) }
    }
}
