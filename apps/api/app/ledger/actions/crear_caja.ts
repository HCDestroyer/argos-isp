import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, ValidacionFallida } from '#shared/errores'
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
 */

export interface EntradaCrearCaja {
    nombre: string
    cajero_id?: number | null
    empresa_id?: number | null
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
        let empresaId: number
        if (input.empresa_id) {
            await exigirEmpresaActiva(t.trx, input.empresa_id)
            empresaId = input.empresa_id
        } else {
            empresaId = await resolverEmpresaActiva(t.ctx, t.trx)
        }
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)

        if (input.cajero_id) {
            const usuario = await t.trx
                .from('core.usuarios')
                .where('id', input.cajero_id)
                .select('id')
                .first()
            if (!usuario) {
                throw new ValidacionFallida([
                    {
                        field: 'cajero_id',
                        message: `El usuario ${input.cajero_id} no existe`,
                        rule: 'exists',
                    },
                ])
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
            })
            .returning('id')) as Array<{ id: number }>
        t.fijarEntidad('caja', fila!.id)
        await t.registrarCambios({ tipo: 'caja', id: fila!.id }, null, {
            empresa_id: empresaId,
            nombre,
            cajero_id: input.cajero_id ?? null,
            cuenta_id: cuenta!.id,
        })
        const cajas = await listarCajas(undefined, [empresaId], t.trx)
        return cajas.find((c) => c.id === fila!.id)!
    }
}
