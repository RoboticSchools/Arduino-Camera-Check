# Arduino Camera Check 📹

A lightweight, zero-dependency WebRTC live camera streaming application designed to test live video streaming from a mobile phone's rear camera to a laptop over the same Wi-Fi network.

## 🚀 Features

- **Mobile Mode**: 
  - Requests camera permissions immediately on load.
  - Live rear camera preview.
  - Displays local IP & connection address.
  - Live status indicators (Camera, Network, Streaming).

- **Laptop Mode**:
  - No camera permissions requested.
  - Address input field with **CONNECT** button.
  - Large live video stream display.
  - Real-time WebRTC connection state monitoring.

- **Zero External Dependencies**:
  - Pure Python 3 backend (`server.py`) serving static files and handling WebRTC signaling.
  - Automatic self-signed SSL certificate generation to satisfy browser HTTPS requirements for `getUserMedia`.

---

## 🛠️ Usage Instructions

### 1. Start the Server on your Laptop
```bash
python3 server.py
```

Output:
```
=======================================================
 📹 WEBRTC LOCAL CAMERA STREAMING SERVER STARTED
=======================================================
 🌐 Laptop Server Local IP: 192.168.0.7
 🔗 Access URL: https://192.168.0.7:8443
-------------------------------------------------------
 📱 On Mobile Phone: Open https://192.168.0.7:8443
 💻 On Laptop:       Open https://localhost:8443 or https://192.168.0.7:8443
=======================================================
```

### 2. Open on Mobile Phone
- Connect phone to the same Wi-Fi.
- Open `https://<LAPTOP_IP>:8443` in mobile browser.
- Accept the self-signed SSL certificate (*Advanced → Proceed*).
- Allow camera access.

### 3. Open on Laptop
- Open `https://localhost:8443` or `https://<LAPTOP_IP>:8443`.
- Select **Laptop Mode**.
- Enter the address shown on your mobile screen and click **CONNECT**.
