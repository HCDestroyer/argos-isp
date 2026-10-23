import type { Schema } from '@argosisp/contracts'

export type TableroFiscal = Schema<'TableroFiscal'>
export type TableroEmpresa = TableroFiscal['empresas'][number]
export type BloquesTablero = TableroEmpresa['bloques']
export type NombreBloque = keyof BloquesTablero
export type EstimadoDeclaracion = Schema<'EstimadoDeclaracion'>

/**
 * Tablero fiscal (A3, fase 8 PR A; contrato de localización fiscal §22). Solo lectura: una sección por
 * empresa (la activa; con «Todas» y alcance global, todas, sin totales consolidados) con ocho bloques
 * calculados por separado. Un bloque que falla trae su problema RFC 9457 y ningún dato; la respuesta es
 * 200 aunque fallen bloques.
 */
export function useTableroFiscal() {
    const api = useApi()

    /** `GET /fiscal/tablero` (`fiscal.ver`); el plugin de empresa agrega `empresas=todas` con «Todas». */
    function ver(): Promise<Resultado<TableroFiscal>> {
        return resolver(api.GET('/api/v1/fiscal/tablero'))
    }

    return { ver }
}
