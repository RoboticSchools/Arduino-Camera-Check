let currentMode = 'mobile';
let localStream = null;
let peer = null;
let currentCall = null;
let dataConn = null;
let myPeerId = null;
let laptopRotationAngle = 90; // Default 90 degrees rotation

// Elements
const tabMobile = document.getElementById('tabMobile');
const tabLaptop = document.getElementById('tabLaptop');
const mobileView = document.getElementById('mobileView');
const laptopView = document.getElementById('laptopView');

const mobilePreview = document.getElementById('mobilePreview');
const cameraOverlay = document.getElementById('cameraOverlay');
const cameraOverlayText = document.getElementById('cameraOverlayText');
const mobileAddressDisplay = document.getElementById('mobileAddressDisplay');

const statusCameraDot = document.getElementById('statusCameraDot');
const statusCameraText = document.getElementById('statusCameraText');
const statusNetworkDot = document.getElementById('statusNetworkDot');
const statusNetworkText = document.getElementById('statusNetworkText');
const statusStreamingDot = document.getElementById('statusStreamingDot');
const statusStreamingText = document.getElementById('statusStreamingText');

const inputMobileAddress = document.getElementById('inputMobileAddress');
const btnConnect = document.getElementById('btnConnect');
const remoteVideo = document.getElementById('remoteVideo');
const remoteOverlay = document.getElementById('remoteOverlay');
const remoteOverlayText = document.getElementById('remoteOverlayText');
const statusLaptopDot = document.getElementById('statusLaptopDot');
const statusLaptopText = document.getElementById('statusLaptopText');

window.addEventListener('DOMContentLoaded', () => {
  const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) || window.innerWidth < 768;
  setMode(isMobile ? 'mobile' : 'laptop');
});

function setMode(mode) {
  currentMode = mode;
  cleanupPeer();

  if (mode === 'mobile') {
    tabMobile.classList.add('active');
    tabLaptop.classList.remove('active');
    mobileView.classList.add('active');
    laptopView.classList.remove('active');

    startMobileCamera();
  } else {
    tabLaptop.classList.add('active');
    tabMobile.classList.remove('active');
    laptopView.classList.add('active');
    mobileView.classList.remove('active');

    stopLocalCamera();
    updateLaptopStatus('disconnected', 'Disconnected');
    initLaptopPeer();
  }
}

// Toggle Fullscreen on Mobile Camera View
function toggleMobileFullscreen() {
  const container = document.getElementById('mobileVideoContainer');
  if (!document.fullscreenElement && !document.webkitFullscreenElement) {
    if (container.requestFullscreen) {
      container.requestFullscreen();
    } else if (container.webkitRequestFullscreen) {
      container.webkitRequestFullscreen();
    } else if (mobilePreview.webkitEnterFullscreen) {
      mobilePreview.webkitEnterFullscreen();
    }
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    }
  }
}

// Rotate Laptop Video Preview Manual Toggle
function rotateLaptopVideo(e) {
  if (e) e.stopPropagation();
  laptopRotationAngle = (laptopRotationAngle + 90) % 360;
  applyVideoTransform(laptopRotationAngle);
}

function applyVideoTransform(angle) {
  const video = document.getElementById('remoteVideo');
  if (!video) return;

  let norm = ((angle % 360) + 360) % 360;
  laptopRotationAngle = norm;

  video.className = '';
  if (norm === 90) {
    video.classList.add('rotate-90');
  } else if (norm === 180) {
    video.classList.add('rotate-180');
  } else if (norm === 270) {
    video.classList.add('rotate-270');
  }
}

// ==========================================
// MOBILE MODE LOGIC
// ==========================================

async function startMobileCamera() {
  updateCameraStatus('yellow', 'Requesting Permission...');
  cameraOverlay.classList.remove('hidden');
  cameraOverlayText.textContent = 'Requesting Rear Camera Permission...';
  document.getElementById('btnRetryCamera').classList.add('hidden');

  try {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { exact: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      });
    } catch (e) {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false
      });
    }

    localStream = stream;
    mobilePreview.srcObject = stream;
    await mobilePreview.play().catch(e => console.warn('Preview play:', e));
    cameraOverlay.classList.add('hidden');

    updateCameraStatus('green', 'Connected');
    updateStreamingStatus('yellow', 'Ready');

    initMobilePeer();

  } catch (err) {
    console.error('Camera Error:', err);
    updateCameraStatus('red', 'Permission Denied / Error');
    cameraOverlayText.textContent = '❌ Camera Access Failed: ' + err.message;
    document.getElementById('btnRetryCamera').classList.remove('hidden');
  }
}

function generateShortCode() {
  const code = Math.floor(1000 + Math.random() * 9000);
  return `CAM-${code}`;
}

