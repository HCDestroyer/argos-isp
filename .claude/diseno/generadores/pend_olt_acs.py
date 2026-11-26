# Pendiente de aprobar: SmartOLT y ACS (contrato .claude/integration/contratos/equipos-olt-acs.md, 25 nov 2026).
# Tableros: PendSmartoltLista, PendSmartoltDetalle, PendSmartoltForm, PendAcs, PendEquipoServicio y sus versiones
# de teléfono (PendSmartoltMovil, PendSmartoltFormMovil, PendAcsMovil, PendEquipoServicioMovil).
# API que dibujan: GET/POST /integraciones/smartolt/instancias, GET/PUT/DELETE …/:id, POST …/:id/probar,
# POST /integraciones/smartolt/olts/:id/vincular, GET/PUT /integraciones/acs, POST /integraciones/acs/probar.
# Uso: python3 pend_olt_acs.py   ·   SALIDA_TABLEROS=/otra/carpeta python3 pend_olt_acs.py
import os
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'pend_base.py')).read())
tgl = lambda on: '<span class="tg %s"><i></i></span>' % ('on' if on else '')
ic.update({'candado2': ic['candado']})

# ---------------- datos de ejemplo (formas de la API: InstanciaSmartOlt, OltSmartOlt, ConfigAcs) ----------------
P = lambda **k: k
INS = [
    P(id=1, g='todas', nom='Zona norte', sub='zonanorte', emp='Conecta Norte, S.A.', comp=0, est='ok', estI='check', estT='Probada', n='3', pr='hoy 08:40', ap=0),
    P(id=2, g='todas comp', nom='Principal', sub='redesdelvalle', emp='Compartida', comp=1, est='ok', estI='check', estT='Probada', n='5', pr='hoy 08:40', ap=0),
    P(id=3, g='todas falla', nom='Costa sur', sub='costasur', emp='Conecta, S.A.', comp=0, est='er', estI='alerta', estT='Falla', n='2', pr='ayer 17:05', ap=0),
    P(id=4, g='todas', nom='Pruebas', sub='pruebas', emp='Conecta, S.A.', comp=0, est='ne', estI='reloj', estT='Sin probar', n='—', pr='Nunca', ap=1),
]
CI = '38px minmax(0,1.25fr) minmax(0,1.1fr) 142px 72px 118px 22px'


def chip(cls, ico, txt):
    return T('<span class="b <<c>>"><i:<<i>>:13><<t>></span>', c=cls, i=ico, t=txt)


def estado_tres(grupo='e'):
    """Los tres estados de una instancia como chips alternables (ok, falla, sin)."""
    return ''.join('<span style="display:{{%s.%s.b}}">%s</span>' % (grupo, k, chip(c, i, t)) for k, c, i, t in
                   [('ok', 'ok', 'check', 'Probada'), ('comp', 'ok', 'check', 'Probada'), ('falla', 'er', 'alerta', 'Falla'), ('sin', 'ne', 'reloj', 'Sin probar')])


# ---------------- lista de integraciones (izquierda) ----------------
def izq(sel):
    items = [('Iris', 'chat', 'Soporte, órdenes, chat y avisos', 'Conectado', 'ok', 0), ('Horus', 'onda', 'Tráfico y seguridad de la red', 'Conectado', 'ok', 0),
             ('Pasarela de pago', 'tarjeta', 'Cobro con tarjeta en el portal', 'Modo de prueba', 'wa', 0), ('Factura electrónica', 'escudo', 'INFILE · certificador', 'Conectado', 'ok', 0),
             ('SmartOLT', 'olt', 'Autoriza y mira las ONU (varias cuentas)', '', 'wa', 1), ('ACS (GenieACS)', 'cpu', 'Wi-Fi y PPPoE de la ONU', '', 'ok', 2),
             ('Asistentes de IA (MCP)', 'bot', 'Tokens con alcance acotado', '2 tokens', 'nf', 0)]
    out = ''
    for n, i, s_, e, k, tipo in items:
        on = 'on' if (tipo == 1 and sel == 'smartolt') or (tipo == 2 and sel == 'acs') else ''
        if tipo == 1:
            e = ('<span style="display:{{v.lista.b}}"><span class="b wa">2 de 4 operativas</span></span><span style="display:{{v.vacio.b}}"><span class="b ne">Sin instancias</span></span>'
                 '<span style="display:{{v.error.b}}"><span class="b er">No se pudo leer</span></span>')
        elif tipo == 2:
            e = ('<span style="display:{{a.ok.b}}"><span class="b ok">Conectado</span></span><span style="display:{{a.editar.b}}"><span class="b ok">Conectado</span></span>'
                 '<span style="display:{{a.falla.b}}"><span class="b er">Falla</span></span><span style="display:{{a.sin.b}}"><span class="b ne">Sin configurar</span></span>'
                 '<span style="display:{{a.apagado.b}}"><span class="b ne">Apagado</span></span>')
        else:
            e = '<span class="b %s">%s</span>' % (k, e)
        out += T('<div class="lr <<on>>" style="grid-template-columns:38px minmax(0,1fr) auto"><span class="ico <<k>>" style="width:38px;height:38px"><i:<<i>>:18></span><div style="min-width:0"><b style="font-size:14px;display:block"><<a>></b><span class="m2 el" style="display:block"><<b>></span></div><<e>></div>',
                 on=on, k='nf' if tipo else k if k != 'wa' else 'wa', i=i, a=n, b=s_, e=e)
    return '<section class="isla pan" style="width:380px;flex:0 0 auto"><div class="sc" style="flex:1">' + out + '</div></section>'


MIGAS = ['Configuración', 'Integraciones']
NOVE = 'Ayuda: SmartOLT y ACS'
SEL_OLT = lambda ok: ''

# =====================================================================================
# 1 · SmartOLT: lista de instancias
# =====================================================================================
filas = T('''<sc-for list="{{ins}}" as="x"><div class="lr {{x.cls}}" style="grid-template-columns:<<c>>" onClick="{{x.ver}}">
 <span class="ico {{x.est}}" style="width:38px;height:38px"><i:olt:18></span>
 <div style="min-width:0"><b class="el" style="display:block;font-size:14px">{{x.nom}}</b><div class="m2 mono el" style="font-size:11.5px">{{x.sub}}.smartolt.com</div></div>
 <div class="el"><span class="b nf" style="display:{{x.vcomp}}"><i:globo:13>Compartida</span><span class="el" style="display:{{x.vemp}}">{{x.emp}}</span></div>
 <div><span class="b {{x.est}}"><span class="ti ti-{{x.estI}}" style="width:13px;height:13px"></span>{{x.estT}}</span><div class="m2" style="display:{{x.vap}};margin-top:3px"><i:power:12> Apagada</div></div>
 <div class="num"><b>{{x.n}}</b> <span class="m2">OLT</span></div>
 <div class="m2">{{x.pr}}</div>
 <i:der:16:#94A3B8>
</div></sc-for>''', c=CI)
lista_ok = T('''<div style="display:{{v.lista.v}};flex:1;min-height:0;flex-direction:column">
 <div style="display:flex;align-items:center;gap:10px;padding:12px 18px;border-bottom:1px solid #F1F5F9;flex:0 0 auto"><<seg>><span style="flex:1"></span><span class="busca" style="width:300px"><i:bus:15>Buscar instancia…</span></div>
 <div class="av2 nf" style="margin:12px 18px 12px;padding:8px 12px;align-items:flex-start;flex:0 0 auto"><i:info:16><div>Cada instancia es una cuenta de SmartOLT (un subdominio). Una puede ser <b>compartida</b> entre empresas y solo la administra quien tiene acceso a todas. Wi-Fi y PPPoE de la ONU no se configuran aquí: eso lo hace el <b>ACS</b>.</div></div>
 <div class="lh" style="grid-template-columns:<<c>>;border-top:0"><span></span><span>Instancia</span><span>Empresas</span><span>Estado</span><span>OLT</span><span>Última prueba</span><span></span></div>
 <div class="sc" style="flex:1"><<f>></div>
</div>''', c=CI, f=filas, seg=seg('t', [('todas', 'Todas', 'olt', 4), ('comp', 'Compartidas', 'globo', 1), ('falla', 'Con falla', 'alerta', 1, 'rj')]))
lista_vacio = T('''<div style="display:{{v.vacio.v}};flex:1;min-height:0;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:40px;text-align:center">
 <span class="ico nf" style="width:64px;height:64px;border-radius:20px"><i:olt:30></span>
 <b style="font-size:18px">Todavía no hay cuentas de SmartOLT</b>
 <div class="m2" style="max-width:440px;font-size:13.5px;line-height:1.5">Agrega la cuenta (subdominio y token) de tu SmartOLT para autorizar ONU y ver su estado desde Argos. Puedes agregar varias si tienes más de una.</div>
 <button class="btn p" style="padding:11px 22px;margin-top:6px"><i:mas1:16>Agregar instancia</button>
 <div class="m2" style="margin-top:4px">¿Solo necesitas Wi-Fi y PPPoE de la ONU? Eso va por el <a href="#">ACS</a>, aparte.</div>
</div>''')
lista_error = T('''<div style="display:{{v.error.v}};flex:1;min-height:0;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:40px;text-align:center">
 <span class="ico er" style="width:64px;height:64px;border-radius:20px"><i:alerta:30></span>
 <b style="font-size:18px">No se pudo leer la lista de instancias</b>
 <div class="m2" style="max-width:440px;font-size:13.5px;line-height:1.5">Argos no pudo traer los datos. No mostramos números ni estados hasta poder leerlos. Tus instancias no se tocaron.</div>
 <button class="btn p" style="padding:11px 22px;margin-top:6px"><i:refresh:16>Reintentar</button>
</div>''')
panel1 = T('''<section class="isla pan" style="flex:1;min-width:0">
 <div class="ph2"><span class="ico nf"><i:olt:19></span><div style="flex:1"><b style="font-size:17px">SmartOLT</b><div class="m2">Las cuentas de SmartOLT que usa Argos para autorizar ONU y ver su estado</div></div><button class="btn p" style="display:{{vAdd}}"><i:mas1:16>Agregar instancia</button></div>
 <<a>><<b>><<c>>
</section>''', a=lista_ok, b=lista_vacio, c=lista_error)
encab = head('Integraciones', 'Los sistemas con los que Argos habla, con su estado', TEMA_HINT, NOVE)
nota1 = nota_estados('Estados de la lista (para revisar el diseño)', 'v', [('lista', 'Con instancias'), ('vacio', 'Vacía'), ('error', 'Error al leer')], 'right:28px;bottom:28px;width:330px')
G1 = {'v': (['lista', 'vacio', 'error'], 'lista'), 't': (['todas', 'comp', 'falla'], 'todas'), 'a': (['ok', 'falla', 'apagado', 'sin', 'editar'], 'ok'), 'm': (['no'], 'no')}
L1 = {'ins': {'rows': [dict(r, vcomp='inline-flex' if r['comp'] else 'none', vemp='none' if r['comp'] else 'block', vap='block' if r['ap'] else 'none') for r in INS], 'def': 1, 'por': 't', 'todos': 'todas'}}
ex1 = "out.vAdd = st.v === 'vacio' ? 'none' : 'inline-flex';"
CSSM = mask(['check', 'alerta', 'reloj'])
pbuild('PendSmartoltLista.dc.html', 'Integraciones › SmartOLT', shell2('aj', MIGAS + ['SmartOLT'], encab + '<div style="flex:1;min-height:0;display:flex;gap:12px">' + izq('smartolt') + panel1 + '</div>', nota1), tlogic(G1, L1, ex1), 900, CSSM)

