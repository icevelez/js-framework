import Busboy from 'busboy';

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

        if (req.headers['content-type'].startsWith("text/plain")) {
            let body = '';
            for await (const chunk of req) body += chunk;
            let response = func(req, body);
            if (response instanceof Promise) response = await response;
            res.setHeader('Type', typeof response === "object" ? "json" : "text")
            res.setHeader('Content-type', typeof response === "object" ? "application/json" : "plain/text");
            res.end(typeof response === "object" ? JSON.stringify(response) : response);
            return;
        }

        let resolve;
        const busboy = Busboy({ headers: req.headers });
        const fields = {};

        busboy.on('field', (name, value) => fields[name] = value);
        busboy.on('file', (name, file) => {
            const chunks = [];
            file.on('data', (chunk) => chunks.push(chunk));
            file.on('end', () => fields[name] = new Blob([Buffer.concat(chunks)]));
        });
        busboy.on('finish', async () => {
            try {
                let response = func(req, fields);
                if (response instanceof Promise) response = await response;
                res.setHeader('Type', typeof response === "object" ? "json" : "text")
                res.setHeader('Content-type', typeof response === "object" ? "application/json" : "plain/text");
                res.end(typeof response === "object" ? JSON.stringify(response) : response);
                return resolve();
            } catch (error) {
                res.writeHead(500);
                res.end(error);
                return resolve();
            }
        });

        req.pipe(busboy);
        return new Promise((r) => resolve = r);
    }
}
