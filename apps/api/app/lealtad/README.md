# lealtad · programa de lealtad (A3)

Contrato: `.claude/integration/contratos/lealtad.md` (fase 1: §2, §3, §4, §6, §6.1, §9, §11, §13–§15 y §15.1).

## Qué hace

- **Programa por empresa** (`lealtad.programas`, uno activo por empresa). Por defecto los puntos son un
  indicador (`diferimiento = false`, sin asientos); con `diferimiento = true` son un pasivo NIIF 15
  (`2.1.10`) valorado a `valor_punto × canje_esperado_pct`. Vencimiento por empresa (12 meses por
  defecto, `null` = no vencen).
- **Reglas para ganar** (`lealtad.reglas`): `pago_a_tiempo` (con racha), `antiguedad`, `referido` y
  `pago_adelantado`, cada una con su esquema de `condiciones` (`validators.ts`) y topes por cliente.
- **Auxiliar de puntos por lotes** (`lealtad.movimientos`, solo inserción): cada acumulación es un lote
  con `vence_en` y `valor`; las salidas consumen lotes en `lealtad.consumos`, el que vence antes
  primero. Saldo = suma de movimientos (no hay columna). `puntos.ts` concentra la escritura.
- **Asientos del pasivo** por `RegistrarAsiento` (origen `lealtad`): acumulación `4.1.05 / 2.1.10`,
  vencimiento `2.1.10 / 4.1.06`, reverso y ajuste negativo `2.1.10 / 4.1.05`. Invariante: saldo de
  `2.1.10` = Σ valor vivo de los lotes (`GET /reportes/lealtad`, `cuadra`).
- **Referidos** (`lealtad.referidos`): se registran con `servicio.creado` del cliente que llegó con el
  código de otro (A1: `core.codigos_referido`, `referidoDeCliente` de `#core/referidos`) y califican
  con las facturas pagadas mínimas.

- **Canjes** (fase 2, `lealtad.premios` y `lealtad.canjes`): `canjear` saca los puntos con un
  movimiento `canje` (lotes que vencen antes primero; con diferimiento `2.1.10 / 4.1.06`). Mejora de
  plan por `ProgramarPlanTemporal` de A1 (falla entera si no se puede), descuento sobre factura
  emitida por nota de crédito por línea, descuento sin factura `reservado` para la próxima factura.
  Revertir (solo reservado) devuelve los puntos en lotes nuevos con su vencimiento original.

- **Sorteos** (fase 3, §7, §8 y §15.3; `sorteos.ts`, `sorteo_v1.ts`): bases congeladas con `bases_hash`,
  semilla comprometida al publicar (`compromiso = SHA-256(s)`, cifrada con la clave de la instalación),
  foto del corte (servicios activos sin facturas vencidas + boletos canjeados) con seudónimos y
  `lista_hash`, checklist legal que bloquea abrir y ejecutar, ejecución con `argos-sorteo-v1` y
  `valor_publico` (reproducible con `scripts/verificar-sorteo.mjs` y `GET /lealtad/sorteos/:id/verificacion`),
  entrega como gasto `5.1.03` (efectivo por egreso; bien contra `2.1.03` o una cuenta de activo; servicio
  como canje sin puntos) con el ISR a `2.1.05`. Portal: `GET /portal/sorteos`. Correcciones del auditor
  (contrato §15.3): anular una entrega todo junto (H22), `sorteo` sin reverso directo (H23), ganadores
  congelados (H24), lista blanca de la cuenta del bien (H25), fuente y evidencia del valor público y estado
  que no retrocede. Segunda PR (§15.4): archivos de evidencia y constancias, imágenes de premios subidas,
  `aviso_portal`, notificación a ganadores, suplentes y no reclamados, acta en PDF (`acta_cerrada`) y
  exportación de participantes en CSV/XLSX.

## Acciones

`lealtad.crear_programa`, `lealtad.editar_programa`, `lealtad.activar_programa`,
`lealtad.desactivar_programa`, `lealtad.crear_regla`, `lealtad.editar_regla`, `lealtad.ajustar`,
`lealtad.rechazar_referido`, `lealtad.crear_premio`, `lealtad.editar_premio`, `lealtad.canjear`,
`lealtad.revertir_canje`, `sorteos.crear`, `sorteos.editar`, `sorteos.publicar_bases`,
`sorteos.abrir`, `sorteos.cerrar_corte`, `sorteos.cancelar`, `sorteos.marcar_requisito`,
`sorteos.ejecutar`, `sorteos.entregar`, `sorteos.anular_entrega`, `sorteos.cambiar_aviso_portal`,
`sorteos.subir_archivo`, `sorteos.subir_imagen_premio`, `sorteos.notificar_ganadores`,
`sorteos.marcar_no_reclamado`, `sorteos.cerrar_acta`, `lealtad.evaluar_evento` (consumidor), `lealtad.otorgar_antiguedad` y
`lealtad.vencer` (crons).

## Eventos

- Emite: `lealtad.programa_cambiado`, `lealtad.puntos_acumulados`, `lealtad.puntos_revertidos`,
  `lealtad.puntos_por_vencer`, `lealtad.puntos_vencidos`, `lealtad.referido_calificado`,
  `lealtad.canje_reservado`, `lealtad.canje_aplicado`, `lealtad.canje_revertido`,
  `sorteo.bases_publicadas`, `sorteo.corte_cerrado`, `sorteo.ejecutado`, `sorteo.premio_entregado`,
  `sorteo.cancelado`, `sorteo.entrega_anulada`, `sorteo.ganador_notificado`, `sorteo.premio_no_reclamado`,
  `sorteo.acta_cerrada`.
- Consume (grupo `lealtad` en `node ace billing:worker`, `consumidor.ts`): `pago.registrado`,
  `pago.anulado`, `factura.emitida`, `factura.anulada`, `nota_credito.emitida`,
  `nota_credito.anulada`, `servicio.creado`, `servicio.estado_cambiado`. Idempotente por
  `clave_unica`: un evento repetido no da puntos dos veces.

## Crons

`lealtad:antiguedad` (03:05) y `lealtad:vencer` (03:20, Guatemala) en la cola de `billing:worker`, con
lock y "todo lo pendiente hasta hoy" por lotes de 500. `node ace billing:worker --una-vez lealtad:vencer`.

## Pruebas

`tests/lealtad/*.spec.ts`; cada una termina en `afirmarLibroLealtad` (invariantes del auditor y
`2.1.10` = lotes vivos).
