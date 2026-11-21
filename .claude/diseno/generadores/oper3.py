exec(open('/tmp/claude-0/-home-user/59389ade-3278-540a-8050-19c26767da8e/scratchpad/gen/oper_base.py').read())
# ================= 3 · Facturas: lista =================
fs=[
 dict(id=1,num='FAC-A 004512',cl='Rosa Méndez',sv='S-000412 · Casa',con='Noviembre 2026',em='1 nov',ve='10 nov',tot='325.00',sal='250.00',est='Vencida',ec='er',fel='Certificada',fc='ok',g='ven pen'),
 dict(id=2,num='FAC-A 004513',cl='Ferretería El Clavo',sv='S-000187 · Local',con='Noviembre 2026',em='1 nov',ve='10 nov',tot='575.00',sal='575.00',est='Vencida',ec='er',fel='Certificada',fc='ok',g='ven pen'),
 dict(id=3,num='FAC-A 004514',cl='Marta Xicará',sv='S-000291 · Casa',con='Noviembre 2026',em='1 nov',ve='10 nov',tot='300.00',sal='300.00',est='Con promesa',ec='nf',fel='Certificada',fc='ok',g='pen'),
 dict(id=4,num='FAC-A 004515',cl='Luis Coc',sv='S-000614',con='Noviembre 2026',em='1 nov',ve='10 nov',tot='350.00',sal='0.00',est='Pagada',ec='ok',fel='Certificada',fc='ok',g='pag'),
 dict(id=5,num='—',cl='Colegio Belén',sv='S-000655 · Bodega',con='Noviembre 2026',em='1 nov',ve='15 nov',tot='2,400.00',sal='2,400.00',est='Por certificar',ec='wa',fel='Rechazada por SAT: NIT',fc='er',g='cer'),
 dict(id=6,num='FAC-A 004498',cl='Aura Batz',sv='S-000122',con='Cargo único · instalación',em='28 oct',ve='28 oct',tot='150.00',sal='0.00',est='Pagada',ec='ok',fel='Certificada',fc='ok',g='pag'),
 dict(id=7,num='FAC-A 004101',cl='Pedro Cumes',sv='S-000377 · Casa',con='Octubre 2026',em='1 oct',ve='10 oct',tot='250.00',sal='0.00',est='Anulada',ec='ne',fel='Anulada en SAT',fc='ne',g='anu'),
 dict(id=8,num='FAC-A 004102',cl='Tienda La Bendición',sv='S-000708',con='Octubre 2026',em='1 oct',ve='10 oct',tot='350.00',sal='100.00',est='Abonada',ec='wa',fel='Certificada',fc='ok',g='pen ven'),
]
C='minmax(0,1.4fr) 124px minmax(0,1fr) 66px 100px 100px 120px'
lista=T('''<div class="lh" style="grid-template-columns:<<c>>"><span>Cliente y servicio</span><span>Número</span><span>Concepto</span><span>Vence</span><span class="r">Total</span><span class="r">Saldo</span><span>Estado</span></div>
<div class="sc" style="flex:1"><sc-for list="{{fs}}" as="x"><div class="lr {{x.cls}}" style="grid-template-columns:<<c>>" onClick="{{x.ver}}">
 <div><b class="el" style="display:block;font-size:14px">{{x.cl}}</b><div class="m2 mono el" style="font-size:12px">{{x.sv}}</div></div>
 <div><span class="mono" style="font-size:12px">{{x.num}}</span><div class="m2 el" style="font-size:11.5px">{{x.fel}}</div></div>
 <span class="el">{{x.con}}</span><span>{{x.ve}}</span>
 <span class="num r">Q {{x.tot}}</span><b class="num r">Q {{x.sal}}</b>
 <span><span class="b {{x.ec}}">{{x.est}}</span></span>
</div></sc-for><div style="display:{{fsVacio}};padding:40px;text-align:center;color:#64748B">Ninguna factura con ese filtro.</div></div>
<div class="pf m2">Mostrando {{fsN}} de 1,284 · <a href="#">Cargar más</a><span style="flex:1"></span>Total filtrado: <b style="color:#0F172A" class="num">Q 412,300.00</b> · Saldo: <b style="color:#B91C1C" class="num">Q 38,450.00</b></div>''',c=C)
rapida=T('''<aside class="isla pan" style="width:350px;flex:0 0 auto">
 <div class="ph2"><span class="ico nf"><i:fac:19></span><div style="min-width:0;flex:1"><b class="mono" style="font-size:14px">{{s.num}}</b><div class="m2 el">{{s.cl}} · {{s.con}}</div></div><span class="b {{s.ec}}">{{s.est}}</span></div>
 <div class="sc" style="flex:1;padding:12px 18px">
  <div style="display:flex;gap:10px"><div class="kpi" style="flex:1"><div class="l">Total</div><b class="num">Q {{s.tot}}</b></div><div class="kpi" style="flex:1"><div class="l">Saldo</div><b class="num" style="color:#B91C1C">Q {{s.sal}}</b></div></div>
  <div class="kv2" style="margin-top:8px;border-top:0"><span>Servicio</span><span class="mono" style="font-size:12px">{{s.sv}}</span></div><div class="kv2"><span>Emitida / vence</span><span>{{s.em}} / {{s.ve}}</span></div><div class="kv2"><span>Factura electrónica</span><span class="b {{s.fc}}">{{s.fel}}</span></div>
  <div class="sec" style="margin-top:12px">Imprimir</div><div style="display:flex;gap:8px"><button class="btn o sm" style="flex:1;justify-content:center"><i:hoja:14>Carta</button><button class="btn o sm" style="flex:1;justify-content:center"><i:pos:14>POS 80 mm</button></div>
 </div>
 <div class="pf"><button class="btn o sm" style="flex:1;justify-content:center">Abrir factura</button><button class="btn v sm" style="flex:1;justify-content:center"><i:cob:14>Cobrar</button></div>
</aside>''')
mgen=dlg('gen','rayo','nf','Generar las facturas del mes',T('''<div style="font-size:14px;color:#475569;line-height:1.5">Emite todo lo pendiente hasta hoy. Si ya existe la factura de un servicio y periodo, no la repite.</div>
<div class="cd" style="padding:8px 14px"><<a>><<b>><<c>></div>''',a=kv('Servicios por facturar','<b class="num">1,268</b> de diciembre 2026'),b=kv('Total estimado','<b class="num">Q 356,900.00</b>'),c=kv('Se saltan','14 pendientes de instalación · 3 sin plantilla <button class="lnk">Ver</button>')),'<button class="btn g" onClick="{{m.no.ir}}">Cancelar</button><button class="btn p" onClick="{{m.no.ir}}">Generar 1,268 facturas</button>',w=480)
inner=head('Facturas','Todo lo emitido, con su estado de cobro y de factura electrónica','<button class="btn o"><i:tag:16>Cargo único</button><button class="btn o"><i:cal:16>Emitir por periodo</button><button class="btn p" style="padding:11px 20px" onClick="{{m.gen.ir}}"><i:rayo:16>Generar las del mes</button>','Ayuda: facturas')+T('''
<div class="av2 wa" style="flex:0 0 auto"><i:alerta:18><div style="flex:1"><b>1 factura no se pudo certificar.</b> Mientras no esté certificada no es deuda ni se puede cobrar.</div><button class="btn o sm" onClick="{{t.cer.ir}}">Ver</button></div>
<div style="flex:1;min-height:0;display:flex;gap:12px"><section class="isla pan" style="flex:1;min-width:0">
 <div style="padding:12px 18px 10px"><<seg>></div>
 <div style="display:flex;align-items:center;gap:8px;padding:0 18px 12px;flex-wrap:wrap"><span class="busca" style="flex:1;min-width:220px"><i:bus:15>Cliente, número de factura, código de servicio o NIT…</span><span class="selp"><i:cal:15>Periodo: nov 2026<i:ab:14></span><span class="selp"><i:filtro:15>Más filtros<i:ab:14></span><button class="ib" title="Descargar lo filtrado"><i:desc:17></button></div>
 <<lista>>
</section><<rap>></div>''',seg=seg('t',[('todos','Todas',None,'1,284'),('pen','Pendientes',None,212),('ven','Vencidas','alerta',64,'rj'),('pag','Pagadas'),('cer','Por certificar',None,1,'rj'),('anu','Anuladas')]),lista=lista,rap=rapida)
lg=logic({'t':(['todos','pen','ven','pag','cer','anu'],'todos'),'m':(['no','gen'],'no')},{'fs':dict(rows=fs,por='t',todos='todos',**{'def':1})},'out.s = out.fsSel;')
obuild('OperFacturas.dc.html','Facturas · lista',shell2('fac',['Facturas','Todas las facturas'],inner,VELO+mgen),lg)
check('OperFacturas.dc.html')

