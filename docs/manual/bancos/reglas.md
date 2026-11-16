---
orden: 3
pantallas:
    - /bancos/reglas
---

# Reglas de conciliación

Una regla concilia sola las líneas del extracto que se repiten cada mes: comisiones del banco, intereses o transferencias de clientes. Se aplican con el botón «Aplicar reglas» de cada extracto (ver [Conciliación bancaria](./conciliacion.md#aplicar-reglas)).

## Quién la usa

- **Ver:** `bancos.ver` (`admin`, `contabilidad`, `lectura`).
- **Crear y editar:** `bancos.conciliar` (`admin`, `contabilidad`).

Se llega desde **Bancos → Conciliación bancaria → Reglas**.

## Qué ves

| Columna       | Qué muestra                                                             |
| ------------- | ----------------------------------------------------------------------- |
| **Regla**     | Nombre, la condición y la cuenta («Todas las cuentas» si no se limita). |
| **Acción**    | Qué hace y su cuenta contrapartida.                                     |
| **Prioridad** | El orden en que se prueba.                                              |
| **Estado**    | «Activa» o «Inactiva».                                                  |

## Cómo se aplican

Al aplicar reglas a un extracto, cada línea sin conciliar toma **la primera regla que coincide**, empezando por la de menor prioridad.

Una regla coincide si:

- la descripción de la línea cumple la **condición**: «La descripción contiene» (un texto, sin distinguir mayúsculas) o «Expresión regular»;
- el monto está entre **Monto desde** y **Monto hasta** (con signo: negativo sale de la cuenta), si los pusiste;
- la línea es de la cuenta elegida en **Solo en la cuenta**, si la elegiste.

Y hace una de estas **acciones**:

- «Registrar contra una cuenta»: crea el asiento de la línea contra la cuenta contrapartida y la concilia. Para comisiones e intereses.
- «Pago de cliente»: concilia con el único pago bancario vigente de esa referencia y ese monto en la cuenta. Si no hay uno solo, la línea queda sin conciliar.

## Acciones

### Crear o editar una regla

- **Permiso:** `bancos.conciliar`.
- **Dónde:** «Nueva regla» o el lápiz de la fila.
- **Qué pide:** **Nombre** (2 a 80 caracteres), **Condición** y **Patrón**, **Monto desde** y **Monto hasta** (opcionales), **Solo en la cuenta** (opcional), **Acción**, **Cuenta contrapartida** (obligatoria con «Registrar contra una cuenta», por ejemplo `5.3.07`), **Prioridad** (0 a 1000) y **Estado**.
- Las reglas no se borran: se desactivan.

## Ejemplo

Regla «Comisiones del banco»: la descripción contiene `comision`, monto desde `-100.00` hasta `0.00`, acción «Registrar contra una cuenta», contrapartida `5.3.07`. Cada mes, la comisión del extracto se registra y concilia sola.

## Preguntas frecuentes y errores

| Situación                                     | Qué hacer                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------- |
| La expresión regular no es válida             | Corrige el patrón o usa «La descripción contiene».                        |
| Alguien más cambió la regla mientras editabas | Cierra, vuelve a abrirla y repite el cambio.                              |
| Una línea no se concilió con la regla         | Revisa el patrón, los montos y la prioridad: otra regla pudo ganar antes. |

## Relacionado

- [Conciliación bancaria](./conciliacion.md)
