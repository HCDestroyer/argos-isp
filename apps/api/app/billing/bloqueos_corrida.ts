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

/**
 * Contadores de una corrida por empresa (pedido de A4, fase 6): la corrida guarda en su resultado
 * `por_empresa { <empresa_id>: { …contadores } }` para que `GET /facturas/corridas` muestre lo de
 * cada empresa y no el total de todas.
 */
export class ContadoresPorEmpresa<C extends string> {
    private readonly porEmpresa = new Map<number, Record<C, number>>()

    constructor(private readonly campos: readonly C[]) {}

    sumar(empresaId: number, campo: C, n = 1): void {
        const actual =
            this.porEmpresa.get(empresaId) ??
            (Object.fromEntries(this.campos.map((c) => [c, 0])) as Record<C, number>)
        actual[campo] += n
        this.porEmpresa.set(empresaId, actual)
    }

    /** `{ <empresa_id>: { …contadores, bloqueados } }`, con las empresas que solo tuvieron bloqueos. */
    json(bloqueos: BloqueoCorrida[]): Record<string, Record<string, number>> {
        for (const b of bloqueos) {
            if (!this.porEmpresa.has(Number(b.empresa_id))) {
                this.sumar(Number(b.empresa_id), this.campos[0]!, 0)
            }
        }
        const salida: Record<string, Record<string, number>> = {}
        for (const [empresaId, contadores] of [...this.porEmpresa].sort((a, b) => a[0] - b[0])) {
            const bloqueados = bloqueos
                .filter((b) => Number(b.empresa_id) === empresaId)
                .reduce((s, b) => s + Number(b.documentos), 0)
            salida[String(empresaId)] = { ...contadores, bloqueados }
        }
        return salida
    }
}
