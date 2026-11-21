p='c13.py'; t=open(p).read()
def rep(a,b):
    global t
    assert a in t, a[:80]; t=t.replace(a,b,1)
rep("[['existencias','Existencias',''],['unidades','Equipos (serie/MAC)',''],['kardex','Kardex',''],['recuperar','Por recuperar','3']]",
    "[['existencias','Existencias',''],['unidades','Equipos (serie/MAC)',''],['kardex','Kardex',''],['recuperar','Por recuperar','3'],['taller','Revisión y garantía','4']]")
helpers='''
col=lambda tit,sub,bg,fg,ico,items: f'<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:8px"><div style="display:flex;align-items:center;gap:8px"><span class="av" style="width:30px;height:30px;border-radius:9px;background:{bg};color:{fg}">{s(ico,15)}</span><b style="font-size:14px">{tit}</b><span style="font-size:12px;color:#64748B">{sub}</span></div>{items}</div>'
it=lambda a,b,c,btns: f'<div style="border:1px solid #E6E8F0;border-radius:14px;padding:10px 12px;background:#fff;display:flex;flex-direction:column;gap:6px"><b style="font-size:13px">{a}</b><span class="mono" style="font-size:11px;color:#64748B">{b}</span><span style="font-size:12px;color:#475569">{c}</span><div style="display:flex;gap:6px;flex-wrap:wrap">{btns}</div></div>'
bt=lambda x,cl='': f'<button class="btn o" style="padding:5px 10px;font-size:12px;{cl}">{x}</button>'
GASTO='<span class="b ne">Gasto 5.6.02</span>'
taller=f"""  <div style="display:{{{{t.taller}}}};gap:14px;padding:14px;overflow:auto;align-items:flex-start">
   {col('En revisión','2','#E0F2FE','#0369A1','herr', it('ONU ZTE F660','ZTEG77AB12CD','Devuelta de S-000150 · «no enciende»',bt('Funciona: a bodega')+bt('Enviar a garantía')+bt('Dar de baja','color:#B91C1C'))+it('Router TP-Link C6','2231500988','Cambio en S-000201 · wifi intermitente',bt('Funciona: a bodega')+bt('Enviar a garantía')+bt('Dar de baja','color:#B91C1C')))}
   {col('En garantía','1','#EDE9FE','#6D28D9','camion', it('Antena LiteBeam 5AC','B4FBE4112233','Con Distribuidora Red · RMA 7781 · enviada 12 nov · vence 12 dic',bt('Volvió reparada')+bt('Cambiada por otra')+bt('Rechazada','color:#B91C1C')))}
   {col('Dados de baja','este mes · Q 595.00','#FEE2E2','#B91C1C','alerta', it('Router TP-Link C6','2231500111','Dañado por rayo · 8 nov · Q 285.00',GASTO)+it('ONU ZTE F660','ZTEG11223344','Obsoleta (no soporta 1 Gbps) · 2 nov · Q 310.00',GASTO))}
  </div>"""
NOREC=''.join(f'<div style="display:flex;align-items:center;gap:12px;padding:10px 14px;border:1px solid #E6E8F0;border-radius:14px"><span class="av" style="background:#FEE2E2;color:#B91C1C">{s("barra",16)}</span><div><b>{a}</b><div style="font-size:12px;color:#64748B">{b}</div></div><span class="b {c}" style="margin-left:auto">{d}</span></div>' for a,b,c,d in [('ONU ZTE F660 · ZTEG0099AA11','S-000045 · declarado 30 oct · Q 248.00','ok','Cobrado al cliente'),('Router TP-Link C6 · 2231500300','S-000071 · declarado 12 oct · Q 230.00','wa','Cargo pendiente de pago'),('ONU ZTE F660 · ZTEG7788CC22','S-000033 · declarado 2 oct · Q 210.00','ne','Sin cobro (decisión)')])
op2=lambda on,tit,sub: f'<div class="op {"on" if on else ""}" style="padding:10px 12px"><span class="rd"></span><div><b style="font-size:13px">{tit}</b><div style="font-size:12px;color:#64748B">{sub}</div></div></div>'
modalC=f"""<div style="position:absolute;inset:0;background:rgba(15,23,42,.45);z-index:10;display:{{{{verC}}}}"></div>
<div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:640px;max-height:calc(100% - 32px);background:#fff;border-radius:26px;box-shadow:0 30px 80px rgba(15,23,42,.35);z-index:11;display:{{{{verC}}}};flex-direction:column;overflow:hidden">
 <header style="display:flex;align-items:center;gap:12px;padding:16px 22px;border-bottom:1px solid #F1F5F9"><span class="av" style="background:#EEF2FF;color:#4338CA">{s('barra',18)}</span><div><b style="font-size:17px">Cambiar equipo</b><div style="font-size:12px;color:#64748B">S-000412 · Casa · José López</div></div><button class="ib" style="margin-left:auto" onClick="{{{{cerrarC}}}}">{s('cerrar',16)}</button></header>
 <div style="padding:16px 22px;overflow:auto;display:flex;flex-direction:column;gap:14px">
  <div><div class="lb" style="font-size:12px">¿Por qué se cambia?<span class="req">*</span></div><div style="display:flex;gap:6px;flex-wrap:wrap"><span class="fc on">Dañado</span><span class="fc">Actualización</span><span class="fc">Garantía</span><span class="fc">Otro</span></div></div>
  <div style="display:grid;grid-template-columns:1fr 32px 1fr;gap:8px;align-items:center">
   <div style="border:1px solid #FECACA;background:#FEF2F2;border-radius:14px;padding:10px 12px"><div style="font-size:11px;color:#991B1B;font-weight:700">SALE</div><b style="font-size:13px">ONU ZTE F660</b><div class="mono" style="font-size:11px;color:#64748B">ZTEG1A2B3C4D</div></div>
   <span style="color:#4338CA;text-align:center">{s('flecha',20)}</span>
   <div style="border:1px solid #BBF7D0;background:#F0FDF4;border-radius:14px;padding:10px 12px"><div style="font-size:11px;color:#166534;font-weight:700">ENTRA</div><b style="font-size:13px">ONU ZTE F660</b><div class="mono" style="font-size:11px;color:#64748B">ZTEG9F8E7D6C · de Central</div></div>
  </div>
  <div class="in" style="color:#94A3B8">{s('bus',15)}Escanear o buscar el equipo que entra<span style="margin-left:auto">{s('barra',16)}</span></div>
  <div><div class="lb" style="font-size:12px">¿Qué pasa con el que sale?<span class="req">*</span></div>
   <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">{op2(False,'Funciona','Vuelve a bodega como usado')}{op2(True,'A revisión','Se prueba en bodega antes de decidir')}{op2(False,'Garantía','Se envía al proveedor')}{op2(False,'Dañado','Se da de baja (gasto)')}</div></div>
  <label style="display:flex;align-items:center;gap:10px;font-size:13px"><span class="tg"><i></i></span>Cobrar al cliente (daño por mal uso)</label>
 </div>
 <footer style="display:flex;gap:8px;padding:14px 22px;border-top:1px solid #F1F5F9;background:#FCFCFE"><span style="font-size:12px;color:#64748B;align-self:center">Queda en el historial de los dos equipos y en la bitácora del servicio</span><button class="btn p" style="margin-left:auto">{s('check',15)}Cambiar equipo</button></footer>
</div>"""
'''
rep("inv=f\"\"\"{rail('inv')}",helpers+"\ninv=f\"\"\"{rail('inv')}")
rep('  <div style="display:{{{{t.recuperar}}}};flex-direction:column;overflow:auto;padding:14px;gap:10px">', '{taller}\n  <div style="display:{{{{t.recuperar}}}};flex-direction:column;overflow:auto;padding:14px;gap:10px">')
rep("""('ONU ZTE F660 · ZTEG55CD98EF','S-000099 · retirado 2 nov · 3 intentos')])}""","""('ONU ZTE F660 · ZTEG55CD98EF','S-000099 · retirado 2 nov · 3 intentos')])}
   <div style="display:flex;align-items:center;gap:10px;padding:12px 14px;border:1px dashed #FCA5A5;border-radius:14px;font-size:13px">{s('alerta',16,'#B91C1C')}<span>Si no se recupera, «Declarar no recuperado» lo da de baja como pérdida y ofrece <b>cobrarlo al cliente</b> con un cargo «Equipo no devuelto».</span></div>
   <div class="sec" style="margin:8px 0 0">No recuperados (este año)</div>
   {NOREC}""")
rep("('Router TP-Link C6','2231500988 · 50:C7:BF:44:55:66','er','Dañado','Central · baja pendiente')","('Router TP-Link C6','2231500988 · 50:C7:BF:44:55:66','wa','En revisión','Central · cambio en S-000201'),('Antena LiteBeam 5AC','B4FBE4112233','ix','En garantía','Distribuidora Red · RMA 7781')")
rep('<button class="btn o">Registrar devolución</button><button class="btn o" style="color:#B91C1C">Declarar pérdida</button>','<button class="btn p" onClick="{{{{abrirCambio}}}}">Cambiar equipo</button><button class="btn o">Retirar</button><button class="btn o" style="color:#B91C1C">No recuperado</button>')
rep("{drawerU}\"\"\"","{drawerU}\n{modalC}\"\"\"")
rep("cerrarU: () => this.setState({ u: false }) };","cerrarU: () => this.setState({ u: false }), verC: st.c ? 'flex' : 'none', abrirCambio: () => this.setState({ c: true, u: false }), cerrarC: () => this.setState({ c: false }) };")
open(p,'w').write(t)
