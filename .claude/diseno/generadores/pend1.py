# Pendientes del backend · 1: Promociones de velocidad (decisiones del PM 18 y 34).
# API: GET/POST /promociones-velocidad, GET /promociones-velocidad/:id(/servicios),
# POST …/:id/servicios, POST …/:id/servicios/:servicioId/quitar, POST …/:id/cancelar,
# GET /servicios/:id/promociones-velocidad. Validadores en app/core/validators_operacion.ts.
import os
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'pend_base.py')).read())
tgl = lambda on: '<span class="tg %s"><i></i></span>' % ('on' if on else '')

# ---------------- datos de ejemplo (formas de la API: PromocionVelocidad, PromocionServicio) ----------------
P = lambda **k: k
promos = [
    P(id=1, g='vig', nom='Gamer nocturno', desc='Para los que juegan en línea de noche', vel='x2', velT='El doble de su plan', cuando='Franja diaria', hor='18:00 a 23:00 · lun a vie', per='1 dic 2026 – 31 ene 2027', precio='Gratis', precioT='No cambia la factura', n='24', est='ok', estI='rayo', estT='Aplicada ahora', ahora='18:00 a 23:00 · se quita sola a las 23:00', ver='7'),
    P(id=2, g='vig', nom='Navidad x2', desc='Todo diciembre al doble para clientes al día', vel='x2', velT='El doble de su plan', cuando='Días completos', hor='Todo el día', per='1 dic – 31 dic 2026', precio='Gratis', precioT='No cambia la factura', n='312', est='ok', estI='rayo', estT='Aplicada ahora', ahora='Todo el día hasta el 31 dic', ver='3'),
    P(id=3, g='vig', nom='Pyme turbo fin de mes', desc='Más subida para cierres contables', vel='Pyme 200', velT='Pasa a Pyme 200 (200/200 Mbps)', cuando='Franja diaria', hor='08:00 a 18:00 · días 25 a 31', per='25 nov – 31 dic 2026', precio='Q 900.00 /mes', precioT='Se cobra la diferencia, proporcional', n='9', est='wa', estI='reloj', estT='Fuera de su horario', ahora='Vuelve mañana a las 08:00', ver='2'),
    P(id=4, g='prog', nom='Vacaciones escolares', desc='Más velocidad para estudiantes', vel='x1.5', velT='Una vez y media su plan', cuando='Días completos', hor='Todo el día', per='15 ene – 15 feb 2027', precio='Gratis', precioT='No cambia la factura', n='0', est='nf', estI='cal', estT='Empieza el 15 ene', ahora='Todavía no empieza', ver='1'),
    P(id=5, g='ter', nom='Mundial 2026', desc='Partidos sin cortes', vel='x2', velT='El doble de su plan', cuando='Franja diaria', hor='10:00 a 22:00', per='11 jun – 19 jul 2026', precio='Gratis', precioT='No cambia la factura', n='204', est='ne', estI='check', estT='Terminada', ahora='Terminó el 19 jul', ver='4'),
    P(id=6, g='can', nom='Prueba Torre San Juan', desc='', vel='x3', velT='El triple de su plan', cuando='Días completos', hor='Todo el día', per='1 – 7 nov 2026', precio='Gratis', precioT='No cambia la factura', n='0', est='er', estI='x', estT='Cancelada', ahora='Cancelada el 2 nov: «el router no aguanta»', ver='2'),
]
asig = [('S-000412', 'Rosa Méndez', 'Fibra 50', '50/25 → 100/50 Mbps', 'ok', 'rayo', 'Aplicada ahora', 'MK Centro · RADIUS'),
        ('S-000731', 'Luis Coc', 'Fibra 100', '100/50 → 200/100 Mbps', 'ok', 'rayo', 'Aplicada ahora', 'MK Centro · RADIUS'),
        ('S-000655', 'Aura Batz', 'Fibra 30', '30/15 → 60/30 Mbps', 'ne', 'wifi', 'Sin sesión ahora', 'MK Norte · RADIUS'),
        ('S-000588', 'Carlos Ajú', 'Fibra 50', '50/25 → 100/50 Mbps', 'ok', 'rayo', 'Aplicada ahora', 'MK Centro · RADIUS'),
        ('S-000213', 'Tienda La Bendición', 'Fibra 50', '—', 'ne', 'x', 'Quitada el 3 dic · «la pidió quitar»', 'MK Norte · RADIUS')]

