# Contabilidad · propuesta (pendiente de aprobación del PM, 26 nov 2026).
# Tableros: PlanContaInicio(+Movil), PlanContaConciliar(+Movil), PlanClienteFiscal(+Movil), PlanIndicadorAyuda(+Movil).
# Plan y API que piden: .claude/integration/contratos/plan-contabilidad.md
# Uso: python3 conta_plan.py   ·   SALIDA_TABLEROS=/otra/carpeta python3 conta_plan.py
import os
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'pend_base.py')).read())

CSSP = '''
.kt{background:#fff;border:1px solid #E6E8F0;border-radius:16px;padding:12px 14px;display:flex;flex-direction:column;gap:3px;min-width:0;flex:1;position:relative}
.kt .kl{font-size:12.5px;color:#64748B;display:flex;align-items:center;gap:6px;font-weight:600}
.kt .kv{font-size:23px;font-weight:700;letter-spacing:-.01em;font-variant-numeric:tabular-nums;white-space:nowrap}
.kt .ks{font-size:12px;color:#64748B;display:flex;align-items:center;gap:6px}
.q{width:20px;height:20px;border-radius:999px;border:1.5px solid #CBD5E1;color:#64748B;background:#fff;font-size:11.5px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;cursor:help;margin-left:auto;flex:0 0 auto;padding:0}
.q.on{background:#4F46E5;border-color:#4F46E5;color:#fff}
.pop{position:absolute;z-index:11;width:330px;border-radius:16px;padding:14px 16px;font-size:13px;line-height:1.5;display:flex;flex-direction:column;gap:8px}
.pop h4{margin:0;font-size:14px}.pop .pl{font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#64748B}
.pop .tec{font-size:12px;color:#64748B;border-top:1px solid #F1F5F9;padding-top:8px}
.stp{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-radius:14px;cursor:pointer}
.stp:hover{background:#F8FAFC}.stp.on{background:#EEF2FF}
.stp .n{width:28px;height:28px;border-radius:999px;display:flex;align-items:center;justify-content:center;flex:0 0 auto;font-weight:700;font-size:12.5px;background:#F1F5F9;color:#64748B}
.stp.ok .n{background:#DCFCE7;color:#166534}.stp.on .n{background:#4F46E5;color:#fff}.stp.wa .n{background:#FEF3C7;color:#92400E}
.stp b{font-size:13.5px;display:block}.stp small{font-size:12px;color:#64748B;display:block}
.tar{display:flex;align-items:center;gap:12px;padding:11px 0;border-top:1px solid #F1F5F9}
.tar:first-child{border-top:0}
.cnt{min-width:30px;height:30px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;padding:0 8px}
.cr{display:flex;flex-direction:column;align-items:flex-start;gap:6px;padding:12px;border-radius:14px;border:1px solid #E6E8F0;background:#fff;font-size:13px;font-weight:600;cursor:pointer;flex:1;min-width:0;text-align:left;font-family:inherit}
.cr small{font-weight:500;color:#64748B;font-size:11.5px}
.bl{display:grid;grid-template-columns:20px 64px minmax(0,1fr) 96px 150px;gap:10px;align-items:center;padding:11px 16px;border-bottom:1px solid #F1F5F9;font-size:13px;cursor:pointer}
.bl.on{background:#F5F7FF;box-shadow:inset 3px 0 0 #4F46E5}
.sug{border:1.5px solid #E2E8F0;border-radius:14px;padding:10px 12px;display:flex;gap:10px;align-items:center;font-size:13px;cursor:pointer}
.sug.on{border-color:#4F46E5;background:#EEF2FF}
.pasos{display:flex;align-items:center;gap:8px;flex:0 0 auto}
.osc .kt,.osc .cr,.osc .sug,.osc .pop{background:#121A2B!important;border-color:#1E2638!important;color:#E2E8F0}
.osc .kt .kv,.osc .stp b,.osc .cr,.osc .pop h4{color:#F1F5F9}
.osc .kt .kl,.osc .kt .ks,.osc .stp small,.osc .cr small,.osc .pop .pl,.osc .pop .tec{color:#94A3B8!important;border-color:#1E2638}
.osc .q{background:#0F1524;border-color:#2A3550;color:#CBD5E1}.osc .q.on{background:#818CF8;border-color:#818CF8;color:#0B0F1A}
.osc .stp:hover{background:#161E31}.osc .stp.on,.osc .sug.on,.osc .bl.on{background:rgba(129,140,248,.14)!important;border-color:#818CF8}
.osc .stp .n{background:#1E2638;color:#CBD5E1}.osc .stp.on .n{background:#818CF8;color:#0B0F1A}.osc .stp.ok .n{background:rgba(34,197,94,.16);color:#86EFAC}.osc .stp.wa .n{background:rgba(245,158,11,.16);color:#FCD34D}
.osc .tar,.osc .bl{border-color:#1A2235}
'''
Q = lambda g, i: T('<button class="q {{<<g>>.<<i>>.cls}}" aria-label="¿Qué es esto?" onClick="{{<<g>>.<<i>>.ir}}">?</button>', g=g, i=i)


def pop(g, i, st, tit, que, calc, hacer, tec, lnk='Ver el detalle'):
    return T('''<div class="isla pop" role="dialog" aria-label="¿Qué es esto?" style="display:{{<<g>>.<<i>>.v}};<<st>>">
 <div style="display:flex;align-items:center;gap:8px"><span class="ico nf" style="width:30px;height:30px;border-radius:10px"><i:ayuda:16></span><h4 style="flex:1"><<tit>></h4><button class="ib" aria-label="Cerrar" onClick="{{<<g>>.no.ir}}"><i:cerrar:15></button></div>
 <div><div class="pl">Qué es</div><<que>></div>
 <div><div class="pl">Cómo se calcula</div><<calc>></div>
 <div><div class="pl">Qué hacer</div><<hacer>></div>
 <div class="tec">Nombre contable: <b><<tec>></b></div>
 <div style="display:flex;gap:10px"><button class="lnk"><<lnk>></button><span style="flex:1"></span><button class="lnk" style="color:#64748B">Abrir el manual</button></div>
</div>''', g=g, i=i, st=st, tit=tit, que=que, calc=calc, hacer=hacer, tec=tec, lnk=lnk)


def ind(g, i, ico, cls, lab, val, sub, est=None):
    e = chip(*est) if est else ''
    return T('<div class="kt"><div class="kl"><span class="ico <<cls>>" style="width:26px;height:26px;border-radius:8px"><i:<<ico>>:15></span><<lab>><<q>></div><div class="kv"><<val>></div><div class="ks"><<e>><<sub>></div></div>', cls=cls, ico=ico, lab=lab, val=val, sub=sub, e=e, q=Q(g, i))


