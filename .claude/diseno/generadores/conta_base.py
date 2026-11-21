exec(open('/tmp/claude-0/-home-user/59389ade-3278-540a-8050-19c26767da8e/scratchpad/gen/red_base.py').read())
ic.update({
'libro':'<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 21a2 2 0 0 0 2 2h13v-4M9 8h6"/>',
'estrella':'<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
'tend':'<path d="M3 17 9 11l4 4 8-8M15 7h6v6"/>',
'pastel':'<path d="M12 3v9h9A9 9 0 1 1 12 3z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/>',
'sello':'<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
'firma':'<path d="M3 17c3-6 5-9 6-7s-2 7 0 7 3-5 5-5 1 4 3 4 2-1 4-1M3 21h18"/>',
'excel':'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16"/>',
'pdf':'<path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4M9 17v-4h1.5a1.5 1.5 0 0 1 0 3H9"/>',
'enviar':'<path d="M21 3 10 14M21 3l-7 18-4-7-7-4z"/>',
'subir':'<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
'calc':'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01"/>',
'girar':'<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
'caden':'<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
'camion':'<path d="M2 6h11v10H2zM13 9h5l3 3v4h-8z"/><circle cx="6.5" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
'torre':'<path d="M12 8v13M8 21l4-13 4 13M9.5 16h5M7 5a7 7 0 0 1 10 0M9.5 7.5a3.5 3.5 0 0 1 5 0"/>',
'bandera':'<path d="M5 21V4M5 4h12l-2 4 2 4H5"/>',
'grupo':'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
'nota':'<path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z"/><path d="M9 12h6"/>',
})
CSSK='''
.kt{background:#fff;border:1px solid #E6E8F0;border-radius:16px;padding:12px 14px;display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.kt .kl{font-size:12px;color:#64748B;display:flex;align-items:center;gap:6px;font-weight:600;white-space:nowrap}.kt .kl .nuevo{margin-left:auto}
.kt .kv{font-size:23px;font-weight:700;letter-spacing:-.01em;font-variant-numeric:tabular-nums;white-space:nowrap}
.kt .ks{font-size:12px;color:#64748B;display:flex;align-items:center;gap:6px;white-space:nowrap}
.dl{display:inline-flex;align-items:center;gap:3px;font-size:11.5px;font-weight:700;border-radius:999px;padding:1px 7px}
.dl.up{background:#DCFCE7;color:#166534}.dl.dn{background:#FEE2E2;color:#B91C1C}.dl.eq{background:#F1F5F9;color:#475569}
.pan{background:#fff;border:1px solid #E6E8F0;box-shadow:0 10px 30px rgba(15,23,42,.06);border-radius:20px;padding:16px 18px;display:flex;flex-direction:column;min-width:0;min-height:0}
.ct{font-size:15px;font-weight:700;margin:0;line-height:1.3}
.cs{font-size:12px;color:#64748B;margin-top:2px}
.lg{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:#475569}
.lg i{width:10px;height:10px;border-radius:3px;display:inline-block}
.ax{font-size:11px;fill:#94A3B8;font-family:Inter,system-ui,sans-serif}
.axv{font-size:11px;fill:#334155;font-weight:600;font-family:Inter,system-ui,sans-serif}
.tb{width:100%;border-collapse:collapse;font-size:13px}
.tb th{font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#64748B;text-align:left;padding:8px 12px;background:#F8FAFC;position:sticky;top:0;white-space:nowrap}
.tb td{padding:9px 12px;border-top:1px solid #F1F5F9;vertical-align:middle}
.tb .r{text-align:right;font-variant-numeric:tabular-nums}
.tb tr.tot td{font-weight:700;background:#F8FAFC;border-top:2px solid #E2E8F0}
.tb tr.hv:hover td{background:#FAFAFF;cursor:pointer}
.tb tr.act td{background:#F5F7FF}
.sw{width:10px;height:10px;border-radius:3px;display:inline-block;flex:0 0 auto}
.stp{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:#64748B;white-space:nowrap}
.stp .n{width:26px;height:26px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;background:#F1F5F9;color:#64748B;font-size:12px;font-weight:700}
.stp.hecho{color:#166534}.stp.hecho .n{background:#DCFCE7;color:#166534}
.stp.act{color:#3730A3}.stp.act .n{background:#4F46E5;color:#fff;box-shadow:0 0 0 4px #E0E7FF}
.stl{flex:1;height:2px;background:#E2E8F0;border-radius:2px;min-width:16px}.stl.hecho{background:#86EFAC}
.chk{display:flex;align-items:center;gap:12px;padding:10px 16px;border-top:1px solid #F1F5F9;font-size:13px}
.chk:first-child{border-top:0}
.ci2{width:26px;height:26px;border-radius:999px;display:flex;align-items:center;justify-content:center;flex:0 0 auto}
.ci2.ok{background:#DCFCE7;color:#166534}.ci2.er{background:#FEE2E2;color:#B91C1C}.ci2.wa{background:#FEF3C7;color:#92400E}.ci2.ne{background:#F1F5F9;color:#64748B}
.side{position:absolute;top:0;right:0;bottom:0;background:#fff;border-left:1px solid #E6E8F0;box-shadow:-20px 0 50px rgba(15,23,42,.14);display:flex;flex-direction:column;z-index:5}
.cat{display:flex;align-items:center;gap:8px;padding:9px 12px;border-radius:12px;font-size:13px;font-weight:600;color:#475569;cursor:pointer;border:0;background:transparent;width:100%;text-align:left}
.cat.on{background:#EEF2FF;color:#3730A3}
.cat .c{margin-left:auto;font-size:11px;font-weight:700;color:#94A3B8}
.rp{display:flex;align-items:center;gap:12px;padding:11px 16px;border-bottom:1px solid #F1F5F9;cursor:pointer;font-size:13px}
.rp:hover{background:#FAFAFF}
.fav{color:#CBD5E1;display:inline-flex}.fav.on{color:#D97706}.fav.on svg{fill:#FBBF24}
.mes{flex:1;border:1px solid #E6E8F0;border-radius:12px;padding:8px 6px;display:flex;flex-direction:column;align-items:center;gap:4px;font-size:12px;font-weight:600;color:#475569;background:#fff;min-width:0;cursor:pointer}
.mes.cer{background:#F0FDF4;border-color:#BBF7D0;color:#166534}.mes.dur{background:#F1F5F9;border-color:#CBD5E1;color:#334155}.mes.act{border-color:#4F46E5;box-shadow:0 0 0 3px rgba(79,70,229,.15);color:#3730A3}.mes.fut{color:#CBD5E1;border-style:dashed}
.hbar{display:flex;height:22px;gap:2px;border-radius:6px;overflow:hidden}
.hbar i{display:block;height:100%}
.av2 b{font-weight:700}
.grp{display:flex;align-items:center;gap:8px;padding:8px 16px;background:#F8FAFC;border-top:1px solid #EEF0F5;border-bottom:1px solid #EEF0F5;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#64748B}
.grp .m2{font-weight:600;letter-spacing:0}
.nsh>*{flex:0 0 auto}
'''
EMP=T('<span class="selp" style="height:40px"><i:edif:15><<e>><i:ab:14></span>',e='__E__')
def emp(n='Todas las empresas'): return EMP.replace('__E__',n)
def per(n='Noviembre 2026'): return T('<span class="selp" style="height:40px"><i:cal:15><<e>><i:ab:14></span>',e=n)
AYUDA=lambda t:T('<button class="ib f" title="Ayuda: <<t>> (manual)" style="width:40px;height:40px;border-radius:999px;cursor:help"><i:ayuda:18></button>',t=t)
def kt(ico,cls,l,v,sub,d='',dc='up',nuevo=False):
    return T('<div class="kt"><div class="kl"><span class="ico <<cls>>" style="width:26px;height:26px;border-radius:8px"><i:<<ico>>:15></span><<l>><<nv>></div><div class="kv"><<v>></div><div class="ks"><<dd>><<sub>></div></div>',cls=cls,ico=ico,l=l,v=v,sub=sub,nv=' <span class="nuevo">nuevo</span>' if nuevo else '',dd=(f'<span class="dl {dc}">{d}</span>' if d else ''))
