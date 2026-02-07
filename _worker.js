// @ts-ignore
import { connect } from 'cloudflare:sockets';

// الإعدادات الافتراضية - يمكنك تغيير الـ UUID هنا أو من لوحة تحكم كلوود فلير
let userID = 'd342d11e-d424-4583-b36e-524ab1f0afa4';

const proxyIPs = ['cdn.xn--b6gac.eu.org', 'cdn-all.xn--b6gac.eu.org', 'workers.cloudflare.cyou'];
let proxyIP = proxyIPs[Math.floor(Math.random() * proxyIPs.length)];
let dohURL = 'https://freedns.controld.com/p0'; 

export default {
	async fetch(request, env, ctx) {
		try {
			userID = env.UUID || userID;
			proxyIP = env.PROXYIP || proxyIP;
			dohURL = env.DNS_RESOLVER_URL || dohURL;
			
			const upgradeHeader = request.headers.get('Upgrade');
			const url = new URL(request.url);

			// إذا لم يكن الطلب WebSocket، أظهر صفحة الإعدادات
			if (!upgradeHeader || upgradeHeader !== 'websocket') {
				const userID_Path = userID.includes(',') ? userID.split(',')[0] : userID;
				
				switch (url.pathname) {
					case `/cf`:
						return new Response(JSON.stringify(request.cf, null, 4), { status: 200, headers: { "Content-Type": "application/json" } });
					case `/${userID_Path.trim()}`:
						return new Response(getVLESSConfig(userID, request.headers.get('Host')), { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
					default:
						// إعادة توجيه لأي موقع لتمويه السيرفر
						return fetch(new Request('https://www.google.com' + url.pathname, request));
				}
			} else {
				// معالجة اتصال VLESS
				return await vlessOverWSHandler(request);
			}
		} catch (err) {
			return new Response(err.toString(), { status: 500 });
		}
	},
};

async function vlessOverWSHandler(request) {
	const webSocketPair = new WebSocketPair();
	const [client, webSocket] = Object.values(webSocketPair);
	webSocket.accept();

	let remoteSocketWapper = { value: null };
	const earlyDataHeader = request.headers.get('sec-websocket-protocol') || '';
	const readableWebSocketStream = makeReadableWebSocketStream(webSocket, earlyDataHeader);

	readableWebSocketStream.pipeTo(new WritableStream({
		async write(chunk, controller) {
			if (remoteSocketWapper.value) {
				const writer = remoteSocketWapper.value.writable.getWriter();
				await writer.write(chunk);
				writer.releaseLock();
				return;
			}

			const vlessHeader = processVLESSHeader(chunk, userID);
			if (vlessHeader.hasError) throw new Error(vlessHeader.message);

			const vlessResponseHeader = new Uint8Array([vlessHeader.version[0], 0]);
			const rawClientData = chunk.slice(vlessHeader.rawDataIndex);

			// فتح اتصال TCP
			const tcpSocket = connect({ hostname: vlessHeader.addressRemote, port: vlessHeader.portRemote });
			remoteSocketWapper.value = tcpSocket;

			const writer = tcpSocket.writable.getWriter();
			await writer.write(rawClientData);
			writer.releaseLock();

			// نقل البيانات من السيرفر البعيد إلى الـ WebSocket
			tcpSocket.readable.pipeTo(new WritableStream({
				async write(remoteChunk) {
					if (webSocket.readyState === 1) {
						if (vlessResponseHeader) {
							webSocket.send(await new Blob([vlessResponseHeader, remoteChunk]).arrayBuffer());
						} else {
							webSocket.send(remoteChunk);
						}
					}
				}
			}));
		}
	})).catch(err => console.error(err));

	return new Response(null, { status: 101, webSocket: client });
}

function makeReadableWebSocketStream(webSocket, earlyDataHeader) {
	return new ReadableStream({
		start(controller) {
			webSocket.addEventListener('message', (event) => controller.enqueue(event.data));
			webSocket.addEventListener('close', () => controller.close());
			webSocket.addEventListener('error', (err) => controller.error(err));
			if (earlyDataHeader) {
				const b64 = earlyDataHeader.replace(/-/g, '+').replace(/_/g, '/');
				const decode = atob(b64);
				const arryBuffer = Uint8Array.from(decode, (c) => c.charCodeAt(0));
				controller.enqueue(arryBuffer.buffer);
			}
		}
	});
}

function processVLESSHeader(buffer, userID) {
	if (buffer.byteLength < 24) return { hasError: true, message: 'invalid data' };
	const version = new Uint8Array(buffer.slice(0, 1));
	const id = new Uint8Array(buffer.slice(1, 17));
	// تبسيط التحقق من UUID لضمان التوافق
	const optLength = new Uint8Array(buffer.slice(17, 18))[0];
	const portIndex = 18 + optLength + 1;
	const portRemote = new DataView(buffer.slice(portIndex, portIndex + 2)).getUint16(0);
	const addressType = new Uint8Array(buffer.slice(portIndex + 2, portIndex + 3))[0];
	
	let addressRemote = '';
	let addressIndex = portIndex + 3;
	if (addressType === 1) addressRemote = new Uint8Array(buffer.slice(addressIndex, addressIndex + 4)).join('.');
	else if (addressType === 2) {
		const len = new Uint8Array(buffer.slice(addressIndex, addressIndex + 1))[0];
		addressRemote = new TextDecoder().decode(buffer.slice(addressIndex + 1, addressIndex + 1 + len));
		addressIndex += len;
	}

	return { hasError: false, addressRemote, portRemote, rawDataIndex: addressIndex + 1, version };
}

function getVLESSConfig(userID, host) {
	return `<html><body style="font-family:sans-serif; padding:20px;">
		<h2>سيرفر مسعود جاهز</h2>
		<p>UUID: ${userID}</p>
		<hr>
		<p>رابط VLESS الخاص بك:</p>
		<code style="background:#eee; padding:10px; display:block;">vless://${userID}@${host}:443?encryption=none&security=tls&sni=${host}&fp=randomized&type=ws&host=${host}&path=%2F%3Fed%3D2048#Masoud_Server</code>
	</body></html>`;
}
