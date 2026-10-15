import { crearServidor } from './app.ts'

const port = Number(process.env.PORT ?? 3200)
const host = process.env.HOST ?? '0.0.0.0'

const servidor = crearServidor()
servidor.listen(port, host, () => {
    console.log(JSON.stringify({ level: 'info', servicio: 'coa', msg: `escuchando en ${host}:${port}` }))
})

function apagar(signal: string): void {
    console.log(JSON.stringify({ level: 'info', servicio: 'coa', msg: `${signal}: cerrando` }))
    servidor.close(() => process.exit(0))
    setTimeout(() => process.exit(1), 10_000).unref()
}

process.on('SIGTERM', () => apagar('SIGTERM'))
process.on('SIGINT', () => apagar('SIGINT'))
