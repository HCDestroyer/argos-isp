import json
S='/tmp/claude-0/-home-user/59389ade-3278-540a-8050-19c26767da8e/scratchpad/'
c=json.load(open(S+'artifact-files/08795c71-47c7-4c94-b1aa-212a30d80e6c/project/canvas.json'))
B=[
('OperComprobantes','1 · Comprobantes: cola de revisión con la imagen, sugerencia de factura, aprobar o rechazar con causa (interactiva)',0,0,1440,900),
('OperPromesas','1 · Promesas por servicio: activas, por vencer, por aprobar, cumplidas, incumplidas y reconexión temporal (interactiva)',1520,0,1440,900),
('OperComprobanteMovil','1 · Revisar un comprobante · teléfono',3040,0,390,844),
('OperServicioFicha','2 · Ficha del servicio S-000412: sesión, IPs, equipo, tráfico, plan, adicionales, facturas, contactos, bitácora y portal de corte (interactiva)',0,1100,1440,1000),
('OperServicioFichaMovil','2 · Ficha del servicio · teléfono (interactiva)',1520,1100,390,844),
('OperFacturas','3 · Facturas: lista con filtros y vista rápida (interactiva)',0,2300,1440,900),
('OperFacturaDetalle','3 · Factura: líneas, pagos, DTE, nota de crédito, imprimir en carta o POS y anular (interactiva)',1520,2300,1440,900),
('OperFacturasPeriodo','3 · Emitir facturas por periodo, incluidas las pasadas: sin prorrateo, monto editable y tramo inicial',3040,2300,1440,900),
('OperPlantillasFacturacion','3 · Plantillas de facturación: ciclo, corte, promesas y reconexión temporal (interactiva)',0,3400,1440,900),
('OperPlantillaDocumento','3 · Plantillas de documentos con formato POS de 80 mm',1520,3400,1440,900),
('OperLogin','4 · Inicio de sesión con logo y fondo de Apariencia',0,4500,1440,900),
('OperLoginMovil','4 · Inicio de sesión · teléfono',1520,4500,390,844),
('OperConfigEmpresa','5 · Configuración: empresa y fiscal (interactiva)',0,5600,1440,900),
('OperConfigCobro','5 · Configuración: facturación y cobro, cuentas y bancos de origen (interactiva)',1520,5600,1440,900),
('OperConfigRed','5 · Configuración: red y portal',3040,5600,1440,900),
('OperConfigNotificaciones','5 · Configuración: notificaciones y plantillas de mensajes',0,6700,1440,900),
('OperConfigIntegraciones','5 · Configuración: integraciones (Iris, Horus, pasarela)',1520,6700,1440,900),
('OperConfigImportar','5 · Configuración: importar desde Mikrowisp',3040,6700,1440,900),
('OperUsuarios','6 · Usuarios: lista y perfil',0,7800,1440,900),
('OperRoles','6 · Roles y permisos con alcance por router, zona o caja',1520,7800,1440,900),
('OperBitacora','6 · Bitácora: filtros y diff por campo (interactiva)',3040,7800,1440,900),
('OperLealtad','6 · Lealtad: programa, puntos, canjes y referidos (interactiva)',0,8900,1440,900),
('OperSorteo','6 · Sorteo con ganadores, entrega y acta',1520,8900,1440,900),
]
if not any(p['id']=='operacion' for p in c['pages']): c['pages'].append({"id":"operacion","name":"Operación: servicios, facturas, comprobantes y más"})
inter={'OperComprobantes','OperPromesas','OperServicioFicha','OperServicioFichaMovil','OperFacturas','OperFacturaDetalle','OperPlantillasFacturacion','OperConfigEmpresa','OperConfigCobro','OperConfigNotificaciones','OperBitacora','OperLealtad','OperLogin','OperLoginMovil'}
for n,t,x,y,w,h in B:
    k=n+'.dc.html'
    e={"expand":"fill","h":h,"page":"operacion","title":t,"w":w,"x":x,"y":y}
    if n in inter: e["is_interactive"]=True
    c['boards'][k]=e
    if k not in c['order']: c['order'].append(k)
c['notes']['tituloOper']={"kind":"title1","maxW":4480,"page":"operacion","text":"Operación · comprobantes, servicio, facturas, acceso, configuración y control","w":240,"x":0,"y":-300}
if 'noteOrder' in c and 'tituloOper' not in c['noteOrder']: c['noteOrder'].append('tituloOper')
json.dump(c,open(S+'rediseno-artifact/project/canvas.json','w'),ensure_ascii=False,indent=2)
print(len(c['boards']),[p['id'] for p in c['pages']])
print(json.dumps({'project/'+n+'.dc.html':'project/'+n+'.dc.html' for n,*_ in B}))
