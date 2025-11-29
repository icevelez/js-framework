import http from 'http';

export class HttpMux {

    /** @typedef {{ method : string, url : string, callback_fn : (request:any, response:any) => void, regex : RegExp, path_param_names : string[] }} Route */
    /** @type {({ type : 'route', data : Route } | { type : 'middleware', path : string, callback_fn : (request:any, response:any) => void | Promise<void> })[]} */
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
        const server = http.createServer(this.strip_prefix());
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
        const server = http.createServer({ key, cert }, this.strip_prefix());
        server.listen({ host, port }, (error) => {
            if (error) return reject(error);
            console.log(`Serving at https://${host}:${port}`);
            resolve();
        });
    })

    /**
     * @param {string} method_and_path
     * @param {(request:http.IncomingMessage, response:http.ServerResponse<http.IncomingMessage>) => void} callback_fn
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
     * @param {(request, response, next) => void | Promise<void>} middleware
     */
    handle = (path, callback_fn) => this.#routes.push({ type: 'middleware', path, callback_fn });

    /**
     * @param {string} strip_prefix
     */
    strip_prefix = (strip_prefix = "") => {
        /**
         * @param {http.IncomingMessage} request
         * @param {http.ServerResponse<http.IncomingMessage>} response
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
                    if (response.writableEnded) return;
                }
            }

            if (response.writableEnded) return;
            response.writeHead(404);
            response.end("Page Not found");
            return;
        }
    }
}
