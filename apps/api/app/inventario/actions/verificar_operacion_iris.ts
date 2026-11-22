import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado } from '#shared/errores'
import { aplicarIntentoQueCuenta, type MotivoVerificacion } from '#inventario/recuperacion'

/**
 * `inventario.verificar_operacion_iris`: aplica la respuesta de Iris a la verificación de un intento de
 * recuperación o de un cambio con cobro propuesto (contrato Iris 0.14.0 §3.10, R-01 a R-03, T-3, T-4, T-7).
 * La consulta HTTP la hace `#inventario/verificacion_iris` (worker con reintentos, la pantalla de
 * declaración y el cupo diario) y llama aquí con el resultado; esta acción no habla con Iris.
 *
 * - Solo cambia una verificación `pendiente` (otra: sin cambios, `cambio: false`).
 * - `verificado`: un intento pasa la unidad a `por_recuperar` (si sigue en comodato en ese servicio) y
 *   avisa al titular (uno por servicio al día); un cambio deja su cobro propuesto en la cola (`propuesto`).
 * - `no_verificado` (`no_enviado_por_iris`, `no_coincide`, `foto_invalida`, `desconocido_en_iris`): queda
 *   como registro con su motivo, sin reintentos. Un cobro propuesto pasa a `no_verificado` y nunca entra a
 *   la cola.
 * - `pendiente` (`envio_en_curso`, `foto_pendiente`, `error_iris`, `timeout`, `sin_acceso`, `limitado`,
 *   `sin_conector`, `respuesta_invalida`): siguiente consulta con espera creciente (30 s, 1 min, 5 min,
 *   15 min, 1 h, 6 h y después cada 12 h, hasta 20 consultas), o según `Retry-After` con `limitado`. Con
 *   `sin_conector` no gasta consultas. La primera vez que Iris responde `401`/`403` avisa al admin
 *   (`inventario.verificacion_sin_acceso`, en el registro del sistema).
 * - Emite `inventario.operacion_verificada` cuando la verificación termina (verificada o no).
 */

export const ESPERAS_VERIFICACION_S = [30, 60, 300, 900, 3600, 21600, 43200]
export const CONSULTAS_MAXIMAS = 20

export type ResultadoConsultaIris =
    | { tipo: 'verificado'; status: number }
    | { tipo: 'no_verificado'; motivo: MotivoVerificacion; status: number | null }
    | {
          tipo: 'pendiente'
          motivo: MotivoVerificacion
          status: number | null
          reintentar_en_s?: number | null
      }

export interface EntradaVerificarOperacionIris {
    verificacion_id: number
    resultado: ResultadoConsultaIris
    /** quién pidió la consulta: `worker`, `pantalla` (al abrir la declaración) o `cupo` (antes del 429) */
    origen: 'worker' | 'pantalla' | 'cupo'
}

export interface SalidaVerificarOperacionIris {
    verificacion_id: number
    estado: string
    motivo: string | null
    cambio: boolean
    proxima_en: Date | null
}

interface Fila {
    id: number
    empresa_id: number
    operacion: 'no_recuperado' | 'cambio'
    intento_id: number | null
    cambio_id: number | null
    estado: string
    motivo: string | null
    consultas: number
}

export function esperaVerificacion(consultas: number): number {
    return ESPERAS_VERIFICACION_S[Math.min(consultas, ESPERAS_VERIFICACION_S.length) - 1] ?? 30
}

export default class VerificarOperacionIris extends DomainAction<
    EntradaVerificarOperacionIris,
    SalidaVerificarOperacionIris
