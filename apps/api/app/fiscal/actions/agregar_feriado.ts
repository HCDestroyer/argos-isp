import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, ReglaNegocio, ValidacionFallida } from '#shared/errores'
import { fechaValida } from '#ledger/fechas'
import { exigirAlcanceGlobal } from '#fiscal/comun'
import { feriadosVigentesFilas, verFeriado, type FeriadoVista } from '#fiscal/calendario'
import GenerarCalendario, { type ResultadoCalendario } from '#fiscal/actions/generar_calendario'

/**
 * `fiscal.agregar_feriado` (`POST /fiscal/feriados`, permiso `fiscal.configurar`): agrega un día
 * inhábil a `fiscal.feriados` (global: requiere alcance global) o lo retira con `activo: false`
 * (contrato §3.2, §15 #22). Solo inserción: la fila vigente de cada fecha es la última.
 *
 * - 409 `feriado_duplicado` si la fecha ya es feriado con el mismo nombre; 422 `feriado_inexistente`
 *   al retirar una fecha que no es feriado.
 * - En la misma transacción recalcula el calendario de todas las empresas (`fiscal.generar_calendario`):
 *   los vencimientos sin presentar corren al día hábil que corresponda.
 * - Evento `fiscal.parametros_cambiados` (`empresa_id` null, `claves: ['feriados']`,
 *   `vigente_desde` = la fecha) para quien muestre plazos.
 */

export interface EntradaAgregarFeriado {
    fecha: string
    nombre?: string | null
    activo?: boolean
    motivo: string
}

export interface FeriadoAgregado extends FeriadoVista {
    calendario: ResultadoCalendario
}

export default class AgregarFeriado extends DomainAction<EntradaAgregarFeriado, FeriadoAgregado> {
    readonly nombre = 'fiscal.agregar_feriado'

    protected async handle(input: EntradaAgregarFeriado, t: Transaccion): Promise<FeriadoAgregado> {
        const fecha = fechaValida(input.fecha, 'fecha')
        exigirAlcanceGlobal(t)
        t.fijarEmpresa(null)
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?)', [3042])

        const activo = input.activo ?? true
        const [previa] = await feriadosVigentes(t, fecha)
        let nombre = input.nombre?.trim() ?? ''
        if (activo) {
            if (nombre.length < 3) {
                throw new ValidacionFallida([
                    {
                        field: 'nombre',
                        message: 'Nombre del feriado (mínimo 3 caracteres)',
                        rule: 'required',
                    },
                ])
            }
            if (previa?.activo && previa.nombre === nombre) {
                throw new Conflicto(
                    `El ${fecha} ya es feriado (${nombre})`,
                    'feriado_duplicado',
                    'Feriado duplicado',
                )
            }
        } else {
            if (!previa?.activo) {
                throw new ReglaNegocio(
                    `El ${fecha} no es feriado: no hay nada que retirar`,
                    'feriado_inexistente',
                )
            }
            nombre = previa.nombre
        }

        const [fila] = (await t.trx
            .insertQuery()
            .table('fiscal.feriados')
            .insert({
                fecha,
                nombre,
                activo,
                origen: 'usuario',
                motivo: input.motivo.trim(),
                creado_por: usuarioDelActor(t.ctx.actor),
            })
            .returning('id')) as Array<{ id: number }>
        const id = Number(fila!.id)
        t.fijarEntidad('feriado', id)
        await t.registrarCambios(
            { tipo: 'feriado', id },
            previa ? { fecha, nombre: previa.nombre, activo: previa.activo } : { fecha },
            { fecha, nombre, activo },
        )
        await t.emit('fiscal.parametros_cambiados', {
            empresa_id: null,
            claves: ['feriados'],
            vigente_desde: fecha,
        })

        const calendario = await new GenerarCalendario().execute({}, t.ctx, { trx: t.trx })
        return { ...(await verFeriado(id, t.trx)), calendario }
    }
}

async function feriadosVigentes(t: Transaccion, fecha: string) {
    return feriadosVigentesFilas(t.trx, { desde: fecha, hasta: fecha })
}
