import type { QueryClientContract, TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { ContextoAccion } from '#shared/contexto'
import type { RegimenIsr } from '#core/empresas'

/**
 * Punto de extensión de la localización fiscal (`contratos/localizacion-fiscal.md` §2 y §13).
 *
 * El núcleo guarda el país de la empresa (`core.empresas.pais`); lo que se instala al elegirlo
 * (plan de cuentas, parámetros, régimen, establecimientos, frases) es del módulo `fiscal` de A3.
 * A3 registra su instalador al arrancar (`registrarInstaladorLocalizacion`, desde un preload suyo)
 * y el núcleo lo llama **en la misma transacción** que crea la empresa (`empresas.crear`) o le
 * cambia el país (`empresas.cambiar_pais`). Si el instalador falla, la empresa no se crea ni
 * cambia de país.
 *
 * Sin instalador registrado (antes de que exista `fiscal`, o en pruebas que no lo necesitan) el
 * núcleo solo acepta los países de `PAISES_NUCLEO` y no instala nada.
 */

export interface DatosFiscalesEmpresa {
    regimen_isr: RegimenIsr | null
    codigo_establecimiento: number | null
}

export interface InstalacionLocalizacion {
    trx: TransactionClientContract
    ctx: ContextoAccion
    empresaId: number
    pais: string
    /** país anterior; null en el alta de la empresa */
    paisAnterior: string | null
}

export interface InstaladorLocalizacion {
    /** Países con paquete (`l10n/<pais>/`), en el orden del selector */
    paises(): readonly string[]
    /**
     * Instala (o actualiza) la localización del país en la empresa. Corre dentro de la transacción
     * de la acción del núcleo: lo que escriba se confirma o se deshace con ella. En el alta,
     * `core.empresas` ya tiene la fila con el `regimen_isr` y el `codigo_establecimiento` iniciales
     * (§11.2: de ahí salen el parámetro `regimen` y el establecimiento 1).
     */
    instalar(datos: InstalacionLocalizacion): Promise<void>
    /**
     * Documentos fiscales propios de `fiscal` (DTE, compras, declaraciones…) además de los que ya
     * revisa el núcleo (facturas, notas, pagos, saldos iniciales, asientos, egresos).
     */
    tieneDocumentos?(empresaId: number, trx: TransactionClientContract): Promise<boolean>
    /**
     * Régimen de ISR y establecimiento vigentes según los parámetros de `fiscal` (§2: la columna
     * `regimen_isr` pasa a ser de solo lectura y se calcula del parámetro `regimen`). Sin este
     * método, o si devuelve null para la empresa, la API sigue mostrando el valor guardado en
     * `core.empresas` (punto de cambio documentado en `app/core/README.md`).
     */
    datosFiscales?(
        empresaIds: number[],
        cliente: QueryClientContract,
    ): Promise<Map<number, DatosFiscalesEmpresa>>
}

/** Países que el núcleo acepta sin instalador. Hoy solo Guatemala. */
export const PAISES_NUCLEO = ['GT'] as const

export const NOMBRES_PAIS: Record<string, string> = { GT: 'Guatemala' }

let instalador: InstaladorLocalizacion | null = null

/** Registra el instalador de `fiscal` (uno por proceso; el último gana). */
export function registrarInstaladorLocalizacion(nuevo: InstaladorLocalizacion | null): void {
    instalador = nuevo
}

export function instaladorLocalizacion(): InstaladorLocalizacion | null {
    return instalador
}

/** Países que se pueden elegir: los del instalador o, sin él, los del núcleo. */
export function paisesSoportados(): readonly string[] {
    return instalador ? instalador.paises() : PAISES_NUCLEO
}

export function paisSoportado(pais: string): boolean {
    return paisesSoportados().includes(pais)
}
