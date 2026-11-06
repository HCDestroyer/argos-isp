import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Problema } from '#shared/errores'
import { usuarioDelActor } from '#shared/contexto'
import {
    CAMPOS_PORTAL_CORTE,
    sinMetadatos,
    verPortalCorte,
    type DatosPortalCorte,
    type ModoSuspension,
    type PortalCorteVista,
} from '#portal/corte'

export interface EntradaConfigurarPortalCorte {
    /** versión leída; 0 si nunca se guardó (los valores salen del entorno) */
    version: number
    portal_v4?: string | null
    portal_v6?: string | null
    portal_puerto?: number
    modo_suspension?: ModoSuspension
}

/**
 * Guarda la configuración del portal de corte (`PUT /corte/configuracion`, permiso `portal_corte.configurar`):
 * IPv4/IPv6 y puerto del dst-nat de los routers y el modo de suspensión de las sesiones.
 *
 * - Versión 0 = nunca se guardó: guarda la siembra del entorno más lo enviado y queda en `version = 1`
 *   (desde ahí el entorno ya no se lee). Si no, control optimista por `version` (409).
 * - Solo cambia los campos enviados; `null` en `portal_v4`/`portal_v6` vuelve a deducirlo / lo quita.
 * - Diff por campo en `audit.cambios` (entidad `portal_corte`, id 1).
 * - Si algo cambió, `portal.config_cambiada` con `empresa_id: null` (global) y los campos: `routeros`
 *   reconcilia el NAT de corte en todos los routers con API y `coa` relee el modo de suspensión.
 */
export default class ConfigurarPortalCorte extends DomainAction<
    EntradaConfigurarPortalCorte,
    PortalCorteVista
> {
    readonly nombre = 'portal_corte.configurar'

    protected async handle(input: EntradaConfigurarPortalCorte, t: Transaccion): Promise<PortalCorteVista> {
        t.fijarEntidad('portal_corte', 1)
        t.fijarEmpresa(null)
        await t.trx.from('core.portal_corte').where('id', 1).forUpdate().select('id')
        const antes = await verPortalCorte(t.trx)
        if (input.version !== antes.version) {
            throw new Problema(
                409,
                'conflicto_version',
                'Conflicto de versión',
                'La configuración del portal de corte cambió en otra sesión; recarga y vuelve a intentar',
            )
        }

        const despuesDatos: DatosPortalCorte = { ...sinMetadatos(antes) }
        if (input.portal_v4 !== undefined) despuesDatos.portal_v4 = input.portal_v4 || null
        if (input.portal_v6 !== undefined) despuesDatos.portal_v6 = input.portal_v6?.toLowerCase() || null
        if (input.portal_puerto !== undefined) despuesDatos.portal_puerto = input.portal_puerto
        if (input.modo_suspension !== undefined) despuesDatos.modo_suspension = input.modo_suspension

        const campos = CAMPOS_PORTAL_CORTE.filter((c) => despuesDatos[c] !== antes[c])
        await t.trx
            .from('core.portal_corte')
            .where('id', 1)
            .update({
                ...despuesDatos,
                version: antes.version + 1,
                updated_by: usuarioDelActor(t.ctx.actor),
                updated_at: t.trx.knexRawQuery('now()'),
            })

        const despues = await verPortalCorte(t.trx)
        await t.registrarCambios({ tipo: 'portal_corte', id: 1 }, sinMetadatos(antes), sinMetadatos(despues))
        if (campos.length > 0) {
            await t.emit('portal.config_cambiada', { empresa_id: null, campos: [...campos] })
        }
        return despues
    }
}
