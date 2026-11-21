exec(open('/tmp/claude-0/-home-user/59389ade-3278-540a-8050-19c26767da8e/scratchpad/gen/red_base.py').read())
CSS3='''
.code{background:#0F172A;color:#CBD5E1;border-radius:14px;padding:14px 16px;font-family:ui-monospace,Menlo,monospace;font-size:12px;line-height:1.6;overflow:auto;white-space:pre;flex:1;min-height:0}
.code .c{color:#64748B}.code .k{color:#7DD3FC}.code .s{color:#FDE68A}
.stp{display:flex;gap:12px;align-items:flex-start;padding:10px 0}
.stp .n{width:28px;height:28px;border-radius:999px;background:#EEF2FF;color:#3730A3;font-weight:700;font-size:13px;display:flex;align-items:center;justify-content:center;flex:0 0 auto}
.vf{display:flex;gap:12px;align-items:center;padding:12px 14px;border:1px solid #E6E8F0;border-radius:14px;font-size:14px}
.gir{width:18px;height:18px;border-radius:999px;border:3px solid #C7D2FE;border-top-color:#4F46E5;animation:gira 1s linear infinite;flex:0 0 auto}
@keyframes gira{to{transform:rotate(360deg)}}
.opb{border:1.5px solid #E2E8F0;border-radius:14px;padding:12px 14px;display:flex;gap:10px;align-items:flex-start;cursor:pointer;background:#fff;flex:1;min-width:0}
.opb.on{border-color:#4F46E5;background:#EEF2FF;box-shadow:0 0 0 3px rgba(79,70,229,.12)}
.opb .rd{width:16px;height:16px;border-radius:999px;border:2px solid #CBD5E1;flex:0 0 auto;margin-top:2px}
.opb.on .rd{border:5px solid #4F46E5}
.opb b{font-size:14px;display:block}.opb span.d{font-size:12px;color:#64748B;line-height:1.4;display:block;margin-top:2px}
.rec{font-size:10px;font-weight:700;color:#166534;background:#DCFCE7;border-radius:999px;padding:1px 7px;margin-left:6px;vertical-align:middle}
'''
opb=lambda on,t,d,rec=False: f'<div class="opb {"on" if on else ""}"><span class="rd"></span><div><b>{t}{"<span class=rec>Recomendado</span>" if rec else ""}</b><span class="d">{d}</span></div></div>'
grp=lambda tit,ay,ops: f'<div><div class="lb">{tit}</div><div style="display:flex;gap:10px">{ops}</div>{f"<div class=ay>{ay}</div>" if ay else ""}</div>'
p1=T('''<div style="display:{{p1}};flex-direction:column;gap:18px;max-width:760px">
 <div><h2 class="tit">¿Qué router vas a conectar?</h2><p class="subt">Solo el nombre es obligatorio. Lo demás lo crea el script por ti.</p></div>
 <div class="g2"><<c1>><<c2>></div>
 <<g>>
 <div class="av2 nf" style="align-items:flex-start"><i:info:17><div><b>Necesita RouterOS 7</b> (por WireGuard). El script lo comprueba al inicio y no toca nada si es más viejo.</div></div>
</div>''',c1=campo('Nombre del router','MK Bodega',True,ayuda='Como lo conoce tu equipo: lugar o torre.'),c2=campo('Empresa','Compartido entre empresas',cls='sel',ayuda='La red es infraestructura común; cada servicio lleva su empresa.'),
 g=grp('¿Cómo se comunica con Argos?','',opb(True,'Por túnel seguro','Argos crea el túnel, el usuario de la API y el RADIUS con un script. No abres puertos.',True)+opb(False,'Ya tengo acceso directo','Escribes a mano la dirección, el usuario y la clave de la API. Para instalaciones ya armadas.')))
