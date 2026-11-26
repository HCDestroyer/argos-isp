"""Tableros «Menú lateral, Ajustes y perfil» (pendientes de aprobación del PM, 26 nov 2026).

Genera cuatro tableros en ../tableros (o en SALIDA_TABLEROS):

- MenuLateral.dc.html        menú lateral corregido (isla con margen abajo, Ajustes como una sola entrada)
- AjustesEscritorio.dc.html  Ajustes reestructurado en escritorio (lista agrupada con buscador + la pantalla)
- AjustesMovil.dc.html       Ajustes en el teléfono (lista agrupada a pantalla completa y una pantalla)
- PerfilDrawer.dc.html       menú del perfil del teléfono como drawer desde abajo, y su fila en «Más»

Uso: python3 menu_ajustes.py
Imagen: node ../herramientas/render.js ../tableros/<tablero> salida.png <ancho> <alto> '<estado json>'
Estados: {"tema":"osc"} en todos; MenuLateral {"modo":"expandido"}; AjustesEscritorio {"v":"buscar"|"rol"};
AjustesMovil {"p":"buscar"|"pagina"}; PerfilDrawer {"p":"mas"|"una"}.
"""
import os

_G = os.path.dirname(os.path.abspath(__file__))
SALIDA = os.environ.get('SALIDA_TABLEROS', os.path.join(_G, '..', 'tableros'))
os.makedirs(SALIDA, exist_ok=True)


def svg(d, t=18):
    return (f'<svg width="{t}" height="{t}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
            f'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex:0 0 auto">{d}</svg>')


I = {
    'casa': '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    'dia': '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    'factura': '<path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
    'red': '<rect x="9" y="2" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="16" y="16" width="6" height="6" rx="1"/><path d="M12 8v4M5 16v-2a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v2"/>',
    'inv': '<path d="m21 8-9-5-9 5 9 5z"/><path d="M3 8v8l9 5 9-5V8M12 13v8"/>',
    'lealtad': '<path d="M6 3h12l4 6-10 12L2 9z"/><path d="M2 9h20M12 21 8 9l4-6 4 6z"/>',
    'finanzas': '<path d="M3 21h18M5 21V10M19 21V10M9 21v-6M15 21v-6M2 10l10-7 10 7z"/>',
    'reportes': '<path d="M21 12A9 9 0 1 1 12 3v9z"/><path d="M21 8a9 9 0 0 0-5-5v5z"/>',
    'ajustes': '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    'buscar': '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    'clientes': '<circle cx="9" cy="8" r="3.5"/><path d="M3 20a6 6 0 0 1 12 0M16 4.5a3.5 3.5 0 0 1 0 7M21 20a6 6 0 0 0-4-5.6"/>',
    'wifi': '<path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01"/>',
    'puntos': '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
    'caja': '<path d="M4 7h16v13H4z"/><path d="M4 7l2-4h12l2 4M9 12h6"/>',
    'pulso': '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    'campana': '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
    'mas': '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    'der': '<path d="m9 18 6-6-6-6"/>', 'izq': '<path d="m15 18-6-6 6-6"/>', 'abajo': '<path d="m6 9 6 6 6-6"/>',
    'x': '<path d="M18 6 6 18M6 6l12 12"/>', 'check': '<path d="m5 12 5 5L20 7"/>', 'mas1': '<path d="M12 5v14M5 12h14"/>',
    'edificio': '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 8h.01M15 8h.01M9 12h.01M15 12h.01M10 21v-4h4v4"/>',
    'banco': '<path d="M3 10h18L12 4zM5 10v8M9 10v8M15 10v8M19 10v8M3 20h18"/>',
    'escudo': '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
    'contacto': '<rect x="4" y="3" width="16" height="18" rx="2"/><circle cx="12" cy="10" r="2.5"/><path d="M8 17a4 4 0 0 1 8 0"/>',
    'doc': '<path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4M9 13h6M9 17h6"/>',
    'codigo': '<path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4m-8 5-2 2 2 2m4-4 2 2-2 2"/>',
    'lista': '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    'tarjeta': '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>',
    'reglas': '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    'campo': '<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M8 5v14M6 5h4M6 19h4"/>',
    'llave': '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3"/>',
    'servidor': '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
    'corte': '<path d="M8 3h8l5 5v8l-5 5H8l-5-5V8z"/><path d="M10 9v6M14 9v6"/>',
    'mensaje': '<path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 8h8M8 12h5"/>',
    'bloques': '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/><path d="M17 3v8M13 7h8M7 13v8M3 17h8"/>',
    'subir': '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
    'usuario': '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    'rol': '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>',
    'paleta': '<path d="M12 3a9 9 0 1 0 0 18c1.5 0 2-1 2-2 0-1.5 1-2 2.500-2H18a3 3 0 0 0 3-3c0-6-4-9-9-9z"/><path d="M7.5 11h.01M10 7.500h.01M15 7.500h.01"/>',
    'salud': '<path d="M20.800 5.600a5 5 0 0 0-7.800 0L12 6.700l-1-1.100a5 5 0 0 0-7.800 6.300L12 21l8.800-9.100a5 5 0 0 0 0-6.300z"/><path d="M4 12h4l2-3 3 6 2-3h4"/>',
    'registro': '<path d="M6 3h11a2 2 0 0 1 2 2v14a2 2 0 0 0 2 2H8a2 2 0 0 1-2-2z"/><path d="M6 8H3V5a2 2 0 0 1 3-2M10 9h5M10 13h5"/>',
    'disco': '<path d="M3 13h18M5 5h14l2 8v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5zM7 16h.01M11 16h.01"/>',
    'tareas': '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4M12 13v3l2 1"/>',
    'sol': '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M5 12H3M21 12h-2M6.300 6.300 4.900 4.900M19.100 19.100l-1.400-1.400M6.300 17.700l-1.400 1.400M19.100 4.900l-1.400 1.400"/>',
    'luna': '<path d="M20 14.500A8.500 8.500 0 1 1 9.500 4a7 7 0 0 0 10.500 10.500z"/>',
    'monitor': '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
    'ayuda': '<circle cx="12" cy="12" r="9"/><path d="M9.500 9a2.500 2.500 0 0 1 5 0c0 2-2.500 2-2.500 4M12 17h.01"/>',
    'cambios': '<path d="M6 3h11a2 2 0 0 1 2 2v14a2 2 0 0 0 2 2H8a2 2 0 0 1-2-2z"/><path d="m10 12 2 2 4-4"/>',
    'salir': '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
    'capas': '<path d="m12 3 9 5-9 5-9-5zM3 13l9 5 9-5"/>',
    'sliders': '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    'aviso': '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
    'tel': '<path d="M5 4h4l2 5-3 2a11 11 0 0 0 5 5l2-3 5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 6a2 2 0 0 1 2-2"/>',
    'pin': '<path d="M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11z"/><circle cx="12" cy="10" r="2.500"/>',
    'cobrar': '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.500"/><path d="M6 12h.01M18 12h.01"/>',
}

