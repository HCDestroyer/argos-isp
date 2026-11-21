exec(open('/tmp/claude-0/-home-user/59389ade-3278-540a-8050-19c26767da8e/scratchpad/gen/conta_base.py').read())
MES=['dic','ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov']
FAC=[241.2,246.8,249.1,255.4,259.0,263.7,268.2,272.9,279.5,284.1,290.3,296.5]
COB=[229.6,236.1,235.9,243.0,247.8,249.2,256.4,258.8,266.0,268.3,275.1,231.3]
ant=[38900,21450,12870,11400]
def mk(l,v,sub,d='',dc='up'):
    return f'<div class="kt" style="padding:11px 12px"><div class="kl">{l}</div><div class="kv" style="font-size:20px">{v}</div><div class="ks">{f"<span class=\'dl {dc}\'>{d}</span>" if d else ""}{sub}</div></div>'
nav=mnav('mas')
top=T('''<header style="display:flex;align-items:center;gap:10px;padding:14px 14px 8px;flex:0 0 auto"><div style="min-width:0;flex:1"><b style="font-size:19px;display:block">Finanzas</b><span class="m2">21 nov, 10:42 · 3 empresas</span></div><span class="selp" style="height:36px"><i:edif:14>Todas<i:ab:13></span><span class="f ci" style="width:38px;height:38px"><i:not:18><span class="pt" style="background:#DC2626"></span></span></header>''')
b1=T('''<div style="height:100%;display:flex;flex-direction:column"><<top>>
<div class="sc" style="flex:1;padding:4px 14px 14px;display:flex;flex-direction:column;gap:10px">
 <div class="nsh" style="display:flex;gap:8px;overflow:auto;margin:0 -14px;padding:0 14px;flex:0 0 auto">
  <div class="av2 er" style="width:250px"><i:alerta:16><div style="min-width:0"><b>Contingencia FEL</b><div class="el" style="font-size:12px">Conecta Occidente · 12 en cola</div></div></div>
  <div class="av2 wa" style="width:230px"><i:reloj:16><div style="min-width:0"><b>IVA vence en 9 días</b><div class="el" style="font-size:12px">Q 21,924 · falta presentar</div></div></div>
  <div class="av2 wa" style="width:220px"><i:candado:16><div style="min-width:0"><b>Octubre sin cerrar</b><div class="el" style="font-size:12px">3 anomalías</div></div></div>
 </div>
 <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;flex:0 0 auto"><<k1>><<k2>><<k3>><<k4>></div>
 <section class="pan" style="flex:0 0 auto;padding:14px">
  <h2 class="ct" style="font-size:14px">Va cobrado el 78 % de noviembre; faltan Q 65,230</h2><div class="cs">Facturado y cobrado · miles de Q</div>
  <div style="display:flex;gap:12px;margin:8px 0 2px"><span class="lg"><i style="background:#4F46E5"></i>Facturado</span><span class="lg"><i style="background:#0891B2"></i>Cobrado</span></div>
  <div style="height:150px"><<g>></div>
 </section>
 <section class="pan" style="flex:0 0 auto;padding:14px">
  <div style="display:flex;align-items:center"><h2 class="ct" style="font-size:14px;flex:1">Q 84,620 vencidos</h2><button class="lnk">Ver cartera <i:der:13></button></div>
  <div style="margin:10px 0 8px"><<hb>></div>
  <<leg>>
 </section>
</div><<nav>></div>''',top=top,nav=nav,
 k1=mk('Cobrado en noviembre','Q 231,250','de Q 296,480','78 %','eq'),k2=mk('Efectivo disponible','Q 412,300','cajas y bancos'),k3=mk('Ingreso recurrente','Q 278,400','al mes','+2.1 %','up'),k4=mk('Impuestos por pagar','Q 31,514','IVA en 9 días'),
 g=barras2(MES[-6:],FAC[-6:],COB[-6:],330,150,ymax=320),hb=hbar(ant,ANT[1:],18),
 leg=''.join(f'<div class="kv" style="padding:7px 0;font-size:13px"><span style="display:flex;align-items:center;gap:8px;color:#334155"><span class="sw" style="background:{c}"></span>{l}</span><b class="num">Q {fmt(v)}</b></div>' for c,l,v in zip(ANT[1:],['0–30 días','31–60 días','61–90 días','Más de 90 días'],ant)))
