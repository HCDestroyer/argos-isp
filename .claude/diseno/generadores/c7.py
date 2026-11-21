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
ic.update({
'user':'<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
'check':'<path d="m5 12 5 5L20 7"/>',
'router':'<rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 17h.01M11 17h.01M12 13V9M8 6a6 6 0 0 1 8 0"/>',
'id':'<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2.5"/><path d="M14 10h4M14 14h4M6 16a3 3 0 0 1 6 0"/>',
'cal':'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
'llave':'<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3"/>',
'herr':'<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-2.4z"/>',
})
CSSF='''
.paso{display:flex;gap:12px;align-items:flex-start;padding:12px;border-radius:14px;cursor:pointer;border:0;background:transparent;font-family:inherit;text-align:left;width:100%}
.paso:hover{background:#F8FAFC}
.paso .n{width:34px;height:34px;border-radius:11px;display:flex;align-items:center;justify-content:center;flex:0 0 auto;background:#F1F5F9;color:#64748B;font-weight:700;font-size:13px}
.paso b{font-size:14px;color:#334155;display:block}.paso small{font-size:12px;color:#94A3B8}
.paso.on{background:#EEF2FF}.paso.on .n{background:#4F46E5;color:#fff;box-shadow:0 6px 14px rgba(79,70,229,.35)}.paso.on b{color:#3730A3}
.paso.ok .n{background:#DCFCE7;color:#166534}
.lb{font-size:13px;font-weight:600;color:#334155;display:flex;align-items:center;gap:6px;margin-bottom:6px}
.lb .req{color:#B91C1C}
.in{display:flex;align-items:center;gap:8px;border:1px solid #CBD5E1;border-radius:12px;padding:10px 12px;font-size:14px;color:#0F172A;background:#fff;cursor:text;min-height:20px}
.in.ph{color:#94A3B8}
.in.sel{cursor:pointer}.in.sel::after{content:"";margin-left:auto;width:8px;height:8px;border-right:2px solid #94A3B8;border-bottom:2px solid #94A3B8;transform:rotate(45deg) translateY(-2px)}
.in.auto{background:#F8FAFC;border-style:dashed;cursor:default}
.ay{font-size:12px;color:#64748B;margin-top:5px}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.g3{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.op{border:1.5px solid #E2E8F0;border-radius:14px;padding:12px 14px;display:flex;gap:10px;align-items:flex-start;cursor:pointer;background:#fff}
.op.on{border-color:#4F46E5;background:#EEF2FF;box-shadow:0 0 0 3px rgba(79,70,229,.12)}
.op .rd{width:16px;height:16px;border-radius:999px;border:2px solid #CBD5E1;flex:0 0 auto;margin-top:2px}
.op.on .rd{border:5px solid #4F46E5}
.plan{border:1.5px solid #E2E8F0;border-radius:16px;padding:14px;cursor:pointer;background:#fff;display:flex;flex-direction:column;gap:4px}
.plan.on{border-color:#4F46E5;box-shadow:0 0 0 3px rgba(79,70,229,.12)}
.plan b{font-size:20px}
.tit{font-size:18px;font-weight:700;margin:0}
.subt{font-size:13px;color:#64748B;margin:2px 0 0}
.res{display:flex;justify-content:space-between;gap:10px;font-size:13px;padding:7px 0;border-top:1px solid #F1F5F9}
.res span:first-child{color:#64748B}
.pc{display:inline-flex;align-items:center;gap:8px;border:0;background:transparent;font-family:inherit;font-size:13px;font-weight:600;color:#64748B;cursor:pointer;padding:4px 6px;border-radius:999px;white-space:nowrap}
.pc .n{width:24px;height:24px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;background:#F1F5F9;color:#64748B;font-size:12px;font-weight:700}
.pc.on{color:#3730A3}.pc.on .n{background:#4F46E5;color:#fff;box-shadow:0 0 0 4px #E0E7FF}
.pc.ok{color:#166534}.pc.ok .n{background:#DCFCE7;color:#166534}
.ln{flex:1;height:2px;border-radius:2px;background:#E2E8F0;min-width:24px}.ln.ok{background:#86EFAC}.ln.fin{display:none}
.ok-note{display:flex;gap:8px;align-items:center;font-size:12px;color:#166534;background:#F0FDF4;border-radius:10px;padding:8px 10px}
'''
def campo(lab,val,req=False,cls='',ayuda='',ico=None):
    ph=' ph' if val.startswith('~') else ''
    v=val.lstrip('~')
    return f'<div><div class="lb">{lab}{"<span class=req>*</span>" if req else ""}</div><div class="in {cls}{ph}">{s(ico,16,"#94A3B8") if ico else ""}{v}</div>{f"<div class=ay>{ayuda}</div>" if ayuda else ""}</div>'
