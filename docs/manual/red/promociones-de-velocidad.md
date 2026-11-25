---
orden: 5
pantallas:
    - /planes/promociones
    - /planes/promociones/[id]#detalle-de-una-promocion
    - /planes/promociones/nueva#crear-una-promocion
---

# Promociones de velocidad

Una promoción sube la velocidad de algunos servicios por unos días o en unas horas fijas de cada día, sin cortar su sesión, y la quita sola al terminar. Puede ser gratis o tener un precio. Las promociones viven en **Red → Planes**, en la pestaña **Promociones de velocidad**, junto a **Planes**.

## Quién la usa

- Ver: `promociones_velocidad.ver`.
- Crear: `promociones_velocidad.crear`.
- Asignar servicios: `promociones_velocidad.asignar`.
- Quitar a un servicio: `promociones_velocidad.quitar`.
- Cancelar: `promociones_velocidad.cancelar`.

## Lista de promociones

Abre **Red → Planes** y pulsa la pestaña **Promociones de velocidad**. Las promociones se separan en **Vigentes**, **Programadas**, **Terminadas** y **Canceladas**, cada una con cuántas hay. El buscador busca en el nombre y la descripción.

| Columna           | Qué muestra                                                                     |
| ----------------- | ------------------------------------------------------------------------------- |
| Promoción         | Nombre y descripción.                                                           |
| Velocidad         | «x2» (multiplica el plan de cada servicio) o el plan al que pasa, y cuándo.     |
| Periodo y horario | Las fechas y la franja diaria con sus días, o «Todo el día».                    |
| Precio            | «Gratis» o el precio mensual mientras dure.                                     |
| Servicios         | Cuántos servicios la tienen.                                                    |
| Estado            | Aplicada ahora, Fuera de su horario, Empieza el …, Terminada o Cancelada.       |

Las horas son de Guatemala. Una promoción nunca baja la velocidad ni el precio del plan.

En una pantalla ancha, el detalle de la promoción elegida se ve a la derecha. En el teléfono y en pantallas angostas, tocar una promoción abre su página.

## Detalle de una promoción

- **Cabecera:** el nombre, el estado y lo que pasa ahora («18:00 a 23:00 · se quita sola a las 23:00», «Vuelve mañana a las 08:00»).
- **Velocidad, Cuándo, Periodo y Precio**, y cómo se aplica: por CoA, sin cortar la sesión. En un router que controla la velocidad por plan (PCQ o árbol), el servicio pasa al plan destino mientras dura y regresa solo a su plan.
- **Servicios:** cada uno con su código, cliente, plan y router, y su estado: «Aplicada ahora», «Fuera de su horario» o «Quitada» con la fecha y el motivo. El buscador filtra por código, cliente o router. «Cargar más» trae los siguientes.

### Asignar servicios

- **Permiso:** `promociones_velocidad.asignar`.
- **Dónde:** botón «Asignar servicios» del detalle (en el teléfono, abajo).
- **Qué pasa:** buscas los servicios por cliente, usuario PPP o IP y marcas los que la reciben. Si el horario ya empezó, la velocidad sube en ese momento.
- **Todo o nada:** si uno de los elegidos no puede recibirla, no se asigna ninguno. La ventana dice cuál y por qué, y puedes quitarlo de la lista y volver a intentar.

### Quitar a un servicio

- **Permiso:** `promociones_velocidad.quitar`.
- **Dónde:** la «×» de su fila, o «Quitar» en la pestaña **Promociones** de la ficha del servicio.
- **Qué pasa:** vuelve ahora a la velocidad de su plan, sin cortar la sesión. El motivo es opcional y queda en la bitácora.

### Cancelar la promoción

- **Permiso:** `promociones_velocidad.cancelar`.
- **Dónde:** botón «Cancelar promoción» del detalle (en el teléfono, «Cancelar» abajo).
- **Qué pasa:** todos sus servicios vuelven a la velocidad de su plan ahora mismo, sin cortar la sesión. Pide un motivo. No se puede deshacer: para volver a darla se crea otra. Si tenía precio, los días que ya tuvo se cobran en la próxima factura; los que faltan, no.

## Crear una promoción

- **Permiso:** `promociones_velocidad.crear`.
- **Dónde:** «Nueva promoción» en la lista, o en la pestaña **Promociones** de la ficha del servicio (ese servicio sale elegido). El formulario se abre en su página.
- **Campos:**
    1. **Lo básico:** nombre (de 3 a 120 caracteres) y descripción. Lo ve el personal, no el cliente.
    2. **Velocidad:** «Multiplicar su plan» (de x1.01 a x10 sobre el plan de cada servicio) o «Pasar a otro plan». En los routers que controlan la velocidad por plan (PCQ o árbol) no se puede multiplicar: ahí hace falta un plan destino, que debe estar en el router del servicio y tener la misma IPv6.
    3. **Cuándo:** empieza y termina, en hora de Guatemala. «Días completos» sube al empezar y baja al terminar; «Franja diaria» sube cada día de una hora a otra, solo los días marcados (sin días marcados, todos). Si «hasta» es más temprano que «desde» (22:00 a 02:00), termina al día siguiente.
    4. **Precio:** apagado, la promoción es **gratis** y la factura no cambia. Encendido, escribes el precio mensual con la promoción: se cobra la diferencia con el precio de su plan, proporcional a los días que la tuvo, en una línea aparte. Si su plan ya cuesta más, no se cobra nada.
    5. **Servicios:** a quién se le da. Puedes crearla sin servicios y asignarlos después.
- **Así queda:** a la derecha (abajo en el teléfono) ves el resumen, la semana con las horas que sube cada día y un ejemplo con el primer servicio.
- **Al guardar:** también es todo o nada. Si un servicio no puede recibirla, arriba sale el motivo, el servicio queda marcado en la lista y **no se guarda nada**. «Quitar de la lista» lo saca para volver a intentar.

## En la ficha del servicio

La pestaña **Promociones** muestra la que tiene ahora, con su tramo («Aplicada ahora · hasta 23:00») y «Quitar», y las anteriores (terminadas, quitadas o canceladas). «Agregar a una promoción» elige una vigente o programada; las que se cruzan en fechas con la que ya tiene salen deshabilitadas: un servicio no puede tener dos promociones con fechas que se crucen. El menú «Más» de la ficha también tiene «Agregar a una promoción».

## Preguntas frecuentes y errores

**«Se encima con otra promoción».** El servicio ya tiene otra promoción con fechas que se cruzan, aunque sus horas no coincidan. Quítale la otra o elige otras fechas.

**«Supera la capacidad del router».** Con la promoción el servicio tendría más velocidad de la que su router admite por cliente. Quítalo de la lista o usa un multiplicador o un plan destino más bajo.

**«Este router necesita un plan destino».** El router del servicio controla la velocidad por plan (PCQ o árbol): usa «Pasar a otro plan».

**«El plan destino no es compatible» o «El servicio tiene un plan temporal».** El plan destino debe estar en el router del servicio y tener la misma IPv6, y no puede haber a la vez un plan temporal: los dos cambian el plan.

**«Su router no controla la velocidad por servicio».** Es un router PPPoE sin RADIUS: cambiar la velocidad cortaría la sesión, así que no se le puede dar.

## Relacionado

- [Planes](planes.md)
- [Servicios: ficha del servicio](../clientes-y-servicios/servicios.md#ficha-del-servicio)
- [Ficha del router: control de velocidad](ficha-del-router.md#control-de-velocidad)