# ============================ 1 · Inicio de contabilidad ============================
PASOS = [('ok', 'check', 'Facturar', '412 facturas del mes emitidas', 'Listo'),
         ('ok', 'check', 'Cobrar y cerrar cajas', 'Todas las cajas cerradas hasta ayer', 'Listo'),
         ('wa', '3', 'Registrar compras y gastos', '2 facturas de proveedor por revisar', 'Revisar'),
         ('on', '4', 'Conciliar los bancos', '14 movimientos del banco sin pareja', 'Conciliar'),
         ('', '5', 'Revisar el mes', 'Lista de verificación: se corre al terminar el paso 4', ''),
         ('', '6', 'Declarar impuestos', 'IVA de noviembre · vence el 31 dic', ''),
         ('', '7', 'Cerrar el mes', 'Nadie podrá cambiar noviembre después', '')]
pasos = ''.join(T('<div class="stp <<c>>"><span class="n"><<n>></span><div style="flex:1;min-width:0"><b><<t>></b><small><<s>></small></div><<b>></div>',
                  c=c, n=(T('<i:check:14>') if n == 'check' else n), t=t, s=s, b=(T('<button class="btn <<k>> sm"><<x>></button>', k='p' if c == 'on' else 'o', x=b) if b and c != 'ok' else (chip('ok', 'check', 'Listo') if c == 'ok' else ''))) for c, n, t, s, b in PASOS)
TAREAS = [('er', '3', 'Comprobantes de pago por revisar', 'Clientes que ya depositaron y esperan', 'Revisar', 'comprobantes.ver'),
          ('wa', '14', 'Movimientos del banco sin pareja', 'Banco Industrial · estado de cuenta al 24 nov', 'Conciliar', 'bancos.conciliar'),
          ('wa', '2', 'Depósitos de caja que el banco aún no muestra', 'Q 4,150.00 · el más viejo es de hace 4 días', 'Ver', 'bancos.ver'),
          ('wa', '2', 'Facturas de proveedor por revisar', 'Leídas de la foto; falta confirmarlas', 'Revisar', 'compras.registrar'),
          ('nf', '5', 'Facturas sin certificar (FEL)', 'Se certifican al cobrarlas o desde aquí', 'Certificar', 'fel.certificar'),
          ('nf', '1', 'Asiento por aprobar', 'Lo creó Luis Pérez · ajuste de Q 350.00', 'Aprobar', 'libro.aprobar_asiento'),
          ('ne', '4', 'Compras por pagar esta semana', 'Q 8,210.00 a 3 proveedores', 'Pagar', 'compras.pagar')]
tareas = ''.join(T('<div class="tar"><span class="cnt" style="background:<<bg>>;color:<<fg>>"><<n>></span><div style="flex:1;min-width:0"><b style="font-size:13.5px;display:block" class="el"><<t>></b><span class="m2 el" style="display:block"><<s>></span></div><button class="btn o sm"><<b>><i:der:13></button></div>',
                   n=n, t=t, s=s, b=b, bg={'er': '#FEE2E2', 'wa': '#FEF3C7', 'nf': '#EEF2FF', 'ne': '#F1F5F9'}[k], fg={'er': '#B91C1C', 'wa': '#92400E', 'nf': '#3730A3', 'ne': '#475569'}[k]) for k, n, t, s, b, p in TAREAS)
CREAR = [('fac', 'Nueva factura', 'A un cliente, por algo fuera de la mensualidad'), ('cob', 'Registrar un cobro', 'Efectivo, depósito o transferencia'),
         ('doc', 'Registrar compra o gasto', 'Con factura del proveedor o sin ella'), ('banco', 'Pagar a un proveedor', 'Lo que quedó al crédito'),
         ('caja', 'Depositar la caja', 'Llevar el efectivo al banco'), ('libro', 'Asiento manual', 'Solo contabilidad')]
crear = ''.join(T('<button class="cr"><span class="ico nf" style="width:30px;height:30px;border-radius:10px"><i:<<i>>:16></span><<t>><small><<s>></small></button>', i=i, t=t, s=s) for i, t, s in CREAR)
inds = (ind('a', 'cxc', 'cli', 'wa', 'Te deben', 'Q 15,840.50', '64 facturas · Q 1,652 con más de 60 días', ('wa', 'alerta', 'Atención'))
        + ind('a', 'cxp', 'doc', 'ne', 'Debes a proveedores', 'Q 8,210.00', '4 compras · Q 5,000 ya vencidos')
        + ind('a', 'din', 'banco', 'ok', 'Dinero disponible', 'Q 9,757.77', '2 bancos y 2 cajas', ('ok', 'check', 'Bien'))
        + ind('a', 'imp', 'calc', 'nf', 'Impuestos del mes', 'Q 3,912.40', 'IVA estimado de noviembre · vence 31 dic'))
pops = (pop('a', 'cxc', 'left:124px;top:238px', 'Te deben', 'Lo que tus clientes aún no han pagado de sus facturas.', 'Suma de lo pendiente de cada factura emitida, sin las anuladas ni lo ya cobrado.', 'Si lo de más de 60 días crece, revisa <b>Cobranza</b>: llama, acuerda una promesa o corta el servicio.', 'Cuentas por cobrar (1.1.03)', 'Ver quién debe')
        + pop('a', 'cxp', 'left:452px;top:238px', 'Debes a proveedores', 'Compras que recibiste al crédito y todavía no pagas.', 'Suma del saldo de cada compra al crédito, menos los pagos y las notas de crédito del proveedor.', 'Paga primero lo vencido desde <b>Compras › Pagar a proveedor</b>.', 'Cuentas por pagar (2.1.03)', 'Ver a quién debo')
        + pop('a', 'din', 'left:640px;top:238px', 'Dinero disponible', 'Lo que hay hoy en tus bancos y en tus cajas según lo registrado en Argos.', 'Saldo de cada cuenta de banco más el efectivo de cada caja. No cuenta lo que va en camino al banco.', 'Si no coincide con tu banca en línea, <b>concilia</b>: algo falta registrar.', 'Cajas y bancos (1.1.01 y 1.1.02)', 'Ver por cuenta')
        + pop('a', 'imp', 'left:960px;top:238px', 'Impuestos del mes', 'Lo que calculamos que pagarás a la SAT por este mes. Es un borrador.', 'IVA de tus ventas menos el IVA de tus compras, menos lo que te retuvieron.', 'Registra todas tus compras antes de fin de mes: cada factura baja este número.', 'IVA por pagar (débito − crédito fiscal)', 'Ver el cálculo'))
