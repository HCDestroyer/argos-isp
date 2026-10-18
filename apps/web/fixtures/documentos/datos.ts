import type { Schema } from '@argosisp/contracts'

/**
 * Empresa y plantilla del aviso de cobro (A5, `apps/api/app/portal/README.md`). Como la API:
 * `version: 0` mientras nadie las guarda (valores por defecto y plantilla de fábrica).
 */
export const empresa: Schema<'Empresa'> = {
    nombre: 'ArgosIsp',
    nit: null,
    direccion: null,
    telefono: null,
    telefono_alterno: null,
    whatsapp: null,
    correo: null,
    horario: null,
    instrucciones_pago: null,
    version: 0,
}

/** Variables del aviso de cobro, como `VARIABLES_AVISO_COBRO` de la API. */
export const variablesAvisoCobro: Schema<'VariableDocumento'>[] = [
    { nombre: 'empresa.nombre', descripcion: 'Nombre comercial de la empresa' },
    { nombre: 'empresa.nit', descripcion: 'NIT de la empresa' },
    { nombre: 'empresa.direccion', descripcion: 'Dirección de la empresa' },
    { nombre: 'empresa.telefono', descripcion: 'Teléfono de atención' },
    { nombre: 'empresa.telefono_alterno', descripcion: 'Segundo teléfono' },
    { nombre: 'empresa.whatsapp', descripcion: 'WhatsApp de atención' },
    { nombre: 'empresa.correo', descripcion: 'Correo de atención' },
    { nombre: 'empresa.horario', descripcion: 'Horario de atención' },
    { nombre: 'empresa.instrucciones_pago', descripcion: 'Texto de instrucciones de pago' },
    { nombre: 'cliente.nombre', descripcion: 'Nombre del cliente' },
    { nombre: 'cliente.nit', descripcion: 'NIT o CUI del cliente; "CF" si no tiene' },
    { nombre: 'cliente.direccion', descripcion: 'Dirección fiscal (o la del cliente)' },
    { nombre: 'cliente.email', descripcion: 'Correo del cliente' },
    { nombre: 'servicio.plan', descripcion: 'Plan del servicio facturado' },
    { nombre: 'servicio.direccion', descripcion: 'Dirección de instalación' },
    { nombre: 'factura.documento', descripcion: '"Aviso de cobro"; "Factura" (o "Nota de débito" en la mora) cuando su DTE está certificado' },
    { nombre: 'factura.numero', descripcion: 'Serie-número FEL o número del aviso' },
    { nombre: 'factura.periodo', descripcion: 'Mes facturado: "octubre 2026"' },
    { nombre: 'factura.emitida', descripcion: 'Fecha de emisión: 01/10/2026' },
    { nombre: 'factura.vence', descripcion: 'Fecha de vencimiento: 10/10/2026' },
    { nombre: 'factura.estado', descripcion: 'Pendiente, Abono parcial, Vencida, Pagada o Anulada' },
    { nombre: 'factura.subtotal', descripcion: 'Subtotal sin IVA: "Q 156.25"' },
    { nombre: 'factura.iva', descripcion: 'IVA: "Q 18.75"' },
    { nombre: 'factura.total', descripcion: 'Total: "Q 175.00"' },
    { nombre: 'factura.pagado', descripcion: 'Abonado hasta hoy' },
    { nombre: 'factura.saldo', descripcion: 'Saldo a pagar' },
    { nombre: 'factura.lineas', descripcion: 'Tabla de líneas (concepto, cantidad, precio, total)' },
    { nombre: 'factura.tiene_pagos', descripcion: 'Sección: hay abonos' },
    { nombre: 'factura.fel', descripcion: 'Sección: el DTE de la factura está certificado (FEL)' },
    { nombre: 'factura.fel_uuid', descripcion: 'Número de autorización FEL' },
    { nombre: 'factura.fel_serie', descripcion: 'Serie FEL' },
    { nombre: 'factura.fel_numero', descripcion: 'Número FEL' },
    { nombre: 'factura.fel_fecha', descripcion: 'Fecha y hora de certificación (Guatemala)' },
    { nombre: 'factura.fel_tipo', descripcion: 'Tipo de DTE en palabras: Factura, Factura cambiaria, Nota de débito' },
    { nombre: 'factura.fel_anulado', descripcion: 'Sección: el DTE fue anulado ante la SAT' },
    { nombre: 'lineas', descripcion: 'Lista para {{#lineas}}: concepto, cantidad, precio_unitario, iva, total' },
    { nombre: 'generado', descripcion: 'Fecha y hora de generación (Guatemala)' },
]

