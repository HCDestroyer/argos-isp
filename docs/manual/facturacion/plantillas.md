---
orden: 1
pantallas:
    - /plantillas
---

# Plantillas de facturación

Cada servicio factura con una plantilla. La plantilla dice cuándo se emite la factura, cuántos días tiene el cliente para pagar, cuándo se limita o se suspende el servicio, si se cobra mora, cuándo se certifica con FEL y qué promesas de pago se aceptan.

Para entender cómo se usan estas reglas en el día a día, lee [El ciclo de cobro](../../guia/ciclo-de-cobro.md).

## Quién la usa

- **Ver:** permiso `plantillas.ver`. Lo traen los roles `admin`, `contabilidad`, `soporte` y `lectura`.
- **Crear:** `plantillas.crear` (`admin`, `contabilidad`).
- **Editar:** `plantillas.editar` (`admin`, `contabilidad`). Sin este permiso, el botón de cada fila es un ojo y la plantilla se abre en solo lectura.

Se llega desde **Configuración → Plantillas**.

## Qué ves

Una tabla con una fila por plantilla:

| Columna       | Qué muestra                                                                                                                                                                      |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Plantilla** | El nombre, la insignia «Por defecto» (estrella) si es la que reciben los servicios nuevos, la insignia «FEL: al emitir», «FEL: al pagar» o «FEL: nunca», y el resumen del ciclo. |
| **Corte**     | Días de gracia, cuántas facturas vencidas limitan y suspenden, y la hora del corte.                                                                                              |
| **Mora**      | Si cobra recargo por mora y cuánto.                                                                                                                                              |
| **Promesas**  | Si acepta promesas de pago, el resumen de sus reglas, la reconexión temporal, qué canales piden aprobación y la insignia «IA: mismas reglas que operador».                       |

En el teléfono, las columnas que no caben se muestran como líneas debajo del nombre.

Si todavía no hay plantillas, verás «Todavía no hay plantillas»: crea al menos una antes de dar de alta servicios o de importar clientes.

## Acciones

### Crear una plantilla

- **Permiso:** `plantillas.crear`
- **Dónde:** botón «Nueva plantilla», arriba a la derecha.
- **Qué pasa:** se abre un panel lateral con el formulario. Al pulsar «Crear plantilla» aparece el aviso «… creada» con el resumen del ciclo y de las promesas. La plantilla ya se puede asignar a servicios.

### Editar una plantilla

- **Permiso:** `plantillas.editar`
- **Dónde:** el lápiz al final de la fila.
- **Qué pasa:** al pulsar «Guardar cambios», las reglas nuevas rigen para las facturas que se emitan desde ese momento. **Las facturas ya emitidas no cambian:** cada factura guarda una copia de las reglas con las que se emitió. Cada cambio queda en la bitácora con el valor anterior y el nuevo.

### Marcar la plantilla por defecto

En el formulario, el interruptor «Plantilla por defecto». La reciben los servicios que se crean sin elegir plantilla. Solo puede haber una: marcar esta desmarca la anterior.

## Campos del formulario

### Ciclo de facturación

- **Nombre:** obligatorio, por ejemplo «Mensual día 5».
- **Ciclo:**
    - «Día fijo del mes»: todas las facturas salen el mismo día. Se elige el **Día de facturación**, del 1 al 28 (para que exista en todos los meses).
    - «Aniversario»: cada servicio factura el día del mes en que se instaló. Si se instaló un 29, 30 o 31, factura el 28.
- **Prorratear el primer periodo:** si está encendido, la primera factura cobra solo los días desde la instalación hasta el inicio del siguiente periodo. Apagado, la primera factura va por el precio completo.

### Corte por falta de pago

- **Días de gracia** (0 a 90): la factura vence ese número de días después de que empieza su periodo. Al día siguiente del vencimiento queda **vencida**.
- **Hora del corte:** hora de Guatemala, en formato de 24 horas. A esa hora el sistema revisa los servicios de la plantilla y los limita o suspende si corresponde. Reactivar no espera a esta hora: es inmediato.
- **Facturas vencidas para limitar** (0 a 24): con esta cantidad de facturas vencidas, el servicio pasa a **limitado** (velocidad reducida). `0` = nunca limita. Solo limita si el plan del servicio tiene una velocidad limitada configurada.
- **Facturas vencidas para suspender** (1 a 24): con esta cantidad, el servicio pasa a **suspendido**. Tiene que ser igual o mayor que la de limitar.

### Recargo por mora

- **Tipo:** «Sin mora», «Monto fijo» (en quetzales) o «Porcentaje de la factura».
- **Monto** o **Porcentaje:** obligatorio si hay mora. El porcentaje no puede pasar de 100.
- **Cobrar en cada periodo vencido:** encendido, se agrega otro recargo por cada mes que la factura siga vencida. Apagado, un solo recargo por factura.

El recargo es una factura aparte («Recargo por mora») ligada a la factura que venció. No cuenta para limitar ni suspender.

### Factura electrónica (FEL)

- **Certificar:** «Al emitir» (el documento se pide a la SAT al emitir la factura), «Al pagar» (la factura es un aviso de cobro y se certifica cuando se paga) o «Nunca» (sin documento electrónico). «Nunca» no se admite si la FEL es obligatoria para la empresa.

