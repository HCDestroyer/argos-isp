# Contrato: localización fiscal (Guatemala)

Decisión del PM, 17 de octubre. Al elegir el país de una empresa se instala su **localización**: plan de cuentas, impuestos, libros, reglas de cierre, tipos de DTE y calendario fiscal. Hoy solo existe la de Guatemala (`GT`).

- Dueños: A1 (`core.empresas.pais` y la selección de país) y A3 (todo lo demás: `ledger`, `billing`, FEL y el módulo nuevo `fiscal`). A4, A5 y A6 consumen.
- La fuente de cada tasa, plazo, límite o formulario es la investigación del líder (`contabilidad-gt/investigacion.md`, citada como **inv. X.n**). Lo que el informe marca como NO VERIFICADO entra como parámetro editable con la marca **confirmar con contador** (tabla al final), nunca como un hecho.
- Este contrato manda sobre lo que choque con él en los README de `ledger` y `billing`. Cambia en la misma PR que el código que lo cumple.

## 1. Objetivos

1. Que cada empresa (NIT) lleve su contabilidad legal de Guatemala dentro de ArgosIsp: libros con folio, IVA, ISR, ISO, retenciones y cierres, sin hoja de cálculo aparte.
2. FEL obligatoria, opcional o desactivada por empresa, con varios certificadores posibles.
3. Parámetros con vigencia: si cambia la ley se agrega una versión; nada se pisa.
4. Declaraciones como **borradores calculados** y un tablero que ayuda a decidir. El sistema **nunca** presenta nada a la SAT ni cambia el régimen por su cuenta.
5. Sin romper las reglas 4 (libro inmutable), 5 (invalidación por evento), 9 (auditoría) y 13 (multiempresa). Con una empresa GT y FEL desactivada, todo lo que existe hoy se comporta igual.

Fuera de alcance: nómina (IGSS, IRTRA, INTECAP; inv. A.6), activos fijos con depreciación automática (solo se deja el catálogo de tasas), multimoneda (solo se guarda el tipo de cambio del Banguat cuando haga falta; inv. B.4), envío de declaraciones a la SAT.

### Decisiones del PM (2026-10-17)

| Tema               | Decisión                                                                                                                                                                                                                                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FEL desactivada    | Se permite en cualquier régimen, con la alerta permanente "FEL es obligatoria para su régimen" en el tablero                                                                                                                                                                                                                          |
| Certificación      | **Opcional y al cobrar.** El aviso de cobro existe desde el día 1 del periodo; el cliente no siempre paga en la fecha ni todos los meses. Por eso `certificar_al = pagar` es válido en cualquier modo y es el valor por defecto para servicios recurrentes; `emitir` queda para quien lo elija. Un mes que no se paga no se certifica |
| Mora               | **No lleva IVA** (`mora_con_iva = no` por defecto; solo el contador puede activarlo por empresa) y es **opcional** por empresa o plantilla: son servicios sin contrato                                                                                                                                                                |
| Establecimiento    | Uno por empresa; el modelo permite varios y asignarlos a zona o caja más adelante                                                                                                                                                                                                                                                     |
| FEL de la semana 5 | Queda absorbido por las fases de este contrato: INFILE es el primer proveedor de `ProveedorFel`                                                                                                                                                                                                                                       |

## 2. Decisiones de diseño

| Tema                        | Decisión                                                                                                                                                                                                                                              | Por qué                                                                                              |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Paquete                     | `apps/api/app/fiscal/l10n/gt/` es código versionado (`gt-2026.1`): cuentas, parámetros, tipos de DTE, frases, libros, obligaciones y consejos. Un `Instalador` lo aplica a una empresa. Otro país = otra carpeta `l10n/<pais>/` con la misma interfaz | Como los `l10n_*` de Odoo (inv. D.2), pero con nuestras tasas: las de `l10n_gt` están mal (inv. D.1) |
| Schema nuevo                | `fiscal` (A3) para configuración, DTE, declaraciones, libros emitidos y calendario. Compras y bloqueos van en `ledger`; el estado de la factura en `billing`                                                                                          | `ledger` guarda lo que mueve dinero; `fiscal` lo que se calcula o se reporta encima                  |
| Parámetros                  | Filas **solo de inserción** con `vigente_desde`. Leer = la fila más reciente con `vigente_desde <= fecha`, primero la de la empresa, luego la global, luego la del paquete                                                                            | Versionado sin `UPDATE`; una declaración vieja se recalcula con los valores de su fecha              |
| Régimen y banderas          | También son parámetros con vigencia (`regimen`, `agente_retencion_iva`, `contribuyente_especial`…), con acciones propias que validan la ley                                                                                                           | Un solo mecanismo de vigencia y auditoría                                                            |
| `core.empresas.regimen_isr` | Pasa a ser de solo lectura: la API la calcula del parámetro `regimen` vigente. Se borra la columna en una PR posterior                                                                                                                                | Evita dos fuentes de verdad                                                                          |
| Plan de cuentas             | Se **amplía** el catálogo común (`ledger.cuentas`), con tipo nuevo `patrimonio` y columna `pais`                                                                                                                                                      | No rompe `CUENTAS.*` ni los asientos existentes                                                      |
| FEL                         | Interfaz `ProveedorFel` (como `account_edi_format` de Odoo, inv. D.2) y tabla `fiscal.dte` separada de la factura                                                                                                                                     | La factura es dinero; el DTE es su certificación, con su propio ciclo y reintentos                   |
| Modo obligatorio            | La factura nace `por_certificar`, sin asiento ni `factura.emitida`, y se emite al certificarse                                                                                                                                                        | Decisión del PM: no se considera emitida sin certificar                                              |
| Libros oficiales            | Solo de periodos cerrados y bloqueados; cada emisión guarda folio inicial y final y el hash del archivo                                                                                                                                               | Un folio impreso no puede cambiar de contenido                                                       |

## 3. Modelo de datos

Todas las tablas llevan `empresa_id NOT NULL` (FK a `core.empresas`) salvo los catálogos del paquete. Fechas en UTC; fechas contables `date` en hora de Guatemala. Dinero `numeric(14,2)`; tasas `numeric(9,6)`.

### 3.1 Núcleo (A1)

| Tabla           | Cambio                                                                                                                                                                                                                                                     |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core.empresas` | `pais char(2) NOT NULL DEFAULT 'GT'`. Cambiar el país de una empresa con documentos: 409 `empresa_con_documentos`. `regimen_isr` y `codigo_establecimiento` quedan de solo lectura (ver §11)                                                               |
| `core.clientes` | Datos del receptor: `tipo_documento_fiscal` (`nit`, `cui`, `pasaporte`, `cf`; por defecto `cf`), `nit_cui` (ya existe), `nombre_fiscal`, `direccion_fiscal`, `pais_fiscal`, `agente_retencion_iva` (bool), `sector_publico` (bool). Van en `audit.cambios` |

### 3.2 Localización y parámetros (`fiscal`, A3)

| Tabla                       | Columnas clave                                                                                                                                                                                                                                     | Restricciones                                                                                                                                                                                                          |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fiscal.localizaciones`     | `codigo` (`gt-2026.1`), `pais`, `version` (semver), `publicada_en`, `checksum`                                                                                                                                                                     | Catálogo sembrado desde el código; solo inserción                                                                                                                                                                      |
| `fiscal.instalaciones`      | `empresa_id`, `localizacion_codigo`, `de_codigo` (null en la primera), `instalada_en`, `instalada_por`, `resumen` jsonb (qué agregó)                                                                                                               | Solo inserción. La vigente es la última                                                                                                                                                                                |
| `fiscal.parametros`         | `pais`, `clave`, `tipo` (`porcentaje`, `monto`, `entero`, `fecha`, `texto`, `enum`, `bool`, `json`), `alcance` (`N`, `G`, `E`), `fuente` (`inv. A.1`), `confianza`, `confirmar_contador` bool, `descripcion`, `opciones` jsonb, `minimo`, `maximo` | Catálogo del paquete, una fila por (`pais`, `clave`)                                                                                                                                                                   |
| `fiscal.parametros_valores` | `id`, `empresa_id` (null = global de la instalación), `clave`, `valor` jsonb, `vigente_desde` date, `origen` (`paquete`, `usuario`), `motivo`, `creado_por`, `created_at`                                                                          | Solo inserción (trigger y `REVOKE`). Único (`empresa_id`, `clave`, `vigente_desde`) con NULLS NOT DISTINCT. `alcance = N` solo admite `origen = paquete`. El valor respeta `minimo`/`maximo` (ej. reserva legal ≥ 5 %) |
| `fiscal.establecimientos`   | `codigo` (entero de la SAT), `nombre`, `direccion`, `municipio`, `departamento`, `activo`, `por_defecto`, `version`                                                                                                                                | Único (`empresa_id`, `codigo`); uno `por_defecto` por empresa                                                                                                                                                          |
| `fiscal.frases`             | `tipo_frase`, `escenario`, `texto`, `tipos_dte[]`, `origen` (`regimen`, `manual`), `vigente_desde`, `resolucion` (pago directo)                                                                                                                    | Solo inserción; las de `regimen` las deriva la acción, las `manual` las agrega el contador                                                                                                                             |
| `fiscal.feriados`           | `fecha`, `nombre`, `origen`                                                                                                                                                                                                                        | Global; para plazos en días hábiles. **confirmar con contador**                                                                                                                                                        |

Lectura: `parametro(empresaId, clave, fecha)` en `#fiscal/parametros`. Caché en memoria del proceso por (empresa, clave), invalidada por el evento `fiscal.parametros_cambiados` (regla 5, sin TTL).

### 3.3 Plan de cuentas (`ledger`, A3)