CL = 'minmax(0,1.4fr) 92px minmax(0,1.4fr) 104px 64px 156px'
filas = T('''<sc-for list="{{pr}}" as="p"><div class="lr {{p.cls}}" style="grid-template-columns:<<c>>" onClick="{{p.ver}}">
 <div style="display:flex;gap:10px;align-items:center;min-width:0"><span class="ico nf" style="width:34px;height:34px;border-radius:10px"><i:promo:17></span><div style="min-width:0"><b class="el" style="display:block;font-size:14px">{{p.nom}}</b><div class="m2 el">{{p.desc}}</div></div></div>
 <div><b>{{p.vel}}</b><div class="m2">{{p.cuando}}</div></div>
 <div class="el"><div class="el">{{p.per}}</div><div class="m2 el">{{p.hor}}</div></div>
 <div class="num">{{p.precio}}</div>
 <div class="num"><b>{{p.n}}</b> <span class="m2">serv.</span></div>
 <div><span class="b {{p.est}}"><span class="ti ti-{{p.estI}}" style="width:13px;height:13px"></span>{{p.estT}}</span></div>
</div></sc-for>
<div style="display:{{prVacio}};padding:40px;text-align:center;color:#64748B">No hay promociones aquí.</div>''', c=CL)
filas_asig = ''.join(T('''<div class="lr" style="grid-template-columns:minmax(0,1fr) 170px 28px;padding:10px 18px;cursor:default<<op>>"><div style="min-width:0"><div style="display:flex;gap:6px;align-items:center"><span class="copy" style="font-size:12px"><<a>></span><b class="el"><<b>></b></div><div class="m2 el"><<d>> · <<c>> · <<h>></div></div><span><span class="b <<e>>" style="font-size:11.5px"><i:<<i>>:12><<f>></span></span><button class="ib" title="Quitar la promoción de este servicio" aria-label="Quitar" style="width:28px;height:28px;display:<<vq>>" onClick="{{m.quitar.ir}}"><i:cerrar:15></button></div>''', a=a, b=b, c=c, d=d, e=e, i=i, f=f, h=h, op=';opacity:.6' if 'Quitada' in f else '', vq='none' if 'Quitada' in f else 'inline-flex') for a, b, c, d, e, i, f, h in asig)
detalle = T('''<aside style="width:440px;flex:0 0 auto;border-left:1px solid #F1F5F9;display:flex;flex-direction:column;min-height:0">
 <div style="padding:14px 18px;border-bottom:1px solid #F1F5F9">
  <div style="display:flex;align-items:center;gap:8px"><b style="font-size:17px;flex:1" class="el">{{prSel.nom}}</b><span class="b {{prSel.est}}"><span class="ti ti-{{prSel.estI}}" style="width:13px;height:13px"></span>{{prSel.estT}}</span></div>
  <div class="m2" style="margin-top:3px">{{prSel.ahora}}</div>
 </div>
 <div class="sc" style="flex:1;display:flex;flex-direction:column">
  <div style="padding:6px 18px 10px">
   <div class="kv2"><span>Velocidad</span><span><b>{{prSel.vel}}</b> <span class="m2">· {{prSel.velT}}</span></span></div>
   <div class="kv2"><span>Cuándo</span><span><b>{{prSel.cuando}}</b> <span class="m2">· {{prSel.hor}}</span></span></div>
   <div class="kv2"><span>Periodo</span><b>{{prSel.per}}</b></div>
   <div class="kv2"><span>Precio</span><span><b>{{prSel.precio}}</b> <span class="m2">· {{prSel.precioT}}</span></span></div>
   <div class="kv2"><span>Cómo se aplica</span><span class="m2" style="color:#334155">Sin cortar la sesión. En routers con velocidad por plan (PCQ o árbol) el servicio pasa al plan destino mientras dura y regresa solo.</span></div>
  </div>
  <div style="display:flex;align-items:center;gap:8px;padding:8px 18px;background:#F8FAFC;border-top:1px solid #EEF0F5;border-bottom:1px solid #EEF0F5"><b style="font-size:13px">Servicios ({{prSel.n}})</b><span style="flex:1"></span><span class="busca" style="height:32px;width:190px;font-size:12px"><i:bus:13>Código o cliente…</span></div>
  <<asig>>
  <div style="padding:10px 18px" class="m2">5 de 24 · <a href="#">Cargar más</a></div>
 </div>
 <div class="pf"><button class="btn r sm" onClick="{{m.cancelar.ir}}"><i:x:14>Cancelar promoción</button><span style="flex:1"></span><button class="btn p" onClick="{{m.asig.ir}}"><i:mas1:15>Asignar servicios</button></div>
</aside>''', asig=filas_asig)
lista = T('''<section class="isla pan" style="flex:1">
 <div style="display:flex;align-items:center;gap:10px;padding:12px 18px;border-bottom:1px solid #F1F5F9;flex:0 0 auto">
  <<seg>><span style="flex:1"></span><span class="busca" style="width:240px"><i:bus:15>Buscar promoción…</span>
 </div>
 <div style="flex:1;min-height:0;display:flex">
  <div style="flex:1;min-width:0;display:flex;flex-direction:column">
   <div class="lh" style="grid-template-columns:<<c>>;border-top:0"><span>Promoción</span><span>Velocidad</span><span>Periodo y horario</span><span>Precio</span><span>Servicios</span><span>Estado</span></div>
   <div class="sc" style="flex:1"><<filas>></div>
   <div style="padding:10px 18px;border-top:1px solid #F1F5F9;font-size:12px;color:#64748B;flex:0 0 auto;display:flex;gap:6px;align-items:center"><i:info:14>Las horas son de Guatemala. Una promoción nunca baja la velocidad ni el precio del plan.</div>
  </div>
  <<det>>
 </div>
</section>''', c=CL, filas=filas, det=detalle,
    seg=seg('t', [('vig', 'Vigentes', 'rayo', 3), ('prog', 'Programadas', 'cal', 1), ('ter', 'Terminadas', 'check', 1), ('can', 'Canceladas', 'x', 1)]))
