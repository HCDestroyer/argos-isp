import { expect, test, type Locator, type Page } from '@playwright/test'
import { entrar } from './ayudas'

/**
 * Inventario fase D (modo fixtures, escritorio y teléfono; `contratos/inventario.md` «Fase D»):
 * 1. crear una orden de traslado, recibirla con la firma en pantalla y abrir su PDF;
 * 2. alta de productos por lote pegando desde Excel;
 * 3. cargar un XML FEL y confirmar el borrador de la compra.
 */

function campo(contenedor: Locator, prueba: string): Locator {
    return contenedor.locator(`[data-prueba="${prueba}"] input, input[data-prueba="${prueba}"], [data-prueba="${prueba}"] textarea, textarea[data-prueba="${prueba}"]`).first()
}

async function elegir(page: Page, disparador: Locator, opcion: string | RegExp): Promise<void> {
    await disparador.click()
    await page.getByRole('option', { name: opcion }).first().click()
}

/** Firma con el ratón (o el dedo) sobre el lienzo: unas curvas de lado a lado. */
async function firmar(page: Page, lienzo: Locator): Promise<void> {
    await lienzo.scrollIntoViewIfNeeded()
    const caja = await lienzo.boundingBox()
    if (!caja) {
        throw new Error('El lienzo de la firma no se ve')
    }
    const y = caja.y + caja.height / 2
    await page.mouse.move(caja.x + 20, y)
    await page.mouse.down()
    for (let i = 1; i <= 12; i++) {
        await page.mouse.move(caja.x + 20 + i * ((caja.width - 40) / 12), y + (i % 2 === 0 ? -25 : 25), { steps: 3 })
    }
    await page.mouse.up()
}

const FACTURA_FEL = `<?xml version="1.0" encoding="UTF-8"?>
<dte:GTDocumento xmlns:dte="http://www.sat.gob.gt/dte/fel/0.2.0" Version="0.1">
  <dte:SAT ClaseDocumento="dte">
    <dte:DTE ID="DatosCertificados">
      <dte:DatosEmision ID="DatosEmision">
        <dte:DatosGenerales CodigoMoneda="GTQ" FechaHoraEmision="2026-09-15T10:15:00-06:00" Tipo="FACT"/>
        <dte:Emisor NITEmisor="33214561" NombreComercial="Electrónica Central" NombreEmisor="ELECTRONICA CENTRAL, S.A."/>
        <dte:Receptor IDReceptor="12345678" NombreReceptor="ARGOSNET, S.A."/>
        <dte:Items>
          <dte:Item BienOServicio="B" NumeroLinea="1">
            <dte:Cantidad>2</dte:Cantidad><dte:UnidadMedida>UNI</dte:UnidadMedida><dte:Descripcion>Conector RJ45</dte:Descripcion>
            <dte:PrecioUnitario>1.50</dte:PrecioUnitario><dte:Descuento>0.00</dte:Descuento>
            <dte:Impuestos><dte:Impuesto><dte:NombreCorto>IVA</dte:NombreCorto><dte:MontoImpuesto>0.32</dte:MontoImpuesto></dte:Impuesto></dte:Impuestos>
            <dte:Total>3.00</dte:Total>
          </dte:Item>
          <dte:Item BienOServicio="B" NumeroLinea="2">
            <dte:Cantidad>10</dte:Cantidad><dte:UnidadMedida>UNI</dte:UnidadMedida><dte:Descripcion>Patch cord Cat6 1 m</dte:Descripcion>
            <dte:PrecioUnitario>12.00</dte:PrecioUnitario><dte:Descuento>0.00</dte:Descuento>
            <dte:Impuestos><dte:Impuesto><dte:NombreCorto>IVA</dte:NombreCorto><dte:MontoImpuesto>12.86</dte:MontoImpuesto></dte:Impuesto></dte:Impuestos>
            <dte:Total>120.00</dte:Total>
          </dte:Item>
        </dte:Items>
        <dte:Totales><dte:TotalImpuestos><dte:TotalImpuesto NombreCorto="IVA" TotalMontoImpuesto="13.18"/></dte:TotalImpuestos><dte:GranTotal>123.00</dte:GranTotal></dte:Totales>
      </dte:DatosEmision>
    </dte:DTE>
    <dte:Certificacion><dte:NumeroAutorizacion Numero="990011" Serie="E2E00001">E2E00001-0007-1234-ABCD-1234567890AB</dte:NumeroAutorizacion></dte:Certificacion>
  </dte:SAT>
</dte:GTDocumento>
`

