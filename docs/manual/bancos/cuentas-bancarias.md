---
orden: 1
pantallas:
    - /configuracion/cuentas-bancarias
---

# Cuentas bancarias

Las cuentas bancarias propias de la empresa: donde entran los depósitos, transferencias, ACH y remesas de los clientes. Las activas en quetzales son las que aparecen en el cobro y en el portal del cliente.

## Quién la usa

- **Ver:** `cuentas_bancarias.ver` (`admin`, `cajero`, `contabilidad`, `lectura`).
- **Crear y editar:** `cuentas_bancarias.editar` (`admin`, `contabilidad`).

Se llega desde **Configuración → Cuentas bancarias**.

## Qué ves

Filtro: «Todas», «Activas» o «Inactivas».

| Columna       | Qué muestra                            |
| ------------- | -------------------------------------- |
| **Cuenta**    | Banco y alias.                         |
| **Número**    | Número de cuenta.                      |
| **Titular**   | A nombre de quién está la cuenta.      |
| **Tipo**      | Monetaria o de ahorro.                 |
| **Moneda**    | Quetzales o dólares.                   |
| **Subcuenta** | La subcuenta del libro de esta cuenta. |
| **Estado**    | «Activa» o «Inactiva».                 |

## Acciones

### Crear una cuenta

- **Permiso:** `cuentas_bancarias.editar`.
- **Dónde:** botón «Nueva cuenta».
- **Qué pide:** **Banco**, **Alias** (cómo la verá el cajero, por ejemplo «Recaudación»), **Número de cuenta**, **Titular** (el nombre a quien se deposita, tal como lo escribe el cliente en la boleta; de 2 a 120 caracteres), **Tipo** (monetaria o de ahorro), **Moneda** y «Activa (recibe pagos)».
- **Qué pasa:** se crea la cuenta y su subcuenta en el libro. Si Iris está conectado, Iris se entera del cambio y actualiza las cuentas que ofrece para depositar.

### Editar o desactivar

- **Permiso:** `cuentas_bancarias.editar`.
- **Dónde:** el lápiz de la fila.
- Las cuentas creadas antes de la versión 1.18 no tienen **Titular** ni **Tipo**: complétalos al editarlas. Iris no ofrece para depositar una cuenta sin titular.
- Cada cambio queda en la bitácora (antes y después de cada campo) y, si Iris está conectado, se le avisa.
- Las cuentas **no se borran**, porque tienen movimientos en el libro. Se desactivan: una cuenta inactiva deja de aparecer en el cobro y en el portal, y sus pagos anteriores se conservan.

::: warning Cuentas en dólares
Una cuenta en dólares no recibe pagos (no hay tipo de cambio). Tampoco una inactiva.
:::

## Preguntas frecuentes y errores

| Mensaje                                       | Qué hacer                                                                                                                                |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| «Ese número ya está registrado en este banco» | La cuenta ya existe: edítala.                                                                                                            |
| «Alguien más cambió esta cuenta»              | «Recargar» trae la versión actual; vuelve a aplicar tus cambios.                                                                         |
| La cuenta no aparece en el cobro              | Revisa que esté activa y en quetzales.                                                                                                   |
| «La cuenta bancaria está inactiva»            | El pago o el comprobante apunta a una cuenta desactivada: elige otra cuenta activa o reactívala si de verdad sigue recibiendo depósitos. |
| Iris no ofrece la cuenta a los clientes       | Revisa que tenga **Titular**, que esté activa y en quetzales.                                                                            |

## Relacionado

- [Cobrar](../cobros/cobrar.md)
- [Conciliación bancaria](./conciliacion.md)
