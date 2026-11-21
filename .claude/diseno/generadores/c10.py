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
<div style="width:100%;height:100vh;min-height:560px;background:{BG};position:relative;overflow:hidden">
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
.tln{display:flex;align-items:center;gap:10px;padding:9px 0;font-size:14px;border-bottom:1px dashed #E2E8F0}
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
CSSX="""
html,body{height:100%;overflow:hidden}
.tabs2{display:inline-flex;gap:2px;padding:4px;border-radius:14px;background:#F1F5F9}
.tabs2 button{border:0;background:transparent;border-radius:10px;padding:8px 16px;font-size:13px;font-weight:600;color:#64748B;cursor:pointer;font-family:inherit;display:inline-flex;gap:6px;align-items:center}
.tabs2 button.on{background:#fff;color:#3730A3;box-shadow:0 2px 8px rgba(15,23,42,.1)}
.tabs2 .c{font-size:11px;border-radius:999px;padding:0 6px;background:#FEF3C7;color:#92400E}
.tr{display:grid;align-items:center;gap:12px;padding:12px 16px;border-top:1px solid #F1F5F9;font-size:14px}
.tr:hover{background:#FAFAFF}
.tr .b{justify-self:start}
.trh{display:grid;gap:12px;padding:10px 16px;background:#F8FAFC;font-size:11px;font-weight:700;letter-spacing:.05em;color:#64748B;text-transform:uppercase}
.ck2{width:20px;height:20px;border-radius:6px;border:2px solid #CBD5E1;display:inline-flex;align-items:center;justify-content:center;color:#fff;font-size:12px;box-sizing:border-box}
.ck2.on{background:#4F46E5;border-color:#4F46E5}
.drw{position:absolute;right:16px;top:16px;bottom:16px;width:460px;background:#fff;border-radius:24px;box-shadow:0 30px 80px rgba(15,23,42,.3);display:flex;flex-direction:column;overflow:hidden;z-index:9}
"""
def fld(lab,val,req=False,ayuda=''):
    ph=' ph' if val.startswith('~') else ''
    return f'<div><div class="lb" style="font-size:12px;margin-bottom:4px">{lab}{"<span class=req>*</span>" if req else ""}</div><div class="in{ph}" style="padding:9px 12px">{val.lstrip("~")}</div>{f"<div class=ay>{ayuda}</div>" if ayuda else ""}</div>'
K=lambda ico,bg,fg,lab,val,sub: f'<div class="card" style="padding:14px 16px;display:flex;gap:12px;align-items:center"><span class="av" style="background:{bg};color:{fg}">{s(ico,18)}</span><div><div style="font-size:12px;color:#64748B">{lab}</div><b class="num" style="font-size:19px">{val}</b><div style="font-size:11px;color:#94A3B8">{sub}</div></div></div>'
GC='grid-template-columns:110px 1.3fr 1fr 1fr 1fr 1.1fr 120px 70px'
cierres=[('C-0311','Caja 1 · Ana','hoy 16:16','Q 5,100.50','Q 2,563.50','er','Falta Q 87.00','wa','Por depositar'),
('C-0310','Caja 2 · Marcos','hoy 15:40','Q 3,420.00','Q 1,980.00','ok','Cuadra','wa','Por depositar'),
('C-0309','Caja 1 · Ana','ayer 16:05','Q 4,880.00','Q 2,310.00','ok','Cuadra','ok','Depositado'),
('C-0308','Caja 2 · Marcos','ayer 15:52','Q 2,915.25','Q 1,402.25','wa','Sobra Q 2.00','ok','Depositado'),
('C-0307','Caja 1 · Ana','19 nov','Q 5,630.00','Q 2,880.00','ok','Cuadra','ok','Depositado')]
filas_c=''.join(f'<div class="tr" style="{GC}"><span class="mono">{a}</span><span><b>{b}</b></span><span style="color:#64748B">{c}</span><span class="num">{d}</span><span class="num">{e}</span><span class="b {f}">{g}</span><span class="b {h}">{i}</span><span style="display:flex;gap:2px"><button class="ib" title="Imprimir corte">{s("imp",15)}</button><button class="ib" title="Ver corte, reabrir (supervisor), depositar">{s("mas",15)}</button></span></div>' for a,b,c,d,e,f,g,h,i in cierres)
tab_cierres=f"""<div style="display:{{{{t.cierres}}}};flex-direction:column;gap:14px;flex:1;min-height:0">
 <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px">
  {K('caja','#DCFCE7','#166534','Cajas abiertas','1','Caja 3 · Sofía desde 08:00')}
  {K('cob','#EEF2FF','#4338CA','Cobrado hoy','Q 8,520.50','2 cierres')}
  {K('banco','#FEF3C7','#92400E','Efectivo por depositar','Q 4,543.50','2 cierres')}
  {K('alerta','#FEE2E2','#B91C1C','Diferencias del mes','− Q 85.00','3 cierres')}
 </div>
 <section class="card" style="overflow:hidden;display:flex;flex-direction:column;min-height:0;flex:1">
  <div style="display:flex;gap:8px;align-items:center;padding:12px 14px"><span class="fc on">Todos</span><span class="fc">Por depositar<span class="c">2</span></span><span class="fc">Con diferencia</span><span class="fc">{s('cal',13)} Noviembre</span><span class="fc">Todas las cajas</span><button class="btn o" style="margin-left:auto;padding:6px 12px">{s('imp',14)}Exportar</button></div>
  <div class="trh" style="{GC}"><span>Corte</span><span>Caja y cajero</span><span>Cerrada</span><span>Cobrado</span><span>Efectivo</span><span>Cuadre</span><span>Depósito</span><span></span></div>
  <div style="overflow:auto">{filas_c}</div>
 </section>
</div>"""
GD='grid-template-columns:110px 1fr 1.2fr 1fr 1fr 120px 40px'
deps=[('D-0122','hoy 16:40','Banrural ···4567','BR-778812','Q 2,310.00','wa','Por conciliar'),('D-0121','ayer 16:30','Banrural ···4567','BR-778455','Q 1,402.25','ok','Conciliado'),('D-0120','19 nov','BI ···0091','BI-55120','Q 2,880.00','ok','Conciliado')]
filas_d=''.join(f'<div class="tr" style="{GD}"><span class="mono">{a}</span><span style="color:#64748B">{b}</span><span>{c}</span><span class="mono">{d}</span><b class="num">{e}</b><span class="b {f}">{g}</span><button class="ib" title="Ver boleta">{s("foto",15)}</button></div>' for a,b,c,d,e,f,g in deps)
tab_dep=f"""<div style="display:{{{{t.depositos}}}};flex-direction:column;gap:14px;flex:1;min-height:0">
 <div style="display:flex;gap:12px;align-items:center;padding:14px 16px;border-radius:18px;background:#FFFBEB;border:1px solid #FDE68A"><span class="av" style="background:#FEF3C7;color:#92400E">{s('banco',18)}</span><div><b>Q 4,543.50 en efectivo por depositar</b><div style="font-size:13px;color:#92400E">Cortes C-0311 y C-0310</div></div><button class="btn p" style="margin-left:auto" onClick="{{{{abrir}}}}">{s('mas1',15)}Registrar depósito</button></div>
 <section class="card" style="overflow:hidden;flex:1;min-height:0;display:flex;flex-direction:column">
  <div class="trh" style="{GD}"><span>Depósito</span><span>Fecha</span><span>Cuenta</span><span>Boleta</span><span>Monto</span><span>Estado</span><span></span></div>
  <div style="overflow:auto">{filas_d}</div>
 </section>
</div>"""
GM='grid-template-columns:90px 1fr 1.4fr 1fr 1fr'
movs=[('hoy 12:10','Retiro','Pago de luz del local · Ana','− Q 300.00','Caja 1'),('hoy 09:30','Ingreso','Cambio desde caja fuerte · Luis','+ Q 200.00','Caja 2'),('ayer 14:00','Retiro','Viáticos técnico Pedro · Marcos','− Q 150.00','Caja 2')]
filas_m=''.join(f'<div class="tr" style="{GM}"><span style="color:#64748B">{a}</span><span class="b {"er" if b=="Retiro" else "ok"}">{b}</span><span>{c}</span><span>{e}</span><b class="num">{d}</b></div>' for a,b,c,d,e in movs)
tab_mov=f"""<div style="display:{{{{t.movimientos}}}};flex-direction:column;gap:14px;flex:1;min-height:0">
 <div style="display:flex;gap:8px"><button class="btn o">{s('cob',15)}Registrar retiro</button><button class="btn o">{s('mas1',15)}Registrar ingreso</button><span style="font-size:12px;color:#64748B;align-self:center;margin-left:8px">Cada movimiento pide motivo y queda en la bitácora; el cierre los descuenta.</span></div>
 <section class="card" style="overflow:hidden"><div class="trh" style="{GM}"><span>Hora</span><span>Tipo</span><span>Motivo y quién</span><span>Caja</span><span>Monto</span></div>{filas_m}</section>
</div>"""
ck=lambda on,a,b,c: f'<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-top:1px solid #F1F5F9"><span class="ck2 {"on" if on else ""}">{"✓" if on else ""}</span><div><b class="mono" style="font-size:13px">{a}</b><div style="font-size:12px;color:#64748B">{b}</div></div><b class="num" style="margin-left:auto">{c}</b></div>'
drawer=f"""<div style="position:absolute;inset:0;background:rgba(15,23,42,.35);z-index:8;display:{{{{verDrw}}}}"></div>
<aside class="drw" style="display:{{{{verDrw}}}}" aria-label="Registrar depósito">
 <header style="display:flex;align-items:center;gap:10px;padding:16px 18px;border-bottom:1px solid #F1F5F9"><span class="av" style="background:#EEF2FF;color:#4338CA">{s('banco',18)}</span><div><b style="font-size:17px">Registrar depósito</b><div style="font-size:12px;color:#64748B">Efectivo de los cierres al banco</div></div><button class="ib" style="margin-left:auto" onClick="{{{{cerrarDrw}}}}" title="Cerrar">{s('cerrar',16)}</button></header>
 <div style="flex:1;overflow:auto;padding:16px 18px;display:flex;flex-direction:column;gap:14px">
  <div><div class="lb" style="font-size:12px">Cierres que deposita<span class="req">*</span></div><div style="border:1px solid #E2E8F0;border-radius:14px;overflow:hidden">{ck(True,'C-0311 · Caja 1','hoy · Ana','Q 2,563.50').replace('border-top:1px solid #F1F5F9','border-top:0',1)}{ck(True,'C-0310 · Caja 2','hoy · Marcos','Q 1,980.00')}</div></div>
  {fld('Cuenta bancaria','Banrural · Monetaria ···4567',True)}
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">{fld('Número de boleta','~impreso en la boleta',True)}{fld('Fecha del depósito','21/11/2026',True)}</div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">{fld('Monto de la boleta','Q 4,543.50',True,'Debe coincidir con los cierres')}{fld('Depositó','Ana')}</div>
  <div style="height:70px;border-radius:14px;border:1px dashed #A5B4FC;background:#EEF2FF;color:#4338CA;font-size:13px;font-weight:600;display:flex;align-items:center;justify-content:center;gap:8px;cursor:pointer">{s('foto',18)}Foto de la boleta (obligatoria)</div>
  <div class="ok-note">{s('check',14)}Monto igual a los cierres elegidos: Q 4,543.50</div>
 </div>
 <footer style="display:flex;gap:8px;padding:14px 18px;border-top:1px solid #F1F5F9"><button class="btn g" onClick="{{{{cerrarDrw}}}}">Cancelar</button><button class="btn p" style="margin-left:auto">{s('check',15)}Registrar depósito</button></footer>
</aside>"""
tabs='<div class="tabs2"><sc-for list="{{tabs}}" as="x" hint-placeholder-count="3"><button class="{{x.clase}}" onClick="{{x.ir}}">{{x.nombre}}<span class="c" style="display:{{x.vc}}">{{x.n}}</span></button></sc-for></div>'
body=f"""{rail('fin')}
{HEADER}
<main style="position:absolute;left:108px;right:16px;top:76px;bottom:16px;padding:8px 4px;display:flex;flex-direction:column;gap:14px">
 <div style="display:flex;align-items:flex-end;gap:12px"><div><div style="font-size:13px;color:#64748B">Finanzas › Cajas</div><h1 style="margin:2px 0 0;font-size:26px">Cajas</h1></div><button class="ib" title="Ayuda (manual)" style="cursor:help">{s('ayuda')}</button><div style="margin-left:auto">{tabs}</div></div>
 {tab_cierres}{tab_dep}{tab_mov}
</main>
{drawer}"""
logic="""class Component extends DCLogic {
renderVals() {
const st = this.state || {};
const act = st.tab || 'cierres';
const L = [['cierres','Cierres',''],['depositos','Depósitos','2'],['movimientos','Retiros e ingresos','']];
const t = {}; L.forEach(([k]) => { t[k] = k === act ? 'flex' : 'none'; });
return { t, tabs: L.map(([id, nombre, n]) => ({ id, nombre, n, vc: n ? 'inline' : 'none', clase: id === act ? 'on' : '', ir: () => this.setState({ tab: id }) })),
  verDrw: st.drw ? 'flex' : 'none', abrir: () => this.setState({ drw: true }), cerrarDrw: () => this.setState({ drw: false }) };
}
}"""
html=page('Cajas',body,900,logic).replace('</style>',CSSF+CSSTG+CSSC+ICSS+CSSP+CSSX+'</style>',1).replace('height:900px;background','height:100vh;min-height:560px;background')
open('NuevoCajas.dc.html','w').write(html)
c=json.load(open('canvas.json'))
c['boards']['NuevoCajas.dc.html']={"x":2040,"y":11820,"w":1440,"h":900,"title":"Cajas · cierres, depósitos (boleta) y retiros (interactiva)","expand":"fill","page":"novedades","is_interactive":True}
if 'NuevoCajas.dc.html' not in c['order']: c['order'].append('NuevoCajas.dc.html')
json.dump(c,open('canvas.json','w'),ensure_ascii=False)
print('ok')