- `ledger.cuentas.tipo` admite `patrimonio`. Columna `pais char(2) NOT NULL DEFAULT 'GT'`; el único pasa a (`pais`, `codigo`). `cuentasPorCodigo` resuelve con el país de la empresa del asiento (hoy siempre GT: nada cambia).
- Columnas nuevas: `naturaleza` (`deudora`, `acreedora`; derivada del tipo, salvo las contracuentas), `auxiliar_proveedor` bool, `categoria_fiscal` (ver §6.5), `libro_inventario` bool.
- `ledger.movimientos.proveedor_id` (FK a `ledger.proveedores`), obligatorio en cuentas con `auxiliar_proveedor`.
- `ledger.asientos.origen_tipo` agrega `compra`, `pago_proveedor`, `retencion`, `liquidacion_impuesto`, `pago_impuesto`, `cierre_anual`, `reclasificacion` y `lealtad` (este último lo usa `contratos/lealtad.md`).

### 3.4 Compras (`ledger`, A3)

| Tabla                          | Columnas clave                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Restricciones                                                                                                                                                                                                                                                         |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ledger.proveedores`           | `nit` (o `cui`, `id_extranjero`), `nombre`, `tipo` (`general`, `pequeno_contribuyente`, `no_residente`, `sin_documento` → factura especial), `regimen_isr`, `agente_retencion_iva`, `pais`, `activo`, `version`                                                                                                                                                                                                                                                                                                                        | Único (`empresa_id`, NIT normalizado) entre activos                                                                                                                                                                                                                   |
| `ledger.compras`               | `proveedor_id`, `tipo_documento` (`FACT`, `FCAM`, `FPEQ`, `FCAP`, `NCRE`, `NDEB`, `FESP`, `DUA`, `RECIBO`), `serie`, `numero`, `autorizacion` (UUID del DTE), `fecha_documento`, `periodo_iva` (primer día del mes donde se toma el crédito), `condicion` (`contado`, `credito`), `vence_en`, `base_bienes`, `base_servicios`, `exento`, `iva`, `total`, `credito_fiscal` bool, `retencion_iva`, `retencion_isr`, `compra_referencia_id` (NCRE/NDEB del proveedor), `egreso_id` (si nace de un egreso), `asiento_id`, `registrado_por` | **Solo inserción** (trigger y `REVOKE`). Único (`empresa_id`, `proveedor_id`, `tipo_documento`, `serie`, `numero`) → 409 `compra_duplicada`. `total = base_bienes + base_servicios + exento + iva`. `FPEQ` y `FCAP` ⇒ `iva = 0` y `credito_fiscal = false` (inv. A.3) |
| `ledger.compras_lineas`        | `compra_id`, `descripcion`, `tipo` (`bien`, `servicio`, `activo_fijo`, `combustible`, `importacion`), `cuenta_id` (gasto o activo), `base`, `iva`, `clase_activo`                                                                                                                                                                                                                                                                                                                                                                      | Solo inserción                                                                                                                                                                                                                                                        |
| `ledger.compras_anulaciones`   | `compra_id` (único), `asiento_id` (reverso), `motivo`, `anulado_por`, `anulado_en`                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Como `egresos_anulaciones`                                                                                                                                                                                                                                            |
| `ledger.pagos_proveedores`     | `proveedor_id`, `compras[]` (tabla de aplicaciones), `metodo` (`caja`, `banco`, `cuenta_bancaria`), `monto`, `asiento_id`                                                                                                                                                                                                                                                                                                                                                                                                              | Solo inserción; anular con fila en `pagos_proveedores_anulaciones`                                                                                                                                                                                                    |
| `ledger.constancias_retencion` | `direccion` (`recibida` de un cliente, `emitida` a un proveedor), `impuesto` (`iva`, `isr`), `numero`, `fecha`, `monto`, `pago_id` o `compra_id`, `cliente_id` o `proveedor_id`                                                                                                                                                                                                                                                                                                                                                        | Solo inserción. Único (`empresa_id`, `direccion`, `impuesto`, `numero`)                                                                                                                                                                                               |

**Cómo se extienden los egresos sin romper la regla 4.** `ledger.egresos` no cambia de significado: sigue siendo un gasto pagado sin datos fiscales. Se agrega solo la columna `compra_id` (nulable; `ALTER ADD COLUMN`, ningún `UPDATE` de filas):

1. **Compra al contado**: `compras.registrar` crea la compra y, en la misma transacción, el egreso que la paga (`compra_id` lleno). Hay un solo asiento, con origen `compra`; el egreso no genera otro.
2. **Compra al crédito**: asiento contra `2.1.03 Proveedores` con auxiliar; después `compras.pagar` hace `Proveedores / Caja | Banco`.
3. **Egreso viejo con factura**: `compras.registrar_desde_egreso` crea la compra con `egreso_id` y un asiento de **reclasificación** (`IVA crédito / gasto` por el IVA), sin tocar el asiento original. Debe hacerse dentro de la ventana del crédito fiscal (inv. A.1, art. 20); si no, la compra entra al libro con `credito_fiscal = false`.
4. Solo las compras aparecen en el libro de compras; un egreso sin compra, no.

Asiento de una compra del régimen general, al contado, siendo agente de retención:

```
Gasto o activo (línea)           debe   base
1.1.04 IVA crédito fiscal         debe   iva            (solo si credito_fiscal)
Caja | Banco | 2.1.03 Proveedores haber  total − retenciones
2.1.04 Retenciones IVA por pagar  haber  retencion_iva
2.1.05 Retenciones ISR por pagar  haber  retencion_isr
```

### 3.5 Facturación (`billing`, A3)

- `billing.facturas.estado` agrega `por_certificar`. `establecimiento_id` (FK) y `tipo_dte` (texto, del catálogo). Las columnas `fel_*` quedan de solo lectura y se migran a `fiscal.dte` (§11).
- `billing.facturas_lineas.tipo` agrega `descuento` (línea negativa ligada a otra línea por `linea_id`; la usa lealtad, inv. F.1). `descuento numeric(14,2)` en la línea descontada.
- `billing.pagos`: `retenciones[]` vía `ledger.constancias_retencion` (`direccion = recibida`). El asiento del pago agrega `1.1.05 IVA retenido por clientes` o `1.1.06 ISR retenido por clientes` en el debe por el monto de la constancia, y CxC en el haber por el total.

### 3.6 FEL (`fiscal`, A3)

| Tabla                      | Columnas clave                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Restricciones                                                                              |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `fiscal.fel_configuracion` | `empresa_id` (PK), `proveedor` (`infile`…), `ambiente` (`pruebas`, `produccion`), `modo` (`obligatoria`, `opcional`, `desactivada`), `contingencia_activa`, `version`                                                                                                                                                                                                                                                                                                                                                                                          | Cambios con `version` (409) y `audit.cambios`                                              |
| `fiscal.fel_credenciales`  | `empresa_id`, `proveedor`, `ambiente`, `datos` bytea (cifrado con la clave de la instalación, como notify), `campos_visibles` jsonb (usuario o prefijo), `probada_en`, `resultado_prueba`                                                                                                                                                                                                                                                                                                                                                                      | Nunca salen por la API ni a la auditoría (`***`); solo se reemplazan                       |
| `fiscal.dte`               | `id`, `empresa_id`, `establecimiento_id`, `documento_tipo` (`factura`, `nota_credito`, `nota_debito`), `documento_id`, `tipo_dte`, `estado`, `proveedor`, `ambiente`, `identificador` uuid (único por envío, la clave de idempotencia ante el certificador), `autorizacion` (UUID SAT), `serie`, `numero`, `fecha_emision`, `certificado_en`, `receptor` jsonb (tipo, id, nombre), `total`, `iva`, `contingencia` bool, `intentos`, `proximo_intento`, `ultimo_error`, `xml` y `pdf` (rutas en el almacenamiento), `anulado_en`, `motivo_anulacion`, `version` | Único (`documento_tipo`, `documento_id`) entre no rechazados; único `autorizacion` no nula |
| `fiscal.dte_intentos`      | `dte_id`, `operacion` (`certificar`, `anular`, `consultar`), `enviado_en`, `respuesta` jsonb (sin credenciales), `resultado`, `duracion_ms`                                                                                                                                                                                                                                                                                                                                                                                                                    | Solo inserción; es la bitácora ante el certificador (como `audit.red`)                     |
| `fiscal.tipos_dte`         | `pais`, `codigo`, `nombre`, `regimenes[]`, `afecta_iva`, `requiere_referencia`, `fuente`                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Catálogo del paquete                                                                       |

### 3.7 Cierres, bloqueos, libros y declaraciones

| Tabla                        | Columnas clave                                                                                                                                                                                                                                                                                                                        | Restricciones                                                                                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ledger.bloqueos`            | `empresa_id`, `tipo` (`normal`, `duro`), `hasta` date, `motivo`, `creado_por`, `created_at`                                                                                                                                                                                                                                           | Solo inserción. El bloqueo vigente de cada tipo es la última fila. Un `duro` nuevo debe ser posterior al anterior (trigger); el `normal` nunca queda antes del `duro` |
| `ledger.cierres_anuales`     | `empresa_id`, `anio`, `resultado`, `isr`, `reserva_legal`, `asientos[]`, `cerrado_por`, `cerrado_en`                                                                                                                                                                                                                                  | Único (`empresa_id`, `anio`); solo inserción                                                                                                                          |
| `fiscal.libros_habilitados`  | `empresa_id`, `libro`, `tipo` (`computarizado`), `autorizacion` (SAT-7121 y Registro Mercantil), `folio_desde`, `folio_hasta`, `fecha`                                                                                                                                                                                                | Solo inserción                                                                                                                                                        |
| `fiscal.libros_emisiones`    | `empresa_id`, `libro`, `desde`, `hasta`, `folio_inicial`, `folio_final`, `formato` (`pdf`, `xlsx`), `archivo`, `sha256`, `generado_por`                                                                                                                                                                                               | Solo inserción. Folios correlativos por (`empresa_id`, `libro`) y dentro de un rango habilitado                                                                       |
| `fiscal.obligaciones`        | `empresa_id`, `impuesto`, `periodo_desde`, `periodo_hasta`, `formulario`, `vence_en`, `estado` (`pendiente`, `borrador`, `presentada`, `no_aplica`), `declaracion_id`                                                                                                                                                                 | Único (`empresa_id`, `impuesto`, `periodo_desde`). Es el calendario fiscal                                                                                            |
| `fiscal.declaraciones`       | `id`, `empresa_id`, `impuesto`, `periodo_desde`, `periodo_hasta`, `version` (1, 2…), `formulario`, `vence_en`, `parametros` jsonb (clave, valor, `vigente_desde`, fuente), `detalle` jsonb (renglones), `totales` jsonb, `datos_hash`, `calculada_por`, `calculada_en`, `estado` (`borrador`, `revisada`, `presentada`, `sustituida`) | Solo inserción de versiones; `presentada` guarda `numero_formulario`, `fecha_presentacion` y `boleta` que escribe el usuario                                          |
| `fiscal.ajustes_fiscales`    | `empresa_id`, `anio`, `concepto`, `tipo` (`no_deducible`, `exento`, `diferencia_temporal`), `monto`, `cuenta_id`, `motivo`, `creado_por`                                                                                                                                                                                              | Solo inserción; los usa el ISR anual y el trimestral por cierre parcial                                                                                               |
| `fiscal.iso_acreditamientos` | `empresa_id`, `declaracion_iso_id`, `monto`, `acreditado_contra` (declaración ISR), `vence_en` (3 años, inv. A.4)                                                                                                                                                                                                                     | Solo inserción                                                                                                                                                        |

