exec(open('/tmp/claude-0/-home-user/59389ade-3278-540a-8050-19c26767da8e/scratchpad/gen/red_base.py').read())
ses=[
 dict(id=1,cl='Rosa Méndez',u='rosa.3',ip='10.20.4.18',v6='2803:d100:40:8012::/56',rt='MK Centro',dur='3 d 4 h',ini='18 nov 05:12',dn='41.2 GB',up='3.8 GB',pl='Fibra 50',est='ok',estT='Activo',org='RADIUS'),
 dict(id=2,cl='Ferretería El Clavo',u='ferreteria.2',ip='190.56.12.66',v6='2803:d100:40:8040::/56',rt='MK Centro',dur='12 d 1 h',ini='9 nov 08:30',dn='212 GB',up='64 GB',pl='Pyme 100',est='ok',estT='Activo',org='RADIUS'),
 dict(id=3,cl='Carlos Ajú',u='carlos.aju',ip='10.20.5.3',v6='2803:d100:40:8101::/56',rt='MK Centro',dur='4 h 10 min',ini='hoy 05:31',dn='2.1 GB',up='0.3 GB',pl='Fibra 50',est='wa',estT='Limitado',org='RADIUS'),
 dict(id=4,cl='Juan Pérez',u='juan.perez.12',ip='10.20.4.77',v6='—',rt='MK Centro',dur='22 min',ini='hoy 09:19',dn='4 MB',up='1 MB',pl='Fibra 30',est='er',estT='Suspendido',org='RADIUS'),
 dict(id=5,cl='Finca La Esperanza',u='finca.esperanza',ip='172.16.40.120',v6='—',rt='MK Torre San Juan',dur='6 d 2 h',ini='15 nov 07:40',dn='—',up='—',pl='Radio 10',est='ok',estT='Activo',org='Sondeo'),
 dict(id=6,cl='Marta Xicará',u='marta.xicara',ip='10.30.8.41',v6='2803:d100:88:2900::/56',rt='MK Norte · Chimaltenango',dur='1 d 9 h',ini='ayer 00:22',dn='18.4 GB',up='1.1 GB',pl='Fibra 30',est='ok',estT='Activo',org='RADIUS'),
 dict(id=7,cl='Colegio Belén',u='colegio.belen',ip='190.56.12.67',v6='2803:d100:40:8041::/56',rt='MK Centro',dur='41 d',ini='11 oct 02:05',dn='1.9 TB',up='210 GB',pl='Dedicado 200',est='ok',estT='Activo',org='RADIUS'),
 dict(id=8,cl='Luis Coc',u='luis.coc.1',ip='10.20.5.91',v6='2803:d100:40:8155::/56',rt='MK Centro',dur='8 min',ini='hoy 09:33',dn='120 MB',up='9 MB',pl='Fibra 100',est='ok',estT='Activo',org='RADIUS'),
]
caidas=[('Luis Coc','luis.coc.1','MK Centro','7','en 30 min','Se perdió la señal × 6 · Reinicio del equipo × 1','Ticket #1203 abierto en Iris','ok'),('Aura Batz','aura.batz','MK Norte · Chimaltenango','6','en 30 min','Se perdió la señal × 6','Ticket #1204 abierto en Iris','ok'),('Tienda La Bendición','tienda.bendicion','MK Norte · Chimaltenango','5','en 28 min','Sin respuesta del equipo × 5','Sin ticket','wa'),('Pedro Cumes','pedro.cumes','MK Centro','5','en 30 min','El cliente desconectó × 5','Sin ticket','wa')]
sin=[('Luis Tum','luis.tum','MK Centro','Activo','ok','hace 2 d','Se perdió la señal'),('Ana Chávez','ana.chavez.4','MK Centro','Activo','ok','hace 9 h','El equipo se apagó'),('Iglesia Vida Nueva','iglesia.vn','MK Norte · Chimaltenango','Activo','ok','hace 5 d','Se perdió la señal'),('Mario Sic','mario.sic','MK Centro','Activo','ok','nunca se conectó','—')]
CS='minmax(0,1.4fr) 138px minmax(0,1fr) 100px 120px 100px'
conect=T('''<div style="display:{{v.con}};flex:1;min-height:0;flex-direction:column">
 <div class="lh" style="grid-template-columns:<<c>>;border-top:0"><span>Cliente</span><span>IP</span><span>Router</span><span>Conectado</span><span>Consumo ↓ / ↑</span><span>Servicio</span></div>
 <div class="sc" style="flex:1"><sc-for list="{{ses}}" as="x"><div class="lr {{x.cls}}" style="grid-template-columns:<<c>>" onClick="{{x.ver}}">
  <div><b class="el" style="display:block;font-size:14px">{{x.cl}}</b><div class="m2 mono el" style="font-size:12px">{{x.u}}</div></div>
  <span class="mono" style="font-size:12px">{{x.ip}}</span>
  <span class="el m2" style="color:#334155">{{x.rt}}</span>
  <span class="num">{{x.dur}}</span>
  <span class="num m2" style="color:#334155">{{x.dn}} / {{x.up}}</span>
  <span><span class="b {{x.est}}">{{x.estT}}</span></span>
 </div></sc-for></div>
 <div style="padding:10px 18px;border-top:1px solid #F1F5F9;font-size:12px;color:#64748B;flex:0 0 auto">8 de 799 · <a href="#">Cargar más</a> · se actualiza sola cada 30 s</div>
</div>''',c=CS)
CC='minmax(0,1.1fr) minmax(0,1fr) 120px minmax(0,1.6fr) 230px'
caid=T('''<div style="display:{{v.cai}};flex:1;min-height:0;flex-direction:column">
 <div class="av2 nf" style="margin:12px 18px 0"><i:info:16><div>Un cliente aparece aquí cuando se cae <b>3 veces o más en 60 minutos</b> (se cambia en Configuración › Red y portal). Suele ser fibra dañada, equipo fallando o energía. Argos avisa a Iris para que soporte lo atienda; si es una falla general, va al ticket general.</div></div>
 <div class="lh" style="grid-template-columns:<<c>>;margin-top:12px"><span>Cliente</span><span>Router</span><span>Caídas</span><span>Por qué se cayó</span><span>Soporte</span></div>
 <div class="sc" style="flex:1"><<rows>></div>
</div>''',c=CC,rows=''.join(T('<div class="lr" style="grid-template-columns:<<c>>"><div><b class="el" style="display:block;font-size:14px"><<a>></b><div class="m2 mono" style="font-size:12px"><<u>></div></div><span class="el m2" style="color:#334155"><<r>></span><div><b class="num" style="font-size:16px;color:#B91C1C"><<n>></b> <span class="m2"><<t>></span></div><span class="el"><<w>></span><span><span class="b <<k>>"><<s>></span></span></div>',c=CC,a=a,u=u,r=r,n=n,t=t,w=w,s=s_,k=k) for a,u,r,n,t,w,s_,k in caidas))
CN='minmax(0,1.2fr) minmax(0,1fr) 110px 150px minmax(0,1fr) 110px'
sinc=T('''<div style="display:{{v.sin}};flex:1;min-height:0;flex-direction:column">
 <div class="lh" style="grid-template-columns:<<c>>;border-top:0"><span>Cliente</span><span>Router</span><span>Servicio</span><span>Última conexión</span><span>Cómo terminó</span><span></span></div>
 <div class="sc" style="flex:1"><<rows>>
 <div style="padding:14px 18px" class="m2">Solo servicios activos de routers con PPPoE. Los suspendidos por mora no cuentan. Mostrando 4 de 37.</div></div>
</div>''',c=CN,rows=''.join(T('<div class="lr" style="grid-template-columns:<<c>>"><div><b class="el" style="display:block;font-size:14px"><<a>></b><div class="m2 mono" style="font-size:12px"><<u>></div></div><span class="el m2" style="color:#334155"><<r>></span><span><span class="b <<k>>"><<e>></span></span><span><<d>></span><span class="m2 el"><<w>></span><button class="lnk" style="justify-self:end">Abrir cliente</button></div>',c=CN,a=a,u=u,r=r,e=e,k=k,d=d,w=w) for a,u,r,e,k,d,w in sin))
panel=T('''<aside class="isla" style="width:340px;flex:0 0 auto;border-radius:20px;display:{{vPan}};flex-direction:column;overflow:hidden">
 <div style="padding:16px 18px;border-bottom:1px solid #F1F5F9"><div style="display:flex;gap:10px;align-items:center"><span class="ico ok"><i:wifi:19></span><div style="min-width:0;flex:1"><b class="el" style="display:block;font-size:16px">{{s.cl}}</b><div class="m2 mono" style="font-size:12px">{{s.u}}</div></div><span class="b {{s.est}}">{{s.estT}}</span></div></div>
 <div class="sc" style="flex:1;padding:10px 18px">
  <div class="kv" style="font-size:13px;border-top:0"><span>Plan</span><b>{{s.pl}}</b></div>
  <div class="kv" style="font-size:13px"><span>IPv4</span><span class="copy">{{s.ip}}</span></div>
  <div class="kv" style="font-size:13px"><span>IPv6 de su casa</span><span class="mono" style="font-size:11.5px">{{s.v6}}</span></div>
  <div class="kv" style="font-size:13px"><span>Router</span><b>{{s.rt}}</b></div>
  <div class="kv" style="font-size:13px"><span>Conectado desde</span><b>{{s.ini}}</b></div>
  <div class="kv" style="font-size:13px"><span>Tiempo</span><b class="num">{{s.dur}}</b></div>
  <div class="kv" style="font-size:13px"><span>Descargó / subió</span><b class="num">{{s.dn}} / {{s.up}}</b></div>
  <div class="kv" style="font-size:13px"><span>Cómo lo sabemos</span><span class="b ne">{{s.org}}</span></div>
  <div class="m2" style="margin-top:10px;line-height:1.45">«Sondeo» = el router no usa RADIUS: Argos pregunta cada minuto quién está conectado y no mide consumo.</div>
 </div>
 <div style="padding:12px 18px;border-top:1px solid #F1F5F9;display:flex;gap:8px"><button class="btn o" style="flex:1;justify-content:center">Abrir cliente</button><button class="btn o" style="flex:1;justify-content:center;color:#B91C1C;border-color:#FECACA" onClick="{{pedir}}"><i:corte:15>Desconectar</button></div>
</aside>''')
modal=T('''<div style="display:{{vMod}};position:absolute;inset:0;background:rgba(15,23,42,.45);z-index:8"></div>
<div class="isla" role="dialog" style="display:{{vMod}};position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:440px;border-radius:22px;padding:22px;z-index:9;flex-direction:column;gap:12px">
 <div style="display:flex;gap:12px;align-items:center"><span class="ico wa"><i:corte:19></span><b style="font-size:17px">¿Desconectar a {{s.cl}}?</b></div>
 <div style="font-size:14px;color:#475569;line-height:1.5">Se cierra su sesión ahora. Su equipo vuelve a conectarse solo en unos segundos y toma la velocidad y el estado actuales. No cambia su servicio ni su factura.</div>
 <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:6px"><button class="btn g" onClick="{{cerrar}}">Cancelar</button><button class="btn p" style="background:#B91C1C;box-shadow:none" onClick="{{cerrar}}">Desconectar</button></div>
</div>''')
kp=lambda cls,ico,l,v,sub: T('<div class="card" style="padding:10px 14px;display:flex;align-items:center;gap:12px;flex:1;min-width:0"><span class="ico <<cls>>" style="width:34px;height:34px;border-radius:10px"><i:<<ico>>:17></span><div style="min-width:0"><div class="m2"><<l>></div><b style="font-size:17px" class="num"><<v>></b> <span class="m2"><<sub>></span></div></div>',cls=cls,ico=ico,l=l,v=v,sub=sub)
inner=T('''<div style="display:flex;align-items:center;gap:12px;flex:0 0 auto">
 <div><h1 class="h1">Conectados ahora</h1><div class="sub">Quién está navegando, desde cuándo y por cuál router</div></div>
 <span style="flex:1"></span>
 <span class="b ok" style="padding:8px 14px;font-size:13px"><i:shield:15>RADIUS funcionando · 2 nodos</span>
 <button class="btn o"><i:alerta:15>Fallas generales</button>
 <button class="ib f" title="Ayuda (manual)" style="width:40px;height:40px;border-radius:999px;cursor:help"><i:ayuda:18></button>
</div>
<div class="av2 er" style="flex:0 0 auto;padding:10px 16px"><i:alerta:18><div style="flex:1"><b>Falla general en MK Sur · Escuintla</b> desde las 05:12 · 395 de 410 servicios sin conexión · Iris abrió un ticket general y no se abren tickets por servicio mientras dure.</div><button class="btn o" style="padding:7px 14px">Ver la falla</button></div>
<div style="display:flex;gap:12px;flex:0 0 auto"><<k1>><<k2>><<k3>><<k4>></div>
<div style="display:flex;gap:12px;flex:1;min-height:0">
<section class="isla" style="flex:1;min-width:0;border-radius:20px;display:flex;flex-direction:column;overflow:hidden">
 <div style="display:flex;align-items:center;gap:10px;padding:10px 18px;border-bottom:1px solid #F1F5F9;flex:0 0 auto">
  <div class="segb"><sc-for list="{{tabs}}" as="t"><button class="ts {{t.cls}}" onClick="{{t.ir}}">{{t.nom}}<span class="c {{t.cc}}">{{t.n}}</span></button></sc-for></div>
  <span style="flex:1"></span><span class="busca" style="width:210px;height:36px"><i:bus:15>Cliente, usuario o IP…</span><span class="selp"><i:router:15>Todos<i:ab:14></span>
 </div>
 <<conect>><<caid>><<sinc>>
</section>
<<panel>>
</div>''',conect=conect,caid=caid,sinc=sinc,panel=panel,
 k1=kp('ok','wifi','Conectados','799','de 1,295 servicios'),k2=kp('er','router','Sin servicio por router caído','395','MK Sur · Escuintla'),k3=kp('wa','onda','Caídas repetidas','4','clientes en los últimos 30 min'),k4=kp('ne','corte','Activos sin conexión','37','sin contar los de MK Sur'))
