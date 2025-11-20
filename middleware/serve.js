import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.join(path.dirname(__filename), "/../");

/**
 * @param {string} dir
 */
export function serve(dir) {
    /**
     * @param {http.IncomingMessage} req
     * @param {http.ServerResponse<http.IncomingMessage>} res
     */
    return async (req, res) => {
        if (req.method !== 'GET') return;

        const url = req.url.split("?")[0];
        let filePath = path.join(__dirname, "/", dir, (url === '/') ? 'index.html' : url);

        if (!filePath.startsWith(__dirname)) {
            res.writeHead(403);
            res.end("Forbidden");
            return;
        }

        try {
            const file = await fs.readFile(filePath);
            const ext = path.extname(filePath).toLowerCase();
            const contentTypes = {
                '.html': 'text/html',
                '.css': 'text/css',
                '.js': 'text/javascript',
                '.json': 'application/json',
                '.png': 'image/png',
                '.jpg': 'image/jpeg',
                '.svg': 'image/svg+xml',
                '.txt': 'text/plain'
            };

            res.writeHead(200, {
                'Content-Type': contentTypes[ext] ?? 'application/octet-stream'
            });
            res.end(file);
        } catch (error) {
            // ignore non-existent files
            // console.error(error);
            return;
        }
    }
}
