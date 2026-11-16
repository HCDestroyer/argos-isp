---
orden: 4
pantallas:
    - /promesas
---

# Promesas de pago

Una promesa de pago es el compromiso del cliente de pagar lo vencido antes de una fecha. Mientras la promesa está activa, **el servicio no se corta** (y si ya estaba cortado, se reactiva). Aquí ves todas las promesas, apruebas las pendientes y simulas qué decidirían las reglas.

## Quién la usa

- **Ver y simular:** `promesas.ver` (`admin`, `cajero`, `soporte`, `contabilidad`, `lectura`).
- **Crear:** `promesas.crear` (`admin`, `cajero`, `soporte`). Las promesas se crean desde la **ficha del servicio** con el botón «Promesa de pago», o desde el simulador con «Crear con estos datos».
- **Aprobar:** `promesas.aprobar`. **Rechazar:** `promesas.rechazar`. **Cancelar:** `promesas.cancelar`. Los tres los traen `admin` y `contabilidad`.

Se llega desde **Cobros → Promesas**.

## Cómo se decide una promesa

Al crear una promesa, el sistema revisa las reglas de la plantilla del servicio, en orden, y se detiene en la primera que no se cumple. Las reglas están explicadas en [Plantillas](../facturacion/plantillas.md#promesas-de-pago). El resultado es uno de estos:

- **Aprobada:** queda «Activa» y el servicio se reactiva al momento (salvo que alguien lo haya suspendido a mano: eso se respeta).
- **Rechazada:** el sistema guarda la promesa como «Rechazada» con **la regla exacta que falló** y por qué (por ejemplo, «Plazo máximo»).
- **Pendiente de aprobación:** el canal pide aprobación. Queda esperando a alguien con `promesas.aprobar`.

Nadie escribe el monto: **la promesa cubre todo lo vencido** del servicio en ese momento (facturas, recargos y cargos). Si la plantilla pide abono inicial, el cliente debe pagarlo antes de prometer; la promesa cubre lo que queda vencido después del abono.

### Canales

Cada promesa tiene un canal, y la plantilla puede dar límites distintos a cada uno:

| Canal                  | Quién la crea                                                        |
| ---------------------- | -------------------------------------------------------------------- |
| **Operador**           | Una persona desde el panel (cajero, soporte).                        |
| **Supervisor**         | Una persona con `promesas.aprobar`. Suele tener límites más amplios. |
| **Portal del cliente** | El cliente desde el portal.                                          |
| **Agente de IA**       | El asistente de IA (por ejemplo, en una conversación de Iris).       |

El asistente de IA pasa por **las mismas reglas** que cualquiera; no tiene atajos. Si la plantilla tiene marcada «Mismas reglas para IA y operador», usa exactamente los límites del operador.

### Cuándo termina

- **Cumplida:** cuando todas las facturas que cubre quedan pagadas. Un pago parcial no la cumple. Al cumplirse, el servicio se vuelve a evaluar: si venció otra factura después de crear la promesa, puede volver a limitarse o cortarse.
- **Incumplida:** llegó la fecha sin pagar todo. El servicio se vuelve a evaluar y se corta a la hora de corte. Además, la plantilla puede bloquear promesas nuevas por unos días.
- **Cancelada:** la canceló un supervisor, o una pendiente de aprobación venció sin que nadie la aprobara.

### Reconexión temporal

Es un tipo especial de promesa («Reconexión temporal»). La pide Iris cuando un cliente cortado mandó su comprobante y caja no lo puede revisar pronto. Dura unas horas (las que diga la plantilla), cubre todo lo vencido y tiene su propio cupo. Si caja aprueba el comprobante y salda lo vencido, se cumple; si lo rechaza, se cancela y el servicio vuelve a cortarse; si vence sin revisar, se cancela sin contar como incumplida.

## Qué ves

- **Accesos rápidos:** «Todas», «Pendientes de aprobación» y «Activas».
- **Filtros:** cliente, estado y tipo («Promesa» o «Reconexión temporal»). Si llegaste desde un servicio, verás «Servicio …» como filtro. «Limpiar filtros» los quita.

| Columna                 | Qué muestra                                                                            |
| ----------------------- | -------------------------------------------------------------------------------------- |
| **Promesa**             | Número, servicio, vencimiento y de dónde viene (canal, si la pidió Iris, comprobante). |
| **Cliente**             | El cliente.                                                                            |
| **Monto**               | Lo vencido que cubre.                                                                  |
| **Estado y evaluación** | El estado y la regla que decidió, con lo medido y el límite.                           |
| Acciones                | «Aprobar», «Rechazar» y «Cancelar promesa», según el estado y tus permisos.            |

Estados: «Activa» (azul), «Pendiente de aprobación» (amarillo), «Cumplida» (verde), «Incumplida» (rojo), «Rechazada» y «Cancelada» (gris).

## Acciones

### Simular una promesa

- **Permiso:** `promesas.ver`.
- **Dónde:** botón «Simular» (también «Simular promesa» en la ficha del servicio).
- **Qué pide:** el cliente y el servicio, **Pagará a más tardar** (vacío = mañana) y el **canal**.
- **Qué pasa:** no crea nada. Muestra qué decidiría el sistema, regla por regla («Decide: …»), la deuda, las promesas del periodo, el cumplimiento reciente, qué facturas cubriría y el último día posible. Si se rechazaría, cambia la fecha o el canal y «Volver a simular». Con `promesas.crear`, «Crear con estos datos» la crea con esa fecha y canal.
- Desde el panel solo se crean promesas con canal Operador o Supervisor; las del portal y la IA las crea el cliente o el agente.

### Crear una promesa (desde la ficha del servicio)

- **Permiso:** `promesas.crear`.
- **Qué pide:** **Pagará a más tardar** (hasta el final de ese día, hora de Guatemala; el panel dice el último día posible) y el **canal** (Supervisor solo si tienes `promesas.aprobar`). Antes de crear, el panel muestra lo que cubrirá: las facturas vencidas, el total, el abono requerido y lo ya abonado.
- **Qué pasa:** el sistema evalúa y muestra el resultado. Si la rechazó, puedes «Probar otra fecha».

### Aprobar

- **Permiso:** `promesas.aprobar`. Solo en «Pendiente de aprobación».
- **Qué pide:** una nota opcional (hasta 500 caracteres).
- **Qué pasa:** la promesa queda activa y el servicio se reactiva.

### Rechazar

- **Permiso:** `promesas.rechazar`. Solo en «Pendiente de aprobación».
- **Qué pide:** el motivo. La promesa no se activa y el servicio sigue como está.

### Cancelar

- **Permiso:** `promesas.cancelar`. En promesas activas o pendientes.
- **Qué pide:** el motivo.
- **Qué pasa:** la promesa deja de proteger el servicio: se vuelve a evaluar y **puede cortarse** si tiene avisos vencidos.

::: danger Rechazar y cancelar no se deshacen
Si hace falta, crea una promesa nueva (si las reglas lo permiten).
:::

## Preguntas frecuentes y errores

**¿Por qué rechazó la promesa?** La columna «Estado y evaluación» dice la regla exacta y el valor que no cumplió.

**El cliente pagó y la promesa sigue activa.** Solo se cumple cuando todas las facturas que cubre quedan pagadas.

| Mensaje                                                                | Qué hacer                                                   |
| ---------------------------------------------------------------------- | ----------------------------------------------------------- |
| «El servicio … ya tiene la promesa … activa / pendiente de aprobación» | Solo puede haber una abierta por servicio. Revisa esa.      |
| «La promesa debe vencer en el futuro»                                  | Elige una fecha posterior a hoy.                            |
| «Tiene deuda» como regla que decide                                    | No hay nada vencido: no hace falta promesa.                 |
| «Falta abonar Q …»                                                     | El cliente debe pagar el abono inicial antes.               |
| «Suspendido a mano»                                                    | La promesa quedaría activa pero no reactivaría el servicio. |

## Relacionado

- [Plantillas de facturación](../facturacion/plantillas.md#promesas-de-pago)
- [El ciclo de cobro](../../guia/ciclo-de-cobro.md#promesas-de-pago)
