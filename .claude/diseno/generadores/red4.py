exec(open('/tmp/claude-0/-home-user/59389ade-3278-540a-8050-19c26767da8e/scratchpad/gen/red_base.py').read())
P=lambda **k:k
planes=[
 P(id=1,nom='Fibra 30',tipo='res',tipoT='Residencial',ico='casa',b='30',s='15',reuso='1:8',gar='12.5 %',lim='2 / 1',rout='Todos los routers',rg=1,cli='412',precio='Q 175.00',act=1,rl='15M/30M 18M/36M 12M/24M 16/16 8 1875k/3750k'),
 P(id=2,nom='Fibra 50',tipo='res',tipoT='Residencial',ico='casa',b='50',s='25',reuso='1:8',gar='12.5 %',lim='2 / 1',rout='Todos los routers',rg=1,cli='338',precio='Q 225.00',act=1,rl='25M/50M 30M/60M 20M/40M 16/16 8 3125k/6250k'),
 P(id=3,nom='Fibra 100',tipo='res',tipoT='Residencial',ico='casa',b='100',s='50',reuso='1:6',gar='16.7 %',lim='3 / 1',rout='Todos los routers',rg=1,cli='197',precio='Q 325.00',act=1,rl='50M/100M 60M/120M 40M/80M 16/16 8 8333k/16667k'),
 P(id=4,nom='Radio 10',tipo='res',tipoT='Residencial',ico='casa',b='10',s='3',reuso='1:10',gar='10 %',lim='1 / 0.5',rout='MK Torre San Juan, MK Zona 4',rg=0,cli='140',precio='Q 150.00',act=1,rl='3M/10M 0/0 0/0 0/0 8 300k/1000k'),
 P(id=5,nom='Pyme 100',tipo='emp',tipoT='Empresarial',ico='edif',b='100',s='100',reuso='1:4',gar='25 %',lim='5 / 5',rout='Todos los routers',rg=1,cli='61',precio='Q 650.00',act=1,rl='100M/100M 0/0 0/0 0/0 4 25M/25M'),
 P(id=6,nom='Pyme 200',tipo='emp',tipoT='Empresarial',ico='edif',b='200',s='200',reuso='1:4',gar='25 %',lim='5 / 5',rout='MK Centro, MK Sur',rg=0,cli='23',precio='Q 1,100.00',act=1,rl='200M/200M 0/0 0/0 0/0 4 50M/50M'),
 P(id=7,nom='Dedicado 200',tipo='ded',tipoT='Dedicado',ico='cable',b='200',s='200',reuso='1:1',gar='100 %',lim='—',rout='MK Centro',rg=0,cli='6',precio='Q 4,800.00',act=1,rl='200M/200M 0/0 0/0 0/0 1 200M/200M'),
 P(id=8,nom='Dedicado 500',tipo='ded',tipoT='Dedicado',ico='cable',b='500',s='500',reuso='1:1',gar='100 %',lim='—',rout='MK Centro',rg=0,cli='2',precio='Q 9,500.00',act=1,rl='500M/500M 0/0 0/0 0/0 1 500M/500M'),
 P(id=9,nom='Fibra 20 (2024)',tipo='res',tipoT='Residencial',ico='casa',b='20',s='10',reuso='1:8',gar='12.5 %',lim='2 / 1',rout='Todos los routers',rg=1,cli='116',precio='Q 150.00',act=0,rl='10M/20M 0/0 0/0 0/0 8 1250k/2500k'),
]
COLS='minmax(0,1.2fr) 125px 115px minmax(0,1.3fr) 70px 100px 24px'
lista=T('''<div class="lh" style="grid-template-columns:<<c>>"><span>Plan</span><span>Bajada / subida</span><span>Reuso · garantía</span><span>Dónde se ofrece</span><span>Clientes</span><span style="text-align:right">Precio</span><span></span></div>
<div class="sc" style="flex:1">
<sc-for list="{{filas}}" as="p"><div class="lr {{p.cls}}" style="grid-template-columns:<<c>>" onClick="{{p.ver}}">
 <div style="display:flex;align-items:center;gap:10px"><span class="ico {{p.ic}}" style="width:34px;height:34px;border-radius:10px"><span class="ti ti-{{p.ico}}"></span></span><div style="min-width:0"><b class="el" style="display:block;font-size:14px">{{p.nom}}</b><div class="m2">{{p.tipoT}}<span style="display:{{p.vi}}"> · ya no se ofrece</span></div></div></div>
 <div><b class="num">{{p.b}} / {{p.s}}</b> <span class="m2">Mbps</span></div>
 <div class="num">{{p.reuso}} <span class="m2">· {{p.gar}}</span></div>
 <div class="el" style="display:flex;align-items:center;gap:6px"><span class="ti ti-{{p.ri}}" style="width:15px;height:15px;color:{{p.rc}}"></span><span class="el">{{p.rout}}</span></div>
 <div class="num"><b>{{p.cli}}</b></div>
 <div class="num" style="text-align:right;font-weight:600">{{p.precio}}</div>
 <span style="color:#94A3B8"><i:der:15></span>
</div></sc-for>
<div style="display:{{vacio}};padding:40px;text-align:center;color:#64748B;font-size:14px">Ningún plan con ese filtro. <button class="lnk" onClick="{{limpiar}}">Quitar filtros</button></div>
</div>''',c=COLS)
panel=T('''<aside class="isla" style="width:330px;flex:0 0 auto;border-radius:20px;display:flex;flex-direction:column;overflow:hidden">
 <div style="padding:16px 18px;border-bottom:1px solid #F1F5F9">
  <div style="display:flex;align-items:center;gap:10px"><b style="font-size:18px;flex:1" class="el">{{s.nom}}</b><span class="b nf">{{s.tipoT}}</span></div>
  <div style="display:flex;align-items:baseline;gap:8px;margin-top:6px"><b style="font-size:26px" class="num">{{s.precio}}</b><span class="m2">al mes</span></div>
 </div>
 <div class="sc" style="flex:1;padding:14px 18px;display:flex;flex-direction:column;gap:14px">
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
   <div class="kpi"><div class="l"><i:baja:13>Bajada</div><b class="num">{{s.b}} <span style="font-size:13px;color:#64748B">Mbps</span></b></div>
   <div class="kpi"><div class="l"><i:sube:13>Subida</div><b class="num">{{s.s}} <span style="font-size:13px;color:#64748B">Mbps</span></b></div>
  </div>
  <div>
   <div class="kv" style="font-size:13px"><span>Reuso</span><b class="num">{{s.reuso}}</b></div>
   <div class="kv" style="font-size:13px"><span>Garantizado</span><b class="num">{{s.gar}}</b></div>
   <div class="kv" style="font-size:13px"><span>Limitado (mora)</span><b class="num">{{s.lim}} Mbps</b></div>
   <div class="kv" style="font-size:13px"><span>Clientes</span><b class="num">{{s.cli}}</b></div>
  </div>
  <div><div class="sec" style="margin-bottom:6px">Así lo recibe el router</div><span class="cmdp">{{s.rl}}</span></div>
  <div><div class="sec" style="margin-bottom:6px">Dónde se ofrece</div><div style="font-size:13px;display:flex;gap:8px;align-items:center"><i:router:15>{{s.rout}}</div>
   <div class="av2 wa" style="margin-top:8px;padding:8px 10px;align-items:flex-start;display:{{s.vex}}"><div style="flex:1">En <b>MK Centro</b> tiene velocidad propia heredada.</div><button class="lnk">Unificar</button></div></div>
 </div>
 <div style="padding:12px 18px;border-top:1px solid #F1F5F9;display:flex;gap:8px"><button class="btn o" style="flex:1;justify-content:center" title="Aplica las velocidades a las sesiones abiertas"><i:refresh:15>Sincronizar</button><button class="btn p" style="flex:1;justify-content:center"><i:editar:15>Editar</button></div>
</aside>''')
inner=T('''<div style="display:flex;align-items:center;gap:12px;flex:0 0 auto">
 <div><h1 class="h1">Planes</h1><div class="sub">8 planes en venta · 1,295 servicios</div></div>
 <span style="flex:1"></span>
 <button class="ib f" title="Ayuda: reuso, garantizado y ráfaga (manual)" style="width:40px;height:40px;border-radius:999px;cursor:help"><i:ayuda:18></button>
 <button class="btn o"><i:lista:16>Prioridad (QoS)</button>
 <button class="btn p" style="padding:11px 20px"><i:mas1:16>Nuevo plan</button>
</div>
<div style="display:flex;gap:12px;flex:1;min-height:0">
<section class="isla" style="flex:1;min-width:0;border-radius:20px;display:flex;flex-direction:column;overflow:hidden">
 <div style="display:flex;align-items:center;gap:10px;padding:12px 18px">
  <span class="busca" style="width:170px"><i:bus:15>Buscar plan…</span>
  <div class="segb"><sc-for list="{{chips}}" as="c"><button class="ts {{c.cls}}" onClick="{{c.ir}}">{{c.nom}}<span class="c">{{c.n}}</span></button></sc-for></div>
  <span style="flex:1"></span>
  <button class="selp" style="padding:0 10px;{{rSt}}" onClick="{{alternarR}}"><i:router:15>{{rTxt}}<i:ab:14></button>
  <button class="selp" style="padding:0 10px;{{aSt}}" onClick="{{alternarA}}">{{aTxt}}</button>
 </div>
 <<lista>>
 <div style="display:flex;align-items:center;gap:10px;padding:10px 18px;border-top:1px solid #F1F5F9;font-size:12px;color:#64748B;flex:0 0 auto">{{cuenta}}<span style="flex:1"></span>Orden: más clientes primero</div>
</section>
<<panel>>
</div>''',lista=lista,panel=panel)
logic='''class Component extends DCLogic {
renderVals() {
const ps = %s;
const st = this.state || {};
const f = st.f || 'todos';
const soloR = !!st.soloR;
const inact = !!st.inact;
const cnt = (t) => ps.filter((p) => (inact || p.act) && (t === 'todos' || p.tipo === t)).length;
const lista = ps.filter((p) => (inact || p.act) && (f === 'todos' || p.tipo === f) && (!soloR || !p.rg));
const sel = lista.find((p) => p.id === (st.sel || 1)) || lista[0] || ps[0];
const filas = lista.map((p) => ({ ...p, cls: p.id === sel.id ? 'on' : '', ic: p.tipo === 'res' ? 'ne' : (p.tipo === 'emp' ? 'nf' : 'cy'), vi: p.act ? 'none' : 'inline', ri: p.rg ? 'globo' : 'router', rc: p.rg ? '#16A34A' : '#4338CA', ver: () => this.setState({ sel: p.id }) }));
const chips = [['todos', 'Todos'], ['res', 'Residencial'], ['emp', 'Empresarial'], ['ded', 'Dedicado']].map(([id, nom]) => ({ id, nom, n: cnt(id), cls: id === f ? 'on' : '', ir: () => this.setState({ f: id }) }));
const onSt = 'background:#EEF2FF;border-color:#4F46E5;color:#3730A3';
return { filas, chips, s: { ...sel, vex: sel.id === 2 || sel.id === 5 ? 'flex' : 'none' }, vacio: filas.length ? 'none' : 'block',
  cuenta: filas.length + ' planes',
  rTxt: soloR ? 'Solo algunos routers' : 'Todos los routers', rSt: soloR ? onSt : '', alternarR: () => this.setState({ soloR: !soloR }),
  aTxt: inact ? 'Todos' : 'En venta', aSt: inact ? onSt : '', alternarA: () => this.setState({ inact: !inact }),
  limpiar: () => this.setState({ f: 'todos', soloR: false }) };
}
}''' % JS(planes)
CSS4='.cmdp{font-family:ui-monospace,Menlo,monospace;font-size:11.5px;color:#334155;background:#F1F5F9;border-radius:8px;padding:8px 10px;display:block;word-break:break-all;line-height:1.5}'
build('RedPlanes.dc.html','Red · Planes',shell('red',['Red','Planes'],inner),logic,900,CSS4+mask(['casa','edif','cable','globo','router']))