encab = head('Promociones de velocidad', 'Más velocidad por días o en horas fijas, sin cortar la sesión',
             TEMA_HINT + '<button class="btn p" style="padding:11px 20px"><i:mas1:16>Nueva promoción</button>', 'Ayuda: promociones de velocidad')
pesta = T('<div style="display:flex;align-items:center;gap:8px;flex:0 0 auto"><div class="segb"><button class="ts"><i:gauge:15>Planes</button><button class="ts on"><i:promo:15>Promociones de velocidad</button></div><span class="m2">Planes y promociones viven en la misma pantalla de Red › Planes</span></div>')
inner = encab + pesta + lista
# ventanas
serv_opc = [('S-000498', 'Marco Tzul', 'Fibra 50 · MK Centro', 1, ''), ('S-000502', 'Julia Coy', 'Fibra 100 · MK Centro', 1, ''), ('S-000521', 'Gerson Pop', 'Fibra 50 · MK Sur', 0, 'MK Sur controla por plan: esta promoción es x2 y necesita plan destino'), ('S-000530', 'Andrea Lix', 'Fibra 30 · MK Norte', 0, '')]
masig = dlg('asig', 'mas1', 'nf', 'Asignar «{{prSel.nom}}»', T('''<span class="busca" style="height:42px;border:2px solid #4F46E5;box-shadow:0 0 0 4px rgba(79,70,229,.12);color:#0F172A"><i:bus:16:#4F46E5>S-0005</span>
 <div style="border:1px solid #E6E8F0;border-radius:14px;overflow:hidden"><<rows>></div>
 <div class="av2 nf" style="align-items:flex-start"><i:info:16><div><b>Todo o nada:</b> si uno de los elegidos no puede recibirla, no se asigna ninguno y te decimos cuál y por qué. Si el horario ya empezó, la velocidad sube al guardar.</div></div>''',
    rows=''.join(T('<div style="display:flex;gap:10px;align-items:center;padding:10px 12px;border-top:1px solid #F1F5F9<<op>>"><span class="ck2 <<on>>"><<chk>></span><div style="flex:1;min-width:0"><b><<a>></b> <span class="m2">· <<b>></span><div class="m2"><<c>></div><div style="display:<<vw>>;color:#B45309;font-size:12px;margin-top:2px;gap:4px;align-items:center"><i:alerta:12><<w>></div></div></div>', op=';opacity:.75' if w else '', on='on' if on else '', chk=s('check', 13) if on else '', a=a, b=b, c=c, w=w, vw='flex' if w else 'none') for a, b, c, on, w in serv_opc)),
    '<span class="m2" style="flex:1;align-self:center">2 elegidos</span><button class="btn g" onClick="{{m.no.ir}}">Cancelar</button><button class="btn p" onClick="{{m.no.ir}}"><i:check:15>Asignar 2</button>', w=520)
