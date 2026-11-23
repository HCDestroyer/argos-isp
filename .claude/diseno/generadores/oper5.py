exec(open('/tmp/claude-0/-home-user/59389ade-3278-540a-8050-19c26767da8e/scratchpad/gen/oper_base.py').read())
# ================= 5 · Configuración: pantallas internas =================
SECS=[('emp','edif','Empresa y fiscal','Datos, régimen y factura electrónica'),('cob','banco','Facturación y cobro','Plantillas, cuentas y bancos'),('red','globo','Red y portal','Portal de corte y del cliente'),('usu','usuarios','Usuarios y permisos','Usuarios, roles y tokens'),('not','not','Notificaciones','Canales y plantillas de mensajes'),('int','link','Integraciones','Iris, Horus, pasarela'),('imp','subir','Importar datos','Desde Mikrowisp u otro sistema'),('apa','pincel','Apariencia','Logo, colores e inicio de sesión')]
def conf(on,tit,sub,acc,cuerpo,fn,titulo,groups=None,over='',migas=None):
    nav=''.join(T('<a class="sn <<on>>" href="#"><i:<<i>>:18><span><<a>><small><<b>></small></span></a>',on='on' if k==on else '',i=i,a=a,b=b) for k,i,a,b in SECS)
    inner=T('''<div style="flex:1;min-height:0;display:flex;gap:12px">
 <nav class="isla pan" aria-label="Secciones de configuración" style="width:264px;flex:0 0 auto"><div style="padding:14px 14px 8px"><b style="font-size:16px">Configuración</b><span class="busca" style="height:36px;margin-top:10px"><i:bus:14>Buscar un ajuste…</span></div><div class="sc" style="flex:1;padding:4px 8px 10px;display:flex;flex-direction:column;gap:2px"><<nav>></div></nav>
 <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:10px"><<head>><<c>></div>
</div>''',nav=nav,head=head(tit,sub,acc),c=cuerpo)
    g={'m':(['no'],'no')}; g.update(groups or {})
    obuild(fn,titulo,shell2('aj',migas or ['Configuración',tit],inner,over),logic(g))
    check(fn)
