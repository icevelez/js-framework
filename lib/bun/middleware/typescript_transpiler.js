import path from 'path';

const transpiler = new Bun.Transpiler({
  loader: 'ts',
});

const default_option = {
    headers: {
        "Content-Type": "application/javascript",
    }
};

/**
 * @param {string} dir
 * @param {{ useGzip : boolean }} options
 */
export function typescript_transpiler(dir, { useGzip } = { useGzip: false }) {
    const __dirname = path.join(process.cwd(), dir);

    /**
     * @param {Request} req
     */
    return async (req) => {
        if (req.method !== 'GET') return;

        const filePath = path.join(__dirname, req.path);
        if (!filePath.startsWith(__dirname)) return new Response("forbidden", { status: 403 });

        const file = Bun.file(filePath);
        if (!(await file.exists())) return;

        const extension = filePath.split(".").at(-1);
        const is_typescript = (file.type === "application/typescript" || (extension && extension === "ts"));
        if (!is_typescript) return;

        const text = await file.text();
        const result = transpiler.transformSync(text);
        if (!useGzip) return new Response(result, default_option);
        return (await gzipResponse(result, default_option.headers, req)) || new Response(result, default_option);
    }
}

/**
 * @param {string} content
 * @param {Headers} headers
 * @param {Request} req
 */
async function gzipResponse(content, headers, req) {
    // Only gzip if client supports it
    const accept = req.headers.get("accept-encoding") || "";
    if (!accept.includes("gzip")) return;

    // small bodies aren't worth gzipping
    if (content.length < 512) return;

    const gzipped = Bun.gzipSync(content);

    return new Response(gzipped, {
        headers: {
            ...headers,
            "Content-Encoding": "gzip",
            "Content-Length": String(gzipped.byteLength),
            "Vary": "Accept-Encoding"
        },
    });
}