# =====================================================================================
# 2 · SmartOLT: detalle de una instancia
# =====================================================================================
olts = [
    P(nom='OLT-CENTRO-01', hw='Huawei MA5800-X7', ip='10.20.0.11', arg='OLT Centro', lig='ok', pf='4 perfiles', pres=1, nota='Ligada sola por el nombre'),
    P(nom='OLT-NORTE-02', hw='ZTE C320', ip='10.20.0.12', arg='', lig='no', pf='Sin perfiles', pres=1, nota=''),
    P(nom='OLT-VIEJA-03', hw='Huawei MA5683T', ip='10.20.0.13', arg='OLT Sur', lig='ok', pf='2 perfiles', pres=0, nota=''),
]
CO = 'minmax(0,1.2fr) minmax(0,1.3fr) 100px 24px'


def olt_row(o, i):
    sel = ('<span class="selp" style="height:34px;max-width:100%%"><i:olt:14:#64748B><span class="el">%s</span><i:ab:12></span>' % o['arg']) if o['lig'] == 'ok' else \
          '<span class="selp" style="height:34px;border-color:#FCD34D;background:#FFFBEB;color:#92400E"><i:alerta:14>Elegir OLT de Argos<i:ab:12></span>'
    sel = '<button class="selp" style="padding:0;border:0;background:none;height:auto" onClick="{{sel.ir%d}}">%s</button>' % (i, sel) if False else sel
    sub = ('<div class="m2" style="margin-top:3px"><i:link:12> %s</div>' % o['nota']) if o['nota'] else ''
    pres = '' if o['pres'] else '<div style="margin-top:3px"><span class="b wa" style="font-size:11px"><i:alerta:11>Ya no aparece en SmartOLT</span></div>'
    return T('<div class="lr" style="grid-template-columns:<<c>>;cursor:default;<<op>>"><div style="min-width:0"><b class="el" style="display:block"><<n>></b><div class="m2 el"><<h>> · <span class="mono" style="font-size:11.5px"><<ip>></span></div><<p>></div><div style="min-width:0"><div class="lb" style="display:none">OLT en Argos</div><<s>><<sb>></div><span class="m2"><<pf>></span><button class="ib" aria-label="Más" style="display:{{vEd}}"><i:mas:17></button></div>',
             c=CO, n=o['nom'], h=o['hw'], ip=o['ip'], p=pres, s=sel, sb=sub, pf=o['pf'], op='' if o['pres'] else 'opacity:.8')


def sel_row(i):
    return olt_row(olts[i], i)


# desplegable abierto sobre la segunda OLT (para ver cómo se liga)
opts = [('OLT Centro', 'Ya ligada a OLT-CENTRO-01', 1, 0), ('OLT Norte', 'Chimaltenango · Conecta Norte', 0, 1), ('OLT Sur', 'Ya ligada a OLT-VIEJA-03', 1, 0), ('OLT Escuintla', 'De otra empresa: no se puede ligar aquí', 1, 0)]
desp = T('''<div style="display:{{sel.abierto.b}};position:absolute;right:26px;top:246px;width:370px;background:#fff;border:1px solid #CBD5E1;border-radius:16px;box-shadow:0 18px 40px rgba(15,23,42,.22);z-index:5;overflow:hidden">
 <div style="padding:10px 10px 6px"><span class="busca" style="height:36px;border:2px solid #4F46E5;box-shadow:0 0 0 4px rgba(79,70,229,.12);color:#0F172A"><i:bus:14:#94A3B8>Norte</span></div>
 <div style="padding:4px 6px 6px"><<o>></div>
 <div style="padding:8px 14px;border-top:1px solid #F1F5F9;display:flex;align-items:center;gap:8px"><span class="m2" style="flex:1">Una OLT de Argos solo se liga a una de SmartOLT.</span><button class="lnk" style="color:#B91C1C">Quitar vínculo</button></div>
</div>''', o=''.join(T('<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;<<bg>><<op>>"><i:olt:16:#94A3B8><div style="flex:1;min-width:0"><b style="font-size:13.5px"><<a>></b><div class="m2"><<b>></div></div><span style="display:<<v>>"><i:check:16:#4F46E5></span></div>',
                                      a=a, b=b, op=';opacity:.55;cursor:not-allowed' if d else ';cursor:pointer', bg='background:#EEF2FF;' if ok else '', v='inline' if ok else 'none') for a, b, d, ok in opts))
bann = (T('<div class="av2 er" style="display:{{e.falla.v}};margin:12px 18px 0;align-items:flex-start;flex:0 0 auto"><i:alerta:18><div style="flex:1"><b>La última prueba falló.</b> SmartOLT rechazó el token (403). Mientras no funcione no se autorizan ONU nuevas con esta instancia ni se lee su estado. Cambia el token o revisa que la clave no esté limitada a otra zona.</div><button class="btn o sm" style="flex:0 0 auto"><i:refresh:13>Probar otra vez</button></div>')
         + T('<div class="av2 nf" style="display:{{e.sin.v}};margin:12px 18px 0;align-items:flex-start;flex:0 0 auto"><i:info:18><div style="flex:1"><b>Todavía no se ha probado.</b> Prueba la conexión para comprobar el token y traer las OLT de esta cuenta.</div></div>')
         + T('<div class="av2 nf" style="display:{{e.comp.v}};margin:12px 18px 0;align-items:flex-start;flex:0 0 auto"><i:candado:18><div style="flex:1"><b>Instancia compartida.</b> La usan todas las empresas y solo la cambia quien tiene acceso a todas. Tú la puedes ver, pero no cambiarla ni ligar sus OLT: eso lo hace un administrador global.</div></div>'))
datos = T('''<section class="cd"><div class="cdh"><i:cuenta:15>Datos de la cuenta<button class="lnk" style="display:{{vEd}}">Editar</button></div>
 <<k1>><<k2>><<k3>><<k4>>
 <div style="display:{{vEd}};margin-top:6px;padding-top:10px;border-top:1px solid #F1F5F9"><button class="lnk" style="color:#B91C1C"><i:basura:13> Eliminar esta instancia</button></div>
</section>''', k1=kv('Nombre en Argos', '<b>Zona norte</b>'), k2=kv('Subdominio', '<span class="copy">zonanorte.smartolt.com</span>'),
    k3=kv('Token', '<span class="mono">***</span> <button class="lnk" style="display:{{vEd}}">Cambiar</button>'),
    k4=kv('Encendida', '<span style="display:inline-flex;align-items:center;gap:8px"><span class="m2">Argos la usa para autorizar y ver ONU</span>' + tgl(True) + '</span>'))
empr = T('''<section class="cd"><div class="cdh"><i:edif:15>Empresas que la usan</div>
 <div style="display:{{e.comp.b}}"><<c>></div><div style="display:{{vUna}}"><<u>></div>
</section>''', c=kv('Conecta, S.A.', chip('nf', 'globo', 'Compartida')) + kv('Conecta Norte, S.A.', chip('nf', 'globo', 'Compartida')) + '<div class="m2" style="margin-top:6px">Todas las empresas de la instalación pueden usarla. Los servicios de cada una siguen con su empresa.</div>',
    u=kv('Conecta Norte, S.A.', chip('ok', 'check', 'Dueña')) + '<div class="m2" style="margin-top:6px">Solo esta empresa la ve y la usa. Para que otra la use, hay que volverla compartida (lo hace quien tiene acceso a todas).</div>')
