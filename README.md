# A Fullstack JS Framework?

Originally this project was focus on implementing a verson of SvelteKit's remote function using plain JS - that's it. 

It just so happens there are also other libraries in this project like wrapping Node's HTTP module and adding middleware support to serve static content and logging (that piece of code had no name until now) to moving to Bun's HTTP module then adding template engine middleware like handlebar and changing it to nunchucks to prevent conflict with another project of mine called Core.js as it primarily uses handlebar to parse templates on the browser

## How to Run 

### Prerequisite

You must have [Bun](https://bun.sh) installed

1. Clone this repository
2. Open terminal and run `bun run start`

## Bun.HTTP 

A web framework wrapper to extend the capabilities of Bun.serve inspired from Go's HTTP standard library

### Usage

```js
import { HttpMux } from "./lib/http.bun.js";
import { logger } from "./lib/bun/middleware/logger.js";

const mux = new HttpMux();

mux.handle("/", logger());      // middleware for logging requests
mux.handleFunc("GET /", (request) => {
    return new Response("Hello World");
});

mux.serve({
    port : 3000,
    hostname : "0.0.0.0",       // hostname by default is "localhost", use "0.0.0.0" to listen to all network interface
});
```

## mRPC 

mRPC (Multipart RPC) - A library and middleware for seamless communication between the front-end and back-end, with an option to have type annotations using JSDoc

### Usage
`remote_example.js`
```js
export default class {
    
    constructor() {}
    
    add_number = (a, b) => {
        return a + b;
    }
}
```

`index.js`
```js
import { HttpMux } from "./lib/http.bun.js";
import { remoteFunction } from "./lib/bun/middleware/remote.js";
import { serve } from "./lib/bun/middleware/serve.js";

import ExampleRemote from "./remote_example.js";

const example_remote = new ExampleRemote();
const mux = new HttpMux();

mux.handle("/", serve("public", { useGzip: true }));            // middleware for serving static files    
mux.handleFunc("POST /remote", remoteFunction(example_remote));

mux.serve({ port : 3000 });
```

`script.js` (browser)
```js
import { connectRemote } from "./remote.js";

/** @import ExampleRemote from '../remote_example.js' */
/** @type {ExampleRemote} */
const REMOTE = connectRemote("/remote");

const result = await REMOTE.add_number(4, 20); 
console.log(result);        // 24;
```

## Nunchucks 

Nunchucks - A templating engine middleware for generating HTML on the server

### Usage
`index.js`
```js
import { HttpMux } from "./lib/http.bun.js";

const mux = new HttpMux();
mux.handle("/", nunchucks("public", { useGzip: true }));        // useGzip to enabled Gzip compression
mux.serve({ port : 3000 });
```

`index.html`
```html
<script runat="server"> // The code inside this script tag is run on the server 
    console.log("Log once upon first request");

    export default function(request) {
        console.log("Log per request");

        return {
            name : request.searchparams.get("name") || "No Name"
        }
    }
</script>
<html>
    <head>
        <title>Server Rendered Test Page</title>
    </head>
    <body>
        <h1>Hello Welcome! {% data.name %}</h1>
        {%#if data.name === "John"%}
            <h1>Hi John!</h1>
        {%/if%}
        <h2>List of number</h2>
        <ul>
            {%#each [1,2,3,4,5] as number%}
                <li>data.number</li>
            {%/each%}
        </ul>
        <p>use the search param to add name like "?name=your_name"</p>
    </body>
</html>
```
