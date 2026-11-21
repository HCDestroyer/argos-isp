# integraciones/equipos · equipos del cliente (A6)

Contrato Iris 0.9.0 §12 (bloque E): aprovisionar (A32), estado del equipo (A33) y cambio de Wi-Fi
(A35). **Argos no tiene integración con SmartOLT ni con un ACS (TR-069)**: no hay credenciales,
cliente HTTP, perfiles ni mapeo de VLAN/OLT por plan. No se simula nada:

| Ruta | Permiso | Hoy responde |
| --- | --- | --- |
| `GET /servicios/:id/equipo` | `servicios.ver_equipo` | `409 equipo_sin_gestion` con `extensions.equipos[]` (los equipos en comodato del inventario: unidad, producto, serie, MAC, estado); sin `extensions` para `X-Iris-Actor: asistente_ia` |
| `POST /servicios/:id/aprovisionar` | `servicios.aprovisionar` | valida (`409 servicio_no_pendiente`, `422 equipo_invalido`, `422 wifi_invalido`) y responde `422 aprovisionamiento_no_disponible`. Nunca el asistente (`403 actor_ia_no_permitido`) |
| `GET /aprovisionamientos/:id` | `servicios.aprovisionar` | `404` (no hay aprovisionamientos) |
| `POST /servicios/:id/wifi` | `servicios.cambiar_wifi` | valida (`422 wifi_invalido`, `422 verificacion_requerida` con las reglas del actor) y responde `409 equipo_sin_gestion` |

- `capacidades.aprovisionamiento` (canje y `GET /integraciones/iris/estado`, §4.3) sale en `false` por
  empresa y tecnología (`capacidadesIris`): Iris no ofrece «Activar servicio» y activa al cerrar.
- `Idempotency-Key` obligatoria en las dos escrituras. La clave Wi-Fi nunca se guarda: la auditoría la
  deja `***` (`wifi` completo en aprovisionar, `clave` en wifi) y los errores no repiten valores.
- Cada intento queda en `audit.acciones` como error (acciones `servicios.aprovisionar` y
  `servicios.cambiar_wifi`). No cambian estado ni emiten eventos: `instalacion.aprovisionada`,
  `instalacion.fallida` y `equipo.wifi_resuelto` no existen todavía porque nada se acepta.
- **Para hacerlo de verdad falta**: integración con SmartOLT (A2, red) y con un ACS (por decidir), su
  configuración por empresa en `gestionDeEmpresa`, la tabla de aprovisionamientos y el worker
  asíncrono con sus webhooks, el tope de 3 cambios de Wi-Fi por día y el aviso al titular tras un
  cambio aplicado.

Pruebas: `tests/integraciones/iris_equipos_090.spec.ts`.
