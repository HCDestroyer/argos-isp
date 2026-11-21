exec(open('/tmp/claude-0/-home-user/59389ade-3278-540a-8050-19c26767da8e/scratchpad/gen/red_base.py').read())
CSSI='''
.cel{width:100%;aspect-ratio:1;border-radius:4px;background:#E0E7FF;display:block}
.cel.a{background:#4F46E5}.cel.l{background:#E2E8F0}.cel.r{background:#FCD34D}.cel.g{background:#06B6D4}.cel.s{background:#F87171}
.lg{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:#475569}
.lg i{width:12px;height:12px;border-radius:3px;display:inline-block}
.gr{padding:8px 18px;background:#F8FAFC;border-bottom:1px solid #EEF0F5;font-size:12px;font-weight:700;color:#475569;display:flex;align-items:center;gap:8px}
.bq{display:flex;height:16px;border-radius:999px;overflow:hidden;background:#EEF0F5}
'''
redes=[
 dict(id=1,cidr='10.20.4.0/22',nom='Clientes fibra',rt='MK Centro',tipo='Pool',pub=0,p=78,a='796',l='222',r='2',gw='10.20.4.1 (derivado)',rango='Toda la red',bc='#4F46E5',sub='10.20.4.0/24'),
 dict(id=2,cidr='190.56.12.64/27',nom='IP fija pública',rt='MK Centro',tipo='Estático',pub=1,p=63,a='19',l='9',r='2',gw='190.56.12.65',rango='.66 a .94',bc='#06B6D4',sub='190.56.12.64/27'),
 dict(id=3,cidr='100.64.20.0/24',nom='CGNAT respaldo',rt='MK Centro',tipo='Pool',pub=0,p=8,a='19',l='222',r='13',gw='100.64.20.1',rango='.10 a .250',bc='#4F46E5',sub='100.64.20.0/24'),
 dict(id=4,cidr='10.30.8.0/24',nom='Clientes Chimaltenango',rt='MK Norte · Chimaltenango',tipo='Pool',pub=0,p=92,a='233',l='20',r='1',gw='10.30.8.1 (derivado)',rango='Toda la red',bc='#D97706',sub='10.30.8.0/24'),
 dict(id=5,cidr='10.30.9.0/24',nom='Ampliación norte',rt='MK Norte · Chimaltenango',tipo='Pool',pub=0,p=27,a='68',l='185',r='1',gw='10.30.9.1 (derivado)',rango='Toda la red',bc='#4F46E5',sub='10.30.9.0/24'),
 dict(id=6,cidr='172.16.40.0/24',nom='Radios San Juan',rt='MK Torre San Juan',tipo='Estático',pub=0,p=61,a='86',l='55',r='113',gw='172.16.40.1',rango='.100 a .240',bc='#4F46E5',sub='172.16.40.0/24'),
 dict(id=7,cidr='10.50.0.0/22',nom='Clientes Escuintla',rt='MK Sur · Escuintla',tipo='Pool',pub=0,p=70,a='395',l='625',r='2',gw='10.50.0.1 (derivado)',rango='Toda la red',bc='#4F46E5',sub='10.50.0.0/24'),
]
C4='minmax(0,1.3fr) minmax(0,1fr) 84px minmax(0,1.2fr)'
v4=T('''<div style="display:{{v.v4}};flex:1;min-height:0">
 <div style="flex:1;min-width:0;display:flex;flex-direction:column;border-right:1px solid #F1F5F9">
  <div class="lh" style="grid-template-columns:<<c>>;border-top:0"><span>Red</span><span>Router</span><span>Tipo</span><span>Ocupación</span></div>
  <div class="sc" style="flex:1">
  <sc-for list="{{redes}}" as="r"><div class="lr {{r.cls}}" style="grid-template-columns:<<c>>" onClick="{{r.ver}}">
   <div><b class="mono" style="font-size:13px">{{r.cidr}}</b> <span class="b cy" style="display:{{r.vp}};font-size:11px;padding:1px 7px">pública</span><div class="m2 el">{{r.nom}}</div></div>
   <div class="el m2" style="color:#334155">{{r.rt}}</div>
   <div><span class="b ne">{{r.tipo}}</span></div>
   <div><div style="display:flex;justify-content:space-between" class="num"><b>{{r.p}} %</b><span class="m2">{{r.l}} libres</span></div><div class="bar" style="margin-top:4px"><i style="width:{{r.p}}%;background:{{r.bc}}"></i></div></div>
  </div></sc-for>
  </div>
  <div style="padding:10px 18px;border-top:1px solid #F1F5F9;display:flex;gap:10px;align-items:center;flex:0 0 auto"><span class="m2">7 redes · 4 routers</span><span style="flex:1"></span><button class="btn o" style="padding:7px 14px"><i:mas1:15>Agregar red</button></div>
 </div>
 <div style="width:470px;flex:0 0 auto;display:flex;flex-direction:column;min-height:0">
  <div style="padding:14px 18px 10px;border-bottom:1px solid #F1F5F9">
   <div style="display:flex;align-items:center;gap:8px"><b class="mono" style="font-size:16px">{{s.cidr}}</b><span class="m2 el" style="flex:1">{{s.nom}} · {{s.rt}}</span><button class="ib" title="Editar la red"><i:editar:15></button><button class="ib" title="Mover a otro router"><i:cable:15></button></div>
   <div style="display:flex;gap:14px;margin-top:8px;font-size:13px"><span><b class="num">{{s.a}}</b> <span class="m2">asignadas</span></span><span><b class="num">{{s.l}}</b> <span class="m2">libres</span></span><span><b class="num">{{s.r}}</b> <span class="m2">reservadas</span></span></div>
  </div>
  <div class="sc" style="flex:1;padding:12px 18px;display:flex;flex-direction:column;gap:10px">
   <div style="display:flex;align-items:center;gap:8px"><span class="sec" style="margin:0">Mapa</span><span class="selp" style="height:30px;font-size:12px;margin-left:auto"><span class="mono" style="font-size:12px">{{s.sub}}</span><i:ab:13></span></div>
   <div style="display:grid;grid-template-columns:repeat(32,1fr);gap:2px"><sc-for list="{{celdas}}" as="c"><i class="cel {{c.k}}" title="{{c.t}}"></i></sc-for></div>
   <div style="display:flex;gap:12px;flex-wrap:wrap"><span class="lg"><i style="background:#4F46E5"></i>Asignada</span><span class="lg"><i style="background:#E2E8F0"></i>Libre</span><span class="lg"><i style="background:#FCD34D"></i>Reservada</span><span class="lg"><i style="background:#06B6D4"></i>Gateway</span><span class="lg"><i style="background:#F87171"></i>Suspendido</span></div>
   <div style="border:1px solid #E6E8F0;border-radius:12px;padding:10px 12px;display:flex;align-items:center;gap:10px;font-size:13px"><span class="mono" style="font-weight:700">.18</span><div style="flex:1;min-width:0"><b>Rosa Méndez</b> <span class="m2">· rosa.3 · Fibra 50</span><div class="m2">Conectada hace 3 d · asignada desde 12 mar 2025</div></div><button class="lnk">Abrir</button></div>
   <div>
    <div class="kv" style="font-size:13px"><span>Gateway</span><b class="mono" style="font-size:12px">{{s.gw}}</b></div>
    <div class="kv" style="font-size:13px"><span>Rango que se entrega</span><b>{{s.rango}}</b></div>
    <div class="kv" style="font-size:13px"><span>DNS</span><b class="mono" style="font-size:12px">10.255.0.1 · 1.1.1.1</b></div>
   </div>
  </div>
 </div>
</div>''',c=C4)
v6=T('''<div style="display:{{v.v6}};flex:1;min-height:0;gap:0">
 <div class="sc" style="flex:1;padding:16px 18px;display:flex;flex-direction:column;gap:12px">
  <<b1>><<b2>>
  <button class="btn o" style="align-self:flex-start"><i:mas1:15>Agregar bloque</button>
 </div>
 <aside style="width:400px;flex:0 0 auto;border-left:1px solid #F1F5F9;background:#FAFBFE;padding:16px 18px;display:flex;flex-direction:column;gap:12px;overflow:auto">
  <div class="sec" style="margin:0">Qué recibe cada cliente</div>
  <div class="card" style="padding:12px 14px"><div style="display:flex;gap:10px;align-items:center"><span class="ico cy" style="width:32px;height:32px;border-radius:10px"><i:cable:16></span><div><b style="font-size:13px">Un /64 para el enlace</b><div class="m2">La conexión entre tu router y el suyo.</div></div></div><div class="mono" style="font-size:12px;margin-top:8px;color:#475569">2803:d100:40:0::/64 · 2803:d100:40:1::/64 …</div></div>
  <div class="card" style="padding:12px 14px"><div style="display:flex;gap:10px;align-items:center"><span class="ico nf" style="width:32px;height:32px;border-radius:10px"><i:casa:16></span><div><b style="font-size:13px">Un /56 para su casa</b><div class="m2">256 redes para su WiFi, cámaras, invitados…</div></div></div><div class="mono" style="font-size:12px;margin-top:8px;color:#475569">2803:d100:40:8000::/56 · …:8100::/56 …</div></div>
  <div class="av2 nf" style="align-items:flex-start"><i:info:16><div>Al agregar un bloque, Argos sugiere cómo partirlo (mitad para casas, y los enlaces justos para los mismos clientes) y te lo muestra antes de guardar.</div></div>
  <div class="av2 wa" style="align-items:flex-start"><i:alerta:16><div><b>Radio 10 en MK Torre San Juan</b> no tiene de dónde sacar IPv6: el router no tiene bloque.</div></div>
 </aside>
</div>''',
 b1='''<div class="card" style="padding:14px 16px"><div style="display:flex;align-items:center;gap:10px"><b class="mono" style="font-size:15px">2803:d100:40::/40</b><span class="m2">MK Centro · proveedor Tigo</span><span style="flex:1"></span><span class="m2">62 % repartido en pools</span></div>
  <div class="bq" style="margin:10px 0 6px"><i style="width:12%;background:#06B6D4"></i><i style="width:38%"></i><i style="width:50%;background:#4F46E5"></i></div>
  <div style="display:grid;grid-template-columns:minmax(0,1.4fr) 130px minmax(0,1fr);gap:10px;font-size:13px;align-items:center;padding:8px 0;border-top:1px solid #F1F5F9"><span class="mono" style="font-size:12px">2803:d100:40::/52</span><span class="b cy" style="justify-self:start">Enlace · /64</span><span><span class="bar"><i style="width:10%;background:#06B6D4"></i></span><span class="m2 num">412 de 4,096</span></span></div>
  <div style="display:grid;grid-template-columns:minmax(0,1.4fr) 130px minmax(0,1fr);gap:10px;font-size:13px;align-items:center;padding:8px 0;border-top:1px solid #F1F5F9"><span class="mono" style="font-size:12px">2803:d100:40:8000::/42</span><span class="b nf" style="justify-self:start">Casa · /56</span><span><span class="bar"><i style="width:3%"></i></span><span class="m2 num">412 de 16,384</span></span></div></div>''',
 b2='''<div class="card" style="padding:14px 16px"><div style="display:flex;align-items:center;gap:10px"><b class="mono" style="font-size:15px">2803:d100:80::/44</b><span class="m2">MK Norte · Chimaltenango · proveedor Claro</span><span style="flex:1"></span><span class="m2">100 % repartido en pools</span></div>
  <div class="bq" style="margin:10px 0 6px"><i style="width:50%;background:#06B6D4"></i><i style="width:50%;background:#4F46E5"></i></div>
  <div style="display:grid;grid-template-columns:minmax(0,1.4fr) 130px minmax(0,1fr);gap:10px;font-size:13px;align-items:center;padding:8px 0;border-top:1px solid #F1F5F9"><span class="mono" style="font-size:12px">2803:d100:80::/45</span><span class="b cy" style="justify-self:start">Enlace · /64</span><span><span class="bar"><i style="width:1%;background:#06B6D4"></i></span><span class="m2 num">301 de 524,288</span></span></div>
  <div style="display:grid;grid-template-columns:minmax(0,1.4fr) 130px minmax(0,1fr);gap:10px;font-size:13px;align-items:center;padding:8px 0;border-top:1px solid #F1F5F9"><span class="mono" style="font-size:12px">2803:d100:88::/45</span><span class="b nf" style="justify-self:start">Casa · /56</span><span><span class="bar"><i style="width:15%"></i></span><span class="m2 num">301 de 2,048</span></span></div></div>''')
