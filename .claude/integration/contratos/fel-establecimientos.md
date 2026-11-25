# FEL por empresa: NIT, certificador, establecimientos y modos

Diagnóstico y plan de trabajo (rama `agente/fel-empresas`, base `origin/main` 3d5d1221, 25 nov 2026).
Este documento **no trae código**: lo ejecuta otro agente, lote por lote. Complementa
`localizacion-fiscal.md` (§3.1, §3.2, §3.6, §8 y §17) y `multiempresa.md`; donde cambia algo de
ellos, el lote lo dice y el ejecutor actualiza ese contrato en el mismo commit.

Reporte del PM: «Existe un problema sobre lógica de empresas y la forma de configurar el
certificador, además que no permite que el NIT tenga letras o guiones (…) en pruebas suelen hacer
eso, además de que el botón o la acción de certificar no está clara cuando algo es opcional, al
parecer no respeta ese tipo de reglas o no la está validando (obligatorio, opcional, ninguno)».
Y luego: «también toma en cuenta las sucursales (según SAT)».

Cómo leer la confianza de cada afirmación:

- **[INFILE]** «Documentación INFILE (docs.infile.com, sección Guatemala)», documentación privada
  que compartió el PM (actualizada el 11-nov-2026). Es la **fuente principal** de este plan. No se
  copia al repositorio: aquí solo se cita y se resume.
- **[demo]** datos no secretos del emisor de pruebas que INFILE le dio al PM (DEMO COMERCIAL, S.A.).
- **[fuente]** citado de una fuente pública consultada en esta sesión (enlace al final).
- **[esquema]** sale del esquema `GT_Documento` de la SAT tal como ya lo arma
  `apps/api/app/fiscal/fel/xml_gt.ts`; el portal de la SAT respondió 403 a la herramienta, así que
  **no se pudo releer el XSD ni «Reglas y validaciones» en esta sesión**. Donde los ejemplos de
  INFILE lo confirman se marca **[INFILE]**; el resto se confirma en el lote 6 (ambiente demo).
- **[código]** leído en el repositorio (archivo y línea). **[probado]** ejecutado en esta sesión.
- **[sin verificar]** no se encontró fuente: no se implementa como regla, va a preguntas.

---

## 1. Lo que exige la SAT

### 1.1 Régimen FEL y certificador

- El Régimen FEL (Acuerdo de Directorio SAT 13-2018, reformado por 26-2019 y 15-2020) regula la
  emisión, transmisión, certificación y conservación de los DTE (facturas, notas de crédito y
  débito, recibos). Publicado el 2-may-2018, vigente desde el 17-may-2018. **[fuente 1, 2, 3]**
- El DTE lo valida y certifica un **certificador autorizado por la SAT** antes de entregarse; el
  emisor contrata al certificador. **[fuente 4]**
- Para habilitarse como emisor hace falta RTU actualizado, domicilio fiscal localizado, estar
  afiliado al IVA y tener **al menos un establecimiento activo**. **[fuente 4, 5]**
- Credenciales de INFILE: **Usuario API, Llave API, Usuario Firma, Llave Firma** y un
  **Identificador** único por transacción. **[INFILE]** Las entrega INFILE al contribuyente que
  contrata. **[fuente 6]** Consecuencia: credenciales por empresa (NIT); **no** por establecimiento.
- **Un solo servicio y una sola URL** para certificar y para anular:
  `POST https://certificador.feel.com.gt/fel/procesounificado/transaccion/v2/xml`
  (`application/xml`, credenciales en las cabeceras `UsuarioAPI`, `LlaveAPI`, `UsuarioFirma`,
  `LlaveFirma`, `Identificador`). El cuerpo es el `GTDocumento` o el `GTAnulacionDocumento`.
  **[INFILE]**
- **Pruebas frente a producción no es otra URL: es el estado del emisor en INFILE.** Con el emisor
  en «Implementación» (sandbox) todo documento certificado vuelve con `alertas_infile` y el texto
  «Este documento fue procesado en nuestro SandBox en modalidad de pruebas, por ningún motivo debe
  ser usado como comprobante fiscal». **[INFILE]** Consecuencia: el «ambiente» de Argos es una
  etiqueta de qué credenciales se usan; lo que de verdad dice si un DTE es de pruebas es esa alerta.
- **Identificador repetido:** el servicio devuelve `resultado: true` con el resultado de la
  transacción anterior y las alertas «Documento enviado previamente» y «Documento consultado en
  modalidad de re-intento». **[INFILE]** Reenviar con el mismo `fiscal.dte.identificador` es seguro.
- Respuesta: `resultado`, `fecha`, `descripcion`, `uuid` (autorización), `serie` (primeros 8
  hexadecimales del UUID), `numero` (decimal de las posiciones 9-16 del UUID), `xml_certificado`
  (base64), `saldo`, `creditos`, `alertas_infile`, `alertas_sat`, `descripcion_alertas_infile[]`,
  `descripcion_alertas_sat[]` (`fuente`, `categoria`, `numeral`, `validacion`, `mensaje_error`),
  `control_emision` (cupo y saldo diario). El rechazo llega con `resultado: false` y sus errores en
  `descripcion_alertas_sat`. **[INFILE]** Serie y número **no se configuran**: salen del UUID.
- **Anulación:** un documento ya anulado se rechaza indicando la fecha de anulación entre
  corchetes. El XML lleva el UUID, `NITEmisor`, `IDReceptor`, fecha de emisión, fecha de anulación
  y motivo. **[INFILE]**
- **Contingencia:** aplica cuando no hay conexión con el certificador. El XML es el mismo
  `GT_Documento` con `NumeroAcceso` en `DatosGenerales`, en el rango **100 000 000 a 999 999 999**;
  al volver la conexión se envían de inmediato todos los documentos, y el emisor debe registrar el
  **aviso de contingencia** en la Agencia Virtual o por correo a la SAT. Base: Acuerdo de
  Directorio 13-2018. **[INFILE]** Esto cierra parte del «NO VERIFICADO 7» de
  `localizacion-fiscal.md`; el plazo máximo sigue sin fuente (la presentación de la USAC de 2018
  habla de 24 horas **[fuente 7]**).

### 1.2 Establecimientos (sucursales)

- El **código de establecimiento** es el identificador que la SAT asigna a cada establecimiento
  comercial del contribuyente; es parte obligatoria del XML y **sin él el documento se rechaza**.
  Se consulta en la Agencia Virtual: FEL › Administración de Establecimientos. **[fuente 6]**
- En el RTU cada establecimiento tiene su número de secuencia, nombre comercial, clasificación y
  tipo. **[fuente 8]** (es una constancia de RTU real, no una norma).
- En el XML, el nodo `dte:Emisor` lleva **del contribuyente**: `NITEmisor`, `NombreEmisor` (razón
  social), `AfiliacionIVA` (`GEN`…), `CorreoEmisor`; y **del establecimiento**:
  `CodigoEstablecimiento`, `NombreComercial` y `DireccionEmisor` con `Direccion`, `CodigoPostal`,
  `Municipio`, `Departamento` y `Pais` **como elementos separados**. Los once ejemplos de XML de
  INFILE (factura, cambiaria, especial, exportación, notas, recibos, contingencia) lo traen así.
  **[INFILE]** INFILE le aclaró al PM lo mismo: dirección, departamento y municipio van por
  separado. **[demo]**
- El establecimiento debe estar **autorizado para ese emisor**: el de pruebas tiene autorizado solo
  el código 1, «DEMO», CIUDAD GUATEMALA, GUATEMALA. **[demo]** Un código que la SAT no tiene para
  ese NIT se rechaza.
- **NCRE y NDEB:** cada nota referencia **un solo** DTE con el complemento `ReferenciasNota`, y «el
  NIT del emisor y el ID del receptor deben coincidir con los del documento origen registrado en la
  SAT». **[INFILE]** No dice nada del establecimiento de la nota.
- Las **frases** dependen del régimen del emisor, del receptor y del tipo de operación.
  **[fuente 6]** No dependen del establecimiento: se quedan por empresa. El emisor de pruebas tiene
  estas (tipo/escenario): 1/1 retención del ISR, 2/1 agente de retención del IVA, 4/1 exento o no
  afecto al IVA, 5/1 factura especial, 9/16 y 9/17 frases especiales. **[demo]** Los ejemplos de
  FACT de INFILE llevan 1/1 y 2/1. **[INFILE]**
- **Serie y número** salen del UUID de la autorización (§1.1). **[INFILE]** No hay «serie por
  sucursal» que administrar.
- Qué establecimiento usar en cada documento: **[sin verificar]** como texto normativo. Lo que el
  esquema obliga es que el código exista y esté activo para ese NIT. El criterio razonable (el
  establecimiento que presta o vende el servicio) es una **decisión de negocio**: §5, pregunta P1.

Reparto que se desprende:

| Dato | Va por | Hoy en Argos |
| --- | --- | --- |
| NIT, razón social, afiliación IVA / régimen, correo | empresa | `core.empresas`, `fiscal.parametros_valores` |
| Frases y escenarios | empresa (régimen, receptor, operación) | `fiscal.frases` + las del régimen |
| Certificador, ambiente, credenciales, modo, contingencia | empresa (y ambiente) | `fiscal.fel_configuracion`, `fiscal.fel_credenciales` |
| Código SAT, nombre comercial, dirección, municipio, departamento, **código postal** | establecimiento | `fiscal.establecimientos` (falta código postal) |
| Serie y número | lo da la certificación | `fiscal.dte` |

### 1.3 NIT

- El NIT es cuerpo numérico + dígito verificador (0-9 o K), módulo 11. La SAT no publica el
  algoritmo como documento técnico; es el que ya documenta `apps/api/app/core/nit_cui.ts`.
  **[código]** **[probado]**: `12521337` (INFILE) y `16693949` (SAT) cuadran.
- **Los NIT de prueba de INFILE no cuadran con el módulo 11.** **[probado]** con el algoritmo del
  repositorio: el emisor de pruebas del PM, **`1170142K`** **[demo]**, da verificador `0`, no `K`;
  el emisor de los ejemplos de INFILE, **`1000000000K`** **[INFILE]**, también da `0`; el receptor
  `9876543` de su manual da `5`. Los receptores `76365204` y `74303856` de los ejemplos sí cuadran.
  Esta es la causa exacta de lo que reportó el PM: son NIT con letra que INFILE acepta en su
  ambiente de pruebas y que Argos rechaza.
- Lo que valida el certificador no es el módulo 11: es que el NIT **exista y esté activo en la
  SAT**. El rechazo de ejemplo es «2.1.3 · El NIT del emisor no se encuentra activo en el sistema
  SAT», y la consulta de NIT exige que «el NIT a consultar debe ser válido y no debe estar
  desactivado en la base de datos de la SAT». **[INFILE]**
- **Consulta de NIT** (`POST https://consultareceptores.feel.com.gt/rest/action`, JSON con
  `emisor_codigo` = Usuario API, `emisor_clave` = Llave API y `nit_consulta`): responde
  `{ resultado: true, razon_social }` o `{ resultado: false, razon_social: null, descripcion: "NIT
  no encontrado en base de datos." }`. INFILE **recomienda consultarlo antes de emitir** para
  validar que el NIT del receptor es correcto y está activo. **[INFILE]** Esa es la validación que
  de verdad vale en producción.
