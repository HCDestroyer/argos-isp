import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SoporteAdjuntos from '~/components/soporte/Adjuntos.vue'
import { simularDecodificacion, type Simulacion } from './simularFotos'

/**
 * Fotos que el cliente sube (contrato Iris 0.14.2 §11.6): JPEG, PNG y PDF pasan igual; otra imagen
 * sale en JPEG (0,85, ≤ 2560 px); la que el navegador no puede leer no se sube. El canvas y la
 * decodificación se simulan: happy-dom no decodifica imágenes.
 */

function archivo(nombre: string, tipo: string, bytes = 1024): File {
    return new File([new Uint8Array(bytes)], nombre, { type: tipo })
}

async function esperar() {
    for (let i = 0; i < 8; i += 1) {
        await flushPromises()
    }
}

let sim: Simulacion

beforeEach(() => {
    sim = simularDecodificacion()
})

afterEach(() => {
    sim.restaurar()
})

describe('prepararArchivo', () => {
    it('JPEG, PNG y PDF dentro del tope pasan sin tocar (ni se decodifican)', async () => {
        for (const original of [archivo('a.jpg', 'image/jpeg'), archivo('b.png', 'image/png'), archivo('c.pdf', 'application/pdf')]) {
            const r = await prepararArchivo(original, 10 * 1024 * 1024)
            expect(r).toEqual({ ok: true, archivo: original, convertido: false })
        }
        expect(sim.bitmap).not.toHaveBeenCalled()
        expect(sim.lienzos).toHaveLength(0)
    })

    it('un PDF grande también pasa igual (el tamaño lo avisa el formulario)', async () => {
        const pdf = archivo('c.pdf', 'application/pdf', 2048)
        const r = await prepararArchivo(pdf, 1024)
        expect(r).toEqual({ ok: true, archivo: pdf, convertido: false })
        expect(sim.bitmap).not.toHaveBeenCalled()
    })

    it('HEIC se convierte a JPEG con calidad 0,85, lado mayor 2560 px y nombre .jpg', async () => {
        sim.medidas = { ancho: 4032, alto: 3024 }
        const r = await prepararArchivo(archivo('IMG_0001.HEIC', 'image/heic', 3000), 10 * 1024 * 1024)
        expect(r.ok).toBe(true)
        if (!r.ok) return
        expect(r.convertido).toBe(true)
        expect(r.archivo.type).toBe('image/jpeg')
        expect(r.archivo.name).toBe('IMG_0001.jpg')
        expect(sim.bitmap).toHaveBeenCalledWith(expect.any(File), { imageOrientation: 'from-image' })
        expect(sim.lienzos[0]).toMatchObject({ width: 2560, height: 1920 })
        expect(sim.exportados[0]).toEqual({ tipo: 'image/jpeg', calidad: 0.85 })
        // fondo blanco antes de dibujar (sin transparencias negras) y el bitmap se libera
        expect(sim.dibujos[0]).toEqual({ relleno: '#ffffff', ancho: 2560, alto: 1920 })
        expect(sim.cerrados).toBe(1)
    })

    it('WebP chica no se agranda', async () => {
        sim.medidas = { ancho: 800, alto: 600 }
        const r = await prepararArchivo(archivo('captura.webp', 'image/webp'), 10 * 1024 * 1024)
        expect(r.ok && r.archivo.type).toBe('image/jpeg')
        expect(sim.lienzos[0]).toMatchObject({ width: 800, height: 600 })
    })

    it('HEIC sin tipo declarado (Windows, Android) se reconoce por la extensión', async () => {
        const r = await prepararArchivo(archivo('foto.heic', ''), 10 * 1024 * 1024)
        expect(r.ok && r.archivo.name).toBe('foto.jpg')
    })

    it('JPEG más grande que el tope: se reescala; si a 2560 px sigue grande, más chico', async () => {
        sim.medidas = { ancho: 6000, alto: 8000 }
        // el primer JPEG (2560 px) pesa más que el tope, el segundo (2000 px) ya cabe
        sim.tamanosBlob = [6000, 900]
        const r = await prepararArchivo(archivo('boleta.jpg', 'image/jpeg', 5000), 1000)
        expect(r.ok && r.convertido).toBe(true)
        expect(sim.lienzos.map(l => [l.width, l.height])).toEqual([[1920, 2560], [1500, 2000]])
        expect(r.ok && r.archivo.size).toBe(900)
    })

    it('JPEG grande que no se puede leer: vuelve igual y el formulario avisa el tamaño', async () => {
        sim.falla = true
        const grande = archivo('boleta.jpg', 'image/jpeg', 5000)
        const r = await prepararArchivo(grande, 1000)
        expect(r).toEqual({ ok: true, archivo: grande, convertido: false })
    })

    it('si createImageBitmap falla, intenta con <img>', async () => {
        sim.bitmapFalla = true
        sim.medidas = { ancho: 1200, alto: 900 }
        const r = await prepararArchivo(archivo('foto.webp', 'image/webp'), 10 * 1024 * 1024)
        expect(r.ok && r.archivo.type).toBe('image/jpeg')
        expect(sim.imagenes).toBe(1)
        expect(sim.lienzos[0]).toMatchObject({ width: 1200, height: 900 })
        expect(sim.urlsLiberadas).toBe(1)
    })

    it('HEIC que el navegador no puede leer (Chrome, Android): error y nada que subir', async () => {
        sim.falla = true
        const r = await prepararArchivo(archivo('IMG_0001.heic', 'image/heic'), 10 * 1024 * 1024)
        expect(r).toEqual({ ok: false, error: 'No pudimos leer esta foto. Tómala de nuevo o elige otra en JPG o PNG.' })
        expect(sim.bitmap).toHaveBeenCalled()
        expect(sim.imagenes).toBe(1)
        expect(sim.lienzos).toHaveLength(0)
    })

    it('si el canvas no exporta, error en vez de subir el HEIC', async () => {
        sim.tamanosBlob = [null]
        const r = await prepararArchivo(archivo('a.heic', 'image/heic'), 10 * 1024 * 1024)
        expect(r).toEqual({ ok: false, error: ERROR_FOTO_ILEGIBLE })
    })

    it('ayudas: accept, tipos, medidas y nombre', () => {
        expect(ACEPTA_FOTOS).toBe('image/jpeg,image/png,application/pdf')
        expect(esTipoSubible(archivo('a.webp', 'image/webp'))).toBe(false)
        expect(esTipoSubible(archivo('a.pdf', 'application/pdf'))).toBe(true)
        expect(esArchivoImagen(archivo('a.docx', ''))).toBe(false)
        expect(medidasReducidas(3000, 1000)).toEqual({ ancho: 2560, alto: 853 })
        expect(nombreJpeg('.heic')).toBe('foto.jpg')
        expect(nombreJpeg('mi.boleta.webp')).toBe('mi.boleta.jpg')
    })
})

