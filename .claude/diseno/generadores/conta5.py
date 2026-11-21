exec(open('/tmp/claude-0/-home-user/59389ade-3278-540a-8050-19c26767da8e/scratchpad/gen/conta_base.py').read())
# ---------- Fiscal: calendario + declaración ----------
OB=[('Vencidas',[('er','Retenciones de ISR · octubre','contador','venció el 13 nov','8 días tarde · mora estimada Q 41','Q 2,180','Sin calcular',0)]),
('Este mes',[('wa','IVA mensual · octubre','SAT-2237','vence el 30 nov','faltan 9 días','Q 21,924','Revisada',1),('ok','Retenciones de IVA · octubre','SAT-2340','venció el 20 nov','pagada el 18 nov','Q 3,460','Pagada',0)]),
('Próximas',[('ne','Retenciones de ISR · noviembre','contador','vence el 14 dic','faltan 23 días','—','Sin calcular',0),('ne','IVA mensual · noviembre','SAT-2237','vence el 31 dic','faltan 40 días','Q 23,410 a hoy','Sin calcular',0),('ne','ISO · 4.º trimestre','SAT-1608','vence el 31 ene','faltan 71 días','Q 7,410 a hoy','Sin calcular',0),('ne','ISR trimestral · oct–dic','SAT-1361','con la anual','31 mar 2027','—','Con la anual',0),('ne','ISR anual 2026','SAT-1411','vence el 31 mar','faltan 130 días','Q 74,300 a hoy','Sin calcular',0)])]
obh=''
for g,items in OB:
    obh+=f'<div class="grp">{g}<span class="m2">· {len(items)}</span></div>'
    for c,n,f,v,d,m,e,on in items:
        obh+=T('<div class="lr <<on>>" style="grid-template-columns:34px minmax(0,1fr) 108px 96px;padding:10px 16px"><span class="ci2 <<c>>"><i:<<i>>:14></span><div style="min-width:0"><b class="el" style="display:block"><<n>></b><div class="m2 el"><<f>> · <<v>> · <span style="<<ds>>"><<d>></span></div></div><b class="num r" style="font-size:12.5px"><<m>></b><span class="b <<bc>>" style="justify-self:end"><<e>></span></div>',on='on' if on else '',c=c,i={'er':'alerta','wa':'reloj','ok':'check','ne':'cal'}[c],n=n,f=f,v=v,d=d,m=m,e=e,ds='color:#B91C1C;font-weight:600' if c=='er' else ('color:#B45309;font-weight:600' if c=='wa' else ''),bc={'Revisada':'nf','Pagada':'ok','Sin calcular':'ne','Con la anual':'ne'}[e])
steps=[('hecho','check','Calcular','19 nov · versión 2'),('hecho','check','Revisar','19 nov · M. Méndez'),('act','3','Presentar','en la Agencia Virtual'),('','4','Pagar','antes del 30 nov')]
sth=''
for k,(c,n,t,d) in enumerate(steps):
    sth+=T('<div class="stp <<c>>"><span class="n"><<n>></span><div><div><<t>></div><div style="font-size:11px;font-weight:500;color:#64748B"><<d>></div></div></div>',c=c,n=(s('check',13) if n=='check' else n),t=t,d=d)
    if k<3: sth+=f'<span class="stl {"hecho" if k<2 else ""}"></span>'
