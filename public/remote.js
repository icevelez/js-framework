/**
 * @param {string} fn_name
 * @param {any[]} args
 */
async function remoteFetch(fn_name, args, remote_endpoint) {
    const formData = new FormData();
    for (let i = 0; i < args.length; i++) formData.append(i, Object.getPrototypeOf(args[i]) === Object.prototype ? new File([JSON.stringify(args[i])], 'json') : args[i]);

    const response = await fetch(remote_endpoint, {
        method: 'POST',
        headers: { 'X-Func-Name': fn_name },
        body: formData,
    })

    if (response.status >= 400) throw new Error(await response.text());
    if (response.status < 200 || response.status > 300 || response.status === 204) return;

    const parse_type = response.headers.get("parse-type") || "text";
    const data = await response[parse_type]();
    const response_type = response.headers.get("type");

    return (response_type === "number") ? (data - 0) : (response_type === "boolean") ? Boolean(data) : data;
}

/**
 * @param {string} remote_endpoint
 * @returns {object}
 */
export function connectRemote(remote_endpoint = "") {
    return new Proxy({}, {
        get(_, fn_name) {
            return (...args) => remoteFetch(fn_name, args, remote_endpoint)
        },
    });
}
