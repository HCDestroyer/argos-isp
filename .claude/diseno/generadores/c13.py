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
ic.update({'caja2':'<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>','camion':'<path d="M3 6h11v10H3zM14 9h4l3 3v4h-7"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>','barra':'<path d="M4 5v14M7 5v14M11 5v14M14 5v14M18 5v14M20 5v14"/>','lista':'<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>','flecha':'<path d="M5 12h14M13 6l6 6-6 6"/>'})
CSSI="""html,body{height:100%;overflow:hidden}
.tabs2{display:inline-flex;gap:2px;padding:4px;border-radius:14px;background:#F1F5F9}
.tabs2 button{border:0;background:transparent;border-radius:10px;padding:8px 14px;font-size:13px;font-weight:600;color:#64748B;cursor:pointer;font-family:inherit;display:inline-flex;gap:6px;align-items:center}
.tabs2 button.on{background:#fff;color:#3730A3;box-shadow:0 2px 8px rgba(15,23,42,.1)}
.tabs2 .c{font-size:11px;border-radius:999px;padding:0 6px;background:#FEF3C7;color:#92400E}
.tr{display:grid;align-items:center;gap:12px;padding:11px 16px;border-top:1px solid #F1F5F9;font-size:14px}
.tr:hover{background:#FAFAFF}.tr .b{justify-self:start}
.trh{display:grid;gap:12px;padding:10px 16px;background:#F8FAFC;font-size:11px;font-weight:700;letter-spacing:.05em;color:#64748B;text-transform:uppercase}
.mini{display:inline-flex;align-items:center;gap:4px;font-size:11px;padding:2px 7px;border-radius:999px;background:#F1F5F9;color:#475569;margin:1px}
.drw{position:absolute;right:16px;top:16px;bottom:16px;width:480px;background:#fff;border-radius:24px;box-shadow:0 30px 80px rgba(15,23,42,.3);display:flex;flex-direction:column;overflow:hidden;z-index:9}
.tl2{display:flex;gap:12px;padding:10px 0}
.tl2 .p{width:30px;height:30px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex:0 0 auto}
.lnk{border:0;background:transparent;color:#4338CA;font-weight:600;font-size:13px;cursor:pointer;font-family:inherit;padding:0}
.b.ix{background:#EEF2FF;color:#3730A3}
"""
K=lambda ico,bg,fg,lab,val,sub: f'<div class="card" style="padding:14px 16px;display:flex;gap:12px;align-items:center"><span class="av" style="background:{bg};color:{fg}">{s(ico,18)}</span><div><div style="font-size:12px;color:#64748B">{lab}</div><b class="num" style="font-size:19px">{val}</b><div style="font-size:11px;color:#94A3B8">{sub}</div></div></div>'
def fld(lab,val,req=False,ayuda=''):
    ph=' ph' if val.startswith('~') else ''
    return f'<div><div class="lb" style="font-size:12px;margin-bottom:4px">{lab}{"<span class=req>*</span>" if req else ""}</div><div class="in{ph}" style="padding:9px 12px">{val.lstrip("~")}</div>{f"<div class=ay>{ayuda}</div>" if ayuda else ""}</div>'
def tabsHTML(): return '<div class="tabs2"><sc-for list="{{tabs}}" as="x" hint-placeholder-count="4"><button class="{{x.clase}}" onClick="{{x.ir}}">{{x.nombre}}<span class="c" style="display:{{x.vc}}">{{x.n}}</span></button></sc-for></div>'
def tabsLogic(L,default): return f"""const act = st.tab || '{default}';
const L = {json.dumps(L,ensure_ascii=False)};
const t = {{}}; L.forEach(([k]) => {{ t[k] = k === act ? 'flex' : 'none'; }});
const tabs = L.map(([id, nombre, n]) => ({{ id, nombre, n, vc: n ? 'inline' : 'none', clase: id === act ? 'on' : '', ir: () => this.setState({{ tab: id }}) }}));"""
def guardar(nombre,body,logic,css=''):
    html=page(nombre,body,900,logic).replace('</style>',CSSF+CSSTG+CSSC+ICSS+CSSP+CSSI+css+'</style>',1).replace('height:900px;background','height:100vh;min-height:560px;background')
    return html