mquitar = dlg('quitar', 'x', 'wa', '¿Quitar la promoción a S-000412?', '<div style="font-size:14px;color:#475569;line-height:1.5">Rosa Méndez vuelve ahora a la velocidad de su plan (Fibra 50 · 50/25 Mbps), sin cortar la sesión. El resto de servicios sigue igual.</div><div><div class="lb">Motivo <span class="m2" style="font-weight:500">(opcional)</span></div><div class="in ph">Ej.: el cliente la pidió quitar</div></div>',
              '<button class="btn g" onClick="{{m.no.ir}}">No</button><button class="btn rr" onClick="{{m.no.ir}}">Quitar</button>', w=460)
mcancel = dlg('cancelar', 'x', 'er', 'Cancelar «{{prSel.nom}}»', '<div style="font-size:14px;color:#475569;line-height:1.5">Los <b>{{prSel.n}} servicios</b> vuelven a la velocidad de su plan ahora mismo, sin cortar la sesión. No se puede deshacer: para volver a darla se crea otra promoción.</div><div><div class="lb">Motivo<span class="req">*</span></div><div class="in ph">Ej.: el router no aguanta la carga</div></div><div class="m2">Si tiene precio, los días que ya tuvo se cobran en la próxima factura; los que faltan, no.</div>',
              '<button class="btn g" onClick="{{m.no.ir}}">Volver</button><button class="btn rr" onClick="{{m.no.ir}}">Cancelar promoción</button>', w=480)
G = {'t': (['vig', 'prog', 'ter', 'can'], 'vig'), 'm': (['no', 'asig', 'quitar', 'cancelar'], 'no')}
L = {'pr': {'rows': promos, 'def': 1, 'por': 't', 'todos': None}}
lg = tlogic(G, L, "out.velo = (st.m && st.m !== 'no') ? 'block' : 'none';")
CSSM = mask(['rayo', 'reloj', 'cal', 'check', 'x', 'wifi'])
pbuild('PendPromociones.dc.html', 'Promociones de velocidad', shell2('red', ['Red', 'Planes', 'Promociones de velocidad'], inner, VELO.replace('{{mOn}}', '{{velo}}') + masig + mquitar + mcancel), lg, 900, CSSM)

# ---------------- crear promoción (página) ----------------
sec = lambda n, t, d, body: f'<div style="display:grid;grid-template-columns:200px 1fr;gap:22px;padding:16px 0;border-top:1px solid #F1F5F9"><div><b style="font-size:14px">{n} · {t}</b><div class="m2" style="margin-top:3px;line-height:1.45">{d}</div></div><div style="display:flex;flex-direction:column;gap:12px;min-width:0">{body}</div></div>'
seg2 = lambda g, items: '<div class="segb" style="align-self:flex-start">' + ''.join(T('<button class="ts {{<<g>>.<<id>>.cls}}" onClick="{{<<g>>.<<id>>.ir}}"><i:<<i>>:15><<n>></button>', g=g, id=i, n=n, i=ic_) for i, n, ic_ in items) + '</div>'
dias = ''.join(f'<span class="fc{" on" if on else ""}" style="padding:7px 0;width:40px;justify-content:center">{d}</span>' for d, on in [('L', 1), ('M', 1), ('M', 1), ('J', 1), ('V', 1), ('S', 0), ('D', 0)])
s1 = sec(1, 'Lo básico', 'Cómo se llama y para qué es. Lo ve el personal, no el cliente.', '<div style="display:grid;grid-template-columns:1fr 1.4fr;gap:14px">' + campo('Nombre', 'Gamer nocturno', True) + campo('Descripción', '~Ej.: para los que juegan en línea de noche') + '</div>')
s2 = sec(2, 'Velocidad', 'Cuánto sube mientras dura.', seg2('v', [('mult', 'Multiplicar su plan', 'promo'), ('plan', 'Pasar a otro plan', 'gauge')]) + T('''
 <div style="display:{{v.mult.v}};gap:14px;align-items:flex-end"><div style="width:220px"><div class="lb">Multiplicador<span class="req">*</span></div><div class="dest" style="font-size:20px;padding:8px 12px"><button class="ib" aria-label="Menos"><i:baja:15></button><span style="flex:1;text-align:center">x 2</span><button class="ib" aria-label="Más"><i:sube:15></button></div><div class="ay">De x1.01 a x10, sobre el plan de cada servicio</div></div>
  <div class="av2 wa" style="flex:1;align-items:flex-start"><i:alerta:16><div>En routers que controlan la velocidad <b>por plan</b> (PCQ o árbol) no se puede multiplicar: ahí hace falta un plan destino.</div></div></div>
 <div style="display:{{v.plan.v}};gap:14px;align-items:flex-end"><div style="width:300px"><div class="lb">Plan destino<span class="req">*</span></div><div class="in sel" style="border:2px solid #4F46E5;box-shadow:0 0 0 4px rgba(79,70,229,.12)"><i:gauge:16:#94A3B8><b>Fibra 100</b> <span class="m2">· 100/50 Mbps</span></div><div class="ay">Debe estar en el router del servicio y tener la misma IPv6</div></div>
  <div class="av2 nf" style="flex:1;align-items:flex-start"><i:info:16><div>Mientras dura, el servicio <b>pasa a Fibra 100</b> y regresa solo a su plan. La factura sigue con su plan de siempre.</div></div></div>'''))
