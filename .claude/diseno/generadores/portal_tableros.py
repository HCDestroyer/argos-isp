# Genera los tableros del portal que no tenían diseño: soporte, contactos y «a cargo», facturas y pagos.
import os, sys
OUT = sys.argv[1]
I = {
 'casa':'<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>',
 'recibo':'<path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z"/>',
 'boya':'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="m5.6 5.6 3.6 3.6M14.8 14.8l3.6 3.6M18.4 5.6l-3.6 3.6M9.2 14.8l-3.6 3.6"/>',
 'gema':'<path d="M6 3h12l4 6-10 13L2 9z"/>',
 'user':'<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
 'mas':'<path d="M12 5v14M5 12h14"/>',
 'reloj':'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
 'ok':'<path d="m5 12 5 5L20 7"/>',
 'chev':'<path d="m9 6 6 6-6 6"/>',
 'atras':'<path d="M19 12H5M12 19l-7-7 7-7"/>',
 'enviar':'<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
 'clip':'<path d="m21 12-9 9a5 5 0 0 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8-8"/>',
 'tarjeta':'<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
 'banco':'<path d="M3 21h18M5 21V10M19 21V10M9 21V10M15 21V10M2 10l10-6 10 6"/>',
 'subir':'<path d="M12 3v12M7 8l5-5 5 5M5 21h14"/>',
 'cal':'<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4M16 3v4M4 11h16"/>',
 'usuarios':'<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 8M22 21a7 7 0 0 0-4-6.3"/>',
 'agregar':'<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M19 8v6M16 11h6"/>',
 'check':'<path d="m5 12 5 5L20 7"/>',
 'pdf':'<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5M9 15h6"/>',
 'alerta':'<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>',
 'quitar':'<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M16 11h6"/>',
 'tel':'<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
 'sol':'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
}
def ic(n, s=18, w=2):
    return f'<svg width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="{w}" aria-hidden="true">{I[n]}</svg>'

HEAD = '''<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>{title}</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&amp;display=swap" rel="stylesheet">
<style>
body{{margin:0;font-family:Inter,system-ui,sans-serif;color:#0F172A;background:#E9ECF5}}
a{{color:#4338CA}}a:hover{{color:#3730A3}}
.ph{{width:390px;height:844px;border-radius:36px;background:#F7F8FC;border:8px solid #0F172A;box-sizing:border-box;overflow:hidden;display:flex;flex-direction:column;flex:0 0 auto;position:relative}}
.card{{background:#fff;border:1px solid #E6E8F0;border-radius:14px;box-shadow:0 10px 28px -18px rgba(30,27,75,.22)}}
.btn{{display:flex;align-items:center;justify-content:center;gap:8px;border-radius:999px;padding:13px 18px;font-weight:600;font-size:15px;border:0;cursor:pointer;font-family:inherit;text-decoration:none}}
.p{{background:#4F46E5;color:#fff}}.o{{background:#fff;color:#334155;border:1px solid #E2E8F0}}
.row{{display:flex;align-items:center;gap:12px;padding:12px 0;border-top:1px solid #F1F5F9;font-size:14px}}
.ico{{width:38px;height:38px;border-radius:12px;display:flex;align-items:center;justify-content:center;flex:0 0 auto}}
.badge{{display:inline-flex;align-items:center;gap:4px;border-radius:999px;padding:2px 9px;font-size:12px;font-weight:600}}
.seg{{display:flex;background:#F1F3F9;border:1px solid #E6E8F0;border-radius:999px;padding:4px;gap:4px}}
.seg span{{flex:1;display:flex;align-items:center;justify-content:center;gap:6px;padding:8px 0;border-radius:999px;font-size:14px;font-weight:500;color:#475569}}
.seg .on{{background:#fff;color:#0F172A;box-shadow:0 1px 3px rgba(15,23,42,.12)}}
.tab{{display:flex;flex-direction:column;align-items:center;gap:2px;font-size:11px;font-weight:600;color:#64748B;text-decoration:none;cursor:pointer}}
.top{{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;background:rgba(255,255,255,.9);border-bottom:1px solid #E6E8F0}}
.campo{{display:flex;flex-direction:column;gap:6px;font-size:14px;font-weight:500}}
.in{{border:1px solid #E2E8F0;border-radius:10px;padding:11px 12px;font-weight:400;color:#94A3B8;background:#fff}}
.barra{{position:absolute;left:0;right:0;bottom:0;padding:12px 16px 16px;background:rgba(255,255,255,.94);border-top:1px solid #E6E8F0;box-shadow:0 -10px 24px -16px rgba(30,27,75,.25)}}
.num{{font-variant-numeric:tabular-nums}}
.cap{{font-weight:600;color:#334155}}
.nota{{font-size:12px;color:#64748B}}
</style>
</helmet>
<div style="width:1400px;height:980px;display:flex;gap:56px;align-items:center;justify-content:center;padding:40px;box-sizing:border-box">
'''
FOOT = '''
</div>
</x-dc>
</body>
</html>
'''
def tope():
    return f'<div class="top"><div style="display:flex;align-items:center;gap:10px"><div style="width:30px;height:30px;border-radius:9px;background:linear-gradient(135deg,#4F46E5,#06B6D4)"></div><b style="font-size:15px">Red Altiplano</b></div><span style="color:#475569">{ic("sol",20)}</span></div>'
