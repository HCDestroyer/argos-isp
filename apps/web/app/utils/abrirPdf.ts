import type { Problem } from '@argosisp/contracts'

/**
 * Abre en otra pestaña el PDF que devuelve `pedir` (para verlo o imprimirlo). La pestaña se abre
 * antes de pedir el PDF para que el navegador no la bloquee; si falla, se cierra y devuelve el
 * Problem para mostrarlo. Sin pestaña (bloqueada), descarga el archivo con `nombre`.
 */
export async function abrirPdf(pedir: () => Promise<Resultado<Blob>>, nombre: string): Promise<Problem | null> {
    const ventana = window.open('', '_blank')
    const resultado = await pedir()
    if (!resultado.ok) {
        ventana?.close()
        return resultado.problema
    }
    const url = URL.createObjectURL(resultado.data)
    if (ventana) {
        ventana.location.href = url
    }
    else {
        const enlace = document.createElement('a')
        enlace.href = url
        enlace.download = nombre
        enlace.click()
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
    return null
}
