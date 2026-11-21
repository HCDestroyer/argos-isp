exec(open('/tmp/claude-0/-home-user/59389ade-3278-540a-8050-19c26767da8e/scratchpad/gen/conta_base.py').read())
# ---------- Catálogo ----------
R=[ # cat, nombre, descripción, ícono, fav, nuevo, uso
('cob','Cartera vencida por antigüedad','Cuánto te deben y desde cuándo, por cliente, zona, router o plan','reloj',1,0,'hoy'),
('cob','Facturado contra cobrado','Qué parte de cada mes ya entró y cuánto falta','rep',1,0,'hoy'),
('cob','Cobranza diaria','Lo cobrado por día, método y caja, con anulados','cob',1,0,'ayer'),
('cob','Promesas de pago','Creadas, cumplidas e incumplidas, y su tasa de cumplimiento','mano',0,0,'hace 3 días'),
('cob','Cobranza por cajero','Lo que cobró cada persona, sus anulaciones y diferencias de caja','user',0,1,''),
('cob','Cortes y reconexiones','Servicios cortados, reconectados y días que estuvieron sin pagar','corte',0,1,''),
('ing','Ingreso recurrente del mes','De dónde viene el cambio: altas, bajas, cambios de plan y descuentos','tend',1,1,''),
('ing','Ingresos por método de pago','Efectivo, tarjeta, transferencia y depósito, con comisión y neto','tarjeta',0,0,'hace 2 días'),
('ing','Altas y bajas','Altas, bajas, suspensiones y reactivaciones por mes','usuarios',0,0,'hace 1 sem'),
('ing','Bajas por motivo','Por qué se van los clientes, por zona, plan y antigüedad','baja',0,1,''),
('ing','Ingreso por servicio','Promedio por servicio, por plan y por zona','pastel',0,1,''),
('ing','Bonificaciones','Lo que se regaló: por motivo, origen y mes','ticket',0,0,'hace 2 sem'),
('ren','Rentabilidad por zona','Ingresos menos gastos y depreciación de cada zona','mapa',0,1,''),
('ren','Rentabilidad por plan','Qué planes dejan más por cada quetzal de ancho de banda','capas',0,1,''),
('ren','Rentabilidad por router','Ingreso de cada nodo contra lo que cuesta mantenerlo','router',0,1,''),
('caj','Cierres de caja','Esperado, contado y diferencia de cada turno','caja',0,0,'ayer'),
('caj','Flujo de efectivo','Lo que entró y salió, y cómo cambia el saldo','onda',1,1,''),
('caj','Conciliación bancaria','Libro contra estado de cuenta y partidas en tránsito','banco',0,0,'hace 4 días'),
('caj','Cobros por liquidar','Lo que deben depositar las pasarelas y agentes, por antigüedad','refresh',0,0,'hace 1 sem'),
('con','Estado de resultados','Ingresos menos gastos del periodo, por empresa','doc',1,0,'hace 2 días'),
('con','Balance general','Activo, pasivo y patrimonio a una fecha','libro',0,0,'hace 2 días'),
('con','Balance de comprobación','Saldo inicial, debe, haber y saldo final por cuenta','calc',0,0,'hace 1 sem'),
('con','Egresos por categoría','En qué se gasta, por mes','desc',0,0,'hace 5 días'),
('con','Cuentas por pagar','Lo que se debe a proveedores, por antigüedad','camion',0,0,'hace 3 días'),
('con','Activos y depreciación','Costo, depreciación acumulada y valor en libros','torre',0,0,'hace 3 sem'),
('fis','IVA del periodo','Débito, crédito y saldo, cuadrado con el libro','nota',0,0,'hace 2 días'),
('fis','Retenciones y constancias','Recibidas de clientes y emitidas a proveedores','firma',0,0,'hace 2 sem'),
('fis','Comparador de regímenes','Cuánto ISR pagarías en cada régimen con tus cifras','tubo',0,0,'hace 1 mes'),
]
cats=[('fav','Favoritos','estrella'),('todos','Todos','grupo'),('cob','Cobranza y cartera','cob'),('ing','Ingresos y clientes','tend'),('ren','Rentabilidad','pastel'),('caj','Caja y bancos','banco'),('con','Contabilidad','libro'),('fis','Fiscal','nota')]
catn={k:n for k,n,_ in cats}
data=[dict(cat=c,catn=catn[c],nom=n,des=d,ico=i,fav=f,nuevo=nv,uso=u,svg=s(i,18)) for c,n,d,i,f,nv,u in R]
envios=[('Cartera vencida por zona','Lunes 7:00 · Excel','gerencia@redesdelvalle.gt y 1 más'),('Cobranza diaria','Cada día 19:30 · PDF','Ana Castillo (dueña)'),('Estado de resultados','Día 5 de cada mes · PDF','contador@despachomm.gt')]
envh=''.join(T('<div style="display:flex;gap:10px;align-items:flex-start;padding:10px 0;border-top:1px solid #F1F5F9"><span class="ico nf" style="width:32px;height:32px;border-radius:10px"><i:enviar:15></span><div style="min-width:0;flex:1"><b style="font-size:13px" class="el"><<a>></b><div class="m2"><<b>></div><div class="m2 el"><<c>></div></div><button class="ib" title="Editar envío"><i:mas:16></button></div>',a=a,b=b,c=c) for a,b,c in envios)
inner=T('''<div style="display:flex;align-items:center;gap:10px;flex:0 0 auto">
 <div><h1 class="h1">Reportes</h1><div class="sub">28 reportes · todos se exportan a Excel y PDF y respetan la empresa activa</div></div>
 <span style="flex:1"></span><<emp>><<ay>>
</div>
<div style="display:grid;grid-template-columns:220px minmax(0,1fr) 310px;gap:10px;flex:1;min-height:0">
 <section class="pan" style="padding:12px 10px;gap:2px">
  <sc-for list="{{cats}}" as="c"><button class="cat {{c.cls}}" onClick="{{c.ir}}"><span class="ti ti-{{c.ico}}"></span>{{c.nom}}<span class="c">{{c.n}}</span></button></sc-for>
  <div style="margin-top:auto;padding:10px;border-radius:12px;background:#F8FAFC;font-size:12px;color:#64748B;line-height:1.45"><i:info:13> Cada número de un reporte abre su detalle: de un total llegas a la factura y a su asiento.</div>
 </section>
 <section class="isla" style="border-radius:20px;display:flex;flex-direction:column;overflow:hidden;min-height:0">
  <div style="display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid #EEF0F5">
   <span class="busca" style="flex:1;border-color:#4F46E5;box-shadow:0 0 0 3px rgba(79,70,229,.12)"><i:bus:15>Buscar un reporte: «morosos», «IVA», «caja»…</span>
   <span class="m2">{{cuenta}}</span>
  </div>
  <div class="sc" style="flex:1">
   <sc-for list="{{filas}}" as="r"><div class="rp">
    <span class="fav {{r.fc}}" title="Favorito"><i:estrella:17></span>
    <span class="ico nf" style="width:36px;height:36px">{{r.svg}}</span>
    <div style="min-width:0;flex:1"><b style="font-size:14px">{{r.nom}}</b> <span class="nuevo" style="display:{{r.nv}}">nuevo</span><div class="m2 el">{{r.des}}</div></div>
    <span class="b ne" style="display:{{r.cv}}">{{r.catn}}</span>
    <span class="m2" style="width:86px;text-align:right">{{r.uso}}</span>
    <i:der:16:#94A3B8>
   </div></sc-for>
  </div>
 </section>
 <div style="display:flex;flex-direction:column;gap:10px;min-height:0">
  <section class="pan" style="flex:0 0 auto">
   <div style="display:flex;align-items:center"><h2 class="ct" style="flex:1">Envíos programados</h2><span class="nuevo">nuevo</span></div><div class="cs">Llegan por correo como archivo; nunca con datos de otra empresa</div>
   <div style="margin-top:8px"><<envh>></div>
   <button class="btn o" style="margin-top:8px;justify-content:center"><i:mas1:15>Programar un envío</button>
  </section>
  <section class="pan" style="flex:1">
   <h2 class="ct">Descargas recientes</h2><div class="cs">Quedan en la bitácora: quién exportó qué</div>
   <div class="sc" style="flex:1;margin-top:6px">
    <div class="kv"><span><i:excel:14> cartera-vencida-2026-11-21.xlsx</span><span class="m2">10:12</span></div>
    <div class="kv"><span><i:pdf:14> estado-resultados-oct.pdf</span><span class="m2">ayer</span></div>
    <div class="kv"><span><i:excel:14> cobranza-diaria-nov.xlsx</span><span class="m2">ayer</span></div>
    <div class="kv"><span><i:pdf:14> libro-ventas-oct-borrador.pdf</span><span class="m2">19 nov</span></div>
   </div>
  </section>
 </div>
</div>''',emp=emp('Redes del Valle, S.A.'),ay=AYUDA('qué reporte usar para cada pregunta'),envh=envh)
logic='''class Component extends DCLogic {
renderVals() {
const rs = __D__; const cs = __C__;
const st = this.state || {}; const f = st.c || 'todos';
const ok = (r) => f === 'todos' ? true : f === 'fav' ? r.fav : r.cat === f;
const filas = rs.filter(ok).map((r) => ({ ...r, fc: r.fav ? 'on' : '', nv: r.nuevo ? 'inline-flex' : 'none', cv: (f === 'fav' || f === 'todos') ? 'inline-flex' : 'none', uso: r.uso || '—' }));
const cats = cs.map(([id, nom, ico]) => ({ id, nom, ico, n: id === 'todos' ? rs.length : id === 'fav' ? rs.filter((r) => r.fav).length : rs.filter((r) => r.cat === id).length, cls: id === f ? 'on' : '', ir: () => this.setState({ c: id }) }));
return { filas, cats, cuenta: filas.length + ' de ' + rs.length };
}
}'''.replace('__D__',JS(data)).replace('__C__',JS([list(c) for c in cats]))
build('ContaReportes.dc.html','Reportes · Catálogo con buscador y favoritos',shell('rep',['Reportes','Catálogo'],inner),logic,900,CSSK+mask([c[2] for c in cats]))