prueba = T('''<section class="cd"><div class="cdh"><i:reloj:15>Última prueba</div>
 <div style="display:{{e.ok.b}}"><<a>></div><div style="display:{{e.comp.b}}"><<a>></div><div style="display:{{e.falla.b}}"><<b>></div><div style="display:{{e.sin.b}}"><<c>></div>
</section>''', a=kv('Resultado', chip('ok', 'check', 'Probada')) + kv('Respondió en', '212 ms') + kv('Cuándo', 'hoy 08:40 · Ana Cruz') + kv('OLT traídas', '3'),
    b=kv('Resultado', chip('er', 'alerta', 'Falla')) + kv('Qué pasó', '<span style="color:#B91C1C">Token rechazado (403)</span>') + kv('Cuándo', 'ayer 17:05 · Ana Cruz') + kv('OLT traídas', '2 <span class="m2">(de la última vez que funcionó)</span>'),
    c=kv('Resultado', chip('ne', 'reloj', 'Sin probar')) + kv('Cuándo', 'Nunca') + kv('OLT traídas', '—'))
izqcol = '<div class="sc" style="width:400px;flex:0 0 auto;display:flex;flex-direction:column;gap:12px;padding-bottom:4px">' + datos + empr + prueba + '</div>'
oltcard = T('''<section class="isla pan" style="flex:1;min-width:0;position:relative">
 <div class="ph2"><span class="ico nf"><i:olt:19></span><div style="flex:1;min-width:0"><b style="font-size:16px">OLT de esta instancia</b> <span class="b ne" style="margin-left:4px"><span style="display:{{e.sin.b}}">0</span><span style="display:{{vN3}}">3</span></span><div class="m2">Las trae SmartOLT. Liga cada una con su OLT de la red de acceso de Argos.</div></div><button class="btn o sm" style="display:{{vEd}}"><i:refresh:14>Sincronizar OLT</button></div>
 <<ban>>
 <div style="display:{{vLista}};flex:1;min-height:0;flex-direction:column">
  <div class="lh" style="grid-template-columns:<<c>>;margin-top:12px"><span>OLT en SmartOLT</span><span>OLT en Argos</span><span>Perfiles</span><span></span></div>
  <div class="sc" style="flex:1"><<r0>><<r1>><<r2>></div>
  <div class="m2" style="padding:10px 18px;border-top:1px solid #F1F5F9;flex:0 0 auto">Traídas de SmartOLT <span style="display:{{e.falla.n}}"></span><span style="display:{{e.falla.b}}">la última vez que funcionó (ayer 17:05)</span> · una OLT que se ligó sola por el nombre se puede cambiar cuando quieras.</div>
 </div>
 <div style="display:{{e.sin.v}};flex:1;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:30px;text-align:center"><span class="ico ne" style="width:56px;height:56px;border-radius:18px"><i:olt:26></span><b>Aún no hay OLT</b><div class="m2" style="max-width:340px">Prueba la conexión: con la misma llamada se comprueba el token y se traen las OLT de esta cuenta.</div></div>
 <<d>>
</section>''', c=CO, ban=bann, r0=sel_row(0), r1=sel_row(1), r2=sel_row(2), d=desp)
mapagar = dlg('apagar', 'power', 'wa', '¿Apagar «Zona norte»?', '<div style="font-size:14px;color:#475569;line-height:1.5">Mientras esté apagada, Argos no autoriza ONU nuevas ni lee su estado con esta cuenta. Los aprovisionamientos en proceso <b>no se pierden</b>: fallan y se reintentan cuando la vuelvas a encender. Tus datos y vínculos quedan igual.</div>',
              '<button class="btn g" onClick="{{m.no.ir}}">Volver</button><button class="btn p" onClick="{{m.no.ir}}"><i:power:15>Apagar</button>', w=480)
msinc = dlg('sinc', 'refresh', 'ok', 'Se sincronizaron 3 OLT', '<div style="font-size:14px;color:#475569;line-height:1.5">1 OLT nueva se ligó sola porque se llama igual que una de Argos: <b>OLT-CENTRO-01 → OLT Centro</b>. Las demás están sin ligar o ya ligadas. Revisa la lista.</div>',
            '<button class="btn p" onClick="{{m.no.ir}}"><i:check:15>Entendido</button>', w=460)
eliminar = dlg('elim', 'basura', 'er', '¿Eliminar «Zona norte»?', '<div style="font-size:14px;color:#475569;line-height:1.5">Se borran sus 3 OLT y sus 6 perfiles de autorización. <b>No se puede mientras haya equipos gestionados o pedidos en proceso</b> con esta instancia: si los hay, Argos te avisa y no borra nada.</div>',
               '<button class="btn g" onClick="{{m.no.ir}}">Volver</button><button class="btn rr" onClick="{{m.no.ir}}">Eliminar</button>', w=480)
head2 = T('''<div style="display:flex;align-items:center;gap:12px;flex:0 0 auto">
 <button class="ib f" style="width:38px;height:38px;border-radius:999px" aria-label="Atrás"><i:izq:17></button>
 <span class="ico nf" style="width:46px;height:46px;border-radius:14px"><i:olt:22></span>
 <div style="min-width:0"><h1 class="h1" style="display:flex;align-items:center;gap:10px">Zona norte <span style="font-size:13px;font-weight:600;display:inline-flex"><<ch>></span> <span style="display:{{e.comp.b}}"><span class="b nf" style="font-size:12px"><i:globo:13>Compartida</span></span></h1><div class="sub mono" style="font-size:12.5px">zonanorte.smartolt.com</div></div>
 <span style="flex:1"></span><<t>><<ay>>
 <button class="btn o" style="display:{{vEd}}" onClick="{{m.apagar.ir}}"><i:power:15>Apagar</button><button class="btn p" style="padding:11px 20px;display:{{vProbar}}" onClick="{{m.sinc.ir}}"><i:refresh:16>Probar conexión</button>
</div>''', ch=estado_tres(), t=TEMA_HINT, ay=AY(NOVE))
nota2 = nota_estados('Estados del detalle (para revisar el diseño)', 'e', [('ok', 'Probada'), ('falla', 'Con falla'), ('sin', 'Sin probar'), ('comp', 'Compartida (sin alcance global)')], 'right:28px;bottom:28px;width:330px')
nota2b = T('<div class="nota" style="right:380px;bottom:28px;width:300px"><b>Ventanas y selector</b><div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px"><button class="fc {{sel.abierto.cls}}" style="padding:5px 10px;font-size:12px;background:transparent;color:#E2E8F0;border-color:#334155" onClick="{{sel.abierto.ir}}">Ligar OLT</button><button class="fc" style="padding:5px 10px;font-size:12px;background:transparent;color:#E2E8F0;border-color:#334155" onClick="{{m.apagar.ir}}">Apagar</button><button class="fc" style="padding:5px 10px;font-size:12px;background:transparent;color:#E2E8F0;border-color:#334155" onClick="{{m.sinc.ir}}">Sincronizar</button><button class="fc" style="padding:5px 10px;font-size:12px;background:transparent;color:#E2E8F0;border-color:#334155" onClick="{{m.elim.ir}}">Eliminar</button></div></div>')
G2 = {'e': (['ok', 'falla', 'sin', 'comp'], 'ok'), 'sel': (['no', 'abierto'], 'no'), 'm': (['no', 'apagar', 'sinc', 'elim'], 'no')}
ex2 = """out.velo = (st.m && st.m !== 'no') ? 'block' : 'none';
const ec = st.e || 'ok';
out.vEd = ec === 'comp' ? 'none' : 'inline-flex'; out.vProbar = ec === 'comp' ? 'none' : 'inline-flex';
out.vLista = ec === 'sin' ? 'none' : 'flex'; out.vN3 = ec === 'sin' ? 'none' : 'inline'; out.vUna = ec === 'comp' ? 'none' : 'block';"""
cuerpo2 = '<div style="flex:1;min-height:0;display:flex;gap:12px">' + izqcol + oltcard + '</div>'
pbuild('PendSmartoltDetalle.dc.html', 'SmartOLT · detalle de la instancia', shell2('aj', MIGAS + ['SmartOLT', 'Zona norte'], head2 + cuerpo2,
       VELO.replace('{{mOn}}', '{{velo}}') + mapagar + msinc + eliminar + nota2 + nota2b), tlogic(G2, None, ex2), 900, CSSM)

