# Pendientes del backend · 2: Fallas generales de red (incidentes, decisión del PM 31).
# API: GET/POST /incidentes-red, GET /incidentes-red/:id, GET /incidentes-red/:id/servicios (solo ids,
# por páginas), POST /incidentes-red/:id/cerrar. Validadores en app/core/validators_operacion.ts.
import os
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'pend_base.py')).read())

P = lambda **k: k
ALC = {'router': ('router', 'Router'), 'olt': ('olt', 'OLT'), 'pon': ('pon', 'Puerto PON'), 'zona': ('zona', 'Zona')}
inc = [
    P(id=42, g='abi', ai='router', alc='Router', nom='MK Sur · Escuintla', est='er', estI='falla', estT='Abierta · 1 h 12 min', org='Automática', orgT='395 de 410 servicios (96 %) cayeron en 5 min', desde='hoy 05:12', hasta='—', af='395', base='410', emp='Conecta, S.A. (380) · Conecta Norte (15)', mot='—', cie='—'),
    P(id=41, g='cer', ai='pon', alc='Puerto PON', nom='OLT Centro · PON 1/1/4', est='ne', estI='check', estT='Cerrada · se recuperó', org='Automática', orgT='31 de 58 servicios (53 %) cayeron en 5 min', desde='19 nov 22:40', hasta='19 nov 23:31', af='31', base='58', emp='Conecta, S.A. (31)', mot='—', cie='Se recuperó solo (51 min)'),
    P(id=40, g='cer', ai='zona', alc='Zona', nom='Zona 4 · Chimaltenango', est='ne', estI='check', estT='Cerrada por Ana Cruz', org='A mano · Ana Cruz', orgT='«Corte de energía de la EEGSA en la zona 4»', desde='17 nov 14:03', hasta='17 nov 18:20', af='122', base='122', emp='Conecta Norte (122)', mot='Corte de energía de la EEGSA en la zona 4', cie='«Volvió la energía» · Ana Cruz'),
    P(id=39, g='cer', ai='router', alc='Router', nom='MK Torre San Juan', est='ne', estI='check', estT='Cerrada · se recuperó', org='Automática', orgT='88 de 140 servicios (63 %) cayeron en 5 min', desde='12 nov 03:10', hasta='12 nov 03:42', af='88', base='140', emp='Conecta, S.A. (88)', mot='—', cie='Se recuperó solo (32 min)'),
]
afect = [('S-000881', 'María Coyoy', 'Fibra 30', 'Caído desde 05:12', 'er', 'Conecta, S.A.'), ('S-000882', 'Ferretería Escuintla', 'Pyme 100', 'Caído desde 05:12', 'er', 'Conecta, S.A.'),
         ('S-000890', 'José Ixcoy', 'Fibra 50', 'Volvió 06:01', 'ok', 'Conecta, S.A.'), ('S-000894', 'Pedro Ajú', 'Fibra 30', 'Caído desde 05:13', 'er', 'Conecta, S.A.'),
         ('S-000903', 'Colegio Mixto Sur', 'Pyme 200', 'Caído desde 05:12', 'er', 'Conecta Norte'), ('S-000911', 'Lucía Pop', 'Fibra 50', 'Caído desde 05:14', 'er', 'Conecta, S.A.'),
         ('S-000915', 'Hugo Chen', 'Fibra 100', 'Caído desde 05:12', 'er', 'Conecta, S.A.')]