logic='''class Component extends DCLogic {
renderVals() {
const ss = %s;
const st = this.state || {};
const tab = st.tab || 'con';
const sel = ss.find((x) => x.id === (st.sel || 1)) || ss[0];
const tabs = [['con', 'Conectados', '799', ''], ['cai', 'Caídas repetidas', '4', 'rj'], ['sin', 'Activos sin conexión', '37', '']].map(([id, nom, n, cc]) => ({ id, nom, n, cc, cls: id === tab ? 'on' : '', ir: () => this.setState({ tab: id }) }));
return { tabs, s: sel, v: { con: tab === 'con' ? 'flex' : 'none', cai: tab === 'cai' ? 'flex' : 'none', sin: tab === 'sin' ? 'flex' : 'none' },
  ses: ss.map((x) => ({ ...x, cls: x.id === sel.id ? 'on' : '', ver: () => this.setState({ sel: x.id }) })),
  vMod: st.mod ? 'flex' : 'none', vPan: tab === 'con' ? 'flex' : 'none', pedir: () => this.setState({ mod: true }), cerrar: () => this.setState({ mod: false }) };
}
}''' % JS(ses)
build('RedSesiones.dc.html','Red · Conectados ahora',shell('red',['Red','Conectados ahora'],inner)+modal,logic,900)