# =====================================================================================
# 3 · SmartOLT: formulario de instancia (página propia)
# =====================================================================================
sec = lambda n, t, d, body: f'<div style="display:grid;grid-template-columns:210px 1fr;gap:22px;padding:16px 0;border-top:1px solid #F1F5F9"><div><b style="font-size:14px">{n} · {t}</b><div class="m2" style="margin-top:3px;line-height:1.45">{d}</div></div><div style="display:flex;flex-direction:column;gap:12px;min-width:0">{body}</div></div>'
seg2 = lambda g, items: '<div class="segb" style="align-self:flex-start">' + ''.join(T('<button class="ts {{<<g>>.<<id>>.cls}}" onClick="{{<<g>>.<<id>>.ir}}"><i:<<i>>:15><<n>></button>', g=g, id=i, n=n, i=ic_) for i, n, ic_ in items) + '</div>'
DEST = 'border:2px solid #4F46E5;box-shadow:0 0 0 4px rgba(79,70,229,.12)'
f1 = sec(1, 'La cuenta', 'Los datos de tu cuenta de SmartOLT. El token se guarda cifrado y nunca se vuelve a mostrar.', T('''
 <div class="g2"><div><div class="lb">Nombre en Argos<span class="req">*</span></div><div class="in">Zona norte</div><div class="ay">Para reconocerla en las listas. No puede repetirse en la empresa.</div></div>
  <div><div class="lb">Subdominio<span class="req">*</span></div><div class="in" id="sub" style="{{subSt}}"><span style="display:{{f.nueva.b}}"><span style="color:{{subCol}}">{{subTxt}}</span></span><span style="display:{{f.editar.b}}">zonanorte</span><span class="m2" style="margin-left:auto">.smartolt.com</span></div>
   <div class="ay" style="display:{{e.sub.v}};color:#B91C1C;align-items:center;gap:6px"><i:alerta:13>Ya existe una instancia con ese subdominio: «Principal». Una cuenta se usa una sola vez.</div>
   <div class="ay" style="display:{{f.nueva.b}}">Solo la parte antes de «.smartolt.com».</div></div></div>
 <div><div class="lb">Token (clave de API)<span class="req">*</span></div>
  <div class="in" style="display:{{f.nueva.v}}"><i:llave:16:#94A3B8><span style="color:#94A3B8">Pega aquí el token de SmartOLT</span></div>
  <div class="in auto" style="display:{{f.editar.v}};background:#F8FAFC"><i:llave:16:#94A3B8><span class="mono">***</span><button class="lnk" style="margin-left:auto">Cambiar</button></div>
  <div class="ay" style="display:{{f.editar.b}}">Para conservarlo, déjalo así. Si lo cambias o cambias el subdominio, hay que probar la conexión otra vez.</div></div>'''))
f2 = sec(2, 'Quién la usa', 'Una cuenta puede ser de una sola empresa o de todas.', seg2('q', [('una', 'Una empresa', 'edif'), ('comp', 'Compartida', 'globo')]) + T('''
 <div style="display:{{q.una.b}}"><div class="lb">Empresa<span class="req">*</span></div><div class="in sel"><i:edif:16:#94A3B8><b>Conecta Norte, S.A.</b> <span class="m2" style="margin-left:6px">empresa activa</span></div></div>
 <div style="display:{{q.comp.b}}" class="av2 nf" ><i:globo:16><div>Todas las empresas de la instalación podrán usar esta cuenta. Úsala cuando una misma OLT atiende a varias empresas. <b>Solo la crea y la cambia quien tiene acceso a todas las empresas.</b></div></div>
 <div style="display:{{e.comp.b}}" class="av2 er"><i:alerta:16><div><b>No tienes acceso a todas las empresas.</b> Pide a un administrador global que la cree como compartida, o elige «Una empresa».</div></div>'''))
f3 = sec(3, 'Nota', 'Opcional. Para ti y tu equipo, el cliente no la ve.', '<div class="in" style="min-height:64px;align-items:flex-start;color:#94A3B8">Ej.: cuenta de las OLT de la zona norte. La renueva Luis en enero.</div>')
f4 = sec(4, 'Al guardar', 'Puedes dejarla apagada y encenderla cuando estés listo.', T('<div style="display:flex;align-items:center;gap:12px"><span class="tg on" style="cursor:pointer"><i></i></span><div><b style="font-size:13px">Encenderla al guardar</b><div class="m2">Argos la usa solo cuando está encendida y la prueba salió bien</div></div></div>'))
ban3 = (T('<div class="av2 er" style="display:{{e.sub.v}};align-items:flex-start;margin:12px 0 4px"><i:alerta:18><div style="flex:1"><b>No se guardó.</b> El subdominio «zonanorte» ya lo usa la instancia «Principal».</div></div>')
        + T('<div class="av2 er" style="display:{{e.ver.v}};align-items:flex-start;margin:12px 0 4px"><i:alerta:18><div style="flex:1"><b>Otra persona cambió esta instancia mientras la editabas.</b> Recarga para ver sus cambios y vuelve a aplicar los tuyos.</div><button class="btn o sm" style="flex:0 0 auto"><i:refresh:13>Recargar</button></div>')
        + T('<div class="av2 wa" style="display:{{f.editar.v}};align-items:flex-start;margin:12px 0 4px"><i:alerta:16><div>Si cambias el <b>subdominio</b> o el <b>token</b>, se borra la última prueba y la instancia queda «Sin probar» hasta que pruebes la conexión.</div></div>'))
aside3 = T('''<aside style="width:350px;flex:0 0 auto;border-left:1px solid #F1F5F9;background:#FAFBFE;padding:18px 20px;display:flex;flex-direction:column;gap:12px;overflow:auto">
 <div class="sec" style="margin:0">¿Dónde saco el token?</div>
 <div class="card" style="padding:14px;font-size:13px;line-height:1.55;color:#334155"><b>1.</b> Entra a tu cuenta de SmartOLT.<br><b>2.</b> Ve a <b>General › API key</b>.<br><b>3.</b> Copia la clave y pégala aquí.</div>
 <div class="av2 wa" style="align-items:flex-start"><i:alerta:16><div>Si la clave está <b>limitada a una zona</b>, Argos solo verá las OLT de esa zona.</div></div>
 <div class="av2 nf" style="align-items:flex-start"><i:info:16><div>Después de guardar, pulsa <b>Probar conexión</b>: se comprueba el token y se traen las OLT de la cuenta.</div></div>
</aside>''')
form3 = T('''<section class="isla" style="flex:1;min-height:0;border-radius:20px;display:flex;flex-direction:column;overflow:hidden">
 <header style="display:flex;align-items:center;gap:14px;padding:14px 22px;border-bottom:1px solid #F1F5F9;flex:0 0 auto">
  <button class="ib f" style="width:38px;height:38px;border-radius:999px" aria-label="Atrás"><i:izq:17></button>
  <div><b style="font-size:18px"><span style="display:{{f.nueva.b}}">Agregar instancia de SmartOLT</span><span style="display:{{f.editar.b}}">Editar «Zona norte»</span></b><div class="m2">Una cuenta de SmartOLT (un subdominio) con su propio token</div></div>
  <span style="flex:1"></span><<tema>><<ay>>
 </header>
 <div style="flex:1;min-height:0;display:flex">
  <div class="sc" style="flex:1;padding:4px 26px 20px"><<ban>><<s1>><<s2>><<s3>><<s4>></div>
  <<aside>>
 </div>
 <footer style="display:flex;align-items:center;gap:10px;padding:14px 22px;border-top:1px solid #F1F5F9;background:#FCFCFE;flex:0 0 auto"><span class="m2">Los cambios quedan en la bitácora; el token siempre como «***».</span><span style="flex:1"></span><button class="btn g">Cancelar</button><button class="btn p" style="padding:11px 24px"><i:check:15>Guardar</button></footer>
</section>''', tema=TEMA_HINT, ay=AY('Ayuda: instancias de SmartOLT'), ban=ban3, s1=f1, s2=f2, s3=f3, s4=f4, aside=aside3)
nota3 = nota_estados('Estados del formulario (para revisar el diseño)', 'e', [('no', 'Sin errores'), ('sub', '409 Subdominio repetido'), ('comp', '403 Sin acceso global'), ('ver', '409 Otro la cambió')], 'right:44px;bottom:96px;width:330px')
nota3b = nota_estados('Modo', 'f', [('nueva', 'Agregar'), ('editar', 'Editar')], 'right:44px;bottom:236px;width:330px')
G3 = {'f': (['nueva', 'editar'], 'nueva'), 'q': (['una', 'comp'], 'una'), 'e': (['no', 'sub', 'comp', 'ver'], 'no'), 'm': (['no'], 'no')}
ex3 = "out.subTxt = st.e === 'sub' ? 'zonanorte' : 'miempresa'; out.subCol = st.e === 'sub' ? '#0F172A' : '#94A3B8'; out.subSt = st.e === 'sub' ? 'border:2px solid #DC2626;box-shadow:0 0 0 4px rgba(220,38,38,.12)' : (st.e === 'sub' ? '' : 'border:2px solid #4F46E5;box-shadow:0 0 0 4px rgba(79,70,229,.12)');"
pbuild('PendSmartoltForm.dc.html', 'SmartOLT · formulario de instancia', shell2('aj', MIGAS + ['SmartOLT', 'Agregar instancia'], form3, nota3 + nota3b), tlogic(G3, None, ex3), 1000, CSSM)

# =====================================================================================
# 4 · ACS (GenieACS) de la empresa activa
# =====================================================================================
AVISO_ACS = '<b>Sin ACS no se configuran Wi-Fi ni PPPoE de la ONU.</b> SmartOLT sigue autorizando las ONU y mostrando su estado, pero la red Wi-Fi y el usuario PPPoE se quedan como los dejó la plantilla de la OLT.'
conx = T('''<section class="cd"><div class="cdh"><i:link:15>Conexión<button class="lnk">Editar</button></div>
 <<k1>><<k2>><<k3>><<k4>></section>''', k1=kv('Dirección (URL)', '<span class="copy">https://acs.conecta.gt:7557</span>'), k2=kv('Usuario', 'argos'),
    k3=kv('Clave', '<span class="mono">***</span> <button class="lnk">Cambiar</button>'), k4=kv('Certificado propio (CA)', chip('ne', 'escudo', 'Ninguno') + ' <button class="lnk">Subir</button>'))
