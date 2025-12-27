import fs from 'node:fs';
import http from 'http';
import http2 from 'http2';
import { createGzip, createBrotliCompress } from "zlib";

export class HttpMux {

    /** @typedef {{ method : string, url : string, callback_fn : (request:Request, response:Response) => void, regex : RegExp, path_param_names : string[] }} Route */
    /** @type {({ type : 'route', data : Route } | { type : 'middleware', path : string, callback_fn : (request:Request, response:Response) => void | Promise<void> })[]} */
    #routes = [];
    #is_serving = false;

    constructor() { }

    /**
     * @param {string} port
     * @param {string} host
     */
    serve = (port, host = "localhost") => new Promise((resolve, reject) => {
        if (this.#is_serving) return console.error("Web server is already running");
        this.#is_serving = true;

        const server = http.createServer((request, response) => {
            this.strip_prefix()(new Request(request), new Response(response));
        });

        server.listen({ host, port }, (error) => {
            if (error) return reject(error);
            console.log(`Serving at http://${host}:${port}`);
            resolve();
        });
    })

    /**
     * @param {string} tls_cert
     * @param {string} tls_key
     * @param {string} port
     * @param {string} host
     */
    serveTLS = (key, cert, port, host = "localhost") => new Promise((resolve, reject) => {
        if (this.#is_serving) return console.error("Web server is already running");
        this.#is_serving = true;
        const server = http2.createSecureServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) })
        const removeColonInHeaders = (headers) => Object.keys(headers).forEach((key) => {
            if (key.charAt(0) !== ":") return;
            const new_key = key.substring(1, key.length);
            headers[new_key] = headers[key];
            delete headers[key];
        })

        server.on('stream', (stream, headers) => {
            const accept = headers["accept-encoding"] || "";
            const useBrotli = accept.includes("br");
            const compressor = useBrotli ? createBrotliCompress() : createGzip();
            compressor.pipe(stream);

            removeColonInHeaders(headers);

            const request = {
                method: headers["method"],
                url: headers["path"],
                headers,
                on: stream.on.bind(stream),
                [Symbol.asyncIterator]: stream[Symbol.asyncIterator].bind(stream)
            };

            const compressedStream = {
                write: chunk => compressor.write(chunk),
                end: chunk => (chunk) ? compressor.end(chunk) : compressor.end(),
                respond: headers => stream.respond({ ...headers, "content-encoding": useBrotli ? "br" : "gzip" }),
            };

            this.strip_prefix()(new Request(request), new Response(compressedStream));
        });

        server.listen({ host, port }, (error) => {
            if (error) return reject(error);
            console.log(`Serving at https://${host}:${port}`);
            resolve();
        });
    })

    /**
     * @param {string} method_and_path
     * @param {(request:Request, response:Response) => void} callback_fn
     */
    handleFunc = (method_and_path, callback_fn) => {
        const [method, url] = method_and_path.split(" ");
        const route = { method, url, callback_fn, regex: new RegExp(""), path_param_names: [] };
        const escapedPattern = url.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

        route.regex = new RegExp("^" + escapedPattern
            .replace(/:([^\/]+)/g, (_, key) => {
                route.path_param_names.push(key);
                return "([^/]+)";
            })
            .replace(/\/\*$/, () => {
                route.path_param_names.push("wildcard");
                return "(?:/(.*))?"; // matches /anything or empty
            }) + "$"
        );

        this.#routes.push({ type: 'route', data: route });
    }

    /**
     * @param {string} path
     * @param {(request, response, next) => void | Promise<void>} callback_fn
     */
    handle = (path, callback_fn) => this.#routes.push({ type: 'middleware', path, callback_fn });

    /**
     * @param {string} strip_prefix
     */
    strip_prefix = (strip_prefix = "") => {
        /**
         * @param {Request} request
         * @param {Response} response
         */
        return async (request, response) => {
            for (const route of this.#routes) {
                if (route.type === "route") {
                    const url = strip_prefix && request.url.startsWith(strip_prefix) ? request.url.substring(strip_prefix.length, request.url.length) : request.url;
                    const clean_url = url.split("?")[0];
                    const match = clean_url.match(route.data.regex);
                    if (!match || request.method !== route.data.method) continue;
                    const path_params = new Map();
                    for (let i = 0; i < route.data.path_param_names.length; i++) path_params.set(route.data.path_param_names[i], match[i + 1]);
                    request.pathParams = path_params;
                    route.data.callback_fn(request, response);
                    return;
                } else {
                    if (!request.url.startsWith(route.path)) continue;
                    const promise = route.callback_fn(request, response);
                    if (promise instanceof Promise) await promise;
                    if (response.is_sent) return;
                }
            }

            if (response.is_sent) return;
            response.status = 404;
            response.end("Page Not found");
            return;
        }
    }
}

export class Response {

    #status = 200;
    is_sent = false;
    /** @type {Record<string, string>} */
    headers = {};

    #response;

    #sendHeaders() {
        this.is_sent = true;

        // HTTP/1
        if (this.#response.setHeaders) {
            this.#response.statusCode = this.#status;
            this.#response.setHeaders(this.headers);
            return;
        }

        // HTTP/2
        this.#response.respond({ ...this.headers, ":status": this.#status });
    }

    /**
     * @param {{ setHeaders : (headers:Headers) => void, write : (chunk:any) => void, end : (chunk:any) => void }} res
     */
    constructor(res) {
        this.#response = res;
    }

    /**
     * @param {string} name
     * @param {string} value
     */
    setHeader(name, value) {
        this.headers[name] = value;
        return this;
    }

    /**
     * @param {number} status
     */
    status(status) {
        this.#status = status;
        return this;
    }

    /**
     * @param {any} chunk
     */
    write(chunk) {
        this.#response.write(chunk);
        return this;
    }

    /**
     * @param {any} chunk
     */
    end(chunk) {
        if (this.is_sent) throw new Error("response has been sent already");
        this.#sendHeaders();
        this.#response.end(chunk);
    }
}

