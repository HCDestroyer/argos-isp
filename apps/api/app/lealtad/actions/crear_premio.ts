import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ReglaNegocio, ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { verPrograma } from '#lealtad/programas'
import {
    camposAuditables,
    verPremio,
    type PremioVista,
    type TipoDescuento,
    type TipoPremio,
} from '#lealtad/premios'

/**
 * `lealtad.crear_premio` (`POST /lealtad/premios`, permiso `lealtad.configurar`): premio del
 * catálogo de un programa (§3 y §5). Campos por tipo:
 *
 * - `descuento_factura`: `descuento_tipo` (`monto` o `porcentaje` ≤ 100) y `descuento_valor`; `tope`
 *   opcional (Q máximos de un porcentaje). Se aplica sobre la línea del plan, nunca bajo cero.
 * - `mes_gratis`: el 100 % de la línea del plan (sin más campos).
 * - `mejora_plan`: `plan_destino_id` (plan activo) y `dias`.
 * - `bien`: `costo_unitario` opcional (el canje queda bloqueado hasta que el
 *   contador decida el IVA del premio en especie, `premio_bien_iva`).
 * - `boletos`: llega con los sorteos (fase 3): 422 `recompensa_no_disponible`.
 *
 * `existencias` (cualquier tipo): unidades disponibles; null = sin límite. `audit.cambios` y
 * `lealtad.programa_cambiado` (`premios`).
 */

export interface EntradaPremio {
    programa_id: number
    tipo: TipoPremio
    nombre: string
    costo_puntos: number
    descuento_tipo?: TipoDescuento | null
    descuento_valor?: string | null
    tope?: string | null
    plan_destino_id?: number | null
    dias?: number | null
    costo_unitario?: string | null
    existencias?: number | null
    en_portal?: boolean
    activo?: boolean
}

export interface CamposPremio {
    descuento_tipo: TipoDescuento | null
    descuento_valor: string | null
    tope: string | null
    plan_destino_id: number | null
    dias: number | null
    costo_unitario: string | null
    existencias: number | null
}

/** Valida los campos del tipo y deja en null los que el tipo no usa. */
export async function camposDelTipo(
    cliente: QueryClientContract,
    tipo: TipoPremio,
    c: CamposPremio,
): Promise<CamposPremio> {
    if (tipo === 'boletos') {
        throw new ReglaNegocio(
            'Los premios de boletos llegan con los sorteos (fase 3)',
            'recompensa_no_disponible',
        )
    }
    const errores: ErrorCampo[] = []
    const vacio: CamposPremio = {
        descuento_tipo: null,
        descuento_valor: null,
        tope: null,
        plan_destino_id: null,
        dias: null,
        costo_unitario: null,
        // las existencias aplican a cualquier premio (null = sin límite)
        existencias: c.existencias,
    }
    if (tipo === 'descuento_factura') {
        if (!c.descuento_tipo) {
            errores.push({ field: 'descuento_tipo', message: 'Obligatorio en un descuento' })
        }
        if (!c.descuento_valor) {
            errores.push({ field: 'descuento_valor', message: 'Obligatorio en un descuento' })
        }
        if (c.descuento_tipo === 'porcentaje' && c.descuento_valor && Number(c.descuento_valor) > 100) {
            errores.push({ field: 'descuento_valor', message: 'Un porcentaje no pasa de 100' })
        }
        if (errores.length > 0) throw new ValidacionFallida(errores)
        return {
            ...vacio,
            descuento_tipo: c.descuento_tipo,
            descuento_valor: c.descuento_valor,
            tope: c.descuento_tipo === 'porcentaje' ? c.tope : null,
        }
    }
    if (tipo === 'mejora_plan') {
        if (!c.plan_destino_id) {
            errores.push({ field: 'plan_destino_id', message: 'Obligatorio en una mejora de plan' })
        }
        if (!c.dias) errores.push({ field: 'dias', message: 'Obligatorio en una mejora de plan' })
        if (c.plan_destino_id) {
            const plan = await cliente
                .from('network.planes')
                .where('id', c.plan_destino_id)
                .select('activo')
                .first()
            if (!plan || !plan.activo) {
                errores.push({
                    field: 'plan_destino_id',
                    message: 'El plan no existe o está inactivo',
                    rule: 'exists',
                })
            }
        }
        if (errores.length > 0) throw new ValidacionFallida(errores)
        return { ...vacio, plan_destino_id: c.plan_destino_id, dias: c.dias }
    }
    if (tipo === 'bien') return { ...vacio, costo_unitario: c.costo_unitario }
    return vacio
}

export default class CrearPremio extends DomainAction<EntradaPremio, PremioVista> {
    readonly nombre = 'lealtad.crear_premio'

    protected async handle(input: EntradaPremio, t: Transaccion): Promise<PremioVista> {
        const programa = await verPrograma(input.programa_id, t.trx)
        exigirAccesoEmpresa(t.ctx, programa.empresa_id)
        t.fijarEmpresa(programa.empresa_id)
        const campos = await camposDelTipo(t.trx, input.tipo, {
            descuento_tipo: input.descuento_tipo ?? null,
            descuento_valor: input.descuento_valor ?? null,
            tope: input.tope ?? null,
            plan_destino_id: input.plan_destino_id ?? null,
            dias: input.dias ?? null,
            costo_unitario: input.costo_unitario ?? null,
            existencias: input.existencias ?? null,
        })
        const [fila] = (await t.trx
            .insertQuery()
            .table('lealtad.premios')
            .insert({
                empresa_id: programa.empresa_id,
                programa_id: programa.id,
                tipo: input.tipo,
                nombre: input.nombre.trim(),
                costo_puntos: input.costo_puntos,
                ...campos,
                en_portal: input.en_portal ?? false,
                activo: input.activo ?? true,
            })
            .returning('id')) as Array<{ id: number }>
        const premio = await verPremio(Number(fila!.id), t.trx)
        t.fijarEntidad('premio_lealtad', premio.id)
        await t.registrarCambios({ tipo: 'premio_lealtad', id: premio.id }, null, {
            tipo: premio.tipo,
            ...camposAuditables(premio),
        })
        await t.emit('lealtad.programa_cambiado', {
            programa_id: programa.id,
            empresa_id: programa.empresa_id,
            campos: ['premios'],
        })
        return premio
    }
}