- **Consulta de CUI** (dos pasos: login con `prefijo` y `llave` que da un JWT de 2 horas, y
  consulta con `cui` de 13 dígitos; responde `nombre` y `estatus`): existe, y Argos no la usa.
  **[INFILE]** El receptor con CUI va con `TipoEspecial="CUI"`; el consumidor final, con
  `IDReceptor="CF"`. **[INFILE]**
- Por todo lo anterior el módulo 11 pasa a ser **advertencia** y lo que decide es el certificador
  (§3, R1).

---

## 2. Lo que hace hoy Argos y las brechas

Lo que ya está bien (no se rehace): acciones `fel.configurar`, `fel.guardar_credenciales`,
`fel.probar_credenciales`, `fiscal.crear_establecimiento`, `fiscal.editar_establecimiento` con
auditoría, `version` y `fiscal.config_cambiada`; todo filtrado por empresa con `empresaFiscal`;
`fiscal.dte.establecimiento_id`; pantalla Configuración › Fiscal con `FiscalEstablecimientos`; la
página se recarga al cambiar de empresa (`app.vue` línea 12 pone la elección en la clave de la
página). **No se encontró** mezcla de configuración entre empresas en la API.

### B1 · NIT de la empresa: rechaza letras y guiones intermedios

- `nitEmpresa()` en `apps/api/app/core/validators.ts:943` exige `^(\d{13}|\d{1,12}-?[0-9K])$`;
  `normalizarNitEmpresa` (`core/empresas.ts:220`) llama a `normalizarNitCui`, que lanza 422 si el
  módulo 11 no cuadra. El panel repite el patrón (`PATRON_NIT_EMPRESA`, `utils/esquemasEmpresa.ts`).
- **[probado]**: el NIT de pruebas de INFILE **`1170142K`** pasa el patrón y la acción lo rechaza
  con 422 «El NIT no es válido (dígito verificador)»; lo mismo `1000000000K`. `ABC-123` y `DEMO-1`
  ni siquiera pasan el patrón. Hoy **no se puede dar de alta la empresa de pruebas de INFILE**.
- La base no estorba: `core.empresas.nit` es `text` de 1 a 20 caracteres y el índice único
  normaliza con `upper(regexp_replace(nit, '[\s-]', '', 'g'))`, igual que `exigirNitLibre`.
- De paso: el ejemplo del comentario de `nit_cui.ts` (`5769373K`) **no cuadra** (**[probado]**: su
  verificador es 0). Se corrige el comentario.

### B2 · NIT del receptor: rechazo duro, sin distinguir ambiente

- `validarDocumentoFiscal` (`core/nit_cui.ts`) lanza 422 con tipo `nit` si falla el módulo 11. Un
  cliente de pruebas con el NIT que da el certificador no se puede guardar.
- Ya existe la marca `core.clientes.nit_cui_invalido` (migración de la localización) y
  `receptorDe` (`fiscal/fel/dte.ts:362`) manda como **CF** a quien la tiene. Se puede reutilizar
  como «advertencia», pero hoy solo la pone la migración; `clientes.crear`/`editar` la apagan
  siempre (`crear_cliente.ts:92`).
- El trigger `core.clientes_tipo_documento` reclasifica a `cf` un número que no parece NIT ni CUI
  cuando cambia `nit_cui` sin cambiar el tipo (migración `1792273376188`): con letras, hoy la base
  le cambiaría el tipo. Hay que tocarlo (lote 1).

### B3 · Certificador: credenciales que se cruzan entre proveedores en el panel

- `fiscal.fel_credenciales` es única por (`empresa_id`, `proveedor`, `ambiente`) y
  `GET /fel/configuracion` devuelve **todas** (`vistaCredenciales`). En
  `apps/web/app/pages/configuracion/fel.vue`, `credencialesDe(ambiente)` toma **la primera del
  ambiente sin mirar el proveedor**. Con credenciales del certificador falso y de INFILE en
  pruebas, la tarjeta muestra unas y «Probar» prueba las del proveedor **guardado**
  (`probar_credenciales_fel.ts`): se ve «Configuradas» y la prueba responde «No hay credenciales».
- El modal guarda con el proveedor **elegido en el formulario sin guardar** (`proveedorCredenciales`
  usa `estado.proveedor`), y «Probar» usa el **guardado**. Si son distintos, lo recién guardado no
  se puede probar.
- `alGuardarCredenciales` y `probar` reemplazan la fila por ambiente, no por proveedor + ambiente.
- Se puede guardar `obligatoria` u `opcional` **sin credenciales** del proveedor y ambiente
  elegidos: no avisa. En `obligatoria` + «al emitir» toda factura nace `por_certificar` y su DTE se
  queda en `error_temporal` (`fel_no_configurada`) hasta agotar reintentos: se deja de facturar sin
  ningún aviso al configurar. No se puede exigir en `fel.configurar` sin romper el orden de las
  ayudas de prueba (`tests/fiscal/ayudas_fel.ts` y `tests/contabilidad/`, que no se edita:
  configuran el modo y **después** guardan credenciales), así que va como **dato de lectura y
  aviso**, no como 422 (lote 2).
- `PUT /fel/configuracion` con `ambiente = produccion` no advierte si el NIT de la empresa no cuadra
  o si la empresa no tiene establecimiento activo.
- Consolidado («Todas»): la pantalla pide elegir empresa (correcto). No hay edición sobre la
  empresa equivocada en `fel.vue` ni en `fiscal.vue`. `empresas.vue` edita por id explícito.

### B4 · Modos FEL: la API no distingue «desactivada» y el panel no dice qué toca

Semántica vigente y aprobada (§8.3 y §17 de `localizacion-fiscal.md`; **no cambia**):

| Modo | «al emitir» | «al pagar» | «nunca» |
| --- | --- | --- | --- |
| `obligatoria` | nace `por_certificar`, DTE ya | aviso de cobro, DTE al cubrirse | no se admite |
| `opcional` | emitida, **DTE solo a mano** | aviso de cobro, DTE al cubrirse | emitida, DTE solo a mano |
| `desactivada` | emitida, sin DTE | emitida, sin DTE | emitida, sin DTE |

Brechas:

1. **`POST /dte/:id/reintentar` con la FEL desactivada crea un DTE nuevo y lo mete en la cola**
   (`reintentar_dte.ts:93-107`: usa `config.proveedor ?? dte.proveedor` y nunca mira `config.modo`).
   Rompe «desactivada: nada entra en la cola».
2. `POST /facturas/:id/certificar` con la FEL desactivada responde 422 `fel_no_configurada`, el
   **mismo código** que «faltan credenciales». El panel no puede distinguir «está apagada» de
   «falta configurar».
3. `obligatoria` solo valida `certificar_al = nunca` **al cambiar el modo** (`configurar_fel.ts:79`).
   Después se puede poner `nunca` en una plantilla (`plantillas.editar`), en una excepción de
   servicio (`billing/excepciones.ts`) o asignar a un servicio una plantilla con `nunca`: no hay
   422. La emisión lo trata como «al emitir» (`modoEmision`), o sea que no se omite el DTE, pero la
   pantalla sigue diciendo «Nunca». Regla sin validar = lo que reportó el PM.
4. En `opcional`, «al emitir» y «nunca» hacen **lo mismo** (a mano) y el panel no lo dice:
   `CERTIFICAR_AL.emitir` describe «El DTE se pide al emitir la factura». Quien elige «Opcional» +
   «Al emitir» espera certificación automática y no ocurre.
5. `DteDocumento.vue` (pestaña «Factura electrónica» de la factura) pinta el botón «Certificar»
   **sin conocer el modo** de la empresa: en `desactivada` el botón aparece y responde 422; en
   `opcional` no dice que es opcional; en `obligatoria` no dice que es automático. El comentario del
   propio componente dice «(opcional, o un aviso…)» pero el usuario no lo ve.
6. `CertificarLoteModal` y la cola DTE tampoco reciben el modo.
7. La factura no expone el modo FEL de su empresa: hoy el panel tendría que pedir
   `GET /fel/configuracion`, que exige `fel.ver` y no sirve en listas consolidadas.

### B5 · Establecimientos: existen, pero todo sale por el «por defecto»

- `insertarDte` (`fiscal/fel/dte.ts:455`) elige siempre el establecimiento **por defecto** de la
  empresa. No hay regla por zona, router ni caja; el comentario de `establecimientos.ts` lo dejaba
  «para más adelante».
- Una NCRE o NDEB no hereda el establecimiento del DTE de su factura: si entre tanto cambia el por
  defecto, la nota sale por otra sucursal que el documento que corrige.
- `DteParaEnviar.emisor.codigo_postal` está fijo en `'01001'` (`dte.ts:747`): una sucursal fuera de
  la capital sale con el código postal de la zona 1. Falta la columna.
- Si la empresa no tiene establecimiento, el DTE sale con `establecimiento_id = null` y código `1`
  por omisión (`dte.ts:742`), sin aviso.
- Un establecimiento **inactivo** sigue en los DTE ya creados (correcto), pero `dteParaEnviar` no
  comprueba que siga activo al enviar un DTE pendiente.
- El panel: `FiscalEstablecimientos` permite crear, editar, desactivar y marcar por defecto (bien).
  No muestra a qué zonas atiende. `DteFicha`, `facturas/[id]` y la cola DTE **no muestran el
  establecimiento** del documento (no hay ninguna mención en esos archivos).
- `GET /dte` no trae código ni nombre del establecimiento, solo `establecimiento_id`.
- `core.empresas.codigo_establecimiento` y `EmpresaFormulario` siguen ofreciendo «código de
  establecimiento» al crear la empresa: es la semilla del establecimiento 1 (correcto), pero el
  formulario no dice que las sucursales se administran en Configuración › Fiscal.

### B6 · Adaptador de INFILE: diferencias con su documentación

`apps/api/app/fiscal/fel/infile.ts` y `xml_gt.ts` se escribieron contra documentación pública vieja
y nunca se probaron contra INFILE. Comparados con la documentación que ahora tenemos **[INFILE]**:

