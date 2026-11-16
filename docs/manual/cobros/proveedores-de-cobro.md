---
orden: 7
pantallas:
    - /configuracion/proveedores-cobro
---

# Proveedores de cobro

Un proveedor de cobro es quien cobra por ti y te liquida después: una pasarela de pago en línea, una red de agentes bancarios o un débito automático. Al darlo de alta, sus pagos esperan en una cuenta puente hasta que registras su liquidación en [Cobros por liquidar](./cobros-por-liquidar.md).

## Quién la usa

- **Ver:** `bancos.ver` (`admin`, `contabilidad`, `lectura`).
- **Crear y editar:** `cobros.configurar` (`admin`, `contabilidad`).

Se llega desde **Configuración → Proveedores de cobro**.

## Qué ves

| Columna        | Qué muestra                                               |
| -------------- | --------------------------------------------------------- |
| **Proveedor**  | Nombre, método y código.                                  |
| **Puente**     | La cuenta del libro donde esperan sus pagos.              |
| **Liquida en** | La cuenta bancaria que recibe el neto.                    |
| **Desde**      | La fecha de corte: desde ese día sus pagos van al puente. |
| **Estado**     | «Activo» o «Inactivo».                                    |

Sin proveedores verás «Sin proveedores de cobro»: mientras no haya uno, los pagos por pasarela, agente o débito se registran directo contra el banco.

## Acciones

### Crear un proveedor

- **Permiso:** `cobros.configurar`.
- **Dónde:** botón «Nuevo proveedor».
- **Qué pide:**
    - **Método:** «Pasarela» (pagos en línea con tarjeta), «Agente» (agentes bancarios y puntos de pago) o «Débito automático».
    - **Pasarela:** el nombre que trae el pago (por ejemplo `recurrente`), solo para pasarelas.
    - **Nombre.**
    - **Banco donde liquida:** la cuenta que recibe el neto.
    - **Fecha de corte:** hoy o una fecha futura (vacía = hoy). Los pagos anteriores siguen contra el banco.
- **Qué pasa:** se crea su cuenta puente en el libro. Desde la fecha de corte, sus pagos van al puente por el monto completo, sin comisión; la comisión se registra con la liquidación.

### Editar o desactivar

- **Permiso:** `cobros.configurar`.
- **Dónde:** el lápiz de la fila.
- La fecha de corte solo se mueve, y el proveedor solo se desactiva, **mientras no tenga pagos**. Inactivo, sus pagos nuevos vuelven al banco.

## Preguntas frecuentes y errores

| Situación                               | Qué hacer                                    |
| --------------------------------------- | -------------------------------------------- |
| El proveedor ya tiene pagos             | Ya no se mueve la fecha ni se desactiva.     |
| Ya existe un proveedor igual            | Edita el existente.                          |
| Alguien más lo cambió mientras editabas | Cierra, vuelve a abrirlo y repite el cambio. |

## Relacionado

- [Cobros por liquidar](./cobros-por-liquidar.md)
- [Cuentas bancarias](../bancos/cuentas-bancarias.md)