# ===== 1. INVENTARIO =====
GE='grid-template-columns:2fr 90px 2.2fr 80px 110px 120px'
ex=[('ONU ZTE F660','serie','Central 42 · Luis 6 · Pedro 3','51','Q 310.00','Q 15,810.00',''),
('Router TP-Link C6','serie','Central 18 · Luis 2','20','Q 285.00','Q 5,700.00',''),
('Cable drop 1 hilo (m)','cantidad','Central 2,400 · Luis 180 · Pedro 95','2,675','Q 1.10','Q 2,942.50',''),
('Conector SC/APC','cantidad','Central 35 · Luis 4','39','Q 4.50','Q 175.50','bajo'),
('Antena LiteBeam 5AC','serie','Central 3','3','Q 690.00','Q 2,070.00','bajo'),
('Grapas para cable','cantidad','Central 900 · Pedro 120','1,020','Q 0.15','Q 153.00','')]
filas_ex=''.join(f'<div class="tr" style="{GE}"><span style="display:flex;gap:10px;align-items:center"><span class="av" style="width:34px;height:34px;border-radius:10px;background:{"#EEF2FF" if t=="serie" else "#F1F5F9"};color:{"#4338CA" if t=="serie" else "#475569"}">{s("barra" if t=="serie" else "caja2",16)}</span><span><b>{n}</b>{"<div style=font-size:11px;color:#B91C1C>Bajo el mínimo</div>" if b else ""}</span></span><span class="b {"ix" if t=="serie" else "ne"}">{"Serie" if t=="serie" else "Cantidad"}</span><span>{"".join(f"<span class=mini>{x}</span>" for x in d.split(" · "))}</span><b class="num" style="color:{"#B91C1C" if b else "#0F172A"}">{c}</b><span class="num" style="color:#64748B">{p}</span><b class="num">{v}</b></div>' for n,t,d,c,p,v,b in ex)
GU='grid-template-columns:1.6fr 1.3fr 150px 1.6fr 1fr'
un=[('ONU ZTE F660','ZTEG1A2B3C4D · 00:1A:2B:3C:4D:5E','ok','En comodato','S-000412 · José López'),('ONU ZTE F660','ZTEG9F8E7D6C · 00:1A:2B:9F:8E:7D','ix','En bodega','Central'),('Router TP-Link C6','2231500712 · 50:C7:BF:11:22:33','wa','Por recuperar','S-000318 · retirado 15 nov'),('ONU ZTE F660','ZTEG5566AA77 · 00:1A:2B:55:66:AA','ne','Con técnico','Luis'),('Router TP-Link C6','2231500988 · 50:C7:BF:44:55:66','wa','En revisión','Central · cambio en S-000201'),('Antena LiteBeam 5AC','B4FBE4112233','ix','En garantía','Distribuidora Red · RMA 7781')]
filas_un=''.join(f'<div class="tr" style="{GU};cursor:pointer" onClick="{{{{abrirUnidad}}}}"><b>{a}</b><span class="mono" style="font-size:12px;color:#475569">{b}</span><span class="b {c}">{d}</span><span>{e}</span><span style="text-align:right"><button class="ib" title="Historial">{s("hist",15)}</button></span></div>' for a,b,c,d,e in un)
GK='grid-template-columns:110px 130px 1.6fr 1fr 90px 110px 110px'
kx=[('21 nov 10:12','Comodato','ONU a S-000412 · José López','Central','− 1','Q 310.00','50'),('20 nov 16:40','Traslado','T-0045 Central → Luis','Central','− 5','Q 1,550.00','51'),('19 nov 09:00','Compra','FC-2291 Distribuidora Red','Central','+ 30','Q 9,300.00','56'),('18 nov 15:30','Devolución','ONU de S-000201 (usada)','Central','+ 1','Q 248.00','26')]
filas_kx=''.join(f'<div class="tr" style="{GK}"><span style="color:#64748B;font-size:13px">{a}</span><span class="b {"ix" if b in ("Compra","Devolución") else "ne"}">{b}</span><span>{c}</span><span>{d}</span><b class="num" style="color:{"#166534" if e.startswith("+") else "#B91C1C"}">{e}</b><span class="num">{f}</span><span class="num" style="color:#64748B">{g}</span></div>' for a,b,c,d,e,f,g in kx)
drawerU=f"""<div style="position:absolute;inset:0;background:rgba(15,23,42,.35);z-index:8;display:{{{{verU}}}}" onClick="{{{{cerrarU}}}}"></div>
<aside class="drw" style="display:{{{{verU}}}}"><header style="display:flex;gap:12px;align-items:center;padding:16px 18px;border-bottom:1px solid #F1F5F9"><span class="av" style="background:#EEF2FF;color:#4338CA">{s('barra',18)}</span><div><b style="font-size:17px">ONU ZTE F660</b><div class="mono" style="font-size:12px;color:#64748B">ZTEG1A2B3C4D · 00:1A:2B:3C:4D:5E</div></div><button class="ib" style="margin-left:auto" onClick="{{{{cerrarU}}}}">{s('cerrar',16)}</button></header>
<div style="flex:1;overflow:auto;padding:16px 18px;display:flex;flex-direction:column;gap:14px">
<div style="display:flex;gap:8px;align-items:center"><span class="b ok">En comodato</span><span style="font-size:13px">S-000412 · Casa · José López</span></div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><div class="kpi"><div class="l">Costo</div><b class="num">Q 310.00</b></div><div class="kpi"><div class="l">Valor en libros</div><b class="num">Q 292.80</b></div></div>
<div><div class="sec">Historial</div>
{''.join(f'<div class="tl2"><span class="p" style="background:{bg};color:{fg}">{s(i,15)}</span><div><b style="font-size:14px">{t1}</b><div style="font-size:12px;color:#64748B">{t2}</div></div></div>' for i,bg,fg,t1,t2 in [('cli','#DCFCE7','#166534','Comodato a S-000412','21 nov · técnico Luis · orden OT-1302 (Iris)'),('camion','#EEF2FF','#4338CA','Traslado T-0045 a Luis','20 nov · recibido con firma'),('fac','#F1F5F9','#475569','Comprada en FC-2291','19 nov · Distribuidora Red · Q 310.00')])}</div></div>
<footer style="display:flex;gap:8px;padding:14px 18px;border-top:1px solid #F1F5F9"><button class="btn p" onClick="{{{{abrirCambio}}}}">Cambiar equipo</button><button class="btn o">Retirar</button><button class="btn o" style="color:#B91C1C">No recuperado</button></footer></aside>"""