LOGO = ('<svg width="{t}" height="{t}" viewBox="0 0 32 32" aria-hidden="true" style="flex:0 0 auto"><defs><linearGradient id="lg{t}" x1="0" y1="0" x2="1" y2="1">'
        '<stop offset="0" stop-color="#4F46E5"/><stop offset="1" stop-color="#06B6D4"/></linearGradient></defs>'
        '<rect width="32" height="32" rx="9" fill="url(#lg{t})"/><path d="M7 16c3-4.500 6-6 9-6s6 1.500 9 6c-3 4.500-6 6-9 6s-6-1.500-9-6z" stroke="#fff" stroke-width="2" fill="none"/>'
        '<circle cx="16" cy="16" r="2.600" fill="#fff"/></svg>')


_LOGOS = [0]


def logo(t=36):
    # Cada logo lleva su degradado: un `id` repetido dentro de un bloque oculto deja al otro sin relleno.
    _LOGOS[0] += 1
    return LOGO.replace('lg{t}', f'lg{_LOGOS[0]}').replace('{t}', str(t))


# ---------------------------------------------------------------------------------------------
# Catálogo propuesto de Ajustes: grupos por tarea y sus pantallas (ruta real y permiso exacto de
# apps/api/app/core/permisos.ts). Es el mismo que debe quedar en `utils/configuracionSecciones.ts`.
# (icono, etiqueta, ruta, permiso, palabras para el buscador, pastilla de atención opcional)
# ---------------------------------------------------------------------------------------------
AJUSTES = [
    ('Empresa y fiscal', 'edificio', [
        ('edificio', 'Datos de la empresa', '/configuracion/empresas', 'empresas.ver', 'NIT, logo, razón social', None),
        ('banco', 'Régimen e impuestos', '/configuracion/fiscal', 'fiscal.ver', 'IVA, ISR, feriados', None),
        ('escudo', 'Factura electrónica (FEL)', '/configuracion/fel', 'fel.ver', 'certificador, contingencia', 'Contingencia activa'),
        ('contacto', 'Contacto y pagos', '/configuracion/empresa', 'empresa.ver', 'teléfono, horario, cómo pagar', None),
    ]),
    ('Facturación y cobro', 'factura', [
        ('factura', 'Plantillas de facturación', '/plantillas', 'plantillas.ver', 'ciclo, corte, mora, promesas', None),
        ('codigo', 'Plantillas de documentos', '/configuracion/aviso-cobro', 'documentos.ver', 'aviso, recibo, factura, carta, 80 mm', None),
        ('doc', 'Conceptos y adicionales', '/configuracion/plantillas-conceptos', 'plantillas.ver · documentos.ver', 'cargo único, IP pública', None),
        ('reglas', 'Reglas de cobro y libro', '/configuracion/reglas-cobro', 'ajustes_cobro.ver', 'aprobar asientos, pausa sin cobro', None),
        ('banco', 'Cuentas bancarias', '/configuracion/cuentas-bancarias', 'cuentas_bancarias.ver', 'depósitos, transferencias', None),
        ('lista', 'Bancos de origen', '/configuracion/bancos-origen', 'cuentas_bancarias.ver', 'catálogo de bancos', None),
        ('tarjeta', 'Proveedores de cobro', '/configuracion/proveedores-cobro', 'bancos.ver', 'pasarelas, agentes, débitos', None),
    ]),
    ('Clientes y portal', 'clientes', [
        ('campo', 'Campos personalizados', '/campos-personalizados', 'campos_personalizados.editar', 'datos extra de la ficha', None),
        ('llave', 'Contraseña del portal', '/configuracion/portal-contrasena', 'empresa.ver', 'clave de entrada del cliente', None),
        ('servidor', 'Nodos del portal', '/configuracion/nodos-portal', 'nodos_portal.administrar', 'portal en otro servidor', None),
    ]),
    ('Red y equipos', 'red', [
        ('corte', 'Corte, caídas y retiro', '/configuracion/portal-corte', 'portal_corte.ver', 'página de corte, fallas, historial de IP', None),
        ('inv', 'Inventario', '/configuracion/inventario', 'inventario.configurar', 'firma de traslados, lector de facturas', None),
    ]),
    ('Comunicación e integraciones', 'campana', [
        ('campana', 'Canales de aviso', '/configuracion/notificaciones', 'notificaciones.ver', 'correo, SMTP, Telegram, WhatsApp', None),
        ('mensaje', 'Plantillas de avisos', '/notificaciones', 'notificaciones.ver', 'textos, recordatorios, envíos', None),
        ('bloques', 'Integraciones', '/configuracion/integraciones', 'horus.ver · iris.ver · equipos.ver', 'Iris, Horus, SmartOLT, GenieACS', None),
        ('subir', 'Importar desde Mikrowisp', '/configuracion/importar', 'rol admin', 'migrar, traer clientes', None),
    ]),
    ('Usuarios y seguridad', 'rol', [
        ('usuario', 'Usuarios', '/usuarios', 'usuarios.ver', 'alta, desactivar, empresas', None),
        ('rol', 'Roles y permisos', '/usuarios/roles', 'roles.ver', 'qué puede hacer cada rol', None),
        ('llave', 'Tokens de API', '/usuarios/tokens', 'tokens.ver', 'integraciones, agentes de IA', None),
    ]),
    ('Apariencia y reportes', 'paleta', [
        ('paleta', 'Apariencia', '/configuracion/apariencia', 'apariencia.ver', 'color, logo, inicio de sesión', None),
        ('reportes', 'Ajustes de reportes', '/configuracion/reportes', 'reportes.ver', 'cuándo cuenta una baja', None),
    ]),
    ('Sistema', 'pulso', [
        ('salud', 'Salud del sistema', '/sistema/salud', 'sistema.ver_salud', 'servidor, colas, RADIUS', None),
        ('registro', 'Registro de fallos', '/sistema/registro', 'sistema.ver_registro', 'errores y avisos', None),
        ('disco', 'Almacenamiento', '/sistema/almacenamiento', 'sistema.ver_almacenamiento', 'disco, base, archivos', None),
        ('tareas', 'Tareas programadas', '/sistema/tareas', 'sistema.ver_crons', 'crons, cuándo corrieron', None),
    ]),
]
ACTIVA = 'Datos de la empresa'
# Rol «contabilidad» del ejemplo de permisos: lo que no puede abrir no aparece, y un grupo vacío tampoco.
ROL_CONTA = {'fiscal.ver', 'fel.ver', 'cuentas_bancarias.ver', 'bancos.ver', 'ajustes_cobro.ver', 'reportes.ver'}

