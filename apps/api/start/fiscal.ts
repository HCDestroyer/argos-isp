/*
|--------------------------------------------------------------------------
| Localización fiscal (A3)
|--------------------------------------------------------------------------
|
| Registra el instalador de `app/fiscal` en el punto de extensión del núcleo
| (`#core/localizacion`): `empresas.crear` y `empresas.cambiar_pais` instalan la localización del
| país en su misma transacción. En todos los ambientes (web, consola, pruebas, workers).
*/
import { registrarInstaladorLocalizacion } from '#core/localizacion'
import { instaladorFiscal } from '#fiscal/instalador_localizacion'

registrarInstaladorLocalizacion(instaladorFiscal)