def nav(activa):
    items=[('casa','Inicio'),('recibo','Facturas'),('boya','Soporte'),('gema','Puntos'),('user','Cuenta')]
    t=''.join(f'<a class="tab" href="#" style="{"color:#4F46E5" if n==activa else ""}">{ic(i,20)}{n}</a>' for i,n in items)
    return f'<nav aria-label="Secciones de mi cuenta" style="display:flex;justify-content:space-around;padding:10px 8px 14px;background:#fff;border-top:1px solid #E6E8F0;margin-top:auto">{t}</nav>'
def banner_compacto():
    return f'<div style="border-radius:18px;padding:14px 16px;background:linear-gradient(120deg,#4F46E5,#3730A3 50%,#0E7490);color:#fff"><div style="font-size:13px;opacity:.9">Hola, <b>Juan Pérez López</b></div><div style="display:flex;align-items:baseline;gap:8px"><span style="font-size:12px;opacity:.88">Total pendiente</span><span class="num" style="font-size:24px;font-weight:700">Q 550.00</span></div><div style="margin-top:8px;display:flex;gap:10px;font-size:12px;font-weight:600"><span class="badge" style="background:rgba(15,23,42,.28);box-shadow:inset 0 0 0 1px rgba(255,255,255,.35)">Suspendido</span><span style="opacity:.9">Actualizar</span></div></div>'
def tel(contenido, pie):
    return f'<div style="display:flex;flex-direction:column;gap:12px;align-items:center"><div class="ph">{contenido}</div><div class="cap">{pie}</div></div>'
def bdg(txt, bg, fg, i=None):
    return f'<span class="badge" style="background:{bg};color:{fg}">{ic(i,12,2.4) if i else ""}{txt}</span>'
def fila_ticket(asunto, meta, est, bg, fg, i):
    return f'<div class="row"><div class="ico" style="width:34px;height:34px;background:{bg};color:{fg}">{ic(i,16)}</div><div style="flex:1;min-width:0"><div style="font-weight:600">{asunto}</div><div class="nota">{meta}</div><div style="margin-top:4px">{bdg(est,bg,fg)}</div></div><span style="color:#94A3B8">{ic("chev",16)}</span></div>'

def escribir(nombre, titulo, cuerpo):
    with open(os.path.join(OUT, nombre), 'w') as f:
        f.write(HEAD.format(title=titulo) + cuerpo + FOOT)