export class Request {

    #request;
    #max_body_size;
    #max_request_size;

    /**
     * @param {{ method : string, url : string, headers : Record<string, any>, on : (name:string, cb:Function) => void }} req
     * @param {number} max_body_size
     * @param {number} max_request_size
     */
    constructor(req, max_body_size, max_request_size) {
        this.#max_body_size = max_body_size;
        this.#max_request_size = max_request_size;
        this.#request = req;

        this.method = this.#request.method;
        this.url = this.#request.url;
        this.headers = this.#request.headers;
    }

    /**
     * @param {string} name
     * @param {Function} callback
     */
    on(name, callback) {
        this.#request.on(name, callback);
    }

    async arrayBuffer() {
        const chunks = [];
        for await (const c of this.#request) chunks.push(c);
        return Buffer.concat(chunks);
    }

    async text() {
        return (await this.arrayBuffer()).toString();
    }

    async json() {
        return JSON.parse(await this.text());
    }

    async formData() {
        const contentType = this.#request.headers["content-type"] || "";
        const boundary = contentType.split("boundary=")[1];
        if (!contentType.startsWith("multipart/form-data")) throw new Error("content-type not multipart/form-data");
        if (!boundary) throw new Error("no form-data boundary");
        return parseMultipart(this.#request, boundary, this.#max_request_size, this.#max_body_size)
    }
}

/**
 * @param {http.IncomingMessage} stream
 * @param {string} boundary
 * @param {number} max_request_size
 * @param {number} max_body_size
 * @returns {Promise<Map<string, any>>}
 */
function parseMultipart(stream, boundary, max_request_size, max_body_size) {
    return new Promise((resolve, reject) => {
        const dashBoundary = Buffer.from("--" + boundary);
        const dashBoundaryEnd = Buffer.from("--" + boundary + "--");
        const headerEndSeq = Buffer.from("\r\n\r\n");
        const fields = new Map();

        let buffer = Buffer.allocUnsafe(64 * 1024);
        let bufferLen = 0;
        let state = 0; // 0 SEARCH, 1 HEADERS, 2 BODY
        let headerStart = 0;
        let bodyStart = 0;
        let currentName = null;
        let currentFilename = null;
        let currentSize = 0;
        let bodyChunks = [];
        let totalBodySize = 0;

        function ensure(size) {
            if (bufferLen + size <= buffer.length) return;
            const next = Buffer.allocUnsafe(Math.max(buffer.length * 2, bufferLen + size));
            buffer.copy(next, 0, 0, bufferLen);
            buffer = next;
        }

        function parseHeaders(buf) {
            return buf.toString().split("\r\n").reduce((headers, line) => {
                const idx = line.indexOf(":");
                if (idx !== -1) headers[line.slice(0, idx).toLowerCase()] = line.slice(idx + 1).trim();
                return headers;
            }, {});
        }

        function setupPart(headers) {
            const disp = headers["content-disposition"];
            if (!disp) return;

            currentName = /name="([^"]+)"/.exec(disp)?.[1] ?? null;
            currentFilename = /filename="([^"]*)"/.exec(disp)?.[1] ?? null;

            currentSize = 0;
            bodyChunks.length = 0;
        }

        function finishPart() {
            if (!currentName) return;

            const data = Buffer.concat(bodyChunks, currentSize);
            totalBodySize += data.length;

            if (max_request_size > 0 && totalBodySize > max_request_size) return reject("maximum request size exceeded");
            if (max_body_size > 0 && data.length > max_body_size) return reject("maximum field size exceeded");

            if (currentFilename) {
                fields.set(currentName, currentFilename === "blob" ? new Blob([data]) : new File([data], currentFilename));
            } else {
                fields.set(currentName, data.toString("utf8"));
            }

            currentName = null;
            currentFilename = null;
        }

        stream.on("data", chunk => {
            ensure(chunk.length);
            chunk.copy(buffer, bufferLen);
            bufferLen += chunk.length;

            let i = 0;
            while (i < bufferLen) {
                if (state === 0) {
                    const idx = buffer.indexOf(dashBoundary, i);
                    if (idx === -1) break;
                    i = idx + dashBoundary.length;
                    if (buffer.indexOf(dashBoundaryEnd, idx) === idx) return resolve(fields);
                    if (buffer[i] === 13 && buffer[i + 1] === 10) i += 2;
                    headerStart = i;
                    state = 1;
                }

                if (state === 1) {
                    const idx = buffer.indexOf(headerEndSeq, headerStart);
                    if (idx === -1) break;

                    const headers = parseHeaders(buffer.subarray(headerStart, idx));
                    setupPart(headers);

                    i = idx + 4;
                    bodyStart = i;
                    state = 2;
                }

                if (state === 2) {
                    const idx = buffer.indexOf(dashBoundary, bodyStart);
                    if (idx === -1) break;

                    const chunkData = buffer.subarray(bodyStart, idx - 2);
                    bodyChunks.push(chunkData);
                    currentSize += chunkData.length;

                    finishPart();

                    i = idx + dashBoundary.length;
                    if (buffer[i] === 45 && buffer[i + 1] === 45) return resolve(fields);
                    if (buffer[i] === 13 && buffer[i + 1] === 10) i += 2;
                    headerStart = i;
                    state = 1;
                }
            }

            buffer.copy(buffer, 0, i, bufferLen);
            bufferLen -= i;
        });

        stream.on("end", () => resolve(fields));
        stream.on("error", reject);
    });
}