# ---------------------------------------------------------------------------------------------
# Estilo común: las fichas del tablero «Oscuro» y del marco del teléfono, como variables.
# ---------------------------------------------------------------------------------------------
CSS = '''
body{margin:0;font-family:Inter,system-ui,sans-serif}
.lienzo{--fondo:#F4F6FB;--tarjeta:#fff;--panel:#F1F5F9;--borde:#E6E8F0;--borde2:#CBD5E1;--texto:#0F172A;--tx2:#334155;--mu:#64748B;--at:#94A3B8;
  --vidrio:rgba(255,255,255,.72);--vidrio2:rgba(255,255,255,.94);--pri:#4F46E5;--pri-tx:#4338CA;--pri-bg:#EEF2FF;--sobre-pri:#fff;--hover:#F8FAFC;
  --ok:#166534;--ok-bg:#DCFCE7;--wa:#92400E;--wa-bg:#FEF3C7;--er:#B91C1C;--er-bg:#FEE2E2;--velo:rgba(15,23,42,.42);
  --sombra:0 18px 40px -18px rgba(30,27,75,.28);--sombra2:0 6px 18px -8px rgba(15,23,42,.16);
  position:relative;width:100%;height:100vh;min-height:560px;overflow:hidden;color:var(--texto);box-sizing:border-box;
  background:radial-gradient(1200px 500px at 20% -10%,#E0E7FF 0%,transparent 60%),radial-gradient(900px 400px at 100% 0%,#CFFAFE 0%,transparent 55%),var(--fondo)}
.lienzo.osc{--fondo:#0B0F1A;--tarjeta:#121A2B;--panel:#0F1524;--borde:#1E2638;--borde2:#2A3550;--texto:#F1F5F9;--tx2:#E2E8F0;--mu:#94A3B8;--at:#64748B;
  --vidrio:rgba(15,20,36,.72);--vidrio2:rgba(18,26,43,.96);--pri:#818CF8;--pri-tx:#C7D2FE;--pri-bg:rgba(129,140,248,.16);--sobre-pri:#0B0F1A;--hover:#161E31;
  --ok:#86EFAC;--ok-bg:rgba(34,197,94,.16);--wa:#FCD34D;--wa-bg:rgba(245,158,11,.16);--er:#FCA5A5;--er-bg:rgba(248,113,113,.16);--velo:rgba(2,6,23,.66);
  --sombra:0 18px 40px -12px rgba(0,0,0,.6);--sombra2:0 6px 18px -8px rgba(0,0,0,.5);
  background:radial-gradient(1200px 500px at 20% -10%,rgba(79,70,229,.22) 0%,transparent 60%),radial-gradient(900px 400px at 100% 0%,rgba(6,182,212,.12) 0%,transparent 55%),var(--fondo)}
.lienzo *{box-sizing:border-box}
.mu{color:var(--mu)}.pri{color:var(--pri)}.num{font-variant-numeric:tabular-nums}
.vidrio{background:var(--vidrio);backdrop-filter:blur(28px) saturate(150%);box-shadow:0 0 0 1px var(--borde),var(--sombra)}
.card{background:var(--tarjeta);border:1px solid var(--borde);border-radius:16px;box-shadow:var(--sombra2)}
.f{background:var(--tarjeta);box-shadow:0 0 0 1px var(--borde),var(--sombra2)}
.ci{position:relative;width:42px;height:42px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;color:var(--mu);flex:0 0 auto}
.ci.cu{background:var(--pri-bg);color:var(--pri-tx);font-size:13px;font-weight:700}
.ci.sm{width:36px;height:36px}.ci.sm.cu{font-size:12px}
.pt{position:absolute;top:8px;right:8px;width:8px;height:8px;border-radius:999px;border:2px solid var(--tarjeta)}
.pi{display:inline-flex;align-items:center;gap:7px;height:42px;padding:0 16px;border-radius:999px;font-size:13px;font-weight:600;color:var(--tx2);white-space:nowrap}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;border-radius:999px;padding:9px 16px;font-weight:600;font-size:13px;border:1px solid transparent;white-space:nowrap}
.btn.p{background:var(--pri);color:var(--sobre-pri)}.btn.o{background:var(--tarjeta);color:var(--tx2);border-color:var(--borde2)}.btn.g{color:var(--mu)}
.b{display:inline-flex;align-items:center;gap:4px;border-radius:999px;padding:2px 8px;font-size:11px;font-weight:600;white-space:nowrap}
.b.wa{background:var(--wa-bg);color:var(--wa)}.b.ok{background:var(--ok-bg);color:var(--ok)}.b.ne{background:var(--panel);color:var(--mu)}
.cap{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--mu)}
.campo{display:flex;align-items:center;gap:8px;height:40px;padding:0 14px;border-radius:999px;background:var(--tarjeta);border:1px solid var(--borde2);color:var(--at);font-size:14px}
.campo.on{border-color:var(--pri);box-shadow:0 0 0 3px var(--pri-bg);color:var(--texto)}
.lb{font-size:13px;font-weight:600;color:var(--tx2);margin-bottom:6px}.lb i{color:var(--er);font-style:normal}
.in{display:flex;align-items:center;gap:8px;border:1px solid var(--borde2);border-radius:12px;padding:10px 12px;font-size:14px;color:var(--texto);background:var(--tarjeta)}
.in.auto{background:var(--panel);border-style:dashed}
/* menú lateral: isla a 16 px de los CUATRO bordes */
.menu{position:absolute;left:16px;top:16px;bottom:16px;border-radius:22px;display:flex;flex-direction:column;z-index:3}
.menu.comp{width:76px;padding:14px 10px}.menu.exp{width:244px;padding:14px 12px}
.palanca{position:absolute;right:-14px;top:24px;width:28px;height:28px;border-radius:999px;display:flex;align-items:center;justify-content:center;color:var(--pri)}
.rail{display:flex;flex-direction:column;align-items:center;gap:3px;padding:8px 2px;border-radius:12px;color:var(--mu);font-size:10px;font-weight:600;position:relative;width:100%}
.rail.on{background:var(--pri-bg);color:var(--pri-tx)}
.rail .pp{position:absolute;top:6px;right:14px;width:7px;height:7px;border-radius:999px;background:#D97706}
.area{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:12px;font-size:14px;font-weight:500;color:var(--tx2)}
.area.on{background:var(--pri-bg);color:var(--pri-tx)}
.area .cnt,.cnt{font-size:11px;font-weight:700;border-radius:999px;padding:1px 7px;background:var(--pri);color:var(--sobre-pri)}
.sub{padding:6px 12px 6px 42px;font-size:13px;color:var(--mu);border-radius:9px;display:flex;align-items:center;gap:8px}
.pie{margin-top:auto;padding-top:8px;border-top:1px solid var(--borde);flex:0 0 auto}
.cuerpo-menu{flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column;gap:2px}
/* navegación propia de Ajustes */
.nav{display:flex;flex-direction:column;min-height:0}
.ng{padding:12px 10px 4px;display:flex;align-items:center;gap:8px}
.ni{display:flex;align-items:center;gap:10px;padding:0 10px;height:32px;border-radius:9px;font-size:13px;color:var(--tx2);white-space:nowrap}
.ni .ic{color:var(--at);display:inline-flex}.ni.on{background:var(--pri-bg);color:var(--pri-tx);font-weight:600}.ni.on .ic{color:var(--pri)}
.ni .t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}
.res{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px}
.res.on{background:var(--pri-bg)}.res b{font-size:13px;display:block}.res span.d{font-size:11.5px;color:var(--mu)}
mark{background:var(--wa-bg);color:inherit;border-radius:3px;padding:0 1px}
.kbd{font-size:11px;border:1px solid var(--borde2);border-radius:6px;padding:1px 6px;color:var(--mu)}
.seg{display:inline-flex;gap:2px;padding:4px;border-radius:12px;background:var(--panel)}
.seg span{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:9px;font-size:13px;font-weight:600;color:var(--mu);white-space:nowrap}
.seg span.on{background:var(--tarjeta);color:var(--pri-tx);box-shadow:0 0 0 1px var(--borde),0 1px 3px rgba(15,23,42,.1)}
.nota{font-size:12px;color:var(--mu);line-height:1.45}
.nota b{color:var(--tx2)}
.fijo>*{flex:0 0 auto}
/* teléfono */
.isla{position:absolute;left:12px;right:12px;bottom:12px;z-index:30;display:grid;grid-template-columns:repeat(5,1fr);gap:2px;padding:6px;border-radius:22px;background:var(--vidrio2);backdrop-filter:blur(28px) saturate(150%);box-shadow:0 0 0 1px var(--borde),var(--sombra)}
.dest{min-height:56px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;border-radius:16px;color:var(--mu);font:600 11px/1 Inter,system-ui,sans-serif}
.dest.on{background:var(--pri-bg);color:var(--pri-tx)}
.barra{position:absolute;left:12px;right:12px;bottom:92px;z-index:25;display:flex;gap:8px;padding:8px;border-radius:22px;background:var(--vidrio2);box-shadow:0 0 0 1px var(--borde),var(--sombra)}
.fila{display:flex;align-items:center;gap:12px;min-height:48px;padding:0 14px;border-top:1px solid var(--borde);font-size:14.5px;color:var(--texto)}
.fila:first-child{border-top:0}.fila .ic{color:var(--mu);display:inline-flex}.fila .t{flex:1;min-width:0}
.velo{position:absolute;inset:0;z-index:40;background:var(--velo)}
.drawer{position:absolute;left:0;right:0;bottom:0;z-index:50;border-radius:24px 24px 0 0;background:var(--vidrio2);backdrop-filter:blur(28px) saturate(150%);box-shadow:0 0 0 1px var(--borde),0 -18px 40px -18px rgba(15,23,42,.35);padding:8px 14px 22px;display:flex;flex-direction:column;gap:12px;max-height:88%}
.asa{width:40px;height:5px;border-radius:999px;background:var(--borde2);margin:2px auto 0}
.radio{width:20px;height:20px;border-radius:999px;border:2px solid var(--borde2);flex:0 0 auto}
.radio.on{border:6px solid var(--pri)}
.seg3{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;padding:4px;border-radius:14px;background:var(--panel)}
.seg3 span{display:flex;align-items:center;justify-content:center;gap:6px;min-height:44px;border-radius:10px;font-size:13.5px;font-weight:600;color:var(--mu)}
.seg3 span.on{background:var(--tarjeta);color:var(--pri-tx);box-shadow:0 0 0 1px var(--borde),0 1px 3px rgba(15,23,42,.12)}
.mas{position:absolute;inset:0;z-index:35;display:flex;flex-direction:column;background:var(--fondo)}
'''

