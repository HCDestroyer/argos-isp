import type { Problem } from '@argosisp/contracts'
import type { FormError } from '@nuxt/ui'
import { erroresDeFormulario } from './resultado'

/**
 * 422 `cuenta_bancaria_id` / `inactiva` (A3, contrato Iris 0.8.0): el pago o el comprobante usa
 * una cuenta bancaria propia que alguien desactivó. Antes salía como `exists`, igual que una cuenta
 * inexistente; ahora el panel lo explica en llano.
 */
export const MENSAJE_CUENTA_INACTIVA = 'Esta cuenta bancaria está desactivada y ya no recibe pagos. Elige otra cuenta, o pide que la vuelvan a activar en Configuración → Cuentas bancarias.'

export function esCuentaInactiva(problema: Problem | null | undefined): boolean {
    return problema?.status === 422 && (problema.errors ?? []).some(e => e.field === 'cuenta_bancaria_id' && e.rule === 'inactiva')
}

/** Los errores del 422 para el formulario, con el de cuenta inactiva en llano. */
export function erroresConCuentaInactiva(problema: Problem): FormError[] {
    return erroresDeFormulario(problema).map(error => (error.name === 'cuenta_bancaria_id' && esCuentaInactiva(problema)
        ? { ...error, message: MENSAJE_CUENTA_INACTIVA }
        : error))
}
