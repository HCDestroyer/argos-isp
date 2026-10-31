import { ValidacionFallida } from '#shared/errores'
import type { ContextoAccion } from '#shared/contexto'

/**
 * Teléfonos de clientes y del contacto en sitio del servicio (pedido A14 de Iris, contrato 0.5.0).
 *
 * Regla: Guatemala con internacional opcional.
 * - Se toleran espacios, guiones, puntos y paréntesis; `00` al inicio vale como `+`.
 * - Guatemala: 8 dígitos que empiezan con 2 a 7 (plan de numeración de la SIT), con `+502` o `502`
 *   opcional delante. Se guarda como `+502 5512-3344`.
 * - Internacional (otro código de país): `+` seguido de 8 a 15 dígitos (E.164). Se guarda como `+`
 *   y los dígitos, sin separadores (`+15551234567`).
 *
 * Datos existentes: los teléfonos viejos no se migran. Se valida y normaliza **solo cuando el campo
 * cambia** (`telefonoParaGuardar`): una edición que reenvía el mismo valor guardado, aunque sea
 * inválido, pasa sin tocarlo; así el panel puede editar otros datos de un cliente con un teléfono
 * viejo mal escrito.
 */
export const FORMATO_TELEFONO =
    '8 dígitos de Guatemala (2-7 al inicio) con +502 opcional, o internacional con + y 8 a 15 dígitos; ' +
    'se toleran espacios, guiones, puntos y paréntesis'

const SEPARADORES = /[\s().-]/g
const PERMITIDOS = /^\+?[\d\s().-]+$/

/** Forma normalizada del teléfono, o null si no cumple la regla. */
export function normalizarTelefono(valor: string): string | null {
    const texto = valor.trim()
    if (texto === '' || !PERMITIDOS.test(texto)) return null
    let compacto = texto.replace(SEPARADORES, '')
    if (compacto.startsWith('00')) compacto = `+${compacto.slice(2)}`
    const internacional = compacto.startsWith('+')
    const digitos = internacional ? compacto.slice(1) : compacto
    if (!/^\d+$/.test(digitos)) return null

    let local: string | null = null
    if (digitos.length === 8 && !internacional) local = digitos
    else if (digitos.length === 11 && digitos.startsWith('502')) local = digitos.slice(3)
    if (local !== null) {
        return /^[2-7]\d{7}$/.test(local) ? `+502 ${local.slice(0, 4)}-${local.slice(4)}` : null
    }
    if (internacional && !digitos.startsWith('502') && /^[1-9]\d{7,14}$/.test(digitos)) return `+${digitos}`
    return null
}

/**
 * Valor que se escribe en la columna, o `undefined` si no hay que tocarla.
 *
 * - `undefined` (no vino) o el mismo texto guardado: `undefined` (no cambia; no se valida).
 * - `null` o vacío: `null` (lo borra).
 * - Otro valor: normalizado; si no cumple la regla, 422 con el campo. Excepción: el canal `consola`
 *   (importador y comandos `ace`) guarda el valor como vino (recortado) en vez de rechazar el
 *   registro completo; el importador lo reporta en su lista de diferencias (`a1.md`, pedido a A6).
 */
export function telefonoParaGuardar(
    campo: string,
    valor: string | null | undefined,
    anterior: unknown,
    ctx: Pick<ContextoAccion, 'canal'>,
): string | null | undefined {
    if (valor === undefined) return undefined
    if (valor === null || valor.trim() === '') return null
    if (typeof anterior === 'string' && valor.trim() === anterior.trim()) return undefined
    const normalizado = normalizarTelefono(valor)
    if (normalizado !== null) return normalizado
    if (ctx.canal === 'consola') return valor.trim()
    throw new ValidacionFallida([
        { field: campo, message: `Teléfono inválido: ${FORMATO_TELEFONO}`, rule: 'telefono' },
    ])
}
