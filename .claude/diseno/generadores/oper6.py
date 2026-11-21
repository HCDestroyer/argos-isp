exec(open('/tmp/claude-0/-home-user/59389ade-3278-540a-8050-19c26767da8e/scratchpad/gen/oper_base.py').read())
tgl=lambda on:'<span class="tg %s"><i></i></span>'%('on' if on else '')
# ================= 6a · Bitácora =================
ac=[
 dict(id=1,h='09:41',q='Ana Cruz',qi='AC',cn='Panel',cc='nf',a='Comprobante aprobado',ak='comprobantes.aprobar',e='Comprobante #5514 · Rosa Méndez',r='Correcto',rc='ok'),
 dict(id=2,h='09:38',q='Luis Tum',qi='LT',cn='Panel',cc='nf',a='Servicio editado',ak='servicios.editar',e='S-000412 · Casa',r='Correcto',rc='ok'),
 dict(id=3,h='09:33',q='Asistente de Iris',qi='IA',cn='Iris',cc='cy',a='Promesa creada',ak='promesas.crear',e='S-000291 · Marta Xicará',r='Correcto',rc='ok'),
 dict(id=4,h='09:30',q='Marvin Ajú',qi='MA',cn='Iris',cc='cy',a='Equipo cambiado',ak='servicios.cambiar_equipo',e='S-000530 · ZTE F670L',r='Correcto',rc='ok'),
 dict(id=5,h='09:12',q='Sistema',qi='⚙',cn='Cron',cc='ne',a='Corte ejecutado',ak='facturas.corte',e='41 servicios evaluados · 6 suspendidos',r='Correcto',rc='ok'),
 dict(id=6,h='09:02',q='Token «Reportes BI»',qi='TK',cn='API',cc='ne',a='Factura anulada',ak='facturas.anular',e='FAC-A 004101',r='Rechazado: sin permiso',rc='er'),
 dict(id=7,h='08:55',q='Ana Cruz',qi='AC',cn='Panel',cc='nf',a='Contraseña PPPoE vista',ak='servicios.ver_credenciales',e='S-000187 · Local',r='Correcto',rc='ok'),
 dict(id=8,h='08:41',q='Rosa Méndez (cliente)',qi='RM',cn='Portal',cc='ne',a='Promesa creada',ak='promesas.crear',e='S-000412 · Casa',r='Correcto',rc='ok'),
]
CB='64px minmax(0,1.1fr) 86px minmax(0,1.2fr) minmax(0,1.3fr) 150px'
dif=[('Dirección','3.ª calle 1-10, zona 1','4.ª calle 2-15, zona 1'),('Referencia','Portón negro','Casa verde, frente a la tienda'),('Teléfono en sitio','5512-3344','5512-3344 · 5598-7711'),('Contraseña PPPoE','***','***')]
inner=head('Bitácora','Quién hizo qué, cuándo y desde dónde. Nada se borra ni se edita.','<button class="btn o"><i:desc:16>Descargar lo filtrado</button>','Ayuda: la bitácora')+T('''
<div style="flex:1;min-height:0;display:flex;gap:12px">
 <section class="isla pan" style="flex:1;min-width:0">
  <div style="padding:12px 18px 10px;display:flex;gap:10px;align-items:center"><<seg>><span style="flex:1"></span><span class="selp"><i:cal:15>Hoy, 21 nov<i:ab:14></span></div>
  <div style="display:flex;align-items:center;gap:8px;padding:0 18px 12px;flex-wrap:wrap"><span class="busca" style="flex:1;min-width:200px"><i:bus:15>Cliente, servicio o factura…</span><span class="selp"><i:user:15>Quién: todos<i:ab:14></span><span class="selp"><i:rayo:15>Acción: todas<i:ab:14></span><span class="selp"><i:chat:15>Desde: todos<i:ab:14></span><span class="fc" style="border-color:#FECACA;color:#B91C1C"><i:x:14>Solo rechazadas</span></div>
  <div class="lh" style="grid-template-columns:<<c>>"><span>Hora</span><span>Quién</span><span>Desde</span><span>Qué hizo</span><span>Sobre qué</span><span>Resultado</span></div>
  <div class="sc" style="flex:1"><sc-for list="{{ac}}" as="x"><div class="lr {{x.cls}}" style="grid-template-columns:<<c>>" onClick="{{x.ver}}">
   <span class="num m2" style="color:#334155">{{x.h}}</span>
   <div style="display:flex;gap:9px;align-items:center"><span class="av" style="width:30px;height:30px;border-radius:9px;background:#EEF2FF;color:#3730A3;font-size:11px">{{x.qi}}</span><b class="el">{{x.q}}</b></div>
   <span><span class="b {{x.cc}}">{{x.cn}}</span></span>
   <div><b class="el" style="display:block">{{x.a}}</b><span class="m2 mono el" style="font-size:11.5px;display:block">{{x.ak}}</span></div>
   <span class="el">{{x.e}}</span>
   <span><span class="b {{x.rc}}">{{x.r}}</span></span>
  </div></sc-for></div>
  <div class="pf m2">8 de 1,912 de hoy · <a href="#">Cargar más</a><span style="flex:1"></span>Los sondeos y evaluaciones sin efecto no dejan fila.</div>
 </section>
 <aside class="isla pan" style="width:420px;flex:0 0 auto">
  <div class="ph2"><span class="ico nf"><i:dif:19></span><div style="flex:1;min-width:0"><b style="font-size:16px">Servicio editado</b><div class="m2 el">Luis Tum · hoy 09:38 · desde el panel</div></div><span class="b ok">Correcto</span></div>
  <div class="sc" style="flex:1;padding:12px 18px">
   <div class="sec">Qué cambió · 3 campos</div>
   <<dif>>
   <div class="sec" style="margin-top:14px">Detalles</div>
   <<k1>><<k2>><<k3>><<k4>>
   <div class="sec" style="margin-top:14px">En la misma petición</div>
   <div class="tl" style="font-size:13px;border-top:0"><span class="ic ico ne" style="width:30px;height:30px;border-radius:9px"><i:enviar:14></span><div><b>Evento servicio.datos_cambiados</b><div class="m2">Enviado a Iris · entregado 09:38</div></div></div>
  </div>
  <div class="pf"><button class="btn o sm" style="flex:1;justify-content:center">Abrir el servicio</button><button class="btn o sm" style="flex:1;justify-content:center">Todo lo de Luis Tum</button></div>
 </aside>
</div>''',c=CB,seg=seg('t',[('acc','Acciones','rayo'),('cam','Cambios de datos','dif'),('red','Órdenes a la red','router')]),
 dif=''.join(T('<div style="padding:9px 0;border-top:1px solid #F1F5F9;font-size:13px"><div class="m2" style="margin-bottom:4px"><<a>></div><div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><span class="dfa"><<b>></span><i:der:13><span class="dfb"><<c>></span></div></div>',a=a,b=b,c=c) for a,b,c in dif[:3])+T('<div class="m2" style="padding-top:8px"><i:bloq:12> Lo sensible (contraseñas, tokens) siempre se guarda como ***.</div>'),
 k1=kv('Acción','<span class="mono" style="font-size:12px">servicios.editar</span>'),k2=kv('Sobre','<a href="#" class="mono">S-000412</a> · Casa'),k3=kv('Petición','<span class="copy" style="font-size:11.5px">req_8f3a1c22</span>'),k4=kv('Equipo','190.56.12.9 · Chrome en Windows'))