fj=[('190.56.12.66','Ferretería El Clavo','Pyme 100','MK Centro','ok','Conectado','12 ene 2025'),('190.56.12.67','Colegio Belén','Dedicado 200','MK Centro','ok','Conectado','3 feb 2025'),('190.56.12.70','Hotel Posada del Sol','Pyme 200','MK Centro','ok','Conectado','20 jun 2025'),('190.56.12.72','Clínica Santa Ana','Pyme 100','MK Centro','er','Suspendido','8 ago 2025'),('190.56.12.75','Municipalidad · cámaras','Dedicado 500','MK Centro','ok','Conectado','1 sep 2026'),('172.16.40.120','Finca La Esperanza','Radio 10','MK Torre San Juan','ok','En línea','14 oct 2026')]
CF='150px minmax(0,1.4fr) 130px minmax(0,1fr) 120px 120px 30px'
fijas=T('''<div style="display:{{v.fijas}};flex:1;min-height:0;flex-direction:column">
 <div style="display:flex;gap:10px;align-items:center;padding:10px 18px"><span class="fc on">Públicas <span class="c">19</span></span><span class="fc">Privadas fijas <span class="c">86</span></span><span style="flex:1"></span><span class="m2">9 públicas libres en 190.56.12.64/27</span></div>
 <div class="lh" style="grid-template-columns:<<c>>"><span>IP</span><span>Cliente</span><span>Plan</span><span>Router</span><span>Estado</span><span>Desde</span><span></span></div>
 <div class="sc" style="flex:1"><<rows>></div>
</div>''',c=CF,rows=''.join(T('<div class="lr" style="grid-template-columns:<<c>>"><span class="copy" style="justify-self:start"><<ip>></span><b class="el"><<cl>></b><span><<pl>></span><span class="m2 el"><<rt>></span><span><span class="b <<k>>"><<e>></span></span><span class="m2"><<d>></span><span style="color:#94A3B8"><i:der:15></span></div>',c=CF,ip=ip,cl=cl,pl=pl,rt=rt,k=k,e=e,d=d) for ip,cl,pl,rt,k,e,d in fj))
kp=lambda cls,ico,l,v,sub: T('<div class="card" style="padding:10px 14px;display:flex;align-items:center;gap:12px;flex:1;min-width:0"><span class="ico <<cls>>" style="width:34px;height:34px;border-radius:10px"><i:<<ico>>:17></span><div style="min-width:0"><div class="m2"><<l>></div><b style="font-size:17px" class="num"><<v>></b> <span class="m2"><<sub>></span></div></div>',cls=cls,ico=ico,l=l,v=v,sub=sub)
inner=T('''<div style="display:flex;align-items:center;gap:12px;flex:0 0 auto">
 <div><h1 class="h1">Direcciones IP</h1><div class="sub">Todas las redes de todos los routers en un solo lugar</div></div>
 <span style="flex:1"></span>
 <button class="ib f" title="Ayuda: redes, rangos y IPv6 (manual)" style="width:40px;height:40px;border-radius:999px;cursor:help"><i:ayuda:18></button>
</div>
<section class="isla" style="border-radius:20px;padding:14px 18px;flex:0 0 auto;display:flex;flex-direction:column;gap:10px">
 <div style="display:flex;gap:10px;align-items:center">
  <div class="busca" style="flex:1;height:48px;font-size:15px;border:2px solid #4F46E5;box-shadow:0 0 0 4px rgba(79,70,229,.12);color:#0F172A;cursor:text" onClick="{{buscar}}"><i:bus:18:#4F46E5><span style="color:{{qCol}}" class="mono">{{qTxt}}</span></div>
  <span class="selp" style="height:48px;padding:0 16px"><i:cal:15>Hoy<i:ab:14></span><span class="nuevo">por fecha: nuevo</span>
  <button class="btn p" style="height:48px;padding:0 24px" onClick="{{buscar}}">¿De quién es?</button>
 </div>
 <div style="display:{{vRes}};align-items:center;gap:14px;padding:12px 14px;border-radius:14px;background:#F0FDF4;border:1px solid #BBF7D0">
  <span class="av" style="background:#DCFCE7;color:#166534">RM</span>
  <div style="flex:1;min-width:0"><div style="font-size:15px"><b>Rosa Méndez</b> <span class="m2">· CLI-00388 · Internet hogar · Fibra 50</span></div><div class="m2">Usuario <span class="mono" style="font-size:12px">rosa.3</span> · MK Centro · conectada desde hace 3 d · la tiene asignada desde el 12 mar 2025</div></div>
  <span class="b ok"><span class="dot" style="background:currentColor"></span>En línea</span>
  <button class="btn o" style="padding:8px 14px">Ver historial de esta IP</button><button class="btn p" style="padding:8px 16px">Abrir cliente</button>
 </div>
 <div style="display:{{vTip}};font-size:12px;color:#64748B;gap:6px;align-items:center"><i:info:14>Escribe una IPv4, una IPv6 o un prefijo. Sirve para reclamos y requerimientos: te dice el cliente, su servicio y desde cuándo. <button class="lnk" style="font-size:12px" onClick="{{buscar}}">Probar con 10.20.4.18</button></div>
</section>
<div style="display:flex;gap:12px;flex:0 0 auto"><<k1>><<k2>><<k3>><<k4>></div>
<section class="isla" style="flex:1;min-height:0;border-radius:20px;display:flex;flex-direction:column;overflow:hidden">
 <div style="display:flex;align-items:center;gap:10px;padding:10px 18px;border-bottom:1px solid #F1F5F9;flex:0 0 auto">
  <div class="segb"><sc-for list="{{tabs}}" as="t"><button class="ts {{t.cls}}" onClick="{{t.ir}}">{{t.nom}}<span class="c">{{t.n}}</span></button></sc-for></div>
  <span style="flex:1"></span><span class="selp"><i:router:15>Todos los routers<i:ab:14></span><span class="selp">Más llenas primero<i:ab:14></span>
 </div>
 <<v4>><<v6>><<fijas>>
</section>''',v4=v4,v6=v6,fijas=fijas,
 k1=kp('nf','net','IPv4 privadas','1,597','de 2,709 · 59 %'),k2=kp('cy','globo','IPv4 públicas','19','de 28 · 9 libres'),k3=kp('wa','alerta','Redes casi llenas','1','10.30.8.0/24 al 92 %'),k4=kp('ok','globo','Clientes con IPv6','713','de 1,295 · 55 %'))
