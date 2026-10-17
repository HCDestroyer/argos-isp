import { createServer, type Server, type Socket } from 'node:net'

/**
 * Servidor SMTP mínimo en memoria para pruebas (sin TLS): anuncia `AUTH PLAIN LOGIN`, valida
 * usuario y contraseña si se configuran (535 si no coinciden) y guarda cada mensaje recibido.
 * Con Mailpit disponible (CI) también se prueba contra él; este no necesita Docker.
 */
export interface MensajeSmtp {
    de: string
    para: string[]
    datos: string
}

export class SmtpFalso {
    readonly mensajes: MensajeSmtp[] = []
    readonly #server: Server
    readonly #sockets = new Set<Socket>()
    puerto = 0

    constructor(private readonly credenciales: { usuario: string; password: string } | null = null) {
        this.#server = createServer((socket) => this.#atender(socket))
    }

    async iniciar(): Promise<this> {
        await new Promise<void>((resolver) => this.#server.listen(0, '127.0.0.1', resolver))
        const direccion = this.#server.address()
        this.puerto = typeof direccion === 'object' && direccion ? direccion.port : 0
        return this
    }

    async cerrar(): Promise<void> {
        for (const socket of this.#sockets) socket.destroy()
        await new Promise<void>((resolver) => this.#server.close(() => resolver()))
    }

    #atender(socket: Socket) {
        this.#sockets.add(socket)
        socket.on('close', () => this.#sockets.delete(socket))
        socket.on('error', () => {})
        const escribir = (linea: string) => socket.write(`${linea}\r\n`)
        let pendiente = ''
        let enDatos = false
        let datos = ''
        let de = ''
        let para: string[] = []
        let autenticado = this.credenciales === null
        let esperandoLogin: 'usuario' | 'password' | null = null
        let usuarioLogin = ''

        const validar = (usuario: string, password: string) => {
            autenticado =
                this.credenciales !== null &&
                usuario === this.credenciales.usuario &&
                password === this.credenciales.password
            escribir(autenticado ? '235 2.7.0 Authentication successful' : '535 5.7.8 Authentication failed')
        }

        escribir('220 smtp-falso ESMTP')
        socket.on('data', (trozo) => {
            pendiente += trozo.toString('utf8')
            for (;;) {
                if (enDatos) {
                    const fin = pendiente.indexOf('\r\n.\r\n')
                    if (fin === -1) {
                        datos += pendiente
                        pendiente = ''
                        return
                    }
                    datos += pendiente.slice(0, fin)
                    pendiente = pendiente.slice(fin + 5)
                    enDatos = false
                    this.mensajes.push({ de, para, datos })
                    escribir(`250 2.0.0 Ok: queued as falso-${this.mensajes.length}`)
                    continue
                }
                const corte = pendiente.indexOf('\r\n')
                if (corte === -1) return
                const linea = pendiente.slice(0, corte)
                pendiente = pendiente.slice(corte + 2)
                if (esperandoLogin === 'usuario') {
                    usuarioLogin = Buffer.from(linea, 'base64').toString('utf8')
                    esperandoLogin = 'password'
                    escribir('334 UGFzc3dvcmQ6')
                    continue
                }
                if (esperandoLogin === 'password') {
                    esperandoLogin = null
                    validar(usuarioLogin, Buffer.from(linea, 'base64').toString('utf8'))
                    continue
                }
                const comando = linea.split(' ')[0]!.toUpperCase()
                if (comando === 'EHLO' || comando === 'HELO') {
                    escribir('250-smtp-falso')
                    escribir('250 AUTH PLAIN LOGIN')
                } else if (comando === 'AUTH') {
                    const [, mecanismo, inicial] = linea.split(' ')
                    if (mecanismo?.toUpperCase() === 'PLAIN' && inicial) {
                        const [, usuario, password] = Buffer.from(inicial, 'base64')
                            .toString('utf8')
                            .split('\0')
                        validar(usuario ?? '', password ?? '')
                    } else if (mecanismo?.toUpperCase() === 'LOGIN') {
                        esperandoLogin = 'usuario'
                        escribir('334 VXNlcm5hbWU6')
                    } else {
                        escribir('504 5.5.4 Unrecognized authentication type')
                    }
                } else if (comando === 'MAIL') {
                    if (!autenticado) {
                        escribir('530 5.7.0 Authentication required')
                        continue
                    }
                    de = /<([^>]*)>/.exec(linea)?.[1] ?? ''
                    para = []
                    escribir('250 2.1.0 Ok')
                } else if (comando === 'RCPT') {
                    para.push(/<([^>]*)>/.exec(linea)?.[1] ?? '')
                    escribir('250 2.1.5 Ok')
                } else if (comando === 'DATA') {
                    enDatos = true
                    datos = ''
                    escribir('354 End data with <CR><LF>.<CR><LF>')
                } else if (comando === 'QUIT') {
                    escribir('221 2.0.0 Bye')
                    socket.end()
                    return
                } else if (comando === 'RSET' || comando === 'NOOP') {
                    escribir('250 2.0.0 Ok')
                } else {
                    escribir('502 5.5.2 Command not recognized')
                }
            }
        })
    }
}