> {
    readonly nombre = 'inventario.verificar_operacion_iris'

    protected async handle(
        input: EntradaVerificarOperacionIris,
        t: Transaccion,
    ): Promise<SalidaVerificarOperacionIris> {
        const fila = (await t.trx
            .from('inventario.verificaciones_iris')
            .where('id', input.verificacion_id)
            .forUpdate()
            .select(
                'id',
                'empresa_id',
                'operacion',
                'intento_id',
                'cambio_id',
                'estado',
                'motivo',
                'consultas',
            )
            .first()) as Fila | null
        if (!fila) throw new NoEncontrado(`La verificación ${input.verificacion_id} no existe`)
        const empresaId = Number(fila.empresa_id)
        t.fijarEmpresa(empresaId)
        t.fijarEntidad('verificacion_iris', Number(fila.id))
        if (fila.estado !== 'pendiente') {
            return {
                verificacion_id: Number(fila.id),
                estado: fila.estado,
                motivo: fila.motivo,
                cambio: false,
                proxima_en: null,
            }
        }
        const r = input.resultado
        const gasta = !(r.tipo === 'pendiente' && r.motivo === 'sin_conector')
        const consultas = Number(fila.consultas) + (gasta ? 1 : 0)
        let estado = 'pendiente'
        let motivo: string | null = null
        let proxima: Date | null = null
        if (r.tipo === 'verificado') {
            estado = 'verificado'
        } else if (r.tipo === 'no_verificado') {
            estado = 'no_verificado'
            motivo = r.motivo
        } else {
            motivo = r.motivo
            if (consultas < CONSULTAS_MAXIMAS) {
                const espera =
                    r.motivo === 'limitado' && r.reintentar_en_s
                        ? Math.min(Math.max(1, r.reintentar_en_s), 43200)
                        : r.motivo === 'sin_conector'
                          ? 300
                          : esperaVerificacion(consultas)
                proxima = new Date(Date.now() + espera * 1000)
            }
        }
        await t.trx
            .from('inventario.verificaciones_iris')
            .where('id', fila.id)
            .update({
                estado,
                motivo,
                consultas,
                proxima_en: proxima,
                ultima_consulta_en: gasta ? t.trx.knexRawQuery('now()') : undefined,
                ultimo_status: r.status ?? null,
                verificado_en: estado === 'verificado' ? t.trx.knexRawQuery('now()') : null,
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        await t.registrarCambios(
            { tipo: 'verificacion_iris', id: Number(fila.id) },
            { estado: fila.estado, motivo: fila.motivo },
            { estado, motivo },
        )

        if (r.tipo === 'pendiente' && r.motivo === 'sin_acceso' && fila.motivo !== 'sin_acceso') {
            await t.emit('inventario.verificacion_sin_acceso', {
                verificacion_id: Number(fila.id),
                empresa_id: empresaId,
                operacion: fila.operacion,
                status: r.status ?? null,
            })
        }

        if (estado !== 'pendiente') {
            let unidadId: number | null = null
            let servicioId: number | null = null
            if (fila.operacion === 'no_recuperado') {
                const intento = (await t.trx
                    .from('inventario.intentos_recuperacion')
                    .where('id', fila.intento_id!)
                    .select('unidad_id', 'servicio_id')
                    .first()) as { unidad_id: number; servicio_id: number }
                unidadId = Number(intento.unidad_id)
                servicioId = Number(intento.servicio_id)
                if (estado === 'verificado') {
                    await aplicarIntentoQueCuenta(t, Number(fila.intento_id), { avisar: true })
                }
            } else {
                const cambio = (await t.trx
                    .from('inventario.cambios_equipo')
                    .where('id', fila.cambio_id!)
                    .select('sale_unidad_id', 'servicio_id')
                    .first()) as { sale_unidad_id: number; servicio_id: number }
                unidadId = Number(cambio.sale_unidad_id)
                servicioId = Number(cambio.servicio_id)
                await t.trx
                    .from('inventario.cobros_equipo')
                    .where({ cambio_id: fila.cambio_id!, estado: 'por_verificar' })
                    .update(
                        estado === 'verificado'
                            ? {
                                  estado: 'propuesto',
                                  version: t.trx.knexRawQuery('version + 1'),
                                  updated_at: t.trx.knexRawQuery('now()'),
                              }
                            : {
                                  estado: 'no_verificado',
                                  decidido_en: t.trx.knexRawQuery('now()'),
                                  motivo_decision: `sin verificar en Iris: ${motivo}`,
                                  version: t.trx.knexRawQuery('version + 1'),
                                  updated_at: t.trx.knexRawQuery('now()'),
                              },
                    )
            }
            await t.emit('inventario.operacion_verificada', {
                verificacion_id: Number(fila.id),
                empresa_id: empresaId,
                operacion: fila.operacion,
                intento_id: fila.intento_id === null ? null : Number(fila.intento_id),
                cambio_id: fila.cambio_id === null ? null : Number(fila.cambio_id),
                unidad_id: unidadId,
                servicio_id: servicioId,
                estado: estado as 'verificado' | 'no_verificado',
                motivo,
            })
        }
        return { verificacion_id: Number(fila.id), estado, motivo, cambio: true, proxima_en: proxima }
    }
}
