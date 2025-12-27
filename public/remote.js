/**
 * @param {string} remote_endpoint
 * @param {Record<string, string>} headers
 */
export const connectRemote = (remote_endpoint, headers = {}) => new Proxy(new Object(), {
    get(_, fn_name) {
        return (...args) => remoteFetch(fn_name, headers, args, remote_endpoint)
    },
});

const deserialization_map = { "Date": (v) => new Date(v), "RegExp": (v) => new RegExp(v), "Set": (v) => new Set(v), "Map": (v) => new Map(v) };
const deserialize = (v) => deserialization_map[v?.__t] ? deserialization_map[v.__t](v.v) : v;
const decode = (json, form) => JSON.parse(json, (_, v) => (v?.__b >= 0) ? form.get(`blob-${v.__b}`) : deserialize(v));

let encoded_blobs_idx = 0;
const serialize = (v) => v instanceof Map ? { __t: "Map", v: [...v] } : v instanceof Set ? { __t: "Set", v: [...v] } : v instanceof RegExp ? { __t: "RegExp", v: v.toString() } : v instanceof Date ? { __t: "Date", v: v.toISOString() } : v;
const encode = (obj, formData) => (obj && obj instanceof Date) ? JSON.stringify(serialize(obj)) : JSON.stringify(obj, (k, v) => {
    if (!(v instanceof File || v instanceof Blob)) return serialize(obj[k] || v);
    formData.append(`blob-${encoded_blobs_idx}`, v);
    return { __b: encoded_blobs_idx++ };
});

async function remoteFetch(fn_name, headers, args, remote_endpoint) {
    encoded_blobs_idx = 0;
    const formData = new FormData();
    for (let i = 0; i < args.length; i++) {
        const data = args[i] && typeof args[i] === "object" ? encode(args[i], formData) : args[i];
        formData.append(i, encoded_blobs_idx > 0 ? new File([data], '.json') : data);
    }

    const response = await fetch(remote_endpoint, {
        method: 'POST',
        headers: {
            ...headers,
            'x-func-name': fn_name,
            'x-func-param-datatypes': JSON.stringify(args.map((arg) => arg == null ? "null" : arg === undefined ? "undefined" : typeof arg)),
        },
        body: formData,
    })

    if (response.status >= 400) throw new Error(await response.text());
    if (response.status < 200 || response.status > 299 || response.status === 204) return;

    const contentType = response.headers.get("content-type");
    const dataType = response.headers.get("data-type");

    if (contentType.startsWith("multipart/form-data")) {
        const formData = await response.formData();
        return decode(formData.get("0"), formData);
    }

    const text = await response.text();
    return (dataType === "object") ? decode(text) : (dataType === "number") ? +text : (dataType === "boolean") ? Boolean(text) : text;
}