p2=T('''<div style="display:{{p2}};flex-direction:column;gap:12px;max-width:980px">
 <div><h2 class="tit">¿Cómo trabaja este router?</h2><p class="subt">Cada decisión es una sola para todo el router. Todas se pueden cambiar después desde su ficha, con vista previa.</p></div>
 <<g1>><<g2>><<g3>><<g4>>
</div>''',
 g1=grp('Seguridad y control','',opb(True,'RADIUS','PPPoE validado por Argos, con corte y cambio de velocidad al instante. Mide el consumo.',True)+opb(False,'Sin RADIUS','Argos configura todo por la API del router. Sin consumo de datos.')),
 g2=grp('Tipo de conexión de los clientes','Uno por router: todos sus servicios lo usan.',opb(True,'PPPoE','Usuario y contraseña en el equipo del cliente.')+opb(False,'IP estática','IP fija, sin usuario.')+opb(False,'DHCP fija','IP amarrada a la MAC.')),
 g3='<div><div class="lb">Control de velocidad</div><div style="display:flex;gap:10px">'+opb(True,'RADIUS','Argos manda la velocidad a cada cliente al conectarse. Bien hasta unos cientos de clientes.',True)+opb(False,'Árbol con PCQ','Una rama por plan. Lo mejor con muchos clientes.')+opb(False,'Cola simple','Una cola fija por servicio. Sirve con cualquier tipo de conexión.')+'</div><div style="display:{{vOtras}};gap:10px;margin-top:10px">'+opb(False,'Perfil PPP','La velocidad vive en el perfil del plan en el router. Solo PPPoE.')+opb(False,'PCQ por plan','Una cola por plan que se reparte entre sus clientes. Necesita RADIUS.')+'<div style="flex:1"></div></div><div style="display:flex;align-items:center;gap:12px;margin-top:6px"><button class="lnk" style="display:inline-flex;align-items:center;gap:4px" onClick="{{verOtras}}">{{otrasTxt}}'+s('ab',14)+'</button><span class="ay" style="margin:0">RADIUS y Perfil PPP solo con PPPoE. Sin RADIUS no aplican RADIUS ni PCQ por plan.</span></div></div>',
 g4=grp('Cómo reconocer al cliente suspendido','',opb(True,'Por código','El router manda a cada suspendido a la página de corte con su propio código.',True)+opb(False,'Por IP','Solo si no hay NAT entre el router y Argos.')))
