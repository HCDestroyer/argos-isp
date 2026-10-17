import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, NoEncontrado } from '#shared/errores'
import { dec } from '#ledger/dinero'
import { fechaValida } from '#ledger/fechas'
import { ParametroFueraDeRango } from '#fiscal/errores'
import { empresaFiscal, exigirAlcanceGlobal, exigirVigenciaAbierta } from '#fiscal/comun'
import { invalidarParametros } from '#fiscal/cache_parametros'
import { filasImpuestos } from '#fiscal/parametros'
import { resolverImpuesto, type ImpuestoVigente } from '#fiscal/impuestos'

/**
 * `fiscal.editar_impuesto` (`POST /fiscal/impuestos/:codigo/versiones`, permiso
 * `fiscal.editar_parametros`): agrega una versión del impuesto con otra tasa (o inactivo) desde
 * `vigente_desde`. Copia el resto (cálculo, cuentas, cuadrículas) de la versión vigente en esa
 * fecha. Nunca edita una versión: lo anterior a la fecha no cambia.
 *
 * - Una retención lleva tasa negativa y un impuesto positiva (422 `parametro_fuera_de_rango`,
 *   regla `signo`; también lo valida un trigger).
 * - `ambito = global` exige alcance global. 422 `vigencia_en_periodo_bloqueado`; 409
 *   `vigencia_duplicada`.
 * - `audit.cambios` (`impuesto_fiscal`: tasa y activo); evento `fiscal.parametros_cambiados` con la
 *   clave `impuesto:<codigo>`.
 */

export interface EntradaEditarImpuesto {
    codigo: string
    /** por ciento con signo, string: "12.00", "-15.00" */
    tasa: string
    vigente_desde: string
    motivo: string
    activo?: boolean
    ambito?: 'empresa' | 'global'
    empresa_id?: number | null
}

const TASA = /^-?\d{1,3}(\.\d{1,6})?$/

export default class EditarImpuesto extends DomainAction<EntradaEditarImpuesto, ImpuestoVigente> {
    readonly nombre = 'fiscal.editar_impuesto'

    protected async handle(input: EntradaEditarImpuesto, t: Transaccion): Promise<ImpuestoVigente> {
        const vigenteDesde = fechaValida(input.vigente_desde, 'vigente_desde')
        const global = input.ambito === 'global'
        let empresaId: number | null = null
        let pais = 'GT'
        if (global) {
            exigirAlcanceGlobal(t)
            t.fijarEmpresa(null)
        } else {
            const datos = await empresaFiscal(t, input.empresa_id)
            empresaId = datos.empresaId
            pais = datos.instalacion.pais
        }

        const leido56 = await filasImpuestos(pais, empresaId, t.trx)
        const filas = leido56.filter((f) => f.codigo === input.codigo)
        if (filas.length === 0) throw new NoEncontrado(`El impuesto ${input.codigo} no existe para ${pais}`)
        const base = resolverImpuesto(filas, input.codigo, vigenteDesde) ?? filas.at(-1)!

        const tasa = input.tasa.trim()
        if (!TASA.test(tasa) || dec(tasa).abs().gt(100)) {
            throw new ParametroFueraDeRango([
                { field: 'tasa', message: 'Por ciento con signo, entre -100 y 100 ("12.00")', rule: 'tasa' },
            ])
        }
        const retencion = base.grupo.startsWith('retencion')
        if (!dec(tasa).isZero() && retencion !== dec(tasa).isNegative()) {
            throw new ParametroFueraDeRango([
                {
                    field: 'tasa',
                    message: retencion
                        ? 'Una retención es un impuesto negativo: la tasa va con signo menos'
                        : 'La tasa de un impuesto no es negativa',
                    rule: 'signo',
                },
            ])
        }
        await exigirVigenciaAbierta(t.trx, empresaId, vigenteDesde)
        const repetida = filas.find(
            (f) => f.empresa_id === empresaId && f.origen === 'usuario' && f.vigente_desde === vigenteDesde,
        )
        if (repetida) {
            throw new Conflicto(
                `${input.codigo} ya tiene una versión ${global ? 'global' : 'de la empresa'} con vigencia ${vigenteDesde}; use otra fecha`,
                'vigencia_duplicada',
                'Vigencia duplicada',
            )
        }

        const activo = input.activo ?? true
        const [fila] = (await t.trx
            .insertQuery()
            .table('fiscal.impuestos_versiones')
            .insert({
                pais,
                codigo: input.codigo,
                empresa_id: empresaId,
                vigente_desde: vigenteDesde,
                origen: 'usuario',
                nombre: base.nombre,
                calculo: base.calculo,
                base_impuesto: base.base_impuesto,
                tasa,
                incluido: base.incluido,
                exigibilidad: base.exigibilidad,
                cuenta_cuota: base.cuenta_cuota,
                cuenta_transicion: base.cuenta_transicion,
                cuadricula_base: base.cuadricula_base,
                cuadricula_cuota: base.cuadricula_cuota,
                descripcion: base.descripcion,
                fuente: base.fuente,
                confianza: base.confianza,
                confirmar_contador: base.confirmar_contador,
                activo,
                motivo: input.motivo.trim(),
                creado_por: usuarioDelActor(t.ctx.actor),
            })
            .returning('id')) as Array<{ id: number }>
        const id = Number(fila!.id)
        t.fijarEntidad('impuesto_fiscal', id)

        await t.registrarCambios(
            { tipo: 'impuesto_fiscal', id },
            { tasa: dec(base.tasa).toString(), activo: base.activo },
            { tasa: dec(tasa).toString(), activo },
        )
        await t.emit('fiscal.parametros_cambiados', {
            empresa_id: empresaId,
            claves: [`impuesto:${input.codigo}`],
            vigente_desde: vigenteDesde,
        })
        t.alConfirmar(() => invalidarParametros(empresaId))

        const leido134 = await filasImpuestos(pais, empresaId, t.trx)
        const nuevas = leido134.filter((f) => f.codigo === input.codigo)
        return { ...nuevas.find((f) => f.id === id)!, nivel: global ? 'global' : 'empresa' }
    }
}
