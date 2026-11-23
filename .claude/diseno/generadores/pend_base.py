# Base de los tableros «Pendientes del backend» (pend1.py … pend4.py).
# Carga red_base.py, oper_base.py y los íconos de conta_base.py de esta misma carpeta, sin tocar su
# os.chdir, y escribe en SALIDA_TABLEROS (de fábrica, ../tableros junto a este archivo).
# Uso: python3 pend1.py   ·   SALIDA_TABLEROS=/otra/carpeta python3 pend1.py
import os
_G = os.path.dirname(os.path.abspath(__file__))
SALIDA = os.environ.get('SALIDA_TABLEROS', os.path.join(_G, '..', 'tableros'))
exec(open(os.path.join(_G, 'red_base.py')).read().replace('os.chdir(', '(lambda _p: None)(', 1))
exec(open(os.path.join(_G, 'oper_base.py')).read().split('\n', 1)[1])
exec(open(os.path.join(_G, 'conta_base.py')).read().split('\n', 1)[1])
os.makedirs(SALIDA, exist_ok=True)
os.chdir(SALIDA)
ic.update({
    'promo': '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/><path d="M19 3v4M17 5h4"/>',
    'falla': '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
    'cuenta': '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/>',
    'pin': '<path d="M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
    'olt': '<rect x="3" y="5" width="18" height="6" rx="1.5"/><path d="M7 8h.01M11 8h.01M6 11v4M12 11v6M18 11v4M4 19h4M10 19h4M16 19h4"/>',
    'zona': '<path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/>',
    'pon': '<circle cx="12" cy="6" r="3"/><path d="M12 9v4M12 13 6 19M12 13l6 6M12 13v6"/>',
    'barra': '<path d="M4 5v14M8 5v14M11 5v14M15 5v14M18 5v14M21 5v14"/>',
    'flecha': '<path d="M5 12h14M13 6l6 6-6 6"/>',
})

