# Tablero «Sistema · Tareas programadas» (SistemaCrons.dc.html): escritorio 1440 y teléfono 390 (lista y detalle).
# Uso: python3 crons.py <tablero_referencia_con_menu.dc.html> <salida.dc.html>
# Toma la hoja de estilos, el menú compacto y el encabezado de un tablero aprobado (RedSesiones.dc.html)
# para que el marco sea idéntico; solo cambia el contenido.
import re
import sys

ref = open(sys.argv[1], encoding='utf-8').read()
estilos = re.search(r'<style>(.*?)</style>', ref, re.S).group(1)
marco = re.search(r'(<nav class="isla".*?</header>)', ref, re.S).group(1)
# en el menú, «Ajustes» (donde vive Sistema) queda marcado
marco = marco.replace('class="rail on"', 'class="rail"')
marco = marco.replace('class="rail" href="#" style="margin-top:auto"', 'class="rail on" href="#" style="margin-top:auto"')


def svg(d, t=16):
    return (f'<svg width="{t}" height="{t}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
            f'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{d}</svg>')


I = {
    'ok': '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
    'sin': '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>',
    'er': '<circle cx="12" cy="12" r="9"/><path d="m15 9-6 6M9 9l6 6"/>',
    'at': '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M5 3 2 6M22 6l-3-3"/>',
    'cu': '<path d="M21 12a9 9 0 1 1-6.2-8.6"/>',
    'off': '<path d="M12 2v10M18.4 6.6a9 9 0 1 1-12.8 0"/>',
    'play': '<path d="M7 4v16l13-8z"/>',
    'busca': '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    'help': '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 .5c0 2-2.5 2-2.5 4M12 17h.01"/>',
    'reloj': '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    'srv': '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 8h.01M7 17h.01"/>',
    'lock': '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    'x': '<path d="M18 6 6 18M6 6l12 12"/>',
    'rel': '<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5"/>',
    'atras': '<path d="m15 18-6-6 6-6"/>',
    'filtro': '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
    'chev': '<path d="m6 9 6 6 6-6"/>',
    'user': '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
}
EST = {
    'ok': ('ok', 'ok', 'Correcta', '#16A34A'),
    'sin': ('ne', 'sin', 'Sin cambios', '#94A3B8'),
    'er': ('er', 'er', 'Con error', '#DC2626'),
    'at': ('wa', 'at', 'Atrasada', '#D97706'),
    'cu': ('nf', 'cu', 'En curso', '#4F46E5'),
    'off': ('ne', 'off', 'Apagada', '#CBD5E1'),
}


def badge(e):
    cls, ic, txt, _ = EST[e]
    return f'<span class="b {cls}" style="align-self:flex-start">{svg(I[ic], 13)}{txt}</span>'


def punto(e):
    # un punto discreto; solo crece (con aro) si está atrasada o con error
    color = EST[e][3]
    if e in ('er', 'at'):
        return (f'<span title="{EST[e][2]}" style="width:14px;height:14px;border-radius:999px;background:{color};'
                f'box-shadow:0 0 0 4px {"#FEE2E2" if e == "er" else "#FEF3C7"};display:inline-block"></span>')
    return f'<span title="{EST[e][2]}" style="width:8px;height:8px;border-radius:999px;background:{color};display:inline-block"></span>'


FILAS = [
    # nombre, descripción, módulo, horario, estado, última, resumen, próxima
    ('Corte por hora', 'Limita o suspende a la hora de corte de cada plantilla.', 'Cobranza', 'Cada minuto', 'ok', 'hace 20 s', '3 servicios cambiaron de estado', 'en 40 s'),
    ('Generar facturas', 'Emite las facturas de los periodos que ya tocan.', 'Facturación', 'Cada hora', 'cu', 'desde 10:00:02', 'en worker-2', '11:00'),
    ('Vencimiento y mora', 'Marca vencidas las facturas y aplica la mora.', 'Facturación', 'Cada hora', 'at', 'hace 2 h 14 min', '18 facturas vencidas', 'debió 10:05'),
    ('Cola de facturación electrónica', 'Certifica los DTE pendientes y reintenta.', 'Fiscal', 'Cada minuto', 'er', 'hace 1 min', 'INFILE no respondió (3 DTE)', 'en 10 s'),
    ('Sellar el libro', 'Encadena con su huella los asientos nuevos.', 'Contabilidad', 'Cada minuto', 'sin', 'hace 30 s', 'Nada pendiente · ×58', 'en 30 s'),
    ('Reconciliar RouterOS', 'Corrige colas, corte y secrets en los routers.', 'Red', 'Cada 15 min', 'ok', 'hace 6 min', '4 correcciones', '10:21'),
    ('Sesiones colgadas', 'Cierra sesiones que dejaron de reportar.', 'Red', 'Cada 5 min', 'sin', 'hace 2 min', 'Nada pendiente · ×12', '10:17'),
    ('Envíos programados', 'Programa los recordatorios de pago a su hora.', 'Notificaciones', 'Cada minuto', 'ok', 'hace 15 s', '12 recordatorios programados', 'en 45 s'),
    ('Verificar integridad del libro', 'Recalcula la cadena de sellos del libro.', 'Contabilidad', 'Diario 02:15', 'ok', 'hoy 02:15', '2 empresas verificadas', 'mañana 02:15'),
    ('Relay de eventos', 'Publica los eventos para los demás procesos.', 'Sistema', 'Siempre activo', 'ok', 'hace 1 s', 'Sin eventos pendientes', '—'),
    ('Sondeo de routers', 'Pregunta a los routers sin contacto si siguen en línea.', 'Red', 'Apagada', 'off', '—', 'Su periodo está en 0', '—'),
]
SEL = 2
COLS = 'grid-template-columns:minmax(0,2.3fr) 120px 120px minmax(0,1.9fr) 110px 22px'


