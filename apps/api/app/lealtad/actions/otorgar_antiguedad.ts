import { DomainAction, type Transaccion } from '#shared/domain_action'
import { hoyGuatemala } from '#ledger/fechas'
import { programaActivo, programaVigente } from '#lealtad/programas'
import { reglasVigentes, type CondicionesAntiguedad } from '#lealtad/reglas'
import { bloquearClienteLealtad, otorgamientoVigente } from '#lealtad/puntos'
import {
    mesesCompletos,
    serviciosParaAntiguedad,
    sumarMeses,
    suspendidoEntre,
    vencidaMasDe,
} from '#lealtad/condiciones'
import { otorgar, resultadoVacio, vigenciaDe, type Resultado } from '#lealtad/otorgamientos'

/**
 * `lealtad.otorgar_antiguedad` (cron `lealtad:antiguedad`, §4): por cada servicio de la empresa en
 * `estados_validos` con fecha de instalación, cada `cada_meses` cumplidos hasta hoy es un
 * aniversario `k` con clave `antiguedad:servicio:<id>:<k>` (todo lo pendiente hasta hoy; repetir no
 * duplica). Un aniversario otorga si cae dentro de la vigencia del programa y de la regla (nada
 * retroactivo), el servicio no pasó a `suspendido` en ese ciclo (eventos `servicio.estado_cambiado`)
 * y ninguna factura del ciclo se pagó más de `sin_vencidas_mas_de_dias` después de vencer.
 *
 * Una empresa y hasta `limite` servicios por ejecución (desde `despues_de`); el cron sigue con
 * `ultimo_servicio_id` mientras `pendientes` sea true.
 */

export interface EntradaAntiguedad {
    empresa_id: number
    hoy?: string
    despues_de?: number
    limite?: number
}

export interface ResultadoAntiguedad extends Resultado {
    empresa_id: number
    hoy: string
    revisados: number
    ultimo_servicio_id: number
    pendientes: boolean
}

export default class OtorgarAntiguedad extends DomainAction<EntradaAntiguedad, ResultadoAntiguedad> {
    readonly nombre = 'lealtad.otorgar_antiguedad'

    protected async handle(input: EntradaAntiguedad, t: Transaccion): Promise<ResultadoAntiguedad> {
        const hoy = input.hoy ?? hoyGuatemala()
        const limite = Math.min(Math.max(input.limite ?? 500, 1), 5000)
        const resultado: ResultadoAntiguedad = {
            ...resultadoVacio(),
            empresa_id: input.empresa_id,
            hoy,
            revisados: 0,
            ultimo_servicio_id: input.despues_de ?? 0,
            pendientes: false,
        }
        t.fijarEmpresa(input.empresa_id)
        const programa = await programaActivo(input.empresa_id, t.trx)
        if (!programa || !programaVigente(programa, hoy)) return resultado
        const reglas = await reglasVigentes(t.trx, programa.id, hoy, 'antiguedad')
        if (reglas.length === 0) return resultado
        const estados = [
            ...new Set(reglas.flatMap((r) => (r.condiciones as CondicionesAntiguedad).estados_validos)),
        ]

        const servicios = await serviciosParaAntiguedad(
            t.trx,
            input.empresa_id,
            estados,
            input.despues_de ?? 0,
            limite + 1,
        )
        resultado.pendientes = servicios.length > limite
        for (const servicio of servicios.slice(0, limite)) {
            resultado.revisados++
            resultado.ultimo_servicio_id = servicio.id
            for (const regla of reglas) {
                const condiciones = regla.condiciones as CondicionesAntiguedad
                if (!condiciones.estados_validos.includes(servicio.estado)) continue
                const vigencia = vigenciaDe(programa, regla)
                const ciclos = Math.floor(
                    mesesCompletos(servicio.fecha_instalacion, hoy) / condiciones.cada_meses,
                )
                for (let k = 1; k <= ciclos; k++) {
                    const aniversario = sumarMeses(servicio.fecha_instalacion, k * condiciones.cada_meses)
                    if (aniversario > hoy || aniversario < vigencia.desde) continue
                    if (vigencia.hasta !== null && aniversario > vigencia.hasta) continue
                    const base = `antiguedad:servicio:${servicio.id}:${k}`
                    const previo = await otorgamientoVigente(t.trx, input.empresa_id, base)
                    if (previo.vigente) continue
                    const inicioCiclo = sumarMeses(
                        servicio.fecha_instalacion,
                        (k - 1) * condiciones.cada_meses,
                    )
                    if (await suspendidoEntre(t.trx, servicio.id, inicioCiclo, aniversario)) {
                        resultado.omitidos.push({ clave: base, motivo: 'suspendido en el ciclo' })
                        continue
                    }
                    if (
                        condiciones.sin_vencidas_mas_de_dias !== null &&
                        (await vencidaMasDe(
                            t.trx,
                            servicio.id,
                            inicioCiclo,
                            aniversario,
                            condiciones.sin_vencidas_mas_de_dias,
                            hoy,
                        ))
                    ) {
                        resultado.omitidos.push({ clave: base, motivo: 'factura pagada tarde en el ciclo' })
                        continue
                    }
                    await bloquearClienteLealtad(t.trx, servicio.cliente_id)
                    await otorgar(
                        t,
                        programa,
                        regla,
                        base,
                        {
                            cliente_id: servicio.cliente_id,
                            servicio_id: servicio.id,
                            puntos: regla.puntos,
                            origen_tipo: 'servicio',
                            origen_id: servicio.id,
                            fecha: hoy,
                            concepto: `${k * condiciones.cada_meses} meses del servicio ${servicio.id}`,
                        },
                        resultado,
                    )
                }
            }
        }
        return resultado
    }
}