tgl=lambda on:'<span class="tg %s"><i></i></span>'%('on' if on else '')
rowx=lambda a,b,c:f'<div class="kv2"><span style="flex:1 1 auto;min-width:0;color:#0F172A"><b>{a}</b><span class="m2" style="display:block">{b}</span></span><span style="flex:0 0 auto">{c}</span></div>'
row=lambda a,b,c:kv(f'<span style="color:#0F172A"><b>{a}</b><span class="m2" style="display:block">{b}</span></span>',c)
EMP=T('<div style="display:flex;gap:8px;align-items:center;flex:0 0 auto"><span class="m2">Empresa</span><span class="fc on"><i:edif:14>Conecta, S.A.</span><span class="fc">Conecta Norte, S.A.</span><span class="fc"><i:mas1:14>Nueva</span></div>')
# --- 5.1 Empresa y fiscal
c1=EMP+T('''<section class="isla pan" style="flex:1">
 <div style="padding:12px 18px;border-bottom:1px solid #F1F5F9"><<seg>></div>
 <div class="sc" style="flex:1;padding:14px 18px;display:{{t.datos.v}};gap:12px">
  <div style="flex:1.2;display:flex;flex-direction:column;gap:12px"><div class="g2"><<f1>><<f2>></div><div class="g2"><<f3>><<f4>></div><<f5>><div class="g2"><<f6>><<f7>></div></div>
  <section class="cd" style="width:300px;flex:0 0 auto;align-self:flex-start;align-items:center;gap:10px"><div class="cdh" style="align-self:stretch"><i:img:15>Logo en documentos</div><span style="width:96px;height:96px;border-radius:28px;background:linear-gradient(135deg,#4F46E5,#06B6D4)"></span><div class="m2" style="text-align:center">PNG o SVG · se usa en facturas, recibos y portal</div><button class="btn o sm"><i:subir:14>Cambiar logo</button></section>
 </div>
 <div class="sc" style="flex:1;padding:14px 18px;display:{{t.fis.v}};gap:12px">
  <div style="flex:1;display:flex;flex-direction:column;gap:12px"><<x1>><<x2>></div><div style="flex:1;display:flex;flex-direction:column;gap:12px"><<x3>><<x4>></div>
 </div>
 <div class="sc" style="flex:1;padding:14px 18px;display:{{t.fel.v}};gap:12px">
  <div style="flex:1;display:flex;flex-direction:column;gap:12px"><<y1>><<y2>></div><div style="flex:1;display:flex;flex-direction:column;gap:12px"><<y3>></div>
 </div>
 <div class="pf" style="padding:12px 18px"><span class="m2" style="flex:1">Cada empresa tiene su NIT, sus cuentas y su libro. Nada se mezcla entre empresas.</span><button class="btn g">Descartar</button><button class="btn p">Guardar</button></div>
</section>''',seg=seg('t',[('datos','Datos de la empresa','edif'),('fis','Régimen e impuestos','fin'),('fel','Factura electrónica (FEL)','escudo')]),
 f1=campo('Nombre comercial','Conecta',True),f2=campo('Razón social','Conecta, Sociedad Anónima',True),f3=campo('NIT','8123456-7',True),f4=campo('País','Guatemala · GTQ',False,'auto','Cambiarlo es una acción aparte'),f5=campo('Dirección fiscal','4.ª avenida 3-20, zona 1, Chimaltenango',True,'','','mapa'),f6=campo('Teléfono de atención','7839-0000',False,'','','tel'),f7=campo('Correo de facturación','facturas@conecta.gt',False,'','','mail'),
 x1=cd('Régimen','fin',kv('ISR','<b>Régimen opcional simplificado</b> · 5 % / 7 %')+kv('IVA','<b>General 12 %</b> · pago mensual')+kv('Vigente desde','1 ene 2026')+T('<div style="padding-top:8px"><button class="btn o sm"><i:cambio:14>Cambiar de régimen</button></div>')),
 x2=cd('Frases de la factura','doc',kv('Frase 1','Sujeto a pagos trimestrales ISR')+kv('Frase 2','Agente de retención del IVA: no'),lnk='Editar'),
 x3=cd('Establecimientos','mapa',kv('1 · Casa matriz','4.ª av. 3-20 z.1 · serie A')+kv('2 · Agencia Tecpán','1.ª calle 4-11 · serie B'),lnk='Agregar'),
 x4=cd('Parámetros con historial','hist',kv('Tasa de IVA','12 % · desde 2001')+kv('Tope de pequeño contribuyente','Q 150,000 al año')+T('<div class="m2" style="margin-top:6px">Un cambio de ley se registra con su fecha; lo anterior no se reescribe.</div>'),lnk='Ver todo'),
 y1=cd('Certificador','escudo',kv('Proveedor','<b>INFILE</b>')+kv('Modo','<span class="segb"><button class="ts">Pruebas</button><button class="ts on">Producción</button></span>')+kv('Credenciales',B('ok','Probadas hoy 06:00','check')+' <button class="lnk">Cambiar</button>')),
 y2=cd('Qué se certifica','fac',row('Facturas al emitirlas','Sin certificar no son deuda',tgl(True))+row('Notas de crédito','',tgl(True))+row('Recibos de cobro','No son documento fiscal',tgl(False))),
 y3=cd('Contingencia','alerta',T('<div class="av2 ok" style="padding:8px 12px"><i:ok:16><div>El certificador responde. Sin documentos en espera.</div></div>')+row('Entrar en contingencia sola','Si INFILE no responde por 10 min; se certifican al volver',tgl(True))+kv('Últimos 30 días','4,812 certificados · 3 rechazados <button class="lnk">Ver</button>')))
