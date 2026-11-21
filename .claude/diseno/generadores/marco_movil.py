"""Genera el tablero `MarcoMovil.dc.html`: marco del panel en el teléfono (isla de navegación abajo,
acción fija encima y menú «Más» a pantalla completa). Escribe en la carpeta del artifact."""
import os, sys

DESTINO = sys.argv[1] if len(sys.argv) > 1 else 'MarcoMovil.dc.html'

def svg(d, t=20):
    return (f'<svg width="{t}" height="{t}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
            f'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{d}</svg>')

I = {
    'casa': '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    'clientes': '<circle cx="9" cy="8" r="3.5"/><path d="M3 20a6 6 0 0 1 12 0M16 4.5a3.5 3.5 0 0 1 0 7M21 20a6 6 0 0 0-4-5.6"/>',
    'cobrar': '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
    'campana': '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
    'mas': '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    'caja': '<path d="M4 7h16v13H4z"/><path d="M4 7l2-4h12l2 4M9 12h6"/>',
    'pulso': '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    'buscar': '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    'x': '<path d="M18 6 6 18M6 6l12 12"/>',
    'promesa': '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4m-7 9 2 2 4-4"/>',
    'chev': '<path d="m9 18 6-6-6-6"/>',
    'dia': '<path d="M12 3v2M12 19v2M5 12H3M21 12h-2M6.3 6.3 4.9 4.9M19.1 19.1l-1.4-1.4M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4"/><circle cx="12" cy="12" r="4"/>',
    'factura': '<path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
    'red': '<path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01"/>',
    'inv': '<path d="m21 8-9-5-9 5 9 5z"/><path d="M3 8v8l9 5 9-5V8M12 13v8"/>',
    'finanzas': '<path d="M3 21h18M5 21V10M19 21V10M9 21v-6M15 21v-6M2 10l10-7 10 7z"/>',
    'ajustes': '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    'sliders': '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
}

LOGO = ('<svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">'
        '<stop offset="0" stop-color="#4F46E5"/><stop offset="1" stop-color="#06B6D4"/></linearGradient></defs>'
        '<rect width="32" height="32" rx="8" fill="url(#lg)"/><path d="M8 17c4.4-4.6 11.6-4.6 16 0M11 20c2.8-2.6 7.2-2.6 10 0" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round"/>'
        '<circle cx="16" cy="22.5" r="1.6" fill="#fff"/></svg>')

def encabezado(cerrar=False):
    derecha = (f'<button class="ci f" aria-label="Cerrar el menú" onClick="{{{{cerrar}}}}">{svg(I["x"], 18)}</button>' if cerrar else
               f'<span class="ci f" title="Caja abierta">{svg(I["caja"], 18)}<i class="pt" style="background:#16A34A"></i></span>'
               f'<span class="ci f" title="Sistema: un aviso">{svg(I["pulso"], 18)}<i class="pt" style="background:#D97706"></i></span>'
               '<span class="ci cu">AA</span>')
    return (f'<div style="display:flex;align-items:center;gap:10px;padding:16px 16px 8px">{LOGO}'
            '<b style="font-size:17px;letter-spacing:-.02em;flex:1">Argos<span class="pri">Isp</span></b>'
            f'{derecha}</div>')

def cliente(ini, nombre, codigo, fondo, tinta, saldo=None):
    s = f'<b class="num" style="font-size:14px">{saldo}</b>' if saldo else '<span class="b ok">Al día</span>'
    return (f'<div class="fila"><span class="av" style="background:{fondo};color:{tinta}">{ini}</span>'
            f'<div style="min-width:0;flex:1"><b style="font-size:14px;display:block">{nombre}</b><span class="mu" style="font-size:12px">{codigo}</span></div>{s}</div>')

INICIO = f'''<div style="display:{{{{v.inicio}}}};flex-direction:column;gap:12px">
<section style="border-radius:18px;padding:18px;color:#fff;background:linear-gradient(135deg,#4F46E5,#4338CA 55%,#0E7490)">
<b style="font-size:20px;display:block">Buenas tardes, Ana</b><span style="font-size:13px;opacity:.9">Hay 4 comprobantes por revisar.</span>
<div style="display:flex;gap:8px;margin-top:12px"><span class="btn" style="background:#fff;color:#4338CA">{svg(I["cobrar"],16)}Cobrar</span><span class="btn" style="border-color:rgba(255,255,255,.6);color:#fff">Revisar comprobantes</span></div></section>
<section class="card" style="padding:14px"><div class="mu" style="font-size:12px">Facturado del mes</div><b class="num" style="font-size:24px">Q 98,450.00</b><div class="mu" style="font-size:12px;margin-top:4px">Cobrado 62 % · octubre 2026</div></section>
<section class="card" style="padding:14px"><div class="mu" style="font-size:12px">Cobros de hoy</div><b class="num" style="font-size:24px">Q 4,380.00</b><div class="mu" style="font-size:12px;margin-top:4px">19 pagos</div></section>
<section class="card" style="padding:14px"><div class="mu" style="font-size:12px">Cartera vencida</div><b class="num" style="font-size:24px">Q 15,840.50</b><div class="mu" style="font-size:12px;margin-top:4px">la lista termina encima de la isla</div></section>
</div>'''