# ---------- Soporte ----------
s1 = tope() + f'''<div style="padding:14px 16px;display:flex;flex-direction:column;gap:14px;flex:1;overflow:hidden">{banner_compacto()}
<section class="card" style="padding:16px;display:flex;flex-direction:column;gap:14px">
<div style="display:flex;align-items:center;gap:10px"><div class="ico" style="background:#FEF3C7;color:#B45309">{ic("boya")}</div><div><div style="font-weight:700;font-size:17px">Soporte</div><div class="nota" style="font-size:13px">Las respuestas llegan aquí y a tus avisos.</div></div></div>
<a href="#" class="btn p">{ic("mas")}Reportar un problema</a>
<div class="seg"><span class="on">{ic("boya",16)}Mis tickets</span><span>{ic("mas",16)}Solicitudes</span></div>
<div>{fila_ticket("Internet lento en la noche","TK-001042 · hace 3 h","En proceso","#FEF3C7","#92400E","reloj")}{fila_ticket("Cambio de contraseña del router","TK-000998 · 02/11/2026","Resuelto","#DCFCE7","#166534","ok")}</div>
</section></div>{nav("Soporte")}'''
s2 = tope() + f'''<div style="padding:14px 16px 96px;display:flex;flex-direction:column;gap:14px;flex:1;overflow:hidden">
<a href="#" style="display:flex;align-items:center;gap:6px;color:#475569;text-decoration:none;font-size:14px">{ic("atras",16)}Atrás</a>
<section class="card" style="padding:16px;display:flex;flex-direction:column;gap:14px">
<div><div style="font-weight:700;font-size:18px">Reportar un problema</div><div class="nota" style="font-size:13px">Cuéntanos qué pasa. Un técnico de soporte te responde aquí.</div></div>
<label class="campo">¿Qué pasa? <span class="in">Por ejemplo: sin internet desde la mañana</span></label>
<label class="campo">Cuéntanos más <span class="in" style="height:72px">Desde cuándo, qué luces ves en el módem…</span></label>
<label class="campo">Tipo de problema <span class="in">Elige uno (opcional)</span></label>
<div class="campo">Fotos o PDF (opcional)<a href="#" class="btn o" style="align-self:flex-start;padding:9px 14px;font-size:14px">{ic("clip",16)}Adjuntar foto o PDF</a><span class="nota">Hasta 3 archivos de 10 MB.</span></div>
</section></div>
<div class="barra"><a href="#" class="btn p">{ic("enviar")}Enviar reporte</a></div>'''
s3 = tope() + f'''<div style="padding:14px 16px 0;display:flex;flex-direction:column;gap:14px;flex:1;overflow:hidden">
<a href="#" style="display:flex;align-items:center;gap:6px;color:#475569;text-decoration:none;font-size:14px">{ic("atras",16)}Soporte</a>
<section class="card" style="padding:16px;display:flex;flex-direction:column;gap:10px">
<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px"><div><div style="font-weight:700;font-size:17px">Internet lento en la noche</div><div class="nota">TK-001042 · Hogar 20 Mbps</div></div>{bdg("En proceso","#FEF3C7","#92400E")}</div>
<div style="display:flex;flex-direction:column;gap:10px;margin-top:6px">
<div style="align-self:flex-end;max-width:80%;background:#EEF2FF;border-radius:14px 14px 4px 14px;padding:10px 12px;font-size:14px">Desde ayer en la noche va muy lento.<div class="nota" style="margin-top:4px;text-align:right">Tú · 20:14</div></div>
<div style="align-self:flex-start;max-width:80%;background:#F1F3F9;border-radius:14px 14px 14px 4px;padding:10px 12px;font-size:14px">Revisamos tu señal, un técnico te llamará hoy.<div class="nota" style="margin-top:4px">Soporte · 08:02</div></div>
</div></section>
<section class="card" style="padding:14px;display:flex;flex-direction:column;gap:10px">
<label class="campo">Responder <span class="in" style="height:56px">Escribe tu mensaje</span></label>
<div style="display:flex;gap:8px"><a href="#" class="btn o" style="padding:9px 14px;font-size:14px">{ic("clip",16)}Adjuntar</a><a href="#" class="btn p" style="flex:1;padding:9px 14px;font-size:14px">{ic("enviar",16)}Enviar</a></div>
</section></div>{nav("Soporte")}'''
escribir('PortalSoporte.dc.html','Portal · Soporte', tel(s1,'Soporte: tickets y solicitudes') + tel(s2,'Reportar un problema') + tel(s3,'Un ticket y su conversación'))

