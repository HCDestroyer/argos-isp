-- Diagnóstico de Mikrowisp 6 para la importación a ArgosIsp. SOLO LECTURA.
-- Responde en una sola tabla (pregunta, respuesta) las dudas de docs/importacion/mapeo-mikrowisp.md.
-- No muestra datos personales ni contraseñas: solo conteos, valores distintos y longitudes.
--   mysql -u <usuario> -p <base_mikrowisp> < docs/importacion/diagnostico-mikrowisp.sql > diagnostico-mikrowisp.txt
SET SESSION group_concat_max_len = 20000;
-- Las tablas mezclan utf8mb3 y utf8mb4: cada texto se convierte (CONVERT … USING utf8mb4) antes de concatenar.

SELECT 'M1 usuarios.estado (valor=clientes)' AS pregunta,
       (SELECT GROUP_CONCAT(CONCAT(CONVERT(IFNULL(estado,'NULL') USING utf8mb4),'=',n) ORDER BY n DESC SEPARATOR ' | ')
          FROM (SELECT estado, COUNT(*) n FROM usuarios GROUP BY estado) t) AS respuesta
UNION ALL
SELECT 'M2 server.seguridad / seguridad2 / velocidad (valor=routers)',
       (SELECT GROUP_CONCAT(CONCAT('seg=',seguridad,' seg2=',seguridad2,' vel=',CONVERT(velocidad USING utf8mb4),' → ',n) ORDER BY n DESC SEPARATOR ' | ')
          FROM (SELECT seguridad, seguridad2, velocidad, COUNT(*) n FROM server GROUP BY seguridad, seguridad2, velocidad) t)
UNION ALL
SELECT 'M3 perfiles.velocidad (ejemplos, plan → velocidad)',
       (SELECT GROUP_CONCAT(CONCAT(CONVERT(plan USING utf8mb4),' → ',CONVERT(velocidad USING utf8mb4)) SEPARATOR ' | ')
          FROM (SELECT plan, velocidad FROM perfiles ORDER BY id LIMIT 15) t)
UNION ALL
SELECT 'M4a perfiles.impuesto (valor=planes)',
       (SELECT GROUP_CONCAT(CONCAT(CONVERT(impuesto USING utf8mb4),'=',n) SEPARATOR ' | ')
          FROM (SELECT impuesto, COUNT(*) n FROM perfiles GROUP BY impuesto) t)
UNION ALL
SELECT 'M4b facturas: impuesto(SI/NO)=n · total vs sub_total+iva',
       (SELECT GROUP_CONCAT(CONCAT(CONVERT(impuesto USING utf8mb4),'=',n,' (total=sub+iva en ',ok,')') SEPARATOR ' | ')
          FROM (SELECT impuesto, COUNT(*) n, SUM(ABS(total-(sub_total+iva_igv))<0.01) ok FROM facturas GROUP BY impuesto) t)
UNION ALL
SELECT 'M4c ejemplo: plan costo vs factura (sub_total, iva, total) de 5 servicios',
       (SELECT GROUP_CONCAT(CONCAT(p.costo,' → sub ',f.sub_total,' iva ',f.iva_igv,' total ',f.total) SEPARATOR ' | ')
          FROM (SELECT s.idcliente, s.idperfil FROM tblservicios s ORDER BY s.id LIMIT 5) s
          JOIN perfiles p ON p.id = s.idperfil
          JOIN facturas f ON f.id = (SELECT MAX(f2.id) FROM facturas f2 WHERE f2.idcliente = s.idcliente))
UNION ALL
SELECT 'M5 perfiles limit_down/limit_up distintos',
       (SELECT GROUP_CONCAT(CONCAT(CONVERT(limit_down USING utf8mb4),'/',CONVERT(limit_up USING utf8mb4),'=',n) ORDER BY n DESC SEPARATOR ' | ')
          FROM (SELECT limit_down, limit_up, COUNT(*) n FROM perfiles GROUP BY limit_down, limit_up) t)
UNION ALL
SELECT 'M6 prepago: emitido → descripción del ítem (10 recientes)',
       (SELECT GROUP_CONCAT(CONCAT(f.emitido,' vence ',f.vencimiento,' → ',CONVERT(LEFT(i.descripcion,70) USING utf8mb4)) SEPARATOR ' | ')
          FROM (SELECT id, emitido, vencimiento FROM facturas ORDER BY id DESC LIMIT 10) f
          JOIN facturaitems i ON i.idfactura = f.id AND i.id = (SELECT MIN(i2.id) FROM facturaitems i2 WHERE i2.idfactura = f.id))
UNION ALL
SELECT 'M7 facturas.estado (valor=facturas)',
       (SELECT GROUP_CONCAT(CONCAT(CONVERT(estado USING utf8mb4),'=',n) ORDER BY n DESC SEPARATOR ' | ')
          FROM (SELECT estado, COUNT(*) n FROM facturas GROUP BY estado) t)
