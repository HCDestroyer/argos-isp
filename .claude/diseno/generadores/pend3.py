# Pendientes del backend · 3: envíos programados y correos externos (decisión del PM 6) e inventario 0.14.0
# (intentos de recuperación con verificación de Iris y vínculos de técnicos).
# API: GET/POST /reportes/envios, GET/PUT /reportes/envios/:id, GET /reportes/envios/:id/corridas,
# GET/POST /reportes/correos-externos, POST /reportes/correos-externos/:id/retirar (panel_financiero.ts);
# GET /inventario/unidades/:id/intentos-recuperacion (+ /verificar), POST /inventario/intentos-recuperacion/:id/decidir,
# GET /inventario/vinculos-tecnicos, POST /inventario/vinculos-tecnicos/conciliar (inventario_equipos.ts).
import os
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'pend_base.py')).read())
tgl = lambda on: '<span class="tg %s"><i></i></span>' % ('on' if on else '')

# ================= Envíos programados y correos externos =================
P = lambda **k: k
envs = [
    P(id=1, nom='Cartera vencida por zona', rep='Cartera vencida por antigüedad', fr='Cada lunes · 7:00', fmt='Excel', fi='excel', dest='Ana Castillo y gerencia@redesdelvalle.gt', prox='lun 23 nov 7:00', est='ok', estI='play', estT='Activo', emp='Redes del Valle'),
    P(id=2, nom='Cobranza diaria', rep='Cobranza del día', fr='Cada día · 19:30', fmt='PDF', fi='pdf', dest='Ana Castillo (dueña)', prox='hoy 19:30', est='ok', estI='play', estT='Activo', emp='Redes del Valle'),
    P(id=3, nom='Estado de resultados', rep='Estado de resultados', fr='Día 5 de cada mes · 8:00', fmt='PDF', fi='pdf', dest='contador@despachomm.gt', prox='5 dic 8:00', est='ok', estI='play', estT='Activo', emp='Consolidado (todas)'),
    P(id=4, nom='Bajas del mes', rep='Bajas y retiros', fr='Día 1 de cada mes · 7:00', fmt='CSV', fi='hoja', dest='Ana Castillo', prox='—', est='ne', estI='pausa', estT='Pausado', emp='Redes del Valle'),
]
CE = 'minmax(0,1.4fr) minmax(0,1fr) 90px minmax(0,1.2fr) 120px 110px'
efilas = T('''<sc-for list="{{env}}" as="x"><div class="lr {{x.cls}}" style="grid-template-columns:<<c>>" onClick="{{x.ver}}">
 <div style="min-width:0"><b class="el" style="display:block;font-size:14px">{{x.nom}}</b><div class="m2 el">{{x.rep}} · {{x.emp}}</div></div>
 <span class="el">{{x.fr}}</span>
 <span><span class="b ne"><span class="ti ti-{{x.fi}}" style="width:13px;height:13px"></span>{{x.fmt}}</span></span>
 <span class="el m2" style="color:#334155">{{x.dest}}</span>
 <span>{{x.prox}}</span>
 <span><span class="b {{x.est}}"><span class="ti ti-{{x.estI}}" style="width:13px;height:13px"></span>{{x.estT}}</span></span>
</div></sc-for>''', c=CE)
corr = [('lun 16 nov 7:00', '1 enviado · 1 omitido', 'wa', [('Ana Castillo', 'ok', 'Enviado'), ('gerencia@redesdelvalle.gt', 'wa', 'Omitido: el correo se retiró de la lista')]),
        ('lun 9 nov 7:00', '2 enviados', 'ok', [('Ana Castillo', 'ok', 'Enviado'), ('gerencia@redesdelvalle.gt', 'ok', 'Enviado')]),
        ('lun 2 nov 7:00', '1 enviado · 1 falló', 'er', [('Ana Castillo', 'ok', 'Enviado'), ('gerencia@redesdelvalle.gt', 'er', 'Falló: el servidor de correo no respondió')])]