def cbuild(fn,title,body,logic,h=900): build(fn,title,body,logic,h,CSSK)
def cmbuild(fn,title,body,logic): mbuild(fn,title,body,logic,CSSK)
LOG0='class Component extends DCLogic {\nrenderVals() { return {}; }\n}'
def fmt(n): return f'{n:,.0f}'
# ---- gráficas ----
C1='#4F46E5';C2='#0891B2'
ANT=['#CBD5E1','#FDBA74','#F97316','#C2410C','#7C2D12']
def barras2(lab,a,b,w=640,h=210,na='Facturado',nb='Cobrado',ymax=None,tick=100):
    ml,mr,mt,mb=40,8,8,22
    pw,ph=w-ml-mr,h-mt-mb
    ymax=ymax or max(a+b)*1.1
    o=f'<svg viewBox="0 0 {w} {h}" width="100%" height="100%" preserveAspectRatio="none" role="img" aria-label="{na} y {nb} por mes" style="display:block">'
    v=0
    while v<=ymax:
        y=mt+ph-ph*v/ymax
        o+=f'<line x1="{ml}" x2="{w-mr}" y1="{y:.1f}" y2="{y:.1f}" stroke="{"#CBD5E1" if v==0 else "#EEF0F5"}" stroke-width="1"/><text class="ax" x="{ml-6}" y="{y+4:.1f}" text-anchor="end">{v}</text>'
        v+=tick
    n=len(lab);g=pw/n;bw=min(14,g*0.3)
    for i,(l,x,y2) in enumerate(zip(lab,a,b)):
        cx=ml+g*i+g/2
        for k,(val,c,nm) in enumerate([(x,C1,na),(y2,C2,nb)]):
            bh=ph*val/ymax;bx=cx-bw-1+k*(bw+2);by=mt+ph-bh
            o+=f'<path d="M{bx:.1f},{mt+ph} V{by+4:.1f} q0,-4 4,-4 h{bw-8:.1f} q4,0 4,4 V{mt+ph} z" fill="{c}"><title>{l}: {nm} Q {val:,.1f} mil</title></path>'
        o+=f'<text class="ax" x="{cx:.1f}" y="{h-6}" text-anchor="middle">{l}</text>'
    lx=ml+g*(n-1)+g/2
    o+='</svg>'
    return o