ini = T('''<<head>>
<div style="display:flex;gap:10px;flex:0 0 auto"><<inds>></div>
<div style="display:flex;gap:12px;flex:1;min-height:0">
 <section class="isla pan" style="flex:1.15">
  <div class="ph2"><span class="ico wa" style="width:32px;height:32px;border-radius:10px"><i:lista:16></span><div style="flex:1"><b style="font-size:15px">Qué toca hoy</b><div class="m2">Lo que espera por ti, lo más urgente arriba</div></div><span class="b wa">31 pendientes</span></div>
  <div class="sc" style="flex:1;padding:4px 18px"><<tareas>></div>
 </section>
 <section class="isla pan" style="flex:1">
  <div class="ph2"><span class="ico nf" style="width:32px;height:32px;border-radius:10px"><i:cal:16></span><div style="flex:1"><b style="font-size:15px">Pasos de noviembre</b><div class="m2">De arriba hacia abajo; el mes termina en el paso 7</div></div><span style="font-size:13px;font-weight:700;color:#4338CA">2 de 7</span></div>
  <div style="padding:0 18px"><span class="bar" style="margin:10px 0 4px"><i style="width:29%"></i></span></div>
  <div class="sc" style="flex:1;padding:4px 8px 8px"><<pasos>></div>
 </section>
 <section class="isla pan" style="width:300px;flex:0 0 auto">
  <div class="ph2"><b style="font-size:15px;flex:1">Crear</b></div>
  <div class="sc" style="flex:1;padding:12px;display:grid;grid-template-columns:1fr 1fr;gap:8px;align-content:start"><<crear>></div>
  <div class="pf m2"><i:info:14>Solo ves lo que tu rol permite.</div>
 </section>
</div>''', head=head('Contabilidad', 'Redes del Valle · noviembre 2026 · empieza por «Qué toca hoy» y sigue los pasos del mes', emp('Redes del Valle') + per('Noviembre 2026') + TEMA_HINT, 'Ayuda: cómo llevar la contabilidad del mes'),
        inds=inds, tareas=tareas, pasos=pasos, crear=crear)
nota1 = nota_estados('Ayuda «¿Qué es esto?» de cada número', 'a', [('no', 'Cerrada'), ('cxc', 'Te deben'), ('cxp', 'Debes'), ('din', 'Dinero'), ('imp', 'Impuestos')], 'right:330px;bottom:28px;width:400px')
G1 = {'a': (['no', 'cxc', 'cxp', 'din', 'imp'], 'no')}
pbuild('PlanContaInicio.dc.html', 'Contabilidad · inicio con tareas y pasos del mes', shell2('fin', ['Finanzas', 'Inicio de contabilidad'], ini, pops + nota1), tlogic(G1), 900, CSSP)

# ---- teléfono
mt = ''.join(T('<div class="tar"><span class="cnt" style="background:<<bg>>;color:<<fg>>"><<n>></span><div style="flex:1;min-width:0"><b style="font-size:13.5px;display:block"><<t>></b></div><i:der:15:#94A3B8></div>',
               n=n, t=t, bg={'er': '#FEE2E2', 'wa': '#FEF3C7', 'nf': '#EEF2FF', 'ne': '#F1F5F9'}[k], fg={'er': '#B91C1C', 'wa': '#92400E', 'nf': '#3730A3', 'ne': '#475569'}[k]) for k, n, t, s, b, p in TAREAS[:5])
mp = ''.join(T('<div class="stp <<c>>" style="padding:8px 6px"><span class="n"><<n>></span><div style="flex:1;min-width:0"><b><<t>></b><small><<s>></small></div></div>', c=c, n=(T('<i:check:14>') if n == 'check' else n), t=t, s=s) for c, n, t, s, b in PASOS)
mini = T('''<div style="height:100%;display:flex;flex-direction:column;position:relative">
<<top>>
<div style="padding:0 12px 8px;flex:0 0 auto"><div class="segb" style="display:flex;width:100%"><button class="ts {{t.hoy.cls}}" style="flex:1;justify-content:center" onClick="{{t.hoy.ir}}">Qué toca hoy<span class="c rj">31</span></button><button class="ts {{t.mes.cls}}" style="flex:1;justify-content:center" onClick="{{t.mes.ir}}">Pasos del mes<span class="c">2/7</span></button></div></div>
<div class="sc" style="flex:1;padding:0 12px 12px;display:flex;flex-direction:column;gap:10px">
 <div style="display:{{t.hoy.v}};flex-direction:column;gap:10px">
  <div style="display:flex;gap:8px"><<i1>><<i2>></div>
  <div class="isla pop" style="display:{{a.cxc.v}};position:static;width:auto"><div style="display:flex;gap:8px;align-items:center"><h4 style="flex:1">Te deben</h4><button class="ib" onClick="{{a.no.ir}}" aria-label="Cerrar"><i:cerrar:15></button></div><div>Lo que tus clientes aún no han pagado de sus facturas. Si lo de más de 60 días crece, revisa <b>Cobranza</b>.</div><div class="tec">Nombre contable: <b>Cuentas por cobrar</b></div></div>
  <section class="cd" style="padding:4px 14px"><<mt>></section>
 </div>
 <section class="cd" style="display:{{t.mes.v}};padding:8px"><<mp>></section>
</div>
<div class="mbar"><button class="btn o" style="flex:0 0 auto"><i:mas1:16>Crear</button><button class="btn p"><i:unir:16>Conciliar (14)</button></div>
</div>''', top=mtop('Contabilidad', 'Redes del Valle · noviembre', '<button class="ib f" style="width:38px;height:38px;border-radius:999px" onClick="{{tTema}}" aria-label="Tema"><i:luna:17></button>'),
         i1=ind('a', 'cxc', 'cli', 'wa', 'Te deben', 'Q 15,840', '64 facturas'), i2=ind('a', 'din', 'banco', 'ok', 'Disponible', 'Q 9,757', 'bancos y cajas'), mt=mt, mp=mp)
pmbuild('PlanContaInicioMovil.dc.html', 'Contabilidad · inicio · teléfono', mini, tlogic({'t': (['hoy', 'mes'], 'hoy'), 'a': (['no', 'cxc', 'din'], 'no')}), CSSP)

# ============================ 2 · Conciliar el banco (flujo guiado) ============================
LIN = [dict(id=1, f='10 nov', d='ABONO PASARELA LIQ', r='LIQ-2026-11-10', m='Q 308.78', k='ok', ki='check', kt='Pareja segura', g='seg'),
       dict(id=2, f='12 nov', d='CREDITO TRANSFERENCIA ACH', r='TRF-55120', m='Q 450.00', k='nf', ki='ayuda', kt='Posible pareja', g='pos'),
       dict(id=3, f='13 nov', d='DEPOSITO EN EFECTIVO AG. CENTRAL', r='B-4471', m='Q 895.00', k='wa', ki='dif', kt='Diferencia Q 5.00', g='dif'),
       dict(id=4, f='14 nov', d='COMISION MANEJO DE CUENTA', r='—', m='− Q 15.00', k='cy', ki='rayo', kt='Regla: gasto bancario', g='reg'),
       dict(id=5, f='14 nov', d='DEPOSITO MONETARIO 0098812', r='0098812', m='Q 200.00', k='er', ki='x', kt='Sin pareja', g='sin'),
       dict(id=6, f='15 nov', d='PAGO SERVICIO EEGSA', r='884120', m='− Q 1,850.40', k='ok', ki='check', kt='Pareja segura', g='seg')]
blin = T('''<sc-for list="{{lin}}" as="x"><div class="bl {{x.cls}}" onClick="{{x.ver}}"><span class="ck2"></span><span class="m2">{{x.f}}</span>
 <div style="min-width:0"><b class="el" style="display:block">{{x.d}}</b><span class="m2 mono" style="font-size:11.5px">ref. {{x.r}}</span></div>
 <b class="num r">{{x.m}}</b><span><span class="b {{x.k}}"><span class="ti ti-{{x.ki}}" style="width:13px;height:13px"></span>{{x.kt}}</span></span></div></sc-for>''')