LOGICA_TEMA = "const st=this.state||{};const tema=st.tema==='osc'?'osc':'';"


def pagina(titulo, cuerpo, ancho, alto, logica, props=''):
    return f'''<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>{titulo}</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&amp;display=swap" rel="stylesheet">
<style>{CSS}</style>
</helmet>
<div class="lienzo {{{{tema}}}}">
{cuerpo}
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{{{props}"$preview":{{"width":{ancho},"height":{alto}}}}}'>
class Component extends DCLogic {{
renderVals() {{
{LOGICA_TEMA}
{logica}
}}
}}
</script>
</body>
</html>
'''


def escribir(nombre, html):
    with open(os.path.join(SALIDA, nombre), 'w') as archivo:
        archivo.write(html)
    print('escrito', nombre, len(html))


# ---------------------------------------------------------------------------------------------
# Piezas del marco de escritorio
# ---------------------------------------------------------------------------------------------
AREAS = [('casa', 'Inicio', 'Inicio'), ('dia', 'Día a día', 'Día a día'), ('factura', 'Facturación', 'Facturas'), ('red', 'Red', 'Red'),
         ('inv', 'Inventario', 'Inventario'), ('lealtad', 'Clientes y lealtad', 'Lealtad'), ('finanzas', 'Finanzas', 'Finanzas'), ('reportes', 'Reportes', 'Reportes')]