corrh = ''.join(T('<div style="padding:10px 0;border-top:1px solid #F1F5F9"><div style="display:flex;align-items:center;gap:8px"><b style="font-size:13px"><<a>></b><span style="flex:1"></span><span class="b <<k>>" style="font-size:11.5px"><<b>></span></div><<r>></div>', a=a, b=b, k=k, r=''.join(T('<div class="m2" style="display:flex;gap:6px;align-items:center;margin-top:4px"><span class="dot" style="background:<<c>>"></span><span style="color:#334155"><<n>></span> · <<t>></div>', c={'ok': '#16A34A', 'wa': '#D97706', 'er': '#DC2626'}[kk], n=n, t=tt) for n, kk, tt in r)) for a, b, k, r in corr)
edet = T('''<aside style="width:420px;flex:0 0 auto;border-left:1px solid #F1F5F9;display:flex;flex-direction:column;min-height:0">
 <div style="padding:14px 18px;border-bottom:1px solid #F1F5F9"><div style="display:flex;align-items:center;gap:8px"><b style="font-size:17px;flex:1" class="el">{{envSel.nom}}</b><span class="b {{envSel.est}}"><span class="ti ti-{{envSel.estI}}" style="width:13px;height:13px"></span>{{envSel.estT}}</span></div><div class="m2" style="margin-top:3px">{{envSel.fr}} · {{envSel.fmt}} · próximo: {{envSel.prox}}</div></div>
 <div class="sc" style="flex:1;padding:8px 18px 12px">
  <div class="sec" style="margin:6px 0 4px">Para quién</div>
  <div class="kv2"><span style="color:#0F172A;display:flex;gap:8px;align-items:center"><i:user:15><b>Ana Castillo</b> <span class="m2">usuaria · dueña</span></span><span class="b ok" style="font-size:11px">Recibe</span></div>
  <div class="kv2"><span style="color:#0F172A;display:flex;gap:8px;align-items:center"><i:mail:15><span style="text-decoration:line-through;color:#94A3B8">gerencia@redesdelvalle.gt</span></span><span class="b wa" style="font-size:11px"><i:alerta:11>Retirado de la lista</span></div>
  <div class="av2 wa" style="margin-top:8px;padding:8px 12px;align-items:flex-start"><i:alerta:15><div>Un correo retirado deja de recibir; quítalo o pide al admin que lo vuelva a aprobar.</div></div>
  <div class="sec" style="margin:14px 0 2px">Últimas corridas</div><<corr>>
 </div>
 <div class="pf"><button class="btn o sm"><i:pausa:14>Pausar</button><button class="btn o sm"><i:editar:14>Editar</button><span style="flex:1"></span><button class="lnk">Ver el reporte</button></div>
</aside>''', corr=corrh)
envio = T('''<div style="display:{{t.env.v}};flex:1;min-height:0">
 <div style="flex:1;min-width:0;display:flex;flex-direction:column">
  <div class="lh" style="grid-template-columns:<<c>>;border-top:0"><span>Envío</span><span>Cada cuánto</span><span>Formato</span><span>Para quién</span><span>Próximo</span><span>Estado</span></div>
  <div class="sc" style="flex:1"><<f>></div>
  <div style="padding:10px 18px;border-top:1px solid #F1F5F9;font-size:12px;color:#64748B;display:flex;gap:6px;align-items:center"><i:info:14>Se programan desde cada reporte con «Programar envío». A un correo externo solo llegan reportes contables sin datos personales.</div>
 </div><<d>>
</div>''', c=CE, f=efilas, d=edet)
corx = [('contador@despachomm.gt', 'Despacho Morales & Asociados', 'Ana Castillo · 3 oct 2026', 'ok', 'check', 'Aprobado', 2), ('socio.inversion@gmail.com', 'Ernesto Ruiz (socio)', 'Ana Castillo · 12 ago 2026', 'ok', 'check', 'Aprobado', 1), ('auditoria@kpmg-gt.com', 'Auditoría externa 2026', 'Ana Castillo · 1 jul 2026', 'ok', 'check', 'Aprobado', 0), ('gerencia@redesdelvalle.gt', 'Gerencia (cuenta compartida)', 'Retirado por Ana Castillo · 14 nov', 'ne', 'x', 'Retirado', 1)]
CX = 'minmax(0,1.3fr) minmax(0,1fr) minmax(0,1.1fr) 110px 110px 90px'
correos = T('''<div style="display:{{t.cor.v}};flex:1;min-height:0;flex-direction:column">
 <div style="display:flex;gap:10px;align-items:center;padding:12px 18px"><div class="av2 nf" style="flex:1;padding:8px 12px"><i:escudo:16><div>Solo el admin aprueba correos de fuera de la empresa (contador, socios, auditoría). Reciben <b>solo reportes contables, sin datos personales de clientes</b>.</div></div><button class="btn p sm" onClick="{{m.apr.ir}}"><i:mas1:14>Aprobar un correo</button></div>
 <div class="lh" style="grid-template-columns:<<c>>"><span>Correo</span><span>De quién es</span><span>Aprobado</span><span>Envíos</span><span>Estado</span><span></span></div>
 <div class="sc" style="flex:1"><<rows>></div>
</div>''', c=CX, rows=''.join(T('<div class="lr" style="grid-template-columns:<<c>>;cursor:default<<op>>"><span class="mono el" style="font-size:12.5px"><<a>></span><span class="el"><<b>></span><span class="m2 el"><<d>></span><span class="m2"><<n>> programados</span><span><span class="b <<k>>"><i:<<i>>:12><<e>></span></span><button class="lnk" style="color:#B91C1C;display:<<vr>>" onClick="{{m.ret.ir}}">Retirar</button></div>', c=CX, a=a, b=b, d=d, k=k, i=i, e=e, n=n, op=';opacity:.65' if k == 'ne' else '', vr='inline' if k == 'ok' else 'none') for a, b, d, k, i, e, n in corx))
lista = T('''<section class="isla pan" style="flex:1">
 <div style="display:flex;align-items:center;gap:10px;padding:12px 18px;border-bottom:1px solid #F1F5F9;flex:0 0 auto"><<seg>><span style="flex:1"></span><span class="busca" style="width:240px"><i:bus:15>Buscar envío o correo…</span></div>
 <<a>><<b>>
</section>''', seg=seg('t', [('env', 'Envíos programados', 'enviar', 4), ('cor', 'Correos externos aprobados', 'mail', 3)]), a=envio, b=correos)
mapr = dlg('apr', 'mail', 'nf', 'Aprobar un correo externo', '<div class="g2">' + campo('Correo', 'contador@despachomm.gt', True, '', '', 'mail') + campo('De quién es', '~Ej.: Despacho Morales', True) + '</div><div class="m2">Queda en la bitácora con tu nombre. Lo pueden elegir quienes programan envíos de reportes contables.</div>',
           '<button class="btn g" onClick="{{m.no.ir}}">Cancelar</button><button class="btn p" onClick="{{m.no.ir}}"><i:check:15>Aprobar</button>', w=520)
