import type { Problem } from '@argosisp/contracts'

/**
 * Cómo imprime cada caja (decisión 20 del PM): ticket de 80 mm para los recibos o carta. Cada caja
 * lo recuerda en la API (`Caja.formato_recibo`, `PUT /cajas/:id/impresion`, A3), nunca en el
 * navegador: cualquier equipo que cobre con la caja imprime igual. Las cajas se leen una vez por
 * sesión (`GET /cajas`) y se comparten entre las pantallas; un cambio guardado actualiza esa copia.
 */
export type FormatoImpresion = 'pos_80' | 'carta'

export const FORMATOS_IMPRESION: { valor: FormatoImpresion, etiqueta: string, corta: string, icono: string }[] = [
    { valor: 'pos_80', etiqueta: 'Ticket de 80 mm', corta: 'Recibo POS', icono: 'i-lucide-receipt' },
    { valor: 'carta', etiqueta: 'Hoja carta', corta: 'Recibo carta', icono: 'i-lucide-file-text' },
]

export function useImpresionCaja() {
    const cajas = useState<Record<number, Caja>>('impresion-caja:cajas', () => ({}))
    const pedidas = useState<boolean>('impresion-caja:pedidas', () => false)
    const toast = useToast()

    async function cargar(): Promise<void> {
        pedidas.value = true
        const r = await useCajas().listar()
        if (r.ok) {
            cajas.value = { ...cajas.value, ...Object.fromEntries(r.data.map(c => [c.id, c])) }
        }
        else {
            // Sin leer, se imprime con el de fábrica; se vuelve a intentar en la siguiente consulta.
            pedidas.value = false
        }
    }

    /** Formato del recibo de la caja (ticket de 80 mm de fábrica mientras no se haya leído). */
    function formatoDe(cajaId: number | null | undefined): FormatoImpresion {
        if (!cajaId) {
            return 'pos_80'
        }
        const caja = cajas.value[cajaId]
        if (!caja && !pedidas.value) {
            void cargar()
        }
        return caja?.formato_recibo ?? 'pos_80'
    }

    /** Guarda el formato del recibo en la caja (`cajas.configurar_impresion`); avisa si la API no lo acepta. */
    async function guardar(cajaId: number, formato: FormatoImpresion): Promise<Problem | null> {
        let caja = cajas.value[cajaId]
        if (!caja) {
            await cargar()
            caja = cajas.value[cajaId]
        }
        if (!caja) {
            return null
        }
        const r = await useImpresionCajas().configurar(caja, { formato_recibo: formato })
        if (!r.ok) {
            toast.add({ title: r.problema.title, description: r.problema.detail, icon: 'i-lucide-circle-alert', color: 'error' })
            if (r.problema.status === 409) {
                await cargar()
            }
            return r.problema
        }
        cajas.value = { ...cajas.value, [r.data.id]: r.data }
        return null
    }

    /** Lo que otra pantalla ya guardó (Configuración › Reglas de cobro y libro). */
    function recordar(caja: Caja): void {
        cajas.value = { ...cajas.value, [caja.id]: caja }
    }

    return { formatoDe, guardar, recordar }
}

export function presentacionFormato(formato: FormatoImpresion) {
    return FORMATOS_IMPRESION.find(f => f.valor === formato) ?? FORMATOS_IMPRESION[0]!
}
