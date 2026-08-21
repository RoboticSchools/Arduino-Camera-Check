// State Management
let currentMode = 'mobile';
let localStream = null;
let peerConnection = null;
let sessionId = null;
let serverIp = window.location.hostname || '127.0.0.1';
let serverPort = window.location.port || '8443';
let pollInterval = null;
let pendingIceCandidates = [];

// STUN server configuration for local P2P WebRTC ICE candidate resolution
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ],
  iceCandidatePoolSize: 10
};

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

// Initialize on DOM load
window.addEventListener('DOMContentLoaded', () => {
  const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) || window.innerWidth < 768;
  const initialMode = isMobile ? 'mobile' : 'laptop';
  
  fetchServerInfo();
  setMode(initialMode);
});

function setMode(mode) {
  currentMode = mode;

  stopPolling();
  closePeerConnection();

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
    fetchDiscoveredSessions();
  }
}

// ==========================================
// MOBILE MODE FUNCTIONS
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
      console.warn('Rear camera exact match failed, using environment fallback:', e);
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false
      });
    }

    localStream = stream;
    mobilePreview.srcObject = stream;
    await mobilePreview.play().catch(e => console.warn('Mobile preview play:', e));
    cameraOverlay.classList.add('hidden');

    updateCameraStatus('green', 'Connected');
    updateStreamingStatus('yellow', 'Ready');

    await registerMobileSession();

  } catch (err) {
    console.error('Camera Access Error:', err);
    updateCameraStatus('red', 'Permission Denied / Error');
    cameraOverlayText.textContent = '❌ Camera Access Failed: ' + err.message;
    document.getElementById('btnRetryCamera').classList.remove('hidden');
  }
}

function stopLocalCamera() {
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  mobilePreview.srcObject = null;
}

async function registerMobileSession() {
  try {
    const res = await fetch('/api/signal/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: serverIp })
    });
    const data = await res.json();

    if (data.session_id) {
      sessionId = data.session_id;
      const fullAddr = `${serverIp}:${serverPort}`;
      mobileAddressDisplay.textContent = fullAddr;

      startMobileSignalPolling();
    }
  } catch (err) {
    console.error('Registration failed:', err);
    mobileAddressDisplay.textContent = `${serverIp}:${serverPort}`;
  }
}

function startMobileSignalPolling() {
  stopPolling();
  pollInterval = setInterval(async () => {
    if (!sessionId) return;
    try {
      const res = await fetch(`/api/signal/poll?session_id=${encodeURIComponent(sessionId)}&role=mobile`);
      const data = await res.json();

      if (data.messages && data.messages.length > 0) {
        for (const msg of data.messages) {
          await handleMobileReceivedSignal(msg);
        }
      }
    } catch (e) {
      console.error('Mobile poll error:', e);
    }
  }, 1000);
}

async function handleMobileReceivedSignal(msg) {
  if (msg.type === 'offer') {
    console.log('Mobile received WebRTC Offer from laptop');
    updateStreamingStatus('yellow', 'Connecting to Laptop...');

    createMobilePeerConnection();

    await peerConnection.setRemoteDescription(new RTCSessionDescription(msg.sdp));

    // Process queued candidates
    while (pendingIceCandidates.length > 0) {
      const candidate = pendingIceCandidates.shift();
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => console.warn('Queued ICE cand error:', e));
    }

    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    await sendSignal('laptop', { type: 'answer', sdp: answer });

  } else if (msg.type === 'candidate') {
    if (peerConnection && peerConnection.remoteDescription && peerConnection.remoteDescription.type) {
      try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(msg.candidate));
      } catch (e) {
        console.error('Error adding ICE candidate on mobile:', e);
      }
    } else {
      pendingIceCandidates.push(msg.candidate);
    }
  }
}

function createMobilePeerConnection() {
  closePeerConnection();
  pendingIceCandidates = [];

  peerConnection = new RTCPeerConnection(rtcConfig);

  if (localStream) {
    localStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, localStream);
    });
  }

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      sendSignal('laptop', { type: 'candidate', candidate: event.candidate });
    }
  };

  peerConnection.onconnectionstatechange = () => {
    console.log('Mobile PC Connection State:', peerConnection.connectionState);
    if (peerConnection.connectionState === 'connected') {
      updateStreamingStatus('green', 'Streaming to Laptop');
    } else if (peerConnection.connectionState === 'disconnected' || peerConnection.connectionState === 'failed') {
      updateStreamingStatus('yellow', 'Ready (Waiting for Laptop)');
    }
  };
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
// LAPTOP MODE FUNCTIONS
// ==========================================