mret = dlg('ret', 'x', 'wa', '¿Retirar contador@despachomm.gt?', '<div style="font-size:14px;color:#475569;line-height:1.5">Deja de recibir desde el próximo envío. Sus <b>2 envíos programados</b> siguen para los demás destinatarios y lo muestran como «Retirado de la lista».</div>',
           '<button class="btn g" onClick="{{m.no.ir}}">Volver</button><button class="btn rr" onClick="{{m.no.ir}}">Retirar</button>', w=460)
G = {'t': (['env', 'cor'], 'env'), 'm': (['no', 'apr', 'ret'], 'no')}
L = {'env': {'rows': envs, 'def': 1}}
encab = head('Envíos programados', 'Reportes que llegan solos por correo, y los correos de fuera que el admin aprobó', TEMA_HINT, 'Ayuda: envíos programados')
pbuild('PendEnviosReportes.dc.html', 'Envíos programados y correos externos', shell2('rep', ['Reportes', 'Envíos programados'], encab + lista, VELO.replace('{{mOn}}', '{{velo}}') + mapr + mret),
       tlogic(G, L, "out.velo = (st.m && st.m !== 'no') ? 'block' : 'none';"), 900, mask(['excel', 'pdf', 'hoja', 'play', 'pausa']))

# ================= Intentos de recuperación (declarar no recuperado) =================
VER = {'verificado': ('ok', 'escudo', 'Verificado por Iris'), 'pendiente': ('wa', 'reloj', 'Verificando con Iris'), 'no_verificado': ('er', 'x', 'No verificado'),
       'anterior': ('nf', 'info', 'Lo decide una persona'), 'aceptado': ('ok', 'check', 'Aceptado'), 'descartado': ('ne', 'x', 'Descartado')}