conf('emp','Empresa y fiscal','Los datos legales con los que se factura y se declara','',c1,'OperConfigEmpresa.dc.html','Configuración · Empresa y fiscal',{'t':(['datos','fis','fel'],'datos')})
# --- 5.2 Facturación y cobro
ctas=[('Banrural','3-044-12345-6','Monetaria · GTQ','Depósitos del portal',1,1),('Banco Industrial','029-004411-2','Monetaria · GTQ','Transferencias',1,1),('G&T Continental','001-0099887-1','Ahorro · GTQ','ACH',1,0),('BAC','90-112233-4','Monetaria · USD','Proveedores',0,0)]
bancos=['Banrural','Banco Industrial','G&T Continental','BAC','BAM','Bantrab','Promerica','Ficohsa','Inmobiliario','Azteca','Vivibanco','CHN']
c2=EMP+T('''<section class="isla pan" style="flex:1">
 <div style="padding:12px 18px;border-bottom:1px solid #F1F5F9"><<seg>></div>
 <div style="flex:1;min-height:0;display:{{t.ctas.v}};flex-direction:column">
  <div style="display:flex;gap:8px;align-items:center;padding:12px 18px"><div class="av2 nf" style="flex:1;padding:8px 12px"><i:info:16><div>Estas son las cuentas donde depositan los clientes. Argos es la única fuente: el portal, caja e Iris leen esta lista.</div></div><button class="btn p sm"><i:mas1:14>Agregar cuenta</button></div>
  <div class="lh" style="grid-template-columns:minmax(0,1.2fr) 170px 150px minmax(0,1fr) 150px 80px"><span>Banco</span><span>Número</span><span>Tipo</span><span>Alias</span><span>Se ofrece al cliente</span><span>Activa</span></div>
  <div class="sc" style="flex:1"><<ctas>></div></div>
 <div style="flex:1;min-height:0;display:{{t.ban.v}};flex-direction:column;padding:14px 18px;gap:12px">
  <div style="display:flex;gap:8px;align-items:center"><span class="busca" style="flex:1"><i:bus:15>Buscar banco…</span><button class="btn p sm"><i:mas1:14>Agregar banco <span class="nuevo">nuevo</span></button></div>
  <div class="m2">Al cobrar una transferencia, el cajero elige de aquí el banco de donde viene el dinero. También lo usa el portal y la conciliación.</div>
  <div style="display:flex;flex-wrap:wrap;gap:8px"><<ban>></div></div>
 <div style="flex:1;min-height:0;display:{{t.pla.v}};padding:14px 18px;gap:12px;align-items:flex-start;align-content:flex-start;flex-wrap:wrap">
  <<l1>><<l2>><<l3>><<l4>></div>
 <div style="flex:1;min-height:0;display:{{t.reg.v}};flex-direction:column">
  <div class="sc" style="flex:1;padding:14px 18px;display:flex;gap:12px;align-items:flex-start">
   <div style="flex:1;display:flex;flex-direction:column;gap:12px;min-width:0"><<g1>><<g2>></div>
   <div style="flex:1;display:flex;flex-direction:column;gap:12px;min-width:0"><<g3>></div>
  </div>
  <div class="pf" style="padding:12px 18px"><span class="m2" style="flex:1">De Conecta, S.A. · cada empresa tiene sus reglas · último cambio: Ana Cruz, 20 nov</span><button class="btn g">Descartar</button><button class="btn p">Guardar</button></div>
 </div>
</section>''',seg=seg('t',[('ctas','Cuentas bancarias','banco',4),('ban','Bancos de origen','lista',12),('pla','Plantillas y conceptos','doc'),('reg','Reglas de cobro y libro','escudo')]),
 g1=cd('Asientos manuales','fin',rowx('Pedir aprobación de otro usuario','El asiento de ajuste queda como borrador en Libro › Por aprobar hasta que otra persona lo aprueba. Quien lo crea no puede aprobarlo.',tgl(False))+T('<div class="m2" style="margin-top:6px">De fábrica: apagado (el asiento entra directo al libro).</div>')),
 g2=cd('Pausa sin cobro','pausa',rowx('Tope de días','Lo más que puede durar una pausa sin cobro (1 a 365)',T('<div class="in" style="width:120px;padding:7px 10px;justify-content:space-between"><b class="num">90</b><span class="m2">días</span></div>'))+T('<div class="m2" style="margin-top:6px">La suspensión normal sigue facturando; la pausa sin cobro pide su propio permiso y motivo.</div>')),
 g3=cd('Facturas de meses pasados','cal',T('<div class="av2 nf" style="align-items:flex-start"><i:info:16><div>Los <b>días de gracia antes del corte</b> no son un ajuste: los escribe quien emite, en «Emitir facturas por periodo», para cada emisión.</div></div>')),
 ctas=''.join(T('<div class="lr" style="grid-template-columns:minmax(0,1.2fr) 170px 150px minmax(0,1fr) 150px 80px"><div style="display:flex;gap:10px;align-items:center"><span class="ico nf" style="width:34px;height:34px;border-radius:10px"><i:banco:16></span><b><<a>></b></div><span class="mono"><<b>></span><span><<c>></span><span class="el m2" style="color:#334155"><<d>></span><<e>><<f>></div>',a=a,b=b,c=c,d=d,e=tgl(e),f=tgl(f)) for a,b,c,d,f,e in ctas),
 ban=''.join(T('<span class="fc" style="padding:9px 14px"><i:banco:14><<b>></span>',b=b) for b in bancos),
 l1=cd('Plantillas de facturación','cal',kv('Residencial día 1','1,102 servicios')+kv('Residencial día 15','84')+kv('Empresarial 30 días','61'),lnk='Abrir',st='flex:1'),l2=cd('Plantillas de documentos','imp',kv('Factura','Carta · POS 80 mm')+kv('Recibo de cobro','POS 80 mm')+kv('Aviso de cobro','Carta'),lnk='Abrir',st='flex:1'),l3=cd('Conceptos de cargo único','tag',kv('Instalación','Q 150.00')+kv('Cambio de domicilio','Q 150.00')+kv('Equipo no devuelto','según equipo'),lnk='Abrir',st='flex:1'),
 l4=cd('Adicionales','mas1',kv('<span style="display:flex;gap:6px;align-items:center;color:#0F172A"><b>IP pública fija</b> <span class="b cy" style="font-size:11px;padding:1px 7px">tipo IP pública</span></span>','Q 75.00 /mes')+kv('Streaming Plus','Q 45.00 /mes')+T('<div class="m2" style="margin-top:6px">El tipo «IP pública» cambia la IP del servicio por una de la red pública de su router y la libera al quitarlo. Los planes empresariales pueden traerla incluida.</div>'),lnk='Abrir',st='flex:1 1 100%'))
