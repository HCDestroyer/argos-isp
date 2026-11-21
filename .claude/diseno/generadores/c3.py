import json,os
os.chdir('/tmp/claude-0/-home-user/59389ade-3278-540a-8050-19c26767da8e/scratchpad/rediseno-artifact/project')
ic={
'home':'<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
'dia':'<circle cx="9" cy="8" r="3.5"/><path d="M3 20a6 6 0 0 1 12 0"/>',
'fac':'<path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z"/>',
'red':'<rect x="2" y="14" width="20" height="7" rx="2"/>',
'inv':'<path d="M21 8 12 3 3 8v8l9 5 9-5z"/>',
'fin':'<path d="M3 21h18M5 21V10l7-5 7 5v11"/>',
'rep':'<path d="M4 19V5M4 19h16M8 15v-4M12 15V8M16 15v-6"/>',
'aj':'<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
'bus':'<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
'cob':'<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>',
'cli':'<circle cx="9" cy="8" r="3.5"/><path d="M3 20a6 6 0 0 1 12 0M19 8v6M16 11h6"/>',
'mas':'<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
'caja':'<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/>',
'sis':'<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
'not':'<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/>',
'der':'<path d="m9 18 6-6-6-6"/>','ab':'<path d="m6 9 6 6 6-6"/>','izq':'<path d="m15 18-6-6 6-6"/>',
'wifi':'<path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01"/>',
'ok':'<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
'alerta':'<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
'pausa':'<circle cx="12" cy="12" r="9"/><path d="M10 9v6M14 9v6"/>',
'reloj':'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
'tel':'<path d="M5 4h4l2 5-3 2a11 11 0 0 0 5 5l2-3 5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 6a2 2 0 0 1 2-2"/>',
'mapa':'<path d="M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
'mail':'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
'imp':'<path d="M6 9V3h12v6M6 18H4v-7h16v7h-2M7 14h10v7H7z"/>',
'doc':'<path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4M9 13h6M9 17h6"/>',
'ticket':'<path d="M3 8a2 2 0 0 0 0 4v4h18v-4a2 2 0 0 1 0-4V4H3z"/>',
'mano':'<path d="M7 11V5a2 2 0 0 1 4 0v5M11 10V4a2 2 0 0 1 4 0v6M15 10V6a2 2 0 0 1 4 0v8a7 7 0 0 1-7 7h-1a7 7 0 0 1-6-3l-3-5a2 2 0 0 1 3-2l2 2"/>',
'mas1':'<path d="M12 5v14M5 12h14"/>',
'filtro':'<path d="M3 5h18l-7 8v6l-4-2v-4z"/>',
'ayuda':'<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4M12 17h.01"/>',
'hist':'<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
'copiar':'<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
'rayo':'<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
'cerrar':'<path d="M6 6l12 12M18 6 6 18"/>',
'editar':'<path d="M4 20h4L19 9l-4-4L4 16z"/>',
}
def s(k,n=18,c='currentColor'): return f'<svg width="{n}" height="{n}" viewBox="0 0 24 24" fill="none" stroke="{c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{ic[k]}</svg>'
CSS='''body{margin:0;font-family:Inter,system-ui,sans-serif;color:#0F172A}
a{color:#4338CA}a:hover{color:#3730A3}
.isla{background:#fff;border:1px solid #E6E8F0;box-shadow:0 10px 30px rgba(15,23,42,.08)}
.f{background:#fff;border:1px solid #E6E8F0;box-shadow:0 6px 18px rgba(15,23,42,.08)}
.rail{width:56px;display:flex;flex-direction:column;align-items:center;gap:3px;padding:8px 2px;border-radius:12px;color:#64748B;font-size:10px;font-weight:600;text-decoration:none;cursor:pointer}
.rail.on{background:#EEF2FF;color:#4338CA}
.ci{position:relative;width:42px;height:42px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;color:#475569;cursor:pointer;box-sizing:border-box}
.pt{position:absolute;top:9px;right:9px;width:8px;height:8px;border-radius:999px;border:2px solid #fff}
.pi{display:inline-flex;align-items:center;gap:7px;height:42px;padding:0 16px;border-radius:999px;font-size:13px;font-weight:600;text-decoration:none;cursor:pointer;box-sizing:border-box}
.card{background:#fff;border:1px solid #E6E8F0;border-radius:16px}
.btn{display:inline-flex;align-items:center;gap:7px;border-radius:999px;padding:9px 16px;font-weight:600;font-size:13px;border:1px solid transparent;cursor:pointer;font-family:inherit;white-space:nowrap}
.btn.p{background:#4F46E5;color:#fff;box-shadow:0 6px 16px rgba(79,70,229,.3)}
.btn.v{background:#16A34A;color:#fff}
.btn.o{background:#fff;color:#334155;border-color:#E2E8F0}
.btn.g{background:transparent;color:#475569}
.ib{width:32px;height:32px;border-radius:9px;border:0;background:transparent;color:#64748B;display:inline-flex;align-items:center;justify-content:center;cursor:pointer}
.ib:hover{background:#F1F5F9;color:#0F172A}
.av{width:38px;height:38px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;flex:0 0 auto}
.th{font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#64748B;text-align:left;padding:11px 16px;background:#F8FAFC}
.td{padding:12px 16px;border-top:1px solid #F1F5F9;font-size:14px;vertical-align:middle}
tr.fila{cursor:pointer}tr.fila:hover td{background:#FAFAFF}tr.sel td{background:#EEF2FF}
.b{display:inline-flex;align-items:center;gap:5px;border-radius:999px;padding:3px 10px;font-size:12px;font-weight:600;white-space:nowrap}
.b.ok{background:#DCFCE7;color:#166534}.b.wa{background:#FEF3C7;color:#92400E}.b.er{background:#FEE2E2;color:#B91C1C}.b.in{background:#EEF2FF;color:#3730A3}.b.ne{background:#F1F5F9;color:#475569}
.num{font-variant-numeric:tabular-nums}
.r{text-align:right}
.mono{font-family:ui-monospace,Menlo,monospace;font-size:13px}
.copy{cursor:copy;font-family:ui-monospace,Menlo,monospace;font-size:13px;background:#F1F5F9;border-radius:6px;padding:2px 6px}
.fc{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:999px;font-size:13px;font-weight:600;color:#475569;cursor:pointer;border:1px solid #E2E8F0;background:#fff}
.fc.on{background:#4F46E5;color:#fff;border-color:#4F46E5}
.fc .c{font-size:11px;border-radius:999px;padding:0 6px;background:#F1F5F9;color:#475569}
.fc.on .c{background:rgba(255,255,255,.25);color:#fff}
.kv{display:flex;justify-content:space-between;align-items:center;gap:10px;font-size:14px;padding:9px 0;border-top:1px solid #F1F5F9}
.kv>span:first-child{color:#64748B}
.mi{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;font-size:14px;color:#334155;cursor:pointer}
.mi:hover{background:#F1F5F9}
.mcap{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#94A3B8;padding:8px 10px 4px}
.tab{display:inline-flex;align-items:center;gap:7px;padding:9px 14px;border-radius:999px;font-size:13px;font-weight:600;color:#475569;cursor:pointer;border:0;background:transparent;font-family:inherit}
.tab:hover{background:#F1F5F9}
.tab.on{background:#EEF2FF;color:#3730A3}
.tab .c{font-size:11px;border-radius:999px;padding:0 6px;background:#F1F5F9}
.tab.on .c{background:#fff}
.kpi{background:#F8FAFC;border-radius:12px;padding:12px 14px}
.kpi .l{font-size:12px;color:#64748B;display:flex;align-items:center;gap:6px}
.kpi b{font-size:20px;display:block;margin-top:2px}
.sec{font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#64748B;margin:0 0 10px}
.dot{width:8px;height:8px;border-radius:999px;display:inline-block}
.tl{display:flex;gap:12px;padding:10px 0;border-top:1px solid #F1F5F9;font-size:14px}
.tl .ic{width:32px;height:32px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex:0 0 auto}'''
def rail(on):
    items=[('home','Inicio'),('dia','Día a día'),('fac','Facturas'),('red','Red'),('inv','Inventario'),('fin','Finanzas'),('rep','Reportes')]
    h=''.join(f'<a class="rail{" on" if k==on else ""}" href="#">{s(k,20)}{n}</a>' for k,n in items)
    return f'''<nav class="isla" aria-label="Menú principal compacto" style="position:absolute;left:16px;top:16px;bottom:16px;width:76px;border-radius:22px;padding:12px 10px;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;gap:6px;z-index:2">
    <div style="width:40px;height:40px;border-radius:13px;background:linear-gradient(135deg,#4F46E5,#06B6D4);margin-bottom:10px"></div><span title="Expandir menú" aria-label="Expandir menú" role="button" style="position:absolute;right:-14px;top:24px;width:28px;height:28px;border-radius:999px;background:#fff;border:1px solid #E2E8F0;box-shadow:0 4px 12px rgba(15,23,42,.12);display:flex;align-items:center;justify-content:center;cursor:pointer;color:#4338CA;z-index:3">{s('der',15)}</span>{h}
    <a class="rail" href="#" style="margin-top:auto">{s('aj',20)}Ajustes</a></nav>'''
