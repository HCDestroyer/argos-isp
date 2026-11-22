import { vi } from 'vitest'

/**
 * Decodificación y canvas simulados para `prepararArchivo` (happy-dom no decodifica imágenes ni
 * exporta canvas). `falla` hace fallar `createImageBitmap` y el `<img>`; `bitmapFalla`, solo el
 * primero; `tamanosBlob`, el tamaño de cada JPEG exportado (`null` = el canvas no exporta);
 * `pausar`, deja la decodificación esperando hasta `continuar()`.
 */
export interface Simulacion {
    medidas: { ancho: number, alto: number }
    falla: boolean
    bitmapFalla: boolean
    pausar: boolean
    tamanosBlob: (number | null)[]
    bitmap: ReturnType<typeof vi.fn>
    lienzos: { width: number, height: number }[]
    exportados: { tipo: string, calidad: number }[]
    dibujos: { relleno: string, ancho: number, alto: number }[]
    cerrados: number
    imagenes: number
    urlsLiberadas: number
    continuar: () => void
    restaurar: () => void
}

export function simularDecodificacion(): Simulacion {
    let soltar: (() => void) | null = null
    const sim: Simulacion = {
        medidas: { ancho: 3000, alto: 2000 },
        falla: false,
        bitmapFalla: false,
        pausar: false,
        tamanosBlob: [],
        bitmap: vi.fn(),
        lienzos: [],
        exportados: [],
        dibujos: [],
        cerrados: 0,
        imagenes: 0,
        urlsLiberadas: 0,
        continuar: () => soltar?.(),
        restaurar: () => {
            vi.unstubAllGlobals()
            crearElemento.mockRestore()
            URL.createObjectURL = crearUrl
            URL.revokeObjectURL = liberarUrl
        },
    }

    sim.bitmap.mockImplementation(async () => {
        if (sim.pausar) {
            await new Promise<void>((resolve) => {
                soltar = resolve
            })
        }
        if (sim.falla || sim.bitmapFalla) {
            throw new DOMException('The source image could not be decoded.', 'InvalidStateError')
        }
        return {
            width: sim.medidas.ancho,
            height: sim.medidas.alto,
            close: () => {
                sim.cerrados += 1
            },
        }
    })
    vi.stubGlobal('createImageBitmap', sim.bitmap)

    class ImagenFalsa {
        onload: (() => void) | null = null
        onerror: (() => void) | null = null
        naturalWidth = 0
        naturalHeight = 0
        set src(_url: string) {
            sim.imagenes += 1
            queueMicrotask(() => {
                if (sim.falla) {
                    this.onerror?.()
                    return
                }
                this.naturalWidth = sim.medidas.ancho
                this.naturalHeight = sim.medidas.alto
                this.onload?.()
            })
        }
    }
    vi.stubGlobal('Image', ImagenFalsa)
    const crearUrl = URL.createObjectURL
    const liberarUrl = URL.revokeObjectURL
    URL.createObjectURL = () => 'blob:simulada'
    URL.revokeObjectURL = () => {
        sim.urlsLiberadas += 1
    }

    const original = document.createElement.bind(document)
    const crearElemento = vi.spyOn(document, 'createElement').mockImplementation(((etiqueta: string, opciones?: ElementCreationOptions) => {
        if (etiqueta !== 'canvas') {
            return original(etiqueta, opciones)
        }
        const lienzo = {
            width: 0,
            height: 0,
            getContext: () => {
                const contexto = {
                    fillStyle: '',
                    fillRect: () => undefined,
                    drawImage: (_fuente: unknown, _x: number, _y: number, ancho: number, alto: number) => {
                        sim.dibujos.push({ relleno: contexto.fillStyle, ancho, alto })
                    },
                }
                return contexto
            },
            toBlob: (listo: (blob: Blob | null) => void, tipo: string, calidad: number) => {
                sim.exportados.push({ tipo, calidad })
                const indice = sim.exportados.length - 1
                const tamano = indice < sim.tamanosBlob.length ? sim.tamanosBlob[indice] : 100
                queueMicrotask(() => listo(tamano === null || tamano === undefined ? null : new Blob([new Uint8Array(tamano)], { type: tipo })))
            },
        }
        sim.lienzos.push(lienzo)
        return lienzo as unknown as HTMLCanvasElement
    }) as typeof document.createElement)

    return sim
}
