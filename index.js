import { HttpMux } from "./lib/http.js";
import { serve } from "./middleware/serve.js";
import { remoteFunction, remoteInstance } from "./middleware/remote.js";

const remote_functions = remoteInstance({
    greetings: (body, file) => {
        console.log(body, file);
        return { message: `Hello from server "${body.age} ${body.name}"`, date: new Date() };
    },
    console_log: (body) => {
        console.log(body);
        return null;
    },
    add_numbers: (a, b) => {
        console.log(a, b, a + b);
        return a + b;
    }
});

const mux = new HttpMux();
mux.handle("/", serve('public'));
mux.handle("/api/remote", remoteFunction(remote_functions));
mux.serve(3000);