HEADER=f'''<header style="position:absolute;left:108px;right:16px;top:16px;height:44px;display:flex;align-items:center;gap:10px;z-index:2">
    <span class="f pi" style="color:#94A3B8;font-weight:500;width:240px;cursor:text">{s('bus',16)}Buscar…<span style="margin-left:auto;font-size:11px">Ctrl K</span></span>
    <a class="f pi" href="#" style="color:#166534;background:#DCFCE7;border-color:#BBF7D0">{s('cob',16)}Cobrar</a>
    <a class="f pi" href="#" style="color:#334155">{s('cli',16)}Cliente</a>
    <span class="f ci" title="Más accesos">{s('mas')}</span>
    <span style="margin-left:auto"></span>
    <span class="f ci" title="Caja">{s('caja')}<span class="pt" style="background:#16A34A"></span></span>
    <span class="f ci" title="Sistema">{s('sis')}<span class="pt" style="background:#F59E0B"></span></span>
    <span class="f ci" title="Notificaciones">{s('not')}<span class="pt" style="background:#06B6D4"></span></span>
    <span class="f ci" title="Tu cuenta" style="background:#E0E7FF;color:#3730A3;font-weight:700;font-size:13px;border-color:#C7D2FE">AC</span></header>'''
BG='radial-gradient(1200px 500px at 20% -10%,#E0E7FF 0%,transparent 60%),radial-gradient(900px 400px at 100% 0%,#CFFAFE 0%,transparent 55%),#F4F6FB'
def page(title,body,h,logic='class Component extends DCLogic {\nrenderVals() { return {}; }\n}'):
    return f'''<!doctype html>
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
{CSS}
</style>
</helmet>
<div style="width:100%;height:{h}px;background:{BG};position:relative;overflow:hidden">
{body}
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{{"$preview":{{"width":1440,"height":{h}}}}}'>
{logic}
</script>
</body>
</html>
'''
# ---------- LISTA ----------
filas=[('MP','María Pérez','CLI-00231','#E0E7FF','#3730A3','1 servicio · 50 Mbps','Q 0.00','ok','ok','Al día',''),
('JL','José López','CLI-00412','#CFFAFE','#0E7490','2 servicios · 50 + 20 Mbps','Q 400.00','er','alerta','Suspendido','sel'),
('AR','Ana Ramírez','CLI-00518','#FCE7F3','#9D174D','1 servicio · 100 Mbps','Q 250.00','wa','reloj','Vence en 3 días',''),
('CG','Carlos Gómez','CLI-00602','#DCFCE7','#166534','1 servicio · 30 Mbps','Q 150.00','in','mano','Con promesa',''),
('LM','Lucía Morales','CLI-00655','#FEF3C7','#92400E','1 servicio · 50 Mbps','Q 0.00','ok','ok','Al día',''),
('RH','Roberto Hernández','CLI-00701','#E0E7FF','#3730A3','1 servicio · 20 Mbps','Q 0.00','ne','pausa','Instalación pendiente',''),
('SC','Sofía Castillo','CLI-00744','#CFFAFE','#0E7490','3 servicios · empresa','Q 1,200.00','wa','reloj','Vence hoy',''),
]
rows=''
for a,n,c,bg,fg,sv,sal,cl,ico,est,sel in filas:
    col='#B91C1C' if sal!='Q 0.00' and cl=='er' else '#0F172A'
    rows+=f'''<tr class="fila {sel}"><td class="td"><div style="display:flex;gap:12px;align-items:center"><div class="av" style="background:{bg};color:{fg}">{a}</div><div><div style="font-weight:600">{n}</div><div style="font-size:12px;color:#64748B">{c}</div></div></div></td>
<td class="td" style="color:#475569">5555-{sum(map(ord,n))*37%9000+1000}</td><td class="td" style="color:#475569">{['Norte','Centro','Sur'][len(n)%3]}</td><td class="td" style="color:#475569">{s('wifi',15,'#94A3B8')} {sv}</td><td class="td num r" style="font-weight:600;color:{col}">{sal}</td><td class="td"><span class="b {cl}">{s(ico,13)}{est}</span></td>
<td class="td r"><button class="ib" title="Cobrar" style="color:#166534">{s('cob',17)}</button><button class="ib" title="Más acciones">{s('mas',17)}</button></td></tr>'''
lista=f'''{rail('dia')}
{HEADER}
<main style="position:absolute;left:108px;right:16px;top:76px;bottom:16px">
  <div style="height:100%;display:flex;flex-direction:column;gap:14px;padding:8px 4px;box-sizing:border-box">
    <div style="display:flex;align-items:flex-end;gap:10px">
      <div><div style="font-size:13px;color:#64748B">Día a día › Clientes</div><h1 style="margin:2px 0 0;font-size:28px">Clientes</h1></div>
      <button class="ib" title="Ayuda: Clientes (manual)" style="cursor:help;margin-bottom:2px">{s('ayuda')}</button>
      <button class="btn p" style="margin-left:auto">{s('mas1',16)}Nuevo cliente</button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px">
      <div class="card" style="padding:14px 16px;display:flex;gap:12px;align-items:center"><span class="av" style="background:#DCFCE7;color:#166534">{s('ok')}</span><div><div style="font-size:12px;color:#64748B">Al día</div><b class="num" style="font-size:20px">1,102</b></div></div>
      <div class="card" style="padding:14px 16px;display:flex;gap:12px;align-items:center"><span class="av" style="background:#FEF3C7;color:#92400E">{s('reloj')}</span><div><div style="font-size:12px;color:#64748B">Por vencer</div><b class="num" style="font-size:20px">96</b></div></div>
      <div class="card" style="padding:14px 16px;display:flex;gap:12px;align-items:center"><span class="av" style="background:#FEE2E2;color:#B91C1C">{s('alerta')}</span><div><div style="font-size:12px;color:#64748B">Suspendidos</div><b class="num" style="font-size:20px">47</b></div></div>
      <div class="card" style="padding:14px 16px;display:flex;gap:12px;align-items:center"><span class="av" style="background:#EEF2FF;color:#3730A3">{s('mano')}</span><div><div style="font-size:12px;color:#64748B">Con promesa</div><b class="num" style="font-size:20px">39</b></div></div>
    </div>
    <section class="card" style="overflow:hidden;flex:1;display:flex;flex-direction:column">
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:12px 14px">
        <label style="display:flex;align-items:center;gap:8px;border:1px solid #E2E8F0;border-radius:999px;padding:8px 14px;width:280px;color:#94A3B8;font-size:13px;cursor:text">{s('bus',15)}Nombre, NIT, teléfono o IP</label>
        <span class="fc on">Todos<span class="c">1,284</span></span><span class="fc">Al día<span class="c">1,102</span></span><span class="fc">Por vencer<span class="c">96</span></span><span class="fc">Suspendidos<span class="c">47</span></span><span class="fc">{s('filtro',14)}Más filtros</span>
      </div>
      <table style="width:100%;border-collapse:collapse">
        <thead><tr><th class="th">Cliente</th><th class="th">Teléfono</th><th class="th">Zona</th><th class="th">Servicios</th><th class="th r">Saldo</th><th class="th">Estado</th><th class="th r">Acciones</th></tr></thead>
        <tbody>{rows}</tbody>
      </table>
      <div style="margin-top:auto;display:flex;align-items:center;gap:8px;padding:12px 16px;border-top:1px solid #F1F5F9;font-size:13px;color:#64748B">7 de 1,284 · clic en una fila para la vista rápida, doble clic para abrir la ficha<span style="margin-left:auto" class="btn o">Cargar más</span></div>
    </section>
  </div>
  <aside class="isla" aria-label="Vista rápida de José López" style="position:absolute;right:12px;top:96px;bottom:12px;width:340px;border-radius:22px;padding:20px;box-sizing:border-box;display:flex;flex-direction:column;gap:14px;box-shadow:0 24px 60px rgba(15,23,42,.22);z-index:4">
    <div style="display:flex;align-items:center"><span class="sec" style="margin:0">Vista rápida</span><button class="ib" title="Cerrar" style="margin-left:auto">{s('cerrar',16)}</button></div>
    <div style="display:flex;gap:12px;align-items:center"><div class="av" style="width:52px;height:52px;border-radius:16px;font-size:17px;background:#CFFAFE;color:#0E7490">JL</div><div><b style="font-size:17px">José López</b><div style="font-size:12px;color:#64748B">CLI-00412 · desde 2023</div></div></div>
    <span class="b er" style="align-self:flex-start">{s('alerta',13)}Suspendido por mora · 2 facturas vencidas</span>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><div class="kpi"><div class="l">Saldo</div><b class="num" style="color:#B91C1C">Q 400.00</b></div><div class="kpi"><div class="l">Servicios</div><b>2</b></div></div>
    <div><div class="kv"><span>{s('tel',14)} Teléfono</span><span>5555-8890</span></div><div class="kv"><span>{s('wifi',14)} Internet hogar</span><span class="copy">10.20.4.18</span></div><div class="kv"><span>{s('wifi',14)} Cámaras</span><span class="copy">10.20.4.77</span></div><div class="kv"><span>{s('mapa',14)} Zona</span><span>Norte · Caja 12</span></div></div>
    <div style="margin-top:auto;display:flex;flex-direction:column;gap:8px"><button class="btn v" style="justify-content:center">{s('cob',16)}Cobrar Q 400.00</button><div style="display:flex;gap:8px"><button class="btn o" style="flex:1;justify-content:center">{s('mano',15)}Promesa</button><button class="btn o" style="flex:1;justify-content:center">Abrir ficha {s('der',15)}</button></div></div>
  </aside>
  <div class="card" role="menu" style="position:absolute;left:560px;top:432px;z-index:5;width:240px;padding:6px;box-shadow:0 16px 40px rgba(15,23,42,.16)">
    <div class="mcap">Ver</div><div class="mi">{s('der',15)}Abrir ficha</div>
    <div class="mcap">Cobro</div><div class="mi">{s('cob',15)}Cobrar Q 400.00</div><div class="mi">{s('mano',15)}Promesa de pago</div>
    <div class="mcap">Servicio</div><div class="mi">{s('rayo',15)}Reactivar</div><div class="mi" style="color:#B91C1C">{s('cerrar',15)}Retirar…</div>
  </div>
</main>
<div style="position:absolute;left:124px;bottom:28px;max-width:420px;background:#0F172A;color:#E2E8F0;border-radius:14px;padding:12px 14px;font-size:13px;line-height:1.5;z-index:3"><b style="color:#fff">Clientes.</b> Contadores arriba que también filtran, estado con ícono y color, cobrar a un clic en cada fila, menú contextual (⋯ o clic derecho) y vista rápida que flota encima (no le quita espacio a la lista; se cierra con Esc o con la ✕).</div>'''
open('NuevoClientes.dc.html','w').write(page('Clientes',lista,900))

