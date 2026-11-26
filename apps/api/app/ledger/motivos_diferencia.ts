import type { Transaccion } from '#shared/domain_action'
import { ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { aTexto, dec } from '#ledger/dinero'
import { CUENTAS } from '#ledger/plan_cuentas'
import { buscarContrapartida } from '#ledger/conciliacion'
import type { LimiteMotivo, SentidoMotivo, SeOfreceEn } from '#ledger/diferencias_conciliacion'

/**
 * Entrada y normalización de un motivo de diferencia (crear y editar, plan de contabilidad §5.8).
 * La cuenta del motivo debe servir de contrapartida de una partida del banco (imputable, sin
 * auxiliar, nunca caja, banco ni puente); la cuenta del banco del filtro, una subcuenta 1.1.02.NN de
 * la empresa.
 */

export interface EntradaMotivo {
    nombre?: string
    sentido?: SentidoMotivo
    se_ofrece_en?: SeOfreceEn
    cuenta_banco_id?: number | null
    texto?: string | null
    limite_tipo?: LimiteMotivo
    limite_valor?: string | null
    cuenta_codigo?: string | null
    cuenta_contra_tope?: boolean
    siempre_aprobacion?: boolean
    activo?: boolean
    orden?: number
}

export interface DatosMotivo {
    nombre: string
    sentido: SentidoMotivo
    se_ofrece_en: SeOfreceEn
    cuenta_banco_id: number | null
    texto: string | null
    limite_tipo: LimiteMotivo
    limite_valor: string | null
    cuenta_codigo: string | null
    cuenta_contra_tope: boolean
    siempre_aprobacion: boolean
    activo: boolean
    orden: number
}

export const CAMPOS_MOTIVO = [
    'nombre',
    'sentido',
    'se_ofrece_en',
    'cuenta_banco_id',
    'texto',
    'limite_tipo',
    'limite_valor',
    'cuenta_codigo',
    'cuenta_contra_tope',
    'siempre_aprobacion',
    'activo',
    'orden',
] as const

/** Mezcla lo que viene sobre `base` y valida el resultado. */
export async function normalizarMotivo(
    t: Transaccion,
    input: EntradaMotivo,
    base: DatosMotivo,
    empresaId: number,
    fija: boolean,
): Promise<DatosMotivo> {
    const datos: DatosMotivo = {
        nombre: input.nombre?.trim() ?? base.nombre,
        sentido: input.sentido ?? base.sentido,
        se_ofrece_en: input.se_ofrece_en ?? base.se_ofrece_en,
        cuenta_banco_id: input.cuenta_banco_id === undefined ? base.cuenta_banco_id : input.cuenta_banco_id,
        texto: input.texto === undefined ? base.texto : input.texto?.trim() || null,
        limite_tipo: input.limite_tipo ?? base.limite_tipo,
        limite_valor: input.limite_valor === undefined ? base.limite_valor : input.limite_valor,
        cuenta_codigo:
            input.cuenta_codigo === undefined ? base.cuenta_codigo : input.cuenta_codigo?.trim() || null,
        cuenta_contra_tope: input.cuenta_contra_tope ?? base.cuenta_contra_tope,
        siempre_aprobacion: input.siempre_aprobacion ?? base.siempre_aprobacion,
        activo: input.activo ?? base.activo,
        orden: input.orden ?? base.orden,
    }
    if (datos.limite_tipo === 'sin_limite') datos.limite_valor = null
    const errores: ErrorCampo[] = []
    if (datos.nombre.length < 3) {
        errores.push({ field: 'nombre', message: 'El nombre es obligatorio', rule: 'required' })
    }
    if (datos.limite_tipo !== 'sin_limite') {
        const valor = dec(datos.limite_valor)
        if (!datos.limite_valor || !valor.isPositive() || valor.isZero()) {
            errores.push({
                field: 'limite_valor',
                message: 'Indica hasta cuánto se permite',
                rule: 'required',
            })
        } else if (datos.limite_tipo === 'porcentaje' && valor.gt(100)) {
            errores.push({ field: 'limite_valor', message: 'Un porcentaje no pasa de 100', rule: 'range' })
        } else {
            datos.limite_valor = aTexto(valor)
        }
    }
    if (datos.cuenta_codigo === null && !datos.siempre_aprobacion) {
        errores.push({
            field: 'siempre_aprobacion',
            message: 'Un motivo sin cuenta propia (la elige quien concilia) siempre pide aprobación',
            rule: 'aprobacion_obligatoria',
        })
    }
    if (datos.cuenta_codigo !== null && !(await buscarContrapartida(t.trx, datos.cuenta_codigo, empresaId))) {
        errores.push({
            field: 'cuenta_codigo',
            message: `La cuenta ${datos.cuenta_codigo} no sirve (imputable, sin auxiliar y nunca caja, banco ni puente)`,
            rule: 'contrapartida',
        })
    }
    if (datos.cuenta_banco_id !== null) {
        const cuenta = (await t.trx
            .from('ledger.cuentas')
            .where('id', datos.cuenta_banco_id)
            .select('codigo', 'empresa_id')
            .first()) as { codigo: string; empresa_id: number | null } | null
        if (
            !cuenta ||
            !cuenta.codigo.startsWith(`${CUENTAS.BANCOS}.`) ||
            (cuenta.empresa_id !== null && Number(cuenta.empresa_id) !== empresaId)
        ) {
            errores.push({
                field: 'cuenta_banco_id',
                message: 'Debe ser una cuenta bancaria (1.1.02.NN) de la empresa',
                rule: 'cuenta_banco',
            })
        }
    }
    if (fija && !datos.activo) {
        errores.push({ field: 'activo', message: 'Este motivo es fijo: no se apaga', rule: 'fija' })
    }
    if (errores.length > 0) throw new ValidacionFallida(errores)
    return datos
}
