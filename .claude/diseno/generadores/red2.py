exec(open('/tmp/claude-0/-home-user/59389ade-3278-540a-8050-19c26767da8e/scratchpad/gen/red_base.py').read())
CSS2='''
.sal{flex:1;min-width:0;border:1px solid #E6E8F0;border-radius:14px;padding:10px 12px;background:#fff}
.sal .l{font-size:12px;color:#64748B;display:flex;align-items:center;gap:6px}
.sal b{font-size:15px;display:flex;align-items:center;gap:6px;margin-top:3px}
.pan{border:1px solid #E6E8F0;border-radius:16px;padding:14px 16px;background:#fff;min-width:0}
.pan h3{font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#64748B;margin:0 0 8px;display:flex;align-items:center;gap:8px}
.pan h3 .b,.pan h3 .lnk,.pan h3 .btn{text-transform:none;letter-spacing:0}
.kv2{display:flex;justify-content:space-between;align-items:center;gap:10px;font-size:13px;padding:8px 0;border-top:1px solid #F1F5F9}
.kv2>span:first-child{color:#64748B;white-space:nowrap}
.kv2>*:last-child{text-align:right;min-width:0}
.opc{border:1.5px solid #E2E8F0;border-radius:14px;padding:10px 12px;cursor:pointer;background:#fff;min-width:0}
.opc b{font-size:13px;display:block}.opc span{font-size:11.5px;color:#64748B;line-height:1.35;display:block;margin-top:2px}
.opc span.rec{display:inline-block;color:#166534;font-size:10px;margin-top:0}
.opc.on{border-color:#4F46E5;background:#EEF2FF;box-shadow:0 0 0 3px rgba(79,70,229,.12)}
.opc.off{opacity:.55;cursor:not-allowed;background:#F8FAFC}
.pill{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:999px;border:1.5px solid #E2E8F0;font-size:12.5px;font-weight:600;color:#475569;background:#fff;cursor:pointer;white-space:nowrap}
.pill.on{border-color:#4F46E5;background:#EEF2FF;color:#3730A3}
.pill.off{opacity:.5;text-decoration:line-through;cursor:not-allowed}
.tree{position:relative;padding-left:22px;margin-left:10px;border-left:2px solid #E2E8F0}
.nd{display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid #E6E8F0;border-radius:12px;background:#fff;margin:8px 0;position:relative;font-size:13px}
.nd::before{content:"";position:absolute;left:-23px;top:50%;width:22px;height:2px;background:#E2E8F0}
.cmd{font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#334155;background:#F8FAFC;border-radius:8px;padding:5px 8px;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.spark{display:flex;align-items:flex-end;gap:3px;height:70px}
.spark i{flex:1;background:#C7D2FE;border-radius:3px 3px 0 0}
'''
sal=lambda ico,l,v,cls,sub='': T('<div class="sal"><div class="l"><i:<<ico>>:14><<l>></div><b style="color:<<col>>"><<v>></b><div class="m2 el"><<sub>></div></div>',ico=ico,l=l,v=v,sub=sub,col={'ok':'#166534','wa':'#92400E','er':'#B91C1C','':'#0F172A'}[cls])
kv=lambda a,b: f'<div class="kv2"><span>{a}</span><span>{b}</span></div>'
bars=[38,36,35,33,30,28,27,30,41,55,62,66,70,72,75,74,78,83,88,94,97,100,96,90]
spark='<div class="spark">'+''.join(f'<i style="height:{b}%{";background:#4F46E5" if i==23 else ""}"></i>' for i,b in enumerate(bars))+'</div>'
# ---------- Resumen
resumen=T('''<div style="display:{{v.resumen}};flex-direction:column;gap:12px">
 <div style="display:flex;gap:10px">
  <<s1>><<s2>><<s3>><<s4>><<s5>>
 </div>
 <div style="display:grid;grid-template-columns:1.25fr 1fr 1fr;gap:12px">
  <div class="pan"><h3><i:usuarios:14>Clientes conectados · últimas 24 h<span style="flex:1"></span><button class="lnk">Ver sesiones</button></h3>
   <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:8px"><b style="font-size:26px" class="num">412</b><span class="m2">de 438 servicios · 26 sin sesión (9 suspendidos)</span></div>
   <<spark>>
   <div style="display:flex;justify-content:space-between" class="m2"><span>ayer 14:00</span><span>02:00</span><span>ahora</span></div>
  </div>
  <div class="pan"><h3><i:cpu:14>Equipo <span class="nuevo">nuevo</span></h3>
   <div style="display:flex;gap:14px;margin-bottom:6px">
    <div style="flex:1"><div class="m2">CPU</div><b style="font-size:20px" class="num">23 %</b><div class="bar" style="margin-top:4px"><i style="width:23%"></i></div></div>
    <div style="flex:1"><div class="m2">Memoria</div><b style="font-size:20px" class="num">41 %</b><div class="bar" style="margin-top:4px"><i style="width:41%"></i></div></div>
   </div>
   <<e1>><<e2>><<e3>><<e4>>
  </div>
  <div class="pan"><h3><i:alerta:14>Para atender<span class="b wa" style="margin-left:auto">3</span></h3>
   <div style="display:flex;flex-direction:column;gap:8px">
    <div class="av2 wa" style="padding:8px 10px;align-items:flex-start"><div style="flex:1"><b>3 servicios no usan PPPoE</b><div>Este router es PPPoE; quedaron con IP estática de antes.</div></div><button class="lnk">Unificar</button></div>
    <div class="av2 wa" style="padding:8px 10px;align-items:flex-start"><div style="flex:1"><b>2 planes con velocidad propia</b><div>Excepciones heredadas: «Fibra 50» y «Pyme 100».</div></div><button class="lnk">Unificar</button></div>
    <div class="av2 nf" style="padding:8px 10px;align-items:flex-start"><div style="flex:1"><b>4 clientes con caídas repetidas</b><div>5 o más reconexiones en 30 min.</div></div><button class="lnk">Ver</button></div>
   </div>
  </div>
 </div>
 <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
  <div class="pan"><h3><i:net:14>Direcciones<span style="flex:1"></span><button class="lnk" onClick="{{irRed}}">Ver redes</button></h3>
   <<ip1>><<ip2>><<ip3>>
  </div>
  <div class="pan"><h3><i:hist:14>Lo último que Argos le mandó<span style="flex:1"></span><button class="lnk" onClick="{{irBit}}">Bitácora</button></h3>
   <<b1>><<b2>><<b3>>
  </div>
 </div>
</div>''',
 s1=sal('onda','Contacto','<span class="dot" style="background:#16A34A"></span>En línea','ok','hace 12 s'),
 s2=sal('plug','Túnel y API','<span class="dot" style="background:#16A34A"></span>Conectado','ok','saludo hace 18 s · 10.255.0.12'),
 s3=sal('shield','RADIUS y CoA','<span class="dot" style="background:#16A34A"></span>Funcionando','ok','último CoA aceptado 09:41'),
 s4=sal('usuarios','Sesiones abiertas','412','','de 438 servicios PPPoE'),
 s5=sal('net','IPs ocupadas','78 %','','IPv4 · IPv6 /56 al 31 %'),
 spark=spark,
 e1=kv('Modelo','CCR2004-16G-2S+'),e2=kv('RouterOS','7.16.1'),e3=kv('Encendido','41 días'),e4=kv('Serie','<span class="mono">HDK08A2X91P</span>'),
 ip1='<div class="kv2"><span class="mono" style="color:#0F172A">10.20.4.0/22</span><span style="display:flex;align-items:center;gap:8px;flex:1;justify-content:flex-end"><span class="bar" style="width:120px"><i style="width:78%"></i></span><b class="num">796 / 1,020</b></span></div>',
 ip2='<div class="kv2"><span class="mono" style="color:#0F172A">190.56.12.64/27 <span class="b cy" style="font-family:Inter">pública</span></span><span style="display:flex;align-items:center;gap:8px;flex:1;justify-content:flex-end"><span class="bar" style="width:120px"><i style="width:63%"></i></span><b class="num">19 / 30</b></span></div>',
 ip3='<div class="kv2"><span class="mono" style="color:#0F172A">2803:d100:40::/42 · /56</span><span style="display:flex;align-items:center;gap:8px;flex:1;justify-content:flex-end"><span class="bar" style="width:120px"><i style="width:31%"></i></span><b class="num">412 / 16,384</b></span></div>',
 b1='<div class="kv2"><span style="color:#0F172A"><span class="b ok">CoA</span> Cambiar velocidad · rosa.3</span><span class="m2">09:41 · aceptado</span></div>',
 b2='<div class="kv2"><span style="color:#0F172A"><span class="b ok">Desconectar</span> juan.perez.12 (suspendido)</span><span class="m2">09:38 · aceptado</span></div>',
 b3='<div class="kv2"><span style="color:#0F172A"><span class="b er">RouterOS</span> Crear cola del plan «Pyme 100»</span><span class="m2">09:12 · falló · <a href="#">Reintentar</a></span></div>')