## 4. Versionado

- **Localización.** Cada versión del paquete (`gt-2026.1`, `gt-2027.1`…) declara qué agrega: cuentas nuevas, parámetros nuevos o valores nuevos **con su `vigente_desde`**. Instalarla en una empresa (`fiscal.actualizar_localizacion`) inserta solo lo que falta; nunca borra ni cambia una cuenta, un valor o una frase. Una versión del paquete no puede quitar cuentas.
- **Parámetros.** Editar = insertar una fila con `vigente_desde`. No se admite un `vigente_desde` dentro de un periodo con bloqueo (422 `vigencia_en_periodo_bloqueado`), porque cambiaría documentos ya reportados. Cada inserción deja `audit.acciones` (`fiscal.editar_parametros`) y `audit.cambios` (`entidad_tipo = parametro_fiscal`, antes y después en la fecha).
- **Documentos.** Facturas, DTE, compras y declaraciones guardan los parámetros con que se calcularon (`reglas_snapshot`, `declaraciones.parametros`). Recalcular un periodo viejo usa los valores vigentes en su fecha.
- **Cambio de ley.** El líder publica `gt-AAAA.n` con la fila nueva; el administrador la instala por empresa o para todas. Mientras tanto, cualquier empresa puede adelantarse con un valor propio.

## 5. Catálogo de parámetros GT

Alcance: **N** = lo fija la ley (no editable), **G** = valor global que la empresa puede sobrescribir, **E** = de la empresa. "Contador" = confirmar con contador. Los números de la última columna son los de la tabla de parámetros del informe.

