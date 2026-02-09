import path from 'path';

const context = new Map();

export function getContext(key) {
    return context.get(key);
}

export function setContext(key, value) {
    context.set(key, value);
}

export function removeContext(key) {
    context.delete(key);
}

/**
 * @param {string} view_dir
 * @param {{ useGzip : boolean }} options
 */
export function nunchucks(view_dir, options = { useGzip: false }) {
    const __dirname = path.join(process.cwd(), view_dir);
    /** @type {Map<string, any>} */
    const hbsCache = new Map();
    const encoder = new TextEncoder();

    /**
     * @param {Request} req
     */
    return async (req) => {
        const filePath = path.join(__dirname, (req.path === '/') ? 'index.html' : req.path);
        if (!filePath.startsWith(__dirname)) return new Response("forbidden", { status: 403 });

        try {
            if (!hbsCache.has(filePath)) {
                const pathSplit = filePath.split(".");

                const is_html = pathSplit.at(-1) === "html";
                if (!is_html) return;

                const file_path = `${pathSplit.slice(0, pathSplit.length - 1).join(".")}.html`;
                const file = Bun.file(file_path);
                const file_exists = await file.exists();
                if (!file_exists) return;

                const text = await file.text();
                let { html, script } = extractServerScripts(text);
                const expression_blocks = parser(html);

                const random = Math.random().toString(36).substring(5); // prevent file collision
                const code_file_path = `${file_path}.${random}.js`;

                let default_fn = null;

                if (script) {
                    await Bun.write(code_file_path, new Blob([script]))
                    try {
                        const script_module = await import(code_file_path);
                        default_fn = script_module?.default;
                    } catch (error) {
                        console.error(error);
                    } finally {
                        Bun.file(code_file_path).delete(); // trigger a server re-run if under --watch
                    }
                }

                hbsCache.set(filePath, { html, expression_blocks, default_fn })
            }

            let { html, expression_blocks, default_fn } = hbsCache.get(filePath);

            let data = typeof default_fn === "function" ? default_fn(req) : default_fn;
            if (data instanceof Promise) data = await data;
            if (data instanceof Response) return data;
            if (data) {
                for (let i = 0; i < expression_blocks.length; i++) {
                    let rendered_block = "";

                    const block = expression_blocks[i];
                    const payload = block.payload;

                    if (block.name === "if") {
                        for (let i = 0; i < payload.exprs.length; i++) {
                            if (payload.exprs[i](data, process) === true) {
                                rendered_block += evaluate_handlebar_expression(payload.htmls[i], data);
                                break;
                            }
                        }
                    } else if (block.name === "each") {
                        const arr = payload.expr(data, process);
                        let count = 0;

                        for (const ar of arr) {
                            if (payload.keys.length > 0) {
                                for (const key of payload.keys) data[key] = ar[key];
                            } else {
                                data[payload.key] = ar;
                            }
                            rendered_block += evaluate_handlebar_expression(payload.html, data);
                            count++;
                        }

                        if (payload.keys.length > 0) {
                            for (const key of payload.keys) delete data[key];
                        } else {
                            delete data[payload.key];
                        }
                    }
                    html = html.slice(0, block.start) + rendered_block + html.slice(block.end);
                }

                html = evaluate_handlebar_expression(html, data);
            }

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

const evaluated_expression_cache = new Map();

// code by chatGPT, don't ask me how it works, its purpose is to extract JS code from <script runat="server"></script> blocks
function evaluate_handlebar_expression(html, data) {
    let rendered_html = "";

    if (!evaluated_expression_cache.has(html)) {
        const split_html = html.split(/({%[\s\S]*?%})/g);
        const fns = [];

        for (let i = 0; i < split_html.length; i++) {
            const html = split_html[i];
            if (html.charAt(2) === "#" || html.charAt(2) === "/") continue;
            if (html.charAt(0) === "{" && html.charAt(1) === "%") {
                const fn = new Function('data', 'process', `return ${html.slice(2, html.length - 2)}`)
                fns[i] = fn;
            }
        }

        evaluated_expression_cache.set(html, { split_html, fns })
    }

    const { split_html, fns } = evaluated_expression_cache.get(html);
    for (let i = 0; i < split_html.length; i++) rendered_html += fns[i] ? fns[i](data, process) : split_html[i];

    return rendered_html;
}

function parser(source) {
    const blockPattern = /{%#(await|if|each)(\b[^}]*)?%}|{%\/(await|if|each)%}/g, stack = [], blocks = [];
    let match;

    while ((match = blockPattern.exec(source))) {
        const [full, openName, , closeName] = match;
        if (openName) {
            stack.push({ name: openName, start: match.index, end: null, outer: '', payload: {} });
        } else if (closeName) {
            const last = stack.pop();
            if (!last || last.name !== closeName) throw new Error(`Unbalanced block: expected {%/${last?.name}%} but found {%/${closeName}%}`);
            last.end = match.index + full.length;
            last.outer = source.slice(last.start, last.end);
            blocks.push(last);
        }
    }

    blocks.sort((a, b) => b.start - a.start);

    for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        if (!parse[block.name]) throw new Error(`unknown syntax {%$${block.name}%}`);
        block.payload = parse[block.name](block.outer);
    }

    return blocks;
}

const RE = {
    each: /{%\s*#each\s+(.+?)\s+as\s+((?:\w+|\{[\s\S]*?\}|\([\s\S]*?\)))\s*(?:,\s*(\w+))?\s*%}([\s\S]*?){%\s*\/each\s*%}/g,
    if: /{%\s*#if\s+(.+?)\s*%}([\s\S]*?){%\s*\/if\s*%}/g,
    else: /{%\s*:else\s+if\s+(.+?)\s*%}|{%\s*:else\s*%}/g,
};

const parse = {
    if: function (block) {
        RE.if.lastIndex = RE.else.lastIndex = 0;
        const match = RE.if.exec(block);
        if (!match) throw new Error("parsing error on \"if\" block");

        const [, firstCond, firstBody] = match, exprs = [], htmls = [];
        let lastCond = firstCond, lastIndex = 0, m;

        while ((m = RE.else.exec(firstBody))) {
            if (m.index > lastIndex) {
                exprs.push(new Function('data', 'process', `return ${lastCond}`));
                htmls.push(firstBody.slice(lastIndex, m.index))
            }
            if (m[0].startsWith("{%:else if")) {
                lastCond = m[1];
                lastIndex = m.index + m[0].length;
            } else {
                exprs.push(() => true);
                htmls.push(firstBody.slice(m.index + m[0].length))
                lastIndex = firstBody.length;
                break;
            }
        }

        if (lastIndex < firstBody.length) {
            exprs.push(new Function('data', 'process', `return ${lastCond}`));
            htmls.push(firstBody.slice(lastIndex))
        }

        return { htmls, exprs };
    },
    each: function (block) {
        RE.each.lastIndex = 0;
        const match = RE.each.exec(block);
        if (!match) throw new Error("parsing error on \"each\" block")

        const [, expr, blockVar, indexVar, content] = match,
            parts = content.split(/{%:empty%}/),
            trimmedVar = blockVar.trim();

        return {
            expr: new Function('data', 'process', `return ${expr.trim()}`),
            html: parts[0] ? parts[0] : undefined,
            empty_html: parts[1] ? parts[1] : undefined,
            key: trimmedVar,
            keys: trimmedVar.startsWith("{") || trimmedVar.startsWith("[") ? trimmedVar.slice(1, -1).split(",").map(v => v.trim()) : [],
            index_key: indexVar?.trim() || "",
        };
    },
}

function extractServerScripts(html) {
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
