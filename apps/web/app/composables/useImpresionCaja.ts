/**
 * Cómo imprime cada caja (decisión 20 del PM): ticket de 80 mm para los recibos o carta. Cada caja
 * lo recuerda.
 *
 * NEEDS(A3): la preferencia por caja está en construcción en `agente/a3-cobro-pm`. Mientras la API
 * no la devuelva en `Caja`, se guarda en este navegador (por caja) y la pantalla ya la usa; al
 * llegar el campo, `formatoDe` lo lee de la caja y `guardar` llama a la API, sin tocar las pantallas.
 */
export type FormatoImpresion = 'pos_80' | 'carta'

export const FORMATOS_IMPRESION: { valor: FormatoImpresion, etiqueta: string, corta: string, icono: string }[] = [
    { valor: 'pos_80', etiqueta: 'Ticket de 80 mm', corta: 'Recibo POS', icono: 'i-lucide-receipt' },
    { valor: 'carta', etiqueta: 'Hoja carta', corta: 'Recibo carta', icono: 'i-lucide-file-text' },
]

const CLAVE = 'argos:impresion-caja:'

function leer(cajaId: number): FormatoImpresion {
    try {
        const valor = localStorage.getItem(`${CLAVE}${cajaId}`)
        return valor === 'carta' ? 'carta' : 'pos_80'
    }
    catch {
        return 'pos_80'
    }
}

export function useImpresionCaja() {
    /** Versión para que las vistas se enteren de un cambio hecho en otra parte de la pantalla. */
    const version = useState('impresion-caja:version', () => 0)

    function formatoDe(cajaId: number | null | undefined): FormatoImpresion {
        void version.value
        return cajaId ? leer(cajaId) : 'pos_80'
    }

    function guardar(cajaId: number, formato: FormatoImpresion): void {
        try {
            localStorage.setItem(`${CLAVE}${cajaId}`, formato)
        }
        catch {
            // Sin almacenamiento (ventana privada): queda solo para esta sesión.
        }
        version.value++
    }

    return { formatoDe, guardar }
}

export function presentacionFormato(formato: FormatoImpresion) {
    return FORMATOS_IMPRESION.find(f => f.valor === formato) ?? FORMATOS_IMPRESION[0]!
}