# ---------- formulario de plan
sec=lambda n,t,d,body: f'<div style="display:grid;grid-template-columns:220px 1fr;gap:24px;padding:18px 0;border-top:1px solid #F1F5F9"><div><b style="font-size:14px">{n} · {t}</b><div class="m2" style="margin-top:3px;line-height:1.45">{d}</div></div><div style="display:flex;flex-direction:column;gap:12px;min-width:0">{body}</div></div>'
un=lambda lab,val,u,ay='',big=False: f'<div><div class="lb" style="font-size:12px">{lab}</div><div class="in" style="{"font-size:20px;font-weight:700;padding:10px 14px" if big else ""}">{val}<span class="m2" style="margin-left:auto;font-weight:500;font-size:13px">{u}</span></div>{f"<div class=ay>{ay}</div>" if ay else ""}</div>'
rchk=lambda on,n,d: T('<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid #E6E8F0;border-radius:12px"><span class="ck <<on>>" style="width:20px;height:20px;border-radius:6px;border:2px solid #CBD5E1;display:flex;align-items:center;justify-content:center;color:#fff;<<st>>"><i:check:13></span><b style="font-size:13px"><<n>></b><span class="m2" style="margin-left:auto"><<d>></span></div>',on='on' if on else '',st='background:#4F46E5;border-color:#4F46E5' if on else '',n=n,d=d)
form=T('''<section class="isla" style="flex:1;min-height:0;border-radius:20px;display:flex;flex-direction:column;overflow:hidden">
 <header style="display:flex;align-items:center;gap:14px;padding:14px 22px;border-bottom:1px solid #F1F5F9;flex:0 0 auto">
  <button class="ib f" style="width:38px;height:38px;border-radius:999px"><i:izq:17></button>
  <div><b style="font-size:18px">Editar plan · Fibra 50</b><div class="m2">338 servicios lo usan · cambiar la velocidad se aplica a sus sesiones al guardar</div></div>
  <span style="flex:1"></span><button class="ib" title="Ayuda (manual)" style="cursor:help"><i:ayuda:18></button>
 </header>
 <div style="flex:1;min-height:0;display:flex">
  <div class="sc" style="flex:1;padding:4px 26px 20px">
   <<s1>><<s2>><<s3>><<s4>><<s5>>
  </div>
  <aside style="width:380px;flex:0 0 auto;border-left:1px solid #F1F5F9;background:#FAFBFE;padding:18px 20px;display:flex;flex-direction:column;gap:14px;overflow:auto">
   <div class="sec" style="margin:0">Así queda</div>
   <div class="card" style="padding:14px">
    <div style="display:flex;align-items:center;gap:8px"><b style="font-size:16px">Fibra 50</b><span class="b ne">Residencial</span><b style="margin-left:auto" class="num">Q 225.00</b></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px">
     <div class="kpi"><div class="l"><i:baja:13>Bajada</div><b class="num">50 Mbps</b><div class="m2">mínimo 6.25</div></div>
     <div class="kpi"><div class="l"><i:sube:13>Subida</div><b class="num">25 Mbps</b><div class="m2">mínimo 3.13</div></div>
    </div>
   </div>
   <div class="card" style="padding:14px"><b style="font-size:13px">Cuando la red se llena</b>
    <div class="m2" style="margin:4px 0 8px;line-height:1.45">Con reuso 1:8, ocho clientes comparten 50 Mbps. Cada uno tiene asegurados 6.25 Mbps.</div>
    <div style="display:flex;height:22px;border-radius:8px;overflow:hidden;background:#E0E7FF"><i style="width:12.5%;background:#4F46E5"></i></div>
    <div style="display:flex;justify-content:space-between;margin-top:4px" class="m2"><span>asegurado 12.5 %</span><span>hasta 50 Mbps si hay espacio</span></div>
   </div>
   <div class="card" style="padding:14px"><b style="font-size:13px">En mora (limitado)</b><div class="m2" style="margin-top:4px">Navega a 2 / 1 Mbps hasta que pague o prometa.</div></div>
   <div><div class="m2" style="margin-bottom:4px">Lo que recibe el router</div><span class="cmdp">25M/50M 30M/60M 20M/40M 16/16 8 3125k/6250k</span></div>
   <div class="av2 nf" style="align-items:flex-start"><i:info:16><div><b>338 sesiones abiertas</b> toman la velocidad nueva al guardar, sin desconectarse.</div></div>
  </aside>
 </div>
 <footer style="display:flex;align-items:center;gap:10px;padding:14px 22px;border-top:1px solid #F1F5F9;background:#FCFCFE;flex:0 0 auto"><span class="m2">Los cambios quedan en la bitácora.</span><span style="flex:1"></span><button class="btn g">Cancelar</button><button class="btn p" style="padding:11px 24px"><i:check:15>Guardar y aplicar</button></footer>
</section>''',
 s1=sec(1,'Lo básico','Cómo se llama, a quién se vende y cuánto cuesta.','<div style="display:grid;grid-template-columns:1.4fr 1fr;gap:14px">'+campo('Nombre','Fibra 50',True)+un('Precio mensual','225.00','Q')+'</div><div><div class="lb" style="font-size:12px">Tipo de plan</div><div style="display:flex;gap:8px"><span class="pillf on">'+s('casa',15)+'Residencial</span><span class="pillf">'+s('edif',15)+'Empresarial</span><span class="pillf">'+s('cable',15)+'Dedicado</span></div><div class="ay">Solo cambia avisos y reportes.</div></div>').replace('border-top:1px solid #F1F5F9','border-top:0',1),
 s2=sec(2,'Velocidad','Lo que contrata el cliente y lo que recibe si cae en mora.','<div class="g2">'+un('Bajada','50','Mbps',big=True)+un('Subida','25','Mbps',big=True)+'</div><div class="g2">'+un('Bajada limitada','2','Mbps','Cuando está en mora')+un('Subida limitada','1','Mbps')+'</div>'),
 s3=sec(3,'Reparto','Cuántos clientes comparten la capacidad y qué mínimo tienen.','<div class="g3">'+un('Reuso','1 : 8','','1 = dedicado')+un('Garantizado','12.5','%','Automático: 100 / reuso')+un('Prioridad','8','','1 alta · 8 normal')+'</div><div style="display:flex;align-items:center;gap:10px"><span class="tg on"><i></i></span><div><b style="font-size:13px">Con ráfaga</b><div class="m2">Hasta 60 / 30 Mbps por 16 s al abrir páginas.</div></div><button class="lnk" style="margin-left:auto">Ajustar ráfaga</button></div>'),
 s4=sec(4,'Dónde se ofrece','En todos los routers o solo en algunos.','<div style="display:flex;gap:10px"><div class="opb on"><span class="rd"></span><div><b>Todos los routers</b><span class="d">También los que conectes después.</span></div></div><div class="opb"><span class="rd"></span><div><b>Solo en algunos</b><span class="d">Eliges cuáles; en los demás no aparece.</span></div></div></div><div class="m2">El modo de colas y la prioridad por protocolo se eligen en cada router, no en el plan.</div>'),
 s5=sec(5,'Direcciones y extras','Qué IP recibe y qué incluye.','<div class="g2"><div><div class="lb" style="font-size:12px">IP</div><div class="in sel">IPv4 e IPv6</div></div><div><div class="lb" style="font-size:12px">Prefijo IPv6 para su casa</div><div class="in sel">/56 · 256 redes</div></div></div><div><div class="lb" style="font-size:12px">Adicionales incluidos</div><div class="in" style="flex-wrap:wrap"><span class="b nf">IPTV básico × 1</span><span style="color:#94A3B8">Agregar…</span></div></div><div style="display:flex;align-items:center;gap:10px"><span class="tg"><i></i></span><div><b style="font-size:13px">Incluye IP pública <span class="nuevo">nuevo</span></b><div class="m2">Cada servicio recibe una IP de una red pública de su router al crearse o al pasar a este plan, y la devuelve al salir de él. Sin cobro aparte.</div></div></div><div style="display:flex;align-items:center;gap:10px"><span class="tg on"><i></i></span><div><b style="font-size:13px">En venta</b><div class="m2">Aparece al crear servicios. Apagado, los clientes actuales lo conservan.</div></div></div>'))
