import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Problema, ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { permisosDeUsuario } from '#core/acl'
import { valorParametro } from '#fiscal/parametros'
import { aTexto, dec, tieneCentavosExactos } from '#ledger/dinero'
import { fechaValida, hoyGuatemala } from '#ledger/fechas'
import type { ClaveCategoriaEgreso } from '#ledger/plan_cuentas'
import {
    egresosDelTurno,
    resolverOrigenEgreso,
    verEgreso,
    type EgresoVista,
    type MetodoEgreso,
} from '#ledger/egresos'
import { depositosDelTurno } from '#ledger/transitos'
import { pagosProveedoresDelTurno } from '#ledger/pagos_proveedores'
import RegistrarAsiento from '#ledger/actions/registrar_asiento'

/**
 * `egresos.registrar` (`POST /egresos`): un gasto pagado por la empresa.
 *
 * - Categoría (`energia`, `transito`, `nomina`, `vehiculos`, `alquileres`, `otros`) → su cuenta
 *   de gasto del plan (`egresos_categorias.cuenta_id`).
 * - Método (de dónde sale el dinero): `caja` (`caja_id`; el efectivo queda en el turno abierto de
 *   esa caja y baja el esperado del cierre), `banco` (`banco_id` del libro; por defecto el banco
 *   principal) o `cuenta_bancaria` (`cuenta_bancaria_id` propia, activa y en GTQ).
 * - Asiento `Gasto (categoría) / Caja | Banco | subcuenta bancaria` con la fecha del egreso
 *   (`fecha`, por defecto hoy; no futura; un mes cerrado la rechaza). Origen `egreso`.
 * - `comprobante` opcional: número o serie del documento del proveedor.
 *
 * Cajero (decisión del PM, `a3.md` fila 47): quien registra sin `egresos.registrar_sin_limite`
 * (el rol `cajero`) solo saca efectivo de **su** caja abierta (de la que es cajero o cuyo turno
 * abrió), con motivo (`descripcion`) y hasta `egreso_cajero_maximo` de la empresa (parámetro
 * fiscal, gt-2026.3). Errores: 403 `egreso_solo_caja` (otro método), 422 `caja_no_abierta`, 403
 * `caja_ajena`, 422 en `fecha` (`anterior_al_turno`, H52), 422 `efectivo_insuficiente` (más que el
 * efectivo del turno, H53), 422 en `descripcion` (`required`), 403 `egreso_sobre_limite` (sobre el tope: lo
 * registra contabilidad) y 403 `egreso_sin_limite_configurado` (la empresa no tiene el parámetro).
 * Contabilidad los revisa en el cierre de caja: bajan el esperado del turno.
 */

export interface EntradaRegistrarEgreso {
    categoria: ClaveCategoriaEgreso
    monto: string
    metodo: MetodoEgreso
    fecha?: string
    caja_id?: number | null
    banco_id?: number | null
    cuenta_bancaria_id?: number | null
    proveedor?: string | null
    descripcion?: string | null
    comprobante?: string | null
}

const ORIGEN_POR_METODO: Record<MetodoEgreso, 'caja_id' | 'banco_id' | 'cuenta_bancaria_id'> = {
    caja: 'caja_id',
    banco: 'banco_id',
    cuenta_bancaria: 'cuenta_bancaria_id',
}

export default class RegistrarEgreso extends DomainAction<EntradaRegistrarEgreso, EgresoVista> {
    readonly nombre = 'egresos.registrar'

