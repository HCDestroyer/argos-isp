# scripts/importacion

`ejemplo/`: export de Mikrowisp de prueba en el formato que acepta el importador (un CSV por entidad), con un caso de cada diferencia que reporta: IP duplicada, IP fuera de red, plan sin equivalente, cliente sin NIT, NIT inválido, `user_ppp` repetido, servicio suspendido y retirado, referencia rota y filas mal formadas.

```sh
pnpm importar --dry-run scripts/importacion/ejemplo
```

Formato y reglas en `apps/api/app/importacion/README.md`.