# ---------- FICHA ----------
CSS2='''
.tu{display:inline-flex;align-items:center;gap:8px;padding:14px 4px;margin-right:22px;font-size:14px;font-weight:600;color:#64748B;cursor:pointer;border:0;background:transparent;font-family:inherit;border-bottom:2px solid transparent;margin-bottom:-1px}
.tu:hover{color:#0F172A}
.tu.on{color:#4338CA;border-bottom-color:#4F46E5}
.tu .c,.ts .c,.tv .c{font-size:11px;font-weight:700;border-radius:999px;padding:1px 7px;background:#FEE2E2;color:#B91C1C}
.ts{display:inline-flex;align-items:center;gap:7px;padding:8px 14px;border-radius:10px;font-size:13px;font-weight:600;color:#64748B;cursor:pointer;border:0;background:transparent;font-family:inherit}
.ts.on{background:#fff;color:#4338CA;box-shadow:0 2px 8px rgba(15,23,42,.1)}
.tv{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:12px;font-size:14px;font-weight:600;color:#475569;cursor:pointer;border:0;background:transparent;font-family:inherit;width:100%;text-align:left;position:relative}
.tv:hover{background:#F8FAFC}
.tv.on{background:#EEF2FF;color:#4338CA}
.tv.on::before{content:"";position:absolute;left:-12px;top:8px;bottom:8px;width:3px;border-radius:3px;background:#4F46E5}
.tv .c{margin-left:auto}
.est{display:inline-flex;gap:2px;padding:3px;border-radius:999px;background:#fff;border:1px solid #E2E8F0}
.est button{border:0;background:transparent;font-family:inherit;font-size:12px;font-weight:600;color:#64748B;padding:5px 11px;border-radius:999px;cursor:pointer}
.est button.on{background:#0F172A;color:#fff}
.w{background:#fff;border:1px solid #E6E8F0;border-radius:14px;padding:14px;display:flex;gap:12px;align-items:center}
.w .i{width:42px;height:42px;border-radius:12px;display:flex;align-items:center;justify-content:center;flex:0 0 auto}
'''
tabs=[('resumen','Resumen','home',''),('servicios','Servicios','wifi',''),('contactos','Contactos','cli','3'),('facturas','Facturación','fac','2'),('pagos','Pagos','cob',''),('promesas','Promesas','mano',''),('soporte','Soporte','ticket','1'),('documentos','Documentos','doc',''),('bitacora','Bitácora','hist','')]
import urllib.parse
ICSS='.ti{width:16px;height:16px;flex:0 0 auto;background:currentColor;-webkit-mask:var(--m) center/contain no-repeat;mask:var(--m) center/contain no-repeat}'
for k,_,i,_ in tabs:
    svg=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{ic[i]}</svg>'
    ICSS+=f'.ti-{k}{{--m:url("data:image/svg+xml,{urllib.parse.quote(svg)}")}}'
