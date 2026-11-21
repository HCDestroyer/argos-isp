exec(open('/tmp/claude-0/-home-user/59389ade-3278-540a-8050-19c26767da8e/scratchpad/gen/oper_base.py').read())
# ================= 1 · Comprobantes =================
comp=[
 dict(id=1,cl='Rosa Méndez',sv='S-000412 · Casa',cn='Iris',cc='cy',ci='chat',met='Depósito',cta='Banrural · 3-044-12345-6',ref='88214507',monto='250.00',fecha='20 nov',hace='hace 3 h',hc='#B91C1C',g='pend',svE='Suspendido',svC='er',av='flex',sug='Factura de noviembre · S-000412',sugM='250.00',dif='Coincide con lo vencido',difC='ok',iris='flex',conf='92 %',lee='Leído por el asistente',quien='Mandó: Luis Pérez (contacto, puede pagar)'),
 dict(id=2,cl='Ferretería El Clavo',sv='S-000187 · Local',cn='Portal',cc='nf',ci='globo',met='Transferencia',cta='BI · 029-004411-2',ref='TRX-55120093',monto='1,150.00',fecha='21 nov',hace='hace 1 h',hc='#92400E',g='pend',svE='Activo',svC='ok',av='none',sug='Facturas de octubre y noviembre · S-000187',sugM='1,150.00',dif='Coincide con 2 facturas',difC='ok',iris='none',conf='',lee='',quien='Lo subió el titular desde el portal'),
 dict(id=3,cl='Carlos Ajú',sv='S-000530',cn='Iris',cc='cy',ci='chat',met='Depósito',cta='Banrural · 3-044-12345-6',ref='88214699',monto='200.00',fecha='21 nov',hace='hace 40 min',hc='#64748B',g='pend',svE='Limitado',svC='wa',av='none',sug='Factura de noviembre · S-000530',sugM='250.00',dif='Faltan Q 50.00: queda como abono',difC='wa',iris='flex',conf='61 %',lee='Lo dictó el cliente',quien='Mandó: el titular'),
 dict(id=4,cl='Marta Xicará',sv='S-000291 · Casa',cn='Panel',cc='ne',ci='user',met='ACH',cta='G&T · 001-0099887-1',ref='ACH-771203',monto='300.00',fecha='21 nov',hace='hace 25 min',hc='#64748B',g='pend',svE='Activo',svC='ok',av='none',sug='Factura de noviembre · S-000291',sugM='300.00',dif='Coincide',difC='ok',iris='none',conf='',lee='',quien='Lo registró Ana Cruz (soporte)'),
 dict(id=5,cl='Luis Coc',sv='S-000614',cn='Portal',cc='nf',ci='globo',met='Depósito',cta='Banrural · 3-044-12345-6',ref='88215001',monto='350.00',fecha='21 nov',hace='hace 12 min',hc='#64748B',g='pend',svE='Activo',svC='ok',av='none',sug='Factura de noviembre · S-000614',sugM='350.00',dif='Coincide',difC='ok',iris='none',conf='',lee='',quien='Lo subió el titular desde el portal'),
 dict(id=6,cl='Aura Batz',sv='S-000122',cn='Iris',cc='cy',ci='chat',met='Remesa',cta='Banrural · 3-044-12345-6',ref='RM-440912',monto='250.00',fecha='21 nov',hace='Aprobado 09:10',hc='#166534',g='apr',svE='Activo',svC='ok',av='none',sug='Pago #20418',sugM='250.00',dif='Aplicado',difC='ok',iris='flex',conf='97 %',lee='Leído por el asistente',quien='Aprobó: Ana Cruz'),
 dict(id=7,cl='Pedro Cumes',sv='S-000377',cn='Portal',cc='nf',ci='globo',met='Depósito',cta='BI · 029-004411-2',ref='10293847',monto='250.00',fecha='19 nov',hace='Rechazado ayer',hc='#B91C1C',g='rec',svE='Suspendido',svC='er',av='none',sug='No aparece en el banco',sugM='—',dif='Rechazado',difC='er',iris='none',conf='',lee='',quien='Rechazó: Ana Cruz'),
]
CL='minmax(0,1.5fr) 92px minmax(0,1.1fr) 100px 110px'
lista=T('''<div class="lh" style="grid-template-columns:<<c>>"><span>Cliente y servicio</span><span>Llegó por</span><span>Cuenta y referencia</span><span class="r">Monto</span><span class="r">Espera</span></div>
<div class="sc" style="flex:1"><sc-for list="{{comp}}" as="x"><div class="lr {{x.cls}}" style="grid-template-columns:<<c>>" onClick="{{x.ver}}">
 <div><b class="el" style="display:block;font-size:14px">{{x.cl}}</b><div class="m2 el"><span class="mono" style="font-size:12px">{{x.sv}}</span> · <span class="b {{x.svC}}" style="padding:1px 7px;font-size:11px">{{x.svE}}</span></div></div>
 <span><span class="b {{x.cc}}">{{x.cn}}</span></span>
 <div><div class="el">{{x.met}} · {{x.cta}}</div><div class="m2 mono el" style="font-size:12px">Ref. {{x.ref}} · {{x.fecha}}</div></div>
 <b class="num r" style="font-size:15px">Q {{x.monto}}</b>
 <span class="r m2" style="color:{{x.hc}};font-weight:600">{{x.hace}}</span>
</div></sc-for>
<div style="display:{{compVacio}};padding:40px;text-align:center;color:#64748B;font-size:14px">Nada por aquí.</div></div>
<div class="pf m2"><i:info:14>La cola ordena primero lo más antiguo. Los que llegan por Iris traen la conversación.<span style="flex:1"></span>{{compN}} comprobantes</div>''',c=CL)
boleta=T('''<div style="position:relative;background:#0F172A;border-radius:16px;height:262px;display:flex;align-items:center;justify-content:center;overflow:hidden;flex:0 0 auto">
 <div aria-label="Imagen del comprobante" role="img" style="width:176px;height:232px;background:#FDFDF7;border-radius:4px;transform:rotate(-2deg);padding:11px 11px;font-family:ui-monospace,Menlo,monospace;font-size:9px;line-height:1.5;color:#334155;box-shadow:0 10px 30px rgba(0,0,0,.4)">
  <b style="font-size:11px;display:block;text-align:center">BOLETA DE DEPÓSITO</b><div style="text-align:center">{{s.cta}}</div><div style="border-top:1px dashed #94A3B8;margin:6px 0"></div>
  <div>No. <b style="background:#FEF08A">{{s.ref}}</b></div><div>Fecha: <b style="background:#FEF08A">{{s.fecha}} 2026</b></div><div>A nombre de: CONECTA, S.A.</div><div>Efectivo</div><div style="border-top:1px dashed #94A3B8;margin:6px 0"></div>
  <div style="font-size:13px;font-weight:700">TOTAL <span style="background:#FEF08A">Q {{s.monto}}</span></div><div style="margin-top:8px;color:#94A3B8">Agencia 114 · Caja 03<br>*** copia cliente ***</div></div>
 <div style="position:absolute;right:10px;top:10px;display:flex;flex-direction:column;gap:6px"><button class="ib" style="background:rgba(255,255,255,.14);color:#fff" title="Acercar"><i:zoom:17></button><button class="ib" style="background:rgba(255,255,255,.14);color:#fff" title="Girar"><i:girar:17></button><button class="ib" style="background:rgba(255,255,255,.14);color:#fff" title="Abrir el archivo original"><i:desc:17></button></div>
 <span style="position:absolute;left:12px;top:12px;width:150px;font-size:11.5px;line-height:1.4;color:#CBD5E1">Lo resaltado es lo que debes encontrar en la banca en línea</span>
</div>''')
panel=T('''<aside class="isla pan" style="width:596px;flex:0 0 auto">
 <div class="ph2"><span class="ico nf"><i:img:19></span><div style="min-width:0;flex:1"><b class="el" style="display:block;font-size:16px">{{s.cl}}</b><div class="m2 el"><span class="mono" style="font-size:12px">{{s.sv}}</span> · {{s.quien}}</div></div><span class="b {{s.cc}}">{{s.cn}}</span></div>
 <div class="sc" style="flex:1;padding:14px 18px;display:flex;flex-direction:column;gap:12px">
  <div class="av2 er" style="display:{{s.av}}"><i:corte:17><div style="flex:1"><b>El servicio está suspendido.</b> Si no puedes revisarlo ya, reconéctalo mientras tanto (1 vez por periodo).</div><button class="btn o sm" onClick="{{m.recon.ir}}">Reconectar mientras reviso</button></div>
  <<boleta>>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
   <section class="cd" style="padding:12px 14px"><div class="cdh"><i:doc:15>Lo que declaró</div>
    <div class="kv2"><span>Monto</span><b class="num" style="font-size:16px">Q {{s.monto}}</b></div>
    <div class="kv2"><span>Método</span><span>{{s.met}}</span></div>
    <div class="kv2"><span>Cuenta de destino</span><span class="el">{{s.cta}}</span></div>
    <div class="kv2"><span>Referencia</span><span class="copy">{{s.ref}}</span></div>
    <div class="kv2"><span>Fecha del depósito</span><span>{{s.fecha}} 2026</span></div></section>
   <section class="cd" style="padding:12px 14px"><div class="cdh"><i:rayo:15>A qué se aplicaría</div>
    <div style="display:flex;gap:10px;align-items:flex-start;padding:8px 10px;border-radius:12px;background:#F5F7FF;border:1px solid #C7D2FE"><span class="ck2 on"><i:check:13></span><div style="min-width:0;flex:1"><b style="font-size:13px;display:block">{{s.sug}}</b><span class="m2 num">Q {{s.sugM}}</span></div></div>
    <div style="margin-top:8px"><span class="b {{s.difC}}">{{s.dif}}</span></div>
    <button class="lnk" style="margin-top:8px;text-align:left">Elegir otras facturas</button>
    <div style="display:{{s.iris}};flex-direction:column;gap:4px;margin-top:10px;padding-top:10px;border-top:1px solid #F1F5F9"><div class="m2"><i:bot:13> {{s.lee}} · confianza <b style="color:#0F172A">{{s.conf}}</b></div><button class="lnk" style="text-align:left"><i:chat:13> Ver conversación en Iris</button></div></section>
  </div>
 </div>
 <div class="pf" style="padding:14px 18px"><button class="btn r" onClick="{{m.rech.ir}}"><i:x:16>Rechazar</button><span style="flex:1"></span><span class="m2">Queda como pago de hoy en tu caja</span><button class="btn v" style="padding:11px 20px;font-size:14px"><i:check:16>Aprobar y registrar el pago</button></div>
</aside>''',boleta=boleta)
causas=[('No aparece en el banco','Busqué la referencia y no está',1),('El monto es distinto','El banco muestra otra cantidad',0),('No se lee','La foto está borrosa o cortada',0),('Falta un dato','Sin referencia, fecha o cuenta',0),('Ya se usó','Esa referencia ya es un pago',0),('Otra causa','Lo explico abajo',0)]
mrech=dlg('rech','x','er','Rechazar el comprobante de {{s.cl}}',T('''<div class="m2" style="font-size:13px">El cliente recibe el motivo y puede volver a mandarlo. La referencia queda libre.</div>
 <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><<ops>></div>
 <div><div class="lb">Mensaje para el cliente <span class="m2" style="font-weight:500">(opcional)</span></div><div class="in ph" style="min-height:44px;align-items:flex-start">Ej.: en el banco aparece otro monto, revisa tu boleta</div></div>''',ops=''.join(T('<div class="op <<on>>" style="padding:9px 11px"><span class="rd"></span><div><b style="font-size:13px"><<a>></b><div style="font-size:11.5px;color:#64748B"><<b>></div></div></div>',on='on' if o else '',a=a,b=b) for a,b,o in causas)),'<button class="btn g" onClick="{{m.no.ir}}">Cancelar</button><button class="btn rr" onClick="{{m.no.ir}}">Rechazar comprobante</button>',w=520)
