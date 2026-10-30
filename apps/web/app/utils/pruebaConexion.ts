import type { Schema } from '@argosisp/contracts'

/**
 * Presentación de la conexión de un router (`contratos/conexion-routers.md`): estado del túnel,
 * cada chequeo de «Probar conexión» con icono + texto + color y, si falla, qué revisar en
 * lenguaje simple. RADIUS sin el secreto verificado es neutral, no un error.
 */

type Chequeo = Schema<'ChequeoConexion'>
type EstadoTunel = Schema<'ConexionRouter'>['estado']
type Color = 'success' | 'warning' | 'error' | 'neutral' | 'info'

export const ETIQUETAS_CHEQUEO: Record<Chequeo['clave'], string> = {
    tunel: 'Túnel WireGuard',
    api: 'API del router',
    equipo: 'Datos del equipo',
    radius: 'RADIUS',
    corte: 'Corte de suspendidos',
}

export const ESTADOS_TUNEL: Record<EstadoTunel, { etiqueta: string, color: Color, icono: string, descripcion: string }> = {
    sin_configurar: { etiqueta: 'Sin configurar', color: 'neutral', icono: 'i-lucide-circle-dashed', descripcion: 'Todavía no se generó el script de conexión.' },
    pendiente: { etiqueta: 'Pendiente', color: 'warning', icono: 'i-lucide-clock', descripcion: 'El script está generado, pero el servidor no ve al router en los últimos 3 minutos.' },
    conectado: { etiqueta: 'Conectado', color: 'success', icono: 'i-lucide-circle-check', descripcion: 'El túnel está activo: RADIUS, CoA y la API del router van por dentro.' },
}

/** RADIUS respondió, pero el secreto no se pudo comparar (no es un fallo). */
export function radiusSinVerificar(chequeo: Chequeo): boolean {
    return chequeo.clave === 'radius' && chequeo.ok === true && chequeo.datos?.secreto_verificado === false
}

export function estadoChequeo(chequeo: Chequeo): { etiqueta: string, color: Color, icono: string } {
    if (radiusSinVerificar(chequeo)) {
        return { etiqueta: 'Responde · secreto no verificado', color: 'neutral', icono: 'i-lucide-circle-help' }
    }
    if (chequeo.ok === true) {
        return { etiqueta: 'Bien', color: 'success', icono: 'i-lucide-circle-check' }
    }
    if (chequeo.ok === false) {
        return { etiqueta: 'Falla', color: 'error', icono: 'i-lucide-circle-x' }
    }
    return { etiqueta: 'No se pudo comprobar', color: 'neutral', icono: 'i-lucide-circle-minus' }
}

/** Qué revisar cuando un chequeo falla, en lenguaje simple; `null` si no hace falta. */
export function consejoChequeo(chequeo: Chequeo): string | null {
    if (chequeo.ok !== false) {
        return radiusSinVerificar(chequeo)
            ? 'Argos no puede leer el secreto con el usuario de la API. Si los clientes no se autentican, vuelve a ejecutar el script de conexión.'
            : null
    }
    switch (chequeo.clave) {
        case 'tunel':
            return 'Revisa que el router tenga internet y que el script de conexión se haya ejecutado completo («argosisp: listo»). Si dijo «FALTA un paso», usa «Pegar clave pública». En el servidor, el puerto UDP de WireGuard debe estar abierto.'
        case 'api':
            // El `detalle` de la API ya explica la causa y trae los comandos de RouterOS
            // (`diagnostico_routeros.ts`); aquí solo lo que se hace desde el panel.
            switch (chequeo.motivo) {
                case 'sin_credenciales':
                    return 'Faltan el usuario y la clave de la API: escríbelos en «Editar» o ejecuta el script de conexión, que los crea.'
                case 'credenciales':
                    return 'Si cambiaste la clave en el router, usa «Editar» para guardar la misma aquí.'
                case 'certificado_no_confiable':
                    return 'La CA se pega en «Conexión de la API» de este router, o ahí mismo se apaga «Verificar el certificado TLS».'
                case 'certificado_proposito':
                    return 'En «Conexión de la API» va el certificado de la CA (argos-ca), no el del servicio.'
                case 'protocolo':
                    return 'La URL de la API se corrige en «Conexión de la API».'
                default:
                    return null
            }
        case 'equipo':
            return 'ArgosIsp necesita RouterOS 7: actualiza el router.'
        case 'radius':
            return 'Vuelve a ejecutar el script de conexión: deja /radius apuntando a Argos con el secreto correcto.'
        case 'corte':
            // Cada paso del corte trae su qué hacer y sus comandos (`RouterDiagnosticoCorte`).
            return chequeo.corte ? 'Abajo está cada paso del corte con qué hacer y los comandos para el router.' : null
        default:
            return null
    }
}