obuild('OperBitacora.dc.html','Bitácora',shell2('aj',['Sistema','Bitácora'],inner),logic({'t':(['acc','cam','red'],'acc'),'m':(['no'],'no')},{'ac':dict(rows=ac,**{'def':2})}))
check('OperBitacora.dc.html')

# ================= 6b · Lealtad =================
reglas=[('Pagar antes de vencer','50 puntos por factura','cob',1),('Antigüedad','100 puntos cada 12 meses','cal',1),('Referir a un cliente','300 puntos cuando el referido paga su 2.ª factura','usuarios',1),('Pago en línea','10 puntos extra','tarjeta',0)]
canjes=[('Rosa Méndez','S-000412','Descuento Q 50 en factura','500','Aplicado en FAC-A 004512','ok'),('Luis Coc','S-000614','Router Wi-Fi 6','2,000','Reservado · por entregar','wa'),('Aura Batz','S-000122','Mes de Streaming Plus','800','Aplicado','ok'),('Pedro Cumes','S-000377','Descuento Q 50 en factura','500','Revertido · factura anulada','ne')]
premios=[('Descuento Q 50 en factura','500 pts','tag'),('Mes de Streaming Plus','800 pts','foto'),('Subir de plan 1 mes','1,200 pts','vel'),('Router Wi-Fi 6','2,000 pts','router')]
kp=lambda cls,ico,l,v,sub: T('<div class="card" style="padding:11px 14px;display:flex;align-items:center;gap:12px;flex:1;min-width:0"><span class="ico <<cls>>"><i:<<ico>>:19></span><div style="min-width:0"><div class="m2"><<l>></div><b style="font-size:19px" class="num"><<v>></b> <span class="m2"><<sub>></span></div></div>',cls=cls,ico=ico,l=l,v=v,sub=sub)
CJ='minmax(0,1.1fr) 110px minmax(0,1.3fr) 90px minmax(0,1.2fr)'
linner=head('Lealtad','Puntos por pagar a tiempo, por antigüedad y por referir; se canjean por premios','<button class="btn o"><i:trofeo:16>Sorteos</button><button class="btn p" style="padding:11px 20px"><i:regalo:16>Canjear puntos</button>','Ayuda: programa de lealtad')+T('''
<div style="display:flex;gap:12px;flex:0 0 auto"><<k1>><<k2>><<k3>><<k4>></div>
<section class="isla pan" style="flex:1">
 <div style="padding:12px 18px;border-bottom:1px solid #F1F5F9;display:flex;align-items:center;gap:10px"><<seg>><span style="flex:1"></span><span class="m2">Programa «Puntos Conecta»</span><<tg>></div>
 <div class="sc" style="flex:1;padding:14px 18px;display:{{t.prog.v}};gap:12px">
  <div style="flex:1.2;display:flex;flex-direction:column;gap:12px;min-width:0"><section class="cd"><div class="cdh"><i:estrella:15>Cómo se ganan puntos<button class="lnk">Nueva regla</button></div><<reglas>></section>
   <section class="cd"><div class="cdh"><i:reloj:15>Vencimiento</div><<v1>><<v2>></section></div>
  <div style="flex:1;display:flex;flex-direction:column;gap:12px;min-width:0"><section class="cd"><div class="cdh"><i:regalo:15>Premios<button class="lnk">Nuevo premio</button></div><<premios>></section>
   <div class="av2 nf" style="align-items:flex-start"><i:info:16><div>Si una factura se anula o un pago se revierte, sus puntos se revierten solos. El cliente ve sus puntos en el portal.</div></div></div>
 </div>
 <div style="flex:1;min-height:0;display:{{t.can.v}};flex-direction:column">
  <div style="display:flex;gap:8px;padding:12px 18px"><span class="busca" style="flex:1"><i:bus:15>Cliente o premio…</span><span class="selp">Estado: todos<i:ab:14></span></div>
  <div class="lh" style="grid-template-columns:<<c>>"><span>Cliente</span><span>Servicio</span><span>Premio</span><span class="r">Puntos</span><span>Estado</span></div>
  <div class="sc" style="flex:1"><<canjes>></div></div>
 <div style="flex:1;min-height:0;display:{{t.ref.v}};flex-direction:column;padding:14px 18px"><<refs>></div>
</section>''',c=CJ,seg=seg('t',[('prog','Programa y premios','estrella'),('can','Canjes','regalo',38),('ref','Referidos','usuarios',12)]),tg=tgl(True),
 k1=kp('nf','estrella','Puntos en circulación','184,200','en 912 clientes'),k2=kp('ok','regalo','Canjes este mes','38','19,400 puntos'),k3=kp('wa','reloj','Vencen en 30 días','6,150','41 clientes avisados'),k4=kp('cy','usuarios','Referidos que calificaron','12','de 27 este año'),
 reglas=''.join(T('<div class="kv2"><span style="color:#0F172A;display:flex;gap:10px;align-items:center"><span class="ico nf" style="width:32px;height:32px;border-radius:10px"><i:<<i>>:15></span><span><b><<a>></b><span class="m2" style="display:block"><<b>></span></span></span><<t>></div>',a=a,b=b,i=i,t=tgl(o)) for a,b,i,o in reglas),
 v1=kv('Los puntos vencen','<b>12 meses</b> después de ganarlos'),v2=kv('Aviso antes de vencer','30 días · por WhatsApp'),
 premios=''.join(T('<div class="kv2"><span style="color:#0F172A;display:flex;gap:10px;align-items:center"><span class="ico cy" style="width:32px;height:32px;border-radius:10px"><i:<<i>>:15></span><b><<a>></b></span><b class="num"><<b>></b></div>',a=a,b=b,i=i) for a,b,i in premios),
 canjes=''.join(T('<div class="lr" style="grid-template-columns:<<c>>"><b class="el"><<a>></b><span class="mono" style="font-size:12px"><<b>></span><span class="el"><<d>></span><b class="num r"><<p>></b><span><span class="b <<k>>"><<e>></span></span></div>',c=CJ,a=a,b=b,d=d,p=p,e=e,k=k) for a,b,d,p,e,k in canjes),
 refs=''.join(T('<div class="kv2"><span style="color:#0F172A"><b><<a>></b> refirió a <b><<b>></b></span><span class="b <<k>>"><<e>></span></div>',a=a,b=b,e=e,k=k) for a,b,e,k in [('Rosa Méndez','Luis Pérez','Calificó · 300 puntos','ok'),('Aura Batz','Tienda La Bendición','Espera su 2.ª factura','wa'),('Luis Coc','Mario Sic','Rechazado: misma dirección','er')]))
