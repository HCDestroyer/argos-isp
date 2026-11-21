exec(open('/tmp/claude-0/-home-user/59389ade-3278-540a-8050-19c26767da8e/scratchpad/gen/red_base.py').read())
routers=[
 dict(id=1,nom='MK Centro',meta='CCR2004-16G-2S+ · RouterOS 7.16.1 · túnel 10.255.0.12',est='ok',estT='En línea',estS='contacto hace 12 s',ico='ok',tipo='PPPoE',seg='RADIUS',modo='Árbol con PCQ',modoS='padre por plan',con='412',tot='438',conP=94,cpu='23 %',cpuP=23,cpuC='#4F46E5',ips='78 %',ipsP=78,ipsC='#4F46E5',aviso='',grupo='linea'),
 dict(id=2,nom='MK Norte · Chimaltenango',meta='CCR1036-8G-2S+ · RouterOS 7.15.3 · túnel 10.255.0.14',est='ok',estT='En línea',estS='contacto hace 20 s',ico='ok',tipo='PPPoE',seg='RADIUS',modo='Colas simples',modoS='RADIUS rate-limit',con='301',tot='322',conP=93,cpu='41 %',cpuP=41,cpuC='#4F46E5',ips='92 %',ipsP=92,ipsC='#D97706',aviso='Red 10.30.8.0/24 casi llena',grupo='linea'),
 dict(id=3,nom='MK Torre San Juan',meta='RB4011iGS+ · RouterOS 7.14.3 · túnel 10.255.0.21',est='ok',estT='En línea',estS='contacto hace 48 s',ico='ok',tipo='IP estática',seg='Sin RADIUS',modo='Colas simples',modoS='una por servicio',con='86',tot='86',conP=100,cpu='12 %',cpuP=12,cpuC='#4F46E5',ips='61 %',ipsP=61,ipsC='#4F46E5',aviso='',grupo='linea'),
 dict(id=4,nom='MK Zona 4',meta='hEX S · RouterOS 7.16 · túnel 10.255.0.23',est='wa',estT='Sin túnel',estS='último saludo hace 3 h',ico='wa',tipo='DHCP fija',seg='Sin RADIUS',modo='PCQ por plan',modoS='sin padre',con='—',tot='54',conP=0,cpu='—',cpuP=0,cpuC='#CBD5E1',ips='44 %',ipsP=44,ipsC='#4F46E5',aviso='Argos no puede aplicar cortes ni cambios',grupo='prob'),
 dict(id=5,nom='MK Sur · Escuintla',meta='CCR2116-12G-4S+ · RouterOS 7.16.1 · túnel 10.255.0.30',est='er',estT='Caído',estS='sin contacto hace 14 min',ico='er',tipo='PPPoE',seg='RADIUS',modo='Árbol con PCQ',modoS='jerárquico',con='0',tot='395',conP=0,cpu='—',cpuP=0,cpuC='#CBD5E1',ips='70 %',ipsP=70,ipsC='#4F46E5',aviso='395 clientes sin servicio',grupo='prob'),
 dict(id=6,nom='MK Bodega',meta='Script generado ayer · todavía no se registró',est='ne',estT='Por conectar',estS='falta correr el script',ico='ne',tipo='PPPoE',seg='RADIUS',modo='Colas simples',modoS='—',con='—',tot='0',conP=0,cpu='—',cpuP=0,cpuC='#CBD5E1',ips='—',ipsP=0,ipsC='#CBD5E1',aviso='',grupo='pend'),
 dict(id=7,nom='MK Centro 2',meta='Se unió a MK Centro el 29 oct · conserva su historial',est='ne',estT='Inactivo',estS='unido a MK Centro',ico='ne',tipo='PPPoE',seg='RADIUS',modo='—',modoS='',con='—',tot='0',conP=0,cpu='—',cpuP=0,cpuC='#CBD5E1',ips='—',ipsP=0,ipsC='#CBD5E1',aviso='',grupo='inac'),
]
COLS='minmax(0,2.6fr) 165px 120px 150px 150px 90px 100px 70px'
lista=T('''<div class="lh" style="grid-template-columns:<<c>>"><span>Router</span><span>Estado</span><span>Conexión</span><span>Control de velocidad</span><span>Clientes conectados</span><span>CPU</span><span>IPs ocupadas</span><span></span></div>
<div class="sc" style="flex:1">
<sc-for list="{{filas}}" as="r"><div class="lr" style="grid-template-columns:<<c>>">
 <div style="display:flex;align-items:center;gap:12px"><span class="ico {{r.ico}}"><i:router:19></span><div style="min-width:0"><b class="el" style="display:block;font-size:14px">{{r.nom}}</b><div class="m2 el">{{r.meta}}</div><div class="m2 el" style="color:#B45309;font-weight:600;display:{{r.va}}">{{r.aviso}}</div></div></div>
 <div><span class="b {{r.est}}"><span class="dot" style="background:currentColor"></span>{{r.estT}}</span><div class="m2" style="margin-top:3px">{{r.estS}}</div></div>
 <div><b>{{r.tipo}}</b><div class="m2">{{r.seg}}</div></div>
 <div><b>{{r.modo}}</b><div class="m2">{{r.modoS}}</div></div>
 <div><div style="display:flex;align-items:baseline;gap:4px"><b class="num">{{r.con}}</b><span class="m2 num">de {{r.tot}}</span></div><div class="bar" style="margin-top:5px"><i style="width:{{r.conP}}%;background:#16A34A"></i></div></div>
 <div><b class="num">{{r.cpu}}</b><div class="bar" style="margin-top:5px"><i style="width:{{r.cpuP}}%;background:{{r.cpuC}}"></i></div></div>
 <div><b class="num">{{r.ips}}</b><div class="bar" style="margin-top:5px"><i style="width:{{r.ipsP}}%;background:{{r.ipsC}}"></i></div></div>
 <div style="display:flex;justify-content:flex-end;gap:2px"><button class="ib" title="Probar conexión"><i:onda:17></button><button class="ib" title="Más acciones"><i:mas:17></button></div>
</div></sc-for>
<div style="display:{{vacio}};padding:40px;text-align:center;color:#64748B;font-size:14px">Ningún router con ese filtro.</div>
</div>''',c=COLS)
kp=lambda cls,ico,l,v,sub: T('<div class="card" style="padding:12px 14px;display:flex;align-items:center;gap:12px;flex:1;min-width:0"><span class="ico <<cls>>"><i:<<ico>>:19></span><div style="min-width:0"><div class="m2"><<l>></div><b style="font-size:19px" class="num"><<v>></b> <span class="m2"><<sub>></span></div></div>',cls=cls,ico=ico,l=l,v=v,sub=sub)
inner=T('''<div style="display:flex;align-items:center;gap:12px;flex:0 0 auto">
 <div><h1 class="h1">Routers</h1><div class="sub">6 routers activos · 799 clientes conectados ahora</div></div>
 <span style="flex:1"></span>
 <button class="ib f" title="Ayuda: cómo conectar un router (manual)" style="width:40px;height:40px;border-radius:999px;cursor:help"><i:ayuda:18></button>
 <button class="btn o"><i:onda:16>Probar todos</button>
 <button class="btn p" style="padding:11px 20px"><i:mas1:16>Conectar router</button>
</div>
<div style="display:flex;gap:12px;flex:0 0 auto">
 <<k1>><<k2>><<k3>><<k4>>
</div>
<div class="av2 er" style="flex:0 0 auto"><i:alerta:18><div style="flex:1"><b>MK Sur · Escuintla no responde desde hace 14 min.</b> 395 clientes sin servicio. Las sesiones se cerrarán solas si no vuelve.</div><button class="btn o" style="padding:7px 14px">Ver router</button></div>
<section class="isla" style="flex:1;min-height:0;border-radius:20px;display:flex;flex-direction:column;overflow:hidden">
 <div style="display:flex;align-items:center;gap:10px;padding:12px 18px;flex-wrap:wrap">
  <div class="segb"><sc-for list="{{chips}}" as="c"><button class="ts {{c.cls}}" onClick="{{c.ir}}">{{c.nom}}<span class="c {{c.cc}}">{{c.n}}</span></button></sc-for></div>
  <span style="flex:1"></span>
  <span class="busca" style="width:260px"><i:bus:15>Buscar por nombre, IP o serie…</span>
  <span class="selp"><i:plug:15>Conexión: todas<i:ab:14></span>
  <span class="selp"><i:gauge:15>Control: todos<i:ab:14></span>
 </div>
 <<lista>>
 <div style="display:flex;align-items:center;gap:10px;padding:10px 18px;border-top:1px solid #F1F5F9;font-size:12px;color:#64748B;flex:0 0 auto"><i:info:14>El estado se actualiza solo cada minuto. «Sin túnel» = el router responde por RADIUS pero Argos no puede escribirle.<span style="flex:1"></span>{{cuenta}}</div>
</section>''',lista=lista,
 k1=kp('ok','ok','En línea','3','de 6 routers'),k2=kp('er','alerta','Con problemas','2','1 caído · 1 sin túnel'),k3=kp('nf','usuarios','Clientes conectados','799','de 1,295 servicios'),k4=kp('wa','net','Redes casi llenas','1','MK Norte al 92 %'))
