exec(open('/tmp/claude-0/-home-user/59389ade-3278-540a-8050-19c26767da8e/scratchpad/gen/conta_base.py').read())
A=[('21 nov','COB-2026-009341','Pago de Marta Julia Xicará · recibo R-018822','Pago','R-018822','215.00','cob','ok'),
('21 nov','VEN-2026-004812','Factura de noviembre · S-000412 · María López','Factura','FACT A-10233','215.00','fac','ok'),
('21 nov','CAJ1-2026-000655','Depósito de caja a Banrural · boleta 4471902','Depósito','DEP-0231','12,450.00','banco','ok'),
('21 nov','VAR-2026-000118','Reverso de COB-2026-009102 · pago duplicado','Reverso','R-018640','350.00','girar','rev'),
('20 nov','COM-2026-000487','Compra a Fibras y Cables, S.A. · FACT 3B1F-88213','Compra','C-000487','18,760.00','camion','ok'),
('20 nov','VEN-2026-004811','Nota de crédito por cargo indebido · Luis Morales','Nota de crédito','NCRE A-00412','75.00','nota','ok'),
('20 nov','BAN2-2026-000341','Liquidación de pasarela · 38 pagos','Liquidación','LIQ-0098','8,932.50','tarjeta','ok'),
('20 nov','COB-2026-009340','Pago de Comercial El Roble · transferencia','Pago','R-018821','1,290.00','cob','pend'),
('19 nov','VAR-2026-000117','Castigo de cartera · 3 facturas · Pedro Ajú','Castigo','CAS-0014','645.00','alerta','ok'),
('19 nov','IMP-2026-000011','Liquidación del IVA de octubre','Impuesto','DEC-0031 v2','31,766.00','calc','ok'),
('18 nov','VAR-2026-000116','Depreciación de octubre · 214 activos','Depreciación','DEP-2026-10','6,318.40','torre','ok')]
rows=''.join(T('''<div class="lr <<on>>" style="grid-template-columns:62px 150px minmax(0,1fr) 150px 110px 34px"><span class="m2"><<f>></span><span class="mono" style="font-size:12.5px"><<n>></span><div style="display:flex;align-items:center;gap:10px;min-width:0"><span class="ico <<ic>>" style="width:30px;height:30px;border-radius:9px"><i:<<i>>:15></span><span class="el"><<d>></span></div><span><span class="b ne"><<t>></span><div class="m2 mono" style="font-size:11.5px;margin-top:2px"><<o>></div></span><b class="num r"><<m>></b><span title="<<st>>" style="color:<<sc>>;display:flex;justify-content:center"><i:<<si>>:15></span></div>''',on='on' if k==0 else '',f=f,n=n,d=d,t=t,o=o,m=m,i=i,ic='wa' if e=='rev' else 'nf',st={'ok':'Sellado en la cadena','rev':'Sellado · es un reverso','pend':'Pendiente de sello (menos de 1 min)'}[e],sc={'ok':'#16A34A','rev':'#16A34A','pend':'#94A3B8'}[e],si={'ok':'sello','rev':'sello','pend':'reloj'}[e]) for k,(f,n,d,t,o,m,i,e) in enumerate(A))
diario=T('''<div class="lh" style="grid-template-columns:62px 150px minmax(0,1fr) 150px 110px 34px"><span>Fecha</span><span>Número</span><span>Descripción</span><span>Documento de origen</span><span style="text-align:right">Debe = Haber</span><span></span></div>
<div class="sc" style="flex:1"><<rows>></div>
<div style="display:flex;align-items:center;gap:10px;padding:10px 18px;border-top:1px solid #F1F5F9;font-size:12px;color:#64748B;flex:0 0 auto"><i:sello:14:#16A34A>Cadena verificada hasta el sello 48,211. Ningún asiento se edita ni se borra: los errores se corrigen con un reverso.<span style="flex:1"></span>11 de 1,842 en noviembre</div>''',rows=rows)
M=[('1 nov','','Saldo inicial','','','148,310.00'),('1 nov','VEN-2026-004388','Facturación de noviembre · 1,010 facturas','221,900.00','','370,210.00'),('3 nov','COB-2026-008790','Cobros del día · 96 pagos','','20,640.00','349,570.00'),('4 nov','COB-2026-008841','Cobros del día · 121 pagos','','26,015.00','323,555.00'),('5 nov','VEN-2026-004401','Nota de crédito NCRE A-00409','','215.00','323,340.00'),('5 nov','COB-2026-008902','Cobros del día · 88 pagos','','18,920.00','304,420.00'),('19 nov','VAR-2026-000117','Castigo de cartera · Pedro Ajú','','645.00','118,930.00'),('21 nov','COB-2026-009341','Pago de Marta Julia Xicará','','215.00','118,715.00')]
mrows=''.join(f'<tr class="hv"><td class="m2">{a}</td><td class="mono" style="font-size:12.5px">{b}</td><td>{c}</td><td class="r">{d}</td><td class="r">{e}</td><td class="r"><b>{f}</b></td></tr>' for a,b,c,d,e,f in M)
mayor=T('''<div style="display:flex;align-items:center;gap:12px;padding:12px 18px;border-top:1px solid #EEF0F5;background:#F8FAFC;flex:0 0 auto"><span class="selp" style="border-color:#4F46E5;background:#fff"><i:libro:14><span class="mono">1.1.03</span> Clientes (cuentas por cobrar)<i:ab:13></span><span class="m2">Cuenta de control · su saldo debe ser la suma de los auxiliares de clientes</span><span style="flex:1"></span><div style="text-align:right"><div class="m2">Saldo al 21 nov</div><b class="num" style="font-size:17px">Q 118,715.00</b></div></div>
<div class="sc" style="flex:1"><table class="tb"><tr><th>Fecha</th><th>Asiento</th><th>Descripción</th><th class="r">Debe</th><th class="r">Haber</th><th class="r">Saldo</th></tr><<mrows>></table></div>
<div style="display:flex;align-items:center;gap:10px;padding:10px 18px;border-top:1px solid #F1F5F9;font-size:12px;color:#64748B;flex:0 0 auto"><i:check:14:#16A34A>Suma de auxiliares de clientes = saldo de la cuenta. <span style="flex:1"></span><button class="lnk">Ver los 287 clientes con saldo <i:der:13></button></div>''',mrows=mrows)
X=[('1 nov','FACT A-10233','Factura de noviembre · S-000412 Internet 30 Mb','215.00','','430.00','er'),('1 oct','FACT A-09871','Factura de octubre · S-000412','215.00','','215.00','er'),('28 sep','R-017204','Pago en caja · efectivo','','215.00','0.00','ok'),('1 sep','FACT A-09455','Factura de septiembre · S-000412','215.00','','215.00','ne'),('30 ago','R-016890','Pago por transferencia','','215.00','0.00','ok')]
xrows=''.join(f'<tr class="hv"><td class="m2">{a}</td><td class="mono" style="font-size:12.5px;color:#4338CA">{b}</td><td>{c}</td><td class="r">{d}</td><td class="r">{e}</td><td class="r"><b>{f}</b></td></tr>' for a,b,c,d,e,f,g in X)
aux=T('''<div style="display:flex;align-items:center;gap:12px;padding:12px 18px;border-top:1px solid #EEF0F5;background:#F8FAFC;flex:0 0 auto"><span class="av" style="background:#E0E7FF;color:#3730A3">ML</span><div><b>María López Tzoc</b><div class="m2">C-000318 · NIT 4471902-5 · 1 servicio · Redes del Valle</div></div><span style="flex:1"></span><div style="text-align:right"><div class="m2">Saldo (suma de su auxiliar)</div><b class="num" style="font-size:17px;color:#B91C1C">Q 430.00</b></div><button class="btn o"><i:user:15>Ficha del cliente</button></div>
<div class="sc" style="flex:1"><table class="tb"><tr><th>Fecha</th><th>Documento</th><th>Descripción</th><th class="r">Cargo</th><th class="r">Abono</th><th class="r">Saldo</th></tr><<xrows>></table></div>
<div style="display:flex;align-items:center;gap:10px;padding:10px 18px;border-top:1px solid #F1F5F9;font-size:12px;color:#64748B;flex:0 0 auto"><i:info:14>El saldo no es un campo: es la suma de estos movimientos. Un cliente con servicios en dos empresas tiene un auxiliar por empresa.</div>''',xrows=xrows)
mov=[('1.1.01.02','Caja 2 · Agencia Chimaltenango','215.00',''),('1.1.03','Clientes · Marta Julia Xicará','','215.00')]
movh=''.join(f'<tr><td><span class="mono" style="font-size:12px;color:#64748B">{a}</span><div>{b}</div></td><td class="r">{c}</td><td class="r">{d}</td></tr>' for a,b,c,d in mov)
side=T('''<aside class="side" style="width:440px;top:64px;border-top:1px solid #EEF0F5;box-shadow:-12px 0 30px rgba(15,23,42,.08);display:{{ds}}">
 <div style="display:flex;align-items:center;gap:10px;padding:16px 18px;border-bottom:1px solid #EEF0F5"><span class="ico nf"><i:cob:18></span><div style="flex:1;min-width:0"><b class="mono" style="font-size:15px">COB-2026-009341</b><div class="m2">Diario de cobros · 21 nov 2026, 10:38</div></div><button class="ib" onClick="{{cerrar}}" title="Cerrar"><i:cerrar:16></button></div>
 <div class="sc" style="flex:1;padding:14px 18px;display:flex;flex-direction:column;gap:14px">
  <div><div class="sec">Documento de origen</div><div class="card" style="padding:10px 12px;display:flex;align-items:center;gap:10px"><span class="ico ok" style="width:32px;height:32px;border-radius:10px"><i:fac:15></span><div style="flex:1"><b style="font-size:13px">Recibo R-018822 · Q 215.00</b><div class="m2">Pago en efectivo · paga FACT A-10187 · Marta Julia Xicará</div></div><button class="lnk">Abrir <i:der:13></button></div></div>
  <div><div class="sec">Movimientos</div><div style="border:1px solid #EEF0F5;border-radius:12px;overflow:hidden"><table class="tb"><tr><th>Cuenta</th><th class="r">Debe</th><th class="r">Haber</th></tr><<movh>><tr class="tot"><td>Cuadra <i:check:13:#16A34A></td><td class="r">215.00</td><td class="r">215.00</td></tr></table></div></div>
  <div><div class="sec">Quién y cómo</div>
   <div class="kv"><span>Registró</span><b>Karla Sic (cajera)</b></div><div class="kv"><span>Canal</span><span>Panel · cobro en caja</span></div><div class="kv"><span>Empresa</span><span>Redes del Valle, S.A.</span></div><div class="kv"><span>Periodo</span><span><span class="b ok">Noviembre abierto</span></span></div><div class="kv"><span>Partida del Libro Diario</span><span class="m2">se asigna al cerrar el mes</span></div></div>
  <div><div class="sec">Integridad</div><div class="ok-note" style="align-items:flex-start"><i:sello:16><div>Sello 48,209 de la cadena.<div class="mono" style="font-size:11px;word-break:break-all;margin-top:2px;color:#166534">9f3c…a71e ← 2b80…44d1</div></div></div></div>
 </div>
 <div style="padding:12px 18px;border-top:1px solid #EEF0F5;display:flex;align-items:center;gap:10px"><span class="m2" style="flex:1">Un asiento nunca se edita. Para corregirlo se hace su espejo, con motivo.</span><button class="btn o" style="color:#B91C1C;border-color:#FECACA"><i:girar:15>Revertir</button></div>
</aside>''',movh=movh)
# --- Por aprobar: borradores de asiento manual (decisión del PM 10)
BOR=[('20 nov','Reclasificar depósito sin identificar a cliente Comercial El Roble','Karla Sic','1,290.00','wa','reloj','Pendiente',1),
('19 nov','Ajuste de redondeo en caja 2 · octubre','Luis Ajcip','0.35','wa','reloj','Pendiente',0),
('18 nov','Provisión de cuentas incobrables · octubre','Ana Castillo (tú)','4,800.00','wa','reloj','Pendiente · lo creaste tú',0),
('15 nov','Corrección de cuenta en compra C-000471','Karla Sic','620.00','ok','check','Aprobado · VAR-2026-000115',0),
('12 nov','Traslado entre bancos sin boleta','Luis Ajcip','10,000.00','er','cerrar','Rechazado · «falta la boleta»',0)]
brows=''.join(T('''<div class="lr <<on>>" style="grid-template-columns:62px minmax(0,1fr) 170px 110px 230px"><span class="m2"><<f>></span><span class="el"><<d>></span><span class="el m2" style="color:#334155"><<q>></span><b class="num r"><<m>></b><span><span class="b <<k>>"><i:<<i>>:12><<e>></span></span></div>''',on='on' if on else '',f=f,d=d,q=q,m=m,k=k,i=i,e=e) for f,d,q,m,k,i,e,on in BOR)
aprob=T('''<div class="av2 nf" style="margin:0 18px 10px;padding:8px 12px;flex:0 0 auto"><i:info:16><div>Esta empresa pide que <b>otra persona</b> apruebe cada asiento de ajuste. Un borrador no toca el libro hasta que se aprueba; quien lo creó no puede aprobarlo, pero sí retirarlo.</div></div>
<div style="flex:1;min-height:0;display:flex;border-top:1px solid #EEF0F5">
 <div style="flex:1;min-width:0;display:flex;flex-direction:column">
  <div class="lh" style="grid-template-columns:62px minmax(0,1fr) 170px 110px 230px;border-top:0"><span>Fecha</span><span>Descripción</span><span>Lo creó</span><span style="text-align:right">Total</span><span>Estado</span></div>
  <div class="sc" style="flex:1"><<rows>></div>
 </div>
 <aside style="width:420px;flex:0 0 auto;border-left:1px solid #EEF0F5;display:flex;flex-direction:column;min-height:0">
  <div style="padding:14px 18px;border-bottom:1px solid #EEF0F5"><div style="display:flex;gap:8px;align-items:center"><b style="font-size:15px;flex:1">Borrador del 20 nov</b><span class="b wa"><i:reloj:12>Pendiente</span></div><div class="m2" style="margin-top:3px">Reclasificar depósito sin identificar a cliente Comercial El Roble · Karla Sic, hoy 09:12</div></div>
  <div class="sc" style="flex:1;padding:12px 18px;display:flex;flex-direction:column;gap:12px">
   <div style="border:1px solid #EEF0F5;border-radius:12px;overflow:hidden"><table class="tb"><tr><th>Cuenta</th><th class="r">Debe</th><th class="r">Haber</th></tr><tr><td><span class="mono" style="font-size:12px;color:#64748B">2.1.09</span><div>Depósitos sin identificar</div></td><td class="r">1,290.00</td><td class="r"></td></tr><tr><td><span class="mono" style="font-size:12px;color:#64748B">1.1.03</span><div>Clientes · Comercial El Roble</div></td><td class="r"></td><td class="r">1,290.00</td></tr><tr class="tot"><td>Cuadra <i:check:13:#16A34A></td><td class="r">1,290.00</td><td class="r">1,290.00</td></tr></table></div>
   <div class="kv"><span>Fecha del asiento</span><span>20 nov · noviembre abierto</span></div>
   <div class="m2" style="line-height:1.45">Al aprobarlo se registra con su fecha. Si el mes ya se cerró o una cuenta cambió, verás el error y el borrador seguirá pendiente.</div>
  </div>
  <div style="padding:12px 18px;border-top:1px solid #EEF0F5;display:flex;gap:8px"><button class="btn o" style="color:#B91C1C;border-color:#FECACA" onClick="{{rech}}"><i:cerrar:15>Rechazar</button><span style="flex:1"></span><button class="btn p"><i:check:15>Aprobar y registrar</button></div>
 </aside>
</div>''',rows=brows)
mrech=T('''<div style="display:{{dr}};position:absolute;inset:0;background:rgba(15,23,42,.35);z-index:8;align-items:center;justify-content:center">
 <div class="isla" style="width:460px;border-radius:22px;padding:22px;display:flex;flex-direction:column;gap:14px">
  <div style="display:flex;align-items:center;gap:10px"><span class="ico er" style="width:38px;height:38px;border-radius:12px;display:flex;align-items:center;justify-content:center"><i:cerrar:18></span><b style="font-size:16px;flex:1">Rechazar el borrador</b><button class="ib" onClick="{{cerrarR}}"><i:cerrar:16></button></div>
  <div style="font-size:14px;color:#475569;line-height:1.5">No toca el libro. Karla Sic verá el motivo y puede crear otro corregido.</div>
  <div><div class="lb">Motivo<span class="req">*</span></div><div class="in ph">Ej.: falta la boleta del depósito</div></div>
  <div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn g" onClick="{{cerrarR}}">Cancelar</button><button class="btn p" style="background:#B91C1C;box-shadow:none" onClick="{{cerrarR}}">Rechazar</button></div>
 </div></div>''')
