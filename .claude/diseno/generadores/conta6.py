exec(open('/tmp/claude-0/-home-user/59389ade-3278-540a-8050-19c26767da8e/scratchpad/gen/conta_base.py').read())
# ---------- Compras, proveedores y activos ----------
CO=[('20 nov','FACT 3B1F-88213','Fibras y Cables, S.A.','NIT 2291004-6','Bienes · 24 ONU y 2 bobinas','18,760.00','Crédito 30 días','Por pagar','wa','vence 20 dic','Inventario'),
('19 nov','FACT 77AC-10442','Tigo Business','NIT 508132-K','Servicio · ancho de banda nov','42,000.00','Crédito 15 días','Por pagar','wa','vence 4 dic','Gasto'),
('18 nov','FACT 0D4E-55120','Energuate','NIT 1498822-0','Servicio · energía de nodos','3,418.60','Contado','Pagada','ok','banco · 18 nov','Gasto'),
('15 nov','FPEQ 5512-00391','Taller El Buen Poste','NIT 880023-1','Servicio · postes zona Norte','2,400.00','Contado','Pagada','ok','caja 1 · egreso E-0412','Gasto'),
('14 nov','FACT 91B0-33008','Dist. de Torres GT','NIT 3345091-2','Activo · torre de 24 m','31,500.00','Crédito 30 días','Vencida','er','venció 14 nov · 7 días','Activo fijo'),
('12 nov','FACT 2C19-70411','Seguros del País','NIT 120045-5','Seguro anual de equipo','9,600.00','Contado','Pagada','ok','se reparte en 12 meses','Diferido')]
corows=''.join(T('<div class="lr <<on>>" style="grid-template-columns:62px minmax(0,1.3fr) minmax(0,1.2fr) 100px 110px 150px 30px"><span class="m2"><<f>></span><div><b class="el" style="display:block"><<p>></b><div class="m2 el"><span class="mono" style="font-size:11.5px"><<d>></span> · <<n>></div></div><div><span class="el" style="display:block"><<c>></span><div><span class="b ne" style="font-size:11px;padding:1px 8px"><<dest>></span></div></div><b class="num r"><<m>></b><span class="m2"><<cond>></span><div><span class="b <<ec>>"><span class="dot" style="background:currentColor"></span><<e>></span><div class="m2 el" style="margin-top:2px"><<v>></div></div><button class="ib"><i:mas:16></button></div>',on='on' if k==0 else '',f=f,d=d,p=p,n=n,c=c,m=m,cond=cond,e=e,ec=ec,v=v,dest=dest) for k,(f,d,p,n,c,m,cond,e,ec,v,dest) in enumerate(CO))
cxp=[75360,31500,0,0,0]
cxpl=['Por vencer','1–30 días','31–60','61–90','Más de 90']
compras=T('''<div style="display:grid;grid-template-columns:minmax(0,1fr) 360px;flex:1;min-height:0">
 <div style="display:flex;flex-direction:column;min-height:0;border-right:1px solid #EEF0F5">
  <div class="lh" style="grid-template-columns:62px minmax(0,1.3fr) minmax(0,1.2fr) 100px 110px 150px 30px"><span>Fecha</span><span>Proveedor y documento</span><span>Concepto y destino</span><span style="text-align:right">Total (Q)</span><span>Condición</span><span>Estado</span><span></span></div>
  <div class="sc" style="flex:1"><<corows>></div>
  <div style="display:flex;align-items:center;gap:8px;padding:10px 18px;border-top:1px solid #F1F5F9;font-size:12px;color:#64748B"><i:info:14>Una compra no se edita: se anula con su reverso y se registra de nuevo. El crédito de IVA vale 2 meses.<span style="flex:1"></span>6 de 38 en noviembre</div>
 </div>
 <div class="sc" style="padding:14px 16px;display:flex;flex-direction:column;gap:12px">
  <div><h2 class="ct">Debes Q 106,860; Q 31,500 ya vencieron</h2><div class="cs">Cuentas por pagar por antigüedad · cuadra con proveedores (2.1.03)</div>
   <div style="margin:10px 0 6px"><<hb>></div><table class="tb"><<cxprows>></table></div>
  <div class="card" style="padding:12px;border-style:dashed;border-color:#C7D2FE;background:#F5F7FF"><div style="display:flex;gap:10px;align-items:center"><span class="ico nf"><i:subir:18></span><div style="flex:1"><b style="font-size:13px">2 borradores por revisar</b><div class="m2">Leídos del XML o la foto de la factura; tú confirmas antes de que toquen el libro</div></div></div>
   <div class="kv" style="margin-top:8px"><span>Claro · FACT 55E1-0092 <span class="b ok" style="font-size:11px">XML</span></span><b class="num">Q 6,120.00</b></div><div class="kv"><span>Ferretería Ixchel <span class="b wa" style="font-size:11px">foto · revisar NIT</span></span><b class="num">Q 842.50</b></div></div>
  <div class="av2 wa" style="align-items:flex-start"><i:rayo:16><div><b>Consejo:</b> la compra a Taller El Buen Poste pasa de Q 2,500 sin retención registrada. <button class="lnk" style="font-size:12px">Ver</button></div></div>
 </div>
</div>''',corows=corows,hb=hbar(cxp[:2],ANT[:2]),cxprows=''.join(f'<tr><td><span class="sw" style="background:{c}"></span>&nbsp; {l}</td><td class="r">Q {fmt(v)}</td></tr>' for l,v,c in zip(cxpl,cxp,ANT)))
PR=[('Tigo Business','NIT 508132-K','Ancho de banda','42,000.00','4 dic','wa'),('Fibras y Cables, S.A.','NIT 2291004-6','Equipo y fibra','33,360.00','20 dic','wa'),('Dist. de Torres GT','NIT 3345091-2','Infraestructura','31,500.00','vencido 7 días','er'),('Energuate','NIT 1498822-0','Energía','0.00','—','ok'),('Seguros del País','NIT 120045-5','Seguros','0.00','—','ok')]
provs='<table class="tb"><tr><th>Proveedor</th><th>Categoría</th><th class="r">Saldo (Q)</th><th>Próximo vencimiento</th><th></th></tr>'+''.join(f'<tr class="hv"><td><b>{a}</b><div class="m2">{b}</div></td><td>{c}</td><td class="r"><b>{d}</b></td><td><span class="b {g}">{e}</span></td><td class="r"><button class="lnk" style="font-size:12px">Estado de cuenta</button></td></tr>' for a,b,c,d,e,g in PR)+'</table>'
AC=[('Torre de 24 m · Nodo San Juan','Torres y antenas','A-000214','14 nov 2026','31,500.00','10 %','0.00','31,500.00',0),('OLT Huawei MA5608T · Nodo Centro','Equipo de red','A-000102','3 mar 2025','48,200.00','20 %','15,263.30','32,936.70',32),('Pick-up Toyota Hilux 2022','Vehículos','A-000031','12 ene 2023','185,000.00','20 %','141,833.30','43,166.70',77),('ONU en comodato · 1,120 unidades','Equipo en clientes','A-COM','varias','212,800.00','20 %','88,410.00','124,390.00',42),('Planta eléctrica 10 kVA','Maquinaria','A-000077','20 jun 2024','22,400.00','20 %','10,453.30','11,946.70',47)]
activos='<table class="tb"><tr><th>Activo</th><th>Clase</th><th>Alta</th><th class="r">Costo (Q)</th><th class="r">Tasa</th><th>Depreciado</th><th class="r">Valor en libros (Q)</th></tr>'+''.join(f'<tr class="hv"><td><b>{a}</b><div class="m2 mono" style="font-size:11.5px">{c}</div></td><td>{b}</td><td class="m2">{d}</td><td class="r">{e}</td><td class="r">{f}</td><td style="width:170px"><div style="display:flex;align-items:center;gap:8px"><span class="bar" style="flex:1"><i style="width:{p}%;background:#4F46E5"></i></span><span class="num m2" style="width:34px;text-align:right">{p} %</span></div></td><td class="r"><b>{h}</b></td></tr>' for a,b,c,d,e,f,g,h,p in AC)+'<tr class="tot"><td colspan="3">214 activos</td><td class="r">1,284,300.00</td><td></td><td></td><td class="r">812,640.00</td></tr></table>'
inner=T('''<div style="display:flex;align-items:center;gap:10px;flex:0 0 auto">
 <div><h1 class="h1">Compras y gastos</h1><div class="sub">Redes del Valle, S.A. · 38 compras en noviembre · Q 164,280</div></div>
 <span style="flex:1"></span><<emp>><<ay>>
 <button class="btn o"><i:banco:15>Pagar a proveedor</button>
 <button class="btn o"><i:mas1:15>Registrar a mano</button>
 <button class="btn p" style="padding:11px 20px"><i:subir:16>Cargar factura</button>
</div>
<section class="isla" style="flex:1;min-height:0;border-radius:20px;display:flex;flex-direction:column;overflow:hidden">
 <div style="display:flex;align-items:center;gap:10px;padding:12px 18px;flex-wrap:wrap">
  <div class="segb"><sc-for list="{{tabs}}" as="t"><button class="ts {{t.cls}}" onClick="{{t.ir}}">{{t.nom}}<span class="c {{t.cc}}">{{t.n}}</span></button></sc-for></div>
  <span style="flex:1"></span>
  <span class="busca" style="width:280px"><i:bus:15>Proveedor, NIT o número de factura…</span>
  <span class="selp"><i:filtro:14>Estado: todas<i:ab:13></span>
 </div>
 <div style="flex:1;min-height:0;display:{{d1}};flex-direction:column"><<compras>></div>
 <div class="sc" style="flex:1;display:{{d2}}"><<provs>></div>
 <div style="flex:1;min-height:0;display:{{d3}};flex-direction:column">
  <div style="display:flex;align-items:center;gap:12px;padding:10px 18px;background:#F8FAFC;border-top:1px solid #EEF0F5;border-bottom:1px solid #EEF0F5"><span class="ci2 ok"><i:check:14></span><div style="flex:1"><b style="font-size:13px">Depreciación de octubre registrada · Q 6,318.40</b><div class="m2">Método lineal · la de noviembre se registra sola al terminar el mes</div></div><button class="btn o" style="padding:7px 12px"><i:mas1:14>Alta de activo</button><button class="btn o" style="padding:7px 12px"><i:baja:14>Dar de baja</button></div>
  <div class="sc" style="flex:1"><<activos>></div>
 </div>
</section>''',emp=emp('Redes del Valle, S.A.'),ay=AYUDA('cómo registrar una compra y a dónde va cada línea'),compras=compras,provs=provs,activos=activos)
logic='''class Component extends DCLogic {
renderVals() {
const st = this.state || {}; const t = st.t || 'compras';
const tabs = [['compras', 'Compras', 38, ''], ['borr', 'Borradores', 2, 'rj'], ['prov', 'Proveedores', 27, ''], ['pagos', 'Pagos', 19, ''], ['activos', 'Activos fijos', 214, ''], ['dif', 'Diferidos', 9, '']].map(([id, nom, n, cc]) => ({ id, nom, n, cc, cls: id === t ? 'on' : '', ir: () => this.setState({ t: id }) }));
const g = (t === 'prov' || t === 'pagos') ? 2 : (t === 'activos' || t === 'dif') ? 3 : 1;
return { tabs, d1: g === 1 ? 'flex' : 'none', d2: g === 2 ? 'block' : 'none', d3: g === 3 ? 'flex' : 'none' };
}
}'''
cbuild('ContaCompras.dc.html','Finanzas · Compras, proveedores y activos fijos',shell('fin',['Finanzas','Compras y gastos'],inner),logic,900)

