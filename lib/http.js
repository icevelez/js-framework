import fs from 'node:fs';
import http from 'http';
import http2 from 'http2';
import { createGzip, createBrotliCompress } from "zlib";

export class HttpMux {

    /** @typedef {{ children?: Map<string, Node>, param?: Node, paramName?: string, wildcard?: Node, handler?: Function, stack?: Function[] }} Node */

    #is_serving = false;
    #is_serving_https = false;

    /** @type {Map<string, Node>} */
    #routes = new Map();

    #mwCounter = 0;
    /** @type {{ children : Map<string, Node>, stack : Function[] }} */
    #middlewareTree = {            // prefix router
        children: new Map(),
        stack: []
    };


    #findRoute(req) {
        const parts = req.url.split("?")[0].split("/").filter(Boolean);
        const root = this.#routes.get(req.method);
        if (!root) return null;

        let node = root;
        const params = new Map();

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            if (node.children?.has(part)) {
                node = node.children.get(part);
            } else if (node.param) {
                params.set(node.param.paramName, part);
                node = node.param;
            } else if (node.wildcard) {
                params.set("wildcard", parts.slice(i).join("/"));
                node = node.wildcard;
                break;
            } else {
                return null;
            }
        }

        return node?.handler ? { maxMiddlewareId: node.maxMiddlewareId, handler: node.handler, params } : null;
    }

    async #runMiddleware(req, res, maxId) {
        const parts = req.url.split("?")[0].split("/").filter(Boolean);
        let node = this.#middlewareTree;

        for (const { fn, id } of node.stack) {
            if (maxId > -1 && id > maxId) continue;
            await fn(req, res);
            if (res.is_sent) return true;
        }

        for (const part of parts) {
            if (!node.children.has(part)) break;
            node = node.children.get(part);

            for (const { fn, id } of node.stack) {
                if (maxId > -1 && id > maxId) continue
                await fn(req, res);
                if (res.is_sent) return true;
            }
        }

        return false;
    }

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
        if (this.#is_serving_https) return console.error("Web server is already running");
        this.#is_serving_https = true;
        const server = http2.createSecureServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) })

        server.on('stream', (stream, headers) => {
            const accept = headers["accept-encoding"] || "";
            const useBrotli = accept.includes("br");
            const compressor = useBrotli ? createBrotliCompress() : createGzip();
            compressor.pipe(stream);

            stream.method = headers[":method"];
            stream.url = headers[":path"];
            stream.headers = headers;

            const compressedStream = {
                write: chunk => compressor.write(chunk),
                end: chunk => (chunk) ? compressor.end(chunk) : compressor.end(),
                respond: headers => stream.respond({ ...headers, "content-encoding": useBrotli ? "br" : "gzip" }),
            };

            this.strip_prefix()(new Request(stream), new Response(compressedStream));
        });

        server.listen({ host, port }, (error) => {
            if (error) return reject(error);
            console.log(`Serving at https://${host}:${port}`);
            resolve();
        });
    })

    /**
     * @param {string} method_and_path
     * @param {(request:Request, response:Response) => void} fn
     */
    handleFunc = (method_and_path, fn) => {
        const [method, path] = method_and_path.split(" ");
        const parts = path.split("/").filter(Boolean);

        let root = this.#routes.get(method);
        if (!root) {
            root = { children: new Map() };
            this.#routes.set(method, root);
        }

        let node = root;
        if (node.handler) {
            console.trace(`Route "${method} ${path}" already has a handler`);
            process.exit(-1);
        }

        for (const part of parts) {
            if (part === "*") {
                node.wildcard ??= {};
                node = node.wildcard;
                break;
            } else if (part[0] === ":") {
                node.param ??= { paramName: part.slice(1) };
                node = node.param;
            } else {
                node.children ??= new Map();
                if (!node.children.has(part)) node.children.set(part, {});
                node = node.children.get(part);
            }
        }

        node.handler = fn;
        node.maxMiddlewareId = this.#mwCounter;   // snapshot!
    }

    /**
     * @param {string} path
     * @param {(request, response, next) => void | Promise<void>} fn
     */
    handle = (path, fn) => {
        const id = ++this.#mwCounter;
        const parts = path.split("/").filter(Boolean);

        let node = this.#middlewareTree;

        for (const p of parts) {
            if (!node.children.has(p)) node.children.set(p, { children: new Map(), stack: [] });
            node = node.children.get(p);
        }

        node.stack.push({ fn, id });
    };

    /**
     * @param {string} strip_prefix
     */
    strip_prefix = (strip_prefix = "") => {
        /**
         * @param {Request} request
         * @param {Response} response
         */
        return async (request, response) => {
            request.url = request.url.substring(0, strip_prefix.length) === strip_prefix ? request.url.substring(strip_prefix.length, request.url.length) : request.url;
            const match = this.#findRoute(request);
            if (await this.#runMiddleware(request, response, match?.maxMiddlewareId)) return;
            if (!match) return response.status(404).end("Not found");
            request.pathParams = match.params;
            match.handler(request, response);
        }
    }
}

export class Response {

    #headers = {}; // for HTTP2
    #status = 200;
    is_sent = false;
    #response;

    /**
     * @param {{ setHeader : (name:string, value:string) => void, write : (chunk:any) => void, end : (chunk:any) => void }} res
     */
    constructor(res) {
        this.#response = res;
    }

    /**
     * @param {string} name
     * @param {string} value
     */
    setHeader(name, value) {
        if (this.#response.respond) {
            this.#headers[name] = value;
            return this;
        }

        this.#response.setHeader(name, value);
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
        this.is_sent = true;
        (this.#response.respond) ? this.#response.respond({ ...this.#headers, ":status": this.#status }) : (this.#response.statusCode = this.#status);
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
        this.queryParams = new URLSearchParams(this.#request.url.split("?")[1]);
    }

    pathParams = new Map();

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