# ================= 3b · Detalle =================
lineas=[('Internet Fibra 50 · noviembre 2026','1','250.00','250.00'),('IP pública fija · noviembre 2026','1','75.00','75.00')]
tk=T('''<div class="tk80"><div style="text-align:center"><b style="font-size:13px">CONECTA, S.A.</b><br>NIT 8123456-7<br>4.ª av. 3-20 z.1, Chimaltenango</div><hr><div class="fl"><span>FACTURA</span><b>A 004512</b></div><div class="fl"><span>Fecha</span><span>01/11/2026</span></div><div>Rosa Méndez · NIT CF</div><div>Servicio S-000412</div><hr><div class="fl"><span>Internet Fibra 50 nov</span><span>250.00</span></div><div class="fl"><span>IP pública fija nov</span><span>75.00</span></div><hr><div class="fl"><b>TOTAL Q</b><b>325.00</b></div><div class="fl"><span>Pagado</span><span>75.00</span></div><div class="fl"><b>SALDO Q</b><b>250.00</b></div><hr><div style="font-size:10px;word-break:break-all">Autorización: 8F3A1C22-77B0-4E1D-9A55-0C12D4E6A901</div><div style="text-align:center;margin-top:6px"><span style="display:inline-block;width:64px;height:64px;background:repeating-conic-gradient(#0F172A 0 25%,#fff 0 50%) 0 0/12px 12px"></span><br>Certificador: INFILE</div></div>''')
det=T('''<section class="isla" style="border-radius:20px;padding:14px 18px;display:flex;align-items:center;gap:14px;flex:0 0 auto">
 <span class="ico er" style="width:52px;height:52px;border-radius:16px"><i:fac:24></span>
 <div style="min-width:0"><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><b class="mono" style="font-size:20px">FAC-A 004512</b><span class="b er">Vencida hace 11 días</span><span class="b ok"><i:escudo:13>Certificada</span></div>
  <div class="m2" style="margin-top:3px"><a href="#">Rosa Méndez</a> · <a href="#" class="mono">S-000412</a> Casa · Noviembre 2026 · emitida el 1 nov · venció el 10 nov</div></div>
 <span style="flex:1"></span>
 <div style="text-align:right;padding-right:6px"><div class="m2">Saldo de Q 325.00</div><b class="num" style="font-size:22px;color:#B91C1C">Q 250.00</b></div>
 <button class="btn v" style="padding:11px 18px"><i:cob:16>Cobrar</button>
 <button class="btn o" onClick="{{m.nc.ir}}"><i:nc:16>Nota de crédito</button>
 <div style="position:relative"><button class="ib f" style="width:40px;height:40px;border-radius:999px" aria-label="Más acciones" onClick="{{m.mas.ir}}"><i:mas:18></button>
  <div class="isla" style="display:{{m.mas.b}};position:absolute;right:0;top:46px;width:260px;border-radius:16px;padding:8px;z-index:9"><div class="mi"><i:mail:16>Enviar al cliente</div><div class="mi"><i:cambio:16>Sustituir (corregir datos)</div><div class="mi"><i:mano:16>Promesa de pago</div><div class="mi" style="color:#B91C1C" onClick="{{m.anu.ir}}"><i:x:16>Anular factura</div></div></div>
</section>
<div style="flex:1;min-height:0;display:flex;gap:12px">
 <section class="isla pan" style="flex:1;min-width:0">
  <div style="padding:12px 18px;border-bottom:1px solid #F1F5F9;display:flex;align-items:center;gap:10px"><<seg>><span style="flex:1"></span><<ay>></div>
  <div class="sc" style="flex:1;display:{{t.lin.v}};flex-direction:column">
   <div class="lh" style="grid-template-columns:minmax(0,1fr) 80px 120px 120px;border-top:0"><span>Descripción</span><span class="r">Cant.</span><span class="r">Precio</span><span class="r">Importe</span></div>
   <<lin>>
   <div style="display:flex;justify-content:flex-end;padding:14px 18px"><div style="width:300px"><<t1>><<t2>><div class="kv2"><b style="color:#0F172A">Total</b><b class="num" style="font-size:17px">Q 325.00</b></div><<t3>><div class="kv2"><b style="color:#B91C1C">Saldo</b><b class="num" style="font-size:17px;color:#B91C1C">Q 250.00</b></div></div></div>
   <div style="padding:0 18px 14px"><div class="sec">Pagos aplicados</div>
    <div class="lr" style="grid-template-columns:38px minmax(0,1fr) 150px 110px;padding:10px 0;border-top:1px solid #F1F5F9"><span class="ico ok" style="width:34px;height:34px;border-radius:10px"><i:cob:16></span><div><b>Pago #20391 · efectivo</b><div class="m2">5 nov · Caja Centro · Ana Cruz · abono</div></div><a href="#">Recibo R-018822</a><b class="num r">Q 75.00</b></div>
    <div class="sec" style="margin-top:12px">Notas de crédito</div><div class="m2" style="padding:6px 0">Ninguna. Una nota de crédito baja el saldo sin que entre dinero (descuento, días sin servicio, error).</div></div>
  </div>
  <div class="sc" style="flex:1;display:{{t.dte.v}};flex-direction:column;padding:14px 18px;gap:0"><<d1>><<d2>><<d3>><<d4>><<d5>><div style="display:flex;gap:8px;padding-top:12px"><button class="btn o sm"><i:codigo:14>Descargar XML</button><button class="btn o sm"><i:desc:14>PDF certificado</button><button class="btn o sm"><i:hist:14>Intentos (1)</button></div></div>
  <div class="sc" style="flex:1;display:{{t.his.v}};flex-direction:column;padding:6px 18px"><<h>></div>
 </section>
 <aside class="isla pan" style="width:380px;flex:0 0 auto">
  <div class="ph2"><i:imp:17><b style="flex:1">Imprimir</b><div class="segb"><button class="ts {{p.carta.cls}}" style="padding:6px 12px" onClick="{{p.carta.ir}}"><i:hoja:14>Carta</button><button class="ts {{p.pos.cls}}" style="padding:6px 12px" onClick="{{p.pos.ir}}"><i:pos:14>POS 80 mm</button></div></div>
  <div class="sc" style="flex:1;background:#F1F5F9;display:flex;justify-content:center;align-items:flex-start;padding:16px">
   <div style="display:{{p.pos.b}}"><<tk>></div>
   <div style="display:{{p.carta.b}};width:300px;height:388px;background:#fff;border:1px solid #E2E8F0;box-shadow:0 12px 30px rgba(15,23,42,.14);padding:22px;font-size:9px;line-height:1.6;color:#334155"><div style="display:flex;justify-content:space-between"><span style="width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,#4F46E5,#06B6D4)"></span><div style="text-align:right"><b style="font-size:12px;color:#0F172A">FACTURA A 004512</b><br>01/11/2026</div></div><div style="margin:12px 0"><b>Rosa Méndez</b><br>NIT CF · S-000412 Casa</div><div style="border-top:1px solid #E2E8F0;padding:5px 0;display:flex;justify-content:space-between"><span>Internet Fibra 50 · nov</span><span>250.00</span></div><div style="border-top:1px solid #E2E8F0;padding:5px 0;display:flex;justify-content:space-between"><span>IP pública fija · nov</span><span>75.00</span></div><div style="border-top:2px solid #0F172A;padding:6px 0;display:flex;justify-content:space-between;font-size:11px"><b>Total</b><b>Q 325.00</b></div><div style="margin-top:60px;color:#94A3B8">Autorización 8F3A1C22-77B0… · Certificador INFILE · Sujeto a pagos trimestrales ISR</div></div>
  </div>
  <div class="pf"><span class="m2" style="flex:1">Plantilla: «Factura {{pNom}}» <a href="#">Cambiar</a></span><button class="btn p sm"><i:imp:14>Imprimir</button></div>
 </aside>
</div>''',seg=seg('t',[('lin','Líneas y pagos','lista'),('dte','Factura electrónica','escudo'),('his','Historial','hist')]),ay=AY('Ayuda: la factura'),tk=tk,
 lin=''.join(T('<div class="lr" style="grid-template-columns:minmax(0,1fr) 80px 120px 120px;cursor:default"><b><<a>></b><span class="num r"><<q>></span><span class="num r">Q <<p>></span><span class="num r">Q <<t>></span></div>',a=a,q=q,p=p,t=t_) for a,q,p,t_ in lineas),
 t1=kv('Subtotal sin IVA','<span class="num">Q 290.18</span>'),t2=kv('IVA 12 %','<span class="num">Q 34.82</span>'),t3=kv('Pagado','<span class="num">− Q 75.00</span>'),
 d1=kv('Tipo de documento','<b>FACT</b> · Factura'),d2=kv('Serie y número','<span class="copy">A · 004512</span>'),d3=kv('Autorización','<span class="copy" style="font-size:12px">8F3A1C22-77B0-4E1D-9A55-0C12D4E6A901</span>'),d4=kv('Certificada','1 nov 2026 06:02 · INFILE · en línea'),d5=kv('Receptor','CF · Rosa Méndez'),
 h=''.join(T('<div class="tl"><span class="ic ico <<k>>" style="width:34px;height:34px;border-radius:10px"><i:<<i>>:16></span><div style="flex:1"><b><<a>></b><div class="m2"><<b>></div></div><span class="m2"><<h>></span></div>',k=k,i=i,a=a,b=b,h=h_) for k,i,a,b,h_ in [('er','alerta','Venció','Sin pago completo · el servicio se limitó el 12 y se suspendió el 15','10 nov'),('ok','cob','Abono de Q 75.00','Pago #20391 · efectivo · Ana Cruz','5 nov'),('nf','mail','Aviso de cobro enviado','WhatsApp por Iris · entregado y leído','1 nov 08:00'),('ok','escudo','Certificada por INFILE','Al primer intento','1 nov 06:02'),('nf','rayo','Emitida','Corrida mensual · sistema','1 nov 06:00')]))