function initMobilePeer() {
  cleanupPeer();

  const customId = generateShortCode();

  if (typeof Peer !== 'undefined') {
    peer = new Peer(customId, { debug: 1 });

    peer.on('open', (id) => {
      myPeerId = id;
      mobileAddressDisplay.textContent = id;
      console.log('Mobile Peer ID ready:', id);
    });

    peer.on('call', (call) => {
      console.log('Incoming call from laptop');
      updateStreamingStatus('yellow', 'Connecting to Laptop...');
      currentCall = call;

      call.answer(localStream);

      call.on('stream', (remoteStream) => {
        console.log('Stream established with laptop');
      });

      updateStreamingStatus('green', 'Streaming to Laptop');

      call.on('close', () => {
        updateStreamingStatus('yellow', 'Ready (Waiting for Laptop)');
      });

      call.on('error', (err) => {
        console.error('Call error:', err);
        updateStreamingStatus('yellow', 'Ready');
      });
    });

    peer.on('error', (err) => {
      console.warn('PeerJS fallback to random ID:', err);
      if (err.type === 'unavailable-id') {
        peer = new Peer({ debug: 1 });
        peer.on('open', id => {
          myPeerId = id;
          mobileAddressDisplay.textContent = id;
        });
      }
    });
  } else {
    mobileAddressDisplay.textContent = window.location.hostname;
  }
}

function stopLocalCamera() {
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  mobilePreview.srcObject = null;
}

function updateCameraStatus(color, text) {
  statusCameraDot.className = `status-dot ${color}`;
  statusCameraText.textContent = text;
}

function updateStreamingStatus(color, text) {
  statusStreamingDot.className = `status-dot ${color}`;
  statusStreamingText.textContent = text;
}

// ==========================================
// LAPTOP MODE LOGIC
// ==========================================

function initLaptopPeer() {
  cleanupPeer();
  laptopRotationAngle = 90;
  if (typeof Peer !== 'undefined') {
    peer = new Peer({ debug: 1 });
    peer.on('open', id => console.log('Laptop Peer ready:', id));
  }
}

async function connectToMobile() {
  let code = inputMobileAddress.value.trim();
  if (!code) {
    alert('Please enter the Mobile Connection Code (e.g. CAM-1234) shown on your mobile screen.');
    return;
  }

  code = code.replace(/^https?:\/\//i, '').split('/')[0].split(':')[0].trim();

  updateLaptopStatus('connecting', 'Connecting...');
  remoteOverlayText.textContent = 'Connecting to Mobile Camera Stream...';
  remoteOverlay.classList.remove('hidden');

  if (!peer || peer.destroyed) {
    peer = new Peer({ debug: 1 });
    await new Promise(r => peer.on('open', r));
  }

  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const dummyStream = canvas.captureStream(1);

  console.log('Calling mobile peer:', code);
  const call = peer.call(code, dummyStream);
  currentCall = call;

  call.on('stream', async (remoteStream) => {
    console.log('Laptop received remote stream!');
    remoteVideo.srcObject = remoteStream;
    remoteVideo.muted = true;
    try {
      await remoteVideo.play();
    } catch (e) {
      console.warn('Autoplay error:', e);
    }
    remoteOverlay.classList.add('hidden');
    updateLaptopStatus('streaming', 'Streaming');

    applyVideoTransform(90);
  });

  call.on('close', () => {
    updateLaptopStatus('disconnected', 'Disconnected');
    remoteOverlay.classList.remove('hidden');
    remoteOverlayText.textContent = 'Stream Closed';
  });

  call.on('error', (err) => {
    console.error('Laptop call error:', err);
    updateLaptopStatus('disconnected', 'Connection Failed');
    remoteOverlayText.textContent = 'Connection Failed. Please check Code.';
  });

  setTimeout(() => {
    if (remoteOverlayText.textContent === 'Connecting to Mobile Camera Stream...' && !remoteVideo.srcObject) {
      updateLaptopStatus('connecting', 'Still Connecting... Check Code on Phone');
    }
  }, 5000);
}

function updateLaptopStatus(stateClass, text) {
  const dotColorMap = {
    disconnected: 'gray',
    connecting: 'yellow',
    connected: 'green',
    streaming: 'green'
  };
  statusLaptopDot.className = `status-dot ${dotColorMap[stateClass] || 'gray'}`;
  statusLaptopText.className = `status-value ${stateClass}`;
  statusLaptopText.textContent = text;
}

function cleanupPeer() {
  if (dataConn) {
    dataConn.close();
    dataConn = null;
  }
  if (currentCall) {
    currentCall.close();
    currentCall = null;
  }
  if (peer) {
    peer.destroy();
    peer = null;
  }
}
