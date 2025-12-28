import { DatabaseSync } from "node:sqlite";
import { HttpMux } from "./lib/http.js";
import { createContext } from "./lib/context.js";
import { serve } from "./middleware/serve.js";
import { remoteFunction } from "./middleware/remote.js";
import Remote from "./remote_api.js";

const database = new DatabaseSync(":memory:");

const [authContextMiddle, getAuthContext] = createContext((request, response) => {
    const auth_key = request.headers['x-auth'] || "";
    if (auth_key) return `${request.headers['x-auth']}`;
    response.writeHead(401);
    response.end("unauthorized");
    return "";
})

const remote_functions = new Remote(database, getAuthContext);

const rpcMux = new HttpMux();
rpcMux.handle("/api/remote", authContextMiddle);
rpcMux.handle("/api/remote", remoteFunction(remote_functions, { max_request_size_in_mb: 1 }));

const mux = new HttpMux();
mux.handleFunc("GET /i/:hello", (req, res) => {
    res.end("HEX")
})
mux.handle("/", serve('public'));
mux.handle("/", rpcMux.strip_prefix());
mux.serveTLS("ssl/default.key", "ssl/default.cert", 3000);