mnc=dlg('nc','nc','nf','Nota de crédito a FAC-A 004512',T('''<div class="m2" style="font-size:13px">Baja el saldo sin que entre dinero. Se certifica en SAT como nota de crédito.</div>
 <div><div class="lb">Monto a acreditar</div><div class="dest"><span style="color:#64748B">Q</span>41.67<span style="flex:1"></span><span class="m2" style="font-weight:500;font-size:12px">máx. Q 250.00</span></div><div style="display:flex;gap:6px;margin-top:8px"><span class="rap">5 días sin servicio · 41.67</span><span class="rap">Todo el saldo · 250.00</span></div></div>
 <<f1>><<f2>>''',f1=campo('Motivo','Días sin servicio',True,'sel'),f2=campo('Detalle para el cliente','~Ej.: falla de fibra del 12 al 16 de nov')),'<span class="m2" style="flex:1;align-self:center">Saldo nuevo: <b style="color:#0F172A">Q 208.33</b></span><button class="btn g" onClick="{{m.no.ir}}">Cancelar</button><button class="btn p" onClick="{{m.no.ir}}">Emitir nota de crédito</button>',w=480)
manu=dlg('anu','x','er','Anular FAC-A 004512','<div class="av2 wa" style="align-items:flex-start"><i:alerta:17><div>Tiene un <b>abono de Q 75.00</b>. Al anular, ese dinero queda como saldo a favor de Rosa Méndez.</div></div><div style="font-size:14px;color:#475569;line-height:1.5">Se anula también en SAT. El libro guarda un asiento de reverso; nada se borra.</div><div><div class="lb">Motivo<span class="req">*</span></div><div class="in ph">Ej.: se facturó a un servicio equivocado</div></div>','<button class="btn g" onClick="{{m.no.ir}}">Cancelar</button><button class="btn rr" onClick="{{m.no.ir}}">Anular factura</button>')
lg2=logic({'t':(['lin','dte','his'],'lin'),'p':(['pos','carta'],'pos'),'m':(['no','nc','anu','mas'],'no')},None,"out.velo = (st.m && st.m !== 'no' && st.m !== 'mas') ? 'block' : 'none'; out.pNom = (st.p || 'pos') === 'pos' ? 'POS 80 mm' : 'carta';")
obuild('OperFacturaDetalle.dc.html','Factura · detalle',shell2('fac',['Facturas','Todas las facturas','FAC-A 004512'],det,VELO.replace('{{mOn}}','{{velo}}')+mnc+manu),lg2)
check('OperFacturaDetalle.dc.html')

