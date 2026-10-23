import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Problema, ValidacionFallida } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { resolverEmpresaActiva } from '#core/empresas'
import { CERO, aTexto } from '#ledger/dinero'
import { fechaValida, hoyGuatemala } from '#ledger/fechas'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import { verProvision, type ProvisionVista } from '#ledger/cartera'
import { reservaIncobrables } from '#ledger/checks'
import RegistrarAsiento from '#ledger/actions/registrar_asiento'

/**
 * `cartera.provisionar` (`POST /cartera/provisionar`): estimación para cuentas incobrables
 * (contrato de localización fiscal §10.9; LAT art. 21.20, inv. A.2).
 *
 * - Base: Σ de los **saldos deudores** de los clientes en `1.1.03` al corte (`fecha`, por defecto el
 *   31 de diciembre del año, o hoy si el año está en curso).
 * - Tope: base × `reserva_incobrables_max` (3 % por defecto). La reserva de `1.1.12` **al corte**
 *   (H12) nunca lo supera; un corte anterior al de la última estimación responde 422
 *   `provision_fuera_de_orden`. Se registra solo lo que falta (`5.3.02 / 1.1.12`, origen `provision`, fecha
 *   del corte). Si ya está en el tope o lo supera, queda la fila con monto 0 y sin asiento.
 * - Si la base incluye el IVA de los avisos sin DTE y cómo se suman varios años: contador.
 */

export interface EntradaProvisionarCartera {
    empresa_id?: number | null
    anio: number
    fecha?: string | null
}

export default class ProvisionarCartera extends DomainAction<EntradaProvisionarCartera, ProvisionVista> {
    readonly nombre = 'cartera.provisionar'

    protected async handle(input: EntradaProvisionarCartera, t: Transaccion): Promise<ProvisionVista> {
        const empresaId = input.empresa_id ?? (await resolverEmpresaActiva(t.ctx, t.trx))
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        const hoy = hoyGuatemala()
        const cierre = `${input.anio}-12-31`
        const fecha = input.fecha ? fechaValida(input.fecha) : cierre < hoy ? cierre : hoy
        if (!fecha.startsWith(`${input.anio}-`) || fecha > hoy) {
            throw new ValidacionFallida([
                {
                    field: 'fecha',
                    message: `El corte debe ser del año ${input.anio} y no futuro`,
                    rule: 'fecha',
                },
            ])
        }
        // una a la vez por empresa: el tope se calcula sobre lo ya registrado
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(3012, ?::int)', [empresaId])
        // H12: la reserva se mide al corte; una estimación con corte anterior a la última ya registrada
        // podría dejar la reserva de esa fecha posterior sobre su tope
        const ultima = (await t.trx
            .from('ledger.provisiones_cartera')
            .where('empresa_id', empresaId)
            .select(t.trx.raw(`to_char(max(fecha), 'YYYY-MM-DD') as fecha`))
            .first()) as { fecha: string | null } | undefined
        const ultimaFecha = ultima?.fecha ?? null
        if (ultimaFecha && fecha < ultimaFecha) {
            throw new Problema(
                422,
                'provision_fuera_de_orden',
                'Estimación fuera de orden',
                `Ya hay una estimación con corte ${ultimaFecha}: el corte nuevo no puede ser anterior`,
                [
                    {
                        field: 'fecha',
                        message: `Corte mínimo ${ultimaFecha}`,
                        rule: 'provision_fuera_de_orden',
                    },
                ],
            )
        }

        // la misma cuenta que el check `incobrables` y el tablero (observación del auditor, fase 8)
        const reserva = await reservaIncobrables(t.trx, empresaId, fecha)
        const baseDec = reserva.base
        const porcentaje = reserva.porcentaje
        const tope = reserva.tope
        const anterior = reserva.estimacion
        const falta = tope.minus(anterior)
        const monto = falta.gt(0) ? falta : CERO

        const [fila] = (await t.trx
            .insertQuery()
            .table('ledger.provisiones_cartera')
            .insert({
                empresa_id: empresaId,
                anio: input.anio,
                fecha,
                base: aTexto(baseDec),
                porcentaje: porcentaje.toFixed(6),
                tope: aTexto(tope),
                saldo_anterior: aTexto(anterior),
                monto: aTexto(monto),
                registrado_por: usuarioDelActor(t.ctx.actor),
            })
            .returning('id')) as Array<{ id: number }>
        const id = Number(fila!.id)
        t.fijarEntidad('provision_cartera', id)
        if (monto.gt(0)) {
            await new RegistrarAsiento().execute(
                {
                    empresa_id: empresaId,
                    fecha,
                    descripcion: `Estimación para cuentas incobrables ${input.anio}: ${porcentaje.toFixed(2)} % de Q${aTexto(baseDec)} (reserva Q${aTexto(tope)})`,
                    origen_tipo: 'provision',
                    origen_id: id,
                    movimientos: [
                        { cuenta: CUENTAS_GT.CUENTAS_INCOBRABLES, debe: aTexto(monto) },
                        { cuenta: CUENTAS_GT.ESTIMACION_INCOBRABLES, haber: aTexto(monto) },
                    ],
                },
                t.ctx,
                { trx: t.trx },
            )
        }
        return verProvision(id, t.trx)
    }
}
