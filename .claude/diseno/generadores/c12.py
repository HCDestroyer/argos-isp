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
CSSK="""
.mod{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:980px;max-width:calc(100% - 32px);height:min(760px,calc(100% - 32px));background:#fff;border-radius:26px;box-shadow:0 30px 80px rgba(15,23,42,.35);display:flex;flex-direction:column;overflow:hidden;z-index:9}
.pz{display:inline-flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:#94A3B8}
.pz .n{width:24px;height:24px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;background:#F1F5F9;color:#64748B;font-size:12px}
.pz.on{color:#3730A3}.pz.on .n{background:#4F46E5;color:#fff;box-shadow:0 0 0 4px #E0E7FF}
.pz.ok{color:#166534}.pz.ok .n{background:#DCFCE7;color:#166534}
.raya{flex:1;height:2px;background:#E2E8F0;border-radius:2px;min-width:20px}
.den2{display:flex;align-items:center;gap:8px;padding:7px 8px;min-width:0;border:1px solid #EEF0F5;border-radius:14px;background:#fff}
.den2 .v{width:58px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:15px;flex:0 0 auto}
.den2 .st{display:flex;align-items:center;gap:6px;margin-left:auto}
.den2 button{width:30px;height:30px;border-radius:10px;border:1px solid #E2E8F0;background:#F8FAFC;font-size:18px;font-weight:700;cursor:pointer;font-family:inherit;color:#334155}
.den2 .q{width:38px;text-align:center;font-weight:700;font-size:16px;font-variant-numeric:tabular-nums;border:1px solid #CBD5E1;border-radius:10px;padding:5px 0}
.den2 .sub{width:76px;text-align:right;font-size:13px;color:#475569;font-variant-numeric:tabular-nums}
.rs{display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-top:1px solid #F1F5F9;font-size:14px}
.rs span:first-child{color:#64748B}
.lnk{border:0;background:transparent;color:#4338CA;font-weight:600;font-size:13px;cursor:pointer;font-family:inherit;padding:0}
.paso2>*{flex-shrink:0}
"""
CSSI="""html,body{height:100%;overflow:hidden}
.mod{width:900px}
.lnk{border:0;background:transparent;color:#4338CA;font-weight:600;font-size:13px;cursor:pointer;font-family:inherit;padding:0}
.chk{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:12px;font-size:13px}
.pv{display:grid;grid-template-columns:80px 1fr 120px 110px;gap:10px;padding:8px 12px;border-top:1px solid #F1F5F9;font-size:13px;align-items:center}
.pvh{display:grid;grid-template-columns:80px 1fr 120px 110px;gap:10px;padding:8px 12px;background:#F8FAFC;font-size:11px;font-weight:700;color:#64748B}
"""
def fld(lab,val,req=False,ayuda=''):
    ph=' ph' if val.startswith('~') else ''
    return f'<div><div class="lb" style="font-size:12px;margin-bottom:4px">{lab}{"<span class=req>*</span>" if req else ""}</div><div class="in{ph}" style="padding:10px 12px">{val.lstrip("~")}</div>{f"<div class=ay>{ayuda}</div>" if ayuda else ""}</div>'