# ---------- Conexión
chk=lambda ok,t,d: T('<div style="display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-top:1px solid #F1F5F9;font-size:13px"><span style="color:<<c>>;margin-top:1px"><i:<<i>>:16></span><div style="flex:1"><b><<t>></b><div class="m2"><<d>></div></div></div>',c='#16A34A' if ok else '#D97706',i='ok' if ok else 'alerta',t=t,d=d)
conexion=T('''<div style="display:{{v.conexion}};flex-direction:column;gap:12px">
 <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;align-items:start">
  <div class="pan"><h3><i:plug:14>Túnel seguro (WireGuard)<span class="b ok" style="margin-left:auto"><span class="dot" style="background:currentColor"></span>Conectado</span></h3>
   <<w1>><<w2>><<w3>><<w4>>
   <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button class="btn p" style="padding:8px 14px"><i:term:15>Script de conexión</button><button class="btn o" style="padding:8px 14px"><i:refresh:15>Rotar</button><button class="btn g" style="padding:8px 10px"><i:llave:15>Pegar clave</button></div>
   <div class="m2" style="margin-top:10px;line-height:1.45">La clave privada nunca sale del router. «Rotar» invalida el túnel actual y genera un script nuevo.</div>
  </div>
  <div class="pan"><h3><i:shield:14>RADIUS y API<span class="b nf" style="margin-left:auto">RADIUS</span></h3>
   <<r1>><<r2>><<r3>><<r4>><<r5>>
   <div class="m2" style="margin-top:10px;line-height:1.45">Los secretos se guardan cifrados y no se vuelven a mostrar. Al cambiarlos, Argos actualiza FreeRADIUS solo.</div>
  </div>
  <div class="pan"><h3><i:corte:14>Página de corte<span class="b ok" style="margin-left:auto">6 de 6</span></h3>
   <<c1>><<c2>>
   <div class="m2" style="margin:10px 0 2px;line-height:1.45">El router manda a cada suspendido a la página de corte con su propio código. No depende de la IP que vea el servidor.</div>
   <button class="lnk" style="margin-top:6px">Ver diagnóstico del corte</button>
  </div>
 </div>
 <div class="pan"><h3><i:onda:14>Última prueba de conexión · hoy 09:40<span style="flex:1"></span><button class="btn o" style="padding:7px 14px"><i:play:14>Probar ahora</button></h3>
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:0 24px">
   <<p1>><<p2>><<p3>><<p4>><<p5>><<p6>>
  </div>
 </div>
</div>''',
 w1=kv('Último saludo','hace 18 s'),w2=kv('IP en el túnel','<span class="copy">10.255.0.12</span>'),w3=kv('Servidor','argos.miisp.gt:51820'),w4=kv('Registrado','12 oct 2026 · por Ana'),
 r1=kv('Modo de seguridad','RADIUS <a href="#" style="font-size:12px;font-weight:600;margin-left:6px">Cambiar</a>'),r2=kv('IP del NAS','<span class="copy">10.255.0.12</span>'),r3=kv('Secreto RADIUS','•••••••• <a href="#" style="font-size:12px;font-weight:600;margin-left:6px">Cambiar</a>'),r4=kv('API REST','https://10.255.0.12 · argosisp-api'),r5=kv('Clave de la API','•••••••• <a href="#" style="font-size:12px;font-weight:600;margin-left:6px">Cambiar</a>'),
 c1=kv('Cómo reconoce al cliente','Por código <a href="#" style="font-size:12px;font-weight:600;margin-left:6px">Cambiar</a>'),c2=kv('Suspendidos ahora','9 servicios'),
 p1=chk(True,'Túnel','Saludo reciente, 31 ms'),p2=chk(True,'API REST','Usuario argosisp-api con los permisos mínimos'),p3=chk(True,'Equipo','RouterOS 7.16.1 · encendido 41 d · CPU 23 %'),
 p4=chk(True,'RADIUS','Apunta a Argos y el secreto coincide'),p5=chk(True,'CoA y Disconnect','Puerto 3799 abierto solo para Argos'),p6=chk(False,'FastTrack','Hay una regla antes de las de Argos: lo acelerado no se limita'))