ints = [(3, '20 nov 10:42', 'Kevin Tum', 'Se negó', 'anterior', 'Registrado antes de la verificación (Iris 0.13)', 0, '14.4762, -90.8261 · ±9 m'),
        (2, '14 nov 16:05', 'Kevin Tum', 'Cliente ausente', 'no_verificado', 'No coincide con lo que Iris registró', 0, '14.4760, -90.8259 · ±35 m'),
        (1, '9 nov 09:12', 'Marvin Coc', 'Cliente ausente', 'verificado', 'Foto y ubicación confirmadas', 1, '14.4761, -90.8260 · ±6 m')]
def irow(n, f, tec, mot, v, vm, cuenta, ub):
    k, i, t = VER[v]
    acc = T('<div style="display:flex;gap:6px;margin-top:8px"><button class="btn o sm" onClick="{{m.dec.ir}}"><i:check:13>Aceptar</button><button class="btn o sm" onClick="{{m.dec.ir}}"><i:x:13>Descartar</button></div>') if v == 'anterior' else ''
    return T('''<div class="card" style="padding:12px 14px;display:grid;grid-template-columns:34px minmax(0,1fr) 210px 110px;gap:12px;align-items:start">
 <span class="ico ne" style="width:34px;height:34px;border-radius:10px;font-weight:700">#<<n>></span>
 <div style="min-width:0"><b><<mot>></b> <span class="m2">· <<f>></span><div class="m2">Técnico: <b style="color:#334155"><<tec>></b> · <i:pin:12> <<ub>></div><div style="display:flex;gap:10px;margin-top:6px"><button class="lnk"><i:foto:13> Ver foto en Iris</button><button class="lnk"><i:mapa:13> Ver en el mapa</button></div></div>
 <div><span class="b <<k>>"><i:<<i>>:12><<t>></span><div class="m2" style="margin-top:4px"><<vm>></div><<acc>></div>
 <div style="text-align:right"><span class="b <<ck>>"><i:<<ci>>:12><<ct>></span></div>
</div>''', n=n, mot=mot, f=f, tec=tec, ub=ub, k=k, i=i, t=t, vm=vm, acc=acc, ck='ok' if cuenta else 'ne', ci='check' if cuenta else 'x', ct='Cuenta' if cuenta else 'No cuenta')
inner = T('''<div style="display:flex;align-items:center;gap:12px;flex:0 0 auto">
 <span class="ico wa" style="width:48px;height:48px;border-radius:15px"><i:router:22></span>
 <div style="min-width:0"><h1 class="h1">Declarar no recuperado · ONU ZTE F660</h1><div class="sub"><span class="mono">ZTEG55CD98EF</span> · S-000099 · Pedro Ajú · retirado el 2 nov · <span class="b wa" style="font-size:11px">Por recuperar</span></div></div>
 <span style="flex:1"></span><<tema>><<ay>>
</div>
<div style="flex:1;min-height:0;display:flex;gap:12px">
 <section class="isla pan" style="flex:1;min-width:0">
  <div class="ph2"><b style="font-size:15px">Intentos de recuperación</b><span class="m2">del más nuevo al más viejo</span><span style="flex:1"></span><button class="btn o sm"><i:refresh:14>Volver a verificar con Iris</button></div>
  <div class="av2 nf" style="margin:12px 18px 0;padding:8px 12px;align-items:flex-start"><i:info:16><div>La ubicación y la autoría de cada intento las afirma Iris. Argos las verifica con Iris antes de contarlas.</div></div>
  <div class="sc" style="flex:1;padding:12px 18px;display:flex;flex-direction:column;gap:10px"><<rows>></div>
 </section>
 <aside class="isla pan" style="width:380px;flex:0 0 auto">
  <div class="ph2"><i:escudo:17><b>¿Se puede declarar?</b></div>
  <div class="sc" style="flex:1;padding:12px 18px;display:flex;flex-direction:column;gap:12px">
   <div class="card" style="padding:12px 14px"><div style="display:flex;justify-content:space-between"><span class="m2">Técnicos distintos que cuentan</span><b class="num">1 de 2</b></div><div class="bar" style="margin-top:6px"><i style="width:50%;background:#D97706"></i></div></div>
   <div class="card" style="padding:12px 14px"><div style="display:flex;justify-content:space-between"><span class="m2">Contactos con el cliente (panel)</span><b class="num">0 de 1</b></div><div class="bar" style="margin-top:6px"><i style="width:0%"></i></div><button class="btn o sm" style="margin-top:10px"><i:tel:14>Registrar un contacto</button></div>
   <div class="av2 wa" style="align-items:flex-start"><i:alerta:16><div><b>Todavía no.</b> Hacen falta 2 intentos de técnicos distintos o 1 contacto registrado. Decide el intento #3 o registra un contacto.</div></div>
   <div class="m2" style="line-height:1.45">El técnico nunca decide pérdidas ni cobros: la declaración la hace una persona en el panel y ofrece cobrar «Equipo no devuelto».</div>
  </div>
  <div class="pf"><button class="btn rr" style="flex:1;justify-content:center;opacity:.45;cursor:not-allowed" title="Falta un intento que cuente o un contacto"><i:alerta:15>Declarar no recuperado</button></div>
 </aside>
</div>''', tema=TEMA_HINT, ay=AY('Ayuda: equipos por recuperar'), rows=''.join(irow(*x) for x in ints))
mdec = dlg('dec', 'info', 'nf', 'Decidir el intento #3', T('''<div style="font-size:14px;color:#475569;line-height:1.5">Kevin Tum lo registró antes de que Iris verificara los intentos. Revisa la foto y la ubicación en Iris y decide.</div>
 <div class="segb" style="display:flex"><button class="ts on" style="flex:1;justify-content:center"><i:check:15>Aceptar: cuenta</button><button class="ts" style="flex:1;justify-content:center"><i:x:15>Descartar: no cuenta</button></div>
 <div><div class="lb">Motivo<span class="req">*</span></div><div class="in ph">Ej.: la foto muestra la casa del cliente</div></div>'''),
    '<button class="btn g" onClick="{{m.no.ir}}">Cancelar</button><button class="btn p" onClick="{{m.no.ir}}"><i:check:15>Guardar decisión</button>', w=480)