col=lambda tit,sub,bg,fg,ico,items: f'<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:8px"><div style="display:flex;align-items:center;gap:8px"><span class="av" style="width:30px;height:30px;border-radius:9px;background:{bg};color:{fg}">{s(ico,15)}</span><b style="font-size:14px">{tit}</b><span style="font-size:12px;color:#64748B">{sub}</span></div>{items}</div>'
it=lambda a,b,c,btns: f'<div style="border:1px solid #E6E8F0;border-radius:14px;padding:10px 12px;background:#fff;display:flex;flex-direction:column;gap:6px"><b style="font-size:13px">{a}</b><span class="mono" style="font-size:11px;color:#64748B">{b}</span><span style="font-size:12px;color:#475569">{c}</span><div style="display:flex;gap:6px;flex-wrap:wrap">{btns}</div></div>'
bt=lambda x,cl='': f'<button class="btn o" style="padding:5px 10px;font-size:12px;{cl}">{x}</button>'
GASTO='<span class="b ne">Gasto 5.6.02</span>'
taller=f"""  <div style="display:{{{{t.taller}}}};gap:14px;padding:14px;overflow:auto;align-items:flex-start">
   {col('En revisión','2','#E0F2FE','#0369A1','herr', it('ONU ZTE F660','ZTEG77AB12CD','Devuelta de S-000150 · «no enciende»',bt('Funciona: a bodega')+bt('Enviar a garantía')+bt('Dar de baja','color:#B91C1C'))+it('Router TP-Link C6','2231500988','Cambio en S-000201 · wifi intermitente',bt('Funciona: a bodega')+bt('Enviar a garantía')+bt('Dar de baja','color:#B91C1C')))}
   {col('En garantía','1','#EDE9FE','#6D28D9','camion', it('Antena LiteBeam 5AC','B4FBE4112233','Con Distribuidora Red · RMA 7781 · enviada 12 nov · vence 12 dic',bt('Volvió reparada')+bt('Cambiada por otra')+bt('Rechazada','color:#B91C1C')))}
   {col('Dados de baja','este mes · Q 595.00','#FEE2E2','#B91C1C','alerta', it('Router TP-Link C6','2231500111','Dañado por rayo · 8 nov · Q 285.00',GASTO)+it('ONU ZTE F660','ZTEG11223344','Obsoleta (no soporta 1 Gbps) · 2 nov · Q 310.00',GASTO))}
  </div>"""
