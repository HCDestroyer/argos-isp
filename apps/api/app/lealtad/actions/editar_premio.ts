import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ConflictoVersion } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { camposAuditables, verPremio, type PremioVista, type TipoDescuento } from '#lealtad/premios'
import { camposDelTipo } from '#lealtad/actions/crear_premio'

/**
 * `lealtad.editar_premio` (`PUT /lealtad/premios/:id`, permiso `lealtad.configurar`, con
 * `version`). El tipo y el programa no cambian; `activo: false` lo saca del catálogo (no se borra).
 * Los canjes ya hechos conservan lo que se les aplicó. `audit.cambios` y `lealtad.programa_cambiado`.
 */

export interface EntradaEditarPremio {
    id: number
    version: number
    nombre?: string
    costo_puntos?: number
    descuento_tipo?: TipoDescuento | null
    descuento_valor?: string | null
    tope?: string | null
    plan_destino_id?: number | null
    dias?: number | null
    costo_unitario?: string | null
    existencias?: number | null
    sorteo_id?: number | null
    boletos?: number | null
    en_portal?: boolean
    activo?: boolean
}

const o = <T>(nuevo: T | undefined, actual: T) => (nuevo === undefined ? actual : nuevo)

export default class EditarPremio extends DomainAction<EntradaEditarPremio, PremioVista> {
    readonly nombre = 'lealtad.editar_premio'

    protected async handle(input: EntradaEditarPremio, t: Transaccion): Promise<PremioVista> {
        t.fijarEntidad('premio_lealtad', input.id)
        const actual = await verPremio(input.id, t.trx, true)
        exigirAccesoEmpresa(t.ctx, actual.empresa_id)
        t.fijarEmpresa(actual.empresa_id)
        if (actual.version !== input.version) throw new ConflictoVersion('El premio', input.id)
        const campos = await camposDelTipo(
            t.trx,
            actual.tipo,
            {
                descuento_tipo: o(input.descuento_tipo, actual.descuento_tipo),
                descuento_valor: o(input.descuento_valor, actual.descuento_valor),
                tope: o(input.tope, actual.tope),
                plan_destino_id: o(input.plan_destino_id, actual.plan_destino_id),
                dias: o(input.dias, actual.dias),
                costo_unitario: o(input.costo_unitario, actual.costo_unitario),
                existencias: o(input.existencias, actual.existencias),
                sorteo_id: o(input.sorteo_id, actual.sorteo_id),
                boletos: o(input.boletos, actual.boletos),
            },
            actual.empresa_id,
        )
        await t.trx
            .from('lealtad.premios')
            .where('id', actual.id)
            .update({
                nombre: input.nombre?.trim() || actual.nombre,
                costo_puntos: input.costo_puntos ?? actual.costo_puntos,
                ...campos,
                en_portal: input.en_portal ?? actual.en_portal,
                activo: input.activo ?? actual.activo,
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            })
        const editado = await verPremio(actual.id, t.trx)
        const cambiados = await t.registrarCambios(
            { tipo: 'premio_lealtad', id: actual.id },
            camposAuditables(actual),
            camposAuditables(editado),
        )
        if (cambiados.length > 0) {
            await t.emit('lealtad.programa_cambiado', {
                programa_id: actual.programa_id,
                empresa_id: actual.empresa_id,
                campos: ['premios'],
            })
        }
        return editado
    }
}