def fila(i, f):
    n, d, m, h, e, u, r, p = f
    on = ' on' if i == SEL else ''
    return (f'<div class="lr{on}" role="button" tabindex="0" style="{COLS}">'
            f'<div style="min-width:0"><b class="el" style="display:block;font-size:14px">{n}</b><span class="m2 el" style="display:block">{d}</span></div>'
            f'<span class="m2">{m}</span><span class="m2">{h}</span>'
            f'<div style="display:flex;flex-direction:column;gap:3px;min-width:0">{badge(e)}<span class="m2 el">{u} · {r}</span></div>'
            f'<span class="m2 num">{p}</span><span style="display:flex;justify-content:center">{punto(e)}</span></div>')


HIST = [
    ('er', 'Hoy 08:05', 'Falló · 0.4 s', 'connection refused: billing.facturas (lock timeout)', 'worker-1'),
    ('ok', 'Hoy 07:05', '3.1 s', '18 facturas vencidas, 6 moras aplicadas', 'worker-1'),
    ('sin', 'Hoy 01:05 – 06:05', '×6 · 0.2 s', 'Nada pendiente', 'worker-1'),
    ('ok', 'Ayer 23:41', 'A mano · Ana C. · 2.8 s', '4 facturas vencidas', 'worker-2'),
    ('ok', 'Ayer 23:05', '2.9 s', '31 facturas vencidas, 9 moras aplicadas', 'worker-2'),
]


def hist(h):
    e, cuando, dur, txt, inst = h
    cls = EST[e][0]
    return (f'<div class="tl"><span class="ic ico {cls}" style="width:32px;height:32px;border-radius:10px">{svg(I[EST[e][1]], 15)}</span>'
            f'<div style="min-width:0;flex:1"><div style="display:flex;gap:8px;align-items:baseline"><b style="font-size:13px">{cuando}</b>'
            f'<span class="m2" style="margin-left:auto">{dur}</span></div><div class="m2" style="color:#334155">{txt}</div>'
            f'<div class="m2" style="font-size:11px">{inst}</div></div></div>')


filtros = ''.join(
    f'<button class="ts{" on" if i == 0 else ""}">{t}<span class="c{" rj" if t in ("Con error", "Atrasadas") else ""}">{c}</span></button>'
    for i, (t, c) in enumerate([('Todas', 31), ('Con error', 1), ('Atrasadas', 1), ('En curso', 1), ('Al día', 27), ('Apagadas', 1)]))

