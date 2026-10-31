/**
 * `telefonoParaGuardar` de la API (`apps/api/app/core/telefonos.ts`) para los fixtures de clientes
 * y servicios: se valida y normaliza solo cuando el campo cambia; reenviar el valor guardado,
 * aunque sea viejo e inválido, pasa sin tocarlo.
 */
import type { Problem } from '@argosisp/contracts'
import { normalizarTelefono } from '~/utils/telefonos'

type ErrorCampo = NonNullable<Problem['errors']>[number]

const FORMATO_TELEFONO = '8 dígitos de Guatemala (2-7 al inicio) con +502 opcional, o internacional con + y 8 a 15 dígitos; '
    + 'se toleran espacios, guiones, puntos y paréntesis'

function sinCambio(valor: string, anterior: string | null | undefined): boolean {
    return typeof anterior === 'string' && valor.trim() === anterior.trim()
}

/** El 422 de la API (`rule: 'telefono'`) si el valor cambió a uno que no cumple. */
export function errorTelefono(campo: string, valor: unknown, anterior?: string | null): ErrorCampo | null {
    if (valor === undefined || valor === null || (typeof valor === 'string' && (valor.trim() === '' || sinCambio(valor, anterior)))) {
        return null
    }
    if (typeof valor === 'string' && valor.trim().length <= 30 && normalizarTelefono(valor) !== null) {
        return null
    }
    return { field: campo, message: `Teléfono inválido: ${FORMATO_TELEFONO}`, rule: 'telefono' }
}

/** Valor que queda guardado (ya validado con `errorTelefono`): normalizado, el anterior o null. */
export function telefonoGuardado(valor: unknown, anterior: string | null | undefined): string | null {
    if (valor === undefined) {
        return anterior ?? null
    }
    if (typeof valor !== 'string' || valor.trim() === '') {
        return null
    }
    if (sinCambio(valor, anterior)) {
        return anterior ?? null
    }
    return normalizarTelefono(valor) ?? valor.trim()
}
