import json,sys
S='/tmp/claude-0/-home-user/59389ade-3278-540a-8050-19c26767da8e/scratchpad/'
c=json.load(open(S+'conta_remote/project/canvas.json'))
if not any(p['id']=='contabilidad' for p in c['pages']): c['pages'].append({'id':'contabilidad','name':'Reportes y contabilidad'})
B=[('ContaPanel.dc.html','1 · Panel financiero del dueño: cobranza, morosidad, efectivo, impuestos, empresas y alertas (interactiva)',0,0,1440,1000),
('ContaPanelMovil.dc.html','1 · Panel financiero · teléfono (consulta)',1520,0,390,844),
('ContaPanelMovil2.dc.html','1 · Finanzas por empresa e impuestos · teléfono',1990,0,390,844),
('ContaReportes.dc.html','2 · Reportes: catálogo agrupado con buscador, favoritos y envíos programados (interactiva)',0,1120,1440,900),
('ContaReporteVisor.dc.html','2 · Visor de reporte: filtros, gráfica, tabla, Excel/PDF y programar envío (interactiva)',1520,1120,1440,900),
('ContaLibro.dc.html','3 · Libro: diario, mayor, auxiliar de cliente y detalle de un asiento con reverso (interactiva)',0,2140,1440,900),
('ContaCierres.dc.html','4 · Periodos y cierres: verificaciones del mes, bloqueos, ejercicio y reabrir con motivo (interactiva)',1520,2140,1440,900),
('ContaFiscal.dc.html','5 · Fiscal: calendario de obligaciones y declaración (calcular → revisar → presentar → pagar)',0,3160,1440,900),
('ContaFel.dc.html','5 · FEL: cola, contingencia y rechazados · libros legales con folio (interactiva)',1520,3160,1440,900),
('ContaCompras.dc.html','6 · Compras y gastos: compras, borradores desde archivo, proveedores y activos fijos (interactiva)',0,4180,1440,900),
('ContaCartera.dc.html','7 · Cartera: antigüedad, gestión de cobro, castigos y notas de crédito (interactiva)',1520,4180,1440,900)]
for f,t,x,y,w,h in B:
    c['boards'][f]={'expand':'fill','h':h,'is_interactive':True,'page':'contabilidad','title':t,'w':w,'x':x,'y':y}
    if f not in c['order']: c['order'].append(f)
c['notes']['tituloConta']={'kind':'title1','maxW':2960,'page':'contabilidad','text':'Reportes y contabilidad · el corazón de la app','w':240,'x':0,'y':-300}
if 'tituloConta' not in c.get('noteOrder',[]): c.setdefault('noteOrder',[]).append('tituloConta')
json.dump(c,open(S+'rediseno-artifact/project/canvas.json','w'),ensure_ascii=False,indent=2)
print(len(c['boards']))
