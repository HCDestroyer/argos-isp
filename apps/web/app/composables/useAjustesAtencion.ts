/**
 * Lo que pide atención dentro de Ajustes (plan del menú y Ajustes, §3): un indicador discreto junto a
 * la pantalla en la lista y en la página de tarjetas. Hoy, «Contingencia activa» en la factura
 * electrónica de la empresa activa. Solo aparece si se pudo leer de la API (con `fel.ver`); si la
 * lectura falla, no se inventa nada.
 */
export interface AtencionAjuste {
    /** Texto completo (título del indicador y lector de pantalla). */
    texto: string
    /** Texto corto de la pastilla en la lista del teléfono. */
    corto: string
}

export function useAjustesAtencion() {
    const { puede } = usePermisos()
    const { empresaId } = useEmpresaActiva()
    const atencion = useState<Record<string, AtencionAjuste>>('ajustes-atencion', () => ({}))

    async function cargar(): Promise<void> {
        const nueva: Record<string, AtencionAjuste> = {}
        if (puede('fel.ver') && empresaId.value !== null) {
            const resultado = await useFel().configuracion(empresaId.value)
            if (resultado.ok && resultado.data.contingencia_activa) {
                nueva.fel = { texto: 'Contingencia activa', corto: 'Contingencia' }
            }
        }
        atencion.value = nueva
    }

    return { atencion, cargar }
}