CSS2+=ICSS
def barra(cls,tag='button'):
    return f'<sc-for list="{{{{tabs}}}}" as="t" hint-placeholder-count="8"><button class="{cls} {{{{t.clase}}}}" onClick="{{{{t.ir}}}}"><span class="ti ti-{{{{t.id}}}}" aria-hidden="true"></span>{{{{t.nombre}}}}<span class="c" style="display:{{{{t.vc}}}}">{{{{t.n}}}}</span></button></sc-for>'
def panel(k,html): return f'<div style="display:{{{{v.{k}}}}};flex-direction:column;gap:14px">{html}</div>'
def tabla(cab,filas):
    th=''.join(f'<th class="th{" r" if c.startswith(">") else ""}">{c.lstrip(">")}</th>' for c in cab)
    return f'<div style="border:1px solid #EEF0F5;border-radius:12px;overflow:hidden"><table style="width:100%;border-collapse:collapse"><thead><tr>{th}</tr></thead><tbody>{filas}</tbody></table></div>'
def widget(ico,bg,fg,lab,val,sub,col='#0F172A'):
    return f'<div class="w"><span class="i" style="background:{bg};color:{fg}">{s(ico,20)}</span><div><div style="font-size:12px;color:#64748B">{lab}</div><b class="num" style="font-size:19px;color:{col}">{val}</b><div style="font-size:11px;color:#94A3B8">{sub}</div></div></div>'

def per(av,bg,fg,n,sub,chips,acc=''):
    return f'<div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-top:1px solid #F1F5F9"><span class="av" style="background:{bg};color:{fg}">{av}</span><div style="min-width:0"><b style="font-size:14px">{n}</b><div style="font-size:12px;color:#64748B">{sub}</div></div><div style="margin-left:auto;display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end">{chips}</div>{acc}</div>'
PERM='<span class="b ne">Consulta</span><span class="b ne">Fallas</span><span class="b ne">Paga</span><span class="b ne">Avisos</span>'
contactos=f"""<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
<div style="border:1px solid #EEF0F5;border-radius:14px;padding:12px 16px"><div style="display:flex;align-items:center"><div class="sec" style="margin:0">A cargo de sus servicios</div><button class="btn o" style="margin-left:auto;padding:5px 10px">{s('mas1',13)}Agregar</button></div>
{per('JL','#CFFAFE','#0E7490','José López (titular)','5555-8890 · WhatsApp · 7788-1020','<span class="b in">Titular</span>')}
{per('LL','#FCE7F3','#9D174D','Luis López · hijo','4444-1234 · WhatsApp · Casa','PERM'.replace('PERM',PERM),'<button class="ib" title="Editar">'+s('editar',14)+'</button>')}
{per('MP','#E0E7FF','#3730A3','María Pérez · vecina (es cliente)','3322-1100 · Cámaras','<span class="b ne">Fallas</span><span class="b ne">Avisos</span>','<button class="ib" title="Editar">'+s('editar',14)+'</button>')}</div>
<div style="border:1px solid #EEF0F5;border-radius:14px;padding:12px 16px"><div class="sec" style="margin:0 0 4px">Él está a cargo de</div>
{per('AR','#FCE7F3','#9D174D','S-000518 · Ana Ramírez','Su mamá · puede consultar, reportar y pagar','<span class="b er">Vence en 3 días</span>','<button class="ib" title="Abrir">'+s('der',14)+'</button>')}
<div class="ay" style="margin-top:8px">Si José escribe por WhatsApp, el chat le ofrece sus servicios y los que tiene a cargo. Al cobrarle, también aparecen las cuentas de los servicios a su cargo.</div></div></div>"""