# ================= 3c · Emitir por periodo =================
per=[('Ago 2026','ant','Periodo anterior','250.00','no','Sin factura · el servicio estaba activo',1),('Sep 2026','ant','Periodo anterior','250.00','no','Sin factura',1),('Oct 2026','ya','Ya facturado','325.00','','FAC-A 004101 · pagada',0),('Nov 2026','ya','Ya facturado','325.00','','FAC-A 004512 · vencida',0),('Dic 2026','sig','Siguiente','325.00','si','Se emite sola el 1 dic · puedes adelantarla',1),('Ene 2027','ade','Adelantado','325.00','si','',1),('Feb 2027','ade','Adelantado','325.00','si','',0)]
def prow(n,k,et,m,ed,nota,on):
    ya=k=='ya'
    return T('''<div class="lr" style="grid-template-columns:28px 110px 150px minmax(0,1fr) 190px;cursor:<<cur>>;<<op>>"><span class="ck2 <<on>>"><<chk>></span><b><<n>></b><span><span class="b <<bc>>"><<et>></span></span><span class="m2 el"><<nota>></span><<monto>></div>''',cur='default' if ya else 'pointer',op='opacity:.6' if ya else '',on='on' if on else '',chk=s('check',13) if on else (s('bloq',11,'#94A3B8') if ya else ''),n=n,et=et,bc={'ant':'wa','ya':'ne','sig':'nf','ade':'cy'}[k],nota=nota,
      monto=(f'<span class="num r m2">Q {m}</span>' if ya else T('<div class="in" style="padding:6px 10px;justify-content:flex-end;<<st>>"><span style="color:#94A3B8;margin-right:auto">Q</span><b class="num"><<m>></b><i:editar:13:#94A3B8></div>',m=m,st='' if on else 'opacity:.5')))
