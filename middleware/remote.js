/**
 * @param {{ [key:string] : (req:http.IncomingMessage, body:any }} remote_fns
 */
export function remoteFunction(remote_fns) {
    /**
     * @param {http.IncomingMessage} req
     * @param {http.ServerResponse<http.IncomingMessage>} res
     */
    return async (req, res) => {
        if (req.method !== 'POST') return;

        const func_name = req.headers['x-func-name'];
        const func = func_name ? remote_fns[func_name] : null;
        if (!func_name || !func) {
            res.writeHead(404);
            res.end(`Function "${func_name}" not found`);
            return;
        }

        const contentType = req.headers["content-type"] || "";

        if (contentType.startsWith("text/plain")) {
            let body = '';
            for await (const chunk of req) body += chunk;
            let response = func(req, body);
            if (response instanceof Promise) response = await response;
            res.setHeader('Type', typeof response === "object" ? "json" : "text")
            res.setHeader('Content-type', typeof response === "object" ? "application/json" : "plain/text");
            res.end(typeof response === "object" ? JSON.stringify(response) : response);
            return;
        }

        if (!contentType.startsWith("multipart/form-data")) {
            res.writeHead(400);
            res.end("Content-type must be \"multipart/form-data\"");
            return;
        }

        const boundary = contentType.split("boundary=")[1];
        if (!boundary) {
            res.writeHead(400);
            res.end("Missing boundary");
            return;
        }

        try {
            const fields = await parseMultipart(req, boundary);
            let response = func(req, fields);
            if (response instanceof Promise) response = await response;
            res.setHeader('Type', typeof response === "object" ? "json" : "text")
            res.setHeader('Content-type', typeof response === "object" ? "application/json" : "plain/text");
            res.end(typeof response === "object" ? JSON.stringify(response) : response);
        } catch (error) {
            res.statusCode = 500;
            res.end(error.toString());
            return;
        }
    }
}

/**
 * Streaming multipart parser
 * @param {Readable} stream
 * @param {string} boundary
 */
export function parseMultipart(stream, boundary) {
    return new Promise((resolve, reject) => {
        const dashBoundary = "--" + boundary;
        const boundaryBuffer = Buffer.from(dashBoundary);
        const endBoundaryBuffer = Buffer.from(dashBoundary + "--");
        const fields = {};

        console.log(dashBoundary);

        let buffer = Buffer.alloc(0);
        let state = "SEARCH_PART"; // SEARCH_PART → HEADERS → BODY
        let headers = "";
        let current = {
            name: null,
            filename: null,
            data: []
        };

        function parseHeaders(headerText) {
            const out = {};
            headerText.split("\r\n").forEach(line => {
                const idx = line.indexOf(":");
                if (idx === -1) return;
                const key = line.slice(0, idx).toLowerCase();
                const val = line.slice(idx + 1).trim();
                out[key] = val;
            });
            return out;
        }

        // Given headers, extract form info
        function setupPart(headers) {
            const disp = headers["content-disposition"];
            if (!disp) return;

            const name = /name="([^"]+)"/.exec(disp)?.[1];
            const filename = /filename="([^"]*)"/.exec(disp)?.[1] || null;

            current = { name, filename, data: [] };
        }

        function finishPart() {
            if (!current.name) return;

            const data = Buffer.concat(current.data);

            if (current.filename) {
                fields[current.name] = current.filename === "blob" ? new Blob([data]) : new File([data], current.filename);
            } else {
                fields[current.name] = data.toString("utf8");
            }
        }

        stream.on("data", chunk => {
            buffer = Buffer.concat([buffer, chunk]);

            let boundaryIndex;

            while (true) {
                if (state === "SEARCH_PART") {
                    boundaryIndex = buffer.indexOf(boundaryBuffer);
                    if (boundaryIndex === -1) {
                        // Boundary not found yet, wait for more data
                        return;
                    }
                    // Remove up to boundary + CRLF
                    buffer = buffer.subarray(boundaryIndex + boundaryBuffer.length);
                    if (buffer.subarray(0, 2).toString() === "--") {
                        // End
                        resolve(fields);
                        return;
                    }
                    if (buffer.subarray(0, 2).toString() === "\r\n") {
                        buffer = buffer.subarray(2);
                    }
                    headers = "";
                    state = "HEADERS";
                }

                if (state === "HEADERS") {
                    const headerEnd = buffer.indexOf("\r\n\r\n");
                    if (headerEnd === -1) {
                        return; // need more data
                    }

                    headers = buffer.subarray(0, headerEnd).toString();
                    buffer = buffer.subarray(headerEnd + 4);

                    const headerObj = parseHeaders(headers);
                    setupPart(headerObj);
                    state = "BODY";
                }

                if (state === "BODY") {
                    // Look for the next boundary
                    const nextBoundaryPos = buffer.indexOf("\r\n" + dashBoundary);

                    if (nextBoundaryPos === -1) {
                        // all buffer is body data for now
                        current.data.push(buffer);
                        buffer = Buffer.alloc(0);
                        return;
                    }

                    // Body until boundary
                    const bodyChunk = buffer.subarray(0, nextBoundaryPos);
                    current.data.push(bodyChunk);

                    finishPart();

                    // Move buffer after boundary
                    buffer = buffer.subarray(nextBoundaryPos + 2); // skip leading CRLF

                    // Detect -- at end
                    if (buffer.indexOf(endBoundaryBuffer) === 0) {
                        resolve(fields);
                        return;
                    }

                    // Skip boundary + CRLF
                    buffer = buffer.subarray(boundaryBuffer.length);
                    if (buffer.subarray(0, 2).toString() === "\r\n")
                        buffer = buffer.subarray(2);

                    state = "HEADERS";
                }
            }
        });

        stream.on("end", () => {
            resolve(fields);
        });

        stream.on("error", reject);
    });
}