mrecon=dlg('recon','power','wa','Reconectar mientras revisas',T('''<div style="font-size:14px;color:#475569;line-height:1.5">El servicio <b class="mono">{{s.sv}}</b> vuelve a navegar hoy y el comprobante sigue en esta cola. Si lo rechazas, se corta de nuevo.</div>
 <div class="cd" style="padding:10px 14px"><<a>><<b>><<c>></div>
 <div><div class="lb">¿Por qué?</div><div style="display:flex;gap:8px"><div class="op on" style="flex:1;padding:9px 11px"><span class="rd"></span><b style="font-size:13px">No hay quien revise ahora</b></div><div class="op" style="flex:1;padding:9px 11px"><span class="rd"></span><b style="font-size:13px">Llegó fuera de horario</b></div></div></div>''',a=kv('Vale hasta','<b>hoy a medianoche</b> (00:00 del sáb. 22)'),b=kv('El comprobante cubre lo vencido',B('ok','Sí · Q 250.00','check')),c=kv('Reconexiones este periodo','<b>0 de 1</b>')),'<button class="btn g" onClick="{{m.no.ir}}">Cancelar</button><button class="btn p" onClick="{{m.no.ir}}"><i:power:15>Reconectar hasta medianoche</button>',w=500)
inner=head('Comprobantes','Depósitos y transferencias que mandan los clientes por el portal, por Iris o que registra el equipo','<button class="btn o"><i:banco:16>Abrir banca en línea</button><button class="btn p" style="padding:11px 20px"><i:mas1:16>Registrar comprobante</button>','Ayuda: cómo revisar un comprobante')+T('''
<div style="flex:1;min-height:0;display:flex;gap:12px">
 <section class="isla pan" style="flex:1;min-width:0">
  <div style="display:flex;align-items:center;gap:10px;padding:12px 18px;flex-wrap:wrap"><<seg>><span style="flex:1"></span></div>
  <div style="display:flex;align-items:center;gap:8px;padding:0 18px 12px"><span class="busca" style="flex:1"><i:bus:15>Cliente, referencia o monto…</span><span class="selp"><i:chat:15>Llegó por: todos<i:ab:14></span><span class="selp"><i:banco:15>Cuenta: todas<i:ab:14></span></div>
  <<lista>>
 </section>
 <<panel>>
</div>''',seg=seg('t',[('pend','Por revisar','reloj',5,'rj'),('apr','Aprobados',None,18),('rec','Rechazados',None,2),('todos','Todos')]),lista=lista,panel=panel)
lg=logic({'t':(['pend','apr','rec','todos'],'pend'),'m':(['no','rech','recon'],'no')},{'comp':dict(rows=comp,por='t',todos='todos',**{'def':1})},'out.s = out.compSel;')
obuild('OperComprobantes.dc.html','Comprobantes · cola de revisión',shell2('fac',['Facturas','Comprobantes'],inner,VELO+mrech+mrecon),lg)
check('OperComprobantes.dc.html')