obuild('OperLealtad.dc.html','Lealtad · programa, puntos y canjes',shell2('dia',['Clientes','Lealtad'],linner),logic({'t':(['prog','can','ref'],'prog'),'m':(['no'],'no')}))
check('OperLealtad.dc.html')

# ================= 6c · Sorteo con acta =================
pasos=[('Bases','ok'),('Participación','ok'),('Corte','ok'),('Sorteo','ok'),('Entrega','on'),('Acta','')]
prog=''.join(T('<button class="pc <<k>>"><span class="n"><<n>></span><<t>></button>'+('<span class="ln <<lk>>"></span>' if i<5 else ''),k=k,n=(s('check',13) if k=='ok' else str(i+1)),t=t_,lk='ok' if k=='ok' else '') for i,(t_,k) in enumerate(pasos))
gan=[('1','Televisor 55"','Marta Xicará','S-000291','Entregado el 18 nov · con foto y firma','ok','Titular'),('2','Tablet','Luis Coc','S-000614','Avisado · reclama antes del 15 dic','wa','Titular'),('3','3 meses gratis','Pedro Cumes','S-000377','No se presentó · pasa al suplente','er','Titular'),('3','3 meses gratis','Aura Batz','S-000122','Suplente avisada hoy','nf','Suplente')]
req=[('Autorización de Gobernación','Resolución 114-2026.pdf',1),('Bases publicadas','Hash a3f1…9c · 1 oct',1),('Lista de participantes cerrada','1,104 boletos · hash 77be…02',1),('Presencia de notario o delegado','Lic. Mario Sic · colegiado 12,345',1),('Constancia de entrega de cada premio','1 de 3',0)]
CG='44px minmax(0,1fr) minmax(0,1.1fr) 110px minmax(0,1.5fr) 110px'
sinner=head('Sorteo de fin de año 2026','Para clientes al día al 30 de noviembre · 3 premios · sorteado el 10 nov','<button class="btn o"><i:desc:16>Participantes</button><button class="btn o"><i:enviar:16>Avisar ganadores (1)</button><button class="btn p" style="padding:11px 20px"><i:doc:16>Cerrar acta</button>','Ayuda: sorteos')+T('''
<section class="isla" style="border-radius:20px;padding:12px 18px;display:flex;align-items:center;gap:8px;flex:0 0 auto"><<prog>></section>
<div style="flex:1;min-height:0;display:flex;gap:12px">
 <section class="isla pan" style="flex:1;min-width:0">
  <div class="ph2"><i:trofeo:17><b style="flex:1">Ganadores</b><span class="m2">Elegidos con una semilla pública: cualquiera puede comprobar el resultado</span><button class="lnk">Ver verificación</button></div>
  <div class="lh" style="grid-template-columns:<<c>>;border-top:0"><span>#</span><span>Premio</span><span>Ganador</span><span>Servicio</span><span>Entrega</span><span></span></div>
  <div class="sc" style="flex:1"><<gan>>
   <div style="padding:14px 18px"><div class="av2 wa" style="align-items:flex-start"><i:alerta:17><div>No puedes cerrar el acta todavía: falta entregar 2 premios o declararlos no reclamados (plazo: 30 días).</div></div></div></div>
 </section>
 <aside class="isla pan" style="width:400px;flex:0 0 auto">
  <div class="ph2"><i:escudo:17><div style="flex:1"><b>Lo que pide la ley</b><div class="m2">Cada paso con su evidencia</div></div><span class="b wa">4 de 5</span></div>
  <div class="sc" style="flex:1;padding:6px 18px"><<req>>
   <section class="cd" style="margin-top:12px;background:#F8FAFC"><div class="cdh"><i:doc:15>Acta</div><div class="m2" style="line-height:1.5">Al cerrarla se genera el PDF con las bases, la lista, los ganadores, las entregas y sus hashes. Después ya no se puede cambiar nada.</div><div style="display:flex;gap:8px;margin-top:10px"><button class="btn o sm"><i:ojo:14>Ver borrador</button><button class="btn o sm"><i:desc:14>Bases (PDF)</button></div></section></div>
 </aside>
</div>''',prog=prog,c=CG,
 gan=''.join(T('<div class="lr" style="grid-template-columns:<<c>>"><span class="ico nf" style="width:32px;height:32px;border-radius:10px;font-weight:700"><<n>></span><b class="el"><<p>></b><div><b class="el" style="display:block"><<g>></b><span class="m2"><<t>></span></div><span class="mono" style="font-size:12px"><<sv>></span><span class="el"><span class="b <<k>>"><<e>></span></span><button class="lnk" style="justify-self:end"><<acc>></button></div>',c=CG,n=n,p=p,g=g,sv=sv,e=e,k=k,t=t_,acc={'ok':'Ver constancia','wa':'Entregar','er':'','nf':'Entregar'}[k]) for n,p,g,sv,e,k,t_ in gan),
 req=''.join(T('<div class="kv2"><span style="color:#0F172A;display:flex;gap:10px;align-items:center"><span class="ck2 <<on>>"><<ch>></span><span><b><<a>></b><span class="m2" style="display:block"><<b>></span></span></span></div>',on='on' if o else '',ch=s('check',13) if o else '',a=a,b=b) for a,b,o in req))