def menu_compacto(activa='Inicio', mostrar=''):
    filas = ''.join(f'<span class="rail{" on" if n == activa else ""}">{svg(I[k], 20)}{c}{"<i class=pp></i>" if n == "Día a día" else ""}</span>' for k, n, c in AREAS)
    return f'''<nav class="menu comp vidrio" aria-label="Menú principal compacto" {mostrar}>
<div style="display:flex;justify-content:center;padding-bottom:10px">{logo(36)}</div>
<span class="palanca f" role="button" aria-label="Expandir el menú">{svg(I['der'], 15)}</span>
<div class="cuerpo-menu fijo" style="gap:4px">{filas}</div>
<div class="pie"><span class="rail{" on" if activa == "Ajustes" else ""}">{svg(I['ajustes'], 20)}Ajustes</span></div>
</nav>'''


def menu_expandido(activa='Inicio', mostrar=''):
    filas = ''
    for k, n, _ in AREAS:
        if n == 'Inicio':
            filas += f'<span class="area{" on" if activa == n else ""}">{svg(I[k])}<span style="flex:1">{n}</span></span>'
        elif n == 'Día a día':
            filas += f'<span class="area">{svg(I[k])}<span style="flex:1">{n}</span>{svg(I["abajo"], 15)}</span>'
            filas += ''.join(f'<span class="sub"><span style="flex:1">{x}</span>{e}</span>' for x, e in
                             [('Clientes', ''), ('Servicios', ''), ('Cobrar', ''), ('Caja', '<span class="b ok">Abierta</span>'), ('Promesas', ''), ('Comprobantes', '<span class="cnt">4</span>')])
        else:
            filas += f'<span class="area">{svg(I[k])}<span style="flex:1">{n}</span>{svg(I["der"], 15)}</span>'
    return f'''<nav class="menu exp vidrio" aria-label="Menú principal" {mostrar}>
<div style="display:flex;align-items:center;gap:10px;padding:0 4px 10px">{logo(36)}<b style="font-size:18px;letter-spacing:-.02em">Argos<span class="pri">Isp</span></b></div>
<span class="palanca f" role="button" aria-label="Compactar el menú">{svg(I['izq'], 15)}</span>
<div class="cuerpo-menu fijo">{filas}</div>
<div class="pie"><span class="area{" on" if activa == "Ajustes" else ""}">{svg(I['ajustes'])}<span style="flex:1">Ajustes</span></span></div>
</nav>'''


def encabezado(izq=108):
    return f'''<header style="position:absolute;left:{izq}px;right:16px;top:16px;height:44px;display:flex;align-items:center;gap:10px;z-index:2">
<span class="f pi" style="color:var(--at);font-weight:500;width:232px">{svg(I['buscar'], 16)}Buscar…<span style="margin-left:auto;font-size:11px">Ctrl K</span></span>
<span class="f pi">{svg(I['clientes'], 16)}Clientes</span><span class="f pi">{svg(I['wifi'], 16)}Servicios</span><span class="f ci">{svg(I['puntos'])}</span>
<span style="margin-left:auto"></span>
<span class="f ci">{svg(I['caja'])}<i class="pt" style="background:#16A34A"></i></span><span class="f ci">{svg(I['pulso'])}<i class="pt" style="background:#D97706"></i></span>
<span class="f ci">{svg(I['campana'])}<i class="pt" style="background:#0891B2"></i></span><span class="f ci cu">AA</span></header>'''


# ---------------------------------------------------------------------------------------------
# 1 · Menú lateral corregido
# ---------------------------------------------------------------------------------------------
def tarjeta_kpi(t, v, s):
    return f'<section class="card" style="padding:16px;flex:1"><div class="mu" style="font-size:13px">{t}</div><b class="num" style="font-size:24px;display:block;margin:6px 0 2px">{v}</b><span class="mu" style="font-size:12px">{s}</span></section>'


INICIO = f'''<section style="border-radius:18px;padding:22px 26px;color:#fff;background:linear-gradient(135deg,#4F46E5,#4338CA 55%,#0E7490)">
<b style="font-size:22px;display:block">Buenas tardes, Ana</b><span style="font-size:13px;opacity:.9">Hay 4 comprobantes por revisar.</span></section>
<div style="display:flex;gap:14px">{tarjeta_kpi("Facturado del mes", "Q 98,450.00", "Cobrado 62 % · octubre 2026")}{tarjeta_kpi("Cobros de hoy", "Q 4,380.00", "19 pagos")}{tarjeta_kpi("Cartera vencida", "Q 15,840.50", "64 facturas · 41 clientes")}</div>
<section class="card" style="padding:18px;display:flex;flex-direction:column;gap:10px;max-width:760px">
<div class="cap">Qué se corrigió en el menú</div>
<div class="nota"><b>Antes:</b> la isla medía el alto completo de la pantalla y además empezaba 16 px abajo, así que su final quedaba 16 px fuera: «Ajustes» se veía cortado y no había margen ni esquina redondeada abajo.</div>
<div class="nota"><b>Ahora:</b> la isla queda a 16 px de los cuatro bordes en cualquier alto de pantalla (720, 800, 900…). «Ajustes» se ve entero, con aire debajo.</div>
<div class="nota"><b>Además (con el rediseño de Ajustes):</b> «Ajustes» es una sola entrada fija abajo que abre su propia pantalla. Ya no despliega 28 enlaces dentro del menú, que le quitaban espacio a lo de todos los días.</div>
</section>'''

MENU_LATERAL = f'''
{menu_compacto('Inicio', 'style="display:{{v.comp}}"')}
{menu_expandido('Inicio', 'style="display:{{v.exp}}"')}
<div style="position:absolute;left:{{{{v.izq}}}};right:0;top:0;bottom:0">
{encabezado(0)}
<main style="position:absolute;left:0;right:16px;top:84px;bottom:16px;display:flex;flex-direction:column;gap:14px;overflow:hidden">{INICIO}</main>
</div>
<!-- guía de los 16 px de abajo -->
<div style="position:absolute;left:16px;bottom:0;height:16px;width:{{{{v.ancho}}}};border-left:1px dashed var(--pri);border-right:1px dashed var(--pri);z-index:4;display:flex;align-items:center;justify-content:center"><span style="font-size:10px;font-weight:700;color:var(--pri)">16 px</span></div>
'''

escribir('MenuLateral.dc.html', pagina(
    'Menú lateral corregido', MENU_LATERAL, 1440, 900,
    "const exp=st.modo==='expandido';\nreturn {tema,v:{comp:exp?'none':'flex',exp:exp?'flex':'none',izq:exp?'276px':'108px',ancho:exp?'244px':'76px'}};"))


