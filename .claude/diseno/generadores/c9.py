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
fila_den='<sc-for list="{{{L}}}" as="d" hint-placeholder-count="6"><div class="den2"><span class="v" style="background:{{d.bg}};color:{{d.fg}}">{{d.t}}</span><div class="st"><button onClick="{{d.menos}}">−</button><span class="q">{{d.n}}</span><button onClick="{{d.mas}}">+</button></div><span class="sub">{{d.subTxt}}</span></div></sc-for>'
resumen=f"""<div style="width:300px;flex:0 0 300px;background:#F8FAFC;border-radius:18px;padding:16px;display:flex;flex-direction:column;align-self:flex-start">
  <b style="font-size:14px;margin-bottom:6px">Efectivo en caja</b>
  <div class="rs" style="border-top:0"><span>Fondo inicial</span><b class="num">Q 500.00</b></div>
  <div class="rs"><span>Cobros en efectivo (18)</span><b class="num">Q 2,450.50</b></div>
  <div class="rs"><span>Retiros</span><b class="num">− Q 300.00</b></div>
  <div class="rs" style="border-top:1.5px solid #E2E8F0"><span style="color:#0F172A;font-weight:600">Debe haber</span><b class="num" style="font-size:18px">Q 2,650.50</b></div>
  <div class="rs"><span style="color:#0F172A;font-weight:600">Contado</span><b class="num" style="font-size:18px">{{{{contadoTxt}}}}</b></div>
  <div style="margin-top:10px;border-radius:14px;padding:12px;background:{{{{difBg}}}};color:{{{{difCol}}}};display:flex;align-items:center;gap:8px"><b style="font-size:13px">{{{{difLbl}}}}</b><b class="num" style="margin-left:auto;font-size:20px">{{{{difTxt}}}}</b></div>
  <div style="font-size:12px;color:#64748B;margin-top:8px">{{{{difAyuda}}}}</div>
</div>"""
paso1=f"""<div style="display:{{{{p1}}}};gap:18px;flex:1;min-height:0">
  <div style="flex:1;min-width:0;overflow:auto;display:flex;flex-direction:column;gap:12px;padding-right:4px">
    <div style="display:flex;align-items:center;gap:8px"><b style="font-size:15px">Cuenta el efectivo</b><span style="font-size:12px;color:#64748B">cantidad de billetes y monedas</span><button class="lnk" style="margin-left:auto" onClick="{{{{limpiar}}}}">Poner en cero</button></div>
    <div style="font-size:12px;font-weight:700;letter-spacing:.05em;color:#94A3B8">BILLETES</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">{fila_den.replace('{{{L}}}','{{billetes}}')}</div>
    <div style="font-size:12px;font-weight:700;letter-spacing:.05em;color:#94A3B8;margin-top:4px">MONEDAS</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">{fila_den.replace('{{{L}}}','{{monedas}}')}</div>
  </div>
  {resumen}
</div>"""
met=lambda ico,bg,fg,n,cnt,mon,extra: f'<div style="display:flex;align-items:center;gap:12px;padding:12px 14px;border-top:1px solid #F1F5F9"><span class="av" style="width:36px;height:36px;border-radius:11px;background:{bg};color:{fg}">{s(ico,17)}</span><div><b style="font-size:14px">{n}</b><div style="font-size:12px;color:#64748B">{cnt}</div></div><div style="margin-left:auto;text-align:right">{extra}</div><b class="num" style="width:110px;text-align:right">{mon}</b></div>'
paso2=f"""<div style="display:{{{{p2}}}};flex-direction:column;gap:14px;flex:1;min-height:0;overflow:auto">
  <b style="font-size:15px">Revisa el día</b>
  <div style="border:1px solid #E6E8F0;border-radius:16px;overflow:hidden;flex-shrink:0">
    <div style="display:flex;padding:8px 14px;background:#F8FAFC;font-size:11px;font-weight:700;letter-spacing:.05em;color:#64748B"><span>MÉTODO</span><span style="margin-left:auto;width:110px;text-align:right">TOTAL</span></div>
    {met('cob','#DCFCE7','#166534','Efectivo','18 cobros · contado','Q 2,450.50','<span class="b {{difCls}}">{{difCorto}}</span>')}
    {met('tarjeta','#EEF2FF','#4338CA','Tarjeta','6 cobros · cuadrar con el cierre del POS','Q 1,250.00','<span class="b ok">Cuadra</span>')}
    {met('rayo','#E0F2FE','#0369A1','Transferencias','5 cobros · se concilian en Bancos','Q 1,000.00','<span class="b ne">Informativo</span>')}
    {met('banco','#F1F5F9','#475569','Depósitos','2 cobros · se concilian en Bancos','Q 400.00','<span class="b ne">Informativo</span>')}
    <div style="display:flex;align-items:center;padding:12px 14px;border-top:1.5px solid #E2E8F0"><b>Total cobrado hoy</b><span style="font-size:12px;color:#64748B;margin-left:8px">31 cobros · 2 anulados</span><b class="num" style="margin-left:auto;font-size:18px">Q 5,100.50</b></div>
  </div>
  <div style="display:{{{{verMotivo}}}};flex-direction:column;gap:10px;border:1.5px solid #FDE68A;background:#FFFBEB;border-radius:16px;padding:14px">
    <b style="font-size:14px;color:#92400E">Hay una diferencia de {{{{difTxt}}}}: explica por qué</b>
    <div style="display:flex;gap:6px;flex-wrap:wrap"><span class="fc on">Faltó cambio</span><span class="fc">Error al cobrar</span><span class="fc">Billete falso</span><span class="fc">Otro</span></div>
    <div class="in ph" style="min-height:44px;background:#fff">Nota (obligatoria)</div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
    <div><div class="lb" style="font-size:12px">Fondo que queda para mañana</div><div class="in">Q 500.00</div></div>
    <div><div class="lb" style="font-size:12px">Entrega a</div><div class="in sel">Supervisor · Luis</div></div>
  </div>
</div>"""
paso3=f"""<div style="display:{{{{p3}}}};flex-direction:column;align-items:center;justify-content:center;gap:14px;flex:1;text-align:center">
  <span style="width:78px;height:78px;border-radius:999px;background:#DCFCE7;color:#166534;display:flex;align-items:center;justify-content:center">{s('check',38)}</span>
  <b style="font-size:22px">Caja cerrada</b>
  <div style="font-size:14px;color:#475569">Caja 1 · Ana · 07:02 a 16:16 · corte <span class="mono">C-0311</span></div>
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;width:520px;max-width:100%">
    <div class="kpi"><div class="l">Cobrado</div><b class="num">Q 5,100.50</b></div>
    <div class="kpi"><div class="l">Efectivo a entregar</div><b class="num">{{{{entregarTxt}}}}</b></div>
    <div class="kpi"><div class="l">Diferencia</div><b class="num" style="color:{{{{difCol}}}}">{{{{difTxt}}}}</b></div>
  </div>
  <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center"><button class="btn o">{s('imp',15)}Imprimir corte (POS)</button><button class="btn o">{s('imp',15)}Carta</button><button class="btn o">{s('banco',15)}Registrar depósito al banco</button></div>
  <button class="btn p" style="padding:12px 24px" onClick="{{{{reiniciar}}}}">Listo</button>
</div>"""
pasos='<div style="display:flex;align-items:center;gap:10px;flex:1;max-width:460px;margin:0 auto">'+'<span class="pz {{c1}}"><span class="n">{{n1}}</span>Contar</span><span class="raya"></span><span class="pz {{c2}}"><span class="n">{{n2}}</span>Revisar</span><span class="raya"></span><span class="pz {{c3}}"><span class="n">3</span>Cerrada</span></div>'
modal=f"""<div style="position:absolute;inset:0;background:rgba(15,23,42,.45);z-index:8"></div>
<div class="mod" role="dialog" aria-label="Cerrar caja">
  <header style="display:flex;align-items:center;gap:12px;padding:16px 22px;border-bottom:1px solid #F1F5F9">
    <span class="av" style="background:#DCFCE7;color:#166534">{s('caja',18)}</span>
    <div><b style="font-size:17px">Cerrar Caja 1</b><div style="font-size:12px;color:#64748B">Ana · abierta 07:02 · 9 h 14 min</div></div>
    {pasos}
    <button class="ib" title="Ayuda: cierre de caja (manual)" style="cursor:help">{s('ayuda')}</button><button class="ib" title="Cerrar sin terminar">{s('cerrar',16)}</button>
  </header>
  <div style="flex:1;min-height:0;padding:18px 22px;display:flex;flex-direction:column">{paso1}{paso2}{paso3}</div>
  <footer style="display:{{{{verPie}}}};align-items:center;gap:10px;padding:14px 22px;border-top:1px solid #F1F5F9;background:#FCFCFE">
    <span style="font-size:13px;color:#64748B">{{{{pieTxt}}}}</span><span style="flex:1"></span>
    <button class="btn o" style="margin-left:auto;display:{{{{verAtras}}}}" onClick="{{{{atras}}}}">{s('izq',15)}Atrás</button>
    <button class="btn p" style="display:{{{{verSig}}}}" onClick="{{{{siguiente}}}}">Revisar{s('der',15)}</button>
    <button class="btn v" style="display:{{{{verCerrar}}}};padding:11px 20px" onClick="{{{{cerrar}}}}">{s('check',15)}Cerrar caja</button>
  </footer>
</div>"""
fondo=f"""{rail('dia')}
{HEADER}
<main style="position:absolute;left:108px;right:16px;top:76px;bottom:16px;padding:8px 4px;display:flex;gap:16px;filter:blur(1px)">
  <section class="isla" style="flex:1;border-radius:20px"></section><aside class="tk" style="width:440px"></aside>
</main>
{modal}"""
B=[(20000,'Q 200','#EDE9FE','#5B21B6',2),(10000,'Q 100','#FEE2E2','#991B1B',12),(5000,'Q 50','#FEF3C7','#92400E',9),(2000,'Q 20','#DBEAFE','#1E40AF',18),(1000,'Q 10','#FEE2E2','#B91C1C',11),(500,'Q 5','#EDE9FE','#6D28D9',7),(100,'Q 1','#DCFCE7','#166534',6)]
M=[(100,'Q 1.00','#F1F5F9','#334155',0),(50,'50 ¢','#F1F5F9','#334155',4),(25,'25 ¢','#F1F5F9','#334155',2),(10,'10 ¢','#F1F5F9','#334155',0),(5,'5 ¢','#F1F5F9','#334155',0),(1,'1 ¢','#F1F5F9','#334155',0)]
logic="""class Component extends DCLogic {
renderVals() {
const st = this.state || {};
const B = %s, M = %s;
const cant = st.cant || {};
const n = (k, d) => (cant[k] != null ? cant[k] : d);
const q = (c) => 'Q ' + (c / 100).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fila = (pref) => ([v, t, bg, fg, d], i) => { const k = pref + i; const c = n(k, d);
  return { t, bg, fg, n: c, subTxt: q(v * c), mas: () => this.setState({ cant: { ...cant, [k]: c + 1 } }), menos: () => this.setState({ cant: { ...cant, [k]: Math.max(0, c - 1) } }) }; };
const contado = B.reduce((a, [v, , , , d], i) => a + v * n('b' + i, d), 0) + M.reduce((a, [v, , , , d], i) => a + v * n('m' + i, d), 0);
const esperado = 265050;
const dif = contado - esperado;
const paso = st.paso || 1;
const ir = (p) => () => this.setState({ paso: p });
return {
  billetes: B.map(fila('b')), monedas: M.map(fila('m')),
  contadoTxt: q(contado), difTxt: (dif > 0 ? '+ ' : dif < 0 ? '− ' : '') + q(Math.abs(dif)),
  difLbl: dif === 0 ? 'Cuadra' : (dif < 0 ? 'Falta' : 'Sobra'),
  difBg: dif === 0 ? '#DCFCE7' : (dif < 0 ? '#FEE2E2' : '#FEF3C7'), difCol: dif === 0 ? '#166534' : (dif < 0 ? '#B91C1C' : '#92400E'),
  difCls: dif === 0 ? 'ok' : (dif < 0 ? 'er' : 'wa'), difCorto: dif === 0 ? 'Cuadra' : (dif < 0 ? 'Falta ' : 'Sobra ') + (dif ? q(Math.abs(dif)) : ''),
  difAyuda: dif === 0 ? 'Todo cuadra. Puedes revisar y cerrar.' : 'Vuelve a contar. Si la diferencia sigue, en el siguiente paso explicas el motivo.',
  limpiar: () => { const z = {}; B.forEach((_, i) => { z['b' + i] = 0; }); M.forEach((_, i) => { z['m' + i] = 0; }); this.setState({ cant: z }); },
  p1: paso === 1 ? 'flex' : 'none', p2: paso === 2 ? 'flex' : 'none', p3: paso === 3 ? 'flex' : 'none',
  c1: paso > 1 ? 'ok' : 'on', n1: paso > 1 ? '✓' : '1', c2: paso > 2 ? 'ok' : (paso === 2 ? 'on' : ''), n2: paso > 2 ? '✓' : '2', c3: paso === 3 ? 'ok' : '',
  verMotivo: dif !== 0 ? 'flex' : 'none',
  verPie: paso < 3 ? 'flex' : 'none', verAtras: paso === 2 ? 'inline-flex' : 'none', verSig: paso === 1 ? 'inline-flex' : 'none', verCerrar: paso === 2 ? 'inline-flex' : 'none',
  pieTxt: paso === 1 ? 'Contado ' + q(contado) + ' · debe haber ' + q(esperado) : 'Al cerrar ya no se pueden registrar cobros en esta caja.',
  siguiente: ir(2), atras: ir(1), cerrar: ir(3), reiniciar: () => this.setState({ paso: 1 }),
  entregarTxt: q(Math.max(0, contado - 50000))
};
}
}""" % (json.dumps(B), json.dumps(M))
html=page('Cerrar caja',fondo,900,logic).replace('</style>',CSSF+CSSTG+CSSC+ICSS+CSSP+CSSK+'html,body{height:100%;overflow:hidden}</style>',1).replace('height:900px;background','height:100vh;min-height:560px;background')
open('NuevoCierreCaja.dc.html','w').write(html)
# móvil
movil=f"""<div style="position:absolute;inset:0;display:flex;flex-direction:column;background:#fff">
 <div style="display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid #F1F5F9"><span class="ib" style="width:38px;height:38px;border:1px solid #E2E8F0;border-radius:999px">{s('cerrar',16)}</span><div style="flex:1"><b style="font-size:16px;display:block">Cerrar Caja 1</b><span style="font-size:11px;color:#64748B">Paso {{{{pasoN}}}} de 3 · {{{{pasoNom}}}}</span></div></div>
 <div style="flex:1;min-height:0;overflow:auto;padding:12px 14px;display:flex;flex-direction:column;gap:10px">
  <div style="display:{{{{p1}}}};flex-direction:column;gap:8px">
   <div style="font-size:12px;font-weight:700;color:#94A3B8">BILLETES</div>{fila_den.replace('{{{L}}}','{{billetes}}').replace('class="den2"','class="den2" style="padding:6px 8px"')}
   <div style="font-size:12px;font-weight:700;color:#94A3B8;margin-top:4px">MONEDAS</div>{fila_den.replace('{{{L}}}','{{monedas}}').replace('class="den2"','class="den2" style="padding:6px 8px"')}
  </div>
  {paso2.replace('grid-template-columns:1fr 1fr;gap:12px','grid-template-columns:1fr;gap:10px').replace('width:110px','width:auto')}
  {paso3.replace('width:520px','width:100%').replace('grid-template-columns:repeat(3,1fr)','grid-template-columns:1fr')}
 </div>
 <div style="display:{{{{verPie}}}};flex-direction:column;gap:10px;padding:10px 16px 16px;border-top:1px solid #E6E8F0;box-shadow:0 -8px 24px rgba(15,23,42,.06)">
  <div style="display:flex;align-items:center;gap:8px"><span style="font-size:12px;color:#64748B">Contado</span><b class="num">{{{{contadoTxt}}}}</b><span class="b {{{{difCls}}}}" style="margin-left:auto">{{{{difCorto}}}}</span></div>
  <div style="display:flex;gap:8px"><button class="btn o" style="display:{{{{verAtras}}}};padding:12px 14px" onClick="{{{{atras}}}}">Atrás</button><button class="btn p" style="flex:1;justify-content:center;padding:12px;display:{{{{verSig}}}}" onClick="{{{{siguiente}}}}">Revisar</button><button class="btn v" style="flex:1;justify-content:center;padding:12px;display:{{{{verCerrar}}}}" onClick="{{{{cerrar}}}}">Cerrar caja</button></div>
 </div>
</div>"""
lm=logic.replace("  entregarTxt:","  pasoN: String(paso), pasoNom: ['Contar', 'Revisar', 'Cerrada'][paso - 1],\n  entregarTxt:")
hm=page('Cerrar caja en el teléfono',movil,844,lm).replace('</style>',CSSF+CSSTG+CSSC+ICSS+CSSP+CSSK+'html,body{height:100%;overflow:hidden}.den2 .sub{width:78px}</style>',1).replace('"width":1440,"height":844','"width":390,"height":844').replace('height:844px;background','height:100vh;background')
open('NuevoCierreCajaMovil.dc.html','w').write(hm)
c=json.load(open('canvas.json'))
c['boards']['NuevoCierreCaja.dc.html']={"x":0,"y":11820,"w":1440,"h":900,"title":"Cierre de caja · contar, revisar y cerrar (interactiva)","expand":"fill","page":"novedades","is_interactive":True}
c['boards']['NuevoCierreCajaMovil.dc.html']={"x":1520,"y":11820,"w":390,"h":844,"title":"Cierre de caja · teléfono (interactiva)","expand":"fill","page":"novedades","is_interactive":True}
for k in ['NuevoCierreCaja.dc.html','NuevoCierreCajaMovil.dc.html']:
    if k not in c['order']: c['order'].append(k)
json.dump(c,open('canvas.json','w'),ensure_ascii=False)
print('ok')