obuild('OperSorteo.dc.html','Sorteo · ganadores, entrega y acta',shell2('dia',['Clientes','Lealtad','Sorteos','Fin de año 2026'],sinner),logic({'m':(['no'],'no')}))
check('OperSorteo.dc.html')

# ================= 6d · Usuarios: lista y perfil =================
us=[('AC','Ana Cruz','ana.cruz@conecta.gt','Cajero · Contabilidad','Caja Centro','hace 2 min','Activo','ok',1,'Iris'),('LT','Luis Tum','luis.tum@conecta.gt','Soporte','Todo','hace 1 h','Activo','ok',0,'Iris'),('MA','Marvin Ajú','marvin@conecta.gt','Técnico','Zona Norte · MK Norte','ayer','Activo','ok',0,'Iris'),('JP','Julia Pérez','julia@conecta.gt','Admin','Todo · 2 empresas','hoy 08:02','Activo','ok',0,'Iris · Horus'),('CR','Carlos Ruiz','carlos@conecta.gt','Cajero','Caja Tecpán','hace 3 días','Activo','ok',0,''),('EV','Elena Vásquez','elena@conecta.gt','Lectura','Todo','hace 2 meses','Desactivado','ne',0,'')]
CU='minmax(0,1.5fr) minmax(0,1fr) minmax(0,1fr) 110px 110px'
uinner=head('Usuarios','Las personas que entran al panel, con su rol y hasta dónde llega','<button class="btn o"><i:escudo:16>Roles y permisos</button><button class="btn o"><i:llave:16>Tokens de API</button><button class="btn p" style="padding:11px 20px"><i:mas1:16>Nuevo usuario</button>','Ayuda: usuarios')+T('''
<div style="flex:1;min-height:0;display:flex;gap:12px">
 <section class="isla pan" style="flex:1;min-width:0">
  <div style="padding:12px 18px 10px"><<seg>></div>
  <div style="display:flex;gap:8px;padding:0 18px 12px"><span class="busca" style="flex:1"><i:bus:15>Nombre o correo…</span><span class="selp"><i:escudo:15>Rol: todos<i:ab:14></span></div>
  <div class="lh" style="grid-template-columns:<<c>>"><span>Usuario</span><span>Rol</span><span>Alcance</span><span>Última vez</span><span>Estado</span></div>
  <div class="sc" style="flex:1"><<rows>></div>
 </section>
 <aside class="isla pan" style="width:420px;flex:0 0 auto">
  <div class="ph2"><span class="av" style="width:46px;height:46px;border-radius:14px;background:#E0E7FF;color:#3730A3;font-size:15px">AC</span><div style="flex:1;min-width:0"><b style="font-size:17px">Ana Cruz</b><div class="m2 el">ana.cruz@conecta.gt · desde feb 2024</div></div><span class="b ok">Activo</span></div>
  <div class="sc" style="flex:1;padding:12px 18px">
   <div class="sec">Roles y alcance</div>
   <div class="kv2" style="border-top:0"><span style="color:#0F172A"><b>Cajero</b><span class="m2" style="display:block">Cobra, abre y cierra su caja</span></span><span class="b nf"><i:caja:12>Caja Centro</span></div>
   <div class="kv2"><span style="color:#0F172A"><b>Contabilidad</b><span class="m2" style="display:block">Libro, bancos y reportes</span></span><span class="b ne">Toda la empresa</span></div>
   <button class="lnk" style="margin-top:6px"><i:mas1:13> Agregar rol</button>
   <div class="sec" style="margin-top:14px">Empresas</div><div style="display:flex;gap:6px"><span class="fc on" style="padding:5px 10px">Conecta, S.A.</span><span class="fc" style="padding:5px 10px">Conecta Norte, S.A.</span></div>
   <div class="sec" style="margin-top:14px">Seguridad</div>
   <<s1>><<s2>><<s3>>
   <div class="sec" style="margin-top:14px">Lo último que hizo</div>
   <div class="kv2" style="border-top:0"><span style="color:#0F172A">Comprobante aprobado · #5514</span><span class="m2">09:41</span></div><div class="kv2"><span style="color:#0F172A">Cobro Q 325.00 · Luis Coc</span><span class="m2">09:20</span></div><button class="lnk" style="margin-top:4px">Ver todo en la bitácora</button>
  </div>
  <div class="pf"><button class="btn o sm"><i:editar:14>Editar</button><button class="btn o sm"><i:llave:14>Contraseña <span class="nuevo">nuevo</span></button><span style="flex:1"></span><button class="btn r sm">Desactivar</button></div>
 </aside>
</div>''',c=CU,seg=seg('t',[('act','Activos',None,14),('des','Desactivados',None,3),('tec','Tokens y sistemas',None,4)]),
 rows=''.join(T('<div class="lr <<on>>" style="grid-template-columns:<<c>>"><div style="display:flex;gap:11px;align-items:center"><span class="av" style="background:#EEF2FF;color:#3730A3"><<i>></span><div style="min-width:0"><b class="el" style="display:block;font-size:14px"><<n>></b><span class="m2 el"><<m>></span></div></div><span class="el"><<r>></span><span class="el m2" style="color:#334155"><<al>></span><span class="m2"><<u>></span><span><span class="b <<k>>"><<e>></span></span></div>',c=CU,on='on' if o else '',i=i,n=n,m=m,r=r,al=al,u=u,e=e,k=k) for i,n,m,r,al,u,e,k,o,v in us),
 s1=kv('Sesiones abiertas','2 · <button class="lnk">Cerrar todas</button> <span class="nuevo">nuevo</span>'),s2=kv('Cuentas vinculadas','Iris (ana.cruz)'),s3=kv('Último ingreso','hoy 07:58 · 190.56.12.9'))