conf('cob','Facturación y cobro','Cuentas donde pagan los clientes, bancos de origen, plantillas y conceptos','',c2,'OperConfigCobro.dc.html','Configuración · Facturación y cobro',{'t':(['ctas','ban','pla','reg'],'ctas')})
# --- 5.3 Red y portal
ALC=T('<div style="display:flex;gap:8px;align-items:center;flex:0 0 auto"><span class="m2">Ajustes para</span><span class="fc {{a.glob.cls}}" onClick="{{a.glob.ir}}"><i:globo:14>Todas las empresas</span><span class="fc {{a.emp.cls}}" onClick="{{a.emp.ir}}"><i:edif:14>Conecta, S.A.</span><span class="fc"><i:edif:14>Conecta Norte, S.A.</span><span class="m2" style="margin-left:6px">Lo que cambies en una empresa manda sobre «Todas»</span></div>')
EMPB=lambda: T('<span class="b nf" style="font-size:11px;padding:1px 7px;display:{{a.glob.v}}"><i:edif:11>Cada empresa puede cambiarlo</span><span class="b ne" style="font-size:11px;padding:1px 7px;display:{{a.emp.v}}"><i:globo:11>Usa el de todas</span>')
GLOB=lambda: T('<span class="b ne" style="font-size:11px;padding:1px 7px"><i:candado:11>Para todas las empresas</span>')
GLK=lambda h: T('<div style="display:{{a.emp.v}}" class="av2 nf"><i:candado:15><div>Esto es igual para todas las empresas: se cambia en «Todas las empresas».</div></div><div style="display:{{a.glob.v}};flex-direction:column">')+h+'</div>'
num=lambda v,u,w=110: T('<div class="in" style="width:<<w>>px;padding:7px 10px;justify-content:space-between"><b class="num"><<v>></b><span class="m2"><<u>></span></div>',v=v,u=u,w=w)
c3=ALC+T('''<section class="isla pan" style="flex:1"><div style="padding:12px 18px;border-bottom:1px solid #F1F5F9;display:flex;align-items:center;gap:10px"><<seg>></div><div class="sc" style="flex:1;padding:14px 18px;display:{{t.cor.v}};gap:12px">
 <div style="flex:1;display:flex;flex-direction:column;gap:12px;min-width:0"><<a>><<b>></div>
 <div style="flex:1;display:flex;flex-direction:column;gap:12px;min-width:0"><<c>><<d>></div>
</div>
<div class="sc" style="flex:1;padding:14px 18px;display:{{t.cai.v}};gap:12px">
 <div style="flex:1;display:flex;flex-direction:column;gap:12px;min-width:0"><<e>></div>
 <div style="flex:1;display:flex;flex-direction:column;gap:12px;min-width:0"><<f>></div>
</div>
<div class="sc" style="flex:1;padding:14px 18px;display:{{t.otr.v}};gap:12px">
 <div style="flex:1;display:flex;flex-direction:column;gap:12px;min-width:0"><<g>><<h>></div>
 <div style="flex:1;display:flex;flex-direction:column;gap:12px;min-width:0"><<i>></div>
</div><div class="pf" style="padding:12px 18px"><span class="m2" style="flex:1"><i:alerta:14> Cambiar la IP o el puerto del portal actualiza las reglas de corte en los 6 routers.</span><button class="btn g">Descartar</button><button class="btn p">Guardar y actualizar routers</button></div></section>''',
 a=cd('Portal de corte · a dónde van los suspendidos','corte',T('<div class="g3"><<f1>><<f2>><<f3>></div>',f1=campo('IPv4 del portal','190.56.12.70'),f2=campo('IPv6 (opcional)','~2001:db8::20'),f3=campo('Puerto','8443'))+T('<div class="lb" style="margin-top:12px">Al suspender un servicio</div><div class="g2"><<o1>><<o2>></div>',o1=op(True,'Mostrar el portal de corte','Ve su deuda y puede pagar'),o2=op(False,'Cortar del todo','Sin navegación ni portal'))),
 b=cd('Cómo se identifica al cliente cortado','id',row('Por su IP','Automático en routers con IP conocida',tgl(True))+row('Con un código','Para redes detrás de NAT: se le da un código de 6 dígitos',tgl(True))+rowx('El código que da el personal vale','Desde la ficha del servicio · de 5 a 60 minutos '+EMPB(),num('15','min'))+kv('Routers que usan código','MK Torre San Juan · MK Zona 4 <button class="lnk">Cambiar</button>')),
 c=cd('Portal del cliente','globo',kv('Dirección','<span class="copy">https://portal.conecta.gt</span>')+row('Contraseña inicial','La que recibe un cliente nuevo','<b>Su número de DPI</b> <button class="lnk">Cambiar</button>')+row('Pago en línea','Con la pasarela configurada',tgl(True))+row('Promesas desde el portal','Según la plantilla del servicio',tgl(True))),
 d=cd('Nodos del portal','serv',kv('portal-1 · Centro',B('ok','En línea'))+kv('portal-2 · Norte',B('ok','En línea'))+T('<div class="m2" style="margin-top:6px">Cada nodo sirve la página de corte cerca de sus routers.</div>'),lnk='Agregar nodo'),
 seg=seg('t',[('cor','Portal de corte','corte'),('cai','Caídas y fallas generales','alerta'),('otr','Retiro, historial de IP y acceso','hist')]),
 e=cd('Caídas repetidas de un servicio','onda',rowx('Avisar las caídas repetidas','Alerta en Conectados › Caídas repetidas y un ticket en Iris, uno por servicio mientras siga abierto '+EMPB(),tgl(True))+rowx('Cuántas caídas','De 2 a 50',num('3','caídas',130))+rowx('En cuánto tiempo','De 5 a 1,440 minutos',num('60','min'))+T('<div class="m2" style="margin-top:6px">De fábrica: 3 caídas en 60 minutos. Si el servicio está en una falla general, no se abre su ticket: va al ticket general.</div>')),
 f=cd('Falla general','alerta',GLK(rowx('Detectar fallas generales','Muchos servicios del mismo router, OLT, PON o zona caídos a la vez abren un incidente y un solo ticket en Iris '+GLOB(),tgl(True))+rowx('Cómo se mide','',T('<span class="segb"><button class="ts on">Porcentaje</button><button class="ts">Cantidad</button></span>'))+rowx('Umbral','Porcentaje de los servicios del router, OLT, PON o zona',num('30','%'))+rowx('Mínimo de servicios','Aunque el porcentaje se cumpla',num('5','serv.'))+rowx('En cuánto tiempo','De 1 a 60 minutos',num('5','min'))+T('<div class="av2 nf" style="margin-top:8px;padding:8px 12px"><i:info:15><div>Con MK Sur (410 servicios): se abre si se caen <b>123 o más en 5 minutos</b>.</div></div>'))),
 g=cd('Retiro de servicios','power',GLK(rowx('Pedir a Iris la orden de retiro','Y dejar el equipo en comodato «por recuperar». Al retirar se puede omitir si ya se entregó '+GLOB(),tgl(True)))),
 h=cd('Quién tenía una IP','net',GLK(rowx('Buscar hasta','Días hacia atrás en Red › Direcciones IP (30 a 3,650) '+GLOB(),num('730','días',130))+T('<div class="m2" style="margin-top:6px">Argos busca en sus propias sesiones. Lo más viejo lo guarda Horus: la búsqueda te lleva allá.</div>'))),
 i=cd('Acceso al panel','candado',GLK(rowx('Recuperar la contraseña por correo','Muestra «¿La olvidaste?» en el inicio de sesión y manda un enlace de un solo uso '+GLOB(),tgl(True)))))

