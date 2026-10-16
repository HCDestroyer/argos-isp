import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ReglaNegocio, ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { aTexto, dec, tieneCentavosExactos } from '#ledger/dinero'
import { fechaValida, hoyGuatemala } from '#ledger/fechas'
import { CUENTAS, type ClaveCategoriaEgreso } from '#ledger/plan_cuentas'
import { verEgreso, type EgresoVista, type MetodoEgreso } from '#ledger/egresos'
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

        const origen = await this.origen(t, input)

        const [fila] = (await t.trx
            .insertQuery()
            .table('ledger.egresos')
            .insert({
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
                registrado_por: t.ctx.actor.id,
            })
            .returning('id')) as Array<{ id: number }>
        const egresoId = fila!.id
        t.fijarEntidad('egreso', egresoId)

        await new RegistrarAsiento().execute(
            {
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

    private async origen(t: Transaccion, input: EntradaRegistrarEgreso) {
        const vacio = { caja_id: null, turno_id: null, banco_id: null, cuenta_bancaria_id: null }
        if (input.metodo === 'caja') {
            const caja = (await t.trx
                .from('ledger.cajas')
                .where('id', input.caja_id!)
                .select('id', 'nombre', 'cuenta_id', 'activa')
                .first()) as { id: number; nombre: string; cuenta_id: number; activa: boolean } | null
            if (!caja || !caja.activa) {
                throw new ValidacionFallida([
                    {
                        field: 'caja_id',
                        message: `La caja ${input.caja_id} no existe o está inactiva`,
                        rule: 'caja',
                    },
                ])
            }
            // FOR SHARE como los cobros: si el turno se está cerrando, este egreso espera.
            const turno = await t.trx
                .from('ledger.cajas_turnos')
                .where('caja_id', caja.id)
                .whereNull('cerrado_en')
                .forShare()
                .select('id')
                .first()
            return {
                ...vacio,
                caja_id: caja.id,
                turno_id: (turno?.id as number | undefined) ?? null,
                cuenta_id: caja.cuenta_id,
                nombre: caja.nombre,
            }
        }
        if (input.metodo === 'banco') {
            const banco = (await t.trx
                .from('ledger.bancos as b')
                .join('ledger.cuentas as cu', 'cu.id', 'b.cuenta_id')
                .if(
                    input.banco_id,
                    (q) => q.where('b.id', input.banco_id!),
                    (q) => q.where('cu.codigo', CUENTAS.BANCO_PRINCIPAL),
                )
                .select('b.id', 'b.nombre', 'b.cuenta_id')
                .first()) as { id: number; nombre: string; cuenta_id: number } | null
            if (!banco) {
                throw new ValidacionFallida([
                    {
                        field: 'banco_id',
                        message: `El banco ${input.banco_id ?? 'principal'} no existe`,
                        rule: 'exists',
                    },
                ])
            }
            return { ...vacio, banco_id: banco.id, cuenta_id: banco.cuenta_id, nombre: banco.nombre }
        }
        const cuenta = (await t.trx
            .from('billing.cuentas_bancarias as cb')
            .join('billing.bancos as b', 'b.id', 'cb.banco_id')
            .where('cb.id', input.cuenta_bancaria_id!)
            .select('cb.id', 'cb.alias', 'cb.cuenta_id', 'cb.activa', 'cb.moneda', 'b.nombre as banco')
            .first()) as {
            id: number
            alias: string
            cuenta_id: number
            activa: boolean
            moneda: string
            banco: string
        } | null
        if (!cuenta) {
            throw new ValidacionFallida([
                {
                    field: 'cuenta_bancaria_id',
                    message: `La cuenta bancaria ${input.cuenta_bancaria_id} no existe`,
                    rule: 'exists',
                },
            ])
        }
        if (!cuenta.activa || cuenta.moneda !== 'GTQ') {
            throw new ReglaNegocio(
                `La cuenta bancaria ${cuenta.id} está inactiva o no es en quetzales`,
                'cuenta_bancaria_no_disponible',
            )
        }
        return {
            ...vacio,
            cuenta_bancaria_id: cuenta.id,
            cuenta_id: cuenta.cuenta_id,
            nombre: `${cuenta.banco} · ${cuenta.alias}`,
        }
    }
}
