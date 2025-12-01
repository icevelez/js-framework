import { HttpMux } from "./lib/http.js";
import { serve } from "./middleware/serve.js";
import { remoteFunction } from "./middleware/remote.js";

const remote_functions = {};

remote_functions.greetings = function (req, body) {
    console.log(body);
    return { message: `Hello from server "${body.age} ${body.name}" url "${req.url}"`, date: new Date() };
}

const apiMux = new HttpMux();

apiMux.handleFunc('GET /lol', (request, response) => {
    response.end("Hello from api endpoint" + request.url);
})

const mux = new HttpMux();

mux.handleFunc('GET /h', (request, response) => {
    response.end("Hello from server " + request.url);
})

mux.handle("/", serve('public'));
mux.handle("/api/remote", remoteFunction(remote_functions));
mux.handle("/api/v1/", apiMux.strip_prefix("/api/v1"));

mux.serve(3000);
