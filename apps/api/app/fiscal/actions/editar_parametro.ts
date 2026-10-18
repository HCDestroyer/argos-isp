import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto } from '#shared/errores'
import { fechaValida } from '#ledger/fechas'
import { ParametroNoEditable } from '#fiscal/errores'
import { empresaFiscal, exigirAlcanceGlobal, exigirVigenciaAbierta } from '#fiscal/comun'
import { invalidarParametros } from '#fiscal/cache_parametros'
import { definicion, filasValores, resolver, validarValor, type FilaValor } from '#fiscal/parametros'

/**
 * `fiscal.editar_parametros` (`POST /fiscal/parametros/:clave/valores`, contrato §4 y §5): agrega
 * una versión del parámetro con su `vigente_desde`. **Nunca** se edita una fila: lo vigente antes
 * de esa fecha no cambia (una declaración vieja se recalcula igual).
 *
 * - `ambito = empresa` (por defecto): de la empresa activa o `empresa_id`. `ambito = global`: de toda
 *   la instalación; exige alcance global y que el parámetro no sea de alcance E.
 * - 422 `parametro_no_editable` (alcance N o con acción propia, como `regimen`),
 *   `parametro_fuera_de_rango` (tipo, opciones, mínimo, máximo o tope), `vigencia_en_periodo_bloqueado`.
 * - 409 `vigencia_duplicada` si ya hay un valor de ese ámbito con la misma fecha.
 * - `audit.cambios` (`parametro_fiscal`, campo = clave: el valor vigente en esa fecha antes y
 *   después), evento `fiscal.parametros_cambiados` (y `fiscal.config_cambiada` con `fel_modo`).
 */

export interface EntradaEditarParametro {
    clave: string
    valor?: unknown
    vigente_desde: string
    motivo: string
    ambito?: 'empresa' | 'global'
    empresa_id?: number | null
}

export interface ValorCreado extends FilaValor {
    nivel: 'empresa' | 'global'
    /** valor vigente en `vigente_desde` antes de este (null si no había) */
    anterior: unknown
}

/** Claves cuyo cambio también avisa `fiscal.config_cambiada` (contrato §10.3). */
const CAMPOS_CONFIG: Record<string, 'fel_modo'> = { fel_modo: 'fel_modo' }

export default class EditarParametro extends DomainAction<EntradaEditarParametro, ValorCreado> {
    readonly nombre = 'fiscal.editar_parametros'

    protected async handle(input: EntradaEditarParametro, t: Transaccion): Promise<ValorCreado> {
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

        const def = await definicion(pais, input.clave, t.trx)
        if (def.alcance === 'N') {
            throw new ParametroNoEditable(
                input.clave,
                `${input.clave} lo fija la ley (alcance N): no se edita`,
            )
        }
        if (def.accion) {
            throw new ParametroNoEditable(
                input.clave,
                `${input.clave} se cambia con su acción propia (${def.accion})`,
            )
        }
        if (global && def.alcance === 'E') {
            throw new ParametroNoEditable(
                input.clave,
                `${input.clave} es de cada empresa (alcance E): no admite valor global`,
            )
        }

        const filas = await filasValores(pais, empresaId, t.trx, input.clave)
        // forma de los json y tope por clave: el valor del paquete vigente en esa fecha (o el último)
        const delPaquete = filas.filter((f) => f.origen === 'paquete')
        const modelo = (resolver(delPaquete, input.clave, vigenteDesde) ?? delPaquete.at(-1))?.valor
        const valor = validarValor(def, input.valor, modelo)
        await exigirVigenciaAbierta(t.trx, empresaId, vigenteDesde)

        const repetida = filas.find(
            (f) => f.empresa_id === empresaId && f.origen === 'usuario' && f.vigente_desde === vigenteDesde,
        )
        if (repetida) {
            throw new Conflicto(
                `${input.clave} ya tiene un valor ${global ? 'global' : 'de la empresa'} con vigencia ${vigenteDesde} (${repetida.id}); use otra fecha`,
                'vigencia_duplicada',
                'Vigencia duplicada',
            )
        }
        const anterior = resolver(filas, input.clave, vigenteDesde)?.valor ?? null

        const [fila] = (await t.trx
            .insertQuery()
            .table('fiscal.parametros_valores')
            .insert({
                pais,
                empresa_id: empresaId,
                clave: input.clave,
                valor: JSON.stringify(valor),
                vigente_desde: vigenteDesde,
                origen: 'usuario',
                motivo: input.motivo.trim(),
                creado_por: usuarioDelActor(t.ctx.actor),
            })
            .returning('id')) as Array<{ id: number }>
        const id = Number(fila!.id)
        t.fijarEntidad('parametro_fiscal', id)

        await t.registrarCambios(
            { tipo: 'parametro_fiscal', id },
            { [input.clave]: anterior },
            { [input.clave]: valor },
        )
        await t.emit('fiscal.parametros_cambiados', {
            empresa_id: empresaId,
            claves: [input.clave],
            vigente_desde: vigenteDesde,
        })
        const campo = CAMPOS_CONFIG[input.clave]
        if (campo && empresaId !== null) {
            await t.emit('fiscal.config_cambiada', { empresa_id: empresaId, campos: [campo] })
        }
        t.alConfirmar(() => invalidarParametros(empresaId))

        const leido131 = await filasValores(pais, empresaId, t.trx, input.clave)
        const creada = leido131.find((f) => f.id === id)!
        return { ...creada, nivel: global ? 'global' : 'empresa', anterior }
    }
}