script='''<span class="c"># ArgosIsp · conexión de «MK Bodega» · válido 24 h, un solo uso</span>
<span class="c"># Lleva secretos: no lo guardes ni lo reenvíes.</span>
:if ([:pick [/system resource get version] 0 1] != "7") do={ :error "Requiere RouterOS 7" }
<span class="k">/interface wireguard</span> add name=wg-argos comment=<span class="s">"argosisp: tunel"</span>
<span class="k">/ip address</span> add address=10.255.0.31/32 interface=wg-argos
<span class="k">/tool fetch</span> url=<span class="s">"https://argos.miisp.gt/api/v1/routers/conexion/registrar"</span> \\
    http-data=<span class="s">"{token: ••••••, public_key: ...}"</span>
<span class="k">/user group</span> add name=argosisp-api policy=read,write,api,rest-api
<span class="k">/user</span> add name=argosisp-api group=argosisp-api address=10.255.0.1
<span class="k">/radius</span> add address=10.255.0.1 secret=<span class="s">••••••••</span> service=ppp src-address=10.255.0.31
<span class="k">/radius incoming</span> set accept=yes port=3799
<span class="c"># Gestión: solo se restringe si el registro y el túnel funcionaron</span>
<span class="k">/ip firewall filter</span> add chain=input in-interface=wg-argos ... comment=<span class="s">"argosisp:gestion"</span>
<span class="c"># … 64 líneas más</span>'''
p3=T('''<div style="display:{{p3}};gap:20px;flex:1;min-height:0">
 <div style="width:400px;flex:0 0 auto;display:flex;flex-direction:column;gap:14px;overflow:auto">
  <div><h2 class="tit">Pega este script en el router</h2><p class="subt">Crea el túnel, el usuario de la API y el RADIUS. Se puede volver a correr sin dañar nada.</p></div>
  <div>
   <div class="stp"><span class="n">1</span><div><b style="font-size:14px">Abre Winbox y entra al router</b><div class="m2">Con tu usuario de siempre.</div></div></div>
   <div class="stp" style="border-top:1px solid #F1F5F9"><span class="n">2</span><div><b style="font-size:14px">New Terminal</b><div class="m2">Botón en el menú de la izquierda.</div></div></div>
   <div class="stp" style="border-top:1px solid #F1F5F9"><span class="n">3</span><div><b style="font-size:14px">Pega el script y presiona Enter</b><div class="m2">Al final dice «LISTO» o qué falló.</div></div></div>
  </div>
  <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-top:1px solid #F1F5F9"><span class="tg on"><i></i></span><div><b style="font-size:13px">Incluir configuración de servicio</b><div class="m2">PPPoE, perfiles y reglas de corte. Apágalo si el router ya atiende clientes.</div></div></div>
  <div><div class="lb" style="font-size:12px">IPs de administración (opcional)</div><div class="in" style="flex-wrap:wrap"><span class="b ne">190.56.12.10 ×</span><span class="ph" style="color:#94A3B8">Agregar IP…</span></div><div class="ay">Desde dónde puedes entrar por Winbox además del túnel. Tu sesión actual nunca se bloquea.</div></div>
 </div>
 <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:10px">
  <div style="display:flex;align-items:center;gap:8px"><b style="font-size:13px">conexion-mk-bodega.rsc</b><span class="b wa"><i:reloj:13>Vale 24 h · un solo uso</span><span style="flex:1"></span><button class="btn o" style="padding:8px 14px"><i:desc:15>Descargar</button><button class="btn p" style="padding:9px 18px" onClick="{{copiar}}"><i:copiar:15>{{copiarTxt}}</button></div>
  <div class="code"><<script>></div>
  <div class="av2 wa"><i:candado:16><div>El script lleva la clave de la API y el secreto RADIUS. Argos no lo guarda: si lo pierdes, genera otro.</div></div>
 </div>
</div>''',script=script)
vf=lambda est,t,d: '<div class="vf">'+{'ok':T('<span style="color:#16A34A"><i:ok:20></span>'),'es':'<span class="gir"></span>','no':T('<span style="color:#CBD5E1"><i:reloj:20></span>')}[est]+f'<div style="flex:1"><b>{t}</b><div class="m2">{d}</div></div></div>'
p4=T('''<div style="display:{{p4}};gap:24px;flex:1;min-height:0">
 <div style="flex:1.2;min-width:0;display:flex;flex-direction:column;gap:10px">
  <div><h2 class="tit">{{vTit}}</h2><p class="subt">{{vSub}}</p></div>
  <div style="display:{{esp}};flex-direction:column;gap:8px">
   <<a1>><<a2>><<a3>><<a4>><<a5>>
   <div class="m2" style="display:flex;gap:6px;align-items:center;margin-top:4px">Demo: <button class="lnk" onClick="{{listo}}">simular que el router respondió</button></div>
  </div>
  <div style="display:{{fin}};flex-direction:column;gap:8px">
   <<b1>><<b2>><<b3>><<b4>><<b5>>
  </div>
 </div>
 <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:10px">
  <div class="card" style="padding:16px;display:{{esp}};flex-direction:column;gap:8px;background:#F8FAFC">
   <b style="font-size:14px">¿No avanza?</b>
   <div style="font-size:13px;color:#475569;line-height:1.55">• El router necesita salida a internet por el puerto UDP 51820.<br>• Si el script dijo «la gestión NO se restringió», corrige lo que indica y genera un script nuevo.<br>• Sin internet en el router: <a href="#">pega su clave pública a mano</a>.</div>
   <button class="btn o" style="align-self:flex-start;margin-top:4px" onClick="{{atras}}"><i:izq:15>Volver al script</button>
  </div>
  <div class="card" style="padding:18px;display:{{fin}};flex-direction:column;gap:10px;background:#F0FDF4;border-color:#BBF7D0">
   <div style="display:flex;align-items:center;gap:12px"><span class="ico ok" style="width:48px;height:48px;border-radius:999px"><i:check:24></span><div><b style="font-size:17px">MK Bodega está conectado</b><div class="m2">CCR2004 · RouterOS 7.16.1 · túnel 10.255.0.31</div></div></div>
   <div class="sec" style="margin:8px 0 0">Siguiente</div>
   <div class="mi" style="background:#fff;border:1px solid #E6E8F0"><i:net:16><div style="flex:1"><b>Agregar sus redes</b><div class="m2">De dónde salen las IPs de los clientes</div></div><i:der:15></div>
   <div class="mi" style="background:#fff;border:1px solid #E6E8F0"><i:bus:16><div style="flex:1"><b>Detectar lo que ya tiene</b><div class="m2">VLAN y servidores PPPoE existentes</div></div><i:der:15></div>
   <div class="mi" style="background:#fff;border:1px solid #E6E8F0"><i:gauge:16><div style="flex:1"><b>Elegir en qué planes se ofrece</b><div class="m2">Los planes «para todos» ya aplican</div></div><i:der:15></div>
  </div>
 </div>
</div>''',
 a1=vf('ok','El router se registró','Recibimos su clave pública hace 8 s.'),a2=vf('es','Esperando el saludo del túnel…','Suele tardar menos de 40 segundos.'),a3=vf('no','API del router','Usuario argosisp-api con los permisos mínimos.'),a4=vf('no','RADIUS y CoA','Que apunte a Argos y acepte cortes al instante.'),a5=vf('no','Página de corte','Que un suspendido llegue a su aviso de pago.'),
 b1=vf('ok','El router se registró','Clave pública recibida.'),b2=vf('ok','Túnel con saludo','31 ms · IP 10.255.0.31'),b3=vf('ok','API del router','RouterOS 7.16.1 · CCR2004-16G-2S+'),b4=vf('ok','RADIUS y CoA','El secreto coincide · puerto 3799 abierto solo para Argos.'),b5=vf('ok','Página de corte','Reglas instaladas · identificación por código.'))
