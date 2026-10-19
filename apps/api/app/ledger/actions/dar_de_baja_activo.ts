import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, NoEncontrado, ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { CERO, aTexto, dec, tieneCentavosExactos } from '#ledger/dinero'
import { fechaValida, hoyGuatemala, inicioDeMes } from '#ledger/fechas'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import { resolverCuentaBanco, type PedidoCuentaBanco } from '#ledger/cuentas_banco'
import { acumuladaDe, sumarMeses, verActivo, type ActivoVista } from '#ledger/activos'
import RegistrarAsiento, { type LineaAsiento } from '#ledger/actions/registrar_asiento'
import DepreciarActivos from '#ledger/actions/depreciar_activos'

/**
 * `activos.dar_de_baja` (`POST /activos/:id/dar-de-baja`, con motivo): venta o retiro de un activo
 * (contrato de localización fiscal §10.10).
 *
 * - Antes deprecia lo pendiente hasta el mes anterior al de la baja (el mes de la baja ya no se
 *   deprecia; confirmar con contador).
 * - Asiento `baja_activo` (origen = el activo): `1.2.02.NN (acumulada) + Banco (precio de venta) +
 *   5.3.06 Pérdida (si el valor en libros pasa del precio) / 1.2.01.NN (costo) + 4.2.02 Ganancia
 *   (si el precio pasa del valor en libros)`. La venta se cobra en una cuenta bancaria de la empresa;
 *   el IVA de la venta no se calcula aquí (factúrese aparte; confirmar con contador).
 * - 409 `activo_dado_de_baja`. Evento `activo.dado_de_baja` con el valor en libros.
 */

export interface EntradaBajaActivo extends PedidoCuentaBanco {
    activo_id: number
    tipo: 'venta' | 'retiro'
    motivo: string
    fecha?: string | null
    precio_venta?: string | null
}

export default class DarDeBajaActivo extends DomainAction<EntradaBajaActivo, ActivoVista> {
    readonly nombre = 'activos.dar_de_baja'

    protected async handle(input: EntradaBajaActivo, t: Transaccion): Promise<ActivoVista> {
        t.fijarEntidad('activo', input.activo_id)
        const activo = (await t.trx
            .from('ledger.activos')
            .where('id', input.activo_id)
            .select('id', 'empresa_id', 'descripcion', 'costo', 'cuenta_activo_id', 'cuenta_depreciacion_id')
            .first()) as {
            id: number
            empresa_id: number
            descripcion: string
            costo: string
            cuenta_activo_id: number
            cuenta_depreciacion_id: number
        } | null
        if (!activo) throw new NoEncontrado(`El activo ${input.activo_id} no existe`)
        const empresaId = Number(activo.empresa_id)
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?)', [3016, activo.id])
        const previa = await t.trx.from('ledger.activos_bajas').where('activo_id', activo.id).first()
        if (previa) {
            throw new Conflicto(`El activo ${activo.id} ya está dado de baja`, 'activo_dado_de_baja', 'Activo dado de baja')
        }

        const errores: ErrorCampo[] = []
        const hoy = hoyGuatemala()
        const fecha = input.fecha ? fechaValida(input.fecha) : hoy
        if (fecha > hoy) errores.push({ field: 'fecha', message: 'No puede ser futura', rule: 'futuro' })
        const precio = dec(input.precio_venta ?? '0')
        if (precio.isNegative() || !tieneCentavosExactos(precio)) {
            errores.push({ field: 'precio_venta', message: 'Monto inválido', rule: 'monto' })
        }
        if (input.tipo === 'venta' && precio.lte(0)) {
            errores.push({ field: 'precio_venta', message: 'Una venta lleva su precio (sin IVA)', rule: 'required' })
        }
        if (input.tipo === 'retiro' && precio.gt(0)) {
            errores.push({ field: 'precio_venta', message: 'Un retiro no tiene precio: usa tipo venta', rule: 'no_aplica' })
        }
        const motivo = input.motivo?.trim() ?? ''
        if (motivo.length < 3) errores.push({ field: 'motivo', message: 'El motivo es obligatorio', rule: 'motivo' })
        if (errores.length > 0) throw new ValidacionFallida(errores)
        const cobro =
            input.tipo === 'venta' ? (await resolverCuentaBanco(t.trx, input, { empresaId }))! : null

        // lo pendiente hasta el mes anterior al de la baja
        const hasta = sumarMeses(inicioDeMes(fecha), -1)
        await new DepreciarActivos().execute({ activo_id: activo.id, hasta }, t.ctx, { trx: t.trx })
        const costo = dec(activo.costo)
        const acumulada = await acumuladaDe(t.trx, activo.id)
        const libros = costo.minus(acumulada)
        const resultado = precio.minus(libros)

        const movimientos: LineaAsiento[] = []
        if (acumulada.gt(0)) movimientos.push({ cuenta: Number(activo.cuenta_depreciacion_id), debe: aTexto(acumulada) })
        if (cobro && precio.gt(0)) movimientos.push({ cuenta: cobro.cuenta_id, debe: aTexto(precio) })
        if (resultado.isNegative()) {
            movimientos.push({ cuenta: CUENTAS_GT.PERDIDA_BAJA_ACTIVOS, debe: aTexto(resultado.abs()) })
        }
        movimientos.push({ cuenta: Number(activo.cuenta_activo_id), haber: aTexto(costo) })
        if (resultado.gt(CERO)) movimientos.push({ cuenta: CUENTAS_GT.GANANCIA_VENTA_ACTIVOS, haber: aTexto(resultado) })
        const asiento = await new RegistrarAsiento().execute(
            {
                empresa_id: empresaId,
                fecha,
                descripcion: `Baja (${input.tipo}) del activo ${activo.id} · ${activo.descripcion} · ${motivo}`,
                origen_tipo: 'baja_activo',
                origen_id: activo.id,
                movimientos,
            },
            t.ctx,
            { trx: t.trx },
        )
        await t.trx.insertQuery().table('ledger.activos_bajas').insert({
            activo_id: activo.id,
            fecha,
            tipo: input.tipo,
            motivo,
            precio_venta: aTexto(precio),
            cuenta_cobro_id: cobro?.cuenta_id ?? null,
            costo: aTexto(costo),
            depreciacion_acumulada: aTexto(acumulada),
            valor_libros: aTexto(libros),
            asiento_id: asiento.id,
            registrado_por: usuarioDelActor(t.ctx.actor),
        })
        await t.emit('activo.dado_de_baja', {
            activo_id: activo.id,
            empresa_id: empresaId,
            motivo,
            valor_libros: aTexto(libros),
        })
        return verActivo(activo.id, t.trx)
    }
}