test('orden de traslado: enviar, recibir con firma digital y ver el PDF', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await page.goto('/inventario/traslados')
    await expect(page.locator('[data-orden="3"]')).toBeVisible({ timeout: 20_000 })
    await page.locator('[data-prueba="nueva-orden-traslado"]').click()
    await expect(page).toHaveURL(/\/inventario\/traslados\/nueva$/, { timeout: 20_000 })

    await elegir(page, page.locator('[data-prueba="orden-origen"]'), 'Bodega central')
    await elegir(page, page.locator('[data-prueba="orden-destino"]'), /Pedro Técnico/)
    await elegir(page, page.locator('[data-prueba="orden-agregar-producto"]'), /Cable UTP Cat6/)
    await campo(page.locator('[data-linea-orden="CAB-UTP6"]'), 'orden-cantidad').fill('10')
    // Escanear una ONU por su MAC (un lector «teclea» y manda Enter).
    const escaner = campo(page.locator('body'), 'orden-escanear')
    await escaner.fill('AA:BB:CC:00:00:02')
    await escaner.press('Enter')
    await expect(page.locator('[data-linea-orden="ONU-HG8145"]')).toContainText('HWTC1A2B3C02')
    await page.locator('[data-prueba="orden-enviar"]').click()

    await expect(page).toHaveURL(/\/inventario\/traslados\/\d+$/, { timeout: 20_000 })
    await expect(page.locator('[data-prueba="estado-traslado"]')).toHaveText('En tránsito')
    await page.locator('[data-prueba="traslado-recibir"]').click()
    const recibir = page.getByRole('dialog', { name: /Recibir orden N\.º 4/ })
    await firmar(page, recibir.locator('[data-prueba="firma-lienzo"]'))
    await expect(recibir.locator('[data-prueba="firma-huella"]')).toContainText('SHA-256')
    await recibir.locator('[data-prueba="recibir-confirmar"]').click()
    await expect(recibir).toBeHidden()
    await expect(page.locator('[data-prueba="estado-traslado"]')).toHaveText('Recibida')
    await expect(page.locator('[data-prueba="recepcion-traslado"]')).toContainText('Firma digital')
    await expect(page.locator('[data-prueba="traslado-firma"]')).toBeVisible()

    // «Imprimir» abre el PDF en otra pestaña (Chrome sin interfaz lo descarga en vez de mostrarlo).
    const ventana = page.waitForEvent('popup')
    await page.locator('[data-prueba="traslado-imprimir"]').click()
    const pdf = await ventana
    await expect(pdf).toBeTruthy()
    await expect(page.locator('[data-prueba="traslado-imprimir"]')).toBeEnabled()
    await expect(page.getByText('No se pudo generar el PDF')).toHaveCount(0)
})

test('alta de productos por lote pegando desde Excel', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await page.goto('/inventario/productos-lote')
    await expect(page.locator('[data-prueba="tabla-lote"]')).toBeVisible({ timeout: 20_000 })
    await elegir(page, page.locator('[data-prueba="lote-bodega"]'), 'Bodega central')
    await page.locator('[data-prueba="lote-pegar"]').click()
    const pegar = page.getByRole('dialog', { name: 'Pegar desde Excel o CSV' })
    await campo(pegar, 'lote-texto').fill([
        'SKU\tNombre\tTipo\tUnidad\tModalidad\tPrecio\tCantidad\tCosto',
        'PAT-CAT6\tPatch cord Cat6 1 m\tMaterial\tunidad\tcobro\t25.00\t30\t8.50',
        'CAB-UTP6\tCable repetido\tMaterial\tmetro\t\t\t10\t2.00',
    ].join('\n'))
    await pegar.locator('[data-prueba="lote-agregar-pegado"]').click()
    await expect(pegar).toBeHidden()
    await page.locator('[data-prueba="lote-crear"]').click()
    // El SKU ya existe: error en su fila y no se crea nada.
    await expect(page.getByText('La empresa ya tiene ese SKU', { exact: true })).toBeVisible()
    await expect(page.locator('[data-prueba="lote-creados"]')).toHaveCount(0)
    await page.locator('input[data-prueba="lote-sku"], [data-prueba="lote-sku"] input').nth(1).fill('CAB-EXT')
    await page.locator('[data-prueba="lote-crear"]').click()
    await expect(page.locator('[data-prueba="lote-creados"]')).toContainText('PAT-CAT6, CAB-EXT')
})

test('cargar un XML FEL y confirmar el borrador de la compra', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await page.goto('/compras')
    await page.locator('[data-prueba="cargar-factura"]').click()
    await expect(page).toHaveURL(/\/compras\/cargar$/, { timeout: 20_000 })
    await page.locator('input[type="file"]').first().setInputFiles({ name: 'factura-electronica-central.xml', mimeType: 'text/xml', buffer: Buffer.from(FACTURA_FEL) })
    await page.locator('[data-prueba="compra-cargar"]').click()

    await expect(page).toHaveURL(/\/compras\/borradores\/\d+$/, { timeout: 20_000 })
    await expect(page.locator('[data-prueba="borrador-estado"]')).toHaveText('Por revisar')
    await expect(campo(page.locator('body'), 'borrador-numero')).toHaveValue('990011')
    await expect(page.locator('[data-prueba="borrador-cuadre"]')).toContainText('123.00')
    for (let i = 0; i < 2; i++) {
        await elegir(page, page.locator('[data-prueba="confirmar-bodega"]').nth(i), 'Bodega central')
    }
    await page.locator('[data-prueba="borrador-confirmar"]').click()
    await expect(page.locator('[data-prueba="borrador-estado"]')).toHaveText('Confirmado', { timeout: 15_000 })
    await expect(page.locator('[data-prueba="borrador-ver-compra"]')).toBeVisible()
})
