exec(open('/tmp/claude-0/-home-user/59389ade-3278-540a-8050-19c26767da8e/scratchpad/gen/red_base.py').read())
ic.update({
'img':'<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m4 18 5-5 4 4 3-3 4 4"/>',
'zoom':'<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M11 8v6M8 11h6"/>',
'girar':'<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
'chat':'<path d="M4 5h16v11H9l-5 4z"/>',
'bot':'<rect x="4" y="8" width="16" height="11" rx="3"/><path d="M12 8V4M9 13h.01M15 13h.01M9 16h6"/>',
'estrella':'<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
'regalo':'<rect x="3" y="9" width="18" height="12" rx="1"/><path d="M3 13h18M12 9v12M12 9c-4 0-5-5-2-5 2 0 2 5 2 5zM12 9c4 0 5-5 2-5-2 0-2 5-2 5z"/>',
'trofeo':'<path d="M8 4h8v6a4 4 0 0 1-8 0zM8 6H4a4 4 0 0 0 4 4M16 6h4a4 4 0 0 1-4 4M12 14v4M8 21h8"/>',
'link':'<path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1"/>',
'bd':'<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
'subir':'<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
'enviar':'<path d="m3 11 18-8-8 18-2-8z"/>',
'codigo':'<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13 5l-2 14"/>',
'pos':'<path d="M7 3h10v18l-2.5-1.5L12 21l-2.5-1.5L7 21zM10 8h4M10 12h4"/>',
'hoja':'<path d="M6 3h9l4 4v14H6zM15 3v4h4"/>',
'dif':'<path d="M6 4v12a3 3 0 0 0 3 3h3M18 20V8a3 3 0 0 0-3-3h-3M9 2 6 5l3 3M15 22l3-3-3-3"/>',
'escudo':'<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
'bloq':'<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
'tag':'<path d="M3 12V4h8l10 10-8 8z"/><path d="M7.5 8h.01"/>',
'vel':'<path d="M12 14 16 9M4.5 19a9 9 0 1 1 15 0"/>',
'power':'<path d="M12 3v9M6.3 6.3a8 8 0 1 0 11.4 0"/>',
'cambio':'<path d="M4 8h14l-3-3M20 16H6l3 3"/>',
'nc':'<path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 11h6"/>',
'tele':'<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
'modulo':'<rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/>',
'pincel':'<path d="M4 20c2 0 4-1 4-4l9-9a2.1 2.1 0 0 0-3-3l-9 9c-3 0-4 2-4 4 0 2 1 3 3 3z"/>',
})
CSSO='''
.pan{display:flex;flex-direction:column;min-height:0;overflow:hidden;border-radius:20px}
.ph2{padding:14px 18px;border-bottom:1px solid #F1F5F9;display:flex;align-items:center;gap:10px;flex:0 0 auto}
.pf{padding:12px 18px;border-top:1px solid #F1F5F9;display:flex;align-items:center;gap:8px;flex:0 0 auto}
.kv2{display:flex;justify-content:space-between;align-items:center;gap:10px;font-size:13px;padding:8px 0;border-top:1px solid #F1F5F9}
.kv2:first-child{border-top:0}
.kv2>span:first-child{color:#64748B;flex:0 0 auto}
.kv2>*:last-child{text-align:right;min-width:0}
.cd{background:#fff;border:1px solid #E6E8F0;border-radius:16px;padding:14px 16px;display:flex;flex-direction:column;min-width:0}
.cdh{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#64748B;margin-bottom:8px}
.cdh .lnk{margin-left:auto;text-transform:none;letter-spacing:0}
.btn.r{background:#fff;color:#B91C1C;border-color:#FECACA}
.btn.rr{background:#B91C1C;color:#fff}
.btn.sm{padding:6px 12px;font-size:12.5px}
.velo{position:absolute;inset:0;background:rgba(15,23,42,.45);z-index:8}
.dlg{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);border-radius:22px;padding:22px;z-index:9;flex-direction:column;gap:12px;max-height:88%;overflow:auto}
.dest{border:2px solid #4F46E5;border-radius:14px;padding:10px 14px;background:#fff;box-shadow:0 0 0 4px rgba(79,70,229,.12);font-size:22px;font-weight:700;display:flex;align-items:center;gap:8px}
.sn{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:12px;font-size:13.5px;font-weight:600;color:#475569;cursor:pointer;text-decoration:none}
.sn:hover{background:#F8FAFC}.sn.on{background:#EEF2FF;color:#3730A3}
.sn small{display:block;font-weight:500;font-size:11.5px;color:#94A3B8}
.cod{font-family:ui-monospace,Menlo,monospace;font-size:12px;line-height:1.6;background:#0F172A;color:#CBD5E1;border-radius:14px;padding:14px;overflow:auto;white-space:pre}
.cod em{color:#67E8F9;font-style:normal}.cod u{color:#FCD34D;text-decoration:none}
.tk80{width:302px;background:#fff;border:1px solid #E2E8F0;box-shadow:0 12px 30px rgba(15,23,42,.14);padding:16px 14px;font-family:ui-monospace,Menlo,monospace;font-size:11.5px;line-height:1.5;color:#0F172A}
.tk80 hr{border:0;border-top:1px dashed #94A3B8;margin:7px 0}
.tk80 .fl{display:flex;justify-content:space-between;gap:8px}
.rd2{width:18px;height:18px;border-radius:999px;border:2px solid #CBD5E1;flex:0 0 auto;box-sizing:border-box}
.rd2.on{border:5.5px solid #4F46E5}
.ck2{width:20px;height:20px;border-radius:6px;border:2px solid #CBD5E1;flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;color:#fff;box-sizing:border-box}
.ck2.on{background:#4F46E5;border-color:#4F46E5}
.dfa{background:#FEE2E2;color:#991B1B;border-radius:6px;padding:1px 6px;text-decoration:line-through}
.dfb{background:#DCFCE7;color:#166534;border-radius:6px;padding:1px 6px}
.rap{display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:10px;border:1px solid #E2E8F0;background:#fff;font-weight:600;font-size:13px;cursor:pointer}
.mbar{flex:0 0 auto;display:flex;gap:8px;padding:10px 12px 14px;background:#fff;border-top:1px solid #E6E8F0}
.mbar .btn{flex:1;justify-content:center;padding:13px 10px;font-size:14px}
'''
AY=lambda t='Ayuda del manual': T('<button class="ib f" title="<<t>>" aria-label="<<t>>" style="width:40px;height:40px;border-radius:999px;cursor:help;flex:0 0 auto"><i:ayuda:18></button>',t=t)
def head(tit,sub,acc='',ay='Ayuda del manual'):
    return T('''<div style="display:flex;align-items:center;gap:10px;flex:0 0 auto">
 <div style="min-width:0"><h1 class="h1"><<t>></h1><div class="sub"><<s>></div></div><span style="flex:1"></span><<ay>><<a>></div>''',t=tit,s=sub,a=acc,ay=AY(ay))
