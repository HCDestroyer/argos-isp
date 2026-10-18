import { DateTime } from 'luxon'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { ValidacionFallida } from '#shared/errores'
import { fechaValida } from '#ledger/fechas'
import { RegimenFueraDePlazo } from '#fiscal/errores'
import { empresaFiscal, exigirVigenciaAbierta, hoyFiscal } from '#fiscal/comun'
import { invalidarParametros } from '#fiscal/cache_parametros'
import { frasesVigentes, type FraseVista } from '#fiscal/frases'
import { definicion, filasValores, resolver } from '#fiscal/parametros'

/**
 * `fiscal.cambiar_regimen` (`POST /fiscal/regimen`, contrato §6.2): agrega el régimen de la empresa
 * con su vigencia (sus frases se derivan de él al leer). Valida la ley (inv. A.2, LAT arts. 50 y 51):
 *
 * - La **primera configuración** de la empresa (sin un régimen puesto por un usuario) admite
 *   cualquier fecha: es la inscripción. El que dejó la instalación (de `core.empresas.regimen_isr`)
 *   no cuenta como configuración.
 * - Después, el cambio solo rige desde el **1 de enero de un año futuro** y exige el aviso a la SAT
 *   (`aviso_sat.numero` y `aviso_sat.fecha`), que se presenta en **diciembre del año anterior** y no
 *   puede ser futuro. Si no: 422 `regimen_fuera_de_plazo`.
 *
 * El sistema nunca cambia el régimen por su cuenta (tampoco al superar el límite de pequeño
 * contribuyente). Audita en `audit.cambios` (`parametro_fiscal`, campo `regimen`) y emite
 * `fiscal.parametros_cambiados` y `fiscal.config_cambiada` (`regimen` y `frases`).
 */

export interface EntradaCambiarRegimen {
    regimen: string
    vigente_desde: string
    aviso_sat?: { numero: string; fecha: string } | null
    motivo?: string | null
    empresa_id?: number | null
}

export interface RegimenCambiado {
    empresa_id: number
    regimen: string
    vigente_desde: string
    anterior: string | null
    primera_configuracion: boolean
    aviso_sat: { numero: string; fecha: string } | null
    valor_id: number
    /** frases que aplican desde `vigente_desde` */
    frases: FraseVista[]
}

export default class CambiarRegimen extends DomainAction<EntradaCambiarRegimen, RegimenCambiado> {
    readonly nombre = 'fiscal.cambiar_regimen'

    protected async handle(input: EntradaCambiarRegimen, t: Transaccion): Promise<RegimenCambiado> {
        const vigenteDesde = fechaValida(input.vigente_desde, 'vigente_desde')
        const { empresaId, instalacion } = await empresaFiscal(t, input.empresa_id)
        const def = await definicion(instalacion.pais, 'regimen', t.trx)
        if (!(def.opciones ?? []).includes(input.regimen)) {
            throw new ValidacionFallida([
                { field: 'regimen', message: `Una de: ${(def.opciones ?? []).join(', ')}`, rule: 'enum' },
            ])
        }

        const filas = await filasValores(instalacion.pais, empresaId, t.trx, 'regimen')
        const primera = !filas.some((f) => f.empresa_id === empresaId && f.origen === 'usuario')
        const hoy = hoyFiscal()
        let aviso: RegimenCambiado['aviso_sat'] = null
        if (!primera) {
            const desde = DateTime.fromISO(vigenteDesde, { zone: 'utc' })
            const anioHoy = Number(hoy.slice(0, 4))
            if (desde.month !== 1 || desde.day !== 1 || desde.year <= anioHoy) {
                throw new RegimenFueraDePlazo(
                    'vigente_desde',
                    `El cambio de régimen rige desde el 1 de enero de un año futuro (LAT, art. 51); ${vigenteDesde} no lo es`,
                )
            }
            if (!input.aviso_sat?.numero?.trim() || !input.aviso_sat.fecha) {
                throw new ValidacionFallida([
                    {
                        field: 'aviso_sat',
                        message: 'El cambio de régimen exige el número y la fecha del aviso a la SAT',
                        rule: 'required',
                    },
                ])
            }
            const fechaAviso = fechaValida(input.aviso_sat.fecha, 'aviso_sat.fecha')
            const diciembre = `${desde.year - 1}-12`
            if (!fechaAviso.startsWith(diciembre) || fechaAviso > hoy) {
                throw new RegimenFueraDePlazo(
                    'aviso_sat.fecha',
                    `El aviso a la SAT se presenta en diciembre de ${desde.year - 1}, antes del nuevo periodo (LAT, art. 51), y no puede ser futuro`,
                )
            }
            aviso = { numero: input.aviso_sat.numero.trim(), fecha: fechaAviso }
        } else if (input.aviso_sat?.numero?.trim() && input.aviso_sat.fecha) {
            aviso = {
                numero: input.aviso_sat.numero.trim(),
                fecha: fechaValida(input.aviso_sat.fecha, 'aviso_sat.fecha'),
            }
        }

        const anterior = (resolver(filas, 'regimen', vigenteDesde)?.valor as string | undefined) ?? null
        if (!primera && anterior === input.regimen) {
            throw new ValidacionFallida([
                {
                    field: 'regimen',
                    message: `La empresa ya está en ${input.regimen} en esa fecha`,
                    rule: 'sin_cambio',
                },
            ])
        }
        await exigirVigenciaAbierta(t.trx, empresaId, vigenteDesde)
        if (
            filas.some(
                (f) =>
                    f.empresa_id === empresaId && f.origen === 'usuario' && f.vigente_desde === vigenteDesde,
            )
        ) {
            throw new ValidacionFallida([
                {
                    field: 'vigente_desde',
                    message: 'Ya hay un régimen con esa vigencia',
                    rule: 'vigencia_duplicada',
                },
            ])
        }

        const motivo = [
            primera ? 'Primera configuración del régimen' : 'Cambio de régimen',
            aviso ? `aviso SAT ${aviso.numero} del ${aviso.fecha}` : null,
            input.motivo?.trim() || null,
        ]
            .filter(Boolean)
            .join('; ')
        const [fila] = (await t.trx
            .insertQuery()
            .table('fiscal.parametros_valores')
            .insert({
                pais: instalacion.pais,
                empresa_id: empresaId,
                clave: 'regimen',
                valor: JSON.stringify(input.regimen),
                vigente_desde: vigenteDesde,
                origen: 'usuario',
                motivo,
                creado_por: usuarioDelActor(t.ctx.actor),
            })
            .returning('id')) as Array<{ id: number }>
        const valorId = Number(fila!.id)
        t.fijarEntidad('parametro_fiscal', valorId)

        await t.registrarCambios(
            { tipo: 'parametro_fiscal', id: valorId },
            { regimen: anterior },
            { regimen: input.regimen },
        )
        await t.emit('fiscal.parametros_cambiados', {
            empresa_id: empresaId,
            claves: ['regimen'],
            vigente_desde: vigenteDesde,
        })
        await t.emit('fiscal.config_cambiada', {
            empresa_id: empresaId,
            // las frases del régimen se derivan de él: cambian con él
            campos: ['regimen', 'frases'],
        })
        t.alConfirmar(() => invalidarParametros(empresaId))

        return {
            empresa_id: empresaId,
            regimen: input.regimen,
            vigente_desde: vigenteDesde,
            anterior,
            primera_configuracion: primera,
            aviso_sat: aviso,
            valor_id: valorId,
            frases: await frasesVigentes(empresaId, vigenteDesde, t.trx),
        }
    }
}