| Clave                                 | Por defecto                                                                                         | Fuente              | Alcance    | Nota                                                                                                    |
| ------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------- | ---------- | ------------------------------------------------------------------------------------------------------- |
| `moneda`                              | GTQ                                                                                                 | inv. B.4            | N          | #1                                                                                                      |
| `ejercicio`                           | 1-ene a 31-dic                                                                                      | inv. A.2, B.2       | N          | #2                                                                                                      |
| `inicio_libros`                       | fecha de instalación                                                                                | diseño              | E          | Desde cuándo ArgosIsp es el libro oficial (§11)                                                         |
| `tipo_cambio_fuente`                  | Banguat `TipoCambioDia`                                                                             | inv. B.4            | G          | #3; horario de publicación: contador                                                                    |
| `iva_tasa`                            | 12 %                                                                                                | inv. A.1            | G          | #4                                                                                                      |
| `iva_incluido`                        | sí                                                                                                  | inv. A.1            | N          | #5                                                                                                      |
| `regimen`                             | `utilidades`                                                                                        | inv. A.2 (art. 50)  | E          | `utilidades`, `opcional_simplificado`, `pequeno_contribuyente`. Solo con `vigente_desde` = 1-ene (§6.2) |
| `iva_declaracion`                     | mensual, mes siguiente, SAT-2237                                                                    | inv. A.1            | G          | #7                                                                                                      |
| `credito_fiscal_ventana_meses`        | 2                                                                                                   | inv. A.1 (art. 20)  | G          | #8                                                                                                      |
| `nota_ventana_meses`                  | 2                                                                                                   | inv. A.1 (art. 17)  | G          | #9                                                                                                      |
| `agente_retencion_iva`                | no                                                                                                  | inv. A.1            | E          | Bandera de la empresa                                                                                   |
| `contribuyente_especial`              | no                                                                                                  | inv. A.1, A.2       | E          | Bandera; con agente, exige EEFF auditados (#57)                                                         |
| `ret_iva_especial`                    | 15 % del IVA                                                                                        | inv. A.1            | G          | #10                                                                                                     |
| `ret_iva_sector_publico`              | 25 % del IVA                                                                                        | inv. A.1            | G          | #11                                                                                                     |
| `ret_iva_exportador`                  | 15 % y 65 %                                                                                         | inv. A.1            | G          | #12                                                                                                     |
| `ret_iva_tarjeta`                     | 15 % (1.5 % combustibles)                                                                           | inv. A.1            | G          | #13                                                                                                     |
| `ret_iva_minimo`                      | Q2,500.00                                                                                           | inv. A.1            | G          | #14; sector público Q2,500 o Q30,000: contador                                                          |
| `ret_iva_pequeno`                     | 5 % del total si ≥ Q2,500.01                                                                        | inv. A.1            | G          | #15                                                                                                     |
| `ret_iva_plazo`                       | 15 días hábiles del mes siguiente, SAT-2340                                                         | inv. A.1            | G          | #16                                                                                                     |
| `pc_tasa`                             | 5 %                                                                                                 | inv. A.3            | G          | #17                                                                                                     |
| `pc_limite_anual`                     | Q500,285.00 (2026)                                                                                  | inv. A.3            | G          | #18; se actualiza cada año                                                                              |
| `pc_alertas`                          | 80 % y 100 %                                                                                        | inv. tabla #19      | E          | Umbrales del tablero                                                                                    |
| `pc_declaracion`                      | mensual, mes siguiente, SAT-2046                                                                    | inv. A.3            | G          |                                                                                                         |
| `isr_utilidades_tasa`                 | 25 %                                                                                                | inv. A.2 (art. 36)  | G          | #21                                                                                                     |
| `isr_trimestral_metodo`               | `renta_presunta`                                                                                    | inv. A.2 (art. 38)  | E          | `renta_presunta` o `cierre_parcial`; cambiarlo exige autorización de la SAT: el panel lo advierte       |
| `isr_trimestral_presunta`             | 8 %                                                                                                 | inv. A.2            | G          | #23                                                                                                     |
| `isr_trimestral_plazo`                | mes siguiente; el 4.º con la anual; SAT-1361                                                        | inv. A.2            | G          | #24; LAT dice 10 días: contador                                                                         |
| `isr_anual_plazo`                     | 31-mar, SAT-1411                                                                                    | inv. A.2            | G          | #25                                                                                                     |
| `isr_opcional_tramos`                 | 5 % hasta Q30,000; Q1,500 + 7 % del excedente                                                       | inv. A.2 (art. 44)  | G          | #26                                                                                                     |
| `isr_opcional_directo`                | 7 %                                                                                                 | inv. A.2 (art. 46)  | G          | #27                                                                                                     |
| `isr_opcional_no_retenido`            | `art46_directo`                                                                                     | inv. E.1            | E          | `art46_directo` o `art44_escala`. Contador (NO VERIFICADO 14)                                           |
| `isr_opcional_retencion`              | 7 %                                                                                                 | inv. A.2 (art. 48)  | G          | #28                                                                                                     |
| `isr_opcional_plazo`                  | 10 días hábiles del mes siguiente, SAT-1311                                                         | inv. A.2            | G          | #29                                                                                                     |
| `isr_dividendos`                      | 5 %                                                                                                 | inv. A.2            | G          | #30                                                                                                     |
| `isr_capital_premios`                 | 10 %                                                                                                | inv. A.2, F.2       | G          | #31                                                                                                     |
| `isr_no_residentes`                   | datos 5 %, honorarios 15 %, otras 25 %                                                              | inv. A.2 (art. 104) | G          | #32–34                                                                                                  |
| `isr_retenciones_plazo`               | 10 días del mes siguiente                                                                           | inv. A.2            | G          | #35; formulario: contador (NO VERIFICADO 10)                                                            |
| `iso_tasa`                            | 1 %                                                                                                 | inv. A.4            | G          | #36                                                                                                     |
| `iso_base`                            | mayor de ¼ activo neto y ¼ ingresos brutos                                                          | inv. A.4            | G          | #37; periodo de referencia: contador                                                                    |
| `iso_umbral_margen`                   | > 4 %                                                                                               | inv. A.4            | G          | #38                                                                                                     |
| `iso_acreditamiento`                  | `iso_a_isr`                                                                                         | inv. A.4            | E          | `iso_a_isr` (3 años) o `isr_a_iso` (mismo año)                                                          |
| `iso_plazo`                           | mes siguiente, SAT-1608                                                                             | inv. A.4            | G          | #40                                                                                                     |
| `iso_regla_4x`, `iso_exencion_inicio` | sin valor                                                                                           | inv. A.4            | G          | NO VERIFICADO: no se aplican hasta que el contador los llene                                            |
| `depreciacion`                        | computación 33.33; maquinaria y vehículos 20; mobiliario 20; herramientas 25; edificios 5; otros 10 | inv. A.2 (art. 28)  | E (tope N) | #41–46; equipo de telecom = otros 10 %: contador                                                        |
| `reserva_incobrables_max`             | 3 %                                                                                                 | inv. A.2            | G          | #47                                                                                                     |
| `reserva_indemnizaciones_max`         | 8.33 %                                                                                              | inv. A.2            | G          | #48                                                                                                     |
| `limites_deduccion`                   | parientes 10 %; exterior 5 %; viáticos 3 %; donaciones ONG 5 % y Q500,000                           | inv. A.2            | G          | #49                                                                                                     |
| `reserva_legal_pct`                   | 5 % (mínimo 5)                                                                                      | inv. B.3            | E          | #50                                                                                                     |
| `reserva_legal_base`                  | `despues_isr`                                                                                       | inv. B.3            | E          | #51, confianza baja: contador                                                                           |
| `marco_contable`                      | `niif_pymes`                                                                                        | inv. B.2            | E          | #58                                                                                                     |
| `requiere_auditoria`                  | derivado                                                                                            | inv. A.2, B.2       | E          | #57                                                                                                     |
| `fel_modo`                            | `obligatoria` (régimen general y PC)                                                                | inv. C              | E          | #59; ver §8.3                                                                                           |
| `consumidor_final_limite`             | < Q2,500.00                                                                                         | inv. C.2            | G          | #66                                                                                                     |
| `dte_anulacion_plazo`                 | mes de emisión, hasta el vencimiento del IVA                                                        | inv. C.3            | G          | #67                                                                                                     |
| `fel_contingencia_plazo`              | sin valor                                                                                           | inv. C.3            | G          | NO VERIFICADO 7: contador                                                                               |
| `mora_tributaria`                     | 0.0005 diario                                                                                       | inv. E.2            | G          | #68                                                                                                     |
| `multa_declaracion_tardia`            | Q50 por día, máximo Q1,000                                                                          | inv. E.2            | G          | #69                                                                                                     |
| `interes_resarcitorio`                | sin valor                                                                                           | inv. E.2            | G          | #70; NO VERIFICADO 9: contador                                                                          |
| `conservacion_anios`                  | indefinida (mínimo 5)                                                                               | inv. B.1            | G          | #56                                                                                                     |
| `libros_ventana_meses`                | 2                                                                                                   | inv. B.1            | G          | #55                                                                                                     |
| `mora_con_iva`                        | no (decisión del PM)                                                                                | inv. A.1 (art. 12)  | E          | Interpretación de A3: el art. 12 podría incluirla; el contador decide si se activa                      |

Regla: un parámetro **sin valor** y marcado contador bloquea solo el cálculo que lo necesita, con 422 `parametro_sin_confirmar` (`errors[0].field` = la clave). Nada se inventa.

## 6. Plan de cuentas e impuestos

### 6.1 Cuentas GT que se agregan

Se respetan los códigos actuales (`1.1.03` es CxC, `2.1.02` es IVA débito); no se copian los de Odoo (inv. D.1).

| Código       | Cuenta                                                                            | Tipo       | Notas                                                 |
| ------------ | --------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------- |
| 1.1.04       | IVA crédito fiscal                                                                | activo     | Remanente del mes anterior incluido                   |
| 1.1.05       | IVA retenido por clientes                                                         | activo     | Constancias recibidas (inv. A.1)                      |
| 1.1.06       | ISR retenido por clientes                                                         | activo     | Régimen opcional (inv. A.2, art. 48)                  |
| 1.1.07       | ISR pagos trimestrales                                                            | activo     | Anticipos del régimen sobre utilidades                |
| 1.1.08       | ISO por acreditar                                                                 | activo     | Con vencimiento de 3 años (inv. A.4)                  |
| 1.1.09       | Pagos anticipados de impuestos                                                    | activo     | ISR 10 % y timbre de sorteos (lealtad)                |
| 1.2.01.01–07 | Equipo de red, computación, mobiliario, vehículos, herramientas, edificios, otros | activo     | `libro_inventario`                                    |
| 1.2.02.01–07 | Depreciación acumulada (una por clase)                                            | activo     | Contracuenta, naturaleza acreedora                    |
| 2.1.03       | Proveedores                                                                       | pasivo     | `auxiliar_proveedor`                                  |
| 2.1.04       | Retenciones de IVA por pagar                                                      | pasivo     | Si la empresa es agente                               |
| 2.1.05       | Retenciones de ISR por pagar                                                      | pasivo     | No residentes, facturas especiales, premios, opcional |
| 2.1.06       | IVA por pagar                                                                     | pasivo     | Resultado de la liquidación mensual                   |
| 2.1.07       | ISR por pagar                                                                     | pasivo     |                                                       |
| 2.1.08       | ISO por pagar                                                                     | pasivo     |                                                       |
| 2.1.09       | Impuesto de pequeño contribuyente por pagar                                       | pasivo     | 5 % mensual                                           |
| 2.1.10       | Pasivo del programa de lealtad                                                    | pasivo     | Ingreso diferido (contrato de lealtad)                |
| 2.1.11       | IVA por certificar                                                                | pasivo     | Avisos de cobro con certificación al pagar (§8.3)     |
| 3.1.01       | Capital social                                                                    | patrimonio |                                                       |
| 3.2.01       | Reserva legal                                                                     | patrimonio | inv. B.3                                              |
| 3.3.01       | Utilidades acumuladas                                                             | patrimonio |                                                       |
| 3.3.02       | Resultado del ejercicio                                                           | patrimonio |                                                       |
| 3.3.03       | Pérdidas y ganancias                                                              | patrimonio | Transitoria del cierre anual                          |
| 4.1.05       | Ingresos diferidos por lealtad                                                    | ingreso    | Contracuenta (deudora)                                |
| 4.1.06       | Ingresos por puntos canjeados o vencidos                                          | ingreso    |                                                       |
| 4.2.01       | Diferencial cambiario                                                             | ingreso    |                                                       |
| 5.1.03       | Premios y promociones                                                             | gasto      | Sorteos y premios en bienes                           |
| 5.3.01       | Depreciaciones                                                                    | gasto      |                                                       |
| 5.3.02       | Cuentas incobrables                                                               | gasto      | Reserva ≤ 3 %                                         |
| 5.3.03       | Impuestos y tasas deducibles                                                      | gasto      | Incluye el ISO no acreditado vencido                  |
| 5.3.04       | Impuesto de pequeño contribuyente                                                 | gasto      |                                                       |
| 5.4.01       | Gastos no deducibles                                                              | gasto      | `categoria_fiscal = no_deducible`                     |
| 5.4.02       | Multas, recargos e intereses tributarios                                          | gasto      | No deducibles (inv. E.2)                              |
| 5.5.01       | Impuesto sobre la renta                                                           | gasto      |                                                       |

`categoria_fiscal` marca cuentas para el ISR anual: `no_deducible`, `limite_parientes`, `limite_exterior`, `limite_viaticos`, `donacion_ong`, `publicidad`, `depreciacion`. Las categorías de egreso (`5.2.xx`) conservan su cuenta.

### 6.2 Impuestos y su cálculo

| Impuesto                  | Base y cálculo                                                                                                                                                                                 | Fuente                      |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| IVA débito (general)      | Precio con IVA incluido menos descuentos; `iva = total − total / (1 + iva_tasa)` por línea, redondeo al final (como hoy)                                                                       | inv. A.1, F.1               |
| IVA en recargos por mora  | Por defecto la mora **no** lleva IVA (decisión del PM) y es opcional por empresa o plantilla. Si el contador activa `mora_con_iva`, el art. 12 la incluiría en la base; aplica solo a lo nuevo | inv. A.1; contador          |
| IVA crédito               | IVA de compras con `credito_fiscal`, `periodo_iva` dentro de la ventana (`fecha_documento` + 2 meses); fuera de ella: 422 `credito_fiscal_extemporaneo`, o la compra entra sin crédito         | inv. A.1 (arts. 16, 18, 20) |
| Pequeño contribuyente     | Las facturas **no desglosan IVA** (`iva = 0`, FPEQ). Impuesto mensual = `pc_tasa` × ingresos brutos del mes − retenciones del 5 % recibidas                                                    | inv. A.3                    |
| Retención de IVA recibida | Constancia del cliente agente o del Estado: menor CxC y crédito contra el débito                                                                                                               | inv. A.1                    |
| Retención de IVA emitida  | Solo si la empresa es agente: % según el proveedor, desde `ret_iva_minimo`                                                                                                                     | inv. A.1                    |
| ISR opcional mensual      | Ingresos del mes sin IVA, escala del art. 44, menos retenciones del 7 % recibidas; lo no retenido según `isr_opcional_no_retenido` (el borrador muestra los dos cálculos)                      | inv. A.2, E.1               |
| ISR trimestral            | `renta_presunta`: `isr_utilidades_tasa` × 8 % × ingresos brutos del trimestre sin exentos. `cierre_parcial`: 25 % × resultado del trimestre ± ajustes fiscales                                 | inv. A.2 (art. 38)          |
| ISO trimestral            | Solo en `utilidades` y con margen bruto > 4 %: `iso_tasa` × max(¼ activo neto, ¼ ingresos brutos), con el acreditamiento elegido                                                               | inv. A.4                    |
| ISR anual                 | (Renta bruta − exentas − costos y gastos deducibles con sus límites) × 25 % − trimestrales − ISO acreditable                                                                                   | inv. A.2                    |
| Retenciones ISR emitidas  | No residentes por categoría, factura especial (escala del opcional), premios 10 %, dividendos 5 %                                                                                              | inv. A.2, F.2               |

**Régimen.** `fiscal.cambiar_regimen` solo acepta `vigente_desde` = 1 de enero de un año futuro, y pide fecha y número del aviso a la SAT (inv. A.2, art. 51: aviso en diciembre). La primera configuración de la empresa admite cualquier fecha (inscripción). El sistema nunca lo cambia solo, tampoco al superar el límite de pequeño contribuyente: avisa (§9).

**Tipo de DTE por régimen** (inv. C.1): `utilidades` y `opcional_simplificado` → FACT (FCAM a crédito), NCRE, NDEB; `pequeno_contribuyente` → FPEQ (FCAP a crédito). Otro tipo: 422 `tipo_dte_no_permitido`. NABN no se emite hasta aclarar su diferencia con NCRE (NO VERIFICADO 6).

**Frases** (inv. C.2): se derivan del régimen vigente en la fecha del documento: escenario 1 "Sujeto a pagos trimestrales ISR", escenario 2 "Sujeto a retención definitiva ISR", en FACT, NCRE y NDEB. Pequeño contribuyente: "No genera derecho a crédito fiscal" (código vigente: contador). Las demás (pago directo, exportación) se agregan a mano en `fiscal.frases`.

## 7. Libros

Todos son reportes de `#fiscal/libros` con la misma salida que `/reportes/*` (`columnas`, `filas`, `totales`) y exportación PDF y XLSX. Llevan encabezado con razón social, NIT, nombre legal del libro (inv. B.1: usar el nombre legal), periodo, folio y "Página N de M". El PDF repite "Van" y "Vienen" con los totales acumulados al pie y al inicio de cada página.

| Libro                         | Columnas                                                                                                                                                                         | Fuente de datos                                                                              |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Diario (primera entrada)      | Partida (correlativo por empresa y año, por `fecha, id`), fecha, cuenta (código y nombre), descripción, debe, haber; total por partida                                           | `ledger.asientos` y `movimientos`                                                            |
| Mayor (centralizador)         | Por cuenta: saldo inicial, fecha, partida, descripción, debe, haber, saldo; saldo final                                                                                          | `movimientos`                                                                                |
| Inventarios                   | A una fecha (apertura y 31-dic): cuenta, detalle, valor parcial y total; activo, pasivo y patrimonio; firma del comerciante y del contador                                       | Saldos de cuentas con `libro_inventario` (inv. A.2, art. 42; B.1)                            |
| Estados financieros           | Balance general, estado de resultados, flujo de efectivo (método indirecto desde el mayor) y, si aplica, costo de producción; firmas                                             | Amplía `estados_financieros.ts` (inv. B.2)                                                   |
| Compras y servicios recibidos | Fecha, tipo, serie, número, NIT, proveedor, bienes, servicios, importaciones, exento, IVA, total, retención IVA, retención ISR, crédito sí/no, periodo IVA                       | `ledger.compras` por `periodo_iva`                                                           |
| Ventas y servicios prestados  | Fecha, tipo DTE, serie, número, autorización, NIT/CUI/CF, cliente, bienes, servicios, exportación, exento, IVA, total, estado (anulado = valores en cero), retenciones recibidas | `fiscal.dte` certificados del mes y, sin FEL, `billing.facturas` emitidas y notas de crédito |

- Las columnas de los libros de IVA son propuesta de A3; el formato exacto exigido por la SAT no está en el informe: contador.
- **Emisión oficial** (`POST /libros/:libro/emitir`): solo de un rango con mes cerrado **y** bloqueo normal o duro (422 `periodo_sin_bloqueo`). Toma el siguiente folio del libro (`fiscal.libros_emisiones`), dentro de un rango habilitado (`fiscal.libros_habilitados`; 422 `folios_agotados`). Guarda archivo y SHA-256. Volver a emitir el mismo rango crea otra emisión con folios nuevos y la marca de reimpresión.
- Vista previa (`GET /libros/:libro`): cualquier rango, marca de agua "Borrador sin folio".
- Pequeño contribuyente: solo el libro de compras y ventas (inv. A.3).
- Plazo: el tablero avisa si un libro no se emitió dentro de `libros_ventana_meses` (multa de Q5,000; inv. E.2).

## 8. FEL

### 8.1 Interfaz del proveedor

`apps/api/app/fiscal/fel/proveedor.ts`, registro por código como `pasarelas/pasarela.ts`:

```ts
interface ProveedorFel {
    readonly codigo: string // 'infile', 'digifact', 'sat'
    readonly capacidades: { contingencia: boolean; consultaNit: boolean; pdf: boolean }
    probarCredenciales(cred: CredencialesFel, ambiente: Ambiente): Promise<ResultadoPrueba>
    certificar(dte: DteParaEnviar, cred: CredencialesFel): Promise<ResultadoCertificacion>
    anular(dte: DteCertificado, motivo: string, cred: CredencialesFel): Promise<ResultadoAnulacion>
    consultar(identificador: string, cred: CredencialesFel): Promise<ResultadoConsulta>
    consultarNit?(nit: string, cred: CredencialesFel): Promise<{ nombre: string } | null>
}
```

- `DteParaEnviar` es neutral (emisor, establecimiento, receptor, líneas con IVA, frases, referencia a la factura original en NCRE y NDEB, `identificador`). El XML de la SAT lo arma un módulo común `fel/xml_gt.ts`; el adaptador solo lo firma y lo envía como pida su certificador.
- `ResultadoCertificacion`: `certificado` (autorización, serie, número, fecha, XML, PDF opcional), `rechazado` (definitivo, con los errores de la SAT) o `error_temporal` (red, 5xx, tiempo agotado).
- Hoy solo `infile`. `falso` para laboratorio y pruebas (como la pasarela falsa). Digifact y el certificador SAT se agregan sin tocar nada más.

### 8.2 Estados del DTE

```
pendiente → enviando → certificado → anulacion_pendiente → anulado
              ↘ error_temporal → (reintento) enviando
              ↘ rechazado (definitivo)
pendiente → contingencia → enviando → certificado
```

- `enviando` es corto: la acción toma el DTE con `FOR UPDATE SKIP LOCKED`. Si el proceso cae, el reintento **consulta primero** por `identificador` (no duplica).
- `rechazado` no se reintenta: la factura queda `por_certificar` con el error visible; se corrige el dato (por ejemplo, el NIT del cliente) y `fel.reintentar` crea un DTE nuevo con otro `identificador`.
- Cada transición deja fila en `fiscal.dte_intentos` y auditoría; los cambios de estado emiten eventos (§10).

### 8.3 Modos de emisión por empresa

| Modo                                                                 | Factura                                                                                                         | Asiento y `factura.emitida`                                                                                                                                                                             |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `obligatoria` + `certificar_al = emitir`                             | Nace `por_certificar`; no cuenta para el corte                                                                  | Al certificarse: la acción `facturas.confirmar_emision` escribe el asiento con la fecha de certificación, pasa a `emitida`, emite `factura.emitida` y aplica anticipos                                  |
| `certificar_al = pagar` (cualquier modo; por defecto en recurrentes) | Nace `emitida` como **aviso de cobro** (cuenta para el corte); se certifica al registrarse el pago que la cubre | Asiento con `2.1.11 IVA por certificar` en lugar de IVA débito; al certificar (con el pago), reclasificación `2.1.11 / 2.1.02`. Momento del IVA en servicios: contador (inv. A.1, art. 4; C.3, art. 34) |
| `opcional`                                                           | Como hoy                                                                                                        | Se certifica a mano (`POST /facturas/:id/certificar`) o en lote (`POST /fel/lotes`)                                                                                                                     |
| `desactivada`                                                        | Como hoy                                                                                                        | Sin DTE. El tablero muestra la alerta permanente "FEL es obligatoria para su régimen" (inv. C, inferencia de diseño)                                                                                    |

- `certificar_al = nunca` solo se permite en `opcional` y `desactivada` (422 `certificar_al_incompatible`). `pagar` es válido en todos los modos (decisión del PM); un aviso que nunca se paga nunca se certifica y no genera DTE.
- La cola es BullMQ `fel` (worker `node ace fiscal:worker`, con lock): reintentos con backoff exponencial (1, 5, 15, 60 min y luego cada hora), tope configurable; al agotarse emite `dte.rechazado` con `definitivo: false` y alerta.
- **Contingencia.** El procedimiento oficial no se verificó (NO VERIFICADO 7). Diseño: contabilidad la activa por empresa (`fel.activar_contingencia`, con motivo) o el worker la propone tras N fallos seguidos (no la activa solo). Con contingencia activa, en `obligatoria` la factura se trata como emitida (asiento y evento) y su DTE queda `contingencia`, en cola para cuando vuelva el servicio. El plazo máximo para regularizar es `fel_contingencia_plazo`, sin valor hasta que el contador lo confirme.
- **Consumidor final.** Total < `consumidor_final_limite` → CF permitido. Desde el límite exige NIT, CUI o pasaporte del cliente (422 `receptor_requerido`; en `obligatoria` el DTE queda `rechazado` local sin enviarse y la factura `por_certificar`). El tablero señala varias facturas CF del mismo cliente en el mismo día que juntas pasan el límite (la SAT fiscaliza el fraccionamiento; inv. C.2).
- **Anulación.** `facturas.anular` sobre una factura con DTE certificado verifica `dte_anulacion_plazo` (mes de emisión y antes del vencimiento del IVA de ese mes; inv. C.3). Dentro del plazo: el DTE pasa a `anulacion_pendiente` y la anulación interna (reverso, `factura.anulada`, reevaluación) se completa cuando el certificador confirma. Fuera de plazo: 422 `anulacion_fuera_de_plazo` con la sugerencia de nota de crédito.
- **Notas de crédito.** `facturas.nota_credito` genera una NCRE con referencia (número y fecha de la factura) y la frase de ISR; solo dentro de `nota_ventana_meses` desde la factura (422 `nota_fuera_de_plazo`; inv. A.1, art. 17). En `obligatoria` el asiento de la nota espera su certificación, igual que la factura.
- **Notas de débito.** La mora, con `mora_con_iva`, sale como NDEB referida a la factura vencida (inv. C.1). Contador.
- El PDF del DTE lo genera ArgosIsp con la marca de la empresa (A5) y los datos FEL; si el certificador devuelve PDF se guarda también.

## 9. Cierres, bloqueos, declaraciones y tablero

### 9.1 Cierre anual

`libro.cerrar_ejercicio { anio, empresa_id }`: exige enero a noviembre cerrados, diciembre abierto, ningún DTE `pendiente`, `enviando` o `contingencia` del año, y la declaración ISR anual del año en `revisada` (para el monto del ISR). En una transacción, con fecha 31-dic y origen `cierre_anual` (inv. B.3):

1. Provisión del ISR: `5.5.01 / 1.1.07 + 1.1.08 (lo acreditable) + 2.1.07`.
2. Cancelación de ingresos y gastos contra `3.3.03 Pérdidas y ganancias`.
3. Traslado de `3.3.03` a `3.3.02 Resultado del ejercicio` y de ahí a `3.3.01 Utilidades acumuladas`.
4. Reserva legal si hubo utilidad: `reserva_legal_pct` × la base de `reserva_legal_base`, `3.3.01 / 3.2.01`. El 15 % del capital es el umbral para capitalizar, no un tope.
5. Cierra diciembre (`cerrar_periodo`) y guarda `ledger.cierres_anuales`.

El procedimiento detallado no está en una norma (NO VERIFICADO, inv. B.3): los pasos son la práctica estándar y el contador los revisa. Un cierre anual no se reabre si hay bloqueo duro; sin él, `libro.reabrir_ejercicio` (solo `admin`) revierte los asientos de cierre con fecha de hoy.

### 9.2 Bloqueos (inv. D.2)

| Tipo     | Quién                                                     | Efecto                                                                                                                               |
| -------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `normal` | `contabilidad` (`libro.bloquear`)                         | Ningún asiento con fecha ≤ `hasta`. Se puede mover hacia atrás con motivo (`libro.desbloquear`)                                      |
| `duro`   | `admin` (`libro.bloquear_duro`), con confirmación escrita | Irreversible: una fila posterior solo puede avanzar la fecha. Exige meses cerrados, sin DTE pendientes y sin compras sin periodo IVA |

`ledger.periodo_cerrado(fecha, empresa_id)` pasa a ser verdadero también si `fecha <= bloqueo`. `reabrir_periodo` sobre un mes bajo bloqueo duro: 409 `bloqueo_duro`. Los asientos de un periodo bloqueado se corrigen con reverso fechado hoy, como ya pasa con los meses cerrados.

### 9.3 Declaraciones (borradores, nunca se envían)

| Impuesto               | Formulario | Vence                               | Régimen               | Fuente   |
| ---------------------- | ---------- | ----------------------------------- | --------------------- | -------- |
| `iva_mensual`          | SAT-2237   | último día del mes siguiente        | utilidades, opcional  | inv. A.1 |
| `pc_mensual`           | SAT-2046   | mes siguiente                       | pequeño contribuyente | inv. A.3 |
| `isr_opcional_mensual` | SAT-1311   | 10 días hábiles del mes siguiente   | opcional              | inv. A.2 |
| `isr_trimestral`       | SAT-1361   | mes siguiente (el 4.º con la anual) | utilidades            | inv. A.2 |
| `iso_trimestral`       | SAT-1608   | mes siguiente                       | utilidades            | inv. A.4 |
| `isr_anual`            | SAT-1411   | 31-mar                              | utilidades            | inv. A.2 |
| `retenciones_iva`      | SAT-2340   | 15 días hábiles del mes siguiente   | agentes               | inv. A.1 |
| `retenciones_isr`      | contador   | 10 días del mes siguiente           | quien retenga         | inv. A.2 |

- El calendario (`fiscal.obligaciones`) lo genera el cron `fiscal:calendario` para todo lo pendiente hasta el mes en curso, según el régimen y las banderas vigentes en cada periodo; idempotente por la clave única.
- `declaraciones.calcular` crea una versión nueva con `detalle` (cada renglón con su origen: DTE, compra, constancia, cuenta), `totales`, los parámetros usados y `datos_hash` (hash de lo leído). Al abrirla, si los datos cambiaron (otro hash), la API lo dice y `presentar` responde 409 `declaracion_desactualizada`.
- `declaraciones.marcar_presentada` guarda lo que el usuario presentó en la Agencia Virtual: número de formulario, fecha y boleta. Opcionalmente genera el asiento de liquidación (IVA: `2.1.02 / 1.1.04 + 1.1.05 + 2.1.06`, el remanente queda en `1.1.04`).
- `declaraciones.registrar_pago` hace `2.1.06 | 2.1.07 | 2.1.08 | 2.1.09 | 2.1.04 | 2.1.05 / Banco`. Si el pago es tardío calcula mora y multa con los parámetros (inv. E.2) y las separa en `5.4.02`.
- ISO e ISR: `fiscal.iso_acreditamientos` lleva el saldo por acreditar y su vencimiento; al vencer los 3 años, el cierre anual pasa el remanente a `5.3.03` (inv. A.4).

### 9.4 Tablero fiscal (`GET /fiscal/tablero`)

Por empresa activa; con `?empresas=todas`, una sección por empresa y totales solo informativos (regla 13). Lee vistas materializadas `fiscal.resumen_*` refrescadas por evento (`factura.*`, `dte.*`, `compra.*`, `pago.*`, `nota_credito.emitida`, `declaracion.*`), como el dashboard de billing.

| Bloque                  | Contenido                                                                                                                                    |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Facturado               | Mes y año, con y sin IVA, por tipo de DTE                                                                                                    |
| IVA                     | Débito, crédito, retenciones recibidas, saldo a pagar o remanente del mes en curso; compras cuyo crédito vence este mes (ventana de 2 meses) |
| ISR estimado            | Opcional: el del mes; utilidades: trimestral del trimestre en curso y anual proyectado; ISO del trimestre                                    |
| Pequeño contribuyente   | Facturado del año frente a `pc_limite_anual`, con alertas en los umbrales. Si se supera: "debe pasar al régimen general" (inv. A.3)          |
| Vencimientos            | Próximas obligaciones con días restantes; vencidas en rojo con mora estimada                                                                 |
| Comparador de regímenes | Ver abajo                                                                                                                                    |
| Consejos                | Ver abajo                                                                                                                                    |

Errores visibles: si una parte no se puede calcular (falta un parámetro, una vista no existe), ese bloque muestra el error y no un cero (regla 12).

**Comparador** (inv. E.1). Con los datos reales de los últimos 12 meses: `R` = ingresos mensuales sin IVA y `m` = margen fiscal (resultado antes de ISR ± ajustes fiscales, sobre `R`).

- Opcional: `0.07·R − 600` al mes si `R > 30,000` (5 % si no); utilidades: `0.25·m·R`, con el ISO como piso cuando es mayor.
- Margen de equilibrio `m* = 0.28 − 2,400 / R` (20 % si `R ≤ 30,000`). Se muestra `m`, `m*`, el ISR anual de cada régimen y la diferencia.
- Proyección a 12 meses con el crecimiento que el usuario escriba (por defecto, la tendencia de los últimos 12 meses).
- Matices fijos del informe: dividendos iguales en ambos; el 7 % plano del art. 46 con clientes que no retienen (se calcula también con `m* = 28 %`, NO VERIFICADO 14); pérdidas; el ISO; el cambio solo con aviso en diciembre y efecto el 1-ene; y que fragmentar la empresa para quedar en pequeño contribuyente no es planeación legítima.
- Sin botón de "aplicar": el cambio de régimen es la acción manual de §6.2.

**Consejos** (inv. E.2). Catálogo del paquete (`l10n/gt/consejos.ts`): cada uno tiene `clave`, texto, fuente (artículo e inv.) y una condición evaluada sobre los datos:

- compras ≥ Q2,500 sin NIT;
- crédito fiscal por vencer;
- reserva de incobrables sin usar (3 %);
- ISO por vencer sin acreditar;
- retenciones sin enterar (el gasto no es deducible hasta enterarla);
- pago tardío antes del requerimiento (rebaja del 85 % de la mora y del 50 % de los intereses);
- depreciación por debajo del máximo legal;
- forma del pago trimestral según el margen.

Todos llevan el aviso **"Referencia; valídelo con su contador"**. Se pueden ocultar por empresa (queda auditado).

## 10. API, permisos, eventos y errores

### 10.1 Endpoints (`/api/v1`)

| Método       | Ruta                                                                                                         | Permiso                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| POST         | `/empresas/:id/cambiar-pais` `{ pais }` (A1)                                                                 | `empresas.cambiar_pais`                                                     |
| GET          | `/fiscal/localizaciones`, `/fiscal/empresas/:id/localizacion`                                                | `fiscal.ver`                                                                |
| POST         | `/fiscal/empresas/:id/actualizar-localizacion` `{ codigo }`                                                  | `fiscal.instalar`                                                           |
| GET          | `/fiscal/parametros?fecha=` (valores vigentes con su origen y fuente), `/fiscal/parametros/:clave/historial` | `fiscal.ver`                                                                |
| POST         | `/fiscal/parametros/:clave/valores` `{ valor, vigente_desde, motivo }`                                       | `fiscal.editar_parametros`                                                  |
| POST         | `/fiscal/regimen` `{ regimen, vigente_desde, aviso_sat }`                                                    | `fiscal.cambiar_regimen`                                                    |
| GET/POST/PUT | `/fiscal/establecimientos[/:id]`                                                                             | `fiscal.ver` / `fiscal.configurar`                                          |
| GET/POST     | `/fiscal/frases`                                                                                             | `fiscal.ver` / `fiscal.configurar`                                          |
| GET/PUT      | `/fel/configuracion` (con `version`)                                                                         | `fel.ver` / `fel.configurar`                                                |
| PUT          | `/fel/credenciales/:ambiente` (multipart o JSON; responde sin secretos)                                      | `fel.configurar`                                                            |
| POST         | `/fel/credenciales/:ambiente/probar`                                                                         | `fel.configurar`                                                            |
| POST         | `/fel/activar-contingencia`, `/fel/desactivar-contingencia` `{ motivo }`                                     | `fel.contingencia`                                                          |
| GET          | `/dte`, `/dte/:id`, `/dte/:id/xml`, `/dte/:id/pdf`                                                           | `fel.ver`                                                                   |
| POST         | `/facturas/:id/certificar`, `/fel/lotes` `{ facturas[] \| desde, hasta }`                                    | `fel.certificar`                                                            |
| POST         | `/dte/:id/reintentar`                                                                                        | `fel.certificar`                                                            |
| GET/POST/PUT | `/proveedores[/:id]`                                                                                         | `proveedores.ver` / `proveedores.editar`                                    |
| GET          | `/compras`, `/compras/:id`                                                                                   | `compras.ver`                                                               |
| POST         | `/compras`, `/compras/desde-egreso/:egreso_id`                                                               | `compras.registrar`                                                         |
| POST         | `/compras/:id/anular` `{ motivo }`                                                                           | `compras.anular`                                                            |
| POST         | `/pagos-proveedores`, `/pagos-proveedores/:id/anular`                                                        | `compras.pagar`                                                             |
| GET          | `/libros/:libro?desde&hasta&formato` (vista previa)                                                          | `libros.ver`                                                                |
| POST         | `/libros/:libro/emitir` `{ desde, hasta, formato }`                                                          | `libros.emitir`                                                             |
| GET/POST     | `/libros/habilitaciones`                                                                                     | `libros.ver` / `libros.habilitar`                                           |
| POST         | `/libro/ejercicios/:anio/cerrar`, `/libro/ejercicios/:anio/reabrir`                                          | `libro.cerrar_ejercicio` / `libro.reabrir_ejercicio`                        |
| GET/POST     | `/libro/bloqueos` `{ tipo, hasta, motivo }`                                                                  | `libro.ver` / `libro.bloquear`, `libro.bloquear_duro`                       |
| POST         | `/libro/bloqueos/desbloquear` `{ hasta, motivo }`                                                            | `libro.desbloquear`                                                         |
| GET          | `/fiscal/obligaciones`, `/declaraciones`, `/declaraciones/:id[?formato=pdf\|xlsx]`                           | `declaraciones.ver`                                                         |
| POST         | `/declaraciones/calcular` `{ impuesto, periodo }`                                                            | `declaraciones.calcular`                                                    |
| POST         | `/declaraciones/:id/revisar`, `/marcar-presentada`, `/registrar-pago`                                        | `declaraciones.revisar` / `declaraciones.presentar` / `declaraciones.pagar` |
| GET          | `/fiscal/tablero`, `/fiscal/comparador?crecimiento=`                                                         | `fiscal.ver`                                                                |
| POST         | `/fiscal/consejos/:clave/ocultar`                                                                            | `fiscal.configurar`                                                         |

Todas las listas con cursor y `?empresas=todas` (solo alcance global). Las que mueven dinero o estado aceptan `Idempotency-Key`. `POST /pagos` acepta `retenciones[] { impuesto, numero, fecha, monto }`.

### 10.2 Permisos nuevos

`empresas.cambiar_pais`, `fiscal.ver`, `fiscal.configurar`, `fiscal.instalar`, `fiscal.editar_parametros`, `fiscal.cambiar_regimen`, `fel.ver`, `fel.configurar`, `fel.certificar`, `fel.anular`, `fel.contingencia`, `proveedores.ver`, `proveedores.editar`, `compras.ver`, `compras.registrar`, `compras.anular`, `compras.pagar`, `libros.ver`, `libros.emitir`, `libros.habilitar`, `libro.cerrar_ejercicio`, `libro.reabrir_ejercicio`, `libro.bloquear`, `libro.bloquear_duro`, `libro.desbloquear`, `declaraciones.ver`, `declaraciones.calcular`, `declaraciones.revisar`, `declaraciones.presentar`, `declaraciones.pagar`.

| Rol            | Agrega                                                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `admin`        | todos                                                                                                                      |
| `contabilidad` | todos menos `fiscal.instalar`, `fel.configurar`, `libro.bloquear_duro`, `libro.reabrir_ejercicio`, `empresas.cambiar_pais` |
| `cajero`       | `fel.ver` (ver el estado del DTE al cobrar)                                                                                |
| `lectura`      | los `.ver` (automático)                                                                                                    |

`fel.anular` lo pide `facturas.anular` cuando la factura tiene DTE (el actor necesita los dos).

### 10.3 Eventos nuevos

| Evento                                             | Emite     | Payload                                                                                                                         |
| -------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `fiscal.localizacion_instalada`                    | A3        | empresa_id, pais, codigo, de_codigo                                                                                             |
| `fiscal.parametros_cambiados`                      | A3        | empresa_id (null = global), claves[], vigente_desde                                                                             |
| `fiscal.config_cambiada`                           | A3        | empresa_id, campos[] (`regimen`, `fel_modo`, `proveedor`, `credenciales`, `establecimientos`, `frases`); nunca valores secretos |
| `dte.certificado`                                  | A3        | dte_id, empresa_id, documento_tipo, documento_id, tipo_dte, autorizacion, serie, numero, contingencia                           |
| `dte.rechazado`                                    | A3        | dte_id, empresa_id, documento_tipo, documento_id, error, definitivo                                                             |
| `dte.anulado`                                      | A3        | dte_id, empresa_id, documento_tipo, documento_id, motivo                                                                        |
| `fel.contingencia_cambiada`                        | A3        | empresa_id, activa, motivo                                                                                                      |
| `compra.registrada` / `compra.anulada`             | A3        | compra_id, empresa_id, proveedor_id, total, iva, periodo_iva                                                                    |
| `libro.bloqueo_cambiado`                           | A3        | empresa_id, tipo, hasta, anterior                                                                                               |
| `ejercicio.cerrado`                                | A3        | empresa_id, anio, resultado, reserva_legal                                                                                      |
| `declaracion.calculada` / `declaracion.presentada` | A3        | declaracion_id, empresa_id, impuesto, periodo_desde, periodo_hasta, vence_en, monto                                             |
| `fiscal.vencimiento_proximo`                       | A3 (cron) | obligacion_id, empresa_id, impuesto, vence_en, dias (7, 3, 1, 0; una vez por umbral)                                            |
| `fiscal.limite_pc`                                 | A3        | empresa_id, umbral_pct, acumulado, limite, anio (una vez por umbral y año)                                                      |

Cambio de significado: en modo `obligatoria` con `certificar_al = emitir`, `factura.emitida` sale al certificarse. El payload no cambia. Se actualiza `contratos/eventos.md` y la tabla de `CLAUDE.md` en la PR que lo implemente.

### 10.4 Errores (RFC 9457)

| `type` (sufijo)                 | Estado | Cuándo                                                          |
| ------------------------------- | ------ | --------------------------------------------------------------- |
| `pais_no_soportado`             | 422    | País sin paquete                                                |
| `empresa_con_documentos`        | 409    | Cambiar el país de una empresa con documentos                   |
| `localizacion_no_instalada`     | 422    | Operación fiscal en una empresa sin localización                |
| `parametro_no_editable`         | 422    | Alcance `N`                                                     |
| `parametro_fuera_de_rango`      | 422    | Fuera de `minimo`/`maximo`                                      |
| `parametro_sin_confirmar`       | 422    | Falta un valor marcado contador                                 |
| `vigencia_en_periodo_bloqueado` | 422    | `vigente_desde` bajo bloqueo                                    |
| `regimen_fuera_de_plazo`        | 422    | Cambio de régimen que no empieza el 1-ene                       |
| `fel_no_configurada`            | 422    | Certificar sin proveedor o credenciales                         |
| `fel_proveedor_no_disponible`   | 503    | El certificador no responde (en la petición síncrona de prueba) |
| `tipo_dte_no_permitido`         | 422    | DTE que no corresponde al régimen                               |
| `receptor_requerido`            | 422    | CF desde el límite                                              |
| `certificar_al_incompatible`    | 422    | `nunca` con FEL obligatoria                                     |
| `dte_en_proceso`                | 409    | Acción sobre un DTE `enviando`                                  |
| `anulacion_fuera_de_plazo`      | 422    | Fuera de la ventana de anulación                                |
| `nota_fuera_de_plazo`           | 422    | Nota después de 2 meses                                         |
| `compra_duplicada`              | 409    | Mismo proveedor, tipo, serie y número                           |
| `credito_fiscal_extemporaneo`   | 422    | `periodo_iva` fuera de la ventana                               |
| `periodo_sin_bloqueo`           | 422    | Emitir un libro oficial sin bloqueo                             |
| `folios_agotados`               | 422    | Sin rango habilitado                                            |
| `bloqueo_duro`                  | 409    | Reabrir o fechar bajo bloqueo duro                              |
| `bloqueo_regresivo`             | 422    | Mover el bloqueo duro hacia atrás                               |
| `ejercicio_incompleto`          | 422    | Meses abiertos, DTE pendientes o ISR anual sin revisar          |
| `ejercicio_cerrado`             | 409    | Cerrar dos veces                                                |
| `declaracion_desactualizada`    | 409    | El `datos_hash` cambió                                          |
| `declaracion_presentada`        | 409    | Recalcular una presentada (se crea una sustitutiva)             |

Todos con `errors[]` por campo cuando aplica.

## 11. Migración de lo existente

1. **A1**: `core.empresas.pais = 'GT'` para todas. Datos fiscales del cliente con `tipo_documento_fiscal = 'nit'` si `nit_cui` parece NIT, `cui` si tiene 13 dígitos, si no `cf`. Es una migración de datos de `core`, que sí admite `UPDATE`.
2. **A3**: instala `gt-2026.1` en cada empresa: cuentas que faltan (aditivo), valores del paquete con `vigente_desde = 2013-01-01` (o la fecha de la reforma que cita la fuente), `regimen` desde `core.empresas.regimen_isr` (`sujeto_pagos_trimestrales` → `utilidades`, `retencion_definitiva` → `opcional_simplificado`, `pequeno_contribuyente` igual) y el establecimiento 1 desde `codigo_establecimiento`.
3. `fel_configuracion.modo = 'desactivada'` en todas las empresas hasta que el PM pase cada una a `obligatoria` en la semana 5: con eso nada cambia en la facturación actual.
4. `billing.facturas.fel_*` con datos → filas en `fiscal.dte` (`certificado`). Las columnas quedan sin escritura y se borran en una PR posterior.
5. `inicio_libros` = la fecha de instalación. Antes de esa fecha, los libros de IVA y las declaraciones no se calculan (la FEL y el IVA salían del sistema anterior; PLAN, semana 5): el borrador responde 422 `antes_de_inicio_libros`. Las facturas importadas (contrapartida `2.9.01`) y los pagos históricos nunca entran a los libros de IVA.
6. Los asientos, egresos, notas y pagos existentes **no se tocan**. Los egresos que tienen factura se pueden pasar a compras con `compras.registrar_desde_egreso` (reclasificación, §3.4).
7. Los cambios de `CHECK` (`tipo` de cuenta, `origen_tipo`) son DDL; ninguna fila del libro se actualiza.

## 12. Pruebas mínimas (Japa, contra Postgres)

| Caso                           | Qué se comprueba                                                                                                                                                                   |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Instalar `gt-2026.1` dos veces | La segunda no agrega nada; las cuentas y los `CUENTAS.*` de hoy siguen iguales                                                                                                     |
| Parámetro con vigencia         | Un valor nuevo con `vigente_desde` futuro no cambia el cálculo de hoy; una declaración vieja recalculada usa el valor de su fecha; 422 bajo bloqueo                                |
| Régimen                        | 422 si no empieza el 1-ene; las frases y el tipo de DTE cambian el 1-ene                                                                                                           |
| FEL obligatoria                | Factura `por_certificar` sin asiento ni evento; al certificar (proveedor `falso`), asiento, `factura.emitida` y corte; reintento tras `error_temporal` consulta antes y no duplica |
| Consumidor final               | Q2,499.99 a CF certifica; Q2,500.00 a CF responde 422                                                                                                                              |
| Anulación                      | Dentro del plazo: dos pasos y reverso; fuera: 422 con sugerencia de nota                                                                                                           |
| Compras                        | Duplicado 409; FPEQ sin crédito; crédito fuera de ventana 422; desde egreso con reclasificación; el libro cuadra                                                                   |
| Retención recibida             | Pago con constancia: CxC baja por el total, `1.1.05` por la constancia                                                                                                             |
| Declaraciones                  | IVA del mes = débito del libro de ventas − crédito del de compras − retenciones; `datos_hash` detecta un cambio; 409 al presentar desactualizada                                   |
| Cierre anual                   | Cuentas de resultados en cero, reserva legal del 5 %, diciembre cerrado; 422 con meses abiertos                                                                                    |
| Bloqueo duro                   | No retrocede; `reabrir_periodo` responde 409                                                                                                                                       |
| Libros                         | Folios correlativos, `sha256` guardado, 422 sin bloqueo                                                                                                                            |
| Multiempresa                   | Parámetros, régimen, DTE, compras y declaraciones de la empresa A no se ven ni se mezclan en la B                                                                                  |

## 13. Qué hace cada agente

| Agente | Trabajo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Orden                                 |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| **A1** | `core.empresas.pais` y `empresas.cambiar_pais` (que llama al instalador de A3 en la misma transacción); selector de país al crear la empresa (solo GT por ahora); datos fiscales del cliente con su validador (NIT con dígito verificador, CUI de 13 dígitos); `regimen_isr` y `codigo_establecimiento` de solo lectura desde `fiscal`; permisos nuevos en `permisos.ts` y roles                                                                                                                            | PR 1                                  |
| **A3** | Módulo `apps/api/app/fiscal` (paquete GT, parámetros, instalador, FEL, libros, declaraciones, tablero, worker `fiscal:worker`); en `ledger`, cuentas, compras, proveedores, constancias, bloqueos y cierre anual; en `billing`, `por_certificar`, `tipo_dte`, establecimiento, líneas de descuento, retenciones en pagos e IVA de la mora; adaptadores `infile` y `falso`; README de `fiscal`; actualizar este contrato, `eventos.md` y `multiempresa.md`                                                   | PR 2 a 8                              |
| **A4** | Configuración → Fiscal (país, régimen con su aviso, banderas, establecimientos, frases, parámetros con historial y fuente, marca "confirmar con contador"); Configuración → FEL (proveedor, credenciales, probar, modo, contingencia); estado del DTE en factura y nota (reintentar, ver XML y PDF); proveedores y compras (con alta desde egreso); libros (vista previa, emitir, habilitaciones); cierres y bloqueos (confirmación escrita para el duro); declaraciones; tablero con comparador y consejos | Detrás de cada PR de A3               |
| **A5** | Portal: lista de facturas con su DTE (autorización, serie, número), descarga del PDF FEL con la marca de la empresa y del XML; el aviso de cobro cambia a "Factura" cuando tiene autorización; NCRE visibles en el estado de cuenta                                                                                                                                                                                                                                                                         | Con la PR de FEL                      |
| **A6** | Avisos por `fiscal.vencimiento_proximo`, `fiscal.limite_pc`, `dte.rechazado` (definitivo o agotado), `fel.contingencia_cambiada` y libros por emitir, por Telegram al equipo y correo a contabilidad; importación de compras desde CSV o XLSX del portal de la SAT o del certificador, por la acción `compras.registrar` (neutral al origen, como `contratos/importacion.md`)                                                                                                                               | Con las PR de declaraciones y compras |

## 14. Confirmar con contador

| #   | Tema                                             | Qué decidir                                                                                                  | Valor provisional                        | Fuente                                        |
| --- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------- | --------------------------------------------- |
| 1   | Plazo del ISR trimestral                         | 10 días (LAT compilada) o mes siguiente (SAT)                                                                | Mes siguiente                            | inv. A.2; NO VERIFICADO 17                    |
| 2   | Art. 46 frente al art. 44                        | Si el 7 % directo sustituye la escala para ingresos no retenidos                                             | `art46_directo`, con los dos cálculos    | inv. E.1; NO VERIFICADO 14                    |
| 3   | ISO: regla de 4 veces y exención de 4 trimestres | Si aplican y cómo                                                                                            | Sin valor (no se aplican)                | inv. A.4; NO VERIFICADO 4                     |
| 4   | ISO: periodo de la base                          | Activo neto e ingresos de qué periodo                                                                        | Sin valor                                | inv. A.4                                      |
| 5   | Depreciación del equipo de telecomunicaciones    | 33.33, 20 o 10 %                                                                                             | 10 % (otros bienes)                      | inv. A.2; NO VERIFICADO 5                     |
| 6   | Catálogo de DTE y frases                         | Lista completa (Reglas y Validaciones v2.x), NABN frente a NCRE, código de la frase de pequeño contribuyente | Solo FACT, FCAM, FPEQ, FCAP, NCRE, NDEB  | inv. C.1, C.2; NO VERIFICADO 6                |
| 7   | Contingencia FEL                                 | Procedimiento y plazo para transmitir                                                                        | Sin plazo; activación manual             | inv. C.3; NO VERIFICADO 7                     |
| 8   | Certificadores autorizados                       | Lista vigente                                                                                                | Solo INFILE                              | inv. C.3; NO VERIFICADO 8                     |
| 9   | Interés resarcitorio 2026                        | Tasa vigente                                                                                                 | Sin valor                                | inv. E.2; NO VERIFICADO 9                     |
| 10  | Retenciones de ISR                               | Medio y formulario que sustituyen a RetenISR                                                                 | Sin formulario                           | inv., cambios recientes 5; NO VERIFICADO 10   |
| 11  | Libros electrónicos                              | Si se aceptan 100 % electrónicos sin hojas habilitadas; aranceles                                            | Emisión con folio sobre rango habilitado | inv. B.1; NO VERIFICADO 11                    |
| 12  | Columnas de los libros de IVA                    | Formato exacto que pide la SAT                                                                               | Columnas de §7                           | No está en el informe                         |
| 13  | Umbral de retención de IVA del sector público    | Q2,500 o Q30,000                                                                                             | Q2,500                                   | inv. A.1; NO VERIFICADO 18                    |
| 14  | Exención de IVA para servicios de internet       | Confirmar que no existe                                                                                      | Gravado al 12 %                          | inv. A.1                                      |
| 15  | IVA en recargos por mora y NDEB                  | Si la mora lleva IVA y sale como NDEB                                                                        | Sí (`mora_con_iva`)                      | inv. A.1 (art. 12), C.1; interpretación de A3 |
| 16  | Momento del IVA al certificar al pagar           | Si el aviso de cobro puede diferir el débito hasta el pago                                                   | Permitido, con `2.1.11`                  | inv. A.1 (art. 4), C.3 (art. 34)              |
| 17  | FEL desactivada                                  | Si se permite en producción para el régimen general                                                          | Permitida con alerta                     | inv. C.3 (inferencia)                         |
| 18  | Base de la reserva legal                         | Antes o después del ISR                                                                                      | Después                                  | inv. B.3 (confianza baja)                     |
| 19  | Asientos de cierre anual                         | Procedimiento                                                                                                | §9.1                                     | inv. B.3 (NO VERIFICADO)                      |
| 20  | Timbre fiscal                                    | Tasa del 3 % y exención de documentos con IVA                                                                | No se calcula en facturas                | inv. A.5; NO VERIFICADO 1                     |
| 21  | SIT, FONDETEL y arbitrios                        | Si el ISP debe algo                                                                                          | No se calcula                            | inv. A.5; NO VERIFICADO 2                     |
| 22  | Feriados y días hábiles                          | Calendario para plazos en días hábiles                                                                       | Tabla vacía editable                     | inv. A.1, A.2                                 |
| 23  | Tipo de cambio del Banguat                       | Hora de publicación y días sin publicación                                                                   | Último publicado                         | inv. B.4                                      |
| 24  | Marco contable                                   | NIIF para las PYMES o completas                                                                              | PYMES                                    | inv. B.2 (confianza baja-media)               |