def det(i, tit, sub, body, acc):
    return T('<div style="display:{{sel.<<i>>.v}};flex-direction:column;gap:10px;flex:1;min-height:0"><div><b style="font-size:16px"><<t>></b><div class="m2"><<s>></div></div><div class="sc" style="flex:1;display:flex;flex-direction:column;gap:8px"><<b>></div><div style="display:flex;gap:8px;justify-content:flex-end"><<a>></div></div>', i=i, t=tit, s=sub, b=body, a=acc)
sg = lambda on, a, b, c: T('<div class="sug <<on>>"><span class="rd2 <<on>>"></span><div style="flex:1;min-width:0"><b class="el" style="display:block"><<a>></b><span class="m2"><<b>></span></div><b class="num"><<c>></b></div>', on='on' if on else '', a=a, b=b, c=c)
d_seg = det('s1', 'Coincide con una liquidación', 'Mismo monto y misma referencia: no hay nada que decidir',
            sg(True, 'Liquidación 1 de Pasarela', '10 nov · ref. LIQ-2026-11-10', 'Q 308.78') + '<div class="av2 ok"><i:check:16><div>Todas las «parejas seguras» se pueden aceptar juntas con <b>Aceptar las 6 seguras</b>.</div></div>',
            '<button class="btn o">No es esta</button><button class="btn p"><i:check:15>Aceptar pareja</button>')
d_pos = det('s2', 'Hay 2 candidatos', 'Elige cuál es. Mismo monto, fecha cercana',
            sg(True, 'Pago 6102 · María López', '12 nov · transferencia · ref. TRF-55120', 'Q 450.00') + sg(False, 'Pago 6088 · Taller Hermanos Ruiz', '11 nov · depósito · sin referencia', 'Q 450.00') + '<div class="m2">¿Ninguno? <button class="lnk">Buscar otro movimiento</button> o <button class="lnk">registrar un cobro nuevo</button>.</div>',
            '<button class="btn o">Dejar para después</button><button class="btn p"><i:check:15>Es el pago 6102</button>')
d_dif = det('s3', 'El banco muestra Q 5.00 menos', 'Encontramos el depósito, pero el monto no es igual',
            sg(True, 'Depósito de caja #14 · boleta B-4471', '13 nov · Caja principal', 'Q 900.00')
            + '<div class="cd" style="gap:8px"><div class="cdh" style="margin:0"><i:dif:15>¿Qué pasó con los Q 5.00?</div>' + sg(True, 'El banco cobró una comisión', 'Se registra como gasto bancario', '− Q 5.00') + sg(False, 'Se contó mal el efectivo', 'Se registra como faltante de caja', '− Q 5.00') + sg(False, 'Otra razón', 'Tú eliges dónde va', '') + '</div>'
            + '<div class="kv2"><span>Banco</span><b class="num">Q 895.00</b></div><div class="kv2"><span>Depósito − comisión</span><b class="num" style="color:#166534">Q 895.00 · cuadra</b></div>',
            '<button class="btn o">Dejar para después</button><button class="btn p"><i:check:15>Conciliar con la diferencia</button>')
d_reg = det('s4', 'Lo reconoció una regla', '«Si el texto dice COMISION MANEJO → gasto bancario»',
            '<div class="cd"><div class="kv2"><span>Se registra como</span><b>Gasto bancario</b></div><div class="kv2"><span>Monto</span><b class="num">Q 15.00</b></div><div class="kv2"><span>Regla</span><span>Comisiones del banco <button class="lnk">Editar</button></span></div></div><div class="m2">Las reglas proponen; nada entra al libro hasta que aceptas.</div>',
            '<button class="btn o">No aplicar</button><button class="btn p"><i:check:15>Registrar y conciliar</button>')
d_sin = det('s5', 'Nadie registró este depósito', 'Di qué es y Argos lo registra y lo concilia en un paso',
            ''.join(T('<div class="sug"><span class="ico <<c>>" style="width:32px;height:32px;border-radius:10px"><i:<<i>>:16></span><div style="flex:1"><b><<a>></b><div class="m2"><<b>></div></div><i:der:15:#94A3B8></div>', c=c, i=i, a=a, b=b) for c, i, a, b in [('ok', 'cob', 'Es el pago de un cliente', 'Busca al cliente y aplica a sus facturas'), ('nf', 'cambio', 'Vino de otra cuenta mía', 'Traslado entre cuentas'), ('cy', 'tend', 'Interés u otro ingreso', 'Elige el tipo de ingreso'), ('ne', 'pausa', 'No sé todavía', 'Queda en «por identificar» y no bloquea el cierre con una nota')])
            + '<label style="display:flex;gap:8px;align-items:center;font-size:13px"><span class="ck2"></span>Crear una regla para la próxima vez</label>', '<button class="btn o">Dejar para después</button>')
conc = T('''<<head>>
<div class="isla" style="border-radius:16px;padding:10px 16px;display:flex;align-items:center;gap:10px;flex:0 0 auto">
 <button class="pc ok"><span class="n"><i:check:13></span>Subir el estado de cuenta</button><span class="ln ok"></span>
 <button class="pc on"><span class="n">2</span>Emparejar</button><span class="ln"></span>
 <button class="pc"><span class="n">3</span>Revisar el saldo</button><span class="ln"></span>
 <button class="pc"><span class="n">4</span>Terminar</button>
 <span style="width:1px;height:26px;background:#E6E8F0"></span>
 <div style="min-width:170px"><div class="m2">Emparejado: <b style="color:#0F172A">38 de 52</b></div><span class="bar" style="margin-top:4px"><i style="width:73%"></i></span></div>
</div>
<div style="display:flex;gap:12px;flex:1;min-height:0">
 <section class="isla pan" style="flex:1.25">
  <div class="ph2"><<seg>></div>
  <div class="lh" style="grid-template-columns:20px 64px minmax(0,1fr) 96px 150px;padding:9px 16px"><span></span><span>Fecha</span><span>Lo que dice el banco</span><span class="r">Monto</span><span>Argos encontró</span></div>
  <div class="sc" style="flex:1"><<blin>></div>
  <div class="pf m2"><i:info:14><span style="flex:1">Entradas en positivo, salidas con «−». Lo emparejado pasa a «Listas».</span><button class="btn v sm"><i:check:14>Aceptar las 6 seguras</button></div>
 </section>
 <section class="isla pan" style="flex:1;padding:16px 18px;gap:10px">
  <div class="cdh" style="margin:0"><i:unir:15>Movimiento elegido · {{linSel.f}} · {{linSel.m}}</div>
  <<d1>><<d2>><<d3>><<d4>><<d5>>
 </section>
</div>''', head=head('Conciliar el banco', 'Banco Industrial · Monetaria ···4521 · estado de cuenta del 1 al 24 de noviembre', '<button class="btn o"><i:rayo:15>Reglas</button><button class="btn o"><i:subir:15>Subir otro estado de cuenta</button>' + TEMA_HINT, 'Ayuda: qué es conciliar y para qué sirve'),
         seg=seg('f', [('todo', 'Por emparejar', None, 14, 'rj'), ('seg', 'Seguras', 'check', 6), ('dud', 'Para decidir', 'ayuda', 5), ('sin', 'Sin pareja', 'x', 3), ('ok', 'Listas', None, 38)]),
         blin=blin, d1=d_seg, d2=d_pos, d3=d_dif, d4=d_reg, d5=d_sin)
