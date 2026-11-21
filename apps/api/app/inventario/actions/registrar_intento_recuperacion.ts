import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, Problema, ValidacionFallida } from '#shared/errores'
import { hoyGuatemala } from '#ledger/fechas'
import { empresaDeLaUnidad, servicioDe } from '#inventario/comodato'
import { columnasOrigenExterno, origenExternoDe, type OrigenExternoTipo } from '#inventario/origen_externo'
import { esInstante, idIrisDelActor, momentoDeLaOperacion } from '#inventario/cuadrillas'
import { actualizarUnidad, productoDeUnidad } from '#inventario/unidades'
import { bloquearProducto } from '#inventario/kardex'
import { enmascararSerie } from '#inventario/equipos'
import { resolverTecnico, type TecnicoExterno } from '#inventario/tecnicos'

/**
 * `servicios.registrar_intento_recuperacion` (`POST /servicios/:id/equipos/:unidad_id/no-recuperado`,
 * permiso `servicios.cambiar_equipo`; contrato Iris 0.12.0 §3.10, A48): «no se pudo recuperar». Registra
 * un **intento**; la pérdida la declara una persona en Argos (`inventario.cobrar_equipo`), nunca Iris.
 *
 * - La unidad debe estar en comodato (o por recuperar) en ese servicio (409 `unidad_no_es_del_servicio`;
 *   otro estado, 409 `estado_unidad_cambiado`). Queda (o pasa a) `por_recuperar`, sin asiento: el activo
 *   sigue vigente.
 * - `intento_n` lo calcula Argos. `foto_ref` (id opaco del adjunto de la orden en Iris) es obligatoria con
 *   `se_nego` y `equipo_perdido`; `ubicacion` siempre (422 `validacion`).
 * - Como máximo un intento por unidad al día (en Guatemala, por la `fecha` del teléfono): 429
 *   `demasiados_intentos`.
 * - Emite `inventario.recuperacion_intentada` (para avisar al titular con la serie enmascarada) y
 *   `inventario.unidad_estado_cambiado` si pasó a por recuperar. `nota` no va en eventos.
 */

export const MOTIVOS_NO_RECUPERADO = ['cliente_ausente', 'se_nego', 'equipo_perdido', 'otro'] as const

export interface EntradaIntentoRecuperacion {
    servicio_id: number
    unidad_id: number
    motivo: (typeof MOTIVOS_NO_RECUPERADO)[number]
    foto_ref?: string | null
    ubicacion: { lat: number; lng: number; precision_m: number }
    nota?: string | null
    fecha?: string | null
    recibido_en_iris?: string | null
    tecnico?: TecnicoExterno | null
    iris_actor?: string | null
    origen_tipo?: OrigenExternoTipo | null
    origen_id?: string | null
}

export interface ResultadoIntentoRecuperacion {
    id: number
    unidad_id: number
    servicio_id: number
    intento_n: number
    motivo: string
    estado: string
    fecha: Date
}

export class DemasiadosIntentos extends Problema {
    constructor(unidadId: number, dia: string) {
        super(
            429,
            'demasiados_intentos',
            'Demasiados intentos',
            `La unidad ${unidadId} ya tiene un intento de recuperación el ${dia}: uno por día`,
        )
    }
}

export default class RegistrarIntentoRecuperacion extends DomainAction<
    EntradaIntentoRecuperacion,
    ResultadoIntentoRecuperacion
