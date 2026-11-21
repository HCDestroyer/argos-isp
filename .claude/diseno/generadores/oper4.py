exec(open('/tmp/claude-0/-home-user/59389ade-3278-540a-8050-19c26767da8e/scratchpad/gen/oper_base.py').read())
# ================= 4 · Inicio de sesión =================
FONDO='radial-gradient(900px 600px at 15% 20%,rgba(6,182,212,.55) 0%,transparent 60%),radial-gradient(800px 700px at 85% 90%,rgba(129,140,248,.6) 0%,transparent 55%),linear-gradient(135deg,#312E81,#4F46E5 55%,#0E7490)'
LOGO='<div style="display:flex;align-items:center;gap:12px"><span style="width:48px;height:48px;border-radius:15px;background:linear-gradient(135deg,#4F46E5,#06B6D4);box-shadow:0 8px 20px rgba(79,70,229,.35)"></span><div><b style="font-size:20px;display:block;letter-spacing:-.01em">Conecta</b><span class="m2">Internet para tu casa y tu negocio</span></div></div>'
form=T('''<<logo>>
 <div><h1 class="h1" style="font-size:24px">Inicia sesión</h1><div class="sub">Con el correo que te dio tu administrador</div></div>
 <div class="av2 er" style="display:{{e.mal.v}}"><i:alerta:17><div><b>Correo o contraseña incorrectos.</b> Te quedan 3 intentos.</div></div>
 <div class="av2 wa" style="display:{{e.bloq.v}}"><i:reloj:17><div><b>Demasiados intentos.</b> Espera 4:32 min para volver a intentar.</div></div>
 <div><div class="lb">Correo</div><div class="in" style="border:2px solid #4F46E5;box-shadow:0 0 0 4px rgba(79,70,229,.12);padding:12px 13px"><i:mail:17:#94A3B8>ana.cruz@conecta.gt</div></div>
 <div><div class="lb">Contraseña<a href="#" style="margin-left:auto;font-weight:600;font-size:12.5px">¿La olvidaste?</a></div><div class="in" style="padding:12px 13px"><i:candado:17:#94A3B8><span style="letter-spacing:.2em">••••••••••</span><span style="margin-left:auto;color:#64748B;display:inline-flex" title="Mostrar"><i:ojo:17></span></div></div>
 <button class="btn p" style="justify-content:center;padding:14px;font-size:15px;border-radius:14px">Entrar</button>
 <div style="display:flex;align-items:center;gap:10px" class="m2"><span style="flex:1;height:1px;background:#E2E8F0"></span>o entra desde<span style="flex:1;height:1px;background:#E2E8F0"></span></div>
 <div style="display:flex;gap:8px"><button class="btn o" style="flex:1;justify-content:center;padding:11px"><i:link:15>Iris</button><button class="btn o" style="flex:1;justify-content:center;padding:11px"><i:link:15>Horus</button></div>
 <div class="m2" style="text-align:center">La sesión se cierra sola a los 3 días · <a href="#">Portal de clientes</a></div>''',logo=LOGO)
body=T('''<div style="position:absolute;inset:0;background:<<f>>"></div>
<div style="position:absolute;left:72px;bottom:72px;color:#fff;max-width:520px"><div style="font-size:40px;font-weight:700;line-height:1.1;letter-spacing:-.02em">Todo tu ISP en un solo lugar.</div><div style="font-size:16px;opacity:.85;margin-top:12px">Clientes, cobros, red e inventario.</div></div>
<div style="position:absolute;left:72px;top:56px;display:flex;gap:8px"><span class="nota" style="position:static;width:auto;padding:8px 12px;display:inline-flex;gap:8px;align-items:center"><i:pincel:14>El logo, el fondo (color o foto) y los textos se cambian en <b>Configuración › Apariencia</b></span></div>
<section class="isla" style="position:absolute;right:96px;top:50%;transform:translateY(-50%);width:420px;border-radius:26px;padding:34px 32px;display:flex;flex-direction:column;gap:16px;box-shadow:0 30px 80px rgba(15,23,42,.35)"><<form>></section>
<div style="position:absolute;right:96px;bottom:24px;width:420px;text-align:center;font-size:12px;color:rgba(255,255,255,.8)">ArgosIsp 1.22 · <span style="text-decoration:underline">Privacidad</span> · <span style="text-decoration:underline">Ayuda</span></div>''',f=FONDO,form=form)
lg=logic({'e':(['no','mal','bloq'],'no'),'m':(['no'],'no')})
obuild('OperLogin.dc.html','Inicio de sesión',body,lg)
check('OperLogin.dc.html')
mbody=T('''<div style="height:100%;display:flex;flex-direction:column;background:#fff">
 <div style="height:190px;flex:0 0 auto;background:<<f>>;border-radius:0 0 32px 32px"></div>
 <section class="isla" style="margin:-70px 16px 0;border-radius:24px;padding:24px 20px;display:flex;flex-direction:column;gap:14px"><<form>></section>
</div>''',f=FONDO,form=form.replace('font-size:24px','font-size:21px'))
ombuild('OperLoginMovil.dc.html','Inicio de sesión · teléfono',mbody,lg)
check('OperLoginMovil.dc.html')