# --- modo oscuro: la misma pantalla con las fichas del tablero «Oscuro» (fondo #0B0F1A, isla #121A2B,
# borde #1E2638, primario #818CF8). Se activa con el estado {"tema":"osc"}.
DARK = '''
.tema{position:absolute;inset:0}
.tema.movil{background:#fff}.tema.movil.osc{background:#0B0F1A}
.osc .mbar,.osc nav[style*="border-top:1px solid #E6E8F0"]{background:#121A2B!important;border-color:#1E2638!important}
.osc{background:radial-gradient(1200px 500px at 20% -10%,#1B1F45 0%,transparent 60%),radial-gradient(900px 400px at 100% 0%,#0B2A33 0%,transparent 55%),#0B0F1A;color:#E2E8F0}
.osc .isla,.osc .f,.osc .card,.osc .cd,.osc .tk80{background:#121A2B!important;border-color:#1E2638!important;box-shadow:0 10px 30px rgba(0,0,0,.35)!important}
.osc [style*="background:#fff"]{background:#121A2B!important}
.osc [style*="background:#F8FAFC"],.osc [style*="background:#FAFBFE"],.osc [style*="background:#FCFCFE"],.osc [style*="background:#F1F5F9"],.osc .lh,.osc .kpi,.osc .segb,.osc .gr{background:#0F1524!important}
.osc [style*="#F1F5F9"],.osc [style*="#E6E8F0"],.osc [style*="#E2E8F0"],.osc [style*="#EEF0F5"],.osc [style*="#CBD5E1"]{border-color:#1E2638!important}
.osc [style*="color:#0F172A"],.osc [style*="color:#334155"]{color:#E2E8F0!important}
.osc .h1,.osc b{color:#F1F5F9}
.osc .m2,.osc .sub,.osc .migas,.osc .ay,.osc .th,.osc .sec,.osc .cdh,.osc .lb,.osc .kv2>span:first-child,.osc .kv>span:first-child{color:#94A3B8!important}
.osc .migas b{color:#E2E8F0}
.osc a,.osc .lnk{color:#A5B4FC}
.osc .rail{color:#94A3B8}.osc .rail.on{background:rgba(129,140,248,.16);color:#C7D2FE}
.osc .ci,.osc .ib{color:#CBD5E1}.osc .ib:hover{background:#1E2638}
.osc .pt{border-color:#121A2B}
.osc .btn.p{background:#818CF8;color:#0B0F1A;box-shadow:none}
.osc .btn.o{background:transparent!important;color:#CBD5E1;border-color:#2A3550!important}
.osc .btn.g{color:#CBD5E1}
.osc .btn.v{background:#22C55E;color:#052E16}
.osc .btn.r{background:transparent!important;color:#FCA5A5;border-color:#7F1D1D!important}
.osc .btn.rr{background:#F87171;color:#1F0A0A}
.osc .ts{color:#94A3B8}.osc .ts.on{background:#1E2638!important;color:#C7D2FE;box-shadow:none}
.osc .ts .c{background:#1E2638;color:#CBD5E1}.osc .ts .c.rj{background:rgba(248,113,113,.18);color:#FCA5A5}
.osc .in,.osc .busca,.osc .selp,.osc .fc,.osc .op,.osc .rap,.osc .pillf,.osc .opb{background:#0F1524!important;border-color:#2A3550!important;color:#E2E8F0}
.osc .in.ph,.osc .busca{color:#64748B}
.osc .in.auto{background:#121A2B!important}
.osc .fc.on{background:#818CF8!important;color:#0B0F1A;border-color:#818CF8!important}
.osc .op.on,.osc .opb.on{background:rgba(129,140,248,.14)!important;border-color:#818CF8!important}
.osc .lr{border-color:#1A2235}.osc .lr:hover{background:#161E31}.osc .lr.on{background:#18213A;box-shadow:inset 3px 0 0 #818CF8}
.osc .kv2,.osc .kv,.osc .tl{border-color:#1A2235}
.osc .b.ok{background:rgba(34,197,94,.16);color:#86EFAC}.osc .b.wa{background:rgba(245,158,11,.16);color:#FCD34D}
.osc .b.er{background:rgba(248,113,113,.16);color:#FCA5A5}.osc .b.in,.osc .b.nf{background:rgba(129,140,248,.18);color:#C7D2FE}
.osc .b.ne{background:#1E2638;color:#CBD5E1}.osc .b.cy{background:rgba(34,211,238,.14);color:#67E8F9}
.osc .ico.ok{background:rgba(34,197,94,.16);color:#86EFAC}.osc .ico.wa{background:rgba(245,158,11,.16);color:#FCD34D}
.osc .ico.er{background:rgba(248,113,113,.16);color:#FCA5A5}.osc .ico.ne{background:#1E2638;color:#CBD5E1}
.osc .ico.nf{background:rgba(129,140,248,.18);color:#C7D2FE}.osc .ico.cy{background:rgba(34,211,238,.14);color:#67E8F9}
.osc .av2.wa{background:rgba(245,158,11,.10);border-color:rgba(245,158,11,.35);color:#FCD34D}
.osc .av2.er{background:rgba(248,113,113,.10);border-color:rgba(248,113,113,.35);color:#FCA5A5}
.osc .av2.nf{background:rgba(129,140,248,.10);border-color:rgba(129,140,248,.35);color:#C7D2FE}
.osc .av2.ok{background:rgba(34,197,94,.10);border-color:rgba(34,197,94,.35);color:#86EFAC}
.osc .av2 b{color:inherit}
.osc .copy,.osc .cmdp{background:#1E2638;color:#E2E8F0}
.osc .tg i{background:#334155}.osc .tg.on i{background:#22C55E}
.osc .ck2,.osc .rd2{border-color:#475569}.osc .ck2.on{background:#818CF8;border-color:#818CF8}.osc .rd2.on{border-color:#818CF8}
.osc .dest{background:#0F1524;border-color:#818CF8;color:#F1F5F9;box-shadow:0 0 0 4px rgba(129,140,248,.18)}
.osc .velo{background:rgba(2,6,23,.65)}
.osc .bar{background:#1E2638}
.osc .nuevo{background:rgba(34,211,238,.14);color:#67E8F9}
.osc .mi{color:#CBD5E1}.osc .mi:hover{background:#1E2638}
.osc .sn{color:#CBD5E1}.osc .sn.on{background:rgba(129,140,248,.16);color:#C7D2FE}
.osc .dot.vv{box-shadow:0 0 0 4px rgba(34,197,94,.18)!important}
'''
TEMA = "out.tema = st.tema === 'osc' ? 'osc' : '';"
TEMA_HINT = '<button class="ib f" title="Tema claro u oscuro" aria-label="Tema" style="width:40px;height:40px;border-radius:999px" onClick="{{tTema}}"><i:luna:18></button>'
ic['luna'] = '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>'


def tlogic(groups, lists=None, extra=''):
    """logic() de oper_base más el tema (estado tema = osc) y su botón."""
    return logic(groups, lists, TEMA + "\nout.tTema = () => this.setState({ tema: st.tema === 'osc' ? 'claro' : 'osc' });\n" + extra)


def pbuild(fn, title, body, lg, h=900, css=''):
    obuild(fn, title, '<div class="tema {{tema}}">' + body + '</div>', lg, h, DARK + css)
    check(fn)


def pmbuild(fn, title, body, lg, css=''):
    ombuild(fn, title, '<div class="tema movil {{tema}}">' + body + '</div>', lg, DARK + css)
    check(fn)


def chip(cls, ico, txt):
    """Estado con ícono, texto y color."""
    return T('<span class="b <<c>>"><i:<<i>>:13><<t>></span>', c=cls, i=ico, t=txt)


def nota_estados(titulo, grupo, items, st='left:124px;bottom:28px;width:420px'):
    """Caja oscura de anotación (como la de OperLogin) con botones para ver cada estado del tablero."""
    bs = ''.join(T('<button class="fc {{<<g>>.<<id>>.cls}}" style="padding:5px 10px;font-size:12px;background:transparent;color:#E2E8F0;border-color:#334155" onClick="{{<<g>>.<<id>>.ir}}"><<n>></button>', g=grupo, id=i, n=n) for i, n in items)
    return T('<div class="nota" style="<<st>>"><b><<t>></b><div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px"><<bs>></div></div>', st=st, t=titulo, bs=bs)