| Punto | Hoy en Argos | Documentación INFILE | Gravedad |
| --- | --- | --- | --- |
| Consulta de NIT | `consultarNit` lee `datos.nombre` | la respuesta trae `razon_social` | **Falla siempre**: devuelve `null` aunque el NIT exista |
| Probar credenciales | consulta NIT con `nit_consulta = usuario_api` y da por buenas las credenciales con cualquier HTTP 200 | `nit_consulta` es un NIT; el resultado va en `resultado` | Puede decir «válidas» con credenciales malas; debe consultar el NIT de la empresa y mirar la respuesta |
| Errores de rechazo | lee `descripcion_errores[]` | vienen en `descripcion_alertas_sat[]` (y `descripcion_alertas_infile[]`) | El motivo del rechazo de la SAT se pierde: solo queda `descripcion` |
| Anulación | firma aparte (`signer-emisores…/firma_xml`, `es_anulacion = S`) y `POST …/fel/anulacion/v2/dte/` con JSON | el **mismo** proceso unificado, con el XML `GTAnulacionDocumento` | Confirmar en el lote 6; lo documentado es el proceso unificado |
| XML de anulación | atributos en `dte:DatosGenerales`, namespace `…/fel/0.1.0`, `FechaHoraAnulacion` | elementos hijos de `dte:DatosAnulacion` (`NumeroDocumentoAAnular`, `NITEmisor`, `IDReceptor`, `FechaEmisionDocumentoAnular`, `FechaAnulacion`, `MotivoAnulacion`), namespace `…/fel/0.2.0` | Confirmar en el lote 6: el ejemplo del manual puede estar simplificado frente al XSD |
| Unidad de medida | `UNI` | `UND` en todos los ejemplos | Confirmar; cambiar a `UND` |
| Complemento de notas | `IDComplemento="ReferenciasNota"`, `NombreComplemento="Nota de Credito"`, `URIComplemento` = el namespace | `IDComplemento="Notas"`, `NombreComplemento="Notas"`, `URIComplemento="http://www.sat.gob.gt/fel/notas.xsd"`; el `cno:ReferenciasNota` interno coincide | Confirmar en el lote 6 |
| Sandbox | no se mira `alertas_infile` | el documento de pruebas llega marcado | Un DTE «de producción» certificado con un emisor en Implementación pasaría por válido |
| Identificador repetido | consulta antes de reenviar por `/fel/consulta/dte/v2/identificador_unico` (ruta no documentada) | reenviar con el mismo `Identificador` devuelve el resultado anterior | La consulta previa sobra y su ruta no está en la documentación |
| Receptor de la NCRE | se vuelve a leer del cliente al crear la nota | debe coincidir con el del documento origen | Si el cliente cambió de NIT, la NCRE se rechaza |
| Dirección del receptor | `01001`, Guatemala, Guatemala fijos | elementos separados; mismos valores en los ejemplos | Aceptable; no se toca |
| Número de acceso | 9 dígitos entre 100 000 000 y 999 999 999 | mismo rango | Correcto |
| Cabeceras | `UsuarioApi`, `LlaveApi`, `identificador` | `UsuarioAPI`, `LlaveAPI`, `Identificador` | Sin efecto (HTTP no distingue mayúsculas); se igualan por claridad |

---

## 3. Reglas que quedan (lo que el ejecutor implementa)

### R1 · NIT

Una sola función nueva en `apps/api/app/core/nit_cui.ts`, espejo en
`apps/web/app/utils/documentoFiscal.ts`:

```ts
/** NIT tolerante: letras, dígitos y guiones. Normaliza igual que `exigirNitLibre`. */
export function revisarNit(valor: string): { nit: string; valido: boolean }
```

- Normaliza: quita espacios y guiones, mayúsculas (lo mismo que `limpiarDocumento` y que el índice
  `empresas_nit_activa_unico`). `12345-67-K` → `1234567K`.
- **Rechaza (422, `rule: 'nit'`)** solo si, ya limpio, no es `^[0-9A-Z]{2,20}$` (vacío, un solo
  carácter, símbolos, más de 20).
- `valido = nitValido(nit)` (forma `^\d{1,12}[0-9K]$` + módulo 11). Si es `false` **no se rechaza**:
  es advertencia.
- `CF` nunca es NIT de empresa (se conserva el 422 actual).
- Emisor (empresa): se guarda siempre que pase la forma; la respuesta trae `nit_valido: boolean`
  (derivado, no columna). El panel avisa «El dígito verificador no cuadra: sirve para pruebas; la
  SAT lo rechazará en producción».
- Certificador: al pasar a `ambiente = produccion` con modo distinto de `desactivada`, si
  `nit_valido` es `false` → **422 `nit_emisor_invalido`** (campo `ambiente`). En `pruebas` solo
  aviso. Es la única validación dura del NIT del emisor, y es local: evita mandar a producción un
  NIT que la SAT va a rechazar.
- Receptor (cliente con tipo `nit`): pasa la forma → se guarda; si `valido` es `false` se guarda con
  `nit_cui_invalido = true` (la marca que ya existe y ya se muestra en la ficha y en el filtro de
  clientes). Corregirlo la apaga, como hoy.
- Receptor al certificar (`receptorDe` recibe el ambiente del DTE):
    - `pruebas`: el NIT viaja **tal como está**, aunque tenga la marca. El certificador decide.
    - `produccion`: se conserva lo aprobado en §12 de `localizacion-fiscal.md`: con la marca sale
      como CF; desde `consumidor_final_limite` → `receptor_requerido`. Pregunta P3.
    - La validación que recomienda INFILE no es el módulo 11 sino la **consulta de NIT** (§1.3). Ya
      existe la acción `clientes.verificar_nit`; hoy exige `nitValido` y por eso no sirve para un
      NIT de pruebas: pasa a exigir solo la forma de `revisarNit`. Una consulta que responde
      «encontrado» **apaga** `nit_cui_invalido` (el certificador manda sobre el módulo 11) y
      ofrece la razón social para `nombre_fiscal`.
- **NCRE y NDEB:** el receptor es el del DTE de origen (`fiscal.dte.receptor`), no el dato actual
  del cliente (§1.2).
- CUI y pasaporte: sin cambios.
- No cambian (siguen estrictos, fuera de alcance): `importacion/importador.ts`,
  `portal/actions/solicitar_codigo.ts`, `clientes.verificar_nit`, `cambiar_titular_servicio`,
  proveedores de compras (`ledger/proveedores.ts`). Se anotan en `a1.md` como seguimiento.

### R2 · Modos FEL (la API manda, el panel lo cuenta)

| Modo | Certificar a mano (`POST /facturas/:id/certificar`, `/fel/lotes`) | Reintentar DTE | Automático (emisión, pago, cola) |
| --- | --- | --- | --- |
| `obligatoria` | permitido (idempotente; adelanta un aviso) | permitido | siempre; `nunca` no existe |
| `opcional` | permitido: es **la** forma en «al emitir» y «nunca» | permitido | solo avisos «al pagar» cubiertos |
| `desactivada` | **409 `fel_desactivada`** | **409 `fel_desactivada`** | nada se crea |

- `fel_desactivada` (409, nuevo): «La FEL de la empresa está desactivada: no se certifica. Actívala
  en Configuración › FEL». `fel_no_configurada` (422) queda solo para «falta proveedor o
  credenciales».
- En `desactivada` los DTE que **ya estaban** en cola terminan su ciclo (una `por_certificar` no
  puede quedarse sin asiento); lo que no puede pasar es que nazca uno nuevo. Pregunta P5.
- `obligatoria`: `certificar_al = nunca` responde 422 `certificar_al_incompatible` también al
  **editar o crear una plantilla** usada por servicios de una empresa en `obligatoria`, al poner la
  **excepción** `certificar_al = nunca` en un servicio de esa empresa, y al **asignar** a un
  servicio de esa empresa una plantilla con `nunca`.
- La factura dice qué le toca: campo nuevo de lectura `fel_accion` en `Factura`:
  `certificar_opcional` (modo opcional, sin DTE vigente, certificable), `certificar_ahora`
  (obligatoria, aviso aún sin DTE: se puede adelantar), `automatica` (obligatoria con DTE en
  curso o por nacer), `ninguna` (desactivada, anulada, acreditada, castigada, en cero o ya
  certificada), más `fel_modo`. Lo calcula **una** función en la API
  (`#fiscal/fel/accion.ts`), la misma que usa `SolicitarCertificacion` para decidir: panel y API no
  pueden discrepar.
- El modo **no** varía por establecimiento: la obligación de emitir FEL es del contribuyente (NIT),
  no de la sucursal (§1.1). No se propone modo por establecimiento.

### R3 · Establecimiento de cada documento

Orden, en una sola función `establecimientoPara(trx, empresaId, { servicioId, clienteId })` de
`#fiscal/establecimientos`:

1. **Nota (NCRE, NDEB):** el establecimiento del DTE certificado de su factura de origen. INFILE
   exige que coincidan emisor y receptor con el origen y no dice nada del establecimiento: usar el
   mismo es criterio nuestro, el más conservador (pregunta P1).
2. **Zona:** el establecimiento **activo** de la empresa que atiende la zona del cliente
   (`core.clientes.zona_id`; el servicio no tiene zona propia).
3. **Por defecto** activo de la empresa.
4. Ninguno → al certificar a mano, **422 `establecimiento_requerido`**; en automático el DTE queda
   `rechazado` local con ese error (corregible y reintentable), igual que `receptor_requerido`.
   Nunca más un código `1` supuesto.

Se resuelve **al crear el DTE** y se guarda en `fiscal.dte.establecimiento_id` (ya existe): es la
foto fiscal. La factura no lleva columna propia: sin DTE el establecimiento no tiene efecto fiscal,
y con DTE se lee de él. Un reintento (`fel.reintentar`) vuelve a resolver (por si se corrigió).

Por qué zona y no caja o router (provisional, P1): la factura recurrente nace antes de que exista
un cobro (la caja llega después o nunca); el router es un dato de red; la zona ya es el eje
territorial y de alcance del ACL, y una sucursal atiende territorios.

---

## 4. Plan de trabajo por lotes

Cada lote es un commit (o pocos) que pasa solo: sus pruebas, `pnpm lint`, `pnpm typecheck`,
`pnpm verificar:permisos` y, si tocó validadores o esquemas, `NODE_ENV=development pnpm
contracts:build` con `packages/contracts` en el mismo commit. Pruebas de API, un archivo por corrida:

```
DB_DATABASE=argosisp_test_fel PORT=3409 COLAS_PREFIJO=fel AAA_REDIS_PREFIJO=fel:aaa:user: NODE_ENV=test node ace test --files=<archivo>
```

Prohibido editar `apps/api/tests/contabilidad/`. Si un lote rompe una prueba de ahí, el lote está
mal: se corrige el código, no la prueba. Después de cada lote corre también
`tests/contabilidad/fase3.spec.ts` y `tests/fiscal/fel.spec.ts`.

### Lote 1 · NIT con letras y guiones (API + panel)

API:

- `app/core/nit_cui.ts`: agregar `revisarNit` (R1). `validarDocumentoFiscal` con tipo `nit` usa
  `revisarNit` y devuelve además `nit_cui_invalido: boolean` en `DocumentoFiscal`. Sin tipo: si el
  valor no se deduce (`deducirTipoDocumento` = null) y pasa la forma de `revisarNit` → tipo `nit`
  con `nit_cui_invalido: true`; 13 dígitos que no cuadran como CUI ni como NIT siguen dando el 422
  de CUI. `normalizarNitCui` **no cambia** (lo usan importador y portal). Corregir el ejemplo del
  comentario (`5769373K` no cuadra; usar `12521337`).
- `app/core/empresas.ts`: `normalizarNitEmpresa` usa `revisarNit` (rechaza `CF` y vacío como hoy).
  `EmpresaCompleta` y `verEmpresaCompleta` agregan el derivado `nit_valido` (`null` sin NIT).
  `sinDerivados` (`crear_empresa.ts`) lo excluye de `audit.cambios`.