logic='''class Component extends DCLogic {
renderVals() {
const rs = %s;
const st = this.state || {};
const tab = st.tab || 'v4';
const sel = rs.find((r) => r.id === (st.sel || 1)) || rs[0];
const pct = sel.p;
const celdas = [];
for (let i = 0; i < 256; i++) {
  let k = 'l';
  const h = (i * 37 + sel.id * 11) %% 100;
  if (i === 0 || i === 255) k = 'r'; else if (i === 1) k = 'g'; else if (h < pct) k = (i %% 41 === 7) ? 's' : 'a';
  if (sel.id === 3 && (i < 10 || i > 250)) k = 'r';
  celdas.push({ k, t: '.' + i });
}
const tabs = [['v4', 'IPv4', 7], ['v6', 'IPv6', 2], ['fijas', 'IPs fijas y públicas', 105]].map(([id, nom, n]) => ({ id, nom, n, cls: id === tab ? 'on' : '', ir: () => this.setState({ tab: id }) }));
return { tabs, celdas, s: sel, v: { v4: tab === 'v4' ? 'flex' : 'none', v6: tab === 'v6' ? 'flex' : 'none', fijas: tab === 'fijas' ? 'flex' : 'none' },
  redes: rs.map((r) => ({ ...r, cls: r.id === sel.id ? 'on' : '', vp: r.pub ? 'inline-flex' : 'none', ver: () => this.setState({ sel: r.id }) })),
  buscar: () => this.setState({ q: !st.q }), vRes: st.q ? 'flex' : 'none', vTip: st.q ? 'none' : 'flex',
  qTxt: st.q ? '10.20.4.18' : 'Escribe una IP…', qCol: st.q ? '#0F172A' : '#94A3B8' };
}
}''' % JS(redes)
build('RedIps.dc.html','Red · Direcciones IP',shell('red',['Red','Direcciones IP'],inner),logic,1000,CSSI)