# ---------- Visor ----------
Z=[('Norte · Chimaltenango',131,14900,12400,7300,4870,4200),('Sur · Escuintla',104,11200,9800,6100,3440,3000),('Centro',96,24600,9300,4250,2130,1800),('Torre San Juan',44,7930,4100,2200,1350,1300),('Zona 4',27,5100,2400,1200,760,700),('Sin zona',10,1500,900,400,320,400)]
mx=max(sum(z[2:]) for z in Z)
def zrow(z):
    venc=sum(z[3:]);tot=sum(z[2:])
    segs=''.join(f'<i style="width:{v/mx*100:.2f}%;background:{c}" title="{l}: Q {v:,.0f}"></i>' for v,c,l in zip(z[2:],ANT,['Por vencer','0–30','31–60','61–90','Más de 90']))
    return f'<div style="display:grid;grid-template-columns:150px minmax(0,1fr) 78px;gap:10px;align-items:center;font-size:12.5px"><span class="el" style="color:#334155;font-weight:600">{z[0]}</span><div class="hbar" style="height:16px;border-radius:4px;overflow:visible">{segs}</div><b class="num" style="text-align:right">Q {venc:,.0f}</b></div>'
chart=''.join(zrow(z) for z in Z)
trow=''.join(f'<tr class="hv"><td><b>{z[0]}</b></td><td class="r">{z[1]}</td>'+''.join(f'<td class="r">{v:,.0f}</td>' for v in z[2:])+f'<td class="r"><b>{sum(z[3:]):,.0f}</b></td><td class="r">{sum(z[2:]):,.0f}</td><td class="r" style="color:#64748B">{sum(z[3:])/84620*100:.0f} %</td></tr>' for z in Z)
leg=''.join(f'<span class="lg"><i style="background:{c}"></i>{l}</span>' for c,l in zip(ANT,['Por vencer','0–30 días','31–60','61–90','Más de 90']))
fil=lambda ico,l,v,on=False:T('<span class="selp" style="<<st>>"><i:<<ico>>:14><span style="color:#64748B;font-weight:500"><<l>></span> <<v>><i:ab:13></span>',ico=ico,l=l,v=v,st='border-color:#4F46E5;color:#3730A3;background:#EEF2FF' if on else '')
inner2=T('''<div style="display:flex;align-items:center;gap:10px;flex:0 0 auto">
 <span class="fav on" title="Quitar de favoritos"><i:estrella:22></span>
 <div><h1 class="h1">Cartera vencida por antigüedad</h1><div class="sub">Al 21 nov 2026 · 412 facturas de 287 clientes · cuadra con la cuenta 1.1.03 <i:check:13:#16A34A></div></div>
 <span style="flex:1"></span>
 <<ay>>
 <button class="btn o" onClick="{{abrir}}"><i:enviar:15>Programar envío</button>
 <button class="btn o"><i:pdf:15>PDF</button>
 <button class="btn p"><i:excel:15>Excel</button>
</div>
<section class="isla" style="flex:1;min-height:0;border-radius:20px;display:flex;flex-direction:column;overflow:hidden">
 <div style="display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid #EEF0F5;flex-wrap:wrap">
  <<f1>><<f2>><<f3>><<f4>><<f5>><<f6>>
  <span style="flex:1"></span><button class="lnk"><i:girar:13> Limpiar</button><button class="lnk" style="margin-left:8px"><i:estrella:13> Guardar esta vista</button>
 </div>
 <div class="sc" style="flex:1;padding:16px 18px;display:flex;flex-direction:column;gap:14px">
  <div style="display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:18px;flex:0 0 auto">
   <div>
    <h2 class="ct">Norte y Sur concentran el 60 % de lo vencido</h2><div class="cs">Saldo por cobrar por zona, del más vencido al menos · el número a la derecha es el total vencido</div>
    <div style="display:flex;gap:14px;margin:10px 0 8px;flex-wrap:wrap"><<leg>></div>
    <div style="display:flex;flex-direction:column;gap:9px"><<chart>></div>
   </div>
   <div style="display:flex;flex-direction:column;gap:8px">
    <div class="kpi"><div class="l">Total vencido</div><b class="num">Q 84,620</b><span class="m2">56 % de lo pendiente</span></div>
    <div class="kpi"><div class="l">Más de 60 días</div><b class="num">Q 24,270</b><span class="m2">candidato a gestión de cobro o castigo</span></div>
    <div class="kpi"><div class="l">Con promesa activa</div><b class="num">Q 9,340</b><span class="m2">23 clientes · no se cortan</span></div>
   </div>
  </div>
  <div style="border:1px solid #EEF0F5;border-radius:14px;overflow:hidden;flex:0 0 auto">
   <table class="tb"><tr><th>Zona</th><th class="r">Facturas</th><th class="r">Por vencer</th><th class="r">0–30 días</th><th class="r">31–60</th><th class="r">61–90</th><th class="r">Más de 90</th><th class="r">Vencido</th><th class="r">Pendiente</th><th class="r">% del vencido</th></tr>
   <<trow>>
   <tr class="tot"><td>Total</td><td class="r">412</td><td class="r">65,230</td><td class="r">38,900</td><td class="r">21,450</td><td class="r">12,870</td><td class="r">11,400</td><td class="r">84,620</td><td class="r">149,850</td><td class="r">100 %</td></tr></table>
  </div>
  <div class="m2" style="display:flex;gap:6px;align-items:center"><i:info:13>Montos en quetzales. Toca una zona para ver sus clientes; toca un monto para ver las facturas.</div>
 </div>
</section>
<div style="display:{{dm}};position:absolute;inset:0;background:rgba(15,23,42,.35);z-index:8;align-items:center;justify-content:center">
 <div class="isla" style="width:480px;border-radius:22px;padding:22px;display:flex;flex-direction:column;gap:14px">
  <div style="display:flex;align-items:center;gap:10px"><span class="ico nf"><i:enviar:18></span><div style="flex:1"><b style="font-size:16px">Programar envío</b><div class="m2">Cartera vencida · por zona · Redes del Valle</div></div><button class="ib" onClick="{{cerrar}}"><i:cerrar:16></button></div>
  <div><div class="lb">Cada cuánto</div><div class="segb" style="display:flex"><button class="ts" style="flex:1;justify-content:center">Cada día</button><button class="ts on" style="flex:1;justify-content:center">Cada semana</button><button class="ts" style="flex:1;justify-content:center">Cada mes</button></div></div>
  <div class="g2"><div><div class="lb">Día</div><div class="in sel">Lunes</div></div><div><div class="lb">Hora</div><div class="in sel">7:00</div></div></div>
  <div><div class="lb">Para quién</div><div class="in" style="border-color:#4F46E5;box-shadow:0 0 0 3px rgba(79,70,229,.12);flex-wrap:wrap"><span class="b nf">Ana Castillo ✕</span><span class="b nf">gerencia@redesdelvalle.gt ✕</span></div><div class="ay">Solo personas con permiso para ver este reporte y esta empresa.</div></div>
  <div><div class="lb">Formato</div><div class="segb"><button class="ts on"><i:excel:14>Excel</button><button class="ts"><i:pdf:14>PDF</button></div></div>
  <div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn g" onClick="{{cerrar}}">Cancelar</button><button class="btn p"><i:check:15>Programar</button></div>
 </div>
</div>''',ay=AYUDA('cómo leer la cartera vencida'),leg=leg,chart=chart,trow=trow,
 f1=fil('cal','Corte','21 nov 2026'),f2=fil('edif','Empresa','Redes del Valle'),f3=fil('capas','Agrupar por','Zona',True),f4=fil('mapa','Zona','Todas'),f5=fil('router','Router','Todos'),f6=fil('gauge','Plan','Todos'))
logic2='''class Component extends DCLogic {
renderVals() {
const st = this.state || {};
return { dm: st.envio ? 'flex' : 'none', abrir: () => this.setState({ envio: true }), cerrar: () => this.setState({ envio: false }) };
}
}'''
cbuild('ContaReporteVisor.dc.html','Reportes · Visor: filtros, gráfica, tabla, exportar y programar',shell('rep',['Reportes','Cobranza y cartera','Cartera vencida por antigüedad'],inner2),logic2,900)
