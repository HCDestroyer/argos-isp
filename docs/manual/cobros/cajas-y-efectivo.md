---
orden: 3
pantallas:
    - /caja/efectivo
---

# Cajas y efectivo

Aquí ves dónde está cada quetzal en efectivo y quién lo tiene: en las cajas de cobros, en custodia, en la caja chica o en camino al banco. También recibes el efectivo que te entrega un cajero, depositas lo que tienes en custodia y llevas la caja chica (gastos con comprobante, reposición y conteo).

## Quién la usa

- **Ver:** `cajas.ver`. Sin `cajas.ver_custodia` solo ves tu custodia y tus entregas.
- **Recibir una entrega («Recibí»):** `cajas.recibir_entrega` (`admin`, `contabilidad`). **«No lo recibí»:** `cajas.rechazar_entrega`.
- **Depositar tu custodia:** `cajas.depositar`.
- **Caja chica:** registrar gasto `caja_chica.registrar_gasto`; reponer `caja_chica.reponer`; contar `caja_chica.contar`.
- **En camino al banco:** necesita `bancos.ver`; sin él, el indicador dice «Sin acceso».

Se llega desde **Finanzas → Bancos → Cajas y efectivo**.

## Qué ves

- **Cuatro indicadores:** en cajas de cobros, en custodia, en caja chica y en camino al banco. Cada uno tiene su «?» con qué es y cómo se calcula. Si uno no se pudo leer, dice «No se pudo leer» con «Reintentar» y el total «Efectivo fuera del banco» queda en «—».
- **Camino del efectivo:** el efectivo solo se mueve por cuatro caminos: **entrega** (caja de cobros → custodia, al cerrar el turno), **depósito** (custodia → banco, con boleta), **reposición** (custodia o banco → caja chica, por lo gastado) y **gasto** (caja chica → gasto, con comprobante). La lista muestra cada uno con su número (`E-`, `D-`, `R-`, `G-`), de dónde a dónde, cuándo, el monto y su estado.
- **Caja chica:** siempre se cumple «efectivo + comprobantes sin reponer = fondo fijo». Ves los gastos que aún no se reponen, la encargada, el fondo, la última reposición y el último conteo. Se avisa para reponer al bajar del 30 % del fondo.
- **Custodia y depósitos** (en el teléfono, **Recibir**): quién tiene efectivo, cuánto, desde cuándo y si pasa del plazo o del tope (solo avisa, no bloquea), y las entregas que siguen a nombre del cajero porque nadie dijo «Recibí».

## Acciones

### Recibir una entrega

Cuenta el efectivo y escribe cuánto contaste. Si es distinto de lo entregado, escribe el motivo: la diferencia queda a cargo de quien entregó. Al confirmar, el efectivo pasa a tu nombre hasta que lo deposites. Si no lo recibiste, usa **No lo recibí** y explica por qué.

### Depositar lo que tienes en custodia

Escribe el monto (no puede pasar de lo que tienes), la boleta, la cuenta y la fecha. El depósito queda «en camino» hasta que se concilia con el estado de cuenta.

### Registrar un gasto de caja chica

Monto, tipo de gasto, en qué se gastó y el comprobante (foto o PDF), que es obligatorio. No hay tope por gasto: el único límite es el efectivo de la caja. Si trae factura a nombre de la empresa, márcalo y regístralo después como compra para aprovechar el IVA.

### Reponer la caja chica

Se repone siempre por lo gastado, desde tu custodia o desde el banco, nunca desde una caja de cobros. Los comprobantes quedan sellados como «repuestos».

### Contar la caja chica

Contabilidad puede contarla sin aviso. Si falta o sobra, el motivo es obligatorio y la diferencia queda a cargo de la encargada; la siguiente reposición la cubre.
