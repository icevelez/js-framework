import { HttpMux } from "./lib/http.js";
import { serve } from "./middleware/serve.js";
import { remoteFunction } from "./middleware/remote.js";
import { remote_functions } from "./remote_api.js";

const mux = new HttpMux();
mux.handle("/", serve('public'));
mux.handle("/api/remote", remoteFunction(remote_functions));
mux.serve(3000);