CLIENTES = f'''<div style="display:{{{{v.clientes}}}};flex-direction:column;gap:12px">
<h1 style="margin:4px 0 0;font-size:24px;letter-spacing:-.02em">Clientes</h1>
<label class="campo">{svg(I["buscar"],16)}<input aria-label="Buscar clientes" placeholder="Nombre, NIT, teléfono, user PPP o IP"></label>
<section class="card" style="overflow:hidden">
{cliente("JC","Juan Carlos Ramírez","C-000002 · Suspendido","#FEE2E2","#991B1B","Q 300.00")}
{cliente("MA","Mario Alberto Cojtí","C-000016","#E0E7FF","#3730A3")}
{cliente("FS","Ferretería San José","C-000015 · Empresa","#FEF3C7","#92400E")}
{cliente("CM","Claudia Marisol Barrios","C-000014","#FCE7F3","#9D174D")}
{cliente("JM","José Manuel Tzul","C-000013","#DCFCE7","#166534")}
{cliente("AP","Andrea Paola Gómez","C-000012","#FFE4E6","#9F1239")}
</section></div>'''

FICHA = f'''<div style="display:{{{{v.ficha}}}};flex-direction:column;gap:12px">
<section class="card" style="padding:14px;display:flex;flex-direction:column;gap:12px">
<div style="display:flex;align-items:center;gap:10px"><span class="av" style="width:44px;height:44px;background:#FEE2E2;color:#991B1B">JC</span><div style="min-width:0;flex:1"><b style="font-size:16px;display:block">Juan Carlos Ramírez</b><span class="mu" style="font-size:12px">C-000002 · Norte</span></div><span class="b er">Suspendido</span></div>
<div style="display:grid;grid-template-columns:1.3fr 1fr 1fr;gap:6px"><div class="kpi"><div class="mu" style="font-size:11px">Saldo</div><b class="num">Q 300.00</b></div><div class="kpi"><div class="mu" style="font-size:11px">Próximo</div><b>5 dic</b></div><div class="kpi"><div class="mu" style="font-size:11px">Servicios</div><b>1</b></div></div></section>
<section class="card" style="padding:14px;display:flex;flex-direction:column;gap:8px"><div class="sec">Servicios</div>
<div class="fila" style="padding:8px 0">{svg(I["red"],18)}<div style="flex:1"><b style="font-size:14px">Internet hogar</b><div class="mu" style="font-size:12px">50 Mbps · 10.20.4.18</div></div><span class="b er">Suspendido</span></div></section>
<section class="card" style="padding:14px"><div class="sec">Actividad</div><div class="mu" style="font-size:13px">Corte automático · 8 nov</div></section>
</div>'''

def area(icono, nombre, secciones):
    links = ''.join(f'<a href="#" class="mlink">{s}</a>' for s in secciones)
    return (f'<div class="marea"><div class="mcab">{svg(I[icono],18)}<b style="flex:1">{nombre}</b>{svg(I["chev"],16)}</div>'
            f'<div style="display:flex;flex-direction:column">{links}</div></div>')

AREA_DIA = area('dia', 'Día a día', ['Clientes', 'Servicios', 'Cobrar', 'Caja', 'Promesas', 'Comprobantes <span class="cnt">4</span>'])

MAS = f'''<div class="pantalla-mas" style="display:{{{{v.mas}}}}">
{encabezado(cerrar=True)}
<div style="padding:4px 16px 12px;display:flex;flex-direction:column;gap:10px">
<label class="campo f">{svg(I["buscar"],16)}<input aria-label="Buscar una sección" placeholder="Buscar una sección…"><span class="mu" style="font-size:11px">Ctrl K</span></label>
<span class="btn o" style="align-self:flex-start;padding:7px 12px;font-size:12px">{svg(I["sliders"],14)}Personalizar mis accesos</span></div>
<nav aria-label="Menú principal" style="flex:1;overflow:auto;padding:0 12px 24px;display:flex;flex-direction:column;gap:4px">
<a href="#" class="mcab on">{svg(I["casa"],18)}<b>Inicio</b></a>
{AREA_DIA}
<div class="mcab">{svg(I["factura"],18)}<b style="flex:1">Facturas</b>{svg(I["chev"],16)}</div>
<div class="mcab">{svg(I["red"],18)}<b style="flex:1">Red</b>{svg(I["chev"],16)}</div>
<div class="mcab">{svg(I["inv"],18)}<b style="flex:1">Inventario</b>{svg(I["chev"],16)}</div>
<div class="mcab">{svg(I["finanzas"],18)}<b style="flex:1">Finanzas</b>{svg(I["chev"],16)}</div>
<div class="mcab" style="margin-top:8px;border-top:1px solid var(--borde);padding-top:14px">{svg(I["ajustes"],18)}<b style="flex:1">Ajustes</b>{svg(I["chev"],16)}</div>
</nav></div>'''