# ---------- Contactos y a cargo ----------
c1 = tope() + f'''<div style="padding:14px 16px;display:flex;flex-direction:column;gap:14px;flex:1;overflow:hidden">{banner_compacto()}
<section class="card" style="padding:16px">
<div style="display:flex;align-items:center;gap:10px"><div class="ico" style="background:#EEF2FF;color:#4F46E5">{ic("usuarios")}</div><div style="flex:1"><div style="font-weight:700">Mis contactos</div><div class="nota" style="font-size:13px">Personas que pueden ayudarte con tus servicios.</div></div><a href="#" class="btn o" style="padding:8px 12px;font-size:13px">{ic("agregar",16)}Agregar</a></div>
<div style="margin-top:8px">
<div class="row"><div class="ico" style="width:34px;height:34px;border-radius:999px;background:#F1F3F9;color:#475569;font-weight:700;font-size:13px">LP</div><div style="flex:1;min-width:0"><div style="font-weight:600">Luis Pérez <span style="font-weight:400;color:#64748B">· Inquilino</span></div><div class="nota">+502 5512-3344 · Consultar · Reportar fallas</div></div><span style="color:#94A3B8">{ic("chev",16)}</span></div>
<div class="row"><div class="ico" style="width:34px;height:34px;border-radius:999px;background:#F1F3F9;color:#475569;font-weight:700;font-size:13px">JG</div><div style="flex:1;min-width:0"><div style="font-weight:600">José García <span style="font-weight:400;color:#64748B">· Familiar</span></div><div class="nota">+502 4455-6677 · Consultar</div></div><span style="color:#94A3B8">{ic("chev",16)}</span></div>
</div></section>
<section class="card" style="padding:16px;display:flex;flex-direction:column;gap:8px"><div style="display:flex;align-items:center;gap:8px;font-weight:700">{ic("enviar",16)}Telegram</div><div class="nota" style="font-size:13px">Recibe tus avisos de cobro y pagos en Telegram.</div><a href="#" class="btn p" style="padding:10px">Vincular Telegram</a></section>
</div>{nav("Cuenta")}'''
c2 = tope() + f'''<div style="padding:14px 16px 96px;display:flex;flex-direction:column;gap:14px;flex:1;overflow:hidden">
<a href="#" style="display:flex;align-items:center;gap:6px;color:#475569;text-decoration:none;font-size:14px">{ic("atras",16)}Mi cuenta</a>
<section class="card" style="padding:16px;display:flex;flex-direction:column;gap:12px">
<div style="font-weight:700;font-size:18px">Luis Pérez</div>
<label class="campo">Nombre <span class="in" style="color:#0F172A">Luis Pérez</span></label>
<label class="campo">Relación <span class="in" style="color:#0F172A">Inquilino</span></label>
<label class="campo">Teléfono <span class="in" style="color:#0F172A">+502 5512-3344</span></label>
<div class="campo">Qué puede hacer
<div style="display:flex;flex-direction:column;gap:6px;font-weight:400">
<span style="display:flex;gap:8px;align-items:center"><span style="width:18px;height:18px;border-radius:5px;background:#4F46E5;color:#fff;display:flex;align-items:center;justify-content:center">{ic("check",12,3)}</span>Consultar el estado del servicio</span>
<span style="display:flex;gap:8px;align-items:center"><span style="width:18px;height:18px;border-radius:5px;background:#4F46E5;color:#fff;display:flex;align-items:center;justify-content:center">{ic("check",12,3)}</span>Reportar fallas</span>
<span style="display:flex;gap:8px;align-items:center"><span style="width:18px;height:18px;border-radius:5px;border:1.5px solid #CBD5E1"></span>Ver el saldo y pagar</span>
</div></div>
<a href="#" class="btn" style="color:#B91C1C;background:#fff;border:1px solid #FECACA;padding:10px">{ic("quitar",16)}Quitar contacto</a>
</section></div>
<div class="barra"><a href="#" class="btn p">{ic("check")}Guardar</a></div>'''
c3 = tope() + f'''<div style="padding:14px 16px;display:flex;flex-direction:column;gap:14px;flex:1;overflow:hidden">
<div style="border-radius:18px;padding:18px;background:linear-gradient(120deg,#4F46E5,#3730A3 50%,#0E7490);color:#fff"><div style="font-size:13px;opacity:.9">Hola, <b>Luis Pérez</b></div><div class="num" style="font-size:30px;font-weight:700">Q 0.00</div><div style="font-size:13px;opacity:.9">Estás al día</div></div>
<section class="card" style="padding:16px">
<div style="display:flex;align-items:center;gap:10px"><div class="ico" style="background:#DBEAFE;color:#1D4ED8">{ic("usuarios")}</div><div><div style="font-weight:700">Está a tu cargo</div><div class="nota">Servicios de otros titulares que te dejaron a cargo.</div></div></div>
<div style="border-top:1px solid #F1F5F9;margin-top:14px;padding-top:14px;display:flex;flex-direction:column;gap:10px">
<div style="display:flex;align-items:flex-start;gap:10px"><div class="ico" style="width:34px;height:34px;background:#CFFAFE;color:#0E7490">{ic("casa",16)}</div><div style="flex:1"><div style="font-weight:600">S-000412 · Casa de mamá</div><div class="nota">Red Altiplano</div></div>{bdg("Activo","#DCFCE7","#166534","ok")}</div>
<div style="display:flex;align-items:center;justify-content:space-between;gap:8px"><span style="font-size:14px"><span style="color:#64748B">Por pagar</span> <b class="num">Q 150.00</b></span><a href="#" class="btn o" style="padding:7px 12px;font-size:13px">{ic("boya",15)}Reportar una falla</a></div>
<div class="nota" style="font-weight:600;color:#475569">Tickets de este servicio</div>
{fila_ticket("Sin internet en casa de mamá","TK-002001 · hace 3 h","Esperamos tu respuesta","#FEF3C7","#92400E","alerta")}
<div class="nota">Para pagar, indica el código S-000412 en caja o en tu depósito.</div>
</div></section></div>{nav("Inicio")}'''
escribir('PortalContactos.dc.html','Portal · Contactos y a cargo', tel(c1,'Mi cuenta: «Mis contactos»') + tel(c2,'Un contacto: datos y permisos') + tel(c3,'Inicio: «Está a tu cargo»'))