escritorio = f'''
<div style="position:absolute;left:0;top:0;width:1440px;height:1000px;background:radial-gradient(1200px 500px at 20% -10%,#E0E7FF 0%,transparent 60%),radial-gradient(900px 400px at 100% 0%,#CFFAFE 0%,transparent 55%),#F4F6FB;overflow:hidden">
{marco}
<main style="position:absolute;left:108px;right:16px;top:70px;bottom:16px;display:flex;flex-direction:column;gap:10px;min-height:0;padding:0 4px">
  <div class="migas">Sistema <span aria-hidden="true">›</span> <b>Tareas programadas</b></div>
  <div style="display:flex;align-items:flex-end;gap:12px">
    <div><div style="display:flex;align-items:center;gap:8px"><h1 class="h1">Tareas programadas</h1>
      <button class="ib" aria-label="Ayuda: Tareas programadas" title="Ayuda del manual" style="cursor:help;border:1px solid #E2E8F0;border-radius:999px;background:#fff">{svg(I['help'], 16)}</button></div>
      <div class="sub">31 tareas · <b style="color:#B91C1C">2 necesitan atención</b> · actualizado hace 8 s</div></div>
    <button class="btn o" style="margin-left:auto">{svg(I['rel'])}Actualizar</button>
  </div>
  <div class="av2 wa">{svg(I['at'])}<span><b>Vencimiento y mora</b> no corre desde las 08:05 (debió correr a las 10:05). Revisa que <span class="mono">billing:worker</span> esté corriendo.</span></div>
  <div style="display:flex;gap:14px;flex:1;min-height:0">
    <section class="isla" style="flex:1;border-radius:20px;display:flex;flex-direction:column;min-width:0;min-height:0">
      <div style="display:flex;gap:10px;align-items:center;padding:14px 18px;flex-wrap:wrap">
        <span class="busca" style="width:280px">{svg(I['busca'])}Buscar tarea…</span>
        <div class="segb">{filtros}</div>
        <span class="selp" style="margin-left:auto">{svg(I['filtro'], 14)}Módulo: Todos {svg(I['chev'], 14)}</span>
      </div>
      <div class="lh" style="{COLS}"><span>Tarea</span><span>Módulo</span><span>Horario</span><span>Última corrida</span><span>Próxima</span><span></span></div>
      <div class="sc" style="flex:1">{''.join(fila(i, f) for i, f in enumerate(FILAS))}</div>
    </section>
    <aside class="isla" aria-label="Detalle de la tarea" style="width:400px;border-radius:20px;display:flex;flex-direction:column;min-height:0">
      <div style="padding:16px 18px 10px;display:flex;gap:10px;align-items:flex-start">
        <span class="ico wa">{svg(I['at'], 18)}</span>
        <div style="flex:1;min-width:0"><b style="font-size:16px">Vencimiento y mora</b><div class="m2">Marca vencidas las facturas que pasaron su fecha y aplica la mora de la plantilla.</div></div>
        <button class="ib" aria-label="Cerrar detalle">{svg(I['x'])}</button>
      </div>
      <div style="padding:0 18px">
        <div class="kv"><span>Estado</span>{badge('at')}</div>
        <div class="kv"><span>Horario</span><span>Cada hora · Facturación</span></div>
        <div class="kv"><span>Próxima</span><span>Debió correr 10:05</span></div>
        <div class="kv"><span>Corre en</span><span class="mono">billing:worker</span></div>
        <div class="kv"><span>Lock</span><span style="display:inline-flex;align-items:center;gap:6px;color:#64748B">{svg(I['lock'], 14)}Libre · nadie la corre</span></div>
      </div>
      <div style="padding:12px 18px 4px;display:flex;gap:8px;align-items:center">
        <button class="btn p">{svg(I['play'], 14)}Ejecutar ahora</button>
        <span class="m2">Respeta el lock: si ya corre, no se repite.</span>
      </div>
      <div style="padding:10px 18px 0"><p class="sec" style="margin:0">Historial de corridas</p></div>
      <div class="sc" style="flex:1;padding:0 18px 12px">{''.join(hist(h) for h in HIST)}
        <button class="lnk" style="margin-top:8px">Cargar más</button></div>
    </aside>
  </div>
</main>
<div style="position:absolute;inset:0;background:rgba(15,23,42,.35);display:{{{{dConf}}}};align-items:center;justify-content:center;z-index:8">
  <div role="dialog" aria-label="Ejecutar ahora" class="isla" style="width:440px;border-radius:20px;padding:20px">
    <b style="font-size:17px">¿Ejecutar «Vencimiento y mora» ahora?</b>
    <p class="m2" style="font-size:14px;margin:8px 0 16px">Se pone en la cola de <span class="mono">billing:worker</span> y corre con su lock. Si otra instancia ya la está corriendo, verás «Ya se está ejecutando».</p>
    <div style="display:flex;justify-content:flex-end;gap:8px"><button class="btn o">Cancelar</button><button class="btn p">{svg(I['play'], 14)}Ejecutar ahora</button></div>
  </div>
</div>
</div>'''


def tarjeta(f):
    n, d, m, h, e, u, r, p = f
    return (f'<div style="display:flex;gap:10px;align-items:flex-start;padding:12px 14px;border-bottom:1px solid #F1F5F9">'
            f'<div style="flex:1;min-width:0"><div style="display:flex;align-items:center;gap:8px"><b class="el" style="font-size:14px">{n}</b></div>'
            f'<div class="m2">{m} · {h}</div><div style="display:flex;gap:6px;align-items:center;margin-top:5px">{badge(e)}<span class="m2 el">{u}</span></div></div>'
            f'<span style="padding-top:5px">{punto(e)}</span></div>')


