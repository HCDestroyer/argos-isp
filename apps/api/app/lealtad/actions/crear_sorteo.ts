import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { exigirEmpresaActiva, resolverEmpresaActiva } from '#core/empresas'
import { dec, tieneCentavosExactos } from '#ledger/dinero'
import { fechaValida } from '#ledger/fechas'
import {
    detalleSorteo,
    type BasesSorteo,
    type CriteriosSorteo,
    type TipoPremioSorteo,
} from '#lealtad/sorteos'

/**
 * `sorteos.crear` (`POST /lealtad/sorteos`, permiso `sorteos.gestionar`): sorteo en `borrador` de una
 * empresa (la indicada o la activa), con sus bases (§7.2), criterios del corte y premios. Todo se
 * puede editar hasta publicar las bases; desde ahí se congela (trigger). `audit.cambios`.
 *
 * Criterios (decisión del líder): al cerrar el corte, `boletos_por_servicio` boletos por cada servicio
 * activo sin facturas vencidas del cliente en la empresa, más los boletos canjeados con puntos si
 * `admite_canje`. Sin inscripción.
 */

export interface PremioSorteoEntrada {
    nombre: string
    cantidad?: number
    imagen_url?: string | null
    valor: string
    tipo: TipoPremioSorteo
    /** `servicio`: premio del catálogo de lealtad (`descuento_factura` o `mes_gratis`) que se entrega */
    premio_id?: number | null
    retiene_isr?: boolean
    isr_pct?: string | null
}

export interface EntradaSorteo {
    empresa_id?: number | null
    nombre: string
    descripcion?: string | null
    bases?: BasesSorteo
    criterios?: Partial<CriteriosSorteo>
    inscripcion_desde?: string | null
    corte_en?: Date | string | null
    fecha_sorteo?: Date | string | null
    lugar?: string | null
    suplentes?: number
    premios?: PremioSorteoEntrada[]
}

export function criteriosDe(
    c: Partial<CriteriosSorteo> | undefined,
    previos?: CriteriosSorteo,
): CriteriosSorteo {
    return {
        boletos_por_servicio: c?.boletos_por_servicio ?? previos?.boletos_por_servicio ?? 1,
        admite_canje: c?.admite_canje ?? previos?.admite_canje ?? false,
    }
}

/** Valida los premios y devuelve las filas a insertar (posición = orden de la lista). */
export async function filasPremios(
    cliente: QueryClientContract,
    empresaId: number,
    premios: PremioSorteoEntrada[],
): Promise<Array<Record<string, unknown>>> {
    const errores: ErrorCampo[] = []
    const filas: Array<Record<string, unknown>> = []
    for (const [i, p] of premios.entries()) {
        const valor = dec(p.valor)
        if (!valor.gt(0) || !tieneCentavosExactos(valor)) {
            errores.push({
                field: `premios.${i}.valor`,
                message: 'El valor debe ser mayor que 0',
                rule: 'valor',
            })
        }
        if (p.tipo === 'servicio') {
            const premio = p.premio_id
                ? ((await cliente
                      .from('lealtad.premios')
                      .where('id', p.premio_id)
                      .select('empresa_id', 'tipo')
                      .first()) as { empresa_id: number; tipo: string } | null)
                : null
            if (
                !premio ||
                Number(premio.empresa_id) !== empresaId ||
                !['descuento_factura', 'mes_gratis'].includes(premio.tipo)
            ) {
                errores.push({
                    field: `premios.${i}.premio_id`,
                    message:
                        'Un premio de servicio usa un descuento o mes gratis del catálogo de lealtad de la empresa',
                    rule: 'premio',
                })
            }
        } else if (p.premio_id) {
            errores.push({
                field: `premios.${i}.premio_id`,
                message: 'Solo un premio de servicio usa el catálogo',
                rule: 'premio',
            })
        }
        filas.push({
            posicion: i + 1,
            nombre: p.nombre.trim(),
            cantidad: p.cantidad ?? 1,
            imagen_url: p.imagen_url?.trim() || null,
            valor: valor.toFixed(2),
            tipo: p.tipo,
            premio_id: p.tipo === 'servicio' ? p.premio_id : null,
            retiene_isr: p.retiene_isr ?? false,
            isr_pct: p.isr_pct ?? '10.00',
        })
    }
    if (errores.length > 0) throw new ValidacionFallida(errores)
    return filas
}

export function fechaHora(valor: Date | string | null | undefined): Date | null {
    if (valor === null || valor === undefined) return null
    return valor instanceof Date ? valor : new Date(valor)
}

export default class CrearSorteo extends DomainAction<
    EntradaSorteo,
    Awaited<ReturnType<typeof detalleSorteo>>
> {
    readonly nombre = 'sorteos.crear'

    protected async handle(input: EntradaSorteo, t: Transaccion) {
        let empresaId: number
        if (input.empresa_id) {
            await exigirEmpresaActiva(t.trx, input.empresa_id)
            empresaId = input.empresa_id
        } else {
            empresaId = await resolverEmpresaActiva(t.ctx, t.trx)
        }
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        const programa = (await t.trx
            .from('lealtad.programas')
            .where('empresa_id', empresaId)
            .orderBy('id', 'desc')
            .select('id')
            .first()) as { id: number } | null
        const premios = await filasPremios(t.trx, empresaId, input.premios ?? [])
        const [fila] = (await t.trx
            .insertQuery()
            .table('lealtad.sorteos')
            .insert({
                empresa_id: empresaId,
                programa_id: programa ? Number(programa.id) : null,
                nombre: input.nombre.trim(),
                descripcion: input.descripcion?.trim() || null,
                bases: JSON.stringify(input.bases ?? {}),
                criterios: JSON.stringify(criteriosDe(input.criterios)),
                inscripcion_desde: input.inscripcion_desde ? fechaValida(input.inscripcion_desde) : null,
                corte_en: fechaHora(input.corte_en),
                fecha_sorteo: fechaHora(input.fecha_sorteo),
                lugar: input.lugar?.trim() || null,
                suplentes: input.suplentes ?? 0,
            })
            .returning('id')) as Array<{ id: number }>
        const id = Number(fila!.id)
        t.fijarEntidad('sorteo', id)
        if (premios.length > 0) {
            await t.trx
                .insertQuery()
                .table('lealtad.sorteos_premios')
                .multiInsert(premios.map((p) => ({ ...p, sorteo_id: id })))
        }
        const detalle = await detalleSorteo(id, t.trx)
        await t.registrarCambios({ tipo: 'sorteo', id }, null, {
            nombre: detalle.nombre,
            estado: detalle.estado,
            bases: detalle.bases,
            criterios: detalle.criterios,
            premios: detalle.premios.length,
        })
        return detalle
    }
}