# ---------- Cartera ----------
CL=[('Hotel Vista Real','C-000087 · Sur · Escuintla','4','0.00','2,150.00','2,150.00','2,150.00','6,450.00','Suspendido','er','2 gestiones · última 12 nov','Gestión'),
('Pedro Ajú','C-000512 · Norte','3','0.00','0.00','215.00','430.00','645.00','Retirado','ne','3 gestiones · equipo recuperado','Castigar'),
('Comercial El Roble, S.A.','C-000044 · Centro','2','1,290.00','1,290.00','0.00','0.00','2,580.00','Promesa hasta 25 nov','nf','promesa por Q 2,580','Promesa'),
('Rosa Ixcot','C-000733 · Norte','3','215.00','215.00','215.00','0.00','645.00','Suspendido','er','sin gestiones','Gestión'),
('Julio Tax','C-000281 · San Juan','2','325.00','325.00','0.00','0.00','650.00','Limitado','wa','1 gestión · 18 nov','Gestión'),
('Ferretería La Paz','C-000190 · Zona 4','1','430.00','0.00','0.00','0.00','430.00','Activo','ok','vence en mora el 1 dic','—'),
('Marta Julia Xicará','C-000402 · Norte','2','215.00','215.00','0.00','0.00','430.00','Limitado','wa','sin gestiones','Gestión')]
clrows=''.join(T('<div class="lr <<on>>" style="grid-template-columns:22px minmax(0,1.4fr) 86px 86px 86px 86px 100px 170px minmax(0,1fr) 92px"><span class="ck <<ck>>" style="width:18px;height:18px"><<cki>></span><div><b class="el" style="display:block"><<n>></b><div class="m2 el"><<c>> · <<f>></div></div><span class="num r"><<a>></span><span class="num r"><<b>></span><span class="num r"><<d>></span><span class="num r" style="<<s4>>"><<e>></span><b class="num r"><<t>></b><span><span class="b <<ec>>"><<es>></span></span><span class="m2 el"><<g>></span><span style="justify-self:end"><<ac>></span></div>',on='on' if k==1 else '',ck='on' if k==1 else '',cki=s('check',12) if k==1 else '',n=n,c=c,f=(f+' factura' if f=='1' else f+' facturas'),a=a,b=b,d=d,e=e,t=t,es=es,ec=ec,g=g,s4='color:#B91C1C;font-weight:700' if e!='0.00' else 'color:#CBD5E1',ac=(f'<button class="btn o" style="padding:5px 12px;{"color:#B91C1C;border-color:#FECACA" if ac=="Castigar" else ""}">{ac}</button>' if ac!='—' else '')) for k,(n,c,f,a,b,d,e,t,es,ec,g,ac) in enumerate(CL))
CG='22px minmax(0,1.4fr) 86px 86px 86px 86px 100px 170px minmax(0,1fr) 92px'
ant=[38900,21450,12870,11400]
inner2=T('''<div style="display:flex;align-items:center;gap:10px;flex:0 0 auto">
 <div><h1 class="h1">Cartera</h1><div class="sub">Redes del Valle, S.A. · Q 84,620 vencidos de 287 clientes · estimación para incobrables Q 3,560 (tope legal 3 %)</div></div>
 <span style="flex:1"></span><<emp>><<ay>>
 <button class="btn o"><i:desc:15>Exportar</button>
</div>
<div style="display:flex;gap:10px;flex:0 0 auto">
 <div class="kt" style="flex:2.8"><div class="kl">Vencido por antigüedad</div><div style="margin:6px 0 4px"><<hb>></div><div style="display:flex;gap:14px;flex-wrap:wrap"><<leg>></div></div>
 <<k1>><<k2>><<k3>>
</div>
<section class="isla" style="flex:1;min-height:0;border-radius:20px;display:flex;flex-direction:column;overflow:hidden;position:relative">
 <div style="display:flex;align-items:center;gap:10px;padding:12px 18px;flex-wrap:wrap">
  <div class="segb"><button class="ts {{t1}}" onClick="{{ir1}}"><i:reloj:14>Por cobrar<span class="c">287</span></button><button class="ts {{t2}}" onClick="{{ir2}}"><i:alerta:14>Castigos<span class="c">14</span></button><button class="ts {{t3}}" onClick="{{ir3}}"><i:nota:14>Notas de crédito<span class="c">6</span></button></div>
  <span style="flex:1"></span>
  <span class="busca" style="width:250px"><i:bus:15>Cliente, código o factura…</span>
  <span class="selp"><i:reloj:14>Antigüedad: toda<i:ab:13></span><span class="selp"><i:mapa:14>Zona: todas<i:ab:13></span>
 </div>
 <div style="flex:1;min-height:0;display:{{d1}};flex-direction:column">
  <div class="lh" style="grid-template-columns:<<cg>>"><span></span><span>Cliente</span><span style="text-align:right">0–30</span><span style="text-align:right">31–60</span><span style="text-align:right">61–90</span><span style="text-align:right">Más de 90</span><span style="text-align:right">Vencido (Q)</span><span>Servicio</span><span>Gestión de cobro</span><span></span></div>
  <div class="sc" style="flex:1"><<clrows>></div>
  <div style="display:flex;align-items:center;gap:12px;padding:10px 18px;border-top:1px solid #EEF0F5;background:#F5F7FF"><b style="font-size:13px">1 cliente elegido · 3 facturas · Q 645.00</b><span class="m2">Retirado, con 3 gestiones registradas: cumple para castigo</span><span style="flex:1"></span><button class="btn o"><i:tel:15>Registrar gestión</button><button class="btn p" style="background:#B91C1C;box-shadow:none" onClick="{{abrir}}"><i:alerta:15>Castigar…</button></div>
 </div>
 <div class="sc" style="flex:1;display:{{d2}}"><table class="tb"><tr><th>Fecha</th><th>Cliente</th><th>Facturas</th><th>Motivo y evidencia</th><th class="r">Monto (Q)</th><th>De dónde salió</th><th>Asiento</th></tr>
  <tr class="hv"><td class="m2">19 nov</td><td><b>Pedro Ajú</b></td><td>3</td><td>Retirado · 3 gestiones, equipo recuperado <i:doc:13></td><td class="r"><b>645.00</b></td><td><span class="b ne">Estimación</span></td><td class="mono" style="font-size:12px;color:#4338CA">VAR-2026-000117</td></tr>
  <tr class="hv"><td class="m2">30 oct</td><td><b>Lucía Chávez</b></td><td>5</td><td>Sin localizar · 4 gestiones y carta <i:doc:13></td><td class="r"><b>1,075.00</b></td><td><span class="b ne">Estimación</span></td><td class="mono" style="font-size:12px;color:#4338CA">VAR-2026-000109</td></tr>
  <tr class="hv"><td class="m2">30 oct</td><td><b>Cafetería El Portal</b></td><td>6</td><td>Cerró el negocio · acta <i:doc:13></td><td class="r"><b>2,580.00</b></td><td><span class="b wa">Gasto del mes</span></td><td class="mono" style="font-size:12px;color:#4338CA">VAR-2026-000108</td></tr></table></div>
 <div class="sc" style="flex:1;display:{{d3}}"><table class="tb"><tr><th>Fecha</th><th>Nota</th><th>Cliente y factura</th><th>Motivo</th><th class="r">Monto (Q)</th><th>FEL</th><th>Creó</th></tr>
  <tr class="hv"><td class="m2">20 nov</td><td class="mono" style="font-size:12.5px">NCRE A-00412</td><td><b>Luis Morales</b><div class="m2">FACT A-10110 · una línea</div></td><td>Cargo de reconexión indebido</td><td class="r"><b>75.00</b></td><td><span class="b ok">Certificada</span></td><td class="m2">Karla Sic</td></tr>
  <tr class="hv"><td class="m2">20 nov</td><td class="mono" style="font-size:12.5px">NCRE A-00413</td><td><b>Luis Morales</b><div class="m2">FACT A-09604 · completa</div></td><td>Servicio no prestado en septiembre</td><td class="r"><b>215.00</b></td><td><span class="b er">Rechazada · fuera de plazo</span></td><td class="m2">Karla Sic</td></tr>
  <tr class="hv"><td class="m2">14 nov</td><td class="mono" style="font-size:12.5px">NCRE A-00411</td><td><b>Hotel Vista Real</b><div class="m2">FACT A-10002 · una línea</div></td><td>Descuento por caída de 3 días</td><td class="r"><b>215.00</b></td><td><span class="b ok">Certificada</span></td><td class="m2">Ana Castillo</td></tr></table></div>
</section>
<div style="display:{{dm}};position:absolute;inset:0;background:rgba(15,23,42,.35);z-index:8;align-items:center;justify-content:center">
 <div class="isla" style="width:500px;border-radius:22px;padding:22px;display:flex;flex-direction:column;gap:14px">
  <div style="display:flex;align-items:center;gap:10px"><span class="ico er"><i:alerta:18></span><div style="flex:1"><b style="font-size:16px">Castigar cartera de Pedro Ajú</b><div class="m2">3 facturas · Q 645.00 · no se puede deshacer, solo revertir</div></div><button class="ib" onClick="{{cerrar}}"><i:cerrar:16></button></div>
  <div style="border:1px solid #EEF0F5;border-radius:12px;padding:4px 12px"><div class="kv" style="border-top:0"><span>Sale de la estimación para incobrables</span><b class="num">Q 569.20</b></div><div class="kv"><span>IVA que nunca se certificó</span><b class="num">Q 75.80</b></div><div class="kv"><span>Queda en la estimación</span><b class="num">Q 2,990.80</b></div></div>
  <div><div class="lb">Motivo<span class="req">*</span></div><div class="in" style="border-color:#4F46E5;box-shadow:0 0 0 3px rgba(79,70,229,.12)">Cliente retirado; no responde tras 3 gestiones</div></div>
  <div><div class="lb">Evidencia de la gestión de cobro<span class="req">*</span></div><div class="in"><i:doc:15:#94A3B8>3 gestiones registradas · 1 archivo adjunto</div><div class="ay">La ley pide gestión documentada o estimación. Valídalo con tu contador.</div></div>
  <div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn g" onClick="{{cerrar}}">Cancelar</button><button class="btn p" style="background:#B91C1C;box-shadow:none"><i:alerta:15>Castigar Q 645.00</button></div>
 </div>
</div>''',emp=emp('Redes del Valle, S.A.'),ay=AYUDA('gestión de cobro, estimación y castigo'),cg=CG,clrows=clrows,hb=hbar(ant,ANT[1:]),
 leg=''.join(f'<span class="lg"><i style="background:{c}"></i>{l} <b class="num" style="color:#0F172A">Q {fmt(v)}</b></span>' for c,l,v in zip(ANT[1:],['0–30 días','31–60','61–90','Más de 90'],ant)),
 k1=kt('mano','nf','Con promesa activa','Q 9,340','23 clientes · no se cortan'),k2=kt('alerta','er','Castigado este año','Q 18,420','14 castigos · 0.6 % de lo facturado'),k3=kt('sello','ok','Estimación disponible','Q 3,560','se calcula al cierre del año'))
logic2='''class Component extends DCLogic {
renderVals() {
const st = this.state || {}; const t = st.t || 'cobrar';
return { t1: t === 'cobrar' ? 'on' : '', t2: t === 'cast' ? 'on' : '', t3: t === 'notas' ? 'on' : '', d1: t === 'cobrar' ? 'flex' : 'none', d2: t === 'cast' ? 'block' : 'none', d3: t === 'notas' ? 'block' : 'none', ir1: () => this.setState({ t: 'cobrar' }), ir2: () => this.setState({ t: 'cast' }), ir3: () => this.setState({ t: 'notas' }), dm: st.castigar ? 'flex' : 'none', abrir: () => this.setState({ castigar: true }), cerrar: () => this.setState({ castigar: false }) };
}
}'''
build('ContaCartera.dc.html','Finanzas · Cartera: antigüedad, gestión, castigos y notas de crédito',shell('fin',['Finanzas','Cartera'],inner2),logic2,900,CSSK+CSSC)
