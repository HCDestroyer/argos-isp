/*
|--------------------------------------------------------------------------
| Conector Horus (A6)
|--------------------------------------------------------------------------
|
| Solo en el servidor HTTP: se suscribe a las invalidaciones de la configuración del conector
| (`horus.config_cambiada` → Pub/Sub). No bloquea el arranque ni llama a Horus.
*/
import { escucharInvalidacionesHorus } from '#integraciones/horus/configuracion'

void escucharInvalidacionesHorus()
