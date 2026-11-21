exec(open('/tmp/claude-0/-home-user/59389ade-3278-540a-8050-19c26767da8e/scratchpad/gen/conta_base.py').read())
MES=['dic','ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov']
FAC=[241.2,246.8,249.1,255.4,259.0,263.7,268.2,272.9,279.5,284.1,290.3,296.5]
COB=[229.6,236.1,235.9,243.0,247.8,249.2,256.4,258.8,266.0,268.3,275.1,231.3]
ant=[65230,38900,21450,12870,11400]
antl=['Por vencer','0–30 días','31–60 días','61–90 días','Más de 90 días']
antrows=''.join(f'<tr><td><span class="sw" style="background:{c}"></span>&nbsp; {l}</td><td class="r">Q {fmt(v)}</td><td class="r" style="color:#64748B">{v/sum(ant)*100:.0f} %</td></tr>' for l,v,c in zip(antl,ant,ANT))
SAL=[318,322,331,327,340,352,349,361,372,366,381,395,412]
imp=[('IVA de octubre','SAT-2237 · revisada, falta presentar','Q 21,924','vence 30 nov · 9 días','wa'),
     ('ISR trimestral jul–sep','SAT-1361 · presentada y pagada','Q 18,300','pagada 28 oct','ok'),
     ('ISO 4.º trimestre','SAT-1608 · estimado a hoy','Q 7,410','vence 31 ene','ne'),
     ('Retenciones de ISR','contador · sin calcular','Q 2,180','vence 10 dic','ne')]
improws=''.join(T('<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid #F1F5F9"><span class="ci2 <<c>>"><i:<<i>>:14></span><div style="min-width:0;flex:1"><b style="font-size:13px"><<n>></b><div class="m2 el"><<s>></div></div><div style="text-align:right"><b class="num" style="font-size:13px"><<m>></b><div class="m2" style="<<st>>"><<v>></div></div></div>',c=c,i={'wa':'reloj','ok':'check','ne':'cal'}[c],n=n,s=s_,m=m,v=v,st='color:#B45309;font-weight:600' if c=='wa' else '') for n,s_,m,v,c in imp)
emps=[('Redes del Valle, S.A.','Utilidades · FEL al cobrar','1,010','221,900',80,'61,200','ok','Al día'),
      ('Conecta Occidente, S.A.','Opcional simplificado · FEL al cobrar','231','47,300',71,'19,900','er','Contingencia FEL'),
      ('TeleSur','Pequeño contribuyente · 82 % del límite','54','9,200',76,'3,520','wa','Cerca del límite')]