describe('adjuntos de un ticket', () => {
    function elegir(archivos: File[]) {
        const campo = document.querySelector<HTMLInputElement>('[data-testid="soporte-adjuntos"] input[type="file"], input[type="file"]')!
        Object.defineProperty(campo, 'files', { value: archivos, configurable: true })
        campo.dispatchEvent(new Event('change', { bubbles: true }))
    }

    it('accept con JPEG, PNG y PDF (iOS entrega la foto HEIC ya en JPEG)', async () => {
        await mountSuspended(SoporteAdjuntos, { attachTo: document.body })
        expect(document.querySelector<HTMLInputElement>('input[type="file"]')!.accept).toBe('image/jpeg,image/png,application/pdf')
    })

    it('una foto HEIC se adjunta convertida a JPEG; el PDF va igual', async () => {
        const wrapper = await mountSuspended(SoporteAdjuntos, { attachTo: document.body })
        elegir([archivo('router.heic', 'image/heic'), archivo('recibo.pdf', 'application/pdf')])
        await esperar()
        const emitidos = wrapper.emitted('update:modelValue')!
        const ultimos = emitidos.at(-1)![0] as File[]
        expect(ultimos.map(a => [a.name, a.type])).toEqual([['router.jpg', 'image/jpeg'], ['recibo.pdf', 'application/pdf']])
        expect(wrapper.emitted('update:preparando')!.map(e => e[0])).toEqual([true, false])
    })

    it('si no se puede leer la foto, no se adjunta y pide otra', async () => {
        sim.falla = true
        const wrapper = await mountSuspended(SoporteAdjuntos, { attachTo: document.body })
        elegir([archivo('router.heic', 'image/heic')])
        await esperar()
        expect((wrapper.emitted('update:modelValue')!.at(-1)![0] as File[])).toEqual([])
        expect(document.body.textContent).toContain('No pudimos leer esta foto. Tómala de nuevo o elige otra en JPG o PNG.')
    })

    it('mientras convierte, muestra «Preparando la foto…» sin el botón de adjuntar', async () => {
        sim.pausar = true
        await mountSuspended(SoporteAdjuntos, { attachTo: document.body })
        elegir([archivo('router.webp', 'image/webp')])
        await esperar()
        expect(document.querySelector('[data-testid="soporte-adjuntos-preparando"]')?.textContent).toContain('Preparando la foto…')
        expect(document.body.textContent).not.toContain('Adjuntar foto o PDF')
        sim.continuar()
        await esperar()
        expect(document.querySelector('[data-testid="soporte-adjuntos-preparando"]')).toBeNull()
    })

    it('errorAdjuntos rechaza lo que no es JPG, PNG ni PDF', () => {
        expect(errorAdjuntos([archivo('carta.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')])).toBe('carta.docx no es una foto JPG o PNG ni un PDF')
        expect(errorAdjuntos([archivo('a.jpg', 'image/jpeg'), archivo('b.pdf', 'application/pdf')])).toBeNull()
    })
})

afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
})
