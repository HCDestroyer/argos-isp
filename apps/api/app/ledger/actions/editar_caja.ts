import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ConflictoVersion, NoEncontrado, ValidacionFallida } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { listarCajas, usuariosDeCaja, type CajaVista } from '#ledger/cajas'

/**
 * `cajas.editar` (`PUT /cajas/:id`): las marcas de una caja (B11 del plan de contabilidad; decisiones
 * del PM del 25 y 26 nov 2026).
 *
 * - `fiscal`: false = **caja sin factura**. Sus cobros emiten un recibo no fiscal con numeración
 *   propia y no van a la SAT; sus gastos van a la cuenta interna `5.7.01`. Vale para una caja de
 *   cobros o una caja chica (N1). Se permite aunque la empresa tenga FEL obligatoria: la respuesta
 *   trae `aviso_sin_factura`.
 * - `usuarios`: quiénes ven y usan la caja (operar, cierres y movimientos). Vacío = todos los que la
 *   alcanzan por el ACL. Lo puede tener cualquier caja; en una sin factura es lo normal.
 * - `cajero_id` (en una caja chica, su encargado).
 *
 * Solo cambia lo que se envía; `version` (409 `conflicto_version`). Diff en `audit.cambios` y evento
 * `caja.cambiada` con los nombres de los campos.
 */

export interface EntradaEditarCaja {
    caja_id: number
    version: number
    fiscal?: boolean
    usuarios?: number[]
    cajero_id?: number | null
}

export default class EditarCaja extends DomainAction<EntradaEditarCaja, CajaVista> {
    readonly nombre = 'cajas.editar'

    protected async handle(input: EntradaEditarCaja, t: Transaccion): Promise<CajaVista> {
        t.fijarEntidad('caja', input.caja_id)
        const caja = (await t.trx
            .from('ledger.cajas')
            .where('id', input.caja_id)
            .forUpdate()
            .select('id', 'empresa_id', 'fiscal', 'cajero_id', 'version')
            .first()) as {
            id: number
            empresa_id: number
            fiscal: boolean
            cajero_id: number | null
            version: number
        } | null
        if (!caja) throw new NoEncontrado(`La caja ${input.caja_id} no existe`)
        const empresaId = Number(caja.empresa_id)
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        if (Number(caja.version) !== input.version) throw new ConflictoVersion('caja', input.caja_id)

        const pedidos = [
            ...new Set([...(input.usuarios ?? []), ...(input.cajero_id ? [input.cajero_id] : [])]),
        ]
        if (pedidos.length > 0) {
            const existen = (await t.trx.from('core.usuarios').whereIn('id', pedidos).select('id')) as Array<{
                id: number
            }>
            const faltan = pedidos.filter((id) => !existen.some((e) => Number(e.id) === id))
            if (faltan.length > 0) {
                throw new ValidacionFallida(
                    faltan.map((id) => ({
                        field: input.cajero_id === id ? 'cajero_id' : 'usuarios',
                        message: `El usuario ${id} no existe`,
                        rule: 'exists',
                    })),
                )
            }
        }

        const antesUsuarios = await usuariosDeCaja(t.trx, caja.id)
        const antes = {
            fiscal: Boolean(caja.fiscal),
            cajero_id: caja.cajero_id === null ? null : Number(caja.cajero_id),
            usuarios: antesUsuarios,
        }
        const despues = {
            fiscal: input.fiscal ?? antes.fiscal,
            cajero_id: input.cajero_id === undefined ? antes.cajero_id : input.cajero_id,
            usuarios:
                input.usuarios === undefined
                    ? antes.usuarios
                    : [...new Set(input.usuarios)].sort((a, b) => a - b),
        }
        const campos = (['fiscal', 'cajero_id', 'usuarios'] as const).filter(
            (c) => JSON.stringify(antes[c]) !== JSON.stringify(despues[c]),
        )
        if (campos.length === 0) {
            const cajas = await listarCajas(undefined, [empresaId], t.trx)
            return cajas.find((c) => c.id === caja.id)!
        }

        await t.trx
            .from('ledger.cajas')
            .where('id', caja.id)
            .update({
                fiscal: despues.fiscal,
                cajero_id: despues.cajero_id,
                usuarios: despues.usuarios,
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        await t.registrarCambios({ tipo: 'caja', id: caja.id }, antes, despues)
        const cajas = await listarCajas(undefined, [empresaId], t.trx)
        const vista = cajas.find((c) => c.id === caja.id)!
        await t.emit('caja.cambiada', {
            caja_id: caja.id,
            empresa_id: empresaId,
            campos: [...campos],
            fiscal: despues.fiscal,
            tipo: vista.tipo,
        })
        return vista
    }
}