# ---- teléfono: revisar un comprobante a pantalla completa
mb=T('''<div style="height:100%;display:flex;flex-direction:column">
<<top>>
<div class="sc" style="flex:1;padding:4px 14px 14px;display:flex;flex-direction:column;gap:10px">
 <div class="av2 er" style="align-items:flex-start"><i:corte:17><div><b>Servicio suspendido.</b> <a href="#">Reconectar mientras reviso</a></div></div>
 <<boleta>>
 <section class="cd"><div style="display:flex;align-items:baseline;gap:8px"><b class="num" style="font-size:26px">Q 250.00</b><span class="m2">Depósito · 20 nov</span></div>
  <div class="kv2" style="border-top:1px solid #F1F5F9;margin-top:8px"><span>Cuenta</span><span class="el">Banrural · 3-044-12345-6</span></div><div class="kv2"><span>Referencia</span><span class="copy">88214507</span></div><div class="kv2"><span>Se aplica a</span><span class="el">Factura de noviembre</span></div><div class="kv2"><span>Lectura de Iris</span><span>Asistente · 92 %</span></div>
  <button class="lnk" style="text-align:left;margin-top:6px"><i:chat:13> Ver conversación en Iris</button></section>
</div>
<div class="mbar"><button class="btn r"><i:x:16>Rechazar</button><button class="btn v" style="flex:2"><i:check:16>Aprobar Q 250.00</button></div></div>''',top=mtop('Rosa Méndez','S-000412 · Casa · 1 de 5 por revisar','<span class="b cy">Iris</span>'),boleta=boleta.replace('height:262px','height:270px').replace('{{s.cta}}','Banrural').replace('{{s.ref}}','88214507').replace('{{s.fecha}}','20 nov').replace('{{s.monto}}','250.00'))
ombuild('OperComprobanteMovil.dc.html','Comprobante · teléfono',mb,logic({'m':(['no'],'no')}))
check('OperComprobanteMovil.dc.html')

