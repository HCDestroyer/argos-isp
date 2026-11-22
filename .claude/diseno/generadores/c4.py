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
.seg{display:inline-flex;gap:2px;padding:4px;border-radius:12px;background:#F1F5F9}
.seg button{border:0;background:transparent;font-family:inherit;font-size:13px;font-weight:600;color:#64748B;padding:7px 14px;border-radius:9px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.seg button.on{background:#fff;color:#4338CA;box-shadow:0 2px 8px rgba(15,23,42,.1)}
.rt{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:10px;cursor:pointer;border:0;background:transparent;font-family:inherit;width:100%;text-align:left;color:#0F172A}
.rt:hover{background:#F8FAFC}.rt.on{background:#EEF2FF}.rt.off{cursor:not-allowed;opacity:.62}
.rt .ri{width:32px;height:32px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex:0 0 auto;background:#F1F5F9;color:#475569;position:relative}
.rt .dot{position:absolute;right:-2px;bottom:-2px;width:10px;height:10px;border-radius:999px;border:2px solid #fff}
.rt .meta{font-size:12px;color:#64748B;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.chip{display:inline-flex;align-items:center;gap:7px;padding:6px 12px 6px 8px;border-radius:999px;border:1px solid #E2E8F0;background:#fff;font-family:inherit;font-size:13px;font-weight:600;color:#334155;cursor:pointer;white-space:nowrap}
.chip.on{border-color:#4F46E5;background:#EEF2FF;color:#3730A3}
.chip i{width:8px;height:8px;border-radius:999px;display:inline-block}
.redop{display:flex;align-items:center;gap:12px;border:1.5px solid #E2E8F0;border-radius:12px;padding:10px 12px;cursor:pointer;background:#fff}
.redop.on{border-color:#4F46E5;background:#EEF2FF}.redop.off{cursor:not-allowed;background:#F8FAFC;opacity:.75}
.bar{height:6px;border-radius:6px;background:#E2E8F0;overflow:hidden;width:90px;flex:0 0 auto}.bar span{display:block;height:100%;border-radius:6px}
.adv{display:flex;align-items:center;gap:8px;border:0;background:transparent;font-family:inherit;font-size:13px;font-weight:600;color:#475569;cursor:pointer;padding:6px 0}
'''
def campo(lab,val,req=False,cls='',ayuda='',ico=None):
    ph=' ph' if val.startswith('~') else ''
    v=val.lstrip('~')
    return f'<div><div class="lb">{lab}{"<span class=req>*</span>" if req else ""}</div><div class="in {cls}{ph}">{s(ico,16,"#94A3B8") if ico else ""}{v}</div>{f"<div class=ay>{ayuda}</div>" if ayuda else ""}</div>'
def op(on,tit,sub,ico=None):
    return f'<div class="op {"on" if on else ""}"><span class="rd"></span><div><b style="font-size:14px">{tit}</b><div style="font-size:12px;color:#64748B">{sub}</div></div></div>'
p1=f'''<div><p class="tit">¿Quién es el cliente?</p><p class="subt">Busca primero para no duplicarlo. Solo el nombre y un teléfono son obligatorios.</p></div>
<div style="display:flex;gap:10px;align-items:center;padding:10px 12px;border-radius:12px;background:#EEF2FF;font-size:13px;color:#3730A3">{s('ayuda',16)}<span>¿Solo está interesado o falta revisar cobertura? <b>Regístralo como prospecto</b>: lo atiende ventas en Iris y aquí se crea cuando lo instalen.</span><button class="btn o" style="margin-left:auto;padding:6px 12px">Registrar prospecto</button></div>
<div class="ok-note">{s('check',15)}No hay otro cliente con este teléfono ni con este documento.</div>
<div class="g2">{op(True,'Residencial','Persona u hogar · ve planes residenciales')}{op(False,'Empresarial','Razón social y NIT · ve planes empresariales')}</div>
<div class="g2">{campo('Nombre completo del titular','José López',True,ayuda='Como aparece en su DPI',ico='user')}{campo('DPI o pasaporte','~opcional ahora · obligatorio al instalar',ico='id')}</div>
<div><div class="lb">Teléfonos<span class="req">*</span></div>
<div style="display:flex;flex-direction:column;gap:8px">
<div style="display:flex;gap:8px;align-items:center"><div class="in" style="flex:1">{s('tel',16,'#94A3B8')}5555-8890</div><span class="b ok">WhatsApp</span><span class="b in">Principal</span><button class="ib" title="Quitar">{s('cerrar',14)}</button></div>
<div style="display:flex;gap:8px;align-items:center"><div class="in" style="flex:1">{s('tel',16,'#94A3B8')}7788-1020</div><span class="b ne">Fijo</span><button class="ib" title="Quitar">{s('cerrar',14)}</button></div>
<a href="#" style="font-size:13px;font-weight:600;display:inline-flex;gap:6px;align-items:center">{s('mas1',14)}Agregar otro número</a></div></div>
<div class="g2">{campo('Correo','~opcional',ico='mail')}{campo('Facturar a','CF',ayuda='CF o NIT del titular',ico='fac')}</div>
<div style="border:1px solid #E2E8F0;border-radius:16px;overflow:hidden"><div style="display:flex;align-items:center;padding:10px 14px;background:#F8FAFC"><b style="font-size:13px">Contactos del servicio</b><span style="font-size:12px;color:#64748B;margin-left:8px">Quien también puede escribirnos por este servicio</span><a href="#" style="margin-left:auto;font-size:13px;font-weight:600">{s('mas1',13)} Agregar</a></div>
<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-top:1px solid #EEF0F5"><span class="av" style="width:34px;height:34px;background:#FCE7F3;color:#9D174D;font-size:12px">LL</span><div><b style="font-size:14px">Luis López</b><div style="font-size:12px;color:#64748B">Hijo · 4444-1234 · WhatsApp</div></div><div style="margin-left:auto;display:flex;gap:4px;flex-wrap:wrap"><span class="b ne">Consulta</span><span class="b ne">Fallas</span><span class="b ne">Paga</span><span class="b ne">Avisos</span></div></div></div>
<div>{campo('Dirección','Zona 3, casa 14, frente a la tienda La Bendición',True,ico='mapa')}</div>
<div class="g2">{campo('Zona','Norte','', 'sel')}<div><div class="lb">Ubicación</div><div style="height:44px;border-radius:12px;border:1px dashed #A5B4FC;background:#EEF2FF;color:#4338CA;font-size:13px;font-weight:600;display:flex;align-items:center;justify-content:center;gap:6px;cursor:pointer">{s('mapa',15)}Marcar en el mapa (o usar mi ubicación)</div></div></div>'''
planes=[('Solo en Router Norte',[('RN-25','25 Mbps','25/10','Q 165',False),('RN-60','60 Mbps','60/30','Q 215',False)]),
('Todos los routers',[('R-10','10 Mbps','10/5','Q 150',False),('R-30','30 Mbps','30/15','Q 175',False),('R-50','50 Mbps','50/25','Q 200',True),('R-100','100 Mbps','100/50','Q 275',False)])]
filas_plan=''
for grupo,lst in planes:
    filas_plan+=f'<div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#94A3B8;padding:10px 12px 4px">{grupo} · {len(lst)}</div>'
    for cod,n,vel,pr,on in lst:
        filas_plan+=f'<div style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:10px;cursor:pointer;{"background:#EEF2FF;" if on else ""}"><span style="width:16px;height:16px;border-radius:999px;flex:0 0 auto;{"border:5px solid #4F46E5" if on else "border:2px solid #CBD5E1"};box-sizing:border-box"></span><b style="font-size:14px;{"color:#3730A3" if on else ""}">{n}</b><span style="font-size:12px;color:#64748B">{vel} Mbps · {cod}</span><b class="num" style="margin-left:auto;font-size:14px">{pr}<span style="font-weight:500;color:#64748B;font-size:12px">/mes</span></b></div>'
ROUTERS=[('Router Norte','Zona Norte · Guatemala','PPPoE',62,254,'on','zona del cliente'),
('Torre Centro','Zona 1 · Guatemala','PPPoE',118,254,'on',''),
('Nodo Sur','Zona 12 · Guatemala','PPPoE',9,254,'on',''),
('Cerro Alux','Mixco','PPPoE',201,508,'on',''),
('Nodo El Naranjo','Mixco','PPPoE',140,254,'on',''),
('Bodega Pinula','Santa Catarina Pinula','IP estática',40,62,'on',''),
('Torre Villa Nueva','Villa Nueva','DHCP fija',23,126,'on',''),
('Torre San Lucas','San Lucas Sacatepéquez','PPPoE',77,254,'off','sin respuesta hace 12 min'),
('Nodo Chinautla','Chinautla','PPPoE',96,254,'on',''),
('Torre Fraijanes','Fraijanes','IP estática',12,30,'on',''),
('Torre Santa Catarina','Santa Catarina Pinula','PPPoE',54,126,'on',''),
('Nodo Amatitlán','Amatitlán','PPPoE',0,254,'on','')]
def fila_router(n,ubi,tipo,lib,tot,lin,nota,on=False):
    lleno=lib==0
    dot='#16A34A' if lin=='on' else '#94A3B8'
    est='En línea' if lin=='on' else 'Sin conexión'
    ips=f'<span style="color:#B91C1C;font-weight:600">Sin IP libres</span>' if lleno else (f'<span style="color:#92400E;font-weight:600">{lib} de {tot} libres</span>' if lib*10<tot else f'{lib} de {tot} libres')
    motivo=f'<div class="meta" style="color:#B91C1C;white-space:normal">Sus redes IPv4 están llenas: agrega una red en Red › Routers</div>' if lleno else ''
    sug=f'<span class="b in" style="padding:1px 8px;font-size:11px">{nota}</span>' if nota and lin=='on' else ''
    return f'<button class="rt{" on" if on else ""}{" off" if lleno else ""}" aria-disabled="{"true" if lleno else "false"}"><span class="ri">{s("router",16)}<span class="dot" style="background:{dot}" title="{est}"></span></span><span style="min-width:0;flex:1"><span style="display:flex;align-items:center;gap:6px"><b style="font-size:14px">{n}</b>{sug}</span><div class="meta">{ubi} · {tipo} · {est if lin=="on" else nota}</div>{motivo}</span><span style="font-size:12px;color:#475569;white-space:nowrap;text-align:right" class="num">{ips}</span></button>'
LISTA_R=''.join(fila_router(*r,on=(i==0)) for i,r in enumerate(ROUTERS))
CHIPS=f'''<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><span style="font-size:12px;color:#64748B">Sugeridos</span><button class="chip on"><i style="background:#16A34A"></i>Router Norte<span style="font-weight:500;color:#6366F1">· zona del cliente</span></button><button class="chip"><i style="background:#16A34A"></i>Torre Centro</button><button class="chip"><i style="background:#16A34A"></i>Cerro Alux</button></div>'''
SELR=f'''<div style="position:relative"><button onClick="{{{{alternarRouters}}}}" style="width:100%;display:flex;align-items:center;gap:10px;border:1px solid #CBD5E1;border-radius:12px;padding:8px 12px;background:#fff;font-family:inherit;cursor:pointer;text-align:left"><span class="ri" style="width:32px;height:32px;border-radius:10px;display:flex;align-items:center;justify-content:center;background:#EEF2FF;color:#4338CA;position:relative">{s('router',16)}<span style="position:absolute;right:-2px;bottom:-2px;width:10px;height:10px;border-radius:999px;border:2px solid #fff;background:#16A34A"></span></span><span style="flex:1;min-width:0"><b style="font-size:14px;color:#0F172A">Router Norte</b><div style="font-size:12px;color:#64748B">Zona Norte · PPPoE · en línea · 62 de 254 IP libres</div></span>{s('ab',16,'#94A3B8')}</button>
<div class="card" style="display:{{{{verRouters}}}};position:absolute;left:0;right:0;top:calc(100% + 6px);z-index:8;box-shadow:0 20px 50px rgba(15,23,42,.18);overflow:hidden">
<div style="display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #F1F5F9;color:#94A3B8;font-size:14px">{s('bus',16)}Buscar por nombre, zona o tipo<span style="margin-left:auto;font-size:12px">12 routers</span></div>
<div style="max-height:420px;overflow:auto;padding:4px 6px 6px">{LISTA_R}</div></div></div>'''
REDES=[('Clientes Norte','100.64.10.0/24',62,254,True),('Clientes Norte 2','100.64.11.0/24',0,254,False),('Públicas','190.115.4.0/28',5,13,False)]
def redop(n,cidr,lib,tot,on):
    lleno=lib==0; pct=round((tot-lib)*100/tot)
    col='#B91C1C' if lleno else ('#D97706' if pct>85 else '#4F46E5')
    return f'<div class="redop{" on" if on else ""}{" off" if lleno else ""}"><span style="width:16px;height:16px;border-radius:999px;box-sizing:border-box;flex:0 0 auto;{"border:5px solid #4F46E5" if on else "border:2px solid #CBD5E1"}"></span><div style="min-width:0;flex:1"><b style="font-size:14px">{n}</b> <span class="mono" style="color:#475569">{cidr}</span><div style="font-size:12px;color:{"#B91C1C" if lleno else "#64748B"}">{"Llena: no quedan IP para entregar" if lleno else f"{lib} de {tot} libres"}</div></div><span class="bar"><span style="width:{pct}%;background:{col}"></span></span></div>'
IPBLOQUE=f'''<div style="border:1px solid #E2E8F0;border-radius:16px;padding:14px;display:flex;flex-direction:column;gap:12px">
<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap"><div class="lb" style="margin:0">{s('wifi',15,'#4338CA')}IP del servicio</div>
<div class="seg" role="radiogroup" aria-label="Cómo se asigna la IP" style="margin-left:auto"><button class="{{{{ipA}}}}" onClick="{{{{ipAuto}}}}">Automática</button><button class="{{{{ipR}}}}" onClick="{{{{ipRed}}}}">Elegir red</button><button class="{{{{ipE}}}}" onClick="{{{{ipEsc}}}}">Escribir IP</button></div></div>
<div style="display:{{{{vIpA}}}};gap:10px;align-items:center;font-size:13px;color:#475569;background:#F8FAFC;border-radius:12px;padding:10px 12px">{s('rayo',15,'#4338CA')}<span>La siguiente libre de las redes de Router Norte (<b class="mono">100.64.10.63</b> si se activa hoy). Con «Programar instalación» se asigna al activar. En routers de IP estática o DHCP fija la IP es obligatoria: «Automática» la reserva al guardar.</span></div>
<div style="display:{{{{vIpR}}}};flex-direction:column;gap:8px">{''.join(redop(*r) for r in REDES)}<div class="ay" style="margin:0">Se toma la siguiente IP libre de la red elegida.</div></div>
<div style="display:{{{{vIpE}}}};flex-direction:column;gap:6px"><div style="display:flex;align-items:center;gap:10px;border:2px solid #4F46E5;border-radius:12px;padding:10px 14px;background:#fff;box-shadow:0 0 0 4px rgba(79,70,229,.1)"><span class="mono" style="font-size:18px;color:#0F172A;flex:1">100.64.10.50</span><span class="b ok">{s('check',13)}Libre</span></div>
<div class="ay" style="margin:0">Dentro de <span class="mono">100.64.10.0/24</span> (Clientes Norte). Si otro servicio la tiene: «Ocupada por S-000123», en este mismo campo.</div></div>
<button class="adv" onClick="{{{{alternarV6}}}}" aria-expanded="{{{{v6Abierto}}}}"><span style="display:inline-flex;transform:rotate({{{{v6Giro}}}});transition:transform .15s">{s('der',14)}</span>Avanzado: IPv6<span style="font-weight:500;color:#64748B">· de fábrica: automática por servicio (/64 + /56)</span></button>
<div style="display:{{{{vV6}}}};flex-direction:column;gap:10px;padding-left:22px"><div class="g2">{campo('Modo IPv6','Prefijo estático','', 'sel')}{campo('Prefijo delegado','2800:98:1a00::/56','', ayuda='Solo en modo estático; los demás modos lo toman del pool')}</div></div>
</div>'''
p2=f'''<div><p class="tit">¿Qué servicio va a tener?</p><p class="subt">Elige el router y el plan. La IP es automática salvo que elijas la red o la escribas.</p></div>
<div style="display:flex;flex-direction:column;gap:8px"><div class="lb" style="margin:0">Router<span class="req">*</span></div>{CHIPS}{SELR}<div class="ay" style="margin:0">Busca entre todos: igual con 2 o con 50 routers. Un router sin IP libres no se puede elegir y dice por qué. El tipo de conexión lo toma del router.</div></div>
<div class="g2">{campo('Código','S-000412','', 'auto',ayuda='Automático')}{campo('Nombre del servicio','~Casa, Negocio…',ayuda='Opcional')}</div>
<div><div class="lb">Plan<span class="req">*</span></div>
<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px;font-size:12px;color:#64748B">Mostrando planes
<span class="b in">{s('user',12)}Residenciales</span>de<span class="b in">{s('router',12)}Router Norte</span>· 6 de 23
<a href="#" style="margin-left:auto">¿Por qué no veo un plan?</a></div>
<div style="border:1px solid #CBD5E1;border-radius:14px;overflow:hidden"><div style="display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #F1F5F9;color:#94A3B8;font-size:14px;cursor:text">{s('bus',16)}Buscar por nombre, velocidad o precio</div>
<div style="max-height:236px;overflow:auto;padding:2px 6px 6px">{filas_plan}</div></div>
<div class="ay">Solo salen los planes del modo del cliente (residencial o empresarial, del paso 1) asignados a todos los routers o al router elegido.</div></div>
{IPBLOQUE}
<div class="g2">{campo('Usuario PPPoE','jlopez412','', 'auto',ayuda='Generado; puedes cambiarlo',ico='llave')}{campo('Contraseña','••••••••','', 'auto',ayuda='Generada',ico='llave')}</div>
<div><div class="lb">¿Cuándo empieza?</div><div class="g2">{op(True,'Ya está instalado','Queda activo y navega desde hoy · la IP se asigna ahora')}{op(False,'Programar instalación','Crea la orden en Iris. La IP se asigna al activar; el técnico confirma titular, datos y plan')}</div></div>
<div style="display:flex;gap:10px;flex-wrap:wrap"><span class="fc">{s('mas1',14)}Precio especial</span><span class="fc">{s('mas1',14)}IP pública o adicional</span><span class="fc">{s('mas1',14)}Otra dirección</span><span class="fc">{s('mas1',14)}MAC del equipo</span></div>'''
sw_html=''.join([
 f'<div style="display:flex;align-items:center;gap:12px;padding:12px 14px;border-top:1px solid #EEF0F5"><span class="av" style="width:36px;height:36px;border-radius:11px;background:{bg};color:{fg}">{s(ico,17)}</span><div style="min-width:0"><b style="font-size:14px">{tit}</b><div style="font-size:12px;color:#64748B">{sub}</div></div><span class="tg {"on" if on else ""}" style="margin-left:auto;cursor:pointer"><i></i></span></div>'
 for ico,bg,fg,tit,sub,on in [
  ('cob','#DCFCE7','#166534','Cobrar la instalación ahora','Abre el cobro de Q 150.00 al terminar',True),
  ('mail','#EEF2FF','#4338CA','Enviar bienvenida','WhatsApp al 5555-8890 con su usuario y plan',True),
  ('router','#F1F5F9','#475569','Aplicar en el router de inmediato','Crea el usuario PPPoE en Router Norte',True)]])
p3=f'''<div><p class="tit">¿Cómo se le cobra?</p><p class="subt">Siempre el precio completo del plan, sin prorrateo. Puedes editar el monto de la primera factura.</p></div>
<div class="g2">{campo('Plantilla de facturación','Mensual · emite el 1, vence el 5','', 'sel',ayuda='Se corta el día siguiente al vencimiento si no pagó',ico='cal')}{campo('Primer periodo','Diciembre 2026','', 'sel',ico='cal')}</div>
<div><div class="lb">Primera factura</div><div class="g3">{op(True,'Desde este mes','Q 200.00 · vence 5 dic')}{op(False,'Incluir meses pasados','Hasta 24 meses atrás; vencen desde hoy')}{op(False,'Sin factura ahora','La emite el cron el 1 de dic')}</div></div>
<div class="g2">{campo('Monto de la primera factura','Q 200.00','', ayuda='Precio del plan; edítalo si acordaron otro',ico='cob')}<div></div></div>
<div><div class="lb">Instalación</div><div class="g3">{op(True,'Cargo único','Factura aparte: Q 150.00')}{op(False,'Dentro de la primera factura','Se suma como línea')}{op(False,'Sin costo','Requiere permiso y motivo')}</div></div>
<div style="border:1px solid #E2E8F0;border-radius:16px;overflow:hidden"><div style="padding:12px 14px;background:#F8FAFC;font-size:13px;font-weight:700;color:#334155">Al crear el servicio</div>
{sw_html}</div>'''
SW=True
def bloque(t,filas,ico): return f'<div style="border:1px solid #EEF0F5;border-radius:14px;padding:12px 14px"><div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">{s(ico,16,"#4338CA")}<b style="font-size:14px">{t}</b><a href="#" style="margin-left:auto;font-size:12px">Cambiar</a></div>{"".join(f"<div class=res><span>{a}</span><span>{b}</span></div>" for a,b in filas)}</div>'
p4=f'''<div><p class="tit">Revisa y crea</p><p class="subt">Al crear: queda el cliente, el servicio activo en el router, sus facturas y la bitácora.</p></div>
<div class="g2">{bloque('Cliente',[('Nombre','José López'),('Teléfono','5555-8890'),('NIT','4521873-K'),('Zona','Norte')],'user')}{bloque('Servicio',[('Plan','50 Mbps · Q 200.00/mes'),('Router','Router Norte · PPPoE'),('Usuario','jlopez412'),('IP','Automática (siguiente libre)')],'wifi')}</div>
{bloque('Cobro',[('Plantilla','Emite el 1 · vence el 5'),('Primera factura','Diciembre · Q 200.00 · vence 5 dic'),('Instalación','Cargo único · Q 150.00 · vence hoy')],'cob')}
<div style="display:flex;gap:10px;align-items:center;padding:12px 14px;border-radius:14px;background:#F8FAFC"><span class="tg on" style="pointer-events:none"><i></i></span><span style="font-size:13px">Enviar mensaje de bienvenida por WhatsApp</span><span class="tg on" style="pointer-events:none;margin-left:16px"><i></i></span><span style="font-size:13px">Cobrar la instalación ahora</span></div>'''
pasos=[('cliente','Cliente','Datos y ubicación','user'),('servicio','Servicio','Router, plan e IP','wifi'),('cobro','Cobro','Facturas e instalación','cob')]
lista_pasos='<sc-for list="{{pasos}}" as="p" hint-placeholder-count="3"><button class="pc {{p.clase}}" onClick="{{p.ir}}"><span class="n">{{p.num}}</span>{{p.nombre}}</button><span class="ln {{p.lclase}}"></span></sc-for>'
resumen_vivo=f'''<aside class="isla" style="width:280px;flex:0 0 280px;border-radius:22px;padding:18px;box-sizing:border-box;display:flex;flex-direction:column;gap:6px;align-self:flex-start">
  <span class="sec" style="margin:0 0 6px">Resumen</span>
  <div style="display:flex;gap:10px;align-items:center;margin-bottom:6px"><div class="av" style="background:#CFFAFE;color:#0E7490">JL</div><div><b style="font-size:14px">José López</b><div style="font-size:12px;color:#64748B">Residencial · Norte</div></div></div>
  <div class="res"><span>Plan</span><span>50 Mbps</span></div>
  <div class="res"><span>Mensual</span><b class="num">Q 200.00</b></div>
  <div class="res"><span>Instalación</span><b class="num">Q 150.00</b></div>
  <div class="res" style="border-top:1px solid #E2E8F0;padding-top:10px;margin-top:4px"><span style="color:#0F172A;font-weight:600">Cobra hoy</span><b class="num" style="font-size:18px;color:#166534">Q 150.00</b></div>
  <div class="ay">La mensualidad de diciembre vence el 5 dic.</div>
</aside>'''
alta=f'''{rail('dia')}
{HEADER}
<main style="position:absolute;left:108px;right:16px;top:76px;bottom:16px;display:flex;flex-direction:column;gap:12px;padding:8px 4px;align-items:center">
  <section class="isla" style="width:100%;max-width:960px;flex:1;min-height:0;border-radius:22px;display:flex;flex-direction:column;overflow:hidden">
    <header style="display:flex;align-items:center;gap:14px;padding:14px 20px;border-bottom:1px solid #F1F5F9">
      <div style="white-space:nowrap"><div style="font-size:12px;color:#64748B">Clientes › Nuevo</div><b style="font-size:18px">Nuevo cliente</b></div>
      <nav aria-label="Pasos" style="flex:1;display:flex;align-items:center;gap:6px;margin:0 10px">{lista_pasos}</nav>
      <button class="ib" title="Ayuda: alta de clientes (manual)" style="cursor:help">{s('ayuda')}</button>
      <button class="ib" title="Cerrar (guarda borrador)">{s('cerrar',16)}</button>
    </header>
    <div style="flex:1;overflow:auto;padding:22px 28px">
      <div style="display:{{{{v.cliente}}}};flex-direction:column;gap:16px">{p1}</div>
      <div style="display:{{{{v.servicio}}}};flex-direction:column;gap:16px">{p2}</div>
      <div style="display:{{{{v.cobro}}}};flex-direction:column;gap:16px">{p3}</div>
    </div>
    <footer style="display:flex;align-items:center;gap:10px;padding:12px 20px;border-top:1px solid #F1F5F9;background:#FCFCFE">
      <div style="display:flex;align-items:center;gap:8px;font-size:13px;color:#475569;min-width:0;flex-wrap:wrap">
        <span class="av" style="width:28px;height:28px;border-radius:9px;font-size:11px;background:#CFFAFE;color:#0E7490">JL</span><b>José López</b>
        <span style="color:#CBD5E1">·</span>{s('wifi',14,'#94A3B8')}50 Mbps <b class="num">Q 200/mes</b><span style="color:#CBD5E1">·</span>IP <b>{{{{ipTexto}}}}</b>
        <span style="color:#CBD5E1">·</span>Cobra hoy <b class="num" style="color:#166534">Q 150.00</b>
      </div>
      <span style="margin-left:auto;font-size:12px;color:#94A3B8;white-space:nowrap">Borrador guardado</span>
      <button class="btn o" style="display:{{{{verAtras}}}}" onClick="{{{{atras}}}}">{s('izq',15)}Atrás</button>
      <button class="btn p" style="display:{{{{verSig}}}}" onClick="{{{{siguiente}}}}">Siguiente{s('der',15)}</button>
      <button class="btn v" style="display:{{{{verCrear}}}}">{s('check',15)}Crear cliente y servicio</button>
    </footer>
  </section>
</main>
<div style="position:absolute;right:28px;bottom:28px;max-width:330px;background:#0F172A;color:#E2E8F0;border-radius:14px;padding:12px 14px;font-size:13px;line-height:1.5;z-index:7"><b style="color:#fff">Alta en 3 pasos (interactiva).</b> Router con buscador y sugeridos (sirve con 2 o con 50; sin IP libres se ve deshabilitado con el motivo). IP: Automática, Elegir red o Escribir IP (con «Libre» u «Ocupada por» al momento); IPv6 plegada en «Avanzado». Planes filtrados por modo y router.</div>'''
logic='''class Component extends DCLogic {
renderVals() {
const pasos = %s;
const i = (this.state && this.state.i) || 0;
const v = {};
pasos.forEach((p, k) => { v[p.id] = k === i ? 'flex' : 'none'; });
const ir = (k) => () => this.setState({ i: k });
return {
  v,
  pasos: pasos.map((p, k) => ({ ...p, num: k < i ? '✓' : String(k + 1), clase: k === i ? 'on' : (k < i ? 'ok' : ''), lclase: k === pasos.length - 1 ? 'fin' : (k < i ? 'ok' : ''), ir: ir(k) })),
  ...((() => { const st = this.state || {}; const ip = st.ip || 'auto'; return {
    ipA: ip === 'auto' ? 'on' : '', ipR: ip === 'red' ? 'on' : '', ipE: ip === 'esc' ? 'on' : '',
    vIpA: ip === 'auto' ? 'flex' : 'none', vIpR: ip === 'red' ? 'flex' : 'none', vIpE: ip === 'esc' ? 'flex' : 'none',
    ipAuto: () => this.setState({ ip: 'auto' }), ipRed: () => this.setState({ ip: 'red' }), ipEsc: () => this.setState({ ip: 'esc' }),
    ipTexto: ip === 'auto' ? 'automática' : (ip === 'red' ? 'de Clientes Norte' : '100.64.10.50'),
    verRouters: st.routers ? 'block' : 'none', alternarRouters: () => this.setState({ routers: !st.routers }),
    hoja: st.routers ? 'flex' : 'none',
    vV6: st.v6 ? 'flex' : 'none', v6Abierto: st.v6 ? 'true' : 'false', v6Giro: st.v6 ? '90deg' : '0deg', alternarV6: () => this.setState({ v6: !st.v6 })
  }; })()),
  verAtras: i > 0 ? 'inline-flex' : 'none',
  verSig: i < pasos.length - 1 ? 'inline-flex' : 'none',
  verCrear: i === pasos.length - 1 ? 'inline-flex' : 'none',
  atras: ir(Math.max(0, i - 1)),
  siguiente: ir(Math.min(pasos.length - 1, i + 1))
};
}
}''' % json.dumps([{'id':a,'nombre':b,'sub':c} for a,b,c,_ in pasos],ensure_ascii=False)
CSSTG='''.tg{display:inline-flex;align-items:center}.tg i{width:44px;height:26px;border-radius:999px;background:#CBD5E1;position:relative;display:inline-block}.tg i::after{content:"";position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:999px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.2)}.tg.on i{background:#16A34A}.tg.on i::after{left:21px}'''
open('NuevoAltaCliente.dc.html','w').write(page('Nuevo cliente',alta,1000,logic).replace('</style>',CSSF+CSSTG+'</style>',1))

# ---------- móvil ----------
m_pasos='<div style="display:flex;gap:6px">'+''.join(f'<span style="flex:1;height:4px;border-radius:4px;background:{{{{p{k}}}}}"></span>' for k in range(3))+'</div>'
def mbody(html): return html.replace('display:{{verRouters}};position:absolute','display:none;position:absolute').replace('class="g2"','style="display:flex;flex-direction:column;gap:12px"').replace('class="g3"','style="display:flex;flex-direction:column;gap:10px"').replace('<span style="margin-left:auto;display:flex;gap:4px">','<span style="display:none">').replace('max-height:236px','max-height:300px')
movil=f'''<div style="position:absolute;inset:0;display:flex;flex-direction:column">
  <div style="padding:12px 16px 10px;display:flex;flex-direction:column;gap:10px">
    <div style="display:flex;align-items:center;gap:10px"><span class="f ci" title="Cancelar" style="width:38px;height:38px">{s('cerrar',16)}</span><div style="flex:1"><b style="font-size:16px;display:block">Nuevo cliente</b><span style="font-size:12px;color:#64748B">Paso {{{{num}}}} de 3 · {{{{nombrePaso}}}}</span></div><span class="f ci" title="Ayuda" style="width:38px;height:38px;cursor:help">{s('ayuda',17)}</span></div>
    {m_pasos}
  </div>
  <div style="flex:1;overflow:auto;padding:4px 16px 120px">
    <section class="card" style="padding:16px">
      <div style="display:{{{{v.cliente}}}};flex-direction:column;gap:14px">{mbody(p1)}</div>
      <div style="display:{{{{v.servicio}}}};flex-direction:column;gap:14px">{mbody(p2)}</div>
      <div style="display:{{{{v.cobro}}}};flex-direction:column;gap:14px">{mbody(p3)}</div>
    </section>
  </div>
  <div style="position:absolute;inset:0;background:#fff;z-index:20;display:{{{{hoja}}}};flex-direction:column">
    <div style="display:flex;align-items:center;gap:10px;padding:12px 16px"><button class="f ci" onClick="{{{{alternarRouters}}}}" aria-label="Cerrar" style="width:38px;height:38px">{s('cerrar',16)}</button><b style="font-size:16px;flex:1">Elegir router</b><span style="font-size:12px;color:#64748B">12 routers</span></div>
    <div style="margin:0 16px 8px;display:flex;align-items:center;gap:8px;border:2px solid #4F46E5;border-radius:12px;padding:10px 12px;color:#94A3B8;font-size:15px">{s('bus',17)}Buscar por nombre, zona o tipo</div>
    <div style="padding:0 16px 6px">{CHIPS}</div>
    <div style="flex:1;overflow:auto;padding:0 10px 16px">{LISTA_R}</div>
  </div>
  <div style="position:absolute;left:0;right:0;bottom:0;background:#fff;border-top:1px solid #E6E8F0;padding:8px 12px 14px;display:flex;flex-wrap:wrap;gap:8px;box-shadow:0 -8px 24px rgba(15,23,42,.06)">
    <div style="width:100%;font-size:12px;color:#475569;display:flex;gap:6px;align-items:center">{s('wifi',13,'#94A3B8')}50 Mbps · Q 200/mes · IP {{{{ipTexto}}}}<span style="margin-left:auto">Cobra hoy <b class="num" style="color:#166534">Q 150.00</b></span></div>
    <button class="btn o" style="padding:12px 14px;display:{{{{verAtras}}}}" onClick="{{{{atras}}}}">{s('izq',15)}Atrás</button>
    <button class="btn p" style="flex:1;justify-content:center;padding:12px;font-size:15px;display:{{{{verSig}}}}" onClick="{{{{siguiente}}}}">Siguiente{s('der',16)}</button>
    <button class="btn v" style="flex:1;justify-content:center;padding:12px;font-size:15px;display:{{{{verCrear}}}}">{s('check',16)}Crear</button>
  </div>
</div>'''
logicm=logic.replace("  verAtras:","  num: String(i + 1),\n  nombrePaso: pasos[i].nombre,\n  p0: i >= 0 ? '#4F46E5' : '#E2E8F0', p1: i >= 1 ? '#4F46E5' : '#E2E8F0', p2: i >= 2 ? '#4F46E5' : '#E2E8F0',\n  verAtras:")
hm=page('Nuevo cliente en el teléfono',movil,844,logicm).replace('</style>',CSSF+CSSTG+'</style>',1).replace('"width":1440,"height":844','"width":390,"height":844')
open('NuevoAltaClienteMovil.dc.html','w').write(hm)
c=json.load(open('canvas.json'))
c['boards']['NuevoAltaCliente.dc.html']={"x":0,"y":9720,"w":1440,"h":1000,"title":"Nuevo cliente y servicio · 3 pasos, progreso arriba, planes con buscador (interactiva)","expand":"fill","page":"novedades","is_interactive":True}
c['boards']['NuevoAltaClienteMovil.dc.html']={"x":1520,"y":9720,"w":390,"h":844,"title":"Nuevo cliente · teléfono (interactiva)","expand":"fill","page":"novedades","is_interactive":True}
for k in ['NuevoAltaCliente.dc.html','NuevoAltaClienteMovil.dc.html']:
    if k not in c['order']: c['order'].append(k)
json.dump(c,open('canvas.json','w'),ensure_ascii=False)
print('ok')