pbuild('PendIntentosRecuperacion.dc.html', 'Declarar no recuperado · intentos', shell2('inv', ['Inventario', 'Por recuperar', 'ZTEG55CD98EF', 'Declarar no recuperado'], inner, VELO.replace('{{mOn}}', '{{velo}}') + mdec),
       tlogic({'m': (['no', 'dec'], 'no')}, None, "out.velo = (st.m && st.m !== 'no') ? 'block' : 'none';"), 900)

# ================= Vínculos de técnicos de Iris =================
vin = [('iris-u-118', 'TEC-018', '—', 'er', 'x', 'Rechazado', 'Ese id ya lo usa otro técnico (Marvin Coc)', 'webhook · hoy 08:12', 'rech', 'conc_err'),
       ('iris-u-131', 'TEC-031', 'Jorge Lix', 'er', 'x', 'Rechazado', 'El usuario de Argos no tiene rol de técnico', 'webhook · ayer 17:40', 'rech', ''),
       ('iris-u-102', 'TEC-002', 'Kevin Tum', 'ok', 'link', 'Vinculado', '—', 'webhook · 2 nov', 'vinc', ''),
       ('iris-u-107', 'TEC-007', 'Marvin Coc', 'ok', 'link', 'Vinculado', '—', 'conciliación · 12 nov', 'vinc', ''),
       ('iris-u-099', 'TEC-099', 'Óscar Sis', 'ne', 'cerrar', 'Desvinculado', 'Desactivado en Iris', 'webhook · 30 oct', 'desv', '')]
