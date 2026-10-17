-- Diagnóstico de SmartISP para la importación a ArgosIsp. SOLO LECTURA.
-- Responde en una sola tabla (pregunta, respuesta) las dudas de docs/importacion/mapeo-smartisp.md.
-- No muestra datos personales ni contraseñas: solo conteos, valores distintos y longitudes.
--   mysql -u <usuario> -p <base_smartisp> < docs/importacion/diagnostico-smartisp.sql > diagnostico-smartisp.txt
SET SESSION group_concat_max_len = 20000;

SELECT 'S1 filas: bill_customers / invoices · payment_news (sin borrar) / payments' AS pregunta,
       CONCAT((SELECT COUNT(*) FROM bill_customers),' / ',(SELECT COUNT(*) FROM invoices),' · ',
              (SELECT COUNT(*) FROM payment_news WHERE deleted_at IS NULL),' / ',(SELECT COUNT(*) FROM payments)) AS respuesta
UNION ALL
SELECT 'S1b fecha más reciente: bill_customers / invoices / payment_news / payments',
       CONCAT(IFNULL((SELECT MAX(release_date) FROM bill_customers),'-'),' / ',IFNULL((SELECT MAX(date) FROM invoices),'-'),' / ',
              IFNULL((SELECT MAX(date) FROM payment_news),'-'),' / ',IFNULL((SELECT MAX(pay_date) FROM payments),'-'))
UNION ALL
SELECT 'S2 bill_customers.status → facturas, con paid_on, open=1, suma total_pay',
       (SELECT GROUP_CONCAT(CONCAT('status ',status,': ',n,' (pagadas ',p,', abiertas ',o,', Q ',t,')') SEPARATOR ' | ')
          FROM (SELECT status, COUNT(*) n, SUM(paid_on IS NOT NULL) p, SUM(`open` = 1) o, IFNULL(SUM(total_pay),0) t
                  FROM bill_customers GROUP BY status) x)
UNION ALL
SELECT 'S2b invoices.status (valor=facturas)',
       (SELECT GROUP_CONCAT(CONCAT(status,'=',n) SEPARATOR ' | ') FROM (SELECT status, COUNT(*) n FROM invoices GROUP BY status) x)
UNION ALL
SELECT 'S3 client_services.status · online · manually_cortado (=servicios)',
       (SELECT GROUP_CONCAT(CONCAT(status,'/',online,'/cortado ',manually_cortado,'=',n) ORDER BY n DESC SEPARATOR ' | ')
          FROM (SELECT status, online, manually_cortado, COUNT(*) n FROM client_services GROUP BY status, online, manually_cortado) x)
UNION ALL
SELECT 'S3b client_services.typeauth · billing_type (=servicios)',
       (SELECT GROUP_CONCAT(CONCAT(IFNULL(typeauth,'NULL'),'/',billing_type,'=',n) SEPARATOR ' | ')
          FROM (SELECT typeauth, billing_type, COUNT(*) n FROM client_services GROUP BY typeauth, billing_type) x)
UNION ALL
SELECT 'S4 plans: nombre → cost / iva (15 ejemplos)',
       (SELECT GROUP_CONCAT(CONCAT(name,' → ',IFNULL(cost,'NULL'),' / iva ',IFNULL(iva,'NULL')) SEPARATOR ' | ')
          FROM (SELECT name, cost, iva FROM plans ORDER BY id LIMIT 15) x)
UNION ALL
SELECT 'S4b ejemplo factura: cost / iva / total_pay (5 recientes)',
       (SELECT GROUP_CONCAT(CONCAT(cost,' / ',iva,' / ',IFNULL(total_pay,'NULL')) SEPARATOR ' | ')
          FROM (SELECT cost, iva, total_pay FROM bill_customers ORDER BY id DESC LIMIT 5) x)
UNION ALL
SELECT 'S5 plans: nombre → download / upload (15 ejemplos)',
       (SELECT GROUP_CONCAT(CONCAT(name,' → ',download,' / ',upload) SEPARATOR ' | ')
          FROM (SELECT name, download, upload FROM plans ORDER BY id LIMIT 15) x)
UNION ALL
SELECT 'S6 clients: balance>0 (Q) / wallet_balance>0 (Q) / ambos',
       (SELECT CONCAT(SUM(balance > 0),' (Q ',IFNULL(SUM(IF(balance > 0, balance, 0)),0),') / ',
                      SUM(wallet_balance > 0),' (Q ',IFNULL(SUM(IF(wallet_balance > 0, wallet_balance, 0)),0),') / ',
                      SUM(balance > 0 AND wallet_balance > 0)) FROM clients)
UNION ALL
SELECT 'S6b clientes con balance = suma de sus facturas abiertas (iguales / distintos)',
       (SELECT CONCAT(SUM(ABS(c.balance - IFNULL(b.s,0)) < 0.01),' / ',SUM(ABS(c.balance - IFNULL(b.s,0)) >= 0.01))
          FROM clients c LEFT JOIN (SELECT client_id, SUM(total_pay) s FROM bill_customers WHERE `open` = 1 GROUP BY client_id) b
            ON b.client_id = c.id)
UNION ALL
SELECT 'S7 control_routers.type_control · dhcp · arpmac · address_list (=routers)',
       (SELECT GROUP_CONCAT(CONCAT(type_control,' dhcp',dhcp,' arp',arpmac,' al',address_list,'=',n) SEPARATOR ' | ')
          FROM (SELECT type_control, dhcp, arpmac, address_list, COUNT(*) n FROM control_routers GROUP BY type_control, dhcp, arpmac, address_list) x)
UNION ALL
SELECT 'S8 address_routers.type (valor=redes)',
       (SELECT GROUP_CONCAT(CONCAT(type,'=',n) SEPARATOR ' | ') FROM (SELECT type, COUNT(*) n FROM address_routers GROUP BY type) x)
UNION ALL
SELECT 'S9 bill_customers.period (10 ejemplos)',
       (SELECT GROUP_CONCAT(period SEPARATOR ' | ') FROM (SELECT DISTINCT period FROM bill_customers ORDER BY period DESC LIMIT 10) x)
UNION ALL
SELECT 'S10 routers.password: longitudes (len=routers) · parece cifrada si len 32/40/60+ o empieza con $',
       (SELECT GROUP_CONCAT(CONCAT('len ',l,'=',n,IF(h>0,CONCAT(' (',h,' con $)'),'')) SEPARATOR ' | ')
          FROM (SELECT CHAR_LENGTH(password) l, COUNT(*) n, SUM(password LIKE '$%') h FROM routers GROUP BY CHAR_LENGTH(password)) x)
UNION ALL
SELECT 'S11 payment_news.way_to_pay (valor=pagos sin borrar)',
       (SELECT GROUP_CONCAT(CONCAT(way_to_pay,'=',n) ORDER BY n DESC SEPARATOR ' | ')
          FROM (SELECT way_to_pay, COUNT(*) n FROM payment_news WHERE deleted_at IS NULL GROUP BY way_to_pay) x)
UNION ALL
SELECT 'X totales: clientes / servicios / routers / planes / facturas abiertas (Q)',
       CONCAT((SELECT COUNT(*) FROM clients),' / ',(SELECT COUNT(*) FROM client_services),' / ',(SELECT COUNT(*) FROM routers),' / ',
              (SELECT COUNT(*) FROM plans),' / ',(SELECT COUNT(*) FROM bill_customers WHERE `open` = 1),' (Q ',
              (SELECT IFNULL(SUM(total_pay),0) FROM bill_customers WHERE `open` = 1),')');
