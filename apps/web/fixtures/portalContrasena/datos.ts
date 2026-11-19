/**
 * Contraseña del portal (A5, `core.portal_contrasenas_defecto` y `core.portal_credenciales`) sin
 * hashes: los fixtures, como la API, nunca guardan ni devuelven la contraseña.
 */
export interface PortalContrasenasFixture {
    /** Contraseña por defecto por empresa: cuándo se configuró y su `version` (≥ 1). */
    defecto: Record<number, { actualizada_en: string, version: number }>
    /** Clientes con contraseña propia: cuándo la cambiaron por última vez. */
    propias: Record<number, string>
    /** Sesiones del portal abiertas por cliente (las cierra «Restaurar»). */
    sesiones: Record<number, number>
}

/**
 * ArgosNet (1) ya tiene contraseña por defecto; Fibra del Sur (2) no. La cliente 1 (María José)
 * eligió la suya y tiene dos sesiones abiertas; el cliente 2 entra con la de la empresa.
 */
export function portalContrasenasIniciales(): PortalContrasenasFixture {
    return {
        defecto: { 1: { actualizada_en: '2026-11-02T15:30:00.000Z', version: 1 } },
        propias: { 1: '2026-11-10T21:05:00.000Z' },
        sesiones: { 1: 2 },
    }
}