cmbuild('ContaPanelMovil.dc.html','Teléfono · Panel financiero (consulta)',b1,LOG0)
emps=[('Redes del Valle, S.A.','1,010 servicios','Q 221,900',80,'Q 61,200','ok','Al día'),('Conecta Occidente, S.A.','231 servicios','Q 47,300',71,'Q 19,900','er','Contingencia FEL'),('TeleSur','54 servicios','Q 9,200',76,'Q 3,520','wa','82 % del límite')]
eh=''.join(T('<div style="padding:12px 14px;border-top:1px solid #F1F5F9"><div style="display:flex;align-items:center;gap:8px"><b style="flex:1;font-size:14px" class="el"><<n>></b><span class="b <<c>>" style="font-size:11px"><<e>></span></div><div class="m2"><<s>> · ingreso mensual <<m>></div><div style="display:flex;align-items:center;gap:8px;margin-top:6px"><span class="m2" style="width:62px">Cobranza</span><span class="bar" style="flex:1"><i style="width:<<p>>%"></i></span><b class="num" style="font-size:13px"><<p>> %</b></div><div class="m2" style="margin-top:3px">Vencido <b class="num" style="color:#0F172A"><<v>></b></div></div>',n=n,s=s_,m=m,p=p,v=v,c=c,e=e) for n,s_,m,p,v,c,e in emps)
imp=[('wa','reloj','IVA de octubre','vence 30 nov · falta presentar','Q 21,924'),('er','alerta','Retenciones de ISR · oct','venció el 13 nov','Q 2,180'),('ne','cal','ISO 4.º trimestre','vence 31 ene','Q 7,410')]
ih=''.join(T('<div style="display:flex;align-items:center;gap:10px;padding:11px 14px;border-top:1px solid #F1F5F9"><span class="ci2 <<c>>"><i:<<i>>:14></span><div style="flex:1;min-width:0"><b style="font-size:13.5px"><<n>></b><div class="m2"><<d>></div></div><b class="num" style="font-size:13.5px"><<m>></b></div>',c=c,i=i,n=n,d=d,m=m) for c,i,n,d,m in imp)
b2=T('''<div style="height:100%;display:flex;flex-direction:column"><<top>>
<div style="padding:0 14px 8px;flex:0 0 auto"><div class="segb" style="display:flex"><button class="ts" style="flex:1;justify-content:center">Resumen</button><button class="ts on" style="flex:1;justify-content:center">Empresas</button><button class="ts" style="flex:1;justify-content:center">Reportes</button></div></div>
<div class="sc" style="flex:1;padding:4px 14px 14px;display:flex;flex-direction:column;gap:10px">
 <section class="isla nshx" style="border-radius:18px;overflow:hidden;flex:0 0 auto"><div style="padding:12px 14px 8px"><h2 class="ct" style="font-size:14px">Por empresa · noviembre</h2><div class="cs">Cada NIT lleva su libro; el total es informativo</div></div><<eh>></section>
 <section class="isla" style="border-radius:18px;overflow:hidden;flex:0 0 auto"><div style="padding:12px 14px 8px;display:flex;align-items:center"><h2 class="ct" style="font-size:14px;flex:1">Impuestos por pagar</h2><button class="lnk">Calendario <i:der:13></button></div><<ih>></section>
 <div class="m2" style="text-align:center;flex:0 0 auto;padding:4px 10px">En el teléfono solo se consulta. Cerrar un mes, declarar o castigar se hace en la computadora.</div>
</div><<nav>></div>''',top=top,nav=nav,eh=eh,ih=ih)
cmbuild('ContaPanelMovil2.dc.html','Teléfono · Finanzas por empresa e impuestos',b2,LOG0)