hace = T('''<section class="cd"><div class="cdh"><i:wifi:15>Qué hace el ACS</div>
 <div class="kv2"><span style="color:#0F172A;flex:1 1 auto"><b>Cambiar el Wi-Fi de la ONU</b><span class="m2" style="display:block">Nombre y clave de la red, desde la ficha del servicio o Iris</span></span><span class="b ok"><i:check:12>Disponible</span></div>
 <div class="kv2"><span style="color:#0F172A;flex:1 1 auto"><b>Ver el equipo</b><span class="m2" style="display:block">Firmware, nombre de red y último contacto</span></span><span class="b ok"><i:check:12>Disponible</span></div>
 <div class="kv2"><span style="color:#0F172A;flex:1 1 auto"><b>PPPoE por ACS</b><span class="m2" style="display:block">Poner el usuario y la clave PPPoE de la ONU por el ACS al aprovisionar. Apagado: no se tocan.</span></span><span><<tg>></span></div>
 <div class="av2 nf" style="margin-top:8px;padding:8px 12px;align-items:flex-start"><i:info:16><div>El Wi-Fi y el PPPoE de la ONU se configuran <b>solo con ACS</b>. SmartOLT no los configura.</div></div>
</section>''', tg=tgl(True))
probar = T('''<section class="cd"><div class="cdh"><i:reloj:15>Última prueba</div>
 <div style="display:{{a.ok.b}}"><<a>></div><div style="display:{{a.falla.b}}"><<b>></div><div style="display:{{a.apagado.b}}"><<a>></div></section>''',
           a=kv('Resultado', chip('ok', 'check', 'Probada')) + kv('Respondió en', '180 ms') + kv('Cuándo', 'hoy 08:41 · Ana Cruz'),
           b=kv('Resultado', chip('er', 'alerta', 'Falla')) + kv('Qué pasó', '<span style="color:#B91C1C">No respondió: tiempo agotado</span>') + kv('Cuándo', 'hoy 08:41 · Ana Cruz'))
bann4 = (T('<div class="av2 er" style="display:{{a.falla.v}};margin:12px 18px 0;align-items:flex-start;flex:0 0 auto"><i:alerta:18><div style="flex:1"><b>El ACS no respondió.</b> Mientras no funcione no se cambia el Wi-Fi ni se pone el PPPoE por ACS; esos pedidos esperan y se reintentan solos. Revisa la dirección y que el servidor esté encendido.</div><button class="btn o sm" style="flex:0 0 auto"><i:refresh:13>Probar otra vez</button></div>')
         + T('<div class="av2 wa" style="display:{{a.apagado.v}};margin:12px 18px 0;align-items:flex-start;flex:0 0 auto"><i:power:18><div style="flex:1"><b>El ACS está apagado.</b> ' + AVISO_ACS + '</div><button class="btn o sm" style="flex:0 0 auto">Encender</button></div>')
         + T('<div class="av2 wa" style="display:{{a.sin.v}};margin:12px 18px 0;align-items:flex-start;flex:0 0 auto"><i:alerta:18><div style="flex:1">' + AVISO_ACS + '</div></div>'))
cuerpo_ver = T('''<div class="sc" style="display:{{vCard}};flex:1;flex-direction:column;gap:12px;padding:14px 18px"><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div style="display:flex;flex-direction:column;gap:12px"><<c>><<p>></div><<h>></div></div>''', c=conx, p=probar, h=hace)
cuerpo_sin = T('''<div style="display:{{a.sin.v}};flex:1;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:40px;text-align:center">
 <span class="ico nf" style="width:64px;height:64px;border-radius:20px"><i:cpu:30></span><b style="font-size:18px">Esta empresa todavía no tiene ACS</b>
 <div class="m2" style="max-width:460px;font-size:13.5px;line-height:1.5">El ACS (GenieACS) es el servidor que cambia el Wi-Fi y el PPPoE de la ONU. Cada empresa tiene uno. Puedes usar SmartOLT sin él.</div>
 <button class="btn p" style="padding:11px 22px;margin-top:6px" onClick="{{a.editar.ir}}"><i:cpu:16>Configurar ACS</button></div>''')
# formulario en página (más de 3 campos)
form4 = T('''<section class="isla" style="display:{{a.editar.v}};flex:1;min-height:0;border-radius:20px;flex-direction:column;overflow:hidden">
 <header style="display:flex;align-items:center;gap:14px;padding:14px 22px;border-bottom:1px solid #F1F5F9;flex:0 0 auto">
  <button class="ib f" style="width:38px;height:38px;border-radius:999px" aria-label="Atrás" onClick="{{a.ok.ir}}"><i:izq:17></button>
  <div><b style="font-size:18px">Editar ACS (GenieACS)</b><div class="m2">Conecta, S.A. · un ACS por empresa</div></div><span style="flex:1"></span><<ay>>
 </header>
 <div class="sc" style="flex:1;padding:4px 26px 20px">
  <<s1>><<s2>><<s3>>
 </div>
 <footer style="display:flex;align-items:center;gap:10px;padding:14px 22px;border-top:1px solid #F1F5F9;background:#FCFCFE;flex:0 0 auto"><span class="m2">La clave se guarda cifrada y siempre se ve como «***».</span><span style="flex:1"></span><button class="btn g" onClick="{{a.ok.ir}}">Cancelar</button><button class="btn p" style="padding:11px 24px" onClick="{{a.ok.ir}}"><i:check:15>Guardar</button></footer>
</section>''', ay=AY('Ayuda: ACS'),
    s1=sec(1, 'Conexión', 'Dónde está tu GenieACS y con qué usuario entra Argos.', '<div><div class="lb">Dirección (URL)<span class="req">*</span></div><div class="in" style="' + DEST + '"><i:link:16:#94A3B8>https://acs.conecta.gt:7557</div><div class="ay">Debe empezar con https://</div></div><div class="g2">' + campo('Usuario', 'argos', False) + '<div><div class="lb">Clave</div><div class="in auto" style="background:#F8FAFC"><i:llave:16:#94A3B8><span class="mono">***</span><button class="lnk" style="margin-left:auto">Cambiar</button></div></div></div>'),
    s2=sec(2, 'Certificado', 'Solo si tu servidor usa un certificado propio.', '<div class="in" style="color:#94A3B8"><i:escudo:16:#94A3B8>Sin certificado propio (CA)<button class="lnk" style="margin-left:auto">Subir certificado</button></div>'),
    s3=sec(3, 'PPPoE por ACS', 'Si lo enciendes, al aprovisionar una ONU el usuario y la clave PPPoE los pone el ACS.', '<div style="display:flex;align-items:center;gap:12px"><span class="tg on"><i></i></span><div><b style="font-size:13px">Poner el PPPoE por ACS</b><div class="m2">Apagado: Argos no toca el PPPoE de la ONU</div></div></div>'))
encabes = T('''<div style="display:{{vVer}};flex-direction:column;flex:1;min-height:0"><<ban>><<cs>><<cv>></div>''', ban=bann4, cs=cuerpo_sin, cv=cuerpo_ver)
chipacs = ('<span style="display:{{a.ok.b}}">' + chip('ok', 'check', 'Probado') + '</span><span style="display:{{a.falla.b}}">' + chip('er', 'alerta', 'Falla') + '</span><span style="display:{{a.sin.b}}">' + chip('ne', 'reloj', 'Sin configurar')
           + '</span><span style="display:{{a.apagado.b}}">' + chip('ne', 'power', 'Apagado') + '</span>')
panel4 = T('''<section class="isla pan" style="display:{{vPan}};flex:1;min-width:0">
 <div class="ph2"><span class="ico nf"><i:cpu:19></span><div style="flex:1;min-width:0"><b style="font-size:17px">ACS (GenieACS)</b><div style="display:flex;gap:6px;align-items:center;margin:3px 0"><<chip>><span class="b ne"><i:edif:12>Conecta, S.A.</span></div><div class="m2">Un solo ACS por empresa · cambia el Wi-Fi y el PPPoE de la ONU</div></div>
  <span style="display:{{vAcc}};align-items:center;gap:8px"><span class="m2">Encendido</span><<tg>></span><button class="btn p" style="display:{{vAcc}}"><i:refresh:16>Probar conexión</button></div>
 <<e>>
</section>''', chip=chipacs, tg=tgl(True), e=encabes)
nota4 = nota_estados('Estados del ACS (para revisar el diseño)', 'a', [('ok', 'Probado'), ('falla', 'Falla'), ('apagado', 'Apagado'), ('sin', 'Sin configurar'), ('editar', 'Editar (página)')], 'right:28px;bottom:100px;width:350px')
G4 = {'a': (['ok', 'falla', 'apagado', 'sin', 'editar'], 'ok'), 'v': (['lista', 'vacio', 'error'], 'lista'), 'm': (['no'], 'no')}
ex4 = "const ac = st.a || 'ok'; out.vVer = ac === 'editar' ? 'none' : 'flex'; out.vPan = ac === 'editar' ? 'none' : 'flex'; out.vAcc = ac === 'sin' ? 'none' : 'inline-flex'; out.vCard = (ac === 'editar' || ac === 'sin') ? 'none' : 'flex';"
cuerpo4 = '<div style="flex:1;min-height:0;display:flex;gap:12px">' + izq('acs') + panel4.replace('{{vPan}}', '{{vPan}}') + form4 + '</div>'
pbuild('PendAcs.dc.html', 'Integraciones › ACS (GenieACS)', shell2('aj', MIGAS + ['ACS (GenieACS)'], encab + cuerpo4, nota4), tlogic(G4, None, ex4), 900, CSSM)