/** Versión corta de la plantilla de fábrica (`plantilla_base.ts` de la API). */
const HTML_FABRICA = `<h1>{{empresa.nombre}}</h1>
<p class="tenue">{{#empresa.nit}}NIT {{empresa.nit}}<br>{{/empresa.nit}}{{#empresa.telefono}}Tel. {{empresa.telefono}}{{/empresa.telefono}}</p>
<h2>{{factura.documento}} No. {{factura.numero}}</h2>
<p>Cliente: <strong>{{cliente.nombre}}</strong> · NIT {{cliente.nit}}</p>
<p>Periodo: <strong>{{factura.periodo}}</strong> · Vence: <strong>{{factura.vence}}</strong></p>
{{factura.lineas}}
<p class="derecha grande"><strong>Saldo a pagar {{factura.saldo}}</strong></p>
{{#factura.fel}}
<p class="tenue"><small>Documento Tributario Electrónico (FEL) · {{factura.fel_tipo}} · Serie {{factura.fel_serie}} · Número {{factura.fel_numero}}<br>Autorización {{factura.fel_uuid}}{{#factura.fel_fecha}}<br>Certificado el {{factura.fel_fecha}}{{/factura.fel_fecha}}</small></p>
{{#factura.fel_anulado}}<p><strong>Documento anulado ante la SAT.</strong></p>{{/factura.fel_anulado}}
{{/factura.fel}}
{{^factura.fel}}
<p class="tenue"><small>Este aviso de cobro no es una factura electrónica (FEL).</small></p>
{{/factura.fel}}
{{#empresa.instrucciones_pago}}<h3>Cómo pagar</h3><p>{{empresa.instrucciones_pago}}</p>{{/empresa.instrucciones_pago}}
<p class="tenue centro"><small>Generado el {{generado}}</small></p>
`

/** Variables de la nota de crédito (A5, fase 3), capturadas de `GET /documentos/plantillas/nota_credito/fabrica`. */
export const variablesNotaCredito: Schema<'VariableDocumento'>[] = [
    { nombre: 'empresa.nombre', descripcion: 'Nombre comercial de la empresa que emite la nota' },
    { nombre: 'empresa.razon_social', descripcion: 'Razón social (nombre fiscal) de la empresa' },
    { nombre: 'empresa.nit', descripcion: 'NIT de la empresa' },
    { nombre: 'empresa.direccion', descripcion: 'Dirección fiscal de la empresa' },
    { nombre: 'empresa.logo', descripcion: 'Sección: la empresa tiene logo. Se dibuja con <img src="empresa:logo" height="48">' },
    { nombre: 'empresa.telefono', descripcion: 'Teléfono de atención' },
    { nombre: 'empresa.correo', descripcion: 'Correo de atención' },
    { nombre: 'cliente.nombre', descripcion: 'Receptor: nombre del DTE certificado o nombre fiscal del cliente' },
    { nombre: 'cliente.nit', descripcion: 'NIT o CUI del receptor; "CF" si no tiene' },
    { nombre: 'cliente.direccion', descripcion: 'Dirección fiscal (o la del cliente)' },
    { nombre: 'cliente.email', descripcion: 'Correo del cliente' },
    { nombre: 'nota.documento', descripcion: '"Nota de crédito"' },
    { nombre: 'nota.numero', descripcion: 'Serie-número de la NCRE o número interno de la nota' },
    { nombre: 'nota.fecha', descripcion: 'Fecha de la nota: 12/06/2026' },
    { nombre: 'nota.motivo', descripcion: 'Motivo de la nota' },
    { nombre: 'nota.subtotal', descripcion: 'Subtotal acreditado sin IVA' },
    { nombre: 'nota.iva', descripcion: 'IVA acreditado' },
    { nombre: 'nota.monto', descripcion: 'Total acreditado' },
    { nombre: 'nota.lineas', descripcion: 'Tabla de conceptos acreditados (concepto, cantidad, precio, total)' },
    { nombre: 'nota.anulada', descripcion: 'Sección: la nota se anuló (la SAT rechazó su NCRE o se anuló el DTE)' },
    { nombre: 'nota.motivo_anulacion', descripcion: 'Motivo de la anulación' },
    { nombre: 'nota.fel', descripcion: 'Sección: la NCRE está certificada (FEL)' },
    { nombre: 'nota.fel_uuid', descripcion: 'Número de autorización de la NCRE' },
    { nombre: 'nota.fel_serie', descripcion: 'Serie de la NCRE' },
    { nombre: 'nota.fel_numero', descripcion: 'Número de la NCRE' },
    { nombre: 'nota.fel_fecha', descripcion: 'Fecha y hora de certificación (Guatemala)' },
    { nombre: 'nota.fel_anulado', descripcion: 'Sección: la NCRE fue anulada ante la SAT' },
    { nombre: 'factura.documento', descripcion: 'Documento acreditado: "Factura", "Nota de débito" o "Aviso de cobro"' },
    { nombre: 'factura.numero', descripcion: 'Serie-número FEL o número del documento acreditado' },
    { nombre: 'factura.periodo', descripcion: 'Mes facturado: "junio 2026"' },
    { nombre: 'factura.emitida', descripcion: 'Fecha de emisión del documento acreditado' },
    { nombre: 'factura.total', descripcion: 'Total del documento acreditado' },
    { nombre: 'factura.fel_uuid', descripcion: 'Autorización FEL del documento acreditado' },
    { nombre: 'lineas', descripcion: 'Lista para {{#lineas}}: concepto, cantidad, precio_unitario, iva, total' },
    { nombre: 'generado', descripcion: 'Fecha y hora de generación (Guatemala)' },
]

