/*
|--------------------------------------------------------------------------
| Lectura de una factura de origen Iris (A6): contrato Iris 0.14.3 §3
|--------------------------------------------------------------------------
|
| `GET /facturas/origen-iris`: Iris valida el número de factura que le da un supervisor antes de
| conciliar un «cobro por confirmar». Solo valida, aplica cabeceras y límite, y llama la acción.
|
*/
import { definirRuta, type Ruta } from '#shared/rutas'
import {
    definirEsquema,
    entero,
    enumerado,
    id as idEsquema,
    instante,
    lista,
    nulable,
    objeto,
    texto,
} from '#shared/openapi/esquemas'
import {
    busquedaDe,
    leerFacturaOrigenIrisValidator,
    limitarLecturaFacturaIris,
} from '#integraciones/iris/facturas_origen'
import LeerFacturaOrigenIris from '#integraciones/iris/actions/leer_factura_origen_iris'

const decimal = { ...texto, pattern: '^-?\\d+(\\.\\d+)?$' }

const FacturaOrigenIris = definirEsquema(
    'FacturaOrigenIris',
    objeto({
        factura_id: idEsquema,
        numero: { ...texto, description: 'Número interno de Argos (el panel lo muestra como «Factura #n»)' },
        empresa_id: idEsquema,
        servicio_id: nulable(entero),
        cliente_id: idEsquema,
        origen_tipo: enumerado(['iris_orden']),
        origen_id: { ...texto, description: 'Id de la orden en Iris' },
        estado: texto,
        lineas: lista(
            objeto({
                concepto_id: {
                    ...nulable(entero),
                    description:
                        'Concepto de cargo de la línea (`GET /conceptos-cargo`); null en cargos anteriores a Argos con contrato 0.14.3',
                },
                precio_unitario: { ...decimal, description: 'Bruto con IVA, dos decimales' },
                cantidad: { ...decimal, description: 'Sin ceros de más («1», «2.5»)' },
            }),
        ),
        total: decimal,
        moneda: enumerado(['GTQ']),
        emitida_en: instante,
        dte: nulable(objeto({ serie: texto, numero: texto })),
    }),
)

const rutas: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/facturas/origen-iris',
        operacion: 'facturasOrigenIris',
        resumen:
            'Leer una factura de origen Iris para conciliar un «cobro por confirmar» (contrato Iris 0.14.3 §3)',
        descripcion:
            '`empresa_id` y `origen_id` (id de la orden en Iris) obligatorios, más `numero` (número interno de Argos) o ' +
            '`serie` + `numero_dte` (DTE certificado), excluyentes: si faltan o se mezclan, `422 validacion`. Sin pagos, ' +
            'NIT, nombre ni dirección. Si no existe, no es `iris_orden`, su `origen_id` no es el pedido o su empresa está ' +
            'fuera del token (también un `empresa_id` fuera del token): el mismo `404 factura_no_encontrada`. Con el ' +
            'token de Iris, `X-Iris-Actor: usuario:<id>` obligatoria (`400 cabecera_iris_requerida`); con `asistente_ia` ' +
            'o `sistema`, `403 actor_no_permitido`; sin `X-Iris-Conversacion` ni `X-Iris-Contacto` (se ignoran). Máximo ' +
            '60 lecturas por minuto por token (`429 demasiadas_peticiones` con `Retry-After`). Cada lectura queda ' +
            'auditada con el actor de Iris y canal `api`, con solo los parámetros como entrada.',
        etiqueta: 'facturacion',
        permiso: 'facturas.leer_origen_iris',
        query: leerFacturaOrigenIrisValidator,
        limitada: true,
        antes: limitarLecturaFacturaIris,
        respuesta: { status: 200, descripcion: 'Factura de la orden', esquema: FacturaOrigenIris },
        handler: (ctx, { query }) =>
            new LeerFacturaOrigenIris().execute(busquedaDe(query), ctx.contextoAccion()),
    }),
]

export default rutas