# =====================================================================================
# 5 · Ficha del servicio › Equipo: qué instancia y qué OLT usa, y qué pasa sin ACS
# =====================================================================================
smart_ok = (kv('Cuenta de SmartOLT', '<b>Zona norte</b> <button class="lnk">Abrir</button>') + kv('OLT', '<b>OLT Centro</b> <span class="m2">en Argos · en SmartOLT: <span class="mono" style="font-size:11.5px">OLT-CENTRO-01</span></span>')
            + kv('Puerto', 'PON 1/1/4') + kv('Identificador de la ONU', '<span class="copy">argos412</span>') + kv('Estado de la ONU', chip('ok', 'check', 'En línea') + ' <span class="m2">· señal -21.4 dBm</span>')
            + '<div class="m2" style="margin-top:6px"><i:info:12> Se eligió por la OLT del servicio. Si cambias de OLT, la cuenta se escoge sola.</div>')
smart_sinolt = ('<div class="av2 wa" style="align-items:flex-start"><i:alerta:16><div><b>Este servicio no tiene una OLT ligada a SmartOLT.</b> Al aprovisionar, Argos buscará la serie de la ONU en las <b>2 cuentas</b> de la empresa (Zona norte y Principal). Si aparece en las dos, se detiene y te pregunta.</div></div>'
                + '<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap"><button class="btn o sm"><i:link:14>Ligar la OLT en SmartOLT</button><button class="lnk">Ver las cuentas</button></div>')
smart_caida = ('<div class="av2 er" style="align-items:flex-start"><i:alerta:16><div style="flex:1"><b>SmartOLT no respondió</b> (cuenta «Zona norte»). El estado de la ONU no se pudo leer ahora; el ACS sí respondió.</div><button class="btn o sm" style="flex:0 0 auto"><i:refresh:13>Reintentar</button></div>'
               + kv('Cuenta de SmartOLT', '<b>Zona norte</b>') + kv('OLT', '<b>OLT Centro</b> <span class="m2">· OLT-CENTRO-01</span>') + kv('Estado de la ONU', chip('ne', 'reloj', 'Sin dato ahora')))
acs_ok = (kv('Red Wi-Fi', '<b>CASA_MENDEZ</b>') + kv('Clave del Wi-Fi', '<span class="mono">***</span> <button class="lnk">Cambiar</button>') + kv('PPPoE por ACS', chip('ok', 'check', 'Encendido'))
          + kv('Firmware', 'V3.1.2') + kv('Último contacto', 'hoy 09:02'))
acs_sin = ('<div class="av2 wa" style="align-items:flex-start"><i:alerta:16><div><b>Esta empresa no tiene ACS.</b> Sin ACS no se configuran Wi-Fi ni PPPoE de la ONU.</div></div>'
           + '<div class="m2" style="margin-top:10px;line-height:1.5">La ONU sigue funcionando y SmartOLT la sigue autorizando y mostrando. Solo el Wi-Fi y el usuario PPPoE no se pueden cambiar desde Argos.</div>'
           + '<div style="display:flex;gap:8px;margin-top:10px"><button class="btn o sm" disabled style="opacity:.5;cursor:not-allowed"><i:wifi:14>Cambiar Wi-Fi</button><button class="lnk">Configurar el ACS</button></div>')
apro_ok = (kv('Cuenta', '<b>Zona norte</b>') + kv('OLT', 'OLT Centro · PON 1/1/4') + kv('Perfil de autorización', 'Fibra 50 residencial') + kv('Wi-Fi inicial', chip('ok', 'check', 'Por el ACS')))
apro_sinacs = (kv('Cuenta', '<b>Zona norte</b>') + kv('OLT', 'OLT Centro · PON 1/1/4') + kv('Perfil de autorización', 'Fibra 50 residencial') + kv('Wi-Fi inicial', chip('wa', 'alerta', 'No disponible sin ACS')))
apro_sinolt = (kv('Cuenta', chip('wa', 'alerta', 'Se busca en 2 cuentas')) + kv('OLT', '<span class="m2">La que tenga la serie de la ONU</span>') + kv('Perfil de autorización', '<span class="m2">El de esa OLT para el plan</span>') + kv('Wi-Fi inicial', chip('ok', 'check', 'Por el ACS')))
W = lambda cond, h: '<div style="display:{{%s}}">%s</div>' % (cond, h)
card_s = T('<section class="cd"><div class="cdh"><i:olt:15>ONU en SmartOLT<button class="lnk">Ver en SmartOLT</button></div><<a>><<b>><<c>></section>',
           a=W('hOk', smart_ok), b=W('hSinOlt', smart_sinolt), c=W('hCaida', smart_caida))
card_a = T('<section class="cd"><div class="cdh"><i:wifi:15>Wi-Fi y PPPoE por ACS</div><<a>><<b>></section>', a=W('hAcs', acs_ok), b=W('hSinAcs', acs_sin))
card_p = T('<section class="cd"><div class="cdh"><i:herr:15>Si hay que aprovisionar una ONU nueva<button class="lnk">Aprovisionar ONU</button></div><<a>><<b>><<c>></section>',
           a=W('pOk', apro_ok), b=W('pSinAcs', apro_sinacs), c=W('pSinOlt', apro_sinolt))
tabs = '<div class="segb" style="align-self:flex-start">' + ''.join('<button class="ts%s">%s</button>' % (' on' if n == 'Equipo' else '', n) for n in ['Resumen', 'Facturas', 'Equipo', 'Contactos', 'Promociones', 'Pausas', 'Bitácora']) + '</div>'
ficha = T('''<section class="isla pan" style="flex:1">
 <div style="display:flex;align-items:center;gap:12px;padding:14px 18px;border-bottom:1px solid #F1F5F9;flex:0 0 auto">
  <span class="ico nf" style="width:46px;height:46px;border-radius:14px"><i:router:22></span><div style="flex:1;min-width:0"><b style="font-size:17px">S-000412 · Casa</b> <span class="b ok" style="margin-left:6px">Activo</span><div class="m2">Rosa Méndez · Fibra 50 · MK Centro · Conecta, S.A.</div></div>
  <<tema>><<ay>></div>
 <div style="padding:12px 18px 0;flex:0 0 auto"><<tabs>></div>
 <div class="sc" style="flex:1;padding:12px 18px 18px"><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:start"><<s>><<a>><<p>><section class="cd"><div class="cdh"><i:router:15>Equipo en comodato</div><<k>></section></div></div>
</section>''', tema=TEMA_HINT, ay=AY('Ayuda: equipo del servicio'), tabs=tabs, s=card_s, a=card_a, p=card_p,
           k=kv('ONU ZTE F670L', '<span class="mono" style="font-size:12px">ZTEGC8A1B2C3</span>') + kv('Estado', chip('ok', 'check', 'En comodato · funcionando')))
nota5 = nota_estados('Cuatro casos (para revisar el diseño)', 'a', [('ok', 'Todo bien'), ('sinacs', 'Sin ACS'), ('sinolt', 'OLT sin ligar'), ('caida', 'SmartOLT no responde')], 'right:28px;bottom:28px;width:330px')
G5 = {'a': (['ok', 'sinacs', 'sinolt', 'caida'], 'ok'), 'm': (['no'], 'no')}
ex5 = """const a = st.a || 'ok';
out.hOk = (a === 'ok' || a === 'sinacs') ? 'block' : 'none'; out.hSinOlt = a === 'sinolt' ? 'block' : 'none'; out.hCaida = a === 'caida' ? 'block' : 'none';
out.hAcs = a === 'sinacs' ? 'none' : 'block'; out.hSinAcs = a === 'sinacs' ? 'block' : 'none';
out.pOk = (a === 'ok' || a === 'caida') ? 'block' : 'none'; out.pSinAcs = a === 'sinacs' ? 'block' : 'none'; out.pSinOlt = a === 'sinolt' ? 'block' : 'none';"""
pbuild('PendEquipoServicio.dc.html', 'Ficha del servicio · equipo en SmartOLT y ACS', shell2('dia', ['Clientes', 'Rosa Méndez', 'S-000412 · Casa', 'Equipo'], ficha, nota5), tlogic(G5, None, ex5), 900, CSSM)