resumen=f'''<div style="display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:14px;background:#FEF2F2;border:1px solid #FECACA">
  <span class="i" style="width:38px;height:38px;border-radius:11px;background:#FEE2E2;color:#B91C1C;display:flex;align-items:center;justify-content:center">{s('alerta',19)}</span>
  <div><b style="color:#991B1B">Servicio suspendido por mora</b><div style="font-size:13px;color:#7F1D1D">2 facturas vencidas desde el 5 oct. Al cobrar o dar promesa se reactiva al instante.</div></div>
  <button class="btn v" style="margin-left:auto">{s('cob',15)}Cobrar Q 400.00</button><button class="btn o">{s('mano',15)}Promesa</button></div>
<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px">
  {widget('cob','#FEE2E2','#B91C1C','Saldo pendiente','Q 400.00','2 facturas','#B91C1C')}
  {widget('reloj','#FEF3C7','#92400E','Próximo vencimiento','5 dic','factura de diciembre')}
  {widget('ok','#DCFCE7','#166534','Pagado este año','Q 1,800.00','9 pagos a tiempo')}
  {widget('wifi','#EEF2FF','#4338CA','Consumo del mes','182 GB','↑ 12 % vs. octubre')}
</div>
<div style="display:grid;grid-template-columns:1.25fr 1fr;gap:14px">
  <div style="border:1px solid #EEF0F5;border-radius:14px;padding:14px 16px"><div style="display:flex;align-items:center"><div class="sec" style="margin:0">Servicios</div><a href="#" style="margin-left:auto;font-size:13px">Ver todos</a></div>
    <div style="display:flex;align-items:center;gap:10px;padding:12px 0;border-top:1px solid #F1F5F9;margin-top:10px"><span class="av" style="width:34px;height:34px;background:#EEF2FF;color:#4338CA">{s('wifi',16)}</span><div><b style="font-size:14px">Internet hogar</b><div style="font-size:12px;color:#64748B">50 Mbps · <span class="mono">10.20.4.18</span> · PPPoE</div></div><span class="b er" style="margin-left:auto">{s('alerta',13)}Suspendido</span></div>
    <div style="display:flex;align-items:center;gap:10px;padding:12px 0;border-top:1px solid #F1F5F9"><span class="av" style="width:34px;height:34px;background:#EEF2FF;color:#4338CA">{s('wifi',16)}</span><div><b style="font-size:14px">Cámaras</b><div style="font-size:12px;color:#64748B">20 Mbps · <span class="mono">10.20.4.77</span> · IP estática</div></div><span class="b er" style="margin-left:auto">{s('alerta',13)}Suspendido</span></div></div>
  <div style="border:1px solid #EEF0F5;border-radius:14px;padding:14px 16px"><div style="display:flex;align-items:center"><div class="sec" style="margin:0">Actividad reciente</div><a href="#" style="margin-left:auto;font-size:13px">Bitácora</a></div>
    <div class="tl" style="margin-top:10px"><span class="ic" style="background:#FEE2E2;color:#B91C1C">{s('alerta',15)}</span><div><b style="font-size:14px">Corte automático</b><div style="font-size:12px;color:#64748B">8 nov · sistema</div></div></div>
    <div class="tl"><span class="ic" style="background:#EEF2FF;color:#3730A3">{s('fac',15)}</span><div><b style="font-size:14px">Factura A-1940 · Q 200.00</b><div style="font-size:12px;color:#64748B">1 nov · emitida</div></div></div>
    <div class="tl"><span class="ic" style="background:#FEF3C7;color:#92400E">{s('mano',15)}</span><div><b style="font-size:14px">Promesa incumplida</b><div style="font-size:12px;color:#64748B">16 oct · portal</div></div></div></div>
</div>'''
srv=lambda nombre,plan,ip,extra,sesion: f'''<div style="border:1px solid #EEF0F5;border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:12px">
  <div style="display:flex;align-items:center;gap:10px"><span class="av" style="background:#EEF2FF;color:#4338CA">{s('wifi')}</span><div><b>{nombre}</b><div style="font-size:12px;color:#64748B">{plan}</div></div><span class="b er" style="margin-left:auto">{s('alerta',13)}Suspendido</span><button class="btn o" style="padding:6px 12px">{s('rayo',14)}Reactivar</button><button class="ib" title="Cambiar plan, suspender, desconectar sesión, equipo, retirar">{s('mas',16)}</button></div>
  <div style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;font-size:13px;background:#F8FAFC;border-radius:10px;padding:10px 12px">
    <div><div style="color:#64748B;font-size:12px">IP</div><span class="copy">{ip}</span></div><div><div style="color:#64748B;font-size:12px">Router</div>Router Norte</div><div><div style="color:#64748B;font-size:12px">Conexión</div>{extra}</div><div><div style="color:#64748B;font-size:12px">Sesión</div>{sesion}</div><div><div style="color:#64748B;font-size:12px">Equipo</div>ONU ZTE · OK</div>
  </div></div>'''
servicios=f'''<div style="display:flex;align-items:center;gap:8px"><span style="color:#64748B;font-size:13px">2 servicios · Q 400.00 al mes</span><button class="btn p" style="margin-left:auto">{s('mas1',15)}Agregar servicio</button></div>
{srv('Casa · S-000412','50 Mbps · Q 200.00/mes · desde mar 2023','10.20.4.18','PPPoE','<span style="color:#B91C1C">● sin sesión</span>')}
{srv('Cámaras · S-000977','20 Mbps · Q 200.00/mes · desde ene 2025','10.20.4.77','IP estática','<span style="color:#B91C1C">● bloqueada</span>')}'''
ff=''
for num,per,em,ve,tot,sal,cl,ico,est in [('A-1940','Noviembre 2026','1 nov','5 nov','Q 200.00','Q 200.00','er','alerta','Vencida'),('A-1882','Octubre 2026','1 oct','5 oct','Q 200.00','Q 200.00','er','alerta','Vencida'),('A-1820','Septiembre 2026','1 sep','5 sep','Q 200.00','Q 0.00','ok','ok','Pagada'),('A-1761','Agosto 2026','1 ago','5 ago','Q 200.00','Q 0.00','ok','ok','Pagada')]:
    ff+=f'<tr class="fila"><td class="td mono">{num}</td><td class="td">{per}</td><td class="td">{em}</td><td class="td">{ve}</td><td class="td num r">{tot}</td><td class="td num r" style="font-weight:600">{sal}</td><td class="td"><span class="b {cl}">{s(ico,13)}{est}</span></td><td class="td r"><button class="ib" title="Imprimir (carta o POS 80 mm)">{s("imp",16)}</button><button class="ib" title="Anular, nota de crédito, enviar">{s("mas",16)}</button></td></tr>'
facturas=f'''<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><span class="fc on">Todas</span><span class="fc">Pendientes<span class="c">2</span></span><span class="fc">Pagadas</span><span class="fc">Anuladas</span>
<div style="margin-left:auto;display:flex;gap:8px"><button class="btn o">{s('hist',15)}Facturas pasadas</button><button class="btn o">{s('mas1',15)}Cargo único</button><button class="btn v">{s('cob',15)}Cobrar Q 400.00</button></div></div>
{tabla(['Número','Periodo','Emitida','Vence','>Total','>Saldo','Estado','>'],ff)}'''
pp=''
for f,rec,met,mon,fa in [('4 sep 2026','R-0911','Efectivo · Caja 1','Q 200.00','A-1820'),('3 ago 2026','R-0850','Depósito Banrural','Q 200.00','A-1761'),('2 jul 2026','R-0797','Pago en línea','Q 200.00','A-1702')]:
    pp+=f'<tr class="fila"><td class="td">{f}</td><td class="td mono">{rec}</td><td class="td">{met}</td><td class="td mono">{fa}</td><td class="td num r" style="font-weight:600">{mon}</td><td class="td"><span class="b ok">{s("ok",13)}Aplicado</span></td><td class="td r"><button class="ib" title="Reimprimir recibo">{s("imp",16)}</button><button class="ib" title="Anular pago">{s("mas",16)}</button></td></tr>'
pagos=f'''<div style="display:flex;align-items:center"><span style="color:#64748B;font-size:13px">Pagos y comprobantes</span><button class="btn o" style="margin-left:auto">{s('doc',15)}Revisar comprobantes</button></div>{tabla(['Fecha','Recibo','Método','Factura','>Monto','Estado','>'],pp)}'''
pr=''
for f,ve,mon,cl,ico,est,can in [('12 oct 2026','15 oct','Q 200.00','wa','alerta','Incumplida','Portal'),('8 jul 2026','10 jul','Q 200.00','ok','ok','Cumplida','Panel · cajera Ana')]:
    pr+=f'<tr class="fila"><td class="td">{f}</td><td class="td">{ve}</td><td class="td num r">{mon}</td><td class="td">{can}</td><td class="td"><span class="b {cl}">{s(ico,13)}{est}</span></td></tr>'