- `app/core/validators.ts`: `nitEmpresa()` pasa a `^[0-9A-Z][0-9A-Z -]{0,24}$` con la descripción
  nueva. `app/core/esquemas.ts`: `nit_valido` en `EmpresaGrupo` (y donde se liste la empresa
  completa); actualizar la descripción de `nit_cui_invalido` («también cuando el NIT se guardó con
  advertencia»).
- `app/core/actions/crear_cliente.ts`: `columnasDocumento` guarda
  `nit_cui_invalido: documento.nit_cui_invalido` en vez de `false` fijo.
- Migración (`node ace make:migration alter_clientes_nit_tolerante`): `CREATE OR REPLACE` de
  `core.clasificar_documento` para que un valor `^[0-9A-Z]{2,20}$` que no es CUI ni NIT válido
  quede `tipo = 'nit'`, `invalido = true` (hoy cae a `cf`); y del trigger
  `core.clientes_tipo_documento` para que, con tipo `nit` explícito y sin cambio de tipo, **no
  reclasifique**: solo ponga `nit_cui_invalido := NOT core.nit_valido(limpio)`. `down` restaura las
  dos definiciones de `1792273376188`.
- `app/fiscal/fel/dte.ts`: `receptorDe(cliente, clienteId, corregido, opciones?: { ambiente })`.
  Con `ambiente === 'pruebas'` la marca `nit_cui_invalido` **no** degrada a CF. Pasar el ambiente
  desde `solicitar_certificacion.ts`, `reintentar_dte.ts`, `billing/emision.ts` (usa
  `config.ambiente`) y la nota de crédito (`emitir_nota_credito.ts:346`).
- `app/fiscal/actions/configurar_fel.ts`: 422 `nit_emisor_invalido` (clase nueva en
  `fel/errores.ts`) si `modo !== 'desactivada'`, `ambiente === 'produccion'` y el NIT de la empresa
  falta o no pasa `nitValido`.

Panel:

- `app/utils/documentoFiscal.ts`: `revisarNit` espejo; `errorDocumentoFiscal` deja de dar error por
  módulo 11 en tipo `nit` (solo forma); nueva `avisoDocumentoFiscal(tipo, valor)` → texto de
  advertencia o `null`.
- `app/utils/esquemasEmpresa.ts`: `PATRON_NIT_EMPRESA` = `^[0-9A-Z][0-9A-Z -]{0,24}$`, mensaje
  «Letras, dígitos y guiones».
- `EmpresaFormulario.vue` y `ClienteFormulario.vue`: bajo el campo NIT, `UAlert` `color="warning"`
  `variant="subtle"` con el aviso cuando el módulo 11 no cuadra (no bloquea Guardar). En la ficha de
  la empresa (`empresas.vue`) y en `fel.vue`, `UBadge` de advertencia «NIT sin verificar» si
  `nit_valido === false`.
- Fixtures (`Schema<'EmpresaGrupo'>`) con `nit_valido`.

Pruebas que deben pasar:

- `tests/core/nit_tolerante.spec.ts` (nuevo, Japa):
    - `revisarNit('12521337')` → `{ nit: '12521337', valido: true }`; `'1252133-7'` igual.
    - `revisarNit('5769373K')` → `valido: false`; `'ABC-123'` → `{ nit: 'ABC123', valido: false }`.
    - `revisarNit('-')`, `'A'`, `'12#45'`, 21 caracteres → 422 `rule: 'nit'`.
    - `POST /empresas` con `nit: '1170142K'` (el emisor demo de INFILE) → 201, `nit_valido: false`;
      con `nit: '1170142-K'` en otra empresa → 409 `nit_duplicado`.
    - `revisarNit('1000000000K')` → `valido: false` (no lanza).
    - `POST /empresas` con `nit: 'DEMO-123'` → 201, `nit: 'DEMO123'`, `nit_valido: false`.
    - Otra empresa con `nit: 'demo 123'` → 409 `nit_duplicado` (misma normalización que
      `exigirNitLibre`).
    - `PUT /empresas/:id` a `12521337` → `nit_valido: true`; `nit: 'CF'` → 422.
    - `POST /clientes` con `tipo_documento_fiscal: 'nit'`, `nit_cui: 'ABC-123'` → 201,
      `nit_cui: 'ABC123'`, `nit_cui_invalido: true`, tipo sigue `nit` (el trigger no lo vuelve `cf`).
      Editarlo a `12345679` → `nit_cui_invalido: false`.
    - `POST /clientes` con `nit_cui: '1234567'` (sin tipo; no cuadra) → 201, tipo `nit`, marca `true`.
    - `PUT /fel/configuracion` `ambiente: 'produccion'`, `modo: 'opcional'` con la empresa
      `DEMO123` → 422 `nit_emisor_invalido`; con `ambiente: 'pruebas'` → 200.
    - DTE de un cliente `ABC123` (marca `true`): empresa en `pruebas` → `receptor.tipo = 'nit'`,
      `receptor.id = 'ABC123'`; con el DTE en `produccion` (empresa con NIT válido y proveedor
      `infile`, sin enviar) → `receptor.tipo = 'cf'`.
- Ajustar las pruebas existentes que afirmaban el 422 por dígito verificador en
  `tests/core/clientes.spec.ts`, `tests/core/empresas.spec.ts` y
  `tests/core/localizacion_fiscal.spec.ts` (ahora 201 con la marca). **No** tocar las de
  `importacion`, `portal` ni `cambiar_titular`.
- Vitest: `tests/nuxt/documentoFiscal.test.ts` (o el existente) con los mismos casos de
  `revisarNit` y `avisoDocumentoFiscal`; `empresaDocumentos`/`multiempresa` siguen verdes.
- Playwright `tests/e2e/multiempresa.spec.ts`: crear empresa con `DEMO-123` muestra el aviso y
  guarda, en 1280 px y 390 px (`--trace off`).

### Lote 2 · Certificador ligado a empresa + proveedor + ambiente

API:

- `app/fiscal/fel/configuracion.ts`: nueva `estadoFel(empresaId, cliente)` que devuelve
  `{ lista: boolean, faltantes: Array<'proveedor' | 'credenciales' | 'credenciales_sin_probar' |
  'establecimiento' | 'nit_emisor'> }` para el proveedor y ambiente **guardados**. `lista` es
  `false` con `proveedor`, `credenciales` o `establecimiento` faltantes; `credenciales_sin_probar` y
  `nit_emisor` (en pruebas) solo informan.
- `GET /fel/configuracion` y la respuesta de `PUT` agregan `lista` y `faltantes[]`
  (`app/fiscal/esquemas.ts` `ConfiguracionFel`, y la ruta en `start/routes/fiscal.ts` o donde viva
  `/fel/configuracion`). No se agrega 422 al guardar (ver B3).
- `app/fiscal/actions/probar_credenciales_fel.ts` y su validador: `proveedor` opcional en la
  entrada (por defecto el guardado), igual que ya lo acepta `fel.guardar_credenciales`. Así se
  prueba lo que se acaba de guardar aunque el modo aún no esté guardado.
- `app/fiscal/tablero.ts` (ya lee `configuracionFel`): alerta «FEL activa sin credenciales» cuando
  `modo !== 'desactivada'` y `lista === false`.

Panel (`apps/web/app/pages/configuracion/fel.vue`, `FelCredencialesModal.vue`, `useFel.ts`):

- `credencialesDe(ambiente)` filtra también por `proveedorCredenciales.codigo`.
- `alGuardarCredenciales` y `probar` reemplazan por `proveedor + ambiente`; `probar` envía el
  proveedor de la tarjeta.
- Título del bloque: «Credenciales de {certificador}»; si hay credenciales de **otro** certificador
  en ese ambiente, una línea `text-muted`: «También hay credenciales guardadas de {otro}».
- Con cambios sin guardar en proveedor o ambiente: `UAlert` `info` «Guarda el certificador para que
  estas credenciales se usen al certificar».
- Si `configuracion.lista === false` y el modo no es `desactivada`: `UAlert` `color="error"` arriba
  con cada faltante en texto («Faltan las credenciales de INFILE para Producción», «La empresa no
  tiene establecimiento activo») y enlace al sitio donde se corrige.
- El encabezado del bloque «Certificador» muestra el NIT y el nombre comercial de la empresa activa
  (hoy solo está en las pastillas): se ve de quién son las credenciales.
- Revisar contra `.claude/diseno/tableros/OperConfigEmpresa.dc.html` y `ContaFel.dc.html`; lo que no
  esté en el tablero (avisos nuevos) se reporta al líder en `a4.md`, no se deja callado.

Pruebas:

- `tests/fiscal/fel_empresas.spec.ts` (nuevo):
    - Empresa B con credenciales `falso/pruebas` e `infile/pruebas`; C sin nada.
      `GET /fel/configuracion` con `X-Empresa-Id: C` → `credenciales: []`; con B → 2 filas, cada una
      con su `proveedor`.
    - `PUT /fel/credenciales/pruebas` con `X-Empresa-Id: B` y `empresa_id: C` en el cuerpo sin acceso
      a C → 403; con acceso → se guarda en C y B no cambia (`version` de B igual).
    - `POST /fel/credenciales/pruebas/probar` con `proveedor: 'falso'` mientras el guardado es
      `infile` → prueba las del falso (`resultado_prueba.ok = true`) y no toca la fila de INFILE.
    - B en `opcional` + `falso` sin credenciales → `lista: false`, `faltantes` incluye
      `credenciales`; tras guardarlas → `lista: true`, `faltantes: ['credenciales_sin_probar']`.
    - Empresa sin establecimiento activo → `faltantes` incluye `establecimiento`.
    - Usuario con alcance solo a B: `GET /fel/configuracion?empresa_id=C` → 403.
- Vitest `tests/nuxt/fel.test.ts`: fixture con credenciales de dos proveedores en `pruebas`; la
  tarjeta muestra las del proveedor elegido; «Probar» manda ese proveedor; el aviso de faltantes
  aparece con `lista: false`.
- Playwright `tests/e2e/fel.spec.ts`: cambiar de empresa en las pastillas recarga proveedor, modo y
  credenciales de la otra (regresión de «se mezcla»); 1280 px y 390 px.

### Lote 3 · Modos FEL que se cumplen y se ven

API:

- `app/fiscal/fel/errores.ts`: `FelDesactivada` (409, `fel_desactivada`, campo `empresa_id`).
- `app/fiscal/fel/accion.ts` (nuevo): `accionFel(config, factura, dteVigente)` → `{ fel_modo,
  fel_accion }` según R2. Es la única fuente de la decisión.
- `app/fiscal/actions/solicitar_certificacion.ts`: `modo === 'desactivada'` → a mano
  `FelDesactivada`; automático sigue omitiendo con `fel_desactivada`. Sin proveedor o sin
  credenciales sigue siendo 422 `fel_no_configurada`. El orden de las comprobaciones existentes
  (anulada, castigada, acreditada, en cero) no cambia.
- `app/fiscal/actions/reintentar_dte.ts`: `FelDesactivada` antes de `insertarDte`.
- `app/fiscal/actions/certificar_lote.ts`: una empresa desactivada devuelve cada factura con
  `motivo: 'fel_desactivada'` y `creado: false` (no aborta el lote de otras empresas).