/** Plantilla de fábrica de la nota de crédito (NCRE), capturada de la API. */
const HTML_FABRICA_NOTA = `{{#empresa.logo}}<img src="empresa:logo" height="48">{{/empresa.logo}}
<table class="sin-borde">
    <tr>
        <td width="58%">
            <h1>{{empresa.nombre}}</h1>
            <p class="tenue">
                {{#empresa.razon_social}}{{empresa.razon_social}}<br>{{/empresa.razon_social}}
                {{#empresa.nit}}NIT {{empresa.nit}}<br>{{/empresa.nit}}
                {{#empresa.direccion}}{{empresa.direccion}}<br>{{/empresa.direccion}}
                {{#empresa.telefono}}Tel. {{empresa.telefono}}{{/empresa.telefono}}
                {{#empresa.correo}} · {{empresa.correo}}{{/empresa.correo}}
            </p>
        </td>
        <td width="42%" class="derecha">
            <h2>{{nota.documento}}</h2>
            <p>
                No. <strong>{{nota.numero}}</strong><br>
                Fecha: {{nota.fecha}}
            </p>
        </td>
    </tr>
</table>
{{#nota.anulada}}<h2 class="centro">ANULADA</h2>{{/nota.anulada}}
<hr>
<table class="sin-borde">
    <tr>
        <td width="58%">
            <p class="tenue">Cliente</p>
            <p><strong>{{cliente.nombre}}</strong><br>NIT {{cliente.nit}}{{#cliente.direccion}}<br>{{cliente.direccion}}{{/cliente.direccion}}</p>
        </td>
        <td width="42%" class="derecha">
            <p class="tenue">Documento que se acredita</p>
            <p><strong>{{factura.documento}} {{factura.numero}}</strong><br>Emitido: {{factura.emitida}}{{#factura.fel_uuid}}<br><small>Autorización {{factura.fel_uuid}}</small>{{/factura.fel_uuid}}</p>
        </td>
    </tr>
</table>
<p><strong>Motivo:</strong> {{nota.motivo}}</p>
{{nota.lineas}}
<table class="sin-borde">
    <tr><td width="70%" class="derecha">Subtotal</td><td width="30%" class="derecha">{{nota.subtotal}}</td></tr>
    <tr><td class="derecha">IVA (12%)</td><td class="derecha">{{nota.iva}}</td></tr>
    <tr><td class="derecha grande"><strong>Total acreditado</strong></td><td class="derecha grande"><strong>{{nota.monto}}</strong></td></tr>
</table>
{{#nota.fel}}
<p class="tenue"><small>Documento Tributario Electrónico (FEL) · Nota de crédito · Serie {{nota.fel_serie}} · Número {{nota.fel_numero}}<br>Autorización {{nota.fel_uuid}}{{#nota.fel_fecha}}<br>Certificado el {{nota.fel_fecha}}{{/nota.fel_fecha}}</small></p>
{{/nota.fel}}
{{^nota.fel}}
<p class="tenue"><small>Esta nota de crédito no es un documento tributario electrónico (FEL).</small></p>
{{/nota.fel}}
{{#nota.anulada}}<p><strong>{{nota.motivo_anulacion}}</strong></p>{{/nota.anulada}}
<p class="tenue centro"><small>Generado el {{generado}}</small></p>
`

/** `GET /documentos/plantillas/:tipo/fabrica`: la plantilla de esta versión, con el bloque FEL. */
export const plantillasFabrica: Record<Schema<'PlantillaDocumento'>['tipo'], Schema<'PlantillaDocumentoFabrica'>> = {
    aviso_cobro: { tipo: 'aviso_cobro', html: HTML_FABRICA, variables: variablesAvisoCobro },
    nota_credito: { tipo: 'nota_credito', html: HTML_FABRICA_NOTA, variables: variablesNotaCredito },
}

export const plantillaNotaCredito: Schema<'PlantillaDocumento'> = {
    tipo: 'nota_credito',
    html: HTML_FABRICA_NOTA,
    version: 0,
    variables: variablesNotaCredito,
}

export const plantillaAvisoCobro: Schema<'PlantillaDocumento'> = {
    tipo: 'aviso_cobro',
    html: HTML_FABRICA,
    version: 0,
    variables: variablesAvisoCobro,
}

/** PDF mínimo válido (una página en blanco con un título) para las descargas en modo fixtures. */
export function pdfFixture(titulo: string): Uint8Array {
    const texto = titulo.replace(/[()\\]/g, '')
    const contenido = `BT /F1 18 Tf 72 720 Td (${texto}) Tj ET`
    const objetos = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
        `<< /Length ${contenido.length} >>\nstream\n${contenido}\nendstream`,
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ]
    let pdf = '%PDF-1.4\n'
    const posiciones: number[] = []
    objetos.forEach((objeto, indice) => {
        posiciones.push(pdf.length)
        pdf += `${indice + 1} 0 obj\n${objeto}\nendobj\n`
    })
    const xref = pdf.length
    pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n${posiciones.map(p => `${String(p).padStart(10, '0')} 00000 n \n`).join('')}`
    pdf += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
    return new TextEncoder().encode(pdf)
}