# ---------------------------------------------------------------------------------------------
# 2 · Ajustes en escritorio
# ---------------------------------------------------------------------------------------------
def nav_lista(permitidos=None, movil=False):
    h = ''
    for grupo, _icono, paginas in AJUSTES:
        visibles = [p for p in paginas if permitidos is None or any(x in permitidos for x in p[3].split(' · '))]
        if not visibles:
            continue
        if movil:
            filas = ''.join(
                f'<div class="fila"><span class="ic">{svg(I[ic], 18)}</span><span class="t">{et}</span>'
                f'{f"<span class=\'b wa\'>{svg(I["aviso"], 11)}{pastilla.split()[0]}</span>" if pastilla else ""}<span class="mu" style="display:inline-flex">{svg(I["der"], 16)}</span></div>'
                for ic, et, _r, _p, _k, pastilla in visibles)
            h += f'<div class="cap" style="padding:14px 6px 6px">{grupo}</div><section class="card" style="overflow:hidden;box-shadow:none">{filas}</section>'
        else:
            h += f'<div class="ng cap">{grupo}</div>'
            h += ''.join(
                f'<span class="ni{" on" if et == ACTIVA and permitidos is None else ""}"><span class="ic">{svg(I[ic], 16)}</span><span class="t">{et}</span>'
                f'{f"<span class=\'b wa\' title=\'{pastilla}\'>{svg(I["aviso"], 11)}</span>" if pastilla else ""}</span>'
                for ic, et, _r, _p, _k, pastilla in visibles)
    return h


def resultado(ic, titulo, grupo, on=False):
    return (f'<div class="res{" on" if on else ""}"><span class="ci sm" style="background:var(--panel);border-radius:10px;width:32px;height:32px">{svg(I[ic], 16)}</span>'
            f'<span style="flex:1;min-width:0"><b>{titulo}</b><span class="d">{grupo}</span></span>{"<span class=kbd>Enter</span>" if on else ""}</div>')


RESULTADOS = (resultado('campana', 'Canales de aviso', 'Comunicación e integraciones · <mark>correo</mark>, SMTP, Telegram', True)
              + resultado('mensaje', 'Plantillas de avisos', 'Comunicación e integraciones · textos del <mark>correo</mark>')
              + resultado('contacto', 'Contacto y pagos', 'Empresa y fiscal · <mark>correo</mark> de atención')
              + resultado('edificio', 'Datos de la empresa', 'Empresa y fiscal · <mark>correo</mark> de facturación'))


def campo(lab, val, req=False, cls='', ico=None, ancho=''):
    return (f'<div style="{ancho}"><div class="lb">{lab}{" <i>*</i>" if req else ""}</div>'
            f'<div class="in {cls}">{f"<span class=mu style=display:inline-flex>{svg(I[ico], 16)}</span>" if ico else ""}{val}</div></div>')


FORM = f'''<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
{campo('Nombre comercial', 'ArgosNet', True)}{campo('Razón social', 'ARGOSNET, SOCIEDAD ANÓNIMA', True)}
{campo('NIT', '1234567-8', True)}{campo('País', 'Guatemala · GTQ', cls='auto')}
{campo('Dirección fiscal', '6.ª avenida 12-30, zona 1, Chimaltenango', True, ico='pin', ancho='grid-column:1/3')}
{campo('Teléfono de atención', '7839-0000', ico='tel')}{campo('Correo de facturación', 'facturas@argosnet.gt')}
</div>'''

AJUSTES_ESC = f'''
{menu_compacto('Ajustes')}
{encabezado(108)}
<div style="position:absolute;left:112px;top:72px;font-size:13px;display:flex;gap:6px;align-items:center" class="mu">Ajustes {svg(I['der'], 13)} Empresa y fiscal {svg(I['der'], 13)} <b style="color:var(--texto)">{{{{miga}}}}</b></div>
<!-- navegación propia de Ajustes: una sola lista agrupada, con un solo buscador -->
<aside class="card nav" style="position:absolute;left:108px;top:104px;bottom:16px;width:272px;padding:14px 10px 0;border-radius:20px" aria-label="Ajustes">
<b style="font-size:18px;letter-spacing:-.01em;padding:0 8px 10px">Ajustes</b>
<div style="padding:0 4px 6px"><div class="campo {{{{c.busca}}}}">{svg(I['buscar'], 16)}<span style="flex:1">{{{{busca}}}}</span><span style="display:{{{{v.x}}}}">{svg(I['x'], 14)}</span></div></div>
<div style="display:{{{{v.lista}}}};flex-direction:column;flex:1;min-height:0;overflow:hidden;position:relative" class="fijo">{nav_lista()}
<i style="position:absolute;right:1px;top:8px;width:4px;height:230px;border-radius:9px;background:var(--borde2)"></i></div>
<div style="display:{{{{v.rol}}}};flex-direction:column;flex:1;min-height:0;overflow:hidden" class="fijo">{nav_lista(ROL_CONTA)}
<div class="nota" style="margin:14px 8px 0;padding:10px 12px;border-radius:12px;background:var(--panel)"><b>Rol contabilidad.</b> Solo aparece lo que puede abrir. Un grupo sin nada permitido no se muestra (aquí se ven 3 de 8), y el buscador tampoco lo encuentra.</div></div>
<div style="display:{{{{v.res}}}};flex-direction:column;gap:2px;flex:1;min-height:0;padding:4px 2px">
<div class="cap" style="padding:6px 10px">4 resultados</div>{RESULTADOS}
<div class="nota" style="padding:12px 10px">Busca por nombre y por lo que hay dentro: «correo», «NIT», «mora», «logo», «RADIUS». <span class="kbd">↑</span> <span class="kbd">↓</span> para moverse, <span class="kbd">Esc</span> para borrar.</div></div>
</aside>
<!-- la pantalla elegida -->
<main style="position:absolute;left:396px;right:16px;top:104px;bottom:16px;display:flex;flex-direction:column;gap:12px">
<div style="display:flex;align-items:flex-start;gap:12px"><div style="flex:1"><h1 style="margin:0;font-size:24px;letter-spacing:-.02em">{{{{miga}}}}</h1>
<div class="mu" style="font-size:14px">{{{{desc}}}}</div></div><span class="f ci">{svg(I['ayuda'])}</span></div>
<div style="display:{{{{v.emp}}}};align-items:center;gap:8px"><span class="mu" style="font-size:13px">Empresa</span><span class="btn p">{svg(I['edificio'], 15)}ArgosNet</span><span class="btn o">{svg(I['edificio'], 15)}Fibra del Sur</span><span class="btn o">{svg(I['mas1'], 15)}Nueva</span></div>
<section class="card" style="flex:1;min-height:0;display:flex;flex-direction:column;border-radius:20px">
<div style="flex:1;padding:20px;overflow:hidden">{FORM}</div>
<div style="display:flex;align-items:center;gap:10px;padding:14px 20px;border-top:1px solid var(--borde)"><span class="mu" style="font-size:13px;flex:1">Cada empresa tiene su NIT, sus cuentas y su libro. Nada se mezcla entre empresas.</span><span class="btn g">Descartar</span><span class="btn p">{svg(I['check'], 15)}Guardar</span></div>
</section></main>
'''

