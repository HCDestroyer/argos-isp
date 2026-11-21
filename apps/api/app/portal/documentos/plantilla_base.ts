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

/**
 * Plantilla HTML por defecto de la nota de crédito (`tipo = nota_credito`): la representación
 * gráfica de la NCRE (o de la nota interna mientras no se certifica), con la factura de origen.
 * Variables: `VARIABLES_NOTA_CREDITO` (`documentos/variables_nota.ts`).
 */
export const PLANTILLA_NOTA_CREDITO = `{{#empresa.logo}}<img src="empresa:logo" height="48">{{/empresa.logo}}
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

/*
 * Plantillas de rollo térmico de 80 mm (`formato = pos_80`). El tamaño lo pone el formato (80 mm de
 * ancho, márgenes de 3 mm y alto según el contenido), no el HTML. Texto negro, sin fondos ni colores
 * (la térmica no los imprime bien), una sola columna y tablas de dos columnas como mucho.
 */

/** Aviso de cobro (o factura FEL) en rollo de 80 mm. */
export const PLANTILLA_AVISO_COBRO_POS = `{{#empresa.logo}}<img src="empresa:logo" height="40" class="centro">{{/empresa.logo}}
<h2 class="centro">{{empresa.nombre}}</h2>
<p class="centro"><small>
{{#empresa.razon_social}}{{empresa.razon_social}}<br>{{/empresa.razon_social}}
{{#empresa.nit}}NIT {{empresa.nit}}<br>{{/empresa.nit}}
{{#empresa.direccion}}{{empresa.direccion}}<br>{{/empresa.direccion}}
{{#empresa.telefono}}Tel. {{empresa.telefono}}{{/empresa.telefono}}
</small></p>
<hr>
<h3 class="centro">{{factura.documento}}</h3>
<p class="centro">No. <strong>{{factura.numero}}</strong><br>Emitido: {{factura.emitida}}<br><strong>Vence: {{factura.vence}}</strong></p>
<hr>
<p>Cliente: <strong>{{cliente.nombre}}</strong><br>NIT {{cliente.nit}}<br>Periodo: {{factura.periodo}}{{#servicio.plan}}<br>Plan: {{servicio.plan}}{{/servicio.plan}}</p>
<table class="sin-borde">
{{#lineas}}<tr><td width="68%">{{concepto}}</td><td width="32%" class="derecha">{{total}}</td></tr>{{/lineas}}
</table>
<hr>
<table class="sin-borde">
    <tr><td width="60%">Subtotal</td><td width="40%" class="derecha">{{factura.subtotal}}</td></tr>
    <tr><td>IVA (12%)</td><td class="derecha">{{factura.iva}}</td></tr>
    <tr><td><strong>Total</strong></td><td class="derecha"><strong>{{factura.total}}</strong></td></tr>
    {{#factura.tiene_pagos}}<tr><td>Pagado</td><td class="derecha">{{factura.pagado}}</td></tr>{{/factura.tiene_pagos}}
    <tr><td class="grande"><strong>Saldo</strong></td><td class="derecha grande"><strong>{{factura.saldo}}</strong></td></tr>
</table>
<hr>
{{#factura.fel}}
<p><small>FEL · {{factura.fel_tipo}}<br>Serie {{factura.fel_serie}} · Número {{factura.fel_numero}}<br>Autorización {{factura.fel_uuid}}{{#factura.fel_fecha}}<br>Certificado el {{factura.fel_fecha}}{{/factura.fel_fecha}}</small></p>
{{#factura.fel_anulado}}<p><strong>Documento anulado ante la SAT.</strong></p>{{/factura.fel_anulado}}
{{/factura.fel}}
{{^factura.fel}}<p class="centro"><small>Este aviso de cobro no es una factura electrónica (FEL).</small></p>{{/factura.fel}}
{{#empresa.instrucciones_pago}}<p><small><strong>Cómo pagar:</strong> {{empresa.instrucciones_pago}}</small></p>{{/empresa.instrucciones_pago}}
<p class="centro"><small>Generado el {{generado}}</small></p>
`

/** Nota de crédito en rollo de 80 mm (no es obligatoria; queda para quien la quiera). */
export const PLANTILLA_NOTA_CREDITO_POS = `{{#empresa.logo}}<img src="empresa:logo" height="40" class="centro">{{/empresa.logo}}
<h2 class="centro">{{empresa.nombre}}</h2>
<p class="centro"><small>
{{#empresa.razon_social}}{{empresa.razon_social}}<br>{{/empresa.razon_social}}
{{#empresa.nit}}NIT {{empresa.nit}}<br>{{/empresa.nit}}
{{#empresa.direccion}}{{empresa.direccion}}{{/empresa.direccion}}
</small></p>
<hr>
<h3 class="centro">{{nota.documento}}</h3>
<p class="centro">No. <strong>{{nota.numero}}</strong><br>Fecha: {{nota.fecha}}</p>
{{#nota.anulada}}<h2 class="centro">ANULADA</h2>{{/nota.anulada}}
<hr>
<p>Cliente: <strong>{{cliente.nombre}}</strong><br>NIT {{cliente.nit}}<br>Acredita: {{factura.documento}} {{factura.numero}}</p>
<p>Motivo: {{nota.motivo}}</p>
<table class="sin-borde">
    <tr><td width="60%">Subtotal</td><td width="40%" class="derecha">{{nota.subtotal}}</td></tr>
    <tr><td>IVA (12%)</td><td class="derecha">{{nota.iva}}</td></tr>
    <tr><td class="grande"><strong>Total</strong></td><td class="derecha grande"><strong>{{nota.monto}}</strong></td></tr>
</table>
<hr>
{{#nota.fel}}<p><small>FEL · Nota de crédito<br>Serie {{nota.fel_serie}} · Número {{nota.fel_numero}}<br>Autorización {{nota.fel_uuid}}</small></p>{{/nota.fel}}
{{^nota.fel}}<p class="centro"><small>No es un documento tributario electrónico (FEL).</small></p>{{/nota.fel}}
{{#nota.anulada}}<p><strong>{{nota.motivo_anulacion}}</strong></p>{{/nota.anulada}}
<p class="centro"><small>Generado el {{generado}}</small></p>
`

/**
 * Recibo de un cobro de caja (`tipo = recibo_cobro`, carta). Un cobro que pagó facturas de varias
 * empresas lleva una sección por empresa (`{{#secciones}}`), cada una con su marca y su pago.
 * Variables: `VARIABLES_RECIBO_COBRO` (`documentos/variables_recibo.ts`).
 */
export const PLANTILLA_RECIBO_COBRO = `{{#empresa.logo}}<img src="empresa:logo" height="48">{{/empresa.logo}}
<table class="sin-borde">
    <tr>
        <td width="58%">
            <h1>{{empresa.nombre}}</h1>
            <p class="tenue">
                {{#empresa.razon_social}}{{empresa.razon_social}}<br>{{/empresa.razon_social}}
                {{#empresa.nit}}NIT {{empresa.nit}}<br>{{/empresa.nit}}
                {{#empresa.direccion}}{{empresa.direccion}}<br>{{/empresa.direccion}}
                {{#empresa.telefono}}Tel. {{empresa.telefono}}{{/empresa.telefono}}
            </p>
        </td>
        <td width="42%" class="derecha">
            <h2>Recibo de cobro</h2>
            <p>No. <strong>{{cobro.numero}}</strong><br>{{cobro.fecha}}</p>
        </td>
    </tr>
</table>
<hr>
<p class="tenue">Recibimos de</p>
<p><strong>{{cliente.nombre}}</strong><br>NIT {{cliente.nit}}</p>
{{#secciones}}
<h3>{{empresa.nombre}}</h3>
<p class="tenue"><small>{{#empresa.razon_social}}{{empresa.razon_social}} · {{/empresa.razon_social}}{{#empresa.nit}}NIT {{empresa.nit}} · {{/empresa.nit}}Pago No. {{pago.numero}} · {{pago.metodo}}{{#pago.referencia}} · Ref. {{pago.referencia}}{{/pago.referencia}}</small></p>
<table>
<thead><tr><th width="60%">Documento</th><th width="20%">Periodo</th><th width="20%" class="derecha">Monto</th></tr></thead>
<tbody>
{{#aplicaciones}}<tr><td>{{documento}} {{numero}}</td><td>{{periodo}}</td><td class="derecha">{{monto}}</td></tr>{{/aplicaciones}}
{{#tiene_anticipo}}<tr><td colspan="2">Anticipo (saldo a favor)</td><td class="derecha">{{anticipo}}</td></tr>{{/tiene_anticipo}}
</tbody>
</table>
<table class="sin-borde">
    <tr><td width="70%" class="derecha">Subtotal {{empresa.nombre}}</td><td width="30%" class="derecha"><strong>{{pago.monto}}</strong></td></tr>
</table>
{{#pago.anulado}}<p><strong>PAGO ANULADO</strong></p>{{/pago.anulado}}
{{/secciones}}
<hr>
<table class="sin-borde">
    <tr><td width="70%" class="derecha grande"><strong>Total cobrado</strong></td><td width="30%" class="derecha grande"><strong>{{cobro.total}}</strong></td></tr>
</table>
<p>Forma de pago: {{cobro.metodo}}{{#cobro.cajero}}<br>Atendió: {{cobro.cajero}}{{/cobro.cajero}}</p>
<p class="tenue centro"><small>Este recibo no es una factura electrónica (FEL). Generado el {{generado}}</small></p>
`

/** Recibo de un cobro de caja en rollo de 80 mm (el ticket que se entrega en ventanilla). */
export const PLANTILLA_RECIBO_COBRO_POS = `{{#empresa.logo}}<img src="empresa:logo" height="40" class="centro">{{/empresa.logo}}
<h2 class="centro">{{empresa.nombre}}</h2>
<p class="centro"><small>
{{#empresa.razon_social}}{{empresa.razon_social}}<br>{{/empresa.razon_social}}
{{#empresa.nit}}NIT {{empresa.nit}}<br>{{/empresa.nit}}
{{#empresa.direccion}}{{empresa.direccion}}<br>{{/empresa.direccion}}
{{#empresa.telefono}}Tel. {{empresa.telefono}}{{/empresa.telefono}}
</small></p>
<hr>
<h3 class="centro">Recibo de cobro</h3>
<p class="centro">No. <strong>{{cobro.numero}}</strong><br>{{cobro.fecha}}</p>
<p>Cliente: <strong>{{cliente.nombre}}</strong><br>NIT {{cliente.nit}}</p>
{{#secciones}}
<hr>
{{#cobro.varias_empresas}}<p><strong>{{empresa.nombre}}</strong><br><small>{{#empresa.nit}}NIT {{empresa.nit}} · {{/empresa.nit}}Pago No. {{pago.numero}}</small></p>{{/cobro.varias_empresas}}
<table class="sin-borde">
{{#aplicaciones}}<tr><td width="66%">{{documento}} {{numero}}{{#periodo}}<br><small>{{periodo}}</small>{{/periodo}}</td><td width="34%" class="derecha">{{monto}}</td></tr>{{/aplicaciones}}
{{#tiene_anticipo}}<tr><td>Anticipo</td><td class="derecha">{{anticipo}}</td></tr>{{/tiene_anticipo}}
{{#cobro.varias_empresas}}<tr><td><strong>Subtotal</strong></td><td class="derecha"><strong>{{pago.monto}}</strong></td></tr>{{/cobro.varias_empresas}}
</table>
{{#pago.anulado}}<p class="centro"><strong>PAGO ANULADO</strong></p>{{/pago.anulado}}
{{/secciones}}
<hr>
<table class="sin-borde">
    <tr><td width="50%" class="grande"><strong>TOTAL</strong></td><td width="50%" class="derecha grande"><strong>{{cobro.total}}</strong></td></tr>
</table>
<p><small>Forma de pago: {{cobro.metodo}}{{#cobro.cajero}}<br>Atendió: {{cobro.cajero}}{{/cobro.cajero}}</small></p>
<hr>
<p class="centro"><small>Gracias por su pago.<br>Este recibo no es una factura electrónica (FEL).<br>{{generado}}</small></p>
`
