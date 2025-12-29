
export class HttpMux {

    #is_serving = false;

    /** @typedef {{ children?: Map<string, Node>, param?: Node, paramName?: string, wildcard?: Node, handler?: Function, stack?: Function[] }} Node */
    /** @type {Map<string, Node>} */
    #routes = new Map();

    #mwCounter = 0;
    /** @type {{ children : Map<string, Node>, stack : Function[] }} */
    #middlewareTree = {            // prefix router
        children: new Map(),
        stack: []
    };


    #findRoute(req) {
        const parts = req.path.split("/").filter(Boolean);
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

    async #runMiddleware(req, maxId) {
        const parts = req.path.split("/").filter(Boolean);
        let node = this.#middlewareTree;

        for (const { fn, id } of node.stack) {
            if (maxId > -1 && id > maxId) continue;
            let value = fn(req);
            if (value instanceof Promise) value = await value;
            if (value === undefined) continue;
            if (value instanceof Response) return value;
            return new Response(value);
        }

        for (const part of parts) {
            if (!node.children.has(part)) break;
            node = node.children.get(part);

            for (const { fn, id } of node.stack) {
                if (maxId > -1 && id > maxId) continue
                let value = fn(req);
                if (value instanceof Promise) value = await value;
                if (value === undefined) continue;
                if (value instanceof Response) return value;
                return new Response(value);
            }
        }
    }

    constructor() { }

    /**
     * @param {{ port : number, hostname : string, key?: string, cert?: string }} options
     */
    serve = (options = {}) => {
        if (this.#is_serving) return console.error("Web server is already running");
        this.#is_serving = true;

        options = { hostname: "localhost", port: 3000, ...options, fetch: this.strip_prefix() };
        if (options.cert && options.key) [options.key, options.cert] = [Bun.file(options.key), Bun.file(options.cert)];

        const bunServer = Bun.serve(options);
        console.log(`Server running at ${bunServer.protocol}://${options.hostname === "0.0.0.0" ? "localhost" : options.hostname}${options.port === 443 || options.port === 80 ? '' : `:${options.port}`}`)
    }

    /**
     * @param {string} method_and_path
     * @param {(request:Request) => void} fn
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
                node = node.wildcard ??= {};
                break;
            } else if (part[0] === ":") {
                node = node.param ??= { paramName: part.slice(1) };
            } else {
                node.children ??= new Map();
                if (!node.children.has(part)) node.children.set(part, {});
                node = node.children.get(part);
            }
        }

        node.handler = fn;
        node.maxMiddlewareId = this.#mwCounter;
    }

    /**
     * @param {string} path
     * @param {(request) => void | Promise<void>} fn
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
         */
        return async (request) => {
            const path = request.url.split(request.headers.get("host"))[1].split("?")[0];
            request.path = path;
            const match = this.#findRoute(request);

            const middleware_value = await this.#runMiddleware(request, match?.maxMiddlewareId);
            if (middleware_value instanceof Response) return middleware_value;

            if (!match) return new Response("not found", { status: 404 });

            request.pathParams = match.params;
            return match.handler(request);
        }
    }
}