- `app/billing/actions/crear_plantilla.ts`, `editar_plantilla.ts`, `app/billing/excepciones.ts` y la
  asignación de plantilla al servicio (`core/actions/crear_servicio.ts`, `editar_servicio.ts`):
  422 `certificar_al_incompatible` si el resultado deja `nunca` en un servicio no retirado de una
  empresa en `obligatoria`. Reutilizar la consulta de `configurar_fel.ts:79` extrayéndola a
  `#fiscal/fel/configuracion` (`serviciosConNunca(trx, { empresaId?, plantillaId?, servicioId? })`).
  Para `core` es una dependencia de A1 → A3: se anota en `a1.md` y se llama por la función pública.
- `app/billing/facturas.ts` y `app/billing/esquemas.ts`: `fel_modo` y `fel_accion` en `Factura`
  (detalle y lista; en lista con un `LEFT JOIN fiscal.fel_configuracion`, sin consulta por fila).
- `app/fiscal/esquemas.ts` + rutas: documentar 409 `fel_desactivada` en
  `POST /facturas/:id/certificar`, `POST /fel/lotes` y `POST /dte/:id/reintentar`.
- `localizacion-fiscal.md` §8.3 y §11.4: agregar `fel_desactivada` y la validación ampliada de
  `nunca`. `contratos/eventos.md`: sin eventos nuevos.

Panel:

- `app/utils/fel.ts`: `MODOS_FEL.opcional.descripcion` → «Nada se certifica solo, salvo los avisos
  «al pagar» cuando se cubren. Cada factura se certifica con el botón «Certificar (opcional)».»;
  `CERTIFICAR_AL` pasa a función `certificarAlTexto(valor, modo)`: en `opcional`, «Al emitir» y
  «Nunca» dicen «A mano, con el botón Certificar»; en `desactivada`, las tres dicen «Sin DTE (FEL
  desactivada)». `TITULOS_FEL.fel_desactivada` = «La FEL de la empresa está desactivada».
- `DteDocumento.vue`: recibe `accion` (`fel_accion`) y `modo` de la factura:
    - `certificar_opcional`: botón **«Certificar (opcional)»** `color="primary"` + texto «La FEL de
      esta empresa es opcional: esta factura queda sin certificar hasta que lo pidas.» y `UBadge`
      «Sin certificar».
    - `certificar_ahora`: botón «Certificar ahora» + «Se certifica sola al cubrirse el pago; puedes
      adelantarla.»
    - `automatica`: sin botón; «La FEL es obligatoria: se certifica sola.»
    - `ninguna` con modo `desactivada`: sin botón; «FEL desactivada: esta factura no se certifica.»
    - Con DTE certificado: `UBadge` «Certificada» (ya existe en `DteFicha`).
- `facturas/[id].vue`: pasa `factura.fel_accion` y `factura.fel_modo`; el distintivo de la cabecera
  (línea 342) muestra «Sin certificar» en `certificar_opcional`.
- `facturas/index.vue` y `CertificarLoteModal.vue`: la acción de lote solo se ofrece si alguna
  factura seleccionada tiene `fel_accion` `certificar_opcional` o `certificar_ahora`; el resumen del
  lote muestra las omitidas por `fel_desactivada`.
- `FelCertificarAl.vue`: usa `certificarAlTexto(valor, modo)`; en `obligatoria` la opción «Nunca»
  va `disabled` con «No se admite con FEL obligatoria»; en `desactivada` la tabla va de solo lectura
  con el aviso.
- Revisar contra `OperFacturaDetalle.dc.html` y `ContaFel.dc.html`; diferencias a `a4.md`.

Pruebas:

- `tests/fiscal/fel_modos.spec.ts` (nuevo):
    - **Desactivada:** `POST /facturas/:id/certificar` → 409 `fel_desactivada`; `fiscal.dte` sin
      filas; `POST /fel/lotes` con esa factura → `creado: false`, `motivo: 'fel_desactivada'`;
      `procesarColaFel` → `solicitados: 0`. Un DTE `rechazado` de cuando estaba activa →
      `POST /dte/:id/reintentar` → 409 `fel_desactivada` y sigue habiendo un solo DTE.
      `GET /facturas/:id` → `fel_modo: 'desactivada'`, `fel_accion: 'ninguna'`.
    - **Opcional + emitir:** factura nace `emitida`, sin DTE, `fel_accion: 'certificar_opcional'`;
      certificar → 200 `creado: true`; otra vez → `creado: false`, `motivo: 'ya_tiene_dte'`; tras la
      cola `fel_estado: 'certificado'`, `fel_accion: 'ninguna'`.
    - **Opcional + nunca:** igual que emitir (a mano permitido).
    - **Opcional + pagar:** aviso; sin pago `fel_accion: 'certificar_opcional'`; al pagar se
      certifica solo.
    - **Opcional sin credenciales:** certificar → 422 `fel_no_configurada` (no 409).
    - **Obligatoria + emitir:** nace `por_certificar` con DTE `pendiente`, `fel_accion:
      'automatica'`; no existe forma de dejarla sin DTE.
    - **Obligatoria + pagar:** aviso sin DTE, `fel_accion: 'certificar_ahora'`.
    - **Obligatoria, no se omite:** `PUT /plantillas-facturacion/:id` a `nunca` con un servicio de
      la empresa → 422 `certificar_al_incompatible` con el `servicio_id`; excepción
      `certificar_al = nunca` en ese servicio → 422; crear servicio con una plantilla `nunca` en esa
      empresa → 422. La misma plantilla en una empresa `opcional` → 200.
- Ajustar en `tests/fiscal/fel.spec.ts` (y los que lo afirmen fuera de `contabilidad/`) el caso
  «certificar con FEL desactivada»: de 422 `fel_no_configurada` a 409 `fel_desactivada`. Antes de
  cambiar el código, `grep -rn "desactivada" apps/api/tests/contabilidad` para confirmar que ninguna
  prueba de ahí depende del 422 (en esta sesión `grep fel_no_configurada apps/api/tests` no dio
  resultados).
- Vitest `tests/nuxt/felDocumentos.test.ts`: cuatro fixtures de factura (una por `fel_accion`):
  texto y presencia o ausencia del botón; el 409 `fel_desactivada` se muestra con su título.
- Playwright `tests/e2e/fel.spec.ts`: ficha de factura en modo opcional muestra «Certificar
  (opcional)» y «Sin certificar»; en desactivada no hay botón; 1280 px y 390 px.

#### Ejecución del lote 3 (25-nov-2026)

Hecho: 409 `fel_desactivada`; `fel_modo` y `fel_accion` (`#fiscal/fel/accion`, con `al_cobrar` en
lugar de `certificar_ahora`: antes del pago no hay DTE); `emitir` rechazado con 422
`certificar_al_obsoleto` y migrado a `pagar` con su diff; el cargo único sin plantilla usa `pagar`;
`nunca` validado en plantilla, excepción y asignación con FEL obligatoria; panel con los textos y el
botón según `fel_accion`. Desvíos: (1) la API sigue admitiendo certificar a mano un aviso sin cubrir
(solo el panel lo oculta): impedirlo rompe `tests/contabilidad`, que certifica avisos sin pagar;
(2) el valor `emitir` no se borra de la base: las pruebas del auditor insertan plantillas con
`emitir` directo y esperan el comportamiento de siempre; (3) `/fel/lotes` reporta la empresa
desactivada en `errores[]` con `tipo: fel_desactivada` (la forma que ya tenía el lote). No se
encontró regla de la SAT ni de un contrato (`iris_orden`, especial, exportación) que obligue a
certificar al emitir en lo que hoy emite Argos.

Pendiente (decisiones del PM del 25-nov que piden diseño y tocan la suite del auditor): cargos no
facturables por concepto, caja sin factura, recibo no fiscal con su numeración, cuentas internas de
ingresos y gastos no deducibles, egresos sin comprobante, visibilidad por caja y
`contabilidad.ver_cuentas_internas`, reporte «Cobros en cajas sin factura», y la regla del pago
repartido entre caja fiscal y sin factura (se propone al PM antes de implementarla).

### Lote 4 · Establecimientos según la SAT

Modelo (migración `node ace make:migration alter_establecimientos_sucursales`):

- `fiscal.establecimientos`: `codigo_postal text NULL` (`CHECK (codigo_postal ~ '^[0-9]{5}$')`).
- `fiscal.establecimientos_zonas (empresa_id bigint NOT NULL, zona_id bigint NOT NULL REFERENCES
  core.zonas, establecimiento_id bigint NOT NULL REFERENCES fiscal.establecimientos ON DELETE
  CASCADE, PRIMARY KEY (empresa_id, zona_id))`: una zona, un establecimiento por empresa.
  `empresa_id` se repite para la unicidad (una zona compartida puede ir a una sucursal distinta en
  cada empresa, regla 13).
- Sin columna en `billing.facturas` (R3).

API:

- `app/fiscal/establecimientos.ts`: `EstablecimientoVista` + `codigo_postal` y `zonas: number[]`;
  `CAMPOS_ESTABLECIMIENTO` + ambos (van a `audit.cambios`); `establecimientoPara(...)` (R3).
- `crear_establecimiento.ts` y `editar_establecimiento.ts`: aceptan `codigo_postal` y `zonas[]`
  (reemplaza el conjunto). Validan que cada zona exista, esté activa y sea de la empresa o
  compartida (422 por `zonas.N`); una zona ya asignada a otro establecimiento de la empresa se
  **mueve** y el otro queda en `audit.cambios`. Desactivar un establecimiento conserva sus zonas
  (dejan de aplicar mientras esté inactivo: se cae al por defecto).
- `app/fiscal/validators.ts` y `esquemas.ts` (`EstablecimientoFiscal`): los dos campos.
- `app/fiscal/fel/dte.ts`:
    - `insertarDte` recibe `establecimiento_id` resuelto por quien llama; deja de buscar el por
      defecto por su cuenta.
    - `solicitar_certificacion.ts`, `reintentar_dte.ts`, `billing/emision.ts` y la NCRE
      (`emitir_nota_credito.ts`) llaman a `establecimientoPara`; NCRE y NDEB toman el del DTE de
      origen.
    - Sin establecimiento: a mano 422 `establecimiento_requerido` (clase nueva); automático DTE
      `rechazado` local con `ultimo_error = 'establecimiento_requerido'`, `definitivo = true` y
      `dte.rechazado`. En `emision.ts` con `por_certificar` se comporta como hoy
      `receptor_requerido` (la factura queda `por_certificar` con el error visible).
    - `dteParaEnviar`: `codigo_postal` = el del establecimiento, o `'01001'` solo si es `null`
      (compatibilidad; el panel avisa que falta). Quitar el `?? 1` del código: si no hay
      establecimiento se rechaza local antes de enviar.
    - `DteFila` para la API: `establecimiento: { id, codigo, nombre } | null` (JOIN en `listarDte` y
      `verDte`); `Dte` en `esquemas.ts`.
- `app/fiscal/instalador_localizacion.ts`: sin cambios (ya siembra el establecimiento 1).
- `localizacion-fiscal.md` §3.2 y §8.1: tabla nueva, columna nueva y la regla R3.
  `contratos/eventos.md`: `fiscal.config_cambiada` con `establecimientos` ya cubre los cambios.