def B(cls,txt,ico=None):
    return T('<span class="b <<c>>">'+(f'<i:{ico}:13>' if ico else '')+'<<t>></span>',c=cls,t=txt)
def kv(k,v): return f'<div class="kv2"><span>{k}</span><span>{v}</span></div>'
def cd(tit,ico,body,lnk='',st=''):
    return T('<section class="cd" style="<<st>>"><div class="cdh"><i:<<i>>:15><<t>><<l>></div><<b>></section>',st=st,i=ico,t=tit,b=body,l=(f'<button class="lnk">{lnk}</button>' if lnk else ''))
def dlg(mid,ico,icls,tit,body,acc,w=480):
    return T('''<div class="isla dlg" role="dialog" aria-label="<<t>>" style="display:{{m.<<id>>.v}};width:<<w>>px">
 <div style="display:flex;gap:12px;align-items:center"><span class="ico <<ic>>"><i:<<i>>:19></span><b style="font-size:17px;flex:1"><<t>></b><button class="ib" aria-label="Cerrar" onClick="{{m.no.ir}}"><i:cerrar:17></button></div>
 <<b>>
 <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:6px"><<a>></div>
</div>''',id=mid,w=w,ic=icls,i=ico,t=tit,b=body,a=acc)
VELO='<div class="velo" style="display:{{mOn}}" onClick="{{m.no.ir}}"></div>'
def seg(grp,items):
    return '<div class="segb">'+''.join(T('<button class="ts {{<<g>>.<<id>>.cls}}" onClick="{{<<g>>.<<id>>.ir}}">'+(f'<i:{it[2]}:15>' if len(it)>2 and it[2] else '')+'<<n>>'+(f'<span class="c {it[4] if len(it)>4 else ""}">{it[3]}</span>' if len(it)>3 and it[3] is not None else '')+'</button>',g=grp,id=it[0],n=it[1]) for it in items)+'</div>'
