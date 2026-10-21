import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import meAdmin from '~~/fixtures/auth/me.admin.json'
import { SORTEO_ABIERTO_ID, SORTEO_BORRADOR_ID, SORTEO_EJECUTADO_ID } from '~~/fixtures/sorteos/datos'
import { bytesBase64, IMAGENES_SEMILLA } from '~~/fixtures/sorteos/imagenes'
import PaginaSorteo from '~/pages/lealtad/sorteos/[id].vue'
import { esperar } from '../ayudas/esperar'

/**
 * Sorteos, segunda PR de A3 (`a3/sorteos-2`), lo que toca al panel ahora: el interruptor
 * `aviso_portal` (hasta antes de ejecutar, con `version`) y la imagen de cada premio, que se sube
 * (PNG, JPEG o WebP por su contenido, hasta 1 MB, de 64 a 4096 px) y se pide con la sesión; mandar
 * `imagen_url` al crear o editar es 422 `imagen_externa`.
 */

const PNG_32 = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKklEQVR4nO3NQQEAAATAQCQVRXQl+N0C7DKm47N6vQMAAAAAAAAAAIDDFiq0ASDb5zUVAAAAAElFTkSuQmCC'
const JPEG_80X64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCABAAFADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDlaKKK1PiQooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA//Z'

function archivo(base64: string, nombre: string, tipo: string): File {
    return new File([bytesBase64(base64).slice()], nombre, { type: tipo })
}

