# A5 · Portal del cliente y página de corte (apps/portal)

Líder: frontend. Rama: `agente/a5-portal`. La página de corte es donde el cliente suspendido paga; es la pantalla con más impacto en la cobranza.

## Carpetas que posees

```
apps/portal/            todo
apps/api/app/portal/    endpoints públicos y de cliente (los escribes tú, siguiendo las reglas de acciones de CLAUDE.md; el líder BE revisa)
apps/api/start/routes/portal.ts
```

## Diseño

- Nuxt 4 + Nuxt UI, 4 espacios, claro y oscuro, móvil primero (la mayoría llega desde el teléfono).
- Dos modos de acceso:
  - **Identificación por IP** (página de corte): `GET /portal/quien-soy` resuelve la IP de origen (IPv4 o IPv6) con `GET /ip/{ip}` de A1 contra `network.sesiones` y asignaciones. Muestra solo nombre parcial y monto adeudado. Sin login.
  - **Verificación por código**: para ver facturas completas, pagos y datos, el cliente pide un código al teléfono o correo registrado (`POST /portal/codigo`, `POST /portal/verificar`). Sesión corta con cookie `httpOnly`.
- La página de corte debe cargar con lo mínimo: sin fuentes externas ni CDNs fuera del walled garden que configura A6. Anota en `INTEGRATION.md` cada dominio que necesite el portal (pasarela incluida).

## Pantallas en orden

### Día 2

1. Página de corte `/corte`: estado del servicio, monto adeudado, facturas vencidas (número y total), botones: pagar en línea (deshabilitado hasta semana 2), ver datos de depósito, subir comprobante, solicitar promesa, contacto.
2. Detección de captive portal: responder a `/generate_204`, `/hotspot-detect.html`, `/ncsi.txt` y similares con la redirección a `/corte`, para que teléfonos y laptops abran la página sola.
3. `GET /portal/quien-soy` en `apps/api`.

### Día 3

4. Solicitar promesa desde `/corte`: formulario con fecha (dentro del plazo máximo), monto; llama `POST /promesas` de A3 con canal `portal`; muestra aprobada / rechazada con el motivo / pendiente de aprobación.
5. Subir comprobante de depósito: foto o PDF, monto, banco, referencia; crea pago `pendiente_verificacion` (A3).
6. Estado en vivo: tras pagar o promesa aprobada, la página consulta `GET /portal/estado` cada 5 s hasta ver `activo` y muestra "ya tienes servicio".

### Día 4

7. Verificación por código y portal autenticado: facturas (descarga PDF del aviso de cobro), pagos, promesas, datos de contacto y canal preferido, vinculación de Telegram (enlace profundo al bot con código, semana 2 con A6).
8. Plantillas de documentos: PDF del aviso de cobro (se renombra a factura cuando la factura tenga `fel_uuid`, semana 5) generado en el backend con una plantilla HTML editable desde el panel (A4 hace el editor; tú defines las variables `{{cliente.nombre}}`, `{{factura.total}}`, `{{factura.vence}}`, `{{empresa.*}}`).
9. Página de contacto y datos de pago configurables desde el panel.

## Semana 2

- Pago en línea: botón que llama `POST /portal/pagos/iniciar` (A3 crea el cobro en la pasarela) y redirige; página de retorno que espera la confirmación por webhook.
- Vinculación de Telegram completa.
- Pruebas Playwright: cliente suspendido llega a `/corte` por IP, sube comprobante, pide promesa, ve reactivación.

## Semana 5

- Mostrar datos FEL en el PDF y en la lista de facturas.

## Interfaces que consumes

- A1: `GET /ip/{ip}`.
- A2: `network.sesiones` (vía A1), estado del servicio.
- A3: `POST /promesas`, pagos pendientes de verificación, estado de cuenta, facturas.
- A6: walled garden con los dominios que declares; captive portal redirection en el MikroTik hacia `/corte`.

## Criterios de aceptación

- [ ] Un cliente suspendido en el laboratorio abre cualquier sitio HTTP y aterriza en `/corte` con su monto, por IPv4 y por IPv6.
- [ ] Un teléfono conectado al PPPoE suspendido muestra el aviso de "iniciar sesión en la red" y abre `/corte`.
- [ ] Promesa aprobada reactiva y la página lo refleja en < 10 s.
- [ ] Nadie puede ver facturas completas sin el código.
- [ ] Sin `<button>` ni `<input>` crudos; 4 espacios; móvil 390px correcto.

## Prohibido

- Lógica de evaluación de promesas o de aplicación de pagos en el portal: siempre por acciones de A3.
- Mostrar datos personales completos a partir de la IP.