pinner=head('Emitir facturas por periodo','<span class="mono">S-000412</span> · Casa — Rosa Méndez · Fibra 50 · plantilla «Residencial día 1»','<button class="btn g"><i:izq:16>Volver al servicio</button>','Ayuda: emitir periodos')+T('''
<div style="flex:1;min-height:0;display:flex;gap:12px">
 <section class="isla pan" style="flex:1;min-width:0">
  <div style="padding:12px 18px;display:flex;align-items:center;gap:10px"><b style="font-size:15px">Periodos</b><span class="m2">Marca los que quieres facturar. Cada uno es una factura completa: <b>sin prorrateo</b>.</span><span style="flex:1"></span><span class="m2">Adelantar</span><div style="display:flex;align-items:center;border:1px solid #E2E8F0;border-radius:999px"><button class="ib" aria-label="Menos"><i:baja:14></button><b class="num" style="padding:0 6px">2 meses</b><button class="ib" aria-label="Más"><i:sube:14></button></div></div>
  <div class="lh" style="grid-template-columns:28px 110px 150px minmax(0,1fr) 190px"><span></span><span>Periodo</span><span>Tipo</span><span>Nota</span><span class="r">Monto</span></div>
  <div class="sc" style="flex:1"><<rows>>
   <div style="padding:14px 18px;display:flex;flex-direction:column;gap:10px">
    <div class="av2 wa" style="align-items:flex-start"><i:bloq:17><div style="flex:1"><b>Periodos anteriores:</b> normalmente Argos no cobra hacia atrás. Tu rol tiene el permiso para hacerlo; queda en la bitácora con el motivo.</div></div>
    <div class="cd"><div class="cdh"><i:cal:15>Tramo inicial · del 12 al 31 de julio (20 días antes del primer periodo)</div>
     <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px"><<o1>><<o2>><<o3>></div></div>
   </div></div>
 </section>
 <aside class="isla pan" style="width:380px;flex:0 0 auto">
  <div class="ph2"><i:ojo:17><b>Así queda</b></div>
  <div class="sc" style="flex:1;padding:12px 18px">
   <<r1>><<r2>><<r3>><<r4>>
   <div class="kv2"><b style="color:#0F172A">4 facturas</b><b class="num" style="font-size:20px">Q 1,150.00</b></div>
   <div style="margin-top:12px"><<f1>></div>
   <div style="margin-top:12px"><div class="kv2" style="border-top:0"><span style="color:#0F172A"><b>Certificar ahora (FEL)</b></span><span class="tg on"><i></i></span></div><div class="kv2"><span style="color:#0F172A"><b>Avisar al cliente</b><span class="m2" style="display:block">Un solo mensaje con las 4</span></span><span class="tg"><i></i></span></div></div>
   <div class="av2 nf" style="margin-top:10px;align-items:flex-start"><i:info:16><div>Los periodos anteriores nacen <b>vencidos</b>. El servicio se evalúa al emitir: puede limitarse o suspenderse según su plantilla.</div></div>
  </div>
  <div class="pf" style="padding:14px 18px"><button class="btn g">Cancelar</button><button class="btn p" style="flex:1;justify-content:center;padding:12px"><i:fac:16>Emitir 4 facturas</button></div>
 </aside>
</div>''',rows=''.join(prow(*p) for p in per),o1=op(False,'Incluir en la primera factura','Q 166.67 se suman a agosto'),o2=op(False,'Cobrar como cargo único','Factura aparte de Q 166.67'),o3=op(True,'No cobrarlos','Queda como cortesía, con motivo'),
 r1=kv('Ago 2026 <span class="b wa" style="font-size:11px;padding:1px 7px">anterior</span>','<span class="num">Q 250.00</span>'),r2=kv('Sep 2026 <span class="b wa" style="font-size:11px;padding:1px 7px">anterior</span>','<span class="num">Q 250.00</span>'),r3=kv('Dic 2026','<span class="num">Q 325.00</span>'),r4=kv('Ene 2027 <span class="b cy" style="font-size:11px;padding:1px 7px">adelantado</span>','<span class="num">Q 325.00</span>'),f1=campo('Motivo','~Ej.: se instaló en julio y no se facturó',True,'','Obligatorio con periodos anteriores o monto editado'))