pasos='''<div style="display:flex;align-items:center;gap:8px;flex:1;max-width:760px"><sc-for list="{{pasos}}" as="p"><button class="pc {{p.cls}}" onClick="{{p.ir}}"><span class="n">{{p.n}}</span>{{p.nom}}</button><span class="ln {{p.ln}}"></span></sc-for></div>'''
inner=T('''<section class="isla" style="flex:1;min-height:0;border-radius:20px;display:flex;flex-direction:column;overflow:hidden">
 <header style="display:flex;align-items:center;gap:16px;padding:14px 22px;border-bottom:1px solid #F1F5F9;flex:0 0 auto">
  <span class="ico nf"><i:router:19></span><div style="margin-right:12px"><b style="font-size:17px">Conectar router</b><div class="m2">MK Bodega</div></div>
  <<pasos>>
  <span style="flex:1"></span><button class="ib" title="Ayuda (manual)" style="cursor:help"><i:ayuda:18></button><button class="ib" title="Salir"><i:cerrar:16></button>
 </header>
 <div class="sc" style="flex:1;padding:22px 26px;display:flex;flex-direction:column"><<p1>><<p2>><<p3>><<p4>></div>
 <footer style="display:flex;align-items:center;gap:10px;padding:14px 22px;border-top:1px solid #F1F5F9;background:#FCFCFE;flex:0 0 auto"><span class="m2">{{pie}}</span><span style="flex:1"></span>
  <button class="btn o" style="display:{{verAtras}}" onClick="{{atras}}"><i:izq:15>Atrás</button>
  <button class="btn p" style="padding:11px 22px" onClick="{{sig}}">{{sigTxt}}<i:der:15></button></footer>
</section>''',pasos=pasos,p1=p1,p2=p2,p3=p3,p4=p4)
logic='''class Component extends DCLogic {
renderVals() {
const st = this.state || {};
const paso = st.paso || 1;
const listo = !!st.listo;
const otras = !!st.otras;
const noms = ['Equipo', 'Cómo trabaja', 'Script', 'Verificar'];
const pasos = noms.map((nom, i) => ({ nom, n: i + 1 < paso ? '✓' : String(i + 1), cls: i + 1 < paso ? 'ok' : (i + 1 === paso ? 'on' : ''), ln: i === 3 ? 'fin' : (i + 1 < paso ? 'ok' : ''), ir: () => this.setState({ paso: i + 1 }) }));
return {
  vOtras: otras ? 'flex' : 'none', otrasTxt: otras ? 'Ocultar las otras' : 'Ver las otras (2)', verOtras: () => this.setState({ otras: !otras }),
  pasos, p1: paso === 1 ? 'flex' : 'none', p2: paso === 2 ? 'flex' : 'none', p3: paso === 3 ? 'flex' : 'none', p4: paso === 4 ? 'flex' : 'none',
  verAtras: paso > 1 ? 'inline-flex' : 'none', atras: () => this.setState({ paso: Math.max(1, paso - 1), listo: false }),
  sig: () => this.setState({ paso: Math.min(4, paso + 1) }),
  sigTxt: paso === 1 ? 'Seguir' : paso === 2 ? 'Crear y generar script' : paso === 3 ? 'Ya lo pegué, verificar' : (listo ? 'Ir a la ficha del router' : 'Seguir sin esperar'),
  pie: paso === 1 ? 'Paso 1 de 4 · nada se guarda todavía' : paso === 2 ? 'Al seguir se crea el router en Argos (queda «Por conectar»)' : paso === 3 ? 'El router ya existe en Argos; puedes volver más tarde por el script' : (listo ? 'Todo en orden' : 'Puedes cerrar: Argos te avisa cuando se conecte'),
  copiar: () => this.setState({ copiado: true }), copiarTxt: st.copiado ? 'Copiado ✓' : 'Copiar script',
  esp: listo ? 'none' : 'flex', fin: listo ? 'flex' : 'none', listo: () => this.setState({ listo: true }),
  vTit: listo ? 'Conectado' : 'Esperando al router…', vSub: listo ? 'Argos ya puede configurarlo, cortar y medir.' : 'Deja esta pantalla abierta mientras corres el script. Se actualiza sola.'
};
}
}'''
build('RedRouterNuevo.dc.html','Red · Conectar router',shell('red',['Red','Routers','Conectar router'],inner),logic,900,CSS3)
