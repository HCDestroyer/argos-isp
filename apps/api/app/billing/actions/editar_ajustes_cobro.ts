import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, ValidacionFallida } from '#shared/errores'
import { resolverEmpresaActiva } from '#core/empresas'
import {
    CAMPOS_AJUSTES_COBRO,
    PAUSA_TOPE_MAXIMO,
    leerAjustesCobro,
    type AjustesCobro,
    type CampoAjustesCobro,
} from '#billing/ajustes_cobro'

/**
 * `ajustes_cobro.editar` (`PUT /ajustes-cobro`): ajustes de cobro y libro de la empresa activa
 * (decisiones del PM 10 y 16). Con `version` (la leída; 0 si nunca se guardó): 409 `conflicto_version`
 * si cambió. Solo cambia lo que viene. Deja el diff en `audit.cambios` y emite
 * `ajustes_cobro.cambiados` con los nombres de los campos (sin cambios no emite).
 */

export interface EntradaEditarAjustesCobro {
    empresa_id?: number | null
    version: number
    asientos_requieren_aprobacion?: boolean
    pausa_tope_dias?: number
}

export default class EditarAjustesCobro extends DomainAction<EntradaEditarAjustesCobro, AjustesCobro> {
    readonly nombre = 'ajustes_cobro.editar'

    protected async handle(input: EntradaEditarAjustesCobro, t: Transaccion): Promise<AjustesCobro> {
        const empresaId = input.empresa_id ?? (await resolverEmpresaActiva(t.ctx, t.trx))
        t.fijarEmpresa(empresaId)
        t.fijarEntidad('empresa', empresaId)
        if (
            input.pausa_tope_dias !== undefined &&
            (!Number.isInteger(input.pausa_tope_dias) ||
                input.pausa_tope_dias < 1 ||
                input.pausa_tope_dias > PAUSA_TOPE_MAXIMO)
        ) {
            throw new ValidacionFallida([
                {
                    field: 'pausa_tope_dias',
                    message: `Entre 1 y ${PAUSA_TOPE_MAXIMO} días`,
                    rule: 'range',
                },
            ])
        }
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(3021, ?::int)', [empresaId])
        const antes = await leerAjustesCobro(empresaId, t.trx)
        if (antes.version !== input.version) {
            throw new Conflicto(
                `Los ajustes cambiaron (versión ${antes.version}); vuelve a leerlos`,
                'conflicto_version',
                'Conflicto de versión',
            )
        }
        const despues = {
            asientos_requieren_aprobacion:
                input.asientos_requieren_aprobacion ?? antes.asientos_requieren_aprobacion,
            pausa_tope_dias: input.pausa_tope_dias ?? antes.pausa_tope_dias,
        }
        const campos = CAMPOS_AJUSTES_COBRO.filter((c) => despues[c] !== antes[c]) as CampoAjustesCobro[]
        if (campos.length === 0) return antes

        const usuario = usuarioDelActor(t.ctx.actor)
        await t.trx.rawQuery(
            `INSERT INTO billing.ajustes_cobro (empresa_id, asientos_requieren_aprobacion, pausa_tope_dias, updated_by)
             VALUES (?, ?, ?, ?)
             ON CONFLICT (empresa_id) DO UPDATE
                SET asientos_requieren_aprobacion = EXCLUDED.asientos_requieren_aprobacion,
                    pausa_tope_dias = EXCLUDED.pausa_tope_dias,
                    updated_by = EXCLUDED.updated_by,
                    version = billing.ajustes_cobro.version + 1,
                    updated_at = now()`,
            [empresaId, despues.asientos_requieren_aprobacion, despues.pausa_tope_dias, usuario as number],
        )
        await t.registrarCambios(
            { tipo: 'ajustes_cobro', id: empresaId },
            {
                asientos_requieren_aprobacion: antes.asientos_requieren_aprobacion,
                pausa_tope_dias: antes.pausa_tope_dias,
            },
            despues,
        )
        await t.emit('ajustes_cobro.cambiados', { empresa_id: empresaId, campos })
        return leerAjustesCobro(empresaId, t.trx)
    }
}
