---
orden: 1
pantallas:
    - /configuracion/fiscal
---

# Configuración fiscal

La localización fiscal de cada empresa: país, régimen del ISR, establecimientos, frases de los DTE, parámetros con vigencia, el aviso de pequeño contribuyente e impuestos. También los feriados, que valen para todas las empresas.

Está en **Configuración → Empresa y fiscal → Fiscal**. Lo que cambies aquí rige desde la fecha que indiques y nunca reescribe lo ya emitido.

::: tip Una empresa a la vez
Todo, menos los feriados, es por empresa (NIT). Con «Todas» en el selector de empresa verás «Elige una empresa».
:::

## Quién la usa

- Ver: `fiscal.ver` (**admin**, **contabilidad** y **lectura**).
- Cambiar el régimen: `fiscal.cambiar_regimen` (**contabilidad** y **admin**).
- Nuevos valores de parámetros, banderas e impuestos: `fiscal.editar_parametros` (**contabilidad** y **admin**).
- Establecimientos, frases y feriados: `fiscal.configurar` (**contabilidad** y **admin**).
- Instalar o actualizar el paquete fiscal: `fiscal.instalar` (solo **admin**).
- Cambiar el país: `empresas.cambiar_pais` (solo **admin**).
- Aviso de pequeño contribuyente: verlo con `panel_financiero.ver`, encenderlo o apagarlo con `panel_financiero.configurar`; cambiar sus umbrales pide además `fiscal.editar_parametros` (sin él se ven de solo lectura).

## Qué ves

Siete bloques: **País y régimen**, **Establecimientos**, **Frases**, **Parámetros**, **Aviso de pequeño contribuyente**, **Impuestos** y **Feriados**.

En varias tablas verás de dónde sale cada valor: **Empresa** (propio de esta empresa), **Instalación** (lo dejó el instalador), **Global** (de toda la instalación), **Paquete** (el del paquete de localización) o **Derivado**. La etiqueta ámbar **Confirmar con contador** marca los valores que el contador debe revisar.

## País y régimen

### País y paquete

Muestra el país, el paquete fiscal instalado, cuándo se instaló y el más reciente disponible. Si la empresa no tiene localización, verás «Sin localización fiscal»: las operaciones fiscales no funcionan hasta instalarla.

- **Instalar o actualizar el paquete** (`fiscal.instalar`): botón «Instalar paquete» o «Actualizar a …». Agrega las cuentas, parámetros e impuestos del paquete; si ya estaba instalado, no agrega nada.
- **Cambiar país** (`empresas.cambiar_pais`): elige el **País nuevo** y escribe su código para confirmar. Reinstala la localización con el plan de cuentas, parámetros e impuestos del país nuevo. Solo se permite si la empresa todavía no tiene facturas, pagos, asientos ni documentos fiscales.

### Régimen de ISR

Muestra el régimen vigente (**Sobre utilidades**, **Opcional simplificado** o **Pequeño contribuyente**), desde cuándo y su historial. El régimen define qué DTE emite la empresa y las frases que llevan.

**Configurar o cambiar el régimen** (`fiscal.cambiar_regimen`): botón «Configurar régimen» (la primera vez) o «Cambiar régimen».

- **Campos:** **Régimen**, **Vigente desde**, **Aviso a la SAT** (número), **Fecha del aviso** y **Motivo**.
- La primera configuración admite cualquier fecha (la de inscripción en el régimen).
- Un cambio rige solo desde el 1 de enero de un año futuro y exige el aviso a la SAT presentado en diciembre del año anterior. El sistema nunca cambia el régimen por su cuenta.

### Banderas de la empresa

Sí/no con vigencia (por ejemplo, si la empresa es agente de retención). Al mover el interruptor (`fiscal.editar_parametros`) se abre el formulario de nuevo valor: no cambia lo anterior, agrega un valor desde una fecha.

## Establecimientos

Cada DTE lleva el código del establecimiento que lo emite; sin indicar otro, el **Por defecto**. La tabla muestra código, nombre, municipio y estado.

**Nuevo o editar establecimiento** (`fiscal.configurar`): **Código SAT** (no se edita después), **Nombre**, **Dirección**, **Municipio**, **Departamento**, **Por defecto** (marca otro para cambiarlo) y **Activo** (un inactivo deja de usarse para emitir; no se borra). Si otra persona lo cambió mientras editabas, recarga y vuelve a aplicar tus cambios.

## Frases

Las frases que llevan los DTE. Las **Del régimen** se calculan solas del régimen vigente en la fecha del documento. Las **Manuales** (por ejemplo, una exención) se agregan aquí. Elige **Vigentes al** para ver las de una fecha. Abajo está el historial de frases manuales.

- **Agregar frase** (`fiscal.configurar`): **Tipo de frase (SAT)**, **Escenario**, **Texto**, **Tipos de DTE**, **Vigente desde**, **Resolución SAT**, **Fecha de la resolución** y **Motivo**.
- **Retirar frase**: en una frase manual, con la fecha **Deja de aplicar desde** y el motivo. Los DTE ya emitidos no cambian.

