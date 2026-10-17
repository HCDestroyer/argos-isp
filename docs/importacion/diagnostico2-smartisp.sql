-- Diagnóstico 2 de SmartISP (SOLO LECTURA). Resuelve lo que dejó abierto el primero.
--   mysql -u <usuario> -p <base_smartisp> < diagnostico2-smartisp.sql > diagnostico2-smartisp.txt
SET SESSION group_concat_max_len = 20000;

SELECT 'T1 status → facturas · sin paid_on · con pago (payment_news por num_bill) · Q total_pay / actual_total_pay / pagado' AS pregunta,
       (SELECT GROUP_CONCAT(CONCAT('status ',status,': ',n,' · sin paid_on ',sp,' · con pago ',cp,' · Q ',t,' / ',a,' / ',pg) SEPARATOR ' | ')
          FROM (SELECT b.status, COUNT(*) n, SUM(b.paid_on IS NULL) sp, SUM(p.s IS NOT NULL) cp,
                       IFNULL(SUM(b.total_pay),0) t, IFNULL(SUM(b.actual_total_pay),0) a, IFNULL(SUM(p.s),0) pg
                  FROM bill_customers b
                  LEFT JOIN (SELECT num_bill, SUM(amount) s FROM payment_news WHERE deleted_at IS NULL GROUP BY num_bill) p
                    ON p.num_bill = b.num_bill
                 GROUP BY b.status) x) AS respuesta
UNION ALL
SELECT 'T1b status → con payment_id / vencidas (expiration_date < hoy) / con cortado_date',
       (SELECT GROUP_CONCAT(CONCAT('status ',status,': ',pi,' / ',v,' / ',c) SEPARATOR ' | ')
          FROM (SELECT status, SUM(payment_id IS NOT NULL AND payment_id <> 0) pi, SUM(expiration_date < CURDATE()) v,
                       SUM(cortado_date IS NOT NULL) c FROM bill_customers GROUP BY status) x)
UNION ALL
SELECT 'T2 status 2: cost / iva / total_pay / actual_total_pay / billing_type (5 recientes)',
       (SELECT GROUP_CONCAT(CONCAT(cost,' / ',iva,' / ',IFNULL(total_pay,'NULL'),' / ',IFNULL(actual_total_pay,'NULL'),' / ',IFNULL(billing_type,'NULL')) SEPARATOR ' | ')
          FROM (SELECT cost, iva, total_pay, actual_total_pay, billing_type FROM bill_customers WHERE status = 2 ORDER BY id DESC LIMIT 5) x)
UNION ALL
SELECT 'T3 open=1 por status: periodo de facturación vigente (expiration_date >= hoy) / ya vencido',
       (SELECT GROUP_CONCAT(CONCAT('status ',status,': ',v,' / ',p) SEPARATOR ' | ')
          FROM (SELECT status, SUM(expiration_date >= CURDATE()) v, SUM(expiration_date < CURDATE()) p
                  FROM bill_customers WHERE `open` = 1 GROUP BY status) x)
UNION ALL
SELECT 'T4 clients.balance = candidato (iguales / distintos, todos los clientes)',
       (SELECT CONCAT('status 3 total_pay: ',SUM(ABS(c.balance - IFNULL(a.s,0)) < 0.01),' / ',SUM(ABS(c.balance - IFNULL(a.s,0)) >= 0.01),
                      ' · sin paid_on: ',SUM(ABS(c.balance - IFNULL(b.s,0)) < 0.01),' / ',SUM(ABS(c.balance - IFNULL(b.s,0)) >= 0.01),
                      ' · status 3 menos pagos: ',SUM(ABS(c.balance - IFNULL(d.s,0)) < 0.01),' / ',SUM(ABS(c.balance - IFNULL(d.s,0)) >= 0.01))
          FROM clients c
          LEFT JOIN (SELECT client_id, SUM(total_pay) s FROM bill_customers WHERE status = 3 GROUP BY client_id) a ON a.client_id = c.id
          LEFT JOIN (SELECT client_id, SUM(total_pay) s FROM bill_customers WHERE paid_on IS NULL GROUP BY client_id) b ON b.client_id = c.id
          LEFT JOIN (SELECT b.client_id, SUM(b.total_pay - IFNULL(p.s,0)) s FROM bill_customers b
                       LEFT JOIN (SELECT num_bill, SUM(amount) s FROM payment_news WHERE deleted_at IS NULL GROUP BY num_bill) p ON p.num_bill = b.num_bill
                      WHERE b.status = 3 GROUP BY b.client_id) d ON d.client_id = c.id)
UNION ALL
SELECT 'T5 facturas status 3: de clientes con servicio ac / solo de / sin servicios (facturas, Q)',
       (SELECT CONCAT(SUM(k = 'ac'),' (Q ',IFNULL(SUM(IF(k = 'ac', total_pay, 0)),0),') / ',
                      SUM(k = 'de'),' (Q ',IFNULL(SUM(IF(k = 'de', total_pay, 0)),0),') / ',
                      SUM(k = 'no'),' (Q ',IFNULL(SUM(IF(k = 'no', total_pay, 0)),0),')')
          FROM (SELECT b.total_pay,
                       CASE WHEN EXISTS(SELECT 1 FROM client_services s WHERE s.client_id = b.client_id AND s.status = 'ac') THEN 'ac'
                            WHEN EXISTS(SELECT 1 FROM client_services s WHERE s.client_id = b.client_id) THEN 'de' ELSE 'no' END k
                  FROM bill_customers b WHERE b.status = 3) x)
UNION ALL
SELECT 'T6 payment_news sin borrar: con num_bill que existe / con num_bill que no existe / sin num_bill',
       (SELECT CONCAT(SUM(b.id IS NOT NULL),' / ',SUM(p.num_bill IS NOT NULL AND p.num_bill <> '' AND b.id IS NULL),' / ',SUM(p.num_bill IS NULL OR p.num_bill = ''))
          FROM payment_news p LEFT JOIN (SELECT MIN(id) id, num_bill FROM bill_customers GROUP BY num_bill) b ON b.num_bill = p.num_bill
         WHERE p.deleted_at IS NULL);