# ================= 1b · Promesas =================
prom=[
 dict(id=1,sv='S-000412',nom='Casa',cl='Rosa Méndez',tipo='Promesa',tc='nf',canal='Portal',monto='250.00',vence='Hoy 23:59',vs='quedan 9 h',vc='#B91C1C',p=92,pc='#DC2626',est='Activa',ec='ok',g='act hoy',usadas='1 de 2',fact='Noviembre 2026 · Q 250.00',regla='Dentro de la política: hasta 5 días, 2 por periodo',acc='cancelar'),
 dict(id=2,sv='S-000187',nom='Local',cl='Ferretería El Clavo',tipo='Promesa',tc='nf',canal='Operador',monto='1,150.00',vence='Mañana 23:59',vs='queda 1 día',vc='#92400E',p=70,pc='#D97706',est='Activa',ec='ok',g='act hoy',usadas='1 de 2',fact='Octubre y noviembre · Q 1,150.00',regla='Dentro de la política',acc='cancelar'),
 dict(id=3,sv='S-000530',nom='—',cl='Carlos Ajú',tipo='Reconexión temporal',tc='cy',canal='Iris · sin personal',monto='200.00',vence='Hoy 00:00',vs='comprobante sin revisar',vc='#B91C1C',p=96,pc='#DC2626',est='Activa',ec='ok',g='act hoy recon',usadas='1 de 1',fact='Comprobante #5512 pendiente en la cola',regla='Mientras caja revisa el comprobante',acc='cancelar'),
 dict(id=4,sv='S-000291',nom='Casa',cl='Marta Xicará',tipo='Promesa',tc='nf',canal='Asistente de Iris',monto='300.00',vence='25 nov',vs='quedan 4 días',vc='#64748B',p=30,pc='#4F46E5',est='Activa',ec='ok',g='act',usadas='1 de 2',fact='Noviembre 2026 · Q 300.00',regla='Dentro de la política',acc='cancelar'),
 dict(id=5,sv='S-000655',nom='Bodega',cl='Colegio Belén',tipo='Promesa',tc='nf',canal='Operador',monto='2,400.00',vence='30 nov',vs='pide 9 días (máx. 5)',vc='#92400E',p=0,pc='#CBD5E1',est='Por aprobar',ec='wa',g='apr',usadas='0 de 2',fact='Noviembre 2026 · Q 2,400.00',regla='Fuera de política: plazo mayor al permitido. La decide un supervisor.',acc='aprobar'),
 dict(id=6,sv='S-000122',nom='—',cl='Aura Batz',tipo='Promesa',tc='nf',canal='Portal',monto='250.00',vence='18 nov',vs='pagó el 17 nov',vc='#166534',p=100,pc='#16A34A',est='Cumplida',ec='ok',g='cum',usadas='1 de 2',fact='Noviembre 2026 · pagada',regla='—',acc='nada'),
 dict(id=7,sv='S-000377',nom='Casa',cl='Pedro Cumes',tipo='Promesa',tc='nf',canal='Operador',monto='250.00',vence='19 nov',vs='no pagó · se suspendió',vc='#B91C1C',p=100,pc='#DC2626',est='Incumplida',ec='er',g='inc',usadas='2 de 2',fact='Noviembre 2026 · Q 250.00 sigue vencida',regla='—',acc='nada'),
 dict(id=8,sv='S-000708',nom='—',cl='Tienda La Bendición',tipo='Reconexión temporal',tc='cy',canal='Iris · fuera de horario',monto='350.00',vence='20 nov',vs='caja no la revisó a tiempo',vc='#64748B',p=100,pc='#94A3B8',est='Cancelada',ec='ne',g='recon',usadas='1 de 1',fact='Comprobante #5498 sigue pendiente',regla='No cuenta como incumplida: la demora fue de caja',acc='nada'),
]
CP='minmax(0,1.4fr) 158px minmax(0,.9fr) 100px minmax(0,1fr) 104px'
plista=T('''<div class="lh" style="grid-template-columns:<<c>>"><span>Servicio</span><span>Tipo</span><span>Quién la pidió</span><span class="r">Cubre</span><span>Vence</span><span>Estado</span></div>
<div class="sc" style="flex:1"><sc-for list="{{prom}}" as="x"><div class="lr {{x.cls}}" style="grid-template-columns:<<c>>" onClick="{{x.ver}}">
 <div style="display:flex;gap:11px;align-items:center"><span class="ico nf" style="width:34px;height:34px;border-radius:10px"><i:mano:17></span><div style="min-width:0"><b class="el" style="display:block;font-size:14px"><span class="mono">{{x.sv}}</span> · {{x.nom}}</b><div class="m2 el">{{x.cl}}</div></div></div>
 <span><span class="b {{x.tc}}">{{x.tipo}}</span></span>
 <span class="el">{{x.canal}}</span>
 <b class="num r">Q {{x.monto}}</b>
 <div><div style="display:flex;justify-content:space-between;gap:8px"><b>{{x.vence}}</b></div><div class="bar" style="margin:4px 0 3px"><i style="width:{{x.p}}%;background:{{x.pc}}"></i></div><div class="m2 el" style="color:{{x.vc}}">{{x.vs}}</div></div>
 <span><span class="b {{x.ec}}">{{x.est}}</span></span>
</div></sc-for>
<div style="display:{{promVacio}};padding:40px;text-align:center;color:#64748B;font-size:14px">No hay promesas en esta vista.</div></div>
<div class="pf m2"><i:info:14>Una promesa es <b>por servicio</b> y cubre todo lo vencido de ese servicio. Argos calcula el monto.<span style="flex:1"></span>{{promN}} promesas</div>''',c=CP)
ppanel=T('''<aside class="isla pan" style="width:372px;flex:0 0 auto">
 <div class="ph2"><span class="ico nf"><i:mano:19></span><div style="min-width:0;flex:1"><b class="el" style="display:block;font-size:16px"><span class="mono">{{s.sv}}</span> · {{s.nom}}</b><div class="m2 el">{{s.cl}}</div></div><span class="b {{s.ec}}">{{s.est}}</span></div>
 <div class="sc" style="flex:1;padding:12px 18px">
  <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:6px"><b class="num" style="font-size:24px">Q {{s.monto}}</b><span class="m2">todo lo vencido del servicio</span></div>
  <div class="kv2" style="border-top:1px solid #F1F5F9"><span>Tipo</span><span class="b {{s.tc}}">{{s.tipo}}</span></div>
  <div class="kv2"><span>La pidió por</span><b>{{s.canal}}</b></div>
  <div class="kv2"><span>Vence</span><b>{{s.vence}}</b></div>
  <div class="kv2"><span>Cubre</span><span class="el">{{s.fact}}</span></div>
  <div class="kv2"><span>Promesas este periodo</span><b class="num">{{s.usadas}}</b></div>
  <div class="av2 nf" style="margin-top:10px;align-items:flex-start"><i:info:16><div>{{s.regla}}</div></div>
  <div class="m2" style="margin-top:10px;line-height:1.5">Si paga antes de que venza se marca <b>cumplida</b> sola. Si no, se marca <b>incumplida</b> y el servicio se corta a la hora de corte de su plantilla.</div>
 </div>
 <div class="pf"><button class="btn o sm" style="flex:1;justify-content:center">Abrir servicio</button><button class="btn r sm" style="flex:1;justify-content:center;display:{{aCan}}" onClick="{{m.cancel.ir}}">Cancelar promesa</button><button class="btn r sm" style="display:{{aApr}}">Rechazar</button><button class="btn p sm" style="display:{{aApr}}"><i:check:14>Aprobar</button></div>
</aside>''')
mnueva=dlg('nueva','mano','nf','Nueva promesa de pago',T('''<<f1>>
 <div><div class="lb">Paga a más tardar el</div><div style="display:flex;gap:8px"><span class="rap">Mañana</span><span class="rap" style="border-color:#4F46E5;background:#EEF2FF;color:#3730A3">En 3 días · 24 nov</span><span class="rap">En 5 días</span><span class="rap"><i:cal:14></span></div></div>
 <div class="av2 ok" style="align-items:flex-start"><i:ok:17><div><b>Se aprueba sola.</b> Cubre Q 250.00 (factura de noviembre). Es la 2.ª de 2 en este periodo; plazo máximo 5 días. El servicio se reactiva al guardar.</div></div>''',f1=campo('Servicio','<span class="mono">S-000412</span> · Casa — Rosa Méndez',True,'sel','Suspendido · debe Q 250.00 vencidos','serv')),'<button class="btn g" onClick="{{m.no.ir}}">Cancelar</button><button class="btn p" onClick="{{m.no.ir}}">Crear promesa</button>',w=500)
