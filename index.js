import { SQL } from "bun";
import { HttpMux } from "./lib/http.bun.js";
import { createContext } from "./lib/bun/middleware/context.js";
import { serve } from "./lib/bun/middleware/serve.js";
import { remoteFunction, remoteGetRequest, remoteSetHeaders } from "./lib/bun/middleware/remote.js";
import { logger } from "./lib/bun/middleware/logger.js";

import RemoteAuth from "./remote/auth.js";
import RemoteExample from "./remote/example.js";
import ServerSentEventHandler from "./remote/sse.js";
import { nunchucks } from "./lib/bun/middleware/nunchucks.js";

const database = "FAKE";

/** @type {Map<string, { user:{ id:number, username:string, admin:boolean }, expiry:Date }>} */
const in_memory_session = new Map();

const max_request_size_in_mb = 1;
const megabytes = 1024 * 1024;

const [authContextMiddleware, getAuthContext] = createContext(async (request) => {
    const session_id = request.cookies.get("session_id");
    if (!session_id) return;

    const session = in_memory_session.get(session_id);
    if (!session) return;

    return session.user;
})

const sse_heart_beat_interval = 8_000;
const [sse_func, sse_notify] = ServerSentEventHandler(() => getAuthContext() && getAuthContext().add, sse_heart_beat_interval);

const remote_example = new RemoteExample(database, getAuthContext, sse_notify);
const remote_auth = new RemoteAuth(database, remoteGetRequest, remoteSetHeaders, in_memory_session);

const rpcMux = new HttpMux();
rpcMux.handleFunc("POST /auth", remoteFunction(remote_auth));
rpcMux.handle("/api/", authContextMiddleware);
rpcMux.handleFunc("POST /api/example", remoteFunction(remote_example));
rpcMux.handleFunc("GET /api/sse", sse_func);

const mux = new HttpMux();
mux.handle("/", logger());
mux.handle("/", nunchucks("public", { useGzip: true }));
mux.handle("/", serve("public", { useGzip: true }));
mux.handle("/remote/", rpcMux.strip_prefix("/remote"));

mux.serve({
    hostname: "0.0.0.0",
    port: 3000,
    key: "ssl/default.key",
    cert: "ssl/default.cert",
    maxRequestBodySize: max_request_size_in_mb * megabytes
});
