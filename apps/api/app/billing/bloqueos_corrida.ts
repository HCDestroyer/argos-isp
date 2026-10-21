import { PeriodoBloqueado, type TipoBloqueo } from '#ledger/bloqueos'

/**
 * Documentos que un cron no pudo contabilizar porque la fecha cae bajo un bloqueo del libro
 * (decisión del líder, fase 6): la corrida no se detiene, registra cuántos quedaron bloqueados y
 * avisa al equipo con `libro.proceso_bloqueado` (uno por empresa y tipo). Lo bloqueado sigue
 * pendiente y entra en la siguiente corrida: nada se pierde.
 */

export interface BloqueoCorrida {
    empresa_id: number
    tipo: TipoBloqueo
    hasta: string | null
    fecha: string
    /** documentos (servicios o facturas) que no se contabilizaron */
    documentos: number
    /** los primeros ids afectados (máximo 20) */
    ejemplos: number[]
}

export class BloqueosDeCorrida {
    private readonly porClave = new Map<string, BloqueoCorrida>()

    /** Si `error` es un bloqueo del libro lo acumula y devuelve true; si no, false. */
    registrarError(error: unknown, documentoId: number): boolean {
        if (!(error instanceof PeriodoBloqueado)) return false
        this.registrar(
            { empresa_id: error.empresaId, tipo: error.tipoBloqueo, hasta: error.hasta, fecha: error.fecha },
            documentoId,
        )
        return true
    }

    registrar(b: Omit<BloqueoCorrida, 'documentos' | 'ejemplos'>, documentoId: number): void {
        const clave = `${b.empresa_id}:${b.tipo}`
        const actual = this.porClave.get(clave) ?? { ...b, documentos: 0, ejemplos: [] }
        actual.documentos += 1
        if (actual.ejemplos.length < 20) actual.ejemplos.push(documentoId)
        this.porClave.set(clave, actual)
    }

    get total(): number {
        return [...this.porClave.values()].reduce((s, b) => s + b.documentos, 0)
    }

    lista(): BloqueoCorrida[] {
        return [...this.porClave.values()]
    }
}
