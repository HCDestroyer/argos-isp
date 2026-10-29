#!/usr/bin/env python3
"""API falsa para infra/wireguard/probar.sh: los dos endpoints internos que usa wireguard-agente.

GET  /api/v1/internal/wireguard/peers   → el contenido de <dir>/peers.json
POST /api/v1/internal/wireguard/estado  → guarda el cuerpo en <dir>/estado.json (y suma una línea a
                                          <dir>/estados.log)
Ambos exigen Authorization: Bearer <token>. Uso: api_falsa.py <puerto> <dir> <token>
"""
import http.server
import json
import os
import sys

PUERTO, DIR, TOKEN = int(sys.argv[1]), sys.argv[2], sys.argv[3]


class Manejador(http.server.BaseHTTPRequestHandler):
    def _autorizado(self):
        if self.headers.get('Authorization') != f'Bearer {TOKEN}':
            self.send_response(401)
            self.end_headers()
            return False
        return True

    def do_GET(self):
        if self.path != '/api/v1/internal/wireguard/peers':
            self.send_response(404)
            self.end_headers()
            return
        if not self._autorizado():
            return
        with open(os.path.join(DIR, 'peers.json'), 'rb') as f:
            cuerpo = f.read()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(cuerpo)))
        self.end_headers()
        self.wfile.write(cuerpo)

    def do_POST(self):
        if self.path != '/api/v1/internal/wireguard/estado':
            self.send_response(404)
            self.end_headers()
            return
        if not self._autorizado():
            return
        datos = self.rfile.read(int(self.headers.get('Content-Length', '0')))
        json.loads(datos)
        with open(os.path.join(DIR, 'estado.json.tmp'), 'wb') as f:
            f.write(datos)
        os.replace(os.path.join(DIR, 'estado.json.tmp'), os.path.join(DIR, 'estado.json'))
        with open(os.path.join(DIR, 'estados.log'), 'ab') as f:
            f.write(datos + b'\n')
        self.send_response(204)
        self.end_headers()

    def log_message(self, *args):
        pass


http.server.ThreadingHTTPServer(('0.0.0.0', PUERTO), Manejador).serve_forever()
