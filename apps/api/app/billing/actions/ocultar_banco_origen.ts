import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { NoEncontrado } from '#shared/errores'
import { resolverEmpresaActiva } from '#core/empresas'
import { verBancoOrigen, type BancoOrigenVista } from '#billing/cuentas_bancarias'

/**
 * `bancos_origen.ocultar` (`POST /bancos-origen/:id/ocultar`) y `bancos_origen.mostrar`
 * (`POST /bancos-origen/:id/mostrar`), decisión del PM 23: la empresa activa oculta (o vuelve a
 * mostrar) un banco del catálogo que no usa. Oculto, no sale en `GET /bancos` de esa empresa; los
 * pagos y comprobantes que ya lo usan no cambian. Idempotente: ocultar lo ya oculto no hace nada.
 * Evento `banco_origen.cambiado` con `empresa_id`, `campos: ['oculto']` y `oculto`.
 */

export interface EntradaOcultarBanco {
    banco_id: number
    empresa_id?: number | null
}

abstract class VisibilidadBanco extends DomainAction<EntradaOcultarBanco, BancoOrigenVista> {
    protected abstract readonly ocultar: boolean

    protected async handle(input: EntradaOcultarBanco, t: Transaccion): Promise<BancoOrigenVista> {
        t.fijarEntidad('banco', input.banco_id)
        const banco = await t.trx.from('billing.bancos').where('id', input.banco_id).select('id').first()
        if (!banco) throw new NoEncontrado(`El banco ${input.banco_id} no existe`)
        const empresaId = input.empresa_id ?? (await resolverEmpresaActiva(t.ctx, t.trx))
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        const cambio = this.ocultar
            ? (
                  (await t.trx.rawQuery(
                      `INSERT INTO billing.bancos_ocultos (empresa_id, banco_id, ocultado_por) VALUES (?, ?, ?)
                   ON CONFLICT DO NOTHING RETURNING banco_id`,
                      [empresaId, input.banco_id, usuarioDelActor(t.ctx.actor) as number],
                  )) as { rows: unknown[] }
              ).rows.length
            : Number(
                  await t.trx
                      .from('billing.bancos_ocultos')
                      .where('empresa_id', empresaId)
                      .where('banco_id', input.banco_id)
                      .delete(),
              )
        if (cambio > 0) {
            await t.registrarCambios(
                { tipo: 'banco', id: input.banco_id },
                { [`oculto_empresa_${empresaId}`]: !this.ocultar },
                { [`oculto_empresa_${empresaId}`]: this.ocultar },
            )
            await t.emit('banco_origen.cambiado', {
                banco_id: input.banco_id,
                empresa_id: empresaId,
                campos: ['oculto'],
                creado: false,
                activo: null,
                oculto: this.ocultar,
            })
        }
        return verBancoOrigen(input.banco_id, empresaId, t.trx)
    }
}

export default class OcultarBancoOrigen extends VisibilidadBanco {
    readonly nombre: string = 'bancos_origen.ocultar'
    protected readonly ocultar: boolean = true
}