Panel:

- `useEstablecimientosFiscales.ts`, `utils/esquemasFiscal.ts`: `codigo_postal` (5 dígitos,
  opcional) y `zonas`.
- `EstablecimientoFiscalFormulario.vue`: campo «Código postal» y `USelectMenu` múltiple «Zonas que
  atiende» (de `useZonas`), con ayuda «Las facturas de clientes de estas zonas salen por este
  establecimiento; las demás, por el establecimiento por defecto.» El formulario pasa de 7 a 9
  campos: sigue en su modal actual solo si el tablero lo permite; si no, avisar al líder.
- `FiscalEstablecimientos.vue`: columna «Zonas» (chips; «Todas las demás» en el por defecto) y
  aviso `warning` si un establecimiento activo no tiene código postal o dirección.
- `DteFicha.vue`: fila «Establecimiento» con `código · nombre comercial`. `dte/index.vue`: columna
  «Establecimiento» (oculta en 390 px). `facturas/[id].vue`: se ve dentro de la pestaña «Factura
  electrónica» por `DteFicha`.
- `EmpresaFormulario.vue`: bajo «Código de establecimiento», ayuda «Es el primer establecimiento.
  Las sucursales se administran en Configuración › Fiscal».
- Fixtures de `EstablecimientoFiscal` y `Dte` con los campos nuevos.

Pruebas:

- `tests/fiscal/establecimientos_dte.spec.ts` (nuevo). Empresa B con establecimiento 1 (por
  defecto, «Casa matriz», zona —) y 2 («Sucursal Xela», `codigo_postal: '09001'`, zona Z2):
    - Cliente en Z2: su DTE lleva `establecimiento_id` del 2; `dteParaEnviar` → `emisor.
      establecimiento = 2`, `nombre_comercial = 'Sucursal Xela'`, `codigo_postal = '09001'`; el XML
      de `xmlDte` contiene `CodigoEstablecimiento="2"` y `NombreComercial="Sucursal Xela"`, y
      `NITEmisor` y `NombreEmisor` son los de la empresa.
    - Cliente en Z1 (sin asignar) y cliente sin zona → establecimiento 1.
    - Desactivar el 2 → factura nueva de Z2 sale por el 1; el DTE anterior conserva el 2.
    - NCRE de la factura de Z2 después de mover Z2 al establecimiento 1 → la NCRE sale por el **2**
      (el de su factura).
    - Asignar Z2 al establecimiento 1 → se quita del 2; `audit.cambios` de ambos; un evento
      `fiscal.config_cambiada` con `establecimientos`.
    - Zona de otra empresa (no compartida) → 422 en `zonas.0`.
    - Empresa C sin establecimientos activos: `POST /facturas/:id/certificar` → 422
      `establecimiento_requerido`; por la cola → DTE `rechazado` local y `dte.rechazado`.
    - Multiempresa: la misma zona compartida asignada al establecimiento 2 de B y al 1 de C; cada
      empresa resuelve el suyo.
    - `GET /dte/:id` → `establecimiento: { id, codigo: 2, nombre: 'Sucursal Xela' }`.
- `tests/fiscal/establecimientos_frases.spec.ts` sigue verde sin tocarlo.
- Vitest: formulario con zonas y código postal; `DteFicha` muestra el establecimiento.
- Playwright `tests/e2e/fiscal.spec.ts`: crear «Sucursal Xela» con zona, verla en la lista; ficha
  del DTE con su establecimiento; 1280 px y 390 px.

#### Ejecución del lote 4 (25-nov-2026, con P1 del PM)

Hecho: `fiscal.establecimientos.codigo_postal` y `ledger.cajas.establecimiento_id` (migración); el
establecimiento asigna sus cajas (`cajas[]` en crear y editar, una caja asignada a otro se mueve, diff
de cada caja en `audit.cambios`; 422 en `cajas.N` si es de otra empresa); `establecimientoPara`
(nota → el del DTE de origen; factura → el de la caja del último pago vigente aplicado; si no, el por
defecto); el XML lleva el código postal del establecimiento (01001 si falta); panel con «Código
postal» y «Cajas que cobran por esta sucursal». Desvíos: (1) sin ningún establecimiento activo se
conserva el comportamiento anterior (código de la empresa o 1) en vez de 422
`establecimiento_requerido`: las empresas de `tests/contabilidad` no tienen establecimiento y
certifican; queda el aviso `faltantes: establecimiento` y la decisión para el líder; (2) no se
agregó `establecimiento { id, codigo, nombre }` a `Dte` ni la fila en `DteFicha` y la cola (sigue
`establecimiento_id`); (3) la NCRE de una factura cobrada por completo no se puede emitir (regla
existente «sin saldo pendiente»): con «primero se cobra», una NCRE sobre un DTE ya pagado necesita
una regla de anticipo que no existe (para el PM y el contador).

### Lote 5 · Adaptador de INFILE según su documentación

Todo en `apps/api/app/fiscal/fel/` (B6). Sin red en las pruebas: se prueba con `fetch` sustituido.

- `infile.ts`:
    - `RespuestaInfile` con `razon_social`, `alertas_infile`, `alertas_sat`,
      `descripcion_alertas_infile[]`, `descripcion_alertas_sat[]` (`fuente`, `categoria`, `numeral`,
      `validacion`, `mensaje_error`), `saldo`, `creditos`, `control_emision`.
    - `errores(r)` junta `descripcion_alertas_sat`, `descripcion_alertas_infile` y, por
      compatibilidad, `descripcion_errores`, con el formato `fuente · validacion · mensaje_error`.
    - `consultarNit` lee `razon_social` y distingue `resultado: false` (no encontrado → `null`) de un
      error de red (lanza, para no confundir «no existe» con «no respondió»).
    - `probarCredenciales(cred, ambiente, contexto: { nit_emisor })`: consulta el NIT de la
      empresa; `ok` solo con HTTP 200 **y** una respuesta con forma de consulta (`resultado`
      presente); el detalle trae la razón social que devolvió INFILE para que el usuario vea que es
      su empresa. La firma del método cambia en `proveedor.ts`; `falso.ts` y
      `probar_credenciales_fel.ts` se ajustan.
    - Cabeceras con el nombre exacto de la documentación.
    - `certificar`: si la respuesta trae la alerta de sandbox y el DTE es de `ambiente =
      produccion`, el DTE **no** se da por certificado: `rechazado` con `ultimo_error =
      'certificado_en_sandbox'` y la respuesta en `fiscal.dte_intentos`. En `pruebas` se guarda
      `sandbox: true` en el intento.
    - La consulta previa por identificador (`consultar`) se conserva solo como respaldo; la
      idempotencia se apoya en reenviar con el mismo `Identificador` (documentado).
- `xml_gt.ts`: `UnidadMedida` `UND`; complemento de notas y XML de anulación **según lo que
  confirme el lote 6** (no se cambian a ciegas: el lote 6 prueba la forma actual y la documentada, y
  se queda la que INFILE acepte). `anular()` pasa al proceso unificado si el lote 6 lo confirma.
- `dte.ts`: una NCRE o NDEB toma `receptor` del DTE de origen.
- `core/actions/verificar_nit_cliente.ts`: R1 (forma en vez de módulo 11; apaga la marca).
  Dependencia A1 ← A3, se anota en `a1.md`.
- `localizacion-fiscal.md` §17, último punto («INFILE, por confirmar»): tachar lo que la
  documentación ya responde (misma URL en pruebas y producción; identificador repetido; proceso
  unificado para anular) y dejar lo que falte.

Pruebas (`tests/fiscal/infile_adaptador.spec.ts`, nuevo, con `fetch` falso y las respuestas del
manual):

- Certificación correcta → `certificado` con `uuid`, `serie`, `numero`.
- Rechazo con `descripcion_alertas_sat` «2.1.3 · El NIT del emisor no se encuentra activo…» →
  `rechazado` y ese texto en `errores` y en `fiscal.dte.ultimo_error`.
- Respuesta con la alerta de sandbox: en `pruebas` certifica y marca `sandbox`; en `produccion` →
  `certificado_en_sandbox`.
- Identificador repetido (`resultado: true` + «Documento enviado previamente») → mismo `uuid`, un
  solo DTE certificado.
- `consultarNit`: `{ resultado: true, razon_social: 'X' }` → `{ nombre: 'X' }`; `resultado: false` →
  `null`; HTTP 500 → lanza.
- `probarCredenciales`: 200 con `razon_social` → `ok: true` y el detalle la nombra; 401 →
  `ok: false`.
- XML: `CodigoEstablecimiento`, `NombreComercial`, `Direccion`, `CodigoPostal`, `Municipio` y
  `Departamento` son nodos separados; `UnidadMedida` es `UND`; el CUI lleva `TipoEspecial="CUI"`; CF
  lleva `IDReceptor="CF"`; contingencia lleva `NumeroAcceso` entre 100000000 y 999999999.
- NCRE de un cliente al que se le cambió el NIT después de la factura → `IDReceptor` = el de la
  factura.

### Lote 6 · Prueba contra el ambiente demo de INFILE

Es una prueba **manual y supervisada**, no parte de la suite ni de CI. Emisor **[demo]**: DEMO
COMERCIAL, S.A., NIT `1170142K`, afiliación IVA `GEN`, establecimiento `1` «DEMO», CIUDAD
GUATEMALA, GUATEMALA; frases 1/1, 2/1, 4/1, 5/1, 9/16, 9/17. Los dos servicios (certificación y
consulta de NIT) responden desde la máquina de trabajo.

Reglas de las llaves (obligatorias):

- Están en un archivo fuera del repositorio, con permisos 600. El coordinador le da la ruta al
  ejecutor; **no se escribe aquí**.
- Se cargan solo de dos formas: como variables de entorno del proceso (`set -a; . <archivo>; set
  +a` en la misma orden que corre el script) o tecleándolas en el panel (Configuración › FEL ›
  Credenciales), que las guarda cifradas por `fel.guardar_credenciales`.
- Siempre contra una base de pruebas propia (`DB_DATABASE=argosisp_test_fel` o una
  `argosisp_demo_fel`); nunca la base de desarrollo compartida.
- **Nunca** van al repositorio, a fixtures, a snapshots, a `.env.example`, a la salida de una
  prueba ni a un log. No se imprimen (`echo`, `console.log`, `set -x`), no se pegan en el contrato,
  en un commit ni en el informe. Antes de cada commit del lote: `git diff --cached | grep -i` por el
  usuario y por cada llave, que no debe encontrar nada.
- `fiscal.dte_intentos.respuesta` y `audit.acciones` ya no guardan credenciales (van en cabeceras y
  en `secreto`): el lote lo **comprueba** con un `SELECT` que busque cada llave en esas dos tablas.
- Al terminar se borra la base de la prueba o, al menos, `fiscal.fel_credenciales` de esa empresa.

Pasos (cada uno deja escrito aquí, en una tabla «Resultados del ambiente demo», qué respondió
INFILE: `resultado`, `descripcion`, alertas y errores; nunca credenciales):

1. Crear la empresa con NIT `1170142K` (prueba real del lote 1: debe guardar con `nit_valido:
   false`), razón social DEMO COMERCIAL, S.A., establecimiento 1 «DEMO», Guatemala, Guatemala,
   código postal `01001`.
