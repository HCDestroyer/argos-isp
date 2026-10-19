import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { aTexto, dec, tieneCentavosExactos } from '#ledger/dinero'
import { fechaValida, hoyGuatemala } from '#ledger/fechas'
import type { ClaveCategoriaEgreso } from '#ledger/plan_cuentas'
import { resolverOrigenEgreso, verEgreso, type EgresoVista, type MetodoEgreso } from '#ledger/egresos'
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

        const origen = await resolverOrigenEgreso(t.trx, t.ctx, input)
        // el egreso es de la empresa de su caja, banco o cuenta bancaria
        exigirAccesoEmpresa(t.ctx, origen.empresa_id)
        t.fijarEmpresa(origen.empresa_id)

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
}
