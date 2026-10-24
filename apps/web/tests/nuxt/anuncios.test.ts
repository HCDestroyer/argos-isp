import type { Schema } from '@argosisp/contracts'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reiniciarFixtures, sesionFixture, simularFalla } from '~~/fixtures'
import { meAdmin } from '~~/fixtures/auth/sesiones'
import { bd } from '~~/fixtures/bd'
import { UApp } from '#components'
import AnuncioFormulario from '~/components/AnuncioFormulario.vue'
import AnuncioMetricas from '~/components/AnuncioMetricas.vue'
import AnuncioTarjeta from '~/components/AnuncioTarjeta.vue'
import PaginaAnuncio from '~/pages/anuncios/[id].vue'
import PaginaAnuncios from '~/pages/anuncios/index.vue'
import { esperar } from '../ayudas/esperar'

type Me = Schema<'Me'>

/** Rol `lectura`: ve los anuncios y sus métricas, sin administrarlos. */
const LECTURA: Me = { ...meAdmin, id: 95, nombre: 'Lectura', roles: ['lectura'], permisos: meAdmin.permisos.filter(p => p.endsWith('.ver')) }

function enApp(componente: Component, props: Record<string, unknown> = {}) {
    return defineComponent({ render: () => h(UApp, null, { default: () => h(componente, props) }) })
}

