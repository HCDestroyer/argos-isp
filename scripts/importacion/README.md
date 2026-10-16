# scripts/importacion

`ejemplo/`: export de Mikrowisp de prueba en el formato que acepta el importador (un CSV por entidad), con un caso de cada diferencia que reporta: IP duplicada, IP fuera de red, plan sin equivalente, cliente sin NIT, NIT inválido, `user_ppp` repetido, servicio suspendido y retirado, referencia rota y filas mal formadas. Desde la semana 2 también servicios sin PPPoE (`ip_estatica`, `dhcp_fija` con y sin IP, con amarre IP-MAC, y dos filas inválidas: IP estática sin IP y DHCP fija sin MAC), `facturas.csv` (con servicio, sin servicio, abono parcial, pagada, de un cliente inexistente y con monto inválido) y `saldos.csv` (debe, a favor y de un cliente que no se importa), para que el reporte en seco muestre la suma de saldos contra el origen y sus diferencias.

`mikrowisp-sintetico.sql`: volcado MySQL sintético con el esquema supuesto de Mikrowisp (ver `apps/api/app/importacion/mikrowisp_sql.ts`) y los casos difíciles del dump real: clientes duplicados por NIT, servicio sin plan, router sin credenciales, facturas abonadas, saldos a favor, pago de un cliente a la factura de otro, IPs repetidas, MAC en cuatro formatos e IP estática sin PPPoE. Su suma de saldos es Q 1830.00 y el importador la cuadra.

```sh
pnpm importar --dry-run scripts/importacion/ejemplo
pnpm importar --dry-run scripts/importacion/mikrowisp-sintetico.sql --salida=/tmp/reporte
```

Formato y reglas en `apps/api/app/importacion/README.md`.
