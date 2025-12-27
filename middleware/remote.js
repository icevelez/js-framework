/** @import { Request, Response } from '../lib/http' */

import { randomUUID } from 'crypto';

const byte_to_megabyte = (byte) => byte * 1024 * 1024;

/**
 * @param {{ [key:string] : () => Promise<any> }} remote_fns
 * @param {{ max_request_size_in_mb : number, max_field_size_in_mb : number }} config
 */
export function remoteFunction(remote_fns, config) {
    /**
     * @param {Request} req
     * @param {Response} res
     */
    return async (req, res) => {
        if (req.method !== 'POST') return;

        const contentType = req.headers["content-type"] || "";
        if (!contentType.startsWith("multipart/form-data")) return res.status(400).end("Content-type must be \"multipart/form-data\"");

        const boundary = contentType.split("boundary=")[1];
        if (!boundary) return res.status(400).end("Missing boundary");

        const func_param_data_types = JSON.parse(req.headers['x-func-param-datatypes']);
        if (!Array.isArray(func_param_data_types)) return res.status(400).end(`Function parameter data types invalid`);

        const func_name = req.headers['x-func-name'];
        const func = func_name ? remote_fns[func_name] : null;
        if (!func_name || !func) return res.status(404).end(`Function "${func_name}" not found`);

        try {
            const fields = await parseMultipart(req, boundary, func_param_data_types, byte_to_megabyte(config?.max_request_size_in_mb || 0), byte_to_megabyte(config?.max_field_size_in_mb || 0));
            let response = func(...fields);
            if (response instanceof Promise) response = await response;

            const formData = new FormData();
            const encoded_response = response && typeof response === "object" ? encode(response, formData) : response;

            if (encoded_blobs_idx > 0) {
                encoded_blobs_idx = 0;
                formData.append(0, encoded_response);
                return writeFormDataResponse(res, formData);
            }

            res.setHeader('Data-Type', response ? typeof response : "text");
            res.setHeader('Content-type', response instanceof File || response instanceof Blob ? "application/octet-stream" : typeof response === "object" ? "application/json" : "plain/text")
            res.end(encoded_response);
        } catch (error) {
            res.status(500).end(error.toString());
            return;
        }
    }
}

/**
 * Streaming multipart parser
 * @param {Request} stream
 * @param {string} boundary
 * @param {string[]} func_param_data_types
 * @param {number} max_request_size
 * @param {number} max_body_size
 */
export function parseMultipart(stream, boundary, func_param_data_types, max_request_size, max_body_size) {
    return new Promise((resolve, reject) => {
        const dashBoundary = Buffer.from("--" + boundary);
        const dashBoundaryEnd = Buffer.from("--" + boundary + "--");
        const headerEndSeq = Buffer.from("\r\n\r\n");
        const fields = [];

        let buffer = Buffer.allocUnsafe(64 * 1024);
        let bufferLen = 0;
        let state = 0; // 0 SEARCH, 1 HEADERS, 2 BODY
        let headerStart = 0;
        let bodyStart = 0;
        let currentName = null;
        let currentFilename = null;
        let currentSize = 0;
        let bodyChunks = [];
        let totalBodySize = 0;

        function ensure(size) {
            if (bufferLen + size <= buffer.length) return;
            const next = Buffer.allocUnsafe(Math.max(buffer.length * 2, bufferLen + size));
            buffer.copy(next, 0, 0, bufferLen);
            buffer = next;
        }

        function parseHeaders(buf) {
            return buf.toString().split("\r\n").reduce((headers, line) => {
                const idx = line.indexOf(":");
                if (idx !== -1) headers[line.slice(0, idx).toLowerCase()] = line.slice(idx + 1).trim();
                return headers;
            }, {});
        }

        function setupPart(headers) {
            const disp = headers["content-disposition"];
            if (!disp) return;

            currentName = /name="([^"]+)"/.exec(disp)?.[1] ?? null;
            currentFilename = /filename="([^"]*)"/.exec(disp)?.[1] ?? null;

            currentSize = 0;
            bodyChunks.length = 0;
        }

        function finishPart() {
            if (!currentName) return;

            const data = Buffer.concat(bodyChunks, currentSize);
            totalBodySize += data.length;

            if (max_request_size > 0 && totalBodySize > max_request_size) return reject("maximum request size exceeded");
            if (max_body_size > 0 && data.length > max_body_size) return reject("maximum field size exceeded");

            const type = func_param_data_types[currentName], v = data.toString("utf8");

            if (currentFilename) {
                fields[currentName] = currentFilename === ".json" ? decode(v, fields) : currentFilename === "blob" ? new Blob([data]) : new File([data], currentFilename);
            } else {
                fields[currentName] = type === "object" ? decode(v, fields) : type === "number" ? +v : type === "boolean" ? v === "true" : v === "undefined" ? undefined : v === "null" ? null : v;
            }

            currentName = null;
            currentFilename = null;
        }

        stream.on("data", chunk => {
            ensure(chunk.length);
            chunk.copy(buffer, bufferLen);
            bufferLen += chunk.length;

            let i = 0;
            while (i < bufferLen) {
                if (state === 0) {
                    const idx = buffer.indexOf(dashBoundary, i);
                    if (idx === -1) break;
                    i = idx + dashBoundary.length;
                    if (buffer.indexOf(dashBoundaryEnd, idx) === idx) return resolve(fields);
                    if (buffer[i] === 13 && buffer[i + 1] === 10) i += 2;
                    headerStart = i;
                    state = 1;
                }

                if (state === 1) {
                    const idx = buffer.indexOf(headerEndSeq, headerStart);
                    if (idx === -1) break;

                    const headers = parseHeaders(buffer.subarray(headerStart, idx));
                    setupPart(headers);

                    i = idx + 4;
                    bodyStart = i;
                    state = 2;
                }

                if (state === 2) {
                    const idx = buffer.indexOf(dashBoundary, bodyStart);
                    if (idx === -1) break;

                    const chunkData = buffer.subarray(bodyStart, idx - 2);
                    bodyChunks.push(chunkData);
                    currentSize += chunkData.length;

                    finishPart();

                    i = idx + dashBoundary.length;
                    if (buffer[i] === 45 && buffer[i + 1] === 45) return resolve(fields);
                    if (buffer[i] === 13 && buffer[i + 1] === 10) i += 2;
                    headerStart = i;
                    state = 1;
                }
            }

            buffer.copy(buffer, 0, i, bufferLen);
            bufferLen -= i;
        });

        stream.on("end", () => resolve(fields));
        stream.on("error", reject);
    });
}