describe('anuncios del portal (A5)', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
        useEmpresaActiva().elegir('todas')
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
    })

    describe('reglas y formato', () => {
        it('fechas en hora de Guatemala (UTC−6) de ida y vuelta', () => {
            expect(deHoraGuatemala('2026-10-19T09:30')).toBe('2026-10-19T15:30:00.000Z')
            expect(aHoraGuatemala('2026-10-19T15:30:00.000Z')).toBe('2026-10-19T09:30')
            expect(aHoraGuatemala('2026-10-20T03:00:00Z')).toBe('2026-10-19T21:00')
            expect(deHoraGuatemala('')).toBeNull()
            expect(aHoraGuatemala(null)).toBe('')
        })

        it('URL del botón como la API: http(s) sin usuario, o ruta del portal; nada de javascript:, // ni \\', () => {
            expect(urlBotonValida('/cuenta')).toBe(true)
            expect(urlBotonValida('https://argosisp.test/planes')).toBe(true)
            expect(urlBotonValida('javascript:alert(1)')).toBe(false)
            expect(urlBotonValida('//otro.sitio')).toBe(false)
            expect(urlBotonValida('https://u:p@argosisp.test')).toBe(false)
            expect(urlBotonValida('/a\\b')).toBe(false)
            expect(urlBotonValida('data:text/html,hola')).toBe(false)
        })

        it('esquema: botón con texto y dirección juntos, fin después del inicio y al menos un lugar', () => {
            const base = entradaAnuncio(null)
            expect(esquemaAnuncio.safeParse({ ...base, titulo: 'Hola' }).success).toBe(true)
            expect(esquemaAnuncio.safeParse({ ...base, titulo: 'Hola', boton_texto: 'Ver' }).error?.issues[0]).toMatchObject({ path: ['boton_url'] })
            expect(esquemaAnuncio.safeParse({ ...base, titulo: 'Hola', boton_texto: 'Ver', boton_url: 'javascript:x' }).error?.issues[0]?.message).toContain('http://')
            expect(esquemaAnuncio.safeParse({ ...base, titulo: 'Hola', inicio: '2026-10-20T10:00', fin: '2026-10-20T09:00' }).error?.issues[0]).toMatchObject({ path: ['fin'], message: 'El fin debe ser después del inicio' })
            expect(esquemaAnuncio.safeParse({ ...base, titulo: 'Hola', lugares: [] }).success).toBe(false)
            expect(esquemaAnuncio.safeParse({ ...base, titulo: '' }).success).toBe(false)
        })

        it('editar manda solo lo que cambió y `null` para borrar el fin y el botón', () => {
            const anuncio = bd.anuncios.find(a => a.id === 1)
            if (!anuncio) {
                throw new Error('Falta el anuncio 1')
            }
            const datos = esquemaAnuncio.parse({ ...entradaAnuncio(anuncio), fin: '', boton_texto: '', boton_url: '', orden: 3 })
            expect(cambiosAnuncio(anuncio, datos)).toEqual({ version: anuncio.version, fin: null, boton_texto: null, boton_url: null, orden: 3 })
            expect(cambiosAnuncio(anuncio, esquemaAnuncio.parse(entradaAnuncio(anuncio)))).toEqual({ version: anuncio.version })
        })

        it('métricas: 30 días con ceros donde no hubo eventos, tasa de clics y errores con título legible', () => {
            const dias = diasMetricas([{ dia: '2026-10-18', vistas: 4, clics: 1 }], '2026-10-19')
            expect(dias).toHaveLength(30)
            expect(dias.at(-1)).toEqual({ dia: '2026-10-19', vistas: 0, clics: 0 })
            expect(dias.at(-2)).toEqual({ dia: '2026-10-18', vistas: 4, clics: 1 })
            expect(dias[0]?.dia).toBe('2026-09-20')
            expect(tasaClics({ vistas: 128, clics: 17 })).toBe('13.3 %')
            expect(tasaClics({ vistas: 0, clics: 0 })).toBe('—')
            const vencido = problemaAnuncioLegible({ type: 'urn:argosisp:problema:anuncio_vencido', title: 'Regla de negocio', status: 422, detail: 'Su fecha de fin ya pasó; cámbiala antes de publicar' })
            expect(vencido.title).toBe('El anuncio ya venció')
            expect(errorArchivoImagen({ type: 'image/gif', size: 10 })).toBe('Solo PNG, JPEG o WebP')
            expect(errorArchivoImagen({ type: 'image/png', size: 2 * 1024 * 1024 })).toContain('el máximo es 1 MB')
            expect(errorMedidasImagen(32, 600)).toContain('entre 64 y 4096')
            expect(errorMedidasImagen(1200, 600)).toBeNull()
        })
    })

    describe('composable contra los fixtures (mismos errores que la API)', () => {
        it('crear sin empresa activa: 422 empresa_requerida; con empresa, en borrador', async () => {
            const sinEmpresa = await useAnuncios().crear({ titulo: 'Sin empresa' })
            expect(!sinEmpresa.ok && sinEmpresa.problema.type).toBe('urn:argosisp:problema:empresa_requerida')
            useEmpresaActiva().elegir(1)
            const creado = await useAnuncios().crear({ titulo: 'Nuevo', lugares: ['pagina_corte'], audiencia: 'al_dia' })
            expect(creado.ok && creado.data).toMatchObject({ empresa_id: 1, estado: 'borrador', vigente: false, lugares: ['pagina_corte'] })
            const malo = await useAnuncios().crear({ titulo: 'Malo', boton_texto: 'Ver', boton_url: 'javascript:alert(1)' })
            expect(!malo.ok && malo.problema.errors?.[0]?.field).toBe('boton_url')
        })

        it('publicar un archivado vencido: 422 anuncio_vencido; editar un archivado: 422 anuncio_archivado; versión vieja: 409', async () => {
            const vencido = bd.anuncios.find(a => a.id === 3)
            const publicar = await useAnuncios().publicar(3, vencido?.version ?? 0)
            expect(!publicar.ok && publicar.problema.type).toBe('urn:argosisp:problema:anuncio_vencido')
            const editar = await useAnuncios().editar(3, { version: vencido?.version ?? 0, titulo: 'Otro' })
            expect(!editar.ok && editar.problema.type).toBe('urn:argosisp:problema:anuncio_archivado')
            const vieja = await useAnuncios().publicar(2, 99)
            expect(!vieja.ok && vieja.problema.status).toBe(409)
        })

        it('quitar el fin con null, publicar (ya vigente) y archivar', async () => {
            const sinFin = await useAnuncios().editar(1, { version: 3, fin: null, orden: 20 })
            expect(sinFin.ok && sinFin.data).toMatchObject({ fin: null, orden: 20, version: 4, vigente: true })
            const publicado = await useAnuncios().publicar(2, 1)
            expect(publicado.ok && publicado.data).toMatchObject({ estado: 'publicado', vigente: true, version: 2 })
            const archivado = await useAnuncios().archivar(2, 2)
            expect(archivado.ok && archivado.data).toMatchObject({ estado: 'archivado', vigente: false })
        })

        it('imagen: sin alt 422 en alt, tipo no permitido 422 en imagen, y quitarla', async () => {
            const png = new File([new Uint8Array([137, 80, 78, 71])], 'promo.png', { type: 'image/png' })
            const sinAlt = await useAnuncios().cambiarImagen(2, 1, png, '')
            expect(!sinAlt.ok && sinAlt.problema.errors?.[0]?.field).toBe('alt')
            const gif = new File([new Uint8Array([71, 73, 70])], 'promo.gif', { type: 'image/gif' })
            const tipo = await useAnuncios().cambiarImagen(2, 1, gif, 'Una promo')
            expect(!tipo.ok && tipo.problema.errors?.[0]?.field).toBe('imagen')
            const subida = await useAnuncios().cambiarImagen(2, 1, png, 'Una promo')
            expect(subida.ok && subida.data.imagen).toMatchObject({ tipo: 'image/png', alt: 'Una promo' })
            const quitada = await useAnuncios().cambiarImagen(2, 2, null, '')
            expect(quitada.ok && quitada.data.imagen).toBeNull()
        })
    })

    describe('pantallas', () => {
        it('lista: estado, «Se ve ahora», el vencido explicado y «Nuevo anuncio» solo con empresa elegida', async () => {
            const vista = await mountSuspended(enApp(PaginaAnuncios), { route: '/anuncios' })
            await esperar(() => expect(vista.find('[data-prueba="tabla-anuncios"]').text()).toContain('Duplica tu velocidad en noviembre'))
            const texto = vista.find('[data-prueba="tabla-anuncios"]').text()
            expect(texto).toContain('Se ve ahora')
            expect(texto).toContain('Fibra del Sur llega a tu colonia')
            expect(vista.find('[data-prueba="anuncio-sin-empresa"]').exists()).toBe(true)
            expect(vista.find('[data-prueba="nuevo-anuncio"]').attributes('disabled')).toBeDefined()
            vista.unmount()

            useEmpresaActiva().elegir(1)
            const conEmpresa = await mountSuspended(enApp(PaginaAnuncios), { route: '/anuncios' })
            await esperar(() => expect(conEmpresa.find('[data-prueba="tabla-anuncios"]').text()).toContain('Duplica tu velocidad'))
            expect(conEmpresa.find('[data-prueba="tabla-anuncios"]').text()).not.toContain('Fibra del Sur llega')
            expect(conEmpresa.find('[data-prueba="nuevo-anuncio"]').attributes('disabled')).toBeUndefined()
            conEmpresa.unmount()
        })

        it('si la lista falla: el error con Reintentar y ninguna fila', async () => {
            simularFalla('GET /api/v1/anuncios', 500)
            const vista = await mountSuspended(enApp(PaginaAnuncios), { route: '/anuncios' })
            await esperar(() => expect(vista.text()).toContain('Reintentar'))
            expect(vista.find('[data-prueba="tabla-anuncios"]').exists()).toBe(false)
            vista.unmount()
        })

        it('ficha: vista previa con la imagen, métricas y acciones; lectura no ve acciones', async () => {
            const vista = await mountSuspended(enApp(PaginaAnuncio), { route: '/anuncios/1' })
            await esperar(() => expect(vista.find('[data-prueba="metrica-vistas"]').text()).toContain('128'))
            expect(vista.find('[data-prueba="anuncio-estado"]').text()).toBe('Publicado')
            expect(vista.find('[data-prueba="anuncio-vigente"]').exists()).toBe(true)
            expect(vista.find('[data-prueba="metrica-tasa"]').text()).toContain('13.3 %')
            expect(vista.find('[data-prueba="metricas-por-lugar"]').text()).toContain('Página de corte')
            await esperar(() => expect(vista.find('[data-prueba="anuncio-tarjeta-imagen"]').exists()).toBe(true))
            expect(vista.find('[data-prueba="anuncio-tarjeta-imagen"]').attributes('alt')).toBe('Router con las luces encendidas sobre una mesa')
            expect(vista.find('[data-prueba="anuncio-tarjeta-texto"]').text()).toContain('Solo para clientes al día.')
            expect(vista.find('[data-prueba="archivar-anuncio"]').exists()).toBe(true)
            expect(vista.find('[data-prueba="publicar-anuncio"]').exists()).toBe(false)
            vista.unmount()

            useUsuarioActual().value = LECTURA
            const lectura = await mountSuspended(enApp(PaginaAnuncio), { route: '/anuncios/1' })
            await esperar(() => expect(lectura.find('[data-prueba="metrica-vistas"]').text()).toContain('128'))
            expect(lectura.find('[data-prueba="archivar-anuncio"]').exists()).toBe(false)
            expect(lectura.find('[data-prueba="editar-anuncio"]').exists()).toBe(false)
            lectura.unmount()
        })

        it('archivado vencido: avisa que no se edita y Publicar muestra el 422 con su título', async () => {
            const vista = await mountSuspended(enApp(PaginaAnuncio), { route: '/anuncios/3' })
            await esperar(() => expect(vista.find('[data-prueba="anuncio-estado"]').text()).toBe('Archivado'))
            expect(vista.text()).toContain('Archivado: no se ve ni se edita')
            expect(vista.find('[data-prueba="editar-anuncio"]').attributes('disabled')).toBeDefined()
            await vista.find('[data-prueba="publicar-anuncio"]').trigger('click')
            await esperar(() => expect(document.body.querySelector('[role="dialog"]')).not.toBeNull())
            const confirmar = [...document.body.querySelectorAll('[role="dialog"] button')].find(b => b.textContent?.trim() === 'Publicar') as HTMLElement | undefined
            confirmar?.click()
            await esperar(() => expect(document.body.textContent).toContain('El anuncio ya venció'))
            expect(document.body.textContent).toContain('Cambia o quita la fecha de fin')
            vista.unmount()
        })

        it('métricas: si fallan, Reintentar y ninguna cifra; sin eventos, lo dice', async () => {
            simularFalla('GET /api/v1/anuncios/:id/metricas', 500)
            const falla = await mountSuspended(AnuncioMetricas, { props: { anuncioId: 1 } })
            await esperar(() => expect(falla.text()).toContain('Reintentar'))
            expect(falla.find('[data-prueba="metrica-vistas"]').exists()).toBe(false)
            falla.unmount()
            reiniciarFixtures()
            const vacia = await mountSuspended(AnuncioMetricas, { props: { anuncioId: 2 } })
            await esperar(() => expect(vacia.text()).toContain('Todavía nadie lo ha visto'))
            vacia.unmount()
        })

        it('la tarjeta pinta el texto como texto (nunca HTML) y dice a dónde lleva el botón', async () => {
            const vista = await mountSuspended(AnuncioTarjeta, { props: { titulo: 'T', texto: '<b>hola</b>\nlínea 2', boton: { texto: 'Ver', url: 'https://x.test' }, imagen: null } })
            expect(vista.find('b').exists()).toBe(false)
            expect(vista.find('[data-prueba="anuncio-tarjeta-texto"]').text()).toContain('<b>hola</b>')
            expect(vista.text()).toContain('Abre en otra pestaña: https://x.test')
            vista.unmount()
        })

        it('el formulario crea en borrador con la vista previa al día', async () => {
            useEmpresaActiva().elegir(1)
            const guardado = vi.fn()
            const vista = await mountSuspended(enApp(AnuncioFormulario, { open: true, onGuardado: guardado }))
            await esperar(() => expect(document.body.querySelector('[data-prueba="anuncio-titulo"]')).not.toBeNull())
            const titulo = document.body.querySelector('[data-prueba="anuncio-titulo"]') as HTMLInputElement
            titulo.value = 'Velocidad doble'
            titulo.dispatchEvent(new Event('input'))
            await esperar(() => expect(document.body.querySelector('[data-prueba="anuncio-vista-previa"]')?.textContent).toContain('Velocidad doble'))
            ;(document.body.querySelector('[data-prueba="guardar-anuncio"]') as HTMLButtonElement).click()
            await esperar(() => expect(guardado).toHaveBeenCalled())
            expect(guardado.mock.calls[0]?.[0]).toMatchObject({ titulo: 'Velocidad doble', estado: 'borrador', empresa_id: 1 })
            expect(guardado.mock.calls[0]?.[1]).toBe(true)
            vista.unmount()
        })
    })
})
