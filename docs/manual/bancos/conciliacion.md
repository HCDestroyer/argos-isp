---
orden: 2
pantallas:
    - /bancos/extractos
    - /bancos/extractos/[id]#conciliar-un-extracto
---

# Conciliación bancaria

Conciliar es comparar el extracto del banco con el libro, línea por línea, para confirmar que cada movimiento del banco tiene su registro y al revés. Aquí importas los extractos y concilias sus líneas.

Conciliar **nunca reescribe asientos**: solo liga la línea del banco con lo que ya está en el libro.

## Quién la usa

- **Ver:** `bancos.ver` (`admin`, `contabilidad`, `lectura`).
- **Importar extractos:** `bancos.importar_extracto` (`admin`, `contabilidad`).
- **Conciliar, registrar, deshacer y aplicar reglas:** `bancos.conciliar` (`admin`, `contabilidad`).
- **Reatribuir una llegada:** `bancos.reatribuir_llegada` (`admin`, `contabilidad`).

Se llega desde **Bancos → Conciliación bancaria**. Desde ahí, «Reglas» abre las [reglas de conciliación](./reglas.md) y «Reporte» el [reporte de conciliación](./cuadre-por-cuenta.md).

## Qué ves

La lista de extractos importados, con filtro por cuenta:

| Columna           | Qué muestra                                                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Extracto**      | Número y cuenta (enlace), las fechas que cubre y el archivo. «No encadena: …» si se importó aunque su saldo inicial no seguía al anterior. |
| **Saldo inicial** |                                                                                                                                            |
| **Saldo final**   |                                                                                                                                            |
| **Conciliadas**   | Cuántas líneas están conciliadas de cuántas.                                                                                               |

## Acciones

### Importar un extracto

- **Permiso:** `bancos.importar_extracto`.
- **Dónde:** botón «Importar extracto».
- **El archivo:** un CSV con encabezado `fecha, descripcion, referencia, monto, saldo` (referencia y saldo son opcionales; separado por coma o punto y coma; fecha `AAAA-MM-DD` o `DD/MM/AAAA`; el monto con signo: positivo entra a la cuenta). Si tu banco da otro formato, hay que convertirlo antes.
- **Qué pide:** la **Cuenta del extracto**, el archivo, **Desde** y **Hasta**, **Saldo inicial** (debe ser el saldo final del extracto anterior) y **Saldo final**.
- Antes de enviar, el panel muestra las líneas leídas, la suma y si «Cuadra con los saldos». Si alguna fila no se puede leer, lo dice con su número.
- **Qué pasa:** se guardan las líneas. Solo se agregan líneas; un extracto o líneas repetidas se rechazan.
- Si el saldo inicial no sigue al extracto anterior, la API lo rechaza y el panel pide un **motivo** para importarlo de todos modos («Importar con motivo»). El motivo queda en el extracto y en la bitácora.

## Conciliar un extracto

Al abrir un extracto ves su cuenta, fechas, saldos, cuántas líneas están conciliadas y el archivo. Cada línea muestra su descripción, fecha, referencia, saldo, monto y si está «Conciliada» o «Por conciliar»; las conciliadas listan los movimientos del libro con que se ligaron.

### Conciliar una línea

- **Permiso:** `bancos.conciliar`.
- **Dónde:** «Conciliar» en la línea.
- **Qué pasa:** eliges los movimientos que corresponden: movimientos del libro sin conciliar de esa cuenta, depósitos de caja en tránsito hacia ella o traslados que llegan a ella. Lo elegido debe sumar el monto de la línea (el panel muestra «Cuadra» o la diferencia). Se propone el de igual monto y referencia.
- Si la línea es un depósito de caja o un traslado, al conciliarla **se registra su llegada al banco** y sale de fondos en tránsito.

### Registrar una línea sin documento

- **Permiso:** `bancos.conciliar`.
- **Dónde:** «Registrar» en la línea.
- **Para qué:** movimientos que no tienen documento en el sistema, como comisiones del banco o intereses.
- **Qué pide:** **Cuenta contrapartida** y **Descripción del asiento**. Para un cargo, si la dejas vacía va a gastos y comisiones bancarias. Para un abono (interés u otro ingreso) es obligatoria.
- **Qué pasa:** se registra un asiento nuevo con la fecha de la línea y queda conciliado.

### Aplicar reglas

- **Permiso:** `bancos.conciliar`.
- **Dónde:** botón «Aplicar reglas».
- **Qué pasa:** cada línea sin conciliar toma la primera [regla](./reglas.md) que coincide. El aviso dice cuántas se conciliaron, cuántas no tenían regla y cuántas tenían una regla de cliente pero sin un pago único que coincidiera.

### Deshacer una conciliación

- **Permiso:** `bancos.conciliar`.
- **Dónde:** «Deshacer» en una línea conciliada.
- **Qué pasa:** pide el motivo. La línea y sus movimientos vuelven a estar por conciliar; la anulación queda guardada con su motivo. La llegada de un depósito o traslado ya registrada **no se revierte** (el dinero llegó).

### Reatribuir una llegada

- **Permiso:** `bancos.reatribuir_llegada`.
- **Dónde:** «Reatribuir» en una línea conciliada con un depósito o traslado.
- **Para qué:** la línea se concilió con el depósito o traslado equivocado (por ejemplo, la boleta era la del turno de la tarde).
- **Qué pide:** **Lo que en verdad llegó** (otro depósito o traslado en tránsito hacia esa cuenta) y el **Motivo**.
- **Qué pasa:** la llegada equivocada se revierte (ese documento vuelve a tránsito) y se registra la del correcto con esta misma línea.

## Preguntas frecuentes y errores

| Situación                                      | Qué hacer                                                                     |
| ---------------------------------------------- | ----------------------------------------------------------------------------- |
| «El archivo tiene filas que no se pueden leer» | Corrige esas filas del CSV (fecha, monto) y vuelve a elegir el archivo.       |
| «No cuadra con los saldos»                     | La suma de las líneas no lleva del saldo inicial al final. Revisa el archivo. |
| El extracto ya se importó                      | No se importa dos veces; ábrelo de la lista.                                  |
| Lo elegido no suma el monto de la línea        | Marca los movimientos que completan el monto.                                 |
| «Nada que conciliar en esta cuenta»            | Si es una comisión o un interés, usa «Registrar».                             |
| La línea ya está conciliada                    | Deshaz la conciliación primero si estaba mal.                                 |

## Relacionado

- [Reglas de conciliación](./reglas.md)
- [Reporte de conciliación](./cuadre-por-cuenta.md)
- [Fondos en tránsito](./fondos-en-transito.md)
