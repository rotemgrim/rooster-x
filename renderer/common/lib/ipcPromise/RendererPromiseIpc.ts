import {v4 as uuid} from "uuid";
import {AbstractPromiseIpc} from "./AbstractPromiseIpc";
// import * as Promise from "bluebird";

export class RendererPromiseIpc extends AbstractPromiseIpc {

    private maxTimeoutMs: number = 1000;
    private socket: WebSocket;
    private isSocketConnected: boolean = false;
    private reconnectTimeout: number = 3000;
    private queue: Record<string, {success: CallableFunction, failure: CallableFunction}> = {};

    constructor(opts: { maxTimeoutMs?: number, reconnectTimeout?: number }) {
        super();
        if (opts) {
            this.maxTimeoutMs = opts.maxTimeoutMs || this.maxTimeoutMs;
            this.reconnectTimeout = opts.reconnectTimeout || this.reconnectTimeout;
        }
        this.connectToWs();
    }

    IpcRenderer() {
        // const send = (route: string, payload?: object) => {
        //     const request = {
        //         route: route,
        //         payload: payload
        //     }
        //     this.socket.send(JSON.stringify(request));
        // }
        const send = this.send.bind(this);
        return {
            send,
        }
    }

    private connectToWs = () => {
        // Connect to the WebSocket server
        this.socket = new WebSocket('ws://localhost:8080/ws');

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
                    default:
                        cb.failure(new Error(`Unexpected IPC call for in ${JSON.stringify(response)}`));
                        delete this.queue[response.replyChannel];
                }
            } else if (response.status === "msg") {
                // console.log("msg", response.data);
                window["RoosterX"].showMsg = response.data;
            } else {
                console.error(`No callback found for ${JSON.stringify(response)}`);
            }
        });
    };

    public send(route: string, payload?: object): Promise<any> {

        // If the socket is not connected, wait for it to connect
        if (!this.isSocketConnected) {
            return new Promise((resolve, reject) => {
                setTimeout(() => {
                    this.send(route, payload).then(resolve).catch(reject);
                }, 300);
            });
        }

        return new Promise((resolve, reject) => {
            const replyChannel = `${route}#${uuid()}`;
            this.queue[replyChannel] = {success: resolve, failure: reject};

            console.log(`Sending message to server: ${route}`, payload);
            // ipcRenderer will send a message back to replyChannel when it finishes calculating
            this.socket.send(RendererPromiseIpc.prepareDataForSend(replyChannel, route, payload));

            setTimeout(() => {
                console.error(`Renderer PromiseIpc times out after ${(this.maxTimeoutMs / 1000)} seconds for: ${route}`);
                reject(new Error(`${route} timed out.`));
            }, this.maxTimeoutMs);
        });
    }

}
