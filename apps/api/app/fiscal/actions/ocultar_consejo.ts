import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { NoEncontrado, ValidacionFallida } from '#shared/errores'
import { empresaFiscal } from '#fiscal/comun'
import { catalogoConsejos, ocultosVigentes } from '#fiscal/consejos'

/**
 * `fiscal.ocultar_consejo` (permiso `fiscal.configurar`; `POST /fiscal/consejos/:clave/ocultar` y
 * `/mostrar`, contrato §9.4 y §11.1; fase 8 PR C): oculta o vuelve a mostrar un consejo del catálogo
 * para toda la empresa (`alcance: 'empresa'`, por defecto) o solo para quien lo pide
 * (`alcance: 'usuario'`). Solo inserción en `fiscal.consejos_ocultos`; queda en la auditoría y en
 * `audit.cambios` (`consejo_fiscal`). No toca nada contable. Sin evento (es una preferencia de
 * pantalla, no un hecho de negocio).
 *
 * 404 si la clave no está en el catálogo del país; 422 `alcance` con `usuario` sin usuario (sistema).
 */

export interface EntradaOcultarConsejo {
    empresa_id?: number | null
    clave: string
    oculto: boolean
    alcance?: 'empresa' | 'usuario'
    motivo?: string | null
}

export interface ConsejoOcultado {
    id: number
    empresa_id: number
    clave: string
    oculto: boolean
    alcance: 'empresa' | 'usuario'
    usuario_id: number | null
}

export default class OcultarConsejo extends DomainAction<EntradaOcultarConsejo, ConsejoOcultado> {
    readonly nombre = 'fiscal.ocultar_consejo'

    protected async handle(input: EntradaOcultarConsejo, t: Transaccion): Promise<ConsejoOcultado> {
        const { empresaId } = await empresaFiscal(t, input.empresa_id)
        const catalogo = await catalogoConsejos(t.trx, empresaId)
        if (!catalogo.some((c) => c.clave === input.clave)) {
            throw new NoEncontrado(`El consejo ${input.clave} no existe en el catálogo`)
        }
        const alcance = input.alcance ?? 'empresa'
        const usuario = usuarioDelActor(t.ctx.actor)
        if (alcance === 'usuario' && usuario === null) {
            throw new ValidacionFallida([
                { field: 'alcance', message: 'Ocultar solo para mí requiere un usuario', rule: 'alcance' },
            ])
        }
        const usuarioId = alcance === 'usuario' ? usuario : null
        const antes = (await ocultosVigentes(t.trx, empresaId, usuarioId))(input.clave)
        const [fila] = (await t.trx
            .insertQuery()
            .table('fiscal.consejos_ocultos')
            .insert({
                empresa_id: empresaId,
                clave: input.clave,
                usuario_id: usuarioId,
                oculto: input.oculto,
                motivo: input.motivo?.trim() || null,
                registrado_por: usuario,
            })
            .returning('id')) as Array<{ id: number }>
        const id = Number(fila!.id)
        t.fijarEntidad('consejo_fiscal', id)
        await t.registrarCambios(
            { tipo: 'consejo_fiscal', id },
            { [`${input.clave}:${alcance}`]: antes.oculto },
            { [`${input.clave}:${alcance}`]: input.oculto },
        )
        return {
            id,
            empresa_id: empresaId,
            clave: input.clave,
            oculto: input.oculto,
            alcance,
            usuario_id: usuarioId,
        }
    }
}
