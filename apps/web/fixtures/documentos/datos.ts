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
    { nombre: 'factura.documento', descripcion: '"Aviso de cobro" o "Factura" si tiene FEL' },
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
    { nombre: 'factura.fel', descripcion: 'Sección: la factura está certificada (FEL, semana 5)' },
    { nombre: 'factura.fel_uuid', descripcion: 'Número de autorización FEL' },
    { nombre: 'factura.fel_serie', descripcion: 'Serie FEL' },
    { nombre: 'factura.fel_numero', descripcion: 'Número FEL' },
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
{{#empresa.instrucciones_pago}}<h3>Cómo pagar</h3><p>{{empresa.instrucciones_pago}}</p>{{/empresa.instrucciones_pago}}
<p class="tenue centro"><small>Generado el {{generado}}</small></p>
`

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