obuild('OperUsuarios.dc.html','Usuarios · lista y perfil',shell2('aj',['Configuración','Usuarios y permisos','Usuarios'],uinner),logic({'t':(['act','des','tec'],'act'),'m':(['no'],'no')}))
check('OperUsuarios.dc.html')

# ================= 6e · Roles y permisos con alcance =================
roles=[('Admin','Todo','2 usuarios','Base',0),('Cajero','Cobro y caja','4 usuarios','Base',1),('Soporte','Clientes y servicios','3 usuarios','Base',0),('Técnico','Red e inventario','3 usuarios','Base',0),('Contabilidad','Libro y bancos','2 usuarios','Base',0),('Lectura','Solo ver','1 usuario','Base',0),('Supervisor de caja','Cajero + aprobar y anular','1 usuario','Propio',0)]
mods=[('Cobro','cob','5 de 6',[('Cobrar','pagos.registrar',1,''),('Ver pagos','pagos.ver',1,''),('Anular un pago','pagos.anular',0,'Sensible'),('Registrar comprobantes','comprobantes.registrar',1,''),('Aprobar comprobantes','comprobantes.aprobar',1,'Sensible'),('Rechazar comprobantes','comprobantes.rechazar',1,'')]),('Promesas','mano','2 de 5',[('Ver promesas','promesas.ver',1,''),('Crear promesas','promesas.crear',1,''),('Aprobar fuera de política','promesas.aprobar',0,'Sensible')]),('Facturas','fac','1 de 12',[('Ver facturas','facturas.ver',1,''),('Editar el monto de un periodo','facturas.editar_monto_periodo',0,'Sensible'),('Emitir periodos anteriores','facturas.emitir_periodo_anterior',0,'Sensible')])]
def modblk(n,i,cnt,ps):
    return T('<div class="cd" style="padding:0;overflow:hidden;flex:0 0 auto"><div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:#F8FAFC"><span class="ico nf" style="width:30px;height:30px;border-radius:9px"><i:<<i>>:15></span><b style="flex:1"><<n>></b><span class="m2"><<c>></span><button class="lnk">Todos</button></div><<ps>></div>',n=n,i=i,c=cnt,ps=''.join(T('<div style="display:flex;align-items:center;gap:10px;padding:9px 14px;border-top:1px solid #F1F5F9;font-size:13.5px"><span style="flex:1;min-width:0"><b><<a>></b> <<x>><span class="m2 mono" style="display:block;font-size:11.5px"><<b>></span></span><<t>></div>',a=a,b=b,t=tgl(o),x=(B('wa',x) if x else '')) for a,b,o,x in ps))