# ---------- Red
red=T('''<div style="display:{{v.red}};gap:12px;align-items:start">
 <div style="flex:1.05;min-width:0;display:flex;flex-direction:column;gap:12px">
  <div class="pan"><h3><i:net:14>Redes IPv4<span style="flex:1"></span><button class="lnk"><i:mas1:13> Agregar red</button></h3>
   <<n1>><<n2>><<n3>>
  </div>
  <div class="pan"><h3><i:globo:14>IPv6<span style="flex:1"></span><button class="lnk"><i:mas1:13> Agregar bloque</button></h3>
   <div style="font-size:13px;display:flex;align-items:center;gap:8px"><b class="mono">2803:d100:40::/40</b><span class="m2">Proveedor: Tigo</span><span style="flex:1"></span><button class="ib"><i:editar:15></button></div>
   <div style="display:flex;height:14px;border-radius:999px;overflow:hidden;margin:8px 0;background:#EEF0F5"><i style="width:12%;background:#06B6D4"></i><i style="width:50%;background:#4F46E5;margin-left:38%"></i></div>
   <div style="display:flex;gap:14px" class="m2"><span><span class="dot" style="background:#06B6D4"></span> Enlace /64</span><span><span class="dot" style="background:#4F46E5"></span> Delegación /56</span><span><span class="dot" style="background:#EEF0F5;border:1px solid #CBD5E1"></span> Libre</span></div>
   <<v1>><<v2>>
   <div class="m2" style="margin-top:8px;line-height:1.45">Cada cliente recibe un /64 para su enlace y un /56 para su casa: 256 redes en su router.</div>
  </div>
 </div>
 <div class="pan" style="flex:1.2;min-width:0"><h3><i:cable:14>Red de acceso<span style="flex:1"></span><button class="lnk"><i:bus:13> Detectar en el router</button><button class="lnk" style="margin-left:12px"><i:mas1:13> VLAN</button></h3>
  <div class="m2" style="margin-bottom:6px">Interfaz → VLAN → servidor PPPoE → red. El gateway de la red es la dirección local del servidor.</div>
  <div class="nd" style="margin-left:0"><span class="ico ne" style="width:30px;height:30px;border-radius:9px"><i:tubo:15></span><b>sfp-sfpplus1</b><span class="m2">interfaz padre · OLT Huawei Centro</span></div>
  <div class="tree">
   <div class="nd"><span class="ico nf" style="width:30px;height:30px;border-radius:9px"><i:capas:15></span><div style="flex:1;min-width:0"><b>VLAN 101</b> <span class="m2">PON 0/1/3</span></div><span class="b ok">Administrado</span><button class="ib"><i:mas:15></button></div>
   <div class="tree">
    <div class="nd"><span class="ico cy" style="width:30px;height:30px;border-radius:9px"><i:serv:15></span><div style="flex:1;min-width:0"><b>fibra-101</b> <span class="m2">servidor PPPoE · 214 clientes</span><div class="m2 el">Red 10.20.4.0/22 · local <span class="mono" style="font-size:12px">10.20.4.1</span> (sale del gateway)</div></div><span class="b ok">Administrado</span></div>
   </div>
   <div class="nd"><span class="ico nf" style="width:30px;height:30px;border-radius:9px"><i:capas:15></span><div style="flex:1;min-width:0"><b>VLAN 102</b> <span class="m2">PON 0/1/3</span></div><span class="b ok">Administrado</span><button class="ib"><i:mas:15></button></div>
   <div class="tree">
    <div class="nd"><span class="ico cy" style="width:30px;height:30px;border-radius:9px"><i:serv:15></span><div style="flex:1;min-width:0"><b>fibra-102</b> <span class="m2">servidor PPPoE · 198 clientes</span><div class="m2 el">Red 10.20.4.0/22 · IPv6 /64 y /56</div></div><span class="b ok">Administrado</span></div>
   </div>
   <div class="nd" style="border-color:#FDE68A;background:#FFFBEB"><span class="ico wa" style="width:30px;height:30px;border-radius:9px"><i:capas:15></span><div style="flex:1;min-width:0"><b>VLAN 220 «radios»</b> <span class="m2">ya estaba en el router</span><div class="m2">Argos no la toca mientras siga adoptada.</div></div><span class="b wa">Adoptado</span><button class="btn o" style="padding:6px 12px">Tomar control</button></div>
   <div class="tree">
    <div class="nd" style="border-color:#FDE68A"><span class="ico cy" style="width:30px;height:30px;border-radius:9px"><i:serv:15></span><div style="flex:1;min-width:0"><b>pppoe-radios</b> <span class="m2">servidor PPPoE · 26 clientes</span><div class="m2" style="color:#B45309">Sin red asignada: no se puede tomar control · <a href="#">Asignar red</a></div></div><span class="b wa">Adoptado</span></div>
   </div>
  </div>
 </div>
</div>''',
 n1='<div class="kv2" style="display:grid;grid-template-columns:1.2fr 1fr auto;gap:12px"><span style="color:#0F172A"><b class="mono">10.20.4.0/22</b><div class="m2">Clientes fibra · pool · gateway 10.20.4.1 (derivado)</div></span><span><span class="bar"><i style="width:78%"></i></span><span class="m2 num">796 asignadas · 222 libres · 2 reservadas</span></span><button class="ib"><i:editar:15></button></div>',
 n2='<div class="kv2" style="display:grid;grid-template-columns:1.2fr 1fr auto;gap:12px"><span style="color:#0F172A"><b class="mono">190.56.12.64/27</b> <span class="b cy">pública</span><div class="m2">IP fija · estático · gateway 190.56.12.65</div></span><span><span class="bar"><i style="width:63%;background:#06B6D4"></i></span><span class="m2 num">19 asignadas · 9 libres · 2 reservadas</span></span><button class="ib"><i:editar:15></button></div>',
 n3='<div class="kv2" style="display:grid;grid-template-columns:1.2fr 1fr auto;gap:12px"><span style="color:#0F172A"><b class="mono">100.64.20.0/24</b><div class="m2">CGNAT respaldo · pool · rango .10 a .250</div></span><span><span class="bar"><i style="width:8%"></i></span><span class="m2 num">19 asignadas · 222 libres · 13 reservadas</span></span><button class="ib"><i:editar:15></button></div>',
 v1='<div class="kv2"><span style="color:#0F172A"><b class="mono">2803:d100:40::/52</b> <span class="b cy">Enlace · /64</span></span><span class="num">412 / 4,096</span></div>',
 v2='<div class="kv2"><span style="color:#0F172A"><b class="mono">2803:d100:40:8000::/42</b> <span class="b nf">Delegación · /56</span></span><span class="num">412 / 16,384</span></div>')
