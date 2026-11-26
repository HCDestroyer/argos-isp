import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { ConflictoVersion, ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { exigirEmpresaActiva, resolverEmpresaActiva } from '#core/empresas'
import { aTexto, dec, tieneCentavosExactos } from '#ledger/dinero'
import { ajustesCajas, type AjustesCajas } from '#ledger/custodia'

/**
 * `cajas.configurar` (`PUT /cajas/ajustes`): ajustes de las cajas de cobros y la custodia de una
 * empresa (decisiones del PM del 26 nov 2026): fondo de cambio (Q200), plazo para depositar lo que
 * se tiene en custodia (1 día hábil), tope por persona (Q5,000) y «lo deposito yo» (encendido).
 *
 * Solo cambia lo que se envía. `version` (la de `GET /cajas/ajustes`; 0 = de fábrica) para el
 * control optimista: 409 `conflicto_version`. Diff en `audit.cambios` y evento
 * `cajas.ajustes_cambiados` con los nombres de los campos que cambiaron.
 */

export interface EntradaConfigurarCajas {
    empresa_id?: number | null
    version: number
    fondo_cobros?: string
    custodia_plazo_dias?: number
    custodia_tope?: string
    autoentrega?: boolean
}

const CAMPOS = ['fondo_cobros', 'custodia_plazo_dias', 'custodia_tope', 'autoentrega'] as const

export default class ConfigurarCajas extends DomainAction<EntradaConfigurarCajas, AjustesCajas> {
    readonly nombre = 'cajas.configurar'

    protected async handle(input: EntradaConfigurarCajas, t: Transaccion): Promise<AjustesCajas> {
        let empresaId: number
        if (input.empresa_id) {
            await exigirEmpresaActiva(t.trx, input.empresa_id)
            empresaId = input.empresa_id
        } else {
            empresaId = await resolverEmpresaActiva(t.ctx, t.trx)
        }
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        t.fijarEntidad('empresa', empresaId)

        const errores: ErrorCampo[] = []
        for (const campo of ['fondo_cobros', 'custodia_tope'] as const) {
            const valor = input[campo]
            if (valor === undefined) continue
            const monto = dec(valor)
            if (monto.isNegative() || !tieneCentavosExactos(monto)) {
                errores.push({ field: campo, message: 'Monto inválido (≥ 0, 2 decimales)', rule: 'monto' })
            }
        }
        if (errores.length > 0) throw new ValidacionFallida(errores)

        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?)', [3102, empresaId])
        const antes = await ajustesCajas(empresaId, t.trx)
        if (antes.version !== input.version) throw new ConflictoVersion('ajustes_cajas', empresaId)
        const despues = {
            fondo_cobros: input.fondo_cobros === undefined ? antes.fondo_cobros : aTexto(input.fondo_cobros),
            custodia_plazo_dias: input.custodia_plazo_dias ?? antes.custodia_plazo_dias,
            custodia_tope:
                input.custodia_tope === undefined ? antes.custodia_tope : aTexto(input.custodia_tope),
            autoentrega: input.autoentrega ?? antes.autoentrega,
        }
        const campos = CAMPOS.filter((c) => String(antes[c]) !== String(despues[c]))
        if (campos.length === 0) return antes

        const usuario = usuarioDelActor(t.ctx.actor)
        await t.trx
            .knexQuery()
            .table('ledger.cajas_ajustes')
            .insert({ empresa_id: empresaId, ...despues, actualizado_por: usuario })
            .onConflict('empresa_id')
            .merge({
                ...despues,
                actualizado_por: usuario,
                version: t.trx.knexRawQuery('ledger.cajas_ajustes.version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            })
        const planos = (a: typeof despues) => Object.fromEntries(CAMPOS.map((c) => [c, a[c]]))
        await t.registrarCambios({ tipo: 'ajustes_cajas', id: empresaId }, planos(antes), planos(despues))
        await t.emit('cajas.ajustes_cambiados', { empresa_id: empresaId, campos: [...campos] })
        return ajustesCajas(empresaId, t.trx)
    }
}