promesas=f'''<div style="display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:14px;background:#EEF2FF"><span class="av" style="background:#fff;color:#3730A3">{s('mano')}</span><div><b>Sin promesa activa</b><div style="font-size:13px;color:#475569">Puede pedir una hasta el 25 nov · reactiva el servicio al instante</div></div><button class="btn p" style="margin-left:auto">{s('mano',15)}Nueva promesa</button></div>
{tabla(['Creada','Vence','>Monto','Canal','Estado'],pr)}'''
soporte=f'''<div style="display:flex;align-items:center"><span class="b in">{s('ticket',13)}Tickets y órdenes desde Iris</span><button class="btn p" style="margin-left:auto">{s('mas1',15)}Abrir ticket</button></div>
<div style="border:1px solid #EEF0F5;border-radius:14px;padding:14px 16px;display:flex;align-items:center;gap:12px"><span class="av" style="background:#FEF3C7;color:#92400E">{s('ticket')}</span><div><b>#T-2291 · Sin internet después de pagar</b><div style="font-size:13px;color:#64748B">Hace 2 h · Soporte nivel 1 · SLA 4 h</div></div><span class="b wa" style="margin-left:auto">{s('reloj',13)}En curso</span></div>
<div style="border:1px solid #EEF0F5;border-radius:14px;padding:14px 16px;display:flex;align-items:center;gap:12px"><span class="av" style="background:#DCFCE7;color:#166534">{s('ok')}</span><div><b>OT-1180 · Instalación</b><div style="font-size:13px;color:#64748B">12 mar 2023 · técnico Luis · fotos y firma</div></div><span class="b ok" style="margin-left:auto">{s('ok',13)}Cerrada</span></div>'''
documentos='<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px">'+''.join(f'<div style="border:1px solid #EEF0F5;border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:8px;cursor:pointer"><span class="av" style="background:#F1F5F9;color:#475569">{s(i)}</span><b>{t_}</b><span style="font-size:13px;color:#64748B">{d}</span></div>' for i,t_,d in [('doc','Contrato de servicio','Firmado 12 mar 2023 · PDF'),('doc','Estado de cuenta','Generar al momento'),('imp','Aviso de cobro','Carta o POS 80 mm')])+'</div>'
bitacora=f'''<div>
<div class="tl"><span class="ic" style="background:#FEE2E2;color:#B91C1C">{s('alerta',15)}</span><div><b>Internet hogar suspendido</b><div style="font-size:12px;color:#64748B">Sistema · corte automático · 8 nov 2026 06:00</div></div></div>
<div class="tl"><span class="ic" style="background:#FEF3C7;color:#92400E">{s('mano',15)}</span><div><b>Promesa incumplida</b><div style="font-size:12px;color:#64748B">Sistema · 16 oct 2026</div></div></div>
<div class="tl"><span class="ic" style="background:#EEF2FF;color:#3730A3">{s('editar',15)}</span><div><b>Teléfono cambiado</b><div style="font-size:12px;color:#64748B">Ana (cajera) · panel · 2 oct 2026</div></div></div>
<div class="tl"><span class="ic" style="background:#DCFCE7;color:#166534">{s('cob',15)}</span><div><b>Pago R-0911 registrado</b><div style="font-size:12px;color:#64748B">Ana (cajera) · Caja 1 · 4 sep 2026</div></div></div></div>'''
CSS3='''
.tf{display:inline-flex;gap:2px;padding:4px;border-radius:14px;background:#F1F5F9;max-width:100%;overflow-x:auto;scrollbar-width:none}
.ts{border-radius:10px;padding:8px 14px;white-space:nowrap}
.ts.on{background:#fff;color:#4338CA;box-shadow:0 2px 8px rgba(15,23,42,.12)}
.stat{display:flex;align-items:center;gap:10px;padding:8px 12px 8px 8px;border-radius:14px;background:#F8FAFC;border:1px solid #EEF0F5}
.stat .ic{width:34px;height:34px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex:0 0 auto}
.stat .l{font-size:11px;color:#64748B;white-space:nowrap}
.stat b{font-size:16px;display:block;white-space:nowrap;line-height:1.2}
.stat small{font-size:11px;color:#94A3B8;white-space:nowrap}
.tg{display:inline-flex;align-items:center;gap:8px;font-size:12px;font-weight:600;color:#475569;cursor:pointer;background:#fff;border:1px solid #E2E8F0;border-radius:999px;padding:5px 10px 5px 5px;font-family:inherit}
.tg i{width:30px;height:18px;border-radius:999px;background:#CBD5E1;position:relative;display:inline-block}
.tg i::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:999px;background:#fff;transition:left .15s}
.tg.on i{background:#4F46E5}.tg.on i::after{left:14px}
'''
datos=f'''<div class="card" style="position:absolute;right:0;top:calc(100% + 8px);width:320px;padding:14px 16px;box-shadow:0 20px 50px rgba(15,23,42,.18);z-index:6;display:{{{{verDatos}}}}">
  <div style="display:flex;align-items:center"><b style="font-size:14px">Datos del cliente</b><button class="ib" title="Editar" style="margin-left:auto">{s('editar',15)}</button></div>
  <div class="kv"><span>{s('tel',14)} Teléfono</span><span>5555-8890 · WhatsApp</span></div>
  <div class="kv"><span>{s('mail',14)} Correo</span><span>jlopez@correo.gt</span></div>
  <div class="kv"><span>NIT</span><span class="copy">4521873-K</span></div>
  <div class="kv"><span>{s('mapa',14)} Dirección</span><span>Zona 3, casa 14</span></div>
  <div style="height:70px;margin-top:8px;border-radius:10px;background:repeating-linear-gradient(45deg,#EEF2FF 0 10px,#F8FAFC 10px 20px);display:flex;align-items:center;justify-content:center;color:#4338CA;font-size:12px;font-weight:600">{s('mapa',15)} Ver en el mapa</div></div>'''
