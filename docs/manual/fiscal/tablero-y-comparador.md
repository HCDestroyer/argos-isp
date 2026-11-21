---
orden: 6
pantallas:
    - /fiscal/tablero
    - /fiscal/comparador#comparador-de-regimenes
---

# Tablero fiscal y comparador de regímenes

Dos pantallas de consulta: el tablero resume cómo va la empresa en lo fiscal (lo del mes y del año) y el comparador simula cuánto ISR pagaría en cada régimen. Ninguna guarda ni presenta nada.

Están en **Finanzas → Impuestos → Fiscal** y **Finanzas → Impuestos → Comparador de regímenes**.

## Quién la usa

- Las dos piden `fiscal.ver` (**admin**, **contabilidad** y **lectura**).
- Cada bloque con enlace muestra su botón solo si tienes el permiso de esa pantalla (por ejemplo `declaraciones.ver` para el calendario).
- Ocultar consejos: `fiscal.configurar` (**contabilidad** y **admin**).

## Tablero fiscal

Lo que va del mes y del año según los libros y las declaraciones, calculado hoy. Los estimados no se guardan ni se presentan: confírmalos con el contador. Con varias empresas ves un tablero por empresa, con su régimen.

Arriba aparecen las alertas (en rojo) con un botón a la pantalla donde se resuelven. Luego los bloques:

| Bloque                              | Qué muestra                                                                                    |
| ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| **Facturado**                       | Base sin IVA e IVA del mes y del año a la fecha                                                |
| **IVA del mes**                     | El IVA que va del mes                                                                          |
| **ISR estimado**                    | ISR del año a la fecha, renta e ISR proyectados al año (lo del año × 12 ÷ meses transcurridos) |
| **ISO del trimestre**               | El ISO estimado del trimestre                                                                  |
| **Límite de pequeño contribuyente** | Acumulado, límite anual y disponible, con avisos al llegar a los umbrales                      |
| **Vencimientos**                    | Lo próximo a vencer, con su estado, días restantes y mora estimada; botón «Calendario»         |
| **Libros por emitir**               | Por libro, «Al día» o cuántos meses atrasados; botón «Libros»                                  |
| **Factura electrónica (FEL)**       | Modo, certificador, contingencia y DTE pendientes por estado; botón «FEL»                      |
| **Compras sin NIT del proveedor**   | Compras del año desde el monto límite sin NIT del proveedor, con enlace a cada una             |
| **Reserva de incobrables**          | Saldos deudores, tope, lo registrado y lo que falta por provisionar; botón «Cartera»           |
| **Depreciación bajo el máximo**     | Activos que se deprecian con una tasa menor que la máxima                                      |

La mora estimada se calcula con la tasa diaria vigente sobre lo pendiente, por cada día de atraso. Es una estimación: confírmala con el contador.

### Consejos

Debajo del tablero hay una lista de consejos que aplican hoy a la empresa, con su fuente. «Ver ocultos» y «Ver sin datos» muestran los demás.

- **Ocultar para la empresa** u **Ocultar solo para mí** (`fiscal.configurar`): con un motivo opcional. Queda en la bitácora.
- **Mostrar**: vuelve a hacerlo visible.

## Comparador de regímenes

Una simulación de referencia con los datos del libro y los parámetros vigentes: cuánto ISR pagaría la empresa en el régimen opcional simplificado y en el régimen sobre utilidades. No cambia el régimen. Valídala con tu contador.

- **Crecimiento mensual de las ventas**: por ciento con hasta 2 decimales; vacío usa la tendencia de los meses leídos. Pulsa «Recalcular proyección» o «Usar tendencia».
- Por empresa ves:
    - **Comparación anual**: el impuesto anual estimado de cada régimen, cuál es el actual y cuál paga menos, el margen fiscal, el margen de equilibrio y las ventas al año.
    - **Datos del libro**: ventas sin IVA, promedio mensual, ingresos, gastos, no deducibles y renta fiscal. «Ver las ventas por mes» las desglosa.
    - **Régimen opcional simplificado** y **Régimen sobre utilidades**: cómo sale el ISR en cada uno.
    - **ISO como piso**: el ISO del año.
    - **Proyección a 12 meses** con el crecimiento elegido.
    - **Supuestos** y **Matices**, marcados «Confirmar con contador».

Con menos de 12 meses leídos, las cifras se anualizan (× 12 ÷ meses).

::: tip Cambiar de régimen
Esta pantalla no cambia el régimen. El cambio se hace en [Configuración → Empresa y fiscal → Fiscal](./configuracion-fiscal.md#regimen-de-isr): rige desde el 1 de enero y se avisa a la SAT en diciembre.
:::

## Relacionado

- [Calendario fiscal](./calendario.md)
- [Declaraciones](./declaraciones.md)
- [Cartera](../contabilidad/cartera.md)