pasos='<div style="display:flex;align-items:center;gap:8px;flex:1;max-width:520px;margin:0 auto"><span class="pz {{c1}}"><span class="n">{{n1}}</span>Subir</span><span class="raya"></span><span class="pz {{cC}}" style="display:{{verPasoC}}"><span class="n">{{nC}}</span>Columnas</span><span class="raya" style="display:{{verPasoC}}"></span><span class="pz {{c2}}"><span class="n">{{n2}}</span>Revisar</span><span class="raya"></span><span class="pz {{c3}}"><span class="n">✓</span>Listo</span></div>'
paso1=f"""<div style="display:{{{{p1}}}};flex-direction:column;gap:16px">
 {fld('Cuenta bancaria','Banrural · Monetaria ···4567',True)}
 <div onClick="{{{{subir}}}}" style="cursor:pointer;border:2px dashed {{{{zonaBorde}}}};background:{{{{zonaBg}}}};border-radius:20px;padding:30px;display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center">
  <span style="width:56px;height:56px;border-radius:16px;background:#fff;color:#4338CA;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 16px rgba(79,70,229,.15)">{s('doc',26)}</span>
  <b style="font-size:16px">{{{{zonaTit}}}}</b>
  <span style="font-size:13px;color:#64748B">{{{{zonaSub}}}}</span>
 </div>
 <div style="display:{{{{verReconocido}}}};align-items:center;gap:10px;padding:12px 14px;border-radius:14px;background:#F0FDF4;border:1px solid #BBF7D0;font-size:13px;color:#166534">{s('check',16)}<span><b>Formato reconocido: Banrural · Excel de banca virtual.</b> Argos lo convierte solo.</span></div>
 <div style="display:{{{{verDesconocido}}}};align-items:center;gap:10px;padding:12px 14px;border-radius:14px;background:#FFFBEB;border:1px solid #FDE68A;font-size:13px;color:#92400E">{s('alerta',16)}<span><b>No reconocemos este formato todavía.</b> En el siguiente paso indicas qué es cada columna; solo se hace una vez.</span></div>
 <div style="display:flex;gap:6px;font-size:12px;color:#94A3B8;align-items:center">Demo: <button class="lnk" onClick="{{{{demoOk}}}}">archivo reconocido</button>·<button class="lnk" onClick="{{{{demoNo}}}}">archivo desconocido</button></div>
 <div style="font-size:12px;color:#64748B;line-height:1.5">{s('ayuda',13)} Descárgalo de tu banca en línea: <b>Estado de cuenta → Exportar a Excel</b>, del mes completo. Se aceptan Excel (.xlsx, .xls) y CSV. No hace falta editarlo.</div>
</div>"""
prev=[('01/11','SALDO ANTERIOR','—',''),('02/11','DEP BR-777901 EFECTIVO','BR-777901','+ Q 2,880.00'),('03/11','ACH BI JUAN PEREZ','88213','+ Q 175.00'),('05/11','COMISION MANEJO CUENTA','—','− Q 35.00'),('05/11','TRANSF 554101 A RAMIREZ','554101','+ Q 175.00')]
filas=''.join(f'<div class="pv"><span style="color:#64748B">{a}</span><span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{b}</span><span class="mono" style="font-size:12px;color:#475569">{c}</span><b class="num" style="text-align:right;color:{"#166534" if d.startswith("+") else ("#B91C1C" if d.startswith("−") else "#94A3B8")}">{d}</b></div>' for a,b,c,d in prev[1:])
chk=lambda ok,t: f'<div class="chk" style="background:{"#F0FDF4" if ok=="ok" else "#FFFBEB"};color:{"#166534" if ok=="ok" else "#92400E"}">{s("check" if ok=="ok" else "alerta",15)}<span>{t}</span></div>'
pasoC=f"""<div style="display:{{{{pC}}}};flex-direction:column;gap:14px;min-height:0;overflow:auto">
 <div><b style="font-size:15px">¿Qué es cada columna?</b><div style="font-size:13px;color:#64748B">Argos ya sugirió lo más probable. Revisa y corrige si hace falta.</div></div>
 <div style="display:flex;gap:8px"><div style="flex:1;min-width:0;border:1px solid #E2E8F0;border-radius:14px;overflow:hidden;background:#fff"><div style="padding:8px 10px;background:#F8FAFC;font-size:11px;color:#64748B;font-weight:700">COLUMNA A · «Fecha»</div><div style="padding:8px"><div class="in sel" style="padding:7px 10px;font-size:13px;font-weight:600;border-color:#4F46E5;color:#3730A3;background:#EEF2FF">Fecha</div></div><div style="padding:6px 10px;border-top:1px solid #F1F5F9;font-size:12px;color:#475569;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">12/11/2026</div><div style="padding:6px 10px;border-top:1px solid #F1F5F9;font-size:12px;color:#475569;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">13/11/2026</div><div style="padding:6px 10px;border-top:1px solid #F1F5F9;font-size:12px;color:#475569;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">13/11/2026</div></div><div style="flex:1;min-width:0;border:1px solid #E2E8F0;border-radius:14px;overflow:hidden;background:#fff"><div style="padding:8px 10px;background:#F8FAFC;font-size:11px;color:#64748B;font-weight:700">COLUMNA B · «Concepto»</div><div style="padding:8px"><div class="in sel" style="padding:7px 10px;font-size:13px;font-weight:600;border-color:#4F46E5;color:#3730A3;background:#EEF2FF">Descripción</div></div><div style="padding:6px 10px;border-top:1px solid #F1F5F9;font-size:12px;color:#475569;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">DEPOSITO EFECTIVO</div><div style="padding:6px 10px;border-top:1px solid #F1F5F9;font-size:12px;color:#475569;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">CARGO COMISION</div><div style="padding:6px 10px;border-top:1px solid #F1F5F9;font-size:12px;color:#475569;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">TRANSF RECIBIDA 99120</div></div><div style="flex:1;min-width:0;border:1px solid #E2E8F0;border-radius:14px;overflow:hidden;background:#fff"><div style="padding:8px 10px;background:#F8FAFC;font-size:11px;color:#64748B;font-weight:700">COLUMNA C · «No. Doc»</div><div style="padding:8px"><div class="in sel" style="padding:7px 10px;font-size:13px;font-weight:600;border-color:#4F46E5;color:#3730A3;background:#EEF2FF">Referencia</div></div><div style="padding:6px 10px;border-top:1px solid #F1F5F9;font-size:12px;color:#475569;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">4471203</div><div style="padding:6px 10px;border-top:1px solid #F1F5F9;font-size:12px;color:#475569;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">—</div><div style="padding:6px 10px;border-top:1px solid #F1F5F9;font-size:12px;color:#475569;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">99120</div></div><div style="flex:1;min-width:0;border:1px solid #E2E8F0;border-radius:14px;overflow:hidden;background:#fff"><div style="padding:8px 10px;background:#F8FAFC;font-size:11px;color:#64748B;font-weight:700">COLUMNA D · «Cargos»</div><div style="padding:8px"><div class="in sel" style="padding:7px 10px;font-size:13px;font-weight:600;border-color:#4F46E5;color:#3730A3;background:#EEF2FF">Sale (−)</div></div><div style="padding:6px 10px;border-top:1px solid #F1F5F9;font-size:12px;color:#475569;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">&nbsp;</div><div style="padding:6px 10px;border-top:1px solid #F1F5F9;font-size:12px;color:#475569;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">35.00</div><div style="padding:6px 10px;border-top:1px solid #F1F5F9;font-size:12px;color:#475569;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">&nbsp;</div></div><div style="flex:1;min-width:0;border:1px solid #E2E8F0;border-radius:14px;overflow:hidden;background:#fff"><div style="padding:8px 10px;background:#F8FAFC;font-size:11px;color:#64748B;font-weight:700">COLUMNA E · «Abonos»</div><div style="padding:8px"><div class="in sel" style="padding:7px 10px;font-size:13px;font-weight:600;border-color:#4F46E5;color:#3730A3;background:#EEF2FF">Entra (+)</div></div><div style="padding:6px 10px;border-top:1px solid #F1F5F9;font-size:12px;color:#475569;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">2,880.00</div><div style="padding:6px 10px;border-top:1px solid #F1F5F9;font-size:12px;color:#475569;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">&nbsp;</div><div style="padding:6px 10px;border-top:1px solid #F1F5F9;font-size:12px;color:#475569;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">400.00</div></div><div style="flex:1;min-width:0;border:1px solid #E2E8F0;border-radius:14px;overflow:hidden;background:#fff"><div style="padding:8px 10px;background:#F8FAFC;font-size:11px;color:#64748B;font-weight:700">COLUMNA F · «Saldo»</div><div style="padding:8px"><div class="in sel" style="padding:7px 10px;font-size:13px;font-weight:600;border-color:#4F46E5;color:#3730A3;background:#EEF2FF">Saldo</div></div><div style="padding:6px 10px;border-top:1px solid #F1F5F9;font-size:12px;color:#475569;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">26,486.25</div><div style="padding:6px 10px;border-top:1px solid #F1F5F9;font-size:12px;color:#475569;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">26,451.25</div><div style="padding:6px 10px;border-top:1px solid #F1F5F9;font-size:12px;color:#475569;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">26,851.25</div></div></div>
 <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">
  <div><div class="lb" style="font-size:12px">Los datos empiezan en la fila</div><div class="in">8</div><div class="ay">Antes hay encabezados del banco</div></div>
  <div><div class="lb" style="font-size:12px">Formato de fecha</div><div class="in sel">día/mes/año</div></div>
  <div><div class="lb" style="font-size:12px">Montos</div><div class="in sel">Cargos y abonos en columnas separadas</div></div>
 </div>
 <div class="chk" style="background:#F0FDF4;color:#166534">{s('check',15)}<span>Con esto Argos entiende 48 movimientos: fecha, descripción y monto en todos.</span></div>
 <label style="display:flex;align-items:center;gap:10px;font-size:13px;cursor:pointer"><span class="tg on"><i></i></span>Recordar este formato para <b>Banrural ···4567</b> (la próxima vez se reconoce solo)</label>
</div>"""
paso2=f"""<div style="display:{{{{p2}}}};flex-direction:column;gap:14px;min-height:0;overflow:auto">
 <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px">
  <div class="kpi"><div class="l">Periodo</div><b style="font-size:16px">1 al 30 nov 2026</b></div>
  <div class="kpi"><div class="l">Movimientos</div><b>48</b></div>
  <div class="kpi"><div class="l">Entradas</div><b class="num" style="color:#166534">+ Q 31,420.00</b></div>
  <div class="kpi"><div class="l">Salidas</div><b class="num" style="color:#B91C1C">− Q 6,815.50</b></div>
 </div>
 <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
  <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border:1px solid #E2E8F0;border-radius:14px"><span style="font-size:13px;color:#64748B">Saldo inicial</span><b class="num" style="margin-left:auto">Q 23,606.25</b></div>
  <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border:1px solid #E2E8F0;border-radius:14px"><span style="font-size:13px;color:#64748B">Saldo final</span><b class="num" style="margin-left:auto">Q 48,210.75</b></div>
 </div>
 <div style="display:flex;flex-direction:column;gap:6px">
  {chk('ok','Los movimientos cuadran con los saldos inicial y final.')}
  {chk('ok','El saldo inicial sigue al cierre de octubre (Q 23,606.25).')}
  {chk('wa','2 movimientos ya estaban importados y se omiten.')}
 </div>
 <div style="border:1px solid #E6E8F0;border-radius:14px;overflow:hidden">
  <div style="display:flex;align-items:center;padding:10px 12px;border-bottom:1px solid #F1F5F9"><b style="font-size:13px">Así lo leyó Argos</b><span style="font-size:12px;color:#64748B;margin-left:8px">primeros 4 de 48</span><a href="#" style="margin-left:auto;font-size:12px;font-weight:600">Ver todos</a></div>
  <div class="pvh"><span>FECHA</span><span>DESCRIPCIÓN</span><span>REFERENCIA</span><span style="text-align:right">MONTO</span></div>{filas}
 </div>
</div>"""
paso3=f"""<div style="display:{{{{p3}}}};flex-direction:column;align-items:center;justify-content:center;gap:14px;text-align:center;flex:1">
 <span style="width:76px;height:76px;border-radius:999px;background:#DCFCE7;color:#166534;display:flex;align-items:center;justify-content:center">{s('check',36)}</span>
 <b style="font-size:22px">Estado de cuenta importado</b>
 <div style="font-size:14px;color:#475569">46 movimientos nuevos de Banrural ···4567 · noviembre 2026</div>
 <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;width:540px;max-width:100%">
  <div class="kpi" style="background:#F0FDF4"><div class="l">Conciliados solos</div><b style="color:#166534">39</b></div>
  <div class="kpi" style="background:#FFFBEB"><div class="l">Para confirmar</div><b style="color:#92400E">4</b></div>
  <div class="kpi"><div class="l">Sin pareja</div><b>3</b></div>
 </div>
 <button class="btn p" style="padding:12px 22px">{s('der',15)}Ir a conciliar</button>
</div>"""
modal=f"""<div style="position:absolute;inset:0;background:rgba(15,23,42,.45);z-index:8"></div>
<div class="mod" role="dialog" aria-label="Importar estado de cuenta">
 <header style="display:flex;align-items:center;gap:12px;padding:16px 22px;border-bottom:1px solid #F1F5F9"><span class="av" style="background:#EEF2FF;color:#4338CA">{s('banco',18)}</span><div><b style="font-size:17px">Importar estado de cuenta</b><div style="font-size:12px;color:#64748B">Movimientos del banco para conciliar</div></div>{pasos}<button class="ib" title="Ayuda (manual)" style="cursor:help">{s('ayuda')}</button><button class="ib" title="Cerrar">{s('cerrar',16)}</button></header>
 <div style="flex:1;min-height:0;padding:18px 22px;display:flex;flex-direction:column">{paso1}{pasoC}{paso2}{paso3}</div>
 <footer style="display:{{{{verPie}}}};align-items:center;gap:10px;padding:14px 22px;border-top:1px solid #F1F5F9;background:#FCFCFE"><span style="font-size:13px;color:#64748B">{{{{pieTxt}}}}</span><span style="flex:1"></span>
  <button class="btn o" style="display:{{{{verAtras}}}}" onClick="{{{{atras}}}}">{s('izq',15)}{{{{atrasTxt}}}}</button>
  <button class="btn p" style="display:{{{{verSig}}}}" onClick="{{{{siguiente}}}}">{{{{sigTxt}}}}{s('der',15)}</button>
  <button class="btn v" style="display:{{{{verImp}}}};padding:11px 20px" onClick="{{{{importar}}}}">{s('check',15)}Importar 46 movimientos</button></footer>
</div>"""
body=f"""{rail('fin')}
{HEADER}
<main style="position:absolute;left:108px;right:16px;top:76px;bottom:16px;padding:8px 4px;filter:blur(1px)"><section class="isla" style="height:100%;border-radius:20px"></section></main>
{modal}"""
logic="""class Component extends DCLogic {
renderVals() {
const st = this.state || {};
const paso = st.paso || 1;
const sub = !!st.sub;
const desc = !!st.desc;
const orden = desc ? [1, 'c', 2, 3] : [1, 2, 3];
const idx = orden.indexOf(paso);
const ir = (p) => () => this.setState({ paso: p });
const hecho = (p) => orden.indexOf(p) < idx;
return {
  p1: paso === 1 ? 'flex' : 'none', pC: paso === 'c' ? 'flex' : 'none', p2: paso === 2 ? 'flex' : 'none', p3: paso === 3 ? 'flex' : 'none',
  c1: hecho(1) ? 'ok' : 'on', n1: hecho(1) ? '✓' : '1',
  verPasoC: desc ? 'inline-flex' : 'none', cC: hecho('c') ? 'ok' : (paso === 'c' ? 'on' : ''), nC: hecho('c') ? '✓' : '2',
  c2: hecho(2) ? 'ok' : (paso === 2 ? 'on' : ''), n2: hecho(2) ? '✓' : (desc ? '3' : '2'), c3: paso === 3 ? 'ok' : '',
  zonaTit: sub ? (desc ? 'movimientos_nov.xlsx · 48 filas' : 'estado_nov_2026.xlsx · 48 movimientos') : 'Arrastra aquí el archivo del banco',
  zonaSub: sub ? 'Toca para cambiar de archivo' : 'o toca para elegirlo · Excel o CSV, tal como lo descargas',
  zonaBorde: sub ? (desc ? '#F59E0B' : '#22C55E') : '#A5B4FC', zonaBg: sub ? (desc ? '#FFFBEB' : '#F0FDF4') : '#F5F7FF',
  verReconocido: sub && !desc ? 'flex' : 'none', verDesconocido: sub && desc ? 'flex' : 'none',
  subir: () => this.setState({ sub: true }), demoOk: () => this.setState({ sub: true, desc: false, paso: 1 }), demoNo: () => this.setState({ sub: true, desc: true, paso: 1 }),
  verPie: paso !== 3 ? 'flex' : 'none', verAtras: paso !== 1 ? 'inline-flex' : 'none', verSig: (paso === 1 || paso === 'c') ? 'inline-flex' : 'none', verImp: paso === 2 ? 'inline-flex' : 'none',
  sigTxt: paso === 1 && desc ? 'Acomodar columnas' : 'Revisar', atrasTxt: paso === 2 && desc ? 'Columnas' : 'Otro archivo',
  pieTxt: paso === 1 ? (sub ? 'Listo para seguir' : 'Elige el archivo para seguir') : (paso === 'c' ? 'Solo hace falta fecha, descripción y monto.' : 'Solo se agregan movimientos; nada se borra.'),
  siguiente: () => { if (!sub) return; this.setState({ paso: paso === 1 && desc ? 'c' : 2 }); },
  atras: () => this.setState({ paso: paso === 2 && desc ? 'c' : 1 }), importar: ir(3)
};
}
}"""

html=page('Importar estado de cuenta',body,900,logic).replace('</style>',CSSF+CSSTG+CSSC+ICSS+CSSP+CSSK+CSSI+'</style>',1).replace('height:900px;background','height:100vh;min-height:560px;background')
open('NuevoImportarExtracto.dc.html','w').write(html)
c=json.load(open('canvas.json'))
c['boards']['NuevoImportarExtracto.dc.html']={"x":3040,"y":12820,"w":1440,"h":900,"title":"Importar estado de cuenta del banco (interactiva)","expand":"fill","page":"novedades","is_interactive":True}
if 'NuevoImportarExtracto.dc.html' not in c['order']: c['order'].append('NuevoImportarExtracto.dc.html')
json.dump(c,open('canvas.json','w'),ensure_ascii=False)
print('ok')