# ---------- Velocidad
REC='<span class="rec">Recomendado</span>'
opc=lambda cls,t,d: f'<div class="opc {cls}"><b>{t}</b><span>{d}</span></div>'
pill=lambda cls,t: f'<span class="pill {cls}">{t}</span>'
tog=lambda on,t,d: f'<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid #F1F5F9"><span class="tg {"on" if on else ""}"><i></i></span><div style="flex:1;min-width:0"><b style="font-size:13px">{t}</b><div class="m2">{d}</div></div></div>'
velocidad=T('''<div style="display:{{v.velocidad}};gap:12px;align-items:start">
 <div style="flex:1.7;min-width:0;display:flex;flex-direction:column;gap:12px">
  <div class="pan"><h3><i:plug:14>Tipo de conexión de este router<span class="m2" style="text-transform:none;letter-spacing:0;font-weight:500;margin-left:6px">uno por router; todos sus servicios lo usan</span></h3>
   <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">
    <<t1>><<t2>><<t3>>
   </div>
  </div>
  <div class="pan"><h3><i:gauge:14>1 · Cómo se limita a cada cliente</h3>
   <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
    <<a5>><<a1>><<a3>>
   </div>
   <div style="display:{{vOtras}};grid-template-columns:repeat(3,1fr);gap:8px;margin-top:8px">
    <<a2>><<a4>>
   </div>
   <button class="lnk" style="margin-top:8px;display:inline-flex;align-items:center;gap:4px" onClick="{{verOtras}}">{{otrasTxt}}<i:ab:14></button>
   <h3 style="margin-top:14px"><i:capas:14>2 · Cómo se reparte cuando se llena</h3>
   <div style="display:flex;gap:8px;flex-wrap:wrap"><<q1>><<q2>><<q3>><<q4>></div>
   <div class="m2" style="margin-top:6px">Jerárquico: el router tiene su tope, cada plan el suyo (con el reuso) y cada cliente su velocidad.</div>
   <h3 style="margin-top:14px"><i:lista:14>3 · Tipo de cola</h3>
   <div style="display:flex;gap:8px;flex-wrap:wrap"><sc-for list="{{colas}}" as="c"><button class="pill {{c.cls}}" onClick="{{c.ir}}" title="Cómo funciona"><span class="nm">{{c.nom}}</span><span class="qi" aria-hidden="true">?</span></button></sc-for></div>
   <div class="exq"><div style="display:flex;align-items:center;gap:8px;margin-bottom:4px"><b style="font-size:14px;color:#0F172A">{{colaX.tit}}</b><span class="b {{colaX.ec}}" style="font-size:11px;padding:2px 8px">{{colaX.est}}</span></div>{{colaX.txt}}<div style="margin-top:4px"><b>Cuándo conviene:</b> {{colaX.cuando}}</div><div style="display:{{colaX.vno}};gap:8px;align-items:flex-start;margin-top:8px;padding-top:8px;border-top:1px dashed #C7D2FE;color:#92400E"><span><b>Por qué está tachada:</b> {{colaX.no}}</span></div></div>
   <div class="m2" style="margin-top:6px">Toca el «?» de cada una para ver cómo funciona. Las tachadas no aplican con el modo elegido.</div>
  </div>
 </div>
 <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:12px">
  <div class="pan"><h3><i:rayo:14>4 · Extras</h3>
   <<x1>><<x2>><<x3>><<x4>><<x5>>
   <div style="display:flex;align-items:center;gap:8px;margin-top:8px;font-size:13px"><span class="m2">Perfil de prioridad</span><span class="selp" style="margin-left:auto;height:32px">Predeterminado<i:ab:14></span></div>
  </div>
  <div class="pan"><h3><i:sube:14>Capacidad del enlace</h3>
   <div class="g2"><div><div class="lb" style="font-size:12px">Bajada</div><div class="in">1,000 <span class="m2" style="margin-left:auto">Mbps</span></div></div><div><div class="lb" style="font-size:12px">Subida</div><div class="in">1,000 <span class="m2" style="margin-left:auto">Mbps</span></div></div></div>
   <div class="m2" style="margin-top:6px">Es el techo del router. Vacío = sin techo (con aviso).</div>
  </div>
  <div class="pan" style="background:#F8FAFC"><h3><i:ojo:14>Antes de guardar verás</h3>
   <div style="font-size:13px;line-height:1.6;color:#334155">Qué se crea, cambia o borra en el router · cuántas sesiones reciben el cambio al instante · cuántas lo toman al reconectar.</div>
   <div class="av2 ok" style="margin-top:8px;padding:8px 10px"><i:check:15><b>Nunca se corta a un cliente por cambiar el modo.</b></div>
   <button class="btn p" style="margin-top:12px;width:100%;justify-content:center;padding:11px"><i:ojo:15>Ver vista previa del cambio</button>
  </div>
 </div>
</div>''',
 t1=opc('on','PPPoE','Usuario y contraseña. 438 servicios.'),t2=opc('','IP estática','IP fija por servicio, sin usuario.'),t3=opc('','DHCP fija','IP amarrada a la MAC del equipo.'),
 a1=opc('','RADIUS','Argos manda la velocidad a cada cliente al conectarse. Solo PPPoE.'),a2=opc('','Perfil PPP','La velocidad vive en el perfil del plan en el router. Solo PPPoE.'),a3=opc('','Cola simple','Una cola fija por servicio. Sirve con cualquier tipo de conexión.'),a4=opc('','PCQ por plan','Una cola por plan que se reparte entre sus clientes. Necesita RADIUS.'),a5=opc('on','Árbol con PCQ'+REC,'Una rama por plan. Lo mejor con muchos clientes; permite prioridad por protocolo.'),
 q1=pill('','Sin padre'),q2=pill('','Por plan'),q3=pill('','Por router'),q4=pill('on','Jerárquico'),
 c1=pill('off','Predeterminada'),c2=pill('off','SFQ'),c3=pill('off','FQ-CoDel'),c4=pill('off','CAKE'),c5=pill('on','PCQ'),
 x1=tog(True,'Ráfaga','Empujón corto al abrir páginas.'),x2=tog(True,'Prioridad','Corporativos antes que residenciales.'),x3=tog(True,'Garantizado','Mínimo asegurado por plan.'),x4=tog(True,'Prioridad por protocolo (QoS)','Llamadas y web antes que descargas.'),x5=tog(True,'Vigilar FastTrack','Avisa si algo se salta las colas.'))