# ---- teléfono: sesiones
mb=T('''<div style="height:100%;display:flex;flex-direction:column">
<<top>>
<div style="padding:0 14px 10px;flex:0 0 auto"><span class="busca" style="height:42px"><i:bus:16>Cliente, usuario o IP…</span></div>
<section class="isla" style="flex:1;min-height:0;margin:0 12px 10px;border-radius:20px;display:flex;flex-direction:column;overflow:hidden">
 <div style="padding:10px 10px 8px;flex:0 0 auto"><div class="segb" style="display:flex"><sc-for list="{{tabs}}" as="t"><button class="ts {{t.cls}}" style="padding:7px 10px" onClick="{{t.ir}}">{{t.nom}}<span class="c {{t.cc}}">{{t.n}}</span></button></sc-for></div></div>
 <div class="sc" style="flex:1;display:{{v.con}};flex-direction:column"><sc-for list="{{ses}}" as="x"><div style="display:flex;gap:10px;align-items:center;padding:11px 14px;border-top:1px solid #F1F5F9">
  <div style="flex:1;min-width:0"><b class="el" style="display:block;font-size:14px">{{x.cl}}</b><div class="m2 el"><span class="mono" style="font-size:11.5px">{{x.ip}}</span> · {{x.rt}}</div></div>
  <div style="text-align:right;flex:0 0 auto"><span class="b {{x.est}}" style="font-size:11px;padding:2px 8px">{{x.estT}}</span><div class="m2 num" style="margin-top:2px">{{x.dur}}</div></div>
 </div></sc-for></div>
 <div class="sc" style="flex:1;display:{{v.cai}};flex-direction:column"><<cai>></div>
</section>
<<nav>></div>''',top=mtop('Conectados ahora','799 de 1,295 · RADIUS funcionando'),nav=mnav(),
 cai=''.join(f'<div style="padding:11px 14px;border-top:1px solid #F1F5F9"><div style="display:flex;align-items:center;gap:8px"><b class="el" style="flex:1;font-size:14px">{a}</b><b class="num" style="color:#B91C1C">{n}</b><span class="m2">{t}</span></div><div class="m2 el">{r} · {w}</div><span class="b {k}" style="font-size:11px;padding:2px 8px;margin-top:4px">{s_}</span></div>' for a,u,r,n,t,w,s_,k in caidas))