def op(on,tit,sub,ico=None):
    return f'<div class="op {"on" if on else ""}"><span class="rd"></span><div><b style="font-size:14px">{tit}</b><div style="font-size:12px;color:#64748B">{sub}</div></div></div>'

CSSTG='''.tg{display:inline-flex;align-items:center}.tg i{width:44px;height:26px;border-radius:999px;background:#CBD5E1;position:relative;display:inline-block}.tg i::after{content:"";position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:999px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.2)}.tg.on i{background:#16A34A}.tg.on i::after{left:21px}'''

ic.update({'banco':'<path d="M3 10h18L12 4zM5 10v8M9 10v8M15 10v8M19 10v8M3 20h18"/>','tarjeta':'<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>','foto':'<rect x="3" y="6" width="18" height="14" rx="2"/><circle cx="12" cy="13" r="3.5"/><path d="M8 6l2-2h4l2 2"/>'})
CSSC=""".fx{display:flex;align-items:center;gap:12px;padding:11px 14px;border-top:1px solid #F1F5F9;cursor:pointer}
.fx:hover{background:#FAFAFF}
.ck{width:20px;height:20px;border-radius:6px;border:2px solid #CBD5E1;flex:0 0 auto;display:flex;align-items:center;justify-content:center;color:#fff;box-sizing:border-box}
.ck.on{background:#4F46E5;border-color:#4F46E5}
.met{flex:1;display:flex;flex-direction:column;align-items:center;gap:6px;padding:12px 8px;border-radius:14px;border:1.5px solid #E2E8F0;font-size:13px;font-weight:600;color:#334155;cursor:pointer;background:#fff;font-family:inherit}
.met.on{border-color:#4F46E5;background:#EEF2FF;color:#3730A3;box-shadow:0 0 0 3px rgba(79,70,229,.12)}
.big{font-size:26px;font-weight:700;font-variant-numeric:tabular-nums}
.rap{padding:8px 14px;border-radius:10px;border:1px solid #E2E8F0;background:#fff;font-weight:600;font-size:14px;cursor:pointer;font-variant-numeric:tabular-nums}"""

import urllib.parse
ICSS='.ti{width:22px;height:22px;display:inline-block;background:currentColor;-webkit-mask:var(--m) center/contain no-repeat;mask:var(--m) center/contain no-repeat}'
for k,i in [('cobro','cob'),('mano','mano'),('mas1','mas1'),('cerrar','cerrar'),('efectivo','cob'),('tarjeta','tarjeta'),('deposito','banco')]:
    svg=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{ic[i]}</svg>'
    ICSS+=f'.ti-{k}{{--m:url("data:image/svg+xml,{urllib.parse.quote(svg)}")}}'
