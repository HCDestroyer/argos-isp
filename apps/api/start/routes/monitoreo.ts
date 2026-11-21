/*
|--------------------------------------------------------------------------
| Rutas de sistema (A6, app/monitoreo): versión, salud, registro y almacenamiento
|--------------------------------------------------------------------------
|
| `/health` y `/metrics` viven fuera de /api/v1 (start/routes.ts). Lo demás va dentro para que el
| panel lo lea con su cliente tipado (packages/contracts). Contrato: `.claude/integration/contratos/salud.md`.
*/
import { definirRuta, type Ruta } from '#shared/rutas'
import {
    Almacenamiento,
    MedicionAlmacenamiento,
    RegistroSistemaPagina,
    SaludSistema,
    VersionInstalada,
} from '#monitoreo/esquemas'
import { versionInstalada } from '#monitoreo/version'
import { saludSistema } from '#monitoreo/salud'
import { registroSistema } from '#monitoreo/registro'
import { verAlmacenamiento } from '#monitoreo/almacenamiento'
import RecalcularAlmacenamiento, { PRESUPUESTO_MANUAL_MS } from '#monitoreo/actions/recalcular_almacenamiento'
import { registroSistemaValidator } from '#monitoreo/validators'

const monitoreo: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/version',
        operacion: 'versionInstalada',
        resumen: 'Versión instalada de ArgosIsp y qué cambió en ella',
        descripcion:
            'Cualquier usuario con sesión (sin permiso del ACL, como `/me`) o un nodo portal con su ' +
            '`X-Argos-Nodo-Token`. `cambios` es la sección ' +
            'de la versión en CHANGELOG.md (Markdown); `notas_url`, la página de GitHub Releases.',
        etiqueta: 'sistema',
        permiso: null,
        // el nodo portal compara versiones con su token (`argosisp actualizar`, contrato nodo-portal.md)
        nodoPortal: true,
        respuesta: { status: 200, descripcion: 'Versión instalada', esquema: VersionInstalada },
        handler: () => versionInstalada(),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/sistema/salud',
        operacion: 'sistemaSalud',
        resumen: 'Salud del sistema: servicios, colas, RADIUS, routers, crons, respaldos y servidor',
        descripcion:
            'Se calcula al pedirla (sin caché). Cada chequeo corre en paralelo con 1 s de límite: la ruta ' +
            'responde en ~2 s como mucho y un componente que no contesta sale `caido` o `desconocido`, ' +
            'nunca 500. Contrato `salud.md` §2.',
        etiqueta: 'sistema',
        permiso: 'sistema.ver_salud',
        respuesta: { status: 200, descripcion: 'Salud del sistema', esquema: SaludSistema },
        handler: () => saludSistema(),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/sistema/registro',
        operacion: 'sistemaRegistro',
        resumen: 'Registro del sistema: errores y avisos operativos recientes',
        descripcion:
            'Errores de acciones, comandos de red fallidos, caídas de RADIUS, eventos del libro, avisos de ' +
            'disco y trabajos fallidos de las colas, del más nuevo al más viejo. Sin secretos. Contrato ' +
            '`salud.md` §3.',
        etiqueta: 'sistema',
        permiso: 'sistema.ver_registro',
        query: registroSistemaValidator,
        respuesta: { status: 200, descripcion: 'Página del registro', esquema: RegistroSistemaPagina },
        handler: (_ctx, { query }) => registroSistema(query),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/sistema/almacenamiento',
        operacion: 'sistemaAlmacenamiento',
        resumen: 'Qué se almacena y cuánto espacio ocupa',
        descripcion:
            '`volumenes`: espacio de los discos leído en el momento. `medicion`: último cálculo guardado ' +
            '(carpetas, base de datos y Redis) con su `calculado_en`, o null si nunca se calculó. Se ' +
            'recalcula con el cron diario o con `POST /sistema/almacenamiento/recalcular`. Contrato ' +
            '`salud.md` §6.',
        etiqueta: 'sistema',
        permiso: 'sistema.ver_almacenamiento',
        respuesta: { status: 200, descripcion: 'Almacenamiento', esquema: Almacenamiento },
        handler: () => verAlmacenamiento(),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/sistema/almacenamiento/recalcular',
        operacion: 'sistemaRecalcularAlmacenamiento',
        resumen: 'Recalcular el almacenamiento ahora',
        descripcion:
            `Recorre las carpetas con un límite de ${PRESUPUESTO_MANUAL_MS / 1000} s (lo que no alcance sale ` +
            '`parcial`), mide la base y Redis y guarda el resultado. Solo lee y suma: no borra nada. ' +
            '409 `calculo_en_curso` si ya hay un cálculo corriendo.',
        etiqueta: 'sistema',
        permiso: 'sistema.recalcular_almacenamiento',
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Medición nueva', esquema: MedicionAlmacenamiento },
        handler: (ctx) => new RecalcularAlmacenamiento().execute({ origen: 'manual' }, ctx.contextoAccion()),
    }),
]

export default monitoreo
