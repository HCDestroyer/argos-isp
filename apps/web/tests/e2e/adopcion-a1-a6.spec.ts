import { expect, test, type Locator } from '@playwright/test'
import { entrar } from './ayudas'

/**
 * Adopción de A1 y A6 (modo fixtures, escritorio y teléfono): campos personalizados en el alta y la
 * ficha del cliente, «Importado de Mikrowisp #id» en las fichas de cliente y servicio, y la vista
 * previa del editor de plantillas de aviso con las variables del catálogo de la API.
 */

function campo(contenedor: Locator, prueba: string): Locator {
    return contenedor.locator(`[data-prueba="${prueba}"] input, input[data-prueba="${prueba}"], [data-prueba="${prueba}"] textarea, textarea[data-prueba="${prueba}"]`).first()
}

test('alta de cliente con campos personalizados; la ficha los muestra con su etiqueta', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await page.goto('/clientes/nuevo')
    const adicionales = page.locator('[data-prueba="cliente-campos-personalizados"]')
    await expect(adicionales).toContainText('Cómo nos conoció', { timeout: 15_000 })
    await page.getByLabel('Nombre', { exact: true }).fill('Lucía Campos Pruebas')
    await adicionales.locator('[data-prueba="campo-cliente-referencia_casa"] input').fill('Portón verde')
    await adicionales.locator('[data-prueba="campo-cliente-medio_contacto"] button').click()
    await page.getByRole('option', { name: 'Volante' }).click()
    await adicionales.locator('[data-prueba="campo-cliente-acepta_publicidad"] button[role="switch"]').click()
    await page.getByRole('button', { name: 'Crear cliente' }).click()
    await expect(page).toHaveURL(/\/clientes\/\d+$/)
    await expect(page.locator('[data-prueba="dato-campo-medio_contacto"]')).toContainText('Volante')
    await expect(page.locator('[data-prueba="dato-campo-referencia_casa"]')).toContainText('Portón verde')
    await expect(page.locator('[data-prueba="dato-campo-acepta_publicidad"]')).toContainText('Sí')
})

test('cliente y servicio importados: «Importado de Mikrowisp #id»', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await page.goto('/clientes/8')
    await expect(page.locator('[data-prueba="cliente-importado"]')).toHaveText('Importado de Mikrowisp #1042', { timeout: 15_000 })
    await page.getByRole('tab', { name: /Servicios/ }).click()
    await page.locator('a[href^="/servicios/"]:not([href^="/servicios/nuevo"])').first().click()
    await expect(page).toHaveURL(/\/servicios\/\d+$/)
    await expect(page.locator('[data-prueba="servicio-importado"]')).toHaveText('Importado de Mikrowisp #2088')
})

test('plantilla de aviso: vista previa con datos de ejemplo y variables desconocidas', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await page.goto('/notificaciones')
    const fila = page.locator('[data-aviso="factura.emitida/correo"]')
    await expect(fila).toBeVisible({ timeout: 15_000 })
    await page.locator('tr').filter({ has: fila }).getByRole('button', { name: /Editar Factura emitida por Correo/ }).click()
    const editor = page.getByRole('dialog', { name: 'Factura emitida' })
    await expect(editor.locator('[data-prueba="aviso-variables"]')).toContainText('factura.total_q')
    await campo(editor, 'aviso-cuerpo').fill('Total {{factura.total_q}} {{cliente.apodo}}')
    await editor.locator('[data-prueba="aviso-ver-previa"]').click()
    await expect(editor.locator('[data-prueba="previa-mensaje"]')).toContainText('Total Q')
    await expect(editor.locator('[data-prueba="previa-mensaje"]')).not.toContainText('{{')
    await expect(editor.locator('[data-prueba="previa-desconocidas"]')).toContainText('cliente.apodo')
})
