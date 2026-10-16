/**
 * Nombre de campo para auditoría (`audit.cambios.campo`, enmascarado de sensibles).
 *
 * - Una clave sin mayúsculas ya está en snake_case (o es una sola palabra) y se deja igual:
 *   `ipv4`, `prefijo_enlace_v6`, `pass_ppp`.
 * - Una clave camelCase/PascalCase se convierte separando solo antes de cada mayúscula, nunca
 *   antes de un dígito: `prefijoEnlaceV6` → `prefijo_enlace_v6`, `passPpp` → `pass_ppp`,
 *   `APIPassword` → `api_password`.
 *
 * Reemplaza a `string.snakeCase` de Adonis, que separa los dígitos (`ipv4` → `ipv_4`). Antes del
 * arreglo (día 4) `audit.cambios` guardó nombres como `ipv_4`, `prefijo_enlace_v_6` y
 * `prefijo_delegado_v_6`; esas filas no se reescriben (regla 4), ver `app/core/README.md`.
 */
export function nombreCampo(clave: string): string {
    if (!/[A-Z]/.test(clave)) return clave
    return clave
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
        .replace(/[\s-]+/g, '_')
        .toLowerCase()
}
