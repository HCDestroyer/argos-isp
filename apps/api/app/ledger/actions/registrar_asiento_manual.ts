import { DomainAction, simularEnTransaccion, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { resolverEmpresaActiva } from '#core/empresas'
import { CERO, aTexto, dec, tieneCentavosExactos, type Dec } from '#ledger/dinero'
import { fechaValida } from '#ledger/fechas'
import { leerAjustesCobro } from '#billing/ajustes_cobro'
import { verBorrador, type BorradorAsientoVista, type MovimientoBorrador } from '#ledger/borradores'
import RegistrarAsiento, { type LineaAsiento } from '#ledger/actions/registrar_asiento'

/**
 * `libro.registrar_asiento` (`POST /libro/asientos`, decisión del PM 10): asiento manual de ajuste
 * (`origen_tipo: ajuste`) desde el panel de contabilidad.
 *
 * - Valida antes: cada línea con debe **o** haber (> 0, hasta 2 decimales), al menos dos líneas y
 *   Σ debe = Σ haber (422 `descuadre`). El resto (cuenta imputable y activa, auxiliar de cliente o de
 *   proveedor, mes cerrado o bloqueado) lo valida `RegistrarAsiento`.
 * - Sin aprobación (de fábrica): registra el asiento ya (`RegistrarAsiento` anidada) → `estado:
 *   registrado` y el asiento.
 * - Con `asientos_requieren_aprobacion` en los ajustes de la empresa: guarda un **borrador** que no toca
 *   el libro → `estado: pendiente_aprobacion`. Antes lo prueba en una transacción que siempre se
 *   revierte (`simularEnTransaccion`), así un borrador nunca nace con una cuenta inválida o un mes
 *   cerrado. Lo aprueba **otro** usuario (`libro.aprobar_asiento`) o se rechaza.
 *
 * Eventos: `libro.asiento_manual_registrado` (registrado) o `libro.asiento_pendiente` (borrador).
 */

export interface LineaManual {
    /** código del plan de cuentas (`5.1.04`) */
    cuenta: string
    debe?: string | null
    haber?: string | null
    cliente_id?: number | null
    proveedor_id?: number | null
}

export interface EntradaAsientoManual {
    empresa_id?: number | null
    /** fecha contable YYYY-MM-DD; por defecto hoy (al registrar o al aprobar) */
    fecha?: string | null
    descripcion: string
    movimientos: LineaManual[]
}

export interface ResultadoAsientoManual {
    estado: 'registrado' | 'pendiente_aprobacion'
    asiento_id: number | null
    borrador: BorradorAsientoVista | null
}

/** Normaliza y valida las líneas; devuelve las líneas del borrador y el total. */
export function validarLineasManuales(movimientos: LineaManual[]): {
    lineas: MovimientoBorrador[]
    total: Dec
} {
    const errores: ErrorCampo[] = []
    if (!Array.isArray(movimientos) || movimientos.length < 2) {
        throw new ValidacionFallida([
            { field: 'movimientos', message: 'Un asiento tiene al menos dos líneas', rule: 'minLength' },
        ])
    }
    let debe = CERO
    let haber = CERO
    const lineas = movimientos.map((m, i) => {
        const d = m.debe ? dec(m.debe) : CERO
        const h = m.haber ? dec(m.haber) : CERO
        if (d.gt(0) === h.gt(0) || d.lt(0) || h.lt(0)) {
            errores.push({
                field: `movimientos.${i}`,
                message: 'Cada línea lleva debe o haber (mayor que cero), no los dos',
                rule: 'debe_o_haber',
            })
        }
        if (!tieneCentavosExactos(d) || !tieneCentavosExactos(h)) {
            errores.push({ field: `movimientos.${i}`, message: 'Hasta 2 decimales', rule: 'monto' })
        }
        debe = debe.plus(d)
        haber = haber.plus(h)
        return {
            cuenta: m.cuenta.trim(),
            debe: aTexto(d),
            haber: aTexto(h),
            cliente_id: m.cliente_id ?? null,
            proveedor_id: m.proveedor_id ?? null,
        }
    })
    if (errores.length > 0) throw new ValidacionFallida(errores)
    if (!debe.equals(haber)) {
        throw new ValidacionFallida([
            {
                field: 'movimientos',
                message: `El debe (Q${aTexto(debe)}) y el haber (Q${aTexto(haber)}) no cuadran`,
                rule: 'descuadre',
            },
        ])
    }
    return { lineas, total: debe }
}

export function lineasDeAsiento(lineas: MovimientoBorrador[]): LineaAsiento[] {
    return lineas.map((l) => ({
        cuenta: l.cuenta,
        debe: dec(l.debe).gt(0) ? l.debe : null,
        haber: dec(l.haber).gt(0) ? l.haber : null,
        cliente_id: l.cliente_id,
        proveedor_id: l.proveedor_id,
    }))
}

export default class RegistrarAsientoManual extends DomainAction<
    EntradaAsientoManual,
    ResultadoAsientoManual
> {
    readonly nombre = 'libro.registrar_asiento'

    protected async handle(input: EntradaAsientoManual, t: Transaccion): Promise<ResultadoAsientoManual> {
        const descripcion = input.descripcion?.trim() ?? ''
        if (descripcion.length < 3) {
            throw new ValidacionFallida([
                {
                    field: 'descripcion',
                    message: 'Describe el ajuste (3 caracteres o más)',
                    rule: 'minLength',
                },
            ])
        }
        const fecha = input.fecha ? fechaValida(input.fecha) : null
        const { lineas, total } = validarLineasManuales(input.movimientos)
        const empresaId = input.empresa_id ?? (await resolverEmpresaActiva(t.ctx, t.trx))
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        const entradaAsiento = {
            empresa_id: empresaId,
            ...(fecha ? { fecha } : {}),
            descripcion,
            origen_tipo: 'ajuste' as const,
            origen_id: null,
            movimientos: lineasDeAsiento(lineas),
        }

        const ajustes = await leerAjustesCobro(empresaId, t.trx)
        if (!ajustes.asientos_requieren_aprobacion) {
            const asiento = await new RegistrarAsiento().execute(entradaAsiento, t.ctx, { trx: t.trx })
            t.fijarEntidad('asiento', asiento.id)
            t.fijarEmpresa(empresaId)
            await t.emit('libro.asiento_manual_registrado', {
                asiento_id: asiento.id,
                empresa_id: empresaId,
                borrador_id: null,
                total: aTexto(total),
                registrado_por: usuarioDelActor(t.ctx.actor),
                aprobado_por: null,
            })
            return { estado: 'registrado', asiento_id: asiento.id, borrador: null }
        }

        // prueba el asiento sin dejar nada escrito: cuentas, auxiliares, mes cerrado y bloqueos
        await simularEnTransaccion(t.ctx, (s) =>
            new RegistrarAsiento().execute(entradaAsiento, s.ctx, { trx: s.trx }),
        )
        const [fila] = (await t.trx
            .insertQuery()
            .table('billing.asientos_borradores')
            .insert({
                empresa_id: empresaId,
                fecha,
                descripcion,
                movimientos: JSON.stringify(lineas),
                total: aTexto(total),
                creado_por: usuarioDelActor(t.ctx.actor),
            })
            .returning('id')) as Array<{ id: number }>
        const borradorId = Number(fila!.id)
        t.fijarEntidad('asiento_borrador', borradorId)
        await t.emit('libro.asiento_pendiente', {
            borrador_id: borradorId,
            empresa_id: empresaId,
            creado_por: usuarioDelActor(t.ctx.actor),
            fecha,
            total: aTexto(total),
        })
        return {
            estado: 'pendiente_aprobacion',
            asiento_id: null,
            borrador: await verBorrador(borradorId, t.trx),
        }
    }
}
