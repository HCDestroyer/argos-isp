COLAS_JS='''const colas = [
  ['def', 'Predeterminada', 'La cola básica del router: atiende en orden de llegada. No gasta CPU, pero una descarga grande puede trabar lo demás del mismo cliente.', 'Conviene con pocos clientes y routers pequeños.', 'No aplica con Árbol ni con PCQ por plan: ahí la cola se comparte entre varios clientes y solo sirve PCQ.'],
  ['sfq', 'SFQ', 'Atiende por turnos a cada conexión del cliente. Es ligera y evita que una sola descarga se lleve todo.', 'Conviene como mejora barata en routers con poca CPU.', 'No aplica con Árbol ni con PCQ por plan: ahí solo sirve PCQ.'],
  ['fq', 'FQ-CoDel', 'Evita que una descarga trabe la navegación, las llamadas y los juegos del mismo cliente. Buen equilibrio entre calidad y CPU.', 'Conviene en casi todos los casos con colas por cliente. Solo RouterOS 7.', 'No aplica con Árbol ni con PCQ por plan: ahí solo sirve PCQ.'],
  ['cake', 'CAKE', 'Lo más completo: reparte parejo entre los aparatos del cliente y mantiene baja la espera, pero pide más CPU.', 'Conviene con pocos clientes o routers potentes. Solo RouterOS 7.', 'No aplica con Árbol ni con PCQ por plan: ahí solo sirve PCQ.'],
  ['pcq', 'PCQ', 'Reparte el ancho entre los clientes de un plan: una sola cola por plan y cada cliente con su tope. Es la que menos carga al router con muchos clientes.', 'Obligatoria con Árbol con PCQ y con PCQ por plan.', '']
];
const cv = st.cola || 'pcq';
const cx = colas.find((c) => c[0] === cv);
const colasV = colas.map((c) => ({ nom: c[1], cls: (c[0] === 'pcq' ? 'on' : 'off') + (c[0] === cv ? ' ver' : ''), ir: () => this.setState({ cola: c[0] }) }));
const colaX = { tit: cx[1], txt: cx[2], cuando: cx[3], no: cx[4], vno: cx[4] ? 'flex' : 'none', est: cx[0] === 'pcq' ? 'En uso' : 'No disponible aquí', ec: cx[0] === 'pcq' ? 'ok' : 'ne' };
const otras = !!st.otras;
'''
COLAS_RET="colas: colasV, colaX, vOtras: otras ? 'grid' : 'none', otrasTxt: otras ? 'Ocultar las otras' : 'Ver las otras (2)', verOtras: () => this.setState({ otras: !otras }),"
CSSQ='''
.pill .nm{display:inline}
.pill.off{opacity:1;text-decoration:none;cursor:pointer;color:#94A3B8}
.pill.off .nm{text-decoration:line-through}
.pill .qi{width:18px;height:18px;border-radius:999px;background:#E0E7FF;color:#3730A3;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;font-style:normal}
.pill.ver{box-shadow:0 0 0 3px rgba(79,70,229,.18);border-color:#A5B4FC}
.pill.on.ver{border-color:#4F46E5}
.exq{margin-top:10px;border:1px solid #C7D2FE;background:#F5F7FF;border-radius:14px;padding:12px 14px;font-size:13px;line-height:1.5;color:#334155}
.rec{font-size:10px;font-weight:700;color:#166534;background:#DCFCE7;border-radius:999px;padding:1px 7px;margin-left:4px;vertical-align:middle}
'''
COLAS_HTML='''<div style="display:flex;gap:8px;flex-wrap:wrap"><sc-for list="{{colas}}" as="c"><button class="pill {{c.cls}}" onClick="{{c.ir}}" title="Cómo funciona"><span class="nm">{{c.nom}}</span><span class="qi" aria-hidden="true">?</span></button></sc-for></div>
   <div class="exq"><div style="display:flex;align-items:center;gap:8px;margin-bottom:4px"><b style="font-size:14px;color:#0F172A">{{colaX.tit}}</b><span class="b {{colaX.ec}}" style="font-size:11px;padding:2px 8px">{{colaX.est}}</span></div>{{colaX.txt}}<div style="margin-top:4px"><b>Cuándo conviene:</b> {{colaX.cuando}}</div><div style="display:{{colaX.vno}};gap:8px;align-items:flex-start;margin-top:8px;padding-top:8px;border-top:1px dashed #C7D2FE;color:#92400E"><span><b>Por qué está tachada:</b> {{colaX.no}}</span></div></div>'''