    protected async handle(input: EntradaRegistrarEgreso, t: Transaccion): Promise<EgresoVista> {
        const errores: ErrorCampo[] = []
        const monto = dec(input.monto)
        if (monto.lte(0) || !tieneCentavosExactos(monto)) {
            errores.push({
                field: 'monto',
                message: 'El monto debe ser mayor que 0 con hasta 2 decimales',
                rule: 'monto',
            })
        }
        const hoy = hoyGuatemala()
        const fecha = input.fecha ? fechaValida(input.fecha) : hoy
        if (fecha > hoy) {
            errores.push({
                field: 'fecha',
                message: 'La fecha del egreso no puede ser futura',
                rule: 'futuro',
            })
        }
        for (const [metodo, campo] of Object.entries(ORIGEN_POR_METODO)) {
            if (metodo !== input.metodo && input[campo] !== undefined && input[campo] !== null) {
                errores.push({
                    field: campo,
                    message: `${campo} no aplica al método ${input.metodo}`,
                    rule: 'no_aplica',
                })
            }
        }
        if (input.metodo === 'cuenta_bancaria' && !input.cuenta_bancaria_id) {
            errores.push({
                field: 'cuenta_bancaria_id',
                message: 'La cuenta bancaria es obligatoria',
                rule: 'required',
            })
        }
        if (input.metodo === 'caja' && !input.caja_id) {
            errores.push({ field: 'caja_id', message: 'La caja es obligatoria', rule: 'required' })
        }

        const categoria = (await t.trx
            .from('ledger.egresos_categorias as ec')
            .join('ledger.cuentas as cu', 'cu.id', 'ec.cuenta_id')
            .where('ec.clave', input.categoria)
            .select('ec.id', 'ec.nombre', 'cu.id as cuenta_id')
            .first()) as { id: number; nombre: string; cuenta_id: number } | null
        if (!categoria) {
            errores.push({
                field: 'categoria',
                message: `La categoría ${input.categoria} no existe`,
                rule: 'exists',
            })
        }
        if (errores.length > 0) throw new ValidacionFallida(errores)

        const usuarioId = usuarioDelActor(t.ctx.actor)
        const permisos = usuarioId === null ? null : await permisosDeUsuario(usuarioId)
        const conLimite = permisos !== null && !permisos.includes('egresos.registrar_sin_limite')
        if (conLimite && input.metodo !== 'caja') {
            throw new Problema(
                403,
                'egreso_solo_caja',
                'Egreso solo de caja',
                'Sin egresos.registrar_sin_limite solo se registran egresos en efectivo de tu caja abierta',
            )
        }

        const origen = await resolverOrigenEgreso(t.trx, t.ctx, input)
        // el egreso es de la empresa de su caja, banco o cuenta bancaria
        exigirAccesoEmpresa(t.ctx, origen.empresa_id)
        t.fijarEmpresa(origen.empresa_id)
        if (conLimite) await this.exigirLimiteCajero(t, input, monto, fecha, origen, usuarioId!)

        const [fila] = (await t.trx
            .insertQuery()
            .table('ledger.egresos')
            .insert({
                empresa_id: origen.empresa_id,
                fecha,
                categoria_id: categoria!.id,
                proveedor: input.proveedor?.trim() || null,
                descripcion: input.descripcion?.trim() || null,
                comprobante: input.comprobante?.trim() || null,
                monto: aTexto(monto),
                metodo: input.metodo,
                caja_id: origen.caja_id,
                turno_id: origen.turno_id,
                banco_id: origen.banco_id,
                cuenta_bancaria_id: origen.cuenta_bancaria_id,
                registrado_por: usuarioDelActor(t.ctx.actor),
            })
            .returning('id')) as Array<{ id: number }>
        const egresoId = fila!.id
        t.fijarEntidad('egreso', egresoId)

        await new RegistrarAsiento().execute(
            {
                empresa_id: origen.empresa_id,
                fecha,
                descripcion:
                    `Egreso ${egresoId} · ${categoria!.nombre} · ${origen.nombre}` +
                    (input.proveedor?.trim() ? ` · ${input.proveedor.trim()}` : '') +
                    (input.comprobante?.trim() ? ` · doc. ${input.comprobante.trim()}` : ''),
                origen_tipo: 'egreso',
                origen_id: egresoId,
                movimientos: [
                    { cuenta: categoria!.cuenta_id, debe: aTexto(monto) },
                    { cuenta: origen.cuenta_id, haber: aTexto(monto) },
                ],
            },
            t.ctx,
            { trx: t.trx },
        )
        return verEgreso(egresoId, t.trx)
    }