obuild('OperFacturasPeriodo.dc.html','Emitir facturas por periodo',shell2('fac',['Clientes','Rosa Méndez','S-000412 · Casa','Emitir por periodo'],pinner),logic({'m':(['no'],'no')}))
check('OperFacturasPeriodo.dc.html')

# ================= 3d · Plantillas de facturación =================
pls=[('Residencial día 1','1,102 servicios','Emite 1 · vence 10 · corta 15',1,'De fábrica'),('Residencial día 15','84 servicios','Emite 15 · vence 25 · corta 30',0,''),('Empresarial 30 días','61 servicios','Emite 1 · vence 30 · no corta sola',0,''),('Prepago','21 servicios','Paga antes · corta al vencer',0,''),('Sin plantilla','3 servicios','No se facturan',0,'Atender')]
hitos=[('1','Emite','#4F46E5',3),('5','Recuerda','#06B6D4',17),('10','Vence','#D97706',33),('12','Limita','#EA580C',40),('15','Suspende','#DC2626',50),('45','Retiro sugerido','#64748B',92)]
linea='<div style="position:relative;height:74px;margin:6px 8px 0"><div style="position:absolute;left:0;right:0;top:20px;height:6px;border-radius:9px;background:linear-gradient(90deg,#C7D2FE 0 33%,#FDE68A 33% 50%,#FECACA 50% 100%)"></div>'+''.join(f'<div style="position:absolute;left:{x}%;top:0;transform:translateX(-50%);text-align:center"><span style="display:inline-flex;width:44px;height:44px;border-radius:999px;background:#fff;border:3px solid {c};align-items:center;justify-content:center;font-weight:700;font-size:13px;color:{c}">{d}</span><div style="font-size:12px;font-weight:600;color:#334155;margin-top:4px;white-space:nowrap">{n}</div></div>' for d,n,c,x in hitos)+'</div>'
canal=lambda n,i,a,b,c: T('<div class="lr" style="grid-template-columns:minmax(0,1.2fr) 110px 110px 150px;cursor:default;padding:10px 0"><b style="display:flex;gap:8px;align-items:center"><i:<<i>>:16:#4338CA><<n>></b><span><<a>></span><span><<b>></span><span><<c>></span></div>',n=n,i=i,a=a,b=b,c=c)
tgl=lambda on:'<span class="tg %s"><i></i></span>'%('on' if on else '')
plin=head('Plantillas de facturación','Cuándo se emite, cuándo vence, cuándo se corta y qué promesas se aceptan. Cada servicio usa una.','<button class="btn p" style="padding:11px 20px"><i:mas1:16>Nueva plantilla</button>','Ayuda: plantillas de facturación')+T('''
<div style="flex:1;min-height:0;display:flex;gap:12px">
 <section class="isla pan" style="width:330px;flex:0 0 auto"><div style="padding:12px 14px"><span class="busca"><i:bus:15>Buscar plantilla…</span></div><div class="sc" style="flex:1"><<pl>></div></section>
 <section class="isla pan" style="flex:1;min-width:0">
  <div class="ph2"><div style="flex:1"><b style="font-size:17px">Residencial día 1</b> <span class="b nf">Por defecto</span><div class="m2">1,102 servicios · última edición: Ana Cruz, 3 nov</div></div><<seg>></div>
  <div class="sc" style="flex:1;padding:14px 18px;display:{{t.ciclo.v}};flex-direction:column;gap:12px">
   <section class="cd"><div class="cdh"><i:ojo:15>Así corre el mes de un cliente</div><<linea>></section>
   <div class="g3"><<f1>><<f2>><<f3>></div>
   <div class="g3"><<f4>><<f5>><<f6>></div>
   <section class="cd"><<k1>><<k2>><<k3>></section>
  </div>
  <div class="sc" style="flex:1;padding:14px 18px;display:{{t.prom.v}};flex-direction:column;gap:12px">
   <section class="cd"><div class="cdh"><i:mano:15>Promesas de pago · por servicio</div><div class="g3"><<p1>><<p2>><<p3>></div></section>
   <section class="cd"><div class="cdh"><i:chat:15>Quién puede crearlas</div>
    <div class="lh" style="grid-template-columns:minmax(0,1.2fr) 110px 110px 150px;padding:8px 0;background:transparent;border-top:0"><span>Canal</span><span>Permitida</span><span>Plazo máx.</span><span>Aprobación</span></div><<c1>><<c2>><<c3>><<c4>></section>
   <section class="cd"><div class="cdh"><i:power:15>Reconexión temporal · mientras caja revisa un comprobante</div><<q1>><<q2>><<q3>></section>
  </div>
  <div class="pf" style="padding:12px 18px"><span class="m2" style="flex:1">Los cambios aplican desde el siguiente corte; las facturas ya emitidas no cambian.</span><button class="btn g">Descartar</button><button class="btn p">Guardar plantilla</button></div>
 </section>
</div>''',pl=''.join(T('<div class="lr <<on>>" style="grid-template-columns:minmax(0,1fr) auto"><div><b class="el" style="display:block;font-size:14px"><<a>></b><div class="m2"><<c>></div><div class="m2" style="color:#334155"><<b>></div></div><<x>></div>',on='on' if o else '',a=a,b=b,c=c,x=(B('wa' if x=='Atender' else 'ne',x) if x else '')) for a,b,c,o,x in pls),
 seg=seg('t',[('ciclo','Ciclo y corte','cal'),('prom','Promesas y reconexión','mano')]),linea=linea,
 f1=campo('Día de emisión','1 de cada mes',False,'sel'),f2=campo('Días para pagar','10 días',False,'','Vence el día 10'),f3=campo('Hora de corte','06:00',False,'','Nunca corta de noche','reloj'),
 f4=campo('Limitar velocidad','2 días después de vencer',False,'sel','A 2 Mbps'),f5=campo('Suspender','5 días después de vencer',False,'sel'),f6=campo('Recargo por mora','Sin recargo',False,'sel'),
 k1=kv('<span style="color:#0F172A"><b>No cortar en fin de semana ni feriado</b></span>',tgl(True)),k2=kv('<span style="color:#0F172A"><b>Reactivar al instante cuando paga</b><span class="m2" style="display:block">Viaja por evento, no espera al corte</span></span>',tgl(True)),k3=kv('<span style="color:#0F172A"><b>Cobrar periodo vencido</b> (mes ya consumido) en vez de anticipado</span>',tgl(False)),
 p1=campo('Promesas por periodo','2'),p2=campo('Plazo máximo','5 días'),p3=campo('Monto máximo sin aprobación','Q 1,000.00'),
 c1=canal('Portal del cliente','globo',tgl(True),'3 días','Automática'),c2=canal('Asistente de Iris (IA)','bot',tgl(True),'3 días','Mismas reglas que operador'),c3=canal('Operador (panel e Iris)','user',tgl(True),'5 días','Automática'),c4=canal('Supervisor','escudo',tgl(True),'15 días','Puede saltar las reglas'),
 q1=kv('<span style="color:#0F172A"><b>Permitida</b><span class="m2" style="display:block">Viene apagada de fábrica</span></span>',tgl(True)),q2=kv('Dura','<span class="segb"><button class="ts">24 horas</button><button class="ts on">Hasta medianoche</button></span>'),q3=kv('Máximo por periodo y servicio','<b>1</b>'))