describe('sorteos · aviso en el portal e imagen de los premios', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
    })

    it('la imagen se revisa como la API: tipo por el contenido, tamaño y lados', () => {
        expect(leerImagenPremio(bytesBase64(IMAGENES_SEMILLA.bicicleta))).toEqual({ tipo: 'image/webp', ancho: 320, alto: 200 })
        expect(leerImagenPremio(bytesBase64(JPEG_80X64))).toEqual({ tipo: 'image/jpeg', ancho: 80, alto: 64 })
        expect(errorImagenPremio(bytesBase64(PNG_32))).toBe('La imagen mide 32×32 px; cada lado debe medir entre 64 y 4096 px')
        expect(errorImagenPremio(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe('La imagen debe ser PNG, JPEG o WebP')
        expect(errorImagenPremio(new Uint8Array(1024 * 1024 + 1))).toBe('La imagen pesa 1025 KB; el máximo es 1024 KB')
        expect(errorImagenPremio(new Uint8Array())).toBe('Falta el archivo')
        expect(errorImagenPremio(bytesBase64(JPEG_80X64))).toBeNull()
    })

    it('subir la imagen: solo en borrador; un SVG o una de 32 px es 422; la ficha la pide con la sesión', async () => {
        const svg = await useSorteos().subirImagenPremio(SORTEO_BORRADOR_ID, 1, new File(['<svg/>'], 'premio.svg', { type: 'image/svg+xml' }))
        expect(!svg.ok && [svg.problema.errors?.[0]?.field, svg.problema.errors?.[0]?.rule]).toEqual(['imagen', 'tipo'])
        const chica = await useSorteos().subirImagenPremio(SORTEO_BORRADOR_ID, 1, archivo(PNG_32, 'chica.png', 'image/png'))
        expect(!chica.ok && chica.problema.errors?.[0]?.rule).toBe('dimensiones')
        // El tipo lo da el contenido, no el nombre ni el `type` del navegador.
        const subida = await useSorteos().subirImagenPremio(SORTEO_BORRADOR_ID, 1, archivo(JPEG_80X64, 'efectivo.png', 'image/png'))
        const premio = subida.ok ? subida.data.premios.find(p => p.posicion === 1) : undefined
        expect(premio?.imagen_url).toBe(`/api/v1/lealtad/sorteos/${SORTEO_BORRADOR_ID}/premios/1/imagen`)
        expect(premio?.imagen_archivo_id).toEqual(expect.any(Number))
        const leida = await useSorteos().imagenPremio(SORTEO_BORRADOR_ID, 1)
        expect(leida.ok && [leida.data.type, leida.data.size]).toEqual(['image/jpeg', bytesBase64(JPEG_80X64).length])
        const ejecutado = await useSorteos().subirImagenPremio(SORTEO_EJECUTADO_ID, 1, archivo(JPEG_80X64, 'x.jpg', 'image/jpeg'))
        expect(!ejecutado.ok && codigoProblema(ejecutado.problema)).toBe('estado_sorteo')
    })

    it('crear o editar con imagen_url es 422 imagen_externa; el formulario ya no la manda', async () => {
        const actual = await useSorteos().ver(SORTEO_BORRADOR_ID)
        if (!actual.ok) {
            throw new Error('sin sorteo')
        }
        const cuerpo = cuerpoEdicionSorteo(actual.data, esquemaSorteo.parse(entradaDeSorteo(actual.data)))
        expect(cuerpo.premios?.every(p => !('imagen_url' in p))).toBe(true)
        const externa = await useSorteos().editar(SORTEO_BORRADOR_ID, { ...cuerpo, premios: cuerpo.premios?.map(p => ({ ...p, imagen_url: 'https://ejemplo.com/tv.png' })) })
        expect(!externa.ok && externa.problema.errors?.map(e => e.rule)).toEqual(['imagen_externa', 'imagen_externa'])
        const editado = await useSorteos().editar(SORTEO_BORRADOR_ID, cuerpo)
        expect(editado.ok && editado.data.premios[1]?.imagen_archivo_id).toEqual(expect.any(Number))
    })

    it('aviso en el portal: con version, hasta antes de ejecutar (409 después y con otra versión)', async () => {
        const actual = await useSorteos().ver(SORTEO_BORRADOR_ID)
        if (!actual.ok) {
            throw new Error('sin sorteo')
        }
        expect(actual.data.aviso_portal).toBe(false)
        const anunciado = await useSorteos().cambiarAvisoPortal(SORTEO_BORRADOR_ID, actual.data.version, true)
        expect(anunciado.ok && [anunciado.data.aviso_portal, anunciado.data.version]).toEqual([true, actual.data.version + 1])
        const viejo = await useSorteos().cambiarAvisoPortal(SORTEO_BORRADOR_ID, actual.data.version, false)
        expect(!viejo.ok && viejo.problema.status).toBe(409)
        const ejecutado = await useSorteos().ver(SORTEO_EJECUTADO_ID)
        const tarde = ejecutado.ok ? await useSorteos().cambiarAvisoPortal(SORTEO_EJECUTADO_ID, ejecutado.data.version, true) : null
        expect(tarde && !tarde.ok && codigoProblema(tarde.problema)).toBe('estado_sorteo')
    })

    it('ficha: el interruptor cambia el aviso; ejecutado o sin permiso solo se informa; «Subir imagen» solo en borrador', async () => {
        const abierto = await mountSuspended(PaginaSorteo, { route: `/lealtad/sorteos/${SORTEO_ABIERTO_ID}` })
        await esperar(() => expect(abierto.find('[data-prueba="interruptor-aviso-portal"]').exists()).toBe(true))
        const interruptor = abierto.find('[role="switch"]')
        expect(interruptor.attributes('aria-checked')).toBe('true')
        await interruptor.trigger('click')
        await esperar(() => expect(abierto.find('[role="switch"]').attributes('aria-checked')).toBe('false'))
        expect(abierto.find('[data-prueba="subir-imagen-premio"]').exists()).toBe(false)
        abierto.unmount()

        const ejecutado = await mountSuspended(PaginaSorteo, { route: `/lealtad/sorteos/${SORTEO_EJECUTADO_ID}` })
        await esperar(() => expect(ejecutado.find('[data-prueba="aviso-portal-estado"]').text()).toContain('Ya no se puede cambiar'))
        expect(ejecutado.find('[role="switch"]').exists()).toBe(false)
        // Las imágenes sembradas llegan por la API con la sesión, como URL de objeto.
        await esperar(() => expect(ejecutado.findAll('[data-prueba="premio-imagen"]').length).toBe(3))
        expect(ejecutado.find('[data-prueba="premio-imagen"]').attributes('src')).toMatch(/^blob:/)
        ejecutado.unmount()

        const borrador = await mountSuspended(PaginaSorteo, { route: `/lealtad/sorteos/${SORTEO_BORRADOR_ID}` })
        await esperar(() => expect(borrador.findAll('[data-prueba="subir-imagen-premio"]').map(b => b.text())).toEqual(['Subir imagen', 'Cambiar imagen']))
        borrador.unmount()

        useUsuarioActual().value = { ...meAdmin, permisos: meAdmin.permisos.filter(p => p !== 'sorteos.gestionar') }
        const sinPermiso = await mountSuspended(PaginaSorteo, { route: `/lealtad/sorteos/${SORTEO_BORRADOR_ID}` })
        await esperar(() => expect(sinPermiso.find('[data-prueba="aviso-portal-estado"]').text()).toContain('No se anuncia'))
        expect(sinPermiso.find('[data-prueba="subir-imagen-premio"]').exists()).toBe(false)
        expect(sinPermiso.find('[role="switch"]').exists()).toBe(false)
        sinPermiso.unmount()
    })
})