# =====================================================================================
# TELÉFONO (390 px): pantallas completas y acción principal fija abajo
# =====================================================================================
tbtn = '<button class="ib f" style="width:38px;height:38px;border-radius:999px" onClick="{{tTema}}" aria-label="Tema"><i:luna:17></button>'
mrows = ''.join(T('<div class="card" style="padding:12px 14px;display:flex;flex-direction:column;gap:6px" onClick="{{d.det.ir}}"><div style="display:flex;align-items:center;gap:8px"><span class="ico <<k>>" style="width:32px;height:32px;border-radius:10px"><i:olt:16></span><div style="flex:1;min-width:0"><b class="el" style="display:block;font-size:15px"><<n>></b><span class="m2 mono el" style="display:block;font-size:11px"><<s>>.smartolt.com</span></div><i:der:16:#94A3B8></div><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><span class="b <<k>>"><i:<<i>>:13><<e>></span><span class="b <<c>>" style="display:<<vc>>"><i:globo:12>Compartida</span><span class="m2" style="display:<<ve>>"><<em>></span><span style="flex:1"></span><span class="m2"><b style="color:#0F172A"><<o>></b> OLT · <<p>></span></div></div>',
                  k=x['est'], n=x['nom'], s=x['sub'], i=x['estI'], e=x['estT'], c='nf', vc='inline-flex' if x['comp'] else 'none', ve='none' if x['comp'] else 'inline', em=x['emp'], o=x['n'], p=x['pr']) for x in INS)
m_lista = T('''<div style="display:{{d.lista.v}};flex-direction:column;gap:8px"><div class="segb" style="display:flex;width:100%"><button class="ts on" style="flex:1;justify-content:center;padding:8px 4px">Todas <span class="c">4</span></button><button class="ts" style="flex:1;justify-content:center;padding:8px 4px">Compartidas</button><button class="ts" style="flex:1;justify-content:center;padding:8px 4px">Con falla <span class="c rj">1</span></button></div><<r>></div>''', r=mrows)
m_vacio = '<div style="display:{{d.vacio.v}};flex-direction:column;align-items:center;gap:10px;padding:60px 20px;text-align:center"><span class="ico nf" style="width:64px;height:64px;border-radius:20px"><i:olt:30></span><b style="font-size:17px">Todavía no hay cuentas de SmartOLT</b><div class="m2" style="font-size:13.5px;line-height:1.5">Agrega el subdominio y el token de tu SmartOLT para autorizar ONU y ver su estado.</div></div>'
m_error = '<div style="display:{{d.error.v}};flex-direction:column;align-items:center;gap:10px;padding:60px 20px;text-align:center"><span class="ico er" style="width:64px;height:64px;border-radius:20px"><i:alerta:30></span><b style="font-size:17px">No se pudo leer la lista</b><div class="m2" style="font-size:13.5px;line-height:1.5">No mostramos números ni estados hasta poder leerlos.</div></div>'


def m_det(vid, fallo):
    banner = ('<div class="av2 er" style="align-items:flex-start"><i:alerta:16><div><b>La última prueba falló:</b> token rechazado (403). No se autorizan ONU nuevas con esta cuenta hasta que funcione.</div></div>') if fallo else ''
    return T('''<div style="display:{{d.<<v>>.v}};flex-direction:column;gap:10px"><<b>>
 <section class="cd"><div style="display:flex;align-items:center;gap:8px"><b style="font-size:16px;flex:1"><<n>></b><span class="b <<k>>"><i:<<i>>:12><<e>></span></div><<k1>><<k2>><<k3>><<k4>></section>
 <section class="cd" style="padding:4px 14px"><div class="cdh" style="margin:10px 0 2px">OLT de esta cuenta (3)<button class="lnk">Sincronizar</button></div><<rows>></section></div>''', v=vid, b=banner, n='Costa sur' if fallo else 'Zona norte', k='er' if fallo else 'ok', i='alerta' if fallo else 'check', e='Falla' if fallo else 'Probada',
             k1=kv('Subdominio', '<span class="copy">%s.smartolt.com</span>' % ('costasur' if fallo else 'zonanorte')), k2=kv('Token', '<span class="mono">***</span> <button class="lnk">Cambiar</button>'),
             k3=kv('Empresas', 'Conecta, S.A.' if fallo else 'Conecta Norte, S.A.'), k4=kv('Encendida', tgl(True)),
             rows=''.join(T('<div class="kv2" style="align-items:flex-start"><span style="color:#0F172A;min-width:0"><b><<a>></b><span class="m2" style="display:block"><<h>></span></span><span onClick="{{d.ligar.ir}}" style="cursor:pointer"><<s>></span></div>', a=o['nom'], h=o['hw'],
                                    s=('<span class="selp" style="height:32px;font-size:12px"><i:olt:13:#64748B>%s<i:ab:11></span>' % o['arg']) if o['lig'] == 'ok' else '<span class="selp" style="height:32px;font-size:12px;border-color:#FCD34D;background:#FFFBEB;color:#92400E"><i:alerta:13>Elegir OLT<i:ab:11></span>') for o in olts))


m_ligar = T('''<div style="display:{{d.ligar.v}};position:absolute;inset:0;background:#fff;z-index:6;flex-direction:column" class="hoja">
 <header style="display:flex;align-items:center;gap:10px;padding:14px 14px 8px;flex:0 0 auto"><span class="f ci" style="width:38px;height:38px" onClick="{{d.det.ir}}"><i:izq:18></span><div style="flex:1"><b style="font-size:17px;display:block">Ligar OLT-NORTE-02</b><span class="m2">Elige su OLT en Argos</span></div></header>
 <div style="padding:0 14px 8px"><span class="busca" style="border:2px solid #4F46E5;color:#0F172A"><i:bus:15:#94A3B8>Norte</span></div>
 <div class="sc" style="flex:1;padding:0 14px"><<o>></div>
 <div class="mbar"><button class="btn p" onClick="{{d.det.ir}}"><i:check:16>Ligar con OLT Norte</button></div></div>''',
             o=''.join(T('<div style="display:flex;align-items:center;gap:10px;padding:12px;border-radius:12px;margin-bottom:6px;border:1px solid #E6E8F0;<<bg>><<op>>"><i:olt:16:#94A3B8><div style="flex:1"><b><<a>></b><div class="m2"><<b>></div></div><span style="display:<<v>>"><i:check:16:#4F46E5></span></div>', a=a, b=b, bg='background:#EEF2FF;border-color:#4F46E5;' if ok else '', op=';opacity:.55' if d else '', v='inline' if ok else 'none') for a, b, d, ok in opts))
mb1 = T('''<div style="height:100%;display:flex;flex-direction:column;position:relative">
<<top>>
<div class="sc" style="flex:1;padding:0 12px 12px"><<a>><<v>><<e>><<d1>><<d2>></div>
<div class="mbar" style="display:{{d.lista.v}}"><button class="btn p"><i:mas1:16>Agregar instancia</button></div>
<div class="mbar" style="display:{{d.vacio.v}}"><button class="btn p"><i:mas1:16>Agregar instancia</button></div>
<div class="mbar" style="display:{{d.error.v}}"><button class="btn p"><i:refresh:16>Reintentar</button></div>
<div class="mbar" style="display:{{d.det.v}}"><button class="btn o" style="flex:0 0 auto">Editar</button><button class="btn p"><i:refresh:16>Probar conexión</button></div>
<div class="mbar" style="display:{{d.detf.v}}"><button class="btn o" style="flex:0 0 auto">Editar</button><button class="btn p"><i:refresh:16>Probar otra vez</button></div>
<<l>></div>''', top=mtop('SmartOLT', 'Configuración › Integraciones', tbtn), a=m_lista, v=m_vacio, e=m_error, d1=m_det('det', False), d2=m_det('detf', True), l=m_ligar)
pmbuild('PendSmartoltMovil.dc.html', 'SmartOLT · teléfono', mb1, tlogic({'d': (['lista', 'vacio', 'error', 'det', 'detf', 'ligar'], 'lista'), 'm': (['no'], 'no')}, None), CSSM)