CSSP="""
.tile{position:relative;text-align:left;border:1.5px solid #E2E8F0;background:#fff;border-radius:18px;padding:14px;cursor:pointer;font-family:inherit;display:flex;flex-direction:column;gap:6px;transition:transform .12s,box-shadow .12s}
.tile:hover{transform:translateY(-2px);box-shadow:0 10px 24px rgba(15,23,42,.08)}
.tile.on{border-color:#4F46E5;background:#F5F7FF;box-shadow:0 0 0 3px rgba(79,70,229,.15)}
.tile .ok{position:absolute;top:10px;right:10px;width:22px;height:22px;border-radius:999px;background:#4F46E5;color:#fff;display:none;align-items:center;justify-content:center}
.tile.on .ok{display:flex}
.tile .mt{font-size:22px;font-weight:700;font-variant-numeric:tabular-nums}
.tk{background:#fff;border-radius:24px;border:1px solid #E6E8F0;box-shadow:0 20px 50px rgba(15,23,42,.12);display:flex;flex-direction:column;overflow:hidden}
.ln{display:flex;align-items:center;gap:10px;padding:9px 0;font-size:14px;border-bottom:1px dashed #E2E8F0}
.key{height:52px;border-radius:14px;border:1px solid #E2E8F0;background:#F8FAFC;font-size:20px;font-weight:600;cursor:pointer;font-family:inherit;color:#0F172A;font-variant-numeric:tabular-nums}
.key:hover{background:#EEF2FF}.key:active{transform:scale(.97)}
.den{flex:1;height:40px;border-radius:12px;border:1px solid #C7D2FE;background:#EEF2FF;color:#3730A3;font-weight:700;font-size:14px;cursor:pointer;font-family:inherit}
.seg{display:flex;gap:4px;padding:4px;background:#F1F5F9;border-radius:14px}
.seg button{flex:1;display:flex;align-items:center;justify-content:center;gap:6px;border:0;background:transparent;border-radius:10px;padding:9px;font-size:13px;font-weight:600;color:#64748B;cursor:pointer;font-family:inherit}
.seg button.on{background:#fff;color:#3730A3;box-shadow:0 2px 8px rgba(15,23,42,.1)}
.seg .ti{width:16px;height:16px}
.cobrar{height:58px;border:0;border-radius:16px;background:linear-gradient(135deg,#16A34A,#15803D);color:#fff;font-size:18px;font-weight:700;cursor:pointer;font-family:inherit;box-shadow:0 10px 24px rgba(22,163,74,.35);display:flex;align-items:center;justify-content:center;gap:10px}
.cobrar.off{background:#CBD5E1;box-shadow:none;cursor:not-allowed}
"""
tiles='<sc-for list="{{items}}" as="f" hint-placeholder-count="6"><button class="tile {{f.clase}}" onClick="{{f.ir}}"><span class="ok">✓</span><span style="font-size:12px;color:#64748B;display:flex;gap:6px;align-items:center"><span class="ti ti-{{f.icono}}" style="width:14px;height:14px"></span>{{f.servicio}}</span><b style="font-size:15px">{{f.titulo}}</b><span class="mt">{{f.montoTxt}}</span><span class="b {{f.badgeCls}}" style="align-self:flex-start">{{f.badge}}</span></button></sc-for>'
lineas='<sc-for list="{{lineas}}" as="l" hint-placeholder-count="2"><div class="ln"><div style="flex:1;min-width:0"><b style="font-size:14px">{{l.titulo}}</b><div style="font-size:12px;color:#64748B">{{l.servicio}}</div></div><b class="num">{{l.montoTxt}}</b><button class="ib" style="width:26px;height:26px" title="Quitar" onClick="{{l.quitar}}">×</button></div></sc-for>'
teclas='<sc-for list="{{teclas}}" as="k" hint-placeholder-count="12"><button class="key" onClick="{{k.ir}}">{{k.t}}</button></sc-for>'
dens='<sc-for list="{{dens}}" as="d" hint-placeholder-count="4"><button class="den" onClick="{{d.ir}}">{{d.t}}</button></sc-for>'
segm='<sc-for list="{{metodos}}" as="x" hint-placeholder-count="3"><button class="{{x.clase}}" onClick="{{x.ir}}"><span class="ti ti-{{x.id}}"></span>{{x.nombre}}</button></sc-for>'
ticket=f"""<aside class="tk" style="width:440px;flex:0 0 440px">
  <div style="padding:16px 20px 6px;display:flex;align-items:center;gap:8px"><b style="font-size:16px">Ticket</b><span style="font-size:12px;color:#64748B">Caja 1 · Ana</span><span class="b ok" style="margin-left:auto">● Caja abierta</span></div>
  <div style="padding:0 20px;max-height:150px;overflow:auto">{lineas}<div style="display:{{{{vacio}}}};padding:18px 0;text-align:center;color:#94A3B8;font-size:13px">Toca una cuenta para agregarla</div></div>
  <div style="padding:10px 20px 4px;display:flex;align-items:baseline"><span style="color:#64748B;font-size:13px">Total</span><span class="num" style="margin-left:auto;font-size:38px;font-weight:800;letter-spacing:-.02em">{{{{totalTxt}}}}</span></div>
  <div style="padding:6px 20px 0"><div class="seg">{segm}</div></div>
  <div style="padding:12px 20px 0;display:{{{{verEfectivo}}}};flex-direction:column;gap:10px">
    <div style="display:flex;gap:10px">
      <div style="flex:1;border:1.5px solid #4F46E5;border-radius:14px;padding:8px 12px"><div style="font-size:11px;color:#64748B">Recibido</div><b class="num" style="font-size:22px">{{{{recibidoTxt}}}}</b></div>
      <div style="flex:1;border-radius:14px;padding:8px 12px;background:{{{{cambioBg}}}}"><div style="font-size:11px;color:#64748B">{{{{cambioLbl}}}}</div><b class="num" style="font-size:22px;color:{{{{cambioCol}}}}">{{{{cambioTxt}}}}</b></div>
    </div>
    <div style="display:flex;gap:6px">{dens}</div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px">{teclas}</div>
  </div>
  <div style="padding:12px 20px 0;display:{{{{verOtro}}}};flex-direction:column;gap:10px">
    <div class="in" style="color:#94A3B8">{{{{otroCampo}}}}</div>
    <div style="height:54px;border-radius:12px;border:1px dashed #A5B4FC;background:#EEF2FF;color:#4338CA;font-size:13px;font-weight:600;display:flex;align-items:center;justify-content:center">Foto del comprobante (opcional)</div>
  </div>
  <div style="margin-top:auto;padding:14px 20px 18px;display:flex;flex-direction:column;gap:8px">
    <button class="cobrar {{{{cobrarCls}}}}" onClick="{{{{cobrar}}}}"><span class="ti ti-cobro" style="width:22px;height:22px"></span>{{{{cobrarTxt}}}}</button>
    <div style="display:flex;gap:8px;font-size:12px;color:#64748B;align-items:center">{s('imp',14)} Recibo POS 80 mm<span style="margin-left:6px">{s('mail',14)} WhatsApp</span><a href="#" style="margin-left:auto;font-weight:600">{s('mano',13)} Promesa</a></div>
  </div>
</aside>"""
listo=f"""<div style="position:absolute;inset:0;background:rgba(15,23,42,.4);z-index:8;display:{{{{verListo}}}};align-items:center;justify-content:center">
<div class="isla" style="width:400px;max-width:90%;border-radius:26px;padding:28px;display:flex;flex-direction:column;align-items:center;gap:12px;text-align:center">
<span style="width:72px;height:72px;border-radius:999px;background:#DCFCE7;color:#166534;display:flex;align-items:center;justify-content:center">{s('check',36)}</span>
<b style="font-size:21px">¡Cobro listo!</b><div style="font-size:14px;color:#475569">Recibo <span class="mono">R-0957</span> · {{{{totalTxt}}}}</div>
<div style="font-size:15px;display:{{{{verCambioListo}}}}">Entregar cambio: <b class="num" style="font-size:22px;color:#166534">{{{{cambioTxt}}}}</b></div>
<div class="ok-note" style="width:100%;box-sizing:border-box">{s('rayo',15)}S-000412 · Casa se reactiva al instante</div>
<div style="display:flex;gap:8px;width:100%"><button class="btn o" style="flex:1;justify-content:center">{s('imp',15)}Reimprimir</button><button class="btn o" style="flex:1;justify-content:center">{s('mail',15)}WhatsApp</button></div>
<button class="btn p" style="width:100%;justify-content:center;padding:12px" onClick="{{{{nuevo}}}}">Siguiente cliente</button></div></div>"""
izq=f"""<section style="flex:1;min-width:0;display:flex;flex-direction:column;gap:14px">
  <div class="isla" style="border-radius:20px;padding:12px;display:flex;flex-direction:column;gap:10px">
    <div style="display:flex;align-items:center;gap:10px;border-radius:14px;background:#F8FAFC;padding:12px 14px;font-size:16px;color:#94A3B8">{s('bus',20)}Buscar cliente: nombre, teléfono, S-… o IP<span style="margin-left:auto;font-size:11px;border:1px solid #E2E8F0;border-radius:6px;padding:1px 6px">F2</span></div>
    <div style="display:flex;gap:6px;align-items:center;font-size:12px;color:#64748B">Recientes:<span class="fc" style="padding:4px 10px;font-size:12px">Ana Ramírez</span><span class="fc" style="padding:4px 10px;font-size:12px">Carlos Gómez</span><span class="fc" style="padding:4px 10px;font-size:12px">Lucía Morales</span></div>
  </div>
  <div class="isla" style="border-radius:20px;padding:14px 16px;display:flex;align-items:center;gap:12px">
    <div class="av" style="width:46px;height:46px;border-radius:14px;background:#CFFAFE;color:#0E7490">JL</div>
    <div><b style="font-size:16px">José López</b><div style="font-size:12px;color:#64748B">CLI-00412 · 5555-8890</div></div>
    <span class="b er">{s('alerta',13)}2 suspendidos</span>
    <div style="margin-left:auto;text-align:right"><div style="font-size:11px;color:#64748B">Debe</div><b class="num" style="color:#B91C1C;font-size:18px">Q 600.00</b></div>
    <button class="ib" title="Otro cliente">{s('cerrar',16)}</button>
  </div>
  <div style="display:flex;align-items:center;gap:8px"><b style="font-size:15px">Cuentas por cobrar</b><span style="font-size:12px;color:#64748B">toca para agregar al ticket</span><button class="btn o" style="margin-left:auto;padding:6px 12px" onClick="{{{{todas}}}}">Agregar vencidas</button></div>
  <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;overflow:auto;align-content:start">{tiles}</div>
</section>"""
body=f"""{rail('dia')}
{HEADER}
<main style="position:absolute;left:108px;right:16px;top:76px;bottom:16px;padding:8px 4px;display:flex;gap:16px">
{izq}
{ticket}
</main>
{listo}"""
items=[
 ('f1','A-1882','Octubre','S-000412 · Casa',20000,'er','Vencida','cobro'),
 ('f2','A-1940','Noviembre','S-000412 · Casa',20000,'er','Vencida','cobro'),
 ('f3','A-1941','Noviembre','S-000977 · Cámaras',20000,'er','Vencida','cobro'),
 ('f4','A-2004','Diciembre','S-000412 · Casa',20000,'ne','Vence 5 dic','cobro'),
 ('f5','A-1950','Noviembre','A su cargo: S-000518 · Ana R.',17500,'in','De su mamá','cobro'),
 ('ot','','Otro monto','Abono o adelanto',0,'in','Escribir monto','mas1'),
]
logic="""class Component extends DCLogic {
renderVals() {
const st = this.state || {};
const base = %s;
const sel = st.sel || ['f1', 'f2'];
const met = st.met || 'efectivo';
const rec = st.rec != null ? st.rec : '50000';
const q = (c) => 'Q ' + (c / 100).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const toggle = (id) => () => this.setState({ sel: sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id] });
const elegidos = base.filter((f) => sel.includes(f.id) && f.monto > 0);
const total = elegidos.reduce((a, f) => a + f.monto, 0);
const recibido = parseInt(rec || '0', 10);
const cambio = recibido - total;
const tecla = (t) => () => {
  let r = rec;
  if (t === '⌫') r = r.slice(0, -1);
  else if (t === 'C') r = '';
  else r = (r + t).replace(/^0+/, '').slice(0, 8);
  this.setState({ rec: r });
};
const ef = met === 'efectivo';
const listoCobrar = total > 0 && (!ef || cambio >= 0);
return {
  items: base.map((f) => ({ ...f, montoTxt: f.monto ? q(f.monto) : 'Q —', titulo: f.titulo, clase: sel.includes(f.id) ? 'on' : '', badgeCls: f.badgeCls, ir: toggle(f.id) })),
  lineas: elegidos.map((f) => ({ ...f, montoTxt: q(f.monto), quitar: toggle(f.id) })),
  vacio: elegidos.length ? 'none' : 'block',
  totalTxt: q(total),
  recibidoTxt: q(recibido),
  cambioTxt: q(Math.abs(cambio)),
  cambioLbl: cambio >= 0 ? 'Cambio' : 'Falta',
  cambioCol: cambio >= 0 ? '#166534' : '#B91C1C',
  cambioBg: cambio >= 0 ? '#F0FDF4' : '#FEF2F2',
  verEfectivo: ef ? 'flex' : 'none',
  verOtro: ef ? 'none' : 'flex',
  otroCampo: met === 'tarjeta' ? 'Autorización del voucher' : 'Cuenta y número de boleta',
  teclas: ['7','8','9','4','5','6','1','2','3','00','0','⌫'].map((t) => ({ t, ir: tecla(t) })),
  dens: [['Exacto', total], ['Q 100', 10000], ['Q 500', 50000], ['Q 1,000', 100000]].map(([t, v]) => ({ t, ir: () => this.setState({ rec: String(v) }) })),
  metodos: [['efectivo','Efectivo'],['tarjeta','Tarjeta'],['deposito','Depósito']].map(([id, nombre]) => ({ id, nombre, clase: id === met ? 'on' : '', ir: () => this.setState({ met: id }) })),
  cobrarCls: listoCobrar ? '' : 'off',
  cobrarTxt: total ? (listoCobrar ? 'Cobrar ' + q(total) : 'Falta ' + q(-cambio)) : 'Agrega una cuenta',
  cobrar: () => { if (listoCobrar) this.setState({ listo: true }); },
  verListo: st.listo ? 'flex' : 'none',
  verCambioListo: ef && cambio > 0 ? 'block' : 'none',
  todas: () => this.setState({ sel: ['f1', 'f2', 'f3'] }),
  nuevo: () => this.setState({ listo: false, sel: [], rec: '' })
};
}
}""" % json.dumps([{'id':a,'titulo':(c if not b else c+' · '+b),'servicio':d,'monto':m,'badgeCls':bc,'badge':bd,'icono':ico} for a,b,c,d,m,bc,bd,ico in items],ensure_ascii=False)
html=page('Cobrar (POS)',body,900,logic).replace('</style>',CSSF+CSSTG+CSSC+ICSS+CSSP+'</style>',1)
open('NuevoCobro.dc.html','w').write(html)
# móvil
mov=f"""<div style="position:absolute;inset:0;display:flex;flex-direction:column">
 <div style="display:flex;align-items:center;gap:10px;padding:12px 16px 8px"><span class="f ci" style="width:38px;height:38px">{s('izq',17)}</span><div style="flex:1"><b style="font-size:16px;display:block">Cobrar</b><span style="font-size:11px;color:#64748B">Caja 1 · abierta</span></div><span class="f ci" style="width:38px;height:38px">{s('bus',17)}</span></div>
 <div style="padding:0 12px 8px"><div class="isla" style="border-radius:16px;padding:10px 12px;display:flex;align-items:center;gap:10px"><div class="av" style="background:#CFFAFE;color:#0E7490">JL</div><div style="flex:1"><b>José López</b><div style="font-size:12px;color:#64748B">Debe <b style="color:#B91C1C">Q 600.00</b></div></div></div></div>
 <div style="padding:0 12px;display:grid;grid-template-columns:1fr 1fr;gap:8px;overflow:auto;flex:0 0 auto;max-height:250px">{tiles.replace('class="mt"','class="mt" style="font-size:18px"')}</div>
 <div class="tk" style="position:absolute;left:0;right:0;bottom:0;border-radius:24px 24px 0 0">
  <div style="padding:12px 16px 0;display:flex;align-items:baseline"><span style="font-size:13px;color:#64748B">Total</span><span class="num" style="margin-left:auto;font-size:30px;font-weight:800">{{{{totalTxt}}}}</span></div>
  <div style="padding:8px 16px 0"><div class="seg">{segm}</div></div>
  <div style="padding:10px 16px 0;display:{{{{verEfectivo}}}};flex-direction:column;gap:8px">
   <div style="display:flex;gap:8px"><div style="flex:1;border:1.5px solid #4F46E5;border-radius:12px;padding:6px 10px"><div style="font-size:11px;color:#64748B">Recibido</div><b class="num" style="font-size:18px">{{{{recibidoTxt}}}}</b></div><div style="flex:1;border-radius:12px;padding:6px 10px;background:{{{{cambioBg}}}}"><div style="font-size:11px;color:#64748B">{{{{cambioLbl}}}}</div><b class="num" style="font-size:18px;color:{{{{cambioCol}}}}">{{{{cambioTxt}}}}</b></div></div>
   <div style="display:flex;gap:6px">{dens}</div>
   <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px">{teclas.replace('class="key"','class="key" style="height:44px"')}</div>
  </div>
  <div style="padding:10px 16px 0;display:{{{{verOtro}}}}"><div class="in" style="flex:1;color:#94A3B8">{{{{otroCampo}}}}</div></div>
  <div style="padding:10px 16px 16px"><button class="cobrar {{{{cobrarCls}}}}" style="width:100%" onClick="{{{{cobrar}}}}">{{{{cobrarTxt}}}}</button></div>
 </div>
 {listo}
</div>"""
hm=page('Cobrar (POS) en el teléfono',mov,844,logic).replace('</style>',CSSF+CSSTG+CSSC+ICSS+CSSP+'</style>',1).replace('"width":1440,"height":844','"width":390,"height":844')
open('NuevoCobroMovil.dc.html','w').write(hm)
c=json.load(open('canvas.json'))
c['boards']['NuevoCobro.dc.html']['title']='Cobrar tipo POS · cuentas en tarjetas, ticket con teclado y cambio (interactiva)'
c['boards']['NuevoCobroMovil.dc.html']['title']='Cobrar tipo POS · teléfono (interactiva)'
json.dump(c,open('canvas.json','w'),ensure_ascii=False)
print('ok')