CV = 'minmax(0,1fr) minmax(0,1fr) 140px minmax(0,1.5fr) 150px 120px'
vrow = lambda vv: ''.join(T('<div class="lr" style="grid-template-columns:<<c>>"><div><b class="mono" style="font-size:12.5px"><<a>></b><div class="m2">id externo <span class="mono"><<b>></span></div></div><span><<u>></span><span><span class="b <<k>>"><i:<<i>>:12><<e>></span></span><span class="el" style="color:<<mc>>"><<m>></span><span class="m2"><<o>></span><button class="btn o sm" style="justify-self:end"><i:refresh:13>Conciliar</button></div>', c=CV, a=a, b=b, u=u, k=k, i=i, e=e, m=m, mc='#B91C1C' if k == 'er' else '#64748B', o=o, g=g) for a, b, u, k, i, e, m, o, g, _ in vv)
vrows = ''.join('<div style="display:{{t.%s.b}}">%s</div>' % (g, vrow([x for x in vin if x[8] == g])) for g in ['rech', 'vinc', 'desv'])
vinner = head('Técnicos de Iris', 'Cómo se vincula cada técnico de Iris con su usuario de Argos para mover su bodega', TEMA_HINT, 'Ayuda: técnicos de Iris') + T('''
<section class="isla pan" style="flex:1">
 <div style="display:flex;align-items:center;gap:10px;padding:12px 18px;border-bottom:1px solid #F1F5F9;flex:0 0 auto"><<seg>><span style="flex:1"></span><span class="busca" style="width:240px"><i:bus:15>Técnico o usuario…</span></div>
 <div class="av2 er" style="margin:12px 18px 0;display:{{r.err.v}}"><i:alerta:16><div style="flex:1"><b>No se pudo conciliar:</b> el conector con Iris está apagado o sin token.</div><button class="lnk">Ir a Integraciones</button></div>
 <div class="av2 ok" style="margin:12px 18px 0;display:{{r.ok.v}}"><i:ok:16><div style="flex:1"><b>Conciliado con Iris:</b> iris-u-118 sigue rechazado; Iris todavía le asigna el id TEC-018.</div></div>
 <div class="av2 nf" style="margin:12px 18px 0;padding:8px 12px"><i:info:16><div>Llegan solos desde Iris. Solo sirven para inventario (bodega del técnico): <b>nunca autorizan cobros ni atención</b>. Si uno quedó rechazado, corrige el usuario en Argos o en Iris y concílialo.</div></div>
 <div class="lh" style="grid-template-columns:<<c>>;margin-top:12px"><span>Técnico en Iris</span><span>Usuario de Argos</span><span>Estado</span><span>Por qué</span><span>Origen</span><span></span></div>
 <div class="sc" style="flex:1"><<rows>></div>
</section>''', c=CV, rows=vrows, seg=seg('t', [('rech', 'Rechazados', 'x', 2, 'rj'), ('vinc', 'Vinculados', 'link', 2), ('desv', 'Desvinculados', 'cerrar', 1)]))
nota = nota_estados('Resultado de «Conciliar» (para revisar el diseño)', 'r', [('no', 'Nada'), ('ok', 'Aplicado'), ('err', '409 Iris apagado')], 'right:28px;bottom:28px;width:330px')
pbuild('PendVinculosTecnicos.dc.html', 'Técnicos de Iris · vínculos', shell2('inv', ['Inventario', 'Técnicos de Iris'], vinner, nota), tlogic({'t': (['rech', 'vinc', 'desv'], 'rech'), 'r': (['no', 'ok', 'err'], 'no'), 'm': (['no'], 'no')}), 900)
print('pend3 listo')
