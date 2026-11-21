---
orden: 1
pantallas:
    - /configuracion/fiscal
---

# Configuración fiscal

La localización fiscal de cada empresa: país, régimen del ISR, establecimientos, frases de los DTE, parámetros con vigencia e impuestos. También los feriados, que valen para todas las empresas.

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

## Qué ves

Seis pestañas: **País y régimen**, **Establecimientos**, **Frases**, **Parámetros**, **Impuestos** y **Feriados**.

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

## Relacionado

- [FEL](./fel.md)
- [Calendario fiscal](./calendario.md)
- [Tablero fiscal y comparador](./tablero-y-comparador.md)