REC='<span class="rec">Recomendado</span>'
# ---- red2
t=open('red2.py').read()
a=t.index('   <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px">'); b=t.index('   <h3 style="margin-top:14px"><i:capas:14>')
t=t[:a]+'''   <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
    <<a5>><<a1>><<a3>>
   </div>
   <div style="display:{{vOtras}};grid-template-columns:repeat(3,1fr);gap:8px;margin-top:8px">
    <<a2>><<a4>>
   </div>
   <button class="lnk" style="margin-top:8px;display:inline-flex;align-items:center;gap:4px" onClick="{{verOtras}}">{{otrasTxt}}<i:ab:14></button>
'''+t[b:]
a=t.index('   <div style="display:flex;gap:8px;flex-wrap:wrap"><<c1>>'); b=t.index("  </div>\n </div>\n <div style=\"flex:1;min-width:0;display:flex;flex-direction:column;gap:12px\">\n  <div class=\"pan\"><h3><i:rayo:14>4")
t=t[:a]+'   '+COLAS_HTML+'\n   <div class="m2" style="margin-top:6px">Toca el «?» de cada una para ver cómo funciona. Las tachadas no aplican con el modo elegido.</div>\n'+t[b:]
a=t.index(" a1=opc('','RADIUS'"); b=t.index(" q1=pill(")
t=t[:a]+" a1=opc('','RADIUS','Argos manda la velocidad a cada cliente al conectarse. Solo PPPoE.'),a2=opc('','Perfil PPP','La velocidad vive en el perfil del plan en el router. Solo PPPoE.'),a3=opc('','Cola simple','Una cola fija por servicio. Sirve con cualquier tipo de conexión.'),a4=opc('','PCQ por plan','Una cola por plan que se reparte entre sus clientes. Necesita RADIUS.'),a5=opc('on','Árbol con PCQ'+REC,'Una rama por plan. Lo mejor con muchos clientes; permite prioridad por protocolo.'),\n"+t[b:]
t=t.replace("opc=lambda cls,t,d:","REC='"+REC+"'\nopc=lambda cls,t,d:",1)
t=t.replace("const v = {};\ntabs.forEach","const v = {};\n"+COLAS_JS+"tabs.forEach")
t=t.replace("  v, verMenu:","  "+COLAS_RET+"\n  v, verMenu:")
t=t.replace("CSS2+mask(","CSS2+"+repr(CSSQ)+"+mask(")
assert '{{vOtras}}' in t and 'colasV' in t and "<<a5>><<a1>><<a3>>" in t and '{{colaX.tit}}' in t
open('red2.py','w').write(t)
# ---- red3
t=open('red3.py').read()
a=t.index(" g3=grp('Control de velocidad'"); b=t.index(" g4=grp(")
new=''' g3='<div><div class="lb">Control de velocidad</div><div style="display:flex;gap:10px">'+opb(True,'RADIUS','Argos manda la velocidad a cada cliente al conectarse. Bien hasta unos cientos de clientes.',True)+opb(False,'Árbol con PCQ','Una rama por plan. Lo mejor con muchos clientes.')+opb(False,'Cola simple','Una cola fija por servicio. Sirve con cualquier tipo de conexión.')+'</div><div style="display:{{vOtras}};gap:10px;margin-top:10px">'+opb(False,'Perfil PPP','La velocidad vive en el perfil del plan en el router. Solo PPPoE.')+opb(False,'PCQ por plan','Una cola por plan que se reparte entre sus clientes. Necesita RADIUS.')+'<div style="flex:1"></div></div><div style="display:flex;align-items:center;gap:12px;margin-top:6px"><button class="lnk" style="display:inline-flex;align-items:center;gap:4px" onClick="{{verOtras}}">{{otrasTxt}}'+s('ab',14)+'</button><span class="ay" style="margin:0">RADIUS y Perfil PPP solo con PPPoE. Sin RADIUS no aplican RADIUS ni PCQ por plan.</span></div></div>',
'''
t=t[:a]+new+t[b:]
t=t.replace('flex-direction:column;gap:16px;max-width:860px">','flex-direction:column;gap:12px;max-width:980px">')
t=t.replace("const listo = !!st.listo;","const listo = !!st.listo;\nconst otras = !!st.otras;")
t=t.replace("  pasos, p1:","  vOtras: otras ? 'flex' : 'none', otrasTxt: otras ? 'Ocultar las otras' : 'Ver las otras (2)', verOtras: () => this.setState({ otras: !otras }),\n  pasos, p1:")
assert '{{vOtras}}' in t and 'const otras' in t and 'vOtras: otras' in t and 'max-width:980px' in t
open('red3.py','w').write(t)
# ---- red6
t=open('red6.py').read()
def mop(on,tt,d,rec=False):
    return '<div style="border:1.5px solid %s;background:%s;border-radius:14px;padding:10px 12px"><b style="font-size:13px;display:block">%s%s</b><span class="m2" style="display:block;line-height:1.35">%s</span></div>'%('#4F46E5' if on else '#E2E8F0','#EEF2FF' if on else '#fff',tt,REC if rec else '',d)