async function connectToMobile() {
  let targetAddr = inputMobileAddress.value.trim();
  if (!targetAddr) {
    alert('Please enter the Mobile IP or Connection Address displayed on your phone screen.');
    return;
  }

  targetAddr = targetAddr.replace(/^https?:\/\//i, '').split('/')[0].split(':')[0];
  sessionId = targetAddr;

  updateLaptopStatus('connecting', 'Connecting...');
  remoteOverlayText.textContent = 'Connecting to Mobile Camera Stream...';
  remoteOverlay.classList.remove('hidden');

  createLaptopPeerConnection();

  try {
    const offer = await peerConnection.createOffer({
      offerToReceiveVideo: true,
      offerToReceiveAudio: false
    });
    await peerConnection.setLocalDescription(offer);

    await sendSignal('mobile', { type: 'offer', sdp: offer });

    startLaptopSignalPolling();
  } catch (err) {
    console.error('Error creating offer:', err);
    updateLaptopStatus('disconnected', 'Failed to Create Offer');
  }
}

function createLaptopPeerConnection() {
  closePeerConnection();
  pendingIceCandidates = [];

  peerConnection = new RTCPeerConnection(rtcConfig);

  peerConnection.ontrack = async (event) => {
    console.log('Laptop received remote track:', event.streams[0]);
    if (event.streams && event.streams[0]) {
      remoteVideo.srcObject = event.streams[0];
      remoteVideo.muted = true; // Essential for browser autoplay policies
      try {
        await remoteVideo.play();
        console.log('Remote video playing successfully');
      } catch (err) {
        console.warn('Video play error:', err);
      }
      remoteOverlay.classList.add('hidden');
      updateLaptopStatus('streaming', 'Streaming');
    }
  };

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      sendSignal('mobile', { type: 'candidate', candidate: event.candidate });
    }
  };

  peerConnection.onconnectionstatechange = () => {
    console.log('Laptop PC Connection State:', peerConnection.connectionState);
    if (peerConnection.connectionState === 'connecting') {
      updateLaptopStatus('connecting', 'Connecting');
    } else if (peerConnection.connectionState === 'connected') {
      updateLaptopStatus('connected', 'Connected');
      remoteOverlay.classList.add('hidden');
    } else if (peerConnection.connectionState === 'disconnected' || peerConnection.connectionState === 'failed') {
      updateLaptopStatus('disconnected', 'Disconnected');
      remoteOverlay.classList.remove('hidden');
      remoteOverlayText.textContent = 'Connection Disconnected';
    }
  };
}

function startLaptopSignalPolling() {
  stopPolling();
  pollInterval = setInterval(async () => {
    if (!sessionId) return;
    try {
      const res = await fetch(`/api/signal/poll?session_id=${encodeURIComponent(sessionId)}&role=laptop`);
      const data = await res.json();

      if (data.messages && data.messages.length > 0) {
        for (const msg of data.messages) {
          await handleLaptopReceivedSignal(msg);
        }
      }
    } catch (e) {
      console.error('Laptop poll error:', e);
    }
  }, 1000);
}

async function handleLaptopReceivedSignal(msg) {
  if (msg.type === 'answer' && peerConnection) {
    console.log('Laptop received WebRTC Answer from mobile');
    await peerConnection.setRemoteDescription(new RTCSessionDescription(msg.sdp));

    // Process queued candidates
    while (pendingIceCandidates.length > 0) {
      const candidate = pendingIceCandidates.shift();
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => console.warn('Queued ICE cand error:', e));
    }

  } else if (msg.type === 'candidate') {
    if (peerConnection && peerConnection.remoteDescription && peerConnection.remoteDescription.type) {
      try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(msg.candidate));
      } catch (e) {
        console.error('Error adding ICE candidate on laptop:', e);
      }
    } else {
      pendingIceCandidates.push(msg.candidate);
    }
  }
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

// ==========================================
// SHARED UTILITIES
// ==========================================

async function fetchServerInfo() {
  try {
    const res = await fetch('/api/info');
    const data = await res.json();
    if (data.ip) {
      serverIp = data.ip;
      serverPort = data.port || '8443';
      
      if (inputMobileAddress && !inputMobileAddress.value) {
        inputMobileAddress.value = `${serverIp}:${serverPort}`;
      }
    }
  } catch (e) {
    console.warn('Could not fetch server info:', e);
  }
}

async function fetchDiscoveredSessions() {
  try {
    const res = await fetch('/api/info');
    const data = await res.json();
    const chipsContainer = document.getElementById('sessionChips');
    const container = document.getElementById('discoveredSessionsList');

    if (data.sessions && data.sessions.length > 0) {
      chipsContainer.innerHTML = '';
      data.sessions.forEach(sess => {
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.textContent = sess;
        chip.onclick = () => {
          inputMobileAddress.value = sess;
        };
        chipsContainer.appendChild(chip);
      });
      container.classList.remove('hidden');
    } else {
      container.classList.add('hidden');
    }
  } catch (e) {
    // Ignore
  }
}

async function sendSignal(targetRole, payload) {
  try {
    await fetch('/api/signal/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        target_role: targetRole,
        payload: payload
      })
    });
  } catch (e) {
    console.error('Error sending signal:', e);
  }
}

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

function closePeerConnection() {
  if (peerConnection) {
    peerConnection.onicecandidate = null;
    peerConnection.ontrack = null;
    peerConnection.close();
    peerConnection = null;
  }
  pendingIceCandidates = [];
}