CL = '28px minmax(0,1.3fr) minmax(0,1fr) 120px 110px 178px'
filas = T('''<sc-for list="{{inc}}" as="x"><div class="lr {{x.cls}}" style="grid-template-columns:<<c>>" onClick="{{x.ver}}">
 <span class="ico {{x.est}}" style="width:28px;height:28px;border-radius:9px"><span class="ti ti-{{x.ai}}" style="width:15px;height:15px"></span></span>
 <div style="min-width:0"><b class="el" style="display:block;font-size:14px">{{x.nom}}</b><div class="m2">{{x.alc}} · #{{x.id}}</div></div>
 <div class="el"><div class="el">{{x.org}}</div><div class="m2 el">{{x.orgT}}</div></div>
 <div><div>{{x.desde}}</div><div class="m2">hasta {{x.hasta}}</div></div>
 <div class="num"><b>{{x.af}}</b> <span class="m2">de {{x.base}}</span></div>
 <div><span class="b {{x.est}}"><span class="ti ti-{{x.estI}}" style="width:13px;height:13px"></span>{{x.estT}}</span></div>
</div></sc-for>''', c=CL)
CA = 'minmax(0,1fr) 150px'
arows = ''.join(T('<div class="lr" style="grid-template-columns:<<c>>;padding:9px 18px;cursor:default"><div style="min-width:0"><div style="display:flex;gap:6px;align-items:center"><span class="copy" style="font-size:12px"><<a>></span><b class="el"><<b>></b></div><div class="m2 el"><<p>> · <<em>></div></div><span><span class="b <<k>>" style="font-size:11.5px"><i:<<i>>:12><<e>></span></span></div>', c=CA, a=a, b=b, p=p, e=e, k=k, i='wifi' if k == 'ok' else 'corte', em=em) for a, b, p, e, k, em in afect)
det = T('''<aside style="width:470px;flex:0 0 auto;border-left:1px solid #F1F5F9;display:flex;flex-direction:column;min-height:0">
 <div style="padding:14px 18px;border-bottom:1px solid #F1F5F9">
  <div style="display:flex;align-items:center;gap:8px"><b style="font-size:17px;flex:1" class="el">{{incSel.nom}}</b><span class="b {{incSel.est}}"><span class="ti ti-{{incSel.estI}}" style="width:13px;height:13px"></span>{{incSel.estT}}</span></div>
  <div class="m2" style="margin-top:3px">Falla general #{{incSel.id}} · {{incSel.alc}}</div>
 </div>
 <div class="sc" style="flex:1;display:flex;flex-direction:column">
  <div style="padding:4px 18px 10px">
   <div class="kv2"><span>Cómo se abrió</span><span><b>{{incSel.org}}</b><span class="m2" style="display:block">{{incSel.orgT}}</span></span></div>
   <div class="kv2"><span>Desde / hasta</span><b>{{incSel.desde}} → {{incSel.hasta}}</b></div>
   <div class="kv2"><span>Empresas</span><span>{{incSel.emp}}</span></div>
   <div class="kv2"><span>Cierre</span><span>{{incSel.cie}}</span></div>
   <div class="kv2"><span>Soporte</span><span>Iris abrió <b>un ticket general</b> con todos los afectados <button class="lnk">Abrir en Iris</button></span></div>
  </div>
  <div class="av2 nf" style="margin:0 18px 10px;align-items:flex-start;padding:8px 12px"><i:info:16><div>Mientras siga abierta no se abren tickets por <b>caídas repetidas</b> de estos servicios. Se cierra sola cuando se recuperan.</div></div>
  <div style="display:flex;align-items:center;gap:8px;padding:8px 18px;background:#F8FAFC;border-top:1px solid #EEF0F5;border-bottom:1px solid #EEF0F5"><b style="font-size:13px">Servicios afectados ({{incSel.af}})</b><span style="flex:1"></span><span class="selp" style="height:30px;font-size:12px"><i:edif:13>Todas las empresas<i:ab:12></span></div>
  <<arows>>
 </div>
 <div class="pf"><span class="m2" style="flex:1">1–50 de 395</span><button class="ib" aria-label="Anterior" disabled style="opacity:.4"><i:izq:16></button><button class="ib" aria-label="Siguiente"><i:der:16></button><span style="width:10px"></span><button class="btn o" style="display:{{vCerrar}}" onClick="{{m.cerrar.ir}}"><i:check:15>Cerrar falla</button></div>
</aside>''', arows=arows)
encab = head('Fallas generales', 'Cuando muchos servicios del mismo router, OLT, PON o zona caen a la vez: un solo incidente y un solo ticket en Iris',
             TEMA_HINT + '<button class="btn p" style="padding:11px 20px" onClick="{{m.abrir.ir}}"><i:falla:16>Abrir falla general</button>', 'Ayuda: fallas generales y caídas repetidas')
