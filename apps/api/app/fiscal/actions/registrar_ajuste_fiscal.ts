import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, NoEncontrado, ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { exigirAccesoEmpresa, filtrarPorEmpresa } from '#shared/empresa_activa'
import { aTexto, dec } from '#ledger/dinero'
import { empresaFiscal } from '#fiscal/comun'
import { LOCK_DECLARACIONES } from '#fiscal/declaraciones'
import { ejercicioCerrado, type AjusteFiscal } from '#fiscal/declaraciones_renta'

/**
 * `declaraciones.ajustar` (`POST /declaraciones/ajustes`, fase 7 PR C; contrato §21): registra un ajuste
 * fiscal que lleva el resultado contable a la renta imponible del ISR por cierre parcial (un trimestre)
 * o anual (`trimestre` null): `efecto` `suma` (gasto no deducible que el libro no marca, por ejemplo) o
 * `resta` (renta exenta). Solo inserción: para quitarlo se registra otro con `anula_a` (repite año,
 * trimestre, efecto y monto del anulado; uno solo por ajuste, 409 `ajuste_anulado`).
 *
 * - Un ajuste anual de un ejercicio con cierre vigente: 409 `ejercicio_cerrado`.
 * - El borrador de ese periodo queda desactualizado (otro `datos_hash`): se calcula otra versión.
 * - Sin evento: no cambia el estado de nada; queda en la auditoría y en `audit.cambios`.
 */

export interface EntradaAjusteFiscal {
    empresa_id?: number | null
    anio?: number | null
    trimestre?: number | null
    efecto?: 'suma' | 'resta' | null
    concepto: string
    monto?: string | null
    /** id del ajuste que esta fila anula */
    anula_a?: number | null
}

export default class RegistrarAjusteFiscal extends DomainAction<EntradaAjusteFiscal, AjusteFiscal> {
    readonly nombre = 'declaraciones.ajustar'

    protected async handle(input: EntradaAjusteFiscal, t: Transaccion): Promise<AjusteFiscal> {
        const concepto = input.concepto?.trim() ?? ''
        let empresaId: number
        let anio: number
        let trimestre: number | null
        let efecto: 'suma' | 'resta'
        let monto: string
        if (input.anula_a) {
            const anulado = await verAjuste(input.anula_a, t.trx)
            exigirAccesoEmpresa(t.ctx, anulado.empresa_id)
            t.fijarEmpresa(anulado.empresa_id)
            ;({ empresa_id: empresaId, anio, trimestre, efecto, monto } = anulado)
            if (anulado.anula_a !== null) {
                throw new ValidacionFallida([
                    {
                        field: 'anula_a',
                        message: `El ajuste ${anulado.id} ya es una anulación`,
                        rule: 'anula_a',
                    },
                ])
            }
            if (anulado.anulado_por_ajuste !== null) {
                throw new Conflicto(
                    `El ajuste ${anulado.id} ya fue anulado por el ${anulado.anulado_por_ajuste}`,
                    'ajuste_anulado',
                    'Ajuste anulado',
                )
            }
        } else {
            const errores: ErrorCampo[] = []
            if (!Number.isInteger(input.anio) || input.anio! < 2000 || input.anio! > 2100) {
                errores.push({ field: 'anio', message: 'Año AAAA', rule: 'anio' })
            }
            if (
                input.trimestre !== null &&
                input.trimestre !== undefined &&
                ![1, 2, 3, 4].includes(input.trimestre)
            ) {
                errores.push({ field: 'trimestre', message: '1 a 4, o null para el año', rule: 'trimestre' })
            }
            if (input.efecto !== 'suma' && input.efecto !== 'resta') {
                errores.push({ field: 'efecto', message: 'suma o resta', rule: 'enum' })
            }
            if (!/^\d{1,12}(\.\d{1,2})?$/.test(input.monto ?? '') || dec(input.monto!).lte(0)) {
                errores.push({
                    field: 'monto',
                    message: 'Monto mayor que cero con hasta 2 decimales',
                    rule: 'monto',
                })
            }
            if (concepto.length < 3) {
                errores.push({ field: 'concepto', message: 'Mínimo 3 caracteres', rule: 'minLength' })
            }
            if (errores.length > 0) throw new ValidacionFallida(errores)
            const fiscal = await empresaFiscal(t, input.empresa_id)
            empresaId = fiscal.empresaId
            anio = input.anio!
            trimestre = input.trimestre ?? null
            efecto = input.efecto!
            monto = aTexto(input.monto!)
        }
        if (concepto.length < 3) {
            throw new ValidacionFallida([
                { field: 'concepto', message: 'Mínimo 3 caracteres', rule: 'minLength' },
            ])
        }
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?)', [LOCK_DECLARACIONES, empresaId])
        if (trimestre === null && (await ejercicioCerrado(t.trx, empresaId, anio))) {
            throw new Conflicto(
                `El ejercicio ${anio} está cerrado: su ISR anual ya no cambia (reábralo para ajustarlo)`,
                'ejercicio_cerrado',
                'Ejercicio cerrado',
            )
        }
        const [fila] = (await t.trx
            .insertQuery()
            .table('fiscal.ajustes_fiscales')
            .insert({
                empresa_id: empresaId,
                anio,
                trimestre,
                efecto,
                concepto,
                monto,
                anula_a: input.anula_a ?? null,
                registrado_por: usuarioDelActor(t.ctx.actor),
            })
            .returning('id')) as Array<{ id: number }>
        const id = Number(fila!.id)
        t.fijarEntidad('ajuste_fiscal', id)
        await t.registrarCambios(
            { tipo: 'ajuste_fiscal', id },
            {},
            { anio, trimestre, efecto, concepto, monto, anula_a: input.anula_a ?? null },
        )
        return verAjuste(id, t.trx)
    }
}