    /** Reglas del cajero (decisión del PM): su caja abierta, motivo y tope por egreso. */
    private async exigirLimiteCajero(
        t: Transaccion,
        input: EntradaRegistrarEgreso,
        monto: ReturnType<typeof dec>,
        fecha: string,
        origen: { empresa_id: number; caja_id: number | null; turno_id: number | null; nombre: string },
        usuarioId: number,
    ) {
        if (origen.turno_id === null) {
            throw new Problema(
                422,
                'caja_no_abierta',
                'Caja no abierta',
                `La caja ${origen.nombre} no tiene un turno abierto: ábrela para registrar el egreso`,
            )
        }
        const turno = (await t.trx
            .from('ledger.cajas_turnos as tu')
            .join('ledger.cajas as c', 'c.id', 'tu.caja_id')
            .where('tu.id', origen.turno_id)
            // H53: un egreso a la vez por turno, así dos no sacan el mismo efectivo
            .forUpdate()
            .select(
                'tu.abierto_por',
                'c.cajero_id',
                'tu.fondo_inicial',
                t.trx.raw(
                    `to_char((tu.abierto_en AT TIME ZONE 'America/Guatemala')::date, 'YYYY-MM-DD') as abierto`,
                ),
            )
            .firstOrFail()) as {
            abierto_por: number | null
            cajero_id: number | null
            fondo_inicial: string
            abierto: string
        }
        if (Number(turno.abierto_por) !== usuarioId && Number(turno.cajero_id) !== usuarioId) {
            throw new Problema(
                403,
                'caja_ajena',
                'Caja ajena',
                `La caja ${origen.nombre} no es tuya: un cajero solo registra egresos de su caja abierta`,
            )
        }
        // H52: el efectivo sale del turno abierto: su fecha no es anterior a la apertura del turno
        if (fecha < turno.abierto) {
            throw new ValidacionFallida([
                {
                    field: 'fecha',
                    message: `La fecha del egreso no puede ser anterior a la apertura del turno (${turno.abierto})`,
                    rule: 'anterior_al_turno',
                },
            ])
        }
        // H53: no se saca más efectivo del que tiene el turno (lo mismo que espera su cierre)
        const cobrado = (await t.trx
            .from('billing.pagos')
            .where('turno_id', origen.turno_id)
            .whereNot('estado', 'anulado')
            .select(t.trx.raw('coalesce(sum(monto - retenido), 0)::text as total'))
            .first()) as { total: string }
        const disponible = dec(turno.fondo_inicial)
            .plus(cobrado.total)
            .minus(await egresosDelTurno(t.trx, origen.turno_id))
            .minus(await depositosDelTurno(t.trx, origen.turno_id))
            .minus(await pagosProveedoresDelTurno(t.trx, origen.turno_id))
        if (monto.gt(disponible)) {
            throw new Problema(
                422,
                'efectivo_insuficiente',
                'Efectivo insuficiente en la caja',
                `La caja ${origen.nombre} tiene Q${aTexto(disponible)} en efectivo en este turno: no alcanza para un egreso de Q${aTexto(monto)}`,
            )
        }
        if (!input.descripcion?.trim()) {
            throw new ValidacionFallida([
                {
                    field: 'descripcion',
                    message: 'El motivo del egreso es obligatorio para el cajero',
                    rule: 'required',
                },
            ])
        }
        let tope: ReturnType<typeof dec>
        try {
            tope = dec(
                String(
                    await valorParametro<string>(
                        origen.empresa_id,
                        'egreso_cajero_maximo',
                        hoyGuatemala(),
                        t.trx,
                    ),
                ),
            )
        } catch (error) {
            if (!(error instanceof Problema)) throw error
            throw new Problema(
                403,
                'egreso_sin_limite_configurado',
                'Sin límite de egresos del cajero',
                'La empresa no tiene egreso_cajero_maximo (actualiza su localización a gt-2026.3): el egreso lo registra contabilidad',
            )
        }
        if (monto.gt(tope)) {
            throw new Problema(
                403,
                'egreso_sobre_limite',
                'Egreso sobre el límite del cajero',
                `El egreso de Q${aTexto(monto)} supera el máximo del cajero (Q${aTexto(tope)}, egreso_cajero_maximo): lo registra contabilidad`,
            )
        }
    }
}