cab=f'''<section class="isla" style="border-radius:22px;padding:{{{{cabPad}}}};display:flex;align-items:center;gap:14px;position:relative;transition:padding .2s">
  <div class="av" style="width:{{{{avT}}}};height:{{{{avT}}}};border-radius:16px;font-size:18px;background:#CFFAFE;color:#0E7490">JL</div>
  <div style="min-width:0">
    <div style="display:flex;align-items:center;gap:8px"><b style="font-size:{{{{nomT}}}};white-space:nowrap">José López</b><span class="b er">{s('alerta',13)}Suspendido</span></div>
    <div style="display:{{{{meta}}}};font-size:13px;color:#64748B;gap:12px;margin-top:3px;white-space:nowrap"><span>CLI-00412</span><span>{s('tel',13)} 5555-8890</span><span>{s('mapa',13)} Norte</span></div>
  </div>
  <div style="display:flex;gap:8px;margin-left:12px">
    <div class="stat" style="background:#FEF2F2;border-color:#FECACA"><span class="ic" style="background:#FEE2E2;color:#B91C1C">{s('cob',17)}</span><div><div class="l">Saldo</div><b class="num" style="color:#B91C1C">Q 400.00</b><small style="display:{{{{meta}}}}">2 facturas vencidas</small></div></div>
    <div class="stat" style="display:{{{{metaF}}}}"><span class="ic" style="background:#FEF3C7;color:#92400E">{s('reloj',17)}</span><div><div class="l">Próximo vencimiento</div><b>5 dic</b><small>Q 400.00</small></div></div>
    <div class="stat" style="display:{{{{metaF}}}}"><span class="ic" style="background:#EEF2FF;color:#4338CA">{s('wifi',17)}</span><div><div class="l">Servicios</div><b>2 suspendidos</b><small>Q 400.00 / mes</small></div></div>
  </div>
  <div style="margin-left:auto;display:flex;gap:8px;align-items:center;position:relative">
    <button class="btn v">{s('cob',15)}Cobrar</button>
    <button class="ib" title="Promesa de pago" style="border:1px solid #E2E8F0;border-radius:999px;width:38px;height:38px">{s('mano',16)}</button>
    <button class="ib" title="Abrir ticket" style="border:1px solid #E2E8F0;border-radius:999px;width:38px;height:38px">{s('ticket',16)}</button>
    <button class="ib" title="Ver datos del cliente" onClick="{{{{alternarDatos}}}}" style="border:1px solid #E2E8F0;border-radius:999px;width:38px;height:38px;background:{{{{datosBg}}}}">{s('cli',16)}</button>
    <button class="ib" title="Mensaje, estado de cuenta, editar, retirar" style="border:1px solid #E2E8F0;border-radius:999px;width:38px;height:38px">{s('mas',16)}</button>
    {datos}
  </div>
</section>'''
ficha=f'''{rail('dia')}
{HEADER}
<main style="position:absolute;left:108px;right:16px;top:76px;bottom:16px;display:flex;flex-direction:column;gap:12px;padding:8px 4px">
  <div style="display:flex;align-items:center;gap:10px"><div style="font-size:13px;color:#64748B">Día a día › Clientes › <span style="color:#0F172A">José López</span></div>
    <button class="tg {{{{tgClase}}}}" style="margin-left:auto" onClick="{{{{alternar}}}}"><i></i>Simular desplazamiento</button></div>
  {cab}
  <section class="isla" style="flex:1;min-height:0;border-radius:22px;display:flex;flex-direction:column;overflow:hidden">
    <nav aria-label="Secciones del cliente" style="padding:12px 16px;border-bottom:1px solid #F1F5F9"><div class="tf">{barra('ts')}</div></nav>
    <div style="padding:18px 20px;display:flex;flex-direction:column;gap:14px;overflow:auto;flex:1">
    {panel('resumen',resumen)}{panel('servicios',servicios)}{panel('contactos',contactos)}{panel('facturas',facturas)}{panel('pagos',pagos)}{panel('promesas',promesas)}{panel('soporte',soporte)}{panel('documentos',documentos)}{panel('bitacora',bitacora)}
    </div>
  </section>
</main>
<div style="position:absolute;right:28px;bottom:28px;max-width:360px;background:#0F172A;color:#E2E8F0;border-radius:14px;padding:12px 14px;font-size:13px;line-height:1.5;z-index:7"><b style="color:#fff">Ficha compacta.</b> El cliente ocupa una franja; sus datos se abren con el ícono de persona. Pestañas segmentadas en la misma tarjeta que su contenido, fijas arriba al bajar. Contadores con ícono y contexto. Al bajar, la franja se encoge a nombre, estado, saldo y Cobrar (prueba «Simular desplazamiento»).</div>'''
logic='''class Component extends DCLogic {
renderVals() {
const tabs = %s;
const st = this.state || {};
const act = st.tab || 'resumen';
const c = !!st.compacto;
const v = {};
tabs.forEach((t) => { v[t.id] = t.id === act ? 'flex' : 'none'; });
return {
  v,
  cabPad: c ? '8px 12px' : '16px 20px',
  avT: c ? '36px' : '56px',
  nomT: c ? '15px' : '21px',
  meta: c ? 'none' : 'flex',
  metaF: c ? 'none' : 'flex',
  tgClase: c ? 'on' : '',
  alternar: () => this.setState({ compacto: !c }),
  verDatos: st.datos ? 'block' : 'none',
  datosBg: st.datos ? '#EEF2FF' : 'transparent',
  alternarDatos: () => this.setState({ datos: !st.datos }),
  tabs: tabs.map((t) => ({ ...t, clase: t.id === act ? 'on' : '', vc: t.n ? 'inline' : 'none', ir: () => this.setState({ tab: t.id }) }))
};
}
}''' % json.dumps([{'id':k,'nombre':n,'n':c} for k,n,_,c in tabs],ensure_ascii=False)
open('NuevoClienteFicha.dc.html','w').write(page('Ficha del cliente',ficha,1000,logic).replace('</style>',CSS2+CSS3+'</style>',1))

# ---------- MÓVIL ----------
def fila(ico,bg,fg,tit,sub,der,badge=''):
    return f'<div style="display:flex;align-items:center;gap:10px;padding:11px 0;border-top:1px solid #F1F5F9"><span class="av" style="width:34px;height:34px;border-radius:10px;background:{bg};color:{fg}">{s(ico,16)}</span><div style="min-width:0"><b style="font-size:14px">{tit}</b><div style="font-size:12px;color:#64748B">{sub}</div></div><div style="margin-left:auto;text-align:right"><b class="num" style="font-size:14px">{der}</b>{badge}</div></div>'