mcancel=dlg('cancel','x','er','Cancelar la promesa de {{s.cl}}','<div style="font-size:14px;color:#475569;line-height:1.5">El servicio se vuelve a evaluar: si sigue debiendo, se corta a la hora de corte. Queda en la bitácora con tu nombre.</div><div><div class="lb">Motivo<span class="req">*</span></div><div class="in ph">Ej.: el cliente ya no puede pagar en esa fecha</div></div>','<button class="btn g" onClick="{{m.no.ir}}">Volver</button><button class="btn rr" onClick="{{m.no.ir}}">Cancelar promesa</button>')
kp=lambda cls,ico,l,v,sub: T('<div class="card" style="padding:11px 14px;display:flex;align-items:center;gap:12px;flex:1;min-width:0"><span class="ico <<cls>>"><i:<<ico>>:19></span><div style="min-width:0"><div class="m2"><<l>></div><b style="font-size:19px" class="num"><<v>></b> <span class="m2"><<sub>></span></div></div>',cls=cls,ico=ico,l=l,v=v,sub=sub)
pinner=head('Promesas de pago','Compromisos de pago por servicio y reconexiones temporales mientras caja revisa un comprobante','<button class="btn o"><i:gauge:16>Reglas por plantilla</button><button class="btn p" style="padding:11px 20px" onClick="{{m.nueva.ir}}"><i:mas1:16>Nueva promesa</button>','Ayuda: cómo funcionan las promesas')+T('''
<div style="display:flex;gap:12px;flex:0 0 auto"><<k1>><<k2>><<k3>><<k4>></div>
<div style="flex:1;min-height:0;display:flex;gap:12px"><section class="isla pan" style="flex:1;min-width:0">
 <div style="padding:12px 18px 10px"><<seg>></div>
 <div style="display:flex;align-items:center;gap:8px;padding:0 18px 12px"><span class="busca" style="flex:1"><i:bus:15>Cliente o código de servicio…</span><span class="selp"><i:chat:15>Canal: todos<i:ab:14></span><span class="selp"><i:tag:15>Tipo: todos<i:ab:14></span></div>
 <<lista>>
</section><<pp>></div>''',seg=seg('t',[('act','Activas','mano',4),('hoy','Por vencer','reloj',3,'rj'),('apr','Por aprobar',None,1),('cum','Cumplidas'),('inc','Incumplidas'),('recon','Reconexión temporal','power',2)]),lista=plista,pp=ppanel,
 k1=kp('nf','mano','Activas','23','Q 8,450.00 comprometidos'),k2=kp('er','reloj','Vencen hoy','5','se cortan a las 06:00 si no pagan'),k3=kp('ok','ok','Cumplidas este mes','71 %','61 de 86'),k4=kp('wa','user','Esperan a un supervisor','2','fuera de política'))
plg=logic({'t':(['act','hoy','apr','cum','inc','recon'],'act'),'m':(['no','nueva','cancel'],'no')},{'prom':dict(rows=prom,por='t',todos='todos',**{'def':1})},"out.s = out.promSel; out.aCan = out.s.acc === 'cancelar' ? 'inline-flex' : 'none'; out.aApr = out.s.acc === 'aprobar' ? 'inline-flex' : 'none';")
obuild('OperPromesas.dc.html','Promesas de pago',shell2('fac',['Facturas','Promesas'],pinner,VELO+mnueva+mcancel),plg)
check('OperPromesas.dc.html')