2. FEL: proveedor `infile`, ambiente `pruebas`, modo `opcional`. Guardar credenciales y **Probar**:
   debe responder válidas con la razón social del emisor.
3. **Consulta de NIT:** `76365204` (receptor de los ejemplos) → encontrado, con razón social; un
   NIT inexistente → no encontrado; `1170142K` → anotar qué responde.
4. **Certificar** una FACT de Q120.00 a un receptor con NIT `76365204`, frases 1/1 y 2/1: debe
   volver certificada, con UUID, serie y número, y con la alerta de sandbox. Guardar el XML
   certificado (es de pruebas, sin valor fiscal) como evidencia en la base, no en el repositorio.
5. Certificar una FACT a **CF** y otra a un **CUI** (`TipoEspecial="CUI"`).
6. Certificar una FACT con receptor de NIT que no cuadra (`ABC123`): anotar el rechazo exacto
   (categoría, numeral, validación, mensaje). Es la respuesta que justifica o corrige R1 y P3.
7. Certificar con `CodigoEstablecimiento="2"` (no autorizado): anotar el rechazo exacto. Es la
   evidencia de «el establecimiento debe estar autorizado» y el texto que el panel debe mostrar.
8. **Reintento:** reenviar el DTE del paso 4 con el mismo identificador: mismo UUID y las alertas
   de re-intento.
9. **NCRE** contra la FACT del paso 4 con el complemento en la forma actual; si la rechaza, con la
   forma del manual (`IDComplemento="Notas"`). Queda en el código la que INFILE acepte.
10. **Anular** la FACT de un paso anterior: primero por el proceso unificado con el XML del manual;
    si lo rechaza, con la forma actual (firma aparte). Anular otra vez el mismo: debe rechazar con
    la fecha de anulación entre corchetes; el adaptador lo debe tratar como «ya anulado», no como
    error.
11. **Contingencia:** un DTE con `NumeroAcceso` enviado después: debe certificar.
12. Probar `UnidadMedida` `UNI` frente a `UND` si el paso 4 no lo dejó claro.
13. Verificación de fugas: los `SELECT` y el `grep` de arriba, y `git status` limpio de archivos
    con llaves.

Con los resultados: corregir `xml_gt.ts` e `infile.ts` (lo que el lote 5 dejó pendiente de
confirmar), agregar a `tests/fiscal/infile_adaptador.spec.ts` un caso por cada respuesta real
observada (copiando la **forma** de la respuesta, con datos del emisor demo, sin llaves) y
actualizar §17 de `localizacion-fiscal.md`.

Frases: si el catálogo del paquete GT (`app/fiscal/l10n/`) no trae alguno de los pares 1/1, 2/1,
4/1, 5/1, 9/16, 9/17, se agrega al catálogo de frases **manuales** disponibles (tipo, escenario y
texto), sin asignarlo a ningún régimen: cuál aplica a cada empresa lo decide el contador (P9).

#### Resultados del ambiente demo (25-nov-2026)

Corrida de `tests/fiscal/infile_demo.spec.ts` (manual; se salta sin `INFILE_DEMO_*`) contra el demo
de INFILE con el emisor DEMO COMERCIAL, S.A., en la base `argosisp_test_fel`. Sin credenciales; la
evidencia completa (UUID, serie, número, alertas) quedó fuera del repositorio. Las credenciales de la
empresa demo se borran de la base al terminar.

| Paso | Qué respondió INFILE | Consecuencia en el código |
| --- | --- | --- |
| 1 | Empresa con NIT `1170142K`: 201, `nit_valido: false` | Lote 1 confirmado |
| 2 | Probar credenciales: la consulta de su propio NIT responde `{ nombre: "", mensaje: "NIT no válido" }` | `probarCredenciales` da `ok` con «no encontró el NIT»; credenciales malas responden «Credenciales no registradas» (`ok: false`) |
| 3 | Consulta de NIT real: `{ nit, nombre, mensaje }` (no `resultado`/`razon_social` como el manual). `76365204` → nombre; `1000001` y `1170142K` → «NIT no válido» | `leerConsultaNit` acepta las dos formas; «Credenciales no registradas» lanza (no es «no existe») |
| 4 | FACT Q120.00 a `76365204`, frases 1/1 y 2/1: «Validado y Certificado Exitosamente», serie `**PRUEBAS**`, número decimal, alerta de SandBox | Certifica; `sandbox: true` en el intento. En el sandbox la serie no son los 8 hexadecimales del UUID |
| 5 | CF: certifica. CUI `2984561320101` (el de los fixtures): rechazo 2.2.4 «El CUI del Receptor no es válido. No cumple con el algoritmo de validación» | La SAT sí valida el verificador del CUI (`nit_cui.ts` no lo aplica): seguimiento para A1 |
| 6 | NIT `ABC123`: rechazo 2.2.4 «El NIT del Receptor [ABC123] es inválido [2]. (2244)» | El certificador valida el NIT del receptor; el motivo llega a `ultimo_error` (`descripcion_errores`) |
| 7 | `CodigoEstablecimiento="2"`: rechazo 2.2.3 «El establecimiento [2] no existe. (2202)» | Texto que el panel debe mostrar (lote 4) |
| 8 | Reenvío con el mismo identificador: mismo UUID + «Documento enviado previamente» y «Documento consultado en modalidad de re-intento» | `reenvioIdempotente` confirmado |
| 9 | NCRE con el complemento `Notas` del manual: certifica | Se queda la forma del manual |
| 10 | Anulación con la forma del manual (namespace `0.2.0`, elementos hijos): rechazo XSD «No matching global declaration available for the validation root». Con `dte:DatosGenerales` y atributos (namespace `0.1.0`): «Validado y Anulado Exitosamente». Anular otra vez: `resultado: true` con «…ya esta anulado…» | `xmlAnulacion` usa `atributos` por defecto; «ya anulado» se registra como anulado (`ya_anulado`) |
| 11 | Contingencia con `NumeroAcceso`: certifica | Correcto |
| 12 | `UnidadMedida` `UNI`: también certifica | Se queda `UND` (la de los ejemplos) |
| 13 | Ninguna llave en `fiscal.dte_intentos`, `audit.acciones` ni `audit.cambios` | Correcto |

Frases: el catálogo GT no trae un «catálogo de frases manuales disponibles»; las frases manuales son
filas por empresa (`fiscal.frases`, `fel.agregar_frase`). Para el demo se agregó la 2/1 a la empresa
de prueba; crear un catálogo de frases sugeridas queda pendiente de decisión (P9).

### Lote 7 · Cierre

- README de `apps/api/app/fiscal/` y `apps/api/app/core/` (regla de NIT, modos, establecimientos,
  errores nuevos). `localizacion-fiscal.md` §11.4 con `nit_emisor_invalido`, `fel_desactivada`,
  `establecimiento_requerido`.
- `.claude/integration/a3.md` (dueño de fiscal y billing), `a1.md` (núcleo: NIT tolerante, trigger,
  validación de `nunca` al asignar plantilla; pendientes: importador, portal, `verificar_nit`,
  `cambiar_titular`), `a4.md` (panel: textos y avisos que no están en los tableros).
- `NODE_ENV=development pnpm contracts:build`, `pnpm lint`, `pnpm typecheck`,
  `pnpm verificar:permisos`. No hay permisos nuevos: todo cae en `fel.configurar`,
  `fel.certificar`, `fiscal.configurar`, `empresas.editar`.
- Corrida completa de `tests/fiscal/*.spec.ts`, `tests/core/empresas*.spec.ts`,
  `tests/core/clientes.spec.ts`, `tests/billing/cargo_unico.spec.ts` y
  `tests/contabilidad/fase3.spec.ts`, `hallazgos_fase3.spec.ts` (sin editarlas).
- `pnpm demo:datos` y un recorrido del panel contra la API real: empresa con NIT `DEMO-123`,
  certificador falso, sucursal con zona, factura en cada modo.

Orden y dependencias: 1 → 2 → 3 → 4 → 5 → 6 → 7. El 2 usa `nit_valido` del 1 y el faltante
`establecimiento` (basta la consulta; no depende del 4). El 3 y el 4 no dependen entre sí. El 6
necesita el 1 (NIT `1170142K`), el 2 (credenciales por proveedor) y el 5; si el tiempo aprieta, el
orden útil para el PM es 1 → 2 → 5 → 6 (ya se certifica en demo) y después 3 y 4.

---

## 5. Preguntas para el PM (decisiones de negocio; nada de esto se decide en el código)

**Respuestas del PM (25-nov-2026).** Las marcadas «decisión del PM» mandan sobre el texto del plan
que contradigan (R1, R3 y los lotes 4 y 5); P2, P5, P6, P8, P9 y P10 siguen abiertas y se aplica lo
que propone el plan.

- **P1 · decisión del PM (25-nov-2026).** La factura sale del establecimiento **de la caja** que la
  cobra: cada caja tiene su establecimiento. Las facturas que no pasan por caja (cron mensual, Iris,
  API) salen del establecimiento **por defecto** de la empresa. Las notas (NCRE, NDEB) usan el
  establecimiento del DTE de su factura. Sin ningún establecimiento: 422 `establecimiento_requerido`.
  **Reemplaza la regla de la zona del cliente** de R3 y del lote 4 (no se crea
  `fiscal.establecimientos_zonas`).
- **P3 y P4 · decisión del PM (25-nov-2026).** El NIT del cliente en producción se decide con la
  consulta de NIT de INFILE: si la SAT lo reconoce (existe y está activo) se usa ese NIT aunque no
  cuadre con el módulo 11; si no existe, sale como consumidor final con un aviso visible en la
  factura y en el cliente; si INFILE no responde, se aplica la regla de hoy (con la marca, CF) y se
  deja un aviso.
- **P7 · decisión del PM (25-nov-2026).** Se puede activar «Obligatoria» sin credenciales probadas;
  solo se muestra un aviso hasta que funcionen (es lo que ya propone el lote 2: aviso, no 422).
- **P11 · decisión del PM (25-nov-2026).** La consulta del NIT a INFILE se hace **al guardar el
  cliente** (al crearlo o al cambiar su NIT); se guardan el nombre y el resultado. Además hay un
  botón «Consultar NIT» para repetirla. No se consulta en cada factura.
- **Cobrar antes de certificar · decisión del PM (25-nov-2026).** Primero se cobra y después se
  certifica. Toda factura nace como **aviso de cobro**, sin DTE; el DTE se genera cuando la factura
  queda **cubierta por completo** (lo que hoy hace `certificar_al = pagar`, «DTE al cubrirse»); un
  pago parcial no certifica. `certificar_al = emitir` deja de usarse: el cargo único pasa a `pagar`
  por defecto, ninguna acción nueva acepta `emitir` (422 con mensaje claro) y las plantillas,
  excepciones y cargos con `emitir` se migran a `pagar` con su diff en la auditoría (antes de quitar
  el valor se revisa si alguna regla de la SAT o de un contrato obliga a certificar al emitir; si la
  hay, queda como excepción documentada). Opcional: el botón «Certificar» solo en facturas pagadas o
  cubiertas sin DTE; en una pendiente, «Se certifica al cobrarla». Obligatoria: al cubrirse, el DTE
  entra solo a la cola, sin botón para omitirlo. `nunca` sigue sin admitirse con obligatoria. Panel:
  «Aviso de cobro (sin certificar)» → «Pagada, certificando» → «Certificada», o el error con
  «Reintentar». Se aplica en el lote 3 y **reemplaza** los casos «al emitir» de R2 y del lote 3.