SELJS = "const sid = st.s_lin === undefined ? 3 : st.s_lin; const mp = {1:'s1',2:'s2',3:'s3',4:'s4',5:'s5',6:'s1'}; out.sel = {}; ['s1','s2','s3','s4','s5'].forEach((k) => { out.sel[k] = { v: mp[sid] === k ? 'flex' : 'none' }; });"
pbuild('PlanContaConciliar.dc.html', 'Conciliar el banco · flujo guiado con parejas sugeridas, diferencias y reglas', shell2('fin', ['Finanzas', 'Bancos', 'Conciliar'], conc),
       tlogic({'f': (['todo', 'seg', 'dud', 'sin', 'ok'], 'todo')}, {'lin': {'rows': LIN, 'def': 3}}, SELJS), 900, CSSP + mask(['check', 'ayuda', 'dif', 'rayo', 'x']))

mlin = T('''<sc-for list="{{lin}}" as="x"><div class="card" style="padding:11px 13px;display:flex;flex-direction:column;gap:6px" onClick="{{d.det.ir}}">
 <div style="display:flex;gap:8px;align-items:center"><b class="el" style="flex:1;font-size:13.5px">{{x.d}}</b><b class="num">{{x.m}}</b></div>
 <div style="display:flex;gap:8px;align-items:center"><span class="m2">{{x.f}} · ref. {{x.r}}</span><span style="flex:1"></span><span class="b {{x.k}}" style="font-size:11px"><span class="ti ti-{{x.ki}}" style="width:12px;height:12px"></span>{{x.kt}}</span></div></div></sc-for>''')
mconc = T('''<div style="height:100%;display:flex;flex-direction:column;position:relative">
<<top>>
<div style="padding:0 14px 8px;flex:0 0 auto"><div class="m2">Paso 2 de 4 · emparejado <b style="color:#0F172A">38 de 52</b></div><span class="bar" style="margin-top:5px"><i style="width:73%"></i></span></div>
<div class="sc" style="flex:1;padding:0 12px 12px">
 <div style="display:{{d.lista.v}};flex-direction:column;gap:8px"><<mlin>></div>
 <div style="display:{{d.det.v}};flex-direction:column;gap:10px">
  <section class="cd"><div class="m2">13 nov · ref. B-4471</div><b style="font-size:15px">DEPOSITO EN EFECTIVO AG. CENTRAL</b><b class="num" style="font-size:22px">Q 895.00</b></section>
  <section class="cd" style="gap:8px"><div class="cdh" style="margin:0">Argos encontró</div><<s1>><div class="cdh" style="margin:6px 0 0"><i:dif:15>¿Y los Q 5.00 que faltan?</div><<s2>><<s3>><<s4>></section>
 </div>
</div>
<div class="mbar" style="display:{{d.lista.v}}"><button class="btn v"><i:check:16>Aceptar las 6 seguras</button></div>
<div class="mbar" style="display:{{d.det.v}}"><button class="btn o" style="flex:0 0 auto" onClick="{{d.lista.ir}}">Después</button><button class="btn p"><i:check:16>Conciliar con la diferencia</button></div>
</div>''', top=mtop('Conciliar el banco', 'Banco Industrial ···4521', '<button class="ib f" style="width:38px;height:38px;border-radius:999px" onClick="{{tTema}}" aria-label="Tema"><i:luna:17></button>'), mlin=mlin,
          s1=sg(True, 'Depósito de caja #14', 'boleta B-4471 · Caja principal', 'Q 900.00'), s2=sg(True, 'Comisión del banco', 'Gasto bancario', '− Q 5.00'), s3=sg(False, 'Se contó mal el efectivo', 'Faltante de caja', ''), s4=sg(False, 'Otra razón', 'Tú eliges', ''))
pmbuild('PlanContaConciliarMovil.dc.html', 'Conciliar el banco · teléfono (lista y decisión)', mconc, tlogic({'d': (['lista', 'det'], 'lista')}, {'lin': {'rows': LIN, 'def': 3}}), CSSP + mask(['check', 'ayuda', 'dif', 'rayo', 'x']))

# ============================ 3 · Ficha del cliente: «Nueva factura» y tipo de impuesto ============================
TIPOS = [('nor', 'Normal', 'Se le cobra IVA. Es lo de casi todos los clientes.', 'Factura con IVA incluido'),
         ('ret', 'Agente retenedor de IVA', 'Empresa grande o del Estado: te paga menos y te da una constancia.', 'Al cobrar, Argos espera la constancia por el 15 % del IVA'),
         ('exe', 'Exento de IVA', 'Entidad que por ley no paga IVA (pide su resolución).', 'Factura sin IVA, con la frase de exención'),
         ('isr', 'Te retiene ISR', 'Te descuenta el 5 % o 7 % y te da constancia.', 'Al cobrar, Argos espera la constancia de ISR')]
tipos = ''.join(T('<div class="op {{tp.<<i>>.cls}}" onClick="{{tp.<<i>>.ir}}" style="align-items:center"><span class="rd"></span><div style="flex:1"><b style="font-size:14px"><<a>></b><div style="font-size:12px;color:#64748B"><<b>></div></div><span class="m2" style="max-width:210px;text-align:right"><<c>></span></div>', i=i, a=a, b=b, c=c) for i, a, b, c in TIPOS)
m_tipo = dlg('tipo', 'calc', 'nf', 'Tipo de impuesto de Hotel Posada del Valle', '<div class="m2">Define cómo salen sus facturas y qué se espera al cobrarle. Cambiarlo no toca las facturas ya emitidas.</div><div style="display:flex;flex-direction:column;gap:8px">' + tipos + '</div>' + campo('Documento que lo respalda', '~Resolución o constancia de la SAT (PDF o foto)', False, '', 'Obligatorio para «Exento»', 'subir'),
             '<button class="btn g" onClick="{{m.no.ir}}">Cancelar</button><button class="btn p" onClick="{{m.no.ir}}"><i:check:15>Guardar</button>', w=640)
