import Mustache from 'mustache'

/**
 * Plantillas Mustache de `notify.plantillas`. El texto es plano para todos los canales: no se
 * escapa HTML (`{{x}}` y `{{{x}}}` son equivalentes). Las variables disponibles están en
 * `app/notify/README.md`.
 */

const SIN_ESCAPE = { escape: (valor: unknown) => String(valor) }

export function renderizar(plantilla: string, variables: Record<string, unknown>): string {
    return Mustache.render(plantilla, variables, {}, SIN_ESCAPE)
}

/** Devuelve el mensaje de error si la plantilla no es Mustache válido; `null` si está bien. */
export function errorDeSintaxis(plantilla: string): string | null {
    try {
        Mustache.parse(plantilla)
        return null
    } catch (error) {
        return error instanceof Error ? error.message : String(error)
    }
}
