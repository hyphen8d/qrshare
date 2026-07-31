// Thin wrapper around RTCPeerConnection for the "QR-paired, then direct"
// flow: exchange one offer/answer over QR (non-trickle — we wait for full
// ICE gathering so the *entire* connection description fits in a handful of
// QR frames, no ongoing signaling channel needed), then hand off to a
// DataChannel for the actual bytes.
//
// A public STUN server is included for reliability on trickier networks,
// but nothing here requires internet access to work: on a plain shared
// LAN (the common case — phone and laptop on the same wifi), host
// candidates alone are enough to connect.

const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
const ICE_GATHERING_TIMEOUT_MS = 4000;
const CONNECT_TIMEOUT_MS = 25000;

function waitForIceGatheringComplete(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener('icegatheringstatechange', check);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === 'complete') done();
    };
    pc.addEventListener('icegatheringstatechange', check);
    // Don't let a slow/unreachable STUN server hold up the handshake —
    // proceed with whatever candidates we have so far.
    setTimeout(done, ICE_GATHERING_TIMEOUT_MS);
  });
}

export interface Offerer {
  pc: RTCPeerConnection;
  channel: RTCDataChannel;
  offerSdp: string;
  /** Call once the answer has been scanned back in. */
  applyAnswer: (answerSdp: string) => Promise<void>;
  /** Resolves once the DataChannel is open, rejects on timeout/failure. */
  waitUntilConnected: () => Promise<void>;
}

export async function createOfferer(): Promise<Offerer> {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  const channel = pc.createDataChannel('file', { ordered: true });

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitForIceGatheringComplete(pc);

  const offerSdp = pc.localDescription?.sdp ?? offer.sdp ?? '';

  return {
    pc,
    channel,
    offerSdp,
    applyAnswer: async (answerSdp: string) => {
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
    },
    waitUntilConnected: () => waitForChannelOpen(channel, pc)
  };
}

export interface Answerer {
  pc: RTCPeerConnection;
  answerSdp: string;
  /** Resolves with the DataChannel once the peer's connection opens it. */
  waitForChannel: () => Promise<RTCDataChannel>;
}

export async function createAnswerer(offerSdp: string): Promise<Answerer> {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

  const channelPromise = new Promise<RTCDataChannel>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for a connection.')), CONNECT_TIMEOUT_MS);
    pc.ondatachannel = (ev) => {
      clearTimeout(timer);
      resolve(ev.channel);
    };
  });

  await pc.setRemoteDescription({ type: 'offer', sdp: offerSdp });
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await waitForIceGatheringComplete(pc);

  const answerSdp = pc.localDescription?.sdp ?? answer.sdp ?? '';

  return {
    pc,
    answerSdp,
    waitForChannel: () => channelPromise
  };
}

function waitForChannelOpen(channel: RTCDataChannel, pc: RTCPeerConnection): Promise<void> {
  if (channel.readyState === 'open') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out connecting to the other device.')), CONNECT_TIMEOUT_MS);
    channel.addEventListener('open', () => {
      clearTimeout(timer);
      resolve();
    });
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'failed') {
        clearTimeout(timer);
        reject(new Error('Connection failed.'));
      }
    });
  });
}

export function closeConnection(pc: RTCPeerConnection) {
  try { pc.close(); } catch { /* already closed */ }
}