lin_f = ''.join(T('<div class="lr" style="grid-template-columns:minmax(0,1.6fr) 70px 110px 110px 28px;cursor:default;padding:10px 0"><div class="in sel" style="padding:8px 10px"><<a>></div><div class="in" style="padding:8px 10px"><<b>></div><div class="in num" style="padding:8px 10px"><<c>></div><b class="num r"><<d>></b><button class="ib" aria-label="Quitar línea"><i:x:14></button></div>', a=a, b=b, c=c, d=d) for a, b, c, d in [('Instalación de punto adicional', '1', 'Q 350.00', 'Q 350.00'), ('Router WiFi 6 (de bodega Central)', '2', 'Q 425.00', 'Q 850.00')])
m_fac = T('''<aside class="isla" role="dialog" aria-label="Nueva factura" style="display:{{m.fac.v}};position:absolute;right:16px;top:16px;bottom:16px;width:620px;border-radius:22px;z-index:9;flex-direction:column">
 <div class="ph2"><span class="ico nf"><i:fac:18></span><div style="flex:1"><b style="font-size:17px">Nueva factura</b><div class="m2">Hotel Posada del Valle · NIT 4521789-3 · <span class="b cy" style="font-size:11px">Agente retenedor de IVA</span></div></div><button class="ib" aria-label="Cerrar" onClick="{{m.no.ir}}"><i:cerrar:17></button></div>
 <div class="sc" style="flex:1;padding:14px 18px;display:flex;flex-direction:column;gap:12px">
  <div class="g2"><<c1>><<c2>></div>
  <div><div class="lh" style="grid-template-columns:minmax(0,1.6fr) 70px 110px 110px 28px;padding:8px 0;background:transparent;border-top:0"><span>Qué se cobra</span><span>Cant.</span><span>Precio con IVA</span><span class="r">Total</span><span></span></div><<lin>><button class="lnk" style="margin-top:8px"><i:mas1:13> Agregar línea</button></div>
  <div class="cd" style="background:#F8FAFC">
   <div class="kv2"><span>Subtotal sin IVA</span><span class="num">Q 1,071.43</span></div><div class="kv2"><span>IVA 12 %</span><span class="num">Q 128.57</span></div>
   <div class="kv2"><span style="color:#0F172A"><b>Total de la factura</b></span><b class="num" style="font-size:18px">Q 1,200.00</b></div>
   <div class="kv2"><span>Te retendrá (15 % del IVA) <<q>></span><span class="num">− Q 19.29</span></div>
   <div class="kv2"><span style="color:#0F172A"><b>Recibirás en dinero</b></span><b class="num" style="color:#166534">Q 1,180.71</b></div>
  </div>
  <div class="av2 nf"><i:info:16><div>Se certifica en la SAT (FEL) al guardar. Los 2 routers salen de la bodega Central.</div></div>
 </div>
 <div class="pf"><button class="btn g" onClick="{{m.no.ir}}">Cancelar</button><span style="flex:1"></span><button class="btn o">Guardar y cobrar ahora</button><button class="btn p"><i:check:15>Emitir factura</button></div>
</aside>''', c1=campo('Servicio (opcional)', 'S-000412 · Fibra 100 Mb', False, 'sel', 'Sin servicio, la factura no cuenta para el corte'), c2=campo('Vence', '10 dic 2026', False, 'sel', '', 'cal'), lin=lin_f, q=Q('a', 'ret'))
p_ret = pop('a', 'ret', 'right:60px;top:300px', 'Retención de IVA', 'Este cliente, por ley, no te paga todo el IVA: se queda una parte y la entrega él a la SAT.', '15 % del IVA de la factura. Te da una <b>constancia</b> que vale como dinero al declarar.', 'Al cobrar, registra el dinero y la constancia juntos; la factura queda pagada completa.', 'IVA retenido por clientes (1.1.05)', 'Ver constancias recibidas')
fac_rows = ''.join(T('<div class="lr" style="grid-template-columns:110px minmax(0,1fr) 110px 110px 130px;cursor:default"><span class="mono"><<a>></span><span class="el"><<b>></span><span class="num r"><<c>></span><span class="num r"><<d>></span><span><<e>></span></div>', a=a, b=b, c=c, d=d, e=chip(*e)) for a, b, c, d, e in [('F-004512', 'Mensualidad noviembre · S-000412', 'Q 450.00', 'Q 450.00', ('wa', 'reloj', 'Vence 5 dic')), ('F-004398', 'Mensualidad octubre · S-000412', 'Q 450.00', 'Q 0.00', ('ok', 'check', 'Pagada')), ('F-004377', 'Instalación', 'Q 600.00', 'Q 0.00', ('ok', 'check', 'Pagada'))])
ficha = T('''<section class="isla" style="border-radius:20px;padding:14px 18px;display:flex;align-items:center;gap:14px;flex:0 0 auto">
 <span class="av" style="background:#E0E7FF;color:#3730A3;width:46px;height:46px">HP</span>
 <div style="min-width:0"><b style="font-size:18px" class="el">Hotel Posada del Valle, sucursal Antigua</b><div class="m2">C-000029 · NIT 4521789-3 · <button class="b cy" style="border:0;cursor:pointer;font-family:inherit" onClick="{{m.tipo.ir}}"><i:calc:12>Agente retenedor de IVA <i:editar:11></button></div></div>
 <span style="flex:1"></span>
 <div class="kpi" style="padding:8px 14px"><span class="l">Saldo <<q>></span><b>Q 450.00</b></div>
 <div class="kpi" style="padding:8px 14px"><span class="l">Saldo a favor</span><b>Q 0.00</b></div>
 <button class="btn v"><i:cob:15>Cobrar Q 450.00</button>
 <button class="btn p" onClick="{{m.fac.ir}}"><i:mas1:15>Nueva factura</button>
 <button class="btn o"><i:mas:15>Más</button>
</section>
<section class="isla pan" style="flex:1">
 <div class="ph2"><<seg>><span style="flex:1"></span><button class="btn o sm"><i:nc:14>Nota de crédito</button><button class="btn o sm"><i:doc:14>Estado de cuenta</button><button class="btn p sm" onClick="{{m.fac.ir}}"><i:mas1:14>Nueva factura</button></div>
 <div style="display:flex;gap:10px;padding:12px 18px;flex:0 0 auto">
  <div class="cd" style="flex:1"><div class="cdh" style="margin-bottom:4px"><i:calc:15>Impuestos de este cliente<button class="lnk" onClick="{{m.tipo.ir}}">Cambiar</button></div><b>Agente retenedor de IVA</b><div class="m2">Sus facturas llevan IVA; al cobrar retiene el 15 % del IVA y entrega constancia.</div></div>
  <div class="cd" style="flex:1"><div class="cdh" style="margin-bottom:4px"><i:fac:15>Datos para facturar</div><b>NIT 4521789-3</b><div class="m2">Hotel Posada del Valle, S.A. · factura electrónica al correo conta@posadadelvalle.gt</div></div>
  <div class="cd" style="flex:1"><div class="cdh" style="margin-bottom:4px"><i:sello:15>Constancias pendientes</div><b style="color:#92400E">1 por recibir · Q 19.29</b><div class="m2">Factura F-004398: cobrada sin su constancia. <button class="lnk">Registrarla</button></div></div>
 </div>
 <div class="lh" style="grid-template-columns:110px minmax(0,1fr) 110px 110px 130px"><span>Factura</span><span>Concepto</span><span class="r">Total</span><span class="r">Pendiente</span><span>Estado</span></div>
 <div class="sc" style="flex:1"><<rows>></div>
</section>''', seg=seg('t', [('res', 'Resumen', 'home'), ('ser', 'Servicios', 'wifi'), ('fac', 'Facturación', 'fac', 1, 'rj'), ('pag', 'Pagos', 'cob'), ('pro', 'Promesas', 'mano'), ('doc', 'Documentos', 'doc')]), rows=fac_rows, q=Q('a', 'sal'))
p_sal = pop('a', 'sal', 'right:420px;top:150px', 'Saldo', 'Lo que este cliente te debe hoy, sumando todas sus facturas sin pagar.', 'Facturas emitidas menos pagos, notas de crédito y saldo a favor aplicado.', 'Usa <b>Cobrar</b> para registrar su pago. Si pagó de más, queda como <b>saldo a favor</b> y se usa solo en la próxima factura.', 'Auxiliar de cuentas por cobrar', 'Ver el estado de cuenta')
nota3 = nota_estados('Estados del tablero', 'm', [('no', 'Ficha'), ('fac', 'Nueva factura'), ('tipo', 'Tipo de impuesto')], 'left:124px;bottom:28px;width:330px')
pbuild('PlanClienteFiscal.dc.html', 'Ficha del cliente · «Nueva factura» visible y tipo de impuesto', shell2('dia', ['Día a día', 'Clientes', 'Hotel Posada del Valle'], ficha, VELO.replace('{{mOn}}', '{{velo}}') + m_tipo + m_fac + p_ret + p_sal + nota3),
       tlogic({'t': (['res', 'ser', 'fac', 'pag', 'pro', 'doc'], 'fac'), 'm': (['no', 'fac', 'tipo'], 'no'), 'tp': (['nor', 'ret', 'exe', 'isr'], 'ret'), 'a': (['no', 'ret', 'sal'], 'no')}, None, "out.velo = (st.m && st.m !== 'no') ? 'block' : 'none';"), 900, CSSP)