def destino(clave, icono, texto, extra=''):
    return (f'<button class="dest {{{{c.{clave}}}}}" aria-label="{texto}" onClick="{{{{ir.{clave}}}}}">'
            f'<span style="position:relative;display:inline-flex">{svg(I[icono],22)}{extra}</span><span>{texto}</span></button>')

ISLA = ('<nav class="isla" aria-label="Navegación del teléfono">'
        + destino('inicio', 'casa', 'Inicio')
        + destino('clientes', 'clientes', 'Clientes')
        + destino('cobrar', 'cobrar', 'Cobrar')
        + destino('avisos', 'campana', 'Avisos', '<i class="pa"></i>')
        + destino('mas', 'mas', 'Más')
        + '</nav>')

BARRA = (f'<div class="barra" style="display:{{{{v.barra}}}}"><span class="btn o" style="padding:11px 16px">{svg(I["promesa"],16)}Promesa</span>'
         f'<span class="btn v" style="flex:1;justify-content:center;padding:11px 16px;font-size:15px">{svg(I["cobrar"],17)}Cobrar Q 300.00</span></div>')

HTML = f'''<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Marco del panel en el teléfono</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&amp;display=swap" rel="stylesheet">
<style>
body{{margin:0;font-family:Inter,system-ui,sans-serif}}
a{{color:#4338CA}}a:hover{{color:#3730A3}}
.marco{{--fondo:#F4F6FB;--tarjeta:#fff;--borde:#E6E8F0;--texto:#0F172A;--mu:#64748B;--vidrio:rgba(255,255,255,.86);--activo-bg:#EEF2FF;--activo:#4338CA;--exito:#15803D;--exito-bg:#DCFCE7;--sombra:0 18px 40px -18px rgba(30,27,75,.28);
  width:100%;height:844px;position:relative;overflow:hidden;color:var(--texto);background:radial-gradient(1200px 500px at 20% -10%,#E0E7FF 0%,transparent 60%),radial-gradient(900px 400px at 100% 0%,#CFFAFE 0%,transparent 55%),var(--fondo)}}
.marco.osc{{--fondo:#0B0F1A;--tarjeta:#121828;--borde:#222A40;--texto:#E2E8F0;--mu:#94A3B8;--vidrio:rgba(15,20,36,.86);--activo-bg:rgba(129,140,248,.14);--activo:#A5B4FC;--exito:#86EFAC;--exito-bg:rgba(74,222,128,.16);--sombra:0 18px 40px -12px rgba(0,0,0,.6);
  background:radial-gradient(1200px 500px at 20% -10%,rgba(79,70,229,.22) 0%,transparent 60%),radial-gradient(900px 400px at 100% 0%,rgba(6,182,212,.12) 0%,transparent 55%),var(--fondo)}}
.pri{{color:#4F46E5}}.osc .pri{{color:#818CF8}}
.mu{{color:var(--mu)}}
.f{{background:var(--tarjeta);box-shadow:0 0 0 1px var(--borde),0 6px 18px -8px rgba(15,23,42,.16)}}
.ci{{position:relative;width:36px;height:36px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;color:var(--mu);border:0;cursor:pointer;font-family:inherit}}
.ci.cu{{background:#E0E7FF;color:#4338CA;font-size:12px;font-weight:700}}.osc .ci.cu{{background:rgba(129,140,248,.2);color:#C7D2FE}}
.pt{{position:absolute;top:6px;right:6px;width:8px;height:8px;border-radius:999px;border:2px solid var(--tarjeta)}}
.card{{background:var(--tarjeta);border:1px solid var(--borde);border-radius:16px}}
.btn{{display:inline-flex;align-items:center;gap:7px;border-radius:999px;padding:8px 14px;font-weight:600;font-size:13px;border:1px solid transparent;white-space:nowrap}}
.btn.v{{background:#16A34A;color:#fff}}.btn.o{{background:var(--tarjeta);color:var(--texto);border-color:var(--borde)}}
.b{{display:inline-flex;align-items:center;border-radius:999px;padding:3px 10px;font-size:12px;font-weight:600}}
.b.er{{background:#FEE2E2;color:#B91C1C}}.b.ok{{background:#DCFCE7;color:#166534}}
.osc .b.er{{background:rgba(248,113,113,.16);color:#FCA5A5}}.osc .b.ok{{background:rgba(74,222,128,.16);color:#86EFAC}}
.av{{width:38px;height:38px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;flex:0 0 auto}}
.fila{{display:flex;align-items:center;gap:10px;padding:11px 14px;border-top:1px solid var(--borde)}}.fila:first-child{{border-top:0}}
.kpi{{background:var(--fondo);border-radius:12px;padding:8px 10px}}.kpi b{{font-size:16px}}
.sec{{font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--mu)}}
.num{{font-variant-numeric:tabular-nums}}
.campo{{display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:12px;background:var(--tarjeta);border:1px solid var(--borde);color:var(--mu)}}
.campo input{{flex:1;border:0;outline:0;background:transparent;font:inherit;font-size:14px;color:var(--texto)}}
.isla{{position:absolute;left:12px;right:12px;bottom:12px;z-index:30;display:grid;grid-template-columns:repeat(5,1fr);gap:2px;padding:6px;border-radius:22px;background:var(--vidrio);backdrop-filter:blur(28px) saturate(150%);box-shadow:0 0 0 1px var(--borde),var(--sombra)}}
.dest{{min-height:56px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;border:0;border-radius:16px;background:transparent;color:var(--mu);font:600 11px/1 Inter,system-ui,sans-serif;cursor:pointer}}
.dest.on{{background:var(--activo-bg);color:var(--activo)}}
.dest.ex{{color:var(--exito)}}.dest.ex.on{{background:var(--exito-bg)}}
.pa{{position:absolute;top:-2px;right:-3px;width:8px;height:8px;border-radius:999px;background:#0891B2;border:2px solid var(--tarjeta)}}
.barra{{position:absolute;left:12px;right:12px;bottom:100px;z-index:25;gap:8px;padding:8px;border-radius:22px;background:var(--vidrio);backdrop-filter:blur(28px) saturate(150%);box-shadow:0 0 0 1px var(--borde),0 14px 32px -18px rgba(30,27,75,.3)}}
.pantalla-mas{{position:absolute;inset:0;z-index:40;flex-direction:column;background:var(--fondo)}}
.mcab{{display:flex;align-items:center;gap:12px;padding:11px 12px;border-radius:12px;font-size:14px;color:var(--texto);text-decoration:none}}
.mcab.on{{background:var(--activo-bg);color:var(--activo)}}
.mlink{{padding:7px 12px 7px 42px;font-size:13px;color:var(--mu);text-decoration:none;border-radius:9px;display:flex;align-items:center;gap:8px}}
.cnt{{font-size:11px;font-weight:700;border-radius:999px;padding:1px 7px;background:#4F46E5;color:#fff}}
.nota{{position:absolute;left:16px;right:16px;font-size:11px;color:var(--mu)}}
</style>
</helmet>
<div class="marco {{{{tema}}}}">
<div style="position:absolute;inset:0;display:flex;flex-direction:column">
{encabezado()}
<div style="flex:1;min-height:0;overflow:auto;padding:4px 12px {{{{v.reserva}}}};margin-bottom:92px">
{INICIO}
{CLIENTES}
{FICHA}
</div>
</div>
{BARRA}
{ISLA}
{MAS}
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{{"oscuro":{{"editor":"boolean","default":false}},"pantalla":{{"editor":"select","options":["inicio","clientes","ficha","mas"],"default":"inicio"}},"$preview":{{"width":390,"height":844}}}}'>
class Component extends DCLogic {{
renderVals() {{
const p = (this.state && this.state.p) || this.props.pantalla || 'inicio';
const v = {{ inicio: 'none', clientes: 'none', ficha: 'none', mas: 'none' }};
v[p === 'mas' ? 'mas' : p] = 'flex';
if (p === 'mas') {{ v.inicio = 'flex'; }}
v.barra = p === 'ficha' ? 'flex' : 'none';
v.reserva = p === 'ficha' ? '80px' : '16px';
const activo = p === 'ficha' ? 'clientes' : p;
const c = {{}};
['inicio', 'clientes', 'cobrar', 'avisos', 'mas'].forEach((k) => {{ c[k] = (k === activo ? 'on' : '') + (k === 'cobrar' ? ' ex' : ''); }});
const ir = {{
inicio: () => this.setState({{ p: 'inicio' }}),
clientes: () => this.setState({{ p: 'clientes' }}),
cobrar: () => this.setState({{ p: 'ficha' }}),
avisos: () => this.setState({{ p: 'clientes' }}),
mas: () => this.setState({{ p: 'mas' }}),
}};
return {{ v, c, ir, tema: this.props.oscuro ? 'osc' : '', cerrar: () => this.setState({{ p: 'inicio' }}) }};
}}
}}
</script>
</body>
</html>
'''

with open(DESTINO, 'w') as archivo:
    archivo.write(HTML)
print('escrito', DESTINO, len(HTML))
