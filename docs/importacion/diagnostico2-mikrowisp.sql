-- Diagnóstico 2 de Mikrowisp 6 (SOLO LECTURA). Resuelve lo que dejó abierto el primero.
--   mysql -u <usuario> -p <base_mikrowisp> < diagnostico2-mikrowisp.sql > diagnostico2-mikrowisp.txt
SET SESSION group_concat_max_len = 20000;

SELECT 'N1 por router: seguridad/seguridad2 → servicios con pppuser / sin pppuser' AS pregunta,
       (SELECT GROUP_CONCAT(CONCAT('router ',id,' seg=',seguridad,' seg2=',seguridad2,' → ',c,' / ',s) SEPARATOR ' | ')
          FROM (SELECT sv.id, sv.seguridad, sv.seguridad2,
                       SUM(t.pppuser IS NOT NULL AND t.pppuser <> '') c,
                       SUM(t.id IS NOT NULL AND (t.pppuser IS NULL OR t.pppuser = '')) s
                  FROM server sv LEFT JOIN tblservicios t ON t.nodo = sv.id GROUP BY sv.id, sv.seguridad, sv.seguridad2) x) AS respuesta
UNION ALL
SELECT 'N1b servicios sin pppuser: con ip / con mac (de los sin pppuser)',
       (SELECT CONCAT(SUM(ip IS NOT NULL AND ip <> ''),' / ',SUM(mac IS NOT NULL AND mac <> '' AND mac NOT LIKE '00:00:00%'))
          FROM tblservicios WHERE pppuser IS NULL OR pppuser = '')
UNION ALL
SELECT 'N2 facturas.tipo → facturas, estados, Q total, emitido min..max',
       (SELECT GROUP_CONCAT(CONCAT('tipo ',tipo,': ',n,' (',e,') Q ',t,' · ',d1,'..',d2) SEPARATOR ' | ')
          FROM (SELECT tipo, COUNT(*) n, IFNULL(SUM(total),0) t, MIN(emitido) d1, MAX(emitido) d2,
                       CONCAT('pagado ',SUM(LOWER(estado)='pagado'),', no pagado ',SUM(LOWER(estado)='no pagado'),', anulado ',SUM(LOWER(estado)='anulado')) e
                  FROM facturas GROUP BY tipo) x)
UNION ALL
SELECT 'N2b facturas tipo 1: descripción del ítem (10 recientes)',
       (SELECT GROUP_CONCAT(CONCAT(emitido,' → ',CONVERT(IFNULL(d,'(sin ítems)') USING utf8mb4)) SEPARATOR ' | ')
          FROM (SELECT f.emitido, (SELECT descripcion FROM facturaitems i WHERE i.idfactura = f.id LIMIT 1) d
                  FROM facturas f WHERE f.tipo = 1 ORDER BY f.id DESC LIMIT 10) x)
UNION ALL
SELECT 'N3 mes de vencimiento respecto a emitido (tipo 2): mismo / siguiente / anterior / +2 o más',
       (SELECT CONCAT(SUM(m = 0),' / ',SUM(m = 1),' / ',SUM(m < 0),' / ',SUM(m >= 2))
          FROM (SELECT PERIOD_DIFF(DATE_FORMAT(vencimiento,'%Y%m'), DATE_FORMAT(emitido,'%Y%m')) m
                  FROM facturas WHERE tipo = 2 AND vencimiento IS NOT NULL AND emitido IS NOT NULL) x)
UNION ALL
SELECT 'N3b día del mes de vencimiento (tipo 2, top 5: día=facturas)',
       (SELECT GROUP_CONCAT(CONCAT(d,'=',n) ORDER BY n DESC SEPARATOR ' | ')
          FROM (SELECT DAY(vencimiento) d, COUNT(*) n FROM facturas WHERE tipo = 2 GROUP BY DAY(vencimiento) ORDER BY n DESC LIMIT 5) x)
UNION ALL
SELECT 'N3c ¿una factura por cliente y mes de vencimiento? (repetidos: cliente+mes con 2 o más facturas tipo 2)',
       (SELECT CONCAT(COUNT(*),' grupos repetidos') FROM
          (SELECT idcliente, DATE_FORMAT(vencimiento,'%Y%m') m FROM facturas WHERE tipo = 2 AND LOWER(estado) <> 'anulado'
            GROUP BY idcliente, DATE_FORMAT(vencimiento,'%Y%m') HAVING COUNT(*) > 1) x)
UNION ALL
SELECT 'N4 RETIRADO con deuda: clientes / facturas No pagado / Q / vencimiento más reciente / con deuda de hace 12+ meses',
       (SELECT CONCAT(COUNT(DISTINCT u.id),' / ',COUNT(f.id),' / Q ',IFNULL(SUM(f.total - IFNULL(f.cobrado,0)),0),' / ',
                      IFNULL(MAX(f.vencimiento),'-'),' / ',COUNT(DISTINCT IF(f.vencimiento < CURDATE() - INTERVAL 12 MONTH, u.id, NULL)))
          FROM usuarios u JOIN facturas f ON f.idcliente = u.id AND LOWER(f.estado) = 'no pagado'
         WHERE u.estado = 'RETIRADO')
UNION ALL
SELECT 'N5 routers con fila en nas / con ip_radius lleno / total',
       (SELECT CONCAT(SUM(EXISTS(SELECT 1 FROM nas n WHERE n.idserver = sv.id)),' / ',
                      SUM(ip_radius IS NOT NULL AND ip_radius <> ''),' / ',COUNT(*)) FROM server sv)
UNION ALL
SELECT 'N6 usuarios.correo con varios correos (coma o punto y coma) / con correo',
       (SELECT CONCAT(SUM(correo LIKE '%,%' OR correo LIKE '%;%'),' / ',SUM(correo IS NOT NULL AND correo <> '')) FROM usuarios)
UNION ALL
SELECT 'N7 saldos: estado · monto>0 / monto<0 (filas) · con idorigen / iddestino',
       (SELECT GROUP_CONCAT(CONCAT(estado,' · ',p,' / ',ng,' · ',o,' / ',d) SEPARATOR ' | ')
          FROM (SELECT estado, SUM(monto > 0) p, SUM(monto < 0) ng, SUM(idorigen IS NOT NULL AND idorigen <> 0) o,
                       SUM(iddestino IS NOT NULL AND iddestino <> 0) d FROM saldos GROUP BY estado) x)
UNION ALL
SELECT 'N8 promesas vigentes: con factura No pagado / con factura pagada / sin factura',
       (SELECT CONCAT(SUM(LOWER(f.estado) = 'no pagado'),' / ',SUM(LOWER(f.estado) = 'pagado'),' / ',SUM(f.id IS NULL))
          FROM credito c LEFT JOIN facturas f ON f.id = c.idfactura WHERE c.fecha_limite >= CURDATE());