mlogic=logic.replace("['con', 'Conectados', '799', ''], ['cai', 'Caídas repetidas', '4', 'rj'], ['sin', 'Activos sin conexión', '37', '']","['con', 'Conectados', '799', ''], ['cai', 'Caídas', '4', 'rj']")
mbuild('RedSesionesMovil.dc.html','Red · Conectados (teléfono)',mb,mlogic)

# ---- teléfono: ficha del router
sal=lambda ico,l,v,col,sub: T('<div class="card" style="padding:10px 12px"><div class="m2" style="display:flex;gap:6px;align-items:center"><i:<<ico>>:13><<l>></div><b style="font-size:15px;color:<<col>>"><<v>></b><div class="m2 el"><<sub>></div></div>',ico=ico,l=l,v=v,col=col,sub=sub)
mf=T('''<div style="height:100%;display:flex;flex-direction:column">
<<top>>
<section class="isla" style="margin:0 12px 10px;border-radius:20px;padding:12px 14px;flex:0 0 auto;display:flex;gap:12px;align-items:center">
 <span class="ico ok" style="width:44px;height:44px;border-radius:14px"><i:router:22></span>
 <div style="flex:1;min-width:0"><b style="font-size:17px">MK Centro</b><div class="m2 el">CCR2004 · RouterOS 7.16.1</div><div style="display:flex;gap:6px;margin-top:5px"><span class="b ok" style="font-size:11px;padding:2px 8px">En línea</span><span class="b nf" style="font-size:11px;padding:2px 8px">PPPoE</span><span class="b nf" style="font-size:11px;padding:2px 8px">RADIUS</span></div></div>
</section>
<section class="isla" style="flex:1;min-height:0;margin:0 12px 10px;border-radius:20px;display:flex;flex-direction:column;overflow:hidden">
 <div style="padding:10px 10px 8px;flex:0 0 auto"><div class="segb" style="display:flex"><sc-for list="{{tabs}}" as="t"><button class="ts {{t.cls}}" style="padding:7px 9px" onClick="{{t.ir}}">{{t.nom}}</button></sc-for></div></div>
 <div class="sc" style="flex:1;padding:4px 12px 12px;display:{{v.res}};flex-direction:column;gap:10px">
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><<a1>><<a2>><<a3>><<a4>></div>
  <div class="av2 wa" style="align-items:flex-start"><div style="flex:1"><b>3 servicios no usan PPPoE</b><div>Quedaron con IP estática de antes.</div></div><button class="lnk">Unificar</button></div>
  <div class="av2 nf" style="align-items:flex-start"><div style="flex:1"><b>4 clientes con caídas repetidas</b></div><button class="lnk">Ver</button></div>
  <div class="card" style="padding:10px 12px"><div class="sec" style="margin-bottom:4px">Direcciones</div>
   <div class="kv" style="font-size:13px;border-top:0"><span class="mono" style="color:#0F172A;font-size:12px">10.20.4.0/22</span><b class="num">78 %</b></div>
   <div class="kv" style="font-size:13px"><span class="mono" style="color:#0F172A;font-size:12px">190.56.12.64/27</span><b class="num">63 %</b></div></div>
 </div>
 <div class="sc" style="flex:1;padding:4px 12px 12px;display:{{v.con}};flex-direction:column;gap:10px">
  <div class="card" style="padding:10px 12px"><div class="sec" style="margin-bottom:4px">Túnel seguro</div><div class="kv" style="font-size:13px;border-top:0"><span>Estado</span><span class="b ok">Conectado</span></div><div class="kv" style="font-size:13px"><span>Último saludo</span><b>hace 18 s</b></div><div class="kv" style="font-size:13px"><span>IP en el túnel</span><span class="copy">10.255.0.12</span></div></div>
  <div class="card" style="padding:10px 12px"><div class="sec" style="margin-bottom:4px">RADIUS y corte</div><div class="kv" style="font-size:13px;border-top:0"><span>RADIUS</span><span class="b ok">Funcionando</span></div><div class="kv" style="font-size:13px"><span>Página de corte</span><b>Por código · 6 de 6</b></div></div>
  <div class="m2">El script de conexión y los cambios de velocidad se hacen desde una computadora.</div>
 </div>
 <div class="sc" style="flex:1;padding:4px 12px 12px;display:{{v.vel}};flex-direction:column;gap:8px">
  <div class="sec" style="margin:4px 0 0">Cómo se limita a cada cliente</div>
  <div style="border:1.5px solid #4F46E5;background:#EEF2FF;border-radius:14px;padding:10px 12px"><b style="font-size:13px;display:block">Árbol con PCQ<span class="rec">Recomendado</span></b><span class="m2" style="display:block;line-height:1.35">Una rama por plan. Lo mejor con muchos clientes.</span></div><div style="border:1.5px solid #E2E8F0;background:#fff;border-radius:14px;padding:10px 12px"><b style="font-size:13px;display:block">RADIUS</b><span class="m2" style="display:block;line-height:1.35">Argos manda la velocidad al conectarse. Solo PPPoE.</span></div><div style="border:1.5px solid #E2E8F0;background:#fff;border-radius:14px;padding:10px 12px"><b style="font-size:13px;display:block">Cola simple</b><span class="m2" style="display:block;line-height:1.35">Una cola fija por servicio.</span></div>
  <div style="display:{{vOtras}};flex-direction:column;gap:8px"><div style="border:1.5px solid #E2E8F0;background:#fff;border-radius:14px;padding:10px 12px"><b style="font-size:13px;display:block">Perfil PPP</b><span class="m2" style="display:block;line-height:1.35">La velocidad vive en el perfil del plan. Solo PPPoE.</span></div><div style="border:1.5px solid #E2E8F0;background:#fff;border-radius:14px;padding:10px 12px"><b style="font-size:13px;display:block">PCQ por plan</b><span class="m2" style="display:block;line-height:1.35">Una cola por plan, repartida. Necesita RADIUS.</span></div></div>
  <button class="lnk" style="align-self:flex-start;padding:6px 0" onClick="{{verOtras}}">{{otrasTxt}}</button>
  <div class="sec" style="margin:4px 0 0">Tipo de cola</div>
  <div><div style="display:flex;gap:8px;flex-wrap:wrap"><sc-for list="{{colas}}" as="c"><button class="pill {{c.cls}}" onClick="{{c.ir}}" title="Cómo funciona"><span class="nm">{{c.nom}}</span><span class="qi" aria-hidden="true">?</span></button></sc-for></div>
   <div class="exq"><div style="display:flex;align-items:center;gap:8px;margin-bottom:4px"><b style="font-size:14px;color:#0F172A">{{colaX.tit}}</b><span class="b {{colaX.ec}}" style="font-size:11px;padding:2px 8px">{{colaX.est}}</span></div>{{colaX.txt}}<div style="margin-top:4px"><b>Cuándo conviene:</b> {{colaX.cuando}}</div><div style="display:{{colaX.vno}};gap:8px;align-items:flex-start;margin-top:8px;padding-top:8px;border-top:1px dashed #C7D2FE;color:#92400E"><span><b>Por qué está tachada:</b> {{colaX.no}}</span></div></div></div>
  <div class="m2">Se cambia desde una computadora, con vista previa antes de aplicar.</div>
 </div>
 <div class="sc" style="flex:1;padding:4px 0 12px;display:{{v.bit}};flex-direction:column">
  <<bt>>
 </div>
</section>
<div style="flex:0 0 auto;display:flex;gap:8px;padding:10px 12px 14px;background:#fff;border-top:1px solid #E6E8F0"><button class="btn o" style="flex:1;justify-content:center;padding:12px"><i:refresh:16>Reconciliar</button><button class="btn p" style="flex:1.3;justify-content:center;padding:12px"><i:onda:16>Probar conexión</button></div>
</div>''',top=mtop('Router','Red › Routers','<span class="f ci" style="width:38px;height:38px">'+s('mas',18)+'</span>'),
 a1=sal('onda','Contacto','En línea','#166534','hace 12 s'),a2=sal('usuarios','Conectados','412','#0F172A','de 438'),a3=sal('cpu','CPU','23 %','#0F172A','memoria 41 %'),a4=sal('net','IPs','78 %','#0F172A','222 libres'),
 bt=''.join(f'<div style="padding:10px 14px;border-top:1px solid #F1F5F9"><div style="display:flex;gap:8px;align-items:center"><span class="b {k}" style="font-size:11px;padding:2px 8px">{t}</span><span class="m2 num" style="margin-left:auto">{h}</span></div><div style="font-size:13px;margin-top:3px">{q}</div><div class="m2" style="color:{"#166534" if k=="ok" else "#B91C1C"};font-weight:600">{r}</div></div>' for h,t,k,q,r in [('09:41','CoA','ok','Cambiar velocidad de rosa.3','Aceptado'),('09:38','Desconectar','ok','Cerrar sesión de juan.perez.12','Aceptado'),('09:12','RouterOS','er','Crear cola del plan «Pyme 100»','Falló: el padre no existe'),('08:55','CoA','er','Cambiar velocidad de luis.coc.1','Sin respuesta (3 intentos)')]))