lista = T('''<section class="isla pan" style="flex:1">
 <div style="display:flex;align-items:center;gap:10px;padding:12px 18px;border-bottom:1px solid #F1F5F9;flex:0 0 auto"><<seg>><span style="flex:1"></span><span class="m2">Umbral: 30 % y al menos 5 servicios en 5 min</span><button class="lnk">Cambiar</button></div>
 <div style="flex:1;min-height:0;display:flex">
  <div style="flex:1;min-width:0;display:flex;flex-direction:column">
   <div class="lh" style="grid-template-columns:<<c>>;border-top:0"><span></span><span>Dónde</span><span>Cómo se abrió</span><span>Desde</span><span>Afectados</span><span>Estado</span></div>
   <div class="sc" style="flex:1"><<filas>><div style="display:{{incVacio}};padding:40px;text-align:center;color:#64748B"><i:ok:28:#16A34A><div style="margin-top:8px">No hay fallas generales abiertas.</div></div></div>
  </div>
  <<det>>
 </div>
</section>''', c=CL, filas=filas, det=det, seg=seg('t', [('abi', 'Abiertas', 'falla', 1, 'rj'), ('cer', 'Cerradas', 'check', 14)]))
# ventanas
mabrir = dlg('abrir', 'falla', 'er', 'Abrir falla general', T('''<div class="segb" style="display:flex"><button class="ts on" style="flex:1;justify-content:center"><i:router:15>Router</button><button class="ts" style="flex:1;justify-content:center"><i:olt:15>OLT</button><button class="ts" style="flex:1;justify-content:center"><i:pon:15>Puerto PON</button><button class="ts" style="flex:1;justify-content:center"><i:zona:15>Zona</button></div>
 <div><div class="lb">Router<span class="req">*</span></div><div class="in sel" style="border:2px solid #4F46E5;box-shadow:0 0 0 4px rgba(79,70,229,.12)"><i:router:16:#94A3B8><b>MK Norte · Chimaltenango</b><span class="m2" style="margin-left:6px">253 servicios activos</span></div></div>
 <div style="display:{{e.dup.v}}" class="av2 er"><i:alerta:16><div style="flex:1"><b>Ya hay una falla abierta en MK Norte.</b> Ábrela para ver sus afectados.</div><button class="lnk">Ver #43</button></div>
 <div><div class="lb">Motivo<span class="req">*</span></div><div class="in ph">Ej.: se cayó el enlace del proveedor</div></div>
 <div class="av2 nf" style="align-items:flex-start"><i:info:16><div>Quedan como afectados los <b>253 servicios activos o limitados</b> del router, e Iris abre <b>un solo ticket general</b>. Necesitas acceso a todas sus empresas.</div></div>'''),
    '<button class="btn g" onClick="{{m.no.ir}}">Cancelar</button><button class="btn rr" onClick="{{m.no.ir}}">Abrir falla</button>', w=520)
mcerrar = dlg('cerrar', 'check', 'ok', 'Cerrar la falla de {{incSel.nom}}', '<div style="font-size:14px;color:#475569;line-height:1.5">Iris recibe el cierre de su ticket general. Si el router vuelve a caer, Argos abre una falla <b>nueva</b> sola (Iris reusa su ticket si pasa dentro de 30 min).</div><div><div class="lb">Motivo<span class="req">*</span></div><div class="in ph">Ej.: el proveedor restableció el enlace</div></div>',
              '<button class="btn g" onClick="{{m.no.ir}}">Volver</button><button class="btn p" onClick="{{m.no.ir}}"><i:check:15>Cerrar falla</button>', w=480)
G = {'t': (['abi', 'cer'], 'abi'), 'm': (['no', 'abrir', 'cerrar'], 'no'), 'e': (['no', 'dup'], 'no')}
L = {'inc': {'rows': inc, 'def': 42, 'por': 't', 'todos': None}}
extra = "out.velo = (st.m && st.m !== 'no') ? 'block' : 'none'; out.vCerrar = out.incSel.g === 'abi' ? 'inline-flex' : 'none';"
CSSM = mask(['router', 'olt', 'pon', 'zona', 'falla', 'check'])
pbuild('PendIncidentes.dc.html', 'Fallas generales de red', shell2('red', ['Red', 'Conectados ahora', 'Fallas generales'], encab + lista, VELO.replace('{{mOn}}', '{{velo}}') + mabrir + mcerrar), tlogic(G, L, extra), 900, CSSM)