## Parámetros

Los valores fiscales con vigencia (tasas, montos, plazos). Busca por nombre, elige **Vigentes al** o marca **Solo por confirmar con contador**. Cada fila muestra el valor vigente, de dónde sale y desde cuándo. «Ley» marca los que vienen de la ley.

- El botón de historial muestra todas las versiones con su fuente. Si un parámetro no tiene valor, los cálculos que lo necesiten responden «Falta un valor que debe confirmar el contador».
- **Nuevo valor** (`fiscal.editar_parametros`): **Valor** (los porcentajes sin el signo: `12.00` es 12 %; los montos en quetzales), **Vigente desde** (no puede caer en un mes cerrado), **Valor global (toda la instalación)** si aplica, y **Motivo**. Lo anterior a esa fecha no cambia.

## Aviso de pequeño contribuyente

El aviso del panel financiero cuando las ventas del año se acercan al límite anual del pequeño contribuyente. Antes estaba en Configuración → Reportes. Se ve solo con `panel_financiero.ver`.

- **Avisar al acercarse al límite anual:** encendido de fábrica; se guarda al tocar el interruptor (`panel_financiero.configurar`). **Apagado, no se avisan el 80 % ni el 95 %. El 100 % (límite superado) se avisa siempre**, porque obliga a cambiar de régimen.
- **Umbrales del aviso:** los porcentajes del límite anual en que avisa (de fábrica, 80 % y 95 %), de 1 a 5 valores mayores que 0 y hasta 100. Dice si son el valor de fábrica del país o si los cambió la empresa, y desde cuándo rigen. Son el parámetro fiscal `pc_alertas` de la empresa: el mismo que usa el resumen fiscal y que verás en **Parámetros**.
- **Guardar umbrales:** agrega o quita umbrales (botón **Agregar** y la **x** de cada uno), escribe un motivo si quieres y guarda. El cambio rige desde hoy y queda en el historial del parámetro.
- Si el régimen actual de la empresa no es pequeño contribuyente, una nota dice que el aviso no sale aunque esté encendido.
- Sin localización fiscal, los umbrales no se pueden ver ni cambiar: instala el paquete en **País y régimen**, en esta misma página.

## Impuestos

Los impuestos de la empresa con su tasa, cálculo, cuadrículas y fuente. Filtra por **Vigentes al**, grupo y uso (ventas, compras o ambos).

**Nueva versión** (`fiscal.editar_parametros`): **Tasa** (en una retención, en positivo), **Activo** (inactivo deja de aplicar desde la fecha), **Vigente desde**, **Versión global** si aplica, y **Motivo** (por ejemplo, «Decreto 4-2027, nueva tasa»). Las versiones anteriores no cambian.

## Feriados

Días inhábiles para los plazos fiscales de toda la instalación. Los feriados no vienen precargados: sin filas, solo sábados y domingos son inhábiles. Elige el **Año** para verlos.

- **Agregar feriado** (`fiscal.configurar` y alcance global): **Fecha**, **Nombre** y **Motivo** (cita la fuente que confirmó el contador). Pulsa «Agregar y recalcular».
- **Retirar feriado**: en la fila, con motivo. Pulsa «Retirar y recalcular». El retiro es una fila nueva; el alta no se borra.
- Las dos acciones recalculan el calendario fiscal de todas las empresas; el aviso dice cuántos vencimientos se movieron.
- Sin alcance global verás «Los feriados son de toda la instalación: hace falta alcance global».

## Preguntas frecuentes y errores

| Situación                                       | Qué hacer                                         |
| ----------------------------------------------- | ------------------------------------------------- |
| «La empresa no tiene localización fiscal»       | Un admin instala el paquete en **País y régimen** |
| No me deja cambiar el régimen con esa fecha     | Solo desde el 1 de enero de un año futuro         |
| La fecha de vigencia cae en un mes cerrado      | Usa una fecha de un mes abierto                   |
| «Ese código ya existe en la empresa»            | Cada establecimiento tiene un código SAT único    |
| «Falta un valor que debe confirmar el contador» | Registra el valor del parámetro en **Parámetros** |
| «Los umbrales ya se cambiaron hoy»              | Solo cabe un cambio por día: vuelve mañana o corrige `pc_alertas` en **Parámetros** |
| «Sin permiso para cambiar los umbrales»         | Pide el permiso `fiscal.editar_parametros`        |
| Apagué el aviso y aún sale                      | Es el del 100 %: el límite superado se avisa siempre |

## Relacionado

- [FEL](./fel.md)
- [Calendario fiscal](./calendario.md)
- [Tablero fiscal y comparador](./tablero-y-comparador.md)
- [Ajustes de reportes](../configuracion/ajustes-de-reportes.md)
