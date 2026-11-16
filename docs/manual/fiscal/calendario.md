---
orden: 5
pantallas:
    - /fiscal/calendario
---

# Calendario fiscal

Los vencimientos de las declaraciones de cada empresa según su régimen y sus banderas: IVA, pequeño contribuyente, ISR, ISO y retenciones. Las vencidas sin presentar se ven en rojo y las presentadas en verde.

Está en **Contabilidad → Calendario fiscal**. El sistema nunca presenta nada a la SAT.

## Quién la usa

- Ver: `declaraciones.ver` (**admin**, **contabilidad** y **lectura**).
- Calcular el borrador desde el detalle: `declaraciones.calcular` (**contabilidad** y **admin**).

## Qué ves

Arriba, si hay obligaciones vencidas sin presentar, un aviso rojo con cuántas son. El botón «Feriados» abre la pestaña de feriados de la [configuración fiscal](./configuracion-fiscal.md#feriados): un vencimiento en sábado, domingo o feriado corre al siguiente día hábil.

Filtra por impuesto y por estado. Elige la vista:

- **Mes**: el calendario del mes con cada vencimiento en su día y los feriados marcados. Usa las flechas o «Hoy» para moverte. Debajo, la lista de vencimientos del mes.
- **Lista**: todas las obligaciones, con filtro de **Vence desde** y **Vence hasta**.

Estados de cada obligación:

| Estado                          | Qué significa                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------ |
| **Pendiente** (ámbar)           | Aún sin borrador                                                                     |
| **Borrador** (azul)             | Tiene declaración, todavía sin presentar                                             |
| **Presentada** (verde)          | Se registró la presentación                                                          |
| **Vencida** (rojo)              | El plazo pasó y no consta como presentada                                            |
| **No aplica** (gris)            | La empresa no tenía esa obligación, con el motivo                                    |
| **Rectificativa por presentar** | Una sustitutiva de un mes anterior cambió su remanente: hay que presentarla de nuevo |

También verás los días que faltan y «Formulario por confirmar» cuando el formulario lo debe confirmar el contador.

Motivos de «No aplica»: la empresa no era agente de retención de IVA en ese periodo; no hubo retenciones de ISR en el mes; el cuarto trimestre se paga con la declaración anual; el periodo es anterior al inicio de los libros en ArgosIsp.

## Detalle de una obligación

Pulsa un vencimiento para abrir su detalle: periodo, fechas del periodo, vencimiento, formulario, empresa y periodicidad, y **Cómo se calculó el vencimiento** (el plazo, y si caía en día inhábil, a qué día se corrió).

- «Ver declaración» abre su declaración, si ya tiene.
- «Calcular borrador» (`declaraciones.calcular`) calcula la declaración del periodo.

El calendario se genera solo cada hora para todo lo pendiente hasta el periodo en curso.

## Relacionado

- [Declaraciones](./declaraciones.md)
- [Configuración fiscal](./configuracion-fiscal.md)