UNION ALL
SELECT 'M7b facturas.tipo (valor=facturas)',
       (SELECT GROUP_CONCAT(CONCAT(tipo,'=',n) SEPARATOR ' | ') FROM (SELECT tipo, COUNT(*) n FROM facturas GROUP BY tipo) t)
UNION ALL
SELECT 'M8 monedas usadas en facturas (moneda=facturas)',
       (SELECT GROUP_CONCAT(CONCAT(CONVERT(IFNULL(m.codigo,f.moneda) USING utf8mb4),'=',f.n) SEPARATOR ' | ')
          FROM (SELECT moneda, COUNT(*) n FROM facturas GROUP BY moneda) f LEFT JOIN monedas m ON m.id = f.moneda)
UNION ALL
SELECT 'M8b monedas usadas en saldos (moneda=saldos)',
       (SELECT GROUP_CONCAT(CONCAT(moneda,'=',n) SEPARATOR ' | ') FROM (SELECT moneda, COUNT(*) n FROM saldos GROUP BY moneda) t)
UNION ALL
SELECT 'M9 credito (promesas): estado → total / vigentes (fecha_limite >= hoy)',
       (SELECT GROUP_CONCAT(CONCAT('estado ',estado,': ',n,' / vigentes ',v) SEPARATOR ' | ')
          FROM (SELECT estado, COUNT(*) n, SUM(fecha_limite >= CURDATE()) v FROM credito GROUP BY estado) t)
UNION ALL
SELECT 'M10 server.pass: longitudes (len=routers) · parece cifrada si len 32/40/60+ o empieza con $',
       (SELECT GROUP_CONCAT(CONCAT('len ',l,'=',n,IF(h>0,CONCAT(' (',h,' con $)'),'')) SEPARATOR ' | ')
          FROM (SELECT CHAR_LENGTH(pass) l, COUNT(*) n, SUM(pass LIKE '$%') h FROM server GROUP BY CHAR_LENGTH(pass)) t)
UNION ALL
SELECT 'M11 RETIRADO: clientes / con servicios / con facturas No pagado',
       (SELECT CONCAT(COUNT(*),' / ',
                      SUM(EXISTS(SELECT 1 FROM tblservicios s WHERE s.idcliente = u.id)),' / ',
                      SUM(EXISTS(SELECT 1 FROM facturas f WHERE f.idcliente = u.id AND f.estado = 'No pagado')))
          FROM usuarios u WHERE u.estado = 'RETIRADO')
UNION ALL
SELECT 'X1 tblservicios.tiposervicio (valor=servicios)',
       (SELECT GROUP_CONCAT(CONCAT(CONVERT(tiposervicio USING utf8mb4),'=',n) SEPARATOR ' | ') FROM (SELECT tiposervicio, COUNT(*) n FROM tblservicios GROUP BY tiposervicio) t)
UNION ALL
SELECT 'X2 tblservicios.tipoipv4 · con pppuser (tipo=servicios)',
       (SELECT GROUP_CONCAT(CONCAT('tipo ',tipoipv4,'=',n,' (con pppuser ',p,')') SEPARATOR ' | ')
          FROM (SELECT tipoipv4, COUNT(*) n, SUM(pppuser <> '') p FROM tblservicios GROUP BY tipoipv4) t)
UNION ALL
SELECT 'X3 saldos.estado (valor=filas, suma)',
       (SELECT GROUP_CONCAT(CONCAT(CONVERT(estado USING utf8mb4),'=',n,' (Q ',s,')') SEPARATOR ' | ') FROM (SELECT estado, COUNT(*) n, SUM(monto) s FROM saldos GROUP BY estado) t)
UNION ALL
SELECT 'X4 facturas.cobrado vs suma de operaciones (iguales / distintas)',
       (SELECT CONCAT(SUM(ABS(f.cobrado - IFNULL(o.s,0)) < 0.01),' / ',SUM(ABS(f.cobrado - IFNULL(o.s,0)) >= 0.01))
          FROM facturas f LEFT JOIN (SELECT nfactura, SUM(cobrado) s FROM operaciones GROUP BY nfactura) o ON o.nfactura = f.id)
UNION ALL
SELECT 'X5 facturas.saldo distinto de 0 (facturas, suma)',
       (SELECT CONCAT(COUNT(*),' (Q ',IFNULL(SUM(saldo),0),')') FROM facturas WHERE saldo <> 0)
UNION ALL
SELECT 'X6 totales: clientes / servicios / routers / planes / facturas No pagado (Q)',
       (SELECT CONCAT((SELECT COUNT(*) FROM usuarios),' / ',(SELECT COUNT(*) FROM tblservicios),' / ',
                      (SELECT COUNT(*) FROM server),' / ',(SELECT COUNT(*) FROM perfiles),' / ',
                      (SELECT COUNT(*) FROM facturas WHERE estado = 'No pagado'),' (Q ',
                      (SELECT IFNULL(SUM(total - cobrado),0) FROM facturas WHERE estado = 'No pagado'),')'));