obuild('OperPlantillasFacturacion.dc.html','Plantillas de facturación',shell2('aj',['Configuración','Facturación y cobro','Plantillas de facturación'],plin),logic({'t':(['ciclo','prom'],'ciclo'),'m':(['no'],'no')}))
check('OperPlantillasFacturacion.dc.html')

# ================= 3e · Plantilla de documento (POS 80 mm) =================
docs=[('Factura','hoja','Carta · POS 80 mm',1),('Recibo de cobro','pos','POS 80 mm · carta',0),('Nota de crédito','nc','Carta',0),('Aviso de cobro','mail','Carta',0),('Estado de cuenta','lista','Carta',0),('Traslado de inventario','inv','Carta',0)]
codigo='''<em>&lt;div</em> class="ticket"<em>&gt;</em>
  <em>&lt;h1&gt;</em><u>{{ empresa.nombre }}</u><em>&lt;/h1&gt;</em>
  <em>&lt;p&gt;</em>NIT <u>{{ empresa.nit }}</u><em>&lt;/p&gt;</em>
  <em>&lt;hr&gt;</em>
  <em>&lt;p&gt;</em>FACTURA <u>{{ factura.serie }}</u> <u>{{ factura.numero }}</u><em>&lt;/p&gt;</em>
  <em>&lt;p&gt;</em><u>{{ cliente.nombre }}</u> · NIT <u>{{ cliente.nit }}</u><em>&lt;/p&gt;</em>
  <em>&lt;p&gt;</em>Servicio <u>{{ servicio.codigo }}</u><em>&lt;/p&gt;</em>
  {% for l in factura.lineas %}
    <em>&lt;div</em> class="fila"<em>&gt;</em><u>{{ l.descripcion }}</u> <u>{{ l.importe }}</u><em>&lt;/div&gt;</em>
  {% endfor %}
  <em>&lt;div</em> class="total"<em>&gt;</em>TOTAL Q <u>{{ factura.total }}</u><em>&lt;/div&gt;</em>
  {% bloque_fel %}
<em>&lt;/div&gt;</em>'''.replace('{{','&#123;&#123;').replace('}}','&#125;&#125;')
vars_=[('servicio.codigo','S-000412'),('servicio.nombre','Casa'),('factura.total','325.00'),('factura.saldo','250.00'),('cliente.nombre','Rosa Méndez'),('empresa.nit','8123456-7'),('fel.autorizacion','8F3A1C22…')]
dinner=head('Plantillas de documentos','Cómo se ven la factura, el recibo y los demás documentos al imprimir, en carta o en ticket de 80 mm','<button class="btn o"><i:dif:16>Comparar con la de fábrica</button><button class="btn p" style="padding:11px 20px">Guardar</button>','Ayuda: plantillas de documentos')+T('''
<div style="flex:1;min-height:0;display:flex;gap:12px">
 <section class="isla pan" style="width:250px;flex:0 0 auto"><div class="sc" style="flex:1;padding:8px"><div class="mcap">Documento</div><<docs>></div></section>
 <section class="isla pan" style="flex:1;min-width:0">
  <div class="ph2"><b style="font-size:16px">Factura</b><div class="segb"><button class="ts"><i:hoja:14>Carta</button><button class="ts on"><i:pos:14>POS 80 mm</button></div><span class="b nf">Predeterminada</span><span style="flex:1"></span><button class="btn o sm"><i:hist:14>Restaurar la de fábrica</button></div>
  <div style="flex:1;min-height:0;display:flex;gap:12px;padding:12px 14px">
   <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:10px"><div class="g2"><<f1>><<f2>></div><div class="cod sc" style="flex:1"><<cod>></div></div>
   <div style="width:210px;flex:0 0 auto;display:flex;flex-direction:column;min-height:0"><div class="sec">Variables</div><span class="busca" style="height:34px;margin-bottom:6px"><i:bus:14>Buscar…</span><div class="sc" style="flex:1"><<vars>></div><button class="btn o sm" style="margin-top:8px;justify-content:center"><i:escudo:14>Insertar bloque FEL</button></div>
  </div>
 </section>
 <aside class="isla pan" style="width:360px;flex:0 0 auto"><div class="ph2"><i:ojo:17><b style="flex:1">Vista previa · 80 mm</b><button class="btn o sm"><i:imp:14>Probar</button></div><div class="sc" style="flex:1;background:#F1F5F9;display:flex;justify-content:center;align-items:flex-start;padding:16px"><<tk>></div><div class="pf m2"><i:info:14>Con datos de ejemplo. 48 caracteres por línea; sin imágenes pesadas.</div></aside>
</div>''',docs=''.join(T('<a class="sn <<on>>" href="#"><i:<<i>>:17><span><<a>><small><<b>></small></span></a>',on='on' if o else '',i=i,a=a,b=b) for a,i,b,o in docs),f1=campo('Nombre','Factura POS 80 mm'),f2=campo('Papel','Ticket 80 mm (pos_80)',False,'sel'),cod=codigo,tk=tk,
 vars_=1,vars=''.join(T('<div style="padding:7px 4px;border-top:1px solid #F1F5F9;cursor:pointer"><span class="mono" style="font-size:12px;color:#4338CA"><<a>></span><div class="m2"><<b>></div></div>',a=a,b=b) for a,b in vars_))
obuild('OperPlantillaDocumento.dc.html','Plantilla de documento · POS 80 mm',shell2('aj',['Configuración','Facturación y cobro','Plantillas de documentos','Factura'],dinner),logic({'m':(['no'],'no')}))
check('OperPlantillaDocumento.dc.html')