logic='''class Component extends DCLogic {
renderVals() {
const rs = %s;
const st = this.state || {};
const f = st.f || 'activos';
const ok = (r) => f === 'todos' ? true : f === 'activos' ? r.grupo !== 'inac' : f === 'linea' ? r.grupo === 'linea' : f === 'prob' ? r.grupo === 'prob' : f === 'pend' ? r.grupo === 'pend' : r.grupo === 'inac';
const filas = rs.filter(ok).map((r) => ({ ...r, va: r.aviso ? 'block' : 'none' }));
const chips = [['activos', 'Activos', 6, ''], ['linea', 'En línea', 3, ''], ['prob', 'Con problemas', 2, 'rj'], ['pend', 'Por conectar', 1, ''], ['inac', 'Inactivos', 1, '']].map(([id, nom, n, cc]) => ({ id, nom, n, cc, cls: id === f ? 'on' : '', ir: () => this.setState({ f: id }) }));
return { filas, chips, vacio: filas.length ? 'none' : 'block', cuenta: filas.length + ' de 7 routers' };
}
}''' % JS(routers)
build('RedRouters.dc.html','Red · Routers',shell('red',['Red','Routers'],inner),logic)

# ---- teléfono
mrow=T('''<sc-for list="{{filas}}" as="r"><div style="display:flex;gap:12px;align-items:center;padding:12px 14px;border-top:1px solid #F1F5F9">
 <span class="ico {{r.ico}}"><i:router:19></span>
 <div style="flex:1;min-width:0"><b class="el" style="display:block;font-size:14px">{{r.nom}}</b><div class="m2 el">{{r.tipo}} · {{r.seg}} · {{r.modo}}</div>
  <div style="display:flex;align-items:center;gap:8px;margin-top:5px"><span class="b {{r.est}}" style="font-size:11px;padding:2px 8px">{{r.estT}}</span><span class="m2 el">{{r.estS}}</span></div></div>
 <div style="text-align:right;flex:0 0 auto"><b class="num" style="font-size:16px">{{r.con}}</b><div class="m2 num">de {{r.tot}}</div></div>
</div></sc-for>''')
mbody=T('''<div style="height:100%;display:flex;flex-direction:column">
<<top>>
<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:4px 14px 10px;flex:0 0 auto">
 <div class="card" style="padding:9px 10px"><div class="m2">En línea</div><b style="font-size:18px;color:#166534">3</b></div>
 <div class="card" style="padding:9px 10px;background:#FEF2F2;border-color:#FECACA"><div class="m2">Problemas</div><b style="font-size:18px;color:#B91C1C">2</b></div>
 <div class="card" style="padding:9px 10px"><div class="m2">Conectados</div><b style="font-size:18px" class="num">799</b></div>
</div>
<div class="av2 er" style="margin:0 14px 10px;flex:0 0 auto;align-items:flex-start"><i:alerta:17><div><b>MK Sur no responde</b> desde hace 14 min · 395 clientes sin servicio.</div></div>
<section class="isla" style="flex:1;min-height:0;margin:0 12px 10px;border-radius:20px;display:flex;flex-direction:column;overflow:hidden">
 <div style="padding:10px 10px 8px;flex:0 0 auto"><div class="segb" style="display:flex"><sc-for list="{{chips}}" as="c"><button class="ts {{c.cls}}" style="padding:7px 11px" onClick="{{c.ir}}">{{c.nom}}<span class="c {{c.cc}}">{{c.n}}</span></button></sc-for></div></div>
 <div class="sc" style="flex:1"><<rows>></div>
</section>
<<nav>></div>''',top=mtop('Routers','6 activos · actualizado hace 20 s','<span class="f ci" style="width:38px;height:38px;background:#4F46E5;color:#fff;border-color:#4F46E5">'+s('mas1',18)+'</span>'),rows=mrow,nav=mnav())
mlogic=logic.replace("[['activos', 'Activos', 6, ''], ['linea', 'En línea', 3, ''], ['prob', 'Con problemas', 2, 'rj'], ['pend', 'Por conectar', 1, ''], ['inac', 'Inactivos', 1, '']]","[['activos', 'Todos', 6, ''], ['prob', 'Problemas', 2, 'rj'], ['linea', 'En línea', 3, '']]")
mbuild('RedRoutersMovil.dc.html','Red · Routers (teléfono)',mbody,mlogic)
