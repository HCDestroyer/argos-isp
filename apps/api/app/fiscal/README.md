# fiscal · Localización fiscal (A3)

Localización de Guatemala por empresa (NIT): paquete versionado, parámetros e impuestos con vigencia, régimen, establecimientos y frases. Contrato: `.claude/integration/contratos/localizacion-fiscal.md` (fase 2). Las tasas, plazos y formularios salen de la investigación del líder (`inv. X.n`); lo NO VERIFICADO no trae valor y responde 422 `parametro_sin_confirmar` cuando un cálculo lo necesita.

## Paquete e instalador

- `l10n/gt/` es código versionado (`gt-2026.1`): `cuentas.ts` (plan base + cuentas GT, con `patrimonio`, contracuentas y categoría de flujo), `parametros.ts` (50 parámetros con fuente, confianza y marca «confirmar con contador»), `impuestos.ts` (IVA, retenciones de IVA e ISR como impuestos negativos, ISR, ISO y pequeño contribuyente) e `index.ts` (frases por régimen, tipos de DTE, régimen inicial desde `core.empresas.regimen_isr`). Una versión publicada no se edita: el instalador guarda su `checksum` y falla si cambió.
- `instalador.ts`: `instalarPaquete(trx, paquete, empresaId, { instaladaPor, hoy })` **solo inserta lo que falta** (cuentas, catálogo, valores del paquete, impuestos y, la primera vez en la empresa, `inicio_libros`, el régimen que ya tenía y su establecimiento). Instalar dos veces no agrega nada. `ULTIMO_PAQUETE` da la versión más reciente de cada país (`paqueteDePais`, 422 `pais_no_soportado`).
- `instalador_localizacion.ts` (`instaladorFiscal`): implementa el punto de extensión del núcleo (`InstaladorLocalizacion` de `#core/localizacion`, A1) y lo registra el preload `start/fiscal.ts`. `empresas.crear` y `empresas.cambiar_pais` instalan la localización en su misma transacción (por `ActualizarLocalizacion` con `desde_nucleo`), así una empresa nace instalada. `tieneDocumentos` revisa los documentos de `fiscal` (DTE, compras, declaraciones y libros, a medida que existan) y `datosFiscales` da `regimen_isr` y `codigo_establecimiento` desde el parámetro `regimen` y el establecimiento por defecto (también los usa `emisorDeFactura` de `#billing/empresa`). El 422 `localizacion_no_instalada` queda solo para una empresa sin paquete instalado (fila creada fuera de `empresas.crear`).
- La migración `1792254122357_fiscal_localizacion` instala `gt-2026.1` en todas las empresas existentes.

## Parámetros e impuestos con vigencia

- `fiscal.parametros_valores` e `impuestos_versiones` son **solo de inserción** (trigger + `REVOKE`). Editar = insertar una fila con `vigente_desde`; lo anterior a esa fecha no cambia.
- Lectura (`parametros.ts`, `impuestos.ts`): en cada nivel la fila más reciente con `vigente_desde <= fecha`; gana el primero que tenga una: empresa (`usuario`) → instalación → global (`usuario`, sin empresa) → paquete. `parametro(empresaId, clave, fecha)`, `valorParametro`, `parametrosVigentes`, `impuesto(empresaId, codigo, fecha)`, `impuestosVigentes`.
- Validación (`validarValor`): tipo, opciones, mínimo/máximo, forma de los `json` (la del paquete) y tope por clave (depreciación). La base repite alcance, rango y signo de la retención.
- Caché en memoria por empresa (`cache_parametros.ts`), **sin TTL**: se invalida al confirmar la acción y por Redis Pub/Sub entre procesos; `ConsumidorFiscal` (billing-worker) reenvía el aviso al recibir `fiscal.parametros_cambiados`. Sin suscripción activa no se usa la caché.

## Acciones

| Acción (permiso) | Ruta | Qué hace |
| --- | --- | --- |
| `fiscal.instalar` | `POST /fiscal/empresas/:id/actualizar-localizacion` | Instala o actualiza la versión del paquete |
| `fiscal.editar_parametros` | `POST /fiscal/parametros/:clave/valores` | Valor nuevo con vigencia (empresa o global con alcance global) |
| `fiscal.editar_impuesto` (`fiscal.editar_parametros`) | `POST /fiscal/impuestos/:codigo/versiones` | Versión nueva de la tasa o inactiva |
| `fiscal.cambiar_regimen` | `POST /fiscal/regimen` | Primera configuración con cualquier fecha; cambio solo el 1 de enero de un año futuro con aviso SAT de diciembre (LAT, art. 51) |
| `fiscal.crear_establecimiento` / `fiscal.editar_establecimiento` (`fiscal.configurar`) | `POST/PUT /fiscal/establecimientos` | Uno por defecto por empresa; el código SAT no se edita |
| `fiscal.agregar_frase` (`fiscal.configurar`) | `POST /fiscal/frases` | Frase manual o su retiro (`activa: false`) |

Lecturas (`fiscal.ver`): `GET /fiscal/localizaciones`, `/fiscal/empresas/:id/localizacion`, `/fiscal/parametros?fecha=`, `/fiscal/parametros/:clave/historial`, `/fiscal/impuestos?fecha=`, `/fiscal/impuestos/:codigo/historial`, `/fiscal/establecimientos[/:id]`, `/fiscal/frases?fecha=`.

Las frases del régimen no se guardan: se derivan al leer del régimen vigente en la fecha (así siguen exactamente su vigencia). Las manuales viven en `fiscal.frases`.

Errores: 422 `localizacion_no_instalada`, `pais_no_soportado`, `parametro_no_editable`, `parametro_fuera_de_rango`, `parametro_sin_confirmar`, `vigencia_en_periodo_bloqueado` (un mes cerrado en o después de la fecha; en la fase 5 se suman los bloqueos), `regimen_fuera_de_plazo`, `establecimiento_por_defecto`, `frase_del_regimen`, `frase_inactiva`; 403 `alcance_global_requerido`; 409 `vigencia_duplicada`, `establecimiento_duplicado`.

## Eventos

- Emite `fiscal.localizacion_instalada`, `fiscal.parametros_cambiados` (claves de parámetros o `impuesto:<codigo>`) y `fiscal.config_cambiada` (`regimen`, `fel_modo`, `establecimientos`, `frases`).
- Consume `fiscal.parametros_cambiados` (grupo `billing`) para invalidar la caché.

## Libro (`ledger`) en esta fase

`ledger.cuentas`: tipo `patrimonio`, `pais`, `contracuenta`, `naturaleza` y `reinicia_anual` (generadas), `categoria_flujo`, `categoria_fiscal`, `auxiliar_proveedor`, `libro_inventario`. `ledger.movimientos.impuesto_codigo` + `cuadricula` (etiqueta de base o cuota; `registrarAsiento` la acepta y valida). El balance suma patrimonio y resta las contracuentas.