### Promesas de pago

El interruptor «Permitir promesas de pago» las habilita. Las reglas se revisan en este orden cada vez que alguien crea una promesa, y la primera que no se cumple decide el rechazo:

| Campo                                    | Qué controla                                                                                                |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Plazo máximo (días)**                  | Cuántos días puede durar una promesa (1 a 60).                                                              |
| **Vencer antes de la siguiente factura** | La promesa no puede pasar de la fecha de la próxima factura.                                                |
| **Deuda vencida máxima**                 | Por encima de este monto no se acepta promesa. Vacío = sin límite.                                          |
| **Abono inicial**                        | Porcentaje de lo vencido que el cliente debe pagar antes de prometer. `0` = no se exige.                    |
| **Antigüedad mínima (días)**             | Días que el servicio debe tener desde su alta.                                                              |
| **Exigir cumplimiento mínimo**           | Encendido, pide un porcentaje mínimo de promesas cumplidas en el historial del cliente.                     |
| **Días sin promesas tras incumplir**     | Después de una promesa incumplida, cuántos días no se aceptan promesas nuevas.                              |
| **Promesas por periodo**                 | Cuántas promesas por periodo de facturación (0 a 12).                                                       |
| **Con buen historial**                   | Cuántas por periodo si el cliente cumplió lo suficiente. Debe ser igual o mayor que «Promesas por periodo». |
| **Buen historial desde**                 | Porcentaje de promesas cumplidas para tener «buen historial».                                               |
| **Ventana del historial**                | Cuántas de las últimas promesas se miran para medir el historial (1 a 50).                                  |

**Por canal.** Hay una tarjeta por canal: «Operador», «Supervisor», «Portal del cliente» y «Agente de IA». En cada una:

- «Permitido»: si ese canal puede crear promesas.
- «Requiere aprobación»: la promesa queda pendiente hasta que alguien con el permiso `promesas.aprobar` la apruebe.
- «Plazo (días)», «Por periodo» y «Deuda máx.»: si los escribes, reemplazan al valor general para ese canal. Vacíos, usa el general.

**Mismas reglas para IA y operador.** Si marcas esta casilla, el asistente de IA usa exactamente los límites del canal Operador, como si fuera una persona. La tarjeta «Agente de IA» muestra «Usa las reglas de Operador» y sus valores se conservan por si quitas la casilla, pero no se aplican.

### Reconexión temporal

Cuando un cliente cortado manda su comprobante de depósito por Iris y caja no lo puede revisar pronto, Iris puede pedir que se reconecte mientras se revisa. Está apagada por defecto.

- **Permitir reconexión temporal:** la habilita.
- **Reconexiones por periodo:** cuántas por servicio y periodo de facturación. Es un cupo aparte del de promesas.
- **Vigencia:** hasta cuándo dura la reconexión.
    - **Por horas** (la de siempre): dura las horas de «Duración máxima».
    - **Hasta la medianoche:** dura hasta la siguiente medianoche, hora de Guatemala. Si se pide a menos de una hora de la medianoche (por ejemplo, a las 23:30), dura hasta la medianoche del día siguiente.
- **Duración máxima (horas):** de 1 a 168, contadas desde que se crea. Solo se usa con la vigencia «Por horas».

Iris la puede pedir por dos motivos: **fuera de horario** (la caja está cerrada) o **sin personal de caja** (es horario hábil, pero nadie de caja puede revisar el comprobante). Las reglas son las mismas para los dos, y el comprobante se queda pendiente en la cola para que caja lo revise después.

La vigencia, como las demás reglas de promesa, se puede cambiar para un servicio con una excepción.

Solo se concede si el comprobante cubre todo lo vencido. Si caja lo rechaza, o vence sin revisarse, el servicio se vuelve a cortar a la hora de corte.

## Preguntas frecuentes y errores

**¿Puedo borrar una plantilla?** No. Un servicio siempre tiene su plantilla, así que las plantillas no se borran.

**Cambié la mora y una factura vieja no cambió.** Es lo esperado: cada factura guarda las reglas con las que se emitió.

**Un servicio necesita reglas distintas a las de su plantilla.** El sistema admite excepciones por servicio (día, gracia, cuántas vencidas limitan o suspenden, mora, hora de corte, FEL y reglas de promesa); el nombre y el ciclo no se pueden exceptuar. La ficha del servicio muestra su configuración de facturación ya combinada y marca con «Excepción» cada valor que no viene de la plantilla.

**Mensajes que puedes ver al guardar:**

| Mensaje o situación                                              | Qué hacer                                                                                                                 |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Un campo marcado en rojo                                         | Corrige ese campo. Por ejemplo: el día es obligatorio con «Día fijo del mes», o limitar no puede ser mayor que suspender. |
| Alguien más cambió la plantilla mientras la editabas (conflicto) | «Reintentar» carga la versión guardada. Tus cambios sin guardar se pierden: vuelve a hacerlos.                            |
| «Nunca» no se acepta en Certificar                               | La FEL de la empresa es obligatoria. Elige «Al emitir» o «Al pagar».                                                      |

## Relacionado

- [El ciclo de cobro](../../guia/ciclo-de-cobro.md)
- [Promesas de pago](../cobros/promesas.md)
- [Facturas](./facturas.md)
