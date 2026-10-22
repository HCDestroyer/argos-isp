import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { valorParametro } from '#fiscal/parametros'
import { LocalizacionNoInstalada } from '#fiscal/errores'
import type { LineaCalculada } from '#billing/facturas'

/**
 * Pequeño contribuyente (decisión del líder, fase 7 PR B; §15 #73 «confirmar con contador»): una
 * empresa en régimen `pequeno_contribuyente` en la fecha del documento **no separa IVA** en sus
 * facturas, moras, cargos ni notas: total = precio, todo a ingresos, sin `2.1.02` ni `2.1.11` (tributa
 * el `IVA_PC` sobre el total en su declaración). El DTE sigue saliendo FPEQ. Un cambio de régimen rige
 * desde su `vigente_desde`; lo ya emitido no se toca. Sin localización instalada: régimen general.
 */
export async function sinIvaPorRegimen(
    cliente: QueryClientContract,
    empresaId: number,
    fecha: string,
): Promise<boolean> {
    try {
        return (
            (await valorParametro<string>(empresaId, 'regimen', fecha, cliente)) === 'pequeno_contribuyente'
        )
    } catch (error) {
        if (error instanceof LocalizacionNoInstalada) return false
        throw error
    }
}

/** Las mismas líneas con el IVA en cero (el total no cambia: todo es ingreso). */
export function lineasSinIva<L extends Pick<LineaCalculada, 'iva'>>(lineas: L[]): L[] {
    return lineas.map((l) => ({ ...l, iva: '0.00' }))
}