conf('red','Red y portal','A dónde van los clientes suspendidos, caídas y fallas generales, y otros ajustes de operación','',c3,'OperConfigRed.dc.html','Configuración · Red y portal',{'t':(['cor','cai','otr'],'cor'),'a':(['glob','emp'],'glob')})
# --- 5.4 Notificaciones y plantillas
evs=[('Factura emitida','factura.emitida','Aviso de cobro con el PDF',1,1,0,1),('Factura por vencer','recordatorio · 2 días antes','Recordatorio',1,0,0,0),('Factura vencida','factura.vencida','Aviso de mora',1,1,0,0),('Servicio suspendido','servicio.estado_cambiado','Aviso de corte',1,0,1,0),('Pago recibido','pago.registrado','Recibo',1,1,0,0),('Promesa por vencer','recordatorio · 1 día antes','Recordatorio de promesa',1,0,0,0),('Comprobante rechazado','comprobante.rechazado','Motivo y qué hacer',1,0,0,0)]
canal=lambda i,n,e,k,d: T('<div class="card" style="padding:11px 14px;display:flex;align-items:center;gap:12px;flex:1;min-width:0"><span class="ico <<k>>"><i:<<i>>:19></span><div style="min-width:0;flex:1"><b style="font-size:14px"><<n>></b><div class="m2 el"><<d>></div></div><span class="b <<k>>"><<e>></span></div>',i=i,n=n,e=e,k=k,d=d)
ck=lambda o:'<span class="ck2 %s">%s</span>'%('on' if o else '',s('check',13) if o else '')
CN='minmax(0,1.3fr) minmax(0,1.2fr) 90px 80px 90px'
c4=T('''<div style="display:flex;gap:12px;flex:0 0 auto"><<k1>><<k2>><<k3>></div>
<div style="flex:1;min-height:0;display:flex;gap:12px">
 <section class="isla pan" style="flex:1;min-width:0">
  <div style="padding:12px 18px;display:flex;gap:10px;align-items:center"><<seg>><span style="flex:1"></span><span class="selp"><i:edif:15>Global<i:ab:14></span></div>
  <div class="lh" style="grid-template-columns:<<c>>"><span>Cuándo</span><span>Mensaje</span><span>WhatsApp</span><span>Correo</span><span>Telegram</span></div>
  <div class="sc" style="flex:1"><<rows>></div>
  <div class="pf m2"><i:info:14>Si el hecho nació en Iris (un pago por chat), Argos no avisa: lo hace Iris en la conversación.</div>
 </section>
 <aside class="isla pan" style="width:380px;flex:0 0 auto">
  <div class="ph2"><i:editar:17><div style="flex:1"><b>Aviso de mora</b><div class="m2">WhatsApp · al vencer una factura</div></div></div>
  <div class="sc" style="flex:1;padding:12px 18px;display:flex;flex-direction:column;gap:10px">
   <div class="in" style="align-items:flex-start;min-height:120px;line-height:1.5;font-size:13.5px"><span>Hola <span class="b nf">cliente.nombre</span>, tu factura de <span class="b nf">factura.periodo</span> del servicio <span class="b nf">servicio.codigo</span> venció. Debes <span class="b nf">factura.saldo</span>. Paga aquí: <span class="b nf">portal.enlace</span></span></div>
   <div style="display:flex;gap:6px;flex-wrap:wrap"><span class="rap" style="padding:5px 10px;font-size:12px"><i:mas1:12>Variable</span><span class="rap" style="padding:5px 10px;font-size:12px">servicio.nombre</span><span class="rap" style="padding:5px 10px;font-size:12px">promesa.vence</span></div>
   <div class="sec" style="margin:6px 0 0">Así le llega</div>
   <div style="background:#E7F8EE;border-radius:4px 16px 16px 16px;padding:10px 12px;font-size:13px;line-height:1.5;align-self:flex-start;max-width:92%">Hola Rosa, tu factura de noviembre del servicio S-000412 venció. Debes Q 250.00. Paga aquí: portal.conecta.gt/p/8Fk2<div class="m2" style="text-align:right;font-size:11px">08:00 ✓✓</div></div>
   <div class="av2 wa" style="padding:8px 12px;align-items:flex-start"><i:alerta:16><div>En WhatsApp el texto debe estar aprobado por Meta. Un cambio se envía a revisión desde Iris.</div></div>
  </div>
  <div class="pf"><button class="btn o sm"><i:enviar:14>Enviarme una prueba</button><span style="flex:1"></span><button class="btn p sm">Guardar</button></div>
 </aside>
</div>''',c=CN,seg=seg('t',[('cli','Avisos a clientes','usuarios'),('eq','Alertas al equipo','alerta'),('rec','Recordatorios','reloj')]),
 k1=canal('chat','WhatsApp por Iris','Conectado','ok','Número 7839-0000 · calidad alta'),k2=canal('mail','Correo','Conectado','ok','no-responder@conecta.gt'),k3=canal('enviar','Telegram','Sin configurar','ne','Bot para alertas del equipo'),
 rows=''.join(T('<div class="lr <<on>>" style="grid-template-columns:<<c>>"><div><b class="el" style="display:block"><<a>></b><div class="m2 mono el" style="font-size:11.5px"><<b>></div></div><span class="el"><<d>></span><<w>><<m>><<t>></div>',c=CN,on='on' if i==2 else '',a=a,b=b,d=d,w=ck(w),m=ck(m),t=ck(tg)) for i,(a,b,d,w,m,tg,_) in enumerate(evs)))
