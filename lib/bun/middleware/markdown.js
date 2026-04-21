import { marked } from "./dep/marked.v18.0.2.esm.js";
import path from 'path';

export const context = new Map();

/**
 * @param {string} view_dir
 * @param {{ useGzip : boolean }} options
 */
export function markdown(view_dir, options = { useGzip: false }) {
    const __dirname = path.join(process.cwd(), view_dir);
    /** @type {Map<string, string>} */
    const mdCache = new Map();

    /**
     * @param {Request} req
     */
    return async (req) => {
        const filePath = path.join(__dirname, (req.path === '/') ? 'index.html' : req.path);
        if (!filePath.startsWith(__dirname)) return new Response("forbidden", { status: 403 });

        const pathSplit = filePath.split(".");
        const is_html = pathSplit.at(-1) === "html";
        if (!is_html) return;

        const dirSplit = filePath.split("/");

        const layout_path = `${dirSplit.slice(0, dirSplit.length - 1).join("/")}/+layout.html`;
        const md_path = `${pathSplit.slice(0, pathSplit.length - 1).join(".")}.md`;

        const md_file = Bun.file(md_path);
        const layout_file = Bun.file(layout_path);
        let files_exist = await Promise.all([layout_file.exists(), md_file.exists()]);
        if (!files_exist[0] || !files_exist[1]) return;

        const md_text = await md_file.text();
        const [_, md_header, md_body] = md_text.split(/\+\+\+\s*([\s\S]*?)\s*\+\+\+/);

        const parsed_md = marked.parse(md_body);
        const text = await layout_file.text();

        const html = evaluate_handlebar_expression(text, {
            ...parseEnv(md_header),
            content : parsed_md,
        });

        console.log(html);

        return new Response(html, { headers: { "content-type": "text/html" } });
    }
}

const evaluated_expression_cache = new Map();

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

function parseEnv(content) {
  const result = {};
  const lines = content.split(/\r?\n/);
  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();

    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      const quote = val[0];
      val = val.slice(1, -1).replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t').replace(new RegExp(`\\\\${quote}`, 'g'), quote);
    } else {
      // unquoted: remove inline comments after a space or tab
      const commentIndex = val.search(/\s+#/);
      if (commentIndex !== -1) val = val.slice(0, commentIndex).trim();
    }

    // Handle exported vars like: export KEY=val
    if (key.startsWith('export ')) {
      const k = key.slice(7).trim();
      result[k] = val;
    } else {
      result[key] = val;
    }
  }
  return result;
}