CSS5=CSS4+'''.pillf{display:inline-flex;align-items:center;gap:7px;padding:9px 16px;border-radius:12px;border:1.5px solid #E2E8F0;font-size:13px;font-weight:600;color:#475569;background:#fff;cursor:pointer}
.pillf.on{border-color:#4F46E5;background:#EEF2FF;color:#3730A3;box-shadow:0 0 0 3px rgba(79,70,229,.12)}
.opb{border:1.5px solid #E2E8F0;border-radius:14px;padding:12px 14px;display:flex;gap:10px;align-items:flex-start;cursor:pointer;background:#fff;flex:1;min-width:0}
.opb.on{border-color:#4F46E5;background:#EEF2FF;box-shadow:0 0 0 3px rgba(79,70,229,.12)}
.opb .rd{width:16px;height:16px;border-radius:999px;border:2px solid #CBD5E1;flex:0 0 auto;margin-top:2px}
.opb.on .rd{border:5px solid #4F46E5}
.opb b{font-size:14px;display:block}.opb span.d{font-size:12px;color:#64748B;line-height:1.4;display:block;margin-top:2px}'''
build('RedPlanForm.dc.html','Red · Plan',shell('red',['Red','Planes','Fibra 50','Editar'],form),'class Component extends DCLogic {\nrenderVals() { return {}; }\n}',1100,CSS5)