s3 = sec(3, 'Cuándo', 'Días completos o unas horas cada día, en hora de Guatemala.', '<div class="g2">' + campo('Empieza', '1 dic 2026 · 00:00', True, 'sel', '', 'cal') + campo('Termina', '31 ene 2027 · 23:59', True, 'sel', '', 'cal') + '</div>' + seg2('c', [('dias', 'Días completos', 'cal'), ('franja', 'Franja diaria', 'reloj')]) + T('''
 <div style="display:{{c.franja.v}};flex-direction:column;gap:10px"><div style="display:flex;gap:14px;align-items:flex-end;flex-wrap:wrap"><div style="width:130px"><div class="lb">Desde</div><div class="in sel"><i:reloj:15:#94A3B8>18:00</div></div><div style="width:130px"><div class="lb">Hasta</div><div class="in sel"><i:reloj:15:#94A3B8>23:00</div></div><div><div class="lb">Días</div><div style="display:flex;gap:5px"><<dias>></div></div></div>
  <div class="ay" style="margin:0">Si «hasta» es más temprano que «desde» (22:00 a 02:00), termina al día siguiente. Sin días marcados, todos los días.</div></div>
 <div style="display:{{c.dias.v}}" class="ay">Sube al empezar y baja al terminar, de forma continua.</div>''', dias=dias))
s4 = sec(4, 'Precio', 'Sin precio es gratis: la factura no cambia.', T('''<div style="display:flex;align-items:center;gap:12px"><span class="tg {{p.si.cls}}" onClick="{{p.si.ir}}" style="cursor:pointer"><i></i></span><div><b style="font-size:13px">Cobrar la promoción</b><div class="m2">Apagado = gratis</div></div></div>
 <div style="display:{{p.si.v}};gap:14px;align-items:flex-start"><div style="width:200px"><div class="lb">Precio mensual con la promoción</div><div class="in"><span class="m2">Q</span><b class="num">400.00</b></div></div>
  <div class="av2 nf" style="flex:1;align-items:flex-start"><i:fac:16><div>Se cobra la <b>diferencia</b> con el precio de su plan, <b>proporcional a los días</b> que tuvo la promoción, en una línea aparte: «Promoción de velocidad Gamer nocturno, 12 días». Con Fibra 50 (Q 250.00): Q 150.00 × 12 / 31 = <b>Q 58.06</b>. Si su plan ya cuesta más, no se cobra nada.</div></div></div>'''))
