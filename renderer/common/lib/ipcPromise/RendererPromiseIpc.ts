import {v4 as uuid} from "uuid";

/**
 * Request/response over the server's WebSocket: every send() gets a reply
 * (or streamed chunks, then a reply) on its own reply channel. The server
 * also pushes status messages, delivered to onMessage() listeners.
 */
export class RendererPromiseIpc {

    private maxTimeoutMs: number = 1000;
    private socket: WebSocket;
    private isSocketConnected: boolean = false;
    private reconnectTimeout: number = 3000;
    private queue: Record<string, {success: CallableFunction, failure: CallableFunction, chunk?: CallableFunction}> = {};
    private userId: number = 0;
    private messageListeners = new Set<(msg: string) => void>();

    constructor(opts: { maxTimeoutMs?: number, reconnectTimeout?: number }) {
        if (opts) {
            this.maxTimeoutMs = opts.maxTimeoutMs || this.maxTimeoutMs;
            this.reconnectTimeout = opts.reconnectTimeout || this.reconnectTimeout;
        }
        this.connectToWs();
    }

    setUserId(userId: number) {
        this.userId = userId;
    }

    /** Subscribes to the status messages the server pushes; returns the unsubscribe. */
    public onMessage(listener: (msg: string) => void): () => void {
        this.messageListeners.add(listener);
        return () => {
            this.messageListeners.delete(listener);
        };
    }

    private connectToWs = () => {
        // Connect to the WebSocket server.
        // Use the page's own host so it works when accessed from another
        // device on the LAN (e.g. a phone hitting http://<pc-ip>:8080).
        // Fall back to localhost:8080 when the page isn't served over http
        // (e.g. loaded via file:// during Electron dev).
        let wsUrl = 'ws://localhost:8080/ws';
        if (typeof window !== 'undefined' && window.location && window.location.host
            && (window.location.protocol === 'http:' || window.location.protocol === 'https:')) {
            const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            wsUrl = `${proto}//${window.location.host}/ws`;
        }
        this.socket = new WebSocket(wsUrl);

        // Connection opened
        this.socket.addEventListener('open', (event) => {
            this.isSocketConnected = true;
            console.log('Connected to WebSocket server');
        });

        // Connection closed
        this.socket.addEventListener('close', (event) => {
            this.isSocketConnected = false;
            console.log('Disconnected from WebSocket server, reconnecting in 3 second');
            setTimeout(this.connectToWs, 3000);
        });

        // Listen for all messages
        // this.socket.addEventListener('message', (event) => {
        //     console.log('Message from server:', event.data);
        // });
        this.socket.addEventListener('message', (event) => {
            const response = JSON.parse(event.data);
            console.log('Message from server:', response);
            const cb = this.queue[response.replyChannel];
            if (cb) {
                switch (response.status) {
                    case "success":
                        cb.success(response.data);
                        delete this.queue[response.replyChannel];
                        break;
                    case "failure":
                        cb.failure(response.data);
                        delete this.queue[response.replyChannel];
                        break;
                    case "chunk":
                        // Streaming response - dispatch to onChunk if provided,
                        // but keep the queue entry so final success/failure can resolve.
                        if (cb.chunk) {
                            try {
                                cb.chunk(response.data);
                            } catch (e) {
                                console.error("onChunk handler threw:", e);
                            }
                        }
                        break;
                    default:
                        cb.failure(new Error(`Unexpected IPC call for in ${JSON.stringify(response)}`));
                        delete this.queue[response.replyChannel];
                }
            } else if (response.status === "msg") {
                this.messageListeners.forEach(listener => listener(response.data));
            } else {
                console.error(`No callback found for ${JSON.stringify(response)}`);
            }
        });
    };

    public send<T = unknown>(route: string, payload?: object, onChunk?: (chunk: any) => void): Promise<T> {

        // If the socket is not connected, wait for it to connect
        if (!this.isSocketConnected) {
            return new Promise((resolve, reject) => {
                setTimeout(() => {
                    this.send<T>(route, payload, onChunk).then(resolve).catch(reject);
                }, 300);
            });
        }

        return new Promise((resolve, reject) => {
            const replyChannel = `${route}#${uuid()}`;
            this.queue[replyChannel] = {success: resolve, failure: reject, chunk: onChunk};

            console.log(`Sending message to server: ${route}`, payload);
            // the server answers on replyChannel when it is done
            this.socket.send(JSON.stringify({replyChannel, route, userId: this.userId, data: payload}));

            setTimeout(() => {
                // Only time out if the request is still pending. Long-running
                // streaming requests are expected and should not error out as
                // long as they're still producing chunks or have completed.
                if (!this.queue[replyChannel]) {
                    return;
                }
                console.error(`Renderer PromiseIpc times out after ${(this.maxTimeoutMs / 1000)} seconds for: ${route}`);
                delete this.queue[replyChannel];
                reject(new Error(`${route} timed out.`));
            }, this.maxTimeoutMs);
        });
    }

}
