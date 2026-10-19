import { expect, test, type Page } from '@playwright/test'
import { entrar, ir } from './ayudas'

/**
 * Anuncios del portal (A5) en modo fixtures, en escritorio y teléfono:
 *
 * 1. Con «Todas» no se crea (cada anuncio es de una empresa); con ArgosNet: borrador con la vista
 *    previa al día, imagen con texto alternativo y publicar.
 * 2. Publicar un archivado ya vencido muestra el 422 `anuncio_vencido` con su título.
 * 3. Métricas del anuncio publicado: vistas, clics y tasa.
 */
async function elegirEmpresa(page: Page, nombre: RegExp) {
    const selector = page.locator('[data-prueba="selector-empresa"]:visible').first()
    await selector.click()
    await page.getByRole('option', { name: nombre }).click()
    await expect(selector).toContainText(nombre)
}

test('crear un anuncio con vista previa, imagen y publicarlo', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Anuncios', /\/anuncios$/)
    await expect(page.locator('[data-prueba="anuncio-sin-empresa"]')).toBeVisible()
    await expect(page.locator('[data-prueba="nuevo-anuncio"]')).toBeDisabled()
    await elegirEmpresa(page, /ArgosNet/)

    await page.locator('[data-prueba="nuevo-anuncio"]').click()
    const panel = page.getByRole('dialog', { name: 'Nuevo anuncio' })
    await panel.getByLabel('Título', { exact: true }).fill('Velocidad doble en diciembre')
    await panel.getByLabel('Texto', { exact: true }).fill('Para clientes al día.\nSin costo extra.')
    await panel.getByLabel('Texto del botón', { exact: true }).fill('Ver planes')
    await panel.getByLabel('Dirección del botón', { exact: true }).fill('javascript:alert(1)')
    await panel.getByRole('button', { name: 'Crear borrador' }).click()
    await expect(panel.getByText('Usa una dirección http:// o https://')).toBeVisible()
    await panel.getByLabel('Dirección del botón', { exact: true }).fill('/cuenta')
    const previa = panel.locator('[data-prueba="anuncio-vista-previa"]')
    await expect(previa).toContainText('Velocidad doble en diciembre')
    await expect(previa).toContainText('Lleva a /cuenta')
    await panel.getByRole('button', { name: 'Crear borrador' }).click()

    await expect(page).toHaveURL(/\/anuncios\/\d+$/)
    await expect(page.locator('[data-prueba="anuncio-estado"]')).toHaveText('Borrador')

    // Una imagen PNG real (captura de la propia página, 360×180 en escritorio).
    const png = await page.screenshot({ clip: { x: 0, y: 0, width: 360, height: 180 } })
    await page.locator('[data-prueba="imagen-anuncio"]').click()
    const modal = page.getByRole('dialog', { name: 'Agregar imagen' })
    await modal.locator('input[type="file"]').setInputFiles({ name: 'promo.png', mimeType: 'image/png', buffer: png })
    // En el teléfono la captura sale escalada por la densidad de píxeles: solo se revisa que mida.
    await expect(modal).toContainText(/\d+×\d+ px · se recorta a 2:1/)
    await modal.getByRole('button', { name: 'Subir imagen' }).click()
    await expect(modal.getByText('Describe la imagen para quien no la ve')).toBeVisible()
    await modal.getByLabel('Texto alternativo', { exact: true }).fill('Captura del panel de ArgosIsp')
    await modal.getByRole('button', { name: 'Subir imagen' }).click()
    await expect(modal).toBeHidden()
    await expect(page.locator('[data-prueba="anuncio-tarjeta-imagen"]')).toHaveAttribute('alt', 'Captura del panel de ArgosIsp')

    await page.locator('[data-prueba="publicar-anuncio"]').click()
    const confirmar = page.getByRole('dialog', { name: /Publicar/ })
    await confirmar.getByRole('button', { name: 'Publicar' }).click()
    await expect(page.locator('[data-prueba="anuncio-estado"]')).toHaveText('Publicado')
    await expect(page.locator('[data-prueba="anuncio-vigente"]')).toBeVisible()
})

test('publicar un archivado vencido muestra por qué no se puede', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Anuncios', /\/anuncios$/)
    await page.getByRole('link', { name: 'Reactiva tu servicio hoy' }).click()
    await expect(page.locator('[data-prueba="anuncio-estado"]')).toHaveText('Archivado')
    await expect(page.locator('[data-prueba="editar-anuncio"]')).toBeDisabled()
    await page.locator('[data-prueba="publicar-anuncio"]').click()
    const confirmar = page.getByRole('dialog', { name: /Publicar/ })
    await confirmar.getByRole('button', { name: 'Publicar' }).click()
    await expect(confirmar).toContainText('El anuncio ya venció')
    await expect(confirmar).toContainText('Cambia o quita la fecha de fin')
})

test('métricas del anuncio publicado', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Anuncios', /\/anuncios$/)
    await page.getByRole('link', { name: 'Duplica tu velocidad en noviembre' }).click()
    await expect(page.locator('[data-prueba="metrica-vistas"]')).toContainText('128')
    await expect(page.locator('[data-prueba="metrica-clics"]')).toContainText('17')
    await expect(page.locator('[data-prueba="metrica-tasa"]')).toContainText('13.3 %')
    await expect(page.locator('[data-prueba="metricas-por-lugar"]')).toContainText('Inicio del portal')
})