# ---------------- teléfono ----------------
mres = T('''<div style="display:{{d.lista.v}};flex-direction:column;gap:8px">
 <div class="av2 er" style="align-items:flex-start"><i:falla:17><div><b>1 falla general abierta.</b> Iris ya tiene el ticket general.</div></div>
 <sc-for list="{{inc}}" as="x"><div class="card" style="padding:12px 14px;display:flex;flex-direction:column;gap:6px" onClick="{{d.det.ir}}">
  <div style="display:flex;align-items:center;gap:8px"><span class="ico {{x.est}}" style="width:32px;height:32px;border-radius:10px"><span class="ti ti-{{x.ai}}" style="width:16px;height:16px"></span></span><div style="flex:1;min-width:0"><b class="el" style="display:block;font-size:15px">{{x.nom}}</b><span class="m2">{{x.alc}} · desde {{x.desde}}</span></div></div>
  <div style="display:flex;align-items:center;gap:8px"><span class="b {{x.est}}"><span class="ti ti-{{x.estI}}" style="width:13px;height:13px"></span>{{x.estT}}</span><span style="flex:1"></span><span class="m2"><b style="color:#0F172A">{{x.af}}</b> de {{x.base}} afectados</span></div>
 </div></sc-for></div>''')
mdet = T('''<div style="display:{{d.det.v}};flex-direction:column;gap:10px">
 <section class="cd"><div style="display:flex;align-items:center;gap:8px"><b style="font-size:16px;flex:1">MK Sur · Escuintla</b><span class="b er"><i:falla:12>Abierta</span></div>
  <<k1>><<k2>><<k3>><<k4>></section>
 <section class="cd" style="padding:4px 14px"><div class="cdh" style="margin:10px 0 2px">Afectados (395)</div><<rows>><button class="lnk" style="padding:10px 0">Ver más</button></section>
</div>''', k1=kv('Cómo se abrió', 'Automática · 96 %'), k2=kv('Desde', 'hoy 05:12 · 1 h 12 min'), k3=kv('Empresas', '2'), k4=kv('Soporte', '<button class="lnk">Ticket en Iris</button>'),
    rows=''.join(T('<div class="kv2"><span style="color:#0F172A"><b><<a>></b> <span class="m2">· <<b>></span><span class="m2" style="display:block"><<p>></span></span><span class="b <<k>>" style="font-size:11px;padding:2px 8px"><<e>></span></div>', a=a, b=b, p=p, k=k, e=e.replace('Sin conexión desde', 'Caído')) for a, b, p, e, k, em in afect[:5]))
mbody = T('''<div style="height:100%;display:flex;flex-direction:column;position:relative">
<<top>>
<div style="padding:0 12px 8px;flex:0 0 auto;display:{{d.lista.v}}"><div class="segb" style="display:flex;width:100%"><button class="ts {{t.abi.cls}}" style="flex:1;justify-content:center" onClick="{{t.abi.ir}}">Abiertas <span class="c rj">1</span></button><button class="ts {{t.cer.cls}}" style="flex:1;justify-content:center" onClick="{{t.cer.ir}}">Cerradas</button></div></div>
<div class="sc" style="flex:1;padding:0 12px 12px"><<a>><<b>></div>
<div class="mbar" style="display:{{d.lista.v}}"><button class="btn p"><i:falla:16>Abrir falla general</button></div>
<div class="mbar" style="display:{{d.det.v}}"><button class="btn o"><i:check:16>Cerrar falla</button></div>
</div>''', top=mtop('Fallas generales', 'Red › Conectados ahora', '<button class="ib f" style="width:38px;height:38px;border-radius:999px" onClick="{{tTema}}" aria-label="Tema"><i:luna:17></button>'), a=mres, b=mdet)
pmbuild('PendIncidentesMovil.dc.html', 'Fallas generales · teléfono', mbody, tlogic({'d': (['lista', 'det'], 'lista'), 't': (['abi', 'cer'], 'abi'), 'm': (['no'], 'no')}, L), CSSM)
print('pend2 listo')
