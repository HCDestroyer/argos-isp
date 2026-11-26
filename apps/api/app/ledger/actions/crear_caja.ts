import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, ValidacionFallida } from '#shared/errores'
import { aTexto, dec, tieneCentavosExactos } from '#ledger/dinero'
import type { TipoCaja } from '#ledger/custodia'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { exigirEmpresaActiva, resolverEmpresaActiva } from '#core/empresas'
import { CUENTAS } from '#ledger/plan_cuentas'
import { listarCajas, type CajaVista } from '#ledger/cajas'

/**
 * `cajas.crear` (`POST /cajas`): crea una caja de una empresa (multiempresa: cada NIT tiene sus
 * cajas; un cajero que cobra para varias empresas abre una caja en cada una).
 *
 * - Empresa: `empresa_id` o la activa (422 `empresa_requerida`, 403 `empresa_no_permitida`).
 * - Crea su subcuenta de `1.1.01 Cajas` en el libro (`1.1.01.NN`, el siguiente número libre),
 *   marcada como de esa empresa: un asiento de otra empresa no puede usarla.
 * - Nombre único por empresa (409 `caja_duplicada`). `cajero_id` opcional (cajero asignado).
 * - B1 del plan de contabilidad (§5.7): `tipo` = `cobros` (de fábrica) o `gastos` (caja chica, B9) y
 *   `fondo_fijo` opcional (sin él, el de la empresa en `GET /cajas/ajustes`: `fondo_cobros` o
 *   `fondo_caja_chica`).
 * - B9: una caja chica no tiene turnos ni cobra; su `cajero_id` es su encargado. Nace vacía: la
 *   primera reposición (`POST /cajas/:id/reponer`) le pone su fondo fijo desde la custodia o el banco.
 * - B11: `fiscal = false` = caja sin factura (de cobros o caja chica; aviso si la empresa tiene FEL
 *   obligatoria) y `usuarios` = quiénes la ven y usan (vacío = todos los del ACL).
 */

export interface EntradaCrearCaja {
    nombre: string
    cajero_id?: number | null
    empresa_id?: number | null
    tipo?: TipoCaja
    fondo_fijo?: string | null
    fiscal?: boolean
    usuarios?: number[]
}

/** Mismo lock que las subcuentas de bancos (`crear_cuenta_bancaria`): numeración sin carreras. */
const LOCK_SUBCUENTAS = 3005

export default class CrearCaja extends DomainAction<EntradaCrearCaja, CajaVista> {
    readonly nombre = 'cajas.crear'

    protected async handle(input: EntradaCrearCaja, t: Transaccion): Promise<CajaVista> {
        const nombre = input.nombre?.trim() ?? ''
        if (nombre.length < 2) {
            throw new ValidacionFallida([
                { field: 'nombre', message: 'El nombre es obligatorio', rule: 'required' },
            ])
        }
        const tipo = input.tipo ?? 'cobros'
        let fondoFijo: string | null = null
        if (input.fondo_fijo !== undefined && input.fondo_fijo !== null && input.fondo_fijo !== '') {
            const monto = dec(input.fondo_fijo)
            if (monto.isNegative() || !tieneCentavosExactos(monto)) {
                throw new ValidacionFallida([
                    { field: 'fondo_fijo', message: 'Monto inválido (≥ 0, 2 decimales)', rule: 'monto' },
                ])
            }
            fondoFijo = aTexto(monto)
        }
        let empresaId: number
        if (input.empresa_id) {
            await exigirEmpresaActiva(t.trx, input.empresa_id)
            empresaId = input.empresa_id
        } else {
            empresaId = await resolverEmpresaActiva(t.ctx, t.trx)
        }
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)

        const usuarios = [...new Set(input.usuarios ?? [])].sort((a, b) => a - b)
        for (const [campo, ids] of [
            ['cajero_id', input.cajero_id ? [input.cajero_id] : []],
            ['usuarios', usuarios],
        ] as const) {
            if (ids.length === 0) continue
            const existen = (await t.trx
                .from('core.usuarios')
                .whereIn('id', [...ids])
                .select('id')) as Array<{
                id: number
            }>
            const faltan = ids.filter((id) => !existen.some((e) => Number(e.id) === id))
            if (faltan.length > 0) {
                throw new ValidacionFallida(
                    faltan.map((id) => ({
                        field: campo,
                        message: `El usuario ${id} no existe`,
                        rule: 'exists',
                    })),
                )
            }
        }
        const repetida = await t.trx
            .from('ledger.cajas')
            .where('empresa_id', empresaId)
            .where('nombre', nombre)
            .select('id')
            .first()
        if (repetida) {
            throw new Conflicto(
                `La empresa ${empresaId} ya tiene una caja "${nombre}" (${repetida.id})`,
                'caja_duplicada',
                'Caja duplicada',
            )
        }

        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?)', [LOCK_SUBCUENTAS])
        const padre = (await t.trx
            .from('ledger.cuentas')
            .where('codigo', CUENTAS.CAJAS)
            .select('id')
            .firstOrFail()) as { id: number }
        const hijas = (await t.trx
            .from('ledger.cuentas')
            .where('padre_id', padre.id)
            .select('codigo')) as Array<{ codigo: string }>
        const siguiente =
            Math.max(0, ...hijas.map((h) => Number(h.codigo.split('.').at(-1))).filter(Number.isFinite)) + 1
        const [cuenta] = (await t.trx
            .insertQuery()
            .table('ledger.cuentas')
            .insert({
                codigo: `${CUENTAS.CAJAS}.${String(siguiente).padStart(2, '0')}`,
                nombre: `Caja · ${nombre}`,
                tipo: 'activo',
                padre_id: padre.id,
                imputable: true,
                auxiliar_cliente: false,
                empresa_id: empresaId,
            })
            .returning('id')) as Array<{ id: number }>

        const [fila] = (await t.trx
            .insertQuery()
            .table('ledger.cajas')
            .insert({
                empresa_id: empresaId,
                nombre,
                cajero_id: input.cajero_id ?? null,
                cuenta_id: cuenta!.id,
                tipo,
                fondo_fijo: fondoFijo,
                fiscal: input.fiscal ?? true,
            })
            .returning('id')) as Array<{ id: number }>
        if (usuarios.length > 0) {
            await t.trx
                .insertQuery()
                .table('ledger.cajas_usuarios')
                .multiInsert(usuarios.map((u) => ({ caja_id: fila!.id, usuario_id: u })))
        }
        t.fijarEntidad('caja', fila!.id)
        await t.registrarCambios({ tipo: 'caja', id: fila!.id }, null, {
            empresa_id: empresaId,
            nombre,
            cajero_id: input.cajero_id ?? null,
            cuenta_id: cuenta!.id,
            tipo,
            fondo_fijo: fondoFijo,
            fiscal: input.fiscal ?? true,
            usuarios,
        })
        const cajas = await listarCajas(undefined, [empresaId], t.trx)
        return cajas.find((c) => c.id === fila!.id)!
    }
}
