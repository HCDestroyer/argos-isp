import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { resolverEmpresaActiva } from '#core/empresas'
import { CERO, aTexto, dec, tieneCentavosExactos } from '#ledger/dinero'
import { fechaValida, hoyGuatemala } from '#ledger/fechas'
import { CUENTAS } from '#ledger/plan_cuentas'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import { cuentasDeClase, inicioDepreciacion, tasaDeClase, verActivo, type ActivoVista } from '#ledger/activos'
import type { ClaseActivo } from '#ledger/compras'
import RegistrarAsiento from '#ledger/actions/registrar_asiento'

/**
 * `activos.registrar` (`POST /activos`): alta de un activo que **no** entra por una compra (los
 * de una compra nacen con su línea `activo_fijo`): el inventario inicial al empezar a llevar los
 * libros en ArgosIsp o un aporte de capital en bienes (contrato de localización fiscal §10.10).
 *
 * - Asiento `alta_activo` (origen = el activo): `1.2.01.NN (costo) / 1.2.02.NN (depreciación
 *   inicial, si viene depreciado) + contrapartida`. Contrapartida: `2.9.01 Saldos de apertura`
 *   (por defecto), `3.1.01 Capital social` o `3.3.01 Utilidades acumuladas`. Nunca caja ni bancos:
 *   un activo pagado es una compra.
 * - Tasa anual ≤ tope legal de su clase (422 `tasa_sobre_tope`); residual + depreciación inicial <
 *   costo.
 */

export interface EntradaRegistrarActivo {
    empresa_id?: number | null
    clase: ClaseActivo
    descripcion: string
    serie?: string | null
    ubicacion?: string | null
    fecha_alta?: string | null
    costo: string
    valor_residual?: string | null
    depreciacion_inicial?: string | null
    tasa_anual?: string | null
    contrapartida?: string | null
}

const CONTRAPARTIDAS: string[] = [
    CUENTAS.SALDOS_APERTURA,
    CUENTAS_GT.CAPITAL_SOCIAL,
    CUENTAS_GT.UTILIDADES_ACUMULADAS,
]

export default class RegistrarActivo extends DomainAction<EntradaRegistrarActivo, ActivoVista> {
    readonly nombre = 'activos.registrar'

    protected async handle(input: EntradaRegistrarActivo, t: Transaccion): Promise<ActivoVista> {
        const empresaId = input.empresa_id ?? (await resolverEmpresaActiva(t.ctx, t.trx))
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        const errores: ErrorCampo[] = []
        const costo = dec(input.costo)
        const residual = dec(input.valor_residual ?? '0')
        const inicial = dec(input.depreciacion_inicial ?? '0')
        for (const [campo, valor] of [
            ['costo', costo],
            ['valor_residual', residual],
            ['depreciacion_inicial', inicial],
        ] as const) {
            if (valor.isNegative() || !tieneCentavosExactos(valor)) {
                errores.push({ field: campo, message: 'Monto inválido (≥ 0, 2 decimales)', rule: 'monto' })
            }
        }
        if (costo.lte(0) || residual.plus(inicial).gte(costo)) {
            errores.push({
                field: 'costo',
                message: 'El costo es mayor que 0 y que el residual más la depreciación inicial',
                rule: 'monto',
            })
        }
        const hoy = hoyGuatemala()
        const fechaAlta = input.fecha_alta ? fechaValida(input.fecha_alta, 'fecha_alta') : hoy
        if (fechaAlta > hoy) {
            errores.push({ field: 'fecha_alta', message: 'No puede ser futura', rule: 'futuro' })
        }
        const contrapartida = input.contrapartida?.trim() || CUENTAS.SALDOS_APERTURA
        if (!CONTRAPARTIDAS.includes(contrapartida)) {
            errores.push({
                field: 'contrapartida',
                message: `Contrapartida: ${CONTRAPARTIDAS.join(', ')} (un activo pagado se registra como compra)`,
                rule: 'contrapartida',
            })
        }
        if (!input.descripcion?.trim()) {
            errores.push({ field: 'descripcion', message: 'La descripción es obligatoria', rule: 'required' })
        }
        if (errores.length > 0) throw new ValidacionFallida(errores)

        const cuentas = await cuentasDeClase(t.trx, input.clase)
        const tasa = await tasaDeClase(t.trx, empresaId, input.clase, fechaAlta, input.tasa_anual)
        const [fila] = (await t.trx
            .insertQuery()
            .table('ledger.activos')
            .insert({
                empresa_id: empresaId,
                clase: input.clase,
                descripcion: input.descripcion.trim(),
                serie: input.serie?.trim() || null,
                ubicacion: input.ubicacion?.trim() || null,
                fecha_alta: fechaAlta,
                inicio_depreciacion: await inicioDepreciacion(t.trx, empresaId, fechaAlta),
                costo: aTexto(costo),
                valor_residual: aTexto(residual),
                depreciacion_inicial: aTexto(inicial),
                tasa_anual: tasa,
                cuenta_activo_id: cuentas.activo,
                cuenta_depreciacion_id: cuentas.depreciacion,
                cuenta_gasto_id: cuentas.gasto,
                registrado_por: usuarioDelActor(t.ctx.actor),
            })
            .returning('id')) as Array<{ id: number }>
        const activoId = Number(fila!.id)
        t.fijarEntidad('activo', activoId)
        await new RegistrarAsiento().execute(
            {
                empresa_id: empresaId,
                fecha: fechaAlta,
                descripcion: `Alta del activo ${activoId} · ${input.descripcion.trim()}`,
                origen_tipo: 'alta_activo',
                origen_id: activoId,
                movimientos: [
                    { cuenta: cuentas.activo, debe: aTexto(costo) },
                    ...(inicial.gt(CERO) ? [{ cuenta: cuentas.depreciacion, haber: aTexto(inicial) }] : []),
                    { cuenta: contrapartida, haber: aTexto(costo.minus(inicial)) },
                ],
            },
            t.ctx,
            { trx: t.trx },
        )
        return verActivo(activoId, t.trx)
    }
}
