const remote_endpoint = "./api/remote";

/**
 * @param {string} fn_name
 * @param {any[]} args
 */
async function remoteFetch(fn_name, args) {
    const formData = new FormData();
    for (let i = 0; i < args.length; i++) formData.append(i, Object.getPrototypeOf(args[i]) === Object.prototype ? new File([JSON.stringify(args[i])], 'json') : args[i]);
    const response = await fetch(remote_endpoint, {
        method: 'POST',
        headers: { 'X-Func-Name': fn_name },
        body: formData,
    })
    const data = await response[response.headers.get("parse-type") || "text"]();
    if (response.headers.get("type") === "number") return data - 0;
    if (response.headers.get("type") === "boolean") return Boolean(data);
    return data;
}

/** @type {{ [key:string] : (body:any) => Promise<any> }} */
export const Remote = new Proxy({}, {
    get(_, fn_name) {
        return (...args) => remoteFetch(fn_name, args)
    },
});