def linea(lab,vals,w=420,h=150,ymin=None,ymax=None,ticks=None,color=C1,fmtv=lambda v:f'{v:.0f}',area=True,ult=''):
    ml,mr,mt,mb=34,64,12,20
    pw,ph=w-ml-mr,h-mt-mb
    ymin=min(vals)*0.95 if ymin is None else ymin; ymax=max(vals)*1.05 if ymax is None else ymax
    X=lambda i:ml+pw*i/(len(vals)-1); Y=lambda v:mt+ph-ph*(v-ymin)/(ymax-ymin)
    o=f'<svg viewBox="0 0 {w} {h}" width="100%" height="100%" preserveAspectRatio="none" role="img" style="display:block">'
    for t in (ticks or []):
        o+=f'<line x1="{ml}" x2="{w-mr}" y1="{Y(t):.1f}" y2="{Y(t):.1f}" stroke="#EEF0F5"/><text class="ax" x="{ml-6}" y="{Y(t)+4:.1f}" text-anchor="end">{fmtv(t)}</text>'
    pts=' '.join(f'{X(i):.1f},{Y(v):.1f}' for i,v in enumerate(vals))
    if area: o+=f'<polygon points="{ml},{mt+ph} {pts} {X(len(vals)-1):.1f},{mt+ph}" fill="{color}" opacity=".08"/>'
    o+=f'<polyline points="{pts}" fill="none" stroke="{color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>'
    o+=f'<circle cx="{X(len(vals)-1):.1f}" cy="{Y(vals[-1]):.1f}" r="4.5" fill="{color}" stroke="#fff" stroke-width="2"/><text class="axv" x="{X(len(vals)-1)+8:.1f}" y="{Y(vals[-1])+4:.1f}">{ult}</text>'
    for i,l in enumerate(lab):
        if l: o+=f'<text class="ax" x="{X(i):.1f}" y="{h-5}" text-anchor="middle">{l}</text>'
    o+='</svg>'
    return o
def hbar(vals,cols,hh=22):
    t=sum(vals)
    return f'<div class="hbar" style="height:{hh}px">'+''.join(f'<i style="width:{v/t*100:.2f}%;background:{c}" title="{v:,.0f}"></i>' for v,c in zip(vals,cols))+'</div>'