flogic='''class Component extends DCLogic {
renderVals() {
const st = this.state || {};
const tab = st.tab || 'res';
const colas = [
  ['def', 'Predeterminada', 'La cola básica del router: atiende en orden de llegada. No gasta CPU, pero una descarga grande puede trabar lo demás del mismo cliente.', 'Con pocos clientes y routers pequeños.', 'No aplica con Árbol ni con PCQ por plan: ahí la cola se comparte entre varios clientes y solo sirve PCQ.'],
  ['sfq', 'SFQ', 'Atiende por turnos a cada conexión del cliente. Es ligera y evita que una sola descarga se lleve todo.', 'Como mejora barata en routers con poca CPU.', 'No aplica con Árbol ni con PCQ por plan: ahí solo sirve PCQ.'],
  ['fq', 'FQ-CoDel', 'Evita que una descarga trabe la navegación, las llamadas y los juegos del mismo cliente. Buen equilibrio entre calidad y CPU.', 'En casi todos los casos con colas por cliente. Solo RouterOS 7.', 'No aplica con Árbol ni con PCQ por plan: ahí solo sirve PCQ.'],
  ['cake', 'CAKE', 'Lo más completo: reparte parejo entre los aparatos del cliente y mantiene baja la espera, pero pide más CPU.', 'Con pocos clientes o routers potentes. Solo RouterOS 7.', 'No aplica con Árbol ni con PCQ por plan: ahí solo sirve PCQ.'],
  ['pcq', 'PCQ', 'Reparte el ancho entre los clientes de un plan: una sola cola por plan y cada cliente con su tope. Es la que menos carga al router con muchos clientes.', 'Obligatoria con Árbol con PCQ y con PCQ por plan.', '']
];
const cv = st.cola || 'pcq';
const cx = colas.find((c) => c[0] === cv);
const colasV = colas.map((c) => ({ nom: c[1], cls: (c[0] === 'pcq' ? 'on' : 'off') + (c[0] === cv ? ' ver' : ''), ir: () => this.setState({ cola: c[0] }) }));
const colaX = { tit: cx[1], txt: cx[2], cuando: cx[3], no: cx[4], vno: cx[4] ? 'flex' : 'none', est: cx[0] === 'pcq' ? 'En uso' : 'No disponible aquí', ec: cx[0] === 'pcq' ? 'ok' : 'ne' };
const otras = !!st.otras;
const tabs = [['res', 'Resumen'], ['con', 'Conexión'], ['vel', 'Velocidad'], ['bit', 'Bitácora']].map(([id, nom]) => ({ id, nom, cls: id === tab ? 'on' : '', ir: () => this.setState({ tab: id }) }));
return { colas: colasV, colaX, vOtras: otras ? 'flex' : 'none', otrasTxt: otras ? 'Ocultar las otras' : 'Ver las otras (2)', verOtras: () => this.setState({ otras: !otras }), tabs, v: { vel: tab === 'vel' ? 'flex' : 'none', res: tab === 'res' ? 'flex' : 'none', con: tab === 'con' ? 'flex' : 'none', bit: tab === 'bit' ? 'flex' : 'none' } };
}
}'''
mbuild('RedRouterFichaMovil.dc.html','Red · Router (teléfono)',mf,flogic,'.pill{display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:999px;border:1.5px solid #E2E8F0;font-size:12.5px;font-weight:600;color:#475569;background:#fff;cursor:pointer;white-space:nowrap}.pill.on{border-color:#4F46E5;background:#EEF2FF;color:#3730A3}\n.pill .nm{display:inline}\n.pill.off{opacity:1;text-decoration:none;cursor:pointer;color:#94A3B8}\n.pill.off .nm{text-decoration:line-through}\n.pill .qi{width:18px;height:18px;border-radius:999px;background:#E0E7FF;color:#3730A3;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;font-style:normal}\n.pill.ver{box-shadow:0 0 0 3px rgba(79,70,229,.18);border-color:#A5B4FC}\n.pill.on.ver{border-color:#4F46E5}\n.exq{margin-top:10px;border:1px solid #C7D2FE;background:#F5F7FF;border-radius:14px;padding:12px 14px;font-size:13px;line-height:1.5;color:#334155}\n.rec{font-size:10px;font-weight:700;color:#166534;background:#DCFCE7;border-radius:999px;padding:1px 7px;margin-left:4px;vertical-align:middle}\n')