tel_lista = f'''
<div style="position:absolute;left:1480px;top:0;width:390px;height:844px;border-radius:28px;overflow:hidden;background:#F4F6FB;box-shadow:0 20px 50px rgba(15,23,42,.18);display:flex;flex-direction:column">
  <div style="padding:16px 16px 8px;display:flex;align-items:center;gap:8px">
    <div style="flex:1"><div class="m2">Sistema</div><h1 class="h1" style="font-size:20px">Tareas programadas</h1></div>
    <button class="ib" aria-label="Ayuda" style="cursor:help;border:1px solid #E2E8F0;border-radius:999px;background:#fff">{svg(I['help'])}</button>
  </div>
  <div style="padding:0 16px 8px"><span class="busca" style="width:100%">{svg(I['busca'])}Buscar tarea…</span></div>
  <div style="padding:0 16px 8px;overflow:hidden"><div class="segb" style="flex-wrap:nowrap">{filtros}</div></div>
  <div class="av2 wa" style="margin:0 16px 8px;font-size:12px">{svg(I['at'])}<span>2 tareas necesitan atención</span></div>
  <div class="isla sc" style="margin:0 16px 16px;border-radius:18px;flex:1">{''.join(tarjeta(f) for f in FILAS[:7])}</div>
</div>'''

tel_detalle = f'''
<div style="position:absolute;left:1910px;top:0;width:390px;height:844px;border-radius:28px;overflow:hidden;background:#F4F6FB;box-shadow:0 20px 50px rgba(15,23,42,.18);display:flex;flex-direction:column">
  <div style="padding:14px 12px 6px;display:flex;align-items:center;gap:6px">
    <button class="ib" aria-label="Volver a la lista">{svg(I['atras'], 18)}</button>
    <b style="font-size:16px;flex:1">Vencimiento y mora</b>
    <button class="ib" aria-label="Ayuda" style="cursor:help">{svg(I['help'])}</button>
  </div>
  <div class="sc" style="flex:1;padding:0 16px 90px">
    <div class="isla" style="border-radius:18px;padding:4px 14px 8px">
      <div class="kv" style="border-top:0"><span>Estado</span>{badge('at')}</div>
      <div class="kv"><span>Horario</span><span>Cada hora</span></div>
      <div class="kv"><span>Próxima</span><span>Debió 10:05</span></div>
      <div class="kv"><span>Corre en</span><span class="mono">billing:worker</span></div>
      <div class="kv"><span>Lock</span><span>Libre</span></div>
    </div>
    <p class="sec" style="margin:14px 0 4px">Historial</p>
    <div class="isla" style="border-radius:18px;padding:0 14px">{''.join(hist(h) for h in HIST[:4])}</div>
  </div>
  <div style="position:absolute;left:0;right:0;bottom:0;padding:12px 16px 18px;background:linear-gradient(180deg,rgba(244,246,251,0),#F4F6FB 30%)">
    <button class="btn p" style="width:100%;justify-content:center;padding:13px">{svg(I['play'], 15)}Ejecutar ahora</button>
  </div>
</div>'''

html = f'''<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Sistema · Tareas programadas</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&amp;display=swap" rel="stylesheet">
<style>{estilos}
html,body{{height:auto;overflow:visible}}
</style>
</helmet>
<div style="width:2300px;height:1000px;position:relative;background:#E9ECF4">
{escritorio}
{tel_lista}
{tel_detalle}
<div class="m2" style="position:absolute;left:1480px;top:870px;width:820px;font-size:13px;line-height:1.5;color:#475569">
<b style="color:#0F172A">Teléfono:</b> lista a pantalla completa con buscador y filtros; al tocar una tarea abre su detalle con el historial y «Ejecutar ahora» fijo abajo (con la misma confirmación corta). El punto solo crece con aro cuando la tarea está atrasada o con error.
</div>
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{{"confirmar":{{"editor":"boolean","default":false}},"$preview":{{"width":2300,"height":1000}}}}'>
class Component extends DCLogic {{
renderVals() {{ const p = this.props || {{}}; const s = this.state || {{}}; return {{ dConf: (p.confirmar || s.confirmar) ? 'flex' : 'none' }}; }}
}}
</script>
</body>
</html>
'''
open(sys.argv[2], 'w', encoding='utf-8').write(html)
