"""刷题助手 PWA 本地服务"""
import http.server
import socket
import os
import sys
import webbrowser
import threading
import io

# Force UTF-8 on Windows
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

PORT = 8080
DIR = os.path.dirname(os.path.abspath(__file__))

def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except:
        return '127.0.0.1'

local_ip = get_local_ip()
url = f'http://{local_ip}:{PORT}'

# Generate QR code
def gen_qr():
    try:
        import qrcode
        from PIL import Image, ImageDraw, ImageFont
        qr = qrcode.QRCode(version=2, error_correction=qrcode.constants.ERROR_CORRECT_H,
                           box_size=8, border=2)
        qr.add_data(url)
        qr.make(fit=True)
        img = qr.make_image(fill_color='#3B82F6', back_color='white').convert('RGB')
        w, h = img.size
        label_h = 44
        new_img = Image.new('RGB', (w, h + label_h), 'white')
        new_img.paste(img, (0, 0))
        draw = ImageDraw.Draw(new_img)
        try:
            font = ImageFont.truetype('msyh.ttc', 12)
        except:
            font = ImageFont.load_default()
        draw.text((10, h + 6), url, fill='#3B82F6', font=font)
        draw.text((10, h + 24), 'iPhone: Safari open -> Add to Home Screen', fill='#888888', font=font)
        path = os.path.join(DIR, 'qrcode.png')
        new_img.save(path)
        return path
    except Exception as e:
        print(f'QR gen failed: {e}')
        return None

qr_path = gen_qr()

print('=' * 50)
print('  Quiz App PWA Server')
print('=' * 50)
print(f'  Local:  http://localhost:{PORT}')
print(f'  Mobile: {url}')
print()
print('  [iPhone] Camera scan QR -> Safari -> Add to Home Screen')
print(f'  QR saved: qrcode.png')
print('  Ctrl+C to stop')
print('=' * 50)

# Open browser
if qr_path:
    webbrowser.open(qr_path)

# Start server
class CORSHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIR, **kwargs)
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

httpd = http.server.HTTPServer(('0.0.0.0', PORT), CORSHandler)
try:
    httpd.serve_forever()
except KeyboardInterrupt:
    print('Stopped.')
    httpd.shutdown()