vel=('''
 <div class="sc" style="flex:1;padding:4px 12px 12px;display:{{v.vel}};flex-direction:column;gap:8px">
  <div class="sec" style="margin:4px 0 0">Cómo se limita a cada cliente</div>
  '''+mop(True,'Árbol con PCQ','Una rama por plan. Lo mejor con muchos clientes.',True)+mop(False,'RADIUS','Argos manda la velocidad al conectarse. Solo PPPoE.')+mop(False,'Cola simple','Una cola fija por servicio.')+'''
  <div style="display:{{vOtras}};flex-direction:column;gap:8px">'''+mop(False,'Perfil PPP','La velocidad vive en el perfil del plan. Solo PPPoE.')+mop(False,'PCQ por plan','Una cola por plan, repartida. Necesita RADIUS.')+'''</div>
  <button class="lnk" style="align-self:flex-start;padding:6px 0" onClick="{{verOtras}}">{{otrasTxt}}</button>
  <div class="sec" style="margin:4px 0 0">Tipo de cola</div>
  <div>'''+COLAS_HTML+'''</div>
  <div class="m2">Se cambia desde una computadora, con vista previa antes de aplicar.</div>
 </div>''')
k='''
 <div class="sc" style="flex:1;padding:4px 0 12px;display:{{v.bit}};flex-direction:column">'''
assert k in t
t=t.replace(k,vel+k)
k="const tabs = [['res', 'Resumen'], ['con', 'Conexión'], ['bit', 'Bitácora']]"; assert k in t
t=t.replace(k,COLAS_JS+"const tabs = [['res', 'Resumen'], ['con', 'Conexión'], ['vel', 'Velocidad'], ['bit', 'Bitácora']]")
k="return { tabs, v: { res: tab === 'res' ? 'flex' : 'none',"; assert k in t
t=t.replace(k,"return { "+COLAS_RET.replace("'grid'","'flex'")+" tabs, v: { vel: tab === 'vel' ? 'flex' : 'none', res: tab === 'res' ? 'flex' : 'none',")
t=t.replace('style="padding:7px 11px" onClick="{{t.ir}}">{{t.nom}}</button>','style="padding:7px 9px" onClick="{{t.ir}}">{{t.nom}}</button>')
k="mbuild('RedRouterFichaMovil.dc.html','Red · Router (teléfono)',mf,flogic)"; assert k in t
PILL='.pill{display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:999px;border:1.5px solid #E2E8F0;font-size:12.5px;font-weight:600;color:#475569;background:#fff;cursor:pointer;white-space:nowrap}.pill.on{border-color:#4F46E5;background:#EEF2FF;color:#3730A3}'
t=t.replace(k,k[:-1]+","+repr(PILL+CSSQ)+")")
open('red6.py','w').write(t)
