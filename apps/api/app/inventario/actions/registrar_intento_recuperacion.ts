import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, Problema, ValidacionFallida } from '#shared/errores'
import { hoyGuatemala } from '#ledger/fechas'
import { empresaDeLaUnidad, servicioDe } from '#inventario/comodato'
import { columnasOrigenExterno, origenExternoDe, type OrigenExternoTipo } from '#inventario/origen_externo'
import { esInstante, idIrisDelActor, momentoDeLaOperacion } from '#inventario/cuadrillas'
import { productoDeUnidad } from '#inventario/unidades'
import { bloquearProducto } from '#inventario/kardex'
import { estadoEquipo } from '#inventario/equipos'
import { resolverTecnico, type TecnicoExterno } from '#inventario/tecnicos'
import { esActorIris, estadoVinculos, exigirVinculoIris } from '#inventario/vinculos_iris'
import {
    CupoPorVerificar,
    MOTIVOS_SIN_CUPO,
    aplicarIntentoQueCuenta,
    type EstadoVerificacion,
} from '#inventario/recuperacion'

/**
 * `servicios.registrar_intento_recuperacion` (`POST /servicios/:id/equipos/:unidad_id/no-recuperado`,
 * permiso `servicios.cambiar_equipo`; contrato Iris 0.12.0 §3.10, A48): «no se pudo recuperar». Registra
 * un **intento**; la pérdida la declara una persona en Argos (`inventario.cobrar_equipo`), nunca Iris.
 *
 * - La unidad debe estar en comodato (o por recuperar) en ese servicio (409 `unidad_no_es_del_servicio`;
 *   otro estado, 409 `estado_unidad_cambiado`). Queda (o pasa a) `por_recuperar`, sin asiento: el activo
 *   sigue vigente.
 * - `intento_n` lo calcula Argos. `foto_ref` (id opaco del adjunto de la orden en Iris) es obligatoria con
 *   `se_nego` y `equipo_perdido`; desde 0.14.0 (Iris ≥ 0.14.0), con cualquier `motivo`. `ubicacion`
 *   siempre (422 `validacion`).
 * - **Verificación (0.14.0, R-01 a R-03).** Con un Iris ≥ 0.14.0 la `Idempotency-Key` es obligatoria
 *   (`iris:no_recuperado:<orden>:<unidad>:<intento_id>`) y se guarda tal cual para verificar el intento con
 *   Iris (`inventario.verificaciones_iris`, estado `pendiente`). Mientras no esté verificado, el intento no
 *   cambia la unidad, no avisa al titular y no cuenta para el mínimo. Con un Iris < 0.14.0 queda
 *   «anterior a la verificación» (lo decide una persona, §4.5). Registrado por una persona en Argos, cuenta
 *   en el momento.
 * - **Cupo (T-2, N-4, N-5).** Como máximo un intento por unidad al día de Guatemala de la `fecha`: 429
 *   `demasiados_intentos` (definitivo). Un intento que Iris no confirma (`desconocido_en_iris`,
 *   `no_enviado_por_iris`, `no_coincide`) o descartado por una persona no ocupa el cupo; uno pendiente de
 *   verificar hace que la ruta lo verifique (`CupoPorVerificar`) y, si no es concluyente, `503` con
 *   `Retry-After`.
 * - Emite `inventario.recuperacion_intentada` (aviso al titular, uno por servicio al día) y
 *   `inventario.unidad_estado_cambiado` cuando el intento cuenta. `nota` no va en eventos.
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
    /** `Idempotency-Key` con la que llegó (la pone la ruta): se verifica con Iris tal cual */
    idempotency_key?: string | null
}