conf('not','Notificaciones','Por dónde se avisa a los clientes y al equipo, y qué dice cada mensaje','<button class="btn o"><i:hist:16>Envíos recientes</button>',c4,'OperConfigNotificaciones.dc.html','Configuración · Notificaciones y plantillas de mensajes',{'t':(['cli','eq','rec'],'cli')})
# --- 5.5 Integraciones
ints=[('Iris','chat','Soporte, órdenes, chat y avisos','Conectado','ok',1),('Horus','onda','Tráfico y seguridad de la red','Conectado','ok',0),('Pasarela de pago','tarjeta','Cobro con tarjeta en el portal','Modo de prueba','wa',0),('Factura electrónica','escudo','INFILE · certificador','Conectado','ok',0),('SmartOLT','router','Estado de las ONU','Próximamente','ne',0),('Asistentes de IA (MCP)','bot','Tokens con alcance acotado','2 tokens','nf',0)]
c5=T('''<div style="flex:1;min-height:0;display:flex;gap:12px">
 <section class="isla pan" style="width:380px;flex:0 0 auto"><div class="sc" style="flex:1"><<lst>></div></section>
 <section class="isla pan" style="flex:1;min-width:0">
  <div class="ph2"><span class="ico ok"><i:chat:19></span><div style="flex:1"><b style="font-size:17px">Iris</b> <span class="b ok">Conectado</span><div class="m2">https://iris.conecta.gt · contrato <b>0.12.0</b> · conectado por Ana Cruz el 18 nov</div></div><button class="btn o sm"><i:link:14>Abrir Iris</button><button class="btn r sm">Desconectar</button></div>
  <div class="sc" style="flex:1;padding:14px 18px;display:flex;flex-direction:column;gap:12px">
   <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px"><<m1>><<m2>><<m3>><<m4>></div>
   <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><<a>><<b>></div>
   <<c>>
  </div>
 </section>
</div>''',lst=''.join(T('<div class="lr <<on>>" style="grid-template-columns:38px minmax(0,1fr) auto"><span class="ico <<k>>" style="width:38px;height:38px"><i:<<i>>:18></span><div><b style="font-size:14px;display:block"><<a>></b><span class="m2"><<b>></span></div><span class="b <<k>>"><<e>></span></div>',on='on' if o else '',a=a,i=i,b=b,e=e,k=k) for a,i,b,e,k,o in ints),
 m1='<div class="kpi"><div class="l">Avisos a Iris hoy</div><b class="num">1,204</b></div>',m2='<div class="kpi"><div class="l">En cola</div><b class="num">0</b></div>',m3='<div class="kpi" style="background:#FEF2F2"><div class="l" style="color:#B91C1C">Fallidos</div><b class="num" style="color:#B91C1C">2</b></div>',m4='<div class="kpi"><div class="l">Última sincronización</div><b>hace 2 min</b></div>',
 a=cd('Qué puede hacer Iris en Argos','escudo',row('Registrar comprobantes y promesas','Desde el chat con el cliente',tgl(True))+row('Reconexión temporal','Fuera de horario o sin personal de caja',tgl(True))+row('Crear clientes y servicios','Al ganar un prospecto',tgl(True))+row('Cambiar equipos','Desde la orden del técnico',tgl(True))+kv('Empresas','Conecta, S.A. · Conecta Norte, S.A.')),
 b=cd('Usuarios vinculados','usuarios',kv('Ana Cruz','ana.cruz@iris · caja')+kv('Luis Tum','luis.tum@iris · soporte')+kv('Marvin Ajú','marvin@iris · técnico')+T('<div class="m2" style="margin-top:6px">Un usuario vinculado entra a Iris sin otra contraseña y sus acciones quedan con su nombre.</div>'),lnk='Ver los 14'),
 c=cd('Envíos que fallaron','alerta',T('<div class="kv2"><span style="color:#0F172A"><b class="mono" style="font-size:12px">servicio.estado_cambiado</b> · S-000530</span><span><span class="m2">hoy 09:12 · Iris respondió 502 · 3 intentos</span> <button class="lnk">Reintentar</button></span></div><div class="kv2"><span style="color:#0F172A"><b class="mono" style="font-size:12px">pago.registrado</b> · pago #20418</span><span><span class="m2">hoy 09:10 · tiempo agotado</span> <button class="lnk">Reintentar</button></span></div>'),lnk='Ver todos los envíos'))