srvs = [('S-000412', 'Rosa Méndez', 'Fibra 50 · MK Centro · RADIUS', '100/50 Mbps', '', ''),
        ('S-000731', 'Luis Coc', 'Fibra 100 · MK Centro · RADIUS', '200/100 Mbps', 'cap', ''),
        ('S-000588', 'Carlos Ajú', 'Fibra 50 · MK Centro · RADIUS', '100/50 Mbps', 'sol', ''),
        ('S-000521', 'Gerson Pop', 'Fibra 50 · MK Sur · Árbol con PCQ', '→ plan destino', 'req inc', ''),
        ('S-000520', 'Ana Chávez', 'Fibra 30 · MK Sur · Árbol con PCQ', '→ plan destino', 'tmp', ''),
        ('S-000640', 'Finca La Esperanza', 'Radio 10 · MK Torre San Juan · PPPoE sin RADIUS', '20/6 Mbps', 'est', '')]
ERR = {
    'cap': ('Supera la capacidad del router', 'S-000731 · Luis Coc tendría 200/100 Mbps y MK Centro admite como máximo 150/150 Mbps por cliente.', 'Quítalo de la lista o usa un plan destino más bajo.', 'Quitar de la lista'),
    'sol': ('Se encima con otra promoción', 'S-000588 · Carlos Ajú ya tiene «Navidad x2» del 1 al 31 dic. Un servicio no puede tener dos promociones con fechas que se crucen, aunque sus horas no coincidan.', 'Cambia las fechas o quítalo de la lista.', 'Ver «Navidad x2»'),
    'req': ('Este router necesita un plan destino', 'S-000521 está en MK Sur, que controla la velocidad por plan (Árbol con PCQ). Ahí la promoción mueve el servicio a otro plan mientras dura; no se puede multiplicar.', 'Elige «Pasar a otro plan» en el paso 2.', 'Usar plan destino'),
    'inc': ('El plan destino no sirve para este servicio', 'Fibra 100 no se ofrece en MK Sur, o cambia la IPv6 de su casa (/56 → /48). El cambio de plan de la promoción no puede mover IPs.', 'Elige otro plan destino o quítalo de la lista.', 'Elegir otro plan'),
    'tmp': ('Choca con un plan temporal', 'S-000520 · Ana Chávez tiene plan temporal Fibra 50 del 1 al 15 dic, y en MK Sur los dos cambian el plan del servicio.', 'Espera a que termine el plan temporal o quítalo de la lista.', 'Ver el servicio'),
    'est': ('El router no puede subir la velocidad sin cortar', 'MK Torre San Juan usa PPPoE sin RADIUS: cambiar la velocidad obliga a reconectar al cliente.', 'Quítalo de la lista; ese router no admite promociones.', 'Quitar de la lista'),
}
def srow(a, b, c, d, errs, _x=''):
    vis = ' '.join(errs.split())
    marca = ''.join(T('<div style="display:{{e.<<k>>.v}};gap:6px;align-items:flex-start;margin-top:6px;color:#B91C1C;font-size:12.5px"><i:alerta:14><span><b><<t>>.</b> <<s>></span></div>', k=k, t=ERR[k][0], s=ERR[k][2]) for k in errs.split())
    return T('<div style="display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-top:1px solid #F1F5F9"><span class="copy" style="font-size:12px;margin-top:2px"><<a>></span><div style="flex:1;min-width:0"><b><<b>></b> <span class="m2">· <<c>></span><<mk>></div><span class="m2 num" style="white-space:nowrap"><<d>></span><button class="ib" aria-label="Quitar de la lista" style="width:26px;height:26px"><i:cerrar:14></button></div>', a=a, b=b, c=c, d=d, mk=marca)