/**
 * Separa el `detalle` de la API en el texto y los comandos de RouterOS que trae, para mostrarlos en
 * un bloque que se pueda copiar. Son comandos las líneas que empiezan con `/` y los que van en la
 * misma frase después de «:», «(» o «luego» (`… En el router: /user group set …`), hasta « y », «, »
 * seguida de otra frase, «)» o el final.
 */
export function separarComandos(detalle: string): { texto: string, comandos: string[] } {
    const lineas = detalle.split('\n')
    const comandos = lineas.filter(linea => linea.trim().startsWith('/')).map(linea => linea.trim())
    const texto = lineas.filter(linea => !linea.trim().startsWith('/')).join('\n').trim()
    for (const coincidencia of texto.matchAll(/(?:: |\(|luego )(\/[a-z][\w-]*(?: [^\s()]*[^\s(),])+?)(?= y |, luego |\)|$)/g)) {
        const comando = coincidencia[1]?.trim()
        if (comando && !comandos.includes(comando)) {
            comandos.push(comando)
        }
    }
    return { texto, comandos }
}

/** El error crudo de Node u OpenSSL (`datos.error_tecnico`), solo para soporte. */
export function errorTecnico(chequeo: Chequeo): string | null {
    const valor = chequeo.datos?.error_tecnico
    return typeof valor === 'string' && valor !== '' ? valor : null
}

/** 422 de `POST /servicios/:id/sincronizar-router`, en lenguaje simple. */
export const ERRORES_SINCRONIZAR_ROUTER: Record<string, { titulo: string, ayuda: string }> = {
    servicio_pendiente_instalacion: { titulo: 'Todavía no hay nada que sincronizar', ayuda: 'El servicio está pendiente de instalación: su cola y su configuración se crean en el router al usar «Activar instalación».' },
    router_sin_api: { titulo: 'Argos no puede hablar con ese router', ayuda: 'El router está inactivo o no tiene usuario y clave de la API REST. Actívalo o cárgalos en la ficha del router (o genera su script de conexión) y vuelve a intentar.' },
}

/** Datos del equipo del chequeo `equipo` (versión, modelo, uptime y CPU), si vinieron. */
export function datosEquipo(chequeos: Chequeo[]): { version: string | null, modelo: string | null, uptime: string | null, cpu_pct: number | null } | null {
    const datos = chequeos.find(c => c.clave === 'equipo')?.datos
    if (!datos) {
        return null
    }
    const texto = (valor: unknown) => (typeof valor === 'string' && valor !== '' ? valor : null)
    return {
        version: texto(datos.version),
        modelo: texto(datos.modelo),
        uptime: texto(datos.uptime),
        cpu_pct: typeof datos.cpu_pct === 'number' ? datos.cpu_pct : null,
    }
}

/** Errores al generar el script, en lenguaje simple (`contratos/conexion-routers.md` §7). */
export const ERRORES_SCRIPT: Record<string, { titulo: string, ayuda: string }> = {
    radius_secret_requerido: { titulo: 'Falta el secreto RADIUS del router', ayuda: 'Escríbelo en «Editar» (de 16 a 128 caracteres, sin espacios) y vuelve a generar el script.' },
    servicio_incompleto: { titulo: 'Faltan datos de la red de clientes en el servidor', ayuda: 'Para incluir la configuración de servicio, completa en el .env del servidor estos datos y ejecuta `sudo argosisp levantar`. El script solo de conexión funciona igual.' },
    red_tunel_llena: { titulo: 'No quedan IPs en la red del túnel', ayuda: 'Amplía ARGOSISP_WG_RED en el servidor o desactiva routers que ya no uses.' },
    wireguard_no_configurado: { titulo: 'WireGuard no está activo en el servidor', ayuda: 'Actívalo: en el .env pon ARGOSISP_WIREGUARD=1 y RADIUS_BIND_IP=10.255.0.1, abre el puerto UDP 51820 en el proveedor y ejecuta `sudo argosisp levantar` (o reinstala con `--wireguard si`).' },
    plantillas_no_disponibles: { titulo: 'El servidor no tiene las plantillas del script', ayuda: 'Actualiza ArgosIsp a la última versión: la imagen de la API trae las plantillas de MikroTik.' },
    script_no_generado: { titulo: 'Primero genera el script', ayuda: 'Genera el script de conexión: así el router recibe su IP del túnel. Después pega la clave.' },
    clave_en_uso: { titulo: 'Esa clave ya es de otro router', ayuda: 'Copia la clave pública que mostró este router al final del script.' },
}