NOREC=''.join(f'<div style="display:flex;align-items:center;gap:12px;padding:10px 14px;border:1px solid #E6E8F0;border-radius:14px"><span class="av" style="background:#FEE2E2;color:#B91C1C">{s("barra",16)}</span><div><b>{a}</b><div style="font-size:12px;color:#64748B">{b}</div></div><span class="b {c}" style="margin-left:auto">{d}</span></div>' for a,b,c,d in [('ONU ZTE F660 · ZTEG0099AA11','S-000045 · declarado 30 oct · Q 248.00','ok','Cobrado al cliente'),('Router TP-Link C6 · 2231500300','S-000071 · declarado 12 oct · Q 230.00','wa','Cargo pendiente de pago'),('ONU ZTE F660 · ZTEG7788CC22','S-000033 · declarado 2 oct · Q 210.00','ne','Sin cobro (decisión)')])
op2=lambda on,tit,sub: f'<div class="op {"on" if on else ""}" style="padding:10px 12px"><span class="rd"></span><div><b style="font-size:13px">{tit}</b><div style="font-size:12px;color:#64748B">{sub}</div></div></div>'
modalC=f"""<div style="position:absolute;inset:0;background:rgba(15,23,42,.45);z-index:10;display:{{{{verC}}}}"></div>
<div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:640px;max-height:calc(100% - 32px);background:#fff;border-radius:26px;box-shadow:0 30px 80px rgba(15,23,42,.35);z-index:11;display:{{{{verC}}}};flex-direction:column;overflow:hidden">
 <header style="display:flex;align-items:center;gap:12px;padding:16px 22px;border-bottom:1px solid #F1F5F9"><span class="av" style="background:#EEF2FF;color:#4338CA">{s('barra',18)}</span><div><b style="font-size:17px">Cambiar equipo</b><div style="font-size:12px;color:#64748B">S-000412 · Casa · José López</div></div><button class="ib" style="margin-left:auto" onClick="{{{{cerrarC}}}}">{s('cerrar',16)}</button></header>
 <div style="padding:16px 22px;overflow:auto;display:flex;flex-direction:column;gap:14px">
  <div><div class="lb" style="font-size:12px">¿Por qué se cambia?<span class="req">*</span></div><div style="display:flex;gap:6px;flex-wrap:wrap"><span class="fc on">Dañado</span><span class="fc">Actualización</span><span class="fc">Garantía</span><span class="fc">Otro</span></div></div>
  <div style="display:grid;grid-template-columns:1fr 32px 1fr;gap:8px;align-items:center">
   <div style="border:1px solid #FECACA;background:#FEF2F2;border-radius:14px;padding:10px 12px"><div style="font-size:11px;color:#991B1B;font-weight:700">SALE</div><b style="font-size:13px">ONU ZTE F660</b><div class="mono" style="font-size:11px;color:#64748B">ZTEG1A2B3C4D</div></div>
   <span style="color:#4338CA;text-align:center">{s('flecha',20)}</span>
   <div style="border:1px solid #BBF7D0;background:#F0FDF4;border-radius:14px;padding:10px 12px"><div style="font-size:11px;color:#166534;font-weight:700">ENTRA</div><b style="font-size:13px">ONU ZTE F660</b><div class="mono" style="font-size:11px;color:#64748B">ZTEG9F8E7D6C · de Central</div></div>
  </div>
  <div class="in" style="color:#94A3B8">{s('bus',15)}Escanear o buscar el equipo que entra<span style="margin-left:auto">{s('barra',16)}</span></div>
  <div><div class="lb" style="font-size:12px">¿Qué pasa con el que sale?<span class="req">*</span></div>
   <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">{op2(False,'Funciona','Vuelve a bodega como usado')}{op2(True,'A revisión','Se prueba en bodega antes de decidir')}{op2(False,'Garantía','Se envía al proveedor')}{op2(False,'Dañado','Se da de baja (gasto)')}</div></div>
  <label style="display:flex;align-items:center;gap:10px;font-size:13px"><span class="tg"><i></i></span>Cobrar al cliente (daño por mal uso)</label>
 </div>
 <footer style="display:flex;gap:8px;padding:14px 22px;border-top:1px solid #F1F5F9;background:#FCFCFE"><span style="font-size:12px;color:#64748B;align-self:center">Queda en el historial de los dos equipos y en la bitácora del servicio</span><button class="btn p" style="margin-left:auto">{s('check',15)}Cambiar equipo</button></footer>
</div>"""

