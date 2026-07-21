import path from 'path';

/**
 * @param {string} view_dir
 * @param {{ useGzip : boolean }} options
 */
export function core_server(view_dir, options = { useGzip: false }) {
    const __dirname = path.join(process.cwd(), view_dir);
    /** @type {Map<string, any>} */
    const core_cache = new Map();
    const encoder = new TextEncoder();

    /**
     * @param {Request} req
     */
    return async (req) => {
        const filePath = path.join(__dirname, (req.path === '/') ? 'index.html' : req.path);
        if (!filePath.startsWith(__dirname)) return new Response("forbidden", { status: 403 });

        try {
            if (!core_cache.has(filePath)) {
                const pathSplit = filePath.split(".");

                const is_html = pathSplit.at(-1) === "html";
                if (!is_html) return;

                const file_path = `${pathSplit.slice(0, pathSplit.length - 1).join(".")}.html`;
                const file = Bun.file(file_path);
                const file_exists = await file.exists();
                if (!file_exists) return;

                const text = await file.text();
                const { html, script } = extract_server_scripts(text);

                let default_fn = null;

                if (script) {
                    try {
                        const url = URL.createObjectURL(new Blob([script]));
                        const script_module = await import(url);
                        default_fn = script_module?.load;
                    } catch (error) {
                        console.error(error);
                    }
                }

                core_cache.set(filePath, { html, default_fn })
            }

            let { html, default_fn } = core_cache.get(filePath);

            let data = typeof default_fn === "function" ? default_fn(req) : default_fn;
            if (data instanceof Promise) data = await data;
            if (data instanceof Response) return data;
            if (data) html = replace_top_level_load(html, data);

            if (!options.useGzip) return new Response(html, { headers: { "content-type": "text/html" } });
            const buffer = encoder.encode(html);
            if (buffer.byteLength < 512) new Response(html, { headers: { "content-type": "text/html" } });

            const gzipped = Bun.gzipSync(new Uint8Array(buffer));
            return new Response(gzipped, {
                headers: {
                    "content-type": "text/html",
                    "Content-Encoding": "gzip",
                    "Content-Length": String(gzipped.byteLength),
                    "Vary": "Accept-Encoding"
                }
            });
        } catch (error) {
            console.error(error);
            return new Response(error.toString(), { status: 400 });
        }
    }
}

// code by chatGPT, don't ask me how it works, its purpose is to find the top level `const load = $load()` in a top level `<script>` tag
function replace_top_level_load(html, data) {
    let pos = 0;

    while (true) {
        const start = html.indexOf("<script", pos);
        if (start === -1) return html;

        const tagEnd = html.indexOf(">", start);
        if (tagEnd === -1) return html;

        let i = tagEnd + 1;

        let quote = null;
        let escaped = false;

        while (i < html.length) {
            const ch = html[i];

            if (quote) {
                if (escaped) {
                    escaped = false;
                } else if (ch === "\\") {
                    escaped = true;
                } else if (ch === quote) {
                    quote = null;
                }

                i++;
                continue;
            }

            if (ch === "'" || ch === '"' || ch === "`") {
                quote = ch;
                i++;
                continue;
            }

            if (html.startsWith("</script>", i)) {
                const scriptContent = html.slice(tagEnd + 1, i);

                const replaced = scriptContent.replace(
                    /\bconst\s+load\s*=\s*\$load\s*\(\s*\)/,
                    `const load = ${JSON.stringify(data)}`
                );

                return (
                    html.slice(0, tagEnd + 1) +
                    replaced +
                    html.slice(i)
                );
            }

            i++;
        }

        pos = tagEnd + 1;
    }
}

function extract_server_scripts(html) {
    let i = 0;
    const scripts = [];
    let output = "";

    while (i < html.length) {
        const openIndex = html.indexOf("<script", i);

        if (openIndex === -1) {
            output += html.slice(i);
            break;
        }

        // Add everything before this <script>
        output += html.slice(i, openIndex);

        const tagEnd = html.indexOf(">", openIndex);
        if (tagEnd === -1) break;

        const tagContent = html.slice(openIndex, tagEnd + 1);
        const isServerScript = /runat\s*=\s*["']server["']/i.test(tagContent);

        if (!isServerScript) {
            // Not ours → keep as normal HTML
            output += tagContent;
            i = tagEnd + 1;
            continue;
        }

        // 🔥 Parse JS content safely
        let jsStart = tagEnd + 1;
        let pos = jsStart;

        let inSingle = false;
        let inDouble = false;
        let inTemplate = false;
        let inLineComment = false;
        let inBlockComment = false;
        let escape = false;

        while (pos < html.length) {
            const char = html[pos];
            const next = html[pos + 1];

            // Handle escaping inside strings
            if (escape) {
                escape = false;
                pos++;
                continue;
            }

            if (char === "\\" && (inSingle || inDouble || inTemplate)) {
                escape = true;
                pos++;
                continue;
            }

            // Line comment
            if (!inSingle && !inDouble && !inTemplate && !inBlockComment && char === "/" && next === "/") {
                inLineComment = true;
                pos += 2;
                continue;
            }
            if (inLineComment && char === "\n") {
                inLineComment = false;
                pos++;
                continue;
            }

            // Block comment
            if (!inSingle && !inDouble && !inTemplate && !inLineComment && char === "/" && next === "*") {
                inBlockComment = true;
                pos += 2;
                continue;
            }
            if (inBlockComment && char === "*" && next === "/") {
                inBlockComment = false;
                pos += 2;
                continue;
            }

            if (inLineComment || inBlockComment) {
                pos++;
                continue;
            }

            // Strings
            if (!inDouble && !inTemplate && char === "'") inSingle = !inSingle;
            else if (!inSingle && !inTemplate && char === '"') inDouble = !inDouble;
            else if (!inSingle && !inDouble && char === "`") inTemplate = !inTemplate;

            // Detect closing </script> only if NOT inside anything
            if (!inSingle && !inDouble && !inTemplate) {
                if (html.startsWith("</script>", pos)) {
                    const jsCode = html.slice(jsStart, pos);
                    scripts.push(jsCode.trim());
                    pos += 9; // length of </script>
                    i = pos;
                    break;
                }
            }

            pos++;
        }
    }

    return { html: output, script: scripts[0] };
}
