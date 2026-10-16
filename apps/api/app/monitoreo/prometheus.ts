/**
 * Formato de exposición de Prometheus (texto 0.0.4), sin dependencias: solo gauges, que es lo
 * único que expone la API (todo se lee en el momento del scrape).
 */

export interface Muestra {
    etiquetas?: Record<string, string>
    valor: number
}

function escaparEtiqueta(valor: string): string {
    return valor.replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll('"', '\\"')
}

function escaparAyuda(valor: string): string {
    return valor.replaceAll('\\', '\\\\').replaceAll('\n', '\\n')
}

function numero(valor: number): string {
    if (Number.isNaN(valor)) return 'NaN'
    if (valor === Number.POSITIVE_INFINITY) return '+Inf'
    if (valor === Number.NEGATIVE_INFINITY) return '-Inf'
    return String(valor)
}

export class Exposicion {
    readonly #lineas: string[] = []
    readonly #nombres = new Set<string>()

    /** Agrega una métrica gauge con sus muestras (puede no tener ninguna). */
    gauge(nombre: string, ayuda: string, muestras: Muestra[]): this {
        if (!/^[a-zA-Z_:][a-zA-Z0-9_:]*$/.test(nombre)) {
            throw new Error(`Nombre de métrica inválido: ${nombre}`)
        }
        if (this.#nombres.has(nombre)) throw new Error(`Métrica repetida: ${nombre}`)
        this.#nombres.add(nombre)
        this.#lineas.push(`# HELP ${nombre} ${escaparAyuda(ayuda)}`, `# TYPE ${nombre} gauge`)
        for (const m of muestras) {
            const pares = Object.entries(m.etiquetas ?? {}).map(([k, v]) => `${k}="${escaparEtiqueta(v)}"`)
            this.#lineas.push(`${nombre}${pares.length ? `{${pares.join(',')}}` : ''} ${numero(m.valor)}`)
        }
        return this
    }

    texto(): string {
        return this.#lineas.join('\n') + '\n'
    }
}

export const TIPO_CONTENIDO = 'text/plain; version=0.0.4; charset=utf-8'
