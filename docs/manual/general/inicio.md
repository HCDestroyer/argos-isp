---
orden: 1
pantallas:
    - /
---

# Inicio

La primera pantalla al entrar al panel. Te saluda, te muestra el tablero con los números del negocio (si tienes permiso) y te da accesos a las secciones que puedes abrir.

![Inicio del panel con servicios por estado, indicadores del mes y las gráficas de 12 meses](/capturas/general/inicio.png)

## Quién la usa

- Todos los usuarios del panel entran aquí. **El cajero no:** si tu único rol es `cajero` (sin `admin`), al entrar o al tocar **Inicio** el panel te lleva directo a tu **Caja**.
- El tablero (servicios, montos y gráficas) solo aparece con el permiso `reportes.ver`. Lo traen los roles `admin` y `contabilidad`; `lectura` también, porque incluye todos los permisos de ver. Sin ese permiso ves solo el saludo y los accesos.

## Qué ves

### Saludo y fecha

«Hola, _tu nombre_», la fecha de hoy y, con el tablero, «Datos al _fecha y hora_»: el momento hasta el que están al día los números. El tablero no se calcula en vivo: se actualiza solo cada vez que se emite o anula una factura, se registra o anula un pago, cambia una promesa o cambia el estado de un servicio. Si acabas de hacer algo y no lo ves, espera unos segundos y toca el botón de actualizar (el icono de flechas en la barra de arriba).

### Servicios por estado

Cuántos servicios hay **Activos** (verde), **Limitados** (ámbar), **Cortados** (rojo; en el resto del panel se llaman «Suspendidos») y **Retirados** (gris). Arriba a la derecha, los clientes al día, limitados y cortados. Cada número abre la lista de **Servicios** filtrada por ese estado, si tienes permiso para verla.

### Indicadores

| Tarjeta               | Qué dice                                                                                  | Al tocarla                         |
| --------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------- |
| **Facturado del mes** | Lo facturado en el mes, lo cobrado, el porcentaje de cobranza con su barra y lo pendiente | Abre **Facturas**                  |
| **Cartera vencida**   | El monto vencido, cuántas facturas y clientes, y el total por cobrar                      | Abre **Facturas** con las vencidas |
| **Cobros de hoy**     | Lo cobrado hoy y cuántos pagos                                                            | Abre **Pagos** de hoy              |
| **Promesas activas**  | Cuántas promesas de pago están vigentes y cuánto suman                                    | Abre **Promesas** activas          |

Lo pendiente del mes nunca sale negativo: si un cliente pagó por adelantado, eso no es deuda.

### Gráficas de 12 meses

- **Facturado y cobrado · últimos 12 meses**: dos columnas por mes, con una frase arriba que resume lo más importante (por ejemplo, cuánto de lo facturado este mes ya se cobró).
- **Facturas emitidas y pagos registrados**: cuántos documentos hubo cada mes.

Si no hubo movimientos en esos 12 meses, en lugar de la gráfica dice «Sin facturación ni cobros en los últimos 12 meses».

### Accesos

Una tarjeta por cada sección del menú que puedes abrir, con su descripción. Si una sección no aparece, es que tu usuario no tiene su permiso (ver [Conoce el panel](../../guia/conoce-el-panel.md)).

### Empresa activa

Si trabajas con varias empresas, los números son de la empresa elegida en el selector de la barra de arriba. Con «Todas las empresas» ves el consolidado.

## Acciones

### Actualizar el tablero

- **Permiso:** `reportes.ver`
- **Dónde:** el botón con icono de flechas en la barra de arriba.
- **Qué pasa:** vuelve a leer los números. No cambia nada.

## Preguntas frecuentes y errores

- **«No veo el tablero, solo los accesos».** Tu usuario no tiene `reportes.ver`. Pídelo a un administrador si lo necesitas.
- **Aparece un aviso de error con «Reintentar».** No se pudieron leer los números. El panel no muestra cifras viejas ni en cero junto al error: toca «Reintentar» y, si sigue, avisa a soporte técnico.
- **Un pago que acabo de registrar no se ve en «Cobros de hoy».** El tablero se actualiza unos segundos después del pago. Toca actualizar.

## Relacionado

- [Conoce el panel](../../guia/conoce-el-panel.md)
- [Bitácora](./bitacora.md)
