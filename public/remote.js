const remote_endpoint = "./api/remote";

/**
 * @param {string} fn_name
 * @param {any} body
 */
async function remoteFetch(fn_name, body) {
    const response = await fetch(remote_endpoint, {
        method: 'POST',
        headers: { 'X-Func-Name': fn_name },
        body: typeof body === "object" ? Object.entries(body).reduce((form, [key, value]) => {
            form.append(key, value)
            return form;
        }, new FormData()) : body,
    })
    return response[response.headers.get("type") || "text"]();
}

/** @type {{ [key:string] : (body:any) => Promise<any> }} */
export const Remote = new Proxy({}, {
    get(_, fn_name) {
        return (body) => remoteFetch(fn_name, body)
    },
});