mfic = T('''<div style="height:100%;display:flex;flex-direction:column;position:relative">
<<top>>
<div class="sc" style="flex:1;padding:0 12px 12px;display:flex;flex-direction:column;gap:10px">
 <div style="display:{{m.no.v}};flex-direction:column;gap:10px">
  <section class="cd"><div style="display:flex;align-items:center;gap:8px"><div style="flex:1"><div class="m2">Saldo</div><b style="font-size:24px">Q 450.00</b></div><span class="b wa"><i:reloj:12>Vence 5 dic</span></div></section>
  <section class="cd" onClick="{{m.tipo.ir}}"><div class="cdh" style="margin-bottom:4px"><i:calc:15>Impuestos de este cliente<button class="lnk">Cambiar</button></div><b>Agente retenedor de IVA</b><div class="m2">Al cobrar retiene el 15 % del IVA y entrega constancia.</div></section>
  <section class="cd" style="padding:4px 14px"><<r1>><<r2>><<r3>></section>
 </div>
 <div style="display:{{m.tipo.v}};flex-direction:column;gap:8px"><b style="font-size:16px">Tipo de impuesto</b><div class="m2">Define cómo salen sus facturas y qué se espera al cobrarle.</div><<tipos>></div>
 <div style="display:{{m.fac.v}};flex-direction:column;gap:10px"><b style="font-size:16px">Nueva factura</b><<f1>><div class="g2"><<f2>><<f3>></div>
  <section class="cd" style="background:#F8FAFC"><div class="kv2"><span>Total de la factura</span><b class="num">Q 350.00</b></div><div class="kv2"><span>Te retendrá (15 % del IVA)</span><span class="num">− Q 5.63</span></div><div class="kv2"><span style="color:#0F172A"><b>Recibirás</b></span><b class="num" style="color:#166534">Q 344.37</b></div></section>
  <button class="lnk" style="align-self:flex-start"><i:mas1:13> Agregar otra línea</button></div>
</div>
<div class="mbar" style="display:{{m.no.v}}"><button class="btn o" onClick="{{m.fac.ir}}"><i:mas1:16>Nueva factura</button><button class="btn v"><i:cob:16>Cobrar Q 450</button></div>
<div class="mbar" style="display:{{m.tipo.v}}"><button class="btn o" style="flex:0 0 auto" onClick="{{m.no.ir}}">Cancelar</button><button class="btn p" onClick="{{m.no.ir}}">Guardar</button></div>
<div class="mbar" style="display:{{m.fac.v}}"><button class="btn o" style="flex:0 0 auto" onClick="{{m.no.ir}}">Cancelar</button><button class="btn p">Emitir factura</button></div>
</div>''', top=mtop('Hotel Posada del Valle', 'C-000029 · NIT 4521789-3', '<button class="ib f" style="width:38px;height:38px;border-radius:999px" onClick="{{tTema}}" aria-label="Tema"><i:luna:17></button>'),
         r1=kv('<b style="color:#0F172A">F-004512</b> · nov', 'Q 450.00 ' + chip('wa', 'reloj', 'Pendiente')), r2=kv('<b style="color:#0F172A">F-004398</b> · oct', chip('ok', 'check', 'Pagada')), r3=kv('<b style="color:#0F172A">F-004377</b> · instalación', chip('ok', 'check', 'Pagada')),
         tipos=''.join(T('<div class="op {{tp.<<i>>.cls}}" onClick="{{tp.<<i>>.ir}}"><span class="rd"></span><div><b style="font-size:14px"><<a>></b><div style="font-size:12px;color:#64748B"><<b>></div></div></div>', i=i, a=a, b=b) for i, a, b, c in TIPOS),
         f1=campo('Qué se cobra', 'Instalación de punto adicional', True, 'sel'), f2=campo('Cantidad', '1'), f3=campo('Precio con IVA', 'Q 350.00'))
pmbuild('PlanClienteFiscalMovil.dc.html', 'Ficha del cliente · teléfono: nueva factura y tipo de impuesto', mfic, tlogic({'m': (['no', 'fac', 'tipo'], 'no'), 'tp': (['nor', 'ret', 'exe', 'isr'], 'ret')}), CSSP)

# ============================ 4 · Patrón de indicador con ayuda ============================
def muestra(tit, sub, body, w='flex:1'):
    return T('<section class="isla pan" style="<<w>>;padding:14px 16px;gap:10px;overflow:visible"><div><b style="font-size:14px"><<t>></b><div class="m2"><<s>></div></div><<b>></section>', w=w, t=tit, s=sub, b=body)
anat = T('''<div style="display:flex;gap:18px;align-items:flex-start">
 <div style="width:270px;flex:0 0 auto"><<k>></div>
 <ol style="margin:0;padding-left:18px;font-size:13px;line-height:1.75;color:#334155">
  <li><b>Nombre en palabras de todos</b> («Te deben», no «CxC»).</li><li><b>«?»</b> siempre en la esquina: abre la ayuda sin salir de la pantalla.</li>
  <li><b>El número</b>, uno solo y grande.</li><li><b>Estado</b> con ícono, texto y color (nunca solo color).</li><li><b>Una línea de contexto</b>: de qué está hecho o con qué compararlo.</li><li>Toda la tarjeta lleva al <b>detalle</b>.</li></ol></div>''',
         k=ind('a', 'x', 'cli', 'wa', 'Te deben', 'Q 15,840.50', '64 facturas de 41 clientes', ('wa', 'alerta', 'Atención')))