function consulta(c: QueryClientContract) {
    return c
        .from('fiscal.ajustes_fiscales as a')
        .leftJoin('fiscal.ajustes_fiscales as x', 'x.anula_a', 'a.id')
        .select(
            'a.id',
            'a.empresa_id',
            'a.anio',
            'a.trimestre',
            'a.efecto',
            'a.concepto',
            c.raw('a.monto::text as monto'),
            'a.anula_a',
            'x.id as anulado_por_ajuste',
            'a.registrado_por',
            'a.created_at',
        )
}

function normalizar(f: Record<string, any>): AjusteFiscal {
    return {
        ...(f as AjusteFiscal),
        id: Number(f.id),
        empresa_id: Number(f.empresa_id),
        anio: Number(f.anio),
        trimestre: f.trimestre === null ? null : Number(f.trimestre),
        monto: aTexto(f.monto),
        anula_a: f.anula_a === null ? null : Number(f.anula_a),
        anulado_por_ajuste: f.anulado_por_ajuste === null ? null : Number(f.anulado_por_ajuste),
        registrado_por: f.registrado_por === null ? null : Number(f.registrado_por),
    }
}

export async function verAjuste(id: number, c: QueryClientContract = db.connection()): Promise<AjusteFiscal> {
    const fila = (await consulta(c).where('a.id', id).first()) as Record<string, any> | null
    if (!fila) throw new NoEncontrado(`El ajuste fiscal ${id} no existe`)
    return normalizar(fila)
}

/** Ajustes de un año (todas las filas, con las anulaciones), del más antiguo al más reciente. */
export async function listarAjustes(
    filtros: { anio: number; trimestre?: number | null },
    empresas: number[] | null,
): Promise<AjusteFiscal[]> {
    const c = db.connection()
    const q = consulta(c)
        .where('a.anio', filtros.anio)
        .if(filtros.trimestre !== undefined && filtros.trimestre !== null, (x) =>
            x.where('a.trimestre', filtros.trimestre!),
        )
        .orderBy('a.id', 'asc')
    filtrarPorEmpresa(q, empresas, (x, ids) => x.whereIn('a.empresa_id', ids))
    return ((await q) as Array<Record<string, any>>).map(normalizar)
}