export interface ResultadoIntentoRecuperacion {
    id: number
    unidad_id: number
    servicio_id: number
    intento_n: number
    motivo: string
    estado: string
    fecha: Date
    /** verificación con Iris (0.14.0): `pendiente`, `anterior` o `no_aplica` (registrado en Argos) */
    verificacion: EstadoVerificacion
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
        const iris = await esActorIris(t)
        const vinculos = iris ? await estadoVinculos(t.trx) : null
        const verificar = vinculos?.exige === true
        const modo: EstadoVerificacion = verificar ? 'pendiente' : iris ? 'anterior' : 'no_aplica'
        const fotoObligatoria = verificar || input.motivo === 'se_nego' || input.motivo === 'equipo_perdido'
        if (fotoObligatoria && !input.foto_ref?.trim()) {
            throw new ValidacionFallida([
                {
                    field: 'foto_ref',
                    message: verificar
                        ? 'La foto es obligatoria en todo intento (contrato 0.14.0)'
                        : 'Con se_nego o equipo_perdido la foto es obligatoria',
                    rule: 'required',
                },
            ])
        }
        const clave = input.idempotency_key?.trim() || null
        if (verificar) {
            if (!clave) {
                throw new Problema(
                    400,
                    'idempotency_key_requerida',
                    'Falta Idempotency-Key',
                    'Con el contrato 0.14.0 el intento lleva Idempotency-Key iris:no_recuperado:<orden>:<unidad>:<intento_id>: con ella se verifica en Iris',
                )
            }
            if (!clave.startsWith(`iris:no_recuperado:`) || !clave.includes(`:${input.unidad_id}:`)) {
                throw new ValidacionFallida([
                    {
                        field: 'Idempotency-Key',
                        message: `Se espera iris:no_recuperado:<orden>:${input.unidad_id}:<intento_id>`,
                        rule: 'idempotency_key',
                    },
                ])
            }
        }
        const momento = input.recibido_en_iris || esInstante(input.fecha) ? momentoDeLaOperacion(input) : null
        const fecha = momento?.instante ?? new Date()
        const dia = hoyGuatemala(fecha)
        t.fijarEntidad('unidad', input.unidad_id)
        const empresaId = await empresaDeLaUnidad(t, input.unidad_id)
        t.fijarEmpresa(empresaId)
        const servicio = await servicioDe(t, input.servicio_id, empresaId)
        const tecnicoId = input.tecnico ? await resolverTecnico(t, input.tecnico) : null
        if (tecnicoId !== null) {
            await exigirVinculoIris(t, { usuarioId: tecnicoId, empresaId, iris_actor: input.iris_actor })
        }
        await bloquearProducto(t, await productoDeUnidad(t, input.unidad_id))
        const unidad = (await t.trx
            .from('inventario.unidades')
            .where('id', input.unidad_id)
            .forUpdate()
            .select('id', 'estado', 'servicio_id')
            .first()) as { id: number; estado: string; servicio_id: number | null }
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
        await this.exigirCupo(t, Number(unidad.id), dia)
        const previo = (await t.trx
            .from('inventario.intentos_recuperacion')
            .where('unidad_id', unidad.id)
            .max('intento_n as n')
            .first()) as { n: number | null }
        const intentoN = Number(previo?.n ?? 0) + 1
        const idIris = idIrisDelActor(input.iris_actor)
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
        const intentoId = Number(fila!.id)
        if (modo === 'no_aplica') {
            await aplicarIntentoQueCuenta(t, intentoId, { avisar: true })
        } else {
            await t.trx
                .insertQuery()
                .table('inventario.verificaciones_iris')
                .insert({
                    empresa_id: empresaId,
                    operacion: 'no_recuperado',
                    intento_id: intentoId,
                    idempotency_key: clave,
                    estado: modo,
                    proxima_en:
                        modo === 'pendiente' ? t.trx.knexRawQuery(`now() + interval '30 seconds'`) : null,
                })
        }
        return {
            id: intentoId,
            unidad_id: Number(unidad.id),
            servicio_id: servicio.id,
            intento_n: intentoN,
            motivo: input.motivo,
            estado: (await estadoEquipo(Number(unidad.id), t.trx)) ?? unidad.estado,
            fecha,
            verificacion: modo,
        }
    }

    /**
     * Uno por unidad al día (T-2): cuentan los registrados en Argos, los verificados, los aceptados, los
     * anteriores a la verificación y los `no_verificado` con `foto_invalida`. Un pendiente se verifica antes
     * de decidir (`CupoPorVerificar`).
     */
    private async exigirCupo(t: Transaccion, unidadId: number, dia: string): Promise<void> {
        const delDia = (await t.trx
            .from('inventario.intentos_recuperacion as i')
            .leftJoin('inventario.verificaciones_iris as v', 'v.intento_id', 'i.id')
            .where('i.unidad_id', unidadId)
            .where('i.dia', dia)
            .select('i.id', 'v.id as verificacion_id', 'v.estado', 'v.motivo')) as Array<{
            id: number
            verificacion_id: number | null
            estado: string | null
            motivo: string | null
        }>
        const porVerificar: number[] = []
        for (const f of delDia) {
            if (f.estado === 'pendiente') {
                porVerificar.push(Number(f.verificacion_id))
                continue
            }
            const libre =
                f.estado === 'descartado' ||
                (f.estado === 'no_verificado' && MOTIVOS_SIN_CUPO.includes(f.motivo ?? ''))
            if (!libre) throw new DemasiadosIntentos(unidadId, dia)
        }
        if (porVerificar.length > 0) throw new CupoPorVerificar(porVerificar)
    }
}