emprows=''.join(T('<tr class="hv"><td><b><<n>></b><div class="m2"><<r>></div></td><td class="r"><<s>></td><td class="r">Q <<m>></td><td style="width:150px"><div style="display:flex;align-items:center;gap:8px"><span class="bar" style="flex:1"><i style="width:<<p>>%;background:#4F46E5"></i></span><b class="num" style="width:36px;text-align:right"><<p>> %</b></div></td><td class="r">Q <<v>></td><td><span class="b <<c>>"><span class="dot" style="background:currentColor"></span><<e>></span></td></tr>',n=n,r=r,s=s_,m=m,p=p,v=v,c=c,e=e) for n,r,s_,m,p,v,c,e in emps)
inner=T('''<div style="display:flex;align-items:center;gap:10px;flex:0 0 auto">
 <div><h1 class="h1">Panel financiero</h1><div class="sub">Consolidado de 3 empresas · cifras al 21 nov 2026, 10:42 · se actualiza con cada cobro</div></div>
 <span style="flex:1"></span>
 <<emp>><<per>><<ay>>
 <button class="btn o"><i:desc:16>Resumen del mes</button>
</div>
<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;flex:0 0 auto">
 <div class="av2 ok"><i:sello:18><div style="flex:1;min-width:0"><b>Libro íntegro</b><div class="el" style="font-size:12px">Cadena verificada hasta el sello 48,211 · hace 1 min</div></div></div>
 <div class="av2 wa"><i:candado:18><div style="flex:1;min-width:0"><b>Octubre sin cerrar</b><div class="el" style="font-size:12px">2 empresas · 3 verificaciones con anomalía</div></div><button class="lnk">Cerrar mes</button></div>
 <div class="av2 er"><i:alerta:18><div style="flex:1;min-width:0"><b>Contingencia FEL activa</b><div class="el" style="font-size:12px">Conecta Occidente desde 09:14 · 12 DTE en cola</div></div><button class="lnk" style="color:#991B1B">Ver</button></div>
 <div class="av2 wa"><i:reloj:18><div style="flex:1;min-width:0"><b>IVA de octubre vence en 9 días</b><div class="el" style="font-size:12px">Q 21,924 · revisada, falta presentar</div></div><button class="lnk">Abrir</button></div>
</div>
<div style="display:flex;gap:10px;flex:0 0 auto">
 <<k1>><<k2>><<k3>><<k4>><<k5>><<k6>>
</div>
<div style="display:grid;grid-template-columns:minmax(0,1.45fr) minmax(0,1fr) minmax(0,1fr);gap:10px;flex:1.15;min-height:0">
 <section class="pan">
  <div style="display:flex;align-items:flex-start;gap:10px"><div style="flex:1"><h2 class="ct">En noviembre va cobrado el 78 % de lo facturado; faltan Q 65,230</h2><div class="cs">Facturado y cobrado por mes de factura · miles de Q · últimos 12 meses</div></div>
   <div class="segb" style="padding:3px"><button class="ts {{g1}}" onClick="{{verG}}" style="padding:6px 10px"><i:rep:14>Gráfica</button><button class="ts {{t1}}" onClick="{{verT}}" style="padding:6px 10px"><i:lista:14>Tabla</button></div></div>
  <div style="display:flex;gap:14px;margin:8px 0 4px"><span class="lg"><i style="background:#4F46E5"></i>Facturado</span><span class="lg"><i style="background:#0891B2"></i>Cobrado</span><span class="m2" style="margin-left:auto">Noviembre aún está en curso</span></div>
  <div style="flex:1;min-height:0;display:{{dG}}"><<g1>></div>
  <div class="sc" style="flex:1;display:{{dT}}"><table class="tb"><tr><th>Mes</th><th class="r">Facturado</th><th class="r">Cobrado</th><th class="r">% cobrado</th></tr><<trows>></table></div>
 </section>
 <section class="pan">
  <h2 class="ct">Q 84,620 vencidos; lo de más de 60 días es Q 24,270</h2><div class="cs">Morosidad por antigüedad · 412 facturas de 287 clientes</div>
  <div style="margin:12px 0 6px"><<hb>></div>
  <div class="sc" style="flex:1"><table class="tb"><<antrows>><tr class="tot"><td>Total por cobrar</td><td class="r">Q 149,850</td><td class="r">100 %</td></tr></table></div>
  <div style="display:flex;align-items:center;gap:8px;padding-top:8px"><span class="m2" style="flex:1">Cuadra con la cuenta 1.1.03 del libro <i:check:13:#16A34A></span><button class="lnk">Ver cartera <i:der:13></button></div>
 </section>
 <section class="pan">
  <div style="display:flex;align-items:center"><div style="flex:1"><h2 class="ct">Impuestos por pagar: Q 31,514</h2><div class="cs">Borradores calculados; Argos no presenta nada a la SAT</div></div></div>
  <div style="flex:1;min-height:0;margin-top:6px" class="sc"><<improws>></div>
  <div style="display:flex;align-items:center;gap:8px;padding-top:8px;border-top:1px solid #F1F5F9"><span class="m2" style="flex:1">IVA de noviembre a hoy: Q 23,410</span><button class="lnk">Calendario fiscal <i:der:13></button></div>
 </section>
</div>
<div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2.05fr);gap:10px;flex:1;min-height:0">
 <section class="pan">
  <h2 class="ct">El efectivo subió Q 31 mil en tres semanas</h2><div class="cs">Saldo en cajas y bancos por semana · miles de Q</div>
  <div style="flex:1;min-height:0;margin-top:6px"><<g2>></div>
  <div style="display:flex;gap:14px;font-size:12px;color:#475569;padding-top:6px;border-top:1px solid #F1F5F9"><span>Entró <b class="num" style="color:#0F172A">Q 231,250</b></span><span>Salió <b class="num" style="color:#0F172A">Q 148,900</b></span><span style="margin-left:auto">En tránsito <b class="num" style="color:#0F172A">Q 18,400</b></span></div>
 </section>
 <section class="pan" style="padding:14px 0 0">
  <div style="display:flex;align-items:center;gap:10px;padding:0 18px 10px"><div style="flex:1"><h2 class="ct">Conecta Occidente cobra 9 puntos menos que Redes del Valle</h2><div class="cs">Comparación por empresa · noviembre · el total del grupo es solo informativo: cada NIT lleva su libro</div></div><span class="b nf"><i:candado:12>Solo con alcance global</span></div>
  <div class="sc" style="flex:1"><table class="tb"><tr><th>Empresa</th><th class="r">Servicios</th><th class="r">Ingreso mensual</th><th>Cobranza</th><th class="r">Vencido</th><th>Estado</th></tr><<emprows>>
  <tr class="tot"><td>Grupo (informativo)</td><td class="r">1,295</td><td class="r">Q 278,400</td><td><div style="display:flex;align-items:center;gap:8px"><span class="bar" style="flex:1"><i style="width:78%;background:#4F46E5"></i></span><span class="num" style="width:36px;text-align:right">78 %</span></div></td><td class="r">Q 84,620</td><td></td></tr></table></div>
 </section>
</div>''',emp=emp(),per=per(),ay=AYUDA('cómo leer el panel financiero'),
 k1=kt('tend','nf','Ingreso recurrente','Q 278,400','al mes · vs. octubre','+2.1 %','up',True),
 k2=kt('cob','ok','Cobrado en noviembre','Q 231,250','de Q 296,480','78 %','eq'),
 k3=kt('alerta','er','Cartera vencida','Q 84,620','vs. octubre','+6.4 %','dn'),
 k4=kt('banco','cy','Efectivo disponible','Q 412,300','en 4 bancos y 3 cajas'),
 k5=kt('usuarios','nf','Bajas del mes','1.4 %','18 bajas · 31 altas','−0.3 pt','up',True),
 k6=kt('pastel','wa','Por servicio','Q 215','al mes','+Q 3','up',True),
 g1=barras2(MES,FAC,COB,640,230,ymax=320),hb=hbar(ant,ANT),antrows=antrows,improws=improws,emprows=emprows,
 trows=''.join(f'<tr><td>{m} {"2025" if i==0 else "2026"}</td><td class="r">Q {f*1000:,.0f}</td><td class="r">Q {c*1000:,.0f}</td><td class="r">{c/f*100:.0f} %</td></tr>' for i,(m,f,c) in enumerate(zip(MES,FAC,COB))),
 g2=linea(['1 sep','','','','29 sep','','','','27 oct','','','','17 nov'],SAL,400,185,ymin=300,ymax=430,ticks=[300,350,400],ult='Q 412 mil'))
logic='''class Component extends DCLogic {
renderVals() {
const st = this.state || {};
const t = st.v === 'tabla';
return { g1: t ? '' : 'on', t1: t ? 'on' : '', dG: t ? 'none' : 'block', dT: t ? 'block' : 'none', verG: () => this.setState({ v: 'grafica' }), verT: () => this.setState({ v: 'tabla' }) };
}
}'''
cbuild('ContaPanel.dc.html','Finanzas · Panel financiero del dueño',shell('fin',['Finanzas','Panel financiero'],inner),logic,1000)
