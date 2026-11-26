import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado, Prohibido, ReglaNegocio } from '#shared/errores'
import { actualizarConVersion, verificarVersion } from '#shared/version'
import type { ContextoAccion } from '#shared/contexto'
import { FORMA_NIT, limpiarDocumento } from '#core/nit_cui'

export interface EntradaVerificarNit {
    cliente_id: number
    version: number
    /** cómo lo confirmó la persona: con el documento o con la consulta SAT/FEL del panel */
    metodo: 'documento' | 'consulta_sat'
}

export interface NitVerificado {
    cliente_id: number
    nit_verificado_en: string
    nit_verificado_por: number
    version: number
}

/** 422 `nit_no_verificable`: el cliente no tiene un NIT válido que verificar. */
export class NitNoVerificable extends ReglaNegocio {
    constructor() {
        super('El cliente no tiene un NIT que verificar (tipo nit con forma de NIT)', 'nit_no_verificable')
    }
}

/**
 * Solo una persona con sesión en el panel: nunca un token de API (tampoco el de Iris), un agente de
 * IA ni una actuación vinculada (contrato Iris 0.14.1 §10.11: nunca A43 ni el token de Iris).
 */
export function exigirPersonaDelPanel(ctx: ContextoAccion, detalle: string): number {
    if (ctx.actor.tipo !== 'usuario' || ctx.actor.id === null || ctx.via || ctx.iris) {
        throw new Prohibido(detalle)
    }
    return ctx.actor.id
}

/**
 * `clientes.verificar_nit` (`POST /clientes/:id/verificar-nit`, contrato Iris 0.14.1 §3.4.4 y §10.11
 * ajuste b): una persona del panel confirma que el NIT del cliente es suyo (con el documento o con
 * la consulta SAT/FEL) y lo marca con `nit_verificado_en` y `nit_verificado_por`. Solo un cliente
 * `tipo = empresa` con NIT verificado cuenta como titular existente en el cambio de titular por NIT.
 *
 * La marca se borra sola cuando cambia `nit_cui` (trigger `core.borrar_nit_verificado`; `clientes.editar`
 * deja el diff). Control por `version` (409). Diff en `audit.cambios`; no emite evento (la marca no
 * sale a otros sistemas).
 */
export default class VerificarNitCliente extends DomainAction<EntradaVerificarNit, NitVerificado> {
    readonly nombre = 'clientes.verificar_nit'

    protected async handle(input: EntradaVerificarNit, t: Transaccion): Promise<NitVerificado> {
        t.fijarEntidad('cliente', input.cliente_id)
        const usuarioId = exigirPersonaDelPanel(t.ctx, 'El NIT lo verifica una persona desde el panel')
        const antes = (await t.trx
            .from('core.clientes')
            .where('id', input.cliente_id)
            .forUpdate()
            .select('tipo_documento_fiscal', 'nit_cui', 'nit_verificado_en', 'nit_verificado_por', 'version')
            .first()) as {
            tipo_documento_fiscal: string
            nit_cui: string | null
            nit_verificado_en: Date | null
            nit_verificado_por: number | null
            version: number
        } | null
        if (!antes) throw new NoEncontrado(`El cliente ${input.cliente_id} no existe`)
        verificarVersion('core.clientes', input.cliente_id, Number(antes.version), input.version)
        // forma de NIT (`revisarNit`), no el módulo 11: lo confirma la persona o el certificador
        // (`contratos/fel-establecimientos.md` R1)
        if (
            antes.tipo_documento_fiscal !== 'nit' ||
            !antes.nit_cui ||
            !FORMA_NIT.test(limpiarDocumento(antes.nit_cui))
        ) {
            throw new NitNoVerificable()
        }
        await actualizarConVersion(t.trx, 'core.clientes', input.cliente_id, input.version, {
            nit_verificado_en: t.trx.knexRawQuery('now()'),
            nit_verificado_por: usuarioId,
        })
        const despues = (await t.trx
            .from('core.clientes')
            .where('id', input.cliente_id)
            .select('nit_verificado_en', 'nit_verificado_por', 'version')
            .first()) as { nit_verificado_en: Date; nit_verificado_por: number; version: number }
        await t.registrarCambios(
            { tipo: 'cliente', id: input.cliente_id },
            { nit_verificado_en: antes.nit_verificado_en, nit_verificado_por: antes.nit_verificado_por },
            { nit_verificado_en: despues.nit_verificado_en, nit_verificado_por: despues.nit_verificado_por },
        )
        return {
            cliente_id: input.cliente_id,
            nit_verificado_en: new Date(despues.nit_verificado_en).toISOString(),
            nit_verificado_por: Number(despues.nit_verificado_por),
            version: Number(despues.version),
        }
    }
}