# --- formulario móvil
mf = T('''<div style="height:100%;display:flex;flex-direction:column;position:relative">
<<top>>
<div class="sc" style="flex:1;padding:0 14px 14px;display:flex;flex-direction:column;gap:12px">
 <div class="segb" style="display:flex;width:100%"><button class="ts {{f.nueva.cls}}" style="flex:1;justify-content:center" onClick="{{f.nueva.ir}}">Agregar</button><button class="ts {{f.editar.cls}}" style="flex:1;justify-content:center" onClick="{{f.editar.ir}}">Editar</button></div>
 <div class="av2 er" style="display:{{e.sub.v}};align-items:flex-start"><i:alerta:16><div><b>No se guardó.</b> El subdominio «zonanorte» ya lo usa «Principal».</div></div>
 <div class="av2 wa" style="display:{{f.editar.v}};align-items:flex-start"><i:alerta:16><div>Si cambias el subdominio o el token, hay que probar la conexión otra vez.</div></div>
 <div><div class="lb">Nombre en Argos<span class="req">*</span></div><div class="in">Zona norte</div></div>
 <div><div class="lb">Subdominio<span class="req">*</span></div><div class="in" style="{{subSt}}"><span style="display:{{f.nueva.b}};color:{{subCol}}">{{subTxt}}</span><span style="display:{{f.editar.b}}">zonanorte</span><span class="m2" style="margin-left:auto">.smartolt.com</span></div><div class="ay" style="display:{{e.sub.v}};color:#B91C1C">Ya existe una instancia con ese subdominio.</div></div>
 <div><div class="lb">Token<span class="req">*</span></div><div class="in" style="display:{{f.nueva.v}}"><i:llave:16:#94A3B8><span style="color:#94A3B8">Pega el token de SmartOLT</span></div><div class="in" style="display:{{f.editar.v}};background:#F8FAFC"><i:llave:16:#94A3B8><span class="mono">***</span><button class="lnk" style="margin-left:auto">Cambiar</button></div><div class="ay">En SmartOLT: General › API key.</div></div>
 <div><div class="lb">Quién la usa</div><div class="segb" style="display:flex;width:100%"><button class="ts {{q.una.cls}}" style="flex:1;justify-content:center" onClick="{{q.una.ir}}"><i:edif:14>Una empresa</button><button class="ts {{q.comp.cls}}" style="flex:1;justify-content:center" onClick="{{q.comp.ir}}"><i:globo:14>Compartida</button></div></div>
 <div style="display:{{q.una.b}}"><div class="in sel"><i:edif:16:#94A3B8><b>Conecta Norte, S.A.</b></div></div>
 <div class="av2 nf" style="display:{{q.comp.v}};align-items:flex-start"><i:globo:16><div>Todas las empresas la podrán usar. Solo la crea quien tiene acceso a todas.</div></div>
 <div><div class="lb">Nota (opcional)</div><div class="in" style="min-height:56px;align-items:flex-start;color:#94A3B8">Ej.: la renueva Luis en enero</div></div>
 <div style="display:flex;align-items:center;gap:12px"><span class="tg on"><i></i></span><div><b style="font-size:13px">Encenderla al guardar</b></div></div>
</div>
<div class="mbar"><button class="btn o" style="flex:0 0 auto">Cancelar</button><button class="btn p"><i:check:16>Guardar</button></div></div>''', top=mtop('Agregar instancia', 'SmartOLT', tbtn))
pmbuild('PendSmartoltFormMovil.dc.html', 'SmartOLT · formulario · teléfono', mf, tlogic({'f': (['nueva', 'editar'], 'nueva'), 'q': (['una', 'comp'], 'una'), 'e': (['no', 'sub'], 'no'), 'm': (['no'], 'no')}, None, "out.subTxt = st.e === 'sub' ? 'zonanorte' : 'miempresa'; out.subCol = st.e === 'sub' ? '#0F172A' : '#94A3B8'; out.subSt = st.e === 'sub' ? 'border:2px solid #DC2626' : 'border:2px solid #4F46E5;box-shadow:0 0 0 4px rgba(79,70,229,.12)';"), CSSM)

# --- ACS móvil
mav = lambda cls, ic_, h: '<div class="av2 %s" style="align-items:flex-start"><i:%s:16><div>%s</div></div>' % (cls, ic_, h)
mac = T('''<div style="height:100%;display:flex;flex-direction:column;position:relative">
<<top>>
<div class="sc" style="flex:1;padding:0 12px 12px;display:flex;flex-direction:column;gap:10px">
 <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><<ch>><span class="b ne"><i:edif:12>Conecta, S.A.</span></div>
 <div style="display:{{a.falla.v}};flex-direction:column"><<f>></div><div style="display:{{a.apagado.v}};flex-direction:column"><<ap>></div><div style="display:{{a.sin.v}};flex-direction:column"><<s>></div>
 <div style="display:{{vVer}};flex-direction:column;gap:10px"><section class="cd"><div class="cdh"><i:link:15>Conexión<button class="lnk">Editar</button></div><<k1>><<k2>><<k3>><<k4>></section>
 <section class="cd"><div class="cdh"><i:wifi:15>Qué hace el ACS</div>
  <div class="kv2"><span style="color:#0F172A"><b>Cambiar el Wi-Fi</b></span><span class="b ok"><i:check:12>Disponible</span></div>
  <div class="kv2"><span style="color:#0F172A"><b>PPPoE por ACS</b><span class="m2" style="display:block">Apagado: no se toca el PPPoE de la ONU</span></span><<tg>></div>
  <div class="m2" style="margin-top:6px">El Wi-Fi y el PPPoE de la ONU se configuran solo con ACS.</div></section></div>
 <div style="display:{{a.editar.v}};flex-direction:column;gap:12px"><div><div class="lb">Dirección (URL)<span class="req">*</span></div><div class="in" style="<<d>>">https://acs.conecta.gt:7557</div></div>
  <div><div class="lb">Usuario</div><div class="in">argos</div></div><div><div class="lb">Clave</div><div class="in" style="background:#F8FAFC"><span class="mono">***</span><button class="lnk" style="margin-left:auto">Cambiar</button></div></div>
  <div><div class="lb">Certificado propio (CA)</div><div class="in" style="color:#94A3B8">Ninguno<button class="lnk" style="margin-left:auto">Subir</button></div></div>
  <div style="display:flex;align-items:center;gap:12px"><span class="tg on"><i></i></span><b style="font-size:13px">Poner el PPPoE por ACS</b></div></div>
</div>
<div class="mbar" style="display:{{a.ok.v}}"><button class="btn o" style="flex:0 0 auto">Apagar</button><button class="btn p"><i:refresh:16>Probar conexión</button></div>
<div class="mbar" style="display:{{a.falla.v}}"><button class="btn o" style="flex:0 0 auto">Editar</button><button class="btn p"><i:refresh:16>Probar otra vez</button></div>
<div class="mbar" style="display:{{a.apagado.v}}"><button class="btn p"><i:power:16>Encender</button></div>
<div class="mbar" style="display:{{a.sin.v}}"><button class="btn p" onClick="{{a.editar.ir}}"><i:cpu:16>Configurar ACS</button></div>
<div class="mbar" style="display:{{a.editar.v}}"><button class="btn o" style="flex:0 0 auto" onClick="{{a.ok.ir}}">Cancelar</button><button class="btn p" onClick="{{a.ok.ir}}"><i:check:16>Guardar</button></div></div>''',
         top=mtop('ACS (GenieACS)', 'Configuración › Integraciones', tbtn), ch=chipacs, tg=tgl(True), d=DEST,
         f=mav('er', 'alerta', '<b>El ACS no respondió.</b> Los cambios de Wi-Fi esperan y se reintentan solos.'), ap=mav('wa', 'power', '<b>El ACS está apagado.</b> ' + AVISO_ACS),
         s=mav('wa', 'alerta', AVISO_ACS) + '<div class="m2" style="padding:12px 4px;line-height:1.5">El ACS (GenieACS) cambia el Wi-Fi y el PPPoE de la ONU. Cada empresa tiene uno.</div>',
         k1=kv('URL', '<span class="copy" style="font-size:11.5px">https://acs.conecta.gt:7557</span>'), k2=kv('Usuario', 'argos'), k3=kv('Clave', '<span class="mono">***</span> <button class="lnk">Cambiar</button>'), k4=kv('Última prueba', chip('ok', 'check', 'Probada') + ' <span class="m2">hoy 08:41</span>'))
pmbuild('PendAcsMovil.dc.html', 'ACS · teléfono', mac, tlogic({'a': (['ok', 'falla', 'apagado', 'sin', 'editar'], 'ok'), 'm': (['no'], 'no')}, None, "const ac = st.a || 'ok'; out.vVer = (ac === 'editar' || ac === 'sin') ? 'none' : 'flex';"), CSSM)

# --- ficha del servicio móvil
mes = T('''<div style="height:100%;display:flex;flex-direction:column;position:relative">
<<top>>
<div style="padding:0 12px 8px;flex:0 0 auto"><div class="segb" style="display:flex;width:100%"><button class="ts" style="flex:1;justify-content:center;padding:8px 4px">Resumen</button><button class="ts on" style="flex:1;justify-content:center;padding:8px 4px">Equipo</button><button class="ts" style="flex:1;justify-content:center;padding:8px 4px">Pausas</button></div></div>
<div class="sc" style="flex:1;padding:0 12px 12px;display:flex;flex-direction:column;gap:10px"><<s>><<a>><<p>></div>
<div class="mbar" style="display:{{vBarOk}}"><button class="btn o" style="flex:0 0 auto"><i:wifi:16>Cambiar Wi-Fi</button><button class="btn p"><i:herr:16>Aprovisionar ONU</button></div>
<div class="mbar" style="display:{{hSinAcs}}"><button class="btn p"><i:cpu:16>Configurar el ACS</button></div>
<div class="mbar" style="display:{{hSinOlt}}"><button class="btn p"><i:link:16>Ligar la OLT</button></div></div>''', top=mtop('S-000412 · Casa', 'Rosa Méndez · Activo', tbtn), s=card_s, a=card_a, p=card_p)
ex_m = ex5 + "\nout.vBarOk = (a === 'ok' || a === 'caida') ? 'flex' : 'none'; out.hSinAcs = a === 'sinacs' ? 'flex' : 'none'; out.hSinOlt = a === 'sinolt' ? 'flex' : 'none';"
ex_m = ex_m.replace("out.hSinOlt = a === 'sinolt' ? 'block' : 'none'; out.hCaida", "out.hSinOltB = a === 'sinolt' ? 'block' : 'none'; out.hCaida")
mes = mes.replace('<div style="display:{{hSinOlt}}"><div class="av2 wa"', '<div style="display:{{hSinOltB}}"><div class="av2 wa"')
pmbuild('PendEquipoServicioMovil.dc.html', 'Ficha del servicio · equipo · teléfono', mes, tlogic({'a': (['ok', 'sinacs', 'sinolt', 'caida'], 'ok'), 'm': (['no'], 'no')}, None, ex_m), CSSM)
print('pend_olt_acs listo')