DL=[('Débito fiscal','IVA de 1,004 facturas certificadas','Libro de ventas','31,766.00',''),('Notas de crédito','IVA de 6 NCRE','Libro de ventas','− 128.40',''),('Crédito fiscal','IVA de 38 compras del periodo','Libro de compras','− 6,253.60',''),('Retenciones de IVA recibidas','4 constancias de clientes','Constancias','− 3,460.00','')]
dlh=''.join(f'<tr class="hv"><td><b>{a}</b> <span class="m2">· {b}</span></td><td><button class="lnk" style="font-size:12px">{c} {s("der",12)}</button></td><td class="r">{d}</td></tr>' for a,b,c,d,e in DL)
inner=T('''<div style="display:flex;align-items:center;gap:10px;flex:0 0 auto">
 <div><h1 class="h1">Fiscal</h1><div class="sub">Redes del Valle, S.A. · NIT 8123456-7 · régimen sobre utilidades · FEL obligatoria, se certifica al cobrar</div></div>
 <span style="flex:1"></span><<emp>><<ay>>
 <button class="btn o"><i:tubo:15>Comparar regímenes</button>
</div>
<div style="display:flex;gap:10px;flex:0 0 auto">
 <<k1>><<k2>><<k3>>
 <div class="kt" style="flex:1.5"><div class="kl"><span class="ico wa" style="width:26px;height:26px;border-radius:8px"><i:gauge:15></span>Pequeño contribuyente · TeleSur<span class="b wa" style="margin-left:auto">82 % del límite</span></div><div style="display:flex;align-items:baseline;gap:8px"><span class="kv">Q 123,400</span><span class="ks">de Q 150,000 al año · quedan Q 26,600</span></div><div class="bar" style="height:8px;margin-top:4px;position:relative;overflow:visible"><i style="width:82%;background:#D97706"></i><span style="position:absolute;left:80%;top:-3px;width:2px;height:14px;background:#0F172A" title="Aviso al 80 %"></span></div></div>
</div>
<div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.12fr);gap:10px;flex:1;min-height:0">
 <section class="isla" style="border-radius:20px;display:flex;flex-direction:column;overflow:hidden;min-height:0">
  <div style="display:flex;align-items:center;gap:10px;padding:12px 16px">
   <div class="segb"><button class="ts on"><i:cal:14>Calendario</button><button class="ts"><i:doc:14>Declaraciones</button><button class="ts"><i:rayo:14>Consejos<span class="c">3</span></button></div>
   <span style="flex:1"></span><span class="selp"><i:filtro:14>Todas<i:ab:13></span>
  </div>
  <div class="sc" style="flex:1"><<obh>></div>
  <div style="display:flex;align-items:center;gap:8px;padding:10px 16px;border-top:1px solid #F1F5F9;font-size:12px;color:#64748B"><i:info:14>Los plazos cuentan días hábiles y feriados. Argos calcula borradores; la presentación la haces tú en la Agencia Virtual.</div>
 </section>
 <section class="isla" style="border-radius:20px;display:flex;flex-direction:column;overflow:hidden;min-height:0">
  <div style="padding:14px 18px 12px;border-bottom:1px solid #EEF0F5">
   <div style="display:flex;align-items:center;gap:10px"><span class="ico wa"><i:calc:18></span><div style="flex:1"><b style="font-size:16px">IVA mensual · octubre 2026</b><div class="m2">Formulario SAT-2237 · versión 2 · vence el lunes 30 nov</div></div><button class="btn o" style="padding:7px 12px"><i:pdf:14>PDF</button><button class="btn o" style="padding:7px 12px"><i:excel:14>Excel</button></div>
   <div style="display:flex;align-items:center;gap:8px;margin-top:14px"><<sth>></div>
  </div>
  <div class="sc nsh" style="flex:1;padding:14px 18px;display:flex;flex-direction:column;gap:12px">
   <div class="ok-note"><i:check:15>Los datos no han cambiado desde que se revisó. El asiento de liquidación IMP-2026-000011 ya está en el libro y octubre quedó bloqueado para impuestos.</div>
   <div style="border:1px solid #EEF0F5;border-radius:14px;overflow:hidden"><table class="tb"><tr><th>Renglón</th><th>De dónde sale</th><th class="r">Monto (Q)</th></tr><<dlh>><tr class="tot"><td colspan="2">IVA a pagar</td><td class="r" style="font-size:15px">21,924.00</td></tr></table></div>
   <div class="g3">
    <div><div class="lb">Número de formulario<span class="req">*</span></div><div class="in ph" style="border-color:#4F46E5;box-shadow:0 0 0 3px rgba(79,70,229,.12)">Como aparece en la constancia</div></div>
    <div><div class="lb">Fecha de presentación</div><div class="in sel">21 nov 2026</div></div>
    <div><div class="lb">Constancia (PDF)</div><div class="in ph"><i:subir:15:#94A3B8>Adjuntar</div></div>
   </div>
  </div>
  <div style="display:flex;align-items:center;gap:10px;padding:12px 18px;border-top:1px solid #EEF0F5"><button class="lnk"><i:refresh:13> Calcular de nuevo</button><span style="flex:1"></span><button class="btn o"><i:banco:15>Registrar pago</button><button class="btn p" style="padding:11px 20px"><i:check:15>Marcar como presentada</button></div>
 </section>
</div>''',emp=emp('Redes del Valle, S.A.'),ay=AYUDA('qué se declara, cuándo y con qué formulario'),obh=obh,sth=sth,dlh=dlh,
 k1=kt('nota','wa','IVA de noviembre a hoy','Q 23,410','débito Q 31,902 · crédito Q 8,492'),
 k2=kt('calc','nf','ISR estimado del año','Q 74,300','25 % sobre la utilidad · a hoy'),
 k3=kt('alerta','er','Vencidas','1','retenciones de ISR de octubre'))
