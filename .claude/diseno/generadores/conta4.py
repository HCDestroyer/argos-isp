exec(open('/tmp/claude-0/-home-user/59389ade-3278-540a-8050-19c26767da8e/scratchpad/gen/conta_base.py').read())
ms=[('Ene','dur'),('Feb','dur'),('Mar','dur'),('Abr','dur'),('May','dur'),('Jun','dur'),('Jul','cer'),('Ago','cer'),('Sep','cer'),('Oct','act'),('Nov','ab'),('Dic','fut')]
mt={'dur':('candado','Bloqueo duro'),'cer':('check','Cerrado'),'act':('reloj','Por cerrar'),'ab':('editar','Abierto'),'fut':('cal','—')}
meses=''.join(T('<div class="mes <<c>>"><span style="font-size:13px"><<m>></span><span style="display:flex;align-items:center;gap:4px;font-size:11px;font-weight:600"><i:<<i>>:12><<t>></span></div>',c=c,m=m,i=mt[c][0],t=mt[c][1]) for m,c in ms)
CH=[('ok','Cartera por antigüedad = cuenta de clientes','Q 118,930.00 en los dos lados',''),
('ok','Saldos de clientes y anticipos = sus cuentas de control','287 clientes con saldo · 41 con saldo a favor',''),
('ok','Cuentas por pagar = cuenta de proveedores','Q 46,220.00 en los dos lados',''),
('er','Turnos de caja cerrados','Caja 3 · Agencia Escuintla sigue abierta desde el 31 oct','Ir a cajas'),
('ok','Fondos en tránsito = depósitos sin acreditar','Q 18,400.00 · 2 depósitos',''),
('ok','Cobros de pasarelas liquidados','Ninguno con más de 5 días',''),
('er','Estados de cuenta conciliados','4 líneas de Banrural sin conciliar · Q 3,210.00','Conciliar'),
('ok','Sin DTE en cola ni en contingencia','0 pendientes de octubre',''),
('su','Avisos de cobro sin certificar','7 avisos sin pagar · supervisado por M. Méndez: «se certifican al cobrar»','Ver nota'),
('er','Compras con periodo de IVA','2 compras sin periodo de IVA asignado','Asignar'),
('ok','IVA por certificar cuadra con los avisos sin DTE','Q 4,118.20 en los dos lados',''),
('ok','Numeración sin huecos','6 diarios · 2,104 asientos',''),
('ok','Depreciación y diferidos del mes','214 activos · 9 diferidos registrados',''),
('ok','Integridad del libro','Todos los asientos sellados; cadena verificada','')]
ci={'ok':('ok','check','En orden'),'er':('er','alerta','Anomalía'),'su':('wa','ojo','Supervisado')}
chk=''.join(T('<div class="chk"><span class="ci2 <<c>>"><i:<<i>>:14></span><div style="flex:1;min-width:0"><b><<n>></b><div class="m2 el" style="<<st>>"><<d>></div></div><<ac>></div>',c=ci[e][0],i=ci[e][1],n=n,d=d,st='color:#B91C1C' if e=='er' else '',ac=(f'<button class="btn o" style="padding:6px 12px">{a}</button>' if e=='er' else (f'<button class="lnk">{a}</button>' if a else '<span class="m2">En orden</span>'))) for e,n,d,a in CH)
BL=[('duro','Bloqueo duro','candado','30 jun 2026','Nunca se mueve hacia atrás','ne',''),('global','Todo el libro','libro','30 sep 2026','Fijado al cerrar septiembre','nf','Mover'),('impuestos','Impuestos','calc','31 oct 2026','Automático al revisar el IVA de octubre','nf','Excepción'),('ventas','Ventas','fac','30 sep 2026','','ne','Mover'),('compras','Compras','camion','30 sep 2026','','ne','Mover')]
blh=''.join(T('<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid #F1F5F9"><span class="ico <<c>>" style="width:30px;height:30px;border-radius:9px"><i:<<i>>:15></span><div style="flex:1;min-width:0"><b style="font-size:13px"><<n>></b><div class="m2 el"><<d>></div></div><div style="text-align:right"><b class="num" style="font-size:13px">hasta <<f>></b><div><<a>></div></div></div>',c=c,i=i,n=n,d=d or 'Fijado por contabilidad',f=f,a=(f'<button class="lnk" style="font-size:12px">{a}</button>' if a else '<span class="m2">irreversible</span>')) for k,n,i,f,d,c,a in BL)
EJ=[('ok','Enero a noviembre cerrados','Faltan octubre y noviembre'),('ok','Sin DTE en cola del año','0 pendientes'),('ne','Declaración anual del ISR revisada','Se calcula en enero · SAT-1411'),('ne','Cartera de más de 60 días revisada','Estimación para incobrables hasta el 3 %'),('ne','Balance de comprobación cuadra','Antes y después del cierre')]
ejh=''.join(T('<div class="chk"><span class="ci2 <<c>>"><i:<<i>>:14></span><div style="flex:1"><b><<n>></b><div class="m2"><<d>></div></div></div>',c='wa' if k==0 else ('ok' if e=='ok' else 'ne'),i='reloj' if k==0 else ('check' if e=='ok' else 'cal'),n=n,d=d) for k,(e,n,d) in enumerate(EJ))
PS=[('1','Provisión del ISR del año','Q 74,300 estimado a hoy'),('2','Ingresos y gastos se llevan a «Pérdidas y ganancias»','Las cuentas de resultados quedan en cero'),('3','El resultado pasa a utilidades acumuladas','Q 223,000 estimado a hoy'),('4','Reserva legal del 5 %','Q 11,150 estimado a hoy'),('5','Se cierra diciembre y se guarda el cierre','Con su balance de comprobación')]
psh=''.join(f'<div class="chk"><span class="ci2 ne" style="font-weight:700;font-size:12px">{a}</span><div style="flex:1"><b>{b}</b></div><span class="m2 num">{c}</span></div>' for a,b,c in PS)
inner=T('''<div style="display:flex;align-items:center;gap:10px;flex:0 0 auto">
 <div><h1 class="h1">Periodos y cierres</h1><div class="sub">Redes del Valle, S.A. · ejercicio 2026 · cada empresa cierra por separado</div></div>
 <span style="flex:1"></span><<emp>><<ay>>
 <button class="btn o" onClick="{{abrir}}"><i:girar:15>Reabrir un mes</button>
</div>
<div style="display:flex;gap:6px;flex:0 0 auto"><<meses>></div>
<div style="display:grid;grid-template-columns:minmax(0,1fr) 380px;gap:10px;flex:1;min-height:0">
 <section class="isla" style="border-radius:20px;display:flex;flex-direction:column;overflow:hidden;min-height:0">
  <div style="display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid #EEF0F5">
   <div class="segb"><button class="ts {{c1}}" onClick="{{irMes}}"><i:cal:14>Cierre de octubre<span class="c rj">3</span></button><button class="ts {{c2}}" onClick="{{irAnio}}"><i:bandera:14>Cierre del ejercicio 2026</button><button class="ts"><i:hist:14>Historial</button></div>
   <span style="flex:1"></span>
   <span class="m2" style="display:{{d1i}}">Verificado hoy 10:31</span><button class="btn o" style="display:{{d1i}}"><i:refresh:15>Verificar de nuevo</button>
  </div>
  <div style="flex:1;min-height:0;display:{{d1}};flex-direction:column">
   <div style="display:flex;align-items:center;gap:14px;padding:12px 16px;background:#F8FAFC;border-bottom:1px solid #EEF0F5">
    <div style="flex:1"><b style="font-size:14px">11 de 14 verificaciones en orden</b><div class="bar" style="margin-top:6px;height:8px"><i style="width:79%;background:#16A34A"></i></div></div>
    <span class="b er"><i:alerta:12>3 anomalías</span><span class="b wa"><i:ojo:12>1 supervisada</span>
    <button class="btn p" style="background:#CBD5E1;box-shadow:none;cursor:not-allowed;padding:11px 20px" title="Resuelve o supervisa las 3 anomalías"><i:candado:15>Cerrar octubre</button>
   </div>
   <div class="sc" style="flex:1"><<chk>></div>
   <div style="display:flex;align-items:center;gap:8px;padding:10px 16px;border-top:1px solid #F1F5F9;font-size:12px;color:#64748B"><i:info:14>Una anomalía se resuelve en su pantalla o el contador la supervisa con una nota. Las verificaciones nunca se marcan a mano.</div>
  </div>
  <div style="flex:1;min-height:0;display:{{d2}};flex-direction:column">
   <div class="sc" style="flex:1;display:grid;grid-template-columns:1fr 1fr;gap:0">
    <div style="border-right:1px solid #EEF0F5"><div class="sec" style="padding:14px 16px 0">Antes de cerrar el año</div><<ejh>></div>
    <div><div class="sec" style="padding:14px 16px 0">Lo que hará el cierre (31 dic)</div><<psh>></div>
   </div>
   <div style="display:flex;align-items:center;gap:10px;padding:12px 16px;border-top:1px solid #EEF0F5"><span class="m2" style="flex:1">Las cifras son un estimado con el libro de hoy. El procedimiento lo revisa tu contador. Un ejercicio con bloqueo duro no se reabre.</span><button class="btn o"><i:doc:15>Balance de comprobación</button><button class="btn p" style="background:#CBD5E1;box-shadow:none;cursor:not-allowed"><i:bandera:15>Cerrar ejercicio 2026</button></div>
  </div>
 </section>
 <div style="display:flex;flex-direction:column;gap:10px;min-height:0">
  <section class="pan" style="flex:0 0 auto"><div style="display:flex;align-items:center"><h2 class="ct" style="flex:1">Bloqueos del libro</h2><button class="btn o" style="padding:6px 12px"><i:candado:14>Bloquear</button></div><div class="cs">Nada con fecha anterior puede registrarse ni cambiarse</div><div style="margin-top:6px"><<blh>></div></section>
  <section class="pan" style="flex:1"><h2 class="ct">Excepciones vigentes</h2><div class="cs">Solo un administrador; siempre con fecha de fin</div>
   <div class="sc" style="flex:1;margin-top:8px"><div class="card" style="padding:10px 12px;display:flex;gap:10px;align-items:flex-start"><span class="ico wa" style="width:30px;height:30px;border-radius:9px"><i:llave:15></span><div style="flex:1;min-width:0"><b style="font-size:13px">Impuestos · Mario Méndez (contador)</b><div class="m2">«Compra de octubre que llegó tarde» · hasta el 24 nov, 18:00</div><div class="m2">1 asiento entró por esta excepción</div></div><button class="lnk" style="color:#B91C1C;font-size:12px">Revocar</button></div></div>
  </section>
 </div>
</div>
<div style="display:{{dm}};position:absolute;inset:0;background:rgba(15,23,42,.35);z-index:8;align-items:center;justify-content:center">
 <div class="isla" style="width:460px;border-radius:22px;padding:22px;display:flex;flex-direction:column;gap:14px">
  <div style="display:flex;align-items:center;gap:10px"><span class="ico wa"><i:girar:18></span><div style="flex:1"><b style="font-size:16px">Reabrir un mes cerrado</b><div class="m2">Queda en la bitácora con tu nombre y el motivo</div></div><button class="ib" onClick="{{cerrar}}"><i:cerrar:16></button></div>
  <div><div class="lb">Mes</div><div class="in sel">Septiembre 2026 (el último cerrado)</div><div class="ay">De julio hacia atrás hay bloqueo duro: no se pueden reabrir.</div></div>
  <div><div class="lb">Motivo<span class="req">*</span></div><div class="in ph" style="min-height:64px;align-items:flex-start;border-color:#4F46E5;box-shadow:0 0 0 3px rgba(79,70,229,.12)">Por ejemplo: faltó registrar una compra de septiembre</div></div>
  <div class="av2 wa"><i:alerta:16><div>Al reabrir, el libro de septiembre emitido con folio deja de coincidir. Tendrás que volver a cerrarlo y emitirlo.</div></div>
  <div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn g" onClick="{{cerrar}}">Cancelar</button><button class="btn p" style="background:#D97706;box-shadow:none"><i:girar:15>Reabrir septiembre</button></div>
 </div>
</div>''',emp=emp('Redes del Valle, S.A.'),ay=AYUDA('cómo cerrar un mes y qué revisa cada verificación'),meses=meses,chk=chk,blh=blh,ejh=ejh,psh=psh)
logic='''class Component extends DCLogic {
renderVals() {
const st = this.state || {}; const a = st.t === 'anio';
return { c1: a ? '' : 'on', c2: a ? 'on' : '', d1: a ? 'none' : 'flex', d2: a ? 'flex' : 'none', d1i: a ? 'none' : 'inline-flex', irMes: () => this.setState({ t: 'mes' }), irAnio: () => this.setState({ t: 'anio' }), dm: st.reabrir ? 'flex' : 'none', abrir: () => this.setState({ reabrir: true }), cerrar: () => this.setState({ reabrir: false }) };
}
}'''
cbuild('ContaCierres.dc.html','Finanzas · Periodos y cierres: verificación, bloqueos y ejercicio',shell('fin',['Finanzas','Periodos y cierres'],inner),logic,900)