def logic(groups,lists=None,extra=''):
    return '''class Component extends DCLogic {
renderVals() {
const st = this.state || {};
const G = %s;
const L = %s;
const out = {};
const cur = (g) => (st[g] === undefined ? G[g].def : st[g]);
Object.keys(G).forEach((g) => {
const c = cur(g); const o = {};
G[g].ids.forEach((id) => { o[id] = { cls: id === c ? 'on' : '', v: id === c ? 'flex' : 'none', b: id === c ? 'block' : 'none', ir: () => this.setState({ [g]: id }) }; });
out[g] = o; out[g + 'On'] = c !== G[g].def ? 'block' : 'none';
});
Object.keys(L).forEach((n) => {
let rows = L[n].rows;
if (L[n].por) { const c = cur(L[n].por); rows = rows.filter((r) => c === L[n].todos || String(r.g || '').split(' ').includes(c)); }
const k = 's_' + n; const s = st[k] === undefined ? L[n].def : st[k];
out[n] = rows.map((r) => ({ ...r, cls: r.id === s ? 'on' : '', ver: () => this.setState({ [k]: r.id }) }));
out[n + 'Sel'] = L[n].rows.find((r) => r.id === s) || L[n].rows[0];
out[n + 'N'] = rows.length;
out[n + 'Vacio'] = rows.length ? 'none' : 'block';
});
%s
return out;
}
}''' % (JS({g:{'ids':v[0],'def':v[1]} for g,v in groups.items()}),JS(lists or {}),extra)
def railaj():
    r=rail('aj')
    return r.replace('<a class="rail" href="#" style="margin-top:auto">','<a class="rail on" href="#" style="margin-top:auto">')
def shell2(on,migas,inner,over=''):
    m=' › '.join(migas[:-1])
    return (railaj() if on=='aj' else rail(on))+HEADER+f'''<main style="position:absolute;left:108px;right:16px;top:70px;bottom:16px;display:flex;flex-direction:column;gap:10px;min-height:0;padding:0 4px">
<div class="migas">{m} › <b>{migas[-1]}</b></div>
{inner}
</main>{over}'''
def obuild(fn,title,body,lg,h=900,css=''):
    build(fn,title,body,lg,h,CSSO+css)
def ombuild(fn,title,body,lg,css=''):
    mbuild(fn,title,body,lg,CSSO+css)
def check(fn):
    t=open(fn).read()
    body=t.split('<x-dc>')[1].split('</x-dc>')[0]
    bad=re.findall(r'<<\w+>>|<i:\w+',body)
    if bad: print('SIN REEMPLAZAR',fn,set(bad))
    if re.search(r'class="[^"]*\bb in\b',body): print('CHOQUE b in',fn)