# ---------- Red de acceso
CSSA='''
.olt{display:flex;gap:10px;align-items:center;padding:12px 14px;border-bottom:1px solid #F1F5F9;cursor:pointer}
.olt.on{background:#F5F7FF;box-shadow:inset 3px 0 0 #4F46E5}
.pon{display:grid;grid-template-columns:86px minmax(0,1fr) 70px 20px;gap:10px;align-items:center;padding:10px 16px;border-bottom:1px solid #F1F5F9;font-size:13px;cursor:pointer}
.pon.on{background:#F5F7FF;box-shadow:inset 3px 0 0 #4F46E5}
.vl{display:inline-flex;align-items:center;gap:5px;border-radius:8px;padding:3px 8px;font-size:12px;font-weight:600;background:#EEF2FF;color:#3730A3;margin-right:4px}
.vl.ad{background:#FEF3C7;color:#92400E}
.flow{display:flex;align-items:stretch;gap:0}
.fb{flex:1;min-width:0;border:1px solid #E6E8F0;border-radius:14px;padding:10px 12px;background:#fff}
.fa{display:flex;align-items:center;color:#94A3B8;padding:0 4px}
'''
olt=lambda on,n,d,c: T('<div class="olt <<on>>"><span class="ico <<k>>" style="width:34px;height:34px;border-radius:10px"><i:serv:17></span><div style="flex:1;min-width:0"><b class="el" style="display:block;font-size:14px"><<n>></b><div class="m2 el"><<d>></div></div><b class="num" style="font-size:13px"><<c>></b></div>',on='on' if on else '',k='nf' if on else 'ne',n=n,d=d,c=c)
pon=lambda on,p,v,c,w=False: T('<div class="pon <<on>>"><b class="mono" style="font-size:13px"><<p>></b><span><<v>></span><span class="num" style="text-align:right"><b><<c>></b></span><span style="color:#94A3B8"><i:der:14></span></div>',on='on' if on else '',p=p,v=v,c=c)
vl=lambda n,ad=False: f'<span class="vl {"ad" if ad else ""}">VLAN {n}</span>'
fbox=lambda ico,k,cap,t,d,extra='': T('<div class="fb"><div class="m2" style="display:flex;align-items:center;gap:6px"><i:<<ico>>:13><<cap>></div><b style="font-size:14px;display:block;margin-top:2px" class="el"><<t>></b><div class="m2 el"><<d>></div><<extra>></div>',ico=ico,cap=cap,t=t,d=d,extra=extra)
arrow=T('<span class="fa"><i:der:16></span>')
inner2=T('''<div style="display:flex;align-items:center;gap:12px;flex:0 0 auto">
 <div><h1 class="h1">Red de acceso</h1><div class="sub">Por dónde llega cada cliente: OLT → puerto PON → VLAN → servidor PPPoE → red</div></div>
 <span style="flex:1"></span>
 <button class="ib f" title="Ayuda (manual)" style="width:40px;height:40px;border-radius:999px;cursor:help"><i:ayuda:18></button>
 <button class="btn o"><i:bus:16>Detectar en un router</button>
 <button class="btn p" style="padding:11px 20px"><i:mas1:16>Agregar OLT</button>
</div>
<div class="av2 wa" style="flex:0 0 auto"><i:info:17><div style="flex:1"><b>Encontramos 2 cosas en MK Centro que Argos no conocía:</b> VLAN 220 «radios» y el servidor «pppoe-radios». Puedes importarlas sin que Argos las toque.</div><button class="btn o" style="padding:7px 14px">Revisar e importar</button></div>
<div style="display:flex;gap:12px;flex:1;min-height:0">
 <section class="isla" style="width:270px;flex:0 0 auto;border-radius:20px;display:flex;flex-direction:column;overflow:hidden">
  <div style="padding:12px 14px;border-bottom:1px solid #F1F5F9"><span class="busca" style="height:36px"><i:bus:15>Buscar OLT…</span></div>
  <div class="sc" style="flex:1"><<o1>><<o2>><<o3>><<o4>></div>
  <div style="padding:10px 14px;border-top:1px solid #F1F5F9" class="m2">Las OLT son para ordenar y filtrar: Argos no se conecta a ellas (SmartOLT llegará después).</div>
 </section>
 <section class="isla" style="width:350px;flex:0 0 auto;border-radius:20px;display:flex;flex-direction:column;overflow:hidden">
  <div style="padding:12px 16px;border-bottom:1px solid #F1F5F9;display:flex;align-items:center;gap:8px"><div style="flex:1;min-width:0"><b style="font-size:15px">OLT Huawei Centro</b><div class="m2 el">MA5800-X7 · 16 puertos · MK Centro</div></div><button class="ib"><i:editar:15></button><button class="btn o" style="padding:6px 12px"><i:mas1:14>Puerto</button></div>
  <div class="lh" style="grid-template-columns:86px minmax(0,1fr) 70px 20px;padding:8px 16px;border-top:0"><span>Puerto</span><span>VLAN (máx. 2)</span><span style="text-align:right">Clientes</span><span></span></div>
  <div class="sc" style="flex:1"><<p1>><<p2>><<p3>><<p4>><<p5>><<p6>><<p7>></div>
 </section>
 <section class="isla" style="flex:1;min-width:0;border-radius:20px;display:flex;flex-direction:column;overflow:hidden">
  <div style="padding:12px 18px;border-bottom:1px solid #F1F5F9;display:flex;align-items:center;gap:8px"><div style="flex:1"><b style="font-size:15px">Puerto PON 0/1/3</b><div class="m2">412 clientes · 2 VLAN (lleno)</div></div><button class="btn o" style="padding:6px 12px;opacity:.5;cursor:not-allowed" title="Máximo 2 VLAN por puerto"><i:mas1:14>VLAN</button></div>
  <div class="sc" style="flex:1;padding:14px 18px;display:flex;flex-direction:column;gap:14px">
   <div><div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><span class="vl">VLAN 101</span><span class="b ok">Administrado</span><span class="m2">Argos la crea y la mantiene en el router</span><span style="flex:1"></span><button class="ib"><i:mas:15></button></div>
    <div class="flow"><<f1>><<ar>><<f2>><<ar>><<f3>></div></div>
   <div><div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><span class="vl">VLAN 102</span><span class="b ok">Administrado</span><span style="flex:1"></span><button class="ib"><i:mas:15></button></div>
    <div class="flow"><<g1>><<ar>><<g2>><<ar>><<g3>></div></div>
   <div style="border-top:1px dashed #E2E8F0;padding-top:12px"><div class="sec">Sin puerto asignado · ya estaba en el router</div>
    <div style="border:1px solid #FDE68A;background:#FFFBEB;border-radius:14px;padding:12px 14px;display:flex;gap:12px;align-items:center"><span class="ico wa"><i:capas:18></span><div style="flex:1;min-width:0"><b style="font-size:14px">VLAN 220 «radios» → pppoe-radios</b><div class="m2" style="color:#92400E">Argos la conoce pero no la toca. 26 clientes. Para que Argos la administre falta asignarle una red.</div></div><button class="btn o" style="padding:7px 12px">Asignar red</button><button class="btn o" style="padding:7px 12px;opacity:.5;cursor:not-allowed">Tomar control</button></div>
    <div class="m2" style="margin-top:6px">«Tomar control» muestra antes qué cambiaría en el router, propiedad por propiedad.</div></div>
  </div>
 </section>
</div>''',
 o1=olt(True,'OLT Huawei Centro','MA5800-X7 · MK Centro','412'),o2=olt(False,'OLT ZTE Norte','C320 · MK Norte','301'),o3=olt(False,'OLT VSOL Escuintla','V1600G · MK Sur','395'),o4=olt(False,'Sin OLT','Radio y cobre · 3 routers','187'),
 p1=pon(False,'0/1/1',vl(111)+vl(112),'58'),p2=pon(False,'0/1/2',vl(121),'31'),p3=pon(True,'0/1/3',vl(101)+vl(102),'412'),p4=pon(False,'0/1/4','<span class="m2">Sin VLAN</span>','0'),p5=pon(False,'0/1/5',vl(151),'44'),p6=pon(False,'0/1/6',vl(161),'22'),p7=pon(False,'0/1/7','<span class="m2">Sin VLAN</span>','0'),
 ar=arrow,
 f1=fbox('serv','','Servidor PPPoE','fibra-101','MK Centro · sfp-sfpplus1 · MTU 1492'),f2=fbox('net','','Red IPv4','10.20.4.0/22','Local 10.20.4.1 · sale del gateway'),f3=fbox('usuarios','','Clientes','214','209 conectados ahora'),
 g1=fbox('serv','','Servidor PPPoE','fibra-102','MK Centro · sfp-sfpplus1 · MTU 1492'),g2=fbox('net','','Red IPv4 + IPv6','10.20.4.0/22','/64 de enlace y /56 para casa'),g3=fbox('usuarios','','Clientes','198','194 conectados ahora'))
build('RedAcceso.dc.html','Red · Red de acceso',shell('red',['Red','Red de acceso'],inner2),'class Component extends DCLogic {\nrenderVals() { return {}; }\n}',900,CSSA)
