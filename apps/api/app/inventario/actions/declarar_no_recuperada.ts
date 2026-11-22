import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, Problema, ValidacionFallida } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { configuracionInventario } from '#inventario/ordenes_traslado'
import { verUnidad, type UnidadVista } from '#inventario/unidades'
import DeclararPerdidaComodato from '#inventario/actions/declarar_perdida_comodato'
import { emitirCobroEquipo } from '#inventario/cobros_equipo'
import { SQL_CUENTA } from '#inventario/recuperacion'

/**
 * `inventario.declarar_no_recuperada` (`POST /inventario/unidades/:id/declarar-no-recuperada`, permiso
 * `inventario.cobrar_equipo`; contrato Iris 0.12.0 §3.10, §10.7 a, A48): una **persona en Argos** declara
 * que el cliente no devolvió el equipo, nunca el técnico.
 *
 * - La unidad está en comodato o por recuperar. Exige el **mínimo de intentos de técnicos distintos**
 *   (`inventario.configuracion.recuperacion_tecnicos_minimos`, 2 de fábrica) **o** un contacto con el
 *   cliente registrado (`inventario.registrar_contacto_recuperacion`); si no, 422 `intentos_insuficientes`.
 * - Contabilidad: la de la pérdida de siempre (`activos.dar_de_baja` tipo `retiro`: `1.2.02 + 5.3.06 /
 *   1.2.01`), sin kardex. La unidad queda `no_recuperada`.
 * - Con `monto`: el cobro «Equipo no devuelto» al cliente del servicio, un cargo único (`CxC / ingreso +
 *   IVA`) con el concepto indicado o el «Equipo no devuelto» de la empresa, y una fila aprobada en la cola
 *   de cobros de equipo.
 */

export interface EntradaDeclararNoRecuperada {
    unidad_id: number
    motivo: string
    /** cobro «Equipo no devuelto» (IVA incluido); sin él, solo se declara */
    monto?: string | null
    concepto_id?: number | null
    fecha?: string | null
}

export type ResultadoDeclararNoRecuperada = UnidadVista & {
    cobro_id: number | null
    factura_id: number | null
}

export default class DeclararNoRecuperada extends DomainAction<
    EntradaDeclararNoRecuperada,
    ResultadoDeclararNoRecuperada
> {
    readonly nombre = 'inventario.declarar_no_recuperada'

    protected async handle(
        input: EntradaDeclararNoRecuperada,
        t: Transaccion,
    ): Promise<ResultadoDeclararNoRecuperada> {
        const motivo = input.motivo?.trim() ?? ''
        if (motivo.length < 3) {
            throw new ValidacionFallida([
                { field: 'motivo', message: 'El motivo es obligatorio', rule: 'required' },
            ])
        }
        t.fijarEntidad('unidad', input.unidad_id)
        const unidad = (await t.trx
            .from('inventario.unidades')
            .where('id', input.unidad_id)
            .select('id', 'empresa_id', 'estado', 'servicio_id')
            .first()) as { id: number; empresa_id: number; estado: string; servicio_id: number | null } | null
        if (!unidad) {
            throw new Problema(
                404,
                'no_encontrado',
                'No encontrado',
                `La unidad ${input.unidad_id} no existe`,
            )
        }
        const empresaId = Number(unidad.empresa_id)
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        if (
            (unidad.estado !== 'en_comodato' && unidad.estado !== 'por_recuperar') ||
            unidad.servicio_id === null
        ) {
            throw new Conflicto(
                `La unidad ${unidad.id} está ${unidad.estado.replaceAll('_', ' ')}: solo se declara no recuperada una en comodato o por recuperar`,
                'estado_unidad_cambiado',
                'El estado de la unidad cambió',
            )
        }
        const servicioId = Number(unidad.servicio_id)
        const configuracion = await configuracionInventario(empresaId, t.trx)
        const minimo = configuracion.recuperacion_tecnicos_minimos
        // 0.14.0 (R-02, T-1, T-8): solo intentos que cuentan (registrados en Argos, verificados con Iris o
        // aceptados por una persona) y solo contactos registrados por una persona en el panel
        const tecnicos = (await t.trx
            .from('inventario.intentos_recuperacion as i')
            .leftJoin('inventario.verificaciones_iris as v', 'v.intento_id', 'i.id')
            .where({ 'i.unidad_id': unidad.id, 'i.servicio_id': servicioId })
            .whereRaw(SQL_CUENTA)
            .select(
                t.trx.raw(
                    'count(distinct coalesce(i.actor_tecnico, i.actor_tecnico_id::text, i.registrado_por::text)) as n',
                ),
            )
            .first()) as { n: string }
        const contactos = await t.trx
            .from('inventario.contactos_recuperacion')
            .where('unidad_id', unidad.id)
            .whereRaw(`coalesce(actor_tipo, 'usuario') = 'usuario'`)
            .select('id')
            .first()
        if (Number(tecnicos.n) < minimo && !contactos) {
            throw new Problema(
                422,
                'intentos_insuficientes',
                'Intentos insuficientes',
                `Para declararla no recuperada hacen falta intentos verificados de ${minimo} técnicos distintos (hay ${tecnicos.n}) o un contacto con el cliente registrado por una persona en Argos`,
                [
                    {
                        field: 'unidad_id',
                        message: `Intentos de ${tecnicos.n} de ${minimo} técnicos`,
                        rule: 'intentos_insuficientes',
                    },
                ],
            )
        }
        await new DeclararPerdidaComodato().execute(
            {
                servicio_id: servicioId,
                unidad_id: unidad.id,
                motivo: `no recuperada: ${motivo}`,
                fecha: input.fecha,
                estado_final: 'no_recuperada',
            },
            t.ctx,
            { trx: t.trx },
        )
        let cobroId: number | null = null
        let facturaId: number | null = null
        if (input.monto) {
            const servicio = (await t.trx
                .from('core.servicios')
                .where('id', servicioId)
                .select('cliente_id')
                .first()) as {
                cliente_id: number
            }
            const [fila] = (await t.trx
                .insertQuery()
                .table('inventario.cobros_equipo')
                .insert({
                    empresa_id: empresaId,
                    unidad_id: unidad.id,
                    servicio_id: servicioId,
                    cliente_id: servicio.cliente_id,
                    origen: 'no_recuperado',
                    motivo: 'equipo_no_devuelto',
                    estado: 'propuesto',
                })
                .returning('id')) as Array<{ id: number }>
            cobroId = Number(fila!.id)
            facturaId = await emitirCobroEquipo(t, cobroId, {
                monto: input.monto,
                concepto_id: input.concepto_id ?? null,
                decidido_por: usuarioDelActor(t.ctx.actor),
            })
        }
        const vista = await verUnidad(unidad.id, t.trx)
        return { ...vista, cobro_id: cobroId, factura_id: facturaId }
    }
}