s5 = sec(5, 'Servicios', 'A quién se le da. También se pueden agregar después.', '<span class="busca" style="height:40px"><i:bus:15>Buscar por código, cliente o router…</span><div style="border:1px solid #E6E8F0;border-radius:14px;overflow:hidden">' + ''.join(srow(*x) for x in srvs) + '</div>')
banner = ''.join(T('<div class="av2 er" style="display:{{e.<<k>>.v}};align-items:flex-start;margin:12px 0 4px"><i:alerta:18><div style="flex:1"><b><<t>></b><div style="margin-top:2px"><<d>></div><div style="margin-top:4px">No se guardó nada: la promoción se crea con todos sus servicios o con ninguno.</div></div><button class="btn o sm" style="flex:0 0 auto"><<a>></button></div>', k=k, t=v[0], d=v[1], a=v[3]) for k, v in ERR.items())
aside = T('''<aside style="width:360px;flex:0 0 auto;border-left:1px solid #F1F5F9;background:#FAFBFE;padding:18px 20px;display:flex;flex-direction:column;gap:12px;overflow:auto">
 <div class="sec" style="margin:0">Así queda</div>
 <div class="card" style="padding:14px"><div style="display:flex;align-items:center;gap:8px"><span class="ico nf" style="width:34px;height:34px;border-radius:10px"><i:promo:17></span><b style="font-size:15px;flex:1">Gamer nocturno</b><span class="b ok" style="display:{{p.no.v}}">Gratis</span><span class="b nf" style="display:{{p.si.v}}"><i:fac:12>Q 400.00 /mes</span></div>
  <div style="margin-top:8px"><<k1>><<k2>><<k3>></div></div>
 <div class="card" style="padding:14px"><b style="font-size:13px">Una semana</b>
  <div style="display:grid;grid-template-columns:22px 1fr;gap:4px 8px;margin-top:8px;font-size:11px;color:#64748B;align-items:center"><<sem>></div>
  <div style="display:flex;justify-content:space-between;margin:4px 0 0 30px" class="m2"><span>0 h</span><span>12 h</span><span>24 h</span></div></div>
 <div class="card" style="padding:14px"><b style="font-size:13px">Rosa Méndez · Fibra 50</b><div class="m2" style="margin-top:4px">50/25 Mbps → <b style="color:#0F172A">100/50 Mbps</b> de 18:00 a 23:00, lun a vie. Sin cortar su sesión.</div></div>
 <div style="margin-top:auto"></div>
</aside>''', k1=kv('Velocidad', 'x2 su plan'), k2=kv('Horario', '18:00–23:00 · L a V'), k3=kv('Servicios', '6'),
    sem=''.join(f'<span>{d}</span><span style="height:10px;border-radius:4px;background:#EEF0F5;position:relative;display:block"><i style="position:absolute;left:75%;width:20.8%;top:0;bottom:0;border-radius:4px;background:{"#4F46E5" if on else "transparent"}"></i></span>' for d, on in [('L', 1), ('M', 1), ('M', 1), ('J', 1), ('V', 1), ('S', 0), ('D', 0)]))
form = T('''<section class="isla" style="flex:1;min-height:0;border-radius:20px;display:flex;flex-direction:column;overflow:hidden">
 <header style="display:flex;align-items:center;gap:14px;padding:14px 22px;border-bottom:1px solid #F1F5F9;flex:0 0 auto">
  <button class="ib f" style="width:38px;height:38px;border-radius:999px" aria-label="Atrás"><i:izq:17></button>
  <div><b style="font-size:18px">Nueva promoción de velocidad</b><div class="m2">Se aplica por CoA, sin cortar la sesión · queda en la bitácora de cada servicio</div></div>
  <span style="flex:1"></span><<tema>><<ay>>
 </header>
 <div style="flex:1;min-height:0;display:flex">
  <div class="sc" style="flex:1;padding:4px 26px 20px"><<ban>><<s1>><<s2>><<s3>><<s4>><<s5>></div>
  <<aside>>
 </div>
 <footer style="display:flex;align-items:center;gap:10px;padding:14px 22px;border-top:1px solid #F1F5F9;background:#FCFCFE;flex:0 0 auto"><span class="m2">Puedes crearla sin servicios y asignarlos después.</span><span style="flex:1"></span><button class="btn g">Cancelar</button><button class="btn p" style="padding:11px 24px"><i:check:15>Crear y aplicar</button></footer>
</section>''', tema=TEMA_HINT, ay=AY('Ayuda: cómo se aplica una promoción'), ban=banner, s1=s1, s2=s2, s3=s3, s4=s4, s5=s5, aside=aside)
nota = nota_estados('Errores 422 al guardar (para revisar el diseño)', 'e', [('no', 'Ninguno'), ('cap', 'Capacidad'), ('sol', 'Se encima'), ('req', 'Requiere plan destino'), ('inc', 'Plan incompatible'), ('tmp', 'Plan temporal'), ('est', 'Router sin RADIUS')], 'right:44px;bottom:96px;width:330px')
G2 = {'v': (['mult', 'plan'], 'mult'), 'c': (['franja', 'dias'], 'franja'), 'p': (['no', 'si'], 'no'), 'e': (['no', 'cap', 'sol', 'req', 'inc', 'tmp', 'est'], 'no'), 'm': (['no'], 'no')}
pbuild('PendPromocionForm.dc.html', 'Nueva promoción de velocidad', shell2('red', ['Red', 'Planes', 'Promociones de velocidad', 'Nueva'], form, nota), tlogic(G2), 1000)

