import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, ReglaNegocio, ValidacionFallida } from '#shared/errores'
import { aTexto, dec, tieneCentavosExactos } from '#ledger/dinero'
import { configuracionDeServicio, leerServicio } from '#billing/configuracion'
import { bloquearCliente } from '#billing/cobros'
import {
    datosEvaluacion,
    evaluarReglas,
    verPromesa,
    type EstadoPromesa,
    type PromesaVista,
    type ResultadoEvaluacion,
} from '#billing/promesas'
import type { CanalPromesa } from '#billing/reglas_promesa'
import EvaluarEstadoServicio, { type ResultadoEvaluarEstado } from '#billing/actions/evaluar_estado_servicio'

/**
 * `promesas.crear` = `crearPromesaPago` (`POST /promesas`; el portal de A5 la llama directo con
 * canal `portal` y actor sistema).
 *
 * Evalúa las `reglas_promesa` efectivas del servicio (plantilla + excepciones) con los límites del
 * canal (`evaluarReglas` en `promesas.ts`) y guarda SIEMPRE la promesa con el resultado:
 *
 * | Resultado | Estado | Qué pasa |
 * | --- | --- | --- |
 * | `aprobada` | `activa` | `promesa.creada` y `evaluarEstadoServicio` anidada: reactiva de inmediato |
 * | `pendiente_aprobacion` | `pendiente_aprobacion` | espera `POST /promesas/:id/aprobar` |
 * | `rechazada` | `rechazada` | `resultado_evaluacion.regla` dice la regla exacta que falló |
 *
 * `reglas_snapshot` guarda las reglas con que se evaluó. Una suspensión manual se respeta: la
 * promesa queda activa pero el servicio sigue suspendido hasta que un operador lo reactive.
 * Errores (no se guarda nada): servicio retirado o sin plantilla (422), ya tiene una promesa
 * activa o pendiente (409), `vence_en` en el pasado o monto mayor que la deuda (422).
 */

export interface EntradaCrearPromesa {
    servicio_id: number
    vence_en: Date
    /** string decimal "150.00" */
    monto: string
    canal: CanalPromesa
    /** instante de referencia (pruebas y simulador); por defecto ahora */
    ahora?: Date
}

export type ServicioTrasPromesa = Pick<
    ResultadoEvaluarEstado,
    'servicio_id' | 'estado' | 'de' | 'cambiado' | 'motivo'
>

export interface ResultadoCrearPromesa extends PromesaVista {
    /** cómo quedó el servicio (solo si la promesa quedó activa) */
    servicio?: ServicioTrasPromesa
}

const ESTADO_POR_RESULTADO: Record<ResultadoEvaluacion['resultado'], EstadoPromesa> = {
    aprobada: 'activa',
    pendiente_aprobacion: 'pendiente_aprobacion',
    rechazada: 'rechazada',
}

export default class CrearPromesaPago extends DomainAction<EntradaCrearPromesa, ResultadoCrearPromesa> {
    readonly nombre = 'promesas.crear'

    protected async handle(input: EntradaCrearPromesa, t: Transaccion): Promise<ResultadoCrearPromesa> {
        const ahora = input.ahora ?? new Date()
        const monto = dec(input.monto)
        if (monto.lte(0) || !tieneCentavosExactos(monto)) {
            throw new ValidacionFallida([
                {
                    field: 'monto',
                    message: 'El monto debe ser mayor que 0 con hasta 2 decimales',
                    rule: 'monto',
                },
            ])
        }
        if (!(input.vence_en instanceof Date) || Number.isNaN(input.vence_en.getTime())) {
            throw new ValidacionFallida([{ field: 'vence_en', message: 'Fecha inválida', rule: 'fecha' }])
        }
        if (input.vence_en <= ahora) {
            throw new ValidacionFallida([
                { field: 'vence_en', message: 'La promesa debe vencer en el futuro', rule: 'futuro' },
            ])
        }

        t.fijarEntidad('servicio', input.servicio_id)
        const servicio = await leerServicio(t.trx, input.servicio_id)
        // la promesa es de la empresa del servicio (403 si está fuera del alcance del actor)
        exigirAccesoEmpresa(t.ctx, servicio.empresa_id)
        t.fijarEmpresa(servicio.empresa_id)
        if (servicio.estado === 'retirado') {
            throw new ReglaNegocio('El servicio está retirado', 'servicio_retirado')
        }
        const config = await configuracionDeServicio(t.trx, servicio)
        if (!config) {
            throw new ReglaNegocio('El servicio no tiene plantilla de facturación', 'sin_plantilla')
        }
        await bloquearCliente(t.trx, servicio.cliente_id)

        const abierta = await t.trx
            .from('billing.promesas')
            .where('servicio_id', servicio.id)
            .whereIn('estado', ['activa', 'pendiente_aprobacion'])
            .select('id', 'estado')
            .first()
        if (abierta) {
            throw new Conflicto(
                `El servicio ${servicio.id} ya tiene la promesa ${abierta.id} ${abierta.estado === 'activa' ? 'activa' : 'pendiente de aprobación'}`,
                'promesa_abierta',
                'Promesa abierta',
            )
        }

        const datos = await datosEvaluacion(t.trx, servicio, config, {
            canal: input.canal,
            vence_en: input.vence_en,
            ahora,
        })
        if (datos.deuda.pendiente.gt(0) && monto.gt(datos.deuda.pendiente)) {
            throw new ValidacionFallida([
                {
                    field: 'monto',
                    message: `El monto supera la deuda pendiente del servicio (Q${aTexto(datos.deuda.pendiente)})`,
                    rule: 'monto_maximo',
                },
            ])
        }
        const evaluacion = evaluarReglas(datos)
        const estado = ESTADO_POR_RESULTADO[evaluacion.resultado]

        const [fila] = (await t.trx
            .insertQuery()
            .table('billing.promesas')
            .insert({
                empresa_id: servicio.empresa_id,
                servicio_id: servicio.id,
                cliente_id: servicio.cliente_id,
                vence_en: input.vence_en,
                monto: aTexto(monto),
                estado,
                canal: input.canal,
                aprobada_por:
                    estado === 'activa' && input.canal === 'supervisor' ? usuarioDelActor(t.ctx.actor) : null,
                reglas_snapshot: JSON.stringify(config.reglas_promesa),
                resultado_evaluacion: JSON.stringify(evaluacion),
                ...(input.ahora ? { created_at: ahora, updated_at: ahora } : {}),
            })
            .returning('id')) as Array<{ id: number }>
        const promesaId = fila!.id
        t.fijarEntidad('promesa', promesaId)

        if (estado !== 'activa') return verPromesa(promesaId, t.trx)

        await t.emit('promesa.creada', {
            promesa_id: promesaId,
            empresa_id: servicio.empresa_id,
            servicio_id: servicio.id,
            vence: input.vence_en.toISOString(),
            monto: aTexto(monto),
        })
        const r = await new EvaluarEstadoServicio().execute({ servicio_id: servicio.id, ahora }, t.ctx, {
            trx: t.trx,
        })
        return {
            ...(await verPromesa(promesaId, t.trx)),
            servicio: {
                servicio_id: r.servicio_id,
                estado: r.estado,
                de: r.de,
                cambiado: r.cambiado,
                motivo: r.motivo,
            },
        }
    }
}
