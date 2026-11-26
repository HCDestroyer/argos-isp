/*
|--------------------------------------------------------------------------
| Cuentas de pasarela (A3, D0)
|--------------------------------------------------------------------------
|
| Solo en el servidor HTTP: siembra la cuenta de pasarela de la empresa principal desde el entorno
| si falta (`app/billing/arranque_pasarelas.ts`). No bloquea el arranque. El worker de billing lo
| hace por su cuenta.
*/
import { sembrarCuentaPasarelaDelEntorno } from '#billing/arranque_pasarelas'

void sembrarCuentaPasarelaDelEntorno()
