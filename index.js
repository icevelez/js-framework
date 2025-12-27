import { Pool } from "pg";
import { HttpMux } from "./lib/http.js";
import { createAuth } from "./lib/auth.js";
import { serve } from "./middleware/serve.js";
import { remoteFunction } from "./middleware/remote.js";
import Remote from "./remote_api.js";

const database = new Pool({
    host: 'localhost',
    user: 'pg',
    password: 'pg'
});

const auth = createAuth((request, response) => {
    const auth_key = request.headers['x-auth'] || "";
    if (auth_key) return `${request.headers['x-auth']}`;
    response.writeHead(401);
    response.end("unauthorized");
    return "";
})

const remote_functions = new Remote(database, auth.context);

const rpcMux = new HttpMux();
rpcMux.handle("/api/remote", auth.middleware);
rpcMux.handle("/api/remote", remoteFunction(remote_functions, { max_request_size_in_mb: 1 }));

const mux = new HttpMux();
mux.handle("/", serve('public'));
mux.handle("/", rpcMux.strip_prefix());

mux.serve(3001)
mux.serveTLS("ssl/default.key", "ssl/default.cert", 3000);
