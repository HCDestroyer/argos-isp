/*
|--------------------------------------------------------------------------
| Configuración de canales de notificación (A6)
|--------------------------------------------------------------------------
|
| Solo en el servidor HTTP: siembra la configuración global desde el entorno si falta, se
| suscribe a las invalidaciones y la carga (`app/notify/arranque.ts`). No bloquea el arranque.
| El worker (`node ace notify:worker`) lo hace por su cuenta.
*/
import { prepararConfiguracionNotify } from '#notify/arranque'

void prepararConfiguracionNotify()