# ---------------- teléfono ----------------
mlist = T('''<div style="display:{{d.lista.v}};flex-direction:column;gap:8px">
 <sc-for list="{{pr}}" as="p"><div class="card" style="padding:12px 14px;display:flex;flex-direction:column;gap:6px" onClick="{{d.det.ir}}">
  <div style="display:flex;align-items:center;gap:8px"><span class="ico nf" style="width:32px;height:32px;border-radius:10px"><i:promo:16></span><b style="flex:1;font-size:15px" class="el">{{p.nom}}</b><b>{{p.vel}}</b></div>
  <div class="m2">{{p.per}} · {{p.hor}}</div>
  <div style="display:flex;align-items:center;gap:8px"><span class="b {{p.est}}"><span class="ti ti-{{p.estI}}" style="width:13px;height:13px"></span>{{p.estT}}</span><span style="flex:1"></span><span class="m2">{{p.n}} servicios · {{p.precio}}</span></div>
 </div></sc-for></div>''')
mdet = T('''<div style="display:{{d.det.v}};flex-direction:column;gap:10px">
 <section class="cd"><div style="display:flex;align-items:center;gap:8px"><b style="font-size:16px;flex:1">Gamer nocturno</b><span class="b ok"><i:rayo:12>Aplicada ahora</span></div>
  <<k1>><<k2>><<k3>><<k4>></section>
 <section class="cd" style="padding:4px 14px"><div class="cdh" style="margin:10px 0 2px">Servicios (24)</div><<rows>></section>
</div>''', k1=kv('Velocidad', '<b>x2</b> su plan'), k2=kv('Horario', '18:00–23:00 · L a V'), k3=kv('Periodo', '1 dic – 31 ene'), k4=kv('Precio', 'Gratis'),
    rows=''.join(T('<div class="kv2"><span style="color:#0F172A"><b><<a>></b> <span class="m2">· <<b>></span><span class="m2" style="display:block"><<d>></span></span><span class="b <<e>>" style="font-size:11px;padding:2px 8px"><<f>></span></div>', a=a, b=b, d=d, e=e, f=f.split(' ·')[0]) for a, b, c, d, e, i, f, h in asig[:4]))
mbody = T('''<div style="height:100%;display:flex;flex-direction:column;position:relative">
<<top>>
<div style="padding:0 12px 8px;flex:0 0 auto;display:{{d.lista.v}}"><div class="segb" style="display:flex;width:100%"><button class="ts {{t.vig.cls}}" style="flex:1;justify-content:center;padding:8px 4px" onClick="{{t.vig.ir}}">Vigentes</button><button class="ts {{t.prog.cls}}" style="flex:1;justify-content:center;padding:8px 4px" onClick="{{t.prog.ir}}">Programadas</button><button class="ts {{t.ter.cls}}" style="flex:1;justify-content:center;padding:8px 4px" onClick="{{t.ter.ir}}">Terminadas</button></div></div>
<div class="sc" style="flex:1;padding:0 12px 12px"><<a>><<b>></div>
<div class="mbar" style="display:{{d.lista.v}}"><button class="btn p"><i:mas1:16>Nueva promoción</button></div>
<div class="mbar" style="display:{{d.det.v}}"><button class="btn o" style="flex:0 0 auto;color:#B91C1C">Cancelar</button><button class="btn p"><i:mas1:16>Asignar servicios</button></div>
</div>''', top=mtop('Promociones de velocidad', 'Red › Planes', '<button class="ib f" style="width:38px;height:38px;border-radius:999px" onClick="{{tTema}}" aria-label="Tema"><i:luna:17></button>'), a=mlist, b=mdet)
pmbuild('PendPromocionesMovil.dc.html', 'Promociones de velocidad · teléfono', mbody, tlogic({'d': (['lista', 'det'], 'lista'), 't': (['vig', 'prog', 'ter', 'can'], 'vig'), 'm': (['no'], 'no')}, L), CSSM)
print('pend1 listo')