ests = '<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px">' + ''.join([
    ind('a', 'x', 'banco', 'ok', 'Dinero disponible', 'Q 9,757.77', '2 bancos y 2 cajas', ('ok', 'check', 'Bien')),
    ind('a', 'x', 'cli', 'wa', 'Te deben', 'Q 15,840.50', 'Q 1,652 con más de 60 días', ('wa', 'alerta', 'Atención')),
    ind('a', 'x', 'calc', 'er', 'IVA de octubre', 'Q 3,104.00', 'Venció hace 3 días', ('er', 'alerta', 'Urgente')),
    T('<div class="kt"><div class="kl"><span class="ico ne" style="width:26px;height:26px;border-radius:8px"><i:tend:15></span>Ingreso mensual fijo<<q>></div><div class="kv" style="font-size:16px;color:#64748B">Aún sin datos</div><div class="ks">Aparece al emitir el primer mes</div></div>', q=Q('a', 'x')),
    T('<div class="kt" style="border-color:#FECACA"><div class="kl"><span class="ico er" style="width:26px;height:26px;border-radius:8px"><i:x:15></span>Debes a proveedores<<q>></div><div class="kv" style="font-size:16px;color:#B91C1C">No se pudo leer</div><div class="ks"><button class="lnk"><i:refresh:12> Reintentar</button></div></div>', q=Q('a', 'x'))]) + '</div>'
popd = T('''<div style="display:flex;gap:18px;align-items:flex-start"><div style="position:relative;width:330px;height:292px;flex:0 0 auto"><<p>></div>
 <div style="font-size:13px;line-height:1.7;color:#334155"><b>Siempre las mismas cuatro partes, en este orden:</b><br>1 · <b>Qué es</b>: una frase, sin términos contables.<br>2 · <b>Cómo se calcula</b>: de dónde sale el número.<br>3 · <b>Qué hacer</b>: la acción cuando está mal, con su enlace.<br>4 · <b>Nombre contable</b> y cuenta: para hablar con el contador (decisión 11).<br><br>
 Escritorio: ventana pequeña junto al «?». Teléfono: hoja desde abajo.<br>Se cierra con Esc, con la «x» o tocando fuera. El «?» se alcanza con Tab y se abre con Enter.<br>Los textos viven en un solo archivo (<span class="mono">ayudaIndicadores.ts</span>) y los revisa el contador.</div></div>''',
         p=pop('a', 'x', 'left:0;top:0;display:flex', 'Te deben', 'Lo que tus clientes aún no han pagado de sus facturas.', 'Suma de lo pendiente de cada factura emitida, sin las anuladas ni lo ya cobrado.', 'Si lo de más de 60 días crece, revisa <b>Cobranza</b>.', 'Cuentas por cobrar (1.1.03)', 'Ver quién debe').replace('display:{{a.x.v}};', ''))
glos = ''.join(T('<div class="kv2"><span style="color:#0F172A"><b><<a>></b></span><span class="m2"><<b>></span></div>', a=a, b=b) for a, b in [('Te deben', 'Cuentas por cobrar'), ('Debes a proveedores', 'Cuentas por pagar'), ('Saldo a favor', 'Anticipos de clientes'), ('Dinero en camino al banco', 'Fondos en tránsito'), ('Libro de movimientos', 'Libro diario'), ('Movimiento contable', 'Asiento o partida'), ('Lo que no se va a cobrar', 'Castigo de cartera'), ('Ganancia del mes', 'Resultado del periodo'), ('Emparejar con el banco', 'Conciliación bancaria')])
patron = T('''<<head>>
<div style="display:flex;gap:12px;flex:0 0 auto"><<a>><<d>></div>
<<e>>
<<g>>''', head=head('Indicador con ayuda', 'El mismo patrón para cada número de Finanzas, Cobranza, Cajas y Reportes', TEMA_HINT, 'Ayuda del manual'),
           a=muestra('1 · Partes del indicador', 'Componente único: ContaIndicador (reemplaza a ContaKpi)', anat), d=muestra('2 · La ayuda «¿Qué es esto?»', 'Se abre desde el «?» de cualquier número', popd, 'flex:1.25'),
           e=muestra('3 · Estados', 'Bien · Atención · Urgente · Sin datos · Error con Reintentar (nunca Q 0.00 inventado)', ests, 'flex:0 0 auto'),
           g=muestra('4 · Palabras: lo que se lee y su nombre contable', 'El nombre contable solo aparece en la ayuda, en la exportación y en el libro', '<div class="sc" style="columns:3;column-gap:28px">' + glos + '</div>', 'flex:1'))
pbuild('PlanIndicadorAyuda.dc.html', 'Patrón · indicador con ayuda «¿Qué es esto?»', shell2('fin', ['Finanzas', 'Patrón de indicador'], patron), tlogic({'a': (['no', 'x'], 'no')}), 1000, CSSP)

mpat = T('''<div style="height:100%;display:flex;flex-direction:column;position:relative">
<<top>>
<div class="sc" style="flex:1;padding:0 12px 12px;display:flex;flex-direction:column;gap:10px">
 <div style="display:flex;gap:8px"><<k1>><<k2>></div>
 <<k3>>
 <div class="m2">Toca el «?» de un número: la ayuda sube desde abajo.</div>
</div>
<div class="velo" style="display:{{a.x.b}}" onClick="{{a.no.ir}}"></div>
<div class="isla pop" style="display:{{a.x.v}};left:0;right:0;bottom:0;width:auto;border-radius:22px 22px 0 0;z-index:9;padding:18px 18px 26px">
 <span style="width:40px;height:4px;border-radius:9px;background:#CBD5E1;align-self:center"></span>
 <div style="display:flex;align-items:center;gap:8px"><h4 style="flex:1;font-size:16px">Te deben</h4><button class="ib" aria-label="Cerrar" onClick="{{a.no.ir}}"><i:cerrar:16></button></div>
 <div><div class="pl">Qué es</div>Lo que tus clientes aún no han pagado de sus facturas.</div>
 <div><div class="pl">Cómo se calcula</div>Suma de lo pendiente de cada factura emitida, sin las anuladas.</div>
 <div><div class="pl">Qué hacer</div>Si lo de más de 60 días crece, revisa <b>Cobranza</b>.</div>
 <div class="tec">Nombre contable: <b>Cuentas por cobrar (1.1.03)</b></div>
 <button class="btn p" style="justify-content:center">Ver quién debe</button>
</div></div>''', top=mtop('Finanzas', 'Patrón de indicador', '<button class="ib f" style="width:38px;height:38px;border-radius:999px" onClick="{{tTema}}" aria-label="Tema"><i:luna:17></button>'),
         k1=ind('a', 'x', 'cli', 'wa', 'Te deben', 'Q 15,840', '64 facturas', ('wa', 'alerta', 'Atención')), k2=ind('a', 'x', 'banco', 'ok', 'Disponible', 'Q 9,757', 'bancos y cajas', ('ok', 'check', 'Bien')),
         k3=ind('a', 'x', 'calc', 'er', 'IVA de octubre', 'Q 3,104.00', 'Venció hace 3 días', ('er', 'alerta', 'Urgente')))
pmbuild('PlanIndicadorAyudaMovil.dc.html', 'Patrón · indicador con ayuda · teléfono', mpat, tlogic({'a': (['no', 'x'], 'x')}), CSSP)
print('listo')