def tarjeta(t,html): return f'<div><div class="sec" style="margin:4px 0 2px">{t}</div>{html}</div>'
mv={
'resumen':f'''<div style="display:flex;gap:10px;align-items:center;padding:10px 12px;border-radius:14px;background:#FEF2F2;border:1px solid #FECACA;font-size:13px;color:#7F1D1D">{s('alerta',18,'#B91C1C')}<span><b>Suspendido por mora.</b> Al cobrar o dar promesa se reactiva al instante.</span></div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
<div class="kpi"><div class="l">{s('hist',13)}Cliente desde</div><b>mar 2023</b></div>
<div class="kpi"><div class="l">{s('reloj',13)}Próximo</div><b>5 dic</b></div>
<div class="kpi"><div class="l">{s('ok',13)}Pagado 2026</div><b class="num">Q 1,800</b></div>
<div class="kpi"><div class="l">{s('wifi',13)}Consumo</div><b>182 GB</b></div></div>
{tarjeta('Servicios',fila('wifi','#EEF2FF','#4338CA','Internet hogar','50 Mbps · 10.20.4.18','', '<div><span class="b er">Suspendido</span></div>')+fila('wifi','#EEF2FF','#4338CA','Cámaras','20 Mbps · 10.20.4.77','','<div><span class="b er">Suspendido</span></div>'))}
{tarjeta('Actividad',fila('alerta','#FEE2E2','#B91C1C','Corte automático','8 nov · sistema','')+fila('fac','#EEF2FF','#3730A3','Factura A-1940','1 nov · emitida','Q 200.00'))}''',
'contactos':tarjeta('A cargo de sus servicios',fila('cli','#FCE7F3','#9D174D','Luis López · hijo','4444-1234 · todo permitido','')+fila('cli','#E0E7FF','#3730A3','María Pérez · vecina','Cámaras · fallas y avisos',''))+tarjeta('Él está a cargo de',fila('wifi','#FCE7F3','#9D174D','S-000518 · Ana Ramírez','Su mamá · consulta, reporta y paga','')),
'servicios':tarjeta('2 servicios',fila('wifi','#EEF2FF','#4338CA','Internet hogar','50 Mbps · PPPoE · sin sesión','Q 200','<div><span class="b er">Suspendido</span></div>')+fila('wifi','#EEF2FF','#4338CA','Cámaras','20 Mbps · IP estática','Q 200','<div><span class="b er">Suspendido</span></div>')),
'facturas':tarjeta('Facturas',fila('fac','#FEE2E2','#B91C1C','A-1940 · noviembre','Venció 5 nov','Q 200.00','<div><span class="b er">Vencida</span></div>')+fila('fac','#FEE2E2','#B91C1C','A-1882 · octubre','Venció 5 oct','Q 200.00','<div><span class="b er">Vencida</span></div>')+fila('fac','#DCFCE7','#166534','A-1820 · septiembre','Pagada 4 sep','Q 200.00','<div><span class="b ok">Pagada</span></div>')),
'pagos':tarjeta('Pagos',fila('cob','#DCFCE7','#166534','R-0911 · efectivo','4 sep · Caja 1','Q 200.00')+fila('cob','#DCFCE7','#166534','R-0850 · depósito','3 ago · Banrural','Q 200.00')),
'promesas':tarjeta('Promesas',fila('mano','#FEF3C7','#92400E','Incumplida','12 → 15 oct · portal','Q 200.00')+fila('mano','#DCFCE7','#166534','Cumplida','8 → 10 jul · panel','Q 200.00')),
'soporte':tarjeta('Desde Iris',fila('ticket','#FEF3C7','#92400E','#T-2291 Sin internet','Hace 2 h · SLA 4 h','','<div><span class="b wa">En curso</span></div>')+fila('ok','#DCFCE7','#166534','OT-1180 Instalación','12 mar 2023','','<div><span class="b ok">Cerrada</span></div>')),
'documentos':tarjeta('Documentos',fila('doc','#F1F5F9','#475569','Contrato de servicio','Firmado 12 mar 2023','')+fila('doc','#F1F5F9','#475569','Estado de cuenta','Generar ahora','')+fila('imp','#F1F5F9','#475569','Aviso de cobro','Carta o POS 80 mm','')),
'bitacora':tarjeta('Bitácora',fila('alerta','#FEE2E2','#B91C1C','Suspendido','8 nov · sistema','')+fila('mano','#FEF3C7','#92400E','Promesa incumplida','16 oct · sistema','')+fila('editar','#EEF2FF','#3730A3','Teléfono cambiado','2 oct · Ana','')),
}
movil=f'''<div style="position:absolute;inset:0;display:flex;flex-direction:column">
  <div style="display:flex;align-items:center;gap:10px;padding:12px 16px 8px">
    <span class="f ci" title="Atrás" style="width:38px;height:38px">{s('izq',17)}</span>
    <b style="font-size:16px;flex:1">Cliente</b>
    <span class="f ci" title="Mensaje, estado de cuenta, editar, retirar" style="width:38px;height:38px">{s('mas',17)}</span>
  </div>
  <div style="flex:1;overflow:auto;padding:0 12px 88px;display:flex;flex-direction:column;gap:10px">
    <section class="card" style="padding:14px;display:flex;flex-direction:column;gap:12px">
      <div style="display:flex;align-items:center;gap:10px"><div class="av" style="width:44px;height:44px;border-radius:14px;background:#CFFAFE;color:#0E7490">JL</div><div style="min-width:0;flex:1"><b style="font-size:16px;display:block">José López</b><span style="font-size:12px;color:#64748B">CLI-00412 · Norte · 5555-8890</span></div><span class="b er">{s('alerta',13)}Suspendido</span></div>
      <div style="display:grid;grid-template-columns:1.3fr 1fr 1fr;gap:6px">
        <div style="background:#FEF2F2;border-radius:12px;padding:8px 10px"><div style="font-size:11px;color:#991B1B">Debe</div><b class="num" style="color:#B91C1C;font-size:16px">Q 400</b></div>
        <div style="background:#F8FAFC;border-radius:12px;padding:8px 10px"><div style="font-size:11px;color:#64748B">Vencidas</div><b style="font-size:16px">2</b></div>
        <div style="background:#F8FAFC;border-radius:12px;padding:8px 10px"><div style="font-size:11px;color:#64748B">Servicios</div><b style="font-size:16px">2</b></div>
      </div>
    </section>
    <section class="card" style="display:flex;flex-direction:column;overflow:hidden">
      <nav aria-label="Secciones del cliente" style="padding:8px;border-bottom:1px solid #F1F5F9"><div class="tf" style="display:flex">{barra('ts')}</div></nav>
      <div style="padding:10px 12px 12px;display:flex;flex-direction:column;gap:10px">
      {''.join(f'<div style="display:{{{{v.{k}}}}};flex-direction:column;gap:10px">{h}</div>' for k,h in mv.items())}
      </div>
    </section>
  </div>
  <div style="position:absolute;left:0;right:0;bottom:0;background:#fff;border-top:1px solid #E6E8F0;padding:10px 12px 14px;display:flex;gap:8px;box-shadow:0 -8px 24px rgba(15,23,42,.06)">
    <button class="btn o" style="padding:12px 14px">{s('mano',16)}Promesa</button>
    <button class="btn v" style="flex:1;justify-content:center;padding:12px;font-size:15px">{s('cob',17)}Cobrar Q 400.00</button>
  </div>
</div>'''
logicm='''class Component extends DCLogic {
renderVals() {
const tabs = %s;
const act = (this.state && this.state.tab) || 'resumen';
const v = {};
tabs.forEach((t) => { v[t.id] = t.id === act ? 'flex' : 'none'; });
return { v, tabs: tabs.map((t) => ({ ...t, clase: t.id === act ? 'on' : '', vc: t.n ? 'inline' : 'none', ir: () => this.setState({ tab: t.id }) })) };
}
}''' % json.dumps([{'id':k,'nombre':n,'n':c} for k,n,_,c in tabs],ensure_ascii=False)
hm=page('Ficha del cliente en el teléfono',movil,844,logicm).replace('</style>',CSS2+CSS3+'</style>',1).replace('"width":1440,"height":844','"width":390,"height":844')
open('NuevoClienteFichaMovil.dc.html','w').write(hm)
c=json.load(open('canvas.json'))
c['boards']['NuevoClienteFicha.dc.html'].update({"h":1000,"title":"Ficha del cliente · franja compacta + pestañas segmentadas flotantes (interactiva)","is_interactive":True})
c['boards']['NuevoClienteFichaMovil.dc.html']={"x":3040,"y":8620,"w":390,"h":844,"title":"Ficha del cliente · teléfono (390 px, interactiva)","expand":"fill","page":"novedades","is_interactive":True}
if 'NuevoClienteFichaMovil.dc.html' not in c['order']: c['order'].append('NuevoClienteFichaMovil.dc.html')
json.dump(c,open('canvas.json','w'),ensure_ascii=False)
print('ok')