# ---------- Facturas y pagos ----------
def fila_factura(t, meta, monto, est, bg, fg, i):
    return f'<div class="row"><div class="ico" style="width:34px;height:34px;background:{bg};color:{fg}">{ic(i,16)}</div><div style="flex:1;min-width:0"><div style="font-weight:600">{t}</div><div class="nota">{meta}</div><div style="margin-top:4px">{bdg(est,bg,fg)}</div></div><div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px"><b class="num">{monto}</b><span style="color:#64748B">{ic("pdf",16)}</span></div></div>'
f1 = tope() + f'''<div style="padding:14px 16px;display:flex;flex-direction:column;gap:14px;flex:1;overflow:hidden">{banner_compacto()}
<section class="card" style="padding:14px;display:flex;flex-direction:column;gap:12px">
<div style="display:flex;align-items:center;gap:10px"><div class="ico" style="background:#EEF2FF;color:#4F46E5">{ic("recibo")}</div><div style="font-weight:700;font-size:17px">Facturas y pagos</div></div>
<div class="seg"><span class="on">{ic("recibo",16)}Facturas</span><span>{ic("tarjeta",16)}Pagar</span></div>
<div>{fila_factura("Servicio de octubre 2026","Aviso de cobro 1203 · vence 10/10","Q 175.00","Vencida","#FEE2E2","#991B1B","recibo")}{fila_factura("Recargo por mora","Aviso de cobro 1160 · vence 25/09","Q 30.00","Abono parcial","#FEF3C7","#92400E","recibo")}{fila_factura("Servicio de julio 2026","Factura A1B2C3D4 · vence 10/07","Q 175.00","Pagada","#DCFCE7","#166534","ok")}</div>
</section></div>{nav("Facturas")}'''
f2 = tope() + f'''<div style="padding:14px 16px;display:flex;flex-direction:column;gap:14px;flex:1;overflow:hidden">{banner_compacto()}
<section class="card" style="padding:14px;display:flex;flex-direction:column;gap:12px">
<div style="display:flex;align-items:center;gap:10px"><div class="ico" style="background:#EEF2FF;color:#4F46E5">{ic("recibo")}</div><div style="font-weight:700;font-size:17px">Facturas y pagos</div></div>
<div class="seg"><span>{ic("recibo",16)}Facturas</span><span class="on">{ic("tarjeta",16)}Pagar</span></div>
<a href="#" class="btn p">{ic("tarjeta")}Pagar en línea</a>
<div class="nota" style="text-align:center;margin-top:-6px">Con tarjeta, en la página segura de nuestro proveedor de pagos.</div>
<a href="#" class="btn o">{ic("banco")}Ver datos de depósito</a>
<div style="display:flex;align-items:center;justify-content:space-between"><b style="font-size:14px">Comprobantes enviados</b><a href="#" class="btn o" style="padding:7px 12px;font-size:13px">{ic("subir",15)}Subir comprobante</a></div>
<div>{fila_ticket("Depósito · 14/10/2026","Banco Industrial · Ref. 845120377","En revisión","#FEF3C7","#92400E","reloj")}</div>
<b style="font-size:14px">Promesas de pago</b>
<div>{fila_ticket("Pagar Q 175.00","A más tardar el 13/07/2026","Cumplida","#DCFCE7","#166534","cal")}</div>
</section></div>{nav("Facturas")}'''
f3 = f'''<div style="padding:22px 18px 120px;display:flex;flex-direction:column;gap:14px;flex:1">
<div style="display:flex;align-items:center;gap:10px"><div style="width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,#4F46E5,#06B6D4)"></div><div style="font-weight:700">Red Altiplano</div></div>
<div class="card" style="padding:18px;display:flex;flex-direction:column;gap:12px">
<div style="display:flex;justify-content:space-between;align-items:center">{bdg("Suspendido","#FEE2E2","#991B1B","alerta")}<span class="nota" style="font-size:13px">Hola, Juan P.</span></div>
<h1 style="margin:0;font-size:22px;line-height:1.25">Tu servicio está suspendido</h1>
<div style="background:#F1F3F9;border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:10px"><div style="display:flex;justify-content:space-between;align-items:baseline"><span class="nota" style="font-size:13px">Monto pendiente</span><span class="num" style="font-size:26px;font-weight:700">Q 525.00</span></div><div style="border-top:1px solid #E6E8F0;padding-top:10px;display:flex;justify-content:space-between;font-size:13px"><span style="color:#B91C1C;font-weight:600">2 facturas vencidas</span><b class="num">Q 350.00</b></div></div>
<p style="margin:0;font-size:14px;color:#475569">Paga el saldo pendiente o solicita una promesa de pago para reactivarlo.</p>
</div>
<a href="#" class="btn o">{ic("subir")}Subir comprobante</a>
<a href="#" class="btn o">{ic("banco")}Ver datos de depósito</a>
<a href="#" class="btn o">{ic("cal")}Prometer pago</a>
<a href="#" class="btn o">{ic("tel")}Contactar soporte</a>
</div>
<div class="barra"><a href="#" class="btn p">{ic("tarjeta")}Pagar en línea</a><div class="nota" style="text-align:center;margin-top:6px">Con tarjeta, en la página segura de nuestro proveedor.</div></div>'''
escribir('PortalFacturas.dc.html','Portal · Facturas y pagos y corte', tel(f1,'Facturas y pagos: pestaña Facturas') + tel(f2,'Facturas y pagos: pestaña Pagar') + tel(f3,'Corte: la acción principal fija abajo'))
