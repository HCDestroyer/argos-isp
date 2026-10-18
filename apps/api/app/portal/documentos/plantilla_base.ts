/**
 * Plantilla HTML por defecto del aviso de cobro (`tipo = aviso_cobro`). Se usa mientras nadie la
 * edite desde el panel (y el seeder la deja como primera versión en `core.plantillas_documentos`).
 * Variables y subconjunto de HTML: `app/portal/README.md`.
 */
export const PLANTILLA_AVISO_COBRO = `{{#empresa.logo}}<img src="empresa:logo" height="48">{{/empresa.logo}}
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
            <h2>{{factura.documento}}</h2>
            <p>
                No. <strong>{{factura.numero}}</strong><br>
                Emitido: {{factura.emitida}}<br>
                <strong>Vence: {{factura.vence}}</strong>
            </p>
        </td>
    </tr>
</table>
<hr>
<table class="sin-borde">
    <tr>
        <td width="58%">
            <p class="tenue">Cliente</p>
            <p><strong>{{cliente.nombre}}</strong><br>NIT {{cliente.nit}}{{#cliente.direccion}}<br>{{cliente.direccion}}{{/cliente.direccion}}</p>
        </td>
        <td width="42%" class="derecha">
            <p class="tenue">Periodo</p>
            <p><strong>{{factura.periodo}}</strong>{{#servicio.plan}}<br>{{servicio.plan}}{{/servicio.plan}}</p>
        </td>
    </tr>
</table>
{{factura.lineas}}
<table class="sin-borde">
    <tr><td width="70%" class="derecha">Subtotal</td><td width="30%" class="derecha">{{factura.subtotal}}</td></tr>
    <tr><td class="derecha">IVA (12%)</td><td class="derecha">{{factura.iva}}</td></tr>
    <tr><td class="derecha"><strong>Total</strong></td><td class="derecha"><strong>{{factura.total}}</strong></td></tr>
    {{#factura.tiene_pagos}}<tr><td class="derecha">Pagado</td><td class="derecha">{{factura.pagado}}</td></tr>{{/factura.tiene_pagos}}
    <tr><td class="derecha grande"><strong>Saldo a pagar</strong></td><td class="derecha grande"><strong>{{factura.saldo}}</strong></td></tr>
</table>
{{#factura.fel}}
<p class="tenue"><small>Documento Tributario Electrónico (FEL) · {{factura.fel_tipo}} · Serie {{factura.fel_serie}} · Número {{factura.fel_numero}}<br>Autorización {{factura.fel_uuid}}{{#factura.fel_fecha}}<br>Certificado el {{factura.fel_fecha}}{{/factura.fel_fecha}}</small></p>
{{#factura.fel_anulado}}<p><strong>Documento anulado ante la SAT.</strong></p>{{/factura.fel_anulado}}
{{/factura.fel}}
{{^factura.fel}}
<p class="tenue"><small>Este aviso de cobro no es una factura electrónica (FEL).</small></p>
{{/factura.fel}}
{{#empresa.instrucciones_pago}}
<h3>Cómo pagar</h3>
<p>{{empresa.instrucciones_pago}}</p>
{{/empresa.instrucciones_pago}}
{{#empresa.horario}}<p class="tenue">Horario de atención: {{empresa.horario}}</p>{{/empresa.horario}}
<p class="tenue centro"><small>Generado el {{generado}}</small></p>
`