escribir('AjustesEscritorio.dc.html', pagina(
    'Ajustes reestructurado · escritorio', AJUSTES_ESC, 1440, 900,
    "const b=st.v==='buscar', r=st.v==='rol';\n"
    "return {tema,busca:b?'correo':'Buscar un ajuste…',c:{busca:b?'on':''},miga:r?'Régimen e impuestos':'Datos de la empresa',"
    "desc:r?'País, régimen, establecimientos, frases e impuestos de cada empresa':'Los datos legales con los que se factura y se declara',"
    "v:{x:b?'inline-flex':'none',lista:(b||r)?'none':'flex',rol:r?'flex':'none',res:b?'flex':'none',emp:'flex'}};"))


# ---------------------------------------------------------------------------------------------
# 3 · Ajustes en el teléfono
# ---------------------------------------------------------------------------------------------
def cab_movil(cerrar=False):
    der = (f'<span class="ci sm f">{svg(I["x"], 18)}</span>' if cerrar else
           f'<span class="ci sm f">{svg(I["caja"], 18)}<i class="pt" style="background:#16A34A;top:6px;right:6px"></i></span>'
           f'<span class="ci sm f">{svg(I["pulso"], 18)}<i class="pt" style="background:#D97706;top:6px;right:6px"></i></span><span class="ci sm cu">AA</span>')
    return (f'<div style="display:flex;align-items:center;gap:10px;padding:16px 16px 8px">{logo(30)}'
            f'<b style="font-size:17px;letter-spacing:-.02em;flex:1">Argos<span class="pri">Isp</span></b>{der}</div>')


def isla(activo='mas'):
    d = [('casa', 'Inicio', 'inicio'), ('clientes', 'Clientes', 'clientes'), ('wifi', 'Servicios', 'servicios'), ('campana', 'Avisos', 'avisos'), ('mas', 'Más', 'mas')]
    return '<nav class="isla" aria-label="Navegación del teléfono">' + ''.join(
        f'<span class="dest{" on" if k == activo else ""}">{svg(I[i], 22)}<span>{n}</span></span>' for i, n, k in d) + '</nav>'


def res_movil(ic, titulo, grupo):
    return (f'<div class="fila" style="min-height:58px"><span class="ic">{svg(I[ic], 18)}</span><span class="t"><b style="font-size:14.5px;display:block">{titulo}</b>'
            f'<span class="mu" style="font-size:12px">{grupo}</span></span><span class="mu" style="display:inline-flex">{svg(I["der"], 16)}</span></div>')


AJUSTES_MOV = f'''
<div style="position:absolute;inset:0;display:flex;flex-direction:column">
{cab_movil()}
<!-- lista -->
<div style="display:{{{{v.lista}}}};flex-direction:column;flex:1;min-height:0">
<div style="padding:4px 16px 10px"><h1 style="margin:0 0 10px;font-size:26px;letter-spacing:-.02em">Ajustes</h1>
<div class="campo {{{{c.busca}}}}" style="height:44px">{svg(I['buscar'], 17)}<span style="flex:1">{{{{busca}}}}</span><span style="display:{{{{v.x}}}}">{svg(I['x'], 15)}</span></div></div>
<div style="display:{{{{v.grupos}}}};flex-direction:column;flex:1;min-height:0;overflow:hidden;padding:0 12px 100px" class="fijo">{nav_lista(movil=True)}</div>
<div style="display:{{{{v.res}}}};flex-direction:column;flex:1;min-height:0;padding:0 12px"><div class="cap" style="padding:6px 6px 8px">4 resultados para «correo»</div>
<section class="card" style="overflow:hidden;box-shadow:none">{res_movil('campana', 'Canales de aviso', 'Comunicación e integraciones')}{res_movil('mensaje', 'Plantillas de avisos', 'Comunicación e integraciones')}{res_movil('contacto', 'Contacto y pagos', 'Empresa y fiscal')}{res_movil('edificio', 'Datos de la empresa', 'Empresa y fiscal')}</section></div>
</div>
<!-- una pantalla -->
<div style="display:{{{{v.pag}}}};flex-direction:column;flex:1;min-height:0;padding:0 16px;gap:10px">
<span class="mu" style="display:inline-flex;align-items:center;gap:4px;font-size:14px;font-weight:500">{svg(I['izq'], 16)}Ajustes</span>
<div><h1 style="margin:0;font-size:24px;letter-spacing:-.02em">Datos de la empresa</h1><div class="mu" style="font-size:13px">Empresa y fiscal</div></div>
<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><span class="btn p">{svg(I['edificio'], 15)}ArgosNet</span><span class="btn o">{svg(I['edificio'], 15)}Fibra del Sur</span><span class="f ci sm" style="margin-left:auto">{svg(I['ayuda'], 18)}</span></div>
<section class="card" style="padding:16px;display:flex;flex-direction:column;gap:14px;border-radius:18px">
{campo('Nombre comercial', 'ArgosNet', True)}{campo('Razón social', 'ARGOSNET, SOCIEDAD ANÓNIMA', True)}{campo('NIT', '1234567-8', True)}{campo('País', 'Guatemala · GTQ', cls='auto')}{campo('Dirección fiscal', '6.ª avenida 12-30, zona 1', True, ico='pin')}
</section></div>
</div>
<div class="barra" style="display:{{{{v.barra}}}}"><span class="btn g" style="padding:11px 16px">Descartar</span><span class="btn p" style="flex:1;padding:11px 16px;font-size:15px">{svg(I['check'], 16)}Guardar</span></div>
{isla('mas')}
'''

