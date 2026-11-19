import hash from '@adonisjs/core/services/hash'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { resolverEmpresaActiva } from '#core/empresas'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ConflictoVersion } from '#shared/errores'

export interface EntradaConfigurarContrasenaDefecto {
    /** en claro solo en la petición; se guarda el hash y se audita como `***` */
    contrasena: string
    /** versión leída (`GET /portal/contrasena-defecto`); 0 si nunca se configuró */
    version: number
}

/** Espejo del schema `PortalContrasenaDefecto`. Nunca lleva la contraseña ni su hash. */
export interface ContrasenaDefectoVista {
    empresa_id: number
    configurada: boolean
    actualizada_en: string | null
    version: number
}

export async function verContrasenaDefecto(
    cliente: QueryClientContract,
    empresaId: number,
): Promise<ContrasenaDefectoVista> {
    const fila = (await cliente
        .from('core.portal_contrasenas_defecto')
        .where('empresa_id', empresaId)
        .select('actualizada_en', 'version')
        .first()) as { actualizada_en: Date; version: number } | null
    return {
        empresa_id: empresaId,
        configurada: fila !== null,
        actualizada_en: fila ? fila.actualizada_en.toISOString() : null,
        version: fila ? Number(fila.version) : 0,
    }
}

/**
 * Configura la contraseña por defecto del portal de la empresa activa
 * (`PUT /portal/contrasena-defecto`, permiso `portal.configurar_contrasena_defecto`).
 *
 * - Un cliente sin contraseña propia entra al portal con su documento y esta contraseña, y el portal
 *   le exige cambiarla antes de seguir.
 * - Empresa activa (`X-Empresa-Id` o la única): 422 `empresa_requerida`, 403 `empresa_no_permitida`.
 * - Solo se guarda el hash (`hash.make`, scrypt). En `audit.acciones` la entrada queda `***` y en
 *   `audit.cambios` el campo `portal_contrasena_defecto` también (`esCampoSensible`).
 * - `version` 0 la crea; si no, control optimista (409 `conflicto_version`).
 * - Cambiarla no toca a los clientes que ya tienen su propia contraseña ni cierra sesiones.
 */
export default class ConfigurarContrasenaDefecto extends DomainAction<
    EntradaConfigurarContrasenaDefecto,
    ContrasenaDefectoVista
> {
    readonly nombre = 'portal.configurar_contrasena_defecto'

    protected async handle(
        input: EntradaConfigurarContrasenaDefecto,
        t: Transaccion,
    ): Promise<ContrasenaDefectoVista> {
        const empresaId = await resolverEmpresaActiva(t.ctx, t.trx)
        t.fijarEntidad('empresa', empresaId)
        t.fijarEmpresa(empresaId)
        await t.trx.from('core.empresas').where('id', empresaId).forUpdate().select('id')

        const antes = await verContrasenaDefecto(t.trx, empresaId)
        if (antes.version !== input.version) throw new ConflictoVersion('empresa', empresaId)

        const contrasenaHash = await hash.make(input.contrasena)
        if (antes.configurada) {
            await t.trx
                .from('core.portal_contrasenas_defecto')
                .where('empresa_id', empresaId)
                .update({
                    contrasena_hash: contrasenaHash,
                    actualizada_en: t.trx.knexRawQuery('now()'),
                    version: antes.version + 1,
                })
        } else {
            await t.trx
                .insertQuery()
                .table('core.portal_contrasenas_defecto')
                .insert({ empresa_id: empresaId, contrasena_hash: contrasenaHash })
        }
        // El valor nunca se escribe: `portal_contrasena_defecto` es sensible y queda `***` → `***`
        // (o null → `***` la primera vez).
        await t.registrarCambios(
            { tipo: 'empresa', id: empresaId },
            { portal_contrasena_defecto: antes.configurada ? 'anterior' : null },
            { portal_contrasena_defecto: 'nueva' },
        )
        return verContrasenaDefecto(t.trx, empresaId)
    }
}
