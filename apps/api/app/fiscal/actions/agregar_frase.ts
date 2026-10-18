import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, ReglaNegocio, ValidacionFallida } from '#shared/errores'
import { fechaValida } from '#ledger/fechas'
import { empresaFiscal, exigirVigenciaAbierta } from '#fiscal/comun'
import { PAQUETES } from '#fiscal/instalador'
import { frasesManualesEn, type FraseVista } from '#fiscal/frases'

/**
 * `fiscal.agregar_frase` (`POST /fiscal/frases`, permiso `fiscal.configurar`): agrega una frase
 * manual (pago directo, exportación…; inv. C.2) desde `vigente_desde`, o la retira con
 * `activa: false`. Solo inserción: una frase nunca se edita. Las del régimen no se agregan aquí:
 * salen del régimen vigente.
 *
 * - `tipos_dte` del catálogo del paquete (422); retirar una frase que no está activa: 422
 *   `frase_inactiva`; 422 `vigencia_en_periodo_bloqueado`; 409 `vigencia_duplicada`.
 * - `audit.cambios` (`frase`); evento `fiscal.config_cambiada` (`frases`).
 */

export interface EntradaAgregarFrase {
    empresa_id?: number | null
    tipo_frase: number
    escenario: number
    texto?: string | null
    tipos_dte?: string[] | null
    vigente_desde: string
    activa?: boolean
    resolucion?: { numero: string; fecha: string } | null
    motivo: string
}

export default class AgregarFrase extends DomainAction<EntradaAgregarFrase, FraseVista> {
    readonly nombre = 'fiscal.agregar_frase'

    protected async handle(input: EntradaAgregarFrase, t: Transaccion): Promise<FraseVista> {
        const vigenteDesde = fechaValida(input.vigente_desde, 'vigente_desde')
        const { empresaId, instalacion } = await empresaFiscal(t, input.empresa_id)
        const paquete = PAQUETES[instalacion.localizacion_codigo]!
        const delRegimen = Object.values(paquete.frases_por_regimen)
            .flat()
            .find((f) => f.tipo_frase === input.tipo_frase && f.escenario === input.escenario)
        if (delRegimen) {
            throw new ReglaNegocio(
                `La frase ${input.tipo_frase}-${input.escenario} sale del régimen (${delRegimen.clave}): cambie el régimen`,
                'frase_del_regimen',
            )
        }
        const clave = `manual:${input.tipo_frase}-${input.escenario}`
        const activa = input.activa ?? true

        const leido51 = await frasesManualesEn(empresaId, vigenteDesde, t.trx)
        const previa = leido51.find((f) => f.clave === clave)
        let texto = input.texto?.trim() ?? ''
        let tipos = input.tipos_dte ?? []
        if (!activa) {
            if (!previa?.activa) {
                throw new ReglaNegocio(
                    `La frase ${clave} no está activa al ${vigenteDesde}`,
                    'frase_inactiva',
                )
            }
            texto ||= previa.texto
            if (tipos.length === 0) tipos = previa.tipos_dte
        }
        const errores = []
        if (!texto) {
            errores.push({ field: 'texto', message: 'El texto de la frase es obligatorio', rule: 'required' })
        }
        const validos = new Set(paquete.tipos_dte.map((d) => d.codigo))
        if (tipos.length === 0) {
            errores.push({ field: 'tipos_dte', message: 'Al menos un tipo de DTE', rule: 'required' })
        }
        tipos.forEach((tipo, i) => {
            if (!validos.has(tipo)) {
                errores.push({
                    field: `tipos_dte.${i}`,
                    message: `Tipo de DTE desconocido; uno de: ${[...validos].join(', ')}`,
                    rule: 'enum',
                })
            }
        })
        let resolucion = null
        if (input.resolucion) {
            resolucion = {
                numero: input.resolucion.numero.trim(),
                fecha: fechaValida(input.resolucion.fecha, 'resolucion.fecha'),
            }
        }
        if (errores.length > 0) throw new ValidacionFallida(errores)
        await exigirVigenciaAbierta(t.trx, empresaId, vigenteDesde)
        if (previa?.vigente_desde === vigenteDesde) {
            throw new Conflicto(
                `La frase ${clave} ya tiene un cambio con vigencia ${vigenteDesde}; use otra fecha`,
                'vigencia_duplicada',
                'Vigencia duplicada',
            )
        }

        const [fila] = (await t.trx
            .insertQuery()
            .table('fiscal.frases')
            .insert({
                empresa_id: empresaId,
                clave,
                tipo_frase: input.tipo_frase,
                escenario: input.escenario,
                texto,
                tipos_dte: tipos,
                origen: 'manual',
                activa,
                vigente_desde: vigenteDesde,
                resolucion: resolucion ? JSON.stringify(resolucion) : null,
                motivo: input.motivo.trim(),
                creado_por: usuarioDelActor(t.ctx.actor),
            })
            .returning('id')) as Array<{ id: number }>
        const id = Number(fila!.id)
        t.fijarEntidad('frase', id)
        await t.registrarCambios(
            { tipo: 'frase', id },
            previa ? { texto: previa.texto, tipos_dte: previa.tipos_dte, activa: previa.activa } : null,
            { texto, tipos_dte: tipos, activa },
        )
        await t.emit('fiscal.config_cambiada', { empresa_id: empresaId, campos: ['frases'] })
        const leido124 = await frasesManualesEn(empresaId, vigenteDesde, t.trx)
        return leido124.find((f) => f.id === id)!
    }
}