# ---------- Servicios
sv=[('Rosa Méndez','rosa.3','Fibra 50','10.20.4.18','ok','Activo','ok','En línea · 3 d'),('Juan Pérez','juan.perez.12','Fibra 30','10.20.4.77','er','Suspendido','wa','Página de corte'),('Ferretería El Clavo','ferreteria.2','Pyme 100','190.56.12.70','ok','Activo','ok','En línea · 12 d'),('Carlos Ajú','carlos.aju','Fibra 50','10.20.5.3','wa','Limitado','ok','En línea · 4 h'),('María Tzoc','(IP estática)','Fibra 30','10.20.6.40','ok','Activo','ne','Difiere del router'),('Luis Coc','luis.coc.1','Fibra 100','10.20.5.91','ok','Activo','ne','Sin sesión · 2 d'),('Colegio Belén','colegio.belen','Dedicado 200','190.56.12.72','ok','Activo','ok','En línea · 41 d')]
SC='minmax(0,1.6fr) 150px 120px 140px 120px 170px 40px'
servicios=T('''<div style="display:{{v.servicios}};flex-direction:column;border:1px solid #E6E8F0;border-radius:16px;overflow:hidden">
 <div style="display:flex;align-items:center;gap:10px;padding:10px 14px"><span class="busca" style="width:280px;height:36px"><i:bus:15>Buscar cliente, usuario o IP…</span><span class="fc on">Todos <span class="c">438</span></span><span class="fc">Conectados <span class="c">412</span></span><span class="fc">Sin sesión <span class="c">26</span></span><span class="fc">Suspendidos <span class="c">9</span></span><span class="fc">Difieren del router <span class="c">3</span></span></div>
 <div class="lh" style="grid-template-columns:<<c>>"><span>Cliente</span><span>Usuario PPPoE</span><span>Plan</span><span>IP</span><span>Estado</span><span>Conexión</span><span></span></div>
 <<rows>>
 <div style="padding:10px 14px;font-size:12px;color:#64748B">7 de 438 · <a href="#">Cargar más</a></div>
</div>''',c=SC,rows=''.join(T('<div class="lr" style="grid-template-columns:<<c>>"><b class="el"><<a>></b><span class="mono el" style="font-size:12px"><<b>></span><span><<p>></span><span class="mono" style="font-size:12px"><<ip>></span><span><span class="b <<ec>>"><<e>></span></span><span><span class="b <<cc>>"><<cx>></span></span><button class="ib"><i:der:15></button></div>',c=SC,a=a,b=b,p=p,ip=ip,ec=ec,e=e,cc=cc,cx=cx) for a,b,p,ip,ec,e,cc,cx in sv))
# ---------- Bitácora
bt=[('09:41:07','CoA','ok','Cambiar velocidad de rosa.3 a 50M/25M','CoA-ACK','Sincronizar plan · Ana'),('09:38:52','Desconectar','ok','Cerrar sesión de juan.perez.12','Disconnect-ACK','Corte automático · sistema'),('09:38:51','RouterOS','ok','PUT /ip/proxy/access · código de corte de juan.perez.12','201 creado','Corte automático · sistema'),('09:12:30','RouterOS','er','PUT /queue/tree · argosisp-plan-14-bajada','400 · parent no existe','Plan «Pyme 100» · Ana'),('09:10:02','RouterOS','ok','GET /system/resource (sondeo)','200 · CPU 23 %','Sondeo · sistema'),('08:55:40','CoA','er','Cambiar velocidad de luis.coc.1','Sin respuesta (3 intentos)','Pago registrado · caja 1'),('08:30:00','RouterOS','ok','Reconciliar: 0 cambios','Todo igual','Reconciliación · sistema')]
BC='90px 120px minmax(0,1.6fr) minmax(0,1fr) minmax(0,1fr) 90px'
bitacora=T('''<div style="display:{{v.bitacora}};flex-direction:column;border:1px solid #E6E8F0;border-radius:16px;overflow:hidden">
 <div style="display:flex;align-items:center;gap:10px;padding:10px 14px"><span class="fc on">Todo</span><span class="fc">CoA y Disconnect</span><span class="fc">RouterOS</span><span class="fc" style="color:#B91C1C;border-color:#FECACA">Solo fallos <span class="c" style="background:#FEE2E2;color:#B91C1C">2</span></span><span style="flex:1"></span><span class="selp"><i:cal:15>Hoy<i:ab:14></span><button class="btn o" style="padding:7px 14px"><i:desc:15>Exportar</button></div>
 <div class="lh" style="grid-template-columns:<<c>>"><span>Hora</span><span>Tipo</span><span>Qué se mandó</span><span>Respuesta del equipo</span><span>Por qué</span><span></span></div>
 <<rows>>
 <div style="padding:10px 14px;font-size:12px;color:#64748B;display:flex;gap:8px;align-items:center"><i:candado:14>Este registro no se puede editar ni borrar. Las lecturas de sondeo se agrupan.</div>
</div>''',c=BC,rows=''.join(T('<div class="lr" style="grid-template-columns:<<c>>;cursor:default"><span class="num m2"><<h>></span><span><span class="b <<k>>"><<t>></span></span><span class="cmd"><<q>></span><span class="el" style="color:<<col>>;font-weight:600"><<r>></span><span class="m2 el"><<m>></span><span style="text-align:right"><<x>></span></div>',c=BC,h=h,t=t,k=k,q=q,r=r,m=m,col='#166534' if k=='ok' else '#B91C1C',x='<button class="lnk">Reintentar</button>' if k=='er' else '') for h,t,k,q,r,m in bt))
tabs=[('resumen','Resumen','home',''),('conexion','Conexión','plug',''),('red','Red e IPs','net',''),('velocidad','Velocidad','gauge',''),('servicios','Servicios','usuarios','438'),('bitacora','Bitácora de comandos','hist','2')]
inner=T('''<section class="isla" style="border-radius:20px;padding:14px 18px;display:flex;align-items:center;gap:14px;flex:0 0 auto">
 <span class="ico ok" style="width:52px;height:52px;border-radius:16px"><i:router:26></span>
 <div style="min-width:0"><div style="display:flex;align-items:center;gap:10px"><b style="font-size:20px">MK Centro</b><span class="b ok"><span class="dot" style="background:currentColor"></span>En línea</span><span class="b nf">PPPoE</span><span class="b nf">RADIUS</span><span class="b ne">Árbol con PCQ</span></div>
  <div class="m2" style="margin-top:3px">CCR2004-16G-2S+ · RouterOS 7.16.1 · túnel <span class="mono" style="font-size:12px">10.255.0.12</span> · Empresa: Conecta, S.A.</div></div>
 <span style="flex:1"></span>
 <button class="btn o"><i:onda:16>Probar conexión</button>
 <button class="btn o"><i:refresh:16>Reconciliar</button>
 <button class="btn o"><i:editar:16>Editar</button>
 <span style="position:relative"><button class="ib f" style="width:40px;height:40px;border-radius:999px" onClick="{{menu}}"><i:mas:18></button>
  <div class="isla" style="display:{{verMenu}};position:absolute;right:0;top:46px;width:250px;border-radius:14px;padding:6px;z-index:5">
   <div class="mi"><i:term:16>Script de conexión</div><div class="mi"><i:unir:16>Unir con otro router</div><div class="mi"><i:cable:16>Migrar redes a otro router</div><div class="mi"><i:pausa:16>Desactivar</div>
   <div class="mi" style="color:#94A3B8;cursor:not-allowed" title="Tiene 438 servicios y sesiones"><i:basura:16>Eliminar<span class="m2" style="margin-left:auto">tiene historial</span></div>
  </div></span>
</section>
<section class="isla" style="flex:1;min-height:0;border-radius:20px;display:flex;flex-direction:column;overflow:hidden">
 <div style="padding:12px 18px;border-bottom:1px solid #F1F5F9;flex:0 0 auto"><div class="segb"><sc-for list="{{tabs}}" as="t"><button class="ts {{t.cls}}" onClick="{{t.ir}}"><span class="ti ti-{{t.ico}}" style="width:16px;height:16px"></span>{{t.nom}}<span class="c {{t.cc}}" style="display:{{t.vc}}">{{t.n}}</span></button></sc-for></div></div>
 <div class="sc" style="flex:1;padding:16px 18px">
 <<resumen>><<conexion>><<red>><<velocidad>><<servicios>><<bitacora>>
 </div>
</section>''',resumen=resumen,conexion=conexion,red=red,velocidad=velocidad,servicios=servicios,bitacora=bitacora)
logic='''class Component extends DCLogic {
renderVals() {
const tabs = %s;
const st = this.state || {};
const act = st.tab || 'resumen';
const v = {};
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
tabs.forEach((t) => { v[t[0]] = t[0] === act ? 'flex' : 'none'; });
return {
  colas: colasV, colaX, vOtras: otras ? 'grid' : 'none', otrasTxt: otras ? 'Ocultar las otras' : 'Ver las otras (2)', verOtras: () => this.setState({ otras: !otras }),
  v, verMenu: st.menu ? 'block' : 'none', menu: () => this.setState({ menu: !st.menu }),
  irRed: () => this.setState({ tab: 'red' }), irBit: () => this.setState({ tab: 'bitacora' }),
  tabs: tabs.map((t) => ({ id: t[0], nom: t[1], ico: t[2], n: t[3], vc: t[3] ? 'inline' : 'none', cc: t[0] === 'bitacora' ? 'rj' : '', cls: t[0] === act ? 'on' : '', ir: () => this.setState({ tab: t[0], menu: false }) }))
};
}
}''' % JS(tabs)
build('RedRouterFicha.dc.html','Red · Ficha del router',shell('red',['Red','Routers','MK Centro'],inner),logic,1000,CSS2+'\n.pill .nm{display:inline}\n.pill.off{opacity:1;text-decoration:none;cursor:pointer;color:#94A3B8}\n.pill.off .nm{text-decoration:line-through}\n.pill .qi{width:18px;height:18px;border-radius:999px;background:#E0E7FF;color:#3730A3;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;font-style:normal}\n.pill.ver{box-shadow:0 0 0 3px rgba(79,70,229,.18);border-color:#A5B4FC}\n.pill.on.ver{border-color:#4F46E5}\n.exq{margin-top:10px;border:1px solid #C7D2FE;background:#F5F7FF;border-radius:14px;padding:12px 14px;font-size:13px;line-height:1.5;color:#334155}\n.rec{font-size:10px;font-weight:700;color:#166534;background:#DCFCE7;border-radius:999px;padding:1px 7px;margin-left:4px;vertical-align:middle}\n'+mask(['home','plug','net','gauge','usuarios','hist']))