const deserialization_map = { "Date": (v) => new Date(v), "RegExp": (v) => new RegExp(v), "Set": (v) => new Set(v), "Map": (v) => new Map(v) };
const deserialize = (v) => deserialization_map[v?.__t] ? deserialization_map[v.__t](v.v) : v;
/**
 * @param {string} json
 * @param {Record<string, any>} fields
 */
const decode = (json, fields) => JSON.parse(json, (_, v) => (v?.__b >= 0) ? fields[`blob-${v.__b}`] : deserialize(v));

const serialize = (v) => v instanceof Map ? { __t: "Map", v: [...v] } : v instanceof Set ? { __t: "Set", v: [...v] } : v instanceof RegExp ? { __t: "RegExp", v: v.toString() } : v instanceof Date ? { __t: "Date", v: v.toISOString() } : v;

let encoded_blobs_idx = 0;

/**
 *
 * @param {any} obj
 * @param {FormData} formData
 */
const encode = (obj, formData) => JSON.stringify(obj, (k, v) => {
    if (v instanceof File || v instanceof Blob) {
        formData.append(`blob-${encoded_blobs_idx}`, v);
        return { __b: encoded_blobs_idx++ };
    }
    return serialize(obj[k] || v);
});

/**
 * Writes multipart/form-data to a Node HTTP response
 * @param {ServerResponse} res
 * @param {FormData} formData  (FormData or Map or Object entries)
 */
export async function writeFormDataResponse(res, formData) {
    const boundary = "----" + randomUUID();

    res.setHeader(
        "Content-Type",
        "multipart/form-data; boundary=" + boundary
    );

    for (const [name, value] of formData) {
        res.write(`--${boundary}\r\n`);

        // File / Blob
        if (value?.stream || value instanceof Blob || value instanceof Buffer) {
            const filename = value.name || "blob";
            const type = value.type || "application/octet-stream";

            res.write(
                `Content-Disposition: form-data; name="${name}"; filename="${filename}"\r\n` +
                `Content-Type: ${type}\r\n\r\n`
            );

            const stream =
                value.stream?.() ??
                (value instanceof Buffer
                    ? Readable.from(value)
                    : Readable.from(await value.arrayBuffer()));

            for await (const chunk of stream) {
                res.write(chunk);
            }

            res.write("\r\n");
        }
        // Plain value
        else {
            res.write(
                `Content-Disposition: form-data; name="${name}"\r\n\r\n` +
                String(value) +
                "\r\n"
            );
        }
    }

    res.end(`--${boundary}--`);
}