inner=T('''<div style="display:flex;align-items:center;gap:10px;flex:0 0 auto">
 <div><h1 class="h1">Libro contable</h1><div class="sub">Redes del Valle, S.A. · noviembre abierto · octubre por cerrar</div></div>
 <span style="flex:1"></span><<emp>><<per>><<ay>>
 <button class="btn o"><i:desc:15>Exportar</button>
 <button class="btn p" style="padding:11px 20px"><i:mas1:16>Asiento de ajuste</button>
</div>
<section class="isla" style="flex:1;min-height:0;border-radius:20px;display:flex;flex-direction:column;overflow:hidden;position:relative">
 <div style="display:flex;align-items:center;gap:10px;padding:12px 18px;flex-wrap:wrap">
  <div class="segb"><sc-for list="{{tabs}}" as="t"><button class="ts {{t.cls}}" onClick="{{t.ir}}"><span class="ti ti-{{t.ico}}" style="width:15px;height:15px"></span>{{t.nom}}</button></sc-for></div>
  <span style="flex:1"></span>
  <span class="busca" style="width:330px;border-color:#4F46E5;box-shadow:0 0 0 3px rgba(79,70,229,.12)"><i:bus:15>Buscar por factura, recibo, DTE, compra o número…</span>
  <span class="selp" style="display:{{dfil}}"><i:libro:14>Diario: todos<i:ab:13></span>
  <span class="selp" style="display:{{dfil}}"><i:filtro:14>Origen: todos<i:ab:13></span>
 </div>
 <div style="flex:1;min-height:0;display:{{d1}};flex-direction:column;margin-right:{{mr}}"><<diario>></div>
 <div style="flex:1;min-height:0;display:{{d2}};flex-direction:column"><<mayor>></div>
 <div style="flex:1;min-height:0;display:{{d3}};flex-direction:column"><<aux>></div>
 <div style="flex:1;min-height:0;display:{{d4}};flex-direction:column"><<aprob>></div>
 <<side>><<mrech>>
</section>''',emp=emp('Redes del Valle, S.A.'),per=per(),ay=AYUDA('cómo leer el libro y corregir un asiento'),diario=diario,mayor=mayor,aux=aux,side=side,aprob=aprob,mrech=mrech)
logic='''class Component extends DCLogic {
renderVals() {
const st = this.state || {}; const t = st.t || 'diario';
const tabs = [['diario', 'Diario', 'lista'], ['mayor', 'Mayor', 'libro'], ['aux', 'Auxiliar de cliente', 'user'], ['cuentas', 'Plan de cuentas', 'net'], ['apr', 'Por aprobar (3)', 'check']].map(([id, nom, ico]) => ({ id, nom, ico, cls: id === t ? 'on' : '', ir: () => this.setState({ t: id, cerrado: true }) }));
const s = t === 'diario' && !st.cerrado;
return { tabs, d1: t === 'diario' ? 'flex' : 'none', d2: (t === 'mayor' || t === 'cuentas') ? 'flex' : 'none', d3: t === 'aux' ? 'flex' : 'none', d4: t === 'apr' ? 'flex' : 'none', dr: st.rech ? 'flex' : 'none', rech: () => this.setState({ rech: true }), cerrarR: () => this.setState({ rech: false }), dfil: t === 'diario' ? 'inline-flex' : 'none', ds: s ? 'flex' : 'none', mr: s ? '440px' : '0', cerrar: () => this.setState({ cerrado: true }) };
}
}'''
build('ContaLibro.dc.html','Finanzas · Libro: diario, mayor, auxiliar y detalle de un asiento',shell('fin',['Finanzas','Libro contable'],inner),logic,900,CSSK+mask(['lista','libro','user','net','check']))
