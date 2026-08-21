#!/usr/bin/env python3
import http.server
import ssl
import socket
import json
import os
import sys
import subprocess
import time
from urllib.parse import parse_qs, urlparse

PORT = 8443

# Memory store for WebRTC signaling messages: session_id -> list of pending messages
SIGNALS = {}
# Registered camera sessions: session_id -> metadata
SESSIONS = {}

def get_local_ip():
    """Attempt to detect the machine's local Wi-Fi/LAN IP address."""
    # 1. Try standard routing lookup
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('10.255.255.255', 1))
        ip = s.getsockname()[0]
        s.close()
        if ip and not ip.startswith('127.'):
            return ip
    except Exception:
        pass

    # 2. Try inspecting socket interfaces / hostname
    try:
        hostname = socket.gethostname()
        for ip in socket.gethostbyname_ex(hostname)[2]:
            if not ip.startswith('127.'):
                return ip
    except Exception:
        pass

    # 3. Try parsing ifconfig output on macOS / Linux
    try:
        output = subprocess.check_output(['ifconfig'], text=True)
        import re
        for match in re.finditer(r'inet\s+(?:addr:)?([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)', output):
            ip = match.group(1)
            if not ip.startswith('127.'):
                return ip
    except Exception:
        pass

    return '127.0.0.1'

def ensure_ssl_certificates():
    """Generate self-signed SSL certs if cert.pem and key.pem do not exist."""
    base_dir = os.path.dirname(os.path.abspath(__file__))
    cert_file = os.path.join(base_dir, 'cert.pem')
    key_file = os.path.join(base_dir, 'key.pem')

    if not os.path.exists(cert_file) or not os.path.exists(key_file):
        print("🔐 Generating self-signed SSL certificate for local HTTPS...")
        cmd = [
            'openssl', 'req', '-x509', '-newkey', 'rsa:2048',
            '-keyout', key_file, '-out', cert_file,
            '-days', '365', '-nodes',
            '-subj', '/CN=LocalCameraStream'
        ]
        try:
            subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            print("✅ SSL certificate created successfully.")
        except Exception as e:
            print(f"⚠️ Could not run openssl to create certificate: {e}")
            raise RuntimeError("OpenSSL is required to generate self-signed HTTPS certificate.")
    return cert_file, key_file

class SignalingHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Disable caching for API responses
        if self.path.startswith('/api/'):
            self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        if path == '/api/info':
            local_ip = get_local_ip()
            res = {
                'ip': local_ip,
                'port': PORT,
                'full_address': f"https://{local_ip}:{PORT}",
                'sessions': list(SESSIONS.keys())
            }
            self.send_json_response(200, res)
            return

        elif path == '/api/signal/poll':
            session_id = query.get('session_id', [None])[0]
            role = query.get('role', [None])[0] # 'mobile' or 'laptop'

            if not session_id or not role:
                self.send_json_response(400, {'error': 'Missing session_id or role'})
                return

            target_key = f"{session_id}_{role}"
            messages = SIGNALS.get(target_key, [])
            SIGNALS[target_key] = [] # Clear queued messages once read

            self.send_json_response(200, {'messages': messages})
            return

        # Fallback to standard file serving for static files (index.html, style.css, app.js, etc.)
        super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        content_length = int(self.headers.get('Content-Length', 0))
        body_bytes = self.rfile.read(content_length) if content_length > 0 else b'{}'

        try:
            body = json.loads(body_bytes.decode('utf-8'))
        except Exception:
            body = {}

        if path == '/api/signal/register':
            session_id = body.get('session_id') or get_local_ip()
            SESSIONS[session_id] = {
                'registered_at': time.time(),
                'status': 'ready'
            }
            # Initialize message queues for this session
            SIGNALS[f"{session_id}_mobile"] = []
            SIGNALS[f"{session_id}_laptop"] = []
            
            print(f"📱 Mobile camera session registered: {session_id}")
            self.send_json_response(200, {'success': True, 'session_id': session_id, 'server_ip': get_local_ip()})
            return

        elif path == '/api/signal/send':
            session_id = body.get('session_id')
            target_role = body.get('target_role') # recipient ('mobile' or 'laptop')
            payload = body.get('payload')

            if not session_id or not target_role or not payload:
                self.send_json_response(400, {'error': 'Invalid signal request'})
                return

            target_key = f"{session_id}_{target_role}"
            if target_key not in SIGNALS:
                SIGNALS[target_key] = []
            
            SIGNALS[target_key].append(payload)
            self.send_json_response(200, {'success': True})
            return

        self.send_json_response(404, {'error': 'Endpoint not found'})

    def send_json_response(self, code, data):
        body = json.dumps(data).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

def main():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    cert_file, key_file = ensure_ssl_certificates()
    local_ip = get_local_ip()

    server_address = ('0.0.0.0', PORT)
    httpd = http.server.HTTPServer(server_address, SignalingHandler)

    # Wrap socket with SSL
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(certfile=cert_file, keyfile=key_file)
    httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)

    print("\n=======================================================")
    print(" 📹 WEBRTC LOCAL CAMERA STREAMING SERVER STARTED")
    print("=======================================================")
    print(f" 🌐 Laptop Server Local IP: {local_ip}")
    print(f" 🔗 Access URL: https://{local_ip}:{PORT}")
    print("-------------------------------------------------------")
    print(" 📱 On Mobile Phone: Open https://{}:{}".format(local_ip, PORT))
    print(" 💻 On Laptop:       Open https://localhost:{} or https://{}:{}".format(PORT, local_ip, PORT))
    print("=======================================================\n")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server...")
        httpd.server_close()

if __name__ == '__main__':
    main()