rinner=head('Roles y permisos','Un rol agrupa lo que una persona puede hacer. El alcance dice dónde puede hacerlo.','<button class="btn o"><i:copiar:16>Duplicar rol</button><button class="btn p" style="padding:11px 20px"><i:mas1:16>Nuevo rol</button>','Ayuda: roles y permisos')+T('''
<div style="flex:1;min-height:0;display:flex;gap:12px">
 <section class="isla pan" style="width:290px;flex:0 0 auto"><div class="sc" style="flex:1"><<roles>></div></section>
 <section class="isla pan" style="flex:1;min-width:0">
  <div class="ph2"><div style="flex:1"><b style="font-size:17px">Cajero</b> <span class="b ne">Rol base</span><div class="m2">4 usuarios · 9 de 214 permisos</div></div><span class="busca" style="width:260px"><i:bus:15>Buscar permiso…</span></div>
  <div class="sc" style="flex:1;padding:14px 18px;display:flex;flex-direction:column;gap:12px"><<mods>><div class="m2">+ 11 módulos más: Clientes, Servicios, Red, Inventario, Finanzas, Fiscal, Lealtad, Notificaciones, Integraciones, Usuarios, Sistema</div></div>
  <div class="pf" style="padding:12px 18px"><span class="m2" style="flex:1">Cada permiso es una acción del sistema; lo que no está encendido ni siquiera aparece en el menú.</span><button class="btn g">Descartar</button><button class="btn p">Guardar rol</button></div>
 </section>
 <aside class="isla pan" style="width:330px;flex:0 0 auto">
  <div class="ph2"><i:mapa:17><div><b>Alcance</b><div class="m2">Dónde vale este rol para cada persona</div></div></div>
  <div class="sc" style="flex:1;padding:12px 16px;display:flex;flex-direction:column;gap:10px">
   <div class="segb" style="display:flex"><button class="ts" style="flex:1;justify-content:center;padding:7px 6px">Todo</button><button class="ts" style="flex:1;justify-content:center;padding:7px 6px">Router</button><button class="ts" style="flex:1;justify-content:center;padding:7px 6px">Zona</button><button class="ts on" style="flex:1;justify-content:center;padding:7px 6px">Caja</button></div>
   <div class="m2" style="line-height:1.5">Un cajero solo cobra y cierra <b>su caja</b>. Se elige al dar el rol a cada usuario:</div>
   <<a1>><<a2>><<a3>><<a4>>
   <div class="av2 nf" style="align-items:flex-start;padding:9px 12px"><i:info:16><div>Por <b>router</b> o <b>zona</b>: un técnico solo ve y toca los clientes y equipos de su zona. Un token de API o un asistente de IA usa el mismo sistema.</div></div>
  </div>
 </aside>
</div>''',roles=''.join(T('<div class="lr <<on>>" style="grid-template-columns:minmax(0,1fr) auto"><div><b style="font-size:14px;display:block"><<a>></b><span class="m2"><<b>> · <<c>></span></div><span class="b <<k>>"><<t>></span></div>',on='on' if o else '',a=a,b=b,c=c,t=t_,k='ne' if t_=='Base' else 'cy') for a,b,c,t_,o in roles),mods=''.join(modblk(*m) for m in mods),
 a1=kv('<span style="color:#0F172A"><b>Ana Cruz</b></span>','<span class="b nf">Caja Centro</span>'),a2=kv('<span style="color:#0F172A"><b>Carlos Ruiz</b></span>','<span class="b nf">Caja Tecpán</span>'),a3=kv('<span style="color:#0F172A"><b>Sofía Paz</b></span>','<span class="b nf">Caja Centro</span>'),a4=kv('<span style="color:#0F172A"><b>Julia Pérez</b></span>','<span class="b ne">Todas las cajas</span>'))
obuild('OperRoles.dc.html','Roles y permisos con alcance',shell2('aj',['Configuración','Usuarios y permisos','Roles'],rinner),logic({'m':(['no'],'no')}))
check('OperRoles.dc.html')