inv=f"""{rail('inv')}
{HEADER}
<main style="position:absolute;left:108px;right:16px;top:76px;bottom:16px;padding:8px 4px;display:flex;flex-direction:column;gap:14px">
 <div style="display:flex;align-items:flex-end;gap:12px"><div><div style="font-size:13px;color:#64748B">Inventario</div><h1 style="margin:2px 0 0;font-size:26px">Inventario</h1></div><button class="ib" title="Ayuda (manual)" style="cursor:help">{s('ayuda')}</button>
  <div style="margin-left:auto;display:flex;gap:8px"><button class="btn o">{s('fac',15)}Registrar compra</button><button class="btn o">{s('camion',15)}Trasladar</button><button class="btn p">{s('mas1',15)}Nuevo producto</button></div></div>
 <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px">
  {K('caja2','#EEF2FF','#4338CA','Valor del inventario','Q 26,851.00','en 4 bodegas')}
  {K('alerta','#FEE2E2','#B91C1C','Bajo el mínimo','2 productos','Conector SC/APC, LiteBeam')}
  {K('camion','#E0F2FE','#0369A1','En tránsito','1 traslado','T-0046 a Pedro')}
  {K('hist','#FEF3C7','#92400E','Equipos por recuperar','3','de servicios retirados')}
 </div>
 <section class="card" style="flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column">
  <div style="display:flex;gap:10px;align-items:center;padding:12px 14px;border-bottom:1px solid #F1F5F9">{tabsHTML()}
   <div class="in" style="margin-left:auto;width:300px;color:#94A3B8;padding:8px 12px">{s('bus',15)}Producto, serie o MAC</div><span class="fc">{s('filtro',13)}Bodega: todas</span><span class="fc">Bajo mínimo</span></div>
  <div style="display:{{{{t.existencias}}}};flex-direction:column;overflow:auto"><div class="trh" style="{GE}"><span>Producto</span><span>Tipo</span><span>Dónde está</span><span>Total</span><span>Costo prom.</span><span>Valor</span></div>{filas_ex}</div>
  <div style="display:{{{{t.unidades}}}};flex-direction:column;overflow:auto"><div class="trh" style="{GU}"><span>Equipo</span><span>Serie · MAC</span><span>Estado</span><span>Dónde o con quién</span><span></span></div>{filas_un}</div>
  <div style="display:{{{{t.kardex}}}};flex-direction:column;overflow:auto"><div style="padding:10px 16px;display:flex;gap:8px;align-items:center;font-size:13px">Producto: <span class="fc on">ONU ZTE F660</span><span style="color:#64748B">· solo se agregan movimientos; las correcciones son reversos</span></div><div class="trh" style="{GK}"><span>Fecha</span><span>Tipo</span><span>Detalle</span><span>Bodega</span><span>Cant.</span><span>Costo</span><span>Saldo</span></div>{filas_kx}</div>
{taller}
  <div style="display:{{{{t.recuperar}}}};flex-direction:column;overflow:auto;padding:14px;gap:10px">
   {''.join(f'<div style="display:flex;align-items:center;gap:12px;padding:12px 14px;border:1px solid #FDE68A;background:#FFFBEB;border-radius:14px"><span class="av" style="background:#FEF3C7;color:#92400E">{s("barra",16)}</span><div><b>{a}</b><div style="font-size:12px;color:#92400E">{b}</div></div><button class="btn o" style="margin-left:auto;padding:6px 12px">Crear orden de retiro (Iris)</button><button class="btn o" style="padding:6px 12px">Recibido</button></div>' for a,b in [('Router TP-Link C6 · 2231500712','S-000318 · retirado 15 nov · Calle 5, zona 2'),('ONU ZTE F660 · ZTEG77AB12CD','S-000150 · retirado 10 nov · Aldea El Rosario'),('ONU ZTE F660 · ZTEG55CD98EF','S-000099 · retirado 2 nov · 3 intentos')])}
   <div style="display:flex;align-items:center;gap:10px;padding:12px 14px;border:1px dashed #FCA5A5;border-radius:14px;font-size:13px">{s('alerta',16,'#B91C1C')}<span>Si no se recupera, «Declarar no recuperado» lo da de baja como pérdida y ofrece <b>cobrarlo al cliente</b> con un cargo «Equipo no devuelto».</span></div>
   <div class="sec" style="margin:8px 0 0">No recuperados (este año)</div>
   {NOREC}
  </div>
 </section>
</main>
{drawerU}
{modalC}"""
logicI="""class Component extends DCLogic {
renderVals() {
const st = this.state || {};
%s
return { t, tabs, verU: st.u ? 'flex' : 'none', abrirUnidad: () => this.setState({ u: true }), cerrarU: () => this.setState({ u: false }), verC: st.c ? 'flex' : 'none', abrirCambio: () => this.setState({ c: true, u: false }), cerrarC: () => this.setState({ c: false }) };
}
}""" % tabsLogic([['existencias','Existencias',''],['unidades','Equipos (serie/MAC)',''],['kardex','Kardex',''],['recuperar','Por recuperar','3'],['taller','Revisión y garantía','4']],'existencias')
open('NuevoInventario.dc.html','w').write(guardar('Inventario',inv,logicI))
# ===== 2. BODEGAS + TRASLADO =====
bods=[('caja2','#EEF2FF','#4338CA','Bodega central','Lugar · Oficina zona 1','Q 21,480.00','184 artículos · 63 equipos',''),('cli','#DCFCE7','#166534','Luis (técnico)','Vehículo P-123ABC','Q 3,120.00','186 artículos · 8 equipos',''),('cli','#DCFCE7','#166534','Pedro (técnico)','Moto M-456DEF','Q 1,210.00','218 artículos · 3 equipos','1 traslado en camino'),('camion','#E0F2FE','#0369A1','En tránsito','Virtual · no se opera a mano','Q 1,041.00','T-0046 a Pedro','')]
cards=''.join(f'<div class="card" style="padding:16px;display:flex;flex-direction:column;gap:10px"><div style="display:flex;gap:10px;align-items:center"><span class="av" style="background:{bg};color:{fg}">{s(i,18)}</span><div><b>{n}</b><div style="font-size:12px;color:#64748B">{sub}</div></div><button class="ib" style="margin-left:auto">{s("mas",15)}</button></div><b class="num" style="font-size:20px">{v}</b><div style="font-size:12px;color:#64748B">{d}</div>{f"<span class=\'b wa\' style=\'align-self:flex-start\'>{x}</span>" if x else ""}</div>' for i,bg,fg,n,sub,v,d,x in bods)
lin=lambda prod,tipo,cant,extra: f'<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-top:1px solid #F1F5F9"><span class="av" style="width:32px;height:32px;border-radius:10px;background:{"#EEF2FF" if tipo=="serie" else "#F1F5F9"};color:{"#4338CA" if tipo=="serie" else "#475569"}">{s("barra" if tipo=="serie" else "caja2",15)}</span><div style="flex:1;min-width:0"><b style="font-size:14px">{prod}</b><div style="font-size:12px;color:#64748B">{extra}</div></div><div class="in" style="width:70px;justify-content:center;padding:6px">{cant}</div><button class="ib">{s("cerrar",14)}</button></div>'
nuevo=f"""<div style="position:absolute;inset:0;background:rgba(15,23,42,.35);z-index:8;display:{{{{verT}}}}"></div>
<aside class="drw" style="display:{{{{verT}}}};width:560px"><header style="display:flex;gap:12px;align-items:center;padding:16px 18px;border-bottom:1px solid #F1F5F9"><span class="av" style="background:#E0F2FE;color:#0369A1">{s('camion',18)}</span><div><b style="font-size:17px">Nuevo traslado</b><div style="font-size:12px;color:#64748B">Sale ahora; queda «en tránsito» hasta que lo reciban</div></div><button class="ib" style="margin-left:auto" onClick="{{{{cerrarT}}}}">{s('cerrar',16)}</button></header>
<div style="flex:1;overflow:auto;padding:16px 18px;display:flex;flex-direction:column;gap:14px">
 <div style="display:flex;align-items:center;gap:10px"><div style="flex:1">{fld('Desde','Bodega central',True)}</div><span style="margin-top:18px;color:#4338CA">{s('flecha',20)}</span><div style="flex:1">{fld('Hacia','Pedro (técnico)',True)}</div></div>
 <div><div style="display:flex;align-items:center"><div class="lb" style="font-size:12px">Qué va</div><span style="margin-left:auto;font-size:12px;color:#64748B">Existencia en central al lado de cada uno</span></div>
  <div class="in" style="color:#94A3B8">{s('bus',15)}Buscar producto o escanear serie/MAC<span style="margin-left:auto">{s('barra',16)}</span></div>
  <div style="border:1px solid #E2E8F0;border-radius:14px;overflow:hidden;margin-top:8px">{lin('ONU ZTE F660','serie','3','Series: ZTEG9F8E7D6C, ZTEG1122AABB, ZTEG3344CCDD · hay 42')}{lin('Cable drop 1 hilo (m)','cantidad','300','Metros · hay 2,400')}{lin('Conector SC/APC','cantidad','20','Hay 35 · quedará bajo el mínimo').replace('Hay 35 · quedará bajo el mínimo','<span style=color:#B45309>Hay 35 · quedará bajo el mínimo</span>')}</div></div>
 {fld('Motivo','Reposición semanal')}
 <div style="font-size:12px;color:#64748B;line-height:1.5">{s('ayuda',13)} El técnico confirma en Iris con su firma, aunque no tenga señal. Si falta algo al recibir, regresa a la bodega de origen.</div>
</div>
<footer style="display:flex;gap:8px;padding:14px 18px;border-top:1px solid #F1F5F9"><span style="font-size:13px;color:#64748B;align-self:center">3 productos · Q 1,350.00</span><button class="btn p" style="margin-left:auto">{s('camion',15)}Enviar traslado</button></footer></aside>"""
GT='grid-template-columns:90px 1.6fr 1fr 130px 1.2fr 40px'
tras=[('T-0046','Central → Pedro','20 nov 17:05','wa','En camino','3 productos · Q 1,041.00'),('T-0045','Central → Luis','20 nov 08:30','ok','Recibido con firma','5 productos · Q 1,550.00'),('T-0044','Luis → Central','18 nov 16:00','er','Con faltante','1 conector regresó a Luis')]
filas_t=''.join(f'<div class="tr" style="{GT}"><span class="mono">{a}</span><b>{b}</b><span style="color:#64748B;font-size:13px">{c}</span><span class="b {d}">{e}</span><span style="font-size:13px">{f}</span><button class="ib">{s("der",14)}</button></div>' for a,b,c,d,e,f in tras)
bod=f"""{rail('inv')}
{HEADER}
<main style="position:absolute;left:108px;right:16px;top:76px;bottom:16px;padding:8px 4px;display:flex;flex-direction:column;gap:14px">
 <div style="display:flex;align-items:flex-end;gap:12px"><div><div style="font-size:13px;color:#64748B">Inventario › Bodegas</div><h1 style="margin:2px 0 0;font-size:26px">Bodegas y traslados</h1></div>
  <div style="margin-left:auto;display:flex;gap:8px"><button class="btn o">{s('mas1',15)}Nueva bodega</button><button class="btn p" onClick="{{{{abrirT}}}}">{s('camion',15)}Nuevo traslado</button></div></div>
 <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px">{cards}</div>
 <section class="card" style="flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column">
  <div style="display:flex;align-items:center;gap:8px;padding:12px 14px"><b>Traslados</b><span class="fc on" style="margin-left:12px">Todos</span><span class="fc">En camino<span class="c">1</span></span><span class="fc">Con faltante</span></div>
  <div class="trh" style="{GT}"><span>Número</span><span>De → a</span><span>Enviado</span><span>Estado</span><span>Contenido</span><span></span></div>
  <div style="overflow:auto">{filas_t}</div>
 </section>
</main>
{nuevo}"""
logicB="""class Component extends DCLogic {
renderVals() {
const st = this.state || {};
return { verT: st.t ? 'flex' : 'none', abrirT: () => this.setState({ t: true }), cerrarT: () => this.setState({ t: false }) };
}
}"""
open('NuevoBodegas.dc.html','w').write(guardar('Bodegas y traslados',bod,logicB))
# ===== 3. CONTEO =====
GC='grid-template-columns:2fr 110px 140px 110px 120px'
cont=[('ONU ZTE F660 (serie)','42','42 ✓ escaneadas','ok','0',''),('Cable drop 1 hilo (m)','2,400','2,380','er','− 20','− Q 22.00'),('Conector SC/APC','35','35','ok','0',''),('Grapas para cable','900','920','wa','+ 20','+ Q 3.00'),('Router TP-Link C6 (serie)','18','17 · falta 2231500455','er','− 1','− Q 285.00')]
filas_c=''.join(f'<div class="tr" style="{GC}"><b>{a}</b><span class="num" style="color:#64748B">{b}</span><div class="in" style="padding:6px 10px;font-weight:700;{"border-color:#4F46E5" if d!="ok" else ""}">{c}</div><span class="b {d}">{e}</span><b class="num" style="color:{"#B91C1C" if f.startswith("−") else "#166534"}">{f}</b></div>' for a,b,c,d,e,f in cont)
conteo=f"""{rail('inv')}
{HEADER}
<main style="position:absolute;left:108px;right:16px;top:76px;bottom:16px;padding:8px 4px;display:flex;flex-direction:column;gap:14px">
 <div style="display:flex;align-items:flex-end;gap:12px"><div><div style="font-size:13px;color:#64748B">Inventario › Conteos</div><h1 style="margin:2px 0 0;font-size:26px">Conteo C-012 · Bodega central</h1></div><span class="b wa" style="margin-bottom:6px">Abierto · 21 nov 07:30</span>
  <div style="margin-left:auto;display:flex;gap:8px"><button class="btn o">{s('barra',15)}Escanear series</button><button class="btn o">{s('imp',15)}Hoja para contar</button></div></div>
 <div style="display:flex;gap:16px;flex:1;min-height:0">
  <section class="card" style="flex:1;min-width:0;overflow:hidden;display:flex;flex-direction:column">
   <div style="display:flex;align-items:center;gap:8px;padding:12px 14px"><b>Lo contado</b><span class="fc on" style="margin-left:12px">Todos</span><span class="fc">Con diferencia<span class="c">3</span></span><span class="fc">Sin contar</span></div>
   <div class="trh" style="{GC}"><span>Producto</span><span>Sistema</span><span>Contado</span><span>Diferencia</span><span>Valor</span></div>
   <div style="overflow:auto">{filas_c}</div></section>
  <aside class="card" style="width:320px;flex:0 0 320px;padding:16px;display:flex;flex-direction:column;gap:10px;align-self:flex-start">
   <b>Antes de cerrar</b>
   <div style="display:flex;justify-content:space-between;font-size:14px"><span style="color:#64748B">Faltante</span><b class="num" style="color:#B91C1C">− Q 307.00</b></div>
   <div style="display:flex;justify-content:space-between;font-size:14px"><span style="color:#64748B">Sobrante</span><b class="num" style="color:#166534">+ Q 3.00</b></div>
   <div style="display:flex;justify-content:space-between;font-size:15px;border-top:1px solid #E2E8F0;padding-top:8px"><b>Ajuste neto</b><b class="num" style="color:#B91C1C">− Q 304.00</b></div>
   <div style="font-size:12px;color:#64748B">Al cerrar se ajusta el kardex y la contabilidad con estos montos. El router que falta queda marcado como perdido.</div>
   <div class="in ph" style="min-height:44px">Observaciones (obligatorio con diferencias)</div>
   <button class="btn v" style="justify-content:center">{s('check',15)}Cerrar conteo y ajustar</button>
  </aside>
 </div>
</main>"""
open('NuevoConteo.dc.html','w').write(guardar('Conteo físico',conteo,"class Component extends DCLogic {\nrenderVals() { return {}; }\n}"))
# ===== 4. MI BODEGA (teléfono) =====
mb=f"""<div style="position:absolute;inset:0;display:flex;flex-direction:column;background:#F4F6FB">
 <div style="display:flex;align-items:center;gap:10px;padding:14px 16px 8px"><div class="av" style="background:#DCFCE7;color:#166534">LU</div><div style="flex:1"><b style="font-size:16px;display:block">Mi bodega</b><span style="font-size:11px;color:#64748B">Luis · vehículo P-123ABC</span></div><span class="f ci" style="width:38px;height:38px">{s('barra',17)}</span></div>
 <div style="padding:0 12px;display:flex;flex-direction:column;gap:10px;overflow:auto;flex:1;padding-bottom:90px">
  <div class="card" style="padding:12px 14px;display:flex;align-items:center;gap:10px;border-color:#BAE6FD;background:#F0F9FF"><span class="av" style="background:#E0F2FE;color:#0369A1">{s('camion',16)}</span><div style="flex:1"><b style="font-size:14px">Traslado T-0046 por recibir</b><div style="font-size:12px;color:#0369A1">3 productos desde Central</div></div><button class="btn p" style="padding:8px 12px">Recibir</button></div>
  <div class="card" style="overflow:hidden"><div class="sec" style="margin:10px 14px 4px">Equipos (8)</div>
   {''.join(f'<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-top:1px solid #F1F5F9"><span class="av" style="width:32px;height:32px;border-radius:10px;background:#EEF2FF;color:#4338CA">{s("barra",15)}</span><div style="min-width:0"><b style="font-size:14px">{a}</b><div class="mono" style="font-size:11px;color:#64748B">{b}</div></div></div>' for a,b in [('ONU ZTE F660','ZTEG5566AA77'),('ONU ZTE F660','ZTEG8899BB00'),('Router TP-Link C6','2231500801')])}
   <div style="padding:8px 14px;border-top:1px solid #F1F5F9"><a href="#" style="font-size:13px;font-weight:600">Ver los 8</a></div></div>
  <div class="card" style="overflow:hidden"><div class="sec" style="margin:10px 14px 4px">Materiales</div>
   {''.join(f'<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-top:1px solid #F1F5F9"><span class="av" style="width:32px;height:32px;border-radius:10px;background:#F1F5F9;color:#475569">{s("caja2",15)}</span><b style="font-size:14px;flex:1">{a}</b><b class="num" style="color:{c}">{b}</b></div>' for a,b,c in [('Cable drop (m)','180','#0F172A'),('Conector SC/APC','4','#B91C1C'),('Grapas','150','#0F172A')])}
  </div>
 </div>
 <div style="position:absolute;left:0;right:0;bottom:0;background:#fff;border-top:1px solid #E6E8F0;padding:10px 12px 16px;display:flex;gap:8px"><button class="btn o" style="flex:1;justify-content:center">Devolver a central</button><button class="btn p" style="flex:1;justify-content:center">Pedir material</button></div>
</div>"""
hm=page('Mi bodega',mb,844,"class Component extends DCLogic {\nrenderVals() { return {}; }\n}").replace('</style>',CSSF+CSSTG+CSSC+ICSS+CSSP+CSSI+'</style>',1).replace('"width":1440,"height":844','"width":390,"height":844').replace('height:844px;background','height:100vh;background')
open('NuevoMiBodega.dc.html','w').write(hm)
print('ok')