> {
    readonly nombre = 'servicios.registrar_intento_recuperacion'

    protected async handle(
        input: EntradaIntentoRecuperacion,
        t: Transaccion,
    ): Promise<ResultadoIntentoRecuperacion> {
        const origenExterno = origenExternoDe(input)
        if ((input.motivo === 'se_nego' || input.motivo === 'equipo_perdido') && !input.foto_ref?.trim()) {
            throw new ValidacionFallida([
                {
                    field: 'foto_ref',
                    message: 'Con se_nego o equipo_perdido la foto es obligatoria',
                    rule: 'required',
                },
            ])
        }
        const momento = input.recibido_en_iris || esInstante(input.fecha) ? momentoDeLaOperacion(input) : null
        const fecha = momento?.instante ?? new Date()
        const dia = hoyGuatemala(fecha)
        t.fijarEntidad('unidad', input.unidad_id)
        const empresaId = await empresaDeLaUnidad(t, input.unidad_id)
        t.fijarEmpresa(empresaId)
        const servicio = await servicioDe(t, input.servicio_id, empresaId)
        await bloquearProducto(t, await productoDeUnidad(t, input.unidad_id))
        const unidad = (await t.trx
            .from('inventario.unidades')
            .where('id', input.unidad_id)
            .forUpdate()
            .select('id', 'estado', 'servicio_id', 'serie', 'mac')
            .first()) as {
            id: number
            estado: string
            servicio_id: number | null
            serie: string | null
            mac: string | null
        }
        if (unidad.servicio_id === null || Number(unidad.servicio_id) !== servicio.id) {
            throw new Conflicto(
                `La unidad ${unidad.id} no está en comodato en el servicio ${servicio.id}`,
                'unidad_no_es_del_servicio',
                'La unidad no es del servicio',
            )
        }
        if (unidad.estado !== 'en_comodato' && unidad.estado !== 'por_recuperar') {
            throw new Conflicto(
                `La unidad ${unidad.id} está ${unidad.estado.replaceAll('_', ' ')}: su estado cambió`,
                'estado_unidad_cambiado',
                'El estado de la unidad cambió',
            )
        }
        const repetido = await t.trx
            .from('inventario.intentos_recuperacion')
            .where({ unidad_id: unidad.id, dia })
            .select('id')
            .first()
        if (repetido) throw new DemasiadosIntentos(unidad.id, dia)
        const previo = (await t.trx
            .from('inventario.intentos_recuperacion')
            .where('unidad_id', unidad.id)
            .max('intento_n as n')
            .first()) as { n: number | null }
        const intentoN = Number(previo?.n ?? 0) + 1
        const idIris = idIrisDelActor(input.iris_actor)
        const tecnicoId = input.tecnico ? await resolverTecnico(t, input.tecnico) : null
        const [fila] = (await t.trx
            .insertQuery()
            .table('inventario.intentos_recuperacion')
            .insert({
                empresa_id: empresaId,
                unidad_id: unidad.id,
                servicio_id: servicio.id,
                intento_n: intentoN,
                motivo: input.motivo,
                foto_ref: input.foto_ref?.trim() || null,
                lat: String(input.ubicacion.lat),
                lng: String(input.ubicacion.lng),
                precision_m: String(input.ubicacion.precision_m),
                nota: input.nota?.trim() || null,
                fecha,
                dia,
                recibido_en_iris: input.recibido_en_iris ?? null,
                actor_tecnico: idIris ? `usuario:${idIris}` : null,
                actor_tecnico_id: tecnicoId,
                ...columnasOrigenExterno(origenExterno),
                registrado_por: usuarioDelActor(t.ctx.actor),
            })
            .returning('id')) as Array<{ id: number }>
        if (unidad.estado === 'en_comodato') {
            await actualizarUnidad(
                t,
                unidad.id,
                { estado: 'por_recuperar' },
                { motivo: 'intento_recuperacion', origenExterno },
            )
        }
        await t.emit('inventario.recuperacion_intentada', {
            intento_id: Number(fila!.id),
            unidad_id: Number(unidad.id),
            empresa_id: empresaId,
            servicio_id: servicio.id,
            cliente_id: servicio.cliente_id,
            intento_n: intentoN,
            motivo: input.motivo,
            serie_enmascarada: enmascararSerie(unidad.serie, unidad.mac),
            ...columnasOrigenExterno(origenExterno),
        })
        return {
            id: Number(fila!.id),
            unidad_id: Number(unidad.id),
            servicio_id: servicio.id,
            intento_n: intentoN,
            motivo: input.motivo,
            estado: 'por_recuperar',
            fecha,
        }
    }
}