cbuild('ContaFiscal.dc.html','Finanzas · Fiscal: calendario y declaración (calcular → revisar → presentar → pagar)',shell('fin',['Finanzas','Fiscal'],inner),LOG0,900)

# ---------- FEL y libros legales ----------
D=[('cola','FACT','A-10241','Comercial El Roble, S.A.','NIT 3318820-1','1,290.00','En contingencia','wa','reloj','Se enviará al volver el certificador','09:22'),
('cola','FACT','A-10240','Rosa Ixcot','CF','215.00','En contingencia','wa','reloj','Se enviará al volver el certificador','09:19'),
('rech','FACT','A-10236','Hotel Vista Real','NIT 771234-K','2,150.00','Rechazado','er','x','NIT del receptor inválido · corrige el NIT en la ficha','08:50'),
('rech','NCRE','A-00413','Luis Morales','NIT 5567123-9','75.00','Rechazado','er','x','La factura de origen tiene más de 2 meses','ayer'),
('cola','FACT','A-10239','Julio Tax','CUI 2456 78901 0101','325.00','Reintentando','nf','refresh','Error temporal · intento 3 de 8 · siguiente en 12 min','09:05'),
('anul','FACT','A-10102','Ferretería La Paz','NIT 992817-3','430.00','Anulación pendiente','wa','reloj','Esperando confirmación del certificador','ayer'),
('cert','FACT','A-10238','María López Tzoc','NIT 4471902-5','215.00','Certificado','ok','check','Autorización 6F2A-…-91C4','08:41'),
('cert','FACT','A-10237','Pedro Ajú','CF','215.00','Certificado','ok','check','Autorización 1B77-…-0D2E','08:40'),
('cert','FPEQ','B-00871','Tienda Mi Fortuna','NIT 1204551-8','180.00','Certificado','ok','check','TeleSur · Autorización 88C1-…-AA07','08:12')]
data=[dict(g=g,tipo=t,num=n,cli=c,rec=r,tot=m,est=e,cls=cl,svg=s(i,13),det=d,hora=h,acc={'rech':'Corregir y reintentar','cola':'','anul':'','cert':'XML · PDF'}[g],av={'rech':'inline-flex','cola':'none','anul':'none','cert':'none'}[g],lv='inline' if g=='cert' else 'none',dc='color:#B91C1C' if g=='rech' else '') for g,t,n,c,r,m,e,cl,i,d,h in D]
LB=[('Diario','libro','Folio 412','588 habilitados','Septiembre emitido · 1 oct','ok'),('Mayor','lista','Folio 233','767 habilitados','Septiembre emitido · 1 oct','ok'),('Ventas y servicios prestados','fac','Folio 96','104 habilitados','Septiembre emitido · 1 oct','ok'),('Compras y servicios recibidos','camion','Folio 41','9 habilitados','Quedan pocos folios','wa'),('Inventarios','inv','—','sin habilitar','Se emite al 31 dic','ne'),('Estados financieros','doc','—','sin habilitar','Se emite al cerrar el año','ne')]
lbh=''.join(T('<div class="card" style="padding:14px;display:flex;flex-direction:column;gap:8px"><div style="display:flex;align-items:center;gap:10px"><span class="ico <<c>>"><i:<<i>>:18></span><div style="flex:1;min-width:0"><b class="el" style="display:block;font-size:14px"><<n>></b><div class="m2"><<e>></div></div></div><div style="display:flex;gap:8px"><div class="kpi" style="flex:1;padding:8px 10px"><div class="l">Siguiente</div><b style="font-size:15px"><<f>></b></div><div class="kpi" style="flex:1;padding:8px 10px"><div class="l">Folios</div><b style="font-size:15px"><<h>></b></div></div><div style="display:flex;gap:6px"><button class="btn o" style="flex:1;justify-content:center;padding:7px 10px"><i:ojo:14>Vista previa</button><button class="btn <<bp>>" style="flex:1;justify-content:center;padding:7px 10px;<<bs>>"><i:sello:14>Emitir octubre</button></div></div>',c='nf' if c=='ok' else c,i=i,n=n,e=e,f=f,h=h.replace(' habilitados','').replace('sin habilitar','—'),bp='o',bs='color:#94A3B8;cursor:not-allowed') for n,i,f,h,e,c in LB)
inner2=T('''<div style="display:flex;align-items:center;gap:10px;flex:0 0 auto">
 <div><h1 class="h1">Facturación electrónica y libros legales</h1><div class="sub">3 empresas · certificador INFILE · lo que la SAT y el Registro Mercantil pueden pedirte</div></div>
 <span style="flex:1"></span><<emp>><<ay>>
</div>
<div class="av2 er" style="flex:0 0 auto;display:{{dfel}}"><i:alerta:18><div style="flex:1"><b>Conecta Occidente está en contingencia desde las 09:14.</b> El certificador no responde. Se sigue cobrando: las facturas salen con número de acceso y se certifican solas al volver. 12 DTE en cola.</div><button class="btn o" style="padding:7px 14px">Levantar contingencia</button></div>
<section class="isla" style="flex:1;min-height:0;border-radius:20px;display:flex;flex-direction:column;overflow:hidden">
 <div style="display:flex;align-items:center;gap:10px;padding:12px 18px;flex-wrap:wrap">
  <div class="segb"><button class="ts {{t1}}" onClick="{{irFel}}"><i:rayo:14>Documentos</button><button class="ts {{t2}}" onClick="{{irLib}}"><i:libro:14>Libros legales</button></div>
  <span style="width:8px"></span>
  <div style="display:{{dfel}};gap:6px"><sc-for list="{{chips}}" as="c"><span class="fc {{c.cls}}" onClick="{{c.ir}}">{{c.nom}}<span class="c">{{c.n}}</span></span></sc-for></div>
  <span style="flex:1"></span>
  <span class="busca" style="width:230px;display:{{dfel}}"><i:bus:15>Número, NIT o cliente…</span>
  <button class="btn o" style="display:{{dlib2}}"><i:mas1:15>Registrar folios habilitados</button>
 </div>
 <div style="flex:1;min-height:0;display:{{dfel}};flex-direction:column">
  <div class="lh" style="grid-template-columns:120px minmax(0,1.1fr) 100px 170px minmax(0,1.5fr) 70px 150px"><span>Documento</span><span>Receptor</span><span style="text-align:right">Total (Q)</span><span>Estado</span><span>Detalle</span><span>Hora</span><span></span></div>
  <div class="sc" style="flex:1"><sc-for list="{{filas}}" as="d"><div class="lr" style="grid-template-columns:120px minmax(0,1.1fr) 100px 170px minmax(0,1.5fr) 70px 150px">
   <div><span class="b ne">{{d.tipo}}</span> <span class="mono" style="font-size:12.5px">{{d.num}}</span></div>
   <div><b class="el" style="display:block">{{d.cli}}</b><div class="m2">{{d.rec}}</div></div>
   <b class="num r">{{d.tot}}</b>
   <div><span class="b {{d.cls}}">{{d.svg}}{{d.est}}</span></div>
   <span class="m2 el" style="{{d.dc}}">{{d.det}}</span>
   <span class="m2">{{d.hora}}</span>
   <div style="display:flex;justify-content:flex-end"><button class="btn o" style="padding:6px 12px;display:{{d.av}}">{{d.acc}}</button><button class="lnk" style="display:{{d.lv}};font-size:12px">{{d.acc}}</button></div>
  </div></sc-for></div>
  <div style="display:flex;align-items:center;gap:8px;padding:10px 18px;border-top:1px solid #F1F5F9;font-size:12px;color:#64748B"><i:info:14>Un rechazado no se reintenta solo: se corrige el dato y se crea un documento nuevo. Los avisos de cobro se certifican cuando el cliente paga.<span style="flex:1"></span>{{cuenta}}</div>
 </div>
 <div style="flex:1;min-height:0;display:{{dlib}};flex-direction:column">
  <div class="sc" style="flex:1;padding:4px 18px 16px;display:flex;flex-direction:column;gap:12px">
   <div class="av2 nf"><i:info:16><div>Un libro solo se emite con folio de un mes <b>cerrado y bloqueado</b>. Octubre aún no está cerrado: mientras tanto puedes ver el borrador sin folio.</div><button class="btn o" style="padding:7px 14px">Ir a cierres</button></div>
   <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px"><<lbh>></div>
   <div style="border:1px solid #EEF0F5;border-radius:14px;overflow:hidden"><table class="tb"><tr><th>Últimas emisiones</th><th>Periodo</th><th>Folios</th><th>Archivo</th><th>Huella del archivo</th><th>Emitió</th></tr>
    <tr class="hv"><td><b>Diario</b></td><td>Septiembre 2026</td><td class="num">371–411</td><td><i:pdf:14> PDF</td><td class="mono" style="font-size:12px">a81c…77f0</td><td class="m2">M. Méndez · 1 oct</td></tr>
    <tr class="hv"><td><b>Ventas y servicios prestados</b></td><td>Septiembre 2026</td><td class="num">88–95</td><td><i:excel:14> Excel</td><td class="mono" style="font-size:12px">03be…c219</td><td class="m2">M. Méndez · 1 oct</td></tr>
    <tr class="hv"><td><b>Mayor</b> <span class="b ne">reimpresión</span></td><td>Agosto 2026</td><td class="num">180–206</td><td><i:pdf:14> PDF</td><td class="mono" style="font-size:12px">5d20…e4a8</td><td class="m2">A. Castillo · 14 sep</td></tr></table></div>
  </div>
 </div>
</section>''',emp=emp(),ay=AYUDA('estados de un documento electrónico y cómo emitir un libro'),lbh=lbh)
logic2='''class Component extends DCLogic {
renderVals() {
const ds = __D__;
const st = this.state || {}; const lib = st.t === 'libros'; const f = st.f || 'todos';
const filas = ds.filter((d) => f === 'todos' || d.g === f);
const n = (g) => ds.filter((d) => d.g === g).length;
const chips = [['todos', 'Todos', 38], ['cola', 'En cola', 12], ['rech', 'Rechazados', 2], ['anul', 'Por anular', 1], ['cert', 'Certificados hoy', 23]].map(([id, nom, c]) => ({ id, nom, n: c, cls: id === f ? 'on' : '', ir: () => this.setState({ f: id }) }));
return { filas, chips, cuenta: filas.length + ' de 38 de hoy', t1: lib ? '' : 'on', t2: lib ? 'on' : '', dfel: lib ? 'none' : 'flex', dlib: lib ? 'flex' : 'none', dlib2: lib ? 'inline-flex' : 'none', irFel: () => this.setState({ t: 'fel' }), irLib: () => this.setState({ t: 'libros' }) };
}
}'''.replace('__D__',JS(data))
cbuild('ContaFel.dc.html','Finanzas · FEL (cola, contingencia, rechazados) y libros legales con folio',shell('fin',['Finanzas','Fiscal','Facturación electrónica y libros'],inner2),logic2,900)