- **Cargos no facturables · decisión del PM (25-nov-2026).** Se decide por concepto de cargo
  (`GET /conceptos-cargo`): campo `facturable` (true por defecto en todos los existentes); al emitir
  un cargo único, quien tenga el permiso puede cambiarlo para ese cargo. Un cargo no facturable es un
  cobro de control: entra a la cuenta del cliente, a la caja y al libro contable, pero nunca genera
  DTE ni entra en los libros fiscales (IVA y ventas), en cualquier modo FEL. El panel dice «Este
  cargo no se factura». El cargo de instalación de Iris (`iris_orden`) sigue la marca de su
  concepto. El tratamiento contable (IVA) no se inventa: lo que no esté claro va al contador o al PM.
  Se aplica en el lote 3.
- **Caja sin factura · decisión del PM (25-nov-2026).** Cada caja tiene la marca `fiscal` (true por
  defecto). Una caja `fiscal = false` cobra y lleva todo el control (cierres, arqueo, depósitos,
  asientos), pero sus cobros no certifican: las facturas que se cubren en ella no generan DTE ni
  entran en los libros fiscales. Se permite incluso con FEL «Obligatoria», con un aviso visible en la
  configuración de la caja y en el cobro. Esos cobros salen en un reporte aparte, «Cobros en cajas
  sin factura». Una caja sin factura no necesita establecimiento (P1). Las dos marcas se configuran
  con su permiso, auditoría y evento. Un pago repartido entre caja fiscal y sin factura: regla
  propuesta al PM antes de implementarla. Se aplica en el lote 3.
- **Recibo no fiscal · decisión del PM (25-nov-2026).** Lo que se entrega al cobrar en una caja sin
  factura, o al cubrir un cargo no facturable, es un **recibo no fiscal de pago** (ni aviso de cobro
  ni factura): dice claramente que no es factura y no lleva DTE, serie ni número de la SAT. Numeración
  propia, correlativa y sin huecos por empresa (el ejecutor decide si por caja o por empresa y lo
  justifica). Se imprime y consulta como el recibo de cobro de hoy (plantillas `recibo_cobro`). En el
  panel la factura o el cargo cubierto así se ve «Pagada · Recibo #N», nunca como aviso pendiente ni
  «por certificar». Antes del pago sigue siendo aviso de cobro. Los recibos salen en el reporte
  «Cobros en cajas sin factura». Si choca con la contabilidad (ingresos, IVA) se avisa, no se inventa.
  Se aplica en el lote 3.
- **Contabilidad de los recibos · decisión del PM (25-nov-2026).** Los recibos (caja sin factura y
  cargos no facturables) se registran en una **cuenta especial interna** del plan de cuentas de cada
  empresa (siembra para las nuevas, migración para las existentes; nombre sugerido «Ingresos por
  recibos internos (caja sin factura)»; el código sigue la numeración del catálogo y se justifica).
  El asiento del recibo va contra esa cuenta en lugar de la de ingresos facturados, sin IVA débito,
  con la doble partida y el cierre de caja de siempre. La cuenta queda fuera de los libros fiscales y
  de las declaraciones (IVA, ISR, libro de ventas) con una exclusión explícita y verificable (atributo
  de la cuenta); sí aparece en el balance y el estado de resultados internos y en el reporte «Cobros
  en cajas sin factura». La cuenta se puede cambiar por empresa, con permiso y auditoría. La suite
  `tests/contabilidad/` se corre completa y no se edita. Se aplica en el lote 3.
- **Para qué es la caja sin factura · decisión del PM (25-nov-2026).** Para operaciones reales que
  no llevan factura (pagos por dejar pasar por un camino, permisos por un poste o un cable). No es
  para ocultar nada a la SAT: es para que esos datos no se mezclen con los de la declaración. Mueve
  entradas y salidas.
    - **Salidas:** la caja registra egresos con descripción, beneficiario (texto libre), motivo y
      adjunto opcional. Asiento: gasto contra una cuenta interna de **gastos no deducibles** (creada
      en el plan de cada empresa, como la de ingresos internos) con salida de la caja; fuera de los
      libros fiscales y del crédito fiscal del IVA. Se reúsan los egresos de caja existentes
      (`/egresos`, retiros), sin duplicar.
    - **Entradas:** el recibo y la cuenta de ingresos internos.
    - **Visibilidad:** la caja tiene la lista de usuarios que pueden verla y usarla (operar, ver
      cierres y movimientos), con el alcance por caja del ACL (regla 8). Las cuentas internas
      (ingresos y gastos), sus movimientos, asientos y reportes los ven solo quienes tienen un permiso
      propio (`contabilidad.ver_cuentas_internas`); los demás ven los estados sin esas cuentas o
      agregadas en una línea «Interno (restringido)» (el ejecutor decide cuál y lo justifica).
    - **Sin ocultar nada en una auditoría:** todo sigue en el libro inmutable y en `audit.*`; Debe =
      Haber y el sellado no cambian; quien tiene el permiso ve todo; la restricción es solo de
      visibilidad, con su bitácora.

- **P1 · Cómo se elige la sucursal.** El plan usa la **zona del cliente** y, si no hay, el
  establecimiento por defecto. ¿Es ese el criterio, o debe ser la caja que cobra, el router o un
  campo propio del servicio? Lo confirma el contador: la SAT pide que el código exista y esté
  activo; no se encontró norma que diga cuál usar.
- **P2 · «Nunca» con FEL opcional.** Hoy una plantilla «Nunca» en una empresa opcional se puede
  certificar a mano (es como funcionan las plantillas anteriores a la FEL). ¿Debe «Nunca» prohibir
  también el botón, o se queda como «a mano»?
- **P3 · NIT del cliente que no cuadra, en producción.** Hoy sale como Consumidor Final (hasta el
  límite de CF). ¿Se mantiene, o se prefiere bloquear la certificación hasta corregir el NIT?
- **P4 · NIT de prueba del certificador.** Respondida: el emisor demo es `1170142K` y no cuadra con
  el módulo 11; el plan lo admite con advertencia. Queda una duda para INFILE o el contador: ¿hay NIT
  **reales** que no cuadren con ese módulo 11? Si los hay, el bloqueo de `nit_emisor_invalido` en
  producción (R1) debe ser solo advertencia.
- **P5 · Desactivar la FEL con documentos en cola.** El plan deja terminar los DTE que ya estaban en
  cola. ¿O se debe impedir desactivar mientras haya DTE pendientes?
- **P6 · «Opcional» + «Al emitir».** Hoy no certifica solo (decisión aprobada en la fase 3). ¿Se
  quiere que en opcional «Al emitir» sí pida el DTE automáticamente? Cambia la contabilidad del IVA
  y lo debe ver el contador.
- **P7 · Activar sin credenciales.** El plan avisa pero deja guardar. ¿Se prefiere impedir activar
  «Obligatoria» hasta que las credenciales estén guardadas y probadas?
- **P8 · Código postal y datos de cada sucursal.** Deben coincidir con el RTU. ¿Quién los carga (el
  contador) y con qué constancia?
- **P9 · Frases de cada empresa.** El emisor demo trae 1/1, 2/1, 4/1, 5/1, 9/16 y 9/17. ¿Cuáles
  lleva cada empresa real y en qué documentos? Lo define el contador según el régimen.
- **P10 · Aviso de contingencia a la SAT.** INFILE indica que hay que registrar el aviso en la
  Agencia Virtual o por correo. ¿Quién lo hace cuando Argos activa la contingencia? El plan solo
  propone recordarlo en la pantalla.
- **P11 · Consulta de NIT al guardar el cliente.** INFILE la recomienda antes de emitir. ¿Se quiere
  automática al guardar o al certificar (consume el cupo diario de INFILE), o solo con el botón?

---

## 6. Fuentes

Principal: **Documentación INFILE (docs.infile.com, sección Guatemala)**, actualizada el 11-nov-2026:
«Certificación / Anulación de DTE», «Consulta de NIT», «Consulta de CUI» y los ejemplos de XML
(factura, factura cambiaria, factura especial, exportación, nota de crédito, nota de débito, nota
de abono, recibo, recibo por donación y contingencia). Es documentación privada compartida por el
PM: no está en el repositorio y no se copia. Más los datos no secretos del emisor de pruebas
(DEMO COMERCIAL, S.A.) que INFILE le entregó al PM.

Públicas:

1. Acuerdo de Directorio SAT 13-2018, Régimen FEL (vLex): <https://gt.vlex.com/vid/acuerdo-directorio-no-13-913599220>
2. Deloitte, Tax Newsletter FEL (publicación y vigencia): <https://www.deloitte.com/content/dam/Deloitte/gt/Documents/tax/GUATEMALA/Taxnewsletter/180507-Tax%20Newsletter-FEL.pdf>
3. Acuerdo de Directorio 15-2020, reformas (vLex): <https://gt.vlex.com/vid/acuerdo-directorio-no-15-913390202>; Deloitte sobre el 26-2019: <https://www.deloitte.com/content/dam/Deloitte/gt/Documents/tax/notas-fiscales/191127-taxalert-noviembre5.pdf>
4. EDICOM, «Cómo cumplir con la factura electrónica en Guatemala y el Régimen FEL»: <https://edicomgroup.com/es/blog/guatemala-como-funciona-fel-factura-electronica-en-linea>
5. Mindy, requisitos para facturar (establecimiento activo, afiliación IVA): <https://mindy.gt/blog/negocio-en-guatemala-listo-para-facturar-electronicamente/>
6. Odoo, localización de Guatemala (código de establecimiento, credenciales INFILE, ambientes, frases): <https://www.odoo.com/documentation/18.0/es/applications/finance/fiscal_localizations/guatemala.html>
7. USAC, presentación pública FEL 2018 (contingencia): <https://auditoria.usac.edu.gt/wp-content/uploads/2019/07/FEL-presentacion-publica-2018.pdf>
8. Constancia de RTU con nombre comercial y secuencia de establecimiento: <https://www.florafoodgroup.com/-/media/Project/Upfield/Corporate/Upfield-Corporate/Proof-of-name-change/Guatemala/20250221--FLORA-FOOD-GUATEMALA-SA--RTU--NAME-CHANGE-CONFIRMATION.pdf?rev=fb38f143b22642a882afe03fac320053>
9. Portal SAT, Régimen FEL: <https://portal.sat.gob.gt/portal/efactura/> (respondió 403 a la herramienta: **no leído**; ahí están el XSD y «Reglas y validaciones» que el ejecutor o el contador deben contrastar).

Sin fuente primaria leída en esta sesión: el XSD `GT_Documento` y el documento «Reglas y
validaciones» de la SAT. Todo lo marcado **[esquema]** o **[sin verificar]** se confirma en el lote
6 contra el ambiente demo de INFILE.