escribir('AjustesMovil.dc.html', pagina(
    'Ajustes reestructurado · teléfono', AJUSTES_MOV, 390, 844,
    "const p=st.p||'lista', b=p==='buscar', g=p==='pagina';\n"
    "return {tema,busca:b?'correo':'Buscar un ajuste…',c:{busca:b?'on':''},"
    "v:{lista:g?'none':'flex',grupos:b?'none':'flex',res:b?'flex':'none',x:b?'inline-flex':'none',pag:g?'flex':'none',barra:g?'flex':'none'}};"))


# ---------------------------------------------------------------------------------------------
# 4 · Menú del perfil del teléfono: drawer desde abajo (y su fila en «Más»)
# ---------------------------------------------------------------------------------------------
def empresa(nombre, nit, on=False):
    sub = f'<span class="mu" style="font-size:12px;display:block">{nit}</span>' if nit else ''
    return (f'<div class="fila" style="min-height:52px" role="radio" aria-checked="{"true" if on else "false"}"><span class="t"><span style="font-weight:{600 if on else 500}">{nombre}</span>{sub}</span>'
            f'<i class="radio{" on" if on else ""}"></i></div>')


def accion(ic, texto, sub='', rojo=False):
    color = 'color:var(--er)' if rojo else ''
    s = f'<span class="mu" style="font-size:12px;display:block">{sub}</span>' if sub else ''
    flecha = '' if rojo else f'<span class="mu" style="display:inline-flex">{svg(I["der"], 16)}</span>'
    return f'<div class="fila" style="{color}"><span class="ic" style="{color}">{svg(I[ic], 19)}</span><span class="t">{texto}{s}</span>{flecha}</div>'


FONDO_INICIO = f'''<div style="position:absolute;inset:0;display:flex;flex-direction:column">
{cab_movil()}
<div style="padding:4px 12px;display:flex;flex-direction:column;gap:12px">
<section style="border-radius:18px;padding:18px;color:#fff;background:linear-gradient(135deg,#4F46E5,#4338CA 55%,#0E7490)"><b style="font-size:20px;display:block">Buenas tardes, Ana</b><span style="font-size:13px;opacity:.9">Hay 4 comprobantes por revisar.</span></section>
<section class="card" style="padding:14px"><div class="mu" style="font-size:12px">Facturado del mes</div><b class="num" style="font-size:24px">Q 98,450.00</b></section>
<section class="card" style="padding:14px"><div class="mu" style="font-size:12px">Cobros de hoy</div><b class="num" style="font-size:24px">Q 4,380.00</b></section>
</div></div>{isla('inicio')}'''

DRAWER = f'''<div class="velo" style="display:{{{{v.drawer}}}}"></div>
<div class="drawer" role="dialog" aria-label="Tu cuenta" style="display:{{{{v.drawer}}}}">
<i class="asa"></i>
<div style="display:flex;align-items:center;gap:12px;padding:2px 4px"><span class="ci cu" style="width:46px;height:46px;font-size:15px">AA</span>
<span style="flex:1;min-width:0"><b style="font-size:16px;display:block">Ana Administradora</b><span class="mu" style="font-size:13px">Admin · admin@argos.test</span></span>
<span class="ci sm f" aria-label="Cerrar">{svg(I['x'], 17)}</span></div>
<div style="display:{{{{v.emp}}}};flex-direction:column;gap:6px"><div class="cap" style="padding:0 6px">Empresa activa</div>
<section class="card" style="overflow:hidden;box-shadow:none" role="radiogroup">
{empresa('Todas las empresas', '')}{empresa('ArgosNet', 'NIT 1234567-8', True)}{empresa('Fibra del Sur', 'NIT 7788990-1')}</section></div>
<div style="display:flex;flex-direction:column;gap:6px"><div class="cap" style="padding:0 6px">Tema</div>
<div class="seg3"><span class="on">{svg(I['sol'], 16)}Claro</span><span>{svg(I['luna'], 16)}Oscuro</span><span>{svg(I['monitor'], 16)}Sistema</span></div></div>
<section class="card" style="overflow:hidden;box-shadow:none">
{accion('usuario', 'Mi cuenta', 'Contraseña y verificación en dos pasos')}{accion('ayuda', 'Ayuda de esta pantalla')}{accion('cambios', 'Qué cambió', 'Versión 1.4.2')}</section>
<section class="card" style="overflow:hidden;box-shadow:none">{accion('salir', 'Cerrar sesión', rojo=True)}</section>
</div>'''

MAS = f'''<div class="mas" style="display:{{{{v.mas}}}}">
{cab_movil(cerrar=True)}
<div style="padding:4px 12px 10px;display:flex;flex-direction:column;gap:10px">
<!-- la cuenta, arriba del menú: abre el mismo drawer -->
<div class="card" style="display:flex;align-items:center;gap:12px;padding:10px 12px;box-shadow:none"><span class="ci cu">AA</span>
<span style="flex:1;min-width:0"><b style="font-size:14.5px;display:block">Ana Administradora</b><span class="mu" style="font-size:12.5px;display:inline-flex;align-items:center;gap:5px">{svg(I['edificio'], 13)}ArgosNet · Admin</span></span>
<span class="mu" style="display:inline-flex">{svg(I['der'], 17)}</span></div>
<div class="campo" style="height:44px">{svg(I['buscar'], 17)}Buscar una sección…</div>
<span class="btn o" style="align-self:flex-start;padding:7px 12px;font-size:12px">{svg(I['sliders'], 14)}Personalizar mis accesos</span></div>
<div style="flex:1;min-height:0;overflow:hidden;padding:0 12px;display:flex;flex-direction:column;gap:2px">
<span class="area on">{svg(I['casa'])}<span style="flex:1">Inicio</span></span>
{''.join(f'<span class="area">{svg(I[k])}<span style="flex:1">{n}</span>{"<span class=cnt>4</span>" if n == "Día a día" else ""}{svg(I["der"], 15)}</span>' for k, n, _ in AREAS[1:])}
</div>
<div style="padding:8px 12px 22px;border-top:1px solid var(--borde)"><span class="area">{svg(I['ajustes'])}<span style="flex:1">Ajustes</span>{svg(I['der'], 15)}</span></div>
</div>'''

escribir('PerfilDrawer.dc.html', pagina(
    'Perfil en el teléfono · drawer', FONDO_INICIO + DRAWER + MAS, 390, 844,
    "const p=st.p||'cuenta';\n"
    "return {tema,v:{drawer:p==='mas'?'none':'flex',emp:p==='una'?'none':'flex',mas:p==='mas'?'flex':'none'}};"))