conf('int','Integraciones','Los sistemas con los que Argos habla, con su estado y lo que se les permite','',c5,'OperConfigIntegraciones.dc.html','Configuración · Integraciones')
# --- 5.6 Importar desde Mikrowisp
pasos=[('1','Origen','ok'),('2','Qué traer','ok'),('3','Revisar','on'),('4','Importar','')]
prog=''.join(T('<button class="pc <<k>>"><span class="n"><<n>></span><<t>></button>'+('<span class="ln <<lk>>"></span>' if i<3 else ''),k=k,n=(s('check',13) if k=='ok' else n),t=t_,lk='ok' if k=='ok' else '') for i,(n,t_,k) in enumerate(pasos))
res=[('Clientes','1,312','1,298','14 sin teléfono o DPI','wa'),('Servicios','1,341','1,341','Todos con plan equivalente','ok'),('Planes','18','18','11 ya existían en Argos','ok'),('Facturas pendientes','486','486','Q 121,400.00','ok'),('Pagos históricos','22,410','22,395','15 sin factura: quedan como saldo a favor','wa'),('Promesas activas','31','31','','ok')]
CI='minmax(0,1fr) 110px 110px minmax(0,1.4fr) 120px'
c6=T('''<section class="isla" style="border-radius:20px;padding:12px 18px;display:flex;align-items:center;gap:8px;flex:0 0 auto"><<prog>></section>
<div style="flex:1;min-height:0;display:flex;gap:12px">
 <section class="isla pan" style="flex:1;min-width:0">
  <div class="ph2"><div style="flex:1"><b style="font-size:16px">Revisa antes de importar</b><div class="m2">Todavía no se ha guardado nada. Argos leyó <b>mikrowisp-2026-11-20.sql</b> (184 MB).</div></div><button class="btn o sm"><i:desc:14>Descargar el detalle</button></div>
  <div class="lh" style="grid-template-columns:<<c>>;border-top:0"><span>Qué</span><span class="r">En Mikrowisp</span><span class="r">Se importan</span><span>Nota</span><span>Estado</span></div>
  <div class="sc" style="flex:1"><<rows>>
   <div style="padding:14px 18px;display:flex;flex-direction:column;gap:10px">
    <div class="cd"><div class="cdh"><i:ok:15>Cuadre de saldos</div><<q1>><<q2>><<q3>></div>
   </div></div>
 </section>
 <aside class="isla pan" style="width:340px;flex:0 0 auto">
  <div class="ph2"><i:alerta:17><b>Para atender · 2</b></div>
  <div class="sc" style="flex:1;padding:12px 16px;display:flex;flex-direction:column;gap:10px">
   <div class="av2 wa" style="align-items:flex-start;flex-direction:column;gap:6px"><div><b>14 clientes sin teléfono o DPI</b><br>No se importan hasta completarlos.</div><div style="display:flex;gap:10px"><button class="lnk">Ver lista</button><button class="lnk">Importar igual, marcados</button></div></div>
   <div class="av2 wa" style="align-items:flex-start;flex-direction:column;gap:6px"><div><b>3 clientes no cuadran</b><br>Diferencia total Q 425.00.</div><button class="lnk">Revisar uno por uno</button></div>
   <div class="av2 nf" style="align-items:flex-start"><i:info:16><div>Puedes correrla otra vez: lo que ya entró no se duplica. No avisa a clientes ni corta a nadie; el siguiente corte decide con todo cargado.</div></div>
  </div>
  <div class="pf" style="padding:14px 16px"><button class="btn g"><i:izq:15>Atrás</button><button class="btn p" style="flex:1;justify-content:center;padding:12px">Importar 1,298 clientes</button></div>
 </aside>
</div>''',prog=prog,c=CI,rows=''.join(T('<div class="lr" style="grid-template-columns:<<c>>;cursor:default"><b><<a>></b><span class="num r"><<b>></span><b class="num r"><<d>></b><span class="m2 el" style="color:#334155"><<e>></span><span><span class="b <<k>>"><<t>></span></span></div>',c=CI,a=a,b=b,d=d,e=e,k=k,t='Listo' if k=='ok' else 'Revisar') for a,b,d,e,k in res),
 q1=kv('Saldo total por cobrar en Mikrowisp','<b class="num">Q 121,825.00</b>'),q2=kv('Saldo que quedará en Argos','<b class="num">Q 121,400.00</b>'),q3=kv('Diferencia','<b class="num" style="color:#B45309">Q 425.00</b> en 3 clientes'))
conf('imp','Importar desde Mikrowisp','Trae clientes, servicios, planes, facturas y pagos de tu sistema anterior, con revisión antes de guardar','<button class="btn o"><i:hist:16>Corridas anteriores</button>',c6,'OperConfigImportar.dc.html','Configuración · Importar desde Mikrowisp',migas=['Configuración','Importar datos','Mikrowisp'])
